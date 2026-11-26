import { Decimal } from "./decimal.js";
import { tageZwischen, vergleiche, type Datum } from "./datum.js";

export interface Zahlungsstrom {
  datum: Datum;
  /** Auszahlung an das Unternehmen negativ, Rückfluss an den Fonds positiv. */
  betrag: Decimal.Value;
}

/**
 * Interner Zinsfuß für unregelmäßige Zahlungen (XIRR), Basis act/365.
 *
 * Gerechnet wird mit Gleitkomma, weil der IRR ein Näherungswert ist; Ergebnis auf 10 Stellen.
 * Erst Newton-Verfahren, bei fehlender Konvergenz Intervallhalbierung im Bereich −99 % bis 1000 %.
 * Gibt `null` zurück, wenn es keinen Vorzeichenwechsel gibt (dann existiert kein IRR).
 */
export function xirr(stroeme: Zahlungsstrom[]): Decimal | null {
  if (stroeme.length < 2) return null;
  const sortiert = [...stroeme].sort((a, b) => vergleiche(a.datum, b.datum));
  const start = sortiert[0]!.datum;
  const punkte = sortiert.map((s) => ({ t: tageZwischen(start, s.datum) / 365, c: new Decimal(s.betrag).toNumber() }));

  const hatNegativ = punkte.some((p) => p.c < 0);
  const hatPositiv = punkte.some((p) => p.c > 0);
  if (!hatNegativ || !hatPositiv) return null;

  const kapitalwert = (r: number) => punkte.reduce((summe, p) => summe + p.c / Math.pow(1 + r, p.t), 0);
  const ableitung = (r: number) => punkte.reduce((summe, p) => summe - (p.t * p.c) / Math.pow(1 + r, p.t + 1), 0);

  let r = 0.1;
  for (let i = 0; i < 100; i++) {
    const f = kapitalwert(r);
    const d = ableitung(r);
    if (!Number.isFinite(f) || !Number.isFinite(d) || d === 0) break;
    const neu = r - f / d;
    if (neu <= -0.999999) break;
    if (Math.abs(neu - r) < 1e-12) return new Decimal(neu).toDecimalPlaces(10);
    r = neu;
  }

  let unten = -0.99;
  let oben = 10;
  let fUnten = kapitalwert(unten);
  if (fUnten * kapitalwert(oben) > 0) return null;
  for (let i = 0; i < 300; i++) {
    const mitte = (unten + oben) / 2;
    const fMitte = kapitalwert(mitte);
    if (Math.abs(oben - unten) < 1e-13) break;
    if (fUnten * fMitte <= 0) {
      oben = mitte;
    } else {
      unten = mitte;
      fUnten = fMitte;
    }
  }
  return new Decimal((unten + oben) / 2).toDecimalPlaces(10);
}
