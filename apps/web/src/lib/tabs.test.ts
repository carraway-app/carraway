import { describe, expect, it } from "vitest";
import { ortAusAdresse } from "../seiten/Beteiligung";
import { mitZielen } from "../komponenten/BereichsLeiste";
import { aktiverEintrag, tabSuche } from "./tabs";

const eintraege = [
  { id: "uebersicht", tab: "uebersicht" },
  { id: "transaktionen", tab: "transaktionen" },
  { id: "runden", tab: "kapital", unter: "runden" },
  { id: "kapitaltabelle", tab: "kapital", unter: "tabelle" },
  { id: "esg", tab: "kennzahlen", unter: "esg" },
];

describe("aktiverEintrag", () => {
  it("nimmt tab und unter genau", () => {
    expect(aktiverEintrag({ tab: "kapital", unter: "tabelle" }, eintraege)?.id).toBe("kapitaltabelle");
    expect(aktiverEintrag({ tab: "kennzahlen", unter: "esg" }, eintraege)?.id).toBe("esg");
  });
  it("nur tab oder unbekanntes unter: erster Eintrag dieses Reiters", () => {
    expect(aktiverEintrag({ tab: "kapital" }, eintraege)?.id).toBe("runden");
    expect(aktiverEintrag({ tab: "kapital", unter: "gibtsnicht" }, eintraege)?.id).toBe("runden");
  });
  it("nichts oder unbekannt: erster Eintrag", () => {
    expect(aktiverEintrag({}, eintraege)?.id).toBe("uebersicht");
    expect(aktiverEintrag({ tab: "unbekannt" }, eintraege)?.id).toBe("uebersicht");
    expect(aktiverEintrag({}, [])).toBeUndefined();
  });
  it("Adressen aus tabSuche funktionieren unverändert", () => {
    expect(aktiverEintrag(tabSuche({ tab: "kennzahlen", unter: "esg" }), eintraege)?.id).toBe("esg");
  });
});

describe("Adressen der Leiste (mitZielen)", () => {
  it("schreibt tab und unter wie bisher; der erste Eintrag steht ohne tab in der Adresse", () => {
    const gruppen = mitZielen([{ id: "g", eintraege: eintraege.map((e) => ({ id: e.id, label: e.id, inhalt: () => null })) }], eintraege, { to: "/x/$id", params: { id: "1" } });
    const ziel = (id: string) => gruppen[0]!.eintraege.find((e) => e.id === id)!.ziel;
    expect(ziel("uebersicht")).toEqual({ to: "/x/$id", params: { id: "1" }, search: {} });
    expect(ziel("kapitaltabelle")).toEqual({ to: "/x/$id", params: { id: "1" }, search: { tab: "kapital", unter: "tabelle" } });
    expect(ziel("transaktionen")).toEqual({ to: "/x/$id", params: { id: "1" }, search: { tab: "transaktionen", unter: undefined } });
  });
});

describe("Beteiligung: bisherige Adressen führen auf die neue Gliederung", () => {
  const orte = [
    { id: "uebersicht", sichten: [{ id: "uebersicht" }] },
    { id: "finanzierung", sichten: [{ id: "runden" }, { id: "instrumente" }, { id: "transaktionen" }, { id: "zinsen" }] },
    { id: "kapitaltabelle", sichten: [{ id: "anteile" }, { id: "wasserfall" }] },
    { id: "bewertung", sichten: [{ id: "bewertungen" }, { id: "verlauf" }, { id: "waehrung" }] },
    { id: "unternehmen", sichten: [{ id: "werte" }, { id: "gremien" }, { id: "esg" }] },
    { id: "dokumente", sichten: [{ id: "dokumente" }] },
    { id: "stammdaten", sichten: [{ id: "foerderung" }, { id: "felder-beteiligung" }, { id: "felder-instrument" }] },
  ];
  it.each([
    [{}, "uebersicht", "uebersicht"],
    [{ tab: "finanzierung" }, "finanzierung", "runden"],
    [{ tab: "finanzierung", unter: "transaktionen" }, "finanzierung", "transaktionen"],
    [{ tab: "finanzierung", unter: "kapitaltabelle" }, "kapitaltabelle", "anteile"],
    [{ tab: "finanzierung", unter: "wasserfall" }, "kapitaltabelle", "wasserfall"],
    [{ tab: "bewertung", unter: "verlauf" }, "bewertung", "verlauf"],
    [{ tab: "kennzahlen", unter: "werte" }, "unternehmen", "werte"],
    [{ tab: "kennzahlen", unter: "esg" }, "unternehmen", "esg"],
    [{ tab: "gremien" }, "unternehmen", "gremien"],
    [{ tab: "foerderung" }, "stammdaten", "foerderung"],
    [{ tab: "felder", unter: "instrument" }, "stammdaten", "felder-instrument"],
    [{ tab: "dokumente" }, "dokumente", "dokumente"],
    [{ tab: "unbekannt" }, "uebersicht", "uebersicht"],
  ])("%o → %s / %s", (suche, ort, sicht) => {
    const r = ortAusAdresse(suche, orte);
    expect([r.ort.id, r.sicht?.id]).toEqual([ort, sicht]);
  });
});
