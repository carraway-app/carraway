import { eq } from "drizzle-orm";
import { pruefeKonfiguration, standardKonfiguration, type Berichtsart, type Vorlagenkonfiguration } from "@carraway/berichte";
import { berichtFreigabestufen, berichtVorlage } from "@carraway/db";
import type { Tx } from "../zeitlimit";

/** Standardstufen der Berichtsfreigabe; je Fonds konfigurierbar. Jede Stufe verlangt einen anderen Akteur. */
export const STANDARD_STUFEN = ["Investmentmanager", "Teamleitung", "Geschäftsführung"] as const;

type Abfrage = Pick<Tx, "select">;

/** Vorlage des Fonds für die Art: gespeicherte Konfiguration (geprüft, mit Standardwerten ergänzt) oder die Standardkonfiguration. */
export async function ladeVorlage(tx: Abfrage, fondsId: string, art: Berichtsart): Promise<Vorlagenkonfiguration> {
  const zeilen = await tx.select().from(berichtVorlage).where(eq(berichtVorlage.fondsId, fondsId));
  const treffer = zeilen.find((z) => z.art === art);
  return treffer ? pruefeKonfiguration(art, treffer.konfiguration) : standardKonfiguration(art);
}

export async function ladeFreigabestufen(tx: Abfrage, fondsId: string): Promise<string[]> {
  const [zeile] = await tx.select().from(berichtFreigabestufen).where(eq(berichtFreigabestufen.fondsId, fondsId));
  return zeile ? (zeile.stufen as string[]) : [...STANDARD_STUFEN];
}
