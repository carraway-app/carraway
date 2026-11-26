import { inflateRawSync } from "node:zlib";
import ExcelJS from "exceljs";
import { DateiFehler, pruefeZip, zellText } from "./lesen";

/**
 * Textauszug aus Office-Dokumenten (DOCX und XLSX) für Suche und KI-Auslesung. Der Weg ist so gehärtet wie der Excel-Import:
 * erst die Schutzprüfung des Archivs (`pruefeZip`, jeder Eintrag wird mit harter Grenze entpackt), dann nur gezieltes Lesen einzelner Einträge mit
 * Obergrenze (`leseZipEintrag`). DOCX-XML wird ohne XML-Bibliothek zerlegt und lehnt Dokumenttypdeklarationen und Entitäten ab (kein Entity-Angriff);
 * XLSX liest ExcelJS, wie der Import. Die Ausgabe ist begrenzt (Zeichen je Seite, Zahl der Seiten, Zahl der Zellen).
 */

export interface OfficeSeite {
  seite: number;
  text: string;
}

export type OfficeAuszug = { status: "vorhanden"; seiten: OfficeSeite[] } | { status: "kein_text"; seiten: [] } | { status: "fehler"; seiten: []; grund: "nicht_lesbar" | "zu_gross" };

/** Zielgröße einer DOCX-„Seite“ in Zeichen; ein Abschnittswechsel beginnt eine neue Seite früher. */
export const OFFICE_SEITE_ZEICHEN = 3000;
/** Höchstzahl Seiten, Zeichen je Seite, Zellen je Datei und Größe eines gelesenen Eintrags (entpackt). */
export const OFFICE_MAX_SEITEN = 1000;
export const OFFICE_MAX_ZEICHEN_JE_SEITE = 100_000;
export const OFFICE_MAX_ZELLEN = 200_000;
export const OFFICE_MAX_EINTRAG = 8 * 1024 * 1024;
/** Obergrenze für jeden Eintrag eines Office-Archivs (auch Bilder und Einbettungen), entpackt. */
export const OFFICE_MAX_JEDER_EINTRAG = 16 * 1024 * 1024;
const MIN_ZEICHEN = 1;

/** Entpackt einen Eintrag eines bereits mit `pruefeZip` geprüften Archivs; `null`, wenn es ihn nicht gibt. Wirft `DateiFehler` bei Überschreitung von `maxBytes`. */
export function leseZipEintrag(daten: Uint8Array, name: string, maxBytes = OFFICE_MAX_EINTRAG): Uint8Array | null {
  const ansicht = new DataView(daten.buffer, daten.byteOffset, daten.byteLength);
  const ende = Math.max(0, daten.length - 22 - 65535);
  let eocd = -1;
  for (let i = daten.length - 22; i >= ende; i--) {
    if (ansicht.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new DateiFehler("DATEI_BESCHAEDIGT", "Das Archiv ist beschädigt.");
  const anzahl = ansicht.getUint16(eocd + 10, true);
  let pos = ansicht.getUint32(eocd + 16, true);
  for (let n = 0; n < anzahl; n++) {
    if (pos + 46 > daten.length || ansicht.getUint32(pos, true) !== 0x02014b50) throw new DateiFehler("DATEI_BESCHAEDIGT", "Das Archiv ist beschädigt.");
    const methode = ansicht.getUint16(pos + 10, true);
    const gepackt = ansicht.getUint32(pos + 20, true);
    const lokal = ansicht.getUint32(pos + 42, true);
    const nameLaenge = ansicht.getUint16(pos + 28, true);
    const eintrag = Buffer.from(daten.subarray(pos + 46, pos + 46 + nameLaenge)).toString("utf8");
    pos += 46 + nameLaenge + ansicht.getUint16(pos + 30, true) + ansicht.getUint16(pos + 32, true);
    if (eintrag !== name) continue;
    if (lokal + 30 > daten.length || ansicht.getUint32(lokal, true) !== 0x04034b50) throw new DateiFehler("DATEI_BESCHAEDIGT", "Das Archiv ist beschädigt.");
    const start = lokal + 30 + ansicht.getUint16(lokal + 26, true) + ansicht.getUint16(lokal + 28, true);
    const roh = daten.subarray(start, start + gepackt);
    if (methode === 0) {
      if (roh.length > maxBytes) throw new DateiFehler("DATEI_ZU_GROSS", "Ein Eintrag des Archivs ist zu groß.");
      return roh;
    }
    if (methode !== 8) throw new DateiFehler("DATEI_BESCHAEDIGT", "Das Archiv verwendet ein nicht unterstütztes Packverfahren.");
    try {
      return inflateRawSync(roh, { maxOutputLength: maxBytes });
    } catch (fehler) {
      if (fehler instanceof DateiFehler) throw fehler;
      if ((fehler as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") return zuGross();
      throw new DateiFehler("DATEI_BESCHAEDIGT", "Das Archiv ist beschädigt.");
    }
  }
  return null;
}

/**
 * Lehnt ein Archiv ab, in dem irgendein Eintrag entpackt größer als `maxJeder` ist, oder ein XML-Eintrag (Dokument, Blatt, Zeichenketten) größer als
 * `maxXml`. Die Größen stimmen nach `pruefeZip` (jeder Eintrag wird dort tatsächlich entpackt und gegen die Angabe geprüft); die Summe begrenzt `pruefeZip`.
 */
export function pruefeEintragsgroessen(daten: Uint8Array, maxXml = OFFICE_MAX_EINTRAG, maxJeder = OFFICE_MAX_JEDER_EINTRAG): void {
  const ansicht = new DataView(daten.buffer, daten.byteOffset, daten.byteLength);
  const ende = Math.max(0, daten.length - 22 - 65535);
  let eocd = -1;
  for (let i = daten.length - 22; i >= ende; i--) {
    if (ansicht.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new DateiFehler("DATEI_BESCHAEDIGT", "Das Archiv ist beschädigt.");
  const anzahl = ansicht.getUint16(eocd + 10, true);
  let pos = ansicht.getUint32(eocd + 16, true);
  for (let n = 0; n < anzahl; n++) {
    if (pos + 46 > daten.length || ansicht.getUint32(pos, true) !== 0x02014b50) throw new DateiFehler("DATEI_BESCHAEDIGT", "Das Archiv ist beschädigt.");
    const groesse = ansicht.getUint32(pos + 24, true);
    const nameLaenge = ansicht.getUint16(pos + 28, true);
    const name = Buffer.from(daten.subarray(pos + 46, pos + 46 + nameLaenge)).toString("utf8");
    pos += 46 + nameLaenge + ansicht.getUint16(pos + 30, true) + ansicht.getUint16(pos + 32, true);
    if (groesse > maxJeder || (groesse > maxXml && /\.(xml|rels)$/i.test(name))) throw new DateiFehler("DATEI_ZU_GROSS", "Ein Eintrag des Archivs ist zu groß.");
  }
}

function zuGross(): never {
  throw new DateiFehler("DATEI_ZU_GROSS", "Ein Eintrag des Archivs ist zu groß.");
}

// DOCX ----------------------------------------------------------------------------------------------------------------

const ENTITAETEN: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** Löst nur die fünf vordefinierten und numerische Verweise auf; alles andere bleibt unverändert (keine eigenen Entitäten). */
function entitaeten(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|amp|lt|gt|quot|apos);/g, (_, e: string) => {
    if (e.startsWith("#")) {
      const code = e[1] === "x" ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : "";
    }
    return ENTITAETEN[e] ?? "";
  });
}

interface Absatz {
  text: string;
  /** Hinter diesem Absatz endet ein Abschnitt. */
  abschnittsende: boolean;
}

/** Entfernt Leerzeichen und Tabulatoren am Ende (Schleife statt Ausdruck: linear, auch bei langen Folgen). */
function kuerzeRechts(text: string, zeichen: string): string {
  let ende = text.length;
  while (ende > 0 && zeichen.includes(text[ende - 1]!)) ende--;
  return text.slice(0, ende);
}

const kaputtXml = () => new DateiFehler("DATEI_BESCHAEDIGT", "Das XML ist nicht wohlgeformt.");

/**
 * Zerlegt XML in Ereignisse mit einem einzigen Durchlauf über die Zeichen (linear, kein Zurückspringen): Starttag, Endtag, Text. Ein nicht beendetes
 * Tag, ein `<` in einem Tag oder ein nicht beendeter Kommentar bricht sofort ab. Kommentare und Verarbeitungsanweisungen werden übersprungen.
 * `frist` (Zeitpunkt in ms) wird alle paar tausend Ereignisse geprüft.
 */
export function zerlegeXml(
  xml: string,
  ereignis: (art: "auf" | "zu" | "leer" | "text", name: string, text: string) => void,
  frist = Number.POSITIVE_INFINITY,
): void {
  const n = xml.length;
  let i = 0;
  let zaehler = 0;
  while (i < n) {
    if ((++zaehler & 4095) === 0 && Date.now() > frist) throw new DateiFehler("DATEI_ZU_GROSS", "Das Lesen dauert zu lange.");
    if (xml.charCodeAt(i) !== 60) {
      const j = xml.indexOf("<", i);
      const ende = j < 0 ? n : j;
      ereignis("text", "", xml.slice(i, ende));
      i = ende;
      continue;
    }
    if (xml.startsWith("<!--", i)) {
      const j = xml.indexOf("-->", i + 4);
      if (j < 0) throw kaputtXml();
      i = j + 3;
      continue;
    }
    if (xml.startsWith("<![CDATA[", i)) {
      const j = xml.indexOf("]]>", i + 9);
      if (j < 0) throw kaputtXml();
      ereignis("text", "", xml.slice(i + 9, j).replace(/[&<]/g, (z) => (z === "&" ? "&amp;" : "&lt;")));
      i = j + 3;
      continue;
    }
    if (xml.startsWith("<?", i)) {
      const j = xml.indexOf("?>", i + 2);
      if (j < 0) throw kaputtXml();
      i = j + 2;
      continue;
    }
    if (xml.startsWith("<!", i)) throw kaputtXml();
    // Tag: Zeichen für Zeichen, Anführungszeichen beachten; `<` außerhalb von Anführungszeichen ist ein Fehler.
    let k = i + 1;
    const zu = xml.charCodeAt(k) === 47;
    if (zu) k++;
    const nameStart = k;
    while (k < n) {
      const c = xml.charCodeAt(k);
      if (c === 62 || c === 47 || c === 32 || c === 9 || c === 10 || c === 13) break;
      if (c === 60) throw kaputtXml();
      k++;
    }
    const name = xml.slice(nameStart, k);
    if (name === "") throw kaputtXml();
    let anfuehrung = 0;
    let beendet = false;
    let letztes = 0;
    while (k < n) {
      const c = xml.charCodeAt(k);
      if (anfuehrung !== 0) {
        if (c === anfuehrung) anfuehrung = 0;
      } else if (c === 34 || c === 39) anfuehrung = c;
      else if (c === 60) throw kaputtXml();
      else if (c === 62) {
        beendet = true;
        break;
      }
      if (c !== 32 && c !== 9 && c !== 10 && c !== 13) letztes = c;
      k++;
    }
    if (!beendet) throw kaputtXml();
    const selbst = letztes === 47 && !zu && xml.charCodeAt(k - 1) === 47;
    ereignis(zu ? "zu" : selbst ? "leer" : "auf", name, "");
    i = k + 1;
  }
}

/** Zerlegt `word/document.xml` in Absätze (Tabellenzellen durch Tabulator, Zeilen durch Zeilenumbruch getrennt). Wirft bei Dokumenttypdeklaration oder Entität. */
export function absaetzeAusDocx(xml: string, frist = Number.POSITIVE_INFINITY): Absatz[] {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new DateiFehler("DATEI_BESCHAEDIGT", "Das Dokument enthält eine Dokumenttypdeklaration.");
  const absaetze: Absatz[] = [];
  let aktuell = "";
  let inText = false;
  let abschnitt = false;
  let zellen = 0;
  const schliesse = () => {
    absaetze.push({ text: kuerzeRechts(aktuell, " \t"), abschnittsende: abschnitt });
    aktuell = "";
    abschnitt = false;
  };
  zerlegeXml(
    xml,
    (art, name, text) => {
      if (art === "text") {
        if (inText) aktuell += entitaeten(text);
        return;
      }
      const lokal = name.includes(":") ? name.slice(name.indexOf(":") + 1) : name;
      const zu = art === "zu";
      const auf = art === "auf";
      if (lokal === "t" && auf) inText = true;
      else if (lokal === "t" && zu) inText = false;
      else if (!zu && (lokal === "tab" || lokal === "ptab")) aktuell += "\t";
      else if (!zu && (lokal === "br" || lokal === "cr")) aktuell += "\n";
      else if (auf && lokal === "tc") zellen++;
      else if (zu && lokal === "tc") {
        zellen = Math.max(0, zellen - 1);
        aktuell = kuerzeRechts(aktuell, " ") + "\t";
      } else if (zu && lokal === "tr") schliesse();
      else if (zu && lokal === "p") {
        // In einer Tabellenzelle bleiben mehrere Absätze in der Zeile der Tabelle.
        if (zellen > 0) aktuell += " ";
        else schliesse();
      } else if (lokal === "sectPr" && art !== "auf") abschnitt = true;
    },
    frist,
  );
  if (aktuell.trim() !== "") schliesse();
  return absaetze;
}

/** Bildet aus Absätzen Seiten: neue Seite ab `OFFICE_SEITE_ZEICHEN` Zeichen oder nach einem Abschnittsende; ein sehr langer Absatz wird zerteilt. */
export function seitenAusAbsaetzen(absaetze: readonly Absatz[]): OfficeSeite[] {
  const seiten: string[] = [];
  let seite = "";
  const beende = () => {
    if (seite.trim() !== "") seiten.push(seite.trim());
    seite = "";
  };
  for (const a of absaetze) {
    let rest = a.text;
    while (rest.length > OFFICE_SEITE_ZEICHEN) {
      const schnitt = rest.lastIndexOf(" ", OFFICE_SEITE_ZEICHEN);
      const n = schnitt > OFFICE_SEITE_ZEICHEN / 2 ? schnitt : OFFICE_SEITE_ZEICHEN;
      if (seite !== "") beende();
      seite = rest.slice(0, n);
      beende();
      rest = rest.slice(n).trimStart();
    }
    if (seite !== "" && seite.length + 1 + rest.length > OFFICE_SEITE_ZEICHEN) beende();
    seite += (seite === "" ? "" : "\n") + rest;
    if (a.abschnittsende) beende();
  }
  beende();
  return seiten.map((text, i) => ({ seite: i + 1, text }));
}

function begrenze(seiten: OfficeSeite[]): OfficeAuszug {
  if (seiten.length > OFFICE_MAX_SEITEN) return { status: "fehler", seiten: [], grund: "zu_gross" };
  const zeichen = seiten.reduce((s, x) => s + x.text.replace(/\s/g, "").length, 0);
  if (zeichen < MIN_ZEICHEN) return { status: "kein_text", seiten: [] };
  return { status: "vorhanden", seiten };
}

/** Textauszug einer DOCX-Datei (Absätze, Tabellen); das Archiv ist zuvor mit `pruefeZip` geprüft worden und wird hier erneut geprüft. */
export function extrahiereDocx(daten: Uint8Array, zeitlimitMs = 10_000): OfficeAuszug {
  try {
    const frist = Date.now() + zeitlimitMs;
    pruefeZip(daten);
    pruefeEintragsgroessen(daten);
    const eintrag = leseZipEintrag(daten, "word/document.xml");
    if (!eintrag) return { status: "fehler", seiten: [], grund: "nicht_lesbar" };
    const xml = Buffer.from(eintrag.buffer, eintrag.byteOffset, eintrag.byteLength).toString("utf8");
    return begrenze(seitenAusAbsaetzen(absaetzeAusDocx(xml, frist)).map((s) => ({ seite: s.seite, text: bereinige(s.text) })));
  } catch (fehler) {
    return { status: "fehler", seiten: [], grund: fehler instanceof DateiFehler && fehler.code === "DATEI_ZU_GROSS" ? "zu_gross" : "nicht_lesbar" };
  }
}

// XLSX ----------------------------------------------------------------------------------------------------------------

/** Textauszug einer XLSX-Datei: eine Seite je nicht leerem Blatt (Zeilen mit Tabulator zwischen den Zellwerten, Blattname in der ersten Zeile). */
export async function extrahiereXlsx(daten: Uint8Array): Promise<OfficeAuszug> {
  try {
    pruefeZip(daten);
    pruefeEintragsgroessen(daten);
    const mappe = new ExcelJS.Workbook();
    await mappe.xlsx.load(Buffer.from(daten.buffer, daten.byteOffset, daten.byteLength) as unknown as ExcelJS.Buffer);
    const seiten: OfficeSeite[] = [];
    let zellen = 0;
    for (const blatt of mappe.worksheets) {
      const zeilen: string[] = [];
      let laenge = 0;
      blatt.eachRow({ includeEmpty: false }, (zeile) => {
        if (laenge >= OFFICE_MAX_ZEICHEN_JE_SEITE) return;
        const werte: string[] = [];
        for (let c = 1; c <= zeile.cellCount; c++) {
          if (++zellen > OFFICE_MAX_ZELLEN) throw new DateiFehler("DATEI_ZU_GROSS", "Zu viele Zellen.");
          werte.push(zellText(zeile.getCell(c).value));
        }
        while (werte.length > 0 && werte[werte.length - 1] === "") werte.pop();
        if (werte.length === 0) return;
        const text = werte.join("\t");
        zeilen.push(text);
        laenge += text.length + 1;
      });
      if (zeilen.length === 0) continue;
      const text = bereinige(`${blatt.name}\n${zeilen.join("\n")}`).slice(0, OFFICE_MAX_ZEICHEN_JE_SEITE);
      seiten.push({ seite: seiten.length + 1, text });
    }
    return begrenze(seiten);
  } catch (fehler) {
    return { status: "fehler", seiten: [], grund: fehler instanceof DateiFehler && fehler.code === "DATEI_ZU_GROSS" ? "zu_gross" : "nicht_lesbar" };
  }
}

/** Entfernt NUL- und Steuerzeichen (außer Zeilenumbruch und Tabulator). */
function bereinige(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/\r\n?/g, "\n");
}
