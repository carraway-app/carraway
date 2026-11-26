import { Decimal } from "./decimal.js";

/**
 * Bewertungsszenarien (Etappe 21) als reine Rechnung: je Beteiligung mehrere Fälle (Basis, Bär, Bulle oder eigene) mit Wahrscheinlichkeiten, daraus der
 * Erwartungswert und die Wirkung auf NAV, TVPI, DPI, RVPI und die Carry-Vorschau des Fonds. Die Regeln stehen hier und gleichlautend in
 * `referenz/referenz_bewertungsszenario.py` (unabhängige Rechnung mit Brüchen). Beträge sind in der Fondswährung.
 *
 * - **Methode Multiple auf Kennzahl:** Unternehmenswert = Kennzahl × Multiple − Abzug (nicht unter null); Wert der Beteiligung = Unternehmenswert × Anteil des Fonds.
 *   Steht die Kennzahl in einer anderen Währung als der Fonds (Nacharbeiten 9), gelten Kennzahl und Abzug in der Währung der Kennzahl; der Unternehmenswert wird
 *   mit dem Kurs des Basistags (Faktor als Bruch, kein gerundeter Kehrwert) in die Fondswährung umgerechnet, bevor der Anteil gilt. Gerundet wird nur das Ergebnis.
 *   Fehlt der Kurs (kein Eintrag oder älter als sieben Tage), hat der Fall keinen Wert: eine Lücke, nie ein geschätzter Kurs.
 * - **Methode letzte Runde:** Wert = Preis je Anteil der letzten Runde × Anteile des Fonds × (1 − Abschlag); ein negativer Abschlag ist ein Aufschlag.
 * - **Methode fester Wert:** der Betrag selbst.
 * - **Gewichte** sind Brüche; ihre Summe je Beteiligung muss genau 1 sein (Dezimalrechnung, kein Spielraum). Der **Erwartungswert** ist die gewichtete Summe,
 *   erst am Ende auf Cent gerundet. Jeder Wert wird nur einmal gerundet: am Ende seiner Rechnung.
 * - **Lücke:** Fehlt eine Eingabe (Kennzahl, Runde, Anteil), hat der Fall keinen Wert (`null`). Ein Erwartungswert, in den ein Fall ohne Wert eingeht, hat selbst
 *   keinen Wert, ebenso jede Fondskennzahl, die auf ihm beruht. Es wird nie 0 oder ein Näherungswert eingesetzt.
 * - **Fondswirkung je Fall** (gleicher Fall in allen Beteiligungen, die ihn haben; Beteiligungen ohne diesen Fall behalten ihren aktuellen Wert):
 *   NAV = aktueller NAV − Σ aktuelle Werte der Beteiligungen mit Fällen + Σ Fallwerte. TVPI = (NAV + Ausschüttungen) ÷ Einzahlungen, DPI = Ausschüttungen ÷ Einzahlungen,
 *   RVPI = NAV ÷ Einzahlungen (vier Nachkommastellen, kaufmännisch; ohne Abrufe keine Wert). **Carry-Vorschau** (vereinfacht wie in der Prognose, Gesamtfonds, ohne Hurdle
 *   und Catch-up) = Satz × max(0, Ausschüttungen + NAV − Abrufe), NAV netto = NAV − Carry-Vorschau.
 * - **Erwartet:** wie ein Fall, mit dem Erwartungswert jeder Beteiligung mit Fällen.
 */

export type MethodeEingabe =
  | {
      art: "multiple";
      /** Wert der Kennzahl des Unternehmens; `null` = nicht vorhanden. */
      kennzahlWert: string | null;
      multiple: string;
      abzug: string;
      /** Anteil des Fonds am Unternehmen als Bruch; `null` = nicht bekannt. */
      anteil: string | null;
      /**
       * Umrechnung von der Währung der Kennzahl in die Fondswährung zum Kurs des Basistags: Faktor = `zaehler` ÷ `nenner`. Fehlt die Angabe, haben Kennzahl und Fonds
       * dieselbe Währung; `null` heißt: kein ausreichend aktueller Kurs (Lücke).
       */
      umrechnung?: { zaehler: string; nenner: string } | null;
    }
  | {
      art: "letzte_runde";
      preisJeAnteil: string | null;
      anteile: string | null;
      abschlag: string;
      /** Anteile des Unternehmens nach der letzten Runde (voll verwässert); nur für den Unternehmenswert, aus dem der Exit-Wasserfall rechnet. */
      anteileGesamt?: string | null;
    }
  | { art: "wert"; betrag: string };

/** Wert eines Falls aus seiner Methode; `null`, wenn eine Eingabe fehlt. */
export function bewertungNachMethode(m: MethodeEingabe): Decimal | null {
  if (m.art === "wert") return new Decimal(m.betrag).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  if (m.art === "letzte_runde") {
    if (m.preisJeAnteil === null || m.anteile === null) return null;
    return new Decimal(m.preisJeAnteil).times(m.anteile).times(new Decimal(1).minus(m.abschlag)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  }
  if (m.kennzahlWert === null || m.anteil === null || m.umrechnung === null) return null;
  const unternehmen = Decimal.max(0, new Decimal(m.kennzahlWert).times(m.multiple).minus(m.abzug));
  // Mit Umrechnung erst malnehmen, dann einmal teilen: der Faktor bleibt ein Bruch.
  const wert = m.umrechnung ? unternehmen.times(m.umrechnung.zaehler).times(m.anteil).div(m.umrechnung.nenner) : unternehmen.times(m.anteil);
  return wert.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/**
 * Unternehmenswert eines Falls als Eingabe für den Exit-Wasserfall (Nacharbeiten 9): der Wert des ganzen Unternehmens, nicht der Anteil des Fonds.
 *
 * - **Multiple:** max(0, Kennzahl × Multiple − Abzug), bei Fremdwährung mit dem Faktor des Basistags umgerechnet.
 * - **Letzte Runde:** Preis je Anteil × Anteile des Unternehmens nach der Runde × (1 − Abschlag).
 * - **Fester Wert:** gibt es nicht (der Betrag gilt für den Fonds), `null`.
 *
 * Fehlt eine Eingabe oder der Kurs, ist der Unternehmenswert eine Lücke (`null`). Gerundet wird einmal am Ende auf Cent; den Erlös des Fonds rechnet der Wasserfall.
 */
export function unternehmenswertNachMethode(m: MethodeEingabe): Decimal | null {
  if (m.art === "wert") return null;
  if (m.art === "letzte_runde") {
    if (m.preisJeAnteil === null || m.anteileGesamt === undefined || m.anteileGesamt === null) return null;
    return new Decimal(m.preisJeAnteil).times(m.anteileGesamt).times(new Decimal(1).minus(m.abschlag)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  }
  if (m.kennzahlWert === null || m.umrechnung === null) return null;
  const unternehmen = Decimal.max(0, new Decimal(m.kennzahlWert).times(m.multiple).minus(m.abzug));
  return (m.umrechnung ? unternehmen.times(m.umrechnung.zaehler).div(m.umrechnung.nenner) : unternehmen).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

export interface BwFall {
  schluessel: string;
  /** Wahrscheinlichkeit als Bruch (`0.25`). */
  gewicht: string;
  /** Wert in Fondswährung; `null` = Lücke. */
  wert: string | null;
}

export interface BwBeteiligung {
  id: string;
  /** Aktueller Wert (letzte Bewertung) zum Basistag. */
  aktuell: string;
  faelle: BwFall[];
}

export interface BwEingabe {
  nav: string | null;
  ausschuettungen: string;
  abgerufen: string;
  eingezahlt?: string;
  carrySatz: string;
  beteiligungen: BwBeteiligung[];
}

export interface BwFondsWerte {
  nav: string | null;
  tvpi: string | null;
  dpi: string | null;
  rvpi: string | null;
  carry: string | null;
  navNetto: string | null;
}

export interface BwBeteiligungErgebnis {
  id: string;
  aktuell: string;
  faelle: { schluessel: string; gewicht: string; wert: string | null; abweichung: string | null }[];
  /** Erwartungswert; `null`, wenn ein Fall keinen Wert hat. */
  erwartet: string | null;
  abweichung: string | null;
}

export interface BwErgebnis {
  beteiligungen: BwBeteiligungErgebnis[];
  aktuell: BwFondsWerte;
  faelle: ({ schluessel: string } & BwFondsWerte)[];
  erwartet: BwFondsWerte;
}

export class GewichteFehler extends Error {
  constructor(
    readonly beteiligungId: string,
    readonly summe: string,
  ) {
    super(`Die Gewichte der Beteiligung ${beteiligungId} ergeben ${summe}, erwartet 1`);
  }
}

const cent = (w: Decimal) => w.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const vier = (w: Decimal) => w.toDecimalPlaces(4, Decimal.ROUND_HALF_UP);

function fondsWerte(nav: Decimal | null, e: BwEingabe): BwFondsWerte {
  if (nav === null) return { nav: null, tvpi: null, dpi: null, rvpi: null, carry: null, navNetto: null };
  const aus = new Decimal(e.ausschuettungen);
  const abgerufen = new Decimal(e.abgerufen);
  const carry = cent(new Decimal(e.carrySatz).times(Decimal.max(0, aus.plus(nav).minus(abgerufen))));
  const eingezahlt = new Decimal(e.eingezahlt ?? e.abgerufen);
  const ohneEinzahlungen = eingezahlt.isZero();
  return {
    nav: cent(nav).toFixed(2),
    tvpi: ohneEinzahlungen ? null : vier(nav.plus(aus).div(eingezahlt)).toFixed(4),
    dpi: ohneEinzahlungen ? null : vier(aus.div(eingezahlt)).toFixed(4),
    rvpi: ohneEinzahlungen ? null : vier(nav.div(eingezahlt)).toFixed(4),
    carry: carry.toFixed(2),
    navNetto: cent(nav).minus(carry).toFixed(2),
  };
}

export function bewertungsszenario(e: BwEingabe): BwErgebnis {
  const nav = e.nav === null ? null : new Decimal(e.nav);
  const beteiligungen: BwBeteiligungErgebnis[] = e.beteiligungen.map((b) => {
    if (b.faelle.length > 0) {
      const summe = b.faelle.reduce((s, f) => s.plus(f.gewicht), new Decimal(0));
      if (!summe.equals(1)) throw new GewichteFehler(b.id, summe.toFixed());
    }
    const aktuell = new Decimal(b.aktuell);
    const luecke = b.faelle.some((f) => f.wert === null);
    const erwartet = b.faelle.length === 0 || luecke ? null : cent(b.faelle.reduce((s, f) => s.plus(new Decimal(f.wert!).times(f.gewicht)), new Decimal(0)));
    return {
      id: b.id,
      aktuell: aktuell.toFixed(2),
      faelle: b.faelle.map((f) => ({ schluessel: f.schluessel, gewicht: f.gewicht, wert: f.wert === null ? null : new Decimal(f.wert).toFixed(2), abweichung: f.wert === null ? null : new Decimal(f.wert).minus(aktuell).toFixed(2) })),
      erwartet: erwartet === null ? null : erwartet.toFixed(2),
      abweichung: erwartet === null ? null : erwartet.minus(aktuell).toFixed(2),
    };
  });

  const mitFaellen = e.beteiligungen.filter((b) => b.faelle.length > 0);
  const aktuelleSumme = mitFaellen.reduce((s, b) => s.plus(b.aktuell), new Decimal(0));
  const schluessel = [...new Set(mitFaellen.flatMap((b) => b.faelle.map((f) => f.schluessel)))];
  const faelle = schluessel.map((k) => {
    let summe = new Decimal(0);
    let luecke = false;
    for (const b of mitFaellen) {
      const f = b.faelle.find((x) => x.schluessel === k);
      if (!f) summe = summe.plus(b.aktuell);
      else if (f.wert === null) luecke = true;
      else summe = summe.plus(f.wert);
    }
    return { schluessel: k, ...fondsWerte(luecke || nav === null ? null : nav.minus(aktuelleSumme).plus(summe), e) };
  });
  const erwartungen = beteiligungen.filter((b) => b.faelle.length > 0);
  const navErwartet = nav === null || erwartungen.some((b) => b.erwartet === null) ? null : nav.minus(aktuelleSumme).plus(erwartungen.reduce((s, b) => s.plus(b.erwartet!), new Decimal(0)));
  return { beteiligungen, aktuell: fondsWerte(nav, e), faelle, erwartet: fondsWerte(navErwartet, e) };
}
