import { sql } from "drizzle-orm";
import type { Db } from "@carraway/db";
import { NEUBERECHNUNG } from "../jobs";
import { REGISTER_PRUEFUNG } from "../register/beobachtung";
import { lese } from "../zeitlimit";

/**
 * Betriebszustand aus der Datenbank: Herzschlag des Workers, Warteschlange in pg-boss und Ausgangskorb.
 *
 * Der Worker schreibt alle paar Sekunden eine Zeile in `pgboss.carraway_herzschlag` (eine Tabelle im pg-boss-Schema, vom
 * Worker selbst angelegt; so braucht es keine eigene Migration). Die Warteschlange misst der Verzug des ältesten fälligen
 * Jobs. Der Ausgangskorb (`snapshot_auftrag`) zählt mit: Der Worker leert ihn in pg-boss, bei einem toten Worker wächst er,
 * während pg-boss leer aussieht.
 */

export const HERZSCHLAG_TABELLE = "pgboss.carraway_herzschlag";
/** Älter als das: Der Worker gilt als ausgefallen. */
export const HERZSCHLAG_GRENZE_SEKUNDEN = 30;

export interface Betriebszustand {
  worker: { status: "ok" | "ausgefallen" | "unbekannt"; herzschlagAlterSekunden: number | null };
  /** `null`: pg-boss ist (noch) nicht eingerichtet oder nicht lesbar. */
  warteschlange: { jeZustand: Record<string, number>; wartend: number; aeltesterWartenderSekunden: number } | null;
  ausgangskorb: { anzahl: number; aeltesterSekunden: number } | null;
  /** Fällige, noch nicht versendete Mails (`wartend`, Zeitpunkt des nächsten Versuchs erreicht). */
  mail: Rueckstand | null;
  /** KI-Auslesungen, die noch nicht laufen (`wartend`, `eingereiht`). */
  auslesung: Rueckstand | null;
  /** Fällige Läufe der Registerbeobachtung in pg-boss (`null`: pg-boss nicht eingerichtet). */
  register: Rueckstand | null;
}

/** Wartende Arbeit: Anzahl und Alter der ältesten in Sekunden (0 = leer). */
export interface Rueckstand {
  anzahl: number;
  aeltesterSekunden: number;
}

async function versuche<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

export async function leseBetriebszustand(db: Db): Promise<Betriebszustand> {
  const worker = await versuche(() =>
    lese(db, async (tx) => {
      const { rows: da } = await tx.execute<{ ja: boolean }>(sql`SELECT to_regclass(${HERZSCHLAG_TABELLE}) IS NOT NULL AS ja`);
      if (!da[0]?.ja) return null;
      const { rows } = await tx.execute<{ alter: number | null }>(sql`SELECT EXTRACT(EPOCH FROM now() - max(zeit))::float8 AS alter FROM pgboss.carraway_herzschlag`);
      return rows[0]?.alter ?? null;
    }),
  );
  const warteschlange = await versuche(() =>
    lese(db, async (tx) => {
      const { rows: da } = await tx.execute<{ ja: boolean }>(sql`SELECT to_regclass('pgboss.job') IS NOT NULL AS ja`);
      if (!da[0]?.ja) return null;
      const { rows } = await tx.execute<{ state: string; n: number; verzug: number | null }>(sql`
        SELECT state::text AS state, count(*)::int AS n,
               EXTRACT(EPOCH FROM now() - min(start_after) FILTER (WHERE state IN ('created', 'retry') AND start_after <= now()))::float8 AS verzug
        FROM pgboss.job WHERE name = ${NEUBERECHNUNG} GROUP BY state`);
      const jeZustand = Object.fromEntries(rows.map((z) => [z.state, z.n]));
      const verzug = Math.max(0, ...rows.map((z) => z.verzug ?? 0));
      return { jeZustand, wartend: (jeZustand.created ?? 0) + (jeZustand.retry ?? 0), aeltesterWartenderSekunden: Math.round(verzug * 10) / 10 };
    }),
  );
  const ausgangskorb = await versuche(() =>
    lese(db, async (tx) => {
      const { rows } = await tx.execute<{ n: number; alter: number | null }>(sql`SELECT count(*)::int AS n, EXTRACT(EPOCH FROM now() - min(angelegt_am))::float8 AS alter FROM snapshot_auftrag`);
      return { anzahl: rows[0]?.n ?? 0, aeltesterSekunden: Math.round((rows[0]?.alter ?? 0) * 10) / 10 };
    }),
  );
  const rueckstand = (zeilen: { n: number; alter: number | null }[]): Rueckstand => ({ anzahl: zeilen[0]?.n ?? 0, aeltesterSekunden: Math.max(0, Math.round((zeilen[0]?.alter ?? 0) * 10) / 10) });
  const mail = await versuche(() =>
    lese(db, async (tx) => {
      const { rows } = await tx.execute<{ n: number; alter: number | null }>(
        sql`SELECT count(*)::int AS n, EXTRACT(EPOCH FROM now() - min(naechster_versuch_am))::float8 AS alter FROM mail_auftrag WHERE status = 'wartend' AND naechster_versuch_am <= now()`,
      );
      return rueckstand(rows);
    }),
  );
  const auslesung = await versuche(() =>
    lese(db, async (tx) => {
      const { rows } = await tx.execute<{ n: number; alter: number | null }>(
        sql`SELECT count(*)::int AS n, EXTRACT(EPOCH FROM now() - min(angefordert_am))::float8 AS alter FROM auslesung WHERE status IN ('wartend', 'eingereiht')`,
      );
      return rueckstand(rows);
    }),
  );
  const register = await versuche(() =>
    lese(db, async (tx) => {
      const { rows: da } = await tx.execute<{ ja: boolean }>(sql`SELECT to_regclass('pgboss.job') IS NOT NULL AS ja`);
      if (!da[0]?.ja) return null;
      const { rows } = await tx.execute<{ n: number; alter: number | null }>(
        sql`SELECT count(*)::int AS n, EXTRACT(EPOCH FROM now() - min(start_after))::float8 AS alter FROM pgboss.job WHERE name = ${REGISTER_PRUEFUNG} AND state IN ('created', 'retry') AND start_after <= now()`,
      );
      return rueckstand(rows);
    }),
  );
  return {
    mail,
    auslesung,
    register,
    worker: {
      herzschlagAlterSekunden: worker === null ? null : Math.round(worker * 10) / 10,
      status: worker === null ? "unbekannt" : worker <= HERZSCHLAG_GRENZE_SEKUNDEN ? "ok" : "ausgefallen",
    },
    warteschlange,
    ausgangskorb,
  };
}

/** Legt die Herzschlag-Tabelle an (idempotent); der Worker ruft das beim Start auf. */
export async function richteHerzschlagEin(db: Db): Promise<void> {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS pgboss.carraway_herzschlag (name text PRIMARY KEY, zeit timestamptz NOT NULL DEFAULT now(), verarbeitet bigint NOT NULL DEFAULT 0)`);
  // Container-Namen wechseln bei jedem Start; alte Zeilen räumen.
  await db.execute(sql`DELETE FROM pgboss.carraway_herzschlag WHERE zeit < now() - interval '1 day'`);
}

/** Schreibt den Herzschlag des Workers `name`; `verarbeitet` zählt die seit dem Start erledigten Jobs. */
export async function schreibeHerzschlag(db: Db, name: string, verarbeitet: number): Promise<void> {
  await db.execute(sql`INSERT INTO pgboss.carraway_herzschlag (name, zeit, verarbeitet) VALUES (${name}, now(), ${verarbeitet})
    ON CONFLICT (name) DO UPDATE SET zeit = now(), verarbeitet = EXCLUDED.verarbeitet`);
}
