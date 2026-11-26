import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { erstelleDb } from "../index";
import { TESTDB_URL } from "./hilfen";

/**
 * Datenmigration 0062: Tranche 1 für Instrumente mit Zusage ohne Tranche, Auszahlungen werden zugeordnet.
 * Der Test legt die Daten in einer Transaktion an, spielt die Migrationsdatei nach und rollt am Ende zurück.
 */

const { db, pool } = erstelleDb(TESTDB_URL);
afterAll(async () => {
  await pool.end();
});

const DATEI = new URL("../../drizzle/0062_tranche_aus_zusage.sql", import.meta.url);
const ABBRUCH = new Error("zurückrollen");
const id = (k: string) => `00000000-0000-4000-8000-0000000${k.padStart(5, "0")}`;
const F = id("f1");
const [ORG_A, ORG_B, ORG_C, ORG_D] = ["a1", "a2", "a3", "a4"].map(id) as [string, string, string, string];
const [BA, BB, BC, BD] = ["b1", "b2", "b3", "b4"].map(id) as [string, string, string, string];

type Zeile = Record<string, unknown>;

describe("Migration 0062", () => {
  it("legt Tranche 1 je Instrument mit Zusage und ohne Tranche an und ordnet die Auszahlungen zu", async () => {
    const schritte = readFileSync(DATEI, "utf8")
      .split("--> statement-breakpoint")
      .map((x) => x.trim())
      .filter(Boolean);
    expect(schritte).toHaveLength(1);

    const e: Record<string, Zeile[]> = {};
    await db
      .transaction(async (tx) => {
        const lies = async (name: string, abfrage: ReturnType<typeof sql>) => {
          e[name] = (await tx.execute(abfrage)).rows as Zeile[];
        };
        await tx.execute(sql`INSERT INTO fonds (id, name, kurzname, vintage, zeichnungskapital, waehrung) VALUES (${F}::uuid, 'Trancheonfonds', 'TRNF', 2024, '1000000.00', 'EUR')`);
        for (const [o, name] of [[ORG_A, "Alpha"], [ORG_B, "Beta"], [ORG_C, "Gamma"], [ORG_D, "Delta"]] as const) {
          await tx.execute(sql`INSERT INTO organisation (id, name, art) VALUES (${o}::uuid, ${`Trancheonfirma ${name}`}, 'unternehmen')`);
        }
        const bet = (b: string, o: string) =>
          tx.execute(sql`INSERT INTO beteiligung (id, fonds_id, organisation_id, instrument, status, erstinvestment) VALUES (${b}::uuid, ${F}::uuid, ${o}::uuid, 'darlehen', 'aktiv', '2024-01-01')`);
        for (const [b, o] of [[BA, ORG_A], [BB, ORG_B], [BC, ORG_C], [BD, ORG_D]] as const) await bet(b, o);
        const inst = async (b: string) =>
          ((await tx.execute(sql`INSERT INTO instrument (beteiligung_id, art, bezeichnung) VALUES (${b}::uuid, 'darlehen', 'Darlehen') RETURNING id::text AS id`)).rows[0] as { id: string }).id;
        const [IA, IB, IC, ID] = [await inst(BA), await inst(BB), await inst(BC), await inst(BD)];
        const v = (vid: string, b: string, i: string, art: string, valuta: string, betrag: string, extra?: { storno?: string; tranche?: string }) =>
          tx.execute(sql`INSERT INTO vorgang (id, beteiligung_id, instrument_id, art, valuta, betrag, storniert_vorgang_id, tranche_id)
            VALUES (${vid}::uuid, ${b}::uuid, ${i}::uuid, ${art}::vorgang_art, ${valuta}::date, ${betrag}::numeric, ${extra?.storno ?? null}::uuid, ${extra?.tranche ?? null}::uuid)`);

        // A: zwei Zusagen (die erste storniert), Auszahlungen samt Storno, keine Tranche
        await v(id("d1"), BA, IA, "zusage", "2024-01-01", "5000");
        await v(id("d2"), BA, IA, "zusage", "2024-01-02", "-5000", { storno: id("d1") });
        await v(id("d3"), BA, IA, "zusage", "2024-03-01", "10000");
        await v(id("d4"), BA, IA, "auszahlung", "2024-04-01", "4000");
        await v(id("d5"), BA, IA, "auszahlung", "2024-04-05", "-4000", { storno: id("d4") });
        await v(id("d6"), BA, IA, "auszahlung", "2024-04-05", "3000");
        // B: Zusage und schon eine Tranche, Auszahlung ohne Tranche bleibt unberührt
        await v(id("d7"), BB, IB, "zusage", "2024-01-01", "8000");
        await tx.execute(sql`INSERT INTO tranche (id, beteiligung_id, instrument_id, nummer, bezeichnung, betrag) VALUES (${id("c1")}::uuid, ${BB}::uuid, ${IB}::uuid, 1, 'Vorhanden', '4000.00')`);
        await v(id("d8"), BB, IB, "auszahlung", "2024-02-01", "1000");
        // C: ohne Zusage (nur Rückfluss), keine Tranche
        await v(id("d9"), BC, IC, "rueckfluss", "2024-02-01", "500");
        // D: Auszahlungen übersteigen die Zusage (Altdaten) -> übersprungen
        await v(id("da"), BD, ID, "zusage", "2024-01-01", "1000");
        await v(id("db"), BD, ID, "auszahlung", "2024-02-01", "1500");

        // Zeile für Zeile: Der Trigger der Unveränderlichkeit ist im Test aktiv, die Migration muss ihn selbst umgehen
        for (const schritt of schritte) await tx.execute(sql.raw(schritt));
        // Zweiter Lauf ändert nichts
        await lies("vorZweitlauf", sql`SELECT count(*)::int AS n FROM tranche`);
        for (const schritt of schritte) await tx.execute(sql.raw(schritt));

        await lies("tranchen", sql`SELECT beteiligung_id::text AS b, nummer, bezeichnung, betrag::text AS betrag, geplant_am::text AS geplant, bedingung, erfuellt_am::text AS erfuellt
          FROM tranche ORDER BY beteiligung_id`);
        await lies("auszahlungen", sql`SELECT v.id::text AS id, t.beteiligung_id::text AS tb, t.bezeichnung AS tranche, v.betrag::text AS betrag
          FROM vorgang v LEFT JOIN tranche t ON t.id = v.tranche_id WHERE v.art = 'auszahlung' ORDER BY v.id`);
        await lies("nachZweitlauf", sql`SELECT count(*)::int AS n FROM tranche`);
        await lies("trigger", sql`SELECT tgname, tgenabled::text AS an FROM pg_trigger WHERE tgname IN ('vorgang_kein_update_delete', 'vorgang_periodensperre', 'vorgang_storno_pruefen') ORDER BY 1`);
        throw ABBRUCH;
      })
      .catch((fehler: unknown) => {
        if (fehler !== ABBRUCH) throw fehler;
      });

    // Tranche 1 nur für A (Zusage 10000 wirksam, geplant zur ersten nicht stornierten Zusage); B behält seine Tranche, C und D bekommen keine
    expect(e.tranchen).toEqual([
      { b: BA, nummer: 1, bezeichnung: "Tranche 1", betrag: "10000.00", geplant: "2024-03-01", bedingung: null, erfuellt: null },
      { b: BB, nummer: 1, bezeichnung: "Vorhanden", betrag: "4000.00", geplant: null, bedingung: null, erfuellt: null },
    ]);
    // Auszahlungen von A inklusive Storno an Tranche 1; B, D unverändert ohne Tranche
    expect(e.auszahlungen).toEqual([
      { id: id("d4"), tb: BA, tranche: "Tranche 1", betrag: "4000.00" },
      { id: id("d5"), tb: BA, tranche: "Tranche 1", betrag: "-4000.00" },
      { id: id("d6"), tb: BA, tranche: "Tranche 1", betrag: "3000.00" },
      { id: id("d8"), tb: null, tranche: null, betrag: "1000.00" },
      { id: id("db"), tb: null, tranche: null, betrag: "1500.00" },
    ]);
    expect(e.nachZweitlauf).toEqual(e.vorZweitlauf);
    expect(e.trigger).toEqual([
      { tgname: "vorgang_kein_update_delete", an: "O" },
      { tgname: "vorgang_periodensperre", an: "O" },
      { tgname: "vorgang_storno_pruefen", an: "O" },
    ]);
  });
});
