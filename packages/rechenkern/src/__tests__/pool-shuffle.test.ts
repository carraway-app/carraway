import { describe, expect, it } from "vitest";
import { Decimal, poolShuffle, poolShuffleKennwerte, type PoolBasis, type PoolShuffleEingabe } from "../index.js";

// Erwartungswerte aus referenz/referenz_pool_shuffle.py (exakte Brüche, kleinste ganze Aufstockung per Suche statt geschlossener Formel).
// Alle Zahlen erfunden.

const basis = { preMoney: "9000000", volumen: "3000000", anteileVorher: "1000000", poolVorher: "50000", zielAnteil: "0.15" };

function vorschlag(e: PoolShuffleEingabe) {
  const r = poolShuffle(e);
  if (!r.ok) throw new Error(`kein Vorschlag: ${r.grund}`);
  return r.vorschlag;
}

describe("Option Pool Shuffle", () => {
  const faelle: [string, PoolShuffleEingabe, string, string][] = [
    ["pre", { ...basis, basis: "pre_money" }, "200000", "416666"],
    ["post", { ...basis, basis: "post_money" }, "188236", "350000"],
    ["pre ohne Pool", { preMoney: "4000000", volumen: "1000000", anteileVorher: "800000", poolVorher: "0", zielAnteil: "0.1", basis: "pre_money" }, "114286", "228571"],
    ["pre krumm", { preMoney: "7777777", volumen: "2345678", anteileVorher: "1234567", poolVorher: "33333", zielAnteil: "0.125", basis: "pre_money" }, "206559", "444677"],
    ["post krumm", { preMoney: "7777777", volumen: "2345678", anteileVorher: "1234567", poolVorher: "33333", zielAnteil: "0.125", basis: "post_money" }, "197660", "382382"],
    ["Ziel schon erreicht", { ...basis, poolVorher: "300000", basis: "pre_money" }, "0", "433333"],
  ];

  for (const [name, e, aufstockung, neueAnteile] of faelle) {
    it(`${name}: kleinste ganze Aufstockung wie die Referenz, Pool nach der Runde mindestens Zielgröße`, () => {
      const v = vorschlag(e);
      expect(v.aufstockung.toFixed(0)).toBe(aufstockung);
      const k = poolShuffleKennwerte({ ...e, aufstockung: v.aufstockung, preisJeAnteil: v.preisExakt });
      expect(k.neueAnteile.toFixed(0)).toBe(neueAnteile);
      expect(k.poolAnteilNachher.greaterThanOrEqualTo(e.zielAnteil)).toBe(true);
      // Ein Anteil weniger reicht nicht (sofern aufgestockt wird)
      if (v.aufstockung.greaterThan(0)) {
        const weniger = v.aufstockung.minus(1);
        const preis = e.basis === "pre_money" ? new Decimal(e.preMoney).div(new Decimal(e.anteileVorher).plus(e.poolVorher).plus(weniger)) : v.preisExakt;
        expect(poolShuffleKennwerte({ ...e, aufstockung: weniger, preisJeAnteil: preis }).poolAnteilNachher.lessThan(e.zielAnteil)).toBe(true);
      }
    });
  }

  it("Pre-Money: Preis = Pre-Money ÷ (voll verwässerte Anteile vor der Runde + Aufstockung), effektive Pre-Money ohne den Wert der Aufstockung", () => {
    const v = vorschlag({ ...basis, basis: "pre_money" });
    expect(v.preisExakt.toFixed(6)).toBe("7.200000");
    expect(v.preisJeAnteil.toFixed(4)).toBe("7.2000");
    const k = poolShuffleKennwerte({ ...basis, basis: "pre_money", aufstockung: v.aufstockung, preisJeAnteil: v.preisJeAnteil });
    expect(k.poolVorher.toFixed(0)).toBe("50000");
    expect(k.poolNachher.toFixed(0)).toBe("250000");
    expect(k.vollVerwaessertNachher.toFixed(0)).toBe("1666666");
    expect(k.effektivePreMoney.toFixed(2)).toBe("7560000.00");
    expect(k.effektivePreMoney.toFixed(2)).toBe(new Decimal(basis.preMoney).minus(v.preisJeAnteil.times(v.aufstockung)).toFixed(2));
  });

  it("Post-Money: Preis ohne Aufstockung, effektive Pre-Money gleich dem Pre-Money", () => {
    const v = vorschlag({ ...basis, basis: "post_money" });
    expect(v.preisExakt.toFixed(6)).toBe(new Decimal(60).div(7).toFixed(6));
    expect(v.preisJeAnteil.toFixed(4)).toBe("8.5714");
    const k = poolShuffleKennwerte({ ...basis, basis: "post_money", aufstockung: v.aufstockung, preisJeAnteil: v.preisExakt });
    expect(k.effektivePreMoney.toFixed(2)).toBe("9000000.00");
    expect(k.poolNachher.toFixed(0)).toBe("238236");
  });

  it("die Aufstockung im Pre-Money senkt den Preis, im Post-Money nicht", () => {
    const pre = vorschlag({ ...basis, basis: "pre_money" });
    const post = vorschlag({ ...basis, basis: "post_money" });
    expect(pre.preisExakt.lessThan(post.preisExakt)).toBe(true);
  });

  it("ohne Lösung ein Grund statt eines Fehlers", () => {
    const grund = (e: Partial<PoolShuffleEingabe> & { basis?: PoolBasis }) => {
      const r = poolShuffle({ ...basis, basis: "pre_money", ...e });
      return r.ok ? "ok" : r.grund;
    };
    expect(grund({ anteileVorher: "0" })).toBe("ohne_anteile");
    expect(grund({ preMoney: "0" })).toBe("ohne_pre_money");
    expect(grund({ zielAnteil: "0" })).toBe("ziel_ungueltig");
    expect(grund({ zielAnteil: "1" })).toBe("ziel_ungueltig");
    // t × Post ÷ Pre ≥ 1: Der Pool müsste mehr als alle Altanteile wert sein
    expect(grund({ zielAnteil: "0.75" })).toBe("ziel_unerreichbar");
    expect(grund({ zielAnteil: "0.75", basis: "post_money" })).toBe("ok");
    expect(grund({ preMoney: "1", volumen: "0", anteileVorher: "100000000" })).toBe("preis_null");
  });

  it("nahe 100 % unerreichbar, große Werte in begrenzter Zeit", () => {
    expect(poolShuffle({ ...basis, zielAnteil: "0.995", basis: "post_money" })).toEqual({ ok: false, grund: "ziel_unerreichbar" });
    // k = 0,745 × 12 ÷ 9 ≈ 0,993: 1 − k unter der Schwelle
    expect(poolShuffle({ ...basis, zielAnteil: "0.745", basis: "pre_money" })).toEqual({ ok: false, grund: "ziel_unerreichbar" });
    const start = Date.now();
    const v = vorschlag({ preMoney: "9999999999999999", volumen: "9999999999999999", anteileVorher: "999999999999999", poolVorher: "1", zielAnteil: "0.98", basis: "post_money" });
    expect(Date.now() - start).toBeLessThan(1000);
    expect(v.aufstockung.greaterThan(0)).toBe(true);
    const k = poolShuffleKennwerte({ preMoney: "9999999999999999", volumen: "9999999999999999", anteileVorher: "999999999999999", poolVorher: "1", basis: "post_money", aufstockung: v.aufstockung, preisJeAnteil: v.preisExakt });
    expect(k.poolAnteilNachher.greaterThanOrEqualTo("0.98")).toBe(true);
  });

  it("Kennwerte verlangen einen Preis größer als null", () => {
    expect(() => poolShuffleKennwerte({ ...basis, basis: "pre_money", aufstockung: "0", preisJeAnteil: "0" })).toThrow();
  });
});
