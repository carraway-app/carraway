/**
 * Migrationen nur vorwärts und geordnet.
 *
 * Drizzle wendet beim Start nur Migrationen an, deren Zeitstempel (`when` im Journal) neuer ist als der der zuletzt
 * angewendeten. Trägt eine Migration aus einem später zusammengeführten Zweig einen älteren Zeitstempel, bleibt sie
 * stillschweigend ungelaufen. Darum gibt es zwei Prüfungen:
 *
 * 1. `pruefeMigrationsdateien` (CI, `pnpm migrationen:pruefen`): Journal und Dateien sind in sich stimmig.
 * 2. `verlangeMigrationsstand` (Start von API und Worker): Die Datenbank hat genau die Migrationen, die der Code kennt.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import type { Db } from "./index";

/** Im Container liegt `drizzle/` neben dem Bündel; `MIGRATIONEN_VERZEICHNIS` überschreibt den Pfad. */
export function migrationenVerzeichnis(env: Record<string, string | undefined> = process.env): string {
  return env.MIGRATIONEN_VERZEICHNIS ?? fileURLToPath(new URL("../drizzle", import.meta.url));
}

export interface JournalEintrag {
  idx: number;
  when: number;
  tag: string;
}

/** Prüft Journal und Dateinamen; liefert eine Meldung je Verstoß (leer = in Ordnung). */
export function pruefeJournal(journal: { entries?: JournalEintrag[] } | null, dateien: readonly string[]): string[] {
  const probleme: string[] = [];
  const eintraege = journal?.entries;
  if (!eintraege || eintraege.length === 0) return ["Das Journal (meta/_journal.json) fehlt oder ist leer."];

  const sqlDateien = dateien.filter((d) => d.endsWith(".sql"));
  const snapshots = new Set(dateien.filter((d) => d.endsWith("_snapshot.json")));

  let vorher: JournalEintrag | undefined;
  eintraege.forEach((e, position) => {
    if (e.idx !== position) probleme.push(`Journal: Eintrag ${e.tag} hat idx ${e.idx}, erwartet ${position} (Lücke oder Doppelung im Journal).`);
    const nummer = /^(\d{4})_/.exec(e.tag)?.[1];
    if (nummer === undefined) probleme.push(`Journal: Der Name ${e.tag} beginnt nicht mit einer vierstelligen Nummer.`);
    else if (Number(nummer) !== position) probleme.push(`Journal: ${e.tag} steht an Stelle ${position}, die Nummer im Namen ist ${Number(nummer)}.`);
    if (!sqlDateien.includes(`${e.tag}.sql`)) probleme.push(`Journal: Die Datei ${e.tag}.sql fehlt.`);
    if (nummer !== undefined && !snapshots.has(`${nummer}_snapshot.json`)) probleme.push(`Journal: meta/${nummer}_snapshot.json fehlt (drizzle-kit generate bräuchte ihn für die nächste Migration).`);
    if (vorher && e.when <= vorher.when) {
      probleme.push(
        `Journal: ${e.tag} hat den Zeitstempel ${e.when}, ${vorher.tag} davor ${vorher.when}. Er muss streng aufsteigen, sonst überspringt drizzle die Migration auf Datenbanken, die den späteren Stand schon haben. ` +
          `Den Zeitstempel in meta/_journal.json auf einen Wert über ${vorher.when} setzen.`,
      );
    }
    vorher = e;
  });

  const bekannt = new Set(eintraege.map((e) => `${e.tag}.sql`));
  const nummern = new Map<string, string[]>();
  for (const datei of sqlDateien) {
    const nummer = /^(\d{4})_/.exec(datei)?.[1];
    if (nummer === undefined) {
      probleme.push(`Datei ${datei} beginnt nicht mit einer vierstelligen Nummer.`);
      continue;
    }
    nummern.set(nummer, [...(nummern.get(nummer) ?? []), datei]);
    if (!bekannt.has(datei)) probleme.push(`Datei ${datei} steht nicht im Journal.`);
  }
  for (const [nummer, liste] of nummern) {
    if (liste.length > 1) probleme.push(`Nummer ${nummer} kommt mehrfach vor: ${[...liste].sort().join(", ")}.`);
  }
  const hoechste = Math.max(-1, ...[...nummern.keys()].map(Number));
  for (let n = 0; n <= hoechste; n++) {
    const nummer = String(n).padStart(4, "0");
    if (!nummern.has(nummer)) probleme.push(`Nummer ${nummer} fehlt (die Nummern müssen lückenlos von 0000 an laufen).`);
  }
  return probleme;
}

/** Liest das Verzeichnis (`drizzle/`) und prüft es mit `pruefeJournal`. */
export function pruefeMigrationsdateien(verzeichnis: string): string[] {
  const journalPfad = join(verzeichnis, "meta", "_journal.json");
  if (!existsSync(journalPfad)) return [`${journalPfad} fehlt.`];
  const journal = JSON.parse(readFileSync(journalPfad, "utf8")) as { entries?: JournalEintrag[] };
  return pruefeJournal(journal, [...readdirSync(verzeichnis), ...readdirSync(join(verzeichnis, "meta"))]);
}

export interface BekannteMigration {
  tag: string;
  when: number;
  hash: string;
}

/** Die Migrationen, die der Code mitbringt, mit dem Hash, den drizzle in `__drizzle_migrations` ablegt (SHA-256 der Datei). */
export function leseBekannteMigrationen(verzeichnis: string): BekannteMigration[] {
  const journalPfad = join(verzeichnis, "meta", "_journal.json");
  if (!existsSync(journalPfad)) throw new Error(`Das Journal ${journalPfad} fehlt; Verzeichnis der Migrationen (MIGRATIONEN_VERZEICHNIS) prüfen.`);
  const journal = JSON.parse(readFileSync(journalPfad, "utf8")) as { entries: JournalEintrag[] };
  return journal.entries.map((e) => ({
    tag: e.tag,
    when: e.when,
    hash: createHash("sha256").update(readFileSync(join(verzeichnis, `${e.tag}.sql`), "utf8")).digest("hex"),
  }));
}

export interface AngewendeteMigration {
  hash: string;
  createdAt: number;
}

export interface Migrationsabgleich {
  /** In der Datenbank, aber dem Code unbekannt: Der Code ist älter als die Datenbank (Rückschritt) oder gehört zu einem anderen Zweig. */
  unbekannt: AngewendeteMigration[];
  /** Im Code, aber nicht in der Datenbank: Die Migration ist noch nicht gelaufen oder wurde übersprungen. */
  fehlend: BekannteMigration[];
}

export function vergleicheMigrationen(bekannt: readonly BekannteMigration[], angewendet: readonly AngewendeteMigration[]): Migrationsabgleich {
  const bekannteHashes = new Set(bekannt.map((m) => m.hash));
  const angewendeteHashes = new Set(angewendet.map((m) => m.hash));
  return {
    unbekannt: angewendet.filter((m) => !bekannteHashes.has(m.hash)),
    fehlend: bekannt.filter((m) => !angewendeteHashes.has(m.hash)),
  };
}

export class MigrationsstandFehler extends Error {
  override name = "MigrationsstandFehler";
}

/** Meldung für das Protokoll; `null`, wenn der Stand stimmt. */
export function beschreibeAbgleich(abgleich: Migrationsabgleich): string | null {
  const teile: string[] = [];
  if (abgleich.fehlend.length > 0) {
    teile.push(`Der Datenbank fehlen Migrationen, die der Code kennt: ${abgleich.fehlend.map((m) => m.tag).join(", ")}. Zuerst die Migration ausführen (node dist/migrate.js bzw. pnpm db:migrate).`);
  }
  if (abgleich.unbekannt.length > 0) {
    teile.push(
      `Die Datenbank enthält ${abgleich.unbekannt.length} Migration(en), die der Code nicht kennt (Hash ${abgleich.unbekannt.map((m) => m.hash.slice(0, 12)).join(", ")}). ` +
        `Der Code ist älter als die Datenbank; Rückschritte gibt es nur über die Wiederherstellung einer Sicherung (docs/operations/).`,
    );
  }
  return teile.length === 0 ? null : teile.join(" ");
}

/** Liest die angewendeten Migrationen. `null`, wenn die Tabelle fehlt (Datenbank noch nie migriert). */
export async function leseAngewendeteMigrationen(db: Db): Promise<AngewendeteMigration[] | null> {
  const { rows: da } = await db.execute<{ ja: boolean }>(sql`SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS ja`);
  if (!da[0]?.ja) return null;
  const { rows } = await db.execute<{ hash: string; created_at: string }>(sql`SELECT hash, created_at FROM drizzle.__drizzle_migrations`);
  return rows.map((r) => ({ hash: r.hash, createdAt: Number(r.created_at) }));
}

/** Zustand der Migrationen für die Gesundheitsseite; wirft nie. */
export interface Migrationszustand {
  ok: boolean;
  /** Meldung bei `ok: false`, sonst `null`. */
  meldung: string | null;
  bekannt: number;
  angewendet: number | null;
}

export async function pruefeMigrationszustand(db: Db, verzeichnis: string = migrationenVerzeichnis()): Promise<Migrationszustand> {
  try {
    const bekannt = leseBekannteMigrationen(verzeichnis);
    const angewendet = await leseAngewendeteMigrationen(db);
    if (angewendet === null) return { ok: false, meldung: "Die Datenbank ist nicht migriert.", bekannt: bekannt.length, angewendet: null };
    const meldung = beschreibeAbgleich(vergleicheMigrationen(bekannt, angewendet));
    return { ok: meldung === null, meldung, bekannt: bekannt.length, angewendet: angewendet.length };
  } catch (fehler) {
    const code = (fehler as { code?: string }).code;
    const meldung = code === "42501" ? "Die Migrationstabelle ist für die App-Rolle nicht lesbar (Migration ausführen)." : "Der Migrationsstand ließ sich nicht lesen.";
    return { ok: false, meldung, bekannt: 0, angewendet: null };
  }
}

/**
 * Start von API und Worker: bricht mit `MigrationsstandFehler` ab, wenn die Datenbank Migrationen hat, die der Code nicht kennt,
 * oder Migrationen fehlen, die er kennt.
 */
export async function verlangeMigrationsstand(db: Db, verzeichnis: string = migrationenVerzeichnis()): Promise<void> {
  const bekannt = leseBekannteMigrationen(verzeichnis);
  let angewendet: AngewendeteMigration[] | null;
  try {
    angewendet = await leseAngewendeteMigrationen(db);
  } catch (fehler) {
    const code = (fehler as { code?: string }).code;
    if (code === "42501") {
      throw new MigrationsstandFehler("Die Migrationstabelle ist für diese Datenbankrolle nicht lesbar. Zuerst die Migration ausführen (sie vergibt das Leserecht).");
    }
    throw fehler;
  }
  if (angewendet === null) throw new MigrationsstandFehler("Die Datenbank ist nicht migriert (Tabelle drizzle.__drizzle_migrations fehlt). Zuerst die Migration ausführen.");
  const meldung = beschreibeAbgleich(vergleicheMigrationen(bekannt, angewendet));
  if (meldung) throw new MigrationsstandFehler(meldung);
}
