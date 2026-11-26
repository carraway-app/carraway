import { sql } from "drizzle-orm";
import type { Db } from "../index";

/**
 * Das Demo-Portfolio (alles erfunden) entsteht seit dem Portfolio-Modell vollständig im Generator (`modell.ts`, Teil von `erzeugeDemodaten`):
 * Instrumente je Runde, Brückenrunden, Wandlungen, Tranchen, Zinsbuchungen und -zahlungen und das Unternehmen mit der ganzen Kette (Seed,
 * Wandeldarlehen, Serie A durch Wandlung, Venture Debt, Folgerunde). Dieser Aufruf schreibt nichts mehr und liefert nur die Zahlen, die der
 * Seed ausgibt; er bleibt, damit die Reihenfolge der Seed-Schritte und alte Aufrufer unverändert gelten.
 */

export type DemoPortfolioErgebnis = { instrumente: number; tranchen: number; zinszahlungen: number };

export async function schreibeDemoPortfolio(db: Db): Promise<DemoPortfolioErgebnis> {
  const zahl = async (abfrage: ReturnType<typeof sql>) => Number((await db.execute<{ n: number }>(abfrage)).rows[0]?.n ?? 0);
  return {
    instrumente: await zahl(sql`SELECT count(*)::int AS n FROM instrument`),
    tranchen: await zahl(sql`SELECT count(*)::int AS n FROM tranche`),
    zinszahlungen: await zahl(sql`SELECT count(*)::int AS n FROM vorgang WHERE art = 'zinszahlung'`),
  };
}
