import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { beleg, buchungsexport, buchungsexportPosition, verkauf, zinslaufPosition } from "@carraway/db";
import type { Tx } from "../zeitlimit";

/**
 * Belegnummern und Exportstand der Buchungseinheiten (Vorgang oder Fondsbewegung), gemeinsam für den Buchungsexport und das Journal.
 * Ein Vorgang erreicht seinen Beleg direkt (Art `vorgang`), über den Zinslauf oder über den Verkauf, eine Fondsbewegung direkt
 * (Art `fonds_bewegung`). Es zählen nur freigegebene Belege, denn nur sie haben eine Belegnummer.
 */

/** Belegnummer je Vorgang- oder Bewegungs-ID (UUIDs sind über beide Tabellen eindeutig). */
export async function belegnummern(tx: Tx, fondsId: string, vorgangIds: string[], bewegungIds: string[] = []): Promise<Map<string, string>> {
  const karte = new Map<string, string>();
  if (vorgangIds.length === 0 && bewegungIds.length === 0) return karte;
  // Erst die Hilfsverknüpfungen (Zinslauf, Verkauf) der angefragten Vorgänge, dann nur die Belege, die auf eine dieser IDs zeigen:
  // Die Abfrage wächst mit der Seite, nicht mit der Zahl der Belege des Fonds.
  const lauf = vorgangIds.length ? await tx.select({ vorgang: zinslaufPosition.vorgangId, lauf: zinslaufPosition.zinslaufId }).from(zinslaufPosition).where(inArray(zinslaufPosition.vorgangId, vorgangIds)) : [];
  const verkaeufe = vorgangIds.length ? await tx.select({ vorgang: verkauf.rueckflussVorgangId, id: verkauf.id }).from(verkauf).where(inArray(verkauf.rueckflussVorgangId, vorgangIds)) : [];
  const bezuege = [...new Set([...vorgangIds, ...bewegungIds, ...lauf.map((l) => l.lauf), ...verkaeufe.map((v) => v.id)])];
  const frei = await tx
    .select({ art: beleg.bezugArt, bezug: beleg.bezugId, nummer: beleg.belegnummer })
    .from(beleg)
    .where(and(eq(beleg.fondsId, fondsId), eq(beleg.status, "freigegeben"), isNotNull(beleg.belegnummer), inArray(beleg.bezugId, bezuege)));
  const nachBezug = new Map(frei.map((b) => [`${b.art}:${b.bezug}`, b.nummer!]));
  const laufJeVorgang = new Map(lauf.map((l) => [l.vorgang, l]));
  const verkaufJeVorgang = new Map(verkaeufe.map((v) => [v.vorgang, v]));
  for (const id of vorgangIds) {
    const zl = laufJeVorgang.get(id);
    const vk = verkaufJeVorgang.get(id);
    const n = nachBezug.get(`vorgang:${id}`) ?? (zl ? nachBezug.get(`zinslauf:${zl.lauf}`) : undefined) ?? (vk ? nachBezug.get(`verkauf:${vk.id}`) : undefined);
    if (n) karte.set(id, n);
  }
  for (const id of bewegungIds) {
    const n = nachBezug.get(`fonds_bewegung:${id}`);
    if (n) karte.set(id, n);
  }
  return karte;
}

export interface ExportStand {
  exportId: string;
  am: string;
  dateiName: string;
}

/** Aktive Exportmarkierung je Vorgang- oder Bewegungs-ID. */
export async function exportStaende(tx: Tx, vorgangIds: string[], bewegungIds: string[] = []): Promise<Map<string, ExportStand>> {
  const karte = new Map<string, ExportStand>();
  const lade = async (spalte: typeof buchungsexportPosition.vorgangId | typeof buchungsexportPosition.fondsBewegungId, ids: string[]) => {
    if (ids.length === 0) return;
    const zeilen = await tx
      .select({ id: spalte, exportId: buchungsexport.id, am: buchungsexport.erzeugtAm, dateiName: buchungsexport.dateiName })
      .from(buchungsexportPosition)
      .innerJoin(buchungsexport, eq(buchungsexport.id, buchungsexportPosition.exportId))
      .where(and(eq(buchungsexportPosition.aktiv, true), inArray(spalte, ids)));
    for (const z of zeilen) if (z.id) karte.set(z.id, { exportId: z.exportId, am: z.am.toISOString(), dateiName: z.dateiName });
  };
  await lade(buchungsexportPosition.vorgangId, vorgangIds);
  await lade(buchungsexportPosition.fondsBewegungId, bewegungIds);
  return karte;
}
