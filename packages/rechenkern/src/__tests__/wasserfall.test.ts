import { describe, expect, it } from "vitest";
import { Decimal, rundeGroessterRest, wasserfall, wasserfallBeiEntscheidung, wasserfallKnicke, wasserfallKurve, type WasserfallEingabe } from "../index.js";
import { REFERENZ_FAELLE, REFERENZ_KNICKE } from "./wasserfall.referenz.js";

// Erwartungswerte aus referenz/referenz_wasserfall.py (exakte Brüche, eigener Aufbau, alle stabilen Umwandlungsmengen durchprobiert).

describe("Wasserfall gegen die Python-Referenz", () => {
  it("hat mindestens zehn Fälle mit allen Randfällen", () => {
    expect(REFERENZ_FAELLE.length).toBeGreaterThanOrEqual(10);
    const namen = REFERENZ_FAELLE.map((f) => f.name).join("|");
    for (const stichwort of ["Null-Exit", "Pari passu", "Cap bindet", "Verzinsung", "Gleichstand", "nicht umwandelbar", "Treuhand", "nicht verteilt", "unter den Präferenzen"]) {
      expect(namen).toContain(stichwort);
    }
  });

  for (const fall of REFERENZ_FAELLE) {
    it(fall.name, () => {
      const { wert: e, schritte } = wasserfall(fall.eingabe);
      expect([...e.gewandelt].sort()).toEqual(fall.gewandelt);
      expect(e.nichtVerteilt.toFixed(2)).toBe(fall.nichtVerteilt);
      for (const soll of fall.zeilen) {
        const z = e.zeilen.find((x) => x.id === soll.id)!;
        expect({ id: z.id, praeferenz: z.praeferenz.toFixed(2), beteiligung: z.beteiligung.toFixed(2), gesamt: z.gesamt.toFixed(2), treuhand: z.treuhand.toFixed(2), sofort: z.sofort.toFixed(2), gedeckelt: z.gedeckelt }).toEqual({
          id: soll.id,
          praeferenz: soll.praeferenz,
          beteiligung: soll.beteiligung,
          gesamt: soll.gesamt,
          treuhand: soll.treuhand,
          sofort: soll.sofort,
          gedeckelt: soll.gedeckelt,
        });
        expect(z.multiple === null ? null : z.multiple.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4)).toBe(soll.multiple);
      }
      // Summe der Rückflüsse = Erlös − nicht verteilt
      const summe = e.zeilen.reduce((s, z) => s.plus(z.gesamt), new Decimal(0));
      expect(summe.toFixed(2)).toBe(new Decimal(fall.eingabe.exitwert).minus(e.nichtVerteilt).toFixed(2));
      expect(schritte[0]).toMatchObject({ bezeichnung: "Verteilbarer Erlös (netto nach Kosten)", wert: new Decimal(fall.eingabe.exitwert).toString() });
      expect(schritte.some((s) => s.zeichen === "=" && s.bezeichnung === "Summe der Rückflüsse (auf Cent)")).toBe(true);
    });
  }
});

describe("Knickpunkte gegen die Herleitung von Hand", () => {
  const seriellA = REFERENZ_FAELLE[0]!.eingabe;
  const eingabeC2 = REFERENZ_FAELLE.find((f) => f.name.startsWith("C2"))!.eingabe;
  const faelle = [seriellA, eingabeC2];
  REFERENZ_KNICKE.forEach((soll, i) => {
    it(soll.name, () => {
      const { exitwert: _ignoriert, ...ohneExit } = faelle[i]!;
      const knicke = wasserfallKnicke(ohneExit, "100000000");
      for (const erwartet of soll.knicke) {
        const treffer = knicke.find((k) => k.ereignisse.some((e) => e.art === erwartet.art));
        expect(treffer, erwartet.art).toBeTruthy();
        expect(Math.abs(treffer!.exitwert.minus(erwartet.exitwert).toNumber())).toBeLessThanOrEqual(0.01);
      }
      expect(knicke.length).toBe(new Set(soll.knicke.map((k) => k.exitwert)).size);
    });
  });
});

// Eigenschaften, die nicht von der Implementierung abhängen --------------------------------------------------------------------

const mehrklassig: Omit<WasserfallEingabe, "exitwert"> = {
  exitdatum: "2027-03-31",
  klassen: [
    { id: "B", name: "Serie B", rang: 1, praeferenzFaktor: "1.5", partizipierend: false, umwandelbar: true },
    { id: "A", name: "Serie A", rang: 2, praeferenzFaktor: "1", partizipierend: true, capFaktor: "3", verzinsung: "0.05", umwandelbar: true },
    { id: "S", name: "Seed", rang: 2, praeferenzFaktor: "1", partizipierend: false, umwandelbar: true },
  ],
  inhaber: [
    { id: "g", name: "Gründung", klasseId: null, anteile: "5000000", investiert: "0" },
    { id: "pool", name: "Pool", klasseId: null, anteile: "500000", investiert: "0" },
    { id: "s1", name: "Angel", klasseId: "S", anteile: "800000", investiert: "400000", datum: "2023-02-01" },
    { id: "a1", name: "Fonds", klasseId: "A", anteile: "1200000", investiert: "3000000", datum: "2024-06-30" },
    { id: "b1", name: "Fonds", klasseId: "B", anteile: "1500000", investiert: "9000000", datum: "2026-01-31" },
  ],
};

const exitwerte = ["0", "500000", "3000000", "9999999.99", "14000000", "21000000", "30000000", "45000000", "60000000", "90000000", "150000000", "400000000"];

describe("Eigenschaften", () => {
  it("die Summe der Rückflüsse ist der Erlös, auch mit Treuhand", () => {
    for (const exit of exitwerte) {
      for (const treuhandAnteil of ["0", "0.1", "0.333"]) {
        const { wert: e } = wasserfall({ ...mehrklassig, exitwert: exit, treuhandAnteil });
        const summe = e.zeilen.reduce((s, z) => s.plus(z.gesamt), new Decimal(0));
        expect(summe.toFixed(2), `${exit}/${treuhandAnteil}`).toBe(new Decimal(exit).toFixed(2));
        const sofort = e.zeilen.reduce((s, z) => s.plus(z.sofort), new Decimal(0));
        const einbehalt = e.zeilen.reduce((s, z) => s.plus(z.treuhand), new Decimal(0));
        expect(sofort.plus(einbehalt).toFixed(2)).toBe(summe.toFixed(2));
        // Einbehalt = Erlös × Anteil, auf Cent (höchstens ein Cent Abweichung durch die Rundung der Zeilen)
        expect(einbehalt.minus(new Decimal(exit).times(treuhandAnteil)).abs().lessThanOrEqualTo("0.02"), `${exit}/${treuhandAnteil}`).toBe(true);
      }
    }
  });

  it("jede Zeile bekommt mit steigendem Exitwert nie weniger (auf Cent genau, außer an Umwandlungsgrenzen nie sprunghaft weniger)", () => {
    let vorher: Map<string, Decimal> | null = null;
    for (let exit = 0; exit <= 200_000_000; exit += 1_250_000) {
      const { wert: e } = wasserfall({ ...mehrklassig, exitwert: String(exit) });
      const jetzt = new Map(e.zeilen.map((z) => [z.id, z.gesamt]));
      if (vorher) for (const [id, wert] of jetzt) expect(wert.plus("0.01").greaterThanOrEqualTo(vorher.get(id)!), `${id} bei ${exit}`).toBe(true);
      vorher = jetzt;
    }
  });

  it("keine Klasse gewinnt, wenn sie ihre Entscheidung allein umkehrt (streng bei Umwandlung, Gleichstand = keine)", () => {
    for (const exit of exitwerte) {
      const { wert: e } = wasserfall({ ...mehrklassig, exitwert: exit });
      const eingabe = { ...mehrklassig, exitwert: exit };
      const aktuell = new Set(e.gewandelt);
      const basis = wasserfallBeiEntscheidung(eingabe, [...aktuell]);
      for (const k of mehrklassig.klassen) {
        const andere = aktuell.has(k.id) ? [...aktuell].filter((x) => x !== k.id) : [...aktuell, k.id];
        const umgekehrt = wasserfallBeiEntscheidung(eingabe, andere);
        const jetzt = basis.klassen.get(k.id)!;
        const alt = umgekehrt.klassen.get(k.id)!;
        if (aktuell.has(k.id)) expect(jetzt.greaterThan(alt), `${k.id} bleibt gewandelt bei ${exit}`).toBe(true);
        else expect(alt.lessThanOrEqualTo(jetzt), `${k.id} wandelt nicht bei ${exit}`).toBe(true);
      }
    }
  });

  it("zwischen zwei Knickpunkten ist der Rückfluss einer Zeile linear (Mittelpunkt)", () => {
    const bis = "200000000";
    const knicke = wasserfallKnicke(mehrklassig, bis);
    expect(knicke.length).toBeGreaterThan(3);
    const grenzen = [new Decimal(0), ...knicke.map((k) => k.exitwert), new Decimal(bis)];
    const ids = mehrklassig.inhaber.map((h) => h.id);
    for (let i = 0; i + 1 < grenzen.length; i++) {
      const lo = grenzen[i]!.plus("0.02");
      const hi = grenzen[i + 1]!.minus("0.02");
      if (!hi.greaterThan(lo)) continue;
      const mitte = lo.plus(hi).div(2);
      for (const id of ids) {
        const [a, m, b] = wasserfallKurve(mehrklassig, [lo, mitte, hi], [id]);
        const erwartet = a!.rueckfluss.plus(b!.rueckfluss).div(2);
        expect(m!.rueckfluss.minus(erwartet).abs().lessThan("0.0001"), `${id} zwischen ${grenzen[i]} und ${grenzen[i + 1]}`).toBe(true);
      }
    }
  });

  it("wasserfallKurve stimmt mit wasserfall überein (auf Cent)", () => {
    const punkte = wasserfallKurve(mehrklassig, exitwerte, ["b1", "a1"]);
    exitwerte.forEach((exit, i) => {
      const { wert: e } = wasserfall({ ...mehrklassig, exitwert: exit });
      const soll = e.zeilen.filter((z) => z.id === "b1" || z.id === "a1").reduce((s, z) => s.plus(z.gesamt), new Decimal(0));
      expect(punkte[i]!.rueckfluss.minus(soll).abs().lessThanOrEqualTo("0.02")).toBe(true);
    });
  });

  it("der Rechenweg nennt Erlös, Ansprüche, Umwandlungsprüfung, Rest und Summe in dieser Reihenfolge", () => {
    const { schritte } = wasserfall({ ...mehrklassig, exitwert: "30000000", treuhandAnteil: "0.1" });
    const namen = schritte.map((s) => s.bezeichnung);
    expect(namen[0]).toBe("Verteilbarer Erlös (netto nach Kosten)");
    expect(namen).toContain("Anspruch Serie B (Rang 1)");
    expect(namen).toContain("davon Verzinsung Serie A");
    expect(namen.some((n) => n.startsWith("Entscheidung Serie A: "))).toBe(true);
    expect(namen.indexOf("Rest nach Präferenzen")).toBeGreaterThan(namen.indexOf("Rang 1: gezahlte Präferenzen"));
    expect(namen.at(-1)).toBe("Sofort ausgezahlt");
    expect(namen).toContain("Treuhandanteil");
  });
});

describe("Rundung und Eingaben", () => {
  it("rundeGroessterRest: Summe bleibt, Reste gehen an die größten, Gleichstand an den kleineren Index", () => {
    // 1 Euro in drei gleiche Teile: ein Cent Rest geht an den kleinsten Index
    const r = rundeGroessterRest([new Decimal(1).div(3), new Decimal(1).div(3), new Decimal(1).div(3)]);
    expect(r.map((x) => x.toFixed(2))).toEqual(["0.34", "0.33", "0.33"]);
    const s = rundeGroessterRest(["0.005", "0.005", "0.005", "0.005"].map((x) => new Decimal(x)));
    expect(s.map((x) => x.toFixed(2))).toEqual(["0.01", "0.01", "0.00", "0.00"]);
  });

  it("Einzelklasse und nur Stammanteile", () => {
    const nurStamm = wasserfall({ exitwert: "1000", exitdatum: "2026-01-01", klassen: [], inhaber: [{ id: "a", name: "A", klasseId: null, anteile: "1", investiert: "0" }, { id: "b", name: "B", klasseId: null, anteile: "3", investiert: "0" }] }).wert;
    expect(nurStamm.zeilen.map((z) => z.gesamt.toFixed(2))).toEqual(["250.00", "750.00"]);
    expect(nurStamm.klassen).toHaveLength(1);
  });

  it("lehnt ungültige Eingaben ab", () => {
    const basis = REFERENZ_FAELLE[0]!.eingabe;
    expect(() => wasserfall({ ...basis, exitwert: "-1" })).toThrow();
    expect(() => wasserfall({ ...basis, treuhandAnteil: "1" })).toThrow();
    expect(() => wasserfall({ ...basis, klassen: [{ ...basis.klassen[0]!, rang: 0 }] })).toThrow();
    expect(() => wasserfall({ ...basis, inhaber: [{ id: "x", name: "X", klasseId: "gibtesnicht", anteile: "1", investiert: "1" }] })).toThrow();
    expect(() => wasserfall({ ...basis, inhaber: [...basis.inhaber, basis.inhaber[0]!] })).toThrow();
    expect(() => wasserfall({ ...basis, exitdatum: "morgen" })).toThrow();
  });
});
