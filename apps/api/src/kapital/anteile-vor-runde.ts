import { and, desc, eq, lte } from "drizzle-orm";
import { finanzierungsrunde, mitarbeiterpool, mitarbeiterzuteilung } from "@carraway/db";
import { Decimal } from "@carraway/rechenkern";
import type { Tx } from "../zeitlimit";

/**
 * Ausgegebene Anteile vor einer neuen Runde am `datum` (für den Vorschlag des Option Pool Shuffle): Gesamtzahl der letzten abgeschlossenen
 * Eigenkapitalrunde bis zum Datum, dazu ESOP-Optionen, die nach dieser Runde und bis zum Datum ausgeübt wurden (wie die unverwässerte Sicht
 * der Kapitaltabelle). `null` ohne abgeschlossene Runde: Dann fehlt die Bezugsgröße, die Oberfläche fragt die Zahl ab.
 */
export async function anteileVorRunde(tx: Tx, organisationId: string, datum: string): Promise<string | null> {
  const [letzte] = await tx
    .select({ datum: finanzierungsrunde.datum, anteileGesamtNach: finanzierungsrunde.anteileGesamtNach })
    .from(finanzierungsrunde)
    .where(and(eq(finanzierungsrunde.organisationId, organisationId), lte(finanzierungsrunde.datum, datum), eq(finanzierungsrunde.status, "abgeschlossen"), eq(finanzierungsrunde.art, "eigenkapital")))
    .orderBy(desc(finanzierungsrunde.datum), desc(finanzierungsrunde.erstelltAm), desc(finanzierungsrunde.id))
    .limit(1);
  if (!letzte?.anteileGesamtNach) return null;
  const ausgeuebt = await tx
    .select({ anzahl: mitarbeiterzuteilung.anzahl, statusAm: mitarbeiterzuteilung.statusAm })
    .from(mitarbeiterzuteilung)
    .innerJoin(mitarbeiterpool, eq(mitarbeiterpool.id, mitarbeiterzuteilung.poolId))
    .where(and(eq(mitarbeiterpool.organisationId, organisationId), eq(mitarbeiterpool.art, "esop"), eq(mitarbeiterzuteilung.status, "ausgeuebt")));
  const danach = ausgeuebt.filter((z) => z.statusAm !== null && z.statusAm > letzte.datum && z.statusAm <= datum).reduce((s, z) => s.plus(z.anzahl), new Decimal(0));
  return new Decimal(letzte.anteileGesamtNach).plus(danach).toFixed(0);
}
