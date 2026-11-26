import { describe, expect, it } from "vitest";
import { betragRegel, datumRegel, ganzzahlRegel, prozentRegel, tagNach, waehrungRegel, zahlNormalisiert } from "./feldpruefung";
import { waehrungsOptionen, WAEHRUNGEN } from "./waehrungen";

const de = { sprache: "de" } as const;
const en = { sprache: "en" } as const;
const code = (p: { code: string } | undefined) => p?.code;

describe("zahlNormalisiert", () => {
  it("liest Komma und Tausenderpunkte nach deutscher Schreibweise", () => {
    expect(zahlNormalisiert("1.250,50", "de")).toBe("1250.50");
    expect(zahlNormalisiert("1.250.000", "de")).toBe("1250000");
    expect(zahlNormalisiert("12,5", "de")).toBe("12.5");
    expect(zahlNormalisiert("1 200 000,50", "de")).toBe("1200000.50");
    expect(zahlNormalisiert(",5", "de")).toBe("0.5");
  });
  it("liest Punkt und Tausenderkomma nach englischer Schreibweise", () => {
    expect(zahlNormalisiert("1,250.50", "en")).toBe("1250.50");
    expect(zahlNormalisiert("1,250,000", "en")).toBe("1250000");
    expect(zahlNormalisiert("12.5", "en")).toBe("12.5");
  });
  it("liest ein einzelnes fremdes Trennzeichen als Dezimalzeichen, nie still als Tausender", () => {
    expect(zahlNormalisiert("12.5", "de")).toBe("12.5");
    expect(zahlNormalisiert("1.234", "de")).toBe("1.234");
    expect(zahlNormalisiert("1,234", "en")).toBe("1.234");
  });
  it("lehnt Unbrauchbares ab", () => {
    for (const x of ["abc", "1,2,3", "12.", "-", "1..5", "1e5", ""]) expect(zahlNormalisiert(x, "de")).toBeNull();
  });
});

describe("betragRegel", () => {
  const regel = betragRegel({ vorzeichen: "positiv", pflicht: true });
  it("verlangt bei Pflicht eine Angabe", () => {
    expect(code(regel("", {}, de))).toBe("pflicht");
    expect(code(betragRegel()("", {}, de))).toBeUndefined();
  });
  it("prüft Format, Zeichen und Nachkommastellen wie die API", () => {
    expect(regel("1.250,50", {}, de)).toBeUndefined();
    expect(regel("1250.5", {}, de)).toBeUndefined();
    expect(regel("12,345", {}, de)).toMatchObject({ code: "nachkomma", sofort: true });
    expect(regel("12a", {}, de)).toMatchObject({ code: "zahlFormat", sofort: true });
    expect(regel("12,", {}, de)).toMatchObject({ code: "zahlFormat" });
    expect(regel("12,", {}, de)?.sofort).toBeUndefined();
    expect(code(regel("12345678901234567", {}, de))).toBe("zuGross");
  });
  it("prüft das Vorzeichen je nach Feld", () => {
    expect(code(regel("-5", {}, de))).toBe("negativ");
    expect(code(regel("0", {}, de))).toBe("positivNoetig");
    expect(code(regel("0,00", {}, de))).toBe("positivNoetig");
    expect(betragRegel()("0", {}, de)).toBeUndefined();
    expect(code(betragRegel()("-1", {}, de))).toBe("negativ");
    const mitVorzeichen = betragRegel({ vorzeichen: "ungleichNull" });
    expect(mitVorzeichen("-250,50", {}, de)).toBeUndefined();
    expect(code(mitVorzeichen("0", {}, de))).toBe("nichtNull");
    expect(betragRegel({ vorzeichen: "beliebig" })("-0", {}, de)).toBeUndefined();
  });
  it("kennt die Schreibweise der Sprache", () => {
    expect(regel("1,250.50", {}, en)).toBeUndefined();
    expect(code(regel("1,250.505", {}, en))).toBe("nachkomma");
  });
  it("erlaubt mehr Nachkommastellen, wo die API sie erlaubt (Kurse)", () => {
    const kurs = betragRegel({ vorzeichen: "positiv", nachkomma: 8, ganzstellen: 10 });
    expect(kurs("1,08123456", {}, de)).toBeUndefined();
    expect(code(kurs("1,081234567", {}, de))).toBe("nachkomma");
    expect(code(kurs("12345678901", {}, de))).toBe("zuGross");
  });
});

describe("prozentRegel", () => {
  const regel = prozentRegel({ pflicht: true });
  it("prüft den Bereich 0 bis 100 und vier Nachkommastellen", () => {
    expect(regel("6,5", {}, de)).toBeUndefined();
    expect(regel("0", {}, de)).toBeUndefined();
    expect(regel("100", {}, de)).toBeUndefined();
    expect(regel("0,0001", {}, de)).toBeUndefined();
    expect(regel("100,5", {}, de)).toMatchObject({ code: "bereich", werte: [0, 100] });
    expect(code(regel("-1", {}, de))).toBe("bereich");
    expect(code(regel("1,23456", {}, de))).toBe("nachkomma");
    expect(code(regel("", {}, de))).toBe("pflicht");
    expect(code(regel("x", {}, de))).toBe("zahlFormat");
  });
  it("kennt andere Grenzen", () => {
    expect(prozentRegel({ max: 99.99 })("100", {}, de)?.code).toBe("bereich");
  });
});

describe("ganzzahlRegel", () => {
  it("prüft ganze Zahlen mit Untergrenze", () => {
    const regel = ganzzahlRegel({ min: 1, pflicht: true });
    expect(regel("250", {}, de)).toBeUndefined();
    expect(code(regel("0", {}, de))).toBe("positivNoetig");
    expect(code(regel("1,5", {}, de))).toBe("ganzzahl");
    expect(code(regel("", {}, de))).toBe("pflicht");
    expect(code(regel("-3", {}, de))).toBe("negativ");
    expect(code(regel("1234567890123456789", {}, de))).toBe("zuGross");
  });
});

describe("datumRegel", () => {
  it("prüft Kalenderdatum und Grenzen", () => {
    const regel = datumRegel({ pflicht: true, min: "2021-05-31", max: "2030-12-31" });
    expect(regel("2022-02-28", {}, de)).toBeUndefined();
    expect(code(regel("2022-02-30", {}, de))).toBe("datumFormat");
    expect(code(regel("31.05.2022", {}, de))).toBe("datumFormat");
    expect(regel("2020-01-01", {}, de)).toMatchObject({ code: "datumFrueh", werte: ["2021-05-31"] });
    expect(code(regel("2031-01-01", {}, de))).toBe("datumSpaet");
    expect(code(regel("", {}, de))).toBe("pflicht");
    expect(datumRegel()("", {}, de)).toBeUndefined();
  });
});

describe("waehrungRegel und Währungsliste", () => {
  it("verlangt drei Großbuchstaben", () => {
    const regel = waehrungRegel({ pflicht: true });
    expect(regel("USD", {}, de)).toBeUndefined();
    expect(code(regel("usd", {}, de))).toBe("waehrung");
    expect(code(regel("EURO", {}, de))).toBe("waehrung");
    expect(code(regel("", {}, de))).toBe("pflicht");
  });
  it("bietet die Leitwährungen zuerst und nimmt gespeicherte fremde Codes auf", () => {
    const o = waehrungsOptionen("de", ["XAU", "USD", "xx"]);
    expect(o.slice(0, 4).map((x) => x.code)).toEqual(["EUR", "USD", "GBP", "CHF"]);
    expect(o.find((x) => x.code === "XAU")).toBeTruthy();
    expect(o.find((x) => x.code === "xx")).toBeUndefined();
    expect(o.filter((x) => x.code === "USD")).toHaveLength(1);
    expect(o[1]?.label).toMatch(/^USD – /);
    expect(WAEHRUNGEN.every((c) => /^[A-Z]{3}$/.test(c))).toBe(true);
    expect(new Set(WAEHRUNGEN).size).toBe(WAEHRUNGEN.length);
  });
});

describe("Regeln für Bereiche und Grenzen", () => {
  it("meldet zu kleine und zu große Ganzzahlen als Bereich (Jahre)", () => {
    const jahr = ganzzahlRegel({ min: 1990, max: 2100, stellen: 4, pflicht: true });
    expect(code(jahr("1989", {}, de))).toBe("bereich");
    expect(code(jahr("2101", {}, de))).toBe("bereich");
    expect(jahr("2026", {}, de)).toBeUndefined();
    expect(code(jahr("", {}, de))).toBe("pflicht");
  });
  it("verlangt bei ueberMin einen Wert über der Untergrenze (Anteil größer 0 Prozent)", () => {
    const anteil = prozentRegel({ ueberMin: true });
    expect(code(anteil("0", {}, de))).toBe("bereich");
    expect(anteil("0,5", {}, de)).toBeUndefined();
    expect(anteil("100", {}, de)).toBeUndefined();
    expect(code(anteil("101", {}, de))).toBe("bereich");
  });
  it("kennt den Tag nach einem Datum", () => {
    expect(tagNach("2026-12-31")).toBe("2027-01-01");
    expect(tagNach("2026-02-28")).toBe("2026-03-01");
    expect(tagNach("kein Datum")).toBeUndefined();
  });
});
