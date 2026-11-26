import { DateiFehler, pruefeZip } from "@carraway/import";
import { Fachfehler } from "../fehler";

/**
 * Dateityp eines hochgeladenen Dokuments. Maßgeblich sind allein die ersten Bytes (nie der Dateiname oder der Inhaltstyp der
 * Anfrage); erlaubt sind PDF, PNG, JPEG, DOCX und XLSX. Office-Dateien sind ZIP-Archive: Sie laufen durch dieselbe Schutzprüfung wie
 * der Excel-Import (`pruefeZip`, jeder Eintrag wird mit harter Grenze entpackt) und müssen die Kennzeichen ihres Formats tragen;
 * Archive mit Makros (`vbaProject.bin`) werden abgelehnt. Verschlüsselte PDF-Dateien gibt es hier nicht.
 */

/** Größtes hochladbares Dokument (Bytes). */
export const MAX_DOKUMENT = 25 * 1024 * 1024;
/** Obergrenze der entpackten Größe eines Office-Dokuments und der Zahl seiner Einträge. */
const MAX_ENTPACKT_OFFICE = 100 * 1024 * 1024;
const MAX_EINTRAEGE_OFFICE = 2000;

export type DokumentArt = "pdf" | "png" | "jpeg" | "docx" | "xlsx";

export interface ErkanntesDokument {
  art: DokumentArt;
  mime: string;
}

const MIME: Record<DokumentArt, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpeg: "image/jpeg",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/** Typen, die der Browser (in einem Rahmen mit Sandbox) selbst darstellen darf; alles andere nur als Download. */
export const INLINE_ERLAUBT: ReadonlySet<string> = new Set([MIME.pdf, MIME.png, MIME.jpeg]);

const beginntMit = (b: Uint8Array, magic: readonly number[], ab = 0) => magic.every((m, i) => b[ab + i] === m);

/** Namen der Einträge im Zentralverzeichnis eines ZIP (nach bestandener `pruefeZip`); leer, wenn es nicht lesbar ist. */
export function zipNamen(daten: Uint8Array): string[] {
  const puffer = Buffer.from(daten.buffer, daten.byteOffset, daten.byteLength);
  const eocd = puffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0 || eocd + 22 > puffer.length) return [];
  const anzahl = puffer.readUInt16LE(eocd + 10);
  let pos = puffer.readUInt32LE(eocd + 16);
  const namen: string[] = [];
  for (let i = 0; i < anzahl; i++) {
    if (pos + 46 > puffer.length || puffer.readUInt32LE(pos) !== 0x02014b50) return [];
    const nameLaenge = puffer.readUInt16LE(pos + 28);
    namen.push(puffer.subarray(pos + 46, pos + 46 + nameLaenge).toString("utf8"));
    pos += 46 + nameLaenge + puffer.readUInt16LE(pos + 30) + puffer.readUInt16LE(pos + 32);
  }
  return namen;
}

const unzulaessig = () => new Fachfehler(415, "DOKUMENTTYP_UNZULAESSIG", "Erlaubt sind PDF, PNG, JPEG, Word (.docx) und Excel (.xlsx); der Dateityp wird am Inhalt erkannt, nicht am Namen.");
const unsicher = (grund: string) => new Fachfehler(422, "DOKUMENT_UNSICHER", `Die Datei wird nicht angenommen: ${grund}.`);

/** Erkennt den Typ und prüft die Datei; wirft `Fachfehler` (415, 422), wenn sie nicht angenommen wird. */
export function pruefeDokument(daten: Uint8Array): ErkanntesDokument {
  if (daten.length === 0) throw new Fachfehler(422, "DATEI_LEER", "Die Datei ist leer.");
  if (beginntMit(daten, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    if (istVerschluesselt(daten)) throw new Fachfehler(422, "PDF_VERSCHLUESSELT", "Verschlüsselte oder passwortgeschützte PDF-Dateien werden nicht angenommen. Bitte ohne Passwort speichern und erneut hochladen.");
    return { art: "pdf", mime: MIME.pdf };
  }
  if (beginntMit(daten, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { art: "png", mime: MIME.png };
  if (beginntMit(daten, [0xff, 0xd8, 0xff])) return { art: "jpeg", mime: MIME.jpeg };
  if (beginntMit(daten, [0x50, 0x4b, 0x03, 0x04])) {
    try {
      pruefeZip(daten, { maxEntpackt: MAX_ENTPACKT_OFFICE, maxEintraege: MAX_EINTRAEGE_OFFICE });
    } catch (fehler) {
      if (fehler instanceof DateiFehler) {
        throw unsicher(fehler.code === "DATEI_ZU_GROSS" ? "sie ist entpackt zu groß oder ungewöhnlich stark gepackt" : "das Archiv ist beschädigt");
      }
      throw fehler;
    }
    const namen = new Set(zipNamen(daten));
    if (!namen.has("[Content_Types].xml")) throw unzulaessig();
    if ([...namen].some((n) => /(^|\/)vbaProject\.bin$/i.test(n) || /(^|\/)macrosheets\//i.test(n))) throw unsicher("Dateien mit Makros sind nicht erlaubt");
    if (namen.has("word/document.xml")) return { art: "docx", mime: MIME.docx };
    if (namen.has("xl/workbook.xml")) return { art: "xlsx", mime: MIME.xlsx };
    throw unzulaessig();
  }
  throw unzulaessig();
}

/**
 * Ein PDF ist verschlüsselt, wenn sein Trailer oder sein Querverweisstrom auf ein Verschlüsselungsverzeichnis zeigt
 * (`/Encrypt n g R`). Gesucht wird im ganzen Dokument, weil inkrementelle Änderungen weitere Trailer anhängen.
 */
export function istVerschluesselt(daten: Uint8Array): boolean {
  return /\/Encrypt\s+\d+\s+\d+\s+R/.test(Buffer.from(daten.buffer, daten.byteOffset, daten.byteLength).toString("latin1"));
}

/** Dateiname für Speicherung und Anzeige: ohne Pfad, ohne Steuer- und Richtungszeichen, höchstens 200 Zeichen. */
export function bereinigeDateiname(roh: string, art: DokumentArt): string {
  const ohnePfad = roh.replace(/^.*[\\/]/, "");
  const sauber = ohnePfad
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, "")
    .replace(/[<>:"|?*]/g, "_")
    .trim()
    .slice(0, 200);
  return sauber || `dokument.${art === "jpeg" ? "jpg" : art}`;
}

/** Name für den Kopf `Content-Disposition`: nur ASCII, ohne Anführungszeichen und Backslash (`filename`), dazu der volle Name nach RFC 5987 (`filename*`). */
export function dispositionKopf(art: "attachment" | "inline", dateiname: string): string {
  const ascii = dateiname.normalize("NFKD").replace(/[^\x20-\x7e]/g, "_").replace(/["\\;%]/g, "_");
  const utf8 = encodeURIComponent(dateiname).replace(/['()*]/g, (z) => `%${z.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${art}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}
