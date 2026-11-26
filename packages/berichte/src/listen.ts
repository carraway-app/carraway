import { formatBetrag, formatDatum, formatMultiple, formatProzent, formatZahl } from "./format";
import type { Einheit } from "./konfiguration";
import { TEXTE, type Texte } from "./texte";
import type { BerichtsWaehrungssicht, ExitListeDaten, ExitListeZeile, PortfolioListeDaten, PortfolioListeZeile, SichtBetraege, Sprache, ZusatzSpalte } from "./typen";

/**
 * Spaltendefinitionen der Portfolio- und Exitliste, gemeinsam für PDF und Excel. Eine Spalte kennt ihre Überschrift (je Sprache),
 * Art (Text, Betrag, Multiple, Prozent, Datum) und den Wert; Beträge stehen in der Währung des Fonds, bei der Einheit TEUR geteilt durch tausend.
 */

export type Spaltenart = "text" | "betrag" | "multiple" | "prozent" | "datum" | "zahl";

export interface Spalte<Z> {
  schluessel: string;
  kopf: string;
  art: Spaltenart;
  /** Roher Wert: Zeichenkette (Text, Betrag, Multiple, Anteil, Datum) oder `null`. */
  wert: (zeile: Z) => string | null;
  /** Anteil an der Breite: `null` = automatisch, sonst Bruchteil des freien Platzes. */
  breite: number | null;
  /** Wird in der Summenzeile addiert. */
  summiert: boolean;
  /** Anzeige im PDF, wenn sie von der Art abweicht (eigene Felder, Beträge in anderer Währung). */
  format?: (zeile: Z) => string;
  /** Betrag, der bei der Einheit TEUR durch tausend geteilt wird, obwohl die Art `zahl` ist (Beträge der Währungssicht). */
  skaliert?: boolean;
  /** Zahlenformat in Excel, wenn es vom Standard der Art abweicht. */
  zahlenformat?: string;
  /** Der Wert fehlt wegen eines fehlenden Kurses (Währungssicht); Excel schreibt dann „Kurs fehlt“ statt einer leeren Zelle. */
  luecke?: (zeile: Z) => boolean;
  /** Eigene Summe (Währungssicht: eine Summe mit Lücke ist selbst eine Lücke, `roh` ist dann `null`). */
  summe?: (zeilen: Z[]) => { roh: string | null; text: string };
}

export function portfolioSpalten(t: Texte): Spalte<PortfolioListeZeile>[] {
  const text = (schluessel: string, kopf: string, wert: (z: PortfolioListeZeile) => string | null, breite: number | null = 1): Spalte<PortfolioListeZeile> => ({ schluessel, kopf, art: "text", wert, breite, summiert: false });
  const betrag = (schluessel: string, kopf: string, wert: (z: PortfolioListeZeile) => string | null): Spalte<PortfolioListeZeile> => ({ schluessel, kopf, art: "betrag", wert, breite: null, summiert: true });
  return [
    text("unternehmen", t.unternehmen, (z) => z.organisation, 1.6),
    text("sektor", t.sektor, (z) => z.sektor),
    text("phase", t.phase, (z) => z.phase),
    text("instrument", t.instrument, (z) => t.instrumente[z.instrument as keyof Texte["instrumente"]] ?? z.instrument),
    text("betreuung", t.betreuung, (z) => z.betreuung),
    betrag("zusage", t.kennzahlen.zusage, (z) => z.zusage),
    betrag("investiert", t.kennzahlen.investiert, (z) => z.investiert),
    betrag("buchwert", t.kennzahlen.buchwert, (z) => z.buchwert),
    betrag("wertberichtigung", t.kennzahlen.wertberichtigung, (z) => z.wertberichtigung),
    betrag("offeneZusage", t.kennzahlen.offeneZusage, (z) => z.offeneZusage),
    betrag("bewertung", t.kennzahlen.bewertung, (z) => z.bewertung),
    { schluessel: "multiple", kopf: t.kennzahlen.multiple, art: "multiple", wert: (z) => z.multiple, breite: null, summiert: false },
  ];
}

export function exitSpalten(t: Texte): Spalte<ExitListeZeile>[] {
  return [
    { schluessel: "unternehmen", kopf: t.unternehmen, art: "text", wert: (z) => z.organisation, breite: 1.6, summiert: false },
    { schluessel: "art", kopf: t.art, art: "text", wert: (z) => t.exitArten[z.art], breite: null, summiert: false },
    { schluessel: "datum", kopf: t.datum, art: "datum", wert: (z) => z.datum, breite: null, summiert: false },
    { schluessel: "investiert", kopf: t.kennzahlen.investiert, art: "betrag", wert: (z) => z.investiert, breite: null, summiert: true },
    { schluessel: "erloes", kopf: t.kennzahlen.erloes, art: "betrag", wert: (z) => z.erloes, breite: null, summiert: true },
    { schluessel: "multiple", kopf: t.kennzahlen.multiple, art: "multiple", wert: (z) => z.multiple, breite: null, summiert: false },
    { schluessel: "irr", kopf: t.kennzahlen.irr, art: "prozent", wert: (z) => z.irr, breite: null, summiert: false },
    { schluessel: "offeneForderungen", kopf: t.kennzahlen.offeneForderungen, art: "betrag", wert: (z) => z.offeneForderungen, breite: null, summiert: true },
  ];
}

/** Spalten in der Reihenfolge der Konfiguration; unbekannte Schlüssel werden übersprungen (die Konfiguration prüft sie vorher). */
export function ausgewaehlt<Z>(alle: Spalte<Z>[], schluessel: readonly string[]): Spalte<Z>[] {
  return schluessel.flatMap((k) => alle.filter((s) => s.schluessel === k));
}

/** Summe einer Betragsspalte in Cent (ganzzahlig, damit sich nichts aufsummiert). */
export function summeCent<Z>(zeilen: Z[], spalte: Spalte<Z>): number {
  return zeilen.reduce((s, z) => s + Math.round(Number(spalte.wert(z) ?? 0) * 100), 0);
}

const centAlsBetrag = (cent: number) => (cent / 100).toFixed(2);

/** Anzeige eines Werts in einer Spalte (PDF). */
export function anzeige<Z>(spalte: Spalte<Z>, zeile: Z, sprache: Sprache, waehrung: string, einheit: Einheit): string {
  if (spalte.format) return spalte.format(zeile);
  const w = spalte.wert(zeile);
  switch (spalte.art) {
    case "zahl":
      return w === null ? "–" : formatZahl(w, sprache);
    case "text":
      return w ?? "–";
    case "betrag":
      return formatBetrag(w, sprache, waehrung, einheit);
    case "multiple":
      return formatMultiple(w, sprache);
    case "prozent":
      return formatProzent(w, sprache);
    case "datum":
      return w === null ? "–" : formatDatum(w, sprache);
  }
}

/** Zeilen der Tabelle (Text) mit Summenzeile am Ende, wenn Zeilen vorhanden sind. */
export function tabellenZeilen<Z>(spalten: Spalte<Z>[], zeilen: Z[], sprache: Sprache, waehrung: string, einheit: Einheit, summeText: string): string[][] {
  if (zeilen.length === 0) return [];
  const koerper = zeilen.map((z) => spalten.map((s) => anzeige(s, z, sprache, waehrung, einheit)));
  const summe = spalten.map((s, i) => (i === 0 ? summeText : s.summiert ? (s.summe ? s.summe(zeilen).text : formatBetrag(centAlsBetrag(summeCent(zeilen, s)), sprache, waehrung, einheit)) : ""));
  return [...koerper, summe];
}

export const ausrichtungen = <Z>(spalten: Spalte<Z>[]) => spalten.map((s) => (s.art === "text" ? "left" : "right"));
export const breiten = <Z>(spalten: Spalte<Z>[]) => spalten.map((s) => s.breite);

export const listenTexte = (sprache: Sprache) => TEXTE[sprache];

export type { ExitListeDaten, PortfolioListeDaten };

// Eigene Felder und Währungssicht -----------------------------------------------------------------------------------------------------

type MitFeldern = { felder?: Record<string, unknown>; sicht?: SichtBetraege };

/** Anzeigetext eines Feldwerts nach Typ; `null` für „kein Wert“. Verknüpfungs- und Personenfelder tragen schon den aufgelösten Namen. */
export function zusatzWertText(def: ZusatzSpalte, wert: unknown, t: Texte, sprache: Sprache): string | null {
  if (wert === null || wert === undefined || wert === "") return null;
  switch (def.typ) {
    case "zahl":
      return formatZahl(String(wert), sprache);
    case "betrag":
      return formatBetrag(String(wert), sprache, def.waehrung ?? "EUR");
    case "datum":
      return formatDatum(String(wert), sprache);
    case "kontrollkaestchen":
      return wert === true ? t.zusatzfelder.ja : t.zusatzfelder.nein;
    case "auswahl":
      return def.optionen?.find((o) => o.schluessel === wert)?.label ?? String(wert);
    case "mehrfachauswahl":
      return Array.isArray(wert) ? wert.map((w) => def.optionen?.find((o) => o.schluessel === w)?.label ?? String(w)).join(", ") : String(wert);
    default:
      return String(wert);
  }
}

/** Spalten für die gewählten eigenen Felder in der Reihenfolge der Vorlage; eine Definition, die es nicht mehr gibt, wird übersprungen. */
export function zusatzSpalten<Z extends MitFeldern>(defs: readonly ZusatzSpalte[] | undefined, t: Texte, sprache: Sprache): Spalte<Z>[] {
  return (defs ?? []).map((d): Spalte<Z> => {
    const roh = (z: Z) => z.felder?.[d.id];
    const zahlenart = d.typ === "zahl" || d.typ === "betrag";
    return {
      schluessel: `feld:${d.id}`,
      kopf: d.typ === "betrag" && d.waehrung ? `${d.name} (${d.waehrung})` : d.name,
      art: zahlenart ? "zahl" : d.typ === "datum" ? "datum" : "text",
      // Rohwert für Excel (Zahl, Datum) oder fertiger Text; Anzeige im PDF über `format`.
      wert: (z) => {
        const w = roh(z);
        if (w === null || w === undefined || w === "") return null;
        return zahlenart || d.typ === "datum" ? String(w) : zusatzWertText(d, w, t, sprache);
      },
      format: (z) => zusatzWertText(d, roh(z), t, sprache) ?? "–",
      breite: d.typ === "langtext" ? 1.5 : null,
      summiert: false,
    };
  });
}

/** Welche Spalte welchen Betrag der Währungssicht trägt. */
export type SichtZuordnung = Record<string, "investiert" | "rueckfluesse" | "bewertung">;

/**
 * Ersetzt die Fondsbeträge der zugeordneten Spalten durch die der Währungssicht (lokal je Zeile in ihrer Währung, oder in der Vergleichswährung). Eine Lücke steht
 * als „Kurs fehlt“, nie als Zahl; die Summe der Vergleichswährung ist selbst eine Lücke, sobald eine Zeile eine hat; Summen in lokalen Währungen entfallen.
 */
export function mitWaehrungssicht<Z extends MitFeldern>(spalten: Spalte<Z>[], sicht: BerichtsWaehrungssicht | undefined, zuordnung: SichtZuordnung, t: Texte, sprache: Sprache, einheit: Einheit): Spalte<Z>[] {
  if (!sicht) return spalten;
  return spalten.map((s): Spalte<Z> => {
    const feld = zuordnung[s.schluessel];
    if (!feld) return s;
    const wert = (z: Z): string | null => z.sicht?.[feld] ?? null;
    const ohne = (z: Z) => feld === "bewertung" && z.sicht?.ohneBewertung === true;
    const lueckeIn = (z: Z) => !ohne(z) && (z.sicht === undefined || z.sicht[feld] === null);
    return {
      ...s,
      kopf: `${s.kopf} (${sicht.sicht === "lokal" ? t.waehrung.lokal : sicht.vergleich}${einheit === "TEUR" ? `, ${t.waehrung.tausend}` : ""})`,
      art: "zahl",
      skaliert: true,
      zahlenformat: einheit === "TEUR" ? "#,##0" : "#,##0.00",
      wert,
      luecke: lueckeIn,
      format: (z) => (ohne(z) ? "–" : lueckeIn(z) ? t.kursFehlt : formatBetrag(wert(z), sprache, z.sicht!.waehrung, einheit)),
      summiert: sicht.sicht === "vergleich" && s.summiert,
      summe: (zeilen) => {
        if (zeilen.some(lueckeIn)) return { roh: null, text: t.kursFehlt };
        const cent = zeilen.reduce((acc, z) => acc + Math.round(Number(wert(z)) * 100), 0);
        const roh = centAlsBetrag(cent);
        return { roh, text: formatBetrag(roh, sprache, sicht.vergleich ?? "EUR", einheit) };
      },
    };
  });
}

/** Zeilen des Hinweises zur Währungssicht unter der Tabelle: Sicht, Regel, verwendete Kurse mit Datum, Lücken. Höchstens `max` Kurse, der Rest steht in der Anlage der Datei. */
export function waehrungsHinweise(sicht: BerichtsWaehrungssicht | undefined, t: Texte, sprache: Sprache, max = 8): string[] {
  if (!sicht) return [];
  const w = t.waehrung;
  const zahl = (kurs: string) => new Intl.NumberFormat(sprache === "de" ? "de-DE" : "en-GB", { maximumFractionDigits: 8 }).format(Number(kurs));
  const kopf = [sicht.sicht === "lokal" ? w.sichtLokal : w.sichtVergleich.replace("{waehrung}", sicht.vergleich ?? ""), w.regel];
  const eindeutig = sicht.kurse.filter((k, i) => sicht.kurse.findIndex((x) => x.von === k.von && x.nach === k.nach && x.kursDatum === k.kursDatum && x.tag === k.tag) === i);
  const kurse = eindeutig.slice(0, max).map((k) => w.kurs.replace("{von}", k.von).replace("{nach}", k.nach).replace("{kurs}", zahl(k.kurs)).replace("{datum}", formatDatum(k.kursDatum, sprache)).replace("{tag}", formatDatum(k.tag, sprache)));
  if (eindeutig.length > max) kurse.push(w.weitereKurse.replace("{n}", String(eindeutig.length - max)));
  const luecken = sicht.luecken.map((l) =>
    w.luecke
      .replace("{von}", l.von)
      .replace("{nach}", l.nach)
      .replace("{tag}", formatDatum(l.tag, sprache))
      .replace("{grund}", l.grund === "veraltet" && l.letzterKursDatum ? w.grundVeraltet.replace("{datum}", formatDatum(l.letzterKursDatum, sprache)) : w.grundKeinKurs),
  );
  return [...kopf, ...kurse, ...luecken];
}

/** Zuordnung der Spalten der Listen und des Portfolios zu den Beträgen der Währungssicht. */
export const SICHT_PORTFOLIO: SichtZuordnung = { investiert: "investiert", bewertung: "bewertung", rueckfluesse: "rueckfluesse" };
export const SICHT_EXIT: SichtZuordnung = { investiert: "investiert", erloes: "rueckfluesse" };
