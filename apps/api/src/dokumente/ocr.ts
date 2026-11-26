import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as modul from "node:module";
import { dirname, join } from "node:path";
import { getDocumentProxy, renderPageAsImage } from "unpdf";

/**
 * Lokale Texterkennung (OCR) für Scans ohne Textebene und für Bilder. Alles läuft im eigenen Prozess: `tesseract.js` (Version fest) mit den
 * Sprachdaten `deu` und `eng` aus den Paketen `@tesseract.js-data/*` (im Lockfile mit Prüfsumme festgeschrieben, Datei `4.0.0_best_int`), die über ein
 * lokales `langPath`-Verzeichnis gelesen werden. Damit gibt es weder einen Abruf zur Laufzeit noch einen Zwischenspeicher im Arbeitsverzeichnis (`cacheMethod: none`).
 * PDF-Seiten rendert `unpdf` (PDF.js) mit `@napi-rs/canvas` zu Bildern. Aus ist die Erkennung ohne `OCR=lokal`; sie läuft nur im Worker, mit
 * Seitengrenze und Zeitlimit (der Erkennungsprozess wird beim Überschreiten beendet).
 */

export const OCR_MODI = ["aus", "lokal"] as const;
export type OcrModus = (typeof OCR_MODI)[number];

export interface OcrKonfiguration {
  modus: OcrModus;
  /** Höchstzahl Seiten je PDF; mehr Seiten ergeben den Stand `fehler`. */
  maxSeiten: number;
  /** Zeitlimit je Dokument in Millisekunden. */
  zeitlimitMs: number;
  /** Vergrößerung beim Rendern (1 = 72 dpi). */
  skala: number;
  /** Höchstzahl Pixel je Seite oder Bild (Breite mal Höhe). Größere Bilder werden abgelehnt, große PDF-Seiten kleiner gerendert (nicht unter halber Vorgabeskala). */
  maxPixel: number;
}

export class OcrKonfigurationsFehler extends Error {}

type Umgebung = Record<string, string | undefined>;

function ganzzahl(env: Umgebung, name: string, vorgabe: number, min: number, max: number): number {
  const roh = env[name]?.trim();
  if (!roh) return vorgabe;
  const n = Number(roh);
  if (!Number.isInteger(n) || n < min || n > max) throw new OcrKonfigurationsFehler(`${name} muss eine ganze Zahl zwischen ${min} und ${max} sein.`);
  return n;
}

export function ladeOcrKonfiguration(env: Umgebung = process.env): OcrKonfiguration {
  const roh = (env.OCR ?? "aus").trim() || "aus";
  if (!(OCR_MODI as readonly string[]).includes(roh)) throw new OcrKonfigurationsFehler(`OCR "${roh}" ungültig (${OCR_MODI.join(", ")}).`);
  return {
    modus: roh as OcrModus,
    maxSeiten: ganzzahl(env, "OCR_MAX_SEITEN", 20, 1, 200),
    zeitlimitMs: ganzzahl(env, "OCR_ZEITLIMIT_SEKUNDEN", 180, 5, 3600) * 1000,
    skala: ganzzahl(env, "OCR_SKALA", 2, 1, 4),
    maxPixel: ganzzahl(env, "OCR_MAX_MEGAPIXEL", 40, 1, 200) * 1_000_000,
  };
}

export interface ErkannteSeite {
  seite: number;
  text: string;
  /** Mittlere Sicherheit der Erkennung der Seite, 0 bis 100. */
  konfidenz: number;
}

export class OcrFehler extends Error {
  constructor(
    readonly code: "zu_viele_seiten" | "zeitlimit" | "nicht_lesbar" | "zu_gross",
    meldung: string,
  ) {
    super(meldung);
  }
}

export interface Texterkenner {
  /** Erkennt Text eines gescannten PDF (`pdf`) oder eines Bildes (`bild`); wirft `OcrFehler`. */
  erkenne(bytes: Uint8Array, art: "pdf" | "bild", konfiguration: OcrKonfiguration): Promise<{ seitenzahl: number; seiten: ErkannteSeite[] }>;
}

const SPRACHEN = ["deu", "eng"] as const;

/** Breite und Höhe aus dem Kopf einer PNG-Datei (IHDR) oder JPEG-Datei (Rahmenmarke SOF); `null`, wenn sie sich nicht lesen lassen. Die Angabe im Kopf entscheidet über den Speicher beim Dekodieren. */
export function bildMasse(bytes: Uint8Array): { breite: number; hoehe: number } | null {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47 && b.toString("latin1", 12, 16) === "IHDR") return { breite: b.readUInt32BE(16), hoehe: b.readUInt32BE(20) };
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let pos = 2;
    while (pos + 9 < b.length) {
      if (b[pos] !== 0xff) {
        pos++;
        continue;
      }
      const marke = b[pos + 1]!;
      if (marke === 0xff) {
        pos++;
        continue;
      }
      if (marke === 0xd8 || marke === 0x01 || (marke >= 0xd0 && marke <= 0xd7)) {
        pos += 2;
        continue;
      }
      const laenge = b.readUInt16BE(pos + 2);
      if (marke >= 0xc0 && marke <= 0xcf && marke !== 0xc4 && marke !== 0xc8 && marke !== 0xcc) return { hoehe: b.readUInt16BE(pos + 5), breite: b.readUInt16BE(pos + 7) };
      pos += 2 + Math.max(2, laenge);
    }
  }
  return null;
}

/** Verzeichnis der Sprachdaten eines Pakets (ohne Netz; `OCR_DATEN_VERZEICHNIS` überschreibt für abweichende Aufstellung). */
function datenDatei(sprache: string): string {
  const eigenes = process.env.OCR_DATEN_VERZEICHNIS?.trim();
  if (eigenes) return join(eigenes, `${sprache}.traineddata.gz`);
  const anfordern = modul.createRequire(import.meta.url);
  return join(dirname(anfordern.resolve(`@tesseract.js-data/${sprache}/package.json`)), "4.0.0_best_int", `${sprache}.traineddata.gz`);
}

/** Erkenner mit `tesseract.js` (LSTM, Deutsch und Englisch). Je Dokument ein Erkennungsprozess, der am Ende immer beendet wird. */
export class TesseractErkenner implements Texterkenner {
  async erkenne(bytes: Uint8Array, art: "pdf" | "bild", konf: OcrKonfiguration) {
    const frist = Date.now() + konf.zeitlimitMs;
    const { createWorker, OEM } = await import("tesseract.js");
    // `langPath` ist ein lokales Verzeichnis (nie eine Adresse): Verknüpfungen auf die Dateien der Pakete, so dass tesseract.js nichts herunterlädt.
    const sprachVerzeichnis = await mkdtemp(join(tmpdir(), "carraway-ocr-"));
    for (const code of SPRACHEN) await symlink(datenDatei(code), join(sprachVerzeichnis, `${code}.traineddata.gz`));
    let worker: Awaited<ReturnType<typeof createWorker>>;
    try {
      worker = await createWorker([...SPRACHEN], OEM.LSTM_ONLY, { langPath: sprachVerzeichnis, cacheMethod: "none", gzip: true, logger: () => undefined, errorHandler: () => undefined });
    } catch (fehler) {
      await rm(sprachVerzeichnis, { recursive: true, force: true });
      throw fehler;
    }
    let uhr: NodeJS.Timeout | undefined;
    const ablauf = new Promise<never>((_, nein) => {
      uhr = setTimeout(() => nein(new OcrFehler("zeitlimit", "Zeitlimit der Texterkennung überschritten.")), Math.max(1, frist - Date.now()));
    });
    const arbeit = (async () => {
      const seiten: ErkannteSeite[] = [];
      const erkenneBild = async (bild: Uint8Array, seite: number) => {
        const { data } = await worker.recognize(Buffer.from(bild));
        seiten.push({ seite, text: data.text, konfidenz: Math.max(0, Math.min(100, data.confidence)) });
      };
      if (art === "bild") {
        const masse = bildMasse(bytes);
        if (!masse || masse.breite < 1 || masse.hoehe < 1) throw new OcrFehler("nicht_lesbar", "Die Bildmaße sind nicht lesbar.");
        if (masse.breite * masse.hoehe > konf.maxPixel) throw new OcrFehler("zu_gross", `Das Bild hat mehr als ${konf.maxPixel} Pixel.`);
        await erkenneBild(bytes, 1);
        return { seitenzahl: 1, seiten };
      }
      let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
      try {
        pdf = await getDocumentProxy(new Uint8Array(bytes));
      } catch {
        throw new OcrFehler("nicht_lesbar", "Das PDF ist nicht lesbar.");
      }
      if (pdf.numPages > konf.maxSeiten) throw new OcrFehler("zu_viele_seiten", `Mehr als ${konf.maxSeiten} Seiten.`);
      for (let n = 1; n <= pdf.numPages; n++) {
        if (Date.now() > frist) throw new OcrFehler("zeitlimit", "Zeitlimit der Texterkennung überschritten.");
        // Die Größe der Seite steht im PDF (MediaBox) und kann beliebig sein: erst messen, dann rendern; zu große Seiten kleiner, zu riesige gar nicht.
        const ansicht = (await pdf.getPage(n)).getViewport({ scale: 1 });
        const flaeche = ansicht.width * ansicht.height;
        if (!(flaeche > 0) || !Number.isFinite(flaeche)) throw new OcrFehler("nicht_lesbar", "Die Seitengröße ist nicht lesbar.");
        const skala = Math.min(konf.skala, Math.sqrt(konf.maxPixel / flaeche));
        if (skala < konf.skala / 2) throw new OcrFehler("zu_gross", `Die Seite ist zu groß für die Texterkennung (${Math.round(flaeche)} Punkt²).`);
        const png = await renderPageAsImage(pdf, n, { canvasImport: () => import("@napi-rs/canvas"), scale: skala });
        await erkenneBild(png, n);
      }
      return { seitenzahl: pdf.numPages, seiten };
    })();
    arbeit.catch(() => undefined);
    try {
      return await Promise.race([arbeit, ablauf]);
    } finally {
      clearTimeout(uhr);
      await worker.terminate();
      await rm(sprachVerzeichnis, { recursive: true, force: true });
    }
  }
}
