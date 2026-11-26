import { describe, expect, it } from "vitest";
import { optionsscheinAusuebung, optionsscheinStand, uebertragungKaufpreis, verteileBuchwertabgang, wandlung, wasserfall, wendeUebertragungenAn } from "../index.js";

// SAFE, Optionsscheine, Anteilsübertragung und die Verteilung des Buchwertabgangs auf Instrumente (Issue 148). Beträge erfunden, Erwartungswerte von Hand
// mit exakten Brüchen gerechnet.

describe("SAFE: Wandlung ohne Zinsbedingungen", () => {
  it("Wandlungsbetrag ist das Kapital; Cap 4.000.000 ÷ 500.000 Anteile = 8,00 unter 12,50 × 0,8 = 10,00", () => {
    const e = wandlung({
      bewegungen: [{ datum: "2026-01-15", art: "auszahlung", betrag: 250_000 }],
      cutoff: "2026-09-30",
      zinsenWandeln: false,
      preisregel: { rundenpreisJeAnteil: "12.5", discount: "0.2", bewertungsobergrenze: { betrag: 4_000_000, anteileVorRunde: 500_000 } },
      nennwertJeAnteil: 1,
    });
    expect(e.zinsenGebucht.toString()).toBe("0");
    expect(e.wandlungsbetrag.toString()).toBe("250000");
    expect(e.preisJeAnteil.toString()).toBe("8");
    expect(e.massgeblich).toBe("bewertungsobergrenze");
    expect(e.anzahlAnteile.toString()).toBe("31250");
    expect(e.schritte.some((s) => s.bezeichnung.includes("SAFE"))).toBe(true);
  });

  it("ohne Zinsbedingungen können keine Zinsen mitwandeln", () => {
    expect(() =>
      wandlung({ bewegungen: [{ datum: "2026-01-15", art: "auszahlung", betrag: 1000 }], cutoff: "2026-02-01", zinsenWandeln: true, preisregel: { rundenpreisJeAnteil: 1 }, nennwertJeAnteil: 1 }),
    ).toThrow(/SAFE/);
  });
});

describe("Optionsscheine", () => {
  const b = { anzahl: 20_000, ausuebungspreis: "1.25", ausgabeAm: "2025-03-01", laufzeitBis: "2030-02-28" };

  it("Stand: vor der Ausgabe nichts offen, in der Laufzeit Anzahl − ausgeübt, danach verfallen", () => {
    const aus = [{ datum: "2026-06-30", anzahl: 5000 }];
    expect(optionsscheinStand(b, aus, "2025-01-01").wert).toMatchObject({ status: "vor_ausgabe", offen: expect.anything() });
    expect(optionsscheinStand(b, aus, "2025-01-01").wert.offen.toString()).toBe("0");
    expect(optionsscheinStand(b, aus, "2026-06-29").wert.offen.toString()).toBe("20000");
    const nach = optionsscheinStand(b, aus, "2026-06-30").wert;
    expect([nach.ausgeuebt.toString(), nach.offen.toString(), nach.status]).toEqual(["5000", "15000", "laufend"]);
    const spaet = optionsscheinStand(b, aus, "2030-03-01").wert;
    expect([spaet.offen.toString(), spaet.verfallen.toString(), spaet.status]).toEqual(["0", "15000", "verfallen"]);
  });

  it("Ausübung: Betrag = Anzahl × Preis auf Cent (3 × 0,3333 = 1,00 statt 0,9999)", () => {
    const e = optionsscheinAusuebung({ anzahl: 10, ausuebungspreis: "0.3333" }, [], { datum: "2026-01-01", anzahl: 3 });
    expect(e.wert.betrag.toFixed(2)).toBe("1.00");
    expect(e.wert.offenDanach.toString()).toBe("7");
    expect(e.schritte.at(-1)).toMatchObject({ zeichen: "=", wert: "1" });
  });

  it("Ausübung: nicht mehr als offen (auch gegen spätere Ausübungen), nur in der Laufzeit, ganze Zahl", () => {
    expect(() => optionsscheinAusuebung(b, [{ datum: "2027-01-01", anzahl: 18_000 }], { datum: "2026-01-01", anzahl: 2001 })).toThrow(/nur noch 2000/);
    expect(() => optionsscheinAusuebung(b, [], { datum: "2030-03-01", anzahl: 1 })).toThrow(/nach dem Ende der Laufzeit/);
    expect(() => optionsscheinAusuebung(b, [], { datum: "2025-02-01", anzahl: 1 })).toThrow(/vor der Ausgabe/);
    expect(() => optionsscheinAusuebung(b, [], { datum: "2026-01-01", anzahl: "1.5" })).toThrow(/ganze Zahl/);
  });

  it("im Wasserfall wie eine Option: je Anteil max(0, p − Ausübungspreis), eigene Bezeichnung der Schritte", () => {
    // 80.000 Stammanteile, 20.000 Optionsscheine zu 1,00; Erlös 210.000: p mit 80.000 p + 20.000 (p − 1) = 210.000 → p = 2,30.
    const e = wasserfall({
      exitwert: 210_000,
      exitdatum: "2027-01-01",
      klassen: [],
      inhaber: [
        { id: "stamm", name: "Stamm", klasseId: null, anteile: 80_000, investiert: 0 },
        { id: "optionsschein:x", name: "Fonds · Optionsscheine", klasseId: null, anteile: 20_000, investiert: 0, mitarbeiter: { basispreis: 1, art: "optionsschein" } },
      ],
    });
    expect(e.wert.preisJeAnteil?.toString()).toBe("2.3");
    expect(e.wert.zeilen.find((z) => z.id === "optionsschein:x")?.gesamt.toFixed(2)).toBe("26000.00");
    expect(e.schritte.some((s) => s.bezeichnung.startsWith("Optionsscheine: nicht ausgeübte Anteile"))).toBe(true);
    expect(e.schritte.some((s) => s.bezeichnung.startsWith("Mitarbeiterbeteiligung"))).toBe(false);
  });
});

describe("Anteilsübertragung", () => {
  it("Kaufpreis = Anzahl × Preis auf Cent", () => {
    expect(uebertragungKaufpreis(3, "0.333335").wert.toFixed(2)).toBe("1.00");
    expect(() => uebertragungKaufpreis(0, 1)).toThrow();
  });

  it("Präferenzbasis wandert anteilig mit, Summen bleiben gleich, Zugang kann wieder Quelle sein", () => {
    const e = wendeUebertragungenAn(
      [
        { id: "p1", anteile: 30_000, investiert: "100000.00" },
        { id: "stamm", anteile: 70_000, investiert: 0 },
      ],
      [
        { id: "u1", quelleId: "p1", zielId: "uebertragung:u1", anzahl: 10_000 },
        { id: "u2", quelleId: "uebertragung:u1", zielId: "uebertragung:u2", anzahl: 10_000 },
        { id: "u3", quelleId: "stamm", zielId: "uebertragung:u3", anzahl: 5000 },
      ],
    ).wert;
    // 100.000 × 10.000 ÷ 30.000 = 33.333,33 (auf Cent); die Quelle behält 66.666,67.
    expect(e.bestaende.map((b) => [b.id, b.anteile.toString(), b.investiert.toFixed(2)])).toEqual([
      ["p1", "20000", "66666.67"],
      ["stamm", "65000", "0.00"],
    ]);
    expect(e.zugaenge.map((z) => [z.id, z.anteile.toString(), z.investiert.toFixed(2)])).toEqual([
      ["uebertragung:u1", "0", "0.00"],
      ["uebertragung:u2", "10000", "33333.33"],
      ["uebertragung:u3", "5000", "0.00"],
    ]);
    const anteile = [...e.bestaende, ...e.zugaenge].reduce((s, b) => s + Number(b.anteile), 0);
    expect(anteile).toBe(100_000);
    expect(e.fehler).toEqual([]);
  });

  it("zu viele Anteile oder fehlende Quelle: nicht angewandt, als Fehler gemeldet", () => {
    const e = wendeUebertragungenAn([{ id: "p1", anteile: 100, investiert: 100 }], [
      { id: "u1", quelleId: "p1", zielId: "z1", anzahl: 101 },
      { id: "u2", quelleId: "fehlt", zielId: "z2", anzahl: 1 },
    ]).wert;
    expect(e.fehler.map((f) => [f.uebertragungId, f.grund, f.verfuegbar.toString()])).toEqual([
      ["u1", "zu_viele_anteile", "100"],
      ["u2", "quelle_fehlt", "0"],
    ]);
    expect(e.bestaende[0]?.anteile.toString()).toBe("100");
  });
});

describe("Buchwertabgang je Instrument (Verkauf der ganzen Beteiligung)", () => {
  it("Vollverkauf: jedes Instrument bekommt genau seinen Buchwert", () => {
    const e = verteileBuchwertabgang("350000.01", [
      { id: "a", buchwert: "100000.00" },
      { id: "b", buchwert: "250000.01" },
    ]).wert;
    expect(e.map((x) => [x.id, x.abgang.toFixed(2)])).toEqual([
      ["a", "100000.00"],
      ["b", "250000.01"],
    ]);
  });

  it("Teilverkauf: anteilig nach Buchwert, Summe auf den Cent (größter Rest)", () => {
    // 100 € auf 1 : 2 → 33,333… und 66,666… → 33,33 und 66,67.
    const e = verteileBuchwertabgang(100, [
      { id: "a", buchwert: 1000 },
      { id: "b", buchwert: 2000 },
    ]).wert;
    expect(e.map((x) => x.abgang.toFixed(2))).toEqual(["33.33", "66.67"]);
  });

  it("Instrumente ohne positiven Buchwert bekommen nichts; ohne jeden positiven Buchwert bleibt der Abgang unverteilt", () => {
    expect(verteileBuchwertabgang(50, [{ id: "a", buchwert: 0 }, { id: "b", buchwert: -10 }, { id: "c", buchwert: 200 }]).wert.map((x) => x.abgang.toString())).toEqual(["0", "0", "50"]);
    const leer = verteileBuchwertabgang(50, [{ id: "a", buchwert: 0 }]);
    expect(leer.wert[0]?.abgang.toString()).toBe("0");
    expect(leer.schritte.at(-1)?.bezeichnung).toMatch(/Nicht verteilbar/);
  });
});
