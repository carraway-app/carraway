import ExcelJS from "exceljs";
import { formatBetrag, formatDatum, formatProzent, formatZeitpunkt } from "./format";
import { markdownZuText } from "./markdown-text";
import type { Sprache } from "./typen";
import { literal, setzePdf, type TypstWert } from "./typst";
import { MIT_GRUNDLAGE } from "./vorlagen";

/**
 * Belege und Auswertungen der Buchhaltung (Etappe 14): PDF mit Typst, Excel mit exceljs. Alle Beträge kommen als Zeichenketten
 * (Entscheidung 7). Bezeichnungen der Felder und Positionen liefert die Vorlage des Fonds je Sprache; hier stehen nur die festen Texte.
 */

const TEXTE = {
  de: {
    wasserzeichen: "ENTWURF",
    freigegeben: "Freigegeben",
    stichtag: "Datum",
    wissensstand: "Erzeugt",
    seite: "Seite",
    von: "von",
    beleg: "Beleg",
    belegnummer: "Belegnummer",
    ohneNummer: "ohne Nummer (Entwurf)",
    datum: "Datum",
    betrag: "Betrag",
    angaben: "Angaben",
    feld: "Feld",
    wert: "Wert",
    fehlt: "fehlt",
    mittelherkunft: "Mittelherkunft",
    mittelart: "Mittelart",
    quote: "Quote",
    freigaben: "Prüfung und Freigabe",
    stufe: "Stufe",
    person: "Person",
    zeitpunkt: "Zeitpunkt",
    keine: "keine",
    arten: { vertragsanlage: "Vertragsanlage", auszahlung: "Auszahlung", zinsbuchung: "Zinsbuchung", verkauf: "Verkauf", wandlung: "Wandlung", kapitalabruf: "Kapitalabruf", ausschuettung: "Ausschüttung" } as Record<string, string>,
    auswertung: "Auswertung",
    zeitraum: "Zeitraum",
    position: "Position",
    quelle: "Quelle",
    herkunft: "Herkunft der Zeilen",
    konto: "Konto",
    bezeichnung: "Bezeichnung",
    saldo: "Saldo",
    beitrag: "Beitrag",
    regel: "Regel",
    nichtZugeordnet: "Nicht zugeordnete Konten",
    sichten: { bilanz: "Bilanz", guv: "Gewinn- und Verlustrechnung", liquiditaet: "Liquidität", mittelverwendung: "Mittelverwendung", portfolio: "Portfolio" } as Record<string, string>,
    abstimmung: "Abstimmung",
    carraway: "Carraway",
    buchhaltung: "Buchhaltung",
    differenz: "Differenz",
    hinweisSaldo: "Saldo: Soll positiv, Haben negativ.",
  },
  en: {
    wasserzeichen: "DRAFT",
    freigegeben: "Approved",
    stichtag: "Date",
    wissensstand: "Generated",
    seite: "Page",
    von: "of",
    beleg: "Voucher",
    belegnummer: "Voucher number",
    ohneNummer: "no number (draft)",
    datum: "Date",
    betrag: "Amount",
    angaben: "Details",
    feld: "Field",
    wert: "Value",
    fehlt: "missing",
    mittelherkunft: "Source of funds",
    mittelart: "Type of funds",
    quote: "Share",
    freigaben: "Review and approval",
    stufe: "Stage",
    person: "Person",
    zeitpunkt: "Time",
    keine: "none",
    arten: { vertragsanlage: "Contract annex", auszahlung: "Disbursement", zinsbuchung: "Interest posting", verkauf: "Sale", wandlung: "Conversion", kapitalabruf: "Capital call", ausschuettung: "Distribution" } as Record<string, string>,
    auswertung: "Report",
    zeitraum: "Period",
    position: "Item",
    quelle: "Source",
    herkunft: "Origin of the lines",
    konto: "Account",
    bezeichnung: "Description",
    saldo: "Balance",
    beitrag: "Contribution",
    regel: "Rule",
    nichtZugeordnet: "Unassigned accounts",
    sichten: { bilanz: "Balance sheet", guv: "Profit and loss", liquiditaet: "Liquidity", mittelverwendung: "Use of funds", portfolio: "Portfolio" } as Record<string, string>,
    abstimmung: "Reconciliation",
    carraway: "Carraway",
    buchhaltung: "Accounting",
    differenz: "Difference",
    hinweisSaldo: "Balance: debit positive, credit negative.",
  },
} as const;

export const BUCHHALTUNG_TEXTE = TEXTE;

// Beleg ----------------------------------------------------------------------------------------------------------------

export interface BelegPdfDaten {
  fonds: { name: string; kurzname: string };
  art: string;
  /** Name einer eigenen Belegart in der Sprache des Belegs; ersetzt die Bezeichnung der Art im Titel. */
  artName?: string;
  sprache: Sprache;
  belegnummer: string | null;
  /** Belegdatum (Valuta oder Stichtag). */
  datum: string;
  betrag: string | null;
  waehrung: string;
  kopftext: string;
  fusstext: string;
  /** Felder mit fertiger Bezeichnung in der Belegsprache; `wert` leer = fehlt. */
  felder: { bezeichnung: string; wert: string | null; abschnitt: string }[];
  mittelherkunft: { bezeichnung: string; quote: string; betrag: string }[];
  stufen: { stufe: string; person: string; am: string }[];
  erzeugtAm: string;
}

const BELEG = String.raw`
#beschriftung(data.t.beleg)
#v(0.5 * u)
#text(font: anzeige, weight: 700, size: 24pt, tracking: -0.01em)[#upper(data.titelText)]
#linebreak()
#text(size: 10pt, fill: grau)[#data.untertitel]
#v(1.5 * u)
#grid(columns: (1fr, 1fr, 1fr), column-gutter: u,
  kachel(data.t.belegnummer, data.belegnummer),
  kachel(data.t.datum, data.datum),
  kachel(data.t.betrag, data.betrag, dunkel: true),
)
#if data.kopftext != "" [
  #v(1 * u)
  #data.kopftext.split("\n").join(linebreak())
]
#abschnitt(data.t.angaben)
#tabelle2(data.felderKopf, data.felder, ("left", "left"), (1, 2))
#if data.mittelherkunft.len() > 0 [
  #abschnitt(data.t.mittelherkunft)
  #tabelle2(data.mittelKopf, data.mittelherkunft, ("left", "right", "right"), (2, 1, 1), summe: true)
]
#if data.fusstext != "" [
  #v(1 * u)
  #text(size: 8pt, fill: grau)[#data.fusstext.split("\n").join(linebreak())]
]
#abschnitt(data.t.freigaben)
#if data.stufen.len() == 0 [#text(fill: grau)[#data.t.keine]] else [
  #tabelle2(data.stufenKopf, data.stufen, ("left", "left", "left"), (1, 1, 1))
]
`;

export function belegQuelle(d: BelegPdfDaten, optionen: { entwurf: boolean }): string {
  const t = TEXTE[d.sprache];
  const betrag = (w: string | null) => formatBetrag(w, d.sprache, d.waehrung);
  const art = d.artName ?? t.arten[d.art] ?? d.art;
  const daten: Record<string, TypstWert> = {
    sprache: d.sprache,
    entwurf: optionen.entwurf,
    t: t as unknown as TypstWert,
    titel: `${art} ${d.belegnummer ?? ""}`.trim(),
    titelText: art,
    kopf: `${t.beleg} · ${d.fonds.kurzname}`,
    untertitel: `${d.fonds.name}`,
    stichtag: formatDatum(d.datum, d.sprache),
    wissensstand: formatZeitpunkt(d.erzeugtAm, d.sprache),
    belegnummer: d.belegnummer ?? t.ohneNummer,
    datum: formatDatum(d.datum, d.sprache),
    betrag: d.betrag === null ? "–" : betrag(d.betrag),
    kopftext: markdownZuText(d.kopftext),
    fusstext: markdownZuText(d.fusstext),
    felderKopf: [t.feld, t.wert],
    felder: d.felder.map((f) => [f.bezeichnung, f.wert === null || f.wert === "" ? `(${t.fehlt})` : f.wert]),
    mittelKopf: [t.mittelart, t.quote, t.betrag],
    mittelherkunft: d.mittelherkunft.length
      ? [
          ...d.mittelherkunft.map((m) => [m.bezeichnung, formatProzent(m.quote, d.sprache), betrag(m.betrag)]),
          ["", "", betrag((d.mittelherkunft.reduce((s, m) => s + Math.round(Number(m.betrag) * 100), 0) / 100).toFixed(2))],
        ]
      : [],
    stufenKopf: [t.stufe, t.person, t.zeitpunkt],
    stufen: d.stufen.map((s) => [s.stufe, s.person, formatZeitpunkt(s.am, d.sprache)]),
  };
  return `#let data = ${literal(daten)}\n${MIT_GRUNDLAGE(BELEG)}`;
}

/** PDF eines Belegs; `entwurf` setzt das Wasserzeichen. */
export function erzeugeBelegPdf(d: BelegPdfDaten, optionen: { entwurf: boolean }): Uint8Array {
  return setzePdf(belegQuelle(d, optionen));
}

// Auswertung -----------------------------------------------------------------------------------------------------------

export interface AuswertungExportDaten {
  fonds: { name: string; kurzname: string };
  sicht: string;
  sprache: Sprache;
  zeitraumVon: string;
  zeitraumBis: string;
  waehrung: string;
  erzeugtAm: string;
  zeilen: {
    ebene: number;
    bezeichnungDe: string;
    bezeichnungEn: string;
    wert: string;
    blatt: boolean;
    konten: { konto: string; bezeichnung: string | null; saldo: string; beitrag: string; regelId: string }[];
  }[];
  nichtZugeordnet: { konto: string; bezeichnung: string | null; saldo: string }[];
  abstimmung?: { bezeichnung: string; carraway: string; buchhaltung: string; differenz: string }[];
}

const nbsp = " ";

const AUSWERTUNG = String.raw`
#beschriftung(data.t.auswertung)
#v(0.5 * u)
#text(font: anzeige, weight: 700, size: 24pt, tracking: -0.01em)[#upper(data.titelText)]
#linebreak()
#text(size: 10pt, fill: grau)[#data.untertitel]
#v(1.5 * u)
#tabelle2(data.kopfZeile, data.zeilen, ("left", "right"), (3, 1))
#if data.abstimmung.len() > 0 [
  #abschnitt(data.t.abstimmung)
  #tabelle2(data.abstimmungKopf, data.abstimmung, ("left", "right", "right", "right"), (3, 1, 1, 1))
]
#if data.nichtZugeordnet.len() > 0 [
  #abschnitt(data.t.nichtZugeordnet)
  #tabelle2(data.nzKopf, data.nichtZugeordnet, ("left", "left", "right"), (1, 3, 1))
]
#abschnitt(data.t.herkunft)
#text(size: 7.5pt, fill: grau)[#data.t.hinweisSaldo]
#tabelle2(data.herkunftKopf, data.herkunft, ("left", "left", "left", "right", "right"), (2, 1, 3, 1, 1))
`;

const bezeichnung = (z: { bezeichnungDe: string; bezeichnungEn: string }, s: Sprache) => (s === "de" ? z.bezeichnungDe : z.bezeichnungEn);

export function auswertungQuelle(d: AuswertungExportDaten): string {
  const t = TEXTE[d.sprache];
  const betrag = (w: string) => formatBetrag(w, d.sprache, d.waehrung);
  const sicht = t.sichten[d.sicht] ?? d.sicht;
  const herkunft: string[][] = [];
  for (const z of d.zeilen) {
    for (const k of z.konten) herkunft.push([bezeichnung(z, d.sprache), k.konto, k.bezeichnung ?? "", betrag(k.saldo), betrag(k.beitrag)]);
  }
  const daten: Record<string, TypstWert> = {
    sprache: d.sprache,
    entwurf: false,
    t: t as unknown as TypstWert,
    titel: `${sicht} ${d.fonds.kurzname}`,
    titelText: sicht,
    kopf: `${t.auswertung} · ${d.fonds.kurzname}`,
    untertitel: `${d.fonds.name} · ${t.zeitraum} ${formatDatum(d.zeitraumVon, d.sprache)} – ${formatDatum(d.zeitraumBis, d.sprache)}`,
    stichtag: formatDatum(d.zeitraumBis, d.sprache),
    wissensstand: formatZeitpunkt(d.erzeugtAm, d.sprache),
    kopfZeile: [t.position, t.betrag],
    zeilen: d.zeilen.map((z) => [`${nbsp.repeat(z.ebene * 3)}${bezeichnung(z, d.sprache)}`, betrag(z.wert)]),
    abstimmungKopf: [t.position, t.carraway, t.buchhaltung, t.differenz],
    abstimmung: (d.abstimmung ?? []).map((a) => [a.bezeichnung, betrag(a.carraway), betrag(a.buchhaltung), betrag(a.differenz)]),
    nzKopf: [t.konto, t.bezeichnung, t.saldo],
    nichtZugeordnet: d.nichtZugeordnet.map((n) => [n.konto, n.bezeichnung ?? "", betrag(n.saldo)]),
    herkunftKopf: [t.position, t.konto, t.bezeichnung, t.saldo, t.beitrag],
    herkunft,
  };
  return `#let data = ${literal(daten)}\n${MIT_GRUNDLAGE(AUSWERTUNG)}`;
}

export function erzeugeAuswertungPdf(d: AuswertungExportDaten): Uint8Array {
  return setzePdf(auswertungQuelle(d));
}

/** Excel: Blatt Auswertung (Betrag als Zahl), Blatt Herkunft, Blatt Nicht zugeordnet, optional Abstimmung. */
export async function erzeugeAuswertungExcel(d: AuswertungExportDaten): Promise<Uint8Array> {
  const t = TEXTE[d.sprache];
  const wb = new ExcelJS.Workbook();
  wb.creator = "Carraway";
  wb.created = new Date();
  const zahlFormat = '#,##0.00 "€"';
  const kopf = (blatt: ExcelJS.Worksheet) => {
    blatt.getRow(1).font = { bold: true };
    blatt.views = [{ state: "frozen", ySplit: 1 }];
  };
  const a = wb.addWorksheet(t.sichten[d.sicht] ?? d.sicht);
  a.columns = [
    { header: t.position, key: "p", width: 48 },
    { header: t.betrag, key: "b", width: 20, style: { numFmt: zahlFormat } },
  ];
  for (const z of d.zeilen) a.addRow({ p: `${nbsp.repeat(z.ebene * 3)}${bezeichnung(z, d.sprache)}`, b: Number(z.wert) });
  kopf(a);
  const h = wb.addWorksheet(t.herkunft.slice(0, 31));
  h.columns = [
    { header: t.position, key: "p", width: 40 },
    { header: t.konto, key: "k", width: 12 },
    { header: t.bezeichnung, key: "n", width: 36 },
    { header: t.saldo, key: "s", width: 18, style: { numFmt: zahlFormat } },
    { header: t.beitrag, key: "b", width: 18, style: { numFmt: zahlFormat } },
    { header: t.regel, key: "r", width: 38 },
  ];
  for (const z of d.zeilen) for (const k of z.konten) h.addRow({ p: bezeichnung(z, d.sprache), k: k.konto, n: k.bezeichnung ?? "", s: Number(k.saldo), b: Number(k.beitrag), r: k.regelId });
  kopf(h);
  if (d.nichtZugeordnet.length) {
    const n = wb.addWorksheet(t.nichtZugeordnet.slice(0, 31));
    n.columns = [
      { header: t.konto, key: "k", width: 12 },
      { header: t.bezeichnung, key: "n", width: 40 },
      { header: t.saldo, key: "s", width: 18, style: { numFmt: zahlFormat } },
    ];
    for (const z of d.nichtZugeordnet) n.addRow({ k: z.konto, n: z.bezeichnung ?? "", s: Number(z.saldo) });
    kopf(n);
  }
  if (d.abstimmung?.length) {
    const s = wb.addWorksheet(t.abstimmung);
    s.columns = [
      { header: t.position, key: "p", width: 48 },
      { header: t.carraway, key: "f", width: 20, style: { numFmt: zahlFormat } },
      { header: t.buchhaltung, key: "b", width: 20, style: { numFmt: zahlFormat } },
      { header: t.differenz, key: "d", width: 20, style: { numFmt: zahlFormat } },
    ];
    for (const z of d.abstimmung) s.addRow({ p: z.bezeichnung, f: Number(z.carraway), b: Number(z.buchhaltung), d: Number(z.differenz) });
    kopf(s);
  }
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
