import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { erstelleDb } from "../index";
import { TESTDB_URL } from "./hilfen";

/**
 * Datenmigration 0059 (Portfolio-Modell, Phase 2): Der Test baut in einer Transaktion den Zustand vor der Migration nach (alte Indizes, zwei
 * Beteiligungen desselben Fonds und Unternehmens), spielt das Zusammenführen und die neuen Indizes aus der Migrationsdatei nach und rollt am
 * Ende zurück. Die Datenbank bleibt unverändert.
 */

const { db, pool } = erstelleDb(TESTDB_URL);
afterAll(async () => {
  await pool.end();
});

const DATEI = new URL("../../drizzle/0059_instrument_eindeutigkeit.sql", import.meta.url);
const ABBRUCH = new Error("zurückrollen");
const id = (k: string) => `00000000-0000-4000-8000-0000000${k.padStart(5, "0")}`;
const [F, ORG, B_ALT, B_NEU, I_ALT, I_NEU, V1, V2, BW1, BW2] = ["f9", "a9", "b9", "ba", "c9", "ca", "d1", "d2", "f1", "f2"].map(id) as string[];

async function vorbereiten(tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) {
  for (const i of ["beteiligung_fonds_organisation_uq", "darlehen_kondition_instrument_ab_uq", "wandlung_quell_instrument_uq"]) await tx.execute(sql.raw(`DROP INDEX ${i}`));
  await tx.execute(sql`INSERT INTO fonds (id, name, kurzname, vintage, zeichnungskapital, waehrung) VALUES (${F}::uuid, 'Migrationsfonds', 'MIGZ', 2024, '1000000.00', 'EUR')`);
  await tx.execute(sql`INSERT INTO organisation (id, name, art) VALUES (${ORG}::uuid, 'Migrationsfirma', 'unternehmen')`);
  await tx.execute(sql`INSERT INTO beteiligung (id, fonds_id, organisation_id, instrument, status, erstinvestment, erstellt_am) VALUES
    (${B_ALT}::uuid, ${F}::uuid, ${ORG}::uuid, 'wandeldarlehen', 'exit', '2024-01-01', '2024-01-01'),
    (${B_NEU}::uuid, ${F}::uuid, ${ORG}::uuid, 'offene_beteiligung', 'aktiv', '2024-06-01', '2024-06-01')`);
  await tx.execute(sql`INSERT INTO instrument (id, beteiligung_id, art, bezeichnung, status, erstellt_am) VALUES
    (${I_ALT}::uuid, ${B_ALT}::uuid, 'wandeldarlehen', 'Wandeldarlehen', 'gewandelt', '2024-01-01'),
    (${I_NEU}::uuid, ${B_NEU}::uuid, 'offene_beteiligung', 'Offene Beteiligung', 'aktiv', '2024-06-01')`);
  await tx.execute(sql`INSERT INTO vorgang (id, beteiligung_id, instrument_id, art, valuta, betrag) VALUES
    (${V1}::uuid, ${B_ALT}::uuid, ${I_ALT}::uuid, 'auszahlung', '2024-01-02', 100000.00),
    (${V2}::uuid, ${B_NEU}::uuid, ${I_NEU}::uuid, 'zusage', '2024-06-02', 120000.00)`);
  await tx.execute(sql`INSERT INTO bewertung (id, beteiligung_id, stichtag, wert, methode, status, erstellt_von, freigegeben_von, freigegeben_am) VALUES
    (${BW1}::uuid, ${B_ALT}::uuid, '2024-06-01', 0, 'sonstige', 'freigegeben', 'a', 'b', now()),
    (${BW2}::uuid, ${B_NEU}::uuid, '2024-12-31', 120000.00, 'anschaffungskosten', 'freigegeben', 'a', 'b', now())`);
}

/** Der Zustand einer früheren Wandlung: Darlehen-Beteiligung (exit) und Eigenkapital-Beteiligung, beide am Cut-off freigegeben bewertet, dazu die Wandlung. */
async function mitWandlung(tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) {
  const R = id("a8");
  await tx.execute(sql`INSERT INTO finanzierungsrunde (id, organisation_id, bezeichnung, datum, pre_money, post_money, preis_je_anteil, anteile_gesamt_nach) VALUES (${R}::uuid, ${ORG}::uuid, 'Serie A', '2024-07-01', 1000000, 1100000, 10, 110000)`);
  await tx.execute(sql`INSERT INTO wandlung (id, darlehen_beteiligung_id, ziel_beteiligung_id, quell_instrument_id, ziel_instrument_id, runde_id, cutoff, zinsen_wandeln, preisregel, nennwert_je_anteil, anzahl_anteile, preis_je_anteil, massgeblich, wandlungsbetrag, nominal, agio, spitzenbetrag, zinsen_gebucht, ergebnis, vorgaenge)
    VALUES (${id("a7")}::uuid, ${B_ALT}::uuid, ${B_NEU}::uuid, ${I_ALT}::uuid, ${I_NEU}::uuid, ${R}::uuid, '2024-12-31', false, '{}'::jsonb, 1, 10000, 10, 'rundenpreis', 100000, 10000, 90000, 0, 0, '{}'::jsonb, '{}'::jsonb)`);
  // das Darlehen wurde am Cut-off mit 0 bewertet, das Eigenkapital zu Anschaffungskosten
  await tx.execute(sql`INSERT INTO bewertung (id, beteiligung_id, stichtag, wert, methode, status, erstellt_von, freigegeben_von, freigegeben_am) VALUES
    (${id("f3")}::uuid, ${B_ALT}::uuid, '2024-12-31', 0, 'sonstige', 'freigegeben', 'a', 'system:ereignis', now())`);
}

const schritte = () =>
  readFileSync(DATEI, "utf8")
    .split("--> statement-breakpoint")
    .map((x) => x.trim())
    .filter((x) => x.startsWith("DO $$") || x.startsWith("CREATE UNIQUE"));

describe("Migration 0059", () => {
  it("führt Beteiligungen desselben Fonds und Unternehmens zur ältesten zusammen und legt die neuen Indizes an", async () => {
    let ergebnis: Record<string, unknown>[][] = [];
    await db
      .transaction(async (tx) => {
        await vorbereiten(tx);
        for (const s of schritte()) await tx.execute(sql.raw(s));
        ergebnis = [
          (await tx.execute(sql`SELECT id, status, instrument, erstinvestment::text FROM beteiligung WHERE fonds_id = ${F}::uuid`)).rows,
          (await tx.execute(sql`SELECT id, beteiligung_id FROM instrument WHERE beteiligung_id IN (${B_ALT}::uuid, ${B_NEU}::uuid) ORDER BY erstellt_am`)).rows,
          (await tx.execute(sql`SELECT beteiligung_id FROM vorgang WHERE id IN (${V1}::uuid, ${V2}::uuid)`)).rows,
          (await tx.execute(sql`SELECT beteiligung_id FROM bewertung WHERE id IN (${BW1}::uuid, ${BW2}::uuid)`)).rows,
        ];
        throw ABBRUCH;
      })
      .catch((e: unknown) => {
        if (e !== ABBRUCH) throw e;
      });
    const [beteiligungen, instrumente, vorgaenge, bewertungen] = ergebnis as [Record<string, unknown>[], Record<string, unknown>[], Record<string, unknown>[], Record<string, unknown>[]];
    expect(beteiligungen).toEqual([{ id: B_ALT, status: "aktiv", instrument: "offene_beteiligung", erstinvestment: "2024-01-01" }]);
    expect(instrumente.map((i) => i.beteiligung_id)).toEqual([B_ALT, B_ALT]);
    expect(vorgaenge.map((v) => v.beteiligung_id)).toEqual([B_ALT, B_ALT]);
    expect(bewertungen.map((v) => v.beteiligung_id)).toEqual([B_ALT, B_ALT]);
  });

  it("führt auch die Bewertungen einer früheren Wandlung am selben Cut-off zusammen: Die des erloschenen Darlehens ist danach ersetzt", async () => {
    let ergebnis: Record<string, unknown>[] = [];
    await db
      .transaction(async (tx) => {
        await vorbereiten(tx);
        await mitWandlung(tx);
        for (const s of schritte()) await tx.execute(sql.raw(s));
        ergebnis = (await tx.execute(sql`SELECT id, beteiligung_id, status FROM bewertung WHERE stichtag = '2024-12-31' ORDER BY id`)).rows;
        throw ABBRUCH;
      })
      .catch((e: unknown) => {
        if (e !== ABBRUCH) throw e;
      });
    expect(ergebnis).toEqual([
      { id: BW2, beteiligung_id: B_ALT, status: "freigegeben" },
      { id: id("f3"), beteiligung_id: B_ALT, status: "ersetzt" },
    ]);
  });

  it("bricht bei einem Konflikt mit einer klaren Meldung ab", async () => {
    await expect(
      db.transaction(async (tx) => {
        await vorbereiten(tx);
        await tx.execute(sql`INSERT INTO bewertung (id, beteiligung_id, stichtag, wert, methode, status, erstellt_von, freigegeben_von, freigegeben_am) VALUES (${id("f3")}::uuid, ${B_ALT}::uuid, '2024-12-31', 0, 'sonstige', 'freigegeben', 'a', 'b', now())`);
        for (const s of schritte()) await tx.execute(sql.raw(s));
      }),
    ).rejects.toThrow(/lassen sich nicht zusammenführen/);
  });

  it("tut ohne Dubletten nichts", async () => {
    await db
      .transaction(async (tx) => {
        await vorbereiten(tx);
        await tx.execute(sql`INSERT INTO organisation (id, name, art) VALUES (${id("aa")}::uuid, 'Zweite Migrationsfirma', 'unternehmen')`);
        await tx.execute(sql`UPDATE beteiligung SET organisation_id = ${id("aa")}::uuid WHERE id = ${B_NEU}::uuid`);
        const vorher = (await tx.execute(sql`SELECT count(*)::int AS n FROM beteiligung`)).rows[0];
        for (const s of schritte()) await tx.execute(sql.raw(s));
        expect((await tx.execute(sql`SELECT count(*)::int AS n FROM beteiligung`)).rows[0]).toEqual(vorher);
        throw ABBRUCH;
      })
      .catch((e: unknown) => {
        if (e !== ABBRUCH) throw e;
      });
  });
});
