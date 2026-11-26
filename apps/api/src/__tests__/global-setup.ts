import pg from "pg";
import { datenbankNameAusUrl, testDatenbankUrl } from "@carraway/db/schutz";
import { testDbWorkerAnzahl, workerDbName } from "./worker-db";

const VORGABE_SUPERUSER = "postgres://localhost:5432/postgres";
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;

async function klonePruefen(admin: pg.Client, basis: string, anzahl: number) {
  for (let id = 1; id <= anzahl; id++) await admin.query(`DROP DATABASE IF EXISTS ${quote(workerDbName(basis, id))} WITH (FORCE)`);
}

/**
 * Bricht den ganzen Testlauf mit klarer Meldung ab, bevor eine Datei gegen die falsche Datenbank läuft. Mit `TEST_DB_WORKERS`
 * legt es zusätzlich je Worker einen Klon der migrierten Test-Datenbank an (siehe `worker-db.ts`) und löscht sie am Ende wieder.
 * Die Basis muss migriert sein (`pnpm --filter @carraway/db setup:test`) und darf keine offene Sitzung haben.
 */
export default async function setup(): Promise<(() => Promise<void>) | undefined> {
  const url = testDatenbankUrl();
  const anzahl = testDbWorkerAnzahl();
  if (anzahl === null) return undefined;

  const basis = datenbankNameAusUrl(url);
  const eigentuemer = decodeURIComponent(new URL(url).username);
  const superuserUrl = process.env.DATABASE_URL_SUPERUSER ?? VORGABE_SUPERUSER;

  const admin = new pg.Client({ connectionString: superuserUrl });
  await admin.connect();
  try {
    await klonePruefen(admin, basis, anzahl);
    for (let id = 1; id <= anzahl; id++) {
      const klon = workerDbName(basis, id);
      await admin.query(`CREATE DATABASE ${quote(klon)} TEMPLATE ${quote(basis)} OWNER ${quote(eigentuemer)}`);
      // Wegwerf-Datenbank: ohne Warten auf das Schreiben jedes Commits, gleiche Daten und Abfragen, nur ohne Absturzsicherheit.
      await admin.query(`ALTER DATABASE ${quote(klon)} SET synchronous_commit = off`);
    }
  } finally {
    await admin.end();
  }

  return async () => {
    const abbau = new pg.Client({ connectionString: superuserUrl });
    await abbau.connect();
    try {
      await klonePruefen(abbau, basis, anzahl);
    } finally {
      await abbau.end();
    }
  };
}
