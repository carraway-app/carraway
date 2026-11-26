import { describe, expect, it } from "vitest";
import { allokation, letzteMeldung, portfolioSummen, zielfondsKennzahlen, zielfondsWert, type ZielfondsBewegung, type ZielfondsMeldung } from "../index.js";

// Erwartungswerte von Hand nachgerechnet (exakte Dezimalzahlen).

const bewegungen: ZielfondsBewegung[] = [
  { id: "z1", art: "zusage", valuta: "2022-01-15", betrag: "5000000.00" },
  { id: "a1", art: "abruf", valuta: "2022-03-01", betrag: "1000000.00" },
  { id: "a2", art: "abruf", valuta: "2023-02-01", betrag: "750000.00" },
  { id: "d1", art: "ausschuettung", valuta: "2023-09-15", betrag: "200000.00" },
  { id: "a3", art: "abruf", valuta: "2024-02-01", betrag: "500000.00" },
];

const meldungen: ZielfondsMeldung[] = [
  { id: "m1", stichtag: "2022-12-31", nav: "1050000.00", anteil: null, folge: 1 },
  { id: "m2", stichtag: "2023-06-30", nav: "1900000.00", anteil: "0.1", folge: 2 },
  // Korrektur derselben Meldung (später erfasst): sie gilt.
  { id: "m3", stichtag: "2023-06-30", nav: "1880000.00", anteil: "0.1", folge: 3 },
];

describe("zielfondsWert", () => {
  it("schreibt die letzte NAV-Meldung mit späteren Abrufen und Ausschüttungen fort", () => {
    const w = zielfondsWert({ bezeichnung: "Zielfonds A", stichtag: "2024-03-31", bewegungen, meldungen });
    // 1.880.000 + 500.000 (Abruf 2024-02-01) − 200.000 (Ausschüttung 2023-09-15) = 2.180.000
    expect(w.methode).toBe("nav_meldung");
    expect(w.meldungId).toBe("m3");
    expect(w.wert.toFixed(2)).toBe("2180000.00");
    expect(w.schritte.at(-1)).toMatchObject({ zeichen: "=", wert: "2180000.00" });
    expect(w.schritte[1]!.quellen).toEqual(["a3"]);
    expect(w.schritte[2]!.quellen).toEqual(["d1"]);
  });

  it("zählt Bewegungen am Meldestichtag nicht doppelt (sie stecken in der Meldung)", () => {
    const w = zielfondsWert({ bezeichnung: "A", stichtag: "2023-01-31", bewegungen: [...bewegungen, { id: "a0", art: "abruf", valuta: "2022-12-31", betrag: "10.00" }], meldungen });
    expect(w.wert.toFixed(2)).toBe("1050000.00");
  });

  it("rechnet einen eigenen Zielfonds mit gemeldetem Anteil durch (NAV × Anteil, auf Cent gerundet)", () => {
    const w = zielfondsWert({ bezeichnung: "A", stichtag: "2024-03-31", bewegungen, meldungen, zielNav: "21800003.33" });
    expect(w.methode).toBe("durchrechnung");
    expect(w.wert.toFixed(2)).toBe("2180000.33");
    expect(w.schritte[1]).toMatchObject({ zeichen: "×", wert: "0.1", quellen: ["m3"] });
  });

  it("fällt ohne NAV des Zielfonds auf die Fortschreibung zurück", () => {
    expect(zielfondsWert({ bezeichnung: "A", stichtag: "2024-03-31", bewegungen, meldungen, zielNav: null }).methode).toBe("nav_meldung");
  });

  it("nimmt ohne Meldung die fortgeführten Anschaffungskosten, nicht unter null", () => {
    const w = zielfondsWert({ bezeichnung: "A", stichtag: "2022-06-30", bewegungen, meldungen });
    expect(w.methode).toBe("anschaffungskosten");
    expect(w.wert.toFixed(2)).toBe("1000000.00");
    const negativ = zielfondsWert({ bezeichnung: "A", stichtag: "2025-01-01", bewegungen: [{ id: "a", art: "abruf", valuta: "2024-01-01", betrag: "100" }, { id: "d", art: "ausschuettung", valuta: "2024-06-01", betrag: "250" }], meldungen: [] });
    expect(negativ.wert.toFixed(2)).toBe("0.00");
  });

  it("ignoriert Meldungen nach dem Stichtag", () => {
    expect(letzteMeldung(meldungen, "2023-03-31", "nav")?.id).toBe("m1");
    expect(letzteMeldung(meldungen, "2023-03-31", "anteil")).toBeNull();
  });
});

describe("zielfondsKennzahlen", () => {
  it("liefert Zusage, Abrufe, offene Zusage, Ausschüttungen, DPI und TVPI mit Herkunft", () => {
    const k = zielfondsKennzahlen({ bezeichnung: "A", stichtag: "2024-03-31", bewegungen, meldungen });
    expect(k.zusage.wert.toFixed(2)).toBe("5000000.00");
    expect(k.abgerufen.wert.toFixed(2)).toBe("2250000.00");
    expect(k.offeneZusage.wert.toFixed(2)).toBe("2750000.00");
    expect(k.ausgeschuettet.wert.toFixed(2)).toBe("200000.00");
    // DPI = 200.000 / 2.250.000 = 0,0888…; TVPI = (2.180.000 + 200.000) / 2.250.000 = 1,05777…
    expect(k.dpi.wert!.toFixed(6)).toBe("0.088889");
    expect(k.tvpi.wert!.toFixed(6)).toBe("1.057778");
    expect(k.irr.wert).not.toBeNull();
    expect(k.zusage.schritte[0]!.quellen).toEqual(["z1"]);
  });

  it("hat ohne Abrufe keine Multiples", () => {
    const k = zielfondsKennzahlen({ bezeichnung: "A", stichtag: "2022-02-01", bewegungen, meldungen });
    expect(k.dpi.wert).toBeNull();
    expect(k.tvpi.wert).toBeNull();
    expect(k.irr.wert).toBeNull();
  });
});

describe("portfolioSummen", () => {
  const fonds = [
    { fondsId: "D", bezeichnung: "Dachfonds", zusage: "20000000", eingezahlt: "8000000", ausschuettungen: "500000", nav: "9000000" },
    { fondsId: "Z", bezeichnung: "Zielfonds", zusage: "50000000", eingezahlt: "30000000", ausschuettungen: "4000000", nav: "40000000" },
  ];
  const intern = [{ id: "i1", vonFondsId: "D", zielFondsId: "Z", bezeichnung: "Anteil an Z", alsInvestorErfasst: true, zusage: "5000000", abgerufen: "3000000", ausgeschuettet: "400000", wert: "4000000" }];

  it("zieht Anteile an eigenen Zielfonds ab, wenn beide Fonds in der Summe stehen", () => {
    const s = portfolioSummen(fonds, intern);
    expect(s.bereinigt).toEqual(["i1"]);
    expect(s.zusage.wert!.toString()).toBe("65000000");
    expect(s.eingezahlt.wert!.toString()).toBe("35000000");
    expect(s.ausschuettungen.wert!.toString()).toBe("4100000");
    expect(s.nav.wert!.toString()).toBe("45000000");
    // TVPI = (45.000.000 + 4.100.000) / 35.000.000 = 1,402857…
    expect(s.tvpi.wert!.toFixed(6)).toBe("1.402857");
    expect(s.nav.schritte.find((x) => x.zeichen === "−")).toMatchObject({ wert: "4000000", quellen: ["i1"] });
  });

  it("zieht ohne Erfassung als Investor nur den Wert ab, nicht die Zahlungen", () => {
    const s = portfolioSummen(fonds, [{ ...intern[0]!, alsInvestorErfasst: false }]);
    expect(s.eingezahlt.wert!.toString()).toBe("38000000");
    expect(s.zusage.wert!.toString()).toBe("70000000");
    expect(s.nav.wert!.toString()).toBe("45000000");
    expect(s.eingezahlt.schritte.some((x) => x.zeichen === "−")).toBe(false);
  });

  it("rechnet nichts heraus, wenn der Zielfonds nicht in der Summe steht", () => {
    const s = portfolioSummen([fonds[0]!], intern);
    expect(s.bereinigt).toEqual([]);
    expect(s.nav.wert!.toString()).toBe("9000000");
  });

  it("macht die Summe bei einer Lücke zur Lücke", () => {
    const s = portfolioSummen([fonds[0]!, { ...fonds[1]!, nav: null }], intern);
    expect(s.nav.wert).toBeNull();
    expect(s.tvpi.wert).toBeNull();
    expect(s.dpi.wert).not.toBeNull();
  });
});

describe("allokation", () => {
  it("summiert je Gruppe und rechnet Anteile an der Gesamtsumme", () => {
    const a = allokation([
      { gruppe: "Software", investiert: "100", zeitwert: "300" },
      { gruppe: "Energie", investiert: "200", zeitwert: "100" },
      { gruppe: "Software", investiert: "100", zeitwert: "0" },
    ]);
    expect(a.investiert!.toString()).toBe("400");
    expect(a.zeitwert!.toString()).toBe("400");
    expect(a.gruppen.map((g) => g.gruppe)).toEqual(["Software", "Energie"]);
    expect(a.gruppen[0]).toMatchObject({ anzahl: 2 });
    expect(a.gruppen[0]!.anteilZeitwert!.toString()).toBe("0.75");
    expect(a.gruppen[1]!.anteilInvestiert!.toString()).toBe("0.5");
  });

  it("hat bei einer Lücke keine Summe und keine Anteile dieser Größe", () => {
    const a = allokation([
      { gruppe: "A", investiert: "100", zeitwert: null },
      { gruppe: "B", investiert: "100", zeitwert: "50" },
    ]);
    expect(a.zeitwert).toBeNull();
    expect(a.gruppen.every((g) => g.anteilZeitwert === null)).toBe(true);
    expect(a.gruppen[0]!.anteilInvestiert!.toString()).toBe("0.5");
    expect(a.gruppen.map((g) => g.gruppe)).toEqual(["B", "A"]);
  });
});
