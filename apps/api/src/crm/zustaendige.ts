import { eq, sql } from "drizzle-orm";
import type { Context } from "hono";
import { benutzer, deal, investorBenutzer, wirksameFondsrolle, type FondsRolle } from "@carraway/db";
import { aktuellerAkteur, sichtbareFonds, type Akteur } from "../anmeldung/akteur";
import { Fachfehler } from "../fehler";
import type { Tx } from "../zeitlimit";

/**
 * Wer eine Aufgabe übernehmen darf: aktive angemeldete Personen (keine technischen Zugänge, keine Investoren des LP-Portals), die Zugriff haben.
 * Zugriff heißt: globale Verwalterin bzw. globaler Verwalter, oder eine Rolle an irgendeinem Fonds. Gehört die Aufgabe zu einem Deal mit Fonds, braucht die Person
 * eine Rolle an diesem Fonds. Die Suche beschränkt ihre Ergebnisse zusätzlich auf sichtbare Personen.
 */
const maskiere = (text: string) => text.replace(/[\\%_]/g, (z) => `\\${z}`);

/** Fonds eines Deals (`undefined`: kein Deal-Bezug; `null`: Deal ohne Fonds). Ein Deal, den die Person nicht sieht, gilt als nicht vorhanden. */
export async function dealFondsFuerAufgabe(tx: Tx, c: Context, dealId: string | undefined): Promise<string | null | undefined> {
  if (!dealId) return undefined;
  const [d] = await tx.select({ fondsId: deal.fondsId }).from(deal).where(eq(deal.id, dealId));
  if (!d) throw new Fachfehler(404, "deal_not_found", "Deal not found.");
  const sicht = sichtbareFonds(aktuellerAkteur(c), "betrachter", "dealflow");
  if (d.fondsId !== null && sicht !== "alle" && !sicht.includes(d.fondsId)) throw new Fachfehler(404, "deal_not_found", "Deal not found.");
  return d.fondsId;
}

/** Bedingung „hat Zugriff“ als SQL-Teil auf der Tabelle `benutzer` (Alias `b`). */
function zugriffSql(dealFondsId: string | null | undefined, mindest: FondsRolle) {
  const fonds = dealFondsId ? sql`AND r.fonds_id = ${dealFondsId}::uuid` : sql``;
  const rolle = sql`EXISTS (SELECT 1 FROM ${wirksameFondsrolle} r WHERE r.benutzer_id = b.id AND r.rolle >= ${mindest}::fonds_rolle ${fonds})`;
  return sql`(b.global_verwalter OR ${rolle})`;
}

const grundSql = sql`b.aktiv AND NOT b.technisch AND NOT EXISTS (SELECT 1 FROM ${investorBenutzer} i WHERE i.benutzer_id = b.id)`;

/** Für die Person sichtbare Kandidaten (wie bei den Namen im Protokoll). */
function sichtbareKandidatenSql(akteur: Akteur) {
  const meine = sichtbareFonds(akteur);
  if (meine === "alle") return sql`true`;
  if (meine.length === 0) return sql`b.id = ${akteur.id}::uuid`;
  const fondsIds = sql.join(meine.map((f) => sql`${f}::uuid`), sql`, `);
  return sql`(b.id = ${akteur.id}::uuid OR b.global_verwalter OR EXISTS (
    SELECT 1 FROM ${wirksameFondsrolle} r WHERE r.benutzer_id = b.id AND r.fonds_id = ANY(ARRAY[${fondsIds}])
  ))`;
}

interface Kandidatenkriterien {
  mindest?: FondsRolle;
  sichtbarFuer?: Akteur;
}

function kandidatenSql(dealFondsId: string | null | undefined, { mindest = "betrachter", sichtbarFuer }: Kandidatenkriterien) {
  const sichtbar = sichtbarFuer ? sql` AND ${sichtbareKandidatenSql(sichtbarFuer)}` : sql``;
  return sql`${grundSql} AND ${zugriffSql(dealFondsId, mindest)}${sichtbar}`;
}

/** Durchsucht sichtbare Kandidaten für die Zuständigkeit nach Name. */
export async function sucheZustaendige(tx: Tx, c: Context, eingabe: { q?: string | undefined; dealFondsId?: string | null | undefined; limit?: number; mindest?: FondsRolle }): Promise<{ id: string; name: string }[]> {
  const kandidaten = kandidatenSql(eingabe.dealFondsId, { mindest: eingabe.mindest ?? "betrachter", sichtbarFuer: aktuellerAkteur(c) });
  const name = eingabe.q ? sql`AND lower(b.name) LIKE ${`%${maskiere(eingabe.q.toLowerCase())}%`}` : sql``;
  const limit = eingabe.limit === undefined ? sql`` : sql`LIMIT ${eingabe.limit}`;
  const zeilen = await tx.execute<{ id: string; name: string }>(
    sql`SELECT b.id, b.name FROM ${benutzer} b WHERE ${kandidaten} ${name} ORDER BY lower(b.name), b.id ${limit}`,
  );
  return zeilen.rows;
}

/** Schreibprüfung für die Zuständigkeit; bei Deal-Rollen gilt zusätzlich die Sichtbarkeit aus dem Picker. */
export async function pruefeZustaendigerZugriff(tx: Tx, id: string | null | undefined, dealFondsId: string | null | undefined, kriterien: Kandidatenkriterien = {}): Promise<void> {
  if (!id) return;
  const zeilen = await tx.execute<{ id: string }>(sql`SELECT b.id FROM ${benutzer} b WHERE b.id = ${id}::uuid AND ${kandidatenSql(dealFondsId, kriterien)}`);
  if (zeilen.rows.length === 0) throw new Fachfehler(400, "assignee_invalid", "Only an active signed-in person with access can be the assignee.");
}
