/**
 * Kalenderdaten ohne Uhrzeit und ohne Zeitzone, als ISO-Zeichenkette `JJJJ-MM-TT`.
 * Gerechnet wird über UTC, damit Sommerzeit keine Tage verschiebt.
 */
export type Datum = string;

const ISO_DATUM = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface DatumTeile {
  jahr: number;
  monat: number;
  tag: number;
}

export function zerlege(datum: Datum): DatumTeile {
  const treffer = ISO_DATUM.exec(datum);
  if (!treffer) throw new Error(`Kein gültiges Datum: ${datum}`);
  const jahr = Number(treffer[1]);
  const monat = Number(treffer[2]);
  const tag = Number(treffer[3]);
  const probe = new Date(Date.UTC(jahr, monat - 1, tag));
  if (probe.getUTCFullYear() !== jahr || probe.getUTCMonth() !== monat - 1 || probe.getUTCDate() !== tag) {
    throw new Error(`Kein gültiges Datum: ${datum}`);
  }
  return { jahr, monat, tag };
}

function tagesnummer(datum: Datum): number {
  const { jahr, monat, tag } = zerlege(datum);
  return Date.UTC(jahr, monat - 1, tag) / 86_400_000;
}

/** Tatsächliche Tage von `von` (einschließlich) bis `bis` (ausschließlich). */
export function tageZwischen(von: Datum, bis: Datum): number {
  return tagesnummer(bis) - tagesnummer(von);
}

export function istSchaltjahr(jahr: number): boolean {
  return (jahr % 4 === 0 && jahr % 100 !== 0) || jahr % 400 === 0;
}

export function vergleiche(a: Datum, b: Datum): number {
  return tagesnummer(a) - tagesnummer(b);
}
