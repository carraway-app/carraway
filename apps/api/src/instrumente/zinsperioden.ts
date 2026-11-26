import { and, eq, gt, isNull } from "drizzle-orm";
import { zinslauf, zinslaufPosition, zinsperiodeGebucht } from "@carraway/db";
import type { Tx } from "../zeitlimit";
import { berechneZinsstand, ladeZinskontexte } from "./zinsen";
import { pruefePeriodensperre, type VorgangDaten } from "./zustand";

/** Gibt die Zinsperiode frei, wenn ihre Buchung storniert wird: der Marker verschwindet, ein neuer Lauf kann sie wieder buchen. */
export async function zinsperiodeAufgeben(tx: Tx, original: VorgangDaten): Promise<void> {
  if (original.art !== "zins") return;
  await tx.delete(zinsperiodeGebucht).where(eq(zinsperiodeGebucht.vorgangId, original.id));
}

/** Ein späterer Zinslauf kann wegen des Abgangs eine Nullperiode ohne stornierbare Buchung hinterlassen.
 * Nach dem Storno nur die Marker freigeben, deren Periode jetzt einen positiven Zins ergibt. */
export async function korrigiereNullperioden(tx: Tx, instrumentId: string, erfasstAm: Date) {
  const marker = await tx.select({ id: zinsperiodeGebucht.id, bis: zinsperiodeGebucht.periodeBis }).from(zinsperiodeGebucht)
    .innerJoin(zinslaufPosition, eq(zinslaufPosition.id, zinsperiodeGebucht.zinslaufPositionId))
    .innerJoin(zinslauf, eq(zinslauf.id, zinslaufPosition.zinslaufId))
    .where(and(eq(zinsperiodeGebucht.instrumentId, instrumentId), isNull(zinsperiodeGebucht.vorgangId), gt(zinslauf.gebuchtAm, erfasstAm)));
  if (!marker.length) return;
  const [k] = await ladeZinskontexte(tx, { instrumentIds: [instrumentId] });
  if (!k) return;
  const betroffen = new Map(marker.map((m) => [m.bis, m.id]));
  const bis = [...betroffen.keys()].sort().at(-1)!;
  const stand = berechneZinsstand({ ...k, markierte: k.markierte.filter((tag) => !betroffen.has(tag)) }, bis);
  for (const { position } of stand.positionen) {
    const id = betroffen.get(position.bis);
    if (id && position.betragGebucht.gt(0)) {
      await pruefePeriodensperre(tx, k.beteiligung.fondsId, position.bis);
      await tx.delete(zinsperiodeGebucht).where(eq(zinsperiodeGebucht.id, id));
    }
  }
}
