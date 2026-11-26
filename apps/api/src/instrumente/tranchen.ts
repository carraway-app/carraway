import { asc, eq, inArray } from "drizzle-orm";
import { tranche } from "@carraway/db";
import { Decimal } from "@carraway/rechenkern";
import type { Tx } from "../zeitlimit";
import type { VorgangDaten } from "./zustand";

/**
 * Die Tranche (bisher Meilenstein) in der Form der API: `frist` heißt in der Datenbank jetzt `geplant_am`. Die alten Feldnamen bleiben
 * erhalten (Web und Aufrufer sind unverändert), die neuen kommen dazu.
 */
export const alsMeilenstein = <T extends Pick<typeof tranche.$inferSelect, "geplantAm">>(t: T): T & { frist: string | null } => ({ ...t, frist: t.geplantAm });
export const alsTranche = alsMeilenstein;

/** Ein Vorgang in der Form der API: `tranche_id` heißt in der API weiter `meilensteinId`. */
export const alsVorgangJson = <T extends { trancheId: string | null }>(v: T): T & { meilensteinId: string | null } => ({ ...v, meilensteinId: v.trancheId });

export type TrancheZeile = typeof tranche.$inferSelect;

/**
 * Stand einer Tranche: `zahlung` ist `zugesagt` (noch nichts gezahlt), `teilweise_gezahlt` oder `gezahlt` (Summe der Auszahlungen ≥ Betrag);
 * `bedingung` ist `null` ohne Bedingung, sonst `offen` oder `erfuellt`.
 */
export interface TrancheStand {
  zahlung: "zugesagt" | "teilweise_gezahlt" | "gezahlt";
  bedingung: "offen" | "erfuellt" | null;
  ausgezahlt: string;
  offen: string;
}

export function trancheStand(t: Pick<TrancheZeile, "betrag" | "bedingung" | "erfuelltAm">, ausgezahlt: Decimal.Value): TrancheStand {
  const gezahlt = new Decimal(ausgezahlt);
  const betrag = new Decimal(t.betrag);
  return {
    zahlung: gezahlt.greaterThanOrEqualTo(betrag) ? "gezahlt" : gezahlt.greaterThan(0) ? "teilweise_gezahlt" : "zugesagt",
    bedingung: t.bedingung ? (t.erfuelltAm ? "erfuellt" : "offen") : null,
    ausgezahlt: gezahlt.toFixed(2),
    offen: Decimal.max(betrag.minus(gezahlt), 0).toFixed(2),
  };
}

/** Netto ausgezahlt (Auszahlungen und ihre Stornos) je Tranche. */
export function ausgezahltJeTranche(vorgaenge: readonly VorgangDaten[]): Map<string, Decimal> {
  const summe = new Map<string, Decimal>();
  for (const v of vorgaenge) if (v.art === "auszahlung" && v.trancheId) summe.set(v.trancheId, (summe.get(v.trancheId) ?? new Decimal(0)).plus(v.betrag));
  return summe;
}

/** Tranchen der Instrumente (nach Nummer, dann Anlage) mit Stand; die Vorgänge der Beteiligung(en) liefern die Auszahlungen. */
export async function ladeTranchenMitStand(tx: Tx, instrumentIds: readonly string[], vorgaenge: readonly VorgangDaten[], sicht: { stichtag?: string | undefined; stand?: string | undefined } = {}) {
  if (instrumentIds.length === 0) return [];
  const standMs = sicht.stand === undefined ? null : new Date(sicht.stand).getTime();
  const alle = await tx.select().from(tranche).where(inArray(tranche.instrumentId, [...instrumentIds])).orderBy(asc(tranche.instrumentId), asc(tranche.nummer), asc(tranche.erstelltAm), asc(tranche.id));
  // Mit Wissensstand nur Tranchen, die dann schon angelegt waren; eine Erfüllung nach dem Stichtag gilt dann noch nicht.
  const zeilen = alle
    .filter((t) => standMs === null || t.erstelltAm.getTime() <= standMs)
    .map((t) => (sicht.stichtag !== undefined && t.erfuelltAm !== null && t.erfuelltAm > sicht.stichtag ? { ...t, erfuelltAm: null, nachweis: null } : t));
  const gezahlt = ausgezahltJeTranche(vorgaenge);
  return zeilen.map((t) => ({ ...alsTranche(t), stand: trancheStand(t, gezahlt.get(t.id) ?? 0) }));
}

/** Summe der Tranchen eines Instruments (optional ohne eine Tranche, z. B. beim Ändern). */
export async function summeTranchen(tx: Tx, instrumentId: string, ohne?: string): Promise<Decimal> {
  const zeilen = await tx.select({ id: tranche.id, betrag: tranche.betrag }).from(tranche).where(eq(tranche.instrumentId, instrumentId));
  return zeilen.filter((t) => t.id !== ohne).reduce((s, t) => s.plus(t.betrag), new Decimal(0));
}
