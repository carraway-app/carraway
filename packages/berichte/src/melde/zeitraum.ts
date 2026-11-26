/**
 * Berichtszeitraum eines Meldelaufs aus dem Rhythmus der Definition: Quartal (`2026-Q3`), Halbjahr (`2026-H1`), Jahr (`2026`) oder Stichtag
 * (`2026-09-30`, Beginn und Ende sind derselbe Tag).
 */

export type Rhythmus = "quartal" | "halbjahr" | "jahr" | "stichtag";

export interface MeldeZeitraum {
  beginn: string;
  ende: string;
  kennung: string;
}

const zweistellig = (n: number) => String(n).padStart(2, "0");
const letzterTag = (jahr: number, monat: number) => new Date(Date.UTC(jahr, monat, 0)).getUTCDate();

function gueltigesDatum(text: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

export interface ZeitraumEingabe {
  jahr?: number | undefined;
  nummer?: number | undefined;
  stichtag?: string | undefined;
}

/** Zeitraum zu Rhythmus und Angaben; `null`, wenn die Angaben nicht zum Rhythmus passen. */
export function meldeZeitraum(rhythmus: Rhythmus, e: ZeitraumEingabe): MeldeZeitraum | null {
  if (rhythmus === "stichtag") {
    if (!e.stichtag || !gueltigesDatum(e.stichtag)) return null;
    return { beginn: e.stichtag, ende: e.stichtag, kennung: e.stichtag };
  }
  if (e.jahr === undefined || !Number.isInteger(e.jahr) || e.jahr < 1990 || e.jahr > 2200) return null;
  const jahr = e.jahr;
  if (rhythmus === "jahr") return e.nummer !== undefined ? null : { beginn: `${jahr}-01-01`, ende: `${jahr}-12-31`, kennung: String(jahr) };
  const teile = rhythmus === "quartal" ? 4 : 2;
  const laenge = 12 / teile;
  if (e.nummer === undefined || !Number.isInteger(e.nummer) || e.nummer < 1 || e.nummer > teile) return null;
  const ersterMonat = (e.nummer - 1) * laenge + 1;
  const letzterMonat = ersterMonat + laenge - 1;
  return {
    beginn: `${jahr}-${zweistellig(ersterMonat)}-01`,
    ende: `${jahr}-${zweistellig(letzterMonat)}-${letzterTag(jahr, letzterMonat)}`,
    kennung: `${jahr}-${rhythmus === "quartal" ? "Q" : "H"}${e.nummer}`,
  };
}

/** Der zuletzt abgeschlossene Zeitraum des Rhythmus zu einem Datum (für Vorschläge und die Demo); beim Stichtag der Vortag des Monatsletzten davor. */
export function letzterAbgeschlossenerZeitraum(rhythmus: Exclude<Rhythmus, "stichtag">, heute: string): MeldeZeitraum {
  const jahr = Number(heute.slice(0, 4));
  const monat = Number(heute.slice(5, 7));
  if (rhythmus === "jahr") return meldeZeitraum("jahr", { jahr: jahr - 1 })!;
  const laenge = rhythmus === "quartal" ? 3 : 6;
  const aktuell = Math.floor((monat - 1) / laenge); // 0-basierter Index des laufenden Zeitraums
  const teile = 12 / laenge;
  if (aktuell === 0) return meldeZeitraum(rhythmus, { jahr: jahr - 1, nummer: teile })!;
  return meldeZeitraum(rhythmus, { jahr, nummer: aktuell })!;
}
