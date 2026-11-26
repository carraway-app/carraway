import { describe, expect, it } from "vitest";
import { kapitalkontenMitKosten, pruefeKostenaufteilung, verteileAnteilig, verwaltungsverguetung } from "../index";

// Erwartungswerte aus referenz/referenz_fondskosten.py (exakte Brüche), Beträge erfunden.

describe("verwaltungsverguetung", () => {
  it("rechnet Basis × Satz × Tage / 365 mit beiden Tagen einschließlich", () => {
    const v = verwaltungsverguetung({ basis: "25000000", satzProJahr: "0.02", von: "2026-07-01", bis: "2026-09-30" });
    expect(v.wert.toFixed(2)).toBe("126027.40");
    expect(v.schritte.map((s) => s.wert)).toEqual(["25000000", "0.02", "92/365", "126027.40"]);
  });

  it("rundet halb auf den Cent", () => {
    expect(verwaltungsverguetung({ basis: "12345678.91", satzProJahr: "0.0175", von: "2026-01-01", bis: "2026-01-31" }).wert.toFixed(2)).toBe("18349.40");
  });

  it("lehnt einen Zeitraum mit Ende vor Beginn und Sätze außerhalb von 0 bis 1 ab", () => {
    expect(() => verwaltungsverguetung({ basis: 1, satzProJahr: "0.02", von: "2026-02-01", bis: "2026-01-01" })).toThrow();
    expect(() => verwaltungsverguetung({ basis: 1, satzProJahr: "2", von: "2026-01-01", bis: "2026-01-01" })).toThrow();
  });
});

describe("pruefeKostenaufteilung", () => {
  it("verlangt Centbeträge ohne Vorzeichenwechsel und die genaue Summe", () => {
    expect(pruefeKostenaufteilung("10.00", ["6.00", "4.00"])).toBeNull();
    expect(pruefeKostenaufteilung("10.00", ["6.00", "3.99"])).toBe("summe");
    expect(pruefeKostenaufteilung("10.00", ["11.00", "-1.00"])).toBe("negativ");
    expect(pruefeKostenaufteilung("10.00", ["6.005", "3.995"])).toBe("nachkommastellen");
  });
});

describe("kapitalkontenMitKosten", () => {
  const gewichte = ["50", "30", "20"];
  const konten = [
    { eingezahlt: "500000.00", ausgeschuettet: "0.00" },
    { eingezahlt: "300000.00", ausgeschuettet: "0.00" },
    { eingezahlt: "200000.00", ausgeschuettet: "0.00" },
  ];

  it("lässt die NAV-Anteile bei rein anteiligen Kosten unverändert", () => {
    const teile = verteileAnteilig("1000.01", gewichte).map((t) => t.toFixed(2));
    expect(teile).toEqual(["500.01", "300.00", "200.00"]);
    const ohne = kapitalkontenMitKosten("1000000.00", gewichte, konten, []);
    const mit = kapitalkontenMitKosten("1000000.00", gewichte, konten, [{ id: "k1", art: "fondskosten", teile }]);
    expect(mit.map((k) => k.navAnteil)).toEqual(ohne.map((k) => k.navAnteil));
    expect(mit.map((k) => k.kostenausgleich)).toEqual(["0.00", "0.00", "0.00"]);
    expect(mit.map((k) => k.fondskosten)).toEqual(teile);
  });

  it("gleicht abweichend verteilte Kosten im NAV-Anteil aus, die Summe bleibt der NAV", () => {
    const k = kapitalkontenMitKosten("1000000.00", gewichte, konten, [
      { id: "k1", art: "fondskosten", teile: ["500.01", "300.00", "200.00"] },
      { id: "k2", art: "verwaltungsverguetung", teile: ["600.00", "400.00", "0.00"] },
    ]);
    expect(k.map((x) => x.kostenausgleich)).toEqual(["-100.00", "-100.00", "200.00"]);
    expect(k.map((x) => x.navAnteil)).toEqual(["499900.00", "299900.00", "200200.00"]);
    expect(k.map((x) => x.verwaltungsverguetung)).toEqual(["600.00", "400.00", "0.00"]);
    // Fortschreibung: 500.000 − 0 − 600 − 500,01 + Ergebnis = 499.900
    expect(k[0]!.ergebnisanteil).toBe("1000.01");
    expect(k[0]!.schritte.at(-3)).toMatchObject({ zeichen: "=", bezeichnung: "NAV-Anteil", wert: "499900.00" });
  });

  it("gibt Investoren mit Gewicht null weder NAV noch Ausgleich", () => {
    const k = kapitalkontenMitKosten("900.00", ["1", "1", "0"], konten, [{ id: "k1", art: "fondskosten", teile: ["10.00", "0.00", "5.00"] }]);
    expect(k.map((x) => x.navAnteil)).toEqual(["445.00", "455.00", "0.00"]);
    expect(k[2]!.fondskosten).toBe("5.00");
  });

  it("rechnet ohne NAV nur die Kosten", () => {
    const k = kapitalkontenMitKosten(null, gewichte, konten, [{ id: "k1", art: "verwaltungsverguetung", teile: ["1.00", "1.00", "1.00"] }]);
    expect(k.map((x) => [x.navAnteil, x.ergebnisanteil, x.verwaltungsverguetung])).toEqual([[null, null, "1.00"], [null, null, "1.00"], [null, null, "1.00"]]);
  });
});
