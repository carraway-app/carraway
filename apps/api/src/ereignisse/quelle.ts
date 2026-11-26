import { and, eq, sql } from "drizzle-orm";
import { apiSchluessel, benutzer, investorBenutzer } from "@carraway/db";
import { fuerBereich, rollenAusScopes, sichtbareFonds, type Akteur, type SchluesselScope } from "../anmeldung/akteur";
import { liste } from "../import/sql";
import { ladeRechte } from "../rechte/aufloesung";
import { FEED_TABELLEN, feedSichtbar } from "../routen/aenderungen";
import type { Tx } from "../zeitlimit";

/**
 * Gemeinsame Ereignisquelle der Webhooks (#154) und der Live-Aktualisierung (#161): die Zeilen des Änderungsprotokolls, gefiltert wie die
 * Änderungsabfrage `/changes` (gleiche Tabellen, gleiche Sichtbarkeit nach Fonds im Bereich `alle`). Neue Zeilen meldet der Trigger
 * `aenderung_ereignis_melden` (Migration 0089): als Eintrag im Ausgangskorb der Webhooks und per NOTIFY an die API-Prozesse.
 *
 * `table` und `action` tragen die Kennungen des Protokolls (Namen der Datenbank), wie in der Änderungsabfrage.
 */

export interface Ereignis {
  id: string;
  at: string;
  actor: string;
  actorName: string | null;
  action: string;
  table: string;
  recordId: string;
  fundId: string | null;
  before: unknown;
  after: unknown;
}

/** Kanal von NOTIFY; die Nutzlast sind bis zu 200 kommagetrennte IDs aus `aenderung`. */
export const EREIGNIS_KANAL = "carraway_aenderung";

/** Höchstens so viele IDs je Abfrage (NOTIFY-Bündel und Ausgangskorb werden in Stücken gelesen). */
const STUECK = 500;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Zerlegt die Nutzlast einer Meldung in gültige IDs (alles andere wird verworfen). */
export function idsAusMeldung(nutzlast: string | undefined): string[] {
  return (nutzlast ?? "").split(",").filter((id) => UUID.test(id));
}

/**
 * Lädt die Ereignisse zu `ids`, die jemand mit diesen Fonds sehen darf, in fester Reihenfolge (Zeitpunkt, ID). `tabellen` schränkt zusätzlich
 * ein (leer = alle Tabellen der Änderungsabfrage).
 */
export async function ladeSichtbareEreignisse(tx: Tx, ids: readonly string[], fonds: string[] | "alle", tabellen: readonly string[] = []): Promise<Ereignis[]> {
  if (ids.length === 0 || (fonds !== "alle" && fonds.length === 0)) return [];
  const erlaubt = tabellen.length === 0 ? FEED_TABELLEN : tabellen.filter((t) => FEED_TABELLEN.includes(t));
  if (erlaubt.length === 0) return [];
  const ergebnis: Ereignis[] = [];
  for (let i = 0; i < ids.length; i += STUECK) {
    const { rows } = await tx.execute<{ id: string; am: string; akteur: string; akteur_name: string | null; aktion: string; tabelle: string; datensatz_id: string; fonds_id: string | null; vorher: unknown; nachher: unknown }>(sql`
      SELECT a.id, to_char(a.am AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS am, a.akteur, a.akteur_name, a.aktion, a.tabelle, a.datensatz_id, a.fonds_id, a.vorher, a.nachher
      FROM aenderung a
      WHERE a.id = ANY(${liste([...ids.slice(i, i + STUECK)], "uuid")})
        AND a.aktion <> 'gelesen'
        AND a.tabelle = ANY(${liste([...erlaubt], "text")})
        AND ${feedSichtbar(fonds)}
      ORDER BY a.am, a.id`);
    for (const z of rows) ergebnis.push({ id: z.id, at: z.am, actor: z.akteur, actorName: z.akteur_name, action: z.aktion, table: z.tabelle, recordId: z.datensatz_id, fundId: z.fonds_id, before: z.vorher, after: z.nachher });
  }
  return ergebnis;
}

/** Fonds, deren Änderungen ein Akteur sieht (Bereich `alle` wie die Route `/changes`); `[]` = nichts. */
export function ereignisFonds(akteur: Pick<Akteur, "globalVerwalter" | "rollen" | "stufen" | "stufeOhneFondsJeBereich" | "stufeOhneFonds"> & Partial<Akteur>): string[] | "alle" {
  return sichtbareFonds(fuerBereich(akteur as Akteur, "alle"));
}

export type Eigentuemer = { benutzerId: string; apiSchluesselId: string | null };

/**
 * Rechte des Eigentümers eines Webhooks zum Zeitpunkt der Zustellung. Ein mit API-Schlüssel angelegter Endpunkt hat die Scopes des Schlüssels
 * und endet mit ihm (widerrufen, abgelaufen); einer aus einer Sitzung hat die heutigen Rechte der Person. `null`: Zugang ungültig (Person
 * deaktiviert, Investor-Benutzer, technischer Benutzer ohne Schlüssel, Schlüssel ungültig).
 */
export async function eigentuemerFonds(tx: Tx, e: Eigentuemer): Promise<string[] | "alle" | null> {
  const [person] = await tx.select({ aktiv: benutzer.aktiv, technisch: benutzer.technisch, globalVerwalter: benutzer.globalVerwalter }).from(benutzer).where(eq(benutzer.id, e.benutzerId));
  if (!person || !person.aktiv) return null;
  if (e.apiSchluesselId) {
    const [s] = await tx
      .select({ scopes: apiSchluessel.scopes, ablauf: apiSchluessel.ablauf, widerrufenAm: apiSchluessel.widerrufenAm })
      .from(apiSchluessel)
      .where(and(eq(apiSchluessel.id, e.apiSchluesselId), eq(apiSchluessel.benutzerId, e.benutzerId)));
    if (!s || s.widerrufenAm || s.ablauf <= new Date()) return null;
    const fonds = [...rollenAusScopes(s.scopes as SchluesselScope[]).keys()];
    return fonds.length === 0 ? null : fonds;
  }
  if (person.technisch) return null;
  const [investor] = await tx.select({ id: investorBenutzer.benutzerId }).from(investorBenutzer).where(eq(investorBenutzer.benutzerId, e.benutzerId));
  if (investor) return null;
  if (person.globalVerwalter) return "alle";
  const rechte = await ladeRechte(tx, e.benutzerId);
  const fonds = ereignisFonds({ globalVerwalter: false, ...rechte });
  return fonds === "alle" || fonds.length > 0 ? fonds : null;
}
