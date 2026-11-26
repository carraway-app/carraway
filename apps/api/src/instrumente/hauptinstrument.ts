import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import { beteiligung, INSTRUMENT_BEZEICHNUNG, instrument, type Db } from "@carraway/db";
import type { Tx } from "../zeitlimit";

/**
 * Übergang zum Portfolio-Modell (`docs/portfolio-modell.md`, Phase 1): Jede Beteiligung hat mindestens ein Instrument, jeder Vorgang,
 * jede Kondition und Tranche gehört zu einem. Solange die API noch je Beteiligung rechnet, ist das Instrument das **Hauptinstrument**:
 * das erste aktive, sonst das zuletzt angelegte. Neue Beteiligungen legen es mit an, ältere Zeilen ohne Instrument (z. B. direkt
 * geschriebene) bekommen es beim ersten Zugriff.
 */
type Abfrage = Db | Tx;

type BeteiligungKern = Pick<typeof beteiligung.$inferSelect, "id" | "instrument" | "status"> & { instrumentFelder?: Record<string, unknown> | undefined };

const statusVon = (b: BeteiligungKern): (typeof instrument.$inferInsert)["status"] => (b.status === "aktiv" ? "aktiv" : b.status === "exit" ? "verkauft" : "abgeschrieben");

/** Legt das Hauptinstrument für eine Beteiligung an (Art, Felder und Status aus der Beteiligung) und liefert seine Id. */
export async function legeHauptinstrumentAn(tx: Abfrage, b: BeteiligungKern): Promise<string> {
  const [neu] = await tx
    .insert(instrument)
    .values({ beteiligungId: b.id, art: b.instrument, bezeichnung: INSTRUMENT_BEZEICHNUNG[b.instrument], status: statusVon(b), felder: b.instrumentFelder ?? {} })
    .returning({ id: instrument.id });
  if (!neu) throw new Error("Instrument nicht angelegt");
  return neu.id;
}

/** Id des Hauptinstruments; fehlt es (Beteiligung ohne Instrument), wird es aus der Beteiligung angelegt. */
export async function hauptinstrumentId(tx: Abfrage, beteiligungId: string): Promise<string> {
  const [vorhanden] = await tx
    .select({ id: instrument.id })
    .from(instrument)
    .where(eq(instrument.beteiligungId, beteiligungId))
    .orderBy(sql`(${instrument.status} <> 'aktiv')`, sql`CASE WHEN ${instrument.status} = 'aktiv' THEN ${instrument.erstelltAm} END ASC`, desc(instrument.erstelltAm), asc(instrument.id))
    .limit(1);
  if (vorhanden) return vorhanden.id;
  const [b] = await tx.select().from(beteiligung).where(eq(beteiligung.id, beteiligungId));
  if (!b) throw new Error(`Beteiligung ${beteiligungId} nicht gefunden`);
  return legeHauptinstrumentAn(tx, b);
}

/** Hauptinstrumente mehrerer Beteiligungen in einer Abfrage (fehlende werden angelegt). */
export async function hauptinstrumentIds(tx: Abfrage, beteiligungIds: readonly string[]): Promise<Map<string, string>> {
  const aus = new Map<string, string>();
  const ids = [...new Set(beteiligungIds)];
  if (ids.length === 0) return aus;
  const zeilen = await tx
    .select({ id: instrument.id, beteiligungId: instrument.beteiligungId, status: instrument.status })
    .from(instrument)
    .where(inArray(instrument.beteiligungId, ids))
    .orderBy(asc(instrument.erstelltAm), asc(instrument.id));
  for (const z of zeilen.filter((x) => x.status === "aktiv").concat(zeilen.filter((x) => x.status !== "aktiv").reverse())) if (!aus.has(z.beteiligungId)) aus.set(z.beteiligungId, z.id);
  for (const id of ids) if (!aus.has(id)) aus.set(id, await hauptinstrumentId(tx, id));
  return aus;
}
