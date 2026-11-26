/**
 * Wiederherstellungstest für die Sicherung: legt eine frische Datenbank an, migriert sie, füllt sie mit Demo-Daten, sichert sie
 * mit `pg_dump` (Custom-Format, wie `deploy/sicherung.sh`), spielt den Dump mit `pg_restore` in eine zweite frische Datenbank ein
 * und vergleicht beide: Schema (Spalten, Trigger) sowie je Tabelle Zeilenzahl und eine Prüfsumme über alle Zeilen. Eine
 * Sicherung gilt erst als brauchbar, wenn dieser Vergleich stimmt.
 *
 * Aufruf: `pnpm ops:sicherung-test` (CI und lokal). Die Test-Datenbank selbst bleibt unberührt; der Test legt zwei eigene
 * Datenbanken `<Name der Test-Datenbank>_sq` und `_sz` an und löscht sie am Ende wieder.
 *
 * Umgebung: DATABASE_URL_TEST (Rolle und Name wie bei `setup:test`), DATABASE_URL_SUPERUSER (legt die Datenbanken an und spielt
 * den Dump ein, wie der Superuser im Compose-Stack), PG_DUMP und PG_RESTORE (Pfade, Vorgabe aus dem PATH). Die Client-Version
 * von `pg_dump` muss mindestens der Server-Version entsprechen.
 *
 * Auch die Dateiablage gehört zur Sicherung: Der Test legt für jede Dateiart (Dokumente, Berichte, Berichtsfassungen, Mitteilungen,
 * Belege, Buchungsexporte, Meldedateien; siehe `dateiablage.ts`) eine Datei samt Zeile an, packt das Verzeichnis wie `deploy/sicherung.sh`
 * (`tar -czf`), entpackt es in ein zweites Verzeichnis und prüft für jede wiederhergestellte Zeile, dass die Datei da ist und den
 * gespeicherten SHA-256 hat. Eine beschädigte Datei muss dabei auffallen (Gegenprobe). Kommt eine Dateispalte hinzu, die nicht in
 * `DATEI_ARTEN` steht, scheitert der Test.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import pg from "pg";
import { aenderung, dokument, erstelleDb } from "@carraway/db";
import { erzeugeDemodaten, schreibeDemodaten } from "@carraway/db/demo";
import { testDatenbankUrl } from "../../packages/db/src/schutz";
import { migriere } from "../../packages/db/scripts/migrate";
import { DATEI_ARTEN, findeUnbekannteDateispalten, pruefeDateien } from "./dateiablage";
import { abbilden, legeDateienAn } from "./sicherungs-helfer";

const ausfuehren = promisify(execFile);

// Ausdrücklich gesetzt und mit `test` im Namen (Schutz vor der falschen Datenbank).
const testUrl = new URL(testDatenbankUrl(process.env, "ops:sicherung-test"));
const superuserUrl = new URL(process.env.DATABASE_URL_SUPERUSER ?? "postgres://localhost:5432/postgres");
const pgDump = process.env.PG_DUMP ?? "pg_dump";
const pgRestore = process.env.PG_RESTORE ?? "pg_restore";

const basisName = decodeURIComponent(testUrl.pathname.slice(1));
if (!/^carraway_[a-z0-9_]+$/.test(basisName)) throw new Error(`Datenbank "${basisName}" abgelehnt: Name muss mit carraway_ beginnen.`);
const quelleName = `${basisName}_sq`.slice(0, 63);
const zielName = `${basisName}_sz`.slice(0, 63);
const eigentuemer = decodeURIComponent(testUrl.username);

const urlFuer = (basis: URL, name: string, mitTestRolle = false) => {
  const u = new URL(basis.toString());
  u.pathname = `/${name}`;
  if (mitTestRolle) {
    u.username = testUrl.username;
    u.password = testUrl.password;
  }
  return u.toString();
};
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
/** Erfundene Datei für den Test der Dateiablage (nur Kennzeichen eines PDF, kein lesbarer Inhalt). */
const TESTDATEI = Buffer.from("%PDF-1.4\n% Beispiel fuer den Wiederherstellungstest\n%%EOF\n", "latin1");
/** Tabellen, die nach dem Befüllen Zeilen haben müssen, sonst wäre der Vergleich leer. */
const MUSS_GEFUELLT_SEIN = [...new Set(["dokument", "fonds", "beteiligung", "vorgang", "bewertung", "organisation", "person", "deal", "aenderung", ...DATEI_ARTEN.map((a) => a.tabelle)])];

async function datenbankNeu(admin: pg.Client, name: string) {
  await admin.query(`DROP DATABASE IF EXISTS ${quote(name)} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${quote(name)} OWNER ${quote(eigentuemer)}`);
}

async function serverHauptversion(admin: pg.Client): Promise<number> {
  const { rows } = await admin.query<{ v: string }>("SHOW server_version_num");
  return Math.floor(Number(rows[0]!.v) / 10_000);
}

async function clientHauptversion(): Promise<number> {
  const { stdout } = await ausfuehren(pgDump, ["--version"]);
  const treffer = /(\d+)(?:\.\d+)?/.exec(stdout.replace(/^[^\d]*/, ""));
  return Number(treffer?.[1] ?? 0);
}

const admin = new pg.Client({ connectionString: superuserUrl.toString() });
await admin.connect();
const arbeitsverzeichnis = await mkdtemp(join(tmpdir(), "carraway-sicherungstest-"));
const speicherQuelle = join(arbeitsverzeichnis, "speicher");
const speicherZiel = join(arbeitsverzeichnis, "speicher-zurueck");
const dateiHash = sha256(TESTDATEI);
const dateiSchluessel = `dokumente/${dateiHash.slice(0, 2)}/${dateiHash}`;
let fehler: unknown;
try {
  const server = await serverHauptversion(admin);
  const client = await clientHauptversion();
  if (client < server) throw new Error(`pg_dump ${client} ist älter als der Server ${server}; Client aktualisieren oder PG_DUMP setzen.`);

  console.log(`Quelle ${quelleName} anlegen, migrieren und mit Demo-Daten füllen ...`);
  await datenbankNeu(admin, quelleName);
  const quelleUrl = urlFuer(testUrl, quelleName);
  await migriere(quelleUrl);
  const { db, pool } = erstelleDb(quelleUrl);
  try {
    await schreibeDemodaten(db, erzeugeDemodaten({ seed: 1 }));
    // Die Demo-Daten schreiben kein Änderungsprotokoll; zwei Zeilen genügen, damit auch diese Tabelle (mit JSON-Spalten) mitgeprüft wird.
    await db.insert(aenderung).values([
      { akteur: "system", aktion: "anlegen", tabelle: "fonds", datensatzId: "00000000-0000-0000-0000-000000000001", vorher: null, nachher: { name: "Beispiel" } },
      { akteur: "system", aktion: "aendern", tabelle: "fonds", datensatzId: "00000000-0000-0000-0000-000000000001", vorher: { name: "Beispiel" }, nachher: { name: "Beispiel 2" } },
    ]);
    // Dokument mit Datei in der Dateiablage (Schlüssel wie `dokumentSchluessel` der API)
    await mkdir(join(speicherQuelle, "dokumente", dateiHash.slice(0, 2)), { recursive: true });
    await writeFile(join(speicherQuelle, dateiSchluessel), TESTDATEI);
    await db.insert(dokument).values({ sha256: dateiHash, dateiname: "beispiel.pdf", mime: "application/pdf", groesse: TESTDATEI.length, gespeichertUnter: dateiSchluessel, hochgeladenVon: "system" });
    await legeDateienAn(quelleUrl, speicherQuelle);
  } finally {
    await pool.end();
  }

  const dump = join(arbeitsverzeichnis, "datenbank.dump");
  console.log("pg_dump (Custom-Format, ohne Schema pgboss) ...");
  await ausfuehren(pgDump, ["-Fc", "--exclude-schema=pgboss", "-f", dump, quelleUrl]);
  console.log(`  Dump: ${((await stat(dump)).size / 1024).toFixed(0)} KiB`);

  console.log(`pg_restore in ${zielName} ...`);
  await datenbankNeu(admin, zielName);
  await ausfuehren(pgRestore, ["--exit-on-error", "-d", urlFuer(superuserUrl, zielName), dump]);

  console.log("Dateiablage packen und entpacken (wie deploy/sicherung.sh) ...");
  const archiv = join(arbeitsverzeichnis, "speicher.tar.gz");
  await ausfuehren("tar", ["-czf", archiv, "-C", speicherQuelle, "."]);
  await mkdir(speicherZiel, { recursive: true });
  await ausfuehren("tar", ["-xzf", archiv, "-C", speicherZiel]);

  console.log("Vergleich ...");
  const [vorher, nachher] = await Promise.all([abbilden(quelleUrl), abbilden(urlFuer(testUrl, zielName))]);
  const probleme: string[] = [];
  for (const name of MUSS_GEFUELLT_SEIN) {
    if ((vorher.tabellen.get(`public.${name}`)?.zeilen ?? 0) === 0) probleme.push(`Tabelle ${name} ist in der Quelle leer, der Vergleich wäre aussagelos`);
  }
  if (vorher.tabellen.size < 20) probleme.push(`nur ${vorher.tabellen.size} Tabellen gefunden, erwartet mindestens 20`);
  if (vorher.migrationen === 0) probleme.push("Migrationsjournal der Quelle ist leer");
  for (const [name, a] of vorher.tabellen) {
    const b = nachher.tabellen.get(name);
    if (!b) probleme.push(`${name}: fehlt im Ziel`);
    else if (a.zeilen !== b.zeilen) probleme.push(`${name}: ${a.zeilen} Zeilen in der Quelle, ${b.zeilen} im Ziel`);
    else if (a.pruefsumme !== b.pruefsumme) probleme.push(`${name}: Prüfsumme weicht ab`);
  }
  for (const name of nachher.tabellen.keys()) if (!vorher.tabellen.has(name)) probleme.push(`${name}: nur im Ziel vorhanden`);
  if (vorher.schema !== nachher.schema) probleme.push("Spalten der Tabellen weichen ab");
  if (vorher.trigger !== nachher.trigger) probleme.push(`Trigger: ${vorher.trigger} in der Quelle, ${nachher.trigger} im Ziel`);
  if (vorher.migrationen !== nachher.migrationen) probleme.push(`Migrationsjournal: ${vorher.migrationen} gegen ${nachher.migrationen} Einträge`);

  // Jede wiederhergestellte Zeile mit einer Datei (alle Dateiarten) hat ihre Datei, und die Datei hat den gespeicherten SHA-256.
  const zielClient = new pg.Client({ connectionString: urlFuer(testUrl, zielName) });
  await zielClient.connect();
  try {
    const unbekannt = await findeUnbekannteDateispalten(zielClient);
    if (unbekannt.length > 0) probleme.push(`Dateispalten ohne Eintrag in scripts/ops/dateiablage.ts: ${unbekannt.join(", ")}`);
    const { geprueft, probleme: dateiProbleme } = await pruefeDateien(zielClient, speicherZiel);
    probleme.push(...dateiProbleme);
    for (const art of DATEI_ARTEN) if ((geprueft.get(art.bezeichnung) ?? 0) === 0) probleme.push(`${art.bezeichnung}: keine Datei im Test, die Prüfung wäre aussagelos`);
    console.log(`  Dateien: ${[...geprueft].map(([art, n]) => `${art} ${n}`).join(", ")}`);

    // Gegenprobe: Eine beschädigte Datei in der Dateiablage muss auffallen, sonst prüft der Vergleich nichts.
    const { rows: eine } = await zielClient.query<{ schluessel: string }>("SELECT datei_schluessel AS schluessel FROM beleg WHERE datei_schluessel IS NOT NULL LIMIT 1");
    const beschaedigt = join(speicherZiel, eine[0]!.schluessel);
    const original = await readFile(beschaedigt);
    await writeFile(beschaedigt, Buffer.concat([original, Buffer.from("x")]));
    if ((await pruefeDateien(zielClient, speicherZiel)).probleme.length === 0) probleme.push("Gegenprobe: eine veränderte Datei wurde nicht erkannt");
    await writeFile(beschaedigt, original);
  } finally {
    await zielClient.end();
  }

  const gesamt = [...vorher.tabellen.values()].reduce((s, t) => s + t.zeilen, 0);
  const wichtig = MUSS_GEFUELLT_SEIN.map((n) => `${n} ${vorher.tabellen.get(`public.${n}`)?.zeilen ?? 0}`).join(", ");
  console.log(`  ${vorher.tabellen.size} Tabellen, ${gesamt} Zeilen, ${vorher.trigger} Trigger, ${vorher.migrationen} Migrationen (${wichtig})`);
  if (probleme.length > 0) throw new Error(`Wiederherstellungstest fehlgeschlagen:\n- ${probleme.join("\n- ")}`);
  console.log("Wiederherstellungstest bestanden: Zeilenzahlen und Prüfsummen aller Tabellen und die Dateien aller Dateiarten der Dateiablage stimmen überein.");
} catch (e) {
  fehler = e;
} finally {
  await rm(arbeitsverzeichnis, { recursive: true, force: true });
  for (const name of [quelleName, zielName]) await admin.query(`DROP DATABASE IF EXISTS ${quote(name)} WITH (FORCE)`).catch(() => undefined);
  await admin.end();
}
if (fehler) {
  console.error(fehler instanceof Error ? fehler.message : fehler);
  process.exit(1);
}
