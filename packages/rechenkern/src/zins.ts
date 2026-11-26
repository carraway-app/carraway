import { Decimal } from "./decimal.js";
import type { Datum } from "./datum.js";
import type { MitHerkunft } from "./herkunft.js";
import { zeitanteil, type Zinsmethode } from "./zinsmethoden.js";

export interface Zinsperiode {
  kapital: Decimal.Value;
  /** Jahreszins als Dezimalzahl, z. B. 0.085 für 8,5 %. */
  satz: Decimal.Value;
  von: Datum;
  bis: Datum;
  methode: Zinsmethode;
}

/** Zinsbetrag einer Periode, ungerundet, mit Rechenweg. Gerundet wird erst bei der Buchung. */
export function zinsbetrag(periode: Zinsperiode): MitHerkunft<Decimal> {
  const kapital = new Decimal(periode.kapital);
  const satz = new Decimal(periode.satz);
  if (kapital.isNegative()) throw new Error("Kapital darf nicht negativ sein");

  const zeit = zeitanteil(periode.von, periode.bis, periode.methode);
  const betrag = kapital.times(satz).times(zeit.anteil);

  return {
    wert: betrag,
    schritte: [
      { zeichen: "", bezeichnung: "Kapital", wert: kapital.toString() },
      { zeichen: "×", bezeichnung: "Zinssatz p. a.", wert: satz.toString() },
      {
        zeichen: "×",
        bezeichnung: `Zeitanteil ${periode.methode} (${periode.von} bis ${periode.bis}: ${zeit.formel})`,
        wert: zeit.anteil.toString(),
      },
      { zeichen: "=", bezeichnung: "Zinsbetrag", wert: betrag.toString() },
    ],
  };
}

/** Kaufmännisch auf Cent runden (halb auf). */
export function aufCent(betrag: Decimal.Value): Decimal {
  return new Decimal(betrag).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}
