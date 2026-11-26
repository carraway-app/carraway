import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Decimal, PAI_KATALOG, PAI_KATALOG_V1, PAI_KATALOG_VERSION, PAI_KLIMASEKTOREN, PAI_ZUSATZ, berechnePai, paiDatenpunkte, paiFundstelle, paiMetriken, paiStichtage, type PaiBeteiligung } from "../index";

// Erwartungswerte aus referenz/referenz_pai.py (exakte Brüche, `python3 -I`), Eingaben aus referenz/pai_faelle.json, Zahlen erfunden.
// referenz/pai_erwartet.json ist die Ausgabe des Skripts (`python3 -I referenz/referenz_pai.py > referenz/pai_erwartet.json`).

interface Fall {
  name: string;
  jahr: number;
  zusatz: string[];
  beteiligungen: { id: string; name: string; nace: string | null; wert: string[]; daten: Record<string, [string, boolean]> }[];
}
const lies = <T>(datei: string): T => JSON.parse(readFileSync(new URL(`../../referenz/${datei}`, import.meta.url), "utf8")) as T;
const faelle = lies<{ faelle: Fall[] }>("pai_faelle.json").faelle;
const erwartet = lies<Record<string, Record<string, { wert: string | null; abdeckung: string | null; schaetzanteil: string | null }>>>("pai_erwartet.json");

function eingabeVon(f: Fall) {
  const stichtage = paiStichtage(f.jahr);
  const beteiligungen: PaiBeteiligung[] = f.beteiligungen.map((b) => ({
    id: b.id,
    name: b.name,
    nace: b.nace,
    wert: Object.fromEntries(stichtage.map((s, i) => [s, b.wert[i]!])),
    daten: Object.fromEntries(Object.entries(b.daten).map(([k, [wert, geschaetzt]]) => [k, { wert, geschaetzt }])),
  }));
  return { jahr: f.jahr, zusatz: f.zusatz, beteiligungen };
}
const rechne = (name: string) => berechnePai(eingabeVon(faelle.find((f) => f.name === name)!));
const fix = (x: string | null) => (x === null ? null : new Decimal(x).toFixed(12));

describe("Katalog der Nachhaltigkeitsindikatoren", () => {
  it("enthält die 14 verpflichtenden Indikatoren der Tabelle 1 mit Fundstelle, Version und eindeutigen Codes", () => {
    const pflicht = PAI_KATALOG.filter((m) => m.verpflichtend);
    expect([...new Set(pflicht.map((m) => m.nr))].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    expect(pflicht.every((m) => m.tabelle === 1)).toBe(true);
    expect(new Set(PAI_KATALOG.map((m) => m.code)).size).toBe(PAI_KATALOG.length);
    expect(paiFundstelle(pflicht[0]!)).toBe("DelVO (EU) 2022/1288 Anhang I Tabelle 1 Nr. 1");
    expect(PAI_KATALOG_VERSION).toBe(1);
    expect(PAI_KLIMASEKTOREN.map((s) => s.abschnitt).join("")).toBe("ABCDEFGHL");
    // Indikator 1 hat vier Teilmetriken (Scope 1, 2, 3 und insgesamt).
    expect(PAI_KATALOG.filter((m) => m.nr === 1).length).toBe(4);
  });

  it("Zusatzindikatoren erscheinen nur, wenn ihr Datenpunkt gewählt ist", () => {
    expect(paiMetriken().some((m) => !m.verpflichtend)).toBe(false);
    expect(paiMetriken(["esg_zus_hinweisgeberschutz"]).filter((m) => !m.verpflichtend).map((m) => m.code)).toEqual(["t3_06"]);
    expect(PAI_ZUSATZ.map((z) => z.schluessel).sort()).toEqual(["esg_zus_antikorruption", "esg_zus_hinweisgeberschutz", "esg_zus_ohne_reduktionsinitiativen"]);
    expect(paiDatenpunkte()).toEqual(expect.arrayContaining(["esg_evic", "umsatz", "esg_thg_scope1", "esg_umstrittene_waffen"]));
    expect(paiDatenpunkte()).not.toContain("esg_zus_antikorruption");
    expect(paiDatenpunkte(["esg_zus_antikorruption"])).toContain("esg_zus_antikorruption");
  });

  it("Quartalsenden des Berichtsjahres", () => {
    expect(paiStichtage(2025)).toEqual(["2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31"]);
  });
});

describe("berechnePai gegen die Python-Referenz", () => {
  for (const f of faelle) {
    it(`Fall ${f.name}: Wert, Abdeckung und Schätzanteil jeder Zeile stimmen auf zwölf Stellen`, () => {
      const e = rechne(f.name);
      const soll = erwartet[f.name]!;
      expect(e.zeilen.map((z) => z.code).sort()).toEqual(Object.keys(soll).sort());
      for (const z of e.zeilen) {
        const s = soll[z.code]!;
        expect({ code: z.code, wert: fix(z.wert), abdeckung: fix(z.abdeckung), schaetzanteil: fix(z.schaetzanteil) }).toEqual({ code: z.code, wert: s.wert, abdeckung: s.abdeckung, schaetzanteil: s.schaetzanteil });
      }
    });
  }

  it("Handrechnung Scope 1: Summe aus Wert ÷ Unternehmenswert × Emissionen je Quartal, dann Durchschnitt der vier Quartale", () => {
    // Alpha: 1,0 Mio. ÷ 20 Mio. × 100 = 5 (Q3 und Q4: 1,2 Mio. → 6); Beta: 0,5 ÷ 8 × 40 = 2,5 (Q4 nicht gehalten);
    // Epsilon: 0,1 ÷ 1 × 1 = 0,1; Gamma ohne Daten, Delta mit Unternehmenswert 0 (ausgeschlossen).
    const z = rechne("fuenf_unternehmen").zeilen.find((x) => x.code === "t1_01_scope1")!;
    expect(z.quartale.map((q) => new Decimal(q.wert!).toFixed(4))).toEqual(["7.6000", "7.6000", "8.6000", "6.1000"]);
    expect(new Decimal(z.wert!).toFixed(4)).toBe("7.4750");
    expect(z.schritte.at(-1)).toMatchObject({ zeichen: "=", bezeichnung: "Durchschnitt der Quartale mit Wert (4 von 4)", wert: "7.475" });
    expect(z.schritte.some((s) => s.quellen?.includes("alpha"))).toBe(true);
  });

  it("Gesamtemissionen sind die Summe der drei Scopes, die Abdeckung zählt nur Unternehmen mit allen Angaben", () => {
    const e = rechne("fuenf_unternehmen");
    const wert = (c: string) => new Decimal(e.zeilen.find((z) => z.code === c)!.wert!);
    expect(wert("t1_01_gesamt").toFixed(9)).toBe(wert("t1_01_scope1").plus(wert("t1_01_scope2")).plus(wert("t1_01_scope3")).toFixed(9));
    // Abdeckung Q1: (1,0 + 0,5 + 0,1 Mio.) ÷ 1,8 Mio. (Alpha, Beta, Delta, Epsilon; Gamma erst ab Q2)
    const abd = new Decimal(e.zeilen.find((z) => z.code === "t1_01_scope1")!.quartale[0]!.abdeckung!);
    expect(abd.toFixed(6)).toBe(new Decimal("1600000").div("1800000").toFixed(6));
  });
});

describe("berechnePai: Sonderfälle mit ausdrücklichem Befund", () => {
  it("Unternehmenswert 0 und Umsatz 0 schließen das Unternehmen aus und erscheinen als Befund, nicht als stiller Fehler", () => {
    const e = rechne("fuenf_unternehmen");
    const befund = (code: string) => e.befunde.filter((b) => b.code === code).map((b) => b.beteiligungId);
    expect(befund("EVIC_NICHT_POSITIV")).toEqual(["delta"]);
    expect(befund("UMSATZ_NICHT_POSITIV")).toEqual(["epsilon"]);
    expect(befund("NACE_FEHLT")).toEqual(["epsilon"]);
    // Gamma hat weder Emissions- noch Energiedaten: kein Befund zu Hilfsgrößen, nur geringere Abdeckung.
    expect(e.befunde.some((b) => b.beteiligungId === "gamma")).toBe(false);
    // Delta zählt bei Kennzahlen ohne Unternehmenswert weiter mit (Frauenanteil), Epsilon bei der Intensität nicht.
    const intensitaet = e.zeilen.find((z) => z.code === "t1_03")!;
    expect(new Decimal(intensitaet.abdeckung!).lt(1)).toBe(true);
  });

  it("ohne Bestand im Berichtsjahr ist keine Auswirkung definiert: kein Wert, keine Abdeckung, Befund KEIN_BESTAND", () => {
    const e = rechne("ohne_bestand");
    expect(e.befunde.map((b) => b.code)).toContain("KEIN_BESTAND");
    expect(e.zeilen.every((z) => z.wert === null && z.abdeckung === null)).toBe(true);
    expect(e.zeilen.some((z) => z.code.startsWith("t1_06"))).toBe(false); // kein Sektor mit Beteiligung
    expect(e.zeilen.find((z) => z.code === "t1_01_scope1")!.schritte.at(-1)!.wert).toBe("nicht definiert");
  });

  it("eine Beteiligung mit höherem Wert als der Unternehmenswert wird gerechnet, aber gemeldet", () => {
    const e = rechne("beteiligung_ueber_unternehmenswert");
    expect(e.befunde.find((b) => b.code === "ANTEIL_UEBER_100")).toMatchObject({ beteiligungId: "zu_gross", params: { wert: "2000000", evic: "1000000" } });
    // 2 ÷ 1 × 30 = 60 je Quartal
    expect(new Decimal(e.zeilen.find((z) => z.code === "t1_01_gesamt")!.wert!).toFixed(6)).toBe("60.000000");
    // Die Schätzung des Unternehmenswerts zählt zum Schätzanteil der Emissionen.
    expect(new Decimal(e.zeilen.find((z) => z.code === "t1_01_gesamt")!.schaetzanteil!).toFixed(2)).toBe("1.00");
  });

  it("Sektoren: eine Zeile je Sektor mit Beteiligung; im Quartal ohne Bestand im Sektor zählt das Quartal nicht in den Durchschnitt", () => {
    const e = rechne("fuenf_unternehmen");
    expect(e.zeilen.filter((z) => z.indikator === "t1_06").map((z) => z.sektor)).toEqual(["C", "D", "G"]);
    const d = e.zeilen.find((z) => z.code === "t1_06_d")!;
    expect(d.quartale.map((q) => q.wert === null)).toEqual([false, false, false, true]);
    expect(new Decimal(d.wert!).toFixed(6)).toBe("15.000000"); // 30 GWh ÷ 2 Mio. EUR Umsatz
    expect(new Decimal(d.schaetzanteil!).toFixed(2)).toBe("1.00"); // Verbrauch geschätzt
  });

  it("Schätzanteil: nur Beteiligungen mit geschätzten Eingangsdaten zählen, gewichtet nach Wert", () => {
    const e = rechne("fuenf_unternehmen");
    // Scope 3 und Unternehmenswert von Beta sind geschätzt: Q1 0,5 ÷ (1,0 + 0,5 + 0,1) Mio. = 0,3125
    const q = e.zeilen.find((z) => z.code === "t1_01_scope3")!;
    expect(new Decimal(q.schaetzanteil!).gt(0)).toBe(true);
    expect(new Decimal(q.schaetzanteil!).lt(1)).toBe(true);
    // Der Anteil nicht erneuerbarer Energie ist bei allen berichtet.
    expect(new Decimal(e.zeilen.find((z) => z.code === "t1_05")!.schaetzanteil!).toFixed(2)).toBe("0.00");
  });

  it("Zusatzindikator ohne Wahl fehlt, mit Wahl steht er im Ergebnis", () => {
    const e = rechne("fuenf_unternehmen");
    expect(e.zeilen.some((z) => z.code === "t3_06")).toBe(true);
    expect(e.zeilen.some((z) => z.code === "t3_15")).toBe(false);
    expect(e.katalogVersion).toBe(1);
  });
});

describe("berechnePai: der Katalog ist eine Eingabe", () => {
  // Prüfsumme der Ergebnisse aller Referenzfälle, gemessen vor dem Umbau (Katalog als Konstante im Code).
  const VOR_UMBAU = "1330e836e6b5c8e962c4179709728621cc933dc95d21c12c100b12c48ba9ec02";
  const hash = (ergebnisse: unknown) => createHash("sha256").update(JSON.stringify(ergebnisse)).digest("hex");

  it("ohne Katalog und mit PAI_KATALOG_V1 entsteht dasselbe Ergebnis wie vor dem Umbau", () => {
    expect(hash(faelle.map((f) => berechnePai(eingabeVon(f))))).toBe(VOR_UMBAU);
    expect(hash(faelle.map((f) => berechnePai(eingabeVon(f), PAI_KATALOG_V1)))).toBe(VOR_UMBAU);
    expect(PAI_KATALOG_V1.metriken).toBe(PAI_KATALOG);
    expect(PAI_KATALOG_V1.version).toBe(PAI_KATALOG_VERSION);
  });

  it("ein anderer Katalog bestimmt Zeilen und die Version im Ergebnis", () => {
    const klein = { version: 7, metriken: PAI_KATALOG.filter((m) => m.code === "t1_01_scope1" || m.code === "t1_01_gesamt") };
    const f = faelle[0]!;
    const e = berechnePai(eingabeVon(f), klein);
    expect(e.katalogVersion).toBe(7);
    expect(e.zeilen.map((z) => z.code)).toEqual(["t1_01_scope1", "t1_01_gesamt"]);
    const voll = berechnePai(eingabeVon(f));
    expect(e.zeilen[0]).toEqual(voll.zeilen.find((z) => z.code === "t1_01_scope1"));
    expect(paiMetriken([], klein).map((m) => m.code)).toEqual(["t1_01_scope1", "t1_01_gesamt"]);
    expect(paiDatenpunkte([], klein).sort()).toEqual([...new Set(["esg_evic", "umsatz", ...klein.metriken.flatMap((m) => m.eingaben)])].sort());
  });
});
