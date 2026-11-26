import { erstelleDb } from "@carraway/db";
import { legeDemoPostfachAn } from "../src/demo/postfach";
import { ladeSchluesselring } from "../src/geheimnis/krypto";
import { datenbankUrl } from "../src/konfiguration";

/**
 * Verbindet Postfach und Kalender der Demo-Person Vera mit dem Demo-Anbieter (Fake im Prozess, kein Konto, kein Netzwerk) und übernimmt einige erfundene
 * Mails und Termine mit Kontakten der Demo-Daten. Nach `pnpm db:seed`. Im Echtbestand verweigert das Skript die Arbeit.
 */
const umgebung = process.env.CARRAWAY_UMGEBUNG ?? "demo";
if (umgebung === "echt") throw new Error("Im Echtbestand gibt es keine Demo-Daten.");
const ring = ladeSchluesselring(process.env, umgebung);
if (!ring) throw new Error("GEHEIMNIS_SCHLUESSEL fehlt (außerhalb von Produktion gilt ohne Angabe ein öffentlicher Entwicklungsschlüssel).");
const { db, pool } = erstelleDb(datenbankUrl());
try {
  const e = await legeDemoPostfachAn(db, ring, umgebung);
  console.log(`Demo-Postfach: ${e.verbindungen} Verbindungen abgeglichen, ${e.mails} Mails und ${e.termine} Termine übernommen.`);
} finally {
  await pool.end();
}
