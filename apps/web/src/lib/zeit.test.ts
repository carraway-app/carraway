import { describe, expect, it } from "vitest";
import { alsDatetimeLocal, alsStand, formatZeitpunkt, standAusUrl } from "./zeit";
import { datumDesStands, endeDesTages, istTagesende } from "./wissensstand";

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

describe("Wissensstand als Datum (Ende des Tages, Europe/Berlin)", () => {
  it("rechnet das Ende des Tages in Winter- und Sommerzeit, auf die Mikrosekunde", () => {
    expect(endeDesTages("2026-01-15")).toBe("2026-01-15T22:59:59.999999Z");
    expect(endeDesTages("2026-09-30")).toBe("2026-09-30T21:59:59.999999Z");
  });
  it("behandelt die Umstellungstage richtig", () => {
    // 29.03.2026: Umstellung auf Sommerzeit, der Tag endet um 22:00 UTC.
    expect(endeDesTages("2026-03-28")).toBe("2026-03-28T22:59:59.999999Z");
    expect(endeDesTages("2026-03-29")).toBe("2026-03-29T21:59:59.999999Z");
    // 25.10.2026: Umstellung auf Winterzeit, der Tag endet um 23:00 UTC.
    expect(endeDesTages("2026-10-24")).toBe("2026-10-24T21:59:59.999999Z");
    expect(endeDesTages("2026-10-25")).toBe("2026-10-25T22:59:59.999999Z");
  });
  it("lehnt ungültige Eingaben ab", () => {
    expect(endeDesTages(undefined)).toBeUndefined();
    expect(endeDesTages("30.09.2026")).toBeUndefined();
  });
  it("liest den Tag aus einem Zeitpunkt, auch aus älteren Links mit Uhrzeit", () => {
    expect(datumDesStands("2026-09-30T21:59:59.999999Z")).toBe("2026-09-30");
    expect(datumDesStands("2026-09-30T22:30:00Z")).toBe("2026-10-01");
    expect(datumDesStands(undefined)).toBe("");
    expect(istTagesende("2026-09-30T21:59:59.999999Z")).toBe(true);
    expect(istTagesende("2026-09-30T10:15:00Z")).toBe(false);
    // Der Wert übersteht die Adresse und bleibt das Tagesende.
    expect(standAusUrl(endeDesTages("2026-09-30"))).toBe("2026-09-30T21:59:59.999999Z");
  });
});
