import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { erstelleDb } from "../index";
import { TESTDB_URL } from "./hilfen";

/**
 * Datenmigration 0035 (Förder- und Buchhaltungsschlüssel an einer Stelle): Der Test baut in einer Transaktion den Zustand vor der Migration
 * nach (Freitext-Förderprogramm in der Buchhaltung, Tabelle `beteiligung_meldezuordnung`), führt die Datenschritte der Migrationsdatei aus und rollt am
 * Ende zurück. Die Datenbank bleibt unverändert.
 */

const { db, pool } = erstelleDb(TESTDB_URL);
afterAll(async () => {
  await pool.end();
});

const DATEI = new URL("../../drizzle/0035_melde_schluessel_vereinheitlichen.sql", import.meta.url);
const ABBRUCH = new Error("zurückrollen");
const INSTRUMENTE = ["darlehen", "wandeldarlehen", "offene_beteiligung", "stille_beteiligung"];

describe("Migration 0035", () => {
  it("bildet Freitext auf Förderprogramme ab und führt die Meldeschlüssel in die Buchhaltung zusammen", async () => {
    const schritte = readFileSync(DATEI, "utf8")
      .split("--> statement-breakpoint")
      .map((x) => x.trim())
      .filter(Boolean);
    // Die Strukturschritte (Spalten, Fremdschlüssel) sind in der Testdatenbank schon angewendet; ab der Abbildung des Freitexts wird nachgespielt.
    const ab = schritte.findIndex((x) => x.includes("DO $$"));
    expect(ab).toBeGreaterThan(0);
    const datenschritte = schritte.slice(ab);

    const ergebnis: { rows: unknown[] }[] = [];
    await db
      .transaction(async (tx) => {
        await tx.execute(sql`SET CONSTRAINTS ALL DEFERRED`);
        // Vor Migration 0059 durfte ein Fonds ein Unternehmen mit mehreren Instrumenten als getrennte Beteiligungen halten.
        await tx.execute(sql`DROP INDEX beteiligung_fonds_organisation_uq`);
        // Zustand vor der Migration
        await tx.execute(sql`ALTER TABLE beteiligung_buchhaltung ADD COLUMN foerderprogramm text`);
        await tx.execute(sql`CREATE TABLE beteiligung_meldezuordnung (beteiligung_id uuid PRIMARY KEY, foerderprogramm_id uuid, mittelart text, projektnummer text, vertragsnummer text, partnernummer text, buchungskreis text, geaendert_von text NOT NULL, geaendert_am timestamptz NOT NULL DEFAULT now())`);
        await tx.execute(sql`INSERT INTO fonds (id, name, kurzname, vintage, zeichnungskapital, waehrung) VALUES ('00000000-0000-4000-8000-0000000000f1', 'Migrationsfonds', 'MIGFONDS', 2024, '1000000.00', 'EUR')`);
        await tx.execute(sql`INSERT INTO organisation (id, name, art) VALUES ('00000000-0000-4000-8000-0000000000a1', 'Migrationsfirma', 'unternehmen')`);
        const beteiligungen = ["b1", "b2", "b3", "b4"].map((k) => `00000000-0000-4000-8000-0000000000${k}`);
        for (const [i, id] of beteiligungen.entries()) {
          await tx.execute(sql`INSERT INTO beteiligung (id, fonds_id, organisation_id, instrument, status, erstinvestment) VALUES (${id}::uuid, '00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000a1', ${INSTRUMENTE[i]}::instrument_art, 'aktiv', ${`2024-0${i + 1}-01`}::date)`);
        }
        const [b1, b2, b3, b4] = beteiligungen as [string, string, string, string];
        // Programm der Etappe 15 mit gleicher Bezeichnung wie ein Freitext der Buchhaltung: wird wiederverwendet
        await tx.execute(sql`INSERT INTO foerderprogramm (id, schluessel, bezeichnung) VALUES ('00000000-0000-4000-8000-0000000000c1', 'test_mig_vorhanden', 'Programm Vorhanden')`);
        // Buchhaltung: Freitext mit Leerzeichen und Umlaut, gleiche Bezeichnung wie ein Programm, ein leerer Text
        await tx.execute(sql`INSERT INTO beteiligung_buchhaltung (beteiligung_id, projektnummer, foerderprogramm, geaendert_von) VALUES
          (${b1}::uuid, 'P-1', ' Programm Vorhanden ', 'a'), (${b2}::uuid, NULL, 'Förderlinie Süd', 'a'), (${b3}::uuid, 'P-3', '  ', 'a')`);
        // Meldeschlüssel der Etappe 15: b1 (Lücken füllen, Nummer der Buchhaltung bleibt), b3 (Programm füllt die Lücke), b4 (neue Zeile)
        await tx.execute(sql`INSERT INTO beteiligung_meldezuordnung (beteiligung_id, foerderprogramm_id, mittelart, projektnummer, vertragsnummer, geaendert_von) VALUES
          (${b1}::uuid, NULL, 'foerdermittel', 'ALT-1', 'V-1', 'm'),
          (${b3}::uuid, '00000000-0000-4000-8000-0000000000c1', NULL, 'ALT-3', NULL, 'm'),
          (${b4}::uuid, '00000000-0000-4000-8000-0000000000c1', 'eigenmittel', 'ALT-4', 'V-4', 'm')`);
        for (const schritt of datenschritte) await tx.execute(sql.raw(schritt));
        ergebnis.push(
          await tx.execute(sql`SELECT bb.beteiligung_id, bb.projektnummer, bb.vertragsnummer, p.schluessel, p.bezeichnung FROM beteiligung_buchhaltung bb LEFT JOIN foerderprogramm p ON p.id = bb.foerderprogramm_id ORDER BY bb.beteiligung_id`),
          await tx.execute(sql`SELECT schluessel, bezeichnung FROM foerderprogramm ORDER BY schluessel`),
          await tx.execute(sql`SELECT to_regclass('beteiligung_meldezuordnung') AS t`),
          await tx.execute(sql`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'beteiligung_buchhaltung' AND column_name = 'foerderprogramm'`),
        );
        throw ABBRUCH;
      })
      .catch((e: unknown) => {
        if (e !== ABBRUCH) throw e;
      });

    const [zeilen, programme, tabelle, spalte] = ergebnis as [
      { rows: { beteiligung_id: string; projektnummer: string | null; vertragsnummer: string | null; schluessel: string | null; bezeichnung: string | null }[] },
      { rows: { schluessel: string; bezeichnung: string }[] },
      { rows: { t: string | null }[] },
      { rows: { n: number }[] },
    ];
    const je = new Map(zeilen.rows.map((z) => [z.beteiligung_id.slice(-2), z]));
    // b1: Freitext → vorhandenes Programm (nach Bezeichnung), Projektnummer der Buchhaltung gewinnt, Vertragsnummer füllt die Lücke
    expect(je.get("b1")).toMatchObject({ projektnummer: "P-1", vertragsnummer: "V-1", schluessel: "test_mig_vorhanden" });
    // b2: neuer Freitext → neues Programm mit abgeleitetem Schlüssel
    expect(je.get("b2")).toMatchObject({ schluessel: "foerderlinie_sued", bezeichnung: "Förderlinie Süd" });
    // b3: leerer Freitext zählt nicht; das Programm der Etappe 15 füllt die Lücke
    expect(je.get("b3")).toMatchObject({ projektnummer: "P-3", schluessel: "test_mig_vorhanden" });
    // b4: nur in der alten Tabelle: neue Zeile
    expect(je.get("b4")).toMatchObject({ projektnummer: "ALT-4", vertragsnummer: "V-4", schluessel: "test_mig_vorhanden" });
    expect(programme.rows.filter((p) => p.schluessel.startsWith("test_mig") || p.schluessel === "foerderlinie_sued")).toHaveLength(2);
    expect(tabelle.rows[0]?.t).toBeNull();
    expect(spalte.rows[0]?.n).toBe(0);
  });
});
