import { eq, sql } from "drizzle-orm";
import { beteiligung, finanzierungsrunde, instrument, vorgangRunde } from "@carraway/db";
import { Fachfehler } from "../fehler";
import type { Protokollant } from "../schreiben";
import type { Tx } from "../zeitlimit";

/**
 * Zuordnung eines Vorgangs zu einer Finanzierungsrunde des Unternehmens (Tabelle `vorgang_runde`, `docs/portfolio-modell.md`, Abschnitt
 * „Vorgänge je Runde“). Der Vorgang ist unveränderlich, die Zuordnung nicht; jede Änderung steht im Änderungsprotokoll. Fehlt die Zeile,
 * gehört der Vorgang keiner Runde.
 */

export type Quelle = "automatisch" | "manuell";
type VorgangKurz = { id: string; beteiligungId: string; instrumentId: string; storniertVorgangId: string | null };

/** Die Runde gehört zum Unternehmen der Beteiligung; sonst 404 oder 409. */
async function pruefeRunde(tx: Tx, rundeId: string, organisationId: string): Promise<void> {
  const [r] = await tx.select({ organisationId: finanzierungsrunde.organisationId }).from(finanzierungsrunde).where(eq(finanzierungsrunde.id, rundeId));
  if (!r) throw new Fachfehler(404, "RUNDE_NICHT_GEFUNDEN", "Finanzierungsrunde nicht gefunden.");
  if (r.organisationId !== organisationId) throw new Fachfehler(409, "VORGANG_RUNDE_FREMD", "Die Runde gehört zu einem anderen Unternehmen als der Vorgang.", { rundeId });
}

/** Prüft nur, ob eine ausdrücklich genannte Runde zum Unternehmen der Beteiligung gehört (vor dem Buchen, damit nichts halb entsteht). */
export async function pruefeRundeDerBeteiligung(tx: Tx, beteiligungId: string, rundeId: string): Promise<void> {
  const [b] = await tx.select({ organisationId: beteiligung.organisationId }).from(beteiligung).where(eq(beteiligung.id, beteiligungId));
  if (!b) throw new Fachfehler(404, "BETEILIGUNG_NICHT_GEFUNDEN", "Beteiligung nicht gefunden.");
  await pruefeRunde(tx, rundeId, b.organisationId);
}

/** Die Runde, die der Vorgang ohne ausdrückliche Angabe bekäme: bei Storno die des Originals, sonst die des Instruments. */
export async function standardRunde(tx: Tx, v: Pick<VorgangKurz, "instrumentId" | "storniertVorgangId">): Promise<string | null> {
  if (v.storniertVorgangId) {
    const [o] = await tx.select({ rundeId: vorgangRunde.rundeId }).from(vorgangRunde).where(eq(vorgangRunde.vorgangId, v.storniertVorgangId));
    return o?.rundeId ?? null;
  }
  const [i] = await tx.select({ rundeId: instrument.rundeId }).from(instrument).where(eq(instrument.id, v.instrumentId));
  return i?.rundeId ?? null;
}

/**
 * Ordnet einen neuen Vorgang einer Runde zu. `rundeId` ausdrücklich (Quelle `manuell`, wenn nicht anders angegeben): muss zum Unternehmen der
 * Beteiligung gehören; `null` heißt bewusst keiner Runde. Ohne Angabe (`undefined`) gilt der Standard (`standardRunde`, Quelle `automatisch`).
 * Gibt die zugeordnete Runde zurück (oder `null`).
 */
export async function ordneRundeZu(tx: Tx, protokoll: Protokollant, v: VorgangKurz, opts: { rundeId?: string | null | undefined; quelle?: Quelle } = {}): Promise<string | null> {
  const [b] = await tx.select({ fondsId: beteiligung.fondsId, organisationId: beteiligung.organisationId }).from(beteiligung).where(eq(beteiligung.id, v.beteiligungId));
  if (!b) throw new Fachfehler(404, "BETEILIGUNG_NICHT_GEFUNDEN", "Beteiligung nicht gefunden.");
  let rundeId: string | null;
  let quelle: Quelle = "automatisch";
  if (opts.rundeId === undefined) rundeId = await standardRunde(tx, v);
  else {
    rundeId = opts.rundeId;
    quelle = opts.quelle ?? "manuell";
    if (rundeId) await pruefeRunde(tx, rundeId, b.organisationId);
  }
  if (!rundeId) return null;
  const [zeile] = await tx.insert(vorgangRunde).values({ vorgangId: v.id, rundeId, quelle, geaendertVon: protokoll.akteur }).returning();
  await protokoll("anlegen", "vorgang_runde", v.id, null, { ...zeile, fondsId: b.fondsId });
  return rundeId;
}

/** Nachträglich ändern (`rundeId` = `null` entfernt die Zuordnung). Quelle danach `manuell`. Keine Zeile bei keiner Änderung. */
export async function setzeVorgangRunde(tx: Tx, protokoll: Protokollant, v: VorgangKurz, rundeId: string | null): Promise<{ rundeId: string | null; geaendert: boolean }> {
  const [b] = await tx.select({ fondsId: beteiligung.fondsId, organisationId: beteiligung.organisationId }).from(beteiligung).where(eq(beteiligung.id, v.beteiligungId));
  if (!b) throw new Fachfehler(404, "BETEILIGUNG_NICHT_GEFUNDEN", "Beteiligung nicht gefunden.");
  if (rundeId) await pruefeRunde(tx, rundeId, b.organisationId);
  const [vorher] = await tx.select().from(vorgangRunde).where(eq(vorgangRunde.vorgangId, v.id)).for("update");
  if ((vorher?.rundeId ?? null) === rundeId) return { rundeId, geaendert: false };
  if (!rundeId) {
    await tx.delete(vorgangRunde).where(eq(vorgangRunde.vorgangId, v.id));
    await protokoll("loeschen", "vorgang_runde", v.id, { ...vorher, fondsId: b.fondsId }, null);
    return { rundeId: null, geaendert: true };
  }
  const werte = { rundeId, quelle: "manuell" as const, geaendertAm: new Date(), geaendertVon: protokoll.akteur };
  if (vorher) {
    const [nachher] = await tx.update(vorgangRunde).set(werte).where(eq(vorgangRunde.vorgangId, v.id)).returning();
    await protokoll("aendern", "vorgang_runde", v.id, { ...vorher, fondsId: b.fondsId }, { ...nachher, fondsId: b.fondsId });
  } else {
    const [neu] = await tx.insert(vorgangRunde).values({ vorgangId: v.id, ...werte }).returning();
    await protokoll("anlegen", "vorgang_runde", v.id, null, { ...neu, fondsId: b.fondsId });
  }
  return { rundeId, geaendert: true };
}

/**
 * Standardzuordnung für viele neue Vorgänge auf einmal (Import): Runde des Instruments, Stornos erben vom Original (das in derselben Menge oder
 * schon zugeordnet sein darf). Protokoll in Blöcken.
 */
export async function ordneStandardRundenZu(tx: Tx, protokoll: Protokollant, vorgangIds: readonly string[]): Promise<number> {
  if (vorgangIds.length === 0) return 0;
  let gesamt = 0;
  // Erst alle Originale (Runde des Instruments), dann alle Stornos (erben vom Original, auch aus einem anderen Block).
  const schritte = [
    (liste: ReturnType<typeof sql.join>) => sql`
      INSERT INTO vorgang_runde (vorgang_id, runde_id, quelle, geaendert_von)
      SELECT v.id, i.runde_id, 'automatisch', ${protokoll.akteur} FROM vorgang v JOIN instrument i ON i.id = v.instrument_id
      WHERE v.id IN (${liste}) AND v.storniert_vorgang_id IS NULL AND i.runde_id IS NOT NULL
      ON CONFLICT (vorgang_id) DO NOTHING
      RETURNING vorgang_id, runde_id, (SELECT b.fonds_id FROM beteiligung b JOIN vorgang x ON x.beteiligung_id = b.id WHERE x.id = vorgang_id) AS fonds_id`,
    (liste: ReturnType<typeof sql.join>) => sql`
      INSERT INTO vorgang_runde (vorgang_id, runde_id, quelle, geaendert_von)
      SELECT s.id, o.runde_id, 'automatisch', ${protokoll.akteur} FROM vorgang s JOIN vorgang_runde o ON o.vorgang_id = s.storniert_vorgang_id
      WHERE s.id IN (${liste}) AND s.storniert_vorgang_id IS NOT NULL
      ON CONFLICT (vorgang_id) DO NOTHING
      RETURNING vorgang_id, runde_id, (SELECT b.fonds_id FROM beteiligung b JOIN vorgang x ON x.beteiligung_id = b.id WHERE x.id = vorgang_id) AS fonds_id`,
  ];
  for (const schritt of schritte) {
    for (let i = 0; i < vorgangIds.length; i += 1000) {
      const liste = sql.join(vorgangIds.slice(i, i + 1000).map((x) => sql`${x}::uuid`), sql`, `);
      const { rows } = await tx.execute<{ vorgang_id: string; runde_id: string; fonds_id: string }>(schritt(liste));
      await protokoll.mehrere(rows.map((z) => ({ aktion: "anlegen", tabelle: "vorgang_runde", datensatzId: z.vorgang_id, nachher: { vorgangId: z.vorgang_id, rundeId: z.runde_id, quelle: "automatisch", fondsId: z.fonds_id } })));
      gesamt += rows.length;
    }
  }
  return gesamt;
}
