import { Decimal } from "./decimal.js";
import type { MitHerkunft } from "./herkunft.js";

export interface Fondswerte {
  /** Tatsächlich eingezahltes Kapital (paid-in). */
  eingezahlt: Decimal.Value;
  /** Kumulierte Ausschüttungen an die Investoren. */
  ausschuettungen: Decimal.Value;
  /** Nettoinventarwert zum Stichtag (Summe der Bewertungen plus übrige Vermögenswerte). */
  nav: Decimal.Value | null;
}

export interface Multiples {
  tvpi: MitHerkunft<Decimal | null>;
  dpi: MitHerkunft<Decimal | null>;
  rvpi: MitHerkunft<Decimal | null>;
}

function geteilt(zaehler: Decimal, nenner: Decimal): Decimal | null {
  return nenner.isZero() ? null : zaehler.div(nenner);
}

/**
 * TVPI = (NAV + Ausschüttungen) ÷ Eingezahlt, DPI = Ausschüttungen ÷ Eingezahlt, RVPI = NAV ÷ Eingezahlt.
 * Ohne eingezahltes Kapital gibt es keine Multiples (`null`).
 */
export function multiples(werte: Fondswerte): Multiples {
  const eingezahlt = new Decimal(werte.eingezahlt);
  const ausschuettungen = new Decimal(werte.ausschuettungen);
  const nav = werte.nav === null ? null : new Decimal(werte.nav);

  const tvpi = nav === null ? null : geteilt(nav.plus(ausschuettungen), eingezahlt);
  const dpi = geteilt(ausschuettungen, eingezahlt);
  const rvpi = nav === null ? null : geteilt(nav, eingezahlt);
  const text = (wert: Decimal | null) => (wert === null ? "nicht definiert" : wert.toString());

  return {
    tvpi: {
      wert: tvpi,
      schritte: [
        { zeichen: "", bezeichnung: "NAV", wert: text(nav) },
        { zeichen: "+", bezeichnung: "Ausschüttungen kumuliert", wert: ausschuettungen.toString() },
        { zeichen: "÷", bezeichnung: "Eingezahltes Kapital", wert: eingezahlt.toString() },
        { zeichen: "=", bezeichnung: "TVPI", wert: text(tvpi) },
      ],
    },
    dpi: {
      wert: dpi,
      schritte: [
        { zeichen: "", bezeichnung: "Ausschüttungen kumuliert", wert: ausschuettungen.toString() },
        { zeichen: "÷", bezeichnung: "Eingezahltes Kapital", wert: eingezahlt.toString() },
        { zeichen: "=", bezeichnung: "DPI", wert: text(dpi) },
      ],
    },
    rvpi: {
      wert: rvpi,
      schritte: [
        { zeichen: "", bezeichnung: "NAV", wert: text(nav) },
        { zeichen: "÷", bezeichnung: "Eingezahltes Kapital", wert: eingezahlt.toString() },
        { zeichen: "=", bezeichnung: "RVPI", wert: text(rvpi) },
      ],
    },
  };
}

/**
 * Vorgangsarten, die als Rückfluss an den Fonds zählen: Erlös aus Verkauf oder Exit, Tilgung, tatsächlich gezahlte Zinsen und Dividenden.
 * Die Zinsbuchung (`zins`) ist nur eine Forderung und zählt nie; kapitalisierte Zinsen fließen nicht.
 */
export const RUECKFLUSS_ARTEN = ["rueckfluss", "tilgung", "zinszahlung", "dividende"] as const;
export type RueckflussArt = (typeof RUECKFLUSS_ARTEN)[number];
export const istRueckfluss = (art: string): art is RueckflussArt => (RUECKFLUSS_ARTEN as readonly string[]).includes(art);

/** Multiple einer Beteiligung: (Bewertung + Rückflüsse inkl. gezahlter Zinsen und Dividenden) ÷ investiertes Kapital. */
export function beteiligungsMultiple(investiert: Decimal.Value, rueckfluesse: Decimal.Value, bewertung: Decimal.Value): MitHerkunft<Decimal | null> {
  const inv = new Decimal(investiert);
  const rueck = new Decimal(rueckfluesse);
  const bew = new Decimal(bewertung);
  const wert = geteilt(bew.plus(rueck), inv);
  return {
    wert,
    schritte: [
      { zeichen: "", bezeichnung: "Bewertung zum Stichtag", wert: bew.toString() },
      { zeichen: "+", bezeichnung: "Rückflüsse kumuliert", wert: rueck.toString() },
      { zeichen: "÷", bezeichnung: "Investiertes Kapital", wert: inv.toString() },
      { zeichen: "=", bezeichnung: "Multiple", wert: wert === null ? "nicht definiert" : wert.toString() },
    ],
  };
}
