import { and, asc, desc, eq, isNull, lte, or, sql } from "drizzle-orm";
import { kennzahlDefinition, type KennzahlDefinition } from "@carraway/db";
import { Decimal, kpiPeriodenart, kpiZeitraumPasst, type KpiPeriodenart, type KpiTyp } from "@carraway/rechenkern";
import { Fachfehler } from "../fehler";
import type { Tx } from "../zeitlimit";

/**
 * Gemeinsame Regeln für Kennzahlenwerte: Eingabe je Typ, Auflösung der Katalogversion, Prüfung des Zeitraums. Interne und externe
 * Eingabe laufen über dieselben Funktionen.
 */

const DEZIMAL = /^-?\d{1,16}(\.\d{1,2})?$/;
const DEZIMAL_ZAHL = /^-?\d{1,16}(\.\d{1,4})?$/;
const MAX_TEXT = 2000;

/** Kanonischer Text eines Wertes (Zahl mit Punkt ohne überflüssige Nullen, `ja`/`nein`, Freitext); wirft 400 `KENNZAHL_WERT_UNGUELTIG`. */
export function kanonischerWert(typ: KpiTyp, roh: string): string {
  const ungueltig = (grund: string) => new Fachfehler(400, "KENNZAHL_WERT_UNGUELTIG", `Der Wert ist für diese Kennzahl ungültig (${grund}).`, { grund });
  if (typ === "ja_nein") {
    if (roh !== "ja" && roh !== "nein") throw ungueltig("ja oder nein");
    return roh;
  }
  if (typ === "text") {
    const text = roh.trim();
    if (text === "" || text.length > MAX_TEXT) throw ungueltig(`Text mit 1 bis ${MAX_TEXT} Zeichen`);
    return text;
  }
  const erlaubt = typ === "betrag" ? DEZIMAL : DEZIMAL_ZAHL;
  if (!erlaubt.test(roh)) throw ungueltig(typ === "betrag" ? "Dezimalzahl mit Punkt und höchstens zwei Nachkommastellen" : "Dezimalzahl mit Punkt und höchstens vier Nachkommastellen");
  const zahl = new Decimal(roh);
  if (typ === "prozent" && zahl.abs().greaterThan(1_000_000)) throw ungueltig("Prozentwert zu groß");
  return zahl.isZero() ? "0" : zahl.toFixed();
}

/** Die Katalogversion, die an `datum` gilt (höchste `katalog_version` mit passendem Gültigkeitsraum); wirft 404 `KENNZAHL_NICHT_GEFUNDEN`. */
export async function geltendeDefinition(tx: Tx, schluessel: string, datum: string): Promise<KennzahlDefinition> {
  const [d] = await tx
    .select()
    .from(kennzahlDefinition)
    .where(and(eq(kennzahlDefinition.schluessel, schluessel), lte(kennzahlDefinition.gueltigAb, datum), or(isNull(kennzahlDefinition.gueltigBis), sql`${kennzahlDefinition.gueltigBis} >= ${datum}`)))
    .orderBy(desc(kennzahlDefinition.katalogVersion))
    .limit(1);
  if (d) return d;
  // Liegt der Zeitraum vor dem Beginn der ersten Version (der Standardkatalog gilt ab 2026-01-01, ältere Zeiträume wollen auch erfasst werden),
  // gilt die erste Version rückwärts. Eine außer Kraft gesetzte Kennzahl bleibt für spätere Zeiträume unbekannt.
  const [erste] = await tx.select().from(kennzahlDefinition).where(eq(kennzahlDefinition.schluessel, schluessel)).orderBy(asc(kennzahlDefinition.katalogVersion)).limit(1);
  if (erste && erste.gueltigAb > datum) return erste;
  throw new Fachfehler(404, "KENNZAHL_NICHT_GEFUNDEN", `Die Kennzahl „${schluessel}“ gibt es im Katalog für diesen Zeitraum nicht.`, { schluessel });
}

/** Zeitraum eines Wertes oder einer Anfrage: ein ganzer Kalendermonat, ein Quartal oder ein Jahr; nicht feiner als die Erhebung der Kennzahl. */
export function pruefeZeitraum(beginn: string, ende: string, definition?: Pick<KennzahlDefinition, "periodizitaet" | "schluessel">): KpiPeriodenart {
  const art = kpiPeriodenart(beginn, ende);
  if (!art) throw new Fachfehler(400, "KENNZAHL_PERIODE_UNGUELTIG", "Der Zeitraum muss ein ganzer Kalendermonat, ein Kalenderquartal oder ein Kalenderjahr sein.");
  if (definition && !kpiZeitraumPasst(art, definition.periodizitaet)) {
    throw new Fachfehler(400, "KENNZAHL_PERIODE_ZU_FEIN", `Die Kennzahl „${definition.schluessel}“ wird höchstens ${definition.periodizitaet === "jahr" ? "jährlich" : "vierteljährlich"} erhoben; der Zeitraum ist feiner.`, { schluessel: definition.schluessel });
  }
  return art;
}

/** Zeile für Antworten und das Protokoll ohne das Geheimnis der Anfrage (`token_hash`). */
export function ohneToken<T extends { tokenHash?: unknown }>(zeile: T): Omit<T, "tokenHash"> {
  const { tokenHash: _weg, ...rest } = zeile;
  return rest;
}
