import { desc, eq } from "drizzle-orm";
import { beschluss } from "@carraway/db";
import type { Tx } from "../zeitlimit";
import { Fachfehler } from "../fehler";

/**
 * Ein Deal darf nur ins Closing oder ins Portfolio, wenn sein jüngster Beschluss zustimmt
 * (jüngster nach `datum`, dann `erstellt_am`; ein späterer ablehnender oder vertagender Beschluss hebt die Zustimmung auf).
 */
export async function verlangeZustimmendenBeschluss(tx: Tx, dealId: string) {
  const [juengster] = await tx
    .select()
    .from(beschluss)
    .where(eq(beschluss.dealId, dealId))
    .orderBy(desc(beschluss.datum), desc(beschluss.erstelltAm), desc(beschluss.id))
    .limit(1);
  if (juengster?.ergebnis !== "zugestimmt") throw new Fachfehler(409, "resolution_missing", "This requires an approving resolution.");
  return juengster;
}
