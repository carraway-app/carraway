import { describe, expect, it } from "vitest";
import { aufteilung, Decimal, einheitenBeimExit, gevesteteEinheiten, poolStand, poolStandGrob, type Leaver, rundeVollVerwaessert, volleMonate, wasserfall, wasserfallKnicke, wasserfallKurve, type WasserfallEingabe } from "../index.js";
import { REFERENZ_FAELLE } from "./wasserfall.referenz.js";

// Erwartungswerte aus referenz/referenz_mitarbeiterbeteiligung.py (exakte Brüche, Monate über einen Kalender-Zähler). Alle Zahlen erfunden.

describe("Vesting", () => {
  const plan = { anzahl: "48000", beginn: "2024-01-15", cliffMonate: 12, vestingMonate: 48 };

  it("vor dem Cliff nichts, am Cliff der aufgelaufene Teil, danach monatlich, am Ende alles", () => {
    const soll: [string, string][] = [
      ["2024-12-31", "0"],
      ["2025-01-14", "0"],
      ["2025-01-15", "12000"],
      ["2026-07-31", "30000"],
      ["2028-01-15", "48000"],
      ["2030-01-01", "48000"],
    ];
    for (const [stichtag, wert] of soll) expect(gevesteteEinheiten(plan, stichtag).toFixed(0), stichtag).toBe(wert);
  });

  it("volle Monate über das Monatsende", () => {
    expect(volleMonate("2024-01-31", "2024-02-29")).toBe(1);
    expect(volleMonate("2024-01-31", "2024-02-28")).toBe(0);
    expect(volleMonate("2024-05-10", "2024-01-01")).toBe(0);
  });

  it("Beschleunigung beim Exit: Bruch der ungevesteten Einheiten, auch vor dem Cliff", () => {
    expect(einheitenBeimExit({ ...plan, beschleunigung: "0.5" }, "2026-07-31").toFixed(0)).toBe("39000");
    expect(einheitenBeimExit({ anzahl: "10000", beginn: "2026-03-01", cliffMonate: 12, vestingMonate: 48, beschleunigung: "1" }, "2026-07-31").toFixed(0)).toBe("10000");
    expect(einheitenBeimExit({ anzahl: "10000", beginn: "2026-03-01", cliffMonate: 12, vestingMonate: 48 }, "2026-07-31").toFixed(0)).toBe("0");
  });

  it("Status: verfallen und ausgeübt ab ihrem Datum, gevestet heißt voll", () => {
    expect(einheitenBeimExit({ ...plan, status: "verfallen", statusAm: "2026-01-01" }, "2025-12-31").toFixed(0)).toBe("23000");
    expect(einheitenBeimExit({ ...plan, status: "verfallen", statusAm: "2026-01-01" }, "2026-01-01").toFixed(0)).toBe("0");
    expect(einheitenBeimExit({ ...plan, status: "ausgeuebt" }, "2026-01-01").toFixed(0)).toBe("0");
    expect(einheitenBeimExit({ ...plan, status: "gevestet" }, "2024-06-01").toFixed(0)).toBe("48000");
  });

  it("lehnt ungültige Pläne ab", () => {
    expect(() => gevesteteEinheiten({ ...plan, anzahl: "1.5" }, "2025-01-01")).toThrow();
    expect(() => gevesteteEinheiten({ ...plan, cliffMonate: -1 }, "2025-01-01")).toThrow();
    expect(() => einheitenBeimExit({ ...plan, beschleunigung: "1.1" }, "2025-01-01")).toThrow();
  });
});

describe("Leaver-Regeln", () => {
  const plan = { anzahl: "48000", beginn: "2024-01-15", cliffMonate: 12, vestingMonate: 48 };
  const austritt = (gevestet: Leaver["gevestet"], weiter: Partial<Leaver> = {}): Leaver => ({ art: gevestet === "bleiben" ? "good_leaver" : "bad_leaver", austrittAm: "2026-07-31", anzahl: "48000", gevestet, ...weiter });
  const zahlen = (a: ReturnType<typeof aufteilung>) => [a.gevestet, a.ungevestet, a.verfallen, a.rueckgekauft, a.rueckkaufBetrag].map((d) => d.toFixed(0));

  it("Good Leaver: die bei Austritt gevesteten Einheiten bleiben, der ungevestete Rest verfällt, das Vesting friert ein", () => {
    const v = { ...plan, austritte: [austritt("bleiben")] };
    expect(zahlen(aufteilung(v, "2027-01-01"))).toEqual(["30000", "0", "18000", "0", "0"]);
    expect(aufteilung(v, "2027-01-01").verbleibend.toFixed(0)).toBe("30000");
    // Nach dem Austritt keine Beschleunigung der verfallenen Einheiten
    expect(einheitenBeimExit({ ...v, beschleunigung: "1" }, "2027-01-01").toFixed(0)).toBe("30000");
  });

  it("Bad Leaver: auch die gevesteten Einheiten verfallen; vor dem Austritt gilt der Plan", () => {
    const v = { ...plan, austritte: [austritt("verfallen")] };
    expect(zahlen(aufteilung(v, "2027-01-01"))).toEqual(["0", "0", "48000", "0", "0"]);
    expect(zahlen(aufteilung(v, "2026-07-30"))).toEqual(["30000", "18000", "0", "0", "0"]);
    expect(einheitenBeimExit(v, "2027-01-01").toFixed(0)).toBe("0");
  });

  it("Austritt vor dem Cliff: nichts gevestet, alles verfällt, auch als Good Leaver", () => {
    expect(zahlen(aufteilung({ ...plan, austritte: [austritt("bleiben", { austrittAm: "2024-12-31" })] }, "2027-01-01"))).toEqual(["0", "0", "48000", "0", "0"]);
    // Austritt am Cliff: der aufgelaufene Teil ist gevestet
    expect(zahlen(aufteilung({ ...plan, austritte: [austritt("bleiben", { austrittAm: "2025-01-15" })] }, "2027-01-01"))).toEqual(["12000", "0", "36000", "0", "0"]);
  });

  it("Teilverfall einer aggregierten Zuteilung: nur die betroffenen Einheiten frieren ein, die übrigen vesten weiter und beschleunigen", () => {
    const v = { ...plan, anzahl: "100000", austritte: [austritt("bleiben", { anzahl: "10000" })] };
    const a = aufteilung(v, "2027-01-15");
    expect(zahlen(a)).toEqual(["73750", "22500", "3750", "0", "0"]);
    expect(a.verbleibend.toFixed(0)).toBe("96250");
    expect(einheitenBeimExit({ ...v, beschleunigung: "1" }, "2027-01-15").toFixed(0)).toBe("96250");
  });

  it("Rückkauf zum Basispreis oder zu einem anderen Preis: gevestete Einheiten zurück in den Pool, Betrag = Einheiten × Preis", () => {
    const basis = { ...plan, anzahl: "100000", basispreis: "2" };
    expect(zahlen(aufteilung({ ...basis, austritte: [austritt("rueckkauf", { anzahl: "10000" })] }, "2027-01-15"))).toEqual(["67500", "22500", "3750", "6250", "12500"]);
    expect(zahlen(aufteilung({ ...basis, austritte: [austritt("rueckkauf", { anzahl: "10000", rueckkaufpreis: "0.5" })] }, "2027-01-15"))).toEqual(["67500", "22500", "3750", "6250", "3125"]);
  });

  it("Mehrere Austritte zu verschiedenen Daten: je Austritt eigene Regel und Abrundung, die übrigen vesten weiter", () => {
    const basis = { ...plan, anzahl: "100000", basispreis: "2" };
    const austritte = [austritt("bleiben", { anzahl: "10000" }), austritt("verfallen", { anzahl: "5000", austrittAm: "2025-03-10" }), austritt("rueckkauf", { anzahl: "7000", austrittAm: "2025-11-20", rueckkaufpreis: "1.25" })];
    const a = aufteilung({ ...basis, austritte }, "2027-01-15");
    expect(zahlen(a)).toEqual(["64750", "19500", "12542", "3208", "4010"]);
    expect([a.austritt, a.betroffen.toFixed(0), a.verbleibend.toFixed(0)]).toEqual([true, "22000", "84250"]);
    expect(einheitenBeimExit({ ...basis, austritte, beschleunigung: "1" }, "2027-01-15").toFixed(0)).toBe("84250");
    // Nur die Austritte bis zum Stichtag zählen
    const zwischen = aufteilung({ ...basis, austritte }, "2025-06-30");
    expect(zahlen(zwischen)).toEqual(["33645", "61355", "5000", "0", "0"]);
    expect(zwischen.betroffen.toFixed(0)).toBe("5000");
    expect(zahlen(aufteilung({ ...basis, austritte }, "2025-03-09"))).toEqual(["27083", "72917", "0", "0", "0"]);
    // Alle Einheiten ausgeschieden: nichts vestet weiter
    const alle = aufteilung({ ...basis, anzahl: "30000", austritte: [austritt("bleiben", { anzahl: "20000" }), austritt("rueckkauf", { anzahl: "10000", austrittAm: "2025-11-20" })] }, "2027-01-15");
    expect(zahlen(alle)).toEqual(["12500", "0", "12917", "4583", "9166"]);
    expect(alle.betroffen.toFixed(0)).toBe("30000");
  });

  it("Summe bleibt die Anzahl; ungültige Leaver-Angaben werden abgelehnt", () => {
    const a = aufteilung({ ...plan, anzahl: "100000", austritte: [austritt("rueckkauf", { anzahl: "10000" })] }, "2027-01-15");
    expect(a.gevestet.plus(a.ungevestet).plus(a.verfallen).plus(a.rueckgekauft).plus(a.ausgeuebt).toFixed(0)).toBe("100000");
    expect(() => aufteilung({ ...plan, austritte: [austritt("bleiben", { anzahl: "48001" })] }, "2027-01-01")).toThrow();
    expect(() => aufteilung({ ...plan, austritte: [austritt("bleiben", { anzahl: "0" })] }, "2027-01-01")).toThrow();
    expect(() => aufteilung({ ...plan, austritte: [austritt("bleiben", { anzahl: "40000" }), austritt("verfallen", { anzahl: "8001" })] }, "2027-01-01")).toThrow();
    expect(() => aufteilung({ ...plan, austritte: [austritt("rueckkauf", { rueckkaufpreis: "-1" })] }, "2027-01-01")).toThrow();
  });

  it("Pool: verfallene und zurückgekaufte Einheiten wandern von zugeteilt nach frei, voll verwässert bleibt gleich", () => {
    const aenderungen = [{ datum: "2024-01-01", anzahl: "150000" }];
    const z = { anzahl: "100000", zugeteiltAm: "2024-01-15", status: "zugeteilt" as const, cliffMonate: 12, vestingMonate: 48, basispreis: "2", austritte: [austritt("rueckkauf", { anzahl: "10000" })] };
    const vorher = poolStand(aenderungen, [z], "2026-07-30");
    const nachher = poolStand(aenderungen, [z], "2027-01-15");
    expect([vorher.ausstehend, vorher.frei, vorher.vollVerwaessert].map((d) => d.toFixed(0))).toEqual(["100000", "50000", "150000"]);
    expect([nachher.ausstehend, nachher.frei, nachher.verfallen, nachher.rueckgekauft, nachher.vollVerwaessert].map((d) => d.toFixed(0))).toEqual(["90000", "60000", "3750", "6250", "150000"]);
    expect(() => poolStand(aenderungen, [{ ...z, cliffMonate: undefined }], "2027-01-15")).toThrow();
  });
});

describe("Pool", () => {
  it("Größe, ausstehend, ausgeübt und frei zum Stichtag; verfallene Einheiten gehen zurück in den freien Pool", () => {
    const aenderungen = [
      { datum: "2023-01-01", anzahl: "100000" },
      { datum: "2025-06-01", anzahl: "50000" },
    ];
    const zuteilungen = [
      { anzahl: "40000", zugeteiltAm: "2023-02-01", status: "zugeteilt" as const },
      { anzahl: "10000", zugeteiltAm: "2023-03-01", status: "verfallen" as const, statusAm: "2024-03-01" },
      { anzahl: "5000", zugeteiltAm: "2023-04-01", status: "ausgeuebt" as const, statusAm: "2025-01-01" },
      { anzahl: "20000", zugeteiltAm: "2025-07-01", status: "zugeteilt" as const },
    ];
    const vorher = poolStand(aenderungen, zuteilungen, "2024-01-01");
    expect([vorher.groesse, vorher.ausstehend, vorher.ausgeuebt, vorher.frei].map((d) => d.toFixed(0))).toEqual(["100000", "55000", "0", "45000"]);
    const nachher = poolStand(aenderungen, zuteilungen, "2025-12-31");
    expect([nachher.groesse, nachher.ausstehend, nachher.ausgeuebt, nachher.frei, nachher.vollVerwaessert].map((d) => d.toFixed(0))).toEqual(["150000", "60000", "5000", "85000", "145000"]);
  });
});

describe("Vesting-Takt", () => {
  const plan = { anzahl: "48000", beginn: "2024-01-15", cliffMonate: 12, vestingMonate: 48 };

  it("vestet in Stufen von 1, 3, 6 oder 12 Monaten, am Cliff der aufgelaufene Teil", () => {
    expect([1, 3, 6, 12].map((taktMonate) => gevesteteEinheiten({ ...plan, taktMonate }, "2026-10-14").toFixed(0))).toEqual(["32000", "30000", "30000", "24000"]);
    expect(gevesteteEinheiten({ ...plan, taktMonate: 12 }, "2025-01-15").toFixed(0)).toBe("12000");
    expect(() => gevesteteEinheiten({ ...plan, taktMonate: 2 }, "2025-01-15")).toThrow();
  });
});

describe("Pool grob", () => {
  it("vergebene Einheiten sind ausstehend, höchstens die Größe; der Rest ist frei", () => {
    const stand = (groesse: string, vergeben: string | null) => poolStandGrob([{ datum: "2023-01-01", anzahl: groesse }], vergeben, "2024-01-01");
    expect([stand("100000", "60000").ausstehend, stand("100000", "60000").frei, stand("100000", "60000").vollVerwaessert].map((d) => d.toFixed(0))).toEqual(["60000", "40000", "100000"]);
    expect([stand("50000", "60000").ausstehend, stand("50000", "60000").frei].map((d) => d.toFixed(0))).toEqual(["50000", "0"]);
    expect(stand("100000", null).frei.toFixed(0)).toBe("100000");
    expect(poolStandGrob([{ datum: "2025-01-01", anzahl: "100000" }], "5000", "2024-01-01").ausstehend.toFixed(0)).toBe("0");
    expect(() => stand("100", "-1")).toThrow();
  });
});

describe("Runde auf voll verwässerter Basis", () => {
  it("Pool im Pre-Money: die Aufstockung senkt den Preis und verwässert nur die Altgesellschafter", () => {
    const r = rundeVollVerwaessert({ preMoney: "9000000", volumen: "3000000", anteileVorher: "1000000", poolVorher: "50000", aufstockungPreMoney: "100000" });
    expect(r.preisJeAnteil.toFixed(6)).toBe(new Decimal(180).div(23).toFixed(6));
    expect(r.neueAnteile.toFixed(0)).toBe("383333");
    expect(r.vollVerwaessertNachher.toFixed(0)).toBe("1533333");
    // Die neuen Investoren halten voll verwässert ein Viertel (Volumen ÷ Post-Money), bis auf die Rundung der Anteile
    expect(r.anteilInvestoren.toDecimalPlaces(6).toFixed(6)).toBe("0.250000");
  });

  it("Pool im Post-Money: höherer Preis, die Aufstockung verwässert auch die neuen Investoren", () => {
    const r = rundeVollVerwaessert({ preMoney: "9000000", volumen: "3000000", anteileVorher: "1000000", poolVorher: "50000", aufstockungPostMoney: "100000" });
    expect(r.preisJeAnteil.toFixed(6)).toBe(new Decimal(60).div(7).toFixed(6));
    expect(r.neueAnteile.toFixed(0)).toBe("350000");
    expect(r.vollVerwaessertNachher.toFixed(0)).toBe("1500000");
    expect(r.anteilInvestoren.toFixed(6)).toBe(new Decimal(7).div(30).toFixed(6));
  });
});

describe("Wasserfall mit Mitarbeiterbeteiligung", () => {
  it("die Referenzfälle decken Pool im Geld, aus dem Geld, Präferenz frisst Erlös und VSOP anteilig ab", () => {
    const namen = REFERENZ_FAELLE.map((f) => f.name).join("|");
    for (const stichwort of ["ESOP im Geld", "aus dem Geld", "Präferenz frisst Erlös", "VSOP mit Basispreis", "anteilig"]) expect(namen).toContain(stichwort);
  });

  const mitPool: Omit<WasserfallEingabe, "exitwert"> = {
    exitdatum: "2027-03-31",
    klassen: [
      { id: "A", name: "Serie A", rang: 1, praeferenzFaktor: "1", partizipierend: true, capFaktor: "3", umwandelbar: true },
      { id: "S", name: "Seed", rang: 2, praeferenzFaktor: "1", partizipierend: false, umwandelbar: true },
    ],
    inhaber: [
      { id: "g", name: "Gründung", klasseId: null, anteile: "5000000", investiert: "0" },
      { id: "s1", name: "Angel", klasseId: "S", anteile: "800000", investiert: "400000", datum: "2023-02-01" },
      { id: "a1", name: "Fonds", klasseId: "A", anteile: "1200000", investiert: "3000000", datum: "2024-06-30" },
      { id: "e1", name: "ESOP 2023", klasseId: null, anteile: "300000", investiert: "0", mitarbeiter: { basispreis: "0.5" } },
      { id: "e2", name: "ESOP 2025", klasseId: null, anteile: "200000", investiert: "0", mitarbeiter: { basispreis: "3" } },
    ],
  };
  // Regel „anteilig“: die Minderung trifft auch gedeckelte Zeilen, deren Rückfluss deshalb mit steigendem Exit sinken kann; zwischen Knicken
  // ist der Verlauf nicht linear (der Faktor ist ein Bruch im Exitwert). Deshalb nur Summe und Formel je Einheit.
  const mitVsop: Omit<WasserfallEingabe, "exitwert"> = {
    ...mitPool,
    inhaber: [...mitPool.inhaber, { id: "v1", name: "VSOP", klasseId: null, anteile: "250000", investiert: "0", mitarbeiter: { basispreis: "1", regel: "anteilig" } }],
  };

  it("die Summe der Rückflüsse ist der Erlös und keine Zeile bekommt mit steigendem Exit weniger", () => {
    let vorher: Map<string, Decimal> | null = null;
    for (let exit = 0; exit <= 80_000_000; exit += 400_000) {
      const { wert: e } = wasserfall({ ...mitPool, exitwert: String(exit) });
      expect(e.zeilen.reduce((s, z) => s.plus(z.gesamt), new Decimal(0)).toFixed(2)).toBe(new Decimal(exit).toFixed(2));
      for (const z of e.zeilen) if (z.basispreis !== null && z.anteile.greaterThan(0) && z.gesamt.greaterThan(0)) expect(z.imGeld).toBe(true);
      const jetzt = new Map(e.zeilen.map((z) => [z.id, z.gesamt]));
      if (vorher) for (const [id, wert] of jetzt) expect(wert.plus("0.01").greaterThanOrEqualTo(vorher.get(id)!), `${id} bei ${exit}`).toBe(true);
      vorher = jetzt;
    }
  });

  it("die Einheiten bekommen je Stück den Betrag je Anteil minus Basispreis", () => {
    const { wert: e } = wasserfall({ ...mitPool, exitwert: "40000000" });
    const e1 = e.zeilen.find((z) => z.id === "e1")!;
    expect(e1.gesamt.minus(e.preisJeAnteil!.minus("0.5").times(300000)).abs().lessThanOrEqualTo("0.01")).toBe(true);
    expect(e.minderungsfaktor).toBeNull();
  });

  it("VSOP anteilig: Summe = Erlös, die Einheit bekommt p₀ × f − Basispreis, alle übrigen Rückflüsse sind mit f gemindert", () => {
    for (let exit = 0; exit <= 80_000_000; exit += 2_000_000) {
      const { wert: e } = wasserfall({ ...mitVsop, exitwert: String(exit) });
      expect(e.zeilen.reduce((s, z) => s.plus(z.gesamt), new Decimal(0)).toFixed(2)).toBe(new Decimal(exit).toFixed(2));
    }
    const { wert: e } = wasserfall({ ...mitVsop, exitwert: "40000000" });
    const { wert: ohne } = wasserfall({ ...mitPool, exitwert: "40000000" });
    const f = e.minderungsfaktor!;
    expect(f.lessThan(1)).toBe(true);
    const v1 = e.zeilen.find((z) => z.id === "v1")!;
    expect(v1.gesamt.minus(e.preisJeAnteil!.minus(1).times(250000)).abs().lessThanOrEqualTo("0.01")).toBe(true);
    for (const z of ohne.zeilen) expect(e.zeilen.find((x) => x.id === z.id)!.gesamt.minus(z.gesamt.times(f)).abs().lessThanOrEqualTo("0.01"), z.id).toBe(true);
  });

  it("Knickpunkte nennen den Eintritt ins Geld, und dazwischen ist der Rückfluss linear", () => {
    const bis = "80000000";
    const knicke = wasserfallKnicke(mitPool, bis);
    expect(knicke.some((k) => k.ereignisse.some((x) => x.art === "im_geld"))).toBe(true);
    const grenzen = [new Decimal(0), ...knicke.map((k) => k.exitwert), new Decimal(bis)];
    for (let i = 0; i + 1 < grenzen.length; i++) {
      const lo = grenzen[i]!.plus("0.02");
      const hi = grenzen[i + 1]!.minus("0.02");
      if (!hi.greaterThan(lo)) continue;
      const mitte = lo.plus(hi).div(2);
      for (const id of ["a1", "e1", "e2"]) {
        const [a, m, b] = wasserfallKurve(mitPool, [lo, mitte, hi], [id]);
        expect(m!.rueckfluss.minus(a!.rueckfluss.plus(b!.rueckfluss).div(2)).abs().lessThan("0.0001"), `${id} zwischen ${grenzen[i]} und ${grenzen[i + 1]}`).toBe(true);
      }
    }
  });

  it("lehnt Mitarbeiterbeteiligung mit Klasse oder negativem Basispreis ab", () => {
    expect(() => wasserfall({ ...mitPool, exitwert: "1", inhaber: [{ id: "x", name: "X", klasseId: "A", anteile: "1", investiert: "0", mitarbeiter: { basispreis: "1" } }] })).toThrow();
    expect(() => wasserfall({ ...mitPool, exitwert: "1", inhaber: [{ id: "x", name: "X", klasseId: null, anteile: "1", investiert: "0", mitarbeiter: { basispreis: "-1" } }] })).toThrow();
  });
});
