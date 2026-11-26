import { describe, expect, it } from "vitest";
import { wandlung, type WandlungEingabe } from "../index.js";

// Erwartungswerte aus referenz/referenz_zinsen.py (exakte Brüche), Beträge erfunden.
// Basis: 100.000 ausgezahlt am 01.01.2026, 6 % p. a. nach 30E/360, Cut-off 01.07.2026:
// 100.000 × 0,06 × 180 / 360 = 3.000 Zinsen.

const basis: WandlungEingabe = {
  bewegungen: [{ datum: "2026-01-01", art: "auszahlung", betrag: 100_000 }],
  bedingungen: { satzFix: "0.06", methode: "30E/360" },
  cutoff: "2026-07-01",
  zinsenWandeln: true,
  preisregel: { rundenpreisJeAnteil: "12.5", discount: "0.2" },
  nennwertJeAnteil: 1,
};

describe("wandlung", () => {
  it("nur Abschlag: 12,50 × 0,8 = 10,00, Zinsen werden mitgewandelt", () => {
    const e = wandlung(basis);
    expect(e.aufgelaufeneZinsen.toFixed(8)).toBe("3000.00000000");
    expect(e.wandlungsbetrag.toString()).toBe("103000");
    expect(e.preisJeAnteil.toString()).toBe("10");
    expect(e.massgeblich).toBe("abschlag");
    expect(e.anzahlAnteile.toString()).toBe("10300");
    expect(e.spitzenbetrag.toString()).toBe("0");
    expect(e.nominal.toString()).toBe("10300");
    expect(e.agio.toString()).toBe("92700");
    expect(e.buchungen.map((b) => [b.art, b.betrag.toString()])).toEqual([
      ["zinsen", "3000"],
      ["darlehen_erloschen", "100000"],
      ["anteile", "103000"],
    ]);
    expect(e.schritte.length).toBeGreaterThan(5);
  });

  it("Bewertungsobergrenze greift: 4.000.000 ÷ 500.000 = 8,00 statt 10,00", () => {
    const e = wandlung({
      ...basis,
      preisregel: { rundenpreisJeAnteil: "12.5", discount: "0.2", bewertungsobergrenze: { betrag: 4_000_000, anteileVorRunde: 500_000 } },
    });
    expect(e.massgeblich).toBe("bewertungsobergrenze");
    expect(e.preisJeAnteil.toString()).toBe("8");
    expect(e.anzahlAnteile.toString()).toBe("12875");
    expect(e.agio.toString()).toBe("90125");
  });

  it("Obergrenze über dem Abschlagspreis bleibt wirkungslos", () => {
    const e = wandlung({
      ...basis,
      preisregel: { rundenpreisJeAnteil: "12.5", discount: "0.2", bewertungsobergrenze: { betrag: 6_000_000, anteileVorRunde: 500_000 } },
    });
    expect(e.massgeblich).toBe("abschlag");
    expect(e.preisJeAnteil.toString()).toBe("10");
  });

  it("Zinsen werden ausgezahlt, Spitzenbetrag bleibt übrig: 100.000 ÷ 7,30 = 13.698 Anteile, Rest 4,60", () => {
    const e = wandlung({
      ...basis,
      zinsenWandeln: false,
      preisregel: { rundenpreisJeAnteil: "12.5", discount: "0.2", bewertungsobergrenze: { betrag: 3_650_000, anteileVorRunde: 500_000 } },
    });
    expect(e.preisJeAnteil.toString()).toBe("7.3");
    expect(e.wandlungsbetrag.toString()).toBe("100000");
    expect(e.anzahlAnteile.toString()).toBe("13698");
    expect(e.spitzenbetrag.toString()).toBe("4.6");
    expect(e.nominal.toString()).toBe("13698");
    expect(e.agio.toString()).toBe("86297.4");
    expect(e.nominal.plus(e.agio).plus(e.spitzenbetrag).toString()).toBe("100000");
    // Anteile buchen Nominal plus Agio: 13.698 + 86.297,40 = 99.995,40; dazu 4,60 Spitzenbetrag = 100.000.
    expect(e.buchungen.map((b) => [b.art, b.betrag.toString()])).toEqual([
      ["zinsen", "3000"],
      ["darlehen_erloschen", "100000"],
      ["anteile", "99995.4"],
      ["zinsauszahlung", "3000"],
      ["spitzenauszahlung", "4.6"],
    ]);
    expect(e.buchungen[2]?.anzahlAnteile?.toString()).toBe("13698");
  });

  it("berücksichtigt Kapitalisierung und bereits gebuchte Zinsen über zinsenAb", () => {
    const e = wandlung({
      ...basis,
      bewegungen: [
        { datum: "2026-01-01", art: "auszahlung", betrag: 100_000 },
        { datum: "2026-04-01", art: "kapitalisierung", betrag: 1_500 },
      ],
      zinsenAb: "2026-04-01",
    });
    // 101.500 × 0,06 × 90 / 360 = 1.522,50 (von Hand: 101.500 × 0,06 / 4)
    expect(e.restkapital.toString()).toBe("101500");
    expect(e.aufgelaufeneZinsen.toFixed(8)).toBe("1522.50000000");
  });

  it("vertraglich abweichende Beträge: gewandelt wird nur der vereinbarte Teil, der Rest steht getrennt", () => {
    // Darlehen 100.000 (davon 90.000 gewandelt), Zinsen 3.000 (davon 2.000 gewandelt), Preis 10,00: 92.000 ÷ 10 = 9.200 Anteile
    const e = wandlung({ ...basis, gewandeltesDarlehen: 90_000, gewandelteZinsen: 2_000 });
    expect(e.restkapital.toString()).toBe("100000");
    expect(e.zinsenGebucht.toString()).toBe("3000");
    expect(e.darlehenGewandelt.toString()).toBe("90000");
    expect(e.zinsenGewandelt.toString()).toBe("2000");
    expect(e.darlehenRest.toString()).toBe("10000");
    expect(e.zinsenRest.toString()).toBe("1000");
    expect(e.wandlungsbetrag.toString()).toBe("92000");
    expect(e.anzahlAnteile.toString()).toBe("9200");
    expect(e.spitzenbetrag.toString()).toBe("0");
    expect(e.agio.toString()).toBe("82800");
  });

  it("abweichende Beträge: Spitzenbetrag entsteht aus dem gewandelten Betrag, nicht aus dem Restkapital", () => {
    const e = wandlung({ ...basis, zinsenWandeln: false, gewandeltesDarlehen: 50_003 });
    expect(e.wandlungsbetrag.toString()).toBe("50003");
    expect(e.anzahlAnteile.toString()).toBe("5000");
    expect(e.spitzenbetrag.toString()).toBe("3");
    expect(e.darlehenRest.toString()).toBe("49997");
    expect(e.zinsenRest.toString()).toBe("0");
  });

  it("ohne Angabe bleibt alles wie errechnet, der Rest ist null", () => {
    const e = wandlung(basis);
    expect(e.darlehenGewandelt.toString()).toBe("100000");
    expect(e.zinsenGewandelt.toString()).toBe("3000");
    expect(e.darlehenRest.toString()).toBe("0");
    expect(e.zinsenRest.toString()).toBe("0");
  });

  it("Fehler bei abweichenden Beträgen: über dem Stand, negativ, Zinsen ohne Zinswandlung, nichts gewandelt", () => {
    expect(() => wandlung({ ...basis, gewandeltesDarlehen: 100_001 })).toThrow(/Gewandeltes Darlehen/);
    expect(() => wandlung({ ...basis, gewandeltesDarlehen: -1 })).toThrow(/Gewandeltes Darlehen/);
    expect(() => wandlung({ ...basis, gewandelteZinsen: 3_001 })).toThrow(/Gewandelte Zinsen/);
    expect(() => wandlung({ ...basis, zinsenWandeln: false, gewandelteZinsen: 1 })).toThrow(/nicht gewandelt/);
    expect(() => wandlung({ ...basis, gewandeltesDarlehen: 0, gewandelteZinsen: 0 })).toThrow(/größer als null/);
  });

  it("Fehler: Cut-off vor der ersten Auszahlung", () => {
    expect(() => wandlung({ ...basis, cutoff: "2025-12-31" })).toThrow(/vor der ersten Auszahlung/);
  });

  it("Fehler: negatives Kapital, Bewegung nach dem Cut-off, kein Kapital offen", () => {
    expect(() =>
      wandlung({
        ...basis,
        bewegungen: [
          { datum: "2026-01-01", art: "auszahlung", betrag: 1000 },
          { datum: "2026-02-01", art: "tilgung", betrag: 2000 },
        ],
      }),
    ).toThrow(/negativ/);
    expect(() =>
      wandlung({ ...basis, bewegungen: [...basis.bewegungen, { datum: "2026-09-01", art: "auszahlung", betrag: 5 }] }),
    ).toThrow(/nach dem Cut-off/);
    expect(() =>
      wandlung({ ...basis, bewegungen: [...basis.bewegungen, { datum: "2026-03-01", art: "tilgung", betrag: 100_000 }] }),
    ).toThrow(/kein Kapital/);
  });

  it("Fehler: ungültiger Abschlag", () => {
    expect(() => wandlung({ ...basis, preisregel: { rundenpreisJeAnteil: 10, discount: 1 } })).toThrow(/Abschlag/);
  });
});
