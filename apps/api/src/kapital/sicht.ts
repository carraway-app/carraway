/**
 * Standard-Sicht der Kapitaltabelle je Installation (ein Stack je Kunde, damit je Mandant): `voll_verwaessert` (Vorgabe, empfohlen) oder
 * `unverwaessert`, aus `KAPITAL_SICHT`. Sie bestimmt, auf welcher Basis Kapitaltabelle, Anteil des Fonds und abgeleitete Bewertungen
 * zuerst erscheinen; beide Sichten bleiben überall abrufbar und sind gekennzeichnet.
 */

export const SICHTEN = ["unverwaessert", "voll_verwaessert"] as const;
export type Sicht = (typeof SICHTEN)[number];

export const STANDARD_SICHT: Sicht = "voll_verwaessert";

/** Liest `KAPITAL_SICHT`; leer = voll verwässert. Wirft bei einem unbekannten Wert. */
export function ladeKapitalSicht(env: Record<string, string | undefined>): Sicht {
  const roh = env.KAPITAL_SICHT?.trim();
  if (!roh) return STANDARD_SICHT;
  if (!(SICHTEN as readonly string[]).includes(roh)) throw new Error(`KAPITAL_SICHT "${roh}" ungültig (unverwaessert oder voll_verwaessert).`);
  return roh as Sicht;
}

let standard: Sicht = STANDARD_SICHT;

/** Setzt die Standard-Sicht (beim Start der Anwendung aus der Konfiguration). */
export function setzeStandardSicht(sicht: Sicht) {
  standard = sicht;
}

export function standardSicht(): Sicht {
  return standard;
}
