import type { Sprache } from "./texte";

const LOCALE: Record<Sprache, string> = { de: "de-DE", en: "en-GB" };
const NBSP = " ";

function zahl(wert: number, nachkomma: number, sprache: Sprache): string {
  return new Intl.NumberFormat(LOCALE[sprache], {
    minimumFractionDigits: nachkomma,
    maximumFractionDigits: nachkomma,
  }).format(wert);
}

/** Zeichen einer Währung in der Schreibweise der Sprache (`€`, `$`, `£`; ohne eigenes Zeichen der Code, z. B. `CHF`). */
export function waehrungszeichen(waehrung: string, sprache: Sprache = "de"): string {
  const teile = new Intl.NumberFormat(LOCALE[sprache], { style: "currency", currency: waehrung, currencyDisplay: "narrowSymbol" }).formatToParts(0);
  return teile.find((t) => t.type === "currency")?.value ?? waehrung;
}

/**
 * Betrag in einer Währung (Standard Euro): de `12.400.000 €`, en `€12,400,000`. Kompakt: `12,4 Mio. €` bzw. `€12.4m`. Die Währung ist immer ausdrücklich:
 * Beträge in lokaler oder Vergleichswährung tragen ihr eigenes Zeichen und werden nie als Euro gezeigt.
 */
export function formatBetrag(
  wert: number | string,
  sprache: Sprache = "de",
  optionen: { kompakt?: boolean; waehrung?: string } = {},
): string {
  const n = Number(wert);
  const waehrung = optionen.waehrung ?? "EUR";
  if (optionen.kompakt && Math.abs(n) >= 1_000_000) {
    const mio = zahl(n / 1_000_000, 1, sprache);
    const zeichen = waehrung === "EUR" ? "€" : waehrungszeichen(waehrung, sprache);
    return sprache === "de" ? `${mio} Mio.${NBSP}${zeichen}` : `${zeichen}${mio}m`;
  }
  return new Intl.NumberFormat(LOCALE[sprache], {
    style: "currency",
    currency: waehrung,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

/** Vielfaches mit zwei Nachkommastellen: `1,42x` bzw. `1.42x`. */
export function formatMultiple(wert: number | string, sprache: Sprache = "de"): string {
  return `${zahl(Number(wert), 2, sprache)}x`;
}

/** Prozent, Eingabe in Prozent (8.4 ergibt `8,4 %` bzw. `8.4%`). */
export function formatProzent(wert: number | string, sprache: Sprache = "de", nachkomma = 1): string {
  const text = zahl(Number(wert), nachkomma, sprache);
  return sprache === "de" ? `${text}${NBSP}%` : `${text}%`;
}

/**
 * Datum: de `30.09.2026`, en `30/09/2026`. Zeichenketten `JJJJ-MM-TT` werden ohne
 * Zeitzonenumrechnung gelesen; ein Date wird in Ortszeit gelesen.
 */
export function formatDatum(datum: string | Date, sprache: Sprache = "de"): string {
  let j: string, m: string, t: string;
  if (typeof datum === "string") {
    const treffer = /^(\d{4})-(\d{2})-(\d{2})/.exec(datum);
    if (!treffer) throw new RangeError(`Ungültiges Datum: ${datum}`);
    [, j, m, t] = treffer as unknown as [string, string, string, string];
  } else {
    j = String(datum.getFullYear()).padStart(4, "0");
    m = String(datum.getMonth() + 1).padStart(2, "0");
    t = String(datum.getDate()).padStart(2, "0");
  }
  return sprache === "de" ? `${t}.${m}.${j}` : `${t}/${m}/${j}`;
}
