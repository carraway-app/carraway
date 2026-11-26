import { Decimal } from "./decimal.js";
import type { MitHerkunft, Rechenschritt } from "./herkunft.js";
import { aufCent } from "./zins.js";

/**
 * Buchwert einer Beteiligung (Entscheidung 62):
 *
 *   Buchwert = Investiert + Kapitalisierte Zinsen − Tilgungen − Wertberichtigungen (netto) − Buchwertabgang früherer Teilverkäufe
 *
 * Investiert ist die Summe der Auszahlungen nach Storno. Wertberichtigungen sind netto: Zuführungen positiv,
 * Auflösungen negativ. Erlöse (Rückflüsse, Verkaufspreise) mindern den Buchwert nicht, sie sind Ergebnis, kein Kapital.
 */
export interface BuchwertEingabe {
  investiert: Decimal.Value;
  kapitalisiert?: Decimal.Value;
  tilgungen?: Decimal.Value;
  wertberichtigungen?: Decimal.Value;
  abgang?: Decimal.Value;
}

export function buchwert(eingabe: BuchwertEingabe): MitHerkunft<Decimal> {
  const investiert = new Decimal(eingabe.investiert);
  const kapitalisiert = new Decimal(eingabe.kapitalisiert ?? 0);
  const tilgungen = new Decimal(eingabe.tilgungen ?? 0);
  const wertberichtigungen = new Decimal(eingabe.wertberichtigungen ?? 0);
  const abgang = new Decimal(eingabe.abgang ?? 0);
  const wert = investiert.plus(kapitalisiert).minus(tilgungen).minus(wertberichtigungen).minus(abgang);
  return {
    wert,
    schritte: [
      { zeichen: "", bezeichnung: "Investiert (Auszahlungen nach Storno)", wert: investiert.toString() },
      { zeichen: "+", bezeichnung: "Kapitalisierte Zinsen", wert: kapitalisiert.toString() },
      { zeichen: "−", bezeichnung: "Tilgungen", wert: tilgungen.toString() },
      { zeichen: "−", bezeichnung: "Wertberichtigungen (netto)", wert: wertberichtigungen.toString() },
      { zeichen: "−", bezeichnung: "Buchwertabgang früherer Teilverkäufe", wert: abgang.toString() },
      { zeichen: "=", bezeichnung: "Buchwert", wert: wert.toString() },
    ],
  };
}

export interface VerkaufEingabe {
  buchwert: Decimal.Value;
  /** Anteil der Beteiligung, der verkauft wird: größer als 0, höchstens 1 (1 = vollständig). */
  anteilVerkauft: Decimal.Value;
  kaufpreis: Decimal.Value;
  kosten?: Decimal.Value;
}

export interface Verkaufsergebnis {
  /** Auf Cent gerundet (kaufmännisch); bei vollständigem Verkauf der ganze Buchwert. */
  buchwertAbgang: Decimal;
  /** Kaufpreis minus Kosten. */
  erloes: Decimal;
  /** Erlös minus Buchwertabgang: positiv = Gewinn, negativ = Verlust. */
  ergebnis: Decimal;
}

/** Ergebnis eines Verkaufs: Erlös gegen den anteiligen Buchwert. */
export function verkaufsergebnis(eingabe: VerkaufEingabe): MitHerkunft<Verkaufsergebnis> {
  const buch = new Decimal(eingabe.buchwert);
  const anteil = new Decimal(eingabe.anteilVerkauft);
  const kaufpreis = new Decimal(eingabe.kaufpreis);
  const kosten = new Decimal(eingabe.kosten ?? 0);
  if (!anteil.greaterThan(0) || anteil.greaterThan(1)) throw new Error("Anteil muss größer als 0 und höchstens 1 sein");
  if (kaufpreis.isNegative()) throw new Error("Kaufpreis darf nicht negativ sein");
  if (kosten.isNegative()) throw new Error("Kosten dürfen nicht negativ sein");

  const abgang = anteil.equals(1) ? buch : aufCent(buch.times(anteil));
  const erloes = kaufpreis.minus(kosten);
  const ergebnis = erloes.minus(abgang);
  const schritte: Rechenschritt[] = [
    { zeichen: "", bezeichnung: "Buchwert vor dem Verkauf", wert: buch.toString() },
    { zeichen: "×", bezeichnung: "Verkaufter Anteil", wert: anteil.toString() },
    { zeichen: "=", bezeichnung: "Buchwertabgang (auf Cent, kaufmännisch)", wert: abgang.toString() },
    { zeichen: "", bezeichnung: "Kaufpreis", wert: kaufpreis.toString() },
    { zeichen: "−", bezeichnung: "Kosten", wert: kosten.toString() },
    { zeichen: "=", bezeichnung: "Erlös", wert: erloes.toString() },
    { zeichen: "−", bezeichnung: "Buchwertabgang", wert: abgang.toString() },
    { zeichen: "=", bezeichnung: "Ergebnis (Gewinn positiv, Verlust negativ)", wert: ergebnis.toString() },
  ];
  return { wert: { buchwertAbgang: abgang, erloes, ergebnis }, schritte };
}
