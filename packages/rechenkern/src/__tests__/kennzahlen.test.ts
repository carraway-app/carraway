import { describe, expect, it } from "vitest";
import { beteiligungsMultiple, istRueckfluss, multiples, RUECKFLUSS_ARTEN, xirr } from "../index.js";

// Erwartungswerte unabhängig nachgerechnet (Python: Intervallhalbierung für den IRR, exakte Brüche für Multiples).

describe("xirr", () => {
  it("10 % bei Verdopplungszeit von genau zwei Jahren zu 365 Tagen", () => {
    const r = xirr([
      { datum: "2021-01-01", betrag: -100 },
      { datum: "2023-01-01", betrag: 121 },
    ]);
    expect(r?.toNumber()).toBeCloseTo(0.1, 9);
  });

  it("berücksichtigt den Schalttag (366 Tage gegen Basis 365)", () => {
    const r = xirr([
      { datum: "2020-01-01", betrag: -1000 },
      { datum: "2021-01-01", betrag: 1100 },
    ]);
    expect(r?.toNumber()).toBeCloseTo(0.0997135859, 9);
  });

  it("mehrere Auszahlungen und Rückflüsse, unsortiert übergeben", () => {
    const r = xirr([
      { datum: "2024-12-31", betrag: 5_200_000 },
      { datum: "2019-03-15", betrag: -2_000_000 },
      { datum: "2022-09-01", betrag: 400_000 },
      { datum: "2020-06-30", betrag: -1_500_000 },
    ]);
    expect(r?.toNumber()).toBeCloseTo(0.0969007086, 8);
  });

  it("negativer IRR bei Verlust", () => {
    const r = xirr([
      { datum: "2021-01-01", betrag: -1_000_000 },
      { datum: "2025-01-01", betrag: 600_000 },
    ]);
    expect(r?.toNumber()).toBeCloseTo(-0.1198113290, 8);
  });

  it("ohne Vorzeichenwechsel gibt es keinen IRR", () => {
    expect(xirr([{ datum: "2021-01-01", betrag: -100 }, { datum: "2022-01-01", betrag: -50 }])).toBeNull();
    expect(xirr([{ datum: "2021-01-01", betrag: -100 }])).toBeNull();
  });
});

describe("multiples", () => {
  const werte = { eingezahlt: 41_340_000, ausschuettungen: 10_500_000, nav: 48_200_000 };

  it("TVPI, DPI und RVPI", () => {
    const m = multiples(werte);
    expect(m.tvpi.wert?.toFixed(10)).toBe("1.4199322690");
    expect(m.dpi.wert?.toFixed(10)).toBe("0.2539912917");
    expect(m.rvpi.wert?.toFixed(10)).toBe("1.1659409773");
  });

  it("TVPI ist DPI plus RVPI", () => {
    const m = multiples(werte);
    expect(m.dpi.wert!.plus(m.rvpi.wert!).toFixed(20)).toBe(m.tvpi.wert!.toFixed(20));
  });

  it("legt den Rechenweg offen", () => {
    const schritte = multiples(werte).tvpi.schritte;
    expect(schritte.map((s) => s.bezeichnung)).toEqual(["NAV", "Ausschüttungen kumuliert", "Eingezahltes Kapital", "TVPI"]);
  });

  it("ohne abgerufenes Kapital nicht definiert", () => {
    const m = multiples({ eingezahlt: 0, ausschuettungen: 0, nav: 0 });
    expect(m.tvpi.wert).toBeNull();
    expect(m.tvpi.schritte.at(-1)?.wert).toBe("nicht definiert");
  });

  it("Multiple einer Beteiligung", () => {
    expect(beteiligungsMultiple(5_900_000, 0, 12_400_000).wert?.toFixed(4)).toBe("2.1017");
  });
});

// Erwartungswerte aus referenz/referenz_rueckfluesse.py (Zahlen erfunden).
describe("Rückflüsse einer Beteiligung inklusive gezahlter Zinsen und Dividenden", () => {
  it("zählen: Rückfluss, Tilgung, Zinszahlung, Dividende; nie die Zinsbuchung", () => {
    expect([...RUECKFLUSS_ARTEN]).toEqual(["rueckfluss", "tilgung", "zinszahlung", "dividende"]);
    for (const art of ["rueckfluss", "tilgung", "zinszahlung", "dividende"]) expect(istRueckfluss(art), art).toBe(true);
    for (const art of ["zins", "auszahlung", "zusage", "wertberichtigung"]) expect(istRueckfluss(art), art).toBe(false);
  });

  it("Multiple (100.000 + 1.180.000) ÷ 1.000.000 = 1,28 und IRR 6,89339754 %", () => {
    expect(beteiligungsMultiple(1_000_000, 1_180_000, 100_000).wert?.toFixed(2)).toBe("1.28");
    const r = xirr([
      { datum: "2021-01-01", betrag: -1_000_000 },
      { datum: "2022-01-15", betrag: 60_000 },
      { datum: "2023-06-30", betrag: 20_000 },
      { datum: "2024-01-01", betrag: 200_000 },
      { datum: "2025-01-01", betrag: 900_000 },
      { datum: "2025-06-30", betrag: 100_000 },
    ]);
    expect(r?.toNumber()).toBeCloseTo(0.0689339754, 8);
  });
});
