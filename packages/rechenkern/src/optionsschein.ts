import { Decimal } from "./decimal.js";
import { vergleiche, zerlege, type Datum } from "./datum.js";
import type { MitHerkunft, Rechenschritt } from "./herkunft.js";
import { aufCent } from "./zins.js";

/**
 * Optionsscheine (Warrants) eines Fonds: das Recht, bis zum Ende der Laufzeit eine Zahl Anteile zum Ausübungspreis zu beziehen (ein Anteil je
 * Optionsschein). Reine Funktionen, exakte Rechnung:
 *
 * - **Stand zum Stichtag:** ausgeübt = Summe der Ausübungen bis zum Stichtag; offen = Anzahl − ausgeübt, solange der Stichtag in der Laufzeit liegt
 *   (Ausgabe bis Laufzeitende, jeweils einschließlich); nach dem Laufzeitende verfallen die offenen. Vor der Ausgabe gibt es keine offenen.
 * - **Ausübung:** höchstens die am Tag der Ausübung offenen Optionsscheine, nur in der Laufzeit. Betrag = Anzahl × Ausübungspreis, auf Cent
 *   (kaufmännisch); das zahlt der Fonds.
 */

export interface Optionsscheinbedingungen {
  /** Zahl der Optionsscheine (= Anteile, die sich beziehen lassen), größer als null. */
  anzahl: Decimal.Value;
  /** Ausübungspreis je Anteil, mindestens null. */
  ausuebungspreis: Decimal.Value;
  /** Tag der Ausgabe; ohne Angabe gelten die Optionsscheine von Anfang an. */
  ausgabeAm?: Datum | null | undefined;
  /** Letzter Tag der Ausübung; ohne Angabe unbefristet. */
  laufzeitBis?: Datum | null | undefined;
}

export interface Optionsscheinausuebung {
  datum: Datum;
  anzahl: Decimal.Value;
}

export interface Optionsscheinstand {
  /** Bis zum Stichtag ausgeübt. */
  ausgeuebt: Decimal;
  /** Am Stichtag noch ausübbar (0 vor der Ausgabe und nach dem Laufzeitende). */
  offen: Decimal;
  /** Nach dem Laufzeitende verfallen (nicht ausgeübt). */
  verfallen: Decimal;
  status: "vor_ausgabe" | "laufend" | "verfallen";
}

/** Stand der Optionsscheine zum Stichtag. */
export function optionsscheinStand(b: Optionsscheinbedingungen, ausuebungen: readonly Optionsscheinausuebung[], stichtag: Datum): MitHerkunft<Optionsscheinstand> {
  zerlege(stichtag);
  const anzahl = new Decimal(b.anzahl);
  const ausgeuebt = ausuebungen.filter((a) => vergleiche(a.datum, stichtag) <= 0).reduce((s, a) => s.plus(a.anzahl), new Decimal(0));
  const rest = Decimal.max(0, anzahl.minus(ausgeuebt));
  const status: Optionsscheinstand["status"] = b.ausgabeAm && vergleiche(stichtag, b.ausgabeAm) < 0 ? "vor_ausgabe" : b.laufzeitBis && vergleiche(stichtag, b.laufzeitBis) > 0 ? "verfallen" : "laufend";
  const offen = status === "laufend" ? rest : new Decimal(0);
  const verfallen = status === "verfallen" ? rest : new Decimal(0);
  const schritte: Rechenschritt[] = [
    { zeichen: "", bezeichnung: "Optionsscheine (Anteile, die sich beziehen lassen)", wert: anzahl.toString() },
    { zeichen: "−", bezeichnung: `Ausgeübt bis ${stichtag}`, wert: ausgeuebt.toString() },
    { zeichen: "=", bezeichnung: status === "laufend" ? "Offen am Stichtag" : status === "verfallen" ? `Verfallen (Laufzeit bis ${b.laufzeitBis})` : `Noch nicht ausgegeben (Ausgabe am ${b.ausgabeAm})`, wert: rest.toString() },
  ];
  return { wert: { ausgeuebt, offen, verfallen, status }, schritte };
}

/**
 * Prüft eine Ausübung gegen die Bedingungen und die früheren Ausübungen und liefert den Betrag (Anzahl × Ausübungspreis, auf Cent). Wirft mit
 * einer lesbaren Meldung, wenn die Ausübung nicht in der Laufzeit liegt oder mehr ausübt, als offen ist (auch gegen spätere Ausübungen gerechnet).
 */
export function optionsscheinAusuebung(b: Optionsscheinbedingungen, frueher: readonly Optionsscheinausuebung[], neu: Optionsscheinausuebung): MitHerkunft<{ betrag: Decimal; offenDanach: Decimal }> {
  zerlege(neu.datum);
  const anzahl = new Decimal(neu.anzahl);
  if (!anzahl.isInteger() || !anzahl.greaterThan(0)) throw new Error("Die Zahl der ausgeübten Optionsscheine muss eine ganze Zahl größer als null sein");
  if (b.ausgabeAm && vergleiche(neu.datum, b.ausgabeAm) < 0) throw new Error(`Die Ausübung am ${neu.datum} liegt vor der Ausgabe am ${b.ausgabeAm}`);
  if (b.laufzeitBis && vergleiche(neu.datum, b.laufzeitBis) > 0) throw new Error(`Die Ausübung am ${neu.datum} liegt nach dem Ende der Laufzeit am ${b.laufzeitBis}`);
  const gesamt = new Decimal(b.anzahl);
  // Gegen alle Ausübungen rechnen (auch spätere): Die Summe darf die Anzahl nie übersteigen.
  const bisher = frueher.reduce((s, a) => s.plus(a.anzahl), new Decimal(0));
  const offen = gesamt.minus(bisher);
  if (anzahl.greaterThan(offen)) throw new Error(`Es sind nur noch ${Decimal.max(0, offen).toString()} Optionsscheine offen`);
  const preis = new Decimal(b.ausuebungspreis);
  if (preis.isNegative()) throw new Error("Der Ausübungspreis darf nicht negativ sein");
  const betrag = aufCent(anzahl.times(preis));
  return {
    wert: { betrag, offenDanach: offen.minus(anzahl) },
    schritte: [
      { zeichen: "", bezeichnung: "Offene Optionsscheine vor der Ausübung", wert: offen.toString() },
      { zeichen: "", bezeichnung: "Ausgeübte Optionsscheine (Anteile)", wert: anzahl.toString() },
      { zeichen: "×", bezeichnung: "Ausübungspreis je Anteil", wert: preis.toString() },
      { zeichen: "=", bezeichnung: "Zu zahlender Betrag (auf Cent, kaufmännisch)", wert: betrag.toString() },
    ],
  };
}
