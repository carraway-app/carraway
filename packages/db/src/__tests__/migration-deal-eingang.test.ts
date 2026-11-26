import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { afterAll, expect, it } from "vitest";
import { deal, dealPhasenwechsel, erstelleDb, organisation } from "../index";
import { TESTDB_URL } from "./hilfen";

const { db, pool } = erstelleDb(TESTDB_URL);
afterAll(() => pool.end());

it("Migration 0063 setzt das Eingangsdatum aus dem ersten Phasendatum oder dem Berliner Anlagedatum", async () => {
  const datei = new URL("../../drizzle/0063_deal_eingang_dealtyp.sql", import.meta.url);
  const rueckfuellung = readFileSync(datei, "utf8").split("--> statement-breakpoint").find((teil) => teil.includes('UPDATE "deal"'));
  expect(rueckfuellung).toBeDefined();
  const rueckrollen = new Error("Testdaten zurückrollen");

  await expect(db.transaction(async (tx) => {
    const [org] = await tx.insert(organisation).values({ name: "Unternehmen im Bestand", art: "unternehmen" }).returning();
    const [mitVerlauf, ohneVerlauf] = await tx.insert(deal).values([
      { organisationId: org!.id, titel: "Mit Verlauf", erstelltAm: new Date("2025-03-30T22:30:00Z") },
      { organisationId: org!.id, titel: "Ohne Verlauf", erstelltAm: new Date("2025-03-30T22:30:00Z") },
    ]).returning();
    await tx.insert(dealPhasenwechsel).values([
      { dealId: mitVerlauf!.id, vonPhase: "anfrage", nachPhase: "pruefung", am: "2025-03-04" },
      { dealId: mitVerlauf!.id, nachPhase: "anfrage", am: "2025-03-03" },
    ]);

    await tx.execute(sql.raw(rueckfuellung!));
    const ergebnis = await tx.execute<{ titel: string; datum: string; herkunft: string | null }>(sql`
      SELECT titel, eingangsdatum::text AS datum, herkunft
      FROM deal WHERE id IN (${mitVerlauf!.id}, ${ohneVerlauf!.id}) ORDER BY titel
    `);
    expect(ergebnis.rows).toEqual([
      { titel: "Mit Verlauf", datum: "2025-03-03", herkunft: null },
      { titel: "Ohne Verlauf", datum: "2025-03-31", herkunft: null },
    ]);
    throw rueckrollen;
  })).rejects.toBe(rueckrollen);
});
