import { Decimal } from "./decimal.js";
import type { MitHerkunft } from "./herkunft.js";
import { zerlege, type Datum } from "./datum.js";

/**
 * Kennzahlen der Portfoliounternehmen (Ist, Plan, Forecast je Zeitraum): welcher Wert zählt, Abweichung von Plan zu Ist und
 * Verdichtung feiner Zeiträume. Reine Funktionen ohne Datenbank; die Tests rechnen gegen `referenz/referenz_kpi.py`.
 */

export type KpiSzenario = "ist" | "plan" | "forecast";
export type KpiTyp = "betrag" | "zahl" | "prozent" | "ja_nein" | "text";
export type KpiAggregation = "summe" | "stand" | "durchschnitt";
export type KpiPeriodenart = "monat" | "quartal" | "jahr";
export type KpiWertStatus = "entwurf" | "eingereicht" | "bestaetigt";

/** Die Felder eines gespeicherten Wertes, die für die Auswahl gebraucht werden. */
export interface KpiZeile {
  id: string;
  /** Fachlicher Schlüssel der Kennzahl (über alle Katalogversionen gleich). */
  schluessel: string;
  periodeBeginn: Datum;
  periodeEnde: Datum;
  szenario: KpiSzenario;
  wert: string;
  status: KpiWertStatus;
  /** Zeitpunkt der Bestätigung (ISO-Text oder Date); nur bestätigte Zeilen haben ihn. */
  bestaetigtAm: string | Date | null;
  /** Fortlaufende Nummer der Zeile: entscheidet bei gleichem Zeitpunkt (Zeilen werden nie überschrieben). */
  folge: number;
}

/** Schlüssel einer Zeitreihe: Kennzahl, Zeitraum und Szenario. */
export const kpiReihenschluessel = (z: Pick<KpiZeile, "schluessel" | "periodeBeginn" | "periodeEnde" | "szenario">): string =>
  `${z.schluessel}|${z.periodeBeginn}|${z.periodeEnde}|${z.szenario}`;

const zeitwert = (wert: string | Date | null): number => (wert === null ? 0 : new Date(wert).getTime());

/**
 * Welcher Wert gilt: je Kennzahl, Zeitraum und Szenario die zuletzt bestätigte Zeile (späteste Bestätigung, bei Gleichstand die höhere
 * `folge`). Entwürfe und eingereichte Werte zählen nie. Mit `stand` zählen nur Bestätigungen bis dahin (Wissensstand).
 */
export function geltendeWerte<T extends KpiZeile>(zeilen: readonly T[], stand?: string | Date): Map<string, T> {
  const grenze = stand === undefined ? Infinity : new Date(stand).getTime();
  const aus = new Map<string, T>();
  for (const z of zeilen) {
    if (z.status !== "bestaetigt" || z.bestaetigtAm === null || zeitwert(z.bestaetigtAm) > grenze) continue;
    const k = kpiReihenschluessel(z);
    const bisher = aus.get(k);
    if (!bisher || zeitwert(z.bestaetigtAm) > zeitwert(bisher.bestaetigtAm) || (zeitwert(z.bestaetigtAm) === zeitwert(bisher.bestaetigtAm) && z.folge > bisher.folge)) aus.set(k, z);
  }
  return aus;
}

export interface KpiAbweichung {
  ist: Decimal;
  plan: Decimal;
  /** Ist minus Plan; bei Prozent-Kennzahlen in Prozentpunkten. */
  absolut: Decimal;
  /** (Ist − Plan) ÷ |Plan| in Prozent; `null` bei Plan 0 (nicht definiert). */
  prozent: Decimal | null;
}

const ZAHLENTYPEN: readonly KpiTyp[] = ["betrag", "zahl", "prozent"];
export const istZahlentyp = (typ: KpiTyp): boolean => ZAHLENTYPEN.includes(typ);

/**
 * Abweichung von Plan zu Ist: absolut = Ist − Plan, relativ = (Ist − Plan) ÷ |Plan| × 100. Bei Plan 0 gibt es keine relative Abweichung, bei einem
 * negativen Plan bleibt das Vorzeichen richtig (ein weniger negatives Ist ist eine positive Abweichung). Für `ja_nein` und `text` gibt es keine (`null`).
 */
export function kpiAbweichung(typ: KpiTyp, ist: string, plan: string): MitHerkunft<KpiAbweichung | null> {
  if (!istZahlentyp(typ)) return { wert: null, schritte: [{ zeichen: "", bezeichnung: "Keine Abweichung bei Ja/Nein und Text", wert: "" }] };
  const i = new Decimal(ist);
  const p = new Decimal(plan);
  const absolut = i.minus(p);
  const prozent = p.isZero() ? null : absolut.div(p.abs()).times(100);
  return {
    wert: { ist: i, plan: p, absolut, prozent },
    schritte: [
      { zeichen: "", bezeichnung: "Ist", wert: i.toString() },
      { zeichen: "−", bezeichnung: "Plan", wert: p.toString() },
      { zeichen: "=", bezeichnung: "Abweichung absolut", wert: absolut.toString() },
      { zeichen: "÷", bezeichnung: "Betrag des Plans", wert: p.abs().toString() },
      { zeichen: "=", bezeichnung: "Abweichung relativ in Prozent", wert: prozent === null ? "nicht definiert" : prozent.toString() },
    ],
  };
}

/**
 * Verdichtet Werte feinerer Zeiträume (nach Beginn geordnet) zu einem gröberen: Summe, Stand (der letzte Wert) oder Durchschnitt.
 * Ohne Werte gibt es keinen Wert (`null`); der Durchschnitt zählt nur vorhandene Zeiträume.
 */
export function kpiVerdichte(aggregation: KpiAggregation, werte: readonly { periodeBeginn: Datum; wert: string }[]): MitHerkunft<Decimal | null> {
  if (werte.length === 0) return { wert: null, schritte: [{ zeichen: "", bezeichnung: "Keine Werte", wert: "" }] };
  const geordnet = [...werte].sort((a, b) => (a.periodeBeginn < b.periodeBeginn ? -1 : a.periodeBeginn > b.periodeBeginn ? 1 : 0));
  const summe = geordnet.reduce((s, w) => s.plus(w.wert), new Decimal(0));
  if (aggregation === "summe") return { wert: summe, schritte: [{ zeichen: "", bezeichnung: `Summe aus ${geordnet.length} Zeiträumen`, wert: summe.toString() }] };
  if (aggregation === "stand") {
    const letzter = geordnet[geordnet.length - 1]!;
    return { wert: new Decimal(letzter.wert), schritte: [{ zeichen: "", bezeichnung: `Stand am Ende (Zeitraum ab ${letzter.periodeBeginn})`, wert: letzter.wert }] };
  }
  const durchschnitt = summe.div(geordnet.length);
  return {
    wert: durchschnitt,
    schritte: [
      { zeichen: "", bezeichnung: "Summe", wert: summe.toString() },
      { zeichen: "÷", bezeichnung: "Anzahl Zeiträume", wert: String(geordnet.length) },
      { zeichen: "=", bezeichnung: "Durchschnitt", wert: durchschnitt.toString() },
    ],
  };
}

// Zeiträume -------------------------------------------------------------------------------------------------------

const tageImMonat = (jahr: number, monat: number): number => new Date(Date.UTC(jahr, monat, 0)).getUTCDate();
const zweistellig = (n: number): string => String(n).padStart(2, "0");

/** Art des Zeitraums, wenn er genau ein Kalendermonat, -quartal oder -jahr ist; sonst `null`. */
export function kpiPeriodenart(beginn: Datum, ende: Datum): KpiPeriodenart | null {
  const b = zerlege(beginn);
  const e = zerlege(ende);
  if (b.tag !== 1) return null;
  if (b.jahr === e.jahr && b.monat === e.monat && e.tag === tageImMonat(e.jahr, e.monat)) return "monat";
  if (b.jahr === e.jahr && (b.monat - 1) % 3 === 0 && e.monat === b.monat + 2 && e.tag === tageImMonat(e.jahr, e.monat)) return "quartal";
  if (b.jahr === e.jahr && b.monat === 1 && e.monat === 12 && e.tag === 31) return "jahr";
  return null;
}

const STUFE: Record<KpiPeriodenart, number> = { monat: 1, quartal: 2, jahr: 3 };

/** Ein Zeitraum der Art `art` darf nur erfragt werden, wenn die Kennzahl höchstens so fein erhoben wird (Monat ≤ Quartal ≤ Jahr). */
export const kpiZeitraumPasst = (art: KpiPeriodenart, periodizitaet: KpiPeriodenart): boolean => STUFE[art] >= STUFE[periodizitaet];

/**
 * Zeitraum aus einer Kurzschreibweise: `JJJJ` (Jahr), `JJJJ-Qn` (Quartal), `JJJJ-MM` (Monat). `null` bei ungültiger Schreibweise.
 */
export function kpiZeitraumAus(text: string): { beginn: Datum; ende: Datum; art: KpiPeriodenart } | null {
  let m = /^(\d{4})$/.exec(text);
  if (m) return { beginn: `${m[1]}-01-01`, ende: `${m[1]}-12-31`, art: "jahr" };
  m = /^(\d{4})-Q([1-4])$/.exec(text);
  if (m) {
    const erster = (Number(m[2]) - 1) * 3 + 1;
    return { beginn: `${m[1]}-${zweistellig(erster)}-01`, ende: `${m[1]}-${zweistellig(erster + 2)}-${tageImMonat(Number(m[1]), erster + 2)}`, art: "quartal" };
  }
  m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(text);
  if (m) return { beginn: `${m[1]}-${m[2]}-01`, ende: `${m[1]}-${m[2]}-${tageImMonat(Number(m[1]), Number(m[2]))}`, art: "monat" };
  return null;
}
