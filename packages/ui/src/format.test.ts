import { describe, expect, it } from "vitest";
import { formatBetrag, formatDatum, formatMultiple, formatProzent, waehrungszeichen } from "./format";

const nbsp = (s: string) => s.replaceAll(" ", " ");

describe("Betrag in anderen Währungen (Etappe 21)", () => {
  it("trägt immer das Zeichen der eigenen Währung, nie das des Euro", () => {
    expect(nbsp(formatBetrag(12400000, "de", { waehrung: "USD" }))).toBe("12.400.000 $");
    expect(nbsp(formatBetrag(12400000, "de", { kompakt: true, waehrung: "GBP" }))).toBe("12,4 Mio. £");
    expect(formatBetrag(12400000, "en", { kompakt: true, waehrung: "USD" })).toBe("$12.4m");
    expect(nbsp(formatBetrag(950, "de", { waehrung: "CHF" }))).toContain("CHF");
    expect(nbsp(formatBetrag(950, "de", { waehrung: "EUR" }))).toBe("950 €");
  });
  it("Zeichen der Währung", () => {
    expect(waehrungszeichen("USD", "en")).toBe("$");
    expect(waehrungszeichen("EUR", "de")).toBe("€");
  });
});

describe("Format, Deutsch", () => {
  it("Betrag", () => {
    expect(nbsp(formatBetrag(12400000))).toBe("12.400.000 €");
    expect(nbsp(formatBetrag("950"))).toBe("950 €");
  });
  it("Betrag kompakt", () => {
    expect(nbsp(formatBetrag(12400000, "de", { kompakt: true }))).toBe("12,4 Mio. €");
    expect(nbsp(formatBetrag(12000, "de", { kompakt: true }))).toBe("12.000 €");
  });
  it("Multiple", () => expect(formatMultiple(1.42)).toBe("1,42x"));
  it("Prozent", () => expect(nbsp(formatProzent(8.4))).toBe("8,4 %"));
  it("Datum", () => {
    expect(formatDatum("2026-09-30")).toBe("30.09.2026");
    expect(formatDatum(new Date(2026, 8, 30))).toBe("30.09.2026");
  });
});

describe("Format, Englisch (britisch)", () => {
  it("Betrag", () => expect(formatBetrag(12400000, "en")).toBe("€12,400,000"));
  it("Betrag kompakt", () => expect(formatBetrag(12400000, "en", { kompakt: true })).toBe("€12.4m"));
  it("Multiple", () => expect(formatMultiple(1.42, "en")).toBe("1.42x"));
  it("Prozent", () => expect(formatProzent(8.4, "en")).toBe("8.4%"));
  it("Datum", () => expect(formatDatum("2026-09-30", "en")).toBe("30/09/2026"));
});

it("lehnt ungültige Datumszeichenketten ab", () => {
  expect(() => formatDatum("30.09.2026")).toThrow(RangeError);
});
