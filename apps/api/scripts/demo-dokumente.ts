import { erstelleDb } from "@carraway/db";
import { erstelleStandardSpeicher } from "../src/berichte/speicher";
import { datenbankUrl } from "../src/konfiguration";
import { legeDemoDokumenteAn } from "../src/demo/dokumente";

/** Legt die drei erfundenen Demo-Verträge an (nach `pnpm db:seed`). Dateiablage: `STORAGE_DIR` (Vorgabe `./storage`). */
const { db, pool } = erstelleDb(datenbankUrl());
try {
  const ergebnis = await legeDemoDokumenteAn(db, erstelleStandardSpeicher());
  for (const z of ergebnis.angelegt) console.log(`angelegt: ${z}`);
  for (const z of ergebnis.vorhanden) console.log(`schon vorhanden: ${z}`);
  if (ergebnis.angelegt.length + ergebnis.vorhanden.length === 0) console.log("Keine Beteiligungen gefunden: zuerst `pnpm db:seed`.");
} finally {
  await pool.end();
}
