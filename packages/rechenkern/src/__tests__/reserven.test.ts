import { describe, expect, it } from "vitest";
import { berechneReserven, type ReservenEingabe } from "../index.js";

// Erwartungswerte aus referenz/referenz_reserven.py (exakte Brüche, kaufmännisch auf Cent gerundet), Zahlen erfunden.

const fallA: ReservenEingabe = {
  zeichnungskapital: "10000000",
  abgerufen: "2500000",
  investiert: "2300000",
  gebuehrenPrognose: "300000.50",
  reserven: [
    { beteiligungId: "b1", status: "aktiv", geplant: "1000000", verbraucht: "250000.25" },
    { beteiligungId: "b2", status: "aktiv", geplant: "400000", verbraucht: "450000" },
  ],
};
const fallB: ReservenEingabe = {
  zeichnungskapital: "5000000.00",
  abgerufen: "1200000.10",
  investiert: "1250000.33",
  gebuehrenPrognose: "0",
  reserven: [
    { beteiligungId: "x", status: "exit", geplant: "300000.99", verbraucht: "0" },
    { beteiligungId: "y", status: "aktiv", geplant: "200000.07", verbraucht: "100000.01" },
    { beteiligungId: "z", status: "insolvent", geplant: "50000", verbraucht: "10000" },
  ],
};
const fallC: ReservenEingabe = {
  zeichnungskapital: "1000000",
  abgerufen: "700000",
  investiert: "650000",
  gebuehrenPrognose: "150000",
  reserven: [{ beteiligungId: "n", status: "aktiv", geplant: "400000", verbraucht: "50000.50" }],
};
const fallD: ReservenEingabe = { zeichnungskapital: "2000000", abgerufen: "0", investiert: "0", gebuehrenPrognose: "0", reserven: [] };

describe("Reserven und verfügbarer Betrag", () => {
  it("Fall A: Abrufe größer als investiert, eine Reserve teilweise, eine ganz verbraucht (kein negativer Rest)", () => {
    const r = berechneReserven(fallA);
    expect(r.zeilen).toEqual([
      { beteiligungId: "b1", geplant: "1000000.00", verbraucht: "250000.25", offen: "749999.75" },
      { beteiligungId: "b2", geplant: "400000.00", verbraucht: "450000.00", offen: "0.00" },
    ]);
    expect(r).toMatchObject({ summeGeplant: "1400000.00", summeOffen: "749999.75", belegt: "2500000.00", gebuehrenPrognose: "300000.50", verfuegbar: "6449999.75" });
  });

  it("Fall B: investiert größer als abgerufen; nur aktive Beteiligungen binden ihre Reserve", () => {
    const r = berechneReserven(fallB);
    expect(r.zeilen.map((z) => z.offen)).toEqual(["0.00", "100000.06", "0.00"]);
    expect(r).toMatchObject({ summeGeplant: "550001.06", summeOffen: "100000.06", belegt: "1250000.33", gebuehrenPrognose: "0.00", verfuegbar: "3649999.61" });
  });

  it("Fall C: verfügbar kann negativ sein", () => {
    expect(berechneReserven(fallC)).toMatchObject({ summeOffen: "349999.50", belegt: "700000.00", verfuegbar: "-199999.50" });
  });

  it("Fall D: ohne Reserven gilt Zeichnungskapital − belegt − Gebühren", () => {
    expect(berechneReserven(fallD)).toMatchObject({ zeilen: [], summeGeplant: "0.00", summeOffen: "0.00", belegt: "0.00", verfuegbar: "2000000.00" });
  });

  it("Rechenweg nennt die Posten in Lesereihenfolge mit den ungerundeten Werten", () => {
    const r = berechneReserven(fallA);
    expect(r.schritte.map((s) => `${s.zeichen} ${s.bezeichnung}: ${s.wert}`)).toEqual([
      " Zeichnungskapital: 10000000",
      "− Belegt (das Größere aus abgerufen und investiert): 2500000",
      "− Offene Reserven der aktiven Beteiligungen: 749999.75",
      "− Gebührenprognose des Szenarios: 300000.5",
      "= Verfügbar für Neuinvestments: 6449999.75",
    ]);
  });

  it("Beträge mit mehr als zwei Nachkommastellen: erst gerechnet, dann kaufmännisch gerundet", () => {
    const r = berechneReserven({ zeichnungskapital: "1000.005", abgerufen: "0", investiert: "0", gebuehrenPrognose: "0", reserven: [] });
    expect(r.verfuegbar).toBe("1000.01");
  });
});
