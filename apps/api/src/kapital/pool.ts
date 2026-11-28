import { asc, eq, inArray } from "drizzle-orm";
import { mitarbeiterpool, mitarbeiterzuteilung, poolAenderung, zuteilungAustritt, zuteilungAusuebung } from "@carraway/db";
import { Decimal, poolStand, poolStandGrob, type Leaver, type PoolAenderung, type PoolStand, type PoolZuteilung, type Vesting } from "@carraway/rechenkern";
import type { Tx } from "../zeitlimit";

/**
 * Pool der Mitarbeiterbeteiligung zum Datum einer Runde (für die Prüfung auf voll verwässerter Basis): je Pool die Änderungen bis zum
 * Rundendatum, dazu eine Aufstockung im Pre-Money dieser Runde (auch mit späterem Datum) und ohne eine Aufstockung im Post-Money dieser
 * Runde. Gezählt wird, was voll verwässert zählt: ausstehend + frei (vor der Runde ausgeübte Optionen stecken in den ausgegebenen Anteilen).
 */

type ZuteilungZeile = typeof mitarbeiterzuteilung.$inferSelect;
type AustrittZeile = typeof zuteilungAustritt.$inferSelect;
export type AusuebungZeile = typeof zuteilungAusuebung.$inferSelect;
type AusuebungKern = Pick<AusuebungZeile, "datum" | "anzahl" | "preis">;

/** Angaben eines Austritts, die der Rechenkern braucht. */
export type AustrittKern = Pick<AustrittZeile, "art" | "austrittAm" | "anzahl" | "gevestet" | "rueckkaufpreis">;

/** Spalten einer Zuteilung, die der Rechenkern braucht (Vesting, Status), dazu ihre Austritte (Pflicht, damit kein Ladeweg sie vergisst). */
export type ZuteilungKern = Pick<ZuteilungZeile, "anzahl" | "zugeteiltAm" | "vestingBeginn" | "cliffMonate" | "vestingMonate" | "taktMonate" | "beschleunigung" | "basispreis" | "status" | "statusAm" | "ausloeser" | "vestingStufen" | "leaverStufen"> & {
  austritte: readonly AustrittKern[];
  ausuebungen: readonly AusuebungKern[];
};

export const zuteilungKernSpalten = {
  anzahl: mitarbeiterzuteilung.anzahl,
  zugeteiltAm: mitarbeiterzuteilung.zugeteiltAm,
  vestingBeginn: mitarbeiterzuteilung.vestingBeginn,
  cliffMonate: mitarbeiterzuteilung.cliffMonate,
  vestingMonate: mitarbeiterzuteilung.vestingMonate,
  taktMonate: mitarbeiterzuteilung.taktMonate,
  beschleunigung: mitarbeiterzuteilung.beschleunigung,
  basispreis: mitarbeiterzuteilung.basispreis,
  status: mitarbeiterzuteilung.status,
  statusAm: mitarbeiterzuteilung.statusAm,
  ausloeser: mitarbeiterzuteilung.ausloeser,
  vestingStufen: mitarbeiterzuteilung.vestingStufen,
  leaverStufen: mitarbeiterzuteilung.leaverStufen,
};

/** Austritte der Zuteilungen, je Zuteilung nach Datum geordnet. */
async function ladeAustritte(tx: Tx, zuteilungIds: readonly string[]): Promise<Map<string, AustrittZeile[]>> {
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

export async function ladeAusuebungen(tx: Tx, ids: string[]): Promise<Map<string, AusuebungZeile[]>> {
  const je = new Map<string, AusuebungZeile[]>();
  if (ids.length === 0) return je;
  const zeilen = await tx.select().from(zuteilungAusuebung).where(inArray(zuteilungAusuebung.zuteilungId, ids))
    .orderBy(asc(zuteilungAusuebung.datum), asc(zuteilungAusuebung.erstelltAm), asc(zuteilungAusuebung.id));
  for (const a of zeilen) {
    const gruppe = je.get(a.zuteilungId);
    if (gruppe) gruppe.push(a);
    else je.set(a.zuteilungId, [a]);
  }
  return je;
}

/** Lädt Austritte und Ausübungen für eine Liste von Zuteilungen. */
export async function mitZuteilungsereignissen<T extends { id: string }>(tx: Tx, zuteilungen: readonly T[]) {
  const ids = zuteilungen.map((z) => z.id);
  const austritte = await ladeAustritte(tx, ids);
  const ausuebungen = await ladeAusuebungen(tx, ids);
  return zuteilungen.map((z) => ({ ...z, austritte: austritte.get(z.id) ?? [], ausuebungen: ausuebungen.get(z.id) ?? [] }));
}

/** Ausübungen mit Datum und Preis, einschließlich älterer Zuteilungen mit einem einzigen Statusdatum. */
export function ausuebungenVon(z: Pick<ZuteilungKern, "ausuebungen" | "anzahl" | "basispreis" | "status" | "statusAm">): readonly AusuebungKern[] {
  if (z.ausuebungen.length > 0) return z.ausuebungen;
  return z.status === "ausgeuebt" && z.statusAm ? [{ datum: z.statusAm, anzahl: z.anzahl, preis: z.basispreis }] : [];
}

/** Austritt einer Zeile für den Rechenkern. */
export function leaverVon(a: AustrittKern): Leaver {
  return { art: a.art, austrittAm: a.austrittAm, anzahl: a.anzahl, gevestet: a.gevestet, rueckkaufpreis: a.rueckkaufpreis };
}

/** Zeile einer Zuteilung (mit Austritten) als Vesting und Pool-Zuteilung des Rechenkerns. */
export function kernZuteilung(z: ZuteilungKern): Vesting & PoolZuteilung {
  const beginn = z.vestingBeginn ?? z.zugeteiltAm;
  return { anzahl: z.anzahl, zugeteiltAm: z.zugeteiltAm, beginn, cliffMonate: z.cliffMonate, vestingMonate: z.vestingMonate, taktMonate: z.taktMonate, beschleunigung: z.beschleunigung, basispreis: z.basispreis, status: z.status, statusAm: z.statusAm, austritte: z.austritte.map(leaverVon),
    vestingStufen: z.vestingStufen, leaverStufen: z.leaverStufen, ausuebungen: z.ausuebungen, beschleunigungAusloeser: z.ausloeser };
}

/** Angaben eines Pools, die über die Art der Erfassung entscheiden. */
export type PoolErfassung = Pick<typeof mitarbeiterpool.$inferSelect, "erfassung" | "vergeben">;

/**
 * Stand eines Pools zum Stichtag nach seiner Erfassung: grob mit den vergebenen Einheiten (Rechenkern `poolStandGrob`), einzeln mit den
 * Zuteilungen. Die einzige Stelle, die entscheidet, welche Angaben zählen; Zuteilungen eines grob erfassten Pools gibt es nicht (die API lehnt sie ab).
 */
export function standDesPools(pool: PoolErfassung, aenderungen: readonly PoolAenderung[], zuteilungen: readonly ZuteilungKern[], stichtag: string): PoolStand {
  return pool.erfassung === "grob" ? poolStandGrob(aenderungen, pool.vergeben, stichtag) : poolStand(aenderungen, zuteilungen.map(kernZuteilung), stichtag);
}

export interface PoolBestand {
  aenderungen: { poolId: string; datum: string; anzahl: string; rundeId: string | null; basis: "pre_money" | "post_money" | null }[];
  zuteilungen: (ZuteilungKern & { poolId: string })[];
  pools: string[];
  erfassung: Map<string, PoolErfassung>;
}

export async function ladePoolBestand(tx: Tx, organisationId: string): Promise<PoolBestand> {
  const zeilenPools = await tx.select({ id: mitarbeiterpool.id, erfassung: mitarbeiterpool.erfassung, vergeben: mitarbeiterpool.vergeben }).from(mitarbeiterpool).where(eq(mitarbeiterpool.organisationId, organisationId));
  const pools = zeilenPools.map((p) => p.id);
  const erfassung = new Map(zeilenPools.map((p) => [p.id, { erfassung: p.erfassung, vergeben: p.vergeben }] as const));
  if (pools.length === 0) return { aenderungen: [], zuteilungen: [], pools, erfassung };
  const aenderungen = await tx.select({ poolId: poolAenderung.poolId, datum: poolAenderung.datum, anzahl: poolAenderung.anzahl, rundeId: poolAenderung.rundeId, basis: poolAenderung.basis }).from(poolAenderung).where(inArray(poolAenderung.poolId, pools));
  const zeilen = await tx
    .select({ id: mitarbeiterzuteilung.id, poolId: mitarbeiterzuteilung.poolId, ...zuteilungKernSpalten })
    .from(mitarbeiterzuteilung)
    .where(inArray(mitarbeiterzuteilung.poolId, pools));
  const zuteilungen = await mitZuteilungsereignissen(tx, zeilen);
  return { aenderungen, zuteilungen, pools, erfassung };
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
    summe = summe.plus(standDesPools(b.erfassung.get(poolId)!, aenderungen, b.zuteilungen.filter((z) => z.poolId === poolId), datum).vollVerwaessert);
  }
  return summe.toFixed(0);
}
