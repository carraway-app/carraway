import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { erstelleDb } from "../index";
import { TESTDB_URL } from "./hilfen";

/**
 * Migration 0066 (eigene Belegarten): Die neuen Spalten sind leer für Bestand, die Eindeutigkeit der festen Arten gilt unverändert, die der
 * eigenen Arten kommt hinzu. Jede Prüfung läuft in einer Transaktion, die zurückgerollt wird.
 */

const { db, pool } = erstelleDb(TESTDB_URL);
afterAll(async () => {
  await pool.end();
});

const ABBRUCH = new Error("zurückrollen");
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const id = (k: string) => `00000000-0000-4000-8000-0000000${k.padStart(5, "0")}`;
const [F, ART_A, ART_B, BEZUG] = ["fb", "a1", "a2", "b1"].map(id) as [string, string, string, string];

async function inTransaktion(fn: (tx: Tx) => Promise<void>) {
  await db
    .transaction(async (tx) => {
      await tx.execute(sql`INSERT INTO fonds (id, name, kurzname, vintage, zeichnungskapital, waehrung) VALUES (${F}::uuid, 'Migrationsfonds', 'MIGB', 2024, '1000000.00', 'EUR')`);
      await tx.execute(sql`INSERT INTO beleg_art_eigen (id, fonds_id, basis_art, bezeichnung_de, bezeichnung_en, erstellt_von) VALUES
        (${ART_A}::uuid, ${F}::uuid, 'auszahlung', 'Art A', 'Type A', 'test'), (${ART_B}::uuid, ${F}::uuid, 'auszahlung', 'Art B', 'Type B', 'test')`);
      await fn(tx);
      throw ABBRUCH;
    })
    .catch((e) => {
      if (e !== ABBRUCH) throw e;
    });
}
const scheitert = async (tx: Tx, anweisung: ReturnType<typeof sql>, index: string) => {
  await tx.execute(sql`SAVEPOINT s`);
  await expect(tx.execute(anweisung)).rejects.toMatchObject({ cause: { constraint: index } });
  await tx.execute(sql`ROLLBACK TO SAVEPOINT s`);
};
const vorlage = (art: string, eigene: string | null) =>
  sql`INSERT INTO beleg_vorlage (fonds_id, art, eigene_art_id, felder, geaendert_von) VALUES (${F}::uuid, ${art}::beleg_art, ${eigene}::uuid, '[]'::jsonb, 'test')`;
const beleg = (art: string, eigene: string | null) =>
  sql`INSERT INTO beleg (fonds_id, art, eigene_art_id, bezug_art, bezug_id, sprache, vorlage, daten, erstellt_von) VALUES (${F}::uuid, ${art}::beleg_art, ${eigene}::uuid, 'vorgang', ${BEZUG}::uuid, 'de', '{}'::jsonb, '{}'::jsonb, 'test')`;

describe("Migration 0066: eigene Belegarten", () => {
  it("Spalten sind für Bestand leer: ein Beleg und eine Vorlage ohne eigene Art bleiben gültig", async () => {
    await inTransaktion(async (tx) => {
      await tx.execute(vorlage("auszahlung", null));
      await tx.execute(beleg("auszahlung", null));
      const zeilen = (await tx.execute(sql`SELECT (SELECT count(*) FROM beleg WHERE eigene_art_id IS NULL)::int AS b, (SELECT count(*) FROM beleg_vorlage WHERE eigene_art_id IS NULL)::int AS v`)).rows[0];
      expect(zeilen).toEqual({ b: 1, v: 1 });
    });
  });

  it("Vorlage: eine je Fonds und fester Art, eine je Fonds und eigener Art; feste und eigene Vorlage derselben Basis-Art koexistieren", async () => {
    await inTransaktion(async (tx) => {
      await tx.execute(vorlage("auszahlung", null));
      await tx.execute(vorlage("auszahlung", ART_A));
      await tx.execute(vorlage("auszahlung", ART_B));
      await scheitert(tx, vorlage("auszahlung", null), "beleg_vorlage_fonds_art_uq");
      await scheitert(tx, vorlage("auszahlung", ART_A), "beleg_vorlage_eigene_art_uq");
    });
  });

  it("Beleg: je Bezug höchstens ein nicht stornierter Beleg der festen Art und je eigener Art; nach Storno ist ein neuer möglich", async () => {
    await inTransaktion(async (tx) => {
      await tx.execute(beleg("auszahlung", null));
      await tx.execute(beleg("auszahlung", ART_A));
      await tx.execute(beleg("auszahlung", ART_B));
      await scheitert(tx, beleg("auszahlung", null), "beleg_bezug_uq");
      await scheitert(tx, beleg("auszahlung", ART_A), "beleg_bezug_eigene_uq");
      await tx.execute(sql`UPDATE beleg SET status = 'storniert', belegnummer = 'X-1', belegnummer_lfd = 1, storno_am = now(), storno_von = 't', storno_grund = 'g' WHERE eigene_art_id = ${ART_A}::uuid`);
      await tx.execute(beleg("auszahlung", ART_A));
    });
  });

  it("eine eigene Art mit Belegen oder Vorlage lässt sich nicht aus der Tabelle löschen", async () => {
    await inTransaktion(async (tx) => {
      await tx.execute(beleg("auszahlung", ART_A));
      await tx.execute(sql`SAVEPOINT s`);
      await expect(tx.execute(sql`DELETE FROM beleg_art_eigen WHERE id = ${ART_A}::uuid`)).rejects.toMatchObject({ cause: { constraint: "beleg_eigene_art_id_beleg_art_eigen_id_fk" } });
      await tx.execute(sql`ROLLBACK TO SAVEPOINT s`);
    });
  });
});
