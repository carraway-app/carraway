import { sql } from "drizzle-orm";
import type { Db } from "@carraway/db";

/** Interner Kopf, mit dem der Wrapper die Client-IP an die Hooks von Better Auth reicht (von außen gesetzte Werte werden überschrieben). */
export const IP_KOPF = "x-carraway-ip";

export async function fehlversuche(db: Pick<Db, "execute">, schluessel: string, fensterMs: number): Promise<number> {
  const { rows } = await db.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM anmeldeversuch WHERE schluessel = ${schluessel} AND am > now() - ${`${Math.round(fensterMs / 1000)} seconds`}::interval`,
  );
  return rows[0]?.n ?? 0;
}

/** Reserviert einen Versuch unter Sperren je Zähler. Nur bei erfolgreicher Prüfung wieder freigeben. */
export async function reserviereVersuch(db: Db, schluessel: string[], limit: { versuche: number; fensterMs: number }) {
  const zaehler = [...schluessel].sort();
  const ids = await db.transaction(async tx => {
    for (const z of zaehler) await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${z}, 0))`);
    for (const z of zaehler) {
      if (await fehlversuche(tx, z, limit.fensterMs) >= limit.versuche) return null;
    }
    const ids: string[] = [];
    for (const z of zaehler) {
      const { rows } = await tx.execute<{ id: string }>(sql`INSERT INTO anmeldeversuch (schluessel) VALUES (${z}) RETURNING id`);
      ids.push(rows[0]!.id);
    }
    return ids;
  });
  if (!ids) return null;
  return async () => {
    await db.execute(sql`DELETE FROM anmeldeversuch WHERE id IN (${sql.join(ids.map(id => sql`${id}::uuid`), sql`, `)})`);
  };
}

export async function merkeFehlversuch(db: Pick<Db, "execute">, schluessel: string[], fensterMs: number) {
  for (const s of schluessel) await db.execute(sql`INSERT INTO anmeldeversuch (schluessel) VALUES (${s})`);
  // Alte Zeilen gelegentlich entfernen, ohne eine eigene Wartung zu brauchen.
  if (Math.random() < 0.05) await db.execute(sql`DELETE FROM anmeldeversuch WHERE am < now() - ${`${Math.round((fensterMs * 4) / 1000)} seconds`}::interval`);
}
