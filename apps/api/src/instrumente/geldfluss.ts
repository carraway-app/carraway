import { sql, type SQL } from "drizzle-orm";
import type { Tx } from "../zeitlimit";

/**
 * Buchungen einer Wandlung ohne Geldfluss. Eine Wandlung bucht auf dem Darlehen die Tilgung durch Wandlung in Anteile, auf dem neuen
 * Eigenkapital-Instrument Zusage und Einlage. Das ist Umbuchung, kein Geld: Es geht nicht in Investiert, Rückflüsse, Multiple, DPI, TVPI und
 * IRR ein. Bar fließt nur der Spitzenbetrag (zweite Tilgung auf dem Darlehen); er bleibt ein Rückfluss. Zinsen der Wandlung sind eine
 * Zinsbuchung (Forderung) und zählen ohnehin nie. Für Position, Buchwert und Anschaffungskosten gelten die Buchungen unverändert
 * (`berechneZustand` kennt diesen Filter nicht).
 *
 * Erkennung ohne eigene Spalte (das Hauptbuch ist unveränderlich): Die Vorgänge einer Wandlung stehen in `wandlung.vorgaenge`
 * (Schlüssel `<darlehen|ziel>_<art>_<Nr>`, Nr in Buchungsreihenfolge). Geldlos sind die Schlüssel `ziel_zusage_*`, `ziel_auszahlung_*`
 * und `darlehen_tilgung_*`; davon ist die letzte Tilgung der Spitzenbetrag und bar, sofern der Spitzenbetrag der Wandlung größer null ist.
 * Geldlos ist auch `darlehen_erlass_*` (nicht gewandelter Rest, vertraglich erlassen; Verzicht). Bar und damit Rückfluss bleiben
 * `darlehen_rueckzahlung_*` (Tilgung) und `darlehen_zinszahlung_*` (Zinszahlung des zurückgezahlten Zinsrests).
 * Ein Storno gilt wie sein Original.
 */
const GELDLOSE_IDS = sql`(
  SELECT e.value::uuid FROM wandlung w CROSS JOIN LATERAL jsonb_each_text(w.vorgaenge) e
  WHERE e.value IS NOT NULL AND (
    e.key ~ '^ziel_(zusage|auszahlung)_'
    OR e.key ~ '^darlehen_erlass_'
    OR (e.key ~ '^darlehen_tilgung_' AND NOT (w.spitzenbetrag > 0 AND split_part(e.key, '_', 3)::int = (
      SELECT max(split_part(k.key, '_', 3)::int) FROM jsonb_each_text(w.vorgaenge) k WHERE k.key ~ '^darlehen_tilgung_')))
  )
)`;

/** SQL-Bedingung (nie NULL für Zeilen mit Id): der Vorgang (Alias der Tabelle `vorgang`) ist eine Buchung einer Wandlung ohne Geldfluss (oder deren Storno). */
export function geldlos(alias: string): SQL {
  const a = sql.raw(alias);
  // coalesce: ohne Storno ist `storniert_vorgang_id` NULL, und `NOT (… OR NULL)` würde sonst jede Zeile aus den Summen nehmen.
  return sql`(${a}.verzicht_id IS NOT NULL OR ${a}.art IN ('principal_disposal', 'impairment_disposal', 'interest_waiver') OR ${a}.id IN ${GELDLOSE_IDS} OR coalesce(${a}.storniert_vorgang_id IN ${GELDLOSE_IDS}, false))`;
}

/** Ids der geldlosen Wandlungsbuchungen (samt Stornos) der Beteiligungen; ohne Angabe aller Beteiligungen des Fonds bzw. aller. */
export async function ladeGeldloseIds(tx: Pick<Tx, "execute">, auswahl: { beteiligungId: string } | { beteiligungIds: readonly string[] } | { fondsId: string }): Promise<Set<string>> {
  const bedingung =
    "beteiligungId" in auswahl
      ? sql`v.beteiligung_id = ${auswahl.beteiligungId}`
      : "fondsId" in auswahl
        ? sql`v.beteiligung_id IN (SELECT id FROM beteiligung WHERE fonds_id = ${auswahl.fondsId})`
        : sql`v.beteiligung_id = ANY(${sql`ARRAY[${sql.join(auswahl.beteiligungIds.map((x) => sql`${x}::uuid`), sql`, `)}]::uuid[]`})`;
  if ("beteiligungIds" in auswahl && auswahl.beteiligungIds.length === 0) return new Set();
  const { rows } = await tx.execute<{ id: string }>(sql`SELECT v.id FROM vorgang v WHERE ${bedingung} AND ${geldlos("v")}`);
  return new Set(rows.map((r) => r.id));
}
