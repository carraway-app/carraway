import { and, eq, sql } from "drizzle-orm";
import { dokument, dokumentSeite, type Db } from "@carraway/db";
import type { Logger } from "../beobachtung/protokoll";
import type { Speicher } from "../berichte/speicher";
import { schreibe } from "../schreiben";
import { sperreSchluessel } from "./aufbewahrung";
import { extrahiereOfficeIsoliert } from "./isoliert";
import { OcrFehler, type OcrKonfiguration, type Texterkenner } from "./ocr";
import { bereinigeText, type Textauszug } from "./text";

/**
 * Nachverarbeitung des Textes im Worker, nie im Anfragepfad: Office-Auszug (DOCX, XLSX) und Texterkennung (OCR).
 *
 * - Der Upload legt das Dokument mit `ausstehend` (Office) oder `ocr_ausstehend` (Scan, Bild, nur mit `OCR=lokal`) an.
 * - Der Worker holt ein Dokument, vermerkt vor dem Lesen Beginn und Versuchszahl (`text_begonnen_am`, `text_versuche`) und arbeitet in einem eigenen
 *   Thread mit hartem Zeitlimit (`isoliert.ts`, der Thread wird beendet). Ein Zeitlimit oder Fehler beim Lesen ergibt sofort `fehler` (kein erneutes
 *   Einreihen). Stürzt der Worker mitten im Lauf ab, wird das Dokument nach Ablauf einer Frist noch zweimal versucht, danach gilt `fehler`.
 * - Geschrieben wird nur für ein aktives Dokument, unter der geteilten Sperre des Dateischlüssels (wie Upload) und nur, solange der Stand noch
 *   der des Laufs ist; der Aufbewahrungslauf setzt beim endgültigen Löschen `kein_text`, damit Text nicht zurückgeschrieben wird.
 */

const OFFICE_MIME = [
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];
const DOCX_MIME = OFFICE_MIME[0]!;
const OFFICE_LISTE = sql.join(OFFICE_MIME.map((m) => sql`${m}`), sql`, `);
/** Versuche je Dokument (nur Abstürze zählen mit; Zeitlimit und Lesefehler beenden sofort). */
export const MAX_VERSUCHE = 3;
const MIN_ZEICHEN_OCR = 20;

type Geholt = {
  id: string;
  mime: string;
  schluessel: string;
};

/** Schreibt Seitentext und Stand eines Laufs; wahr, wenn geschrieben wurde (Dokument aktiv und noch im Stand des Laufs). */
async function schreibeErgebnis(
  db: Db,
  d: Geholt,
  vorStand: "ausstehend" | "ocr_laeuft",
  stand: "vorhanden" | "kein_text" | "fehler",
  seitenzahl: number | null,
  seiten: { seite: number; text: string; quelle: "text" | "ocr"; konfidenz: number | null }[],
  protokollDaten: Record<string, unknown>,
  aktion: string,
): Promise<boolean> {
  return schreibe(db, "system", async (tx, protokoll) => {
    // Geteilte Sperre wie beim Upload: Der Aufbewahrungslauf (ausschließliche Sperre) sieht entweder dieses Ergebnis oder wir seinen Endstand.
    await tx.execute(sql`SELECT pg_advisory_xact_lock_shared(${sperreSchluessel(d.schluessel)})`);
    const [zeile] = await tx
      .update(dokument)
      .set({ textStatus: stand, ...(seitenzahl !== null ? { seitenzahl } : {}) })
      .where(and(eq(dokument.id, d.id), eq(dokument.status, "aktiv"), eq(dokument.textStatus, vorStand)))
      .returning({ id: dokument.id });
    if (!zeile) return false;
    if (stand === "vorhanden") {
      for (let i = 0; i < seiten.length; i += 100) {
        await tx.insert(dokumentSeite).values(seiten.slice(i, i + 100).map((x) => ({ dokumentId: d.id, seite: x.seite, text: x.text, quelle: x.quelle, konfidenz: x.konfidenz })));
      }
    }
    await protokoll(aktion, "dokument", d.id, null, { textStatus: stand, seitenzahl, ...protokollDaten });
    return true;
  });
}

// Office ----------------------------------------------------------------------------------------------------------

export interface OfficeLauf {
  verarbeitet: number;
  fehler: number;
}

async function holeOffice(db: Db, reserveSek: number): Promise<Geholt | null> {
  return schreibe(db, "system", async (tx) => {
    await tx.execute(
      sql`UPDATE dokument SET text_status = 'fehler' WHERE text_status = 'ausstehend' AND mime IN (${OFFICE_LISTE}) AND text_versuche >= ${MAX_VERSUCHE} AND text_begonnen_am < now() - make_interval(secs => ${reserveSek})`,
    );
    const { rows } = await tx.execute<Geholt>(
      sql`UPDATE dokument SET text_begonnen_am = now(), text_versuche = text_versuche + 1
          WHERE id = (SELECT id FROM dokument
                      WHERE status = 'aktiv' AND text_status = 'ausstehend' AND mime IN (${OFFICE_LISTE})
                        AND (text_begonnen_am IS NULL OR text_begonnen_am < now() - make_interval(secs => ${reserveSek}))
                      ORDER BY hochgeladen_am, id LIMIT 1 FOR UPDATE SKIP LOCKED)
          RETURNING id, mime, gespeichert_unter AS schluessel`,
    );
    return rows[0] ?? null;
  });
}

/** Zieht den Text der wartenden Office-Dokumente (höchstens `max` je Lauf, älteste zuerst), jedes in einem Thread mit Zeitlimit. */
export async function verarbeiteOfficeTexte(
  db: Db,
  speicher: Speicher,
  optionen: { max?: number; zeitlimitMs?: number; logger?: Logger; ausfuehren?: (art: "docx" | "xlsx", bytes: Uint8Array, zeitlimitMs: number) => Promise<Textauszug> } = {},
): Promise<OfficeLauf> {
  const zeitlimit = optionen.zeitlimitMs ?? 30_000;
  const ausfuehren = optionen.ausfuehren ?? extrahiereOfficeIsoliert;
  const lauf: OfficeLauf = { verarbeitet: 0, fehler: 0 };
  for (let n = 0; n < (optionen.max ?? 5); n++) {
    const d = await holeOffice(db, Math.ceil(zeitlimit / 1000) + 60);
    if (!d) break;
    let auszug: Textauszug;
    try {
      auszug = await ausfuehren(d.mime === DOCX_MIME ? "docx" : "xlsx", await speicher.lese(d.schluessel), zeitlimit);
    } catch (fehler) {
      optionen.logger?.("warn", "Textauszug aus Office-Datei fehlgeschlagen", { dokumentId: d.id, grund: fehler instanceof Error ? fehler.message : String(fehler) });
      auszug = { status: "fehler", seitenzahl: null, seiten: [], grund: "nicht_lesbar" };
    }
    const stand = auszug.status;
    const seiten = auszug.status === "vorhanden" ? auszug.seiten.map((s) => ({ seite: s.seite, text: bereinigeText(s.text), quelle: "text" as const, konfidenz: null })) : [];
    if (await schreibeErgebnis(db, d, "ausstehend", stand, auszug.seitenzahl, seiten, {}, "textauszug")) lauf[stand === "fehler" ? "fehler" : "verarbeitet"]++;
  }
  return lauf;
}

/** Zahl der wartenden Office-Dokumente (für Betriebsansichten und Tests). */
export async function zaehleWartendeOfficeTexte(db: Db): Promise<number> {
  const { rows } = await db.execute<{ n: string }>(sql`SELECT count(*)::text AS n FROM dokument WHERE text_status = 'ausstehend' AND mime IN (${OFFICE_LISTE})`);
  return Number(rows[0]?.n ?? 0);
}

// Texterkennung ---------------------------------------------------------------------------------------------------

export interface OcrErgebnisLauf {
  verarbeitet: number;
  kein_text: number;
  fehler: number;
}

async function holeOcr(db: Db, reserveSek: number): Promise<Geholt | null> {
  return schreibe(db, "system", async (tx) => {
    await tx.execute(
      sql`UPDATE dokument SET text_status = 'fehler' WHERE text_status = 'ocr_laeuft' AND text_versuche >= ${MAX_VERSUCHE} AND text_begonnen_am < now() - make_interval(secs => ${reserveSek})`,
    );
    const { rows } = await tx.execute<Geholt>(
      sql`UPDATE dokument SET text_status = 'ocr_laeuft', text_begonnen_am = now(), text_versuche = text_versuche + 1
          WHERE id = (SELECT id FROM dokument
                      WHERE status = 'aktiv'
                        AND (text_status = 'ocr_ausstehend' OR (text_status = 'ocr_laeuft' AND text_begonnen_am < now() - make_interval(secs => ${reserveSek})))
                      ORDER BY hochgeladen_am, id LIMIT 1 FOR UPDATE SKIP LOCKED)
          RETURNING id, mime, gespeichert_unter AS schluessel`,
    );
    return rows[0] ?? null;
  });
}

/**
 * Erkennt den Text wartender Scans und Bilder (höchstens `max` je Aufruf, nacheinander). Das Ergebnis trägt `quelle = ocr` und die Sicherheit je Seite.
 * Der Erkenner läuft im Betrieb in einem Thread mit hartem Zeitlimit (`IsolierterErkenner`).
 */
export async function verarbeiteTexterkennung(db: Db, speicher: Speicher, erkenner: Texterkenner, konf: OcrKonfiguration, optionen: { max?: number; logger?: Logger } = {}): Promise<OcrErgebnisLauf> {
  const lauf: OcrErgebnisLauf = { verarbeitet: 0, kein_text: 0, fehler: 0 };
  const reserveSek = Math.ceil(konf.zeitlimitMs / 1000) + 60;
  for (let n = 0; n < (optionen.max ?? 1); n++) {
    const geholt = await holeOcr(db, reserveSek);
    if (!geholt) break;
    const start = performance.now();
    let seitenzahl: number | null = null;
    let seiten: { seite: number; text: string; quelle: "ocr"; konfidenz: number }[] = [];
    let grund: string | null = null;
    try {
      const bytes = await speicher.lese(geholt.schluessel);
      const erg = await erkenner.erkenne(bytes, geholt.mime === "application/pdf" ? "pdf" : "bild", konf);
      seitenzahl = erg.seitenzahl;
      seiten = erg.seiten.map((x) => ({ seite: x.seite, text: bereinigeText(x.text).trim(), quelle: "ocr" as const, konfidenz: x.konfidenz })).filter((x) => x.text !== "");
    } catch (fehler) {
      grund = fehler instanceof OcrFehler ? fehler.code : "fehler";
      optionen.logger?.("warn", "Texterkennung fehlgeschlagen", { dokumentId: geholt.id, grund, meldung: fehler instanceof Error ? fehler.message : String(fehler) });
    }
    const zeichen = seiten.reduce((s, x) => s + x.text.replace(/\s/g, "").length, 0);
    const stand = grund !== null ? "fehler" : zeichen >= MIN_ZEICHEN_OCR ? "vorhanden" : "kein_text";
    const mittel = seiten.length === 0 ? null : Math.round((seiten.reduce((s, x) => s + x.konfidenz, 0) / seiten.length) * 10) / 10;
    const geschrieben = await schreibeErgebnis(db, geholt, "ocr_laeuft", stand, seitenzahl, seiten, { seiten: seiten.length, mittlereKonfidenz: mittel, dauerMs: Math.round(performance.now() - start), ...(grund ? { grund } : {}) }, "texterkennung");
    if (geschrieben) lauf[stand === "vorhanden" ? "verarbeitet" : stand === "kein_text" ? "kein_text" : "fehler"]++;
  }
  return lauf;
}
