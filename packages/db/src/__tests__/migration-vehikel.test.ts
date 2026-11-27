import { readdirSync, readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { erstelleDb } from "../index";
import { TESTDB_URL } from "./hilfen";

/**
 * Datenmigration der Vehikel (docs/portfolio-model.md, „Co-investor vehicles“): Der Test baut in einer Transaktion den Zustand vor der Migration
 * nach (Positionen Dritter mit `organisation_id`, ohne Vehikel), spielt die Überführung aus der Migrationsdatei ab und rollt am Ende zurück.
 */

const { db, pool } = erstelleDb(TESTDB_URL);
afterAll(async () => {
  await pool.end();
});

const VERZEICHNIS = new URL("../../drizzle/", import.meta.url);
const DATEI = new URL(readdirSync(VERZEICHNIS).find((n) => /^\d{4}_vehikel\.sql$/.test(n))!, VERZEICHNIS);
const ABBRUCH = new Error("zurückrollen");
const id = (k: string) => `00000000-0000-4000-8000-0000000${k.padStart(5, "0")}`;
const [F, FIRMA_A, FIRMA_B, INV_X, INV_Y, CORP, R_A, R_B] = ["f1", "a1", "a2", "c1", "c2", "c3", "e1", "e2"].map(id) as [string, string, string, string, string, string, string, string];
const [P_FONDS, P_X1, P_X2, P_Y, P_CORP] = ["d1", "d2", "d3", "d4", "d5"].map(id) as [string, string, string, string, string];

const schritte = () =>
  readFileSync(DATEI, "utf8")
    .split("--> statement-breakpoint")
    .map((x) => x.trim())
    .filter((x) => x.includes('INSERT INTO "vehikel"') || x.includes('UPDATE "rundenposition"'));

type Position = { id: string; fonds_id: string | null; vehikel_id: string | null; investor_id: string | null; vehikel_name: string | null; standard: boolean | null };

describe("Migration der Vehikel: Überführung der Positionen Dritter", () => {
  it("legt je Organisation mit Positionen ein Standard-Vehikel mit ihrem Namen an und hängt jede Position daran; Fonds-Positionen bleiben", async () => {
    expect(schritte()).toHaveLength(2);
    let positionen: Position[] = [];
    let vehikel: { investor_id: string; name: string; art: string; status: string; standard: boolean }[] = [];
    await db
      .transaction(async (tx) => {
        // Zustand vor der Migration: Positionen Dritter nennen die Organisation, nicht das Vehikel.
        await tx.execute(sql`ALTER TABLE rundenposition DROP CONSTRAINT rundenposition_ein_investor`);
        await tx.execute(sql`ALTER TABLE rundenposition ADD COLUMN organisation_id uuid REFERENCES organisation(id)`);
        await tx.execute(sql`INSERT INTO fonds (id, name, kurzname, vintage, zeichnungskapital, waehrung) VALUES (${F}::uuid, 'Migrationsfonds', 'MIGVH', 2024, '1000000.00', 'EUR')`);
        await tx.execute(sql`INSERT INTO organisation (id, name, art) VALUES
          (${FIRMA_A}::uuid, 'Firma A', 'unternehmen'), (${FIRMA_B}::uuid, 'Firma B', 'unternehmen'),
          (${INV_X}::uuid, 'Investor X', 'investor'), (${INV_Y}::uuid, 'Investor Y', 'investor'), (${CORP}::uuid, 'Konzern Z', 'unternehmen')`);
        await tx.execute(sql`INSERT INTO finanzierungsrunde (id, organisation_id, bezeichnung, datum, pre_money, post_money, preis_je_anteil, anteile_gesamt_nach) VALUES
          (${R_A}::uuid, ${FIRMA_A}::uuid, 'Seed', '2024-01-01', 1000, 1400, 1, 1400),
          (${R_B}::uuid, ${FIRMA_B}::uuid, 'Seed', '2024-02-01', 1000, 1200, 1, 1200)`);
        await tx.execute(sql`INSERT INTO rundenposition (id, runde_id, fonds_id, organisation_id, betrag, anteile, rolle) VALUES
          (${P_FONDS}::uuid, ${R_A}::uuid, ${F}::uuid, NULL, 100, 100, 'lead'),
          (${P_X1}::uuid, ${R_A}::uuid, NULL, ${INV_X}::uuid, 100, 100, 'co'),
          (${P_X2}::uuid, ${R_B}::uuid, NULL, ${INV_X}::uuid, 100, 100, 'lead'),
          (${P_Y}::uuid, ${R_A}::uuid, NULL, ${INV_Y}::uuid, 100, 100, 'co'),
          (${P_CORP}::uuid, ${R_A}::uuid, NULL, ${CORP}::uuid, 100, 100, 'co')`);
        for (const schritt of schritte()) await tx.execute(sql.raw(schritt));
        positionen = (
          await tx.execute(sql`SELECT p.id::text, p.fonds_id::text, p.vehikel_id::text, v.investor_id::text, v.name AS vehikel_name, v.standard
            FROM rundenposition p LEFT JOIN vehikel v ON v.id = p.vehikel_id WHERE p.runde_id IN (${R_A}::uuid, ${R_B}::uuid) ORDER BY p.id`)
        ).rows as Position[];
        vehikel = (await tx.execute(sql`SELECT investor_id::text, name, art::text, status::text, standard FROM vehikel WHERE investor_id IN (${INV_X}::uuid, ${INV_Y}::uuid, ${CORP}::uuid, ${FIRMA_A}::uuid) ORDER BY name`)).rows as typeof vehikel;
        throw ABBRUCH;
      })
      .catch((e: unknown) => {
        if (e !== ABBRUCH) throw e;
      });

    // Ein Vehikel je Organisation mit Positionen, auch wenn sie nicht als Investor gekennzeichnet ist; das Unternehmen der Runde bekommt keines.
    expect(vehikel).toEqual([
      { investor_id: INV_X, name: "Investor X", art: "fonds", status: "aktiv", standard: true },
      { investor_id: INV_Y, name: "Investor Y", art: "fonds", status: "aktiv", standard: true },
      { investor_id: CORP, name: "Konzern Z", art: "fonds", status: "aktiv", standard: true },
    ].sort((a, b) => a.name.localeCompare(b.name)));
    const nach = new Map(positionen.map((p) => [p.id, p]));
    expect(nach.get(P_FONDS)).toMatchObject({ fonds_id: F, vehikel_id: null });
    expect(nach.get(P_X1)).toMatchObject({ fonds_id: null, investor_id: INV_X, vehikel_name: "Investor X", standard: true });
    // Beide Positionen desselben Investors zeigen auf dasselbe Vehikel.
    expect(nach.get(P_X2)!.vehikel_id).toBe(nach.get(P_X1)!.vehikel_id);
    expect(nach.get(P_Y)).toMatchObject({ investor_id: INV_Y });
    expect(nach.get(P_CORP)).toMatchObject({ investor_id: CORP, vehikel_name: "Konzern Z" });
    expect(positionen.every((p) => (p.fonds_id === null) !== (p.vehikel_id === null))).toBe(true);
  });
});
