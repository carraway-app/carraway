import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { erzeugeDemodaten, schreibeDemodaten, STICHTAG_HEUTE } from "@carraway/db/demo";
import { erzeugeDemoMeldelaeufe } from "../melde/demo";
import { erstelleTestApp } from "./hilfen-auth";
import { leeren, oeffneTestdb } from "./hilfen";
import { aufrufe, json } from "./hilfen-instrumente";

const { db, pool } = oeffneTestdb();
const { get } = aufrufe(erstelleTestApp(db));

/** Die Demo-Daten bekommen je Fonds einen Entwurf des Förderberichts für das letzte Quartal, aus dem echten Rechenweg. */
describe("Demo-Daten: Meldeläufe", () => {
  beforeAll(async () => {
    await schreibeDemodaten(db, erzeugeDemodaten({ seed: 1 }));
  }, 60_000);
  afterAll(async () => {
    await leeren(db);
    await pool.end();
  });

  it("ein Entwurf je Fonds für das dritte Quartal 2026, wiederholbar ohne Doppelung", async () => {
    const { laeufe } = await erzeugeDemoMeldelaeufe(db, STICHTAG_HEUTE);
    const fonds = (await get("/fonds").then(json)).daten as { id: string; vintage: number }[];
    expect(laeufe).toBe(fonds.filter((f) => f.vintage <= 2026).length);
    expect(laeufe).toBeGreaterThan(0);
    expect((await erzeugeDemoMeldelaeufe(db, STICHTAG_HEUTE)).laeufe).toBe(0);

    for (const f of fonds) {
      const liste = (await get(`/reporting-runs?fondsId=${f.id}`).then(json)).daten as { id: string; status: string; periodeKennung: string; fassung: number; erstelltVon: string }[];
      expect(liste).toHaveLength(1);
      expect(liste[0]).toMatchObject({ status: "entwurf", periodeKennung: "2026-Q3", fassung: 1, erstelltVon: "system:demo" });
      const l = await get(`/reporting-runs/${liste[0]!.id}`).then(json);
      const wert = (k: string) => l.werte.find((w: { schluessel: string }) => w.schluessel === k)?.wert;
      // Gegenprobe gegen SQL: Auszahlungen kumuliert bis Ende des Quartals, ohne die Einlage aus einer Wandlung (kein Geldfluss)
      const { rows } = await db.execute<{ s: string }>(
        sql`SELECT coalesce(sum(v.betrag), 0)::numeric(18,2)::text AS s FROM vorgang v JOIN beteiligung b ON b.id = v.beteiligung_id WHERE b.fonds_id = ${f.id} AND v.art = 'auszahlung' AND v.valuta <= '2026-09-30' AND NOT EXISTS (SELECT 1 FROM wandlung w, jsonb_each_text(w.vorgaenge) j WHERE j.value = v.id::text)`,
      );
      expect(wert("mittelverwendung.auszahlungen_kumuliert")).toBe(rows[0]!.s);
      expect(wert("portfolio_programm._summe.investiert")).toBe(rows[0]!.s);
      // Pflichtfeld von Hand ist leer, die Tabelle je Programm hat Zeilen mit Programmnamen
      expect(l.befunde.some((b: { regelId: string }) => b.regelId === "pflicht_verantwortlich")).toBe(true);
      const tabelle = l.anzeige.find((a: { id: string }) => a.id === "portfolio_programm");
      expect(tabelle.zeilen.length).toBeGreaterThan(0);
    }
  });
});
