import { Decimal } from "./decimal.js";
import { istSchaltjahr, tageZwischen, vergleiche, zerlege, type Datum } from "./datum.js";

/**
 * Zinsmethoden (Day-Count-Konventionen).
 *
 * - `30E/360`: deutsche kaufmännische Zinsmethode (Eurobond-Basis). Jeder Monat hat 30 Tage, der 31. zählt als 30.
 *   Das Monatsende im Februar wird nicht angepasst.
 * - `act/360`: tatsächliche Tage durch 360.
 * - `act/365`: tatsächliche Tage durch 365 (fest, auch im Schaltjahr).
 * - `act/act`: ISDA-Variante, die Tage jedes Kalenderjahres durch dessen Länge (365 oder 366).
 */
export const ZINSMETHODEN = ["30E/360", "act/360", "act/365", "act/act"] as const;
export type Zinsmethode = (typeof ZINSMETHODEN)[number];

export interface Zeitanteil {
  /** Anteil des Jahres als exakte Dezimalzahl. */
  anteil: Decimal;
  /** Zinstage nach der Methode (bei `act/act` die tatsächlichen Tage). */
  tage: number;
  /** Lesbare Herleitung, z. B. „180 / 360“. */
  formel: string;
}

function tage30E(von: Datum, bis: Datum): number {
  const a = zerlege(von);
  const b = zerlege(bis);
  const t1 = Math.min(a.tag, 30);
  const t2 = Math.min(b.tag, 30);
  return (b.jahr - a.jahr) * 360 + (b.monat - a.monat) * 30 + (t2 - t1);
}

/** Jahresanteil zwischen zwei Daten (`von` einschließlich, `bis` ausschließlich). */
export function zeitanteil(von: Datum, bis: Datum, methode: Zinsmethode): Zeitanteil {
  if (vergleiche(bis, von) < 0) throw new Error(`Enddatum ${bis} liegt vor dem Beginn ${von}`);

  switch (methode) {
    case "30E/360": {
      const tage = tage30E(von, bis);
      return { anteil: new Decimal(tage).div(360), tage, formel: `${tage} / 360` };
    }
    case "act/360": {
      const tage = tageZwischen(von, bis);
      return { anteil: new Decimal(tage).div(360), tage, formel: `${tage} / 360` };
    }
    case "act/365": {
      const tage = tageZwischen(von, bis);
      return { anteil: new Decimal(tage).div(365), tage, formel: `${tage} / 365` };
    }
    case "act/act": {
      const teile: string[] = [];
      let anteil = new Decimal(0);
      let laufend = von;
      const ende = zerlege(bis);
      while (vergleiche(laufend, bis) < 0) {
        const jahr = zerlege(laufend).jahr;
        const jahresende = jahr < ende.jahr ? `${jahr + 1}-01-01` : bis;
        const tage = tageZwischen(laufend, jahresende);
        const laenge = istSchaltjahr(jahr) ? 366 : 365;
        anteil = anteil.plus(new Decimal(tage).div(laenge));
        teile.push(`${tage} / ${laenge}`);
        laufend = jahresende;
      }
      return { anteil, tage: tageZwischen(von, bis), formel: teile.length ? teile.join(" + ") : "0" };
    }
  }
}
