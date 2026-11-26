import { Decimal } from "./decimal.js";
import { vergleiche, zerlege, type Datum } from "./datum.js";
import type { Rechenschritt } from "./herkunft.js";
import { ersteAuszahlung, kapitalAm, kapitalverlauf, type Kapitalbewegung } from "./kapitalverlauf.js";
import { aufCent } from "./zins.js";
import { zinsenAufVerlauf, type Zinsbedingungen } from "./zinsrechnung.js";

/**
 * Wandlungspreis = min(Rundenpreis × (1 − Abschlag), Bewertungsobergrenze ÷ Anteile vor der Runde),
 * jeweils nur, soweit angegeben. Der Preis wird nicht gerundet (Rundung später konfigurierbar).
 */
export interface Wandlungspreisregel {
  rundenpreisJeAnteil: Decimal.Value;
  /** Abschlag als Dezimalzahl, z. B. 0.20 für 20 %; mindestens 0, kleiner als 1. */
  discount?: Decimal.Value;
  bewertungsobergrenze?: { betrag: Decimal.Value; anteileVorRunde: Decimal.Value };
}

export interface WandlungEingabe {
  bewegungen: Kapitalbewegung[];
  bedingungen: Zinsbedingungen;
  cutoff: Datum;
  /** Zinsen in die Wandlung einbeziehen (true) oder auszahlen (false). */
  zinsenWandeln: boolean;
  preisregel: Wandlungspreisregel;
  nennwertJeAnteil: Decimal.Value;
  /** Beginn der noch nicht gebuchten Zinsen (z. B. letztes Periodenende); Standard: erste Auszahlung. */
  zinsenAb?: Datum;
  /**
   * Vertraglich abweichend gewandeltes Darlehen (0 bis Restkapital); ohne Angabe das ganze Restkapital. Der Rest ist nicht Teil der
   * Wandlung (zurückgezahlt oder erlassen, das bucht die Schicht darüber).
   */
  gewandeltesDarlehen?: Decimal.Value;
  /** Vertraglich abweichend gewandelte Zinsen (0 bis gebuchte Zinsen, nur mit `zinsenWandeln`); ohne Angabe alle Zinsen, wenn `zinsenWandeln`, sonst keine. */
  gewandelteZinsen?: Decimal.Value;
}

export type Wandlungsbuchungsart = "zinsen" | "darlehen_erloschen" | "anteile" | "zinsauszahlung" | "spitzenauszahlung";

export interface Wandlungsbuchung {
  art: Wandlungsbuchungsart;
  datum: Datum;
  betrag: Decimal;
  bezeichnung: string;
  /** Nur bei `anteile`. */
  anzahlAnteile?: Decimal;
  nominal?: Decimal;
  agio?: Decimal;
}

export type MassgeblichePreisregel = "rundenpreis" | "abschlag" | "bewertungsobergrenze";

export interface Wandlungsergebnis {
  cutoff: Datum;
  restkapital: Decimal;
  /** Aufgelaufene Zinsen bis zum Cut-off, ungerundet. */
  aufgelaufeneZinsen: Decimal;
  /** Dieselben Zinsen auf Cent gerundet, wie sie gebucht werden. */
  zinsenGebucht: Decimal;
  /** Gewandeltes Darlehen und gewandelte Zinsen (zusammen der Wandlungsbetrag). */
  darlehenGewandelt: Decimal;
  zinsenGewandelt: Decimal;
  /** Nicht gewandelter Rest von Darlehen und gebuchten Zinsen (nicht der Spitzenbetrag; null ohne Abweichung). */
  darlehenRest: Decimal;
  zinsenRest: Decimal;
  wandlungsbetrag: Decimal;
  preisJeAnteil: Decimal;
  massgeblich: MassgeblichePreisregel;
  /** Ganze Anteile, abgerundet. */
  anzahlAnteile: Decimal;
  /** Nicht wandelbarer Rest, wird ausgezahlt. */
  spitzenbetrag: Decimal;
  nominal: Decimal;
  /** Wandlungsbetrag − Nominal − Spitzenbetrag. */
  agio: Decimal;
  buchungen: Wandlungsbuchung[];
  schritte: Rechenschritt[];
}

/** Wandlung eines Wandeldarlehens zum Cut-off als ein Vorgang (Zinsen, Erlöschen, neue Anteile). */
export function wandlung(eingabe: WandlungEingabe): Wandlungsergebnis {
  const { cutoff } = eingabe;
  zerlege(cutoff);
  const verlauf = kapitalverlauf(eingabe.bewegungen).wert;
  const erste = ersteAuszahlung(verlauf);
  if (erste === undefined) throw new Error("Keine Auszahlung, nichts zu wandeln");
  if (vergleiche(cutoff, erste) < 0) throw new Error(`Cut-off ${cutoff} liegt vor der ersten Auszahlung ${erste}`);
  const letzte = verlauf.staende[verlauf.staende.length - 1]!;
  if (vergleiche(letzte.ab, cutoff) > 0) throw new Error(`Bewegung am ${letzte.ab} liegt nach dem Cut-off ${cutoff}`);

  const restkapital = kapitalAm(verlauf, cutoff);
  if (!restkapital.greaterThan(0)) throw new Error(`Am Cut-off ${cutoff} ist kein Kapital offen`);

  const zinsenAb = eingabe.zinsenAb ?? erste;
  if (vergleiche(zinsenAb, cutoff) > 0) throw new Error(`Zinsbeginn ${zinsenAb} liegt nach dem Cut-off ${cutoff}`);
  const zinsen = zinsenAufVerlauf(verlauf, zinsenAb, cutoff, eingabe.bedingungen);
  const zinsenGebucht = aufCent(zinsen.betragGesamt);

  const nennwert = new Decimal(eingabe.nennwertJeAnteil);
  if (!nennwert.greaterThan(0)) throw new Error("Nennwert je Anteil muss größer als null sein");

  const schritte: Rechenschritt[] = [
    { zeichen: "", bezeichnung: "Offenes Kapital am Cut-off", wert: restkapital.toString() },
    ...zinsen.schritte.map((s) => ({ ...s, bezeichnung: `Zinsen bis Cut-off: ${s.bezeichnung}` })),
    { zeichen: "=", bezeichnung: "Aufgelaufene Zinsen, gebucht (auf Cent)", wert: zinsenGebucht.toString() },
  ];

  const darlehenGewandelt = eingabe.gewandeltesDarlehen === undefined ? restkapital : new Decimal(eingabe.gewandeltesDarlehen);
  if (darlehenGewandelt.isNegative() || darlehenGewandelt.greaterThan(restkapital)) {
    throw new Error(`Gewandeltes Darlehen ${darlehenGewandelt.toString()} liegt außerhalb von 0 bis ${restkapital.toString()}`);
  }
  const zinsenGewandelt = eingabe.gewandelteZinsen === undefined ? (eingabe.zinsenWandeln ? zinsenGebucht : new Decimal(0)) : new Decimal(eingabe.gewandelteZinsen);
  if (zinsenGewandelt.isNegative() || zinsenGewandelt.greaterThan(zinsenGebucht)) {
    throw new Error(`Gewandelte Zinsen ${zinsenGewandelt.toString()} liegen außerhalb von 0 bis ${zinsenGebucht.toString()}`);
  }
  if (!eingabe.zinsenWandeln && zinsenGewandelt.greaterThan(0)) throw new Error("Zinsen werden nicht gewandelt, gewandelte Zinsen müssen null sein");
  const darlehenRest = restkapital.minus(darlehenGewandelt);
  const zinsenRest = eingabe.zinsenWandeln ? zinsenGebucht.minus(zinsenGewandelt) : new Decimal(0);
  const wandlungsbetrag = darlehenGewandelt.plus(zinsenGewandelt);
  if (!wandlungsbetrag.greaterThan(0)) throw new Error("Wandlungsbetrag muss größer als null sein");
  schritte.push({
    zeichen: "=",
    bezeichnung: !eingabe.zinsenWandeln ? "Wandlungsbetrag (nur Kapital, Zinsen werden ausgezahlt)" : "Wandlungsbetrag (Kapital plus Zinsen)",
    wert: wandlungsbetrag.toString(),
  });
  if (darlehenRest.greaterThan(0) || zinsenRest.greaterThan(0)) {
    schritte.push({ zeichen: "", bezeichnung: "Vertraglich nicht gewandelt: Darlehen", wert: darlehenRest.toString() }, { zeichen: "", bezeichnung: "Vertraglich nicht gewandelt: Zinsen", wert: zinsenRest.toString() });
  }

  const { preis, massgeblich, preisSchritte } = wandlungspreis(eingabe.preisregel);
  schritte.push(...preisSchritte);

  const anzahlAnteile = wandlungsbetrag.div(preis).floor();
  const spitzenbetrag = wandlungsbetrag.minus(anzahlAnteile.times(preis));
  const nominal = anzahlAnteile.times(nennwert);
  const agio = wandlungsbetrag.minus(nominal).minus(spitzenbetrag);
  schritte.push(
    { zeichen: "", bezeichnung: "Wandlungsbetrag ÷ Preis, abgerundet auf ganze Anteile", wert: anzahlAnteile.toString() },
    { zeichen: "", bezeichnung: "Spitzenbetrag (Wandlungsbetrag − Anteile × Preis)", wert: spitzenbetrag.toString() },
    { zeichen: "", bezeichnung: "Nominal (Anteile × Nennwert)", wert: nominal.toString() },
    { zeichen: "=", bezeichnung: "Agio (Wandlungsbetrag − Nominal − Spitzenbetrag)", wert: agio.toString() },
  );

  const buchungen: Wandlungsbuchung[] = [
    { art: "zinsen", datum: cutoff, betrag: zinsenGebucht, bezeichnung: "Zinsen bis zum Cut-off" },
    { art: "darlehen_erloschen", datum: cutoff, betrag: restkapital, bezeichnung: "Darlehen erlischt durch Wandlung" },
    {
      art: "anteile",
      datum: cutoff,
      betrag: nominal.plus(agio),
      bezeichnung: "Neue Anteile aus Wandlung (Nominal plus Agio)",
      anzahlAnteile,
      nominal,
      agio,
    },
  ];
  if (!eingabe.zinsenWandeln && zinsenGebucht.greaterThan(0)) {
    buchungen.push({ art: "zinsauszahlung", datum: cutoff, betrag: zinsenGebucht, bezeichnung: "Zinsen werden ausgezahlt" });
  }
  if (spitzenbetrag.greaterThan(0)) {
    buchungen.push({ art: "spitzenauszahlung", datum: cutoff, betrag: spitzenbetrag, bezeichnung: "Spitzenbetrag wird ausgezahlt" });
  }

  return {
    cutoff,
    restkapital,
    aufgelaufeneZinsen: zinsen.betragGesamt,
    zinsenGebucht,
    darlehenGewandelt,
    zinsenGewandelt,
    darlehenRest,
    zinsenRest,
    wandlungsbetrag,
    preisJeAnteil: preis,
    massgeblich,
    anzahlAnteile,
    spitzenbetrag,
    nominal,
    agio,
    buchungen,
    schritte,
  };
}

function wandlungspreis(regel: Wandlungspreisregel): { preis: Decimal; massgeblich: MassgeblichePreisregel; preisSchritte: Rechenschritt[] } {
  const runde = new Decimal(regel.rundenpreisJeAnteil);
  if (!runde.greaterThan(0)) throw new Error("Rundenpreis muss größer als null sein");
  const schritte: Rechenschritt[] = [{ zeichen: "", bezeichnung: "Rundenpreis je Anteil", wert: runde.toString() }];

  let abschlagspreis = runde;
  let massgeblich: MassgeblichePreisregel = "rundenpreis";
  if (regel.discount !== undefined) {
    const discount = new Decimal(regel.discount);
    if (discount.isNegative() || discount.greaterThanOrEqualTo(1)) throw new Error("Abschlag muss mindestens 0 und kleiner als 1 sein");
    abschlagspreis = runde.times(new Decimal(1).minus(discount));
    massgeblich = "abschlag";
    schritte.push({ zeichen: "=", bezeichnung: `Preis mit Abschlag ${discount.toString()}`, wert: abschlagspreis.toString() });
  }

  let preis = abschlagspreis;
  if (regel.bewertungsobergrenze) {
    const anteile = new Decimal(regel.bewertungsobergrenze.anteileVorRunde);
    if (!anteile.greaterThan(0)) throw new Error("Anteile vor der Runde müssen größer als null sein");
    const kappungspreis = new Decimal(regel.bewertungsobergrenze.betrag).div(anteile);
    schritte.push({ zeichen: "=", bezeichnung: "Preis aus Bewertungsobergrenze (Betrag ÷ Anteile vor der Runde)", wert: kappungspreis.toString() });
    if (kappungspreis.lessThan(abschlagspreis)) {
      preis = kappungspreis;
      massgeblich = "bewertungsobergrenze";
    }
  }
  if (!preis.greaterThan(0)) throw new Error("Wandlungspreis muss größer als null sein");
  schritte.push({ zeichen: "=", bezeichnung: "Wandlungspreis je Anteil (kleinerer Wert)", wert: preis.toString() });
  return { preis, massgeblich, preisSchritte: schritte };
}
