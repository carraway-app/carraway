/**
 * Kontrolle einer Installation nach der Wiederherstellung (oder jederzeit): Jede Zeile mit einer Datei in der Dateiablage
 * (Dokumente, Berichte, Berichtsfassungen, Mitteilungen, Belege, Buchungsexporte, Meldedateien) muss ihre Datei haben, und der
 * SHA-256 der Datei muss zum gespeicherten Wert passen. Nur lesend.
 *
 *   DATABASE_URL=postgres://... SPEICHER_VERZEICHNIS=/daten/speicher pnpm ops:dateien-pruefen
 */
import pg from "pg";
import { verlangeDatenbankUrl } from "../../packages/db/src/schutz";
import { pruefeDateien } from "./dateiablage";

const url = verlangeDatenbankUrl(["DATABASE_URL"], "ops:dateien-pruefen");
const speicher = process.env.SPEICHER_VERZEICHNIS?.trim();
if (!speicher) {
  console.error("ops:dateien-pruefen: SPEICHER_VERZEICHNIS ist nicht gesetzt (Verzeichnis der Dateiablage, im Container /daten/speicher).");
  process.exit(2);
}
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const { geprueft, probleme } = await pruefeDateien(client, speicher);
  for (const [art, n] of geprueft) console.log(`${art}: ${n} Dateien geprüft`);
  if (probleme.length > 0) {
    console.error(`Dateiablage und Datenbank passen nicht zusammen:\n- ${probleme.join("\n- ")}`);
    process.exitCode = 1;
  } else {
    console.log("Dateiablage stimmt mit der Datenbank überein.");
  }
} finally {
  await client.end();
}
