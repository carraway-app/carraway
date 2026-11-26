/**
 * Alle Dateiarten der Dateiablage und die Prüfung, ob jede Zeile ihre Datei mit dem gespeicherten SHA-256 hat.
 *
 * Gemeinsame Grundlage von `pnpm ops:sicherung-test` (Wiederherstellung in eine frische Datenbank) und `pnpm ops:dateien-pruefen`
 * (Kontrolle einer laufenden oder frisch wiederhergestellten Installation). Kommt eine neue Dateiart hinzu, muss sie hier in
 * `DATEI_ARTEN` stehen; `findeUnbekannteDateispalten` lässt den Test sonst scheitern.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type pg from "pg";

export interface DateiArt {
  tabelle: string;
  /** Spalte mit dem Schlüssel in der Dateiablage. */
  schluessel: string;
  /** Spalte mit dem SHA-256 der Datei. */
  hash: string;
  bezeichnung: string;
  /** Zusätzliche Bedingung (Zeilen, deren Datei gewollt fehlt), als SQL. */
  wo?: string;
}

export const DATEI_ARTEN: readonly DateiArt[] = [
  // Die Datei eines endgültig gelöschten Dokuments entfernt der Aufbewahrungslauf gewollt.
  { tabelle: "dokument", schluessel: "gespeichert_unter", hash: "sha256", bezeichnung: "Dokumente", wo: "status <> 'endgueltig_geloescht'" },
  { tabelle: "bericht", schluessel: "datei_schluessel", hash: "datei_sha256", bezeichnung: "Berichte" },
  { tabelle: "bericht_variante", schluessel: "datei_schluessel", hash: "datei_sha256", bezeichnung: "Berichtsfassungen je Investor" },
  { tabelle: "fonds_mitteilung", schluessel: "datei_schluessel", hash: "datei_sha256", bezeichnung: "Mitteilungen" },
  { tabelle: "beleg", schluessel: "datei_schluessel", hash: "datei_sha256", bezeichnung: "Belege" },
  { tabelle: "buchungsexport", schluessel: "datei_schluessel", hash: "datei_sha256", bezeichnung: "Buchungsexporte" },
  { tabelle: "melde_datei", schluessel: "schluessel", hash: "sha256", bezeichnung: "Meldedateien" },
];

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
export const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Spalten für Dateischlüssel in der Datenbank, die in `DATEI_ARTEN` fehlen (neue Dateiart ohne Sicherungsprüfung). */
export async function findeUnbekannteDateispalten(client: pg.Client): Promise<string[]> {
  const { rows } = await client.query<{ tabelle: string; spalte: string }>(
    `SELECT table_name AS tabelle, column_name AS spalte FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name IN ('datei_schluessel', 'gespeichert_unter') ORDER BY 1, 2`,
  );
  const bekannt = new Set(DATEI_ARTEN.map((a) => `${a.tabelle}.${a.schluessel}`));
  return rows.map((r) => `${r.tabelle}.${r.spalte}`).filter((name) => !bekannt.has(name));
}

export interface Dateipruefung {
  /** Anzahl geprüfter Dateien je Art (Bezeichnung). */
  geprueft: Map<string, number>;
  probleme: string[];
}

/** Liest jede Zeile jeder Dateiart und vergleicht die Datei im Verzeichnis `speicher` mit dem gespeicherten SHA-256. */
export async function pruefeDateien(client: pg.Client, speicher: string): Promise<Dateipruefung> {
  const geprueft = new Map<string, number>();
  const probleme: string[] = [];
  for (const art of DATEI_ARTEN) {
    const { rows } = await client.query<{ schluessel: string | null; hash: string | null }>(
      `SELECT ${quote(art.schluessel)} AS schluessel, ${quote(art.hash)} AS hash FROM ${quote(art.tabelle)} WHERE ${quote(art.schluessel)} IS NOT NULL${art.wo ? ` AND ${art.wo}` : ""}`,
    );
    geprueft.set(art.bezeichnung, rows.length);
    for (const zeile of rows) {
      const bytes = await readFile(join(speicher, zeile.schluessel!)).catch(() => null);
      if (!bytes) probleme.push(`${art.bezeichnung}: Datei ${zeile.schluessel} fehlt`);
      else if (sha256(bytes) !== zeile.hash) probleme.push(`${art.bezeichnung}: Datei ${zeile.schluessel} hat einen anderen SHA-256 als in der Datenbank`);
    }
  }
  return { geprueft, probleme };
}
