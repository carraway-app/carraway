import { and, eq, sql } from "drizzle-orm";
import { dokument, dokumentSeite, dokumentVerknuepfung, type Dokument } from "@carraway/db";
import { sha256, type Speicher } from "../berichte/speicher";
import { sperreSchluessel } from "./aufbewahrung";
import { Fachfehler } from "../fehler";
import type { Protokollant } from "../schreiben";
import type { Tx } from "../zeitlimit";
import { pruefeDokument, bereinigeDateiname, MAX_DOKUMENT, type ErkanntesDokument } from "./typ";
import { ladeOcrKonfiguration } from "./ocr";
import { extrahiereSeiten, type Textauszug } from "./text";
import { dokumentSichtbar, type Ziel } from "./ziele";
import type { Akteur } from "../anmeldung/akteur";

/**
 * Speichern eines Dokuments: Typ prüfen, Bytes in die Dateiablage legen (Schlüssel `dokumente/<ab>/<sha256>`, einmal geschrieben,
 * gleiche Bytes gleicher Schlüssel), Text ausziehen, dann in einer Transaktion Metadaten, Verknüpfungen und Seitentext anlegen.
 * Aufbewahrung: Die Datei bleibt nach dem Ersetzen in der Ablage und nach dem weichen Löschen so lange, wie `DOKUMENT_AUFBEWAHRUNG_TAGE` sagt;
 * danach entfernt der Worker sie (`aufbewahrung.ts`), sofern keine andere Zeile oder Fundstelle sie braucht.
 */

/** Texterkennung eingeschaltet (`OCR=lokal`)? Liest die Umgebung bei jedem Aufruf (Tests schalten sie je Fall). */
export const ocrAn = (): boolean => ladeOcrKonfiguration().modus === "lokal";

export type Klassifikation = Dokument["klassifikation"];

export const dokumentSchluessel = (hash: string): string => `dokumente/${hash.slice(0, 2)}/${hash}`;

export interface VorbereitetesDokument {
  /** Die Ablage, in die `bereiteVor` geschrieben hat; `legeDokumentAn` schreibt unter Sperre noch einmal (siehe dort). */
  speicher: Speicher;
  bytes: Uint8Array;
  hash: string;
  erkannt: ErkanntesDokument;
  dateiname: string;
  auszug: Textauszug | null;
}

/** Prüft, schreibt die Datei in die Ablage und zieht den Text. Wirft `Fachfehler` bei unzulässigen Dateien; legt noch nichts in der Datenbank an. */
export async function bereiteVor(speicher: Speicher, bytes: Uint8Array, roherName: string): Promise<VorbereitetesDokument> {
  if (bytes.length > MAX_DOKUMENT) throw new Fachfehler(413, "DOKUMENT_ZU_GROSS", `Das Dokument ist größer als ${MAX_DOKUMENT / 1024 / 1024} MB.`);
  const erkannt = pruefeDokument(bytes);
  // Office-Dateien liest der Worker aus (`nachverarbeitung.ts`), nie die Anfrage; Bilder bleiben ohne Auszug.
  const auszug = erkannt.art === "pdf" ? await extrahiereSeiten(bytes) : null;
  if (auszug?.status === "fehler" && auszug.grund === "verschluesselt") {
    throw new Fachfehler(422, "PDF_VERSCHLUESSELT", "Verschlüsselte oder passwortgeschützte PDF-Dateien werden nicht angenommen. Bitte ohne Passwort speichern und erneut hochladen.");
  }
  const hash = sha256(bytes);
  await speicher.schreibe(dokumentSchluessel(hash), bytes);
  return { speicher, bytes, hash, erkannt, dateiname: bereinigeDateiname(roherName, erkannt.art), auszug };
}

export interface Hochlader {
  id: string;
  name: string | null;
}

export interface Anlage {
  klassifikation: Klassifikation;
  vertraulich: boolean;
  ziele: readonly Ziel[];
  vorgaengerId?: string;
}

const textStatus = (v: Pick<VorbereitetesDokument, "auszug" | "erkannt">): Dokument["textStatus"] => {
  // Scans (PDF ohne Textebene) und Bilder warten auf die lokale Texterkennung, wenn sie eingeschaltet ist (`OCR=lokal`); sonst bleibt es beim Stand ohne Text.
  const erkennen = ocrAn() && (v.auszug?.status === "kein_text" || v.erkannt.art === "png" || v.erkannt.art === "jpeg");
  return erkennen ? "ocr_ausstehend" : textStatusOhneOcr(v);
};
const textStatusOhneOcr = (v: Pick<VorbereitetesDokument, "auszug" | "erkannt">): Dokument["textStatus"] =>
  v.auszug !== null ? (v.auszug.status === "vorhanden" ? "vorhanden" : v.auszug.status) : v.erkannt.art === "docx" || v.erkannt.art === "xlsx" ? "ausstehend" : "nicht_unterstuetzt";

/** Schreibt Zeilen für Dokument, Verknüpfungen und Seitentext; protokolliert ohne Textinhalt. */
export async function legeDokumentAn(tx: Tx, protokoll: Protokollant, von: Hochlader, v: VorbereitetesDokument, a: Anlage): Promise<Dokument> {
  // Der Aufbewahrungslauf für gelöschte Dokumente (`aufbewahrung.ts`) entfernt eine Datei nur unter der ausschließlichen Sperre dieses Schlüssels und
  // nur, wenn keine Zeile mehr auf sie zeigt. Hier die geteilte Sperre: Hat der Lauf die Datei zwischen `bereiteVor` und jetzt entfernt, legt das
  // idempotente Schreiben sie wieder an; sonst wartet der Lauf, sieht die neue Zeile und lässt die Datei liegen.
  const schluessel = dokumentSchluessel(v.hash);
  await tx.execute(sql`SELECT pg_advisory_xact_lock_shared(${sperreSchluessel(schluessel)})`);
  await v.speicher.schreibe(schluessel, v.bytes);
  const [neu] = await tx
    .insert(dokument)
    .values({
      sha256: v.hash,
      dateiname: v.dateiname,
      mime: v.erkannt.mime,
      groesse: v.bytes.length,
      gespeichertUnter: dokumentSchluessel(v.hash),
      hochgeladenVon: von.id,
      hochgeladenVonName: von.name,
      klassifikation: a.klassifikation,
      vertraulich: a.vertraulich,
      textStatus: textStatus(v),
      seitenzahl: v.auszug?.seitenzahl ?? null,
      vorgaengerId: a.vorgaengerId ?? null,
    })
    .returning();
  if (!neu) throw new Error("Dokument nicht angelegt");
  for (const z of a.ziele) {
    await tx.insert(dokumentVerknuepfung).values({ dokumentId: neu.id, zielTyp: z.typ, zielId: z.id, erstelltVon: von.id }).onConflictDoNothing();
  }
  if (v.auszug?.status === "vorhanden") {
    for (let i = 0; i < v.auszug.seiten.length; i += 100) {
      await tx.insert(dokumentSeite).values(v.auszug.seiten.slice(i, i + 100).map((s) => ({ dokumentId: neu.id, seite: s.seite, text: s.text })));
    }
  }
  await protokoll("anlegen", "dokument", neu.id, null, {
    dateiname: neu.dateiname,
    mime: neu.mime,
    groesse: neu.groesse,
    sha256: neu.sha256,
    klassifikation: neu.klassifikation,
    vertraulich: neu.vertraulich,
    textStatus: neu.textStatus,
    seitenzahl: neu.seitenzahl,
    vorgaengerId: neu.vorgaengerId,
    ziele: a.ziele,
  });
  return neu;
}

/** Aktive Dokumente mit gleichem SHA-256, die die Person sehen darf (für die Antwort auf einen doppelten Upload). */
export async function sichtbareDubletten(tx: Tx, akteur: Akteur, hash: string): Promise<{ id: string; dateiname: string }[]> {
  const { rows } = await tx.execute<{ id: string; dateiname: string }>(
    sql`SELECT d.id, d.dateiname FROM dokument d WHERE d.sha256 = ${hash} AND d.status = 'aktiv' AND ${dokumentSichtbar(akteur, sql`d.id`)} ORDER BY d.hochgeladen_am, d.id`,
  );
  return rows;
}

export async function verknuepfungenVon(tx: Tx, dokumentId: string): Promise<Ziel[]> {
  const zeilen = await tx.select().from(dokumentVerknuepfung).where(eq(dokumentVerknuepfung.dokumentId, dokumentId));
  return zeilen.map((z) => ({ typ: z.zielTyp, id: z.zielId }));
}

export async function hatVerknuepfung(tx: Tx, dokumentId: string, ziel: Ziel): Promise<boolean> {
  const [z] = await tx
    .select({ d: dokumentVerknuepfung.dokumentId })
    .from(dokumentVerknuepfung)
    .where(and(eq(dokumentVerknuepfung.dokumentId, dokumentId), eq(dokumentVerknuepfung.zielTyp, ziel.typ), eq(dokumentVerknuepfung.zielId, ziel.id)));
  return z !== undefined;
}
