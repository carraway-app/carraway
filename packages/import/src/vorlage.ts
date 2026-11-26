import ExcelJS from "exceljs";
import { ANLEITUNG_NAMEN, BLAETTER, BLATT_NAMEN, SPALTEN, spaltenkopf, type Blatt, type Spalte, type Sprache } from "./spec";

/**
 * Importvorlage als Excel-Arbeitsmappe: ein Blatt je Objekt, Spaltenköpfe in der gewählten Sprache, Auswahllisten für
 * Aufzählungen, Prüfungen für Datum und Zahlen und ein Blatt „Anleitung“. Die erste Zeile jedes Blattes ist der Kopf, die Daten
 * beginnen in Zeile 2; dieselben Köpfe gelten für CSV-Dateien (eine Datei je Blatt).
 */

/** Zeilen, für die Auswahllisten und Prüfungen eingerichtet werden. */
const PRUEFZEILEN = 5000;

/** Spaltenbuchstabe (1 = A). */
function buchstabe(nr: number): string {
  let rest = nr;
  let aus = "";
  while (rest > 0) {
    const m = (rest - 1) % 26;
    aus = String.fromCharCode(65 + m) + aus;
    rest = Math.floor((rest - 1) / 26);
  }
  return aus;
}

const TEXTE = {
  de: {
    titel: "Importvorlage Carraway",
    ablauf: "Ablauf",
    schritte: [
      "1. Die Blätter ausfüllen, die Sie brauchen. Leere Blätter sind erlaubt; eine Datei darf auch nur ein Blatt enthalten (oder eine CSV-Datei je Blatt, Kopfzeile wie in der Vorlage).",
      "2. Hochladen: Die Datei wird gespeichert, es ändert sich noch nichts in den Daten.",
      "3. Prüfen: Carraway prüft alle Zeilen und listet Befunde mit Blatt, Zeile und Spalte. Fehler verhindern die Übernahme, Warnungen nicht.",
      "4. Übernehmen: Eine zweite Person (Freigeber) übernimmt alles in einem Zug oder gar nichts. Ein Abnahmeprotokoll hält Mengen, Summen und Befunde fest.",
    ],
    schluesselTitel: "Schlüssel",
    schluessel:
      "Jede Zeile eines Objekts trägt einen eigenen, dauerhaften Schlüssel (Spalten mit „_schluessel“, bei Fonds der Kurzname). Andere Blätter verweisen darauf. Mit denselben Schlüsseln lässt sich die Datei später wiederholen oder ergänzen: Bereits übernommene Zeilen werden wiedererkannt und nicht doppelt angelegt. Ein bereits übernommener Vorgang wird nie geändert; weicht er ab, meldet die Prüfung das, und die Korrektur ist ein Storno.",
    formateTitel: "Formate",
    formate: [
      "Beträge: Zahl mit höchstens zwei Nachkommastellen. In CSV-Dateien gilt Dezimalkomma oder Dezimalpunkt; Tausenderpunkte sind erlaubt.",
      "Datum: JJJJ-MM-TT oder TT.MM.JJJJ; in Excel ein echtes Datum.",
      "Sätze und Anteile: Anteil von 0 bis 1 (6 % = 0,06).",
      "Auswahlfelder: Werte aus der Liste der Zelle (deutsch oder englisch).",
      "CSV: UTF-8 oder Windows-1252, Trennzeichen Semikolon, Komma oder Tabulator, erste Zeile mit den Spaltenköpfen.",
    ],
    regelnTitel: "Prüfregeln",
    regeln: [
      "Pflichtfelder, Auswahlwerte, Datumswerte und Beträge (höchstens zwei Nachkommastellen).",
      "Verweise zwischen den Blättern müssen auflösbar sein; Schlüssel sind je Blatt eindeutig.",
      "Auszahlungen höchstens in Höhe der Zusage; Kapitalverlauf und Buchwert gültig.",
      "Rundenpositionen ergeben das Rundenvolumen (Post-Money minus Pre-Money).",
      "Abrufe höchstens in Höhe des Zeichnungskapitals.",
      "Mögliche Dubletten bei Organisationen (ähnliche Namen) und Perioden, die für den Fonds gesperrt sind.",
      "Kontrollsummen aus der Quelle (Blatt Kontrollsummen) gegen die Summen der Datei.",
    ],
    blattTitel: "Blätter und Spalten",
    spalte: "Spalte",
    pflicht: "Pflicht",
    ja: "ja",
    nein: "nein",
    erklaerung: "Erklärung",
    blatt: "Blatt",
    pflichtNotiz: "Pflichtfeld",
    optionalNotiz: "optional",
  },
  en: {
    titel: "Carraway import template",
    ablauf: "Procedure",
    schritte: [
      "1. Fill in the sheets you need. Empty sheets are fine; a file may contain just one sheet (or one CSV file per sheet, header row as in the template).",
      "2. Upload: the file is stored, nothing changes in the data yet.",
      "3. Check: Carraway checks every row and lists findings with sheet, row and column. Errors block the take-over, warnings do not.",
      "4. Take over: a second person (approver) takes everything over in one step or nothing. An acceptance report records counts, totals and findings.",
    ],
    schluesselTitel: "Keys",
    schluessel:
      "Every row of an object carries its own stable key (columns ending in “_key”, the short name for funds). Other sheets refer to it. With the same keys the file can be repeated or extended later: rows already taken over are recognised and not created twice. A transaction already taken over is never changed; if it differs the check reports it, and the correction is a reversal.",
    formateTitel: "Formats",
    formate: [
      "Amounts: number with at most two decimals. In CSV files a decimal comma or a decimal point is accepted; thousands separators are allowed.",
      "Date: YYYY-MM-DD or DD.MM.YYYY; in Excel a real date.",
      "Rates and shares: fraction from 0 to 1 (6 % = 0.06).",
      "Choice fields: values from the list of the cell (German or English).",
      "CSV: UTF-8 or Windows-1252, separator semicolon, comma or tab, first line with the column headers.",
    ],
    regelnTitel: "Checks",
    regeln: [
      "Required fields, choice values, dates and amounts (at most two decimals).",
      "References between sheets must resolve; keys are unique per sheet.",
      "Disbursements at most equal to the commitment; capital history and book value valid.",
      "Round positions add up to the round volume (post-money minus pre-money).",
      "Capital calls at most equal to the subscribed capital.",
      "Possible duplicates among organisations (similar names) and periods that are locked for the fund.",
      "Control totals from the source (sheet Control totals) against the totals of the file.",
    ],
    blattTitel: "Sheets and columns",
    spalte: "Column",
    pflicht: "Required",
    ja: "yes",
    nein: "no",
    erklaerung: "Explanation",
    blatt: "Sheet",
    pflichtNotiz: "required",
    optionalNotiz: "optional",
  },
} as const;

/** Wert einer Auswahl in der Sprache; zusammengesetzt für die Liste in der Zellprüfung (höchstens 255 Zeichen). */
function listenFormel(spalte: Spalte, sprache: Sprache): string | null {
  if (!spalte.auswahl) return null;
  const liste = spalte.auswahl.map((x) => x[sprache]).join(",");
  return liste.length <= 250 ? `"${liste}"` : null;
}

function kopfFormat(blatt: ExcelJS.Worksheet, spalten: readonly Spalte[], sprache: Sprache) {
  const t = TEXTE[sprache];
  spalten.forEach((spalte, i) => {
    const zelle = blatt.getCell(1, i + 1);
    zelle.value = spaltenkopf(spalte, sprache);
    zelle.font = { bold: true, color: { argb: spalte.pflicht ? "FFFFFFFF" : "FF0A0B0D" } };
    zelle.fill = { type: "pattern", pattern: "solid", fgColor: { argb: spalte.pflicht ? "FF0A0B0D" : "FFD8D5CE" } };
    zelle.alignment = { vertical: "middle" };
    zelle.note = `${spalte.pflicht ? t.pflichtNotiz : t.optionalNotiz}: ${spalte.hinweis[sprache]}`;
    blatt.getColumn(i + 1).width = Math.max(16, spaltenkopf(spalte, sprache).length + 4);
  });
  blatt.views = [{ state: "frozen", ySplit: 1 }];
}

/** Prüfungen je Spalte (Bereich ab Zeile 2): Auswahllisten, Datum, Zahlen. Formate gelten für die ganze Spalte. */
function pruefungen(blatt: ExcelJS.Worksheet, spalten: readonly Spalte[], sprache: Sprache) {
  const regeln = (blatt as unknown as { dataValidations: { model: Record<string, ExcelJS.DataValidation> } }).dataValidations.model;
  spalten.forEach((spalte, i) => {
    const bereich = `${buchstabe(i + 1)}2:${buchstabe(i + 1)}${PRUEFZEILEN}`;
    const spaltenobjekt = blatt.getColumn(i + 1);
    const meldung = { showErrorMessage: true, errorStyle: "warning" as const, errorTitle: spaltenkopf(spalte, sprache), error: spalte.hinweis[sprache] };
    const liste = listenFormel(spalte, sprache);
    if (spalte.typ === "datum") {
      spaltenobjekt.numFmt = "yyyy-mm-dd";
      regeln[bereich] = { type: "date", operator: "greaterThan", allowBlank: true, formulae: [new Date(Date.UTC(1900, 0, 1))], ...meldung };
    } else if (spalte.typ === "betrag" || spalte.typ === "betragOhneNull" || spalte.typ === "preis") {
      spaltenobjekt.numFmt = spalte.typ === "preis" ? "0.0000" : "#,##0.00";
      regeln[bereich] = { type: "decimal", operator: "greaterThanOrEqual", allowBlank: true, formulae: [0], ...meldung };
    } else if (spalte.typ === "betragVorzeichen") {
      spaltenobjekt.numFmt = "#,##0.00";
    } else if (spalte.typ === "satz") {
      spaltenobjekt.numFmt = "0.000000";
      regeln[bereich] = { type: "decimal", operator: "between", allowBlank: true, formulae: [0, 1], ...meldung };
    } else if (spalte.typ === "ganzzahl") {
      regeln[bereich] = { type: "whole", operator: "greaterThanOrEqual", allowBlank: true, formulae: [0], ...meldung };
    } else if (liste) {
      regeln[bereich] = { type: "list", allowBlank: true, formulae: [liste], ...meldung, errorStyle: "stop" };
    }
  });
}

function anleitung(wb: ExcelJS.Workbook, sprache: Sprache) {
  const t = TEXTE[sprache];
  const blatt = wb.addWorksheet(ANLEITUNG_NAMEN[sprache]);
  blatt.getColumn(1).width = 28;
  blatt.getColumn(2).width = 16;
  blatt.getColumn(3).width = 110;
  const zeile = (text: string, optionen: { fett?: boolean; umbruch?: boolean } = {}) => {
    const z = blatt.addRow([text]);
    z.getCell(1).font = { bold: optionen.fett === true };
    if (optionen.umbruch) {
      blatt.mergeCells(z.number, 1, z.number, 3);
      z.getCell(1).alignment = { wrapText: true, vertical: "top" };
      z.height = Math.max(15, Math.ceil(text.length / 120) * 15);
    }
  };
  zeile(t.titel, { fett: true });
  blatt.addRow([]);
  zeile(t.ablauf, { fett: true });
  for (const x of t.schritte) zeile(x, { umbruch: true });
  blatt.addRow([]);
  zeile(t.schluesselTitel, { fett: true });
  zeile(t.schluessel, { umbruch: true });
  blatt.addRow([]);
  zeile(t.formateTitel, { fett: true });
  for (const x of t.formate) zeile(x, { umbruch: true });
  blatt.addRow([]);
  zeile(t.regelnTitel, { fett: true });
  for (const x of t.regeln) zeile(`• ${x}`, { umbruch: true });
  blatt.addRow([]);
  zeile(t.blattTitel, { fett: true });
  for (const name of BLAETTER) {
    blatt.addRow([]);
    const kopf = blatt.addRow([`${t.blatt}: ${BLATT_NAMEN[name][sprache]}`, t.pflicht, t.erklaerung]);
    kopf.font = { bold: true };
    for (const spalte of SPALTEN[name]) {
      const werte = spalte.auswahl ? ` (${spalte.auswahl.map((x) => x[sprache]).join(", ")})` : "";
      blatt.addRow([spaltenkopf(spalte, sprache), spalte.pflicht ? t.ja : t.nein, `${spalte.hinweis[sprache]}${werte}`]);
    }
  }
}

/** Zeilen für die Blätter: je Zeile die internen Spaltenschlüssel zu kanonischen Werten (Beträge `1234.50`, Datum `JJJJ-MM-TT`, Auswahl intern). */
export type Blattzeilen = Partial<Record<Blatt, Record<string, string>[]>>;

/** Zellwert für eine Spalte: Datum und Zahlen als echte Excel-Werte, Auswahlwerte in der Beschriftung der Sprache. */
function zellwert(spalte: Spalte, wert: string, sprache: Sprache): ExcelJS.CellValue {
  switch (spalte.typ) {
    case "datum":
      return new Date(`${wert}T00:00:00Z`);
    case "betrag":
    case "betragOhneNull":
    case "betragVorzeichen":
    case "preis":
    case "satz":
    case "ganzzahl":
      return Number(wert);
    case "enum":
    case "jaNein":
      return spalte.auswahl?.find((x) => x.wert === wert)?.[sprache] ?? wert;
    default:
      return wert;
  }
}

/**
 * Arbeitsmappe der Vorlage, optional mit gefüllten Zeilen (Beispieldatei, Rundreise-Tests). Die Reihenfolge der Blätter:
 * Anleitung, dann je Objekt eines.
 */
export async function erzeugeMappe(sprache: Sprache, zeilen: Blattzeilen = {}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Carraway";
  wb.title = TEXTE[sprache].titel;
  anleitung(wb, sprache);
  for (const name of BLAETTER as readonly Blatt[]) {
    const blatt = wb.addWorksheet(BLATT_NAMEN[name][sprache]);
    kopfFormat(blatt, SPALTEN[name], sprache);
    pruefungen(blatt, SPALTEN[name], sprache);
    (zeilen[name] ?? []).forEach((werte, r) => {
      SPALTEN[name].forEach((spalte, i) => {
        const wert = werte[spalte.schluessel];
        if (wert !== undefined) blatt.getCell(r + 2, i + 1).value = zellwert(spalte, wert, sprache);
      });
    });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Die leere Importvorlage in der gewählten Sprache. */
export const erzeugeVorlage = (sprache: Sprache): Promise<Buffer> => erzeugeMappe(sprache);
