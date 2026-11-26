import { sql } from "drizzle-orm";
import type { Tx } from "../zeitlimit";

/**
 * Profil des Managers (eine Zeile je Installation, Tabelle `manager_profil`): Name und Hauswährung. Die Hauswährung ist die Währung der fondsübergreifenden
 * Summen (Manager-Profil, Portfolio-Dashboard) und eine weitere Spalte der Währungssicht. Ohne gespeichertes Profil gilt EUR.
 */

export const STANDARD_HAUSWAEHRUNG = "EUR";

export interface ManagerProfil {
  name: string | null;
  hauswaehrung: string;
  geaendertAm: string | null;
}

type Abfrage = Pick<Tx, "execute">;

export async function ladeManagerProfil(tx: Abfrage): Promise<ManagerProfil> {
  const { rows } = await tx.execute<{ name: string | null; hauswaehrung: string; geaendert_am: string }>(sql`
    SELECT name, hauswaehrung, (to_json(geaendert_am) #>> '{}') AS geaendert_am FROM manager_profil WHERE id = 1`);
  const z = rows[0];
  return z ? { name: z.name, hauswaehrung: z.hauswaehrung, geaendertAm: new Date(z.geaendert_am).toISOString() } : { name: null, hauswaehrung: STANDARD_HAUSWAEHRUNG, geaendertAm: null };
}

export async function hauswaehrung(tx: Abfrage): Promise<string> {
  return (await ladeManagerProfil(tx)).hauswaehrung;
}
