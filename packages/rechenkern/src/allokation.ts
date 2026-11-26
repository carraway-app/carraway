import { Decimal } from "./decimal.js";

/**
 * Allokation eines Portfolios nach einem Merkmal (Sektor, Land, Phase, Fonds) als reine Rechnung. Jede Position trägt ihr investiertes Kapital und ihren
 * Zeitwert in derselben Währung; `null` ist eine Lücke (Kurs fehlt). Eine Gruppe mit einer Lücke hat in dieser Größe keine Summe, und dann gibt es auch keine
 * Anteile für diese Größe (die Anteile beruhen auf der Gesamtsumme). Anteile sind ungerundete Brüche (0.25 = 25 %).
 */

export interface AllokationPosition {
  gruppe: string;
  investiert: Decimal.Value | null;
  zeitwert: Decimal.Value | null;
}

export interface AllokationGruppe {
  gruppe: string;
  anzahl: number;
  investiert: Decimal | null;
  zeitwert: Decimal | null;
  anteilInvestiert: Decimal | null;
  anteilZeitwert: Decimal | null;
}

export interface Allokation {
  gruppen: AllokationGruppe[];
  investiert: Decimal | null;
  zeitwert: Decimal | null;
}

const plus = (a: Decimal | null, b: Decimal.Value | null) => (a === null || b === null ? null : a.plus(b));

/** Gruppen absteigend nach Zeitwert (Lücken zuletzt), bei Gleichstand nach Namen. */
export function allokation(positionen: readonly AllokationPosition[]): Allokation {
  const gruppen = new Map<string, { anzahl: number; investiert: Decimal | null; zeitwert: Decimal | null }>();
  for (const p of positionen) {
    const g = gruppen.get(p.gruppe) ?? { anzahl: 0, investiert: new Decimal(0), zeitwert: new Decimal(0) };
    gruppen.set(p.gruppe, { anzahl: g.anzahl + 1, investiert: plus(g.investiert, p.investiert), zeitwert: plus(g.zeitwert, p.zeitwert) });
  }
  let investiert: Decimal | null = new Decimal(0);
  let zeitwert: Decimal | null = new Decimal(0);
  for (const g of gruppen.values()) {
    investiert = plus(investiert, g.investiert);
    zeitwert = plus(zeitwert, g.zeitwert);
  }
  const anteil = (teil: Decimal | null, ganz: Decimal | null) => (teil === null || ganz === null || ganz.isZero() ? null : teil.div(ganz));
  const liste = [...gruppen.entries()].map(([gruppe, g]) => ({
    gruppe,
    anzahl: g.anzahl,
    investiert: g.investiert,
    zeitwert: g.zeitwert,
    anteilInvestiert: anteil(g.investiert, investiert),
    anteilZeitwert: anteil(g.zeitwert, zeitwert),
  }));
  liste.sort((a, b) => {
    if (a.zeitwert === null || b.zeitwert === null) return a.zeitwert === b.zeitwert ? a.gruppe.localeCompare(b.gruppe) : a.zeitwert === null ? 1 : -1;
    return b.zeitwert.comparedTo(a.zeitwert) || a.gruppe.localeCompare(b.gruppe);
  });
  return { gruppen: liste, investiert, zeitwert };
}
