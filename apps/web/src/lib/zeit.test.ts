import { describe, expect, it } from "vitest";
import { alsDatetimeLocal, alsStand, formatZeitpunkt, standAusUrl } from "./zeit";

describe("Wissensstand", () => {
  it("wandelt Eingaben in UTC ohne Millisekunden", () => {
    expect(alsStand("2026-06-30T12:00:00Z")).toBe("2026-06-30T12:00:00Z");
    expect(alsStand("2026-06-30T12:00:00+02:00")).toBe("2026-06-30T10:00:00Z");
    expect(alsStand("")).toBeUndefined();
    expect(alsStand("kein datum")).toBeUndefined();
  });

  it("liest nur Zeitstempel mit Zeitzone aus der URL und rettet ein als Leerzeichen angekommenes Plus", () => {
    expect(standAusUrl("2026-06-30T10:00:00Z")).toBe("2026-06-30T10:00:00Z");
    expect(standAusUrl("2026-06-30T12:00:00+02:00")).toBe("2026-06-30T10:00:00Z");
    expect(standAusUrl("2026-06-30T12:00:00 02:00")).toBe("2026-06-30T10:00:00Z");
    expect(standAusUrl("2026-06-30")).toBeUndefined();
    expect(standAusUrl("2026-06-30T12:00:00")).toBeUndefined();
    expect(standAusUrl(5)).toBeUndefined();
  });

  it("macht aus einem Zeitstempel einen Wert für das Eingabefeld und zurück denselben Zeitpunkt", () => {
    const lokal = alsDatetimeLocal("2026-06-30T10:00:00Z");
    expect(lokal).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(alsStand(lokal)).toBe("2026-06-30T10:00:00Z");
    expect(alsDatetimeLocal(undefined)).toBe("");
  });

  it("formatiert Zeitpunkte je Sprache", () => {
    expect(formatZeitpunkt("2026-06-30T10:00:00Z", "de")).toMatch(/^\d{2}\.\d{2}\.2026, \d{2}:\d{2}$/);
    expect(formatZeitpunkt("2026-06-30T10:00:00Z", "en")).toMatch(/^\d{2}\/\d{2}\/2026, \d{2}:\d{2}$/);
  });
});
