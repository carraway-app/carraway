import { describe, expect, it } from "vitest";
import { prognose, type PrognoseEingabe } from "../index.js";

// Erwartungswerte aus referenz/referenz_prognose.py (exakte Brüche, IRR mit Intervallhalbierung), Zahlen erfunden.

const fallA: PrognoseEingabe = {
  basisStichtag: "2026-06-30",
  endJahr: 2029,
  zeichnungskapital: "10000000",
  abgerufen: "4000000",
  ausschuettungen: "0",
  navSonstiges: "0",
  investiertBisher: "3500000",
  rueckfluesseBisher: "0",
  stroemeFonds: [
    { datum: "2024-01-15", betrag: "-2000000" },
    { datum: "2025-03-31", betrag: "-2000000" },
  ],
  stroemeBrutto: [
    { datum: "2024-02-01", betrag: "-1500000" },
    { datum: "2025-04-15", betrag: "-2000000" },
  ],
  beteiligungen: [
    { id: "b1", name: "Nordlicht Robotik", wert: "2500000", investiert: "2000000", folgeinvestitionen: [{ jahr: 2027, betrag: "500000" }], ausstieg: { jahr: 2028, erloes: "8000000", wahrscheinlichkeit: "0.5" } },
    { id: "b2", name: "Feldwerk Software", wert: "1000000", investiert: "1500000", folgeinvestitionen: [], ausstieg: { jahr: 2029, erloes: "3000000", wahrscheinlichkeit: "1" } },
    { id: "b3", name: "Kieselstein Labs", wert: "300000", investiert: "0", folgeinvestitionen: [], ausstieg: null },
  ],
  gebuehren: { basis: "investiert", satz: "0.02", bisJahr: 2028, sonstigeJahr: "50000" },
  carrySatz: "0.2",
  wertpfad: "linear",
};

const fallB: PrognoseEingabe = {
  basisStichtag: "2026-12-31",
  endJahr: 2028,
  zeichnungskapital: "5000000",
  abgerufen: "1000000",
  ausschuettungen: "200000",
  navSonstiges: "50000",
  investiertBisher: "900000",
  rueckfluesseBisher: "200000",
  stroemeFonds: [
    { datum: "2025-06-30", betrag: "-1000000" },
    { datum: "2026-06-30", betrag: "200000" },
  ],
  stroemeBrutto: [
    { datum: "2025-07-01", betrag: "-900000" },
    { datum: "2026-07-01", betrag: "200000" },
  ],
  beteiligungen: [{ id: "x", name: "Brückenbau Systeme", wert: "800000", investiert: "900000", folgeinvestitionen: [{ jahr: 2027, betrag: "100000" }], ausstieg: { jahr: 2028, erloes: "2000000", wahrscheinlichkeit: "1" } }],
  gebuehren: { basis: "zeichnungskapital", satz: "0.015", bisJahr: null, sonstigeJahr: "0" },
  carrySatz: "0",
  wertpfad: "konstant",
};

const zeile = (e: PrognoseEingabe, jahr: number) => {
  const r = prognose(e).wert.jahre.find((j) => j.jahr === jahr && !j.ist)!;
  return {
    invest: r.investitionen.toFixed(2),
    gebuehren: r.gebuehren.toFixed(2),
    erloes: r.ausschuettungenBrutto.toFixed(2),
    carry: r.carry.toFixed(2),
    nav: r.nav.toFixed(2),
    navNetto: r.navNetto.toFixed(2),
    abgerufen: r.abgerufenKum.toFixed(2),
    aus: r.ausschuettungenKum.toFixed(2),
    dpi: r.dpi?.toFixed(4),
    tvpi: r.tvpi?.toFixed(4),
    tvpiBrutto: r.tvpiBrutto?.toFixed(4),
    irrN: r.irrNetto?.toNumber(),
    irrB: r.irrBrutto?.toNumber(),
  };
};

describe("prognose, Fall A (linear, Investiert-Basis, Carry, Wahrscheinlichkeit)", () => {
  it("2026: Gebühren anteilig (184/365), NAV linear, unrealisierter Carry", () => {
    const z = zeile(fallA, 2026);
    expect(z).toMatchObject({ invest: "0.00", gebuehren: "60493.15", nav: "4800000.00", navNetto: "4652098.63", abgerufen: "4060493.15", dpi: "0.0000", tvpi: "1.1457", tvpiBrutto: "1.3714" });
    expect(z.irrN).toBeCloseTo(0.0599755, 6);
    expect(z.irrB).toBeCloseTo(0.15050955, 6);
  });
  it("2027: Folgeinvestition, Gebühren auf die Kostenbasis zu Jahresbeginn", () => {
    expect(zeile(fallA, 2027)).toMatchObject({ invest: "500000.00", gebuehren: "120000.00", nav: "6300000.00", navNetto: "5976098.63", abgerufen: "4680493.15", tvpi: "1.2768", tvpiBrutto: "1.5750" });
  });
  it("2028: Ausstieg mit 50 % Wahrscheinlichkeit", () => {
    const z = zeile(fallA, 2028);
    expect(z).toMatchObject({ gebuehren: "130000.00", erloes: "4000000.00", carry: "0.00", nav: "2800000.00", aus: "4000000.00", dpi: "0.8315", tvpi: "1.3309" });
    expect(z.irrN).toBeCloseTo(0.07704221, 6);
  });
  it("2029: Carry fällt an, keine Gebühren nach bisJahr", () => {
    const z = zeile(fallA, 2029);
    expect(z).toMatchObject({ gebuehren: "0.00", carry: "437901.37", navNetto: "240000.00", aus: "6562098.63", dpi: "1.3641", tvpi: "1.4140", tvpiBrutto: "1.8250" });
    expect(z.irrN).toBeCloseTo(0.08472511, 6);
    expect(z.irrB).toBeCloseTo(0.14812877, 6);
  });
  it("Herkunft nennt Abrufe, Ausschüttungen und Kennzahlen", () => {
    const h = prognose(fallA);
    expect(h.schritte.map((s) => s.bezeichnung)).toContain("IRR (netto, XIRR)");
    expect(h.schritte.find((s) => s.bezeichnung === "Abgerufen zum Prognoseende")!.wert.startsWith("4810493.15068493")).toBe(true);
  });
});

describe("prognose, Fall B (konstant, Zeichnungs-Basis, ohne Carry, Basistag am Jahresende)", () => {
  it("J-Kurve: TVPI sinkt unter 1 durch Gebühren und steigt mit dem Ausstieg", () => {
    expect(zeile(fallB, 2026)).toMatchObject({ gebuehren: "0.00", nav: "850000.00", tvpi: "1.0500", dpi: "0.2000", tvpiBrutto: "1.1667" });
    const z27 = zeile(fallB, 2027);
    expect(z27).toMatchObject({ invest: "100000.00", gebuehren: "75000.00", abgerufen: "1175000.00", tvpi: "0.9787", tvpiBrutto: "1.1500" });
    expect(z27.irrN).toBeCloseTo(-0.01145408, 6);
    const z28 = zeile(fallB, 2028);
    expect(z28).toMatchObject({ erloes: "2000000.00", aus: "2200000.00", dpi: "1.7600", tvpi: "1.8000", tvpiBrutto: "2.2500" });
    expect(z28.irrN).toBeCloseTo(0.23534851, 6);
    expect(z28.irrB).toBeCloseTo(0.30889051, 6);
  });
  it("Ausgangsstand ist die erste Zeile, als Ist markiert", () => {
    const j = prognose(fallB).wert.jahre;
    expect(j[0]).toMatchObject({ ist: true, datum: "2026-12-31" });
    expect(j[0]!.offeneZusage.toFixed(2)).toBe("4000000.00");
    expect(j.length).toBe(4);
  });
});
