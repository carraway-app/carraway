import { extractText, getDocumentProxy } from "unpdf";
import { extrahiereDocx, extrahiereXlsx } from "@carraway/import";

/**
 * Textauszug eines PDF je Seite (für Suche und Fundstellen). Ein Scan ohne Textebene ergibt `kein_text` (die Texterkennung `ocr.ts` ist ein eigener, optionaler Schritt im Worker). Der Text wird für die
 * Datenbank bereinigt (keine NUL- und Steuerzeichen). Höchstens `MAX_SEITEN` Seiten; größere Dokumente bekommen den Stand `fehler`,
 * statt den Prozess mit sehr langen Läufen zu binden.
 */

export const MAX_SEITEN = 1000;
/** Höchstzahl Zeichen je Seite (der Rest wird abgeschnitten); schützt Datenbank und Suchvektor. */
export const MAX_ZEICHEN_JE_SEITE = 100_000;
/** Ab dieser Zahl Zeichen (ohne Leerraum) über alle Seiten gilt ein PDF als Textdokument. */
const MIN_ZEICHEN = 20;

export interface Seitentext {
  seite: number;
  text: string;
}

export type Textauszug =
  | { status: "vorhanden"; seitenzahl: number; seiten: Seitentext[] }
  | { status: "kein_text"; seitenzahl: number; seiten: [] }
  | { status: "fehler"; seitenzahl: number | null; seiten: []; grund: "zu_viele_seiten" | "nicht_lesbar" | "verschluesselt" };

/** Entfernt NUL- und Steuerzeichen (außer Zeilenumbruch und Tabulator) und kürzt die Seite. */
export function bereinigeText(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/\r\n?/g, "\n").slice(0, MAX_ZEICHEN_JE_SEITE);
}

/** Text für Vergleiche: Leerraum zusammengezogen, Kleinschreibung wie im Original; für Zitate, die Zeilenumbrüche des PDF überspannen. */
export const normalisiere = (text: string): string => text.replace(/\s+/g, " ").trim();

export async function extrahiereSeiten(bytes: Uint8Array): Promise<Textauszug> {
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    // `getDocumentProxy` nimmt den Puffer in Besitz; eine Kopie hält `bytes` für den Aufrufer unverändert.
    pdf = await getDocumentProxy(new Uint8Array(bytes));
  } catch (fehler) {
    const name = (fehler as { name?: string }).name;
    return { status: "fehler", seitenzahl: null, seiten: [], grund: name === "PasswordException" ? "verschluesselt" : "nicht_lesbar" };
  }
  try {
    const seitenzahl = pdf.numPages;
    if (seitenzahl > MAX_SEITEN) return { status: "fehler", seitenzahl, seiten: [], grund: "zu_viele_seiten" };
    const { text } = await extractText(pdf, { mergePages: false });
    const seiten: Seitentext[] = [];
    text.forEach((roh, i) => {
      const bereinigt = bereinigeText(roh).trim();
      if (bereinigt !== "") seiten.push({ seite: i + 1, text: bereinigt });
    });
    const zeichen = seiten.reduce((s, x) => s + x.text.replace(/\s/g, "").length, 0);
    if (zeichen < MIN_ZEICHEN) return { status: "kein_text", seitenzahl, seiten: [] };
    return { status: "vorhanden", seitenzahl, seiten };
  } catch {
    return { status: "fehler", seitenzahl: null, seiten: [], grund: "nicht_lesbar" };
  }
}

/**
 * Textauszug einer DOCX- oder XLSX-Datei (Seiten: DOCX je etwa 3000 Zeichen oder Abschnitt, XLSX je Blatt). Der Weg über `@carraway/import`
 * ist derselbe gehärtete wie beim Excel-Import (Zip-Prüfung, begrenzte Einträge, keine Entitäten); Grenzen stehen dort.
 */
export async function extrahiereOffice(art: "docx" | "xlsx", bytes: Uint8Array): Promise<Textauszug> {
  const a = art === "docx" ? extrahiereDocx(bytes) : await extrahiereXlsx(bytes);
  if (a.status === "fehler") return { status: "fehler", seitenzahl: null, seiten: [], grund: a.grund === "zu_gross" ? "zu_viele_seiten" : "nicht_lesbar" };
  if (a.status === "kein_text") return { status: "kein_text", seitenzahl: 0, seiten: [] };
  return { status: "vorhanden", seitenzahl: a.seiten.length, seiten: a.seiten.map((s) => ({ seite: s.seite, text: bereinigeText(s.text) })) };
}
