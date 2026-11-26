import { fileURLToPath } from "node:url";
import { readMigrationFiles } from "drizzle-orm/migrator";
import type { PgDialect, PgSession } from "drizzle-orm/pg-core";
import { erstelleDb } from "../src/index";
import { verlangeDatenbankUrl } from "../src/schutz";

// Im Container liegt das gebündelte Skript neben `drizzle/`; `MIGRATIONEN_VERZEICHNIS` überschreibt den Pfad.
export const MIGRATIONEN = process.env.MIGRATIONEN_VERZEICHNIS ?? fileURLToPath(new URL("../drizzle", import.meta.url));

export async function migriere(url: string) {
  const { db, pool } = erstelleDb(url);
  try {
    // Jede Migration läuft in einer eigenen Transaktion (drizzle bündelt sonst alle offenen in einer): PostgreSQL erlaubt einen mit
    // `ALTER TYPE … ADD VALUE` neu hinzugefügten Enum-Wert erst nach dem Commit. So darf eine spätere Migration ihn verwenden.
    // `dialect` und `session` sind in den Typen nicht öffentlich, `migrate` von drizzle benutzt sie genauso.
    const { dialect, session } = db as unknown as { dialect: PgDialect; session: PgSession };
    const konfiguration = { migrationsFolder: MIGRATIONEN };
    for (const migration of readMigrationFiles(konfiguration)) await dialect.migrate([migration], session, konfiguration);
  } finally {
    await pool.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // Migrationen laufen mit der Eigentümerrolle (`DATABASE_URL_EIGENTUEMER`), sonst mit `DATABASE_URL`; ohne ausdrückliche Adresse Abbruch.
  const url = verlangeDatenbankUrl(["DATABASE_URL_EIGENTUEMER", "DATABASE_URL"], "Migration");
  await migriere(url);
  console.log("Migrationen angewendet.");
}
