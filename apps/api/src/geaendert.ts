import { sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { z } from "zod";

/**
 * `?geaendertSeit=<Zeitpunkt>` an den Listen: nur Datensätze, die seitdem angelegt oder laut Änderungsprotokoll verändert wurden.
 * Zeitpunkt als ISO 8601 mit Zeitzone. Löschungen kennt das Datenmodell nicht (Korrekturen sind Stornos und neue Zeilen).
 */
export const geaendertSeitEingabe = z.iso.datetime({ offset: true }).optional();

/** Bedingung für eine Listenabfrage; `undefined`, wenn der Parameter fehlt. */
export function geaendertSeitBedingung(tabelle: string, idSpalte: AnyPgColumn, erstelltSpalte: AnyPgColumn | null, seit: string | undefined): SQL | undefined {
  if (seit === undefined) return undefined;
  const imProtokoll = sql`${idSpalte} IN (SELECT a.datensatz_id FROM aenderung a WHERE a.tabelle = ${tabelle} AND a.aktion <> 'gelesen' AND a.am > ${seit}::timestamptz)`;
  return erstelltSpalte ? sql`(${erstelltSpalte} > ${seit}::timestamptz OR ${imProtokoll})` : imProtokoll;
}
