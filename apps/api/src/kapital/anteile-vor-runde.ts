import { and, desc, eq, gt, isNull, lte } from "drizzle-orm";
import { finanzierungsrunde, mitarbeiterpool, mitarbeiterzuteilung, optionsscheinAusuebung, instrument, beteiligung } from "@carraway/db";
import { Decimal } from "@carraway/rechenkern";
import { ausuebungenVon, ladeAusuebungen } from "./pool";
import type { Tx } from "../zeitlimit";

/**
 * Ausgegebene Anteile vor einer neuen Runde am `datum` (für den Vorschlag des Option Pool Shuffle): Gesamtzahl der letzten abgeschlossenen
 * Eigenkapitalrunde bis zum Datum, dazu ESOP-Optionen und Optionsscheine der Fonds, die nach dieser Runde und bis zum Datum ausgeübt wurden
 * (nicht stornierte Ausübungen; wie die unverwässerte Sicht der Kapitaltabelle). `null` ohne abgeschlossene Runde: Dann fehlt die Bezugsgröße, die Oberfläche fragt die Zahl ab.
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
    .select({ id: mitarbeiterzuteilung.id, anzahl: mitarbeiterzuteilung.anzahl, basispreis: mitarbeiterzuteilung.basispreis, status: mitarbeiterzuteilung.status, statusAm: mitarbeiterzuteilung.statusAm })
    .from(mitarbeiterzuteilung)
    .innerJoin(mitarbeiterpool, eq(mitarbeiterpool.id, mitarbeiterzuteilung.poolId))
    .where(and(eq(mitarbeiterpool.organisationId, organisationId), eq(mitarbeiterpool.art, "esop")));
  const ausuebungen = await ladeAusuebungen(tx, ausgeuebt.map((z) => z.id));
  const danach = ausgeuebt.flatMap((z) => ausuebungenVon({ ...z, ausuebungen: ausuebungen.get(z.id) ?? [] })).filter((z) => z.datum > letzte.datum && z.datum <= datum).reduce((s, z) => s.plus(z.anzahl), new Decimal(0));
  const optionsscheine = await tx
    .select({ anzahl: optionsscheinAusuebung.anzahl })
    .from(optionsscheinAusuebung)
    .innerJoin(instrument, eq(instrument.id, optionsscheinAusuebung.instrumentId))
    .innerJoin(beteiligung, eq(beteiligung.id, instrument.beteiligungId))
    .where(and(eq(beteiligung.organisationId, organisationId), isNull(optionsscheinAusuebung.storniertAm), gt(optionsscheinAusuebung.datum, letzte.datum), lte(optionsscheinAusuebung.datum, datum)));
  const ausgeuebteScheine = optionsscheine.reduce((s, z) => s.plus(z.anzahl), new Decimal(0));
  return new Decimal(letzte.anteileGesamtNach).plus(danach).plus(ausgeuebteScheine).toFixed(0);
}
