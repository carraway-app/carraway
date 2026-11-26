import type { Sprache } from "./typen";

const LOCALE: Record<Sprache, string> = { de: "de-DE", en: "en-GB" };

/**
 * Betrag mit zwei Nachkommastellen in der Währung des Fonds; Zeichenketten gehen unverändert in die Formatierung.
 * Mit der Einheit `TEUR` wird durch tausend geteilt und ohne Nachkommastellen mit dem Zusatz „TEUR“ gesetzt (Steuerungslisten).
 */
export function formatBetrag(wert: string | null, sprache: Sprache, waehrung = "EUR", einheit: "EUR" | "TEUR" = "EUR"): string {
  if (wert === null) return "–";
  if (einheit === "TEUR") return `${new Intl.NumberFormat(LOCALE[sprache], { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Number(wert) / 1000)} T${waehrung}`;
  return new Intl.NumberFormat(LOCALE[sprache], { style: "currency", currency: waehrung, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(wert as unknown as number);
}

/** Multiple wie „1,42x“. */
export function formatMultiple(wert: string | null, sprache: Sprache): string {
  if (wert === null) return "–";
  return `${new Intl.NumberFormat(LOCALE[sprache], { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(wert as unknown as number)}x`;
}

/**
 * Anteil (0,12) in Prozent mit einer Nachkommastelle. Deutsch mit Leerzeichen vor dem Zeichen (`4,8 %`), Englisch ohne (`4.8%`).
 */
export function formatProzent(anteil: string | null, sprache: Sprache): string {
  if (anteil === null) return "–";
  const zahl = new Intl.NumberFormat(LOCALE[sprache], { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Number(anteil) * 100);
  return sprache === "de" ? `${zahl} %` : `${zahl}%`;
}

export function formatZahl(wert: string, sprache: Sprache): string {
  return new Intl.NumberFormat(LOCALE[sprache], { maximumFractionDigits: 4 }).format(wert as unknown as number);
}

/** `2026-03-31` als `31.03.2026` (de) oder `31/03/2026` (en). */
export function formatDatum(iso: string, sprache: Sprache): string {
  const [j, m, t] = iso.slice(0, 10).split("-");
  return sprache === "de" ? `${t}.${m}.${j}` : `${t}/${m}/${j}`;
}

/** Zeitstempel in Berliner Ortszeit, z. B. `20.11.2026, 14:41 MEZ`. */
export function formatZeitpunkt(iso: string, sprache: Sprache): string {
  return new Intl.DateTimeFormat(LOCALE[sprache], { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" }).format(new Date(iso));
}

/** Quartalsbezeichnung wie `Q3 2025` zu einem Datum. */
export function quartal(iso: string): string {
  return `Q${Math.floor((Number(iso.slice(5, 7)) - 1) / 3) + 1} ${iso.slice(0, 4)}`;
}

/** Erster Tag des Quartals, in dem `iso` liegt. */
export function quartalsbeginn(iso: string): string {
  const monat = Math.floor((Number(iso.slice(5, 7)) - 1) / 3) * 3 + 1;
  return `${iso.slice(0, 4)}-${String(monat).padStart(2, "0")}-01`;
}
