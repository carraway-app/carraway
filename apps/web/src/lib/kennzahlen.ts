import type { Sprache } from "@carraway/ui";
import type { Texte } from "../i18n";

/** Hilfen für Kennzahlen der Unternehmen: Zeiträume, Anzeige von Werten. */

export type Periodenart = "monat" | "quartal" | "jahr";
export const PERIODENARTEN: readonly Periodenart[] = ["monat", "quartal", "jahr"];

const LOCALE: Record<Sprache, string> = { de: "de-DE", en: "en-GB" };
const zwei = (n: number) => String(n).padStart(2, "0");
const tageImMonat = (jahr: number, monat: number) => new Date(Date.UTC(jahr, monat, 0)).getUTCDate();

/** Beginn und Ende des Zeitraums aus Art, Jahr und Nummer (Monat 1–12, Quartal 1–4, bei Jahr ohne Bedeutung). */
export function zeitraum(art: Periodenart, jahr: number, nummer: number): { beginn: string; ende: string; kurz: string } {
  if (art === "jahr") return { beginn: `${jahr}-01-01`, ende: `${jahr}-12-31`, kurz: `${jahr}` };
  if (art === "quartal") {
    const erster = (nummer - 1) * 3 + 1;
    return { beginn: `${jahr}-${zwei(erster)}-01`, ende: `${jahr}-${zwei(erster + 2)}-${tageImMonat(jahr, erster + 2)}`, kurz: `${jahr}-Q${nummer}` };
  }
  return { beginn: `${jahr}-${zwei(nummer)}-01`, ende: `${jahr}-${zwei(nummer)}-${tageImMonat(jahr, nummer)}`, kurz: `${jahr}-${zwei(nummer)}` };
}

/** Das laufende Kalenderquartal als Voreinstellung. */
export function aktuellesQuartal(heute = new Date()): { jahr: number; nummer: number } {
  return { jahr: heute.getFullYear(), nummer: Math.floor(heute.getMonth() / 3) + 1 };
}

/** Kurzform eines Zeitraums: `2026`, `Q3 2026` oder `07/2026`. */
export function periodeKurz(beginn: string, ende: string): string {
  const monate = Number(ende.slice(5, 7)) - Number(beginn.slice(5, 7)) + 1;
  if (monate === 12) return beginn.slice(0, 4);
  if (monate === 3) return `Q${Math.floor((Number(beginn.slice(5, 7)) - 1) / 3) + 1} ${beginn.slice(0, 4)}`;
  return `${beginn.slice(5, 7)}/${beginn.slice(0, 4)}`;
}

const STUFE: Record<Periodenart, number> = { monat: 1, quartal: 2, jahr: 3 };

/** Ein Zeitraum darf nur erfragt werden, wenn die Kennzahl höchstens so fein erhoben wird (wie in der API: Monat ≤ Quartal ≤ Jahr). */
export const passtZeitraum = (art: Periodenart, periodizitaet: string): boolean => STUFE[art] >= (STUFE[periodizitaet as Periodenart] ?? 3);

const waehrung = (einheit: string) => (/^[A-Z]{3}$/.test(einheit) ? einheit : "EUR");

/** Wert nach Typ und Einheit für die Anzeige. */
export function formatKennzahlWert(typ: string, wert: string, einheit: string, sprache: Sprache, t: Texte): string {
  if (typ === "ja_nein") return wert === "ja" ? t.kennzahlen.jaNein.ja : t.kennzahlen.jaNein.nein;
  if (typ === "text") return wert;
  if (typ === "betrag") return new Intl.NumberFormat(LOCALE[sprache], { style: "currency", currency: waehrung(einheit), minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(wert));
  const zahl = new Intl.NumberFormat(LOCALE[sprache], { maximumFractionDigits: 4 }).format(Number(wert));
  if (typ === "prozent") return sprache === "de" ? `${zahl} %` : `${zahl}%`;
  return einheit && einheit !== "Anzahl" ? `${zahl} ${einheit}` : zahl;
}

/** Abweichung mit Vorzeichen: absolut in der Einheit des Wertes (Prozent-Kennzahlen in Prozentpunkten), relativ in Prozent. */
export function formatAbweichung(typ: string, einheit: string, absolut: string, prozent: string | null, sprache: Sprache, t: Texte): string {
  const vorzeichen = Number(absolut) > 0 ? "+" : "";
  const abs = typ === "prozent" ? `${new Intl.NumberFormat(LOCALE[sprache], { maximumFractionDigits: 4 }).format(Number(absolut))} ${sprache === "de" ? "Pkt." : "pp"}` : formatKennzahlWert(typ, absolut, einheit, sprache, t);
  const rel = prozent === null ? null : `${Number(prozent) > 0 ? "+" : ""}${new Intl.NumberFormat(LOCALE[sprache], { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Number(prozent))}${sprache === "de" ? " %" : "%"}`;
  return t.kennzahlen.abweichung(`${vorzeichen}${abs}`, rel);
}

/** Kurzform für Tabellenzellen: die relative Abweichung, ohne sie die absolute (die Langform steht im Titel und für Screenreader). */
export function formatAbweichungKurz(typ: string, einheit: string, absolut: string, prozent: string | null, sprache: Sprache, t: Texte): string {
  if (prozent !== null) return `${Number(prozent) > 0 ? "+" : ""}${new Intl.NumberFormat(LOCALE[sprache], { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Number(prozent))}${sprache === "de" ? " %" : "%"}`;
  const vorzeichen = Number(absolut) > 0 ? "+" : "";
  return typ === "prozent" ? `${vorzeichen}${new Intl.NumberFormat(LOCALE[sprache], { maximumFractionDigits: 4 }).format(Number(absolut))} ${sprache === "de" ? "Pkt." : "pp"}` : `${vorzeichen}${formatKennzahlWert(typ, absolut, einheit, sprache, t)}`;
}

/** Relative Abweichung ab dieser Höhe (Prozent, Betrag) wird hervorgehoben. */
export const ABWEICHUNG_SCHWELLE = 10;

/** Kurzform der Kennzahlenbezeichnung in der Sprache der Oberfläche. */
export const kennzahlName = (k: { bezeichnungDe: string; bezeichnungEn: string }, sprache: Sprache) => (sprache === "de" ? k.bezeichnungDe : k.bezeichnungEn);
