import { formatBetrag, formatDatum, formatProzent, formatZeitpunkt } from "./format";
import { TEXTE } from "./texte";
import type { Sprache } from "./typen";
import { literal, setzePdf, type TypstWert } from "./typst";
import { MIT_GRUNDLAGE } from "./vorlagen";

/**
 * Mitteilung an einen Investor zu einem Kapitalabruf oder einer Ausschüttung (eine Seite, PDF, Deutsch oder Englisch).
 * Die Beträge sind die auf den Cent verteilten Anteile des Investors (größter Rest wie im LP-Bericht); dazu der Stand der Zusage,
 * der Abrufe und der Ausschüttungen bis einschließlich dieser Bewegung. Bankverbindung und Verwendungszweck sind Platzhalter, die der
 * Fonds vor dem Versand ergänzt.
 */

export interface MitteilungsDaten {
  fonds: { name: string; kurzname: string; waehrung: string };
  investor: string;
  art: "abruf" | "ausschuettung";
  /** Fälligkeit (Abruf) oder Valuta (Ausschüttung) als `JJJJ-MM-TT`. */
  valuta: string;
  /** Anteil des Investors an der Bewegung. */
  betrag: string;
  /** Betrag der ganzen Bewegung im Fonds. */
  fondsBetrag: string;
  /** Anteil des Investors am Fonds (0,35 = 35 %). */
  anteil: string;
  /** Verwendungszweck, vom System vorgeschlagen; die Bankverbindung bleibt ein Platzhalter. */
  referenz: string;
  /** Zeitpunkt der Freigabe (ISO). */
  erstelltAm: string;
  /** Stand bis einschließlich dieser Bewegung. */
  summen: { zusage: string; abgerufen: string; ausgeschuettet: string; offeneZusage: string };
}

const TEXT = {
  de: {
    titel: { abruf: "Mitteilung zum Kapitalabruf", ausschuettung: "Mitteilung zur Ausschüttung" },
    kopf: { abruf: "Kapitalabruf", ausschuettung: "Ausschüttung" },
    fonds: "Fonds",
    investor: "Investor",
    anteilBetrag: { abruf: "Ihr Abrufbetrag", ausschuettung: "Ihr Ausschüttungsbetrag" },
    frist: { abruf: "Fällig am", ausschuettung: "Valuta" },
    valutaKurz: { abruf: "Fälligkeit", ausschuettung: "Valuta" },
    angaben: "Angaben",
    wert: "Wert",
    fondsBetrag: { abruf: "Abrufbetrag des Fonds", ausschuettung: "Ausschüttungsbetrag des Fonds" },
    anteilAmFonds: "Ihr Anteil am Fonds",
    ihrBetrag: { abruf: "Ihr Anteil am Abruf", ausschuettung: "Ihr Anteil an der Ausschüttung" },
    verwendungszweck: "Verwendungszweck",
    bankverbindung: "Bankverbindung",
    bankPlatzhalter: "[Bankverbindung des Fonds, wird vor dem Versand ergänzt]",
    stand: "Stand nach dieser Mitteilung",
    zusage: "Zusage",
    abgerufen: "Abrufe bis dahin",
    ausgeschuettet: "Ausschüttungen bis dahin",
    offeneZusage: "Offene Zusage",
    hinweisAbruf: "Der Betrag ist bis zum genannten Datum auf die angegebene Bankverbindung zu überweisen.",
    hinweisAusschuettung: "Der Betrag wird zum genannten Datum an die hinterlegte Bankverbindung des Investors überwiesen.",
    hinweisVerteilung: "Die Beträge sind nach der Zusage anteilig auf alle Investoren des Fonds verteilt und auf den Cent gerundet; die Summe aller Anteile ergibt den Betrag des Fonds.",
    maschinell: "Diese Mitteilung wurde maschinell erstellt.",
  },
  en: {
    titel: { abruf: "Capital call notice", ausschuettung: "Distribution notice" },
    kopf: { abruf: "Capital call", ausschuettung: "Distribution" },
    fonds: "Fund",
    investor: "Investor",
    anteilBetrag: { abruf: "Your call amount", ausschuettung: "Your distribution amount" },
    frist: { abruf: "Due on", ausschuettung: "Value date" },
    valutaKurz: { abruf: "Due date", ausschuettung: "Value date" },
    angaben: "Details",
    wert: "Value",
    fondsBetrag: { abruf: "Call amount of the fund", ausschuettung: "Distribution amount of the fund" },
    anteilAmFonds: "Your share of the fund",
    ihrBetrag: { abruf: "Your share of the call", ausschuettung: "Your share of the distribution" },
    verwendungszweck: "Payment reference",
    bankverbindung: "Bank details",
    bankPlatzhalter: "[Bank details of the fund, to be added before dispatch]",
    stand: "Position after this notice",
    zusage: "Commitment",
    abgerufen: "Called to date",
    ausgeschuettet: "Distributed to date",
    offeneZusage: "Unfunded commitment",
    hinweisAbruf: "The amount is to be transferred to the stated bank account by the date shown.",
    hinweisAusschuettung: "The amount is transferred to the investor's bank account on file on the date shown.",
    hinweisVerteilung: "Amounts are allocated pro rata to commitments across all investors of the fund and rounded to the cent; the shares of all investors add up to the amount of the fund.",
    maschinell: "This notice was generated automatically.",
  },
} as const;

const SCHRIFT = {
  de: { wasserzeichen: TEXTE.de.wasserzeichen, freigegeben: TEXTE.de.freigegeben, seite: TEXTE.de.seite, von: TEXTE.de.von, wissensstand: TEXTE.de.wissensstand },
  en: { wasserzeichen: TEXTE.en.wasserzeichen, freigegeben: TEXTE.en.freigegeben, seite: TEXTE.en.seite, von: TEXTE.en.von, wissensstand: TEXTE.en.wissensstand },
} as const;

const SEITE = String.raw`
#v(1 * u)
#beschriftung(data.m.kopfZeile)
#v(0.5 * u)
#text(font: anzeige, weight: 700, size: 24pt, tracking: -0.02em)[#data.titel]
#v(0.5 * u)
#text(size: 11pt, fill: grau)[#data.untertitel]
#v(2 * u)
#grid(columns: (1fr, 1fr), column-gutter: u, row-gutter: u,
  kachel(data.m.fonds, data.fonds),
  kachel(data.m.investor, data.investor),
  kachel(data.m.anteilBetrag, data.betrag, dunkel: true),
  kachel(data.m.frist, data.valuta),
)
#abschnitt(data.m.angaben)
#tabelle2((data.m.angaben, data.m.wert), data.angaben, ("left", "right"), (2, 1))
#v(0.5 * u)
#text(size: 8pt, fill: grau)[#data.hinweis]
#abschnitt(data.m.stand)
#tabelle2((data.m.angaben, data.m.wert), data.stand, ("left", "right"), (2, 1))
#v(0.5 * u)
#text(size: 8pt, fill: grau)[#data.m.hinweisVerteilung]
#v(1 * u)
#text(size: 8pt, fill: grau)[#data.m.maschinell]
`;

/** Typst-Quelltext der Mitteilung (getrennt vom Setzen, damit Tests den Text ohne Compiler prüfen können). */
export function mitteilungQuelle(d: MitteilungsDaten, sprache: Sprache): string {
  const m = TEXT[sprache];
  const betrag = (w: string) => formatBetrag(w, sprache, d.fonds.waehrung);
  const titel = m.titel[d.art];
  const daten: Record<string, TypstWert> = {
    sprache,
    entwurf: false,
    titel,
    kopf: `${m.kopf[d.art]} · ${d.fonds.kurzname}`,
    stichtag: formatDatum(d.valuta, sprache),
    wissensstand: formatZeitpunkt(d.erstelltAm, sprache),
    t: { ...SCHRIFT[sprache], stichtag: m.valutaKurz[d.art] },
    m: {
      kopfZeile: m.kopf[d.art],
      fonds: m.fonds,
      investor: m.investor,
      anteilBetrag: m.anteilBetrag[d.art],
      frist: m.frist[d.art],
      angaben: m.angaben,
      wert: m.wert,
      stand: m.stand,
      hinweisVerteilung: m.hinweisVerteilung,
      maschinell: m.maschinell,
    },
    untertitel: `${d.fonds.name} · ${d.investor}`,
    fonds: d.fonds.name,
    investor: d.investor,
    betrag: betrag(d.betrag),
    valuta: formatDatum(d.valuta, sprache),
    angaben: [
      [m.fondsBetrag[d.art], betrag(d.fondsBetrag)],
      [m.anteilAmFonds, formatProzent(d.anteil, sprache)],
      [m.ihrBetrag[d.art], betrag(d.betrag)],
      [m.frist[d.art], formatDatum(d.valuta, sprache)],
      [m.verwendungszweck, d.referenz],
      [m.bankverbindung, m.bankPlatzhalter],
    ],
    hinweis: d.art === "abruf" ? m.hinweisAbruf : m.hinweisAusschuettung,
    stand: [
      [m.zusage, betrag(d.summen.zusage)],
      [m.abgerufen, betrag(d.summen.abgerufen)],
      [m.ausgeschuettet, betrag(d.summen.ausgeschuettet)],
      [m.offeneZusage, betrag(d.summen.offeneZusage)],
    ],
  };
  return `#let data = ${literal(daten)}\n${MIT_GRUNDLAGE(SEITE)}`;
}

export function erzeugeMitteilung(d: MitteilungsDaten, sprache: Sprache): Uint8Array {
  return setzePdf(mitteilungQuelle(d, sprache));
}
