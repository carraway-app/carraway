import { erstelleDb } from "@carraway/db";
import { datenbankUrl } from "../src/konfiguration";
import { ladeSchluesselring } from "../src/geheimnis/krypto";
import { rotiereGeheimnisse } from "../src/geheimnis/rotation";

/**
 * Verschlüsselt alle ruhenden Geheimnisse (Postfach-Zugänge, Mailinhalte im Ausgangskorb, OAuth-Zustände) mit dem aktuellen `GEHEIMNIS_SCHLUESSEL` neu.
 * Vorher den bisherigen Schlüssel in `GEHEIMNIS_SCHLUESSEL_ALT` eintragen. Ablauf: docs/security/mail-and-calendar.md.
 */
const ring = ladeSchluesselring(process.env, process.env.CARRAWAY_UMGEBUNG ?? "demo");
if (!ring) throw new Error("GEHEIMNIS_SCHLUESSEL ist nicht gesetzt.");
const { db, pool } = erstelleDb(datenbankUrl());
try {
  const e = await rotiereGeheimnisse(db, ring);
  console.log(`neu verschlüsselt: ${e.neuVerschluesselt}, schon aktuell: ${e.schonAktuell}, unlesbar (Schlüssel fehlt): ${e.unlesbar}`);
  if (e.unlesbar > 0) process.exitCode = 1;
} finally {
  await pool.end();
}
