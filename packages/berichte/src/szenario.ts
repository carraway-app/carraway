import ExcelJS from "exceljs";
import { formatBetrag, formatDatum, formatMultiple, formatProzent, formatZeitpunkt } from "./format";
import { TEXTE, type Texte } from "./texte";
import type { Sprache } from "./typen";
import { literal, setzePdf, type TypstWert } from "./typst";
import { MIT_GRUNDLAGE } from "./vorlagen";

/**
 * Szenariobericht (Etappe 18): Vergleich von bis zu drei Szenarien eines Fonds als PDF und Excel. Das Paket kennt weder Datenbank noch
 * HTTP; die API reicht Ergebnis und Vergleich unverändert durch. Zahlen sind Zeichenketten, gerechnet wird hier nichts.
 */

export const MAX_SZENARIEN_BERICHT = 3;

export interface SzenarioberichtJahr {
  jahr: number;
  ist: boolean;
  abrufe: string;
  ausschuettungenNetto: string;
  navNetto: string;
  dpi: string | null;
  tvpi: string | null;
  irrNetto: string | null;
}

export interface BewertungsWerte {
  nav: string | null;
  tvpi: string | null;
  dpi: string | null;
  carry: string | null;
  navNetto: string | null;
}

export interface SzenarioberichtBewertung {
  beteiligungen: {
    name: string;
    aktuell: string;
    erwartet: string | null;
    /** Erwartungswert der Erlöse laut Exit-Wasserfall; `null` = Lücke (ein Fall ohne Erlös). Fehlt bei älteren Szenarien. */
    erwartetErloes?: string | null;
    faelle: {
      schluessel: string;
      name: string | null;
      methode: string;
      gewicht: string;
      wert: string | null;
      abweichung: string | null;
      /** Erlös des Fonds aus dem Exit-Wasserfall; `null` = der Fall hat keinen Unternehmenswert (fester Wert). Fehlt bei älteren Szenarien. */
      exit?: { erloesFonds: string | null; grund: "keine_kapitaltabelle" | null } | null;
    }[];
  }[];
  aktuell: BewertungsWerte;
  faelle: ({ schluessel: string; name: string | null } & BewertungsWerte)[];
  erwartet: BewertungsWerte;
}

export interface SzenarioberichtDaten {
  fonds: { name: string; kurzname: string; waehrung: string };
  /** Zeitpunkt der Erzeugung (ISO). */
  erzeugt: string;
  szenarien: {
    name: string;
    status: "entwurf" | "festgeschrieben";
    basisStichtag: string;
    ergebnisHash: string | null;
    jahre: SzenarioberichtJahr[];
    beteiligungen: { name: string; ausstiegsJahr: number | null; erloesBeiAusstieg: string; wahrscheinlichkeit: string; erwarteterErloes: string; erloesQuelle: string }[];
    befunde: { code: string; schwere: string; name?: string; params?: Record<string, string | number> }[];
    /** Bewertungsszenarien (Etappe 21); fehlt, wenn das Szenario keine hat. */
    bewertung?: SzenarioberichtBewertung;
  }[];
  vergleich: {
    kennzahlen: { schluessel: string; werte: (string | null)[] }[];
    jkurve: { jahr: number; werte: { tvpi: string | null; irrNetto: string | null }[] }[];
  };
}

const KENNZAHL_ART: Record<string, "betrag" | "multiple" | "prozent" | "jahr"> = {
  abgerufenEnde: "betrag",
  ausschuettungenEnde: "betrag",
  navNettoEnde: "betrag",
  dpiEnde: "multiple",
  tvpiEnde: "multiple",
  irrNettoEnde: "prozent",
  tvpiBruttoEnde: "multiple",
  irrBruttoEnde: "prozent",
  gebuehrenSumme: "betrag",
  carrySumme: "betrag",
  ausschuettungenBruttoSumme: "betrag",
  tvpiTiefpunkt: "multiple",
  tvpiTiefpunktJahr: "jahr",
};

function zeigeKennzahl(art: "betrag" | "multiple" | "prozent" | "jahr", wert: string | null, sprache: Sprache, waehrung: string): string {
  if (wert === null) return "–";
  if (art === "betrag") return formatBetrag(wert, sprache, waehrung);
  if (art === "multiple") return formatMultiple(wert, sprache);
  if (art === "prozent") return formatProzent(wert, sprache);
  return wert;
}

/** Text zu einem Befund mit eingesetzten Werten (`{name}`, `{jahr}`, `{betrag}`). */
export function befundText(t: Texte, b: SzenarioberichtDaten["szenarien"][number]["befunde"][number], waehrung: string, sprache: Sprache): string {
  const vorlage = t.szenario.befunde[b.code] ?? b.code;
  return vorlage.replace(/\{(\w+)\}/g, (_x, k: string) => {
    if (k === "name") return b.name ?? "";
    const wert = b.params?.[k];
    if (wert === undefined) return "";
    return k === "betrag" ? formatBetrag(String(wert), sprache, waehrung) : String(wert);
  });
}

const fallName = (f: { schluessel: string; name: string | null }) => f.name ?? f.schluessel;

/** Tabellenzeilen der Bewertungsszenarien: je Beteiligung der aktuelle Wert, die Fälle und der Erwartungswert. */
function bewertungZeilen(b: SzenarioberichtBewertung, t: Texte, sprache: Sprache, waehrung: string): string[][] {
  const betrag = (w: string | null) => (w === null ? t.szenario.luecke : formatBetrag(w, sprache, waehrung));
  // Erlös laut Wasserfall: nur bei Fällen mit Unternehmenswert; ohne Kapitaltabelle steht der Grund, nie eine erfundene Zahl.
  const erloes = (f: SzenarioberichtBewertung["beteiligungen"][number]["faelle"][number]) => (!f.exit ? "" : f.exit.erloesFonds === null ? t.szenario.ohneTabelle : formatBetrag(f.exit.erloesFonds, sprache, waehrung));
  const erwartetErloes = (x: SzenarioberichtBewertung["beteiligungen"][number]) => (x.faelle.length > 0 && x.faelle.every((f) => f.exit) ? (x.erwartetErloes == null ? t.szenario.luecke : formatBetrag(x.erwartetErloes, sprache, waehrung)) : "");
  return b.beteiligungen.flatMap((x) => [
    [x.name, t.szenario.aktuellZeile, "", "", betrag(x.aktuell), "", ""],
    ...x.faelle.map((f) => ["", fallName(f), t.szenario.methoden[f.methode] ?? f.methode, formatProzent(f.gewicht, sprache), betrag(f.wert), f.abweichung === null ? "" : formatBetrag(f.abweichung, sprache, waehrung), erloes(f)]),
    ["", t.szenario.erwartetZeile, "", "", betrag(x.erwartet), x.erwartet === null ? "" : formatBetrag((Number(x.erwartet) - Number(x.aktuell)).toFixed(2), sprache, waehrung), erwartetErloes(x)],
  ]);
}

/** Wirkung auf den Fonds: aktueller Stand, je Fall und erwartet. */
function wirkungZeilen(b: SzenarioberichtBewertung, t: Texte, sprache: Sprache, waehrung: string): string[][] {
  const zeile = (name: string, w: BewertungsWerte) => [
    name,
    w.nav === null ? t.szenario.luecke : formatBetrag(w.nav, sprache, waehrung),
    w.tvpi === null ? "–" : formatMultiple(w.tvpi, sprache),
    w.dpi === null ? "–" : formatMultiple(w.dpi, sprache),
    w.carry === null ? "–" : formatBetrag(w.carry, sprache, waehrung),
    w.navNetto === null ? "–" : formatBetrag(w.navNetto, sprache, waehrung),
  ];
  return [zeile(t.szenario.aktuellZeile, b.aktuell), ...b.faelle.map((f) => zeile(fallName(f), f)), zeile(t.szenario.erwartetZeile, b.erwartet)];
}

const VORLAGE = String.raw`
#let strich = (
  (paint: diagramm-ink, thickness: 1.4pt),
  (paint: diagramm-grau, thickness: 1.4pt, dash: "dashed"),
  (paint: rgb("#9a9ea5"), thickness: 1.6pt, dash: "dotted"),
)
#let kurve(serien, hoehe) = box(width: 100%, height: hoehe, stroke: (bottom: 0.5pt + diagramm-linie, left: 0.5pt + diagramm-linie), layout(size => {
  for (i, s) in serien.enumerate() {
    place(top + left, path(stroke: strich.at(i), ..s.map(p => (p.at(0) * size.width, (1 - p.at(1)) * size.height))))
  }
}))
#beschriftung(data.kopf)
#v(0.5 * u)
#text(font: anzeige, weight: 700, size: 26pt, tracking: -0.01em)[#upper(data.t.szenario.titel)]
#linebreak()
#text(size: 10pt, fill: grau)[#data.untertitel]
#v(1 * u)
#grid(columns: (1fr, 1fr), column-gutter: u,
  kachel(data.t.fonds, data.fonds),
  kachel(data.t.szenario.basisStichtag, data.basis),
)
#abschnitt(data.t.szenario.kennzahlenTitel)
#tabelle2(data.kennzahlenKopf, data.kennzahlen, data.kennzahlenAusrichtung, data.kennzahlenBreiten)
#v(0.5 * u)
#text(size: 7.5pt, fill: grau)[#data.t.szenario.nettoHinweis]
#abschnitt(data.t.szenario.jkurveTitel)
#if data.serien.len() > 0 [
  #kurve(data.serien, 40 * u)
  #v(0.5 * u)
  #grid(columns: data.legende.map(_ => 1fr), column-gutter: u, ..data.legende.map(l => text(font: mono, size: 7pt, fill: grau)[#l]))
  #v(0.5 * u)
  #text(size: 7.5pt, fill: grau)[#data.t.szenario.jkurveTabelle]
  #tabelle2(data.jkurveKopf, data.jkurveZeilen, data.jkurveAusrichtung, data.jkurveBreiten)
]
#for s in data.szenarien {
  pagebreak(weak: true)
  abschnitt(s.titel)
  text(size: 8pt, fill: grau)[#s.zeile]
  v(0.5 * u)
  tabelle2(data.jahreKopf, s.jahre, data.jahreAusrichtung, data.jahreBreiten)
  abschnitt(data.t.szenario.beteiligungenTitel)
  if s.beteiligungen.len() > 0 { tabelle2(data.beteiligungenKopf, s.beteiligungen, data.beteiligungenAusrichtung, data.beteiligungenBreiten) }
  if s.bewertung != none {
    abschnitt(data.t.szenario.bewertungTitel)
    tabelle2(data.bewertungKopf, s.bewertung.zeilen, data.bewertungAusrichtung, data.bewertungBreiten)
    v(0.5 * u)
    abschnitt(data.t.szenario.wirkungTitel)
    tabelle2(data.wirkungKopf, s.bewertung.wirkung, data.wirkungAusrichtung, data.wirkungBreiten)
    v(0.5 * u)
    text(size: 7.5pt, fill: grau)[#data.t.szenario.bewertungHinweis]
  }
  abschnitt(data.t.szenario.befundeTitel)
  if s.befunde.len() == 0 { text(fill: grau)[#data.t.szenario.keineBefunde] } else { for b in s.befunde { text(size: 8pt)[#b] ; linebreak() } }
}
`;

/** Typst-Quelle des Szenarioberichts. */
export function szenarioberichtQuelle(d: SzenarioberichtDaten, sprache: Sprache, optionen: { entwurf?: boolean } = {}): string {
  const t = TEXTE[sprache];
  const w = d.fonds.waehrung;
  const sz = d.szenarien.slice(0, MAX_SZENARIEN_BERICHT);
  const lagen = (v: number | string) => String(v);
  const zahlen = sz.flatMap((s) => s.jahre.map((j) => Number(j.tvpi ?? 0)));
  const jahre = d.vergleich.jkurve.map((j) => j.jahr);
  const minJ = Math.min(...jahre);
  const maxJ = Math.max(...jahre);
  const hoch = Math.max(1, ...zahlen) * 1.05;
  const tief = Math.min(0, ...zahlen);
  const serien: TypstWert[] = sz.map((_s, i) =>
    d.vergleich.jkurve
      .map((j) => [j.jahr, j.werte[i]?.tvpi ?? null] as const)
      .filter((p): p is readonly [number, string] => p[1] !== null)
      .map((p) => [maxJ === minJ ? 0 : (p[0] - minJ) / (maxJ - minJ), (Number(p[1]) - tief) / (hoch - tief)]),
  );
  const daten: Record<string, TypstWert> = {
    sprache,
    t: t as unknown as TypstWert,
    // Ohne Angabe gilt: Entwurf, solange ein Szenario noch nicht festgeschrieben ist (Direktabruf); die Berichtsfreigabe gibt die Angabe vor.
    entwurf: optionen.entwurf ?? sz.some((s) => s.status === "entwurf"),
    titel: `${t.szenario.titel} ${d.fonds.kurzname}`,
    kopf: `${t.szenario.kopf} · ${d.fonds.name}`,
    untertitel: t.szenario.untertitel,
    stichtag: formatDatum(sz.map((s) => s.basisStichtag).sort().at(-1) ?? d.erzeugt.slice(0, 10), sprache),
    wissensstand: formatZeitpunkt(d.erzeugt, sprache),
    fonds: d.fonds.name,
    basis: [...new Set(sz.map((s) => formatDatum(s.basisStichtag, sprache)))].join(", "),
    kennzahlenKopf: [t.szenario.kennzahl, ...sz.map((s) => s.name)],
    kennzahlen: d.vergleich.kennzahlen.map((k) => [t.szenario.kennzahlen[k.schluessel] ?? k.schluessel, ...sz.map((_s, i) => zeigeKennzahl(KENNZAHL_ART[k.schluessel] ?? "betrag", k.werte[i] ?? null, sprache, w))]),
    kennzahlenAusrichtung: ["left", ...sz.map(() => "right")],
    kennzahlenBreiten: [2, ...sz.map(() => 1)],
    serien,
    legende: sz.map((s, i) => `${["—", "- -", "···"][i]} ${s.name}`),
    jkurveKopf: [t.szenario.spalten.jahr, ...sz.map((s) => s.name)],
    jkurveZeilen: d.vergleich.jkurve.map((j) => [lagen(j.jahr), ...sz.map((_s, i) => formatMultiple(j.werte[i]?.tvpi ?? null, sprache))]),
    jkurveAusrichtung: ["left", ...sz.map(() => "right")],
    jkurveBreiten: [1, ...sz.map(() => 1)],
    jahreKopf: [t.szenario.spalten.jahr, t.szenario.spalten.abrufe, t.szenario.spalten.ausschuettungen, t.szenario.spalten.nav, t.szenario.spalten.dpi, t.szenario.spalten.tvpi, t.szenario.spalten.irr],
    jahreAusrichtung: ["left", "right", "right", "right", "right", "right", "right"],
    jahreBreiten: [null, 1.3, 1.3, 1.3, null, null, null],
    beteiligungenKopf: [t.szenario.spalten.unternehmen, t.szenario.spalten.ausstieg, t.szenario.spalten.erloes, t.szenario.spalten.wahrscheinlichkeit, t.szenario.spalten.erwartet, t.szenario.spalten.quelle],
    beteiligungenAusrichtung: ["left", "right", "right", "right", "right", "left"],
    beteiligungenBreiten: [2, null, 1.2, null, 1.2, 1.4],
    bewertungKopf: [t.szenario.bewertungSpalten.unternehmen, t.szenario.bewertungSpalten.fall, t.szenario.bewertungSpalten.methode, t.szenario.bewertungSpalten.wahrscheinlichkeit, t.szenario.bewertungSpalten.wert, t.szenario.bewertungSpalten.abweichung, t.szenario.bewertungSpalten.erloes],
    bewertungAusrichtung: ["left", "left", "left", "right", "right", "right", "right"],
    bewertungBreiten: [2, 1.2, 1.6, 1, 1.3, 1.4, 1.5],
    wirkungKopf: [t.szenario.wirkungSpalten.fall, t.szenario.wirkungSpalten.nav, t.szenario.wirkungSpalten.tvpi, t.szenario.wirkungSpalten.dpi, t.szenario.wirkungSpalten.carry, t.szenario.wirkungSpalten.navNetto],
    wirkungAusrichtung: ["left", "right", "right", "right", "right", "right"],
    wirkungBreiten: [1.6, 1.4, 1, 1, 1.4, 1.4],
    szenarien: sz.map((s) => ({
      titel: s.name,
      zeile: `${t.szenario.status[s.status] ?? s.status} · ${t.szenario.basisStichtag} ${formatDatum(s.basisStichtag, sprache)}${s.ergebnisHash ? ` · ${t.szenario.pruefsumme}: ${s.ergebnisHash}` : ""}`,
      jahre: s.jahre.map((j) => [`${j.jahr}${j.ist ? "*" : ""}`, formatBetrag(j.abrufe, sprache, w), formatBetrag(j.ausschuettungenNetto, sprache, w), formatBetrag(j.navNetto, sprache, w), formatMultiple(j.dpi, sprache), formatMultiple(j.tvpi, sprache), formatProzent(j.irrNetto, sprache)]),
      beteiligungen: s.beteiligungen.map((b) => [
        b.name,
        b.ausstiegsJahr === null ? "–" : String(b.ausstiegsJahr),
        formatBetrag(b.erloesBeiAusstieg, sprache, w),
        formatProzent(b.wahrscheinlichkeit, sprache),
        formatBetrag(b.erwarteterErloes, sprache, w),
        t.szenario.quellen[b.erloesQuelle] ?? b.erloesQuelle,
      ]),
      befunde: s.befunde.map((b) => befundText(t, b, w, sprache)),
      bewertung: s.bewertung ? { zeilen: bewertungZeilen(s.bewertung, t, sprache, w), wirkung: wirkungZeilen(s.bewertung, t, sprache, w) } : null,
    })),
  };
  return `#let data = ${literal(daten)}\n${MIT_GRUNDLAGE(VORLAGE)}`;
}

export const erzeugeSzenarioberichtPdf = (d: SzenarioberichtDaten, sprache: Sprache, optionen: { entwurf?: boolean } = {}): Uint8Array => setzePdf(szenarioberichtQuelle(d, sprache, optionen));

const FORMAT = { betrag: '#,##0.00 "€"', multiple: '0.00"x"', prozent: "0.0%" } as const;
const zahl = (w: string | null) => (w === null ? null : Number(w));

export async function erzeugeSzenarioberichtExcel(d: SzenarioberichtDaten, sprache: Sprache): Promise<Uint8Array> {
  const t = TEXTE[sprache];
  const wb = new ExcelJS.Workbook();
  wb.creator = "Carraway";
  wb.created = new Date();
  const sz = d.szenarien.slice(0, MAX_SZENARIEN_BERICHT);

  const vergleich = wb.addWorksheet(t.szenario.kennzahlenTitel.slice(0, 31));
  vergleich.columns = [{ header: t.szenario.kennzahl, key: "k", width: 44 }, ...sz.map((s, i) => ({ header: s.name, key: `s${i}`, width: 22 }))];
  for (const k of d.vergleich.kennzahlen) {
    const art = KENNZAHL_ART[k.schluessel] ?? "betrag";
    const zeile = vergleich.addRow({ k: t.szenario.kennzahlen[k.schluessel] ?? k.schluessel, ...Object.fromEntries(sz.map((_s, i) => [`s${i}`, zahl(k.werte[i] ?? null)])) });
    sz.forEach((_s, i) => {
      if (art !== "jahr") zeile.getCell(i + 2).numFmt = FORMAT[art];
    });
  }
  vergleich.addRow([]);
  vergleich.addRow([t.szenario.nettoHinweis]);
  vergleich.getRow(1).font = { bold: true };
  vergleich.views = [{ state: "frozen", ySplit: 1 }];

  const kurve = wb.addWorksheet(t.szenario.jkurveTitel.slice(0, 31).replace(/[\\/*?:[\]]/g, " "));
  kurve.columns = [{ header: t.szenario.spalten.jahr, key: "j", width: 10 }, ...sz.map((s, i) => ({ header: `${s.name} TVPI`, key: `t${i}`, width: 22 })), ...sz.map((s, i) => ({ header: `${s.name} IRR`, key: `i${i}`, width: 22 }))];
  for (const j of d.vergleich.jkurve) {
    const zeile = kurve.addRow({ j: j.jahr, ...Object.fromEntries(sz.map((_s, i) => [`t${i}`, zahl(j.werte[i]?.tvpi ?? null)])), ...Object.fromEntries(sz.map((_s, i) => [`i${i}`, zahl(j.werte[i]?.irrNetto ?? null)])) });
    sz.forEach((_s, i) => {
      zeile.getCell(2 + i).numFmt = FORMAT.multiple;
      zeile.getCell(2 + sz.length + i).numFmt = FORMAT.prozent;
    });
  }
  kurve.getRow(1).font = { bold: true };
  kurve.views = [{ state: "frozen", ySplit: 1 }];

  sz.forEach((s, i) => {
    const blatt = wb.addWorksheet(`${i + 1} ${s.name}`.slice(0, 31).replace(/[\\/*?:[\]]/g, " "));
    blatt.columns = [
      { header: t.szenario.spalten.jahr, key: "jahr", width: 10 },
      { header: t.szenario.spalten.abrufe, key: "abrufe", width: 20, style: { numFmt: FORMAT.betrag } },
      { header: t.szenario.spalten.ausschuettungen, key: "aus", width: 22, style: { numFmt: FORMAT.betrag } },
      { header: t.szenario.spalten.nav, key: "nav", width: 20, style: { numFmt: FORMAT.betrag } },
      { header: t.szenario.spalten.dpi, key: "dpi", width: 10, style: { numFmt: FORMAT.multiple } },
      { header: t.szenario.spalten.tvpi, key: "tvpi", width: 10, style: { numFmt: FORMAT.multiple } },
      { header: t.szenario.spalten.irr, key: "irr", width: 12, style: { numFmt: FORMAT.prozent } },
    ];
    for (const j of s.jahre) blatt.addRow({ jahr: j.ist ? `${j.jahr} *` : j.jahr, abrufe: zahl(j.abrufe), aus: zahl(j.ausschuettungenNetto), nav: zahl(j.navNetto), dpi: zahl(j.dpi), tvpi: zahl(j.tvpi), irr: zahl(j.irrNetto) });
    blatt.getRow(1).font = { bold: true };
    blatt.views = [{ state: "frozen", ySplit: 1 }];
    blatt.addRow([]);
    blatt.addRow([`${t.szenario.status[s.status] ?? s.status} · ${t.szenario.basisStichtag} ${formatDatum(s.basisStichtag, sprache)}${s.ergebnisHash ? ` · ${t.szenario.pruefsumme}: ${s.ergebnisHash}` : ""}`]);
    blatt.addRow([]);
    blatt.addRow([t.szenario.beteiligungenTitel]).font = { bold: true };
    blatt.addRow([t.szenario.spalten.unternehmen, t.szenario.spalten.ausstieg, t.szenario.spalten.erloes, t.szenario.spalten.wahrscheinlichkeit, t.szenario.spalten.erwartet, t.szenario.spalten.quelle]).font = { bold: true };
    for (const b of s.beteiligungen) {
      const z = blatt.addRow([b.name, b.ausstiegsJahr, zahl(b.erloesBeiAusstieg), zahl(b.wahrscheinlichkeit), zahl(b.erwarteterErloes), t.szenario.quellen[b.erloesQuelle] ?? b.erloesQuelle]);
      z.getCell(3).numFmt = FORMAT.betrag;
      z.getCell(4).numFmt = FORMAT.prozent;
      z.getCell(5).numFmt = FORMAT.betrag;
    }
    if (s.bewertung) {
      blatt.addRow([]);
      blatt.addRow([t.szenario.bewertungTitel]).font = { bold: true };
      blatt.addRow([t.szenario.bewertungSpalten.unternehmen, t.szenario.bewertungSpalten.fall, t.szenario.bewertungSpalten.methode, t.szenario.bewertungSpalten.wahrscheinlichkeit, t.szenario.bewertungSpalten.wert, t.szenario.bewertungSpalten.abweichung, t.szenario.bewertungSpalten.erloes]).font = { bold: true };
      for (const x of s.bewertung.beteiligungen) {
        blatt.addRow([x.name, t.szenario.aktuellZeile, "", null, zahl(x.aktuell), null, null]).getCell(5).numFmt = FORMAT.betrag;
        for (const f of x.faelle) {
          // Erlös laut Exit-Wasserfall: leer ohne Unternehmenswert, der Grund ohne Kapitaltabelle des Fonds.
          const erloes = !f.exit ? null : f.exit.erloesFonds === null ? t.szenario.ohneTabelle : zahl(f.exit.erloesFonds);
          const z = blatt.addRow(["", fallName(f), t.szenario.methoden[f.methode] ?? f.methode, zahl(f.gewicht), f.wert === null ? t.szenario.luecke : zahl(f.wert), zahl(f.abweichung), erloes]);
          z.getCell(4).numFmt = FORMAT.prozent;
          z.getCell(5).numFmt = FORMAT.betrag;
          z.getCell(6).numFmt = FORMAT.betrag;
          z.getCell(7).numFmt = FORMAT.betrag;
        }
        const alleMitErloes = x.faelle.length > 0 && x.faelle.every((f) => f.exit);
        const e = blatt.addRow(["", t.szenario.erwartetZeile, "", null, x.erwartet === null ? t.szenario.luecke : zahl(x.erwartet), x.erwartet === null ? null : Number(x.erwartet) - Number(x.aktuell), alleMitErloes ? (x.erwartetErloes == null ? t.szenario.luecke : zahl(x.erwartetErloes)) : null]);
        e.getCell(5).numFmt = FORMAT.betrag;
        e.getCell(6).numFmt = FORMAT.betrag;
        e.getCell(7).numFmt = FORMAT.betrag;
      }
      blatt.addRow([]);
      blatt.addRow([t.szenario.wirkungTitel]).font = { bold: true };
      blatt.addRow([t.szenario.wirkungSpalten.fall, t.szenario.wirkungSpalten.nav, t.szenario.wirkungSpalten.tvpi, t.szenario.wirkungSpalten.dpi, t.szenario.wirkungSpalten.carry, t.szenario.wirkungSpalten.navNetto]).font = { bold: true };
      const wirkung = (name: string, w: BewertungsWerte) => {
        const z = blatt.addRow([name, w.nav === null ? t.szenario.luecke : zahl(w.nav), zahl(w.tvpi), zahl(w.dpi), zahl(w.carry), zahl(w.navNetto)]);
        z.getCell(2).numFmt = FORMAT.betrag;
        z.getCell(3).numFmt = FORMAT.multiple;
        z.getCell(4).numFmt = FORMAT.multiple;
        z.getCell(5).numFmt = FORMAT.betrag;
        z.getCell(6).numFmt = FORMAT.betrag;
      };
      wirkung(t.szenario.aktuellZeile, s.bewertung.aktuell);
      for (const f of s.bewertung.faelle) wirkung(fallName(f), f);
      wirkung(t.szenario.erwartetZeile, s.bewertung.erwartet);
      blatt.addRow([t.szenario.bewertungHinweis]);
    }
    blatt.addRow([]);
    blatt.addRow([t.szenario.befundeTitel]).font = { bold: true };
    if (s.befunde.length === 0) blatt.addRow([t.szenario.keineBefunde]);
    for (const b of s.befunde) blatt.addRow([befundText(t, b, d.fonds.waehrung, sprache)]);
  });
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
