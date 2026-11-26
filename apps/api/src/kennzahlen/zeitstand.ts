import { sql } from "drizzle-orm";

/**
 * Wissensstand: nur Zeilen, die bis einschließlich `stand` erfasst wurden (`erfasst_am <= stand`), zählen.
 * `stand` ist ein Zeitstempel mit Zeitzone (ISO 8601 oder Postgres-Textform); leer = heutiger Wissensstand.
 */
export const bisStand = (spalte: ReturnType<typeof sql.raw>, stand: string | undefined) =>
  stand === undefined ? sql`` : sql` AND ${spalte} <= ${stand}::timestamptz`;

/**
 * Fondsbewegungen ohne aufgehobene Paare (Etappe 4b): Ein Storno und sein Original fallen gemeinsam aus dem Zahlungsstrom und aus den
 * Anzahlen heraus (wie bei den Vorgängen, Entscheidung 54). Das Original entfällt nur, wenn sein Storno im selben Schnitt (Stichtag und
 * Wissensstand) sichtbar ist; die Summen bleiben gleich, weil sich beide aufheben. `alias` ist der Tabellenalias von `fonds_bewegung`.
 */
export const ohneStornoPaare = (alias: string, stichtag: string, stand: string | undefined) =>
  sql`${sql.raw(alias)}.storniert_bewegung_id IS NULL AND NOT EXISTS (SELECT 1 FROM fonds_bewegung s WHERE s.storniert_bewegung_id = ${sql.raw(alias)}.id AND s.valuta <= ${stichtag}::date${bisStand(sql.raw("s.erfasst_am"), stand)})`;
