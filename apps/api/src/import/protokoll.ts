import ExcelJS from "exceljs";
import { MIT_GRUNDLAGE, literal, setzePdf, type TypstWert } from "@carraway/berichte";
import { BLAETTER, BLATT_NAMEN, type Blatt } from "@carraway/import";
import type { UebernahmeErgebnis } from "./uebernehmen";

/**
 * Abnahmeprotokoll eines Import-Laufs als PDF oder Excel: Dateikopf (Prüfsumme), wer geprüft und wer übernommen hat (Vier-Augen),
 * Mengen je Objekt, Summen je Fonds neben den Kontrollsummen der Quelle und alle Befunde als offene Punkte.
 */

export type ProtokollSprache = "de" | "en";

export interface ProtokollLauf {
  id: string;
  dateiname: string;
  dateityp: string;
  groesse: number;
  sha256: string;
  status: string;
  hochgeladenVonName: string | null;
  hochgeladenVon: string;
  hochgeladenAm: Date;
  geprueftVonName: string | null;
  geprueftVon: string | null;
  geprueftAm: Date | null;
  uebernommenVonName: string | null;
  uebernommenVon: string | null;
  uebernommenAm: Date | null;
  fehlerAnzahl: number | null;
  warnungAnzahl: number | null;
  befundeGekuerzt: boolean;
  ergebnis: UebernahmeErgebnis | null;
  vorschau: { zaehler: UebernahmeErgebnis["zaehler"] } | null;
}

export interface ProtokollBefund {
  nr: number;
  blatt: string | null;
  /** Name des Blattes wie in der Datei; das Protokoll zeigt ihn, sonst den Schlüssel. */
  blattName?: string | null;
  zeile: number | null;
  spalte: string | null;
  code: string;
  schweregrad: string;
  meldung: string;
}

const T = {
  de: {
    titel: "Abnahmeprotokoll Datenübernahme",
    kopf: "Abnahmeprotokoll",
    datei: "Datei",
    pruefsumme: "Prüfsumme SHA-256",
    status: "Stand",
    stati: { hochgeladen: "hochgeladen", geprueft: "geprüft", uebernommen: "übernommen" } as Record<string, string>,
    hochgeladen: "Hochgeladen von",
    geprueft: "Geprüft von",
    uebernommen: "Übernommen von",
    vierAugen: "Vier-Augen: Die übernehmende Person ist weder die hochladende noch die prüfende Person.",
    nochNicht: "noch nicht",
    mengen: "Mengen je Objekt",
    objekt: "Objekt",
    zeilen: "Zeilen",
    angelegt: "Angelegt",
    vorhanden: "Unverändert",
    abweichend: "Abweichend",
    summen: "Summen je Fonds",
    fonds: "Fonds",
    groesse: "Größe",
    quelle: "Quelle",
    ist: "Nach Übernahme",
    differenz: "Differenz",
    ergebnis: "Ergebnis",
    ok: "stimmt",
    abweichung: "Abweichung",
    nichtBerechnet: "nicht berechnet",
    keineKontrolle: "keine Kontrollsumme angegeben",
    befunde: "Befunde und offene Punkte",
    keineBefunde: "Keine Befunde.",
    gekuerzt: "Die Liste ist gekürzt; die Anzahlen zählen alle Befunde.",
    fehler: "Fehler",
    warnungen: "Warnungen",
    beteiligungen: "Beteiligungen",
    zusagen: "Zusagen",
    auszahlungen: "Auszahlungen",
    rueckfluesse: "Rückflüsse",
    nav: "NAV",
    zeichnungskapital: "Zeichnungskapital",
    stichtag: "Stand",
    erstellt: "Erstellt",
    seite: "Seite",
    von: "von",
    blatt: "Blatt",
    zeile: "Zeile",
    spalte: "Spalte",
    code: "Code",
    grad: "Art",
    meldung: "Meldung",
    offen: "Offener Punkt",
    uebersicht: "Übersicht",
  },
  en: {
    titel: "Acceptance report data take-over",
    kopf: "Acceptance report",
    datei: "File",
    pruefsumme: "Checksum SHA-256",
    status: "State",
    stati: { hochgeladen: "uploaded", geprueft: "checked", uebernommen: "taken over" } as Record<string, string>,
    hochgeladen: "Uploaded by",
    geprueft: "Checked by",
    uebernommen: "Taken over by",
    vierAugen: "Four eyes: the person taking over is neither the uploader nor the checker.",
    nochNicht: "not yet",
    mengen: "Counts per object",
    objekt: "Object",
    zeilen: "Rows",
    angelegt: "Created",
    vorhanden: "Unchanged",
    abweichend: "Differing",
    summen: "Totals per fund",
    fonds: "Fund",
    groesse: "Measure",
    quelle: "Source",
    ist: "After take-over",
    differenz: "Difference",
    ergebnis: "Result",
    ok: "matches",
    abweichung: "deviation",
    nichtBerechnet: "not calculated",
    keineKontrolle: "no control total given",
    befunde: "Findings and open items",
    keineBefunde: "No findings.",
    gekuerzt: "The list is shortened; the counts include all findings.",
    fehler: "Errors",
    warnungen: "Warnings",
    beteiligungen: "Holdings",
    zusagen: "Commitments",
    auszahlungen: "Disbursements",
    rueckfluesse: "Distributions",
    nav: "NAV",
    zeichnungskapital: "Subscribed capital",
    stichtag: "As of",
    erstellt: "Created",
    seite: "Page",
    von: "of",
    blatt: "Sheet",
    zeile: "Row",
    spalte: "Column",
    code: "Code",
    grad: "Type",
    meldung: "Message",
    offen: "Open item",
    uebersicht: "Overview",
  },
} as const;

const zeitpunkt = (d: Date | null) => (d ? d.toISOString().replace("T", " ").slice(0, 19) + " UTC" : "");
const zahl = (x: string | null) => (x === null ? "–" : x.replace(/\B(?=(\d{3})+(?!\d))/g, ","));

export interface Protokolldaten {
  lauf: ProtokollLauf;
  befunde: ProtokollBefund[];
  sprache: ProtokollSprache;
  aenderungen?: readonly { zeile: number; typ: string; id: string; feld: string; vorher: string | null; nachher: string | null }[];
}

function mengenZeilen(d: Protokolldaten): { blatt: Blatt; name: string; z: UebernahmeErgebnis["zaehler"][Blatt] }[] {
  const zaehler = d.lauf.ergebnis?.zaehler ?? d.lauf.vorschau?.zaehler;
  if (!zaehler) return [];
  return BLAETTER.filter((b) => zaehler[b].zeilen > 0).map((b) => ({ blatt: b, name: BLATT_NAMEN[b][d.sprache], z: zaehler[b] }));
}

export async function erzeugeProtokollExcel(d: Protokolldaten): Promise<Buffer> {
  const t = T[d.sprache];
  const wb = new ExcelJS.Workbook();
  wb.creator = "Carraway";
  const kopf = (b: ExcelJS.Worksheet) => {
    b.getRow(1).font = { bold: true };
    b.views = [{ state: "frozen", ySplit: 1 }];
  };
  const u = wb.addWorksheet(t.uebersicht);
  u.columns = [{ header: "", width: 28 }, { header: "", width: 70 }];
  const l = d.lauf;
  const reihen: [string, string | number][] = [
    [t.datei, l.dateiname],
    [t.pruefsumme, l.sha256],
    [t.status, t.stati[l.status] ?? l.status],
    [t.hochgeladen, `${l.hochgeladenVonName ?? l.hochgeladenVon}, ${zeitpunkt(l.hochgeladenAm)}`],
    [t.geprueft, l.geprueftAm ? `${l.geprueftVonName ?? l.geprueftVon}, ${zeitpunkt(l.geprueftAm)}` : t.nochNicht],
    [t.uebernommen, l.uebernommenAm ? `${l.uebernommenVonName ?? l.uebernommenVon}, ${zeitpunkt(l.uebernommenAm)}` : t.nochNicht],
    [t.fehler, l.fehlerAnzahl ?? 0],
    [t.warnungen, l.warnungAnzahl ?? 0],
  ];
  u.addRows([[t.titel, ""], ...reihen]);
  u.getRow(1).font = { bold: true };
  if (l.uebernommenAm) u.addRow(["", t.vierAugen]);

  const m = wb.addWorksheet(t.mengen);
  m.addRow([t.objekt, t.zeilen, t.angelegt, t.vorhanden, t.abweichend]);
  kopf(m);
  for (const z of mengenZeilen(d)) m.addRow([z.name, z.z.zeilen, z.z.neu, z.z.unveraendert, z.z.abweichend]);
  m.columns.forEach((c) => (c.width = 22));

  const s = wb.addWorksheet(t.summen);
  s.addRow([t.fonds, t.groesse, t.quelle, t.ist, t.differenz, t.ergebnis]);
  kopf(s);
  for (const f of l.ergebnis?.fonds ?? []) {
    const grund: [string, string | null][] = [
      [t.beteiligungen, String(f.beteiligungen)],
      [t.zusagen, f.zusagen],
      [t.auszahlungen, f.auszahlungen],
      [t.rueckfluesse, f.rueckfluesse],
      [t.nav, f.nav],
      [t.zeichnungskapital, f.zeichnungskapital],
    ];
    for (const k of f.kontrollsummen) {
      const name = (t as unknown as Record<string, string>)[k.groesse] ?? k.groesse;
      s.addRow([f.kurzname, name, Number(k.quelle), k.ist === null ? null : Number(k.ist), k.differenz === null ? null : Number(k.differenz), k.status === "ok" ? t.ok : k.status === "abweichung" ? t.abweichung : t.nichtBerechnet]);
    }
    for (const [name, wert] of grund) {
      if (name === t.beteiligungen || !f.kontrollsummen.some((k) => ((t as unknown as Record<string, string>)[k.groesse] ?? k.groesse) === name)) s.addRow([f.kurzname, name, null, wert === null ? null : Number(wert), null, wert && name !== t.beteiligungen ? t.keineKontrolle : ""]);
    }
  }
  s.columns.forEach((c) => (c.width = 24));
  for (const spalte of [3, 4, 5]) s.getColumn(spalte).numFmt = "#,##0.00";

  const b = wb.addWorksheet(t.befunde);
  b.addRow([t.blatt, t.zeile, t.spalte, t.code, t.grad, t.meldung]);
  kopf(b);
  for (const x of d.befunde) b.addRow([(x.blattName ?? x.blatt) ?? "", x.zeile ?? "", x.spalte ?? "", x.code, x.schweregrad === "fehler" ? t.fehler : t.offen, x.meldung]);
  [18, 8, 26, 34, 16, 120].forEach((w, i) => (b.getColumn(i + 1).width = w));
  if (d.aenderungen?.length) {
    const de = d.sprache === "de";
    const a = wb.addWorksheet(de ? "Änderungen" : "Changes");
    a.addRow([t.zeile, t.objekt, "ID", de ? "Feld" : "Field", de ? "Vorher" : "Before", de ? "Nachher" : "After"]);
    kopf(a);
    // Strings sind in XLSX eigene Zellwerte. ExcelJS erzeugt Formeln nur aus expliziten Formelobjekten.
    for (const z of d.aenderungen) a.addRow([z.zeile, z.typ, z.id, z.feld, z.vorher, z.nachher]);
    [8, 16, 39, 24, 38, 38].forEach((w, i) => (a.getColumn(i + 1).width = w));
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const PDF_VORLAGE = String.raw`
#beschriftung(data.kopf)
#v(0.5 * u)
#text(font: anzeige, weight: 700, size: 22pt, tracking: -0.01em)[#upper(data.titelText)]
#linebreak()
#text(size: 10pt, fill: grau)[#data.datei]
#v(1 * u)
#grid(columns: (1fr, 1fr, 1fr), column-gutter: u,
  kachel(data.t.hochgeladen, data.hochgeladenVon, hinweis: data.hochgeladenAm),
  kachel(data.t.geprueft, data.geprueftVon, hinweis: data.geprueftAm),
  kachel(data.t.uebernommen, data.uebernommenVon, hinweis: data.uebernommenAm, dunkel: true),
)
#v(0.5 * u)
#text(size: 8pt, fill: grau)[#data.vierAugen · #data.t.pruefsumme: #data.sha256]
#abschnitt(data.t.mengen)
#tabelle2(data.mengenKopf, data.mengen, ("left", "right", "right", "right", "right"), (3, 1, 1, 1, 1))
#abschnitt(data.t.summen)
#if data.summen.len() == 0 [#text(fill: grau)[#data.t.nochNicht]] else [
  #tabelle2(data.summenKopf, data.summen, ("left", "left", "right", "right", "right", "left"), (2, 2, 2, 2, 2, 2))
]
#abschnitt(data.t.befunde)
#text(size: 8pt, fill: grau)[#data.befundZahl]
#v(0.5 * u)
#if data.befunde.len() == 0 [#text(fill: grau)[#data.t.keineBefunde]] else [
  #tabelle2(data.befundKopf, data.befunde, ("left", "right", "left", "left", "left"), (2, 1, 2, 3, 6))
]
#if data.gekuerzt != "" [#v(0.5 * u) #text(size: 8pt, fill: grau)[#data.gekuerzt]]
`;

/** PDF des Abnahmeprotokolls (Typst, Design wie die Berichte). Höchstens 500 Befunde stehen im PDF; der Rest steht in der Excel-Fassung. */
export function erzeugeProtokollPdf(d: Protokolldaten): Buffer {
  const t = T[d.sprache];
  const l = d.lauf;
  const MAX_BEFUNDE_PDF = 500;
  const sicht = d.befunde.slice(0, MAX_BEFUNDE_PDF);
  const name = (v: string | null, id: string | null) => v ?? id ?? t.nochNicht;
  const daten: Record<string, TypstWert> = {
    sprache: d.sprache,
    entwurf: false,
    titel: t.titel,
    titelText: t.titel,
    kopf: `${t.kopf} · ${l.dateiname}`,
    stichtag: l.uebernommenAm ? zeitpunkt(l.uebernommenAm) : zeitpunkt(l.hochgeladenAm),
    wissensstand: l.sha256.slice(0, 12),
    t: { ...t, wasserzeichen: "", freigegeben: t.kopf, stichtag: t.erstellt, wissensstand: "SHA-256", stati: {} } as unknown as TypstWert,
    datei: `${l.dateiname} · ${l.dateityp.toUpperCase()} · ${l.groesse} Bytes · ${t.stati[l.status] ?? l.status}`,
    sha256: l.sha256,
    hochgeladenVon: name(l.hochgeladenVonName, l.hochgeladenVon),
    hochgeladenAm: zeitpunkt(l.hochgeladenAm),
    geprueftVon: l.geprueftAm ? name(l.geprueftVonName, l.geprueftVon) : t.nochNicht,
    geprueftAm: zeitpunkt(l.geprueftAm),
    uebernommenVon: l.uebernommenAm ? name(l.uebernommenVonName, l.uebernommenVon) : t.nochNicht,
    uebernommenAm: zeitpunkt(l.uebernommenAm),
    vierAugen: l.uebernommenAm ? t.vierAugen : "",
    mengenKopf: [t.objekt, t.zeilen, t.angelegt, t.vorhanden, t.abweichend],
    mengen: mengenZeilen(d).map((z) => [z.name, String(z.z.zeilen), String(z.z.neu), String(z.z.unveraendert), String(z.z.abweichend)]),
    summenKopf: [t.fonds, t.groesse, t.quelle, t.ist, t.differenz, t.ergebnis],
    summen: (l.ergebnis?.fonds ?? []).flatMap((f) => {
      const bezeichnung = (g: string) => (t as unknown as Record<string, string>)[g] ?? g;
      const kontrollierte = new Set(f.kontrollsummen.map((k) => k.groesse));
      const aus: string[][] = f.kontrollsummen.map((k) => [f.kurzname, bezeichnung(k.groesse), zahl(k.quelle), zahl(k.ist), zahl(k.differenz), k.status === "ok" ? t.ok : k.status === "abweichung" ? t.abweichung : t.nichtBerechnet]);
      const ohne: [string, string | null][] = [
        ["zusagen", f.zusagen],
        ["auszahlungen", f.auszahlungen],
        ["rueckfluesse", f.rueckfluesse],
        ["nav", f.nav],
      ];
      for (const [g, wert] of ohne) if (!kontrollierte.has(g)) aus.push([f.kurzname, bezeichnung(g), "–", zahl(wert), "–", t.keineKontrolle]);
      return aus;
    }),
    befundKopf: [t.blatt, t.zeile, t.spalte, t.code, t.meldung],
    befunde: sicht.map((x) => [(x.blattName ?? x.blatt) ?? "", x.zeile === null ? "" : String(x.zeile), x.spalte ?? "", `${x.schweregrad === "fehler" ? "!" : "·"} ${x.code}`, x.meldung]),
    befundZahl: `${t.fehler}: ${l.fehlerAnzahl ?? 0} · ${t.warnungen}: ${l.warnungAnzahl ?? 0}`,
    gekuerzt: d.befunde.length > MAX_BEFUNDE_PDF || l.befundeGekuerzt ? t.gekuerzt : "",
  };
  return Buffer.from(setzePdf(`#let data = ${literal(daten)}\n${MIT_GRUNDLAGE(PDF_VORLAGE)}`));
}
