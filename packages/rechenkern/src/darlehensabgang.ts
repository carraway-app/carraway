import { Decimal } from "./decimal.js";
import type { MitHerkunft, Rechenschritt } from "./herkunft.js";
import { aufCent } from "./zins.js";

export function kapitalAnErwerber(kapital: Decimal, anteil: string, instrumentId: string): MitHerkunft<Decimal> {
  const wert = aufCent(kapital.times(anteil));
  return { wert, schritte: [{ zeichen: "=", bezeichnung: `Kapitalabgang an Erwerber (offenes Kapital ${kapital} × ${anteil})`, wert: wert.toFixed(2), quellen: [instrumentId] }] };
}

/** Die mit abgegebene Berichtigung gleicht Nominal- und Buchwertabgang aus, begrenzt auf den vorhandenen Bestand. */
export function berichtigungBeiVerkauf(nominal: Decimal, buchwertAbgang: Decimal, berichtigung: Decimal) {
  return Decimal.max(0, Decimal.min(berichtigung, nominal.minus(buchwertAbgang)));
}

export interface VerzichtBasis {
  kapital: Decimal;
  buchwert: Decimal;
  wertberichtigung: Decimal;
  gebuchteZinsen: Decimal;
  aufgelaufeneZinsen: { bis: string; betrag: string }[];
}

export function darlehensverzicht(b: VerzichtBasis, kapital: Decimal, zinsen: Decimal) {
  const offeneZinsen = b.aufgelaufeneZinsen.reduce((s, p) => s.plus(p.betrag), b.gebuchteZinsen);
  if (kapital.isNegative() || zinsen.isNegative() || kapital.plus(zinsen).isZero() || kapital.gt(b.kapital) || zinsen.gt(Decimal.max(0, offeneZinsen))) {
    throw new Error("The waiver must be positive and cannot exceed outstanding principal or interest.");
  }
  const berichtigung = Decimal.max(0, Decimal.min(b.wertberichtigung, b.kapital.minus(b.buchwert)));
  const verbrauch = kapital.isZero() ? new Decimal(0) : aufCent(berichtigung.times(kapital).div(b.kapital));
  const gebucht = Decimal.min(zinsen, Decimal.max(0, b.gebuchteZinsen));
  let rest = zinsen.minus(gebucht);
  const aufgelaufen = [];
  for (const p of b.aufgelaufeneZinsen) {
    if (rest.isZero()) break;
    const betrag = Decimal.min(rest, p.betrag);
    if (!betrag.gt(0)) continue;
    aufgelaufen.push({ bis: p.bis, betrag });
    rest = rest.minus(betrag);
  }
  const restkapital = b.kapital.minus(kapital);
  const restbuchwert = b.buchwert.minus(kapital).plus(verbrauch);
  const verlust = kapital.plus(zinsen).minus(verbrauch);
  const schritte: Rechenschritt[] = [
    { zeichen: "", bezeichnung: "Offenes Kapital vor Verzicht", wert: b.kapital.toFixed(2) },
    { zeichen: "−", bezeichnung: "Verzicht auf Kapital", wert: kapital.toFixed(2) },
    { zeichen: "=", bezeichnung: "Verbleibendes Kapital", wert: restkapital.toFixed(2) },
    { zeichen: "", bezeichnung: "Verzicht auf Kapital und Zinsen", wert: kapital.plus(zinsen).toFixed(2) },
    { zeichen: "−", bezeichnung: kapital.gt(0) ? `Verbrauchte Wertberichtigung (${berichtigung} × ${kapital} / ${b.kapital})` : "Kein Kapitalverzicht", wert: verbrauch.toFixed(2) },
    { zeichen: "=", bezeichnung: "Verlust aus dem Verzicht", wert: verlust.toFixed(2) },
  ];
  return { restkapital, restbuchwert, gebucht, aufgelaufen, verbrauch, verlust, schritte };
}
