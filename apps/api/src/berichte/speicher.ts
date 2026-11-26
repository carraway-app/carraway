import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, mkdir, readFile, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { dirname, join, resolve, sep } from "node:path";

/**
 * Ablage freigegebener Berichtsdateien. Die Schnittstelle ist austauschbar (z. B. später ein Objektspeicher); die
 * Standardumsetzung schreibt in ein lokales Verzeichnis (`STORAGE_DIR`, Vorgabe `./storage`). Eine Datei wird nur einmal
 * geschrieben und danach nicht mehr verändert; der Schlüssel enthält den SHA-256 der Datei, dieselben Bytes ergeben denselben
 * Schlüssel (wiederholtes Schreiben ist ungefährlich).
 */
export interface Speicher {
  /** Schreibt die Bytes unter dem Schlüssel; eine vorhandene Datei mit gleichem Inhalt bleibt unberührt, eine abweichende ist ein Fehler. */
  schreibe(schluessel: string, daten: Uint8Array): Promise<void>;
  /** Liest die Bytes; wirft, wenn es den Schlüssel nicht gibt. */
  lese(schluessel: string): Promise<Uint8Array>;
  /** Öffnet die Datei als Strom (für große Downloads ohne die ganze Datei im Speicher); wirft, wenn es den Schlüssel nicht gibt. Fehlt die Methode, liest der Aufrufer mit `lese`. */
  strom?(schluessel: string): Promise<ReadableStream<Uint8Array>>;
  /**
   * Entfernt die Datei endgültig (nur der Aufbewahrungslauf für gelöschte Dokumente ruft das auf, nach Prüfung aller Verweise). Ein fehlender
   * Schlüssel ist kein Fehler. Fehlt die Methode, bleibt die Datei liegen und der Lauf meldet das.
   */
  loesche?(schluessel: string): Promise<void>;
}

export const sha256 = (daten: Uint8Array): string => createHash("sha256").update(daten).digest("hex");

/** Schlüssel einer Berichtsdatei: `berichte/<id>/<sha256>.<endung>`. */
export const dateiSchluessel = (berichtId: string, hash: string, endung: string): string => `berichte/${berichtId}/${hash}.${endung}`;

/** Schlüssel der Fassung eines LP-Berichts für einen Investor: `berichte/<id>/varianten/<organisation-id>/<sha256>.pdf`. */
export const variantenSchluessel = (berichtId: string, organisationId: string, hash: string): string => `berichte/${berichtId}/varianten/${organisationId}/${hash}.pdf`;

export class DateiSpeicher implements Speicher {
  private readonly wurzel: string;

  constructor(verzeichnis: string) {
    this.wurzel = resolve(verzeichnis);
  }

  private pfad(schluessel: string): string {
    if (!/^[A-Za-z0-9._/-]+$/.test(schluessel) || schluessel.includes("..")) throw new Error("Ungültiger Speicherschlüssel");
    const voll = resolve(join(this.wurzel, schluessel));
    if (!voll.startsWith(this.wurzel + sep)) throw new Error("Speicherschlüssel außerhalb des Verzeichnisses");
    return voll;
  }

  async schreibe(schluessel: string, daten: Uint8Array): Promise<void> {
    const ziel = this.pfad(schluessel);
    await mkdir(dirname(ziel), { recursive: true });
    try {
      // `wx`: nur anlegen, nie überschreiben
      await writeFile(ziel, daten, { flag: "wx", mode: 0o444 });
    } catch (fehler) {
      if ((fehler as NodeJS.ErrnoException).code !== "EEXIST") throw fehler;
      const vorhanden = await readFile(ziel);
      if (sha256(vorhanden) !== sha256(daten)) throw new Error(`Speicherschlüssel ${schluessel} ist belegt, der Inhalt weicht ab`, { cause: fehler });
      return;
    }
    await chmod(ziel, 0o444);
  }

  async lese(schluessel: string): Promise<Uint8Array> {
    const ziel = this.pfad(schluessel);
    await stat(ziel);
    return new Uint8Array(await readFile(ziel));
  }

  async loesche(schluessel: string): Promise<void> {
    const ziel = this.pfad(schluessel);
    try {
      await unlink(ziel);
    } catch (fehler) {
      if ((fehler as NodeJS.ErrnoException).code !== "ENOENT") throw fehler;
      return;
    }
    // Ein leeres Verzeichnis (`dokumente/ab/`) räumt sich auf; ein volles oder fremdes bleibt.
    await rmdir(dirname(ziel)).catch(() => undefined);
  }

  async strom(schluessel: string): Promise<ReadableStream<Uint8Array>> {
    const ziel = this.pfad(schluessel);
    await stat(ziel);
    return Readable.toWeb(createReadStream(ziel)) as ReadableStream<Uint8Array>;
  }
}

/** Standardspeicher aus der Umgebung: `STORAGE_DIR` oder `./storage`. */
export function erstelleStandardSpeicher(): Speicher {
  return new DateiSpeicher(process.env.STORAGE_DIR ?? join(process.cwd(), "storage"));
}
