import { describe, expect, it } from "vitest";
import { geltendeWerte, kpiAbweichung, kpiPeriodenart, kpiVerdichte, kpiZeitraumAus, kpiZeitraumPasst, type KpiZeile } from "../index.js";

// Erwartungswerte aus referenz/referenz_kpi.py (exakte Brüche), Zahlen erfunden.

describe("kpiAbweichung", () => {
  it("A: Umsatz 1.234.567,89 gegen Plan 1.300.000: −65.432,11 und −5,0332392307…", () => {
    const a = kpiAbweichung("betrag", "1234567.89", "1300000.00").wert!;
    expect(a.absolut.toFixed(2)).toBe("-65432.11");
    expect(a.prozent!.toFixed(12)).toBe("-5.033239230769");
  });

  it("B: negativer Plan: weniger negatives Ist ist eine positive Abweichung (+40.000, +33,33 %)", () => {
    const a = kpiAbweichung("betrag", "-80000", "-120000").wert!;
    expect(a.absolut.toFixed(2)).toBe("40000.00");
    expect(a.prozent!.toFixed(12)).toBe("33.333333333333");
  });

  it("C: Plan 0: absolute Abweichung ja, relative nicht definiert", () => {
    const a = kpiAbweichung("zahl", "5000", "0").wert!;
    expect(a.absolut.toFixed(2)).toBe("5000.00");
    expect(a.prozent).toBeNull();
  });

  it("D: Prozent-Kennzahl: Prozentpunkte (−2,5) und relativ −16,67 %", () => {
    const a = kpiAbweichung("prozent", "12.5", "15").wert!;
    expect(a.absolut.toFixed(2)).toBe("-2.50");
    expect(a.prozent!.toFixed(12)).toBe("-16.666666666667");
  });

  it("E: negatives Ist gegen positiven Plan: −12.000 und −120 %", () => {
    const a = kpiAbweichung("betrag", "-2000", "10000").wert!;
    expect(a.absolut.toFixed(2)).toBe("-12000.00");
    expect(a.prozent!.toFixed(2)).toBe("-120.00");
  });

  it("Ja/Nein und Text haben keine Abweichung; die Herkunft nennt die Rechenschritte", () => {
    expect(kpiAbweichung("ja_nein", "ja", "nein").wert).toBeNull();
    expect(kpiAbweichung("text", "a", "b").wert).toBeNull();
    const h = kpiAbweichung("betrag", "10", "8");
    expect(h.schritte.map((s) => s.bezeichnung)).toEqual(["Ist", "Plan", "Abweichung absolut", "Betrag des Plans", "Abweichung relativ in Prozent"]);
    expect(h.schritte[2]!.wert).toBe("2");
  });
});

describe("kpiVerdichte", () => {
  const monate = [
    { periodeBeginn: "2026-03-01", wert: "300.30" },
    { periodeBeginn: "2026-01-01", wert: "100.10" },
    { periodeBeginn: "2026-02-01", wert: "200.20" },
  ];
  it("F: Summe 600,60, Stand 300,30 (letzter nach Beginn, nicht nach Reihenfolge der Eingabe), Durchschnitt 200,20", () => {
    expect(kpiVerdichte("summe", monate).wert!.toFixed(2)).toBe("600.60");
    expect(kpiVerdichte("stand", monate).wert!.toFixed(2)).toBe("300.30");
    expect(kpiVerdichte("durchschnitt", monate).wert!.toFixed(2)).toBe("200.20");
  });
  it("G: Durchschnitt zählt nur vorhandene Zeiträume; ohne Werte kein Wert", () => {
    expect(kpiVerdichte("durchschnitt", [{ periodeBeginn: "2026-01-01", wert: "10" }, { periodeBeginn: "2026-02-01", wert: "15" }]).wert!.toFixed(2)).toBe("12.50");
    expect(kpiVerdichte("summe", []).wert).toBeNull();
  });
});

describe("geltendeWerte", () => {
  const z = (id: string, folge: number, status: KpiZeile["status"], bestaetigtAm: string | null, wert: string, schluessel = "umsatz", szenario: KpiZeile["szenario"] = "ist"): KpiZeile => ({
    id,
    schluessel,
    periodeBeginn: "2026-01-01",
    periodeEnde: "2026-03-31",
    szenario,
    wert,
    status,
    bestaetigtAm,
    folge,
  });

  it("zuletzt bestätigt gewinnt; Entwürfe und Eingereichtes zählen nie", () => {
    const m = geltendeWerte([z("a", 1, "bestaetigt", "2026-04-01T10:00:00Z", "100"), z("b", 2, "bestaetigt", "2026-04-05T10:00:00Z", "110"), z("c", 3, "eingereicht", null, "999"), z("d", 4, "entwurf", null, "888")]);
    expect([...m.values()].map((x) => x.id)).toEqual(["b"]);
  });

  it("bei gleichem Zeitpunkt entscheidet die höhere Folge, unabhängig von der Eingabereihenfolge", () => {
    const zeit = "2026-04-05T10:00:00.000Z";
    const m1 = geltendeWerte([z("alt", 5, "bestaetigt", zeit, "1"), z("neu", 9, "bestaetigt", zeit, "2")]);
    const m2 = geltendeWerte([z("neu", 9, "bestaetigt", zeit, "2"), z("alt", 5, "bestaetigt", zeit, "1")]);
    expect([...m1.values()][0]!.id).toBe("neu");
    expect([...m2.values()][0]!.id).toBe("neu");
  });

  it("Szenarien und Zeiträume bleiben getrennt; mit Stand zählt die Bestätigung bis dahin (Wissensstand)", () => {
    const zeilen = [z("ist", 1, "bestaetigt", "2026-04-01T00:00:00Z", "100"), z("plan", 2, "bestaetigt", "2026-04-01T00:00:00Z", "90", "umsatz", "plan"), z("korr", 3, "bestaetigt", "2026-06-01T00:00:00Z", "105")];
    expect(geltendeWerte(zeilen).size).toBe(2);
    expect([...geltendeWerte(zeilen).values()].find((x) => x.szenario === "ist")!.id).toBe("korr");
    expect([...geltendeWerte(zeilen, "2026-05-01T00:00:00Z").values()].find((x) => x.szenario === "ist")!.id).toBe("ist");
    expect(geltendeWerte(zeilen, new Date("2026-03-01T00:00:00Z")).size).toBe(0);
  });
});

describe("Zeiträume", () => {
  it("erkennt Monat, Quartal und Jahr und lehnt alles andere ab", () => {
    expect(kpiPeriodenart("2026-02-01", "2026-02-28")).toBe("monat");
    expect(kpiPeriodenart("2028-02-01", "2028-02-29")).toBe("monat");
    expect(kpiPeriodenart("2026-04-01", "2026-06-30")).toBe("quartal");
    expect(kpiPeriodenart("2026-01-01", "2026-12-31")).toBe("jahr");
    expect(kpiPeriodenart("2026-02-01", "2026-04-30")).toBeNull();
    expect(kpiPeriodenart("2026-01-01", "2026-03-30")).toBeNull();
    expect(kpiPeriodenart("2026-01-02", "2026-01-31")).toBeNull();
    expect(kpiPeriodenart("2026-01-01", "2027-12-31")).toBeNull();
  });

  it("Kurzschreibweise JJJJ, JJJJ-Qn, JJJJ-MM", () => {
    expect(kpiZeitraumAus("2026")).toEqual({ beginn: "2026-01-01", ende: "2026-12-31", art: "jahr" });
    expect(kpiZeitraumAus("2026-Q3")).toEqual({ beginn: "2026-07-01", ende: "2026-09-30", art: "quartal" });
    expect(kpiZeitraumAus("2026-02")).toEqual({ beginn: "2026-02-01", ende: "2026-02-28", art: "monat" });
    for (const falsch of ["2026-Q5", "2026-13", "26", "2026-Q", "", "2026-1"]) expect(kpiZeitraumAus(falsch)).toBeNull();
  });

  it("ein Zeitraum darf nicht feiner sein als die Erhebung der Kennzahl", () => {
    expect(kpiZeitraumPasst("quartal", "monat")).toBe(true);
    expect(kpiZeitraumPasst("monat", "monat")).toBe(true);
    expect(kpiZeitraumPasst("monat", "quartal")).toBe(false);
    expect(kpiZeitraumPasst("quartal", "jahr")).toBe(false);
  });
});
