import { Decimal } from "./decimal.js";

/**
 * Verteilt einen Betrag anteilig auf Empfänger, auf den Cent genau (Methode des größten Rests): Jeder bekommt den abgerundeten
 * Anteil, die übrigen Cent gehen an die größten Reste, bei Gleichstand an den niedrigeren Index. Die Summe der Teile ist immer
 * genau der Betrag (Kapitalkonten der Investoren ergeben so die Summen des Fonds). Die Anteile müssen nicht 1 ergeben;
 * sie werden auf ihre Summe bezogen. Beträge mit mehr als zwei Nachkommastellen sind nicht zulässig.
 */
export function verteileAnteilig(betrag: Decimal.Value, anteile: readonly Decimal.Value[]): Decimal[] {
  if (anteile.length === 0) throw new Error("Verteilung ohne Empfänger");
  const cent = new Decimal(betrag).times(100);
  if (!cent.isInteger()) throw new Error("Verteilung: Betrag mit mehr als zwei Nachkommastellen");
  const gewichte = anteile.map((a) => new Decimal(a));
  if (gewichte.some((g) => g.isNegative())) throw new Error("Verteilung: negativer Anteil");
  const summe = gewichte.reduce((s, g) => s.plus(g), new Decimal(0));
  if (!summe.greaterThan(0)) throw new Error("Verteilung: Summe der Anteile ist null");

  const vorzeichen = cent.isNegative() ? -1 : 1;
  const absolut = cent.abs();
  const exakt = gewichte.map((g) => absolut.times(g).div(summe));
  const teile = exakt.map((e) => e.floor());
  let rest = absolut.minus(teile.reduce((s, t) => s.plus(t), new Decimal(0))).toNumber();
  const reihenfolge = exakt
    .map((e, i) => ({ i, rest: e.minus(e.floor()) }))
    .sort((a, b) => b.rest.cmp(a.rest) || a.i - b.i);
  for (const { i } of reihenfolge) {
    if (rest <= 0) break;
    teile[i] = (teile[i] as Decimal).plus(1);
    rest--;
  }
  return teile.map((t) => t.times(vorzeichen).div(100));
}
