import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { erzeugeDemodaten, schreibeDemodaten } from "@carraway/db/demo";
import { kontenAusVerteilung, ladeVerteilung } from "../berichte/daten";
import { aktiverLauf, stimmeLiquiditaetAb, ladeAuswertung } from "../buchhaltung/auswertung";
import { berechneFondsUebersicht } from "../kennzahlen/fonds";
import { leeren, oeffneTestdb } from "./hilfen";

/** Demo (Issue #157): Die anteilig gebuchten Kosten ändern keinen NAV-Anteil, und die Liquiditätsabstimmung erklärt sie. */

const { db, pool } = oeffneTestdb();
const STICHTAG = "2026-09-30";

beforeAll(async () => {
  await schreibeDemodaten(db, erzeugeDemodaten({ seed: 1 }));
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

describe("Demo: Verwaltungsvergütung und Fondskosten", () => {
  it("lässt die NAV-Anteile unverändert (kein Ausgleich) und zieht die Kosten in der Abstimmung ab", async () => {
    const fonds = await db.select({ id: s.fonds.id }).from(s.fonds);
    expect(fonds.length).toBeGreaterThan(0);
    for (const { id } of fonds) {
      const u = await berechneFondsUebersicht(db, id, STICHTAG);
      const verteilung = await ladeVerteilung(db, id, STICHTAG, undefined);
      expect(verteilung.kosten.length).toBeGreaterThan(0);
      const konten = kontenAusVerteilung(verteilung, u.kennzahlen.nav.wert);
      expect(konten.every((k) => k.kostenausgleich === "0.00")).toBe(true);
      // Die Abstimmung erwartet eine Transaktion; lesend genügt die Verbindung.
      const tx = db as unknown as Parameters<typeof aktiverLauf>[0];
      const lauf = await aktiverLauf(tx, id, STICHTAG);
      const a = await stimmeLiquiditaetAb(tx, lauf, await ladeAuswertung(tx, lauf, "liquiditaet"));
      expect(a?.schritte.some((x) => x.bezeichnung === "Verwaltungsvergütung und Fondskosten (gebucht)")).toBe(true);
    }
  });
});
