import { Decimal } from "./decimal.js";
import type { MitHerkunft, Rechenschritt } from "./herkunft.js";
import { verteileAnteilig } from "./verteilung.js";
import { aufCent } from "./zins.js";

/**
 * Buchwert einer Beteiligung (Entscheidung 62):
 *
 *   Buchwert = Investiert + Kapitalisierte Zinsen − Tilgungen − Wertberichtigungen (netto) − Buchwertabgang durch Verkäufe
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
      { zeichen: "−", bezeichnung: "Buchwertabgang durch Verkäufe", wert: abgang.toString() },
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

export interface BuchwertabgangAnteil {
  id: string;
  abgang: Decimal;
}

/**
 * Verteilung des Buchwertabgangs eines Verkaufs der ganzen Beteiligung auf ihre Instrumente: anteilig nach dem Buchwert je Instrument unmittelbar
 * vor dem Verkauf (Instrumente mit Buchwert null oder darunter bekommen nichts), auf den Cent nach der Methode des größten Rests (`verteileAnteilig`).
 * Die Summe der Teile ist genau der Abgang; beim Verkauf der ganzen Beteiligung (Abgang = Summe der Buchwerte) bekommt jedes Instrument genau
 * seinen Buchwert. Gibt es keinen positiven Buchwert, bleibt der Abgang unverteilt (alle Teile null, Schritt „nicht verteilbar“).
 */
export function verteileBuchwertabgang(abgang: Decimal.Value, instrumente: readonly { id: string; buchwert: Decimal.Value }[]): MitHerkunft<BuchwertabgangAnteil[]> {
  const gesamt = new Decimal(abgang);
  const gewichte = instrumente.map((i) => Decimal.max(0, new Decimal(i.buchwert)));
  const summe = gewichte.reduce((s, g) => s.plus(g), new Decimal(0));
  const schritte: Rechenschritt[] = [{ zeichen: "", bezeichnung: "Buchwertabgang des Verkaufs der ganzen Beteiligung", wert: gesamt.toString() }];
  instrumente.forEach((i, k) => schritte.push({ zeichen: "", bezeichnung: "Buchwert des Instruments vor dem Verkauf (null, wenn nicht positiv)", wert: (gewichte[k] as Decimal).toString(), quellen: [i.id] }));
  if (gesamt.isZero() || !summe.greaterThan(0)) {
    if (!gesamt.isZero()) schritte.push({ zeichen: "", bezeichnung: "Nicht verteilbar (kein Instrument mit positivem Buchwert)", wert: gesamt.toString() });
    return { wert: instrumente.map((i) => ({ id: i.id, abgang: new Decimal(0) })), schritte };
  }
  const teile = verteileAnteilig(gesamt, gewichte);
  instrumente.forEach((i, k) => schritte.push({ zeichen: "=", bezeichnung: `Anteiliger Abgang des Instruments (Abgang × Buchwert ÷ ${summe.toString()}, auf Cent nach größtem Rest)`, wert: (teile[k] as Decimal).toString(), quellen: [i.id] }));
  return { wert: instrumente.map((i, k) => ({ id: i.id, abgang: teile[k] as Decimal })), schritte };
}
