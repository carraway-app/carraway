import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { erstelleTestApp } from "./hilfen-auth";
import { leeren, oeffneTestdb } from "./hilfen";
import { aufrufe, grundbestand, ID, json, vorgaengeAnlegen } from "./hilfen-instrumente";

/**
 * Wissensstand als Datum: Die Oberfläche fragt nur ein Datum ab und schickt das Ende dieses Tages in Europe/Berlin als Zeitpunkt
 * (`apps/web/src/lib/zeit.ts`, `endeDesTages`, auf die Mikrosekunde: `…T22:59:59.999999Z` im Winter, `…T21:59:59.999999Z` im Sommer).
 * Die API bleibt beim Zeitpunkt. Geprüft wird die Grenze: Eine Erfassung um 23:59 Uhr Ortszeit zählt mit, eine am Folgetag nicht.
 * Alle Daten sind erfunden.
 */

const { db, pool } = oeffneTestdb();
const { get } = aufrufe(erstelleTestApp(db));

beforeEach(async () => {
  await grundbestand(db);
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

/** Zusage und zwei Auszahlungen, mit Erfassungszeitpunkten an der Grenze (Vorgänge sind unveränderlich, darum gleich beim Anlegen). */
async function auszahlungenUmMitternacht(spaet: string, folgetag: string) {
  await vorgaengeAnlegen(db, [
    { beteiligungId: ID.darlehen, art: "zusage", valuta: "2025-01-01", betrag: "100000.00", erfasstAm: new Date("2020-01-01T00:00:00Z") },
    { beteiligungId: ID.darlehen, art: "auszahlung", valuta: "2025-02-01", betrag: "10000.00", erfasstAm: new Date(spaet) },
    { beteiligungId: ID.darlehen, art: "auszahlung", valuta: "2025-02-01", betrag: "20000.00", erfasstAm: new Date(folgetag) },
  ]);
}

const investiert = async (stand: string) => (await json(await get(`/beteiligungen/${ID.darlehen}/instrumentdaten?stand=${encodeURIComponent(stand)}`))).zustand.investiert as string;

describe("Wissensstand bis Ende des Tages (Europe/Berlin)", () => {
  it("Winterzeit: 23:59 Uhr zählt mit, 00:01 Uhr am Folgetag nicht", async () => {
    // 28.03.2026 23:59 Ortszeit (UTC+1) = 22:59Z; 29.03.2026 00:01 Ortszeit = 23:01Z am 28.03.
    await auszahlungenUmMitternacht("2026-03-28T22:59:00Z", "2026-03-28T23:01:00Z");
    expect(await investiert("2026-03-28T22:59:59.999999Z")).toBe("10000.00");
    // Ende des Folgetags (Umstellung auf Sommerzeit in der Nacht, UTC+2): beide zählen.
    expect(await investiert("2026-03-29T21:59:59.999999Z")).toBe("30000.00");
  });

  it("Sommerzeit: 23:59 Uhr zählt mit, 00:01 Uhr am Folgetag nicht", async () => {
    // 30.09.2026 23:59 Ortszeit (UTC+2) = 21:59Z; 01.10.2026 00:01 Ortszeit = 22:01Z am 30.09.
    await auszahlungenUmMitternacht("2026-09-30T21:59:00Z", "2026-09-30T22:01:00Z");
    expect(await investiert("2026-09-30T21:59:59.999999Z")).toBe("10000.00");
    expect(await investiert("2026-10-01T21:59:59.999999Z")).toBe("30000.00");
  });

  it("die letzte Millisekunde des Tages zählt noch mit, Mitternacht nicht mehr", async () => {
    await auszahlungenUmMitternacht("2026-09-30T21:59:59.999Z", "2026-09-30T22:00:00Z");
    expect(await investiert("2026-09-30T21:59:59.999999Z")).toBe("10000.00");
  });
});
