import { inflateRawSync } from "node:zlib";
import ExcelJS from "exceljs";
import { BLAETTER, SPALTEN, blattVonName, istAnleitung, pflichtSpalten, spalteVonKopf, spracheDerKoepfe, type Blatt, type Sprache } from "./spec";

/**
 * Liest eine Importdatei (Excel oder CSV) in Rohzeilen je Blatt: Köpfe (deutsch oder englisch) werden auf die internen
 * Spaltenschlüssel abgebildet, Zellwerte zu getrimmten Zeichenketten (Zahlen ohne Gleitkommarauschen, Datumswerte als
 * `JJJJ-MM-TT`). Geprüft wird hier nur die Form (Blätter, Köpfe); Inhalte prüft `typisiere`.
 */

export type Schweregrad = "fehler" | "warnung";

/** Ein Befund der Prüfung; `zeile` zählt wie in der Datei (Kopfzeile = 1). */
export interface Befund {
  /** Schlüssel des Blattes (`BLAETTER`), nie der Name aus der Datei; leer bei einem Blatt, das die Vorlage nicht kennt. */
  blatt: Blatt | null;
  /** Name des Blattes, wie er in der Datei steht (bei CSV der Dateiname). */
  blattName: string | null;
  zeile: number | null;
  spalte: string | null;
  code: string;
  schweregrad: Schweregrad;
  /** Deutsche Meldung mit eingesetzten Werten; die Oberfläche übersetzt aus `code` und `params`, ohne die Meldung zu zerlegen. */
  meldung: string;
  /** Strukturierte Werte der Meldung (Namen je Code in `apps/web/src/i18n/befunde.ts`). */
  params: BefundParams;
}

export type BefundParams = Record<string, string | number>;

/** Höchstzahl Schlüssel und Länge je Textwert in `params`: Die Werte stammen aus der hochgeladenen Datei und werden gespeichert. */
export const MAX_PARAMS = 20;
export const MAX_PARAM_LAENGE = 500;

/**
 * Begrenzt `params` vor dem Speichern: höchstens 20 Schlüssel, Texte auf 500 Zeichen gekürzt, Zahlen nur wenn endlich; alles andere
 * (verschachtelte Objekte, Listen, null) wird als Text gekürzt übernommen. Schlüssel sind höchstens 50 Zeichen lang.
 */
export function kappeParams(params: unknown): BefundParams {
  if (!params || typeof params !== "object" || Array.isArray(params)) return {};
  const aus: BefundParams = {};
  for (const [schluessel, wert] of Object.entries(params as Record<string, unknown>).slice(0, MAX_PARAMS)) {
    if (typeof wert === "number" && Number.isFinite(wert)) aus[schluessel.slice(0, 50)] = wert;
    else if (typeof wert === "string") aus[schluessel.slice(0, 50)] = wert.slice(0, MAX_PARAM_LAENGE);
    else {
      let text: string;
      try {
        text = JSON.stringify(wert) ?? String(wert);
      } catch {
        text = String(wert);
      }
      aus[schluessel.slice(0, 50)] = text.slice(0, MAX_PARAM_LAENGE);
    }
  }
  return aus;
}

export interface RohZeile {
  /** Zeilennummer in der Datei (Kopfzeile = 1, erste Datenzeile = 2). */
  zeile: number;
  /** Interne Spaltenschlüssel zu getrimmten, nicht leeren Werten. */
  werte: Record<string, string>;
}

export interface RohBlatt {
  blatt: Blatt;
  /** Name des Blattes in der Datei (bei CSV der Dateiname). */
  name: string;
  zeilen: RohZeile[];
}

export type Dateityp = "xlsx" | "csv";

export interface Gelesen {
  dateityp: Dateityp;
  sprache: Sprache | "gemischt" | null;
  blaetter: Partial<Record<Blatt, RohBlatt>>;
  befunde: Befund[];
}

/** Fehler, die die ganze Datei betreffen (nicht lesbar, falscher Typ). */
export class DateiFehler extends Error {
  constructor(
    readonly code: "DATEITYP_UNBEKANNT" | "DATEI_BESCHAEDIGT" | "DATEI_ZU_GROSS" | "DATEI_LEER" | "BLATT_NICHT_ERKANNT",
    meldung: string,
  ) {
    super(meldung);
  }
}

/** Höchstzahl Datenzeilen je Datei und höchste entpackte Größe einer Excel-Datei. */
export const MAX_ZEILEN = 200_000;
export const MAX_ENTPACKT = 100 * 1024 * 1024;
/** Höchstes Verhältnis entpackt zu gepackt je Eintrag (ab 1 MB entpackt). */
export const MAX_VERHAELTNIS = 100;
/** CSV: höchste Größe in Bytes, höchste Zahl Felder je Zeile. */
export const MAX_CSV_BYTES = 50 * 1024 * 1024;
export const MAX_FELDER = 200;

// Dateityp an den ersten Bytes (nicht am Namen) -----------------------------------------------------------------------

const MAGIC_FREMD: readonly (readonly number[])[] = [
  [0x25, 0x50, 0x44, 0x46], // %PDF
  [0x47, 0x49, 0x46, 0x38], // GIF8
  [0x89, 0x50, 0x4e, 0x47], // PNG
  [0xff, 0xd8, 0xff], // JPEG
  [0xd0, 0xcf, 0x11, 0xe0], // altes Excel (.xls), Word usw.
  [0x4d, 0x5a], // MZ (Programme)
  [0x7f, 0x45, 0x4c, 0x46], // ELF
  [0x1f, 0x8b], // gzip
  [0x52, 0x61, 0x72, 0x21], // Rar!
  [0x37, 0x7a, 0xbc, 0xaf], // 7z
];

const beginntMit = (b: Uint8Array, magic: readonly number[]) => magic.every((m, i) => b[i] === m);

/** `xlsx` (ZIP-Kennung), `csv` (Text ohne Steuerzeichen), sonst `null`. */
export function erkenneDateityp(daten: Uint8Array): Dateityp | null {
  if (daten.length === 0) return null;
  if (beginntMit(daten, [0x50, 0x4b, 0x03, 0x04])) return "xlsx";
  if (MAGIC_FREMD.some((m) => beginntMit(daten, m))) return null;
  const probe = daten.subarray(0, 8192);
  let steuer = 0;
  for (const byte of probe) {
    if (byte === 0) return null;
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) steuer++;
  }
  return steuer / probe.length > 0.01 ? null : "csv";
}

/** Summe der entpackten Größen aus dem Zentralverzeichnis der ZIP-Datei (Schutz vor Zip-Bomben); `null`, wenn es nicht lesbar ist. */
export function entpackteGroesse(daten: Uint8Array): number | null {
  const ansicht = new DataView(daten.buffer, daten.byteOffset, daten.byteLength);
  const ende = Math.max(0, daten.length - 22 - 65535);
  let eocd = -1;
  for (let i = daten.length - 22; i >= ende; i--) {
    if (ansicht.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const anzahl = ansicht.getUint16(eocd + 10, true);
  let pos = ansicht.getUint32(eocd + 16, true);
  let summe = 0;
  for (let n = 0; n < anzahl; n++) {
    if (pos + 46 > daten.length || ansicht.getUint32(pos, true) !== 0x02014b50) return null;
    summe += ansicht.getUint32(pos + 24, true);
    pos += 46 + ansicht.getUint16(pos + 28, true) + ansicht.getUint16(pos + 30, true) + ansicht.getUint16(pos + 32, true);
  }
  return summe;
}

/**
 * Schutz vor Zip-Bomben: Prüft jeden Eintrag, bevor die Datei geparst wird. Die Größenangaben im Zentralverzeichnis können
 * gefälscht sein, deshalb wird jeder Eintrag tatsächlich entpackt, mit hartem Limit für die Summe (`MAX_ENTPACKT`); zusätzlich
 * gilt ein Höchstverhältnis je Eintrag. `grenzen` verschärft die Summe und die Zahl der Einträge für kleinere Importe (Kontakte). Wirft `DateiFehler`.
 */
export function pruefeZip(daten: Uint8Array, grenzen: { maxEntpackt?: number; maxEintraege?: number } = {}): void {
  const maxEntpackt = grenzen.maxEntpackt ?? MAX_ENTPACKT;
  const maxEintraege = grenzen.maxEintraege ?? 10_000;
  const zuGross = () => new DateiFehler("DATEI_ZU_GROSS", "Die Excel-Datei ist entpackt zu groß oder ungewöhnlich stark gepackt.");
  const ansicht = new DataView(daten.buffer, daten.byteOffset, daten.byteLength);
  const ende = Math.max(0, daten.length - 22 - 65535);
  let eocd = -1;
  for (let i = daten.length - 22; i >= ende; i--) {
    if (ansicht.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new DateiFehler("DATEI_BESCHAEDIGT", "Die Excel-Datei ist beschädigt oder keine Excel-Datei.");
  const anzahl = ansicht.getUint16(eocd + 10, true);
  const verzeichnisGroesse = ansicht.getUint32(eocd + 12, true);
  const verzeichnisStart = ansicht.getUint32(eocd + 16, true);
  const kaputt = () => new DateiFehler("DATEI_BESCHAEDIGT", "Die Excel-Datei ist beschädigt oder keine Excel-Datei.");
  // ZIP64 und Mehrteil-Archive sind für Importdateien nicht vorgesehen.
  if (anzahl === 0xffff || verzeichnisGroesse === 0xffffffff || verzeichnisStart === 0xffffffff || ansicht.getUint16(eocd + 4, true) !== 0 || ansicht.getUint16(eocd + 6, true) !== 0) throw kaputt();
  if (anzahl !== ansicht.getUint16(eocd + 8, true) || verzeichnisStart + verzeichnisGroesse > eocd) throw kaputt();
  // Das Verzeichnis wird ab seinem Anfang so lange gelesen, wie die Kennung wiederkehrt; die Anzahl im Abschlusssatz zählt nicht als Beweis.
  let pos = verzeichnisStart;
  let gezaehlt = 0;
  let rest = maxEntpackt;
  const namenGesehen = new Set<string>();
  while (pos < verzeichnisStart + verzeichnisGroesse && pos + 4 <= daten.length && ansicht.getUint32(pos, true) === 0x02014b50) {
    gezaehlt++;
    if (gezaehlt > anzahl) throw kaputt();
    if (gezaehlt > maxEintraege) throw zuGross();
    if (pos + 46 > daten.length) throw kaputt();
    const nameLaenge = ansicht.getUint16(pos + 28, true);
    const name = Buffer.from(daten.subarray(pos + 46, pos + 46 + nameLaenge)).toString("latin1");
    if (namenGesehen.has(name)) throw kaputt();
    namenGesehen.add(name);
    if (ansicht.getUint32(pos + 20, true) === 0xffffffff || ansicht.getUint32(pos + 24, true) === 0xffffffff || ansicht.getUint32(pos + 42, true) === 0xffffffff) throw kaputt();
    const methode = ansicht.getUint16(pos + 10, true);
    const gepackt = ansicht.getUint32(pos + 20, true);
    const angegeben = ansicht.getUint32(pos + 24, true);
    const lokal = ansicht.getUint32(pos + 42, true);
    pos += 46 + nameLaenge + ansicht.getUint16(pos + 30, true) + ansicht.getUint16(pos + 32, true);
    if (angegeben > rest) throw zuGross();
    if (angegeben > 1024 * 1024 && angegeben / Math.max(1, gepackt) > MAX_VERHAELTNIS) throw zuGross();
    if (lokal + 30 > daten.length || ansicht.getUint32(lokal, true) !== 0x04034b50) throw new DateiFehler("DATEI_BESCHAEDIGT", "Die Excel-Datei ist beschädigt oder keine Excel-Datei.");
    const start = lokal + 30 + ansicht.getUint16(lokal + 26, true) + ansicht.getUint16(lokal + 28, true);
    const roh = daten.subarray(start, start + gepackt);
    let tatsaechlich: number;
    if (methode === 0) tatsaechlich = roh.length;
    else if (methode === 8) {
      try {
        tatsaechlich = inflateRawSync(roh, { maxOutputLength: rest + 1 }).length;
      } catch (fehler) {
        if ((fehler as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") throw zuGross();
        throw new DateiFehler("DATEI_BESCHAEDIGT", "Die Excel-Datei ist beschädigt oder keine Excel-Datei.");
      }
    } else throw new DateiFehler("DATEI_BESCHAEDIGT", "Die Excel-Datei verwendet ein nicht unterstütztes Packverfahren.");
    if (tatsaechlich > rest || tatsaechlich > angegeben) throw zuGross(); // auch eine zu kleine Größenangabe im Kopf täuscht nicht
    rest -= tatsaechlich;
  }
  if (gezaehlt !== anzahl || pos !== verzeichnisStart + verzeichnisGroesse) throw kaputt();
}

// Zellwerte -----------------------------------------------------------------------------------------------------------

function zahlText(x: number): string {
  const gerundet = Number(x.toPrecision(15));
  const text = String(gerundet);
  if (!/e/i.test(text)) return text;
  return gerundet.toFixed(10).replace(/\.?0+$/, "");
}

/** Wert einer Excel-Zelle als getrimmte Zeichenkette; leere Zellen ergeben `""`. */
export function zellText(wert: ExcelJS.CellValue): string {
  if (wert === null || wert === undefined) return "";
  if (typeof wert === "string") return wert.trim();
  if (typeof wert === "number") return zahlText(wert);
  if (typeof wert === "boolean") return wert ? "ja" : "nein";
  if (wert instanceof Date) return Number.isNaN(wert.getTime()) ? "" : wert.toISOString().slice(0, 10);
  if (typeof wert === "object") {
    if ("richText" in wert && Array.isArray(wert.richText)) return wert.richText.map((t) => t.text).join("").trim();
    if ("formula" in wert || "sharedFormula" in wert) return zellText((wert as { result?: ExcelJS.CellValue }).result ?? null);
    if ("hyperlink" in wert && "text" in wert) return zellText((wert as { text: ExcelJS.CellValue }).text);
    if ("error" in wert) return String((wert as { error: string }).error);
  }
  return "";
}

// Gemeinsame Aufbereitung: Köpfe → Spaltenschlüssel ---------------------------------------------------------------------

interface Tabelle {
  /** Name des Blattes bzw. der Datei. */
  name: string;
  blatt: Blatt;
  /** Zeile 1: Kopfzellen als Text. */
  kopf: string[];
  /** Datenzeilen als Zellentexte mit Zeilennummer in der Datei. */
  zeilen: { zeile: number; zellen: string[] }[];
}

function baueBlatt(t: Tabelle, befunde: Befund[]): RohBlatt | null {
  const schluessel: (string | null)[] = [];
  const gesehen = new Set<string>();
  t.kopf.forEach((kopf) => {
    if (kopf === "") {
      schluessel.push(null);
      return;
    }
    const spalte = spalteVonKopf(t.blatt, kopf);
    if (!spalte) {
      befunde.push({ blatt: t.blatt, blattName: t.name, zeile: 1, spalte: kopf, code: "SPALTE_UNBEKANNT", schweregrad: "warnung", meldung: `Die Spalte „${kopf}“ gehört nicht zur Vorlage und wird ignoriert.`, params: kappeParams({ spalte: kopf }) });
      schluessel.push(null);
      return;
    }
    if (gesehen.has(spalte.schluessel)) {
      befunde.push({ blatt: t.blatt, blattName: t.name, zeile: 1, spalte: kopf, code: "SPALTE_DOPPELT", schweregrad: "fehler", meldung: `Die Spalte „${spalte.schluessel}“ steht mehrfach im Kopf.`, params: kappeParams({ spalte: spalte.schluessel }) });
      schluessel.push(null);
      return;
    }
    gesehen.add(spalte.schluessel);
    schluessel.push(spalte.schluessel);
  });
  if (spracheDerKoepfe(t.kopf, t.blatt) === "gemischt") {
    befunde.push({ blatt: t.blatt, blattName: t.name, zeile: 1, spalte: null, code: "KOPF_SPRACHE_GEMISCHT", schweregrad: "warnung", meldung: "Die Spaltenköpfe mischen deutsche und englische Namen.", params: {} });
  }
  const daten = t.zeilen.filter((z) => z.zellen.some((c) => c !== ""));
  if (daten.length === 0) return null;
  for (const pflicht of pflichtSpalten(t.blatt)) {
    if (!gesehen.has(pflicht)) {
      befunde.push({ blatt: t.blatt, blattName: t.name, zeile: 1, spalte: pflicht, code: "SPALTE_FEHLT", schweregrad: "fehler", meldung: `Die Pflichtspalte „${pflicht}“ fehlt im Kopf.`, params: kappeParams({ spalte: pflicht }) });
    }
  }
  const zeilen: RohZeile[] = daten.map((z) => {
    const werte: Record<string, string> = {};
    schluessel.forEach((s, i) => {
      const wert = z.zellen[i];
      if (s !== null && wert !== undefined && wert !== "") werte[s] = wert;
    });
    return { zeile: z.zeile, werte };
  });
  return { blatt: t.blatt, name: t.name, zeilen };
}

function zusammenfassen(dateityp: Dateityp, tabellen: Tabelle[], befunde: Befund[]): Gelesen {
  const blaetter: Partial<Record<Blatt, RohBlatt>> = {};
  const sprachen = new Set<string>();
  let zeilenGesamt = 0;
  for (const t of tabellen) {
    if (blaetter[t.blatt]) {
      befunde.push({ blatt: t.blatt, blattName: t.name, zeile: null, spalte: null, code: "BLATT_DOPPELT", schweregrad: "fehler", meldung: `Das Blatt „${t.name}“ kommt mehrfach vor.`, params: kappeParams({ blatt: t.name }) });
      continue;
    }
    const s = spracheDerKoepfe(t.kopf, t.blatt);
    if (s) sprachen.add(s);
    zeilenGesamt += t.zeilen.length;
    if (zeilenGesamt > MAX_ZEILEN) throw new DateiFehler("DATEI_ZU_GROSS", `Die Datei hat mehr als ${MAX_ZEILEN} Zeilen.`);
    const blatt = baueBlatt(t, befunde);
    if (blatt) blaetter[t.blatt] = blatt;
  }
  const sprache = sprachen.size === 0 ? null : sprachen.size === 1 ? ([...sprachen][0] as Sprache | "gemischt") : "gemischt";
  return { dateityp, sprache, blaetter, befunde };
}

// Excel ---------------------------------------------------------------------------------------------------------------

async function leseExcel(daten: Uint8Array): Promise<Gelesen> {
  pruefeZip(daten);
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(Buffer.from(daten.buffer, daten.byteOffset, daten.byteLength) as unknown as ExcelJS.Buffer);
  } catch {
    throw new DateiFehler("DATEI_BESCHAEDIGT", "Die Excel-Datei ist beschädigt oder keine Excel-Datei.");
  }
  const befunde: Befund[] = [];
  const tabellen: Tabelle[] = [];
  let zeilenGesamt = 0;
  let gelesenZeilen = 0;
  for (const ws of wb.worksheets) {
    if (istAnleitung(ws.name)) continue;
    const blatt = blattVonName(ws.name);
    if (!blatt) {
      befunde.push({ blatt: null, blattName: ws.name, zeile: null, spalte: null, code: "BLATT_UNBEKANNT", schweregrad: "warnung", meldung: `Das Blatt „${ws.name}“ gehört nicht zur Vorlage und wird ignoriert.`, params: kappeParams({ blatt: ws.name }) });
      continue;
    }
    // Breite nur bis zur erwarteten Kopfbreite; Zeilen werden vor und während des Lesens gezählt.
    const breite = Math.min(ws.columnCount, SPALTEN[blatt].length);
    zeilenGesamt += ws.rowCount;
    if (zeilenGesamt > MAX_ZEILEN + tabellen.length + 1) throw new DateiFehler("DATEI_ZU_GROSS", `Die Datei hat mehr als ${MAX_ZEILEN} Zeilen.`);
    const kopf: string[] = [];
    const zeilen: Tabelle["zeilen"] = [];
    ws.eachRow({ includeEmpty: false }, (zeile, nr) => {
      if (++gelesenZeilen > MAX_ZEILEN + tabellen.length + 1) throw new DateiFehler("DATEI_ZU_GROSS", `Die Datei hat mehr als ${MAX_ZEILEN} Zeilen.`);
      const zellen: string[] = [];
      for (let c = 1; c <= breite; c++) zellen.push(zellText(zeile.getCell(c).value));
      if (nr === 1) kopf.push(...zellen);
      else zeilen.push({ zeile: nr, zellen });
    });
    tabellen.push({ name: ws.name, blatt, kopf, zeilen });
  }
  return zusammenfassen("xlsx", tabellen, befunde);
}

// CSV -----------------------------------------------------------------------------------------------------------------

/** Text der Datei: UTF-8 (mit oder ohne Kennung), sonst Windows-1252. */
export function dekodiereCsv(daten: Uint8Array): { text: string; kodierung: "utf-8" | "windows-1252" } {
  const ohneBom = daten.length >= 3 && daten[0] === 0xef && daten[1] === 0xbb && daten[2] === 0xbf ? daten.subarray(3) : daten;
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(ohneBom), kodierung: "utf-8" };
  } catch {
    return { text: new TextDecoder("windows-1252").decode(ohneBom), kodierung: "windows-1252" };
  }
}

/** Trennzeichen der ersten nicht leeren Zeile: Semikolon, Komma oder Tabulator, je nachdem, was außerhalb von Anführungszeichen am häufigsten steht. */
export function erkenneTrennzeichen(text: string): ";" | "," | "\t" {
  const erste = text.split(/\r?\n/).find((z) => z.trim() !== "") ?? "";
  const zaehler: Record<string, number> = { ";": 0, ",": 0, "\t": 0 };
  let imText = false;
  for (const z of erste) {
    if (z === '"') imText = !imText;
    else if (!imText && z in zaehler) zaehler[z]!++;
  }
  if (zaehler[";"]! >= zaehler[","]! && zaehler[";"]! >= zaehler["\t"]! && zaehler[";"]! > 0) return ";";
  if (zaehler["\t"]! > zaehler[","]!) return "\t";
  return zaehler[","]! > 0 ? "," : ";";
}

/** Zerlegt CSV nach RFC 4180: Anführungszeichen, verdoppelte Anführungszeichen, Zeilenumbrüche in Feldern. */
export function parseCsv(text: string, trenner: string, grenzen: { zeilen?: number; felder?: number } = {}): string[][] {
  const maxZeilen = grenzen.zeilen ?? MAX_ZEILEN + 1;
  const maxFelder = grenzen.felder ?? MAX_FELDER;
  const zuGross = () => new DateiFehler("DATEI_ZU_GROSS", "Die CSV-Datei hat zu viele Zeilen oder Spalten.");
  const zeilen: string[][] = [];
  let zeile: string[] = [];
  let feld = "";
  let imText = false;
  const feldEnde = () => {
    if (zeile.length >= maxFelder) throw zuGross();
    zeile.push(feld);
    feld = "";
  };
  for (let i = 0; i < text.length; i++) {
    const z = text[i]!;
    if (imText) {
      if (z === '"') {
        if (text[i + 1] === '"') {
          feld += '"';
          i++;
        } else imText = false;
      } else feld += z;
    } else if (z === '"' && feld === "") imText = true;
    else if (z === trenner) feldEnde();
    else if (z === "\n" || z === "\r") {
      if (z === "\r" && text[i + 1] === "\n") i++;
      feldEnde();
      zeilen.push(zeile);
      if (zeilen.length > maxZeilen) throw zuGross();
      zeile = [];
    } else feld += z;
  }
  if (feld !== "" || zeile.length > 0) {
    feldEnde();
    zeilen.push(zeile);
  }
  return zeilen;
}

/** Das Blatt einer CSV-Datei: nach den Köpfen (die meisten bekannten Spalten, bei Gleichstand die meisten Pflichtspalten), sonst nach dem Dateinamen. */
export function blattAusKoepfen(kopf: readonly string[], dateiname?: string): Blatt | undefined {
  const ausName = dateiname ? blattVonName(dateiname.replace(/\.[^.]+$/, "").replace(/^.*[\\/]/, "")) : undefined;
  let beste: { blatt: Blatt; treffer: number; pflicht: number } | undefined;
  for (const blatt of BLAETTER) {
    const treffer = kopf.filter((k) => k !== "" && spalteVonKopf(blatt, k)).length;
    if (treffer === 0) continue;
    const bekannt = new Set(kopf.map((k) => spalteVonKopf(blatt, k)?.schluessel).filter(Boolean));
    const pflicht = pflichtSpalten(blatt).filter((p) => bekannt.has(p)).length;
    if (!beste || treffer > beste.treffer || (treffer === beste.treffer && pflicht > beste.pflicht)) beste = { blatt, treffer, pflicht };
  }
  if (ausName && (!beste || ausName === beste.blatt || kopf.filter((k) => spalteVonKopf(ausName, k)).length >= (beste?.treffer ?? 0))) return ausName;
  return beste?.blatt;
}

function leseCsv(daten: Uint8Array, dateiname?: string): Gelesen {
  if (daten.length > MAX_CSV_BYTES) throw new DateiFehler("DATEI_ZU_GROSS", "Die CSV-Datei ist zu groß.");
  const { text } = dekodiereCsv(daten);
  const trenner = erkenneTrennzeichen(text);
  const alle = parseCsv(text, trenner);
  const kopfIndex = alle.findIndex((z) => z.some((c) => c.trim() !== ""));
  if (kopfIndex < 0) throw new DateiFehler("DATEI_LEER", "Die CSV-Datei enthält keine Zeilen.");
  const kopf = alle[kopfIndex]!.map((c) => c.trim());
  const blatt = blattAusKoepfen(kopf, dateiname);
  if (!blatt) throw new DateiFehler("BLATT_NICHT_ERKANNT", "Die Spaltenköpfe der CSV-Datei passen zu keinem Blatt der Vorlage.");
  const zeilen = alle.slice(kopfIndex + 1).map((z, i) => ({ zeile: kopfIndex + i + 2, zellen: z.map((c) => c.trim()) }));
  const name = dateiname?.replace(/^.*[\\/]/, "") ?? blatt;
  return zusammenfassen("csv", [{ name, blatt, kopf, zeilen }], []);
}

// Einstieg ------------------------------------------------------------------------------------------------------------

/**
 * Liest Excel oder CSV (erkannt an den ersten Bytes). Wirft `DateiFehler`, wenn die Datei als Ganzes nicht lesbar ist;
 * Formfehler einzelner Blätter und Spalten stehen als `befunde`.
 */
export async function leseDatei(daten: Uint8Array, optionen: { dateiname?: string } = {}): Promise<Gelesen> {
  const typ = erkenneDateityp(daten);
  if (typ === null) throw new DateiFehler("DATEITYP_UNBEKANNT", "Nur Excel-Dateien (.xlsx) und CSV-Dateien sind erlaubt.");
  return typ === "xlsx" ? leseExcel(daten) : leseCsv(daten, optionen.dateiname);
}

