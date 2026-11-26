import { and, asc, eq, sql } from "drizzle-orm";
import { extractText, getDocumentProxy } from "unpdf";
import { bericht, berichtVariante, type Bericht, type Db } from "@carraway/db";
import type { Protokollant } from "../schreiben";
import { schreibe } from "../schreiben";
import { lese, type Tx } from "../zeitlimit";
import { erzeugeBerichtDatei, hatKapitalkonten, type InvestorFassung } from "./erzeugen";
import { sha256, variantenSchluessel, type Speicher } from "./speicher";

/**
 * Fassungen je Investor für LP-Berichte (Abschnitt „Kapitalkonten“): Mit der letzten Freigabestufe entsteht je Investor eine unveränderlich
 * gespeicherte Datei mit nur dessen Konto (`bericht_variante`). `speichereFassungen` ist dieser gemeinsame Schreibweg. `holeVariantenNach`
 * erzeugt sie für Berichte, die vor den Fassungen freigegeben wurden: Die Daten sind die des festgehaltenen Wissensstands (`bericht.stand`) und
 * werden gegen die unveränderlich gespeicherte Hauptdatei geprüft; stimmt der Inhalt nicht überein, entsteht nichts (nie aus dem heutigen Stand).
 */

export async function speichereFassungen(tx: Tx, protokoll: Protokollant, speicher: Speicher, b: Pick<Bericht, "id" | "fondsId">, fassungen: readonly InvestorFassung[], aktion = "anlegen"): Promise<number> {
  let angelegt = 0;
  for (const fassung of fassungen) {
    const hash = sha256(fassung.bytes);
    const schluessel = variantenSchluessel(b.id, fassung.organisationId, hash);
    await speicher.schreibe(schluessel, fassung.bytes);
    const [variante] = await tx
      .insert(berichtVariante)
      .values({ berichtId: b.id, organisationId: fassung.organisationId, dateiName: fassung.name, dateiSchluessel: schluessel, dateiSha256: hash, dateiGroesse: fassung.bytes.length })
      .onConflictDoNothing()
      .returning();
    if (!variante) continue;
    angelegt++;
    // `fondsId` im Stand ordnet die Zeile im Änderungsprotokoll dem Fonds zu.
    await protokoll(aktion, "bericht_variante", variante.id, null, { ...variante, fondsId: b.fondsId });
  }
  return angelegt;
}

export type NachholGrund = "datei_fehlt" | "datei_veraendert" | "nicht_reproduzierbar" | "keine_investoren";

export interface NachholErgebnis {
  geprueft: number;
  angelegt: { berichtId: string; varianten: number }[];
  uebersprungen: { berichtId: string; grund: NachholGrund }[];
}

async function textVon(bytes: Uint8Array): Promise<string> {
  const { text } = await extractText(await getDocumentProxy(new Uint8Array(bytes)), { mergePages: true });
  return text.replace(/\s+/g, " ").trim();
}

/** Freigegebene LP-Berichte mit Abschnitt „Kapitalkonten“ ohne jede Fassung (älteste zuerst). */
async function kandidaten(tx: Tx, berichtId?: string): Promise<Bericht[]> {
  const zeilen = await tx
    .select()
    .from(bericht)
    .where(
      and(
        eq(bericht.art, "lp_bericht"),
        eq(bericht.status, "freigegeben"),
        berichtId ? eq(bericht.id, berichtId) : undefined,
        sql`NOT EXISTS (SELECT 1 FROM bericht_variante v WHERE v.bericht_id = ${bericht.id})`,
      ),
    )
    .orderBy(asc(bericht.erzeugtAm), asc(bericht.id));
  return zeilen.filter((b) => hatKapitalkonten(b));
}

/**
 * Legt die fehlenden Fassungen an. Je Bericht eine Transaktion (unter der Zeilensperre des Berichts, damit zwei Läufe nichts doppelt anlegen);
 * wiederholbar, ein Bericht mit Fassungen wird nicht noch einmal angefasst.
 */
export async function holeVariantenNach(db: Db, c: Parameters<typeof schreibe>[1], speicher: Speicher, optionen: { berichtId?: string } = {}): Promise<NachholErgebnis> {
  const liste = await lese(db, (tx) => kandidaten(tx, optionen.berichtId));
  const ergebnis: NachholErgebnis = { geprueft: liste.length, angelegt: [], uebersprungen: [] };
  for (const kandidat of liste) {
    const r = await schreibe(db, c, async (tx, protokoll) => {
      const [b] = await tx.select().from(bericht).where(eq(bericht.id, kandidat.id)).for("update");
      if (!b || b.status !== "freigegeben" || !b.stand || !b.dateiSchluessel || !b.dateiSha256) return { art: "nichts" as const };
      const [vorhanden] = await tx.select({ id: berichtVariante.id }).from(berichtVariante).where(eq(berichtVariante.berichtId, b.id)).limit(1);
      if (vorhanden) return { art: "nichts" as const };
      let gespeichert: Uint8Array;
      try {
        gespeichert = await speicher.lese(b.dateiSchluessel);
      } catch {
        return { art: "uebersprungen" as const, grund: "datei_fehlt" as const };
      }
      if (sha256(gespeichert) !== b.dateiSha256) return { art: "uebersprungen" as const, grund: "datei_veraendert" as const };
      // Daten des festgehaltenen Wissensstands, nie des heutigen: Die Hauptdatei muss sich daraus inhaltlich gleich ergeben.
      const neu = await erzeugeBerichtDatei(tx, b, { entwurf: false, stand: b.stand, mitFassungen: true });
      if ((await textVon(neu.bytes)) !== (await textVon(gespeichert))) return { art: "uebersprungen" as const, grund: "nicht_reproduzierbar" as const };
      if (!neu.fassungen || neu.fassungen.length === 0) return { art: "uebersprungen" as const, grund: "keine_investoren" as const };
      const n = await speichereFassungen(tx, protokoll, speicher, b, neu.fassungen, "variante_nachholen");
      return { art: "angelegt" as const, varianten: n };
    });
    if (r.art === "angelegt") ergebnis.angelegt.push({ berichtId: kandidat.id, varianten: r.varianten });
    else if (r.art === "uebersprungen") ergebnis.uebersprungen.push({ berichtId: kandidat.id, grund: r.grund });
  }
  return ergebnis;
}
