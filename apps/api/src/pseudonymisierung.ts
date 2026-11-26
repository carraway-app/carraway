import { sql } from "drizzle-orm";
import type { Db } from "@carraway/db";

/**
 * Ist diese Datenbank eine pseudonymisierte Kopie (Zeile in `pseudonymisierung`)? Kurz zwischengespeichert, damit die Auslieferung der
 * Oberfläche nicht bei jedem Seitenaufruf fragt; fällt die Abfrage aus, gilt „nein“ (die Oberfläche bleibt erreichbar).
 */
export function istPseudonymisiert(db: Db, lebensdauerMs = 30_000, jetzt: () => number = Date.now): () => Promise<boolean> {
  let stand: { bis: number; wert: boolean } | null = null;
  return async () => {
    const t = jetzt();
    if (stand && stand.bis > t) return stand.wert;
    const wert = await db.execute(sql`SELECT 1 FROM pseudonymisierung LIMIT 1`).then(
      (r) => r.rows.length > 0,
      () => false,
    );
    stand = { bis: t + lebensdauerMs, wert };
    return wert;
  };
}
