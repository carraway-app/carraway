import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { erstelleDb } from "../index";
import {
  beschreibeAbgleich,
  leseBekannteMigrationen,
  migrationenVerzeichnis,
  pruefeJournal,
  pruefeMigrationsdateien,
  pruefeMigrationszustand,
  verlangeMigrationsstand,
  vergleicheMigrationen,
  MigrationsstandFehler,
} from "../migrationen";
import { TESTDB_URL } from "./hilfen";

const eintrag = (idx: number, when: number, tag = `${String(idx).padStart(4, "0")}_x`) => ({ idx, when, tag });
const dateien = (n: number) => Array.from({ length: n }, (_, i) => [`${String(i).padStart(4, "0")}_x.sql`, `${String(i).padStart(4, "0")}_snapshot.json`]).flat();

describe("Journal und Dateien (CI-Prüfung)", () => {
  it("nimmt das echte Verzeichnis an", () => {
    expect(pruefeMigrationsdateien(migrationenVerzeichnis())).toEqual([]);
  });

  it("nimmt ein geordnetes Journal an", () => {
    expect(pruefeJournal({ entries: [eintrag(0, 10), eintrag(1, 20)] }, dateien(2))).toEqual([]);
  });

  it("lehnt einen gleichen oder älteren Zeitstempel ab, weil drizzle die Migration überspringen würde", () => {
    const gleich = pruefeJournal({ entries: [eintrag(0, 10), eintrag(1, 10)] }, dateien(2));
    expect(gleich.join("\n")).toMatch(/0001_x hat den Zeitstempel 10, 0000_x davor 10/);
    const aelter = pruefeJournal({ entries: [eintrag(0, 20), eintrag(1, 10)] }, dateien(2));
    expect(aelter.join("\n")).toMatch(/streng aufsteigen/);
  });

  it("lehnt eine Lücke in den Nummern ab", () => {
    const probleme = pruefeJournal({ entries: [eintrag(0, 10), eintrag(1, 20)] }, [...dateien(2), "0003_y.sql"]);
    expect(probleme.join("\n")).toMatch(/Nummer 0002 fehlt/);
    expect(probleme.join("\n")).toMatch(/0003_y.sql steht nicht im Journal/);
  });

  it("lehnt doppelte Nummern ab", () => {
    const probleme = pruefeJournal({ entries: [eintrag(0, 10), eintrag(1, 20)] }, [...dateien(2), "0001_anders.sql"]);
    expect(probleme.join("\n")).toMatch(/Nummer 0001 kommt mehrfach vor: 0001_anders.sql, 0001_x.sql/);
  });

  it("lehnt falsche Nummer im Namen, fehlende Datei und fehlenden Snapshot ab", () => {
    const probleme = pruefeJournal({ entries: [eintrag(0, 10), eintrag(1, 20, "0005_falsch")] }, dateien(1));
    const text = probleme.join("\n");
    expect(text).toMatch(/0005_falsch steht an Stelle 1/);
    expect(text).toMatch(/0005_falsch.sql fehlt/);
    expect(text).toMatch(/0005_snapshot.json fehlt/);
  });

  it("lehnt ein leeres Journal ab", () => {
    expect(pruefeJournal({ entries: [] }, [])).toHaveLength(1);
    expect(pruefeJournal(null, [])).toHaveLength(1);
  });
});

describe("Abgleich mit der Datenbank", () => {
  const bekannt = [
    { tag: "0000_a", when: 1, hash: "h0" },
    { tag: "0001_b", when: 2, hash: "h1" },
  ];

  it("erkennt fehlende und unbekannte Migrationen", () => {
    expect(vergleicheMigrationen(bekannt, [{ hash: "h0", createdAt: 1 }, { hash: "h1", createdAt: 2 }])).toEqual({ unbekannt: [], fehlend: [] });
    const fehlend = vergleicheMigrationen(bekannt, [{ hash: "h1", createdAt: 2 }]);
    expect(fehlend.fehlend.map((m) => m.tag)).toEqual(["0000_a"]);
    const unbekannt = vergleicheMigrationen(bekannt, [{ hash: "h0", createdAt: 1 }, { hash: "h1", createdAt: 2 }, { hash: "fremd0123456789", createdAt: 3 }]);
    expect(unbekannt.unbekannt).toHaveLength(1);
    expect(beschreibeAbgleich(unbekannt)).toMatch(/die der Code nicht kennt/);
    expect(beschreibeAbgleich(fehlend)).toMatch(/fehlen Migrationen.*0000_a/);
    expect(beschreibeAbgleich({ unbekannt: [], fehlend: [] })).toBeNull();
  });
});

describe("Start von API und Worker gegen die Test-Datenbank", () => {
  const { db, pool } = erstelleDb(TESTDB_URL);
  const arbeit = mkdtempSync(join(tmpdir(), "carraway-migrationen-"));
  afterAll(async () => {
    await pool.end();
    rmSync(arbeit, { recursive: true, force: true });
  });

  /** Kopie des echten Verzeichnisses, damit ein Test es verändern kann. */
  const kopie = (name: string) => {
    const ziel = join(arbeit, name);
    cpSync(migrationenVerzeichnis(), ziel, { recursive: true });
    return ziel;
  };

  it("läuft durch, wenn der Stand stimmt", async () => {
    await expect(verlangeMigrationsstand(db)).resolves.toBeUndefined();
    const zustand = await pruefeMigrationszustand(db);
    expect(zustand).toMatchObject({ ok: true, meldung: null });
    expect(zustand.angewendet).toBe(zustand.bekannt);
  });

  it("bricht ab, wenn der Code eine Migration kennt, die die Datenbank nicht hat", async () => {
    const verzeichnis = kopie("neuer");
    const journalPfad = join(verzeichnis, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalPfad, "utf8")) as { entries: { idx: number; version: string; when: number; tag: string; breakpoints: boolean }[] };
    const letzter = journal.entries.at(-1)!;
    journal.entries.push({ ...letzter, idx: letzter.idx + 1, when: letzter.when + 1000, tag: `${String(letzter.idx + 1).padStart(4, "0")}_neu` });
    writeFileSync(journalPfad, JSON.stringify(journal));
    writeFileSync(join(verzeichnis, `${String(letzter.idx + 1).padStart(4, "0")}_neu.sql`), "SELECT 1;");
    await expect(verlangeMigrationsstand(db, verzeichnis)).rejects.toThrow(/fehlen Migrationen.*_neu/);
    await expect(verlangeMigrationsstand(db, verzeichnis)).rejects.toBeInstanceOf(MigrationsstandFehler);
    expect(await pruefeMigrationszustand(db, verzeichnis)).toMatchObject({ ok: false });
  });

  it("bricht ab, wenn die Datenbank eine Migration hat, die der Code nicht kennt (Rückschritt)", async () => {
    const verzeichnis = kopie("aelter");
    const journalPfad = join(verzeichnis, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalPfad, "utf8")) as { entries: unknown[] };
    journal.entries.pop();
    writeFileSync(journalPfad, JSON.stringify(journal));
    await expect(verlangeMigrationsstand(db, verzeichnis)).rejects.toThrow(/die der Code nicht kennt/);
  });

  it("meldet ein fehlendes Journal verständlich", () => {
    expect(() => leseBekannteMigrationen(join(arbeit, "gibt-es-nicht"))).toThrow(/Journal .* fehlt/);
  });
});
