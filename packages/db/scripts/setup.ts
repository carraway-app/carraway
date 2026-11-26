import pg from "pg";
import { setupZiele, testDatenbankUrl } from "../src/schutz";
import { migriere } from "./migrate";

const superuserUrl = process.env.DATABASE_URL_SUPERUSER ?? "postgres://localhost:5432/postgres";
const nurTest = process.argv.includes("--nur-test");

function ziel(url: string) {
  const adresse = new URL(url);
  const name = decodeURIComponent(adresse.pathname.slice(1));
  if (!/^carraway_[a-z0-9_]+$/.test(name) || name.length > 63) {
    throw new Error(`Datenbank "${name}" abgelehnt: Name muss mit carraway_ beginnen und höchstens 63 Zeichen lang sein.`);
  }
  const rolle = decodeURIComponent(adresse.username) || "carraway";
  const passwort = decodeURIComponent(adresse.password) || (rolle === "carraway" ? "carraway" : "");
  return { url, name, rolle, passwort };
}

async function rolleAnlegen(client: pg.Client, rolle: string, passwort: string) {
  const { rowCount } = await client.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [rolle]);
  if (!rowCount) {
    await client.query(`CREATE ROLE ${pg.escapeIdentifier(rolle)} LOGIN PASSWORD ${pg.escapeLiteral(passwort)}`);
    console.log(`Rolle ${rolle} angelegt.`);
  }
}

// Prüfen vor dem Verbinden: ein abgelehntes Ziel darf keinen Datenbankzugriff auslösen.
const ziele = nurTest ? null : setupZiele(process.argv);
// Der Testaufbau legt die Datenbank neu an (DROP): ausdrücklich gesetzt und mit `test` im Namen.
const datenbanken = ziele === null
  ? [ziel(testDatenbankUrl(process.env, "setup:test"))]
  : [ziel(ziele.entwicklung), ziel(ziele.test)];
if (ziele !== null) {
  const herkunft = ziele.quelle === "lokal-standard" ? "--lokal-standard" : "aus DATABASE_URL und DATABASE_URL_TEST";
  console.log(`db:setup legt an und migriert (${herkunft}): ${datenbanken.map(({ name }) => name).join(", ")}`);
}

const client = new pg.Client({ connectionString: superuserUrl });
await client.connect();
try {
  for (const { name, rolle, passwort } of datenbanken) {
    await rolleAnlegen(client, rolle, passwort);
    const kennung = pg.escapeIdentifier(name);
    if (nurTest) await client.query(`DROP DATABASE IF EXISTS ${kennung} WITH (FORCE)`);
    const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    if (!rowCount) {
      await client.query(`CREATE DATABASE ${kennung} OWNER ${pg.escapeIdentifier(rolle)}`);
      console.log(`Datenbank ${name} angelegt.`);
    }
  }
  for (const { url } of datenbanken) await migriere(url);
} finally {
  await client.end();
}
console.log("Setup fertig.");
