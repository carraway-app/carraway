import { describe, expect, it } from "vitest";
import { bauAnnahmen, bruchZuProzent, formAusSzenario, leeresFormular, prozentZuBruch } from "./szenario";

const vorlage = { basisStichtag: "2026-11-20", beteiligungen: [{ id: "b1", organisation: "Alpha", instrument: "offene_beteiligung", wert: "100.00", investiert: "80.00" }] } as never;

describe("Prozent und Bruch", () => {
  it.each([
    ["2", "0.02"],
    ["2,5", "0.025"],
    ["2.5", "0.025"],
    ["100", "1"],
    ["0", "0"],
    ["0,01", "0.0001"],
    ["12,3456", "0.123456"],
  ])("%s %% ist der Bruch %s", (eingabe, bruch) => {
    expect(prozentZuBruch(eingabe)).toBe(bruch);
    expect(prozentZuBruch(bruchZuProzent(bruch))).toBe(bruch);
  });
  it("leer ist undefined, Ungültiges ist null", () => {
    expect(prozentZuBruch(" ")).toBeUndefined();
    expect(prozentZuBruch("abc")).toBeNull();
    expect(prozentZuBruch("1,23456")).toBeNull();
    expect(prozentZuBruch("-1")).toBeNull();
  });
  it("zeigt Brüche als Prozent", () => {
    expect(bruchZuProzent("0.02")).toBe("2");
    expect(bruchZuProzent("0.075")).toBe("7.5");
    expect(bruchZuProzent("1")).toBe("100");
    expect(bruchZuProzent("0")).toBe("0");
  });
});

describe("Annahmen aus dem Formular", () => {
  it("baut Exit mit Multiple, Wahrscheinlichkeit und Folgeinvestition und lässt Leeres weg", () => {
    const f = leeresFormular("2026-11-20", vorlage);
    f.satz = "2";
    f.carry = "20";
    f.bisJahr = "2031";
    f.zeilen.b1 = { art: "multiple", jahr: "2030", angabe: "2.5", wahrscheinlichkeit: "70", quote: "", kosten: "", folgeJahr: "2027", folgeBetrag: "250000" };
    const a = bauAnnahmen(f);
    expect(a.gebuehren).toEqual({ basis: "zeichnungskapital", satz: "0.02", bisJahr: 2031, sonstigeJahr: "0" });
    expect(a.carrySatz).toBe("0.2");
    expect(a.beteiligungen).toEqual({ b1: { ausstieg: { art: "exit", jahr: 2030, multiple: "2.5", wahrscheinlichkeit: "0.7", kosten: "0" }, folgeinvestitionen: [{ jahr: 2027, betrag: "250000" }] } });
    expect(bauAnnahmen(leeresFormular("2026-11-20", vorlage)).beteiligungen).toEqual({});
  });
  it("kennt Exit-Wert mit Quote, Abschreibung und liest Gespeichertes zurück ins Formular", () => {
    const f = leeresFormular("2026-11-20", vorlage);
    f.zeilen.b1 = { art: "wert", jahr: "2029", angabe: "4000000", wahrscheinlichkeit: "50", quote: "15", kosten: "100000", folgeJahr: "", folgeBetrag: "" };
    const a = bauAnnahmen(f);
    expect(a.beteiligungen!.b1).toMatchObject({ ausstieg: { art: "exit", wert: "4000000", wahrscheinlichkeit: "0.5", kosten: "100000" }, quote: "0.15" });
    const zurueck = formAusSzenario({ name: "X", basisStichtag: "2026-11-20", annahmen: a }, vorlage);
    expect(zurueck.zeilen.b1).toMatchObject({ art: "wert", jahr: "2029", angabe: "4000000", wahrscheinlichkeit: "50", quote: "15", kosten: "100000" });
    expect(zurueck.satz).toBe("0");
    f.zeilen.b1 = { ...f.zeilen.b1!, art: "abschreibung" };
    expect(bauAnnahmen(f).beteiligungen!.b1!.ausstieg).toEqual({ art: "abschreibung", jahr: 2029 });
  });
});
