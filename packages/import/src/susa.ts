import ExcelJS from "exceljs";
import { Decimal } from "@carraway/rechenkern";
import { DateiFehler, MAX_ZEILEN, dekodiereCsv, erkenneDateityp, erkenneTrennzeichen, kappeParams, parseCsv, pruefeZip, zellText, type Befund } from "./lesen";

/**
 * Leser für Summen- und Saldenlisten (SuSa), getrennt vom Importleser der Portfoliodaten. Er nutzt dieselben gehärteten Bausteine
 * (Dateityp an den ersten Bytes, ZIP-Prüfung, Windows-1252, Zeilen- und Feldgrenzen) und kennt zwei Formate:
 *
 * - `datev`: Spalten wie im Export der Summen- und Saldenliste (Konto, Beschriftung, EB-Wert mit S/H, Soll, Haben, Saldo mit S/H).
 *   Das Profil ist aus der öffentlich beschriebenen Struktur abgeleitet und noch nicht an einer echten Datei geprüft.
 * - `generisch`: Konto, Bezeichnung, EB-Wert, Soll, Haben, Saldo; Saldo mit Vorzeichen (Soll positiv).
 *
 * Beträge: Dezimalkomma (auch Punkt, wenn eindeutig), Tausenderpunkt, nachgestelltes Minus, Zusatz S oder H.
 * Ergebnis ist je Konto der Endsaldo mit Vorzeichen (Soll positiv, Haben negativ), Entscheidung 244.
 */

export type SusaFormat = "datev" | "generisch";

export interface SusaZeile {
  /** Zeilennummer in der Datei (Kopfzeile = 1). */
  zeile: number;
  konto: string;
  bezeichnung: string | null;
  eb: string | null;
  soll: string | null;
  haben: string | null;
  /** Endsaldo, Soll positiv, auf zwei Nachkommastellen. */
  saldo: string;
}

export interface SusaGelesen {
  format: SusaFormat;
  dateityp: "xlsx" | "csv";
  zeilen: SusaZeile[];
  befunde: Befund[];
}

const normal = (t: string) =>
  t
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9/]+/g, " ")
    .trim();

type Feld = "konto" | "bezeichnung" | "eb" | "ebsh" | "soll" | "haben" | "saldo" | "saldosh";

const ALIASE: Record<Feld, string[]> = {
  konto: ["konto", "kontonummer", "konto nr", "account", "account number"],
  bezeichnung: ["bezeichnung", "beschriftung", "kontobeschriftung", "kontobezeichnung", "name", "description", "account name"],
  eb: ["eb wert", "eb", "eroeffnung", "eroeffnungsbilanzwert", "opening", "opening balance"],
  ebsh: ["eb wert s/h", "eb s/h", "eb sh"],
  soll: ["soll", "kum soll", "kumuliert soll", "soll verkehrszahlen", "soll kumuliert", "debit"],
  haben: ["haben", "kum haben", "kumuliert haben", "haben verkehrszahlen", "haben kumuliert", "credit"],
  saldo: ["saldo", "endsaldo", "balance", "closing balance"],
  saldosh: ["saldo s/h", "s/h", "saldo sh", "balance s/h"],
};

function feldVon(kopf: string): Feld | null {
  const n = normal(kopf);
  for (const [feld, liste] of Object.entries(ALIASE) as [Feld, string[]][]) if (liste.includes(n)) return feld;
  return null;
}

/** Betrag als Dezimalzeichenkette mit Vorzeichen; `S`/`H` als Zusatz (H = negativ). `null`, wenn es kein Betrag ist. */
export function parseSusaBetrag(roh: string, punktIstDezimal = false): string | null {
  let t = roh.replace(/[\s'’€]|EUR/gi, "");
  if (t === "") return null;
  let vorzeichen = 1;
  const sh = /([SH])$/i.exec(t);
  if (sh) {
    if (sh[1]!.toUpperCase() === "H") vorzeichen = -1;
    t = t.slice(0, -1);
  }
  if (t.endsWith("-")) {
    vorzeichen *= -1;
    t = t.slice(0, -1);
  } else if (t.startsWith("-")) {
    vorzeichen *= -1;
    t = t.slice(1);
  } else if (t.startsWith("+")) t = t.slice(1);
  if (t.includes(",")) {
    if ((t.match(/,/g) ?? []).length > 1) return null;
    t = t.replace(/\./g, "").replace(",", ".");
  } else if (t.includes(".")) {
    const gruppen = /^\d{1,3}(\.\d{3})+$/.test(t);
    if (gruppen && !punktIstDezimal) t = t.replace(/\./g, "");
    else if ((t.match(/\./g) ?? []).length > 1) return null;
  }
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  if (t.replace(".", "").length > 17) return null;
  return new Decimal(t).times(vorzeichen).toFixed(2);
}

const MAX_BEZEICHNUNG = 200;

function auswerten(kopf: string[], zeilen: { zeile: number; zellen: string[] }[], dateityp: "xlsx" | "csv"): SusaGelesen {
  const befunde: Befund[] = [];
  const melde = (zeile: number | null, spalte: string | null, code: string, schweregrad: "fehler" | "warnung", meldung: string, params: Record<string, string | number> = {}) =>
    befunde.push({ blatt: null, blattName: null, zeile, spalte, code, schweregrad, meldung, params: kappeParams(params) });
  const index = new Map<Feld, number>();
  kopf.forEach((k, i) => {
    const f = feldVon(k);
    if (f && !index.has(f)) index.set(f, i);
  });
  const format: SusaFormat = index.has("saldosh") || index.has("ebsh") || kopf.some((k) => normal(k) === "beschriftung" || normal(k) === "kontobeschriftung") ? "datev" : "generisch";
  const hatSaldo = index.has("saldo") || (index.has("soll") && index.has("haben"));
  if (!index.has("konto") || !hatSaldo) {
    if (!index.has("konto")) melde(1, "konto", "SUSA_SPALTE_FEHLT", "fehler", "Die Spalte „Konto“ fehlt im Kopf.", { spalte: "Konto" });
    if (!hatSaldo) melde(1, "saldo", "SUSA_SPALTE_FEHLT", "fehler", "Es fehlt die Spalte „Saldo“ (oder „Soll“ und „Haben“).", { spalte: "Saldo" });
    return { format, dateityp, zeilen: [], befunde };
  }
  const punkt = dateityp === "xlsx";
  const wert = (z: string[], f: Feld) => {
    const i = index.get(f);
    return i === undefined ? "" : (z[i] ?? "").trim();
  };
  const aus: SusaZeile[] = [];
  const gesehen = new Set<string>();
  for (const { zeile, zellen } of zeilen) {
    if (zellen.every((c) => c === "")) continue;
    const konto = wert(zellen, "konto");
    if (!/^[0-9]{1,9}$/.test(konto)) {
      melde(zeile, "konto", "SUSA_KONTO_UNGUELTIG", "fehler", `Die Kontonummer „${konto}“ ist ungültig (1 bis 9 Ziffern).`, { wert: konto });
      continue;
    }
    if (gesehen.has(konto)) {
      melde(zeile, "konto", "SUSA_KONTO_DOPPELT", "fehler", `Das Konto ${konto} steht mehrfach in der Liste.`, { konto });
      continue;
    }
    gesehen.add(konto);
    let ok = true;
    const betrag = (f: Feld, sh?: Feld): string | null => {
      const roh = wert(zellen, f);
      if (roh === "") return null;
      const mitSh = sh ? wert(zellen, sh).toUpperCase() : "";
      const b = parseSusaBetrag(mitSh === "S" || mitSh === "H" ? `${roh}${mitSh}` : roh, punkt);
      if (b === null) {
        ok = false;
        melde(zeile, f, "SUSA_BETRAG_UNGUELTIG", "fehler", `Der Betrag „${roh}“ in Spalte ${f} ist ungültig.`, { wert: roh, spalte: f });
      }
      return b;
    };
    const eb = betrag("eb", "ebsh");
    const sollRoh = betrag("soll");
    const habenRoh = betrag("haben");
    const gegeben = betrag("saldo", "saldosh");
    if (!ok) continue;
    // Verkehrszahlen sind Beträge ohne Vorzeichen: `soll` und `haben` zählen als Größen.
    const soll = sollRoh === null ? null : new Decimal(sollRoh).abs().toFixed(2);
    const haben = habenRoh === null ? null : new Decimal(habenRoh).abs().toFixed(2);
    let saldo: string;
    const berechnet = new Decimal(eb ?? 0).plus(soll ?? 0).minus(haben ?? 0);
    if (gegeben !== null) {
      saldo = gegeben;
      if ((soll !== null || haben !== null || eb !== null) && !berechnet.equals(gegeben)) {
        melde(zeile, "saldo", "SUSA_SALDO_ABWEICHEND", "fehler", `Der Saldo ${gegeben} des Kontos ${konto} stimmt nicht mit EB-Wert plus Soll minus Haben (${berechnet.toFixed(2)}) überein.`, { konto, saldo: gegeben, berechnet: berechnet.toFixed(2) });
        continue;
      }
    } else saldo = berechnet.toFixed(2);
    const bez = wert(zellen, "bezeichnung");
    aus.push({ zeile, konto, bezeichnung: bez === "" ? null : bez.slice(0, MAX_BEZEICHNUNG), eb, soll, haben, saldo });
  }
  if (aus.length === 0 && !befunde.some((b) => b.schweregrad === "fehler")) melde(null, null, "SUSA_KEINE_ZEILEN", "fehler", "Die Datei enthält keine Konten.");
  return { format, dateityp, zeilen: aus, befunde };
}

/** Liest eine Summen- und Saldenliste (CSV oder Excel). Wirft `DateiFehler`, wenn die Datei als Ganzes nicht lesbar ist. */
export async function leseSusa(daten: Uint8Array): Promise<SusaGelesen> {
  const typ = erkenneDateityp(daten);
  if (typ === null) throw new DateiFehler("DATEITYP_UNBEKANNT", "Nur Excel-Dateien (.xlsx) und CSV-Dateien sind erlaubt.");
  if (typ === "csv") {
    const { text } = dekodiereCsv(daten);
    const alle = parseCsv(text, erkenneTrennzeichen(text));
    const kopfIndex = alle.findIndex((z) => z.some((c) => c.trim() !== ""));
    if (kopfIndex < 0) throw new DateiFehler("DATEI_LEER", "Die CSV-Datei enthält keine Zeilen.");
    const kopf = alle[kopfIndex]!.map((c) => c.trim());
    return auswerten(
      kopf,
      alle.slice(kopfIndex + 1).map((z, i) => ({ zeile: kopfIndex + i + 2, zellen: z.map((c) => c.trim()) })),
      "csv",
    );
  }
  pruefeZip(daten);
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(Buffer.from(daten.buffer, daten.byteOffset, daten.byteLength) as unknown as ExcelJS.Buffer);
  } catch {
    throw new DateiFehler("DATEI_BESCHAEDIGT", "Die Excel-Datei ist beschädigt oder keine Excel-Datei.");
  }
  const blatt = wb.worksheets[0];
  if (!blatt) throw new DateiFehler("DATEI_LEER", "Die Excel-Datei enthält kein Blatt.");
  if (blatt.rowCount > MAX_ZEILEN + 1) throw new DateiFehler("DATEI_ZU_GROSS", `Die Datei hat mehr als ${MAX_ZEILEN} Zeilen.`);
  const breite = Math.min(blatt.columnCount, 40);
  const kopf: string[] = [];
  const zeilen: { zeile: number; zellen: string[] }[] = [];
  blatt.eachRow({ includeEmpty: false }, (z, nr) => {
    const zellen: string[] = [];
    for (let c = 1; c <= breite; c++) zellen.push(zellText(z.getCell(c).value));
    if (kopf.length === 0) kopf.push(...zellen);
    else zeilen.push({ zeile: nr, zellen });
  });
  return auswerten(kopf, zeilen, "xlsx");
}
