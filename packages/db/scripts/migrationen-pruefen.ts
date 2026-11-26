import { migrationenVerzeichnis, pruefeMigrationsdateien } from "../src/migrationen";

// Aufruf: `pnpm migrationen:pruefen` (CI und lokal). Prüft das Journal und die Dateien in `packages/db/drizzle`.
const verzeichnis = migrationenVerzeichnis();
const probleme = pruefeMigrationsdateien(verzeichnis);
if (probleme.length > 0) {
  console.error(`Migrationen in ${verzeichnis} sind nicht in Ordnung:\n- ${probleme.join("\n- ")}`);
  process.exit(1);
}
console.log("Migrationen geordnet: Zeitstempel steigen streng, Nummern lückenlos und ohne Doppelung.");
