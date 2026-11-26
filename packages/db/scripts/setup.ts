import pg from "pg";
import { setupZiele, testDatenbankUrl } from "../src/schutz";
import { migriere } from "./migrate";

const superuserUrl = process.env.DATABASE_URL_SUPERUSER ?? "postgres://localhost:5432/postgres";
const nurTest = process.argv.includes("--nur-test");
// Der Testaufbau legt die Datenbank neu an (DROP): ausdrücklich gesetzt und mit `test` im Namen.
const testUrl = nurTest ? testDatenbankUrl(process.env, "setup:test") : "";

const ROLLE = "carraway";
const PASSWORT = "carraway";

function datenbankName(url: string): string {
  const name = decodeURIComponent(new URL(url).pathname.slice(1));
  if (!/^carraway_[a-z0-9_]+$/.test(name)) {
    throw new Error(`Datenbank "${name}" abgelehnt: Name muss mit carraway_ beginnen.`);
  }
  return name;
}

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;

async function rolleAnlegen(client: pg.Client) {
  const { rowCount } = await client.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [ROLLE]);
  if (!rowCount) {
    // Utility-Statements nehmen keine Parameter; Name und Passwort sind Konstanten.
    await client.query(`CREATE ROLE ${quote(ROLLE)} LOGIN PASSWORD '${PASSWORT}'`);
    console.log(`Rolle ${ROLLE} angelegt.`);
  }
}

async function datenbankAnlegen(client: pg.Client, name: string) {
  const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
  if (!rowCount) {
    await client.query(`CREATE DATABASE ${quote(name)} OWNER ${quote(ROLLE)}`);
    console.log(`Datenbank ${name} angelegt.`);
  }
}

async function datenbankNeuAnlegen(client: pg.Client, name: string) {
  await client.query(`DROP DATABASE IF EXISTS ${quote(name)} WITH (FORCE)`);
  await client.query(`CREATE DATABASE ${quote(name)} OWNER ${quote(ROLLE)}`);
  console.log(`Datenbank ${name} neu angelegt.`);
}

// Prüfen vor dem Verbinden: ein abgelehntes Ziel darf keinen Datenbankzugriff auslösen.
const ziele = nurTest ? null : setupZiele(process.argv);
const client = new pg.Client({ connectionString: superuserUrl });
await client.connect();
try {
  await rolleAnlegen(client);
  if (ziele === null) {
    const name = datenbankName(testUrl);
    await datenbankNeuAnlegen(client, name);
    await migriere(testUrl);
  } else {
    const namen = [datenbankName(ziele.entwicklung), datenbankName(ziele.test)];
    const herkunft = ziele.quelle === "lokal-standard" ? "--lokal-standard" : "aus DATABASE_URL und DATABASE_URL_TEST";
    console.log(`db:setup legt an und migriert (${herkunft}): ${namen.join(", ")}`);
    for (const name of namen) await datenbankAnlegen(client, name);
    await migriere(ziele.entwicklung);
    await migriere(ziele.test);
  }
} finally {
  await client.end();
}
console.log("Setup fertig.");
