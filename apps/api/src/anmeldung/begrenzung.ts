import { sql } from "drizzle-orm";
import type { Db } from "@carraway/db";

/** Interner Kopf, mit dem der Wrapper die Client-IP an die Hooks von Better Auth reicht (von außen gesetzte Werte werden überschrieben). */
export const IP_KOPF = "x-carraway-ip";

export async function fehlversuche(db: Db, schluessel: string, fensterMs: number): Promise<number> {
  const { rows } = await db.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM anmeldeversuch WHERE schluessel = ${schluessel} AND am > now() - ${`${Math.round(fensterMs / 1000)} seconds`}::interval`,
  );
  return rows[0]?.n ?? 0;
}

export async function merkeFehlversuch(db: Db, schluessel: string[], fensterMs: number) {
  for (const s of schluessel) await db.execute(sql`INSERT INTO anmeldeversuch (schluessel) VALUES (${s})`);
  // Alte Zeilen gelegentlich entfernen, ohne eine eigene Wartung zu brauchen.
  if (Math.random() < 0.05) await db.execute(sql`DELETE FROM anmeldeversuch WHERE am < now() - ${`${Math.round((fensterMs * 4) / 1000)} seconds`}::interval`);
}
