import ExcelJS from "exceljs";
import { standardKonfiguration, type Berichtsart } from "./konfiguration";
import { ausgewaehlt, exitSpalten, mitWaehrungssicht, portfolioSpalten, SICHT_EXIT, SICHT_PORTFOLIO, summeCent, zusatzSpalten, type Spalte } from "./listen";
import { TEXTE, uebersetzeSchritt } from "./texte";
import { paiBefundText, paiGruppen, paiMetrikText } from "./pdf";
import type { BerichtsOptionen, BerichtsWaehrungssicht, ExitListeDaten, FondsberichtDaten, PaiErklaerungDaten, PortfolioListeDaten, Sprache } from "./typen";

/**
 * Excel-Ausgaben. Beträge und Kennzahlen stehen als Zahlen mit Zahlenformat (nicht als Text), Datumswerte als Datum,
 * die Kopfzeile ist eingefroren. Zahlen aus Zeichenketten wandeln `Number()`: für die Anzeige im Blatt genügt Gleitkomma,
 * die exakten Werte stehen in der API.
 */

const FORMAT = {
  betrag: '#,##0.00 "€"',
  multiple: '0.00"x"',
  prozent: "0.0%",
  datum: "dd.mm.yyyy",
  anzahl: "#,##0",
} as const;

const zahl = (w: string | null): number | null => (w === null ? null : Number(w));
/** Datum ohne Zeitzonenverschiebung: 12 Uhr UTC. */
const datum = (iso: string): Date => new Date(`${iso}T12:00:00Z`);

function kopfzeile(blatt: ExcelJS.Worksheet) {
  const zeile = blatt.getRow(1);
  zeile.font = { bold: true };
  zeile.alignment = { vertical: "middle" };
  blatt.views = [{ state: "frozen", ySplit: 1 }];
}

function portfolioBlatt(wb: ExcelJS.Workbook, d: FondsberichtDaten, sprache: Sprache, name: string) {
  const t = TEXTE[sprache];
  const sicht = d.waehrungssicht;
  const suffix = sicht ? ` (${sicht.sicht === "lokal" ? t.waehrung.lokal : sicht.vergleich})` : "";
  const betragsSpalte = (kopf: string, key: string, breite = 18) => ({ header: kopf + suffix, key, width: breite, style: { numFmt: sicht ? "#,##0.00" : FORMAT.betrag } });
  const eigene = zusatzSpalten<FondsberichtDaten["beteiligungen"][number]>(d.zusatzspalten, t, sprache);
  const blatt = wb.addWorksheet(name);
  blatt.columns = [
    { header: t.unternehmen, key: "name", width: 32 },
    { header: t.sektor, key: "sektor", width: 22 },
    { header: t.instrument, key: "instrument", width: 22 },
    { header: t.status, key: "status", width: 14 },
    { header: t.erstinvestment, key: "erst", width: 16, style: { numFmt: FORMAT.datum } },
    { header: t.kennzahlen.zusage, key: "zusage", width: 18, style: { numFmt: FORMAT.betrag } },
    betragsSpalte(t.kennzahlen.investiert, "investiert"),
    betragsSpalte(t.kennzahlen.rueckfluesse, "rueck"),
    betragsSpalte(t.kennzahlen.bewertung, "bewertung"),
    { header: t.excel.bewertungsstichtag, key: "bewertungAm", width: 16, style: { numFmt: FORMAT.datum } },
    { header: t.excel.bewertungsmethode, key: "methode", width: 20 },
    { header: t.kennzahlen.multiple, key: "multiple", width: 12, style: { numFmt: FORMAT.multiple } },
    // Neue Spalte hinter den bisherigen, damit Verweise auf Spaltenbuchstaben in Auswertungen stabil bleiben.
    { header: t.instrumenteSpalte, key: "instrumente", width: 36 },
    ...eigene.map((s) => ({ header: s.kopf, key: s.schluessel, width: s.art === "text" ? 24 : 16, style: s.art === "zahl" ? { numFmt: ZAHLENFORMAT.zahl } : s.art === "datum" ? { numFmt: FORMAT.datum } : {} })),
  ];
  for (const b of d.beteiligungen) {
    // Mit Währungssicht tragen die drei Betragsspalten die Beträge der Sicht; eine Lücke steht als Text, nie als Zahl.
    const sb = b.sicht;
    const sw = (w: string | null | undefined, fonds: number | null, ohne = false) => (sicht ? (ohne ? null : sb && w !== null && w !== undefined ? Number(w) : t.kursFehlt) : fonds);
    const zeile = blatt.addRow({
      name: b.organisation.name,
      sektor: b.organisation.sektor ?? "",
      instrument: t.instrumente[b.instrument as keyof typeof t.instrumente] ?? b.instrument,
      // Alle Instrumente der Beteiligung als Liste ihrer Bezeichnungen (die Spalte davor bleibt die Art des Hauptinstruments).
      instrumente: (b.instrumente ?? []).map((i) => i.bezeichnung).join(", "),
      status: t.stati[b.status as keyof typeof t.stati] ?? b.status,
      erst: datum(b.erstinvestment),
      zusage: zahl(b.zusage),
      investiert: sw(sb?.investiert, zahl(b.investiert)),
      rueck: sw(sb?.rueckfluesse, zahl(b.rueckfluesse)),
      bewertung: sicht ? sw(sb?.bewertung, null, sb?.ohneBewertung === true) : b.letzteBewertung ? zahl(b.letzteBewertung.wert) : null,
      bewertungAm: b.letzteBewertung ? datum(b.letzteBewertung.stichtag) : null,
      methode: b.letzteBewertung?.methode ?? "",
      multiple: zahl(b.multiple.wert),
      ...Object.fromEntries(eigene.map((s) => [s.schluessel, s.wert(b) === null ? null : s.art === "zahl" ? Number(s.wert(b)) : s.art === "datum" ? datum(s.wert(b)!) : s.wert(b)])),
    });
    // Zahlenformat mit der Währung der Zeile (lokal: je Beteiligung verschieden).
    if (sicht && sb) for (const k of ["investiert", "rueck", "bewertung"]) zeile.getCell(k).numFmt = `#,##0.00 "${sb.waehrung}"`;
  }
  kopfzeile(blatt);
  waehrungsBlatt(wb, sicht, sprache);
  return blatt;
}

/** Blatt „Währungssicht“: die verwendeten Kurse mit Kursdatum und Tag des Postens, darunter die Lücken (kein Kurs, nie ein geschätzter). */
function waehrungsBlatt(wb: ExcelJS.Workbook, sicht: BerichtsWaehrungssicht | undefined, sprache: Sprache) {
  if (!sicht) return;
  const t = TEXTE[sprache];
  const w = t.waehrung;
  const blatt = wb.addWorksheet(w.blatt);
  blatt.columns = [
    { header: w.paar, key: "paar", width: 14 },
    { header: w.kursSpalte, key: "kurs", width: 18, style: { numFmt: "#,##0.00000000" } },
    { header: w.kursdatum, key: "kursDatum", width: 14, style: { numFmt: FORMAT.datum } },
    { header: w.tag, key: "tag", width: 16, style: { numFmt: FORMAT.datum } },
    { header: w.verwendung, key: "verwendung", width: 14 },
    { header: w.grund, key: "grund", width: 44 },
  ];
  blatt.addRow({ paar: sicht.sicht === "lokal" ? w.lokal : (sicht.vergleich ?? ""), grund: sicht.sicht === "lokal" ? w.sichtLokal : w.sichtVergleich.replace("{waehrung}", sicht.vergleich ?? "") });
  for (const k of sicht.kurse) blatt.addRow({ paar: `${k.von}/${k.nach}`, kurs: Number(k.kurs), kursDatum: datum(k.kursDatum), tag: datum(k.tag), verwendung: w[k.verwendung] });
  for (const l of sicht.luecken) {
    blatt.addRow({
      paar: `${l.von}/${l.nach}`,
      tag: datum(l.tag),
      verwendung: w[l.verwendung],
      grund: `${t.kursFehlt}: ${l.grund === "veraltet" && l.letzterKursDatum ? w.grundVeraltet.replace("{datum}", l.letzterKursDatum) : w.grundKeinKurs}`,
    });
  }
  blatt.addRow({});
  blatt.addRow({ grund: w.regel });
  kopfzeile(blatt);
}

function arbeitsmappe(): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Carraway";
  wb.created = new Date();
  return wb;
}

/** Portfolioliste je Stichtag: ein Blatt, Zahlen mit Zahlenformat, Kopfzeile eingefroren, Überschriften je Sprache. */
export async function erzeugePortfolioliste(d: FondsberichtDaten, sprache: Sprache): Promise<Uint8Array> {
  const wb = arbeitsmappe();
  portfolioBlatt(wb, d, sprache, TEXTE[sprache].excel.portfolio);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

/** Daten des Fondsberichts als Arbeitsmappe: Kennzahlen, Portfolio, Herkunft. */
export async function erzeugeFondsberichtExcel(d: FondsberichtDaten, sprache: Sprache, optionen: BerichtsOptionen = {}): Promise<Uint8Array> {
  const t = TEXTE[sprache];
  const wb = arbeitsmappe();
  const k = d.kennzahlen;

  const kennzahlen = wb.addWorksheet(t.excel.kennzahlen);
  kennzahlen.columns = [
    { header: t.excel.kennzahl, key: "name", width: 30 },
    { header: t.excel.wert, key: "wert", width: 22 },
  ];
  const zeilen: [string, number | null, string][] = [
    [t.kennzahlen.nav, zahl(k.nav.wert), FORMAT.betrag],
    [t.kennzahlen.tvpi, zahl(k.tvpi.wert), FORMAT.multiple],
    [t.kennzahlen.dpi, zahl(k.dpi.wert), FORMAT.multiple],
    [t.kennzahlen.rvpi, zahl(k.rvpi.wert), FORMAT.multiple],
    [t.kennzahlen.irr, zahl(k.irr.wert), FORMAT.prozent],
    [t.kennzahlen.abgerufen, zahl(k.abgerufen.wert), FORMAT.betrag],
    [t.kennzahlen.ausschuettungen, zahl(k.ausschuettungen.wert), FORMAT.betrag],
    [t.kennzahlen.zeichnungskapital, zahl(d.fonds.zeichnungskapital), FORMAT.betrag],
  ];
  for (const feld of ["eingezahlt", "offen", "ueberfaellig", "ungeklaert"] as const) {
    if (k[feld]) zeilen.push([t.kennzahlen[feld], zahl(k[feld].wert), FORMAT.betrag]);
  }
  for (const [name, wert, format] of zeilen) {
    const zeile = kennzahlen.addRow({ name, wert });
    zeile.getCell("wert").numFmt = format;
  }
  kennzahlen.addRow({});
  kennzahlen.addRow({ name: t.stichtag, wert: datum(d.stichtag) }).getCell("wert").numFmt = FORMAT.datum;
  kennzahlen.addRow({ name: t.wissensstand, wert: new Date(d.wissensstand) }).getCell("wert").numFmt = "dd.mm.yyyy hh:mm";
  kennzahlen.addRow({ name: t.fonds, wert: d.fonds.name });
  if (optionen.entwurf !== false) kennzahlen.addRow({ name: t.wasserzeichen, wert: t.entwurfHinweis });
  else kennzahlen.addRow({ name: t.freigegeben, wert: "" });
  kopfzeile(kennzahlen);

  portfolioBlatt(wb, d, sprache, t.excel.portfolio);

  const herkunft = wb.addWorksheet(t.excel.herkunft);
  herkunft.columns = [
    { header: t.excel.kennzahl, key: "kennzahl", width: 22 },
    { header: t.excel.zeichen, key: "zeichen", width: 8 },
    { header: t.excel.schritt, key: "schritt", width: 64 },
    { header: t.excel.wert, key: "wert", width: 26 },
  ];
  const namen: [string, keyof FondsberichtDaten["kennzahlen"]][] = [
    [t.kennzahlen.nav, "nav"],
    [t.kennzahlen.tvpi, "tvpi"],
    [t.kennzahlen.dpi, "dpi"],
    [t.kennzahlen.rvpi, "rvpi"],
    [t.kennzahlen.irr, "irr"],
    [t.kennzahlen.abgerufen, "abgerufen"],
    [t.kennzahlen.ausschuettungen, "ausschuettungen"],
  ];
  for (const feld of ["eingezahlt", "offen", "ueberfaellig", "ungeklaert"] as const) namen.push([t.kennzahlen[feld], feld]);
  for (const [name, schluessel] of namen) {
    for (const s of k[schluessel]?.schritte ?? []) {
      const numerisch = /^-?\d+(\.\d+)?$/.test(s.wert);
      herkunft.addRow({ kennzahl: name, zeichen: s.zeichen, schritt: uebersetzeSchritt(s.bezeichnung, sprache), wert: numerisch ? Number(s.wert) : s.wert });
    }
  }
  const regel = herkunft.addRow({ kennzahl: t.kennzahlen.nav, schritt: t.navRegel });
  regel.getCell("schritt").alignment = { wrapText: true };
  regel.height = 52;
  kopfzeile(herkunft);

  return new Uint8Array(await wb.xlsx.writeBuffer());
}

const ZAHLENFORMAT = { betrag: FORMAT.betrag, multiple: FORMAT.multiple, prozent: FORMAT.prozent, datum: FORMAT.datum, zahl: "#,##0.######" } as const;

/**
 * Liste als Arbeitsmappe: Blatt mit den Spalten der Vorlage (Überschriften je Sprache, Zahlen als Zahlen, Datum als Datum, Kopfzeile
 * eingefroren), Summenzeile, und ein Blatt „Info“ mit Fonds, Stichtag, Wissensstand und Einheit (bei Entwurf mit Hinweis).
 * Bei der Einheit TEUR stehen die Beträge in Tausend (Überschrift mit Zusatz), sonst in der Währung des Fonds.
 */
async function listeExcel<Z>(art: Berichtsart, blattName: string, spalten: Spalte<Z>[], zeilen: Z[], d: PortfolioListeDaten | ExitListeDaten, sprache: Sprache, optionen: BerichtsOptionen): Promise<Uint8Array> {
  const t = TEXTE[sprache];
  const einheit = (optionen.konfiguration ?? standardKonfiguration(art)).einheit;
  const teur = einheit === "TEUR";
  const wb = arbeitsmappe();
  const blatt = wb.addWorksheet(blattName);
  blatt.columns = spalten.map((s) => ({
    header: s.art === "betrag" && teur ? `${s.kopf} (T${d.fonds.waehrung})` : s.kopf,
    key: s.schluessel,
    width: s.art === "text" ? 28 : 18,
    style: s.art === "text" ? {} : { numFmt: s.zahlenformat ?? (s.art === "betrag" ? (teur ? "#,##0" : FORMAT.betrag) : ZAHLENFORMAT[s.art]) },
  }));
  const skaliert = (s: Spalte<Z>) => s.art === "betrag" || s.skaliert === true;
  const wert = (s: Spalte<Z>, z: Z): string | number | Date | null => {
    const w = s.wert(z);
    // Eine Lücke der Währungssicht steht als Text („Kurs fehlt“), nie als Zahl.
    if (w === null) return s.luecke?.(z) ? t.kursFehlt : null;
    if (s.art === "text") return w;
    if (s.art === "datum") return datum(w);
    return skaliert(s) && teur ? Number(w) / 1000 : Number(w);
  };
  for (const z of zeilen) blatt.addRow(Object.fromEntries(spalten.map((s) => [s.schluessel, wert(s, z)])));
  if (zeilen.length > 0) {
    const summeWert = (s: Spalte<Z>): string | number | null => {
      if (s.summe) {
        const e = s.summe(zeilen);
        return e.roh === null ? e.text : teur ? Number(e.roh) / 1000 : Number(e.roh);
      }
      return teur ? summeCent(zeilen, s) / 100_000 : summeCent(zeilen, s) / 100;
    };
    const summe = blatt.addRow(Object.fromEntries(spalten.map((s, i) => [s.schluessel, i === 0 ? t.summe : s.summiert ? summeWert(s) : null])));
    summe.font = { bold: true };
  }
  kopfzeile(blatt);

  const info = wb.addWorksheet("Info");
  info.columns = [
    { header: t.excel.kennzahl, key: "name", width: 22 },
    { header: t.excel.wert, key: "wert", width: 30 },
  ];
  info.addRow({ name: t.fonds, wert: d.fonds.name });
  info.addRow({ name: t.stichtag, wert: datum(d.stichtag) }).getCell("wert").numFmt = FORMAT.datum;
  info.addRow({ name: t.wissensstand, wert: new Date(d.wissensstand) }).getCell("wert").numFmt = "dd.mm.yyyy hh:mm";
  info.addRow({ name: t.excel.einheit, wert: teur ? `T${d.fonds.waehrung}` : d.fonds.waehrung });
  if (optionen.entwurf !== false) info.addRow({ name: t.wasserzeichen, wert: t.entwurfHinweis });
  else info.addRow({ name: t.freigegeben, wert: "" });
  kopfzeile(info);
  waehrungsBlatt(wb, d.waehrungssicht, sprache);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

/** Portfolioliste je Stichtag als Excel (Spalten und Einheit aus der Vorlage des Fonds). */
export function erzeugePortfolioListeExcel(d: PortfolioListeDaten, sprache: Sprache, optionen: BerichtsOptionen = {}): Promise<Uint8Array> {
  const t = TEXTE[sprache];
  const konfiguration = optionen.konfiguration ?? standardKonfiguration("portfolioliste");
  const spalten = [
    ...mitWaehrungssicht(ausgewaehlt(portfolioSpalten(t), konfiguration.spalten), d.waehrungssicht, SICHT_PORTFOLIO, t, sprache, konfiguration.einheit),
    ...zusatzSpalten<PortfolioListeDaten["zeilen"][number]>(d.zusatzspalten, t, sprache),
  ];
  return listeExcel("portfolioliste", t.excel.portfolioliste, spalten, d.zeilen, d, sprache, optionen);
}

/** Exitliste je Stichtag als Excel. */
export function erzeugeExitListeExcel(d: ExitListeDaten, sprache: Sprache, optionen: BerichtsOptionen = {}): Promise<Uint8Array> {
  const t = TEXTE[sprache];
  const konfiguration = optionen.konfiguration ?? standardKonfiguration("exitliste");
  const spalten = [
    ...mitWaehrungssicht(ausgewaehlt(exitSpalten(t), konfiguration.spalten), d.waehrungssicht, SICHT_EXIT, t, sprache, konfiguration.einheit),
    ...zusatzSpalten<ExitListeDaten["zeilen"][number]>(d.zusatzspalten, t, sprache),
  ];
  return listeExcel("exitliste", t.excel.exitliste, spalten, d.zeilen, d, sprache, optionen);
}

/**
 * PAI-Erklärung als Arbeitsmappe: Blatt „PAI“ mit den Zeilen der Tabelle (Auswirkung des Jahres und des Vorjahres, Abdeckung und Schätzanteil als
 * Prozent-Zahlen, Freitexte), Blatt „Quartale“ mit den Werten der Quartalsenden, Blatt „Hinweise“ mit den Befunden und Blatt „Info“.
 * Nicht definierte Werte bleiben leer (nicht 0). Die Zahlen stehen als Zahlen, die Kopfzeile ist eingefroren.
 */
export async function erzeugePaiErklaerungExcel(d: PaiErklaerungDaten, sprache: Sprache, optionen: BerichtsOptionen = {}): Promise<Uint8Array> {
  const t = TEXTE[sprache];
  const p = t.pai;
  const frei = optionen.freitexte ?? {};
  const wb = arbeitsmappe();

  const blatt = wb.addWorksheet(t.excel.pai);
  blatt.columns = [
    { header: p.nr, key: "nr", width: 8 },
    { header: p.indikator, key: "indikator", width: 40 },
    { header: p.metrik, key: "metrik", width: 56 },
    { header: t.excel.einheit, key: "einheit", width: 24 },
    { header: `${p.auswirkung} ${d.jahr}`, key: "wert", width: 18, style: { numFmt: "#,##0.0000" } },
    { header: `${p.auswirkung} ${d.jahr - 1}`, key: "vorjahr", width: 18, style: { numFmt: "#,##0.0000" } },
    { header: p.abdeckung, key: "abdeckung", width: 14, style: { numFmt: FORMAT.prozent } },
    { header: p.schaetzanteil, key: "schaetzanteil", width: 16, style: { numFmt: FORMAT.prozent } },
    { header: p.erlaeuterung, key: "erlaeuterung", width: 48 },
    { header: p.massnahmen, key: "massnahmen", width: 48 },
  ];
  const alle = paiGruppen(d.zeilen, sprache).flatMap((g) => g.zeilen);
  for (const z of alle) {
    const erster = alle.find((x) => x.indikator === z.indikator) === z;
    blatt.addRow({
      nr: `${z.tabelle === 1 ? "" : `T${z.tabelle} `}${z.nr}`,
      indikator: sprache === "de" ? z.bezeichnungDe : z.bezeichnungEn,
      metrik: paiMetrikText({ ...z, einheit: "" }, sprache).replace(/ \[\]$/, ""),
      einheit: z.einheit,
      wert: zahl(z.wert),
      vorjahr: zahl(z.vorjahr?.wert ?? null),
      abdeckung: zahl(z.abdeckung),
      schaetzanteil: zahl(z.schaetzanteil),
      erlaeuterung: erster ? (frei[`erlaeuterung_${z.indikator}`] ?? "").trim() : "",
      massnahmen: erster ? (frei[`massnahmen_${z.indikator}`] ?? "").trim() : "",
    });
  }
  kopfzeile(blatt);

  const quartale = wb.addWorksheet(t.excel.paiHerkunft);
  quartale.columns = [
    { header: p.metrik, key: "metrik", width: 60 },
    { header: p.quartal, key: "stichtag", width: 16, style: { numFmt: FORMAT.datum } },
    { header: p.auswirkung, key: "wert", width: 18, style: { numFmt: "#,##0.0000" } },
    { header: p.abdeckung, key: "abdeckung", width: 14, style: { numFmt: FORMAT.prozent } },
  ];
  for (const z of alle) for (const q of z.quartale) quartale.addRow({ metrik: paiMetrikText(z, sprache), stichtag: datum(q.stichtag), wert: zahl(q.wert), abdeckung: zahl(q.abdeckung) });
  kopfzeile(quartale);

  const hinweise = wb.addWorksheet(p.befunde);
  hinweise.columns = [{ header: p.befunde, key: "text", width: 120 }];
  for (const b of d.befunde) hinweise.addRow({ text: paiBefundText(b, sprache) });
  kopfzeile(hinweise);

  const info = wb.addWorksheet("Info");
  info.columns = [
    { header: t.excel.kennzahl, key: "name", width: 26 },
    { header: t.excel.wert, key: "wert", width: 40 },
  ];
  info.addRow({ name: t.fonds, wert: d.fonds.name });
  info.addRow({ name: p.berichtsjahr, wert: d.jahr });
  info.addRow({ name: t.stichtag, wert: datum(d.stichtag) }).getCell("wert").numFmt = FORMAT.datum;
  info.addRow({ name: t.wissensstand, wert: new Date(d.wissensstand) }).getCell("wert").numFmt = "dd.mm.yyyy hh:mm";
  info.addRow({ name: p.katalog, wert: d.katalogVersion });
  info.addRow({ name: p.einordnung, wert: d.offenlegung ? `${p[d.offenlegung.art]} (${p.einordnungSeit} ${d.offenlegung.gueltigAb})` : p.einordnungKeine });
  info.addRow({ name: p.unternehmen, wert: d.unternehmen });
  if (frei.vorbemerkung?.trim()) info.addRow({ name: p.vorbemerkung, wert: frei.vorbemerkung.trim() });
  info.addRow({ name: "", wert: p.hinweisBerechnung });
  info.addRow({ name: "", wert: p.hinweisAbdeckung });
  if (optionen.entwurf !== false) info.addRow({ name: t.wasserzeichen, wert: `${t.entwurfHinweis}. ${p.hinweisEntwurf}` });
  else info.addRow({ name: t.freigegeben, wert: "" });
  kopfzeile(info);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
