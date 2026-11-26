import { asc, eq, inArray } from "drizzle-orm";
import { mitarbeiterpool, mitarbeiterzuteilung, poolAenderung, zuteilungAustritt } from "@carraway/db";
import { Decimal, poolStand, type Leaver, type PoolZuteilung, type Vesting } from "@carraway/rechenkern";
import type { Tx } from "../zeitlimit";

/**
 * Pool der Mitarbeiterbeteiligung zum Datum einer Runde (für die Prüfung auf voll verwässerter Basis): je Pool die Änderungen bis zum
 * Rundendatum, dazu eine Aufstockung im Pre-Money dieser Runde (auch mit späterem Datum) und ohne eine Aufstockung im Post-Money dieser
 * Runde. Gezählt wird, was voll verwässert zählt: ausstehend + frei (vor der Runde ausgeübte Optionen stecken in den ausgegebenen Anteilen).
 */

type ZuteilungZeile = typeof mitarbeiterzuteilung.$inferSelect;
type AustrittZeile = typeof zuteilungAustritt.$inferSelect;

/** Angaben eines Austritts, die der Rechenkern braucht. */
export type AustrittKern = Pick<AustrittZeile, "art" | "austrittAm" | "anzahl" | "gevestet" | "rueckkaufpreis">;

/** Spalten einer Zuteilung, die der Rechenkern braucht (Vesting, Status), dazu ihre Austritte (Pflicht, damit kein Ladeweg sie vergisst). */
export type ZuteilungKern = Pick<ZuteilungZeile, "anzahl" | "zugeteiltAm" | "vestingBeginn" | "cliffMonate" | "vestingMonate" | "beschleunigung" | "basispreis" | "status" | "statusAm"> & {
  austritte: readonly AustrittKern[];
};

export const zuteilungKernSpalten = {
  anzahl: mitarbeiterzuteilung.anzahl,
  zugeteiltAm: mitarbeiterzuteilung.zugeteiltAm,
  vestingBeginn: mitarbeiterzuteilung.vestingBeginn,
  cliffMonate: mitarbeiterzuteilung.cliffMonate,
  vestingMonate: mitarbeiterzuteilung.vestingMonate,
  beschleunigung: mitarbeiterzuteilung.beschleunigung,
  basispreis: mitarbeiterzuteilung.basispreis,
  status: mitarbeiterzuteilung.status,
  statusAm: mitarbeiterzuteilung.statusAm,
};

/** Austritte der Zuteilungen, je Zuteilung nach Datum geordnet. */
export async function ladeAustritte(tx: Tx, zuteilungIds: readonly string[]): Promise<Map<string, AustrittZeile[]>> {
  const je = new Map<string, AustrittZeile[]>();
  if (zuteilungIds.length === 0) return je;
  const zeilen = await tx
    .select()
    .from(zuteilungAustritt)
    .where(inArray(zuteilungAustritt.zuteilungId, [...zuteilungIds]))
    .orderBy(asc(zuteilungAustritt.austrittAm), asc(zuteilungAustritt.erstelltAm), asc(zuteilungAustritt.id));
  for (const a of zeilen) je.set(a.zuteilungId, [...(je.get(a.zuteilungId) ?? []), a]);
  return je;
}

/** Hängt jeder Zuteilung ihre Austritte an. */
export function mitAustritten<T extends { id: string }>(zuteilungen: readonly T[], austritte: Map<string, AustrittZeile[]>): (T & { austritte: AustrittZeile[] })[] {
  return zuteilungen.map((z) => ({ ...z, austritte: austritte.get(z.id) ?? [] }));
}

/** Austritt einer Zeile für den Rechenkern. */
export function leaverVon(a: AustrittKern): Leaver {
  return { art: a.art, austrittAm: a.austrittAm, anzahl: a.anzahl, gevestet: a.gevestet, rueckkaufpreis: a.rueckkaufpreis };
}

/** Zeile einer Zuteilung (mit Austritten) als Vesting und Pool-Zuteilung des Rechenkerns. */
export function kernZuteilung(z: ZuteilungKern): Vesting & PoolZuteilung {
  const beginn = z.vestingBeginn ?? z.zugeteiltAm;
  return { anzahl: z.anzahl, zugeteiltAm: z.zugeteiltAm, beginn, cliffMonate: z.cliffMonate, vestingMonate: z.vestingMonate, beschleunigung: z.beschleunigung, basispreis: z.basispreis, status: z.status, statusAm: z.statusAm, austritte: z.austritte.map(leaverVon) };
}

export interface PoolBestand {
  aenderungen: { poolId: string; datum: string; anzahl: string; rundeId: string | null; basis: "pre_money" | "post_money" | null }[];
  zuteilungen: (ZuteilungKern & { poolId: string })[];
  pools: string[];
}

export async function ladePoolBestand(tx: Tx, organisationId: string): Promise<PoolBestand> {
  const pools = (await tx.select({ id: mitarbeiterpool.id }).from(mitarbeiterpool).where(eq(mitarbeiterpool.organisationId, organisationId))).map((p) => p.id);
  if (pools.length === 0) return { aenderungen: [], zuteilungen: [], pools };
  const aenderungen = await tx.select({ poolId: poolAenderung.poolId, datum: poolAenderung.datum, anzahl: poolAenderung.anzahl, rundeId: poolAenderung.rundeId, basis: poolAenderung.basis }).from(poolAenderung).where(inArray(poolAenderung.poolId, pools));
  const zeilen = await tx
    .select({ id: mitarbeiterzuteilung.id, poolId: mitarbeiterzuteilung.poolId, ...zuteilungKernSpalten })
    .from(mitarbeiterzuteilung)
    .where(inArray(mitarbeiterzuteilung.poolId, pools));
  const zuteilungen = mitAustritten(zeilen, await ladeAustritte(tx, zeilen.map((z) => z.id)));
  return { aenderungen, zuteilungen, pools };
}

/** Anteile im Pool nach der Runde (voll verwässert); `null` ohne Pool. */
export function poolBeiRunde(b: PoolBestand, datum: string, rundeId: string | null): string | null {
  if (b.pools.length === 0) return null;
  let summe = new Decimal(0);
  for (const poolId of b.pools) {
    const aenderungen = b.aenderungen
      .filter((a) => a.poolId === poolId)
      .filter((a) => !(rundeId !== null && a.rundeId === rundeId && a.basis === "post_money"))
      // Eine Aufstockung im Pre-Money dieser Runde zählt zum Rundendatum, auch wenn ihr Beschluss später datiert.
      .map((a) => (rundeId !== null && a.rundeId === rundeId && a.basis === "pre_money" ? { ...a, datum: datum < a.datum ? datum : a.datum } : a));
    summe = summe.plus(poolStand(aenderungen, b.zuteilungen.filter((z) => z.poolId === poolId).map(kernZuteilung), datum).vollVerwaessert);
  }
  return summe.toFixed(0);
}
