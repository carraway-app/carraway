import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { erstelleDb } from "../index";
import { TESTDB_URL } from "./hilfen";

/**
 * Datenmigration 0064: Der Test baut in einer Transaktion Bestandsdaten vor der Befüllung nach (Buchung aus dem Rundenabschluss, Wandlung,
 * Runde des Instruments, Storno, unzugeordneter Vorgang), spielt die Befüllung aus der Migrationsdatei ab und rollt am Ende zurück.
 */

const { db, pool } = erstelleDb(TESTDB_URL);
afterAll(async () => {
  await pool.end();
});

const DATEI = new URL("../../drizzle/0064_vorgang_runde_bruecke.sql", import.meta.url);
const ABBRUCH = new Error("zurückrollen");
const id = (k: string) => `00000000-0000-4000-8000-0000000${k.padStart(5, "0")}`;
const [F, ORG, B, I_EK, I_WD, R_A, R_BRUECKE, R_ZIEL, P] = ["f7", "a7", "b7", "c7", "c8", "e7", "e8", "e9", "d7"].map(id) as string[];
const [V_BUCHUNG, V_WANDLUNG, V_INSTRUMENT, V_STORNO, V_OHNE, V_WD_ZINS, W] = ["01", "02", "03", "04", "05", "06", "a1"].map((k) => id(`9${k}`)) as string[];

const schritte = () =>
  readFileSync(DATEI, "utf8")
    .split("--> statement-breakpoint")
    .map((x) => x.trim())
    .filter((x) => x.includes('INSERT INTO "vorgang_runde"'));

describe("Migration 0064: Befüllung der Zuordnung", () => {
  it("nimmt Rundenabschluss vor Wandlung vor Instrument, Stornos erben, der Rest bleibt ohne Runde", async () => {
    let zeilen: { vorgang_id: string; runde_id: string }[] = [];
    await db
      .transaction(async (tx) => {
        await tx.execute(sql`INSERT INTO fonds (id, name, kurzname, vintage, zeichnungskapital, waehrung) VALUES (${F}::uuid, 'Migrationsfonds', 'MIGV', 2024, '1000000.00', 'EUR')`);
        await tx.execute(sql`INSERT INTO organisation (id, name, art) VALUES (${ORG}::uuid, 'Migrationsfirma', 'unternehmen')`);
        await tx.execute(sql`INSERT INTO beteiligung (id, fonds_id, organisation_id, instrument, status, erstinvestment) VALUES (${B}::uuid, ${F}::uuid, ${ORG}::uuid, 'offene_beteiligung', 'aktiv', '2024-01-01')`);
        await tx.execute(sql`INSERT INTO finanzierungsrunde (id, organisation_id, art, bezeichnung, datum, pre_money, post_money, preis_je_anteil, anteile_gesamt_nach) VALUES
          (${R_A}::uuid, ${ORG}::uuid, 'eigenkapital', 'Seed', '2024-01-01', 100, 200, 1, 200),
          (${R_ZIEL}::uuid, ${ORG}::uuid, 'eigenkapital', 'Serie A', '2025-01-01', 1000, 1100, 1, 1100)`);
        await tx.execute(sql`INSERT INTO finanzierungsrunde (id, organisation_id, art, bezeichnung, datum) VALUES (${R_BRUECKE}::uuid, ${ORG}::uuid, 'bruecke', 'Brücke', '2024-09-01')`);
        await tx.execute(sql`INSERT INTO instrument (id, beteiligung_id, art, bezeichnung, runde_id) VALUES
          (${I_EK}::uuid, ${B}::uuid, 'offene_beteiligung', 'Seed-Anteile', ${R_A}::uuid),
          (${I_WD}::uuid, ${B}::uuid, 'wandeldarlehen', 'Brückendarlehen', ${R_BRUECKE}::uuid)`);
        await tx.execute(sql`INSERT INTO rundenposition (id, runde_id, fonds_id, betrag, anteile, rolle, instrument_id) VALUES (${P}::uuid, ${R_A}::uuid, ${F}::uuid, 100, 100, 'lead', ${I_EK}::uuid)`);
        await tx.execute(sql`INSERT INTO vorgang (id, beteiligung_id, instrument_id, art, valuta, betrag) VALUES
          (${V_BUCHUNG}::uuid, ${B}::uuid, ${I_EK}::uuid, 'zusage', '2024-01-02', 100),
          (${V_WANDLUNG}::uuid, ${B}::uuid, ${I_WD}::uuid, 'tilgung', '2025-01-02', 50),
          (${V_WD_ZINS}::uuid, ${B}::uuid, ${I_WD}::uuid, 'zins', '2025-01-02', 5),
          (${V_INSTRUMENT}::uuid, ${B}::uuid, ${I_WD}::uuid, 'zusage', '2024-09-02', 50),
          (${V_OHNE}::uuid, ${B}::uuid, ${I_EK}::uuid, 'auszahlung', '2024-01-03', 10)`);
        // Dieser Vorgang gehört dem Instrument ohne Runde und hat deshalb keine Zuordnung außer über den Storno-Verweis.
        await tx.execute(sql`INSERT INTO vorgang (id, beteiligung_id, instrument_id, art, valuta, betrag, storniert_vorgang_id) VALUES (${V_STORNO}::uuid, ${B}::uuid, ${I_WD}::uuid, 'tilgung', '2025-01-03', -50, ${V_WANDLUNG}::uuid)`);
        await tx.execute(sql`INSERT INTO runde_buchung (vorgang_id, runde_id, position_id, art) VALUES (${V_BUCHUNG}::uuid, ${R_A}::uuid, ${P}::uuid, 'zusage')`);
        await tx.execute(sql`INSERT INTO wandlung (id, darlehen_beteiligung_id, ziel_beteiligung_id, quell_instrument_id, ziel_instrument_id, runde_id, cutoff, zinsen_wandeln, preisregel, nennwert_je_anteil, anzahl_anteile, preis_je_anteil, massgeblich, wandlungsbetrag, nominal, agio, spitzenbetrag, zinsen_gebucht, ergebnis, vorgaenge)
          VALUES (${W}::uuid, ${B}::uuid, ${B}::uuid, ${I_WD}::uuid, ${I_EK}::uuid, ${R_ZIEL}::uuid, '2025-01-02', false, '{}'::jsonb, 1, 50, 1, 'rundenpreis', 55, 50, 5, 0, 5, '{}'::jsonb,
          ${JSON.stringify({ darlehen_tilgung_1: V_WANDLUNG, darlehen_zins_0: V_WD_ZINS, ziel_zusage_2: null })}::jsonb)`);
        for (const schritt of schritte()) await tx.execute(sql.raw(schritt));
        zeilen = (await tx.execute(sql`SELECT vorgang_id::text, runde_id::text FROM vorgang_runde`)).rows as typeof zeilen;
        throw ABBRUCH;
      })
      .catch((e: unknown) => {
        if (e !== ABBRUCH) throw e;
      });
    const je = new Map(zeilen.map((z) => [z.vorgang_id, z.runde_id]));
    expect(je.get(V_BUCHUNG!)).toBe(R_A);
    // Die Buchungen der Wandlung gehören zur Zielrunde, nicht zur Brücke des Darlehens.
    expect(je.get(V_WANDLUNG!)).toBe(R_ZIEL);
    expect(je.get(V_WD_ZINS!)).toBe(R_ZIEL);
    // Vor der Wandlung gilt die Runde des Instruments (die Brücke).
    expect(je.get(V_INSTRUMENT!)).toBe(R_BRUECKE);
    // Das Storno erbt die Runde des Originals.
    expect(je.get(V_STORNO!)).toBe(R_ZIEL);
    // Der Vorgang aus der Runde des Eigenkapital-Instruments (Auszahlung) folgt dem Instrument.
    expect(je.get(V_OHNE!)).toBe(R_A);
    expect(je.size).toBe(6);
  });
});
