import * as s from "@carraway/db";
import { hauptinstrumentIds } from "../instrumente/hauptinstrument";

type Vorgangswert = Omit<typeof s.vorgang.$inferInsert, "instrumentId">;

/** Fügt Vorgänge direkt ein (am Hauptinstrument ihrer Beteiligung; jeder Vorgang braucht ein Instrument) und liefert die Zeilen. */
export async function vorgaengeEinfuegen(db: s.Db, werte: Vorgangswert | Vorgangswert[]) {
  const liste = Array.isArray(werte) ? werte : [werte];
  const instrumente = await hauptinstrumentIds(db, liste.map((v) => v.beteiligungId));
  return db.insert(s.vorgang).values(liste.map((v) => ({ ...v, instrumentId: instrumente.get(v.beteiligungId)! }))).returning();
}
