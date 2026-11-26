import ExcelJS from "exceljs";
import { formatBetrag, formatDatum, formatZahl, formatZeitpunkt } from "../format";
import { TEXTE } from "../texte";
import type { Sprache } from "../typen";
import { literal, setzePdf, type TypstWert } from "../typst";
import { MIT_GRUNDLAGE } from "../vorlagen";
import type { AbschnittErgebnis, FeldAnzeige, Herkunft } from "./auswerten";
import type { Abschnitt, DefinitionInhalt, Feld, Feldformat } from "./definition";
import type { Befund } from "./regeln";

/**
 * Dateien eines Meldelaufs aus den gespeicherten Werten: Excel (Layout der Definition, Zahlen als Zahlen, Rohdatenblatt, Befunde), CSV (lange
 * Form, maschinenlesbar) und PDF über Typst (Prüfansicht). Ein fehlender Wert steht als „k. A.“ (Englisch „n/a“), nie als 0.
 */

export interface MeldeAusgabe {
  sprache: Sprache;
  /** Bezeichnung der Definition in der Sprache der Ausgabe. */
  bezeichnung: string;
  /** `schluessel Version n`. */
  kennung: string;
  fonds: { name: string; kurzname: string; waehrung: string };
  programm: string | null;
  periode: { beginn: string; ende: string; kennung: string };
  /** Wissensstand der Rechnung (ISO). */
  stand: string;
  entwurf: boolean;
  definition: DefinitionInhalt;
  anzeige: AbschnittErgebnis[];
  werte: { schluessel: string; art: string; wert: string | null; herkunft: Herkunft | null; manuell: boolean }[];
  befunde: Befund[];
  /** Kommentare zu Befunden je Regel. */
  kommentare: Record<string, { text: string }>;
}

const TEXT = {
  de: {
    keineAngabe: "k. A.",
    ohneZuordnung: "Ohne Zuordnung",
    meldung: "Meldung",
    roh: "Rohdaten",
    befunde: "Befunde",
    zeitraum: "Zeitraum",
    bis: "bis",
    stand: "Wissensstand",
    status: "Status",
    fonds: "Fonds",
    programm: "Förderprogramm",
    summe: "Summe",
    bezeichnung: "Bezeichnung",
    wert: "Wert",
    einheit: "Einheit",
    hinweis: "Hinweis",
    schluessel: "Schlüssel",
    abschnitt: "Abschnitt",
    zeile: "Zeile",
    feld: "Feld oder Spalte",
    format: "Format",
    quelle: "Quelle",
    herkunft: "Herkunft",
    schwere: "Schwere",
    meldungSpalte: "Meldung",
    kommentar: "Kommentar",
    fehler: "Fehler",
    warnung: "Warnung",
    entwurf: "Entwurf, noch nicht freigegeben",
    freigegeben: "Freigegeben",
    beteiligungen: "Beteiligungen",
    vorgaenge: "Vorgänge",
    kennzahlWerte: "Kennzahlenwerte",
    bewegungen: "Fondsbewegungen",
    filter: "Filter",
    quellen: { kennzahl: "Kennzahl", vorgang: "Vorgänge", fondsbewegung: "Fondsbewegung", bestand: "Bestand", beteiligungsanzahl: "Anzahl Beteiligungen", stammdaten: "Stammdaten", schluessel: "Schlüssel", manuell: "Eingabe von Hand", berechnet: "Berechnet", zeile: "Zeile" } as Record<string, string>,
    ja: "Ja",
    nein: "Nein",
    mittelarten: { foerdermittel: "Fördermittel", kofinanzierung: "Kofinanzierung", eigenmittel: "Eigenmittel", rueckflussmittel: "Rückflussmittel" } as Record<string, string>,
    ohnePrufung: "Keine Befunde",
  },
  en: {
    keineAngabe: "n/a",
    ohneZuordnung: "Unassigned",
    meldung: "Report",
    roh: "Raw data",
    befunde: "Findings",
    zeitraum: "Period",
    bis: "to",
    stand: "Knowledge date",
    status: "Status",
    fonds: "Fund",
    programm: "Funding programme",
    summe: "Total",
    bezeichnung: "Description",
    wert: "Value",
    einheit: "Unit",
    hinweis: "Note",
    schluessel: "Key",
    abschnitt: "Section",
    zeile: "Row",
    feld: "Field or column",
    format: "Format",
    quelle: "Source",
    herkunft: "Provenance",
    schwere: "Severity",
    meldungSpalte: "Message",
    kommentar: "Comment",
    fehler: "Error",
    warnung: "Warning",
    entwurf: "Draft, not yet approved",
    freigegeben: "Approved",
    beteiligungen: "Holdings",
    vorgaenge: "Transactions",
    kennzahlWerte: "KPI values",
    bewegungen: "Fund movements",
    filter: "Filter",
    quellen: { kennzahl: "KPI", vorgang: "Transactions", fondsbewegung: "Fund movement", bestand: "Position", beteiligungsanzahl: "Number of holdings", stammdaten: "Master data", schluessel: "Key", manuell: "Manual entry", berechnet: "Calculated", zeile: "Row" } as Record<string, string>,
    ja: "Yes",
    nein: "No",
    mittelarten: { foerdermittel: "Grant funds", kofinanzierung: "Co-financing", eigenmittel: "Own funds", rueckflussmittel: "Returned funds" } as Record<string, string>,
    ohnePrufung: "No findings",
  },
} as const;

/** Bezeichnung eines Feldes in der Sprache der Ausgabe. */
const name = (f: { bezeichnung: { de: string; en: string } }, s: Sprache) => f.bezeichnung[s];

/** Art der Aufzählung, aus der ein Textwert stammt (für die Übersetzung), sonst `null`. */
function aufzaehlungVon(f: Feld, je: string | null): "instrument" | "status" | "mittelart" | null {
  if (f.quelle.art !== "stammdaten") return null;
  switch (f.quelle.feld) {
    case "beteiligung.instrument": return "instrument";
    case "beteiligung.status": return "status";
    case "foerderung.mittelart": return "mittelart";
    case "gruppe.schluessel":
    case "gruppe.bezeichnung":
      return je === "instrument" ? "instrument" : je === "mittelart" ? "mittelart" : null;
    default: return null;
  }
}

function anzeigeText(wert: string | null, f: Feld, s: Sprache, kontext: { waehrung: string; je: string | null; ohne: boolean }): string {
  const t = TEXT[s];
  if (wert === null) return kontext.ohne && f.quelle.art === "stammdaten" && f.quelle.feld.startsWith("gruppe.") ? t.ohneZuordnung : t.keineAngabe;
  switch (f.format) {
    case "betrag": return formatBetrag(wert, s, /^[A-Z]{3}$/.test(f.einheit ?? "") ? f.einheit! : kontext.waehrung);
    case "zahl": return formatZahl(wert, s);
    case "ganzzahl": return new Intl.NumberFormat(s === "de" ? "de-DE" : "en-GB", { maximumFractionDigits: 0 }).format(Number(wert));
    case "prozent": return s === "de" ? `${formatZahl(wert, s)} %` : `${formatZahl(wert, s)}%`;
    case "datum": return formatDatum(wert, s);
    case "ja_nein": return wert === "ja" ? t.ja : wert === "nein" ? t.nein : wert;
    case "text": {
      const art = aufzaehlungVon(f, kontext.je);
      if (art === "instrument") return (TEXTE[s].instrumente as Record<string, string>)[wert] ?? wert;
      if (art === "status") return (TEXTE[s].stati as Record<string, string>)[wert] ?? wert;
      if (art === "mittelart") return wert.split(", ").map((w) => t.mittelarten[w] ?? w).join(", ");
      return wert;
    }
  }
}

interface Spalte {
  feld: Feld;
}

interface Layout {
  abschnitt: Abschnitt;
  ergebnis: AbschnittErgebnis;
}

function layouts(e: MeldeAusgabe): Layout[] {
  return e.definition.abschnitte.map((abschnitt) => ({ abschnitt, ergebnis: e.anzeige.find((a) => a.id === abschnitt.id)! }));
}

const waehrungExcel = (w: string) => (w === "EUR" ? "€" : w);

function excelFormat(f: Feld, waehrung: string): string | null {
  switch (f.format) {
    case "betrag": return `#,##0.00 "${waehrungExcel(/^[A-Z]{3}$/.test(f.einheit ?? "") ? f.einheit! : waehrung)}"`;
    case "ganzzahl": return "#,##0";
    case "zahl": return "#,##0.####";
    case "prozent": return '0.0" %"';
    case "datum": return "dd.mm.yyyy";
    default: return null;
  }
}

/** Zelle für Excel: Zahl als Zahl, Datum als Datum, sonst Text; ein leerer Wert ist „k. A.“. */
function excelZelle(wert: string | null, f: Feld, s: Sprache, kontext: { waehrung: string; je: string | null; ohne: boolean }): ExcelJS.CellValue {
  if (wert === null) return anzeigeText(null, f, s, kontext);
  switch (f.format) {
    case "betrag":
    case "zahl":
    case "ganzzahl":
    case "prozent":
      return Number(wert);
    case "datum":
      return new Date(`${wert}T12:00:00Z`);
    default:
      return anzeigeText(wert, f, s, kontext);
  }
}

/** Entschärft Text, den Tabellenprogramme als Formel lesen würden (beginnt mit `=`, `+`, `-` oder `@`). */
export const entschaerfe = (text: string): string => (/^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text) ? `'${text}` : text);

function kopfBlock(blatt: ExcelJS.Worksheet, e: MeldeAusgabe) {
  const t = TEXT[e.sprache];
  const titel = blatt.addRow([e.bezeichnung]);
  titel.font = { bold: true, size: 14 };
  blatt.addRow([e.kennung]);
  blatt.addRow([t.fonds, e.fonds.name]);
  if (e.programm) blatt.addRow([t.programm, e.programm]);
  blatt.addRow([t.zeitraum, `${formatDatum(e.periode.beginn, e.sprache)} ${t.bis} ${formatDatum(e.periode.ende, e.sprache)} (${e.periode.kennung})`]);
  blatt.addRow([t.stand, formatZeitpunkt(e.stand, e.sprache)]);
  blatt.addRow([t.status, e.entwurf ? t.entwurf : t.freigegeben]);
  if (e.definition.hinweis) {
    const r = blatt.addRow([name({ bezeichnung: e.definition.hinweis }, e.sprache)]);
    r.alignment = { wrapText: true, vertical: "top" };
    blatt.mergeCells(r.number, 1, r.number, 4);
    r.height = 48;
  }
}

/** Excel-Arbeitsmappe: Blatt „Meldung“ im Layout der Definition, „Rohdaten“ mit Herkunft je Wert, „Befunde“ (nur wenn es welche gibt). */
export async function erzeugeMeldeXlsx(e: MeldeAusgabe): Promise<Uint8Array> {
  const s = e.sprache;
  const t = TEXT[s];
  const wb = new ExcelJS.Workbook();
  wb.creator = "Carraway";
  wb.created = new Date();
  const blatt = wb.addWorksheet(t.meldung);
  blatt.getColumn(1).width = 52;
  for (let i = 2; i <= 14; i++) blatt.getColumn(i).width = 20;
  kopfBlock(blatt, e);

  for (const { abschnitt, ergebnis } of layouts(e)) {
    blatt.addRow([]);
    const titel = blatt.addRow([name({ bezeichnung: abschnitt.titel }, s)]);
    titel.font = { bold: true, size: 12 };
    if (abschnitt.typ === "felder" && ergebnis.typ === "felder") {
      const kopf = blatt.addRow([t.bezeichnung, t.wert, t.einheit, t.hinweis]);
      kopf.font = { bold: true };
      for (const f of abschnitt.felder) {
        const anzeige = ergebnis.felder.find((x) => x.id === f.id)!;
        const zeile = blatt.addRow([name(f, s), excelZelle(anzeige.wert, f, s, { waehrung: e.fonds.waehrung, je: null, ohne: false }), f.einheit ?? "", f.hinweis ? name({ bezeichnung: f.hinweis }, s) : ""]);
        const fmt = excelFormat(f, e.fonds.waehrung);
        if (fmt && anzeige.wert !== null) zeile.getCell(2).numFmt = fmt;
        zeile.getCell(2).alignment = { horizontal: "right" };
      }
    } else if (abschnitt.typ === "tabelle" && ergebnis.typ === "tabelle") {
      const kopf = blatt.addRow(abschnitt.spalten.map((sp) => name(sp, s)));
      kopf.font = { bold: true };
      for (const z of ergebnis.zeilen) {
        const zeile = blatt.addRow(abschnitt.spalten.map((sp) => excelZelle(z.zellen[sp.id]!.wert, sp, s, { waehrung: e.fonds.waehrung, je: abschnitt.je, ohne: z.gruppeOhne })));
        abschnitt.spalten.forEach((sp, i) => {
          const fmt = excelFormat(sp, e.fonds.waehrung);
          if (fmt && z.zellen[sp.id]!.wert !== null) zeile.getCell(i + 1).numFmt = fmt;
        });
      }
      if (ergebnis.summen) {
        const zeile = blatt.addRow(abschnitt.spalten.map((sp, i) => (sp.summe ? excelZelle(ergebnis.summen![sp.id]!.wert, sp, s, { waehrung: e.fonds.waehrung, je: null, ohne: false }) : i === 0 ? t.summe : "")));
        zeile.font = { bold: true };
        abschnitt.spalten.forEach((sp, i) => {
          const fmt = excelFormat(sp, e.fonds.waehrung);
          if (sp.summe && fmt && ergebnis.summen![sp.id]!.wert !== null) zeile.getCell(i + 1).numFmt = fmt;
        });
      }
    }
  }

  // Rohdaten: ein Wert je Zeile mit Schlüssel, Quelle und Herkunft (Zahlen als Zahlen, fehlende Werte als „k. A.“)
  const roh = wb.addWorksheet(t.roh);
  roh.columns = [
    { header: t.schluessel, key: "schluessel", width: 46 },
    { header: t.abschnitt, key: "abschnitt", width: 22 },
    { header: t.zeile, key: "zeile", width: 30 },
    { header: t.feld, key: "feld", width: 28 },
    { header: t.bezeichnung, key: "bezeichnung", width: 44 },
    { header: t.wert, key: "wert", width: 20 },
    { header: t.einheit, key: "einheit", width: 10 },
    { header: t.quelle, key: "quelle", width: 22 },
    { header: t.herkunft, key: "herkunft", width: 60 },
  ];
  const felder = new Map<string, Feld>();
  for (const a of e.definition.abschnitte) for (const f of a.typ === "felder" ? a.felder : a.spalten) felder.set(`${a.id}|${f.id}`, f);
  const zeilenNamen = new Map<string, string>();
  for (const w of e.werte) if (w.art === "zeile") zeilenNamen.set(w.schluessel, w.wert ?? "");
  for (const w of e.werte) {
    if (w.art === "zeile") continue;
    const teile = w.schluessel.split(".");
    const abschnittId = teile[0]!;
    const feldId = teile[teile.length - 1]!;
    const zeileKey = teile.length === 3 ? teile[1]! : "";
    const f = felder.get(`${abschnittId}|${feldId}`);
    if (!f) continue;
    const abschnitt = e.definition.abschnitte.find((a) => a.id === abschnittId);
    const je = abschnitt?.typ === "tabelle" ? abschnitt.je : null;
    const zeilenName = zeileKey === "_summe" ? t.summe : zeileKey ? (zeilenNamen.get(`${abschnittId}.${zeileKey}._zeile`) ?? (zeileKey === "_ohne" ? t.ohneZuordnung : zeileKey)) : "";
    const h = w.herkunft;
    const herkunft = h
      ? [`${t.beteiligungen}: ${h.beteiligungen.length}`, h.vorgaenge.length ? `${t.vorgaenge}: ${h.vorgaenge.length}` : null, h.kennzahlWerte.length ? `${t.kennzahlWerte}: ${h.kennzahlWerte.length}` : null, h.bewegungen.length ? `${t.bewegungen}: ${h.bewegungen.length}` : null, h.filter.length ? `${t.filter}: ${h.filter.map((x) => JSON.stringify(x)).join(" + ")}` : null].filter(Boolean).join("; ")
      : "";
    const zeile = roh.addRow({
      schluessel: w.schluessel,
      abschnitt: abschnittId,
      zeile: zeilenName,
      feld: feldId,
      bezeichnung: name(f, s),
      wert: excelZelle(w.wert, f, s, { waehrung: e.fonds.waehrung, je, ohne: zeileKey === "_ohne" }),
      einheit: f.einheit ?? "",
      quelle: t.quellen[w.art] ?? w.art,
      herkunft,
    });
    const fmt = excelFormat(f, e.fonds.waehrung);
    if (fmt && w.wert !== null) zeile.getCell("wert").numFmt = fmt;
  }
  roh.getRow(1).font = { bold: true };
  roh.views = [{ state: "frozen", ySplit: 1 }];

  if (e.befunde.length) {
    const b = wb.addWorksheet(t.befunde);
    b.columns = [
      { header: t.schwere, key: "schwere", width: 12 },
      { header: "ID", key: "id", width: 30 },
      { header: t.meldungSpalte, key: "meldung", width: 80 },
      { header: t.kommentar, key: "kommentar", width: 60 },
    ];
    for (const x of e.befunde) b.addRow({ schwere: x.schwere === "fehler" ? t.fehler : t.warnung, id: x.regelId, meldung: x.meldung[s], kommentar: e.kommentare[x.regelId]?.text ?? "" });
    b.getRow(1).font = { bold: true };
    b.views = [{ state: "frozen", ySplit: 1 }];
  }
  // Jeder Text in der Mappe wird entschärft (Beschriftungen aus Definitionen, Eingaben, Namen), Formeln gibt es nie.
  for (const blattX of wb.worksheets) {
    blattX.eachRow((zeile) => {
      zeile.eachCell((zelle) => {
        if (typeof zelle.value === "string") zelle.value = entschaerfe(zelle.value);
      });
    });
  }
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

const csvFeld = (text: string) => (/[;"\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text);

/**
 * CSV in langer Form, eine Zeile je Wert: `abschnitt;zeile;feld;bezeichnung;wert;einheit;format`. Trennzeichen Semikolon, UTF-8 mit BOM,
 * Zahlen mit Punkt und Daten als `JJJJ-MM-TT` (maschinenlesbar), fehlende Werte als „k. A.“. Text, den Tabellenprogramme als Formel lesen würden, wird entschärft.
 */
export function erzeugeMeldeCsv(e: MeldeAusgabe): Uint8Array {
  const s = e.sprache;
  const t = TEXT[s];
  const zeilen: string[][] = [["abschnitt", "zeile", "feld", "bezeichnung", "wert", "einheit", "format"]];
  const wert = (w: string | null, f: Feld, je: string | null, ohne: boolean): string => {
    if (w === null) return anzeigeText(null, f, s, { waehrung: e.fonds.waehrung, je, ohne });
    if (f.format === "text") return anzeigeText(w, f, s, { waehrung: e.fonds.waehrung, je, ohne });
    if (f.format === "ja_nein") return anzeigeText(w, f, s, { waehrung: e.fonds.waehrung, je, ohne });
    return w;
  };
  for (const { abschnitt, ergebnis } of layouts(e)) {
    if (abschnitt.typ === "felder" && ergebnis.typ === "felder") {
      for (const f of abschnitt.felder) zeilen.push([abschnitt.id, "", f.id, name(f, s), wert(ergebnis.felder.find((x) => x.id === f.id)!.wert, f, null, false), f.einheit ?? "", f.format]);
    } else if (abschnitt.typ === "tabelle" && ergebnis.typ === "tabelle") {
      for (const z of ergebnis.zeilen) {
        const zeilenName = z.gruppeOhne ? t.ohneZuordnung : (z.bezeichnung ?? z.schluessel);
        for (const sp of abschnitt.spalten) zeilen.push([abschnitt.id, zeilenName, sp.id, name(sp, s), wert(z.zellen[sp.id]!.wert, sp, abschnitt.je, z.gruppeOhne), sp.einheit ?? "", sp.format]);
      }
      if (ergebnis.summen) for (const sp of abschnitt.spalten) if (sp.summe) zeilen.push([abschnitt.id, t.summe, sp.id, name(sp, s), wert(ergebnis.summen[sp.id]!.wert, sp, null, false), sp.einheit ?? "", sp.format]);
    }
  }
  const text = zeilen.map((z) => z.map((x) => csvFeld(entschaerfe(x))).join(";")).join("\r\n") + "\r\n";
  return new Uint8Array(Buffer.from(`\uFEFF${text}`, "utf8"));
}

// PDF -------------------------------------------------------------------------------------------------------------

const MELDUNG = String.raw`
#v(1 * u)
#beschriftung(data.kopfZeile)
#v(0.5 * u)
#text(font: anzeige, weight: 700, size: 20pt, tracking: -0.02em)[#data.titel]
#v(0.5 * u)
#text(size: 10pt, fill: grau)[#data.untertitel]
#v(1 * u)
#grid(columns: (1fr, 1fr), column-gutter: u, row-gutter: u,
  kachel(data.m.fonds, data.fonds),
  kachel(data.m.zeitraum, data.zeitraum),
)
#if data.hinweis != none {
  v(1 * u)
  block(fill: kalk, radius: 4pt, inset: 1.5 * u, width: 100%)[#text(size: 8pt)[#data.hinweis]]
}
#for a in data.abschnitte [
  #abschnitt(a.titel)
  #tabelle2(a.kopf, a.zeilen, a.ausrichtung, a.breiten, summe: a.summe)
]
#if data.befunde.len() > 0 [
  #abschnitt(data.m.befunde)
  #tabelle2((data.m.schwere, data.m.meldungSpalte, data.m.kommentar), data.befunde, ("left", "left", "left"), (1, 4, 3))
]
`;

/** Typst-Quelltext der Prüfansicht (getrennt vom Setzen, damit Tests ihn ohne Compiler prüfen können). */
export function meldeQuelle(e: MeldeAusgabe): string {
  const s = e.sprache;
  const t = TEXT[s];
  const texte = TEXTE[s];
  const abschnitte: TypstWert[] = layouts(e).map(({ abschnitt, ergebnis }) => {
    if (abschnitt.typ === "felder" && ergebnis.typ === "felder") {
      return {
        titel: name({ bezeichnung: abschnitt.titel }, s),
        kopf: [t.bezeichnung, t.wert],
        zeilen: abschnitt.felder.map((f) => [name(f, s), `${anzeigeText(ergebnis.felder.find((x) => x.id === f.id)!.wert, f, s, { waehrung: e.fonds.waehrung, je: null, ohne: false })}${f.einheit && f.format !== "betrag" && f.einheit !== "Anzahl" ? ` ${f.einheit}` : ""}`]),
        ausrichtung: ["left", "right"],
        breiten: [2, 1],
        summe: false,
      };
    }
    const tabelle = abschnitt as Extract<Abschnitt, { typ: "tabelle" }>;
    const er = ergebnis as Extract<AbschnittErgebnis, { typ: "tabelle" }>;
    const zeilen = er.zeilen.map((z) => tabelle.spalten.map((sp) => anzeigeText(z.zellen[sp.id]!.wert, sp, s, { waehrung: e.fonds.waehrung, je: tabelle.je, ohne: z.gruppeOhne })));
    if (er.summen) zeilen.push(tabelle.spalten.map((sp, i) => (sp.summe ? anzeigeText(er.summen![sp.id]!.wert, sp, s, { waehrung: e.fonds.waehrung, je: null, ohne: false }) : i === 0 ? t.summe : "")));
    return {
      titel: name({ bezeichnung: tabelle.titel }, s),
      kopf: tabelle.spalten.map((sp) => name(sp, s)),
      zeilen,
      ausrichtung: tabelle.spalten.map((sp: Spalte["feld"]) => (["betrag", "zahl", "ganzzahl", "prozent"] as Feldformat[]).includes(sp.format) ? "right" : "left"),
      breiten: tabelle.spalten.map((sp) => (sp.format === "text" ? 2 : 1)),
      summe: er.summen !== null,
    };
  });
  const befunde: TypstWert[] = e.befunde.map((b) => [b.schwere === "fehler" ? t.fehler : t.warnung, b.meldung[s], e.kommentare[b.regelId]?.text ?? ""]);
  const daten: Record<string, TypstWert> = {
    sprache: s,
    t: texte as unknown as TypstWert,
    entwurf: e.entwurf,
    titel: e.bezeichnung,
    kopf: `${t.meldung} · ${e.fonds.kurzname}`,
    kopfZeile: `${t.meldung} · ${e.kennung}`,
    untertitel: `${e.fonds.name}${e.programm ? ` · ${e.programm}` : ""} · ${e.periode.kennung}`,
    stichtag: formatDatum(e.periode.ende, s),
    wissensstand: formatZeitpunkt(e.stand, s),
    fonds: e.fonds.name,
    zeitraum: e.periode.beginn === e.periode.ende ? formatDatum(e.periode.ende, s) : `${formatDatum(e.periode.beginn, s)} ${t.bis} ${formatDatum(e.periode.ende, s)}`,
    hinweis: e.definition.hinweis ? name({ bezeichnung: e.definition.hinweis }, s) : null,
    m: { fonds: texte.fonds, zeitraum: t.zeitraum, befunde: t.befunde, schwere: t.schwere, meldungSpalte: t.meldungSpalte, kommentar: t.kommentar },
    abschnitte,
    befunde,
  };
  return `#let data = ${literal(daten)}\n${MIT_GRUNDLAGE(MELDUNG)}`;
}

/** PDF-Prüfansicht über Typst; im Entwurf mit Wasserzeichen. */
export function erzeugeMeldePdf(e: MeldeAusgabe): Uint8Array {
  return setzePdf(meldeQuelle(e));
}

export type { FeldAnzeige };
