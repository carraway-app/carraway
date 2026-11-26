import type { Db } from "../index";
import * as schema from "../schema";
import { testDatenbankUrl } from "../schutz";

export const TESTDB_URL = testDatenbankUrl();

/** Zeichenkette mit zwei Nachkommastellen in Cent (ganze Zahl). */
export const cent = (betrag: string): number => Math.round(Number(betrag) * 100);

/** Legt für eine Beteiligung ein Instrument an (jeder Vorgang braucht eines) und liefert dessen Id. */
export async function neuesInstrument(db: Db, beteiligungId: string, art: (typeof schema.instrument.$inferInsert)["art"] = "offene_beteiligung"): Promise<string> {
  const [zeile] = await db.insert(schema.instrument).values({ beteiligungId, art, bezeichnung: "Testinstrument" }).returning({ id: schema.instrument.id });
  return zeile!.id;
}
