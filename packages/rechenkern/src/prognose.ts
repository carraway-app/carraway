import { Decimal } from "./decimal.js";
import { tageZwischen, type Datum } from "./datum.js";
import type { MitHerkunft, Rechenschritt } from "./herkunft.js";
import { multiples } from "./kennzahlen.js";
import { xirr, type Zahlungsstrom } from "./irr.js";

/**
 * Fondsprognose (Etappe 18): Abrufe, Investitionen, Gebühren, Ausschüttungen, NAV und Kennzahlen je Kalenderjahr, auf Basis des
 * Ist-Stands zum Basistag und Annahmen danach. Reine Funktionen, exakte Decimal-Rechnung. Die Regeln stehen hier und gleichlautend in
 * `referenz/referenz_prognose.py` (unabhängige Rechnung mit Brüchen):
 *
 * - **Perioden:** je Kalenderjahr von `jahr(basisStichtag)` bis `endJahr`; alle Zahlungen eines Jahres liegen am 31.12. (für den IRR).
 * - **Folgeinvestitionen** (je Beteiligung und Neuinvestitionen) sind Abrufe und erhöhen den Wertansatz zu Anschaffungskosten.
 * - **Gebühren:** Satz × Basis × Faktor, bis einschließlich `bisJahr`. Basis `zeichnungskapital` oder `investiert` (Kostenbasis der noch
 *   gehaltenen Beteiligungen zu Jahresbeginn, Ausstiege entfallen mit dem Ausstiegsjahr). Faktor im ersten Jahr = Tage vom Basistag bis
 *   31.12. ÷ 365 (höchstens 1), sonst 1. Dazu feste sonstige Kosten je Jahr mit demselben Faktor. Gebühren werden von den Investoren
 *   abgerufen.
 * - **Ausstieg:** erwarteter Erlös = Wahrscheinlichkeit × Erlös des Fonds im Ausstiegsjahr (der Rest ist Totalverlust). Ohne Ausstieg bleibt
 *   der Wertansatz stehen. Wertpfad `linear`: Wertansatz zum Jahresende k (k = Jahr − Basisjahr + 1 von K = Ausstiegsjahr − Basisjahr + 1)
 *   = max(0, Wert0 + (erwarteter Erlös − Wert0) × k ÷ K) plus Folgeinvestitionen bis dahin; im Ausstiegsjahr 0. `konstant`: Wert0 bis zum Ausstieg.
 * - **Netto:** Die Ausschüttungen des Fonds gehen an die Investoren abzüglich Carry. Carry (vereinfacht, Gesamtfonds, ohne Hurdle und
 *   Catch-up): kumuliert = Satz × max(0, kumulierte Ausschüttungen − kumulierte Abrufe); der Anfangsstand zählt als abgerechnet; der Carry
 *   eines Jahres ist der Zuwachs (nie negativ). Der NAV netto mindert den NAV um den noch nicht ausgeschütteten Carry auf Wertzuwachs.
 * - **Brutto:** Investitionen und Rückflüsse der Beteiligungen ohne Gebühren und Carry.
 */

export interface PrognoseBeteiligung {
  id: string;
  name: string;
  /** Wertansatz zum Basistag (≥ 0). */
  wert: Decimal.Value;
  /** Kostenbasis: bisher ausgezahlt (≥ 0). */
  investiert: Decimal.Value;
  folgeinvestitionen: { jahr: number; betrag: Decimal.Value }[];
  /** `null`: kein Ausstieg im Prognosezeitraum. `erloes` ist der Anteil des Fonds im 100-Prozent-Fall. */
  ausstieg: { jahr: number; erloes: Decimal.Value; wahrscheinlichkeit: Decimal.Value } | null;
}

export interface PrognoseGebuehren {
  basis: "zeichnungskapital" | "investiert";
  /** Anteil je Jahr, 0.02 = 2 %. */
  satz: Decimal.Value;
  /** Letztes Jahr mit Gebühren; `null` = bis zum Prognoseende. */
  bisJahr: number | null;
  /** Feste sonstige Kosten je Jahr. */
  sonstigeJahr: Decimal.Value;
}

export interface PrognoseEingabe {
  basisStichtag: Datum;
  endJahr: number;
  zeichnungskapital: Decimal.Value;
  /** Ist-Stand zum Basistag. */
  abgerufen: Decimal.Value;
  /** Belegte Einzahlungen am Basistag. Ältere Szenarioeingaben setzen volle Zahlung voraus. */
  eingezahlt?: Decimal.Value;
  ausschuettungen: Decimal.Value;
  /** NAV-Anteil, der nicht an den Beteiligungen hängt (z. B. offene Kaufpreisforderungen), bleibt konstant. */
  navSonstiges: Decimal.Value;
  /** Summe aller bisherigen Auszahlungen und Rückflüsse der Beteiligungen (auch ausgeschiedener) für die Bruttokennzahlen. */
  investiertBisher: Decimal.Value;
  rueckfluesseBisher: Decimal.Value;
  /** Ist-Zahlungen der Investoren (Abruf negativ, Ausschüttung positiv) und der Beteiligungen (Auszahlung negativ, Rückfluss positiv). */
  stroemeFonds: Zahlungsstrom[];
  stroemeBrutto: Zahlungsstrom[];
  /** Wertansatz aller Beteiligungen zum Basistag ist die Summe der `wert` unten; Beteiligungen sind nur die noch gehaltenen. */
  beteiligungen: PrognoseBeteiligung[];
  gebuehren: PrognoseGebuehren;
  carrySatz: Decimal.Value;
  wertpfad: "linear" | "konstant";
}

export interface PrognoseJahr {
  jahr: number;
  datum: Datum;
  /** `true` für den Ausgangsstand (Basistag), sonst Prognose. */
  ist: boolean;
  investitionen: Decimal;
  gebuehren: Decimal;
  abrufe: Decimal;
  ausschuettungenBrutto: Decimal;
  carry: Decimal;
  ausschuettungenNetto: Decimal;
  nav: Decimal;
  navNetto: Decimal;
  abgerufenKum: Decimal;
  ausschuettungenKum: Decimal;
  offeneZusage: Decimal;
  dpi: Decimal | null;
  tvpi: Decimal | null;
  rvpi: Decimal | null;
  irrNetto: Decimal | null;
  tvpiBrutto: Decimal | null;
  irrBrutto: Decimal | null;
}

export interface PrognoseBeteiligungErgebnis {
  id: string;
  name: string;
  ausstiegsJahr: number | null;
  erwarteterErloes: Decimal;
  folgeinvestitionen: Decimal;
}

export interface PrognoseErgebnis {
  jahre: PrognoseJahr[];
  beteiligungen: PrognoseBeteiligungErgebnis[];
  summen: { investitionen: Decimal; gebuehren: Decimal; abrufe: Decimal; ausschuettungenBrutto: Decimal; carry: Decimal; ausschuettungenNetto: Decimal };
}

const D = (w: Decimal.Value) => new Decimal(w);
const ende = (jahr: number): Datum => `${jahr}-12-31`;
const jahrVon = (datum: Datum) => Number(datum.slice(0, 4));
const geteilt = (z: Decimal, n: Decimal): Decimal | null => (n.isZero() ? null : z.div(n));

/** Wertansatz einer Beteiligung zum Jahresende `jahr` (nach Ausstieg 0). */
function wertAmEnde(b: PrognoseBeteiligung, jahr: number, basisJahr: number, pfad: "linear" | "konstant"): Decimal {
  const folge = b.folgeinvestitionen.filter((f) => f.jahr <= jahr && (b.ausstieg === null || f.jahr < b.ausstieg.jahr)).reduce((s, f) => s.plus(f.betrag), D(0));
  if (b.ausstieg === null) return D(b.wert).plus(folge);
  if (jahr >= b.ausstieg.jahr) return D(0);
  if (pfad === "konstant") return D(b.wert).plus(folge);
  const erwartet = D(b.ausstieg.erloes).times(b.ausstieg.wahrscheinlichkeit);
  const k = jahr - basisJahr + 1;
  const gesamt = b.ausstieg.jahr - basisJahr + 1;
  const linear = D(b.wert).plus(erwartet.minus(b.wert).times(k).div(gesamt));
  return Decimal.max(0, linear).plus(folge);
}

export function prognose(e: PrognoseEingabe): MitHerkunft<PrognoseErgebnis> {
  const basisJahr = jahrVon(e.basisStichtag);
  const zeichnung = D(e.zeichnungskapital);
  const satzCarry = D(e.carrySatz);
  const jahre: PrognoseJahr[] = [];

  let eingezahltKum = D(e.eingezahlt ?? e.abgerufen);
  let abgerufenKum = D(e.abgerufen);
  let ausKum = D(e.ausschuettungen);
  /** Kumulierte Brutto-Ausschüttungen (Ist = netto an die Investoren) für die Carry-Rechnung. */
  let ausBruttoKum = D(e.ausschuettungen);
  let carryKum = satzCarry.times(Decimal.max(0, ausBruttoKum.minus(abgerufenKum)));
  let investiertKum = D(e.investiertBisher);
  let rueckKum = D(e.rueckfluesseBisher);
  const stromFonds: Zahlungsstrom[] = [...e.stroemeFonds];
  const stromBrutto: Zahlungsstrom[] = [...e.stroemeBrutto];

  const navAn = (jahr: number) => e.beteiligungen.reduce((s, b) => s.plus(wertAmEnde(b, jahr, basisJahr, e.wertpfad)), D(e.navSonstiges));
  const navNetto = (nav: Decimal, ausBrutto: Decimal, abgerufen: Decimal, carry: Decimal) => {
    const unrealisiert = satzCarry.times(Decimal.max(0, ausBrutto.plus(nav).minus(abgerufen))).minus(carry);
    return nav.minus(Decimal.max(0, unrealisiert));
  };
  const kennzahlen = (datum: Datum, nav: Decimal, navN: Decimal) => {
    const m = multiples({ eingezahlt: eingezahltKum, ausschuettungen: ausKum, nav: navN });
    const irrN = xirr([...stromFonds, { datum, betrag: navN }]);
    const tvpiB = geteilt(rueckKum.plus(nav), investiertKum);
    const irrB = xirr([...stromBrutto, { datum, betrag: nav }]);
    return { dpi: m.dpi.wert, tvpi: m.tvpi.wert, rvpi: m.rvpi.wert, irrNetto: irrN, tvpiBrutto: tvpiB, irrBrutto: irrB };
  };

  // Ausgangsstand
  {
    const nav = D(e.navSonstiges).plus(e.beteiligungen.reduce((s, b) => s.plus(b.wert), D(0)));
    const navN = navNetto(nav, ausBruttoKum, abgerufenKum, carryKum);
    jahre.push({
      jahr: basisJahr,
      datum: e.basisStichtag,
      ist: true,
      investitionen: D(0),
      gebuehren: D(0),
      abrufe: D(0),
      ausschuettungenBrutto: D(0),
      carry: D(0),
      ausschuettungenNetto: D(0),
      nav,
      navNetto: navN,
      abgerufenKum,
      ausschuettungenKum: ausKum,
      offeneZusage: zeichnung.minus(abgerufenKum),
      ...kennzahlen(e.basisStichtag, nav, navN),
    });
  }

  const summen = { investitionen: D(0), gebuehren: D(0), abrufe: D(0), ausschuettungenBrutto: D(0), carry: D(0), ausschuettungenNetto: D(0) };
  for (let jahr = basisJahr; jahr <= e.endJahr; jahr++) {
    const faktor = jahr === basisJahr ? Decimal.min(1, D(tageZwischen(e.basisStichtag, ende(jahr))).div(365)) : D(1);
    const invest = e.beteiligungen.reduce((s, b) => s.plus(b.folgeinvestitionen.filter((f) => f.jahr === jahr && (b.ausstieg === null || f.jahr <= b.ausstieg.jahr)).reduce((x, f) => x.plus(f.betrag), D(0))), D(0));
    const gebuehrenJahr = e.gebuehren.bisJahr === null || jahr <= e.gebuehren.bisJahr;
    let basis = zeichnung;
    if (e.gebuehren.basis === "investiert") {
      basis = e.beteiligungen.reduce((s, b) => {
        if (b.ausstieg !== null && b.ausstieg.jahr < jahr) return s;
        return s.plus(b.investiert).plus(b.folgeinvestitionen.filter((f) => f.jahr < jahr).reduce((x, f) => x.plus(f.betrag), D(0)));
      }, D(0));
    }
    const gebuehr = gebuehrenJahr ? D(e.gebuehren.satz).times(basis).plus(e.gebuehren.sonstigeJahr).times(faktor) : D(0);
    const erloes = e.beteiligungen.reduce((s, b) => (b.ausstieg !== null && b.ausstieg.jahr === jahr ? s.plus(D(b.ausstieg.erloes).times(b.ausstieg.wahrscheinlichkeit)) : s), D(0));
    const abrufe = invest.plus(gebuehr);

    abgerufenKum = abgerufenKum.plus(abrufe);
    eingezahltKum = eingezahltKum.plus(abrufe);
    ausBruttoKum = ausBruttoKum.plus(erloes);
    const carryNeu = satzCarry.times(Decimal.max(0, ausBruttoKum.minus(abgerufenKum)));
    const carry = Decimal.max(0, carryNeu.minus(carryKum));
    carryKum = carryKum.plus(carry);
    const netto = erloes.minus(carry);
    ausKum = ausKum.plus(netto);
    investiertKum = investiertKum.plus(invest);
    rueckKum = rueckKum.plus(erloes);
    if (!abrufe.isZero()) stromFonds.push({ datum: ende(jahr), betrag: abrufe.neg() });
    if (!netto.isZero()) stromFonds.push({ datum: ende(jahr), betrag: netto });
    if (!invest.isZero()) stromBrutto.push({ datum: ende(jahr), betrag: invest.neg() });
    if (!erloes.isZero()) stromBrutto.push({ datum: ende(jahr), betrag: erloes });

    const nav = navAn(jahr);
    const navN = navNetto(nav, ausBruttoKum, abgerufenKum, carryKum);
    summen.investitionen = summen.investitionen.plus(invest);
    summen.gebuehren = summen.gebuehren.plus(gebuehr);
    summen.abrufe = summen.abrufe.plus(abrufe);
    summen.ausschuettungenBrutto = summen.ausschuettungenBrutto.plus(erloes);
    summen.carry = summen.carry.plus(carry);
    summen.ausschuettungenNetto = summen.ausschuettungenNetto.plus(netto);
    jahre.push({
      jahr,
      datum: ende(jahr),
      ist: false,
      investitionen: invest,
      gebuehren: gebuehr,
      abrufe,
      ausschuettungenBrutto: erloes,
      carry,
      ausschuettungenNetto: netto,
      nav,
      navNetto: navN,
      abgerufenKum,
      ausschuettungenKum: ausKum,
      offeneZusage: zeichnung.minus(abgerufenKum),
      ...kennzahlen(ende(jahr), nav, navN),
    });
  }

  const beteiligungen = e.beteiligungen.map((b) => ({
    id: b.id,
    name: b.name,
    ausstiegsJahr: b.ausstieg?.jahr ?? null,
    erwarteterErloes: b.ausstieg ? D(b.ausstieg.erloes).times(b.ausstieg.wahrscheinlichkeit) : D(0),
    folgeinvestitionen: b.folgeinvestitionen.reduce((s, f) => s.plus(f.betrag), D(0)),
  }));

  const letzte = jahre[jahre.length - 1]!;
  const text = (w: Decimal | null) => (w === null ? "nicht definiert" : w.toString());
  const schritte: Rechenschritt[] = [
    { zeichen: "", bezeichnung: "Abgerufen bis zum Basistag", wert: D(e.abgerufen).toString() },
    { zeichen: "+", bezeichnung: "Prognose: Investitionen", wert: summen.investitionen.toString() },
    { zeichen: "+", bezeichnung: "Prognose: Gebühren und Kosten", wert: summen.gebuehren.toString() },
    { zeichen: "=", bezeichnung: "Abgerufen zum Prognoseende", wert: letzte.abgerufenKum.toString() },
    { zeichen: "", bezeichnung: "Ausschüttungen bis zum Basistag", wert: D(e.ausschuettungen).toString() },
    { zeichen: "+", bezeichnung: "Prognose: Ausschüttungen brutto", wert: summen.ausschuettungenBrutto.toString() },
    { zeichen: "−", bezeichnung: "Prognose: Carry", wert: summen.carry.toString() },
    { zeichen: "=", bezeichnung: "Ausschüttungen zum Prognoseende (netto)", wert: letzte.ausschuettungenKum.toString() },
    { zeichen: "", bezeichnung: "NAV netto zum Prognoseende", wert: letzte.navNetto.toString() },
    { zeichen: "=", bezeichnung: "DPI (netto)", wert: text(letzte.dpi) },
    { zeichen: "=", bezeichnung: "TVPI (netto)", wert: text(letzte.tvpi) },
    { zeichen: "=", bezeichnung: "IRR (netto, XIRR)", wert: text(letzte.irrNetto) },
  ];
  return { wert: { jahre, beteiligungen, summen }, schritte };
}
