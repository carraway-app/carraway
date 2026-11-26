import { and, asc, desc, eq, isNull, lte, or, sql } from "drizzle-orm";
import { kennzahlDefinition, kennzahlWert, type KennzahlDefinition } from "@carraway/db";
import { Decimal, kpiPeriodenart, kpiZeitraumPasst, type KpiPeriodenart, type KpiTyp } from "@carraway/rechenkern";
import { Fachfehler } from "../fehler";
import type { Protokollant } from "../schreiben";
import type { Tx } from "../zeitlimit";

/**
 * Gemeinsame Regeln für Kennzahlenwerte: Eingabe je Typ, Auflösung der Katalogversion, Prüfung des Zeitraums. Interne und externe
 * Eingabe laufen über dieselben Funktionen.
 */

const DEZIMAL = /^-?\d{1,16}(\.\d{1,2})?$/;
const DEZIMAL_ZAHL = /^-?\d{1,16}(\.\d{1,4})?$/;
const MAX_TEXT = 2000;

/** Kanonischer Text eines Wertes (Zahl mit Punkt ohne überflüssige Nullen, `ja`/`nein`, Freitext); wirft 400 `metric_value_invalid`. */
export function kanonischerWert(typ: KpiTyp, roh: string): string {
  const ungueltig = (grund: string) => new Fachfehler(400, "metric_value_invalid", `The value is invalid for this metric (${grund}).`, { grund });
  if (typ === "ja_nein") {
    if (roh !== "ja" && roh !== "nein") throw ungueltig("ja or nein");
    return roh;
  }
  if (typ === "text") {
    const text = roh.trim();
    if (text === "" || text.length > MAX_TEXT) throw ungueltig(`text with 1 to ${MAX_TEXT} characters`);
    return text;
  }
  const erlaubt = typ === "betrag" ? DEZIMAL : DEZIMAL_ZAHL;
  if (!erlaubt.test(roh)) throw ungueltig(typ === "betrag" ? "decimal number with a point and at most two decimal places" : "decimal number with a point and at most four decimal places");
  const zahl = new Decimal(roh);
  if (typ === "prozent" && zahl.abs().greaterThan(1_000_000)) throw ungueltig("percentage too large");
  return zahl.isZero() ? "0" : zahl.toFixed();
}

/** Die Katalogversion, die an `datum` gilt (höchste `katalog_version` mit passendem Gültigkeitsraum); wirft 404 `metric_not_found`. */
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
  throw new Fachfehler(404, "metric_not_found", `The metric "${schluessel}" does not exist in the catalog for this period.`, { schluessel });
}

/** Zeitraum eines Wertes oder einer Anfrage: ein ganzer Kalendermonat, ein Quartal oder ein Jahr; nicht feiner als die Erhebung der Kennzahl. */
export function pruefeZeitraum(beginn: string, ende: string, definition?: Pick<KennzahlDefinition, "periodizitaet" | "schluessel">): KpiPeriodenart {
  const art = kpiPeriodenart(beginn, ende);
  if (!art) throw new Fachfehler(400, "metric_period_invalid", "The period must be a whole calendar month, a calendar quarter or a calendar year.");
  if (definition && !kpiZeitraumPasst(art, definition.periodizitaet)) {
    throw new Fachfehler(400, "metric_period_too_fine", `The metric "${definition.schluessel}" is collected at most ${definition.periodizitaet === "jahr" ? "annually" : "quarterly"}; the period is finer.`, { schluessel: definition.schluessel });
  }
  return art;
}

/** Zeile für Antworten und das Protokoll ohne das Geheimnis der Anfrage (`token_hash`). */
export function ohneToken<T extends { tokenHash?: unknown }>(zeile: T): Omit<T, "tokenHash"> {
  const { tokenHash: _weg, ...rest } = zeile;
  return rest;
}

export interface NeuerKennzahlWert {
  schluessel: string;
  periodeBeginn: string;
  periodeEnde: string;
  szenario: (typeof kennzahlWert.$inferInsert)["szenario"];
  wert: string;
  kommentar?: string | null | undefined;
  geschaetzt?: boolean | undefined;
  quellenangabe?: string | null | undefined;
}

/**
 * Legt einen Kennzahlenwert einer Beteiligung als ENTWURF aus eigener Eingabe an (Katalogversion zum Zeitraum, Prüfung von Zeitraum und Wert, ein offener Eintrag
 * je Kennzahl, Zeitraum und Szenario). Gemeinsamer Weg der Eingabe von Hand und der Übernahme aus der KI-Auslesung; bestätigt wird in der Kennzahlenerfassung.
 * Die Beteiligung muss der Aufrufer geprüft haben.
 */
export async function legeKennzahlEntwurfAn(tx: Tx, protokoll: Protokollant, beteiligungId: string, e: NeuerKennzahlWert) {
  // Parallele manuelle Eingaben und Bestätigungen prüfen offene Werte nacheinander.
  await tx.execute(sql`SELECT id FROM beteiligung WHERE id = ${beteiligungId} FOR UPDATE`);
  const d = await geltendeDefinition(tx, e.schluessel, e.periodeEnde);
  pruefeZeitraum(e.periodeBeginn, e.periodeEnde, d);
  const wert = kanonischerWert(d.typ, e.wert);
  // Offene Einträge gleicher Kennzahl, Zeitraum und Szenario aus eigener Eingabe: bitte den vorhandenen ändern.
  const { rows: offen } = await tx.execute<{ id: string }>(sql`
    SELECT w.id FROM kennzahl_wert w JOIN kennzahl_definition k ON k.id = w.definition_id
    WHERE w.beteiligung_id = ${beteiligungId} AND k.schluessel = ${e.schluessel} AND w.periode_beginn = ${e.periodeBeginn}::date AND w.periode_ende = ${e.periodeEnde}::date
      AND w.szenario = ${e.szenario} AND w.quelle = 'intern' AND w.status <> 'bestaetigt' AND w.verworfen_am IS NULL`);
  if (offen[0]) throw new Fachfehler(409, "metric_value_pending_exists", "There is already a pending value for this period; please change the existing one.", { wertId: offen[0].id });
  const [zeile] = await tx
    .insert(kennzahlWert)
    .values({ beteiligungId, definitionId: d.id, periodeBeginn: e.periodeBeginn, periodeEnde: e.periodeEnde, szenario: e.szenario, wert, quelle: "intern", erfasstVon: protokoll.akteur, status: "entwurf", kommentar: e.kommentar ?? null, geschaetzt: e.geschaetzt ?? false, quellenangabe: e.quellenangabe ?? null })
    .returning();
  await protokoll("anlegen", "kennzahl_wert", zeile!.id, null, zeile);
  return { zeile: zeile!, definition: d };
}
