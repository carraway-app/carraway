import { sql } from "drizzle-orm";
import type { Db } from "@carraway/db";
import type { Speicher } from "../berichte/speicher";
import type { Logger } from "../beobachtung/protokoll";
import { schreibe } from "../schreiben";
import { lese, type Tx } from "../zeitlimit";

/**
 * Aufbewahrung gelöschter Dokumente. Löscht jemand ein Dokument, bleibt die Datei `DOKUMENT_AUFBEWAHRUNG_TAGE` Tage (Vorgabe 30) in der Ablage; danach
 * entfernt der Worker sie. Mehrere Dokumente mit denselben Bytes teilen sich eine Datei (Schlüssel aus dem SHA-256), deshalb fällt die Datei erst weg,
 * wenn alle Zeilen, die auf sie zeigen, gelöscht und abgelaufen sind und nichts anderes sie braucht: keine Fundstelle (`wert_quelle`), kein
 * Registereintrag mit Auszug, kein Beleg, Bericht oder keine Mitteilung mit demselben Schlüssel oder derselben Prüfsumme. (Berichts-, Beleg- und Mitteilungsdateien
 * liegen unter eigenen Schlüsseln; der Vergleich der Prüfsumme hält die Datei trotzdem, wenn dort dieselben Bytes verwendet werden.) Die Metadaten bleiben mit dem Status
 * `endgueltig_geloescht`; der Text der Seiten (`dokument_seite`) wird mit der Datei entfernt. Jede Löschung steht im Änderungsprotokoll.
 */

/** Nur Dateien dieser Ablage-Gruppe entfernt der Lauf; Berichte, Belege und Meldungen bleiben tabu. */
const DOKUMENT_SCHLUESSEL = /^dokumente\/[0-9a-f]{2}\/[0-9a-f]{64}$/;

/** Warum eine abgelaufene Datei noch gebraucht wird. */
export type Haltegrund = "geteilt" | "fundstelle" | "register" | "beleg";

const TAG_MS = 86_400_000;
export const grenzeFuer = (jetzt: Date, tage: number) => new Date(jetzt.getTime() - tage * TAG_MS);

/** Sperre je Dateischlüssel: Das Anlegen eines Dokuments hält sie geteilt (`speichern.ts`), der Lauf ausschließlich. */
export const sperreSchluessel = (schluessel: string) => sql`hashtextextended(${`dokumentdatei:${schluessel}`}, 0)`;

type Zeile = {
  id: string;
  gespeichert_unter: string;
  dateiname: string;
  groesse: number;
  sha256: string;
  geloescht_am: Date | null;
  geloescht_von: string | null;
};

/** Prüft, ob die Datei noch gebraucht wird; `null` heißt: Sie darf entfernt werden. `ids` sind alle Zeilen mit diesem Schlüssel. */
async function haltegrund(tx: Tx, schluessel: string, sha256: string, ids: string[], grenze: Date): Promise<Haltegrund | null> {
  const liste = sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `);
  const { rows } = await tx.execute<{ grund: Haltegrund | null }>(sql`
    SELECT CASE
      WHEN EXISTS (SELECT 1 FROM dokument WHERE gespeichert_unter = ${schluessel}
                   AND NOT (status IN ('geloescht', 'endgueltig_geloescht') AND geloescht_am IS NOT NULL AND geloescht_am <= ${grenze.toISOString()})) THEN 'geteilt'
      WHEN EXISTS (SELECT 1 FROM wert_quelle WHERE dokument_id IN (${liste})) THEN 'fundstelle'
      WHEN EXISTS (SELECT 1 FROM registereintrag WHERE dokument_id IN (${liste})) THEN 'register'
      WHEN EXISTS (SELECT 1 FROM beleg WHERE datei_schluessel = ${schluessel} OR datei_sha256 = ${sha256})
        OR EXISTS (SELECT 1 FROM bericht WHERE datei_schluessel = ${schluessel} OR datei_sha256 = ${sha256})
        OR EXISTS (SELECT 1 FROM bericht_variante WHERE datei_schluessel = ${schluessel} OR datei_sha256 = ${sha256})
        OR EXISTS (SELECT 1 FROM fonds_mitteilung WHERE datei_schluessel = ${schluessel} OR datei_sha256 = ${sha256}) THEN 'beleg'
      ELSE NULL END AS grund`);
  return rows[0]?.grund ?? null;
}

export interface LoeschErgebnis {
  /** Entfernte Dateien. */
  geloescht: number;
  /** Auf Dokumentzeilen bezogen: so viele Zeilen sind jetzt `endgueltig_geloescht`. */
  dokumente: number;
  /** Abgelaufene Dateien, die wegen eines Verweises bleiben. */
  gehalten: number;
}

export interface LoeschOptionen {
  tage: number;
  jetzt?: () => Date;
  logger?: Logger;
  /** Höchstzahl Dateien, die ein Durchlauf prüft (Standard 2000); Dateien, die bleiben, zählen mit. */
  max?: number;
  /** Größe einer Seite der Kandidaten (Standard 100). */
  seite?: number;
}

/** Entfernt Dateien gelöschter Dokumente nach Ablauf der Frist (siehe oben). Jede Datei in einer eigenen Transaktion; ein Fehler bricht nur diese ab. */
export async function loescheAbgelaufeneDokumente(db: Db, speicher: Speicher, opt: LoeschOptionen): Promise<LoeschErgebnis> {
  const jetzt = (opt.jetzt ?? (() => new Date()))();
  const grenze = grenzeFuer(jetzt, opt.tage);
  const ergebnis: LoeschErgebnis = { geloescht: 0, dokumente: 0, gehalten: 0 };
  if (!speicher.loesche) {
    opt.logger?.("warn", "Dateiablage kann keine Dateien entfernen; Aufbewahrungslauf übersprungen");
    return ergebnis;
  }
  // Kandidaten seitenweise nach Schlüssel: Dateien, die wegen eines Verweises bleiben, bleiben `geloescht` und stehen im nächsten Lauf wieder da; sie dürfen
  // die Kandidaten nicht verstopfen, deshalb läuft der Lauf mit einem Zeiger über alle statt über die ersten N.
  const seitenGroesse = opt.seite ?? 100;
  const obergrenze = opt.max ?? 2000;
  let geprueft = 0;
  let nach = "";
  for (;;) {
    const kandidaten = await lese(db, async (tx) => {
      const { rows } = await tx.execute<{ gespeichert_unter: string }>(sql`
        SELECT DISTINCT gespeichert_unter FROM dokument
        WHERE status = 'geloescht' AND geloescht_am IS NOT NULL AND geloescht_am <= ${grenze.toISOString()} AND gespeichert_unter > ${nach}
        ORDER BY gespeichert_unter LIMIT ${Math.min(seitenGroesse, obergrenze - geprueft)}`);
      return rows.map((r) => r.gespeichert_unter);
    });
    if (kandidaten.length === 0) break;
    nach = kandidaten[kandidaten.length - 1]!;
    geprueft += kandidaten.length;
    await verarbeiteSeite(kandidaten);
    if (geprueft >= obergrenze) break;
  }
  return ergebnis;

  async function verarbeiteSeite(kandidaten: string[]) {
    for (const schluessel of kandidaten) {
      if (!DOKUMENT_SCHLUESSEL.test(schluessel)) {
        opt.logger?.("warn", "Dokument mit unerwartetem Dateischlüssel übersprungen");
        continue;
      }
      try {
        const entfernt = await schreibe(db, "system", async (tx, protokoll) => {
          await tx.execute(sql`SELECT pg_advisory_xact_lock(${sperreSchluessel(schluessel)})`);
          const { rows } = await tx.execute<Zeile & { status: string }>(sql`SELECT id, gespeichert_unter, dateiname, groesse, sha256, geloescht_am, geloescht_von, status FROM dokument WHERE gespeichert_unter = ${schluessel} ORDER BY id FOR UPDATE`);
          const offen = rows.filter((r) => r.status === "geloescht");
          if (offen.length === 0) return { art: "nichts" as const };
          const grund = await haltegrund(tx, schluessel, offen[0]!.sha256, rows.map((r) => r.id), grenze);
          if (grund) return { art: "gehalten" as const, grund };
          const offeneIds = sql.join(offen.map((r) => sql`${r.id}::uuid`), sql`, `);
          await tx.execute(sql`DELETE FROM dokument_seite WHERE dokument_id IN (${offeneIds})`);
          await tx.execute(sql`UPDATE dokument SET status = 'endgueltig_geloescht', text_status = 'kein_text', endgueltig_geloescht_am = ${jetzt.toISOString()} WHERE id IN (${offeneIds})`);
          for (const r of offen) {
            await protokoll("endgueltig_loeschen", "dokument", r.id, { status: "geloescht", geloeschtAm: r.geloescht_am }, { status: "endgueltig_geloescht", sha256: r.sha256, dateiname: r.dateiname, groesse: r.groesse });
          }
          // Zuletzt die Datei: Schlägt das Entfernen fehl, rollt die Transaktion zurück und der nächste Lauf versucht es erneut.
          await speicher.loesche!(schluessel);
          return { art: "entfernt" as const, anzahl: offen.length };
        });
        if (entfernt.art === "entfernt") {
          ergebnis.geloescht++;
          ergebnis.dokumente += entfernt.anzahl;
        } else if (entfernt.art === "gehalten") {
          ergebnis.gehalten++;
        }
      } catch (fehler) {
        opt.logger?.("error", "Dokumentdatei nicht entfernt", { fehlerArt: fehler instanceof Error ? fehler.name : typeof fehler });
      }
    }
  }
}

export interface Ausstehend {
  id: string;
  dateiname: string;
  groesse: number;
  geloeschtAm: string;
  geloeschtVon: string | null;
  /** Wann die Frist abläuft; ab dann entfernt der nächste Lauf die Datei. */
  entferntAb: string;
  faellig: boolean;
  /** Abgelaufen, aber die Datei bleibt, solange dieser Grund besteht. */
  haltegrund: Haltegrund | null;
}

/** Gelöschte Dokumente, deren Datei noch in der Ablage liegt (für die Verwaltung), mit Ablaufdatum und Haltegrund. */
export async function ausstehendeLoeschungen(tx: Tx, tage: number, jetzt: Date, limit = 200): Promise<{ daten: Ausstehend[]; endgueltig: number }> {
  const grenze = grenzeFuer(jetzt, tage);
  const { rows } = await tx.execute<Zeile>(sql`
    SELECT id, gespeichert_unter, dateiname, groesse, sha256, geloescht_am, geloescht_von FROM dokument
    WHERE status = 'geloescht' AND geloescht_am IS NOT NULL
    ORDER BY geloescht_am, id LIMIT ${limit}`);
  const daten: Ausstehend[] = [];
  for (const r of rows) {
    const geloescht = new Date(r.geloescht_am!);
    const faellig = geloescht.getTime() <= grenze.getTime();
    let grund: Haltegrund | null = null;
    if (faellig) {
      const { rows: gleiche } = await tx.execute<{ id: string }>(sql`SELECT id FROM dokument WHERE gespeichert_unter = ${r.gespeichert_unter}`);
      grund = await haltegrund(tx, r.gespeichert_unter, r.sha256, gleiche.map((g) => g.id), grenze);
    }
    daten.push({
      id: r.id,
      dateiname: r.dateiname,
      groesse: r.groesse,
      geloeschtAm: geloescht.toISOString(),
      geloeschtVon: r.geloescht_von,
      entferntAb: new Date(geloescht.getTime() + tage * TAG_MS).toISOString(),
      faellig,
      haltegrund: grund,
    });
  }
  const { rows: z } = await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM dokument WHERE status = 'endgueltig_geloescht'`);
  return { daten, endgueltig: z[0]?.n ?? 0 };
}
