import { loggerAusUmgebung } from "../beobachtung/protokoll";
import { sql } from "drizzle-orm";
import type { Db } from "@carraway/db";
import { berechneFondsUebersicht, bewertungsAenderung, juengsterEingang, standardStichtag, type FondsUebersicht } from "./fonds";
import { schreibe } from "../schreiben";
import { hatZielfonds, ZIELFONDS_SCHRITT, zielfondsEingang } from "./zielfonds";
import { lese, type Tx } from "../zeitlimit";

/**
 * Kennzahlen-Snapshots (Performance-Regel 1, TECH-STACK.md): Seiten lesen, der Worker rechnet.
 * Ein Snapshot ist die vollständige Fondsübersicht eines Stichtags, berechnet mit dem Wissensstand
 * `stand_bis` (jüngster Erfassungszeitpunkt der Eingangsdaten bei der Berechnung). Gibt es neuere
 * Eingangsdaten, ist er veraltet.
 */

export interface SnapshotInfo {
  berechnetAm: string;
  veraltet: boolean;
}

export interface GelesenerSnapshot {
  quellenstand: string;
  uebersicht: FondsUebersicht;
  /** `null`, wenn der Stichtag nicht gespeichert wird (live gerechnet). */
  snapshot: SnapshotInfo | null;
}

/** Höchstzahl Stichtage, die ein Neuberechnungs-Job rechnet; ältere fallen weg. */
export const MAX_STICHTAGE_JE_JOB = 40;

/** Quartalsende: 31.03., 30.06., 30.09. oder 31.12. */
export const istQuartalsende = (stichtag: string) => /-(03-31|06-30|09-30|12-31)$/.test(stichtag);

/** Erstes Quartalsende am oder nach dem Datum (`YYYY-MM-DD`). */
export function quartalsendeAmOderNach(datum: string): string {
  const jahr = Number(datum.slice(0, 4));
  for (const md of ["03-31", "06-30", "09-30", "12-31"]) if (`${jahr}-${md}` >= datum) return `${jahr}-${md}`;
  return `${jahr + 1}-03-31`;
}

/** Zeitfenster, in dem Quartalsenden gespeichert werden: ab dem ersten Eingang des Fonds bis zum Standard-Stichtag. */
export async function speicherFenster(tx: Pick<Tx, "execute">, fondsId: string): Promise<{ von: string | null; bis: string }> {
  const bis = await standardStichtag(tx, fondsId);
  const { rows } = await tx.execute<{ erster: string | null }>(sql`
    SELECT least(
      (SELECT min(valuta) FROM fonds_bewegung WHERE fonds_id = ${fondsId}),
      (SELECT min(v.valuta) FROM vorgang v JOIN beteiligung b ON b.id = v.beteiligung_id WHERE b.fonds_id = ${fondsId}),
      (SELECT min(w.valuta) FROM zielfonds_bewegung w JOIN zielfonds_beteiligung z ON z.id = w.beteiligung_id WHERE z.fonds_id = ${fondsId})
    )::text AS erster`);
  const erster = rows[0]?.erster ?? null;
  return { von: erster === null ? null : quartalsendeAmOderNach(erster), bis };
}

const imFenster = (stichtag: string, f: { von: string | null; bis: string }) => stichtag === f.bis || (istQuartalsende(stichtag) && f.von !== null && stichtag >= f.von && stichtag <= f.bis);

/**
 * Gespeichert werden nur der Standard-Stichtag und Quartalsenden zwischen dem ersten Eingang des Fonds und dem
 * Standard-Stichtag. Alles andere (mitten im Quartal, vor dem Start, in der Zukunft) wird live gerechnet; so kann ein
 * Client keine beliebig vielen Snapshots anlegen.
 */
export async function wirdGespeichert(tx: Pick<Tx, "execute">, fondsId: string, stichtag: string): Promise<boolean> {
  return imFenster(stichtag, await speicherFenster(tx, fondsId));
}

type Abfrage = Pick<Tx, "execute">;

/** Liest den Snapshot samt Veraltet-Kennzeichen in einer Abfrage; `null`, wenn es keinen gibt. */
export async function ladeSnapshot(tx: Abfrage, fondsId: string, stichtag: string): Promise<GelesenerSnapshot | null> {
  const { rows } = await tx.execute<{ daten: FondsUebersicht; quellenstand: string; berechnet_am: string; veraltet: boolean }>(sql`
    SELECT s.daten, to_json(coalesce(s.stand_bis, s.berechnet_am)) #>> '{}' AS quellenstand, (to_json(s.berechnet_am) #>> '{}') AS berechnet_am,
           (e.t IS NOT NULL AND (s.stand_bis IS NULL OR e.t > s.stand_bis)) AS veraltet
    FROM kennzahl_snapshot s
    CROSS JOIN LATERAL (
      SELECT greatest(
        (SELECT max(erfasst_am) FROM fonds_bewegung WHERE fonds_id = s.fonds_id),
        (SELECT max(z.erfasst_am) FROM lp_zahlung z JOIN fonds_bewegung fb ON fb.id = z.bewegung_id WHERE fb.fonds_id = s.fonds_id),
        (SELECT max(m) FROM (SELECT (SELECT max(erfasst_am) FROM vorgang WHERE beteiligung_id = b.id) AS m FROM beteiligung b WHERE b.fonds_id = s.fonds_id) x),
        (SELECT max(m) FROM (SELECT ${sql.raw(bewertungsAenderung("b.id"))} AS m FROM beteiligung b WHERE b.fonds_id = s.fonds_id) y),
        (SELECT max(i.erstellt_am) FROM instrument i JOIN beteiligung b ON b.id = i.beteiligung_id WHERE b.fonds_id = s.fonds_id),
        ${zielfondsEingang(sql`s.fonds_id`)}
      ) AS t
    ) e
    WHERE s.fonds_id = ${fondsId} AND s.stichtag = ${stichtag}::date AND s.daten ? 'portfoliowert'
      AND NOT EXISTS (SELECT 1 FROM saldenlauf l WHERE l.fonds_id = s.fonds_id AND l.zeitraum_bis = s.stichtag
        AND greatest(l.uebernommen_am, l.ersetzt_am) > coalesce(s.stand_bis, '-infinity'::timestamptz))`);
  const zeile = rows[0];
  if (!zeile?.daten.kennzahlen.eingezahlt) return null;
  // Ältere Dachfonds-Snapshots enthalten nur die Summe und die ungekürzte Liste der Quellen.
  if (!zeile.daten.zielfonds && zeile.daten.kennzahlen.nav.schritte.some((s) => s.bezeichnung === ZIELFONDS_SCHRITT)) return null;
  return { quellenstand: zeile.quellenstand, uebersicht: zeile.daten, snapshot: { berechnetAm: new Date(zeile.berechnet_am).toISOString(), veraltet: zeile.veraltet } };
}

/**
 * Rechnet die Übersicht mit dem aktuellen Wissensstand und speichert sie als Snapshot (ersetzt einen vorhandenen).
 * Gerechnet wird mit `stand = stand_bis`, damit der Snapshot genau zu den Eingangsdaten passt, die `stand_bis` abdeckt.
 */
export async function rechneUndSpeichere(tx: Tx, fondsId: string, stichtag: string): Promise<GelesenerSnapshot> {
  if (!(await wirdGespeichert(tx, fondsId, stichtag))) throw new Error(`Stichtag ${stichtag} wird nicht als Snapshot gespeichert`);
  const standBis = await juengsterEingang(tx, fondsId);
  const uebersicht = await berechneFondsUebersicht(tx, fondsId, stichtag, standBis ?? undefined);
  const { rows } = await tx.execute<{ berechnet_am: string; quellenstand: string }>(sql`
    INSERT INTO kennzahl_snapshot (fonds_id, stichtag, stand_bis, berechnet_am, daten)
    VALUES (${fondsId}, ${stichtag}::date, ${standBis}::timestamptz, now(), ${JSON.stringify(uebersicht)}::jsonb)
    ON CONFLICT (fonds_id, stichtag) DO UPDATE
      SET stand_bis = EXCLUDED.stand_bis, berechnet_am = EXCLUDED.berechnet_am, daten = EXCLUDED.daten
    RETURNING (to_json(berechnet_am) #>> '{}') AS berechnet_am, to_json(coalesce(stand_bis, berechnet_am)) #>> '{}' AS quellenstand`);
  const berechnetAm = new Date((rows[0] as { berechnet_am: string }).berechnet_am).toISOString();
  return { quellenstand: rows[0]!.quellenstand, uebersicht, snapshot: { berechnetAm, veraltet: false } };
}

/**
 * Snapshot für `GET /fonds/:id/uebersicht`: vorhanden → lesen; sonst einmal synchron rechnen und speichern.
 * Das Speichern läuft über `schreibe()` (Zeitgrenzen), nicht in der Lese-Transaktion.
 */
export async function holeSnapshot(db: Db, akteur: Parameters<typeof schreibe>[1], fondsId: string, stichtagVorgabe?: string): Promise<GelesenerSnapshot> {
  const gelesen = await lese(db, async (tx) => {
    const stichtag = stichtagVorgabe ?? (await standardStichtag(tx, fondsId));
    const vorhanden = await ladeSnapshot(tx, fondsId, stichtag);
    // Beim Dachfonds beziehen auch Excel, Bericht und Dashboard die aktuelle NAV aus den zugrunde liegenden Fonds.
    if (vorhanden && (!vorhanden.snapshot?.veraltet || !(await hatZielfonds(tx, fondsId)))) return { stichtag, vorhanden, live: null };
    if (await wirdGespeichert(tx, fondsId, stichtag)) return { stichtag, vorhanden: null, live: null };
    const { rows } = await tx.execute<{ stand: string }>(sql`SELECT to_json(now()) #>> '{}' AS stand`);
    const quellenstand = rows[0]!.stand;
    return { stichtag, vorhanden: null, live: { quellenstand, uebersicht: await berechneFondsUebersicht(tx, fondsId, stichtag, quellenstand), snapshot: null } };
  });
  if (gelesen.vorhanden) return gelesen.vorhanden;
  if (gelesen.live) return gelesen.live;
  return schreibe(db, akteur, (tx) => rechneUndSpeichere(tx, fondsId, gelesen.stichtag));
}

/** Stichtage, die der Worker neu rechnet: vorhandene Snapshots im Speicherfenster plus der Standard-Stichtag, höchstens `maximal` (die jüngsten). */
export async function stichtageZumNeuRechnen(tx: Abfrage, fondsId: string, maximal = MAX_STICHTAGE_JE_JOB): Promise<string[]> {
  const { rows } = await tx.execute<{ stichtag: string }>(sql`SELECT stichtag::text AS stichtag FROM kennzahl_snapshot WHERE fonds_id = ${fondsId} ORDER BY stichtag`);
  const fenster = await speicherFenster(tx, fondsId);
  const stichtage = new Set(rows.map((r) => r.stichtag).filter((st) => imFenster(st, fenster)));
  stichtage.add(fenster.bis);
  // Alle liegen höchstens beim Standard-Stichtag; bei Überschreitung bleiben die jüngsten.
  const alle = [...stichtage].sort();
  if (alle.length <= maximal) return alle;
  const behalten = alle.slice(alle.length - maximal);
  loggerAusUmgebung("worker")("warn", "Neuberechnung: älteste Stichtage über der Grenze ausgelassen", { fondsId, ausgelassen: alle.length - maximal, grenze: maximal, bis: alle[alle.length - maximal - 1] });
  return behalten;
}
