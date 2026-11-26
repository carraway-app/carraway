import { describe, expect, it } from "vitest";
import { schaetzeOffeneWandlung, wandlung, type OffeneWandlungEingabe } from "../index.js";

// Beträge erfunden. 100.000 ausgezahlt am 01.01.2026, 6 % p. a. nach 30E/360, Stichtag 01.07.2026: 3.000 Zinsen.
// Letzte Runde 12,50 je Anteil, 1.000.000 Anteile voll verwässert vor der Wandlung.
const basis: OffeneWandlungEingabe = {
  bewegungen: [{ datum: "2026-01-01", art: "auszahlung", betrag: 100_000 }],
  bedingungen: { satzFix: "0.06", methode: "30E/360" },
  stichtag: "2026-07-01",
  zinsenWandeln: true,
  referenzpreis: "12.5",
  anteileVorWandlung: 1_000_000,
};

describe("schaetzeOffeneWandlung", () => {
  it("Abschlag greift: 12,50 × 0,8 = 10,00; 103.000 ÷ 10 = 10.300 Anteile, Cap fehlt", () => {
    const e = schaetzeOffeneWandlung({ ...basis, abschlag: "0.2" });
    expect(e.status).toBe("geschaetzt");
    if (e.status !== "geschaetzt") return;
    expect(e.kapital.toString()).toBe("100000");
    expect(e.zinsen.toString()).toBe("3000");
    expect(e.betrag.toString()).toBe("103000");
    expect(e.preisJeAnteil.toString()).toBe("10");
    expect(e.massgeblich).toBe("abschlag");
    expect(e.anteile.toString()).toBe("10300");
    expect(e.fehlend).toEqual(["bewertungsobergrenze"]);
  });

  it("Cap greift: 8.000.000 ÷ 1.000.000 = 8,00 unter 12,50; Abschlag fehlt", () => {
    const e = schaetzeOffeneWandlung({ ...basis, bewertungsobergrenze: "8000000" });
    expect(e.status).toBe("geschaetzt");
    if (e.status !== "geschaetzt") return;
    expect(e.preisJeAnteil.toString()).toBe("8");
    expect(e.massgeblich).toBe("bewertungsobergrenze");
    expect(e.anteile.toString()).toBe("12875");
    expect(e.fehlend).toEqual(["abschlag"]);
  });

  it("beides: der kleinere Preis gilt (Cap 9,00 gegen Abschlag 10,00, dann Abschlag 10,00 gegen Cap 11,00)", () => {
    const cap = schaetzeOffeneWandlung({ ...basis, abschlag: "0.2", bewertungsobergrenze: "9000000" });
    expect(cap.status === "geschaetzt" && cap.massgeblich).toBe("bewertungsobergrenze");
    expect(cap.status === "geschaetzt" && cap.anteile.toString()).toBe("11444");
    const abschlag = schaetzeOffeneWandlung({ ...basis, abschlag: "0.2", bewertungsobergrenze: "11000000" });
    expect(abschlag.status === "geschaetzt" && abschlag.massgeblich).toBe("abschlag");
    expect(abschlag.status === "geschaetzt" && abschlag.fehlend).toEqual([]);
  });

  it("nur Cap über dem Rundenpreis: der Rundenpreis gilt", () => {
    const e = schaetzeOffeneWandlung({ ...basis, bewertungsobergrenze: "20000000" });
    expect(e.status === "geschaetzt" && e.massgeblich).toBe("rundenpreis");
    expect(e.status === "geschaetzt" && e.preisJeAnteil.toString()).toBe("12.5");
  });

  it("stimmt mit der Wandlung zum selben Cut-off überein", () => {
    const s = schaetzeOffeneWandlung({ ...basis, abschlag: "0.2", bewertungsobergrenze: "9000000" });
    const w = wandlung({
      bewegungen: basis.bewegungen.slice(),
      bedingungen: basis.bedingungen!,
      cutoff: basis.stichtag,
      zinsenWandeln: true,
      preisregel: { rundenpreisJeAnteil: "12.5", discount: "0.2", bewertungsobergrenze: { betrag: "9000000", anteileVorRunde: 1_000_000 } },
      nennwertJeAnteil: 1,
    });
    expect(s.status === "geschaetzt" && s.anteile.toString()).toBe(w.anzahlAnteile.toString());
    expect(s.betrag.toString()).toBe(w.wandlungsbetrag.toString());
  });

  it("fehlende Daten: weder Cap noch Abschlag ist offen, nicht der Rundenpreis", () => {
    const e = schaetzeOffeneWandlung(basis);
    expect(e.status).toBe("offen");
    expect(e.status === "offen" && e.grund).toBe("keine_parameter");
    expect(e.fehlend).toEqual(["abschlag", "bewertungsobergrenze"]);
    expect(e.betrag.toString()).toBe("103000");
  });

  it("fehlende Daten: ohne Runde kein Preis und keine Bezugsgröße", () => {
    const ohne = schaetzeOffeneWandlung({ ...basis, referenzpreis: null, anteileVorWandlung: 0, abschlag: "0.2", bewertungsobergrenze: "8000000" });
    expect(ohne.status === "offen" && ohne.grund).toBe("kein_referenzpreis");
    const nurAbschlag = schaetzeOffeneWandlung({ ...basis, referenzpreis: null, abschlag: "0.2" });
    expect(nurAbschlag.status === "offen" && nurAbschlag.grund).toBe("kein_referenzpreis");
  });

  it("fehlende Daten: kein Kapital am Stichtag (vor der Auszahlung oder getilgt)", () => {
    expect(schaetzeOffeneWandlung({ ...basis, abschlag: "0.2", stichtag: "2025-12-31" }).status === "offen").toBe(true);
    const getilgt = schaetzeOffeneWandlung({ ...basis, abschlag: "0.2", bewegungen: [...basis.bewegungen, { datum: "2026-06-30", art: "tilgung", betrag: 100_000 }] });
    expect(getilgt.status === "offen" && getilgt.grund).toBe("kein_kapital");
  });

  it("ungültiger Abschlag wird offen statt zu werfen", () => {
    const e = schaetzeOffeneWandlung({ ...basis, abschlag: "1" });
    expect(e.status === "offen" && e.grund).toBe("ungueltige_parameter");
  });

  it("Zinsen: nur seit der letzten gebuchten Periode, ohne Mitwandeln nur Kapital, ohne Konditionen mit Hinweis", () => {
    const ab = schaetzeOffeneWandlung({ ...basis, abschlag: "0.2", zinsenAb: "2026-04-01" });
    expect(ab.zinsen.toString()).toBe("1500");
    const ohne = schaetzeOffeneWandlung({ ...basis, abschlag: "0.2", zinsenWandeln: false });
    expect(ohne.betrag.toString()).toBe("100000");
    expect(ohne.status === "geschaetzt" && ohne.anteile.toString()).toBe("10000");
    const keine = schaetzeOffeneWandlung({ ...basis, abschlag: "0.2", bedingungen: undefined });
    expect(keine.zinsen.toString()).toBe("0");
    expect(keine.hinweise).toEqual(["ohne_zinsen"]);
  });

  it("Bewegungen nach dem Stichtag zählen nicht", () => {
    const e = schaetzeOffeneWandlung({ ...basis, abschlag: "0.2", bewegungen: [...basis.bewegungen, { datum: "2026-09-01", art: "tilgung", betrag: 100_000 }] });
    expect(e.status).toBe("geschaetzt");
    expect(e.kapital.toString()).toBe("100000");
  });
});
