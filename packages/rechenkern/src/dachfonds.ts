import { Decimal } from "./decimal.js";
import { vergleiche, type Datum } from "./datum.js";
import type { MitHerkunft, Rechenschritt } from "./herkunft.js";
import { xirr, type Zahlungsstrom } from "./irr.js";

/**
 * Dachfonds (Fund of Funds) als reine Rechnung: Ein Fonds hält Anteile an Zielfonds. Je Zielfondsbeteiligung gibt es Zusagen, Kapitalabrufe und
 * Ausschüttungen des Zielfonds (Bewegungen) und Meldungen des Zielfonds (NAV des Anteils und/oder Anteil am Zielfonds zu einem Stichtag).
 *
 * **Wert des Anteils zum Stichtag** (in dieser Reihenfolge):
 * 1. **Durchrechnung:** Wird der Zielfonds in derselben Installation geführt und ist ein Anteil gemeldet, gilt NAV des Zielfonds zum Stichtag × Anteil.
 * 2. **Fortgeschriebene NAV-Meldung:** letzte gemeldete NAV bis zum Stichtag plus Abrufe und minus Ausschüttungen mit Valuta nach dem Meldestichtag.
 * 3. **Ohne Meldung:** Abrufe minus Ausschüttungen (fortgeführte Anschaffungskosten), nicht unter null.
 *
 * Ergebnisse werden erst am Ende auf Cent gerundet (kaufmännisch); die Rechenschritte nennen die ungerundeten Teile.
 */

export type ZielfondsBewegungArt = "zusage" | "abruf" | "ausschuettung";

export interface ZielfondsBewegung {
  id: string;
  art: ZielfondsBewegungArt;
  valuta: Datum;
  /** Betrag in Fondswährung des Dachfonds; Stornos sind Gegenbuchungen mit negiertem Betrag. */
  betrag: Decimal.Value;
}

export interface ZielfondsMeldung {
  id: string;
  stichtag: Datum;
  /** Gemeldete NAV des Anteils (Fondswährung des Dachfonds) oder `null`. */
  nav: Decimal.Value | null;
  /** Gemeldeter Anteil am Zielfonds als Bruch (0.125 = 12,5 %) oder `null`. */
  anteil: Decimal.Value | null;
  /** Reihenfolge der Erfassung (jüngste zuletzt): Bei mehreren Meldungen zum selben Stichtag gilt die zuletzt erfasste. */
  folge: number;
}

export interface ZielfondsEingang {
  bezeichnung: string;
  stichtag: Datum;
  /** Bewegungen bis zum Stichtag (Valuta) und Wissensstand. */
  bewegungen: readonly ZielfondsBewegung[];
  /** Meldungen bis zum Stichtag und Wissensstand. */
  meldungen: readonly ZielfondsMeldung[];
  /** NAV des Zielfonds zum Stichtag, wenn er in derselben Installation geführt wird und eine NAV hat (sonst `null` oder fehlend). */
  zielNav?: Decimal.Value | null;
}

export type ZielfondsMethode = "durchrechnung" | "nav_meldung" | "anschaffungskosten";

export interface ZielfondsWert extends MitHerkunft<Decimal> {
  methode: ZielfondsMethode;
  /** Meldung, auf der der Wert beruht (Durchrechnung: Anteil, Fortschreibung: NAV), sonst `null`. */
  meldungId: string | null;
}

export interface ZielfondsKennzahlen {
  zusage: MitHerkunft<Decimal>;
  abgerufen: MitHerkunft<Decimal>;
  offeneZusage: MitHerkunft<Decimal>;
  ausgeschuettet: MitHerkunft<Decimal>;
  wert: ZielfondsWert;
  dpi: MitHerkunft<Decimal | null>;
  tvpi: MitHerkunft<Decimal | null>;
  irr: MitHerkunft<Decimal | null>;
}

const NULL = new Decimal(0);
const cent = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const text = (d: Decimal | null) => (d === null ? "nicht definiert" : d.toString());

function summe(bewegungen: readonly ZielfondsBewegung[], art: ZielfondsBewegungArt, filter: (b: ZielfondsBewegung) => boolean = () => true) {
  const teile = bewegungen.filter((b) => b.art === art && filter(b));
  return { wert: teile.reduce((s, b) => s.plus(b.betrag), NULL), quellen: teile.map((b) => b.id) };
}

/** Jüngste Meldung bis zum Stichtag, die das Feld trägt (Stichtag absteigend, dann zuletzt erfasst). */
export function letzteMeldung(meldungen: readonly ZielfondsMeldung[], stichtag: Datum, feld: "nav" | "anteil"): ZielfondsMeldung | null {
  let beste: ZielfondsMeldung | null = null;
  for (const m of meldungen) {
    if (m[feld] === null || vergleiche(m.stichtag, stichtag) > 0) continue;
    if (!beste || vergleiche(m.stichtag, beste.stichtag) > 0 || (m.stichtag === beste.stichtag && m.folge > beste.folge)) beste = m;
  }
  return beste;
}

/** Wert des Anteils an einem Zielfonds zum Stichtag (Regeln oben). */
export function zielfondsWert(e: ZielfondsEingang): ZielfondsWert {
  const imZeitraum = e.bewegungen.filter((b) => vergleiche(b.valuta, e.stichtag) <= 0);
  const anteil = letzteMeldung(e.meldungen, e.stichtag, "anteil");
  if (anteil && e.zielNav !== undefined && e.zielNav !== null) {
    const nav = new Decimal(e.zielNav);
    const quote = new Decimal(anteil.anteil!);
    const roh = nav.times(quote);
    const wert = cent(roh);
    return {
      wert,
      methode: "durchrechnung",
      meldungId: anteil.id,
      schritte: [
        { zeichen: "", bezeichnung: `NAV des Zielfonds ${e.bezeichnung} am ${e.stichtag} (durchgerechnet)`, wert: nav.toString() },
        { zeichen: "×", bezeichnung: `Anteil am Zielfonds laut Meldung zum ${anteil.stichtag}`, wert: quote.toString(), quellen: [anteil.id] },
        { zeichen: "=", bezeichnung: "Wert des Anteils (auf Cent gerundet)", wert: wert.toFixed(2) },
      ],
    };
  }
  const meldung = letzteMeldung(e.meldungen, e.stichtag, "nav");
  if (meldung) {
    const danach = (b: ZielfondsBewegung) => vergleiche(b.valuta, meldung.stichtag) > 0;
    const abrufe = summe(imZeitraum, "abruf", danach);
    const ausschuettungen = summe(imZeitraum, "ausschuettung", danach);
    const nav = new Decimal(meldung.nav!);
    const wert = cent(nav.plus(abrufe.wert).minus(ausschuettungen.wert));
    return {
      wert,
      methode: "nav_meldung",
      meldungId: meldung.id,
      schritte: [
        { zeichen: "", bezeichnung: `Gemeldete NAV zum ${meldung.stichtag}`, wert: nav.toString(), quellen: [meldung.id] },
        { zeichen: "+", bezeichnung: `Kapitalabrufe nach dem ${meldung.stichtag} bis zum ${e.stichtag}`, wert: abrufe.wert.toString(), quellen: abrufe.quellen },
        { zeichen: "−", bezeichnung: `Ausschüttungen nach dem ${meldung.stichtag} bis zum ${e.stichtag}`, wert: ausschuettungen.wert.toString(), quellen: ausschuettungen.quellen },
        { zeichen: "=", bezeichnung: "Fortgeschriebene NAV des Anteils", wert: wert.toFixed(2) },
      ],
    };
  }
  const abrufe = summe(imZeitraum, "abruf");
  const ausschuettungen = summe(imZeitraum, "ausschuettung");
  const roh = abrufe.wert.minus(ausschuettungen.wert);
  const wert = cent(Decimal.max(roh, NULL));
  return {
    wert,
    methode: "anschaffungskosten",
    meldungId: null,
    schritte: [
      { zeichen: "", bezeichnung: "Kapitalabrufe kumuliert (keine NAV-Meldung bis zum Stichtag)", wert: abrufe.wert.toString(), quellen: abrufe.quellen },
      { zeichen: "−", bezeichnung: "Ausschüttungen kumuliert", wert: ausschuettungen.wert.toString(), quellen: ausschuettungen.quellen },
      { zeichen: "=", bezeichnung: "Fortgeführte Anschaffungskosten (nicht unter null)", wert: wert.toFixed(2) },
    ],
  };
}

/** Kennzahlen einer Zielfondsbeteiligung zum Stichtag: Zusage, Abrufe, offene Zusage, Ausschüttungen, Wert, DPI, TVPI und IRR (XIRR). */
export function zielfondsKennzahlen(e: ZielfondsEingang): ZielfondsKennzahlen {
  const imZeitraum = e.bewegungen.filter((b) => vergleiche(b.valuta, e.stichtag) <= 0);
  const zusage = summe(imZeitraum, "zusage");
  const abgerufen = summe(imZeitraum, "abruf");
  const ausgeschuettet = summe(imZeitraum, "ausschuettung");
  const offen = Decimal.max(zusage.wert.minus(abgerufen.wert), NULL);
  const wert = zielfondsWert(e);
  const dpi = abgerufen.wert.isZero() ? null : ausgeschuettet.wert.div(abgerufen.wert);
  const tvpi = abgerufen.wert.isZero() ? null : wert.wert.plus(ausgeschuettet.wert).div(abgerufen.wert);
  const strom: Zahlungsstrom[] = [
    ...imZeitraum.filter((b) => b.art === "abruf").map((b) => ({ datum: b.valuta, betrag: new Decimal(b.betrag).neg() })),
    ...imZeitraum.filter((b) => b.art === "ausschuettung").map((b) => ({ datum: b.valuta, betrag: new Decimal(b.betrag) })),
  ];
  if (!wert.wert.isZero()) strom.push({ datum: e.stichtag, betrag: wert.wert });
  const irr = xirr(strom);
  return {
    zusage: { wert: zusage.wert, schritte: [{ zeichen: "=", bezeichnung: "Zusagen an den Zielfonds kumuliert", wert: zusage.wert.toString(), quellen: zusage.quellen }] },
    abgerufen: { wert: abgerufen.wert, schritte: [{ zeichen: "=", bezeichnung: "Kapitalabrufe des Zielfonds kumuliert", wert: abgerufen.wert.toString(), quellen: abgerufen.quellen }] },
    offeneZusage: {
      wert: offen,
      schritte: [
        { zeichen: "", bezeichnung: "Zusagen kumuliert", wert: zusage.wert.toString() },
        { zeichen: "−", bezeichnung: "Kapitalabrufe kumuliert", wert: abgerufen.wert.toString() },
        { zeichen: "=", bezeichnung: "Offene Zusage (nicht unter null)", wert: offen.toString() },
      ],
    },
    ausgeschuettet: { wert: ausgeschuettet.wert, schritte: [{ zeichen: "=", bezeichnung: "Ausschüttungen des Zielfonds kumuliert", wert: ausgeschuettet.wert.toString(), quellen: ausgeschuettet.quellen }] },
    wert,
    dpi: {
      wert: dpi,
      schritte: [
        { zeichen: "", bezeichnung: "Ausschüttungen kumuliert", wert: ausgeschuettet.wert.toString() },
        { zeichen: "÷", bezeichnung: "Kapitalabrufe kumuliert", wert: abgerufen.wert.toString() },
        { zeichen: "=", bezeichnung: "DPI", wert: text(dpi) },
      ],
    },
    tvpi: {
      wert: tvpi,
      schritte: [
        { zeichen: "", bezeichnung: "Wert des Anteils", wert: wert.wert.toFixed(2) },
        { zeichen: "+", bezeichnung: "Ausschüttungen kumuliert", wert: ausgeschuettet.wert.toString() },
        { zeichen: "÷", bezeichnung: "Kapitalabrufe kumuliert", wert: abgerufen.wert.toString() },
        { zeichen: "=", bezeichnung: "TVPI", wert: text(tvpi) },
      ],
    },
    irr: {
      wert: irr,
      schritte: [
        { zeichen: "−", bezeichnung: "Kapitalabrufe (Valuta)", wert: abgerufen.wert.toString() },
        { zeichen: "+", bezeichnung: "Ausschüttungen (Valuta)", wert: ausgeschuettet.wert.toString() },
        { zeichen: "+", bezeichnung: `Wert des Anteils als Endwert am ${e.stichtag}`, wert: wert.wert.toFixed(2) },
        { zeichen: "=", bezeichnung: "IRR (XIRR, act/365)", wert: text(irr) },
      ],
    },
  };
}

// Fondsübergreifende Summen ohne Doppelzählung ------------------------------------------------------------------------------------------

export interface FondsSummand {
  fondsId: string;
  bezeichnung: string;
  /** Alle Beträge bereits in derselben Währung (z. B. Hauswährung); `null` = Lücke (Kurs oder NAV fehlt). */
  zusage: Decimal.Value | null;
  eingezahlt: Decimal.Value | null;
  ausschuettungen: Decimal.Value | null;
  nav: Decimal.Value | null;
}

/** Anteil eines Fonds an einem anderen Fonds derselben Installation (Zielfondsbeteiligung mit internem Zielfonds), in derselben Währung. */
export interface InterneBeteiligung {
  id: string;
  /** Der haltende Fonds (Dachfonds). */
  vonFondsId: string;
  /** Der gehaltene Fonds (Zielfonds). */
  zielFondsId: string;
  bezeichnung: string;
  /**
   * Der Dachfonds ist im Zielfonds als Investor erfasst: Nur dann stecken Zusage, Abrufe und Ausschüttungen des Anteils auch in den Investorenzahlen des
   * Zielfonds und werden abgezogen. Der Wert des Anteils steckt immer in der NAV des Zielfonds und wird immer abgezogen.
   */
  alsInvestorErfasst: boolean;
  zusage: Decimal.Value | null;
  abgerufen: Decimal.Value | null;
  ausgeschuettet: Decimal.Value | null;
  wert: Decimal.Value | null;
}

export interface PortfolioSummen {
  zusage: MitHerkunft<Decimal | null>;
  eingezahlt: MitHerkunft<Decimal | null>;
  ausschuettungen: MitHerkunft<Decimal | null>;
  nav: MitHerkunft<Decimal | null>;
  tvpi: MitHerkunft<Decimal | null>;
  dpi: MitHerkunft<Decimal | null>;
  rvpi: MitHerkunft<Decimal | null>;
  /** Interne Beteiligungen, die herausgerechnet wurden (beide Fonds in der Summe). */
  bereinigt: string[];
}

/**
 * Summen über mehrere Fonds ohne Doppelzählung: Hält ein Fonds der Summe einen Anteil an einem anderen Fonds der Summe, steckt der Wert des Anteils
 * zweimal darin (im Dachfonds und als Teil der NAV des Zielfonds) und wird abgezogen. Ist der Dachfonds im Zielfonds als Investor erfasst, stecken auch
 * Zusage, Abrufe und Ausschüttungen zweimal darin (Abruf des Zielfonds = Einzahlung eines Investors des Zielfonds) und werden ebenfalls abgezogen.
 * Eine Lücke (`null`) in einem Summanden macht die Summe zur Lücke.
 */
export function portfolioSummen(fonds: readonly FondsSummand[], intern: readonly InterneBeteiligung[]): PortfolioSummen {
  const enthalten = new Set(fonds.map((f) => f.fondsId));
  const bereinigt = intern.filter((i) => enthalten.has(i.vonFondsId) && enthalten.has(i.zielFondsId));

  /** `abzug` liefert `undefined`, wenn der Posten für diese Beteiligung nicht doppelt zählt (kein Abzug). */
  const posten = (titel: string, wahl: (f: FondsSummand) => Decimal.Value | null, abzug: (i: InterneBeteiligung) => Decimal.Value | null | undefined, abzugText: string): MitHerkunft<Decimal | null> => {
    const schritte: Rechenschritt[] = [];
    let wert: Decimal | null = NULL;
    for (const f of fonds) {
      const w = wahl(f);
      schritte.push({ zeichen: schritte.length === 0 ? "" : "+", bezeichnung: f.bezeichnung, wert: w === null ? "Lücke" : new Decimal(w).toString(), quellen: [f.fondsId] });
      wert = w === null || wert === null ? null : wert.plus(w);
    }
    for (const i of bereinigt) {
      const w = abzug(i);
      if (w === undefined) continue;
      schritte.push({ zeichen: "−", bezeichnung: `${abzugText}: ${i.bezeichnung}`, wert: w === null ? "Lücke" : new Decimal(w).toString(), quellen: [i.id] });
      wert = w === null || wert === null ? null : wert.minus(w);
    }
    schritte.push({ zeichen: "=", bezeichnung: titel, wert: wert === null ? "Lücke" : wert.toString() });
    return { wert, schritte };
  };

  const zusage = posten("Zusagen der Investoren, ohne Doppelzählung", (f) => f.zusage, (i) => (i.alsInvestorErfasst ? i.zusage : undefined), "Zusage an einen eigenen Zielfonds");
  const eingezahlt = posten("Eingezahltes Kapital, ohne Doppelzählung", (f) => f.eingezahlt, (i) => (i.alsInvestorErfasst ? i.abgerufen : undefined), "Abrufe eines eigenen Zielfonds");
  const ausschuettungen = posten("Ausschüttungen, ohne Doppelzählung", (f) => f.ausschuettungen, (i) => (i.alsInvestorErfasst ? i.ausgeschuettet : undefined), "Ausschüttungen eines eigenen Zielfonds");
  const nav = posten("NAV, ohne Doppelzählung", (f) => f.nav, (i) => i.wert, "Wert des Anteils an einem eigenen Zielfonds");

  const geteilt = (a: Decimal | null, b: Decimal | null) => (a === null || b === null || b.isZero() ? null : a.div(b));
  const tvpiWert = nav.wert === null || ausschuettungen.wert === null ? null : geteilt(nav.wert.plus(ausschuettungen.wert), eingezahlt.wert);
  const dpiWert = geteilt(ausschuettungen.wert, eingezahlt.wert);
  const rvpiWert = geteilt(nav.wert, eingezahlt.wert);
  const t = (d: Decimal | null) => (d === null ? "Lücke" : d.toString());
  return {
    zusage,
    eingezahlt,
    ausschuettungen,
    nav,
    tvpi: {
      wert: tvpiWert,
      schritte: [
        { zeichen: "", bezeichnung: "NAV, ohne Doppelzählung", wert: t(nav.wert) },
        { zeichen: "+", bezeichnung: "Ausschüttungen, ohne Doppelzählung", wert: t(ausschuettungen.wert) },
        { zeichen: "÷", bezeichnung: "Eingezahltes Kapital, ohne Doppelzählung", wert: t(eingezahlt.wert) },
        { zeichen: "=", bezeichnung: "TVPI über alle Fonds", wert: text(tvpiWert) },
      ],
    },
    dpi: {
      wert: dpiWert,
      schritte: [
        { zeichen: "", bezeichnung: "Ausschüttungen, ohne Doppelzählung", wert: t(ausschuettungen.wert) },
        { zeichen: "÷", bezeichnung: "Eingezahltes Kapital, ohne Doppelzählung", wert: t(eingezahlt.wert) },
        { zeichen: "=", bezeichnung: "DPI über alle Fonds", wert: text(dpiWert) },
      ],
    },
    rvpi: {
      wert: rvpiWert,
      schritte: [
        { zeichen: "", bezeichnung: "NAV, ohne Doppelzählung", wert: t(nav.wert) },
        { zeichen: "÷", bezeichnung: "Eingezahltes Kapital, ohne Doppelzählung", wert: t(eingezahlt.wert) },
        { zeichen: "=", bezeichnung: "RVPI über alle Fonds", wert: text(rvpiWert) },
      ],
    },
    bereinigt: bereinigt.map((i) => i.id),
  };
}
