import ExcelJS from "exceljs";
import { DateiFehler, pruefeZip } from "@carraway/import";
import { Fachfehler } from "../fehler";
import type { Sprache } from "../sprache";

/**
 * Dateien des Kontaktimports (Etappe 7): Vorlage und Einlesen von CSV und Excel. Eine Tabelle für Organisationen und
 * Personen; die Spalte `typ` sagt, was die Zeile ist. Bewusst eigenes Modul, getrennt vom Import der
 * Portfoliodaten (Etappe 6); den Schutz vor Dekompressionsbomben teilen beide (`pruefeZip` aus `@carraway/import`).
 */

export const MAX_BYTES = 2_000_000;
export const MAX_ZEILEN = 1000;
/** Entpackt höchstens 50 MB (die Datei selbst höchstens 2 MB); die Prüfung ist die des Portfolio-Imports aus `@carraway/import`. */
const MAX_ENTPACKT_BYTES = 50_000_000;

export const SPALTEN = ["typ", "name", "art", "sektor", "ort", "website", "vorname", "nachname", "email", "funktion", "organisation", "rolle", "von", "bis"] as const;
export type Spalte = (typeof SPALTEN)[number];

const KOEPFE: Record<Sprache, Record<Spalte, string>> = {
  de: { typ: "typ", name: "name", art: "art", sektor: "sektor", ort: "ort", website: "website", vorname: "vorname", nachname: "nachname", email: "email", funktion: "funktion", organisation: "organisation", rolle: "rolle", von: "von", bis: "bis" },
  en: { typ: "type", name: "name", art: "kind", sektor: "sector", ort: "city", website: "website", vorname: "first_name", nachname: "last_name", email: "email", funktion: "function", organisation: "organisation", rolle: "role", von: "from", bis: "to" },
};

/** Alle Schreibweisen der Spaltenköpfe (beide Sprachen), kleingeschrieben und ohne Leerraum. */
const KOPF_ALIAS = new Map<string, Spalte>();
for (const sprache of ["de", "en"] as const) for (const [spalte, kopf] of Object.entries(KOEPFE[sprache])) KOPF_ALIAS.set(kopf, spalte as Spalte);
for (const [alias, spalte] of [["e-mail", "email"], ["organization", "organisation"], ["firstname", "vorname"], ["lastname", "nachname"], ["until", "bis"]] as const) KOPF_ALIAS.set(alias, spalte);

export type Rohzeile = Partial<Record<Spalte, string>>;

const normKopf = (kopf: string) => kopf.trim().toLowerCase().replace(/[\s-]+/g, "_").replace(/^_+|_+$/g, "");

function ungueltig(grund: string): Fachfehler {
  return new Fachfehler(400, "IMPORT_UNGUELTIG", "Die Datei lässt sich nicht einlesen.", { grund });
}

// CSV ------------------------------------------------------------------------------------------------------------

/** Zerlegt CSV nach RFC 4180 (Anführungszeichen, Trennzeichen und Zeilenumbrüche in Feldern); Trennzeichen wird aus der Kopfzeile erkannt. */
export function leseCsv(text: string): string[][] {
  const inhalt = text.replace(/^\uFEFF/, "");
  const erste = inhalt.split(/\r?\n/, 1)[0] ?? "";
  const trenner = [";", ",", "\t"].map((t) => ({ t, n: erste.split(t).length })).sort((a, b) => b.n - a.n)[0]!.t;
  const zeilen: string[][] = [];
  let zeile: string[] = [];
  let feld = "";
  let inAnfuehrung = false;
  for (let i = 0; i < inhalt.length; i++) {
    const z = inhalt[i]!;
    if (inAnfuehrung) {
      if (z === '"') {
        if (inhalt[i + 1] === '"') {
          feld += '"';
          i++;
        } else inAnfuehrung = false;
      } else feld += z;
    } else if (z === '"' && feld === "") inAnfuehrung = true;
    else if (z === trenner) {
      zeile.push(feld);
      feld = "";
    } else if (z === "\n" || z === "\r") {
      if (z === "\r" && inhalt[i + 1] === "\n") i++;
      zeile.push(feld);
      zeilen.push(zeile);
      zeile = [];
      feld = "";
    } else feld += z;
  }
  if (inAnfuehrung) throw ungueltig("anfuehrungszeichen_offen");
  if (feld !== "" || zeile.length > 0) {
    zeile.push(feld);
    zeilen.push(zeile);
  }
  return zeilen;
}

// Excel ----------------------------------------------------------------------------------------------------------

function zellText(wert: ExcelJS.CellValue): string {
  if (wert === null || wert === undefined) return "";
  if (wert instanceof Date) return wert.toISOString().slice(0, 10);
  if (typeof wert === "object") {
    if ("text" in wert && typeof wert.text === "string") return wert.text; // Link
    if ("richText" in wert) return wert.richText.map((r) => r.text).join("");
    if ("result" in wert) return zellText(wert.result as ExcelJS.CellValue); // Formel: nur das Ergebnis
    return "";
  }
  return String(wert);
}

async function leseExcel(daten: Buffer): Promise<string[][]> {
  // Vor dem Entpacken: Dekompressionsbomben abweisen (die Größe der hochgeladenen Bytes sagt nichts über den entpackten Inhalt).
  try {
    pruefeZip(daten, { maxEntpackt: MAX_ENTPACKT_BYTES, maxEintraege: 1000 });
  } catch (e) {
    throw ungueltig(e instanceof DateiFehler ? (e.code === "DATEI_ZU_GROSS" ? "zu_gross_entpackt" : "zip_ungueltig") : "excel_unlesbar");
  }
  const mappe = new ExcelJS.Workbook();
  try {
    await mappe.xlsx.load(daten as unknown as ArrayBuffer);
  } catch {
    throw ungueltig("excel_unlesbar");
  }
  const blatt = mappe.worksheets[0];
  if (!blatt) throw ungueltig("kein_blatt");
  const zeilen: string[][] = [];
  const breite = Math.min(blatt.columnCount, SPALTEN.length + 6);
  blatt.eachRow({ includeEmpty: false }, (zeile) => {
    const werte: string[] = [];
    for (let i = 1; i <= breite; i++) werte.push(zellText(zeile.getCell(i).value));
    zeilen.push(werte);
  });
  return zeilen;
}

// Einlesen -------------------------------------------------------------------------------------------------------

export interface Eingelesen {
  /** Zeilennummer in der Datei (die Kopfzeile ist Zeile 1) und die Werte je Spalte. */
  zeilen: { zeile: number; werte: Rohzeile }[];
  /** Spalten der Datei, die nicht zur Vorlage gehören (werden ignoriert). */
  unbekannteSpalten: string[];
}

/** Liest Inhalt (Base64) als CSV oder Excel ein und ordnet die Spalten über ihre Köpfe zu. Leere Zeilen entfallen. */
export async function leseDatei(format: "csv" | "xlsx", inhaltBase64: string): Promise<Eingelesen> {
  const daten = Buffer.from(inhaltBase64, "base64");
  if (daten.length === 0) throw ungueltig("leer");
  if (daten.length > MAX_BYTES) throw ungueltig("zu_gross");
  const tabelle = format === "xlsx" ? await leseExcel(daten) : leseCsv(daten.toString("utf8"));
  const kopf = tabelle[0];
  if (!kopf) throw ungueltig("leer");
  const zuordnung = kopf.map((k) => KOPF_ALIAS.get(normKopf(k)));
  const unbekannteSpalten = kopf.filter((k, i) => !zuordnung[i] && k.trim() !== "").map((k) => k.trim().slice(0, 60));
  if (!zuordnung.includes("typ")) throw ungueltig("spalte_typ_fehlt");
  const zeilen: Eingelesen["zeilen"] = [];
  tabelle.slice(1).forEach((roh, i) => {
    const werte: Rohzeile = {};
    zuordnung.forEach((spalte, j) => {
      const wert = (roh[j] ?? "").trim();
      if (spalte && wert !== "") werte[spalte] = wert;
    });
    if (Object.keys(werte).length > 0) zeilen.push({ zeile: i + 2, werte });
  });
  if (zeilen.length === 0) throw ungueltig("keine_zeilen");
  if (zeilen.length > MAX_ZEILEN) throw ungueltig("zu_viele_zeilen");
  return { zeilen, unbekannteSpalten };
}

// Vorlage --------------------------------------------------------------------------------------------------------

const BEISPIELE: Record<Spalte, string>[] = [
  { typ: "organisation", name: "Beispiel Energie GmbH", art: "unternehmen", sektor: "Energie", ort: "Hamburg", website: "https://beispiel.example", vorname: "", nachname: "", email: "", funktion: "", organisation: "", rolle: "", von: "", bis: "" },
  { typ: "person", name: "", art: "", sektor: "", ort: "", website: "", vorname: "Erika", nachname: "Beispiel", email: "erika@beispiel.example", funktion: "Geschäftsführung", organisation: "Beispiel Energie GmbH", rolle: "geschaeftsfuehrung", von: "2024-01-01", bis: "" },
];

const HINWEISE: Record<Sprache, { titel: string; zeilen: string[] }> = {
  de: {
    titel: "Hinweise",
    zeilen: [
      "Eine Zeile je Organisation oder Person. Die Spalte typ ist Pflicht: organisation oder person.",
      "Organisation: name und art sind Pflicht. art: unternehmen, investor, berater, sonstige.",
      "Person: vorname und nachname sind Pflicht. organisation nennt eine Organisation aus dieser Datei oder aus Carraway (nach Namen).",
      "rolle: gruender, geschaeftsfuehrung, co_investor, berater, investor_lp, sonstige. von und bis als JJJJ-MM-TT oder TT.MM.JJJJ.",
      "Ein zweiter Import derselben Datei legt nichts doppelt an: Organisationen gelten über den Namen ohne Rechtsform, Personen über die E-Mail-Adresse als vorhanden.",
    ],
  },
  en: {
    titel: "Notes",
    zeilen: [
      "One row per organisation or person. The column type is required: organisation or person.",
      "Organisation: name and kind are required. kind: unternehmen (company), investor, berater (advisor), sonstige (other).",
      "Person: first_name and last_name are required. organisation names an organisation from this file or from Carraway (by name).",
      "role: gruender (founder), geschaeftsfuehrung (managing director), co_investor, berater (advisor), investor_lp, sonstige (other). from and to as YYYY-MM-DD or DD.MM.YYYY.",
      "Importing the same file again creates nothing twice: organisations match by name without legal form, persons by email address.",
    ],
  },
};

const csvFeld = (w: string) => (/[;"\n\r]/.test(w) ? `"${w.replaceAll('"', '""')}"` : w);

/** Die Vorlage als CSV (Semikolon, UTF-8 mit Kennzeichen für Excel) mit Kopfzeile in der Sprache und zwei erfundenen Beispielzeilen. */
export function vorlageCsv(sprache: Sprache): string {
  const zeilen = [SPALTEN.map((s) => KOEPFE[sprache][s]), ...BEISPIELE.map((b) => SPALTEN.map((s) => b[s]))];
  return `\uFEFF${zeilen.map((z) => z.map(csvFeld).join(";")).join("\r\n")}\r\n`;
}

/** Die Vorlage als Excel mit Kopfzeile, Beispielzeilen und einem Blatt mit Hinweisen. */
export async function vorlageExcel(sprache: Sprache): Promise<Buffer> {
  const mappe = new ExcelJS.Workbook();
  const blatt = mappe.addWorksheet(sprache === "de" ? "Kontakte" : "Contacts");
  blatt.addRow(SPALTEN.map((s) => KOEPFE[sprache][s]));
  for (const b of BEISPIELE) blatt.addRow(SPALTEN.map((s) => b[s]));
  blatt.getRow(1).font = { bold: true };
  blatt.views = [{ state: "frozen", ySplit: 1 }];
  blatt.columns.forEach((spalte) => (spalte.width = 22));
  const hinweise = mappe.addWorksheet(HINWEISE[sprache].titel);
  for (const z of HINWEISE[sprache].zeilen) hinweise.addRow([z]);
  hinweise.getColumn(1).width = 120;
  return Buffer.from(await mappe.xlsx.writeBuffer());
}
