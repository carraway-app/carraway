import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { erstelleDb } from "../index";
import { TESTDB_URL } from "./hilfen";

/**
 * Migration 0049 (CRM und Dealflow, Etappe 20): Der Test spielt den Datenschritt (Hauptbeschäftigungen aus `person.organisation_id`) auf Bestandsdaten nach und rollt
 * am Ende zurück. Geprüft wird, dass nichts verloren geht: Personen, Unternehmen und Deals behalten ihre Werte, neue Spalten haben unschädliche Vorgaben,
 * jede Person mit Unternehmen bekommt genau eine Hauptzeile, Personen ohne Unternehmen keine.
 */

const { db, pool } = erstelleDb(TESTDB_URL);
afterAll(async () => {
  await pool.end();
});

const DATEI = new URL("../../drizzle/0049_crm_objekte.sql", import.meta.url);
const ABBRUCH = new Error("zurückrollen");

describe("Migration 0049", () => {
  it("führt Bestandsdaten ohne Verlust in die Beschäftigungen über", async () => {
    const schritte = readFileSync(DATEI, "utf8")
      .split("--> statement-breakpoint")
      .map((x) => x.trim())
      .filter(Boolean);
    const backfill = schritte.filter((x) => /^(--.*\n)?INSERT INTO "beschaeftigung"/m.test(x));
    expect(backfill).toHaveLength(1);

    const ergebnis: { rows: Record<string, unknown>[] }[] = [];
    await db
      .transaction(async (tx) => {
        await tx.execute(sql`DELETE FROM beschaeftigung`);
        await tx.execute(sql`INSERT INTO organisation (id, name, art, ort) VALUES ('00000000-0000-4000-8000-0000000000a1', 'Bestand Alpha', 'unternehmen', 'Berlin'), ('00000000-0000-4000-8000-0000000000a2', 'Bestand Beta', 'investor', NULL)`);
        await tx.execute(sql`INSERT INTO person (id, vorname, nachname, email, funktion, organisation_id) VALUES
          ('00000000-0000-4000-8000-0000000000b1', 'Anna', 'Bestand', 'anna@bestand.example', 'CFO', '00000000-0000-4000-8000-0000000000a1'),
          ('00000000-0000-4000-8000-0000000000b2', 'Ben', 'Bestand', NULL, NULL, '00000000-0000-4000-8000-0000000000a2'),
          ('00000000-0000-4000-8000-0000000000b3', 'Cara', 'Bestand', NULL, 'Beirat', NULL)`);
        await tx.execute(sql`INSERT INTO deal (id, organisation_id, titel, ticket) VALUES ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000a1', 'Bestand Deal', '12345.60')`);
        for (const schritt of backfill) await tx.execute(sql.raw(schritt));
        ergebnis.push(
          await tx.execute(sql`SELECT person_id, organisation_id, funktion, haupt, bis FROM beschaeftigung ORDER BY person_id`),
          await tx.execute(sql`SELECT vorname, email, funktion, organisation_id, felder::text AS felder, archiviert_am FROM person WHERE id::text LIKE '00000000-0000-4000-8000-0000000000b%' ORDER BY id`),
          await tx.execute(sql`SELECT name, art, ort, felder::text AS felder, archiviert_am, email FROM organisation WHERE id::text LIKE '00000000-0000-4000-8000-0000000000a%' ORDER BY id`),
          await tx.execute(sql`SELECT titel, ticket::text AS ticket, felder::text AS felder FROM deal WHERE id = '00000000-0000-4000-8000-0000000000c1'`),
        );
        throw ABBRUCH;
      })
      .catch((e: unknown) => {
        if (e !== ABBRUCH) throw e;
      });

    const [haupt, personen, organisationen, deals] = ergebnis as [(typeof ergebnis)[0], (typeof ergebnis)[0], (typeof ergebnis)[0], (typeof ergebnis)[0]];
    expect(haupt.rows).toEqual([
      { person_id: "00000000-0000-4000-8000-0000000000b1", organisation_id: "00000000-0000-4000-8000-0000000000a1", funktion: "CFO", haupt: true, bis: null },
      { person_id: "00000000-0000-4000-8000-0000000000b2", organisation_id: "00000000-0000-4000-8000-0000000000a2", funktion: null, haupt: true, bis: null },
    ]);
    expect(personen.rows).toEqual([
      { vorname: "Anna", email: "anna@bestand.example", funktion: "CFO", organisation_id: "00000000-0000-4000-8000-0000000000a1", felder: "{}", archiviert_am: null },
      { vorname: "Ben", email: null, funktion: null, organisation_id: "00000000-0000-4000-8000-0000000000a2", felder: "{}", archiviert_am: null },
      { vorname: "Cara", email: null, funktion: "Beirat", organisation_id: null, felder: "{}", archiviert_am: null },
    ]);
    expect(organisationen.rows).toEqual([
      { name: "Bestand Alpha", art: "unternehmen", ort: "Berlin", felder: "{}", archiviert_am: null, email: null },
      { name: "Bestand Beta", art: "investor", ort: null, felder: "{}", archiviert_am: null, email: null },
    ]);
    expect(deals.rows).toEqual([{ titel: "Bestand Deal", ticket: "12345.60", felder: "{}" }]);
  });

  it("legt die Indizes und Prüfungen an (eine Hauptzeile je Person, Feldschlüssel, Aufgabenbezug)", async () => {
    const indizes = (await db.execute<{ indexname: string }>(sql`SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`)).rows.map((r) => r.indexname);
    for (const i of ["beschaeftigung_haupt_idx", "organisation_felder_idx", "person_felder_idx", "deal_felder_idx", "feld_definition_global_idx", "liste_eintrag_eindeutig_idx", "datensatz_link_eindeutig_idx"]) expect(indizes).toContain(i);
    await expect(
      db.transaction(async (tx) => {
        await tx.execute(sql`INSERT INTO person (id, vorname, nachname) VALUES ('00000000-0000-4000-8000-0000000000d1', 'X', 'Y')`);
        await tx.execute(sql`INSERT INTO organisation (id, name, art) VALUES ('00000000-0000-4000-8000-0000000000d2', 'O1', 'sonstige'), ('00000000-0000-4000-8000-0000000000d3', 'O2', 'sonstige')`);
        await tx.execute(sql`INSERT INTO beschaeftigung (person_id, organisation_id, haupt) VALUES ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000d2', true)`);
        await tx.execute(sql`INSERT INTO beschaeftigung (person_id, organisation_id, haupt) VALUES ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000d3', true)`);
      }),
    ).rejects.toThrow();
    await expect(db.execute(sql`INSERT INTO feld_definition (objekt, schluessel, name, typ) VALUES ('person', 'Ungültig!', 'x', 'text')`)).rejects.toThrow();
    await expect(db.execute(sql`INSERT INTO aufgabe (titel, erstellt_von) VALUES ('ohne Bezug', 'test')`)).rejects.toThrow();
  });
});
