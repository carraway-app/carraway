import { sql } from "drizzle-orm";
import { PgBoss } from "pg-boss";
import type { Db } from "@carraway/db";
import { fehlerFelder, loggerAusUmgebung, type Logger } from "./beobachtung/protokoll";
import { rechneUndSpeichere, stichtageZumNeuRechnen, wirdGespeichert } from "./kennzahlen/snapshot";
import { schreibe } from "./schreiben";
import { lese } from "./zeitlimit";
import { REGISTER_PRUEFUNG } from "./register/beobachtung";
import { WARTESCHLANGE, WEBHOOK_ZUSTELLUNG } from "./webhooks/zustellung";
import type { ApiErweiterung } from "./erweiterung";

/**
 * Warteschlange für Neuberechnungen der Kennzahlen-Snapshots mit pg-boss (Tabellen im Schema `pgboss` derselben Datenbank).
 *
 * Ablauf: Trigger auf vorgang, bewertung und fonds_bewegung (jeder Schreibweg, auch das Seed-Skript) legen in
 * derselben Transaktion eine Zeile in `snapshot_auftrag` an, `POST /fonds/:id/neuberechnen` ebenso. Der Worker
 * übergibt diese Zeilen mit `verteileAuftraege` an pg-boss; ein Job rechnet je Fonds alle Snapshot-Stichtage neu.
 * So geht kein Auftrag verloren, wenn der Prozess zwischen Schreiben und Einreihen stirbt.
 */

export const NEUBERECHNUNG = "kennzahl-neuberechnung";

export interface NeuberechnungsJob {
  fondsId: string;
  /** Leer = alle vorhandenen Snapshot-Stichtage plus den Standard-Stichtag. */
  stichtag: string | null;
}

export async function starteJobs(url: string, logger: Logger = loggerAusUmgebung("worker"), erweiterungen: readonly ApiErweiterung[] = []): Promise<PgBoss> {
  // Mit `PGBOSS_SCHEMA_ANLEGEN=0` legt pg-boss das Schema `pgboss` nicht an (`CREATE SCHEMA` verlangt das Recht CREATE auf der
  // ganzen Datenbank). `deploy/sql/mandant.sql` legt es der App-Rolle gehörend vorab an; Tabellen darin legt pg-boss selbst an.
  const boss = new PgBoss({ connectionString: url, createSchema: process.env.PGBOSS_SCHEMA_ANLEGEN !== "0" });
  boss.on("error", (fehler) => logger("error", "pg-boss-Fehler", fehlerFelder(fehler)));
  await boss.start();
  // `short`: je Schlüssel höchstens ein wartender Job; eine Änderung während der Berechnung reiht einen weiteren ein.
  await boss.createQueue(NEUBERECHNUNG, { policy: "short", retryLimit: 3, retryDelay: 5 });
  // Registerbeobachtung (Etappe 18): geplant nur, wenn der Worker einen Plan und einen Anbieter hat.
  await boss.createQueue(REGISTER_PRUEFUNG, { retryLimit: 0, expireInSeconds: 1800 });
  // Webhooks (#154): eine Zustellung je Job, Wiederholung mit wachsender Wartezeit (`webhooks/zustellung.ts`).
  await boss.createQueue(WEBHOOK_ZUSTELLUNG, { ...WARTESCHLANGE });
  // Warteschlangen der Erweiterungen (z. B. die KI-Auslesung).
  for (const e of erweiterungen) await e.warteschlangen?.(boss);
  return boss;
}

/** Übergibt die Zeilen des Ausgangskorbs an pg-boss und entfernt sie (eine Transaktion; bei Fehler bleiben sie liegen). */
export function verteileAuftraege(db: Db, boss: PgBoss): Promise<number> {
  return schreibe(db, "system", async (tx) => {
    const { rows } = await tx.execute<{ fonds_id: string; stichtag: string | null }>(
      sql`DELETE FROM snapshot_auftrag RETURNING fonds_id, stichtag::text AS stichtag`,
    );
    for (const z of rows) {
      const daten: NeuberechnungsJob = { fondsId: z.fonds_id, stichtag: z.stichtag };
      await boss.send(NEUBERECHNUNG, daten, { singletonKey: `${z.fonds_id}:${z.stichtag ?? "alle"}` });
    }
    return rows.length;
  });
}

/** Rechnet die Snapshots eines Fonds neu; je Stichtag eine eigene Transaktion über `schreibe()`. */
export async function verarbeiteNeuberechnung(db: Db, job: NeuberechnungsJob): Promise<string[]> {
  const stichtage = await lese(db, async (tx) => {
    const { rows } = await tx.execute(sql`SELECT 1 FROM fonds WHERE id = ${job.fondsId}`);
    if (rows.length === 0) return [];
    if (!job.stichtag) return stichtageZumNeuRechnen(tx, job.fondsId);
    return (await wirdGespeichert(tx, job.fondsId, job.stichtag)) ? [job.stichtag] : [];
  });
  for (const stichtag of stichtage) await schreibe(db, "system", (tx) => rechneUndSpeichere(tx, job.fondsId, stichtag));
  return stichtage;
}

/** Verarbeitet alle wartenden Jobs einmal (für Tests und Skripte); der Dauerbetrieb nutzt `boss.work`. */
export async function arbeiteAb(db: Db, boss: PgBoss): Promise<number> {
  let anzahl = 0;
  for (;;) {
    const jobs = await boss.fetch<NeuberechnungsJob>(NEUBERECHNUNG, { batchSize: 20 });
    if (jobs.length === 0) return anzahl;
    for (const job of jobs) {
      try {
        await verarbeiteNeuberechnung(db, job.data);
        await boss.complete(NEUBERECHNUNG, job.id);
        anzahl++;
      } catch (fehler) {
        await boss.fail(NEUBERECHNUNG, job.id, { meldung: fehler instanceof Error ? fehler.message : String(fehler) });
        throw fehler;
      }
    }
  }
}
