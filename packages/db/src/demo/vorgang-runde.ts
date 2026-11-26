import { sql } from "drizzle-orm";
import type { Db } from "../index";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0] | Db;

/**
 * Zuordnung der Demo-Vorgänge zu Runden wie im laufenden Betrieb: ausdrückliche Zuordnung (Wandlung), sonst Runde des Instruments (`instrument.runde_id`), Stornos erben vom Original.
 * Läuft nach dem Einfügen der Vorgänge; die Demo schreibt Vorgänge direkt und geht nicht über `bucheVorgang`.
 */
export async function ordneDemoVorgaengeRunden(tx: Tx, ohneRunde: readonly string[] = []): Promise<void> {
  // `ohneRunde`: bewusst nicht zugeordnete Vorgänge (Beispiel für „Keiner Runde zugeordnet“).
  const ausgenommen = ohneRunde.length > 0 ? sql`AND v.id NOT IN (${sql.join(ohneRunde.map((id) => sql`${id}::uuid`), sql`, `)})` : sql``;
  await tx.execute(sql`
    INSERT INTO vorgang_runde (vorgang_id, runde_id, quelle, geaendert_von)
    SELECT v.id, i.runde_id, 'automatisch', 'Demo' FROM vorgang v JOIN instrument i ON i.id = v.instrument_id
    WHERE i.runde_id IS NOT NULL AND v.storniert_vorgang_id IS NULL ${ausgenommen}
    ON CONFLICT (vorgang_id) DO NOTHING`);
  await tx.execute(sql`
    INSERT INTO vorgang_runde (vorgang_id, runde_id, quelle, geaendert_von)
    SELECT s.id, o.runde_id, 'automatisch', 'Demo' FROM vorgang s JOIN vorgang_runde o ON o.vorgang_id = s.storniert_vorgang_id
    WHERE s.storniert_vorgang_id IS NOT NULL
    ON CONFLICT (vorgang_id) DO NOTHING`);
}
