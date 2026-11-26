import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { aktiverEintrag, tabSuche, useInhalt } from "./tabs";

const eintraege = [
  { id: "uebersicht", tab: "uebersicht" },
  { id: "transaktionen", tab: "transaktionen" },
  { id: "runden", tab: "kapital", unter: "runden" },
  { id: "kapitaltabelle", tab: "kapital", unter: "tabelle" },
  { id: "esg", tab: "kennzahlen", unter: "esg" },
];

function verwende(suche: { tab?: string; unter?: string }) {
  const navigate = vi.fn();
  const { result } = renderHook(() => useInhalt(suche, navigate, eintraege));
  const geschrieben = (id: string) => {
    result.current.setzeAktiv(id);
    const aufruf = navigate.mock.calls.at(-1)?.[0] as { search: (alt: Record<string, unknown>) => Record<string, unknown> };
    return aufruf.search({ stichtag: "2026-01-01", tab: "alt", unter: "alt" });
  };
  return { result, navigate, geschrieben };
}

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

describe("useInhalt", () => {
  it("liefert die aktive Id", () => {
    expect(verwende({ tab: "kapital", unter: "tabelle" }).result.current.aktiv).toBe("kapitaltabelle");
    expect(verwende({}).result.current.aktiv).toBe("uebersicht");
  });
  it("schreibt tab und unter in einer Navigation und behält andere Parameter", () => {
    const { navigate, geschrieben } = verwende({});
    expect(geschrieben("kapitaltabelle")).toEqual({ stichtag: "2026-01-01", tab: "kapital", unter: "tabelle" });
    expect(navigate).toHaveBeenCalledTimes(1);
  });
  it("Eintrag ohne unter entfernt unter", () => {
    expect(verwende({}).geschrieben("transaktionen")).toEqual({ stichtag: "2026-01-01", tab: "transaktionen", unter: undefined });
  });
  it("erster Eintrag entfernt beide Parameter", () => {
    expect(verwende({ tab: "kapital" }).geschrieben("uebersicht")).toEqual({ stichtag: "2026-01-01", tab: undefined, unter: undefined });
  });
});
