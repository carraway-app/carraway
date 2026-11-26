import { describe, expect, it } from "vitest";
import { aufCent, zeitanteil, zinsbetrag } from "../index.js";

// Erwartungswerte unabhängig vom Code nachgerechnet (exakte Brüche, Python `fractions`),
// Beträge und Daten erfunden.

describe("zeitanteil", () => {
  it("30E/360 zählt den 31. als 30. Tag", () => {
    expect(zeitanteil("2026-01-31", "2026-02-28", "30E/360").tage).toBe(28);
  });

  it("30E/360 passt das Monatsende im Februar nicht an", () => {
    expect(zeitanteil("2026-02-28", "2026-03-31", "30E/360").tage).toBe(32);
  });

  it("act/act teilt über den Jahreswechsel in ein Normal- und ein Schaltjahr", () => {
    const anteil = zeitanteil("2027-11-01", "2028-03-01", "act/act");
    expect(anteil.formel).toBe("61 / 365 + 60 / 366");
    expect(anteil.tage).toBe(121);
  });

  it("lehnt ein Ende vor dem Beginn ab", () => {
    expect(() => zeitanteil("2026-05-01", "2026-04-01", "act/360")).toThrow();
  });

  it("lehnt ungültige Daten ab", () => {
    expect(() => zeitanteil("2026-02-30", "2026-03-01", "act/360")).toThrow();
  });

  it("ergibt bei gleichem Beginn und Ende null", () => {
    expect(zeitanteil("2026-04-01", "2026-04-01", "act/act").anteil.toNumber()).toBe(0);
  });
});

describe("zinsbetrag", () => {
  const faelle = [
    { name: "30E/360, halbes Jahr", kapital: 100_000, satz: "0.085", von: "2026-01-15", bis: "2026-07-15", methode: "30E/360", erwartet: "4250.00" },
    { name: "30E/360, krummer Zeitraum", kapital: 250_000, satz: "0.12", von: "2025-03-10", bis: "2025-12-31", methode: "30E/360", erwartet: "24166.67" },
    { name: "act/360, ein Quartal", kapital: 100_000, satz: "0.05", von: "2026-01-01", bis: "2026-04-01", methode: "act/360", erwartet: "1250.00" },
    { name: "act/365, ein Quartal", kapital: 100_000, satz: "0.05", von: "2026-01-01", bis: "2026-04-01", methode: "act/365", erwartet: "1232.88" },
    { name: "act/act, über Schaltjahr", kapital: 100_000, satz: "0.06", von: "2027-11-01", bis: "2028-03-01", methode: "act/act", erwartet: "1986.35" },
  ] as const;

  for (const fall of faelle) {
    it(fall.name, () => {
      const ergebnis = zinsbetrag(fall);
      expect(aufCent(ergebnis.wert).toFixed(2)).toBe(fall.erwartet);
    });
  }

  it("rechnet ungerundet weiter und legt den Rechenweg offen", () => {
    const ergebnis = zinsbetrag({ kapital: 100_000, satz: "0.05", von: "2026-01-01", bis: "2026-04-01", methode: "act/365" });
    expect(ergebnis.wert.toFixed(10)).toBe("1232.8767123288");
    expect(ergebnis.schritte.map((s) => s.zeichen)).toEqual(["", "×", "×", "="]);
    expect(ergebnis.schritte[2]?.bezeichnung).toContain("90 / 365");
  });

  it("lehnt negatives Kapital ab", () => {
    expect(() => zinsbetrag({ kapital: -1, satz: "0.05", von: "2026-01-01", bis: "2026-02-01", methode: "act/360" })).toThrow();
  });
});
