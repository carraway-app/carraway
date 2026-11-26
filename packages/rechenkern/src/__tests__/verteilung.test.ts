import { describe, expect, it } from "vitest";
import { Decimal, verteileAnteilig } from "../index";

const summe = (teile: Decimal[]) => teile.reduce((s, t) => s.plus(t), new Decimal(0));

describe("verteileAnteilig", () => {
  it("verteilt auf den Cent genau, die Summe ist der Betrag", () => {
    const teile = verteileAnteilig("100.00", ["0.333333", "0.333333", "0.333334"]);
    expect(teile.map((t) => t.toFixed(2))).toEqual(["33.33", "33.33", "33.34"]);
    expect(summe(teile).toFixed(2)).toBe("100.00");
  });

  it("gibt die übrigen Cent an die größten Reste, bei Gleichstand an den niedrigeren Index", () => {
    expect(verteileAnteilig("0.02", [1, 1, 1]).map((t) => t.toFixed(2))).toEqual(["0.01", "0.01", "0.00"]);
    expect(verteileAnteilig("0.01", [0.2, 0.5, 0.3]).map((t) => t.toFixed(2))).toEqual(["0.00", "0.01", "0.00"]);
  });

  it("Anteile müssen nicht 1 ergeben und werden auf ihre Summe bezogen", () => {
    expect(verteileAnteilig("10.00", [35, 25, 20, 12, 8]).map((t) => t.toFixed(2))).toEqual(["3.50", "2.50", "2.00", "1.20", "0.80"]);
  });

  it("negative Beträge werden spiegelbildlich verteilt", () => {
    const teile = verteileAnteilig("-100.00", ["0.333333", "0.333333", "0.333334"]);
    expect(summe(teile).toFixed(2)).toBe("-100.00");
    expect(teile.map((t) => t.toFixed(2))).toEqual(["-33.33", "-33.33", "-33.34"]);
  });

  it("lehnt unzulässige Eingaben ab", () => {
    expect(() => verteileAnteilig("1.005", [1])).toThrow();
    expect(() => verteileAnteilig("1.00", [])).toThrow();
    expect(() => verteileAnteilig("1.00", [0, 0])).toThrow();
    expect(() => verteileAnteilig("1.00", [-1, 2])).toThrow();
  });

  it("Proben: die Summe stimmt immer", () => {
    for (let i = 1; i <= 200; i++) {
      const betrag = new Decimal(i * 1237).div(100).toFixed(2);
      const teile = verteileAnteilig(betrag, [0.35, 0.25, 0.2, 0.12, 0.08]);
      expect(summe(teile).toFixed(2)).toBe(betrag);
    }
  });
});
