import { eq } from "drizzle-orm";
import { zinsperiodeGebucht } from "@carraway/db";
import type { Tx } from "../zeitlimit";
import type { VorgangDaten } from "./zustand";

/** Gibt die Zinsperiode frei, wenn ihre Buchung storniert wird: der Marker verschwindet, ein neuer Lauf kann sie wieder buchen. */
export async function zinsperiodeAufgeben(tx: Tx, original: VorgangDaten): Promise<void> {
  if (original.art !== "zins") return;
  await tx.delete(zinsperiodeGebucht).where(eq(zinsperiodeGebucht.vorgangId, original.id));
}
