import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { Db } from "@carraway/db";
import { aktuellerAkteur, sichtbareFonds } from "../anmeldung/akteur";
import { EXPORT_TABELLEN } from "../export/vollexport";
import { liste } from "../import/sql";
import { pruefe } from "../pruefung";
import { lese } from "../zeitlimit";

/**
 * Änderungsabfrage: `GET /changes?since=<Zeitpunkt>&table=&cursor=&limit=` liefert die Zeilen des Änderungsprotokolls in fester
 * Reihenfolge (Zeitpunkt, ID), seitenweise mit undurchsichtigem `nextCursor`. `table` und `action` tragen die Kennungen des Protokolls
 * (Namen der Datenbank), nicht die Begriffe der Schnittstelle. Es erscheinen nur Änderungen an Geschäftsdaten (keine
 * Benutzer, Rollen, Schlüssel, Importläufe, Lesezugriffe) und nur zu Fonds, an denen die Person mindestens Betrachter ist; Datensätze ohne
 * Fonds (Kontakte, Deals ohne Fonds, Unternehmensrunden) sieht jede Person mit einer Rolle, wie in den Listen. Anteilsklassen eines Unternehmens
 * (Etappe 10) sehen nur Personen mit Rolle an einem Fonds, der eine Beteiligung an dem Unternehmen hält (Auflösung über die Beteiligungen, wie bei den Routen).
 *
 * Hinweis für Aufrufer: Transaktionen schreiben mit dem Zeitpunkt ihres Beginns. Eine längere Transaktion kann deshalb Zeilen
 * festschreiben, deren Zeitpunkt vor dem zuletzt gelesenen liegt. Wer lückenlos abfragen will, beginnt jede Abfrage mit etwas
 * Überlappung (z. B. `since` 5 Minuten vor dem letzten Stand) und entfernt Doppelte über die `id`.
 */

const NICHT_IM_FEED = new Set(["benutzer", "fondsrolle", "rechterolle", "nutzergruppe", "rechte_einstellung", "investor_benutzer", "investor_zugang", "api_schluessel", "aenderung", "import_lauf", "import_befund", "import_zuordnung", "runde_buchung", "dokument", "dokument_verknuepfung", "wert_quelle", "aktivitaet_sync", "benutzer_einstellung"]);
export const FEED_TABELLEN = EXPORT_TABELLEN.map((t) => t.name).filter((n) => !NICHT_IM_FEED.has(n));
/**
 * Tabellen, deren Datensätze ohne Fonds vorkommen und für jede Person mit Rolle sichtbar sind. Gemischte Tabellen (Beziehungen, Deals) stehen
 * hier nur mit den Zeilen, deren Stand (auch der gelöschte) keinen Fonds trägt; der Trigger setzt `fonds_id` sonst aus `vorher` oder `nachher`.
 */
const OHNE_FONDS = ["organisation", "vehikel", "person", "kontaktrolle", "organisationsbeziehung", "deal", "deal_phasenwechsel", "beschluss", "aktivitaet", "kennzahl_definition", "foerderprogramm", "melde_definition", "organisation_meldedaten"];

const organisationDerRunde = sql`coalesce(a.nachher->>'organisationId', a.vorher->>'organisationId')::uuid`;

/** Dieselbe Beziehung zum Unternehmen wie bei den Runden im Portfolio. */
function unternehmenSichtbar(fonds: string[], organisationId: ReturnType<typeof sql>) {
  const f = liste(fonds, "uuid");
  return sql`(EXISTS (SELECT 1 FROM beteiligung sb WHERE sb.fonds_id = ANY(${f}) AND sb.organisation_id = ${organisationId})
    OR EXISTS (SELECT 1 FROM rundenposition sp JOIN finanzierungsrunde sr ON sr.id = sp.runde_id
      WHERE sr.organisation_id = ${organisationId} AND sr.status = 'abgeschlossen' AND sp.fonds_id = ANY(${f})))`;
}

/** Die eigene Position gewährt Zugriff auf die Runde, einschließlich ihres Entwurfs. */
function rundeSichtbar(fonds: string[], rundeId: ReturnType<typeof sql>, organisationId: ReturnType<typeof sql>) {
  return sql`(${unternehmenSichtbar(fonds, organisationId)}
    OR EXISTS (SELECT 1 FROM rundenposition sp WHERE sp.runde_id = ${rundeId} AND sp.fonds_id = ANY(${liste(fonds, "uuid")})))`;
}

/** Gespeicherte Anteilszahlen können aus dem Pool abgeleitet sein. Das gilt auch für ältere Änderungen. */
export function feedStaende(fonds: string[] | "alle") {
  if (fonds === "alle") return sql`a.vorher, a.nachher`;
  const schuetzen = sql`a.tabelle = 'finanzierungsrunde' AND NOT ${unternehmenSichtbar(fonds, organisationDerRunde)}`;
  return sql`
    CASE WHEN ${schuetzen} THEN a.vorher - 'anteileGesamtNach' - 'anteile_gesamt_nach' ELSE a.vorher END AS vorher,
    CASE WHEN ${schuetzen} THEN a.nachher - 'anteileGesamtNach' - 'anteile_gesamt_nach' ELSE a.nachher END AS nachher`;
}

/**
 * Sichtbarkeit einer Zeile `a` des Änderungsprotokolls für eine Person mit diesen Fonds (Bereich `alle`, siehe `rechte/bereiche.ts`). Gemeinsame
 * Grundlage der Änderungsabfrage, der Webhooks und der Live-Aktualisierung (`ereignisse/quelle.ts`): Alle drei zeigen dieselben Zeilen.
 */
export function feedSichtbar(fonds: string[] | "alle") {
  if (fonds === "alle") return sql`TRUE`;
  const ids = liste(fonds, "uuid");
  // Bei älteren Löschungen fehlt die Fonds-ID. Der verknüpfte Deal bestimmt die Sichtbarkeit,
  // solange seine Fondszuordnung seither unverändert ist. Fehlende oder mehrdeutige Zuordnungen bleiben verborgen.
  const aktivitaetSichtbar = sql`(a.tabelle <> 'aktivitaet' OR a.aktion <> 'loeschen' OR a.vorher->>'dealId' IS NULL OR EXISTS (
    SELECT 1 FROM deal d WHERE d.id = (a.vorher->>'dealId')::uuid AND (d.fonds_id IS NULL OR d.fonds_id = ANY(${ids}))
      AND NOT EXISTS (SELECT 1 FROM aenderung wechsel WHERE wechsel.tabelle = 'deal' AND wechsel.datensatz_id = d.id
        AND wechsel.am >= a.am AND wechsel.vorher->>'fondsId' IS DISTINCT FROM wechsel.nachher->>'fondsId')
  ))`;
  // Änderungen an Zielfondspositionen enthalten auch im Metadaten-Feed die Kennungen ihrer Einzelbuchungen.
  return sql`(CASE WHEN a.tabelle IN ('zielfonds_beteiligung', 'zielfonds_meldung', 'zielfonds_bewegung') THEN
      EXISTS (SELECT 1 FROM zielfonds_beteiligung z
        WHERE z.id = CASE WHEN a.tabelle = 'zielfonds_beteiligung' THEN a.datensatz_id
                          ELSE coalesce(a.nachher->>'beteiligungId', a.vorher->>'beteiligungId')::uuid END
          AND z.fonds_id = ANY(${ids}) AND (z.zielfonds_id IS NULL OR z.zielfonds_id = ANY(${ids})))
    ELSE a.fonds_id = ANY(${ids}) END OR (a.fonds_id IS NULL AND a.tabelle = ANY(${liste(OHNE_FONDS, "text")}) AND aenderung_fonds_aus_staenden(a.vorher, a.nachher) IS NULL AND ${aktivitaetSichtbar})
            OR (a.tabelle = 'finanzierungsrunde' AND ${rundeSichtbar(fonds, sql`a.datensatz_id`, organisationDerRunde)})
            OR (a.tabelle = 'rundenposition_zahlung' AND EXISTS (SELECT 1 FROM rundenposition zp JOIN finanzierungsrunde zr ON zr.id = zp.runde_id
              WHERE zp.id::text = coalesce(a.nachher->>'positionId', a.vorher->>'positionId') AND ${rundeSichtbar(fonds, sql`zr.id`, sql`zr.organisation_id`)}))
            OR (a.tabelle = 'anteilsklasse' AND EXISTS (SELECT 1 FROM beteiligung b WHERE b.fonds_id = ANY(${liste(fonds, "uuid")}) AND b.organisation_id::text = coalesce(a.nachher->>'organisationId', a.nachher->>'organisation_id', a.vorher->>'organisationId', a.vorher->>'organisation_id'))))`;
}

const kodiere = (am: string, id: string) => Buffer.from(JSON.stringify([am, id])).toString("base64url");
function dekodiere(cursor: string): [string, string] | null {
  try {
    const wert: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (Array.isArray(wert) && typeof wert[0] === "string" && typeof wert[1] === "string" && z.uuid().safeParse(wert[1]).success && z.iso.datetime({ offset: true, precision: 6 }).safeParse(wert[0]).success) return [wert[0], wert[1]];
  } catch {
    // ungültiger Cursor: als Eingabefehler gemeldet
  }
  return null;
}

const abfrage = z.object({
  since: z.iso.datetime({ offset: true }).optional(),
  table: z.enum(FEED_TABELLEN as [string, ...string[]]).optional(),
  cursor: z
    .string()
    .max(500)
    .refine((c) => dekodiere(c) !== null, { message: "Invalid cursor" })
    .optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
});

export function aenderungenRouten(db: Db) {
  return new Hono().get("/", pruefe("query", abfrage), async (c) => {
    const { since: seit, table: tabelle, cursor, limit } = c.req.valid("query");
    const akteur = aktuellerAkteur(c);
    const fonds = sichtbareFonds(akteur);
    const position = cursor ? dekodiere(cursor) : null;
    const zeilen = await lese(db, async (tx) => {
      const { rows } = await tx.execute<{ id: string; am: string; akteur: string; akteur_name: string | null; aktion: string; tabelle: string; datensatz_id: string; fonds_id: string | null; vorher: unknown; nachher: unknown }>(sql`
        SELECT a.id, to_char(a.am AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS am, a.akteur, a.akteur_name, a.aktion, a.tabelle, a.datensatz_id, a.fonds_id, ${feedStaende(fonds)}
        FROM aenderung a
        WHERE a.aktion <> 'gelesen'
          AND a.tabelle = ANY(${liste(tabelle ? [tabelle] : FEED_TABELLEN, "text")})
          ${fonds === "alle" ? sql`` : sql`AND ${feedSichtbar(fonds)}`}
          ${position ? sql`AND (a.am, a.id) > (${position[0]}::timestamptz, ${position[1]}::uuid)` : seit ? sql`AND a.am > ${seit}::timestamptz` : sql``}
        ORDER BY a.am, a.id
        LIMIT ${limit + 1}`);
      return rows;
    });
    const seite = zeilen.slice(0, limit);
    const letzte = seite.at(-1);
    return c.json(
      {
        data: seite.map((z) => ({ id: z.id, at: z.am, actor: z.akteur, actorName: z.akteur_name, action: z.aktion, table: z.tabelle, recordId: z.datensatz_id, fundId: z.fonds_id, before: z.vorher, after: z.nachher })),
        hasMore: zeilen.length > limit,
        // Auch ohne weitere Seite gibt es einen Cursor: Er merkt den Stand für die nächste Abfrage.
        nextCursor: letzte ? kodiere(letzte.am, letzte.id) : (cursor ?? null),
      },
      200,
    );
  });
}
