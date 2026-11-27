/**
 * Hilfsmittel für die Probe von Sicherung und Wiederherstellung gegen einen laufenden Compose-Stack (Ablauf: docs/operations/README.md,
 * Abschnitt „Probe mit Docker Compose“). Der Stack muss Demo-Daten haben (`pnpm db:seed`) und darf nur erfundene Inhalte tragen.
 *
 *   tsx scripts/ops/compose-sicherung-probe.ts anlegen <Datenbankadresse> <Verzeichnis>
 *       legt je Dateiart eine erfundene Datei samt Zeile an; die Dateien liegen danach im Verzeichnis und gehören in die Dateiablage
 *       (`tar -c -C <Verzeichnis> . | docker compose exec -T carraway tar -x -C /daten/speicher`)
 *   tsx scripts/ops/compose-sicherung-probe.ts abbild <Datenbankadresse> <Datei.json>
 *       schreibt Zeilenzahl und Prüfsumme je Tabelle, Spaltenstand, Trigger und Migrationen
 *   tsx scripts/ops/compose-sicherung-probe.ts vergleichen <vorher.json> <nachher.json>
 *       Ausgang 1, wenn etwas abweicht
 *
 * `anlegen` und `abbild` schreiben bzw. lesen mit der Verbindung, die ihr übergeben wird (Administrator-Rolle des Probe-Stacks, der
 * Datenbank-Port ist dafür nur lokal veröffentlicht). Die Datei `abbild` enthält keine Inhalte, nur Zählungen und Prüfsummen.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { legeDateienAn, abbilden, type Abbild } from "./sicherungs-helfer";

const [befehl, erstes, zweites] = process.argv.slice(2);
const aufruf = "Aufruf: compose-sicherung-probe.ts anlegen <Datenbankadresse> <Verzeichnis> | abbild <Datenbankadresse> <Datei.json> | vergleichen <vorher.json> <nachher.json>";
if (!befehl || !erstes || !zweites) {
  console.error(aufruf);
  process.exit(2);
}

interface Gespeichert {
  tabellen: Record<string, { zeilen: number; pruefsumme: string }>;
  schema: string;
  trigger: number;
  migrationen: number;
}

if (befehl === "anlegen") {
  await legeDateienAn(erstes, zweites);
  // Ein Dokument mit Datei (Schlüssel wie `dokumentSchluessel` der API); die Dateien der übrigen Arten legt `legeDateienAn` an.
  const bytes = Buffer.from("%PDF-1.4\n% Beispiel fuer die Probe mit Docker Compose\n%%EOF\n", "latin1");
  const hash = createHash("sha256").update(bytes).digest("hex");
  const schluessel = `dokumente/${hash.slice(0, 2)}/${hash}`;
  await mkdir(join(zweites, "dokumente", hash.slice(0, 2)), { recursive: true });
  await writeFile(join(zweites, schluessel), bytes);
  const client = new pg.Client({ connectionString: erstes });
  await client.connect();
  try {
    await client.query(
      "INSERT INTO dokument (sha256, dateiname, mime, groesse, gespeichert_unter, hochgeladen_von) VALUES ($1, 'probe.pdf', 'application/pdf', $2, $3, 'system')",
      [hash, bytes.length, schluessel],
    );
  } finally {
    await client.end();
  }
  console.log(`Dateien aller sieben Arten angelegt unter ${zweites}`);
} else if (befehl === "abbild") {
  const a: Abbild = await abbilden(erstes);
  const aus: Gespeichert = { tabellen: Object.fromEntries(a.tabellen), schema: a.schema, trigger: a.trigger, migrationen: a.migrationen };
  await writeFile(zweites, JSON.stringify(aus, null, 2));
  const zeilen = [...a.tabellen.values()].reduce((s, t) => s + t.zeilen, 0);
  console.log(`Abbild: ${a.tabellen.size} Tabellen, ${zeilen} Zeilen, ${a.trigger} Trigger, ${a.migrationen} Migrationen`);
} else if (befehl === "vergleichen") {
  const lies = async (pfad: string) => JSON.parse(await readFile(pfad, "utf8")) as Gespeichert;
  const [v, n] = await Promise.all([lies(erstes), lies(zweites)]);
  const probleme: string[] = [];
  for (const [name, a] of Object.entries(v.tabellen)) {
    const b = n.tabellen[name];
    if (!b) probleme.push(`${name}: fehlt nachher`);
    else if (a.zeilen !== b.zeilen) probleme.push(`${name}: ${a.zeilen} Zeilen vorher, ${b.zeilen} nachher`);
    else if (a.pruefsumme !== b.pruefsumme) probleme.push(`${name}: Prüfsumme weicht ab`);
  }
  for (const name of Object.keys(n.tabellen)) if (!v.tabellen[name]) probleme.push(`${name}: nur nachher vorhanden`);
  if (v.schema !== n.schema) probleme.push("Spalten weichen ab");
  if (v.trigger !== n.trigger) probleme.push(`Trigger: ${v.trigger} vorher, ${n.trigger} nachher`);
  if (v.migrationen !== n.migrationen) probleme.push(`Migrationen: ${v.migrationen} vorher, ${n.migrationen} nachher`);
  if (probleme.length > 0) {
    console.error(`Abweichungen:\n- ${probleme.join("\n- ")}`);
    process.exit(1);
  }
  console.log(`Abbilder stimmen überein (${Object.keys(v.tabellen).length} Tabellen, Zeilenzahl und Prüfsumme je Tabelle, Spalten, Trigger, Migrationen).`);
} else {
  console.error(aufruf);
  process.exit(2);
}
