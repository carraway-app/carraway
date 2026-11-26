import type { Db } from "@carraway/db";
import { MigrationsstandFehler, verlangeMigrationsstand } from "@carraway/db/migrationen";
import type { Logger } from "./beobachtung/protokoll";

/**
 * Start von API und Worker: Die Datenbank muss genau die Migrationen haben, die dieser Code kennt. Sonst steht eine klare Zeile im
 * Protokoll, und der Prozess beendet sich mit Fehlercode, statt auf einem falschen Schema zu arbeiten.
 */
export async function verlangeMigrationsstandBeimStart(db: Db, rolle: "api" | "worker", logger: Logger, beenden: (code: number) => never = process.exit): Promise<void> {
  try {
    await verlangeMigrationsstand(db);
  } catch (fehler) {
    const meldung = fehler instanceof Error ? fehler.message : String(fehler);
    logger("error", `${rolle} startet nicht: Migrationsstand passt nicht zum Code`, { grund: fehler instanceof MigrationsstandFehler ? meldung : `Migrationsstand nicht prüfbar: ${meldung}` });
    beenden(1);
  }
}
