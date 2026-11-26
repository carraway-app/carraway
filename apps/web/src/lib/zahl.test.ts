import { describe, expect, it } from "vitest";
import { anteilZuProzent, formatBetragCent, formatSatz, prozentZuAnteil } from "./zahl";

it("bewahrt die Centstellen großer Einzelbeträge in Fondswährung", () => {
  expect(formatBetragCent("9999999999999999.01", "de", "CHF")).toContain("9.999.999.999.999.999,01");
});

describe("Prozent und Anteil", () => {
  it("verschiebt die Stellen im Text, ohne Gleitkomma", () => {
    expect(prozentZuAnteil("6")).toBe("0.06");
    expect(prozentZuAnteil("6,5")).toBe("0.065");
    expect(prozentZuAnteil("20")).toBe("0.2");
    expect(prozentZuAnteil("100")).toBe("1");
    expect(prozentZuAnteil("0,000001")).toBe("0.00000001");
    expect(prozentZuAnteil("1.1")).toBe("0.011");
    expect(prozentZuAnteil("")).toBe("");
    expect(prozentZuAnteil("abc")).toBe("abc");
  });
  it("kehrt um und formatiert je Sprache", () => {
    expect(anteilZuProzent("0.065000")).toBe("6.5");
    expect(anteilZuProzent("1.000000")).toBe("100");
    expect(anteilZuProzent("0.000000")).toBe("0");
    expect(anteilZuProzent(null)).toBe("");
    expect(formatSatz("0.065000", "de")).toBe("6,5\u00A0%");
    expect(formatSatz("0.065000", "en")).toBe("6.5%");
    expect(formatSatz(null, "de")).toBe("–");
  });
});
