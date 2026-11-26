import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { anteilsklasse, beteiligung, finanzierungsrunde, fonds, INSTRUMENT_BEZEICHNUNG, instrument, organisation, rundeBuchung, rundenposition, rundenpositionZahlung, tranche, vehikel, type instrumentArt } from "@carraway/db";
import { Decimal } from "@carraway/rechenkern";
import { hatRolle, type Akteur } from "../anmeldung/akteur";
import { Fachfehler, type Feldfehler } from "../fehler";
import { bucheVorgang } from "../instrumente/buchen";
import { legeInstrumentAn } from "../instrumente/instrumente";
import { legeTrancheAn } from "../instrumente/tranchen-schreiben";
import { pruefeDatumsfenster } from "../instrumente/stichtag";
import { ladeFonds, ladeOrganisation, type Protokollant } from "../schreiben";
import { ladePoolBestand, poolBeiRunde } from "./pool";
import type { Tx } from "../zeitlimit";
import { vehikelDerPosition, type VehikelZeile } from "./vehikel";

/**
 * Finanzierungsrunden von Hand (Etappe 4b). Eine neue Runde ist ein Entwurf und zählt nirgends (Kapitaltabelle, Wasserfall, Bewertung,
 * Berichte). Beim Abschließen prüft `pruefeRunde` Post-Money gegen Pre-Money plus Volumen und Anteile gegen Preis; dieselbe Prüfung liefert
 * die Hinweise der Oberfläche (die Oberfläche rechnet nichts). Ein Abschluss kann für den eigenen Fonds Zusage und erste Auszahlungen
 * buchen, über dieselbe Funktion wie jede andere Buchung (`bucheVorgang`).
 */

/** Preis je Anteil ist auf vier Nachkommastellen gespeichert: Anteile × Preis weicht bis zu einem Anteil plus dieser Rundung ab. */
const PREISRUNDUNG = new Decimal("0.00005");

export type Schwere = "fehler" | "hinweis";

export type Abweichung = {
  code: "KEINE_POSITIONEN" | "POST_MONEY_ABWEICHEND" | "ANTEILE_PREIS_ABWEICHEND" | "ANTEILE_UEBER_GESAMT" | "POSITION_PREIS_ABWEICHEND" | "PREIS_UNVERWAESSERT";
  schwere: Schwere;
  /** Nur bei Abweichungen einer Position. */
  positionId?: string;
  werte: Record<string, string>;
}

export type Rundenpruefung = {
  volumen: string;
  postMoneyErwartet: string;
  anteileErwartet: string;
  anteileVergeben: string;
  abweichungen: Abweichung[];
  schliessbar: boolean;
  /**
   * Basis, auf der Anteile × Preis das Post-Money ergeben: `voll_verwaessert` (ausgegebene Anteile plus Pool der Mitarbeiterbeteiligung),
   * `unverwaessert` (nur ausgegebene Anteile); `null` ohne Pool (dann gibt es keinen Unterschied) oder wenn keine Basis passt.
   */
  preisBasis?: "voll_verwaessert" | "unverwaessert" | null;
  /** Anteile im Pool nach der Runde (voll verwässert); nur mit Pool. */
  poolAnteile?: string;
}

export interface RundenWerte {
  preMoney: string;
  postMoney: string;
  preisJeAnteil: string;
  anteileGesamtNach: string;
}

export interface PositionWerte {
  id?: string;
  betrag: string;
  anteile: string;
}

/** Anteile, die zu einem Betrag und einem Preis passen (auf ganze Anteile gerundet). */
export const anteileZu = (betrag: Decimal.Value, preis: Decimal.Value): Decimal => new Decimal(betrag).div(preis).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);

/**
 * Prüfung einer Runde gegen ihre Positionen: ohne Datenbankzugriff, für Vorschau, Entwurf und Abschluss gleich. Mit `poolAnteile` (Pool der
 * Mitarbeiterbeteiligung nach der Runde) gilt der Preis je Anteil auf voll verwässerter Basis: (Anteile gesamt + Pool) × Preis = Post-Money.
 * Passt nur die unverwässerte Basis, ist das ein Hinweis (`PREIS_UNVERWAESSERT`), kein Fehler. Ohne Pool bleibt alles wie bisher.
 */
export function pruefeRunde(w: RundenWerte, positionen: readonly PositionWerte[], poolAnteile?: string | null): Rundenpruefung {
  const volumen = positionen.reduce((s, p) => s.plus(p.betrag), new Decimal(0));
  const anteileVergeben = positionen.reduce((s, p) => s.plus(p.anteile), new Decimal(0));
  const preis = new Decimal(w.preisJeAnteil);
  const post = new Decimal(w.postMoney);
  const erwartetPost = new Decimal(w.preMoney).plus(volumen);
  const erwartetAnteile = anteileZu(post, preis);
  const abweichungen: Abweichung[] = [];
  if (positionen.length === 0) abweichungen.push({ code: "KEINE_POSITIONEN", schwere: "fehler", werte: {} });
  if (!post.equals(erwartetPost)) {
    abweichungen.push({ code: "POST_MONEY_ABWEICHEND", schwere: "fehler", werte: { postMoney: post.toFixed(2), erwartet: erwartetPost.toFixed(2), volumen: volumen.toFixed(2) } });
  }
  const gesamt = new Decimal(w.anteileGesamtNach);
  const toleranz = (anteile: Decimal) => preis.plus(anteile.times(PREISRUNDUNG));
  const passt = (anteile: Decimal) => !anteile.times(preis).minus(post).abs().greaterThan(toleranz(anteile));
  const pool = poolAnteile ? new Decimal(poolAnteile) : new Decimal(0);
  let preisBasis: Rundenpruefung["preisBasis"] = null;
  if (pool.greaterThan(0)) {
    const voll = gesamt.plus(pool);
    if (passt(voll)) preisBasis = "voll_verwaessert";
    else if (passt(gesamt)) {
      preisBasis = "unverwaessert";
      abweichungen.push({ code: "PREIS_UNVERWAESSERT", schwere: "hinweis", werte: { poolAnteile: pool.toFixed(0), anteileGesamtNach: gesamt.toFixed(0), erwartet: Decimal.max(0, erwartetAnteile.minus(pool)).toFixed(0) } });
    } else {
      abweichungen.push({
        code: "ANTEILE_PREIS_ABWEICHEND",
        schwere: "fehler",
        werte: { anteileGesamtNach: gesamt.toFixed(0), preisJeAnteil: preis.toFixed(4), postMoney: post.toFixed(2), erwartet: Decimal.max(0, erwartetAnteile.minus(pool)).toFixed(0), poolAnteile: pool.toFixed(0) },
      });
    }
  } else if (!passt(gesamt)) {
    abweichungen.push({
      code: "ANTEILE_PREIS_ABWEICHEND",
      schwere: "fehler",
      werte: { anteileGesamtNach: gesamt.toFixed(0), preisJeAnteil: preis.toFixed(4), postMoney: post.toFixed(2), erwartet: erwartetAnteile.toFixed(0) },
    });
  }
  if (anteileVergeben.greaterThan(gesamt)) {
    abweichungen.push({ code: "ANTEILE_UEBER_GESAMT", schwere: "fehler", werte: { anteileVergeben: anteileVergeben.toFixed(0), anteileGesamtNach: gesamt.toFixed(0) } });
  }
  for (const p of positionen) {
    const anteile = new Decimal(p.anteile);
    if (anteile.times(preis).minus(p.betrag).abs().greaterThan(toleranz(anteile))) {
      abweichungen.push({
        code: "POSITION_PREIS_ABWEICHEND",
        schwere: "hinweis",
        ...(p.id ? { positionId: p.id } : {}),
        werte: { betrag: new Decimal(p.betrag).toFixed(2), anteile: anteile.toFixed(0), erwartet: anteileZu(p.betrag, preis).toFixed(0) },
      });
    }
  }
  return {
    volumen: volumen.toFixed(2),
    postMoneyErwartet: erwartetPost.toFixed(2),
    anteileErwartet: erwartetAnteile.toFixed(0),
    anteileVergeben: anteileVergeben.toFixed(0),
    abweichungen,
    schliessbar: abweichungen.every((a) => a.schwere !== "fehler"),
    ...(pool.greaterThan(0) ? { preisBasis, poolAnteile: pool.toFixed(0) } : {}),
  };
}

// Rechte -----------------------------------------------------------------------------------------------------------------------

const keineBerechtigung = () => new Fachfehler(403, "forbidden", "You lack permission for this.");

/**
 * Rechtsgrundlage am Unternehmen: Fonds mit einer Beteiligung daran und Fonds mit einer Position in einer ABGESCHLOSSENEN Runde.
 * Eine Position in einem Entwurf begründet kein Recht am Unternehmen; sie gilt nur für die eigene Runde (`rundeId`).
 */
export async function verwandteFonds(tx: Tx, organisationId: string, rundeId?: string): Promise<Set<string>> {
  const { rows } = await tx.execute<{ fonds_id: string }>(sql`
    SELECT fonds_id FROM beteiligung WHERE organisation_id = ${organisationId}
    UNION
    SELECT p.fonds_id FROM rundenposition p JOIN finanzierungsrunde r ON r.id = p.runde_id
      WHERE r.organisation_id = ${organisationId} AND r.status = 'abgeschlossen' AND p.fonds_id IS NOT NULL
    ${rundeId ? sql`UNION SELECT p.fonds_id FROM rundenposition p WHERE p.runde_id = ${rundeId} AND p.fonds_id IS NOT NULL` : sql``}`);
  return new Set(rows.map((r) => r.fonds_id));
}

/**
 * Mindestrolle an einem Fonds der Rechtsgrundlage (bei `rundeId` auch an einem Fonds mit Position in genau dieser Runde) oder, beim
 * Anlegen, an einem Fonds, der mit einer Position des Antrags einsteigt (`zusaetzlich`). Globale Verwalter immer.
 */
export async function verlangeRundenrecht(tx: Tx, akteur: Akteur, organisationId: string, mindest: Parameters<typeof hatRolle>[2], zusaetzlich: Iterable<string> = [], rundeId?: string): Promise<void> {
  if (akteur.globalVerwalter) return;
  const fonds = await verwandteFonds(tx, organisationId, rundeId);
  for (const f of zusaetzlich) fonds.add(f);
  if (![...fonds].some((f) => hatRolle(akteur, f, mindest))) throw keineBerechtigung();
}

/**
 * Leserecht an den Runden eines Unternehmens (wie die Liste der Runden): Rechtsgrundlage am Unternehmen (`verwandteFonds`) oder eine Position
 * eines eigenen Fonds in irgendeiner Runde des Unternehmens. Dasselbe Recht gilt für den Pool der Mitarbeiterbeteiligung (Entscheidung 486).
 */
export async function verlangeRundenLeserecht(tx: Tx, akteur: Akteur, organisationId: string): Promise<void> {
  if (akteur.globalVerwalter) return;
  const grundlage = await verwandteFonds(tx, organisationId);
  if ([...grundlage].some((f) => hatRolle(akteur, f, "betrachter"))) return;
  const { rows } = await tx.execute<{ fonds_id: string }>(sql`
    SELECT DISTINCT p.fonds_id FROM rundenposition p JOIN finanzierungsrunde r ON r.id = p.runde_id
    WHERE r.organisation_id = ${organisationId} AND p.fonds_id IS NOT NULL`);
  if (!rows.some((r) => hatRolle(akteur, r.fonds_id, "betrachter"))) throw keineBerechtigung();
}

/** Jeder Fonds mit einer Position der Runde verlangt die Rolle `mindest`: Wer die Runde ändert, löscht, schließt oder öffnet, betrifft alle. */
export async function verlangeRolleAnAllenPositionen(tx: Tx, akteur: Akteur, rundeId: string, mindest: Parameters<typeof hatRolle>[2]): Promise<void> {
  if (akteur.globalVerwalter) return;
  const { rows } = await tx.execute<{ fonds_id: string }>(sql`SELECT DISTINCT fonds_id FROM rundenposition WHERE runde_id = ${rundeId} AND fonds_id IS NOT NULL`);
  for (const r of rows) if (!hatRolle(akteur, r.fonds_id, mindest)) throw keineBerechtigung();
}

/** Der eigene Fonds einer Position verlangt die Rolle bearbeiter an diesem Fonds. */
export function verlangeBearbeiterAm(akteur: Akteur, fondsId: string): void {
  if (!hatRolle(akteur, fondsId, "bearbeiter")) throw keineBerechtigung();
}

// Anlegen eines Rundenentwurfs ---------------------------------------------------------------------------------------------------

export interface PositionEntwurf {
  fondsId?: string | undefined;
  /** Vehikel eines Co-Investors; übergangsweise auch `organisationId` (dann das Standard-Vehikel der Organisation, `vehikelDerPosition`). */
  vehikelId?: string | undefined;
  organisationId?: string | undefined;
  betrag: string;
  anteile: string;
  rolle: "lead" | "co_lead" | "co";
  anteilsklasseId?: string | null | undefined;
}

export interface RundenEntwurf {
  /** Standard `eigenkapital`; eine Brückenrunde hat weder Bewertung noch Positionen. */
  art?: "eigenkapital" | "bruecke" | undefined;
  bezeichnung: string;
  datum: string;
  preMoney?: string | undefined;
  preisJeAnteil?: string | undefined;
  postMoney?: string | undefined;
  anteileGesamtNach?: string | undefined;
  positionen: readonly PositionEntwurf[];
  /** Aufstockung des Pools der Mitarbeiterbeteiligung zur Runde (Option Pool Shuffle); im Pre-Money zählt sie zum Pool der Prüfung. */
  poolAufstockung?: { basis: "pre_money" | "post_money"; anzahl: string } | undefined;
}

/** Pool zur Prüfung einer neuen Runde: Bestand zum Rundendatum plus eine Aufstockung im Pre-Money (die im Post-Money zählt nicht). */
export function poolMitAufstockung(pool: string | null, a: { basis: "pre_money" | "post_money"; anzahl: string } | undefined | null): string | null {
  if (!a || a.basis !== "pre_money") return pool;
  return new Decimal(pool ?? 0).plus(a.anzahl).toFixed(0);
}

export function ungueltig(felder: Feldfehler[]): never {
  throw new Fachfehler(400, "invalid_input", "The input is invalid.", { felder });
}

/** Post-Money und Anteile: angegeben oder aus Pre-Money, Volumen und Preis abgeleitet. */
export function wirksam(e: { preMoney: string; preisJeAnteil: string; postMoney?: string | null | undefined; anteileGesamtNach?: string | null | undefined }, volumen: Decimal, poolAnteile?: string | null) {
  const postMoney = e.postMoney ?? new Decimal(e.preMoney).plus(volumen).toFixed(2);
  if (new Decimal(postMoney).lessThan(e.preMoney)) ungueltig([{ feld: "postMoney", code: "post_below_pre", meldung: "Post-money must not be below pre-money" }]);
  // Mit Pool ist der Preis voll verwässert: ausgegebene Anteile = Post-Money ÷ Preis − Pool.
  const anteileGesamtNach = e.anteileGesamtNach ?? Decimal.max(0, anteileZu(postMoney, e.preisJeAnteil).minus(poolAnteile ?? 0)).toFixed(0);
  return { postMoney, anteileGesamtNach };
}

/** Prüft eine Position gegen das Unternehmen der Runde und die Rechte der Person; legt nichts an. Positionen Dritter kommen mit ihrem Vehikel. */
export async function pruefePosition(tx: Tx, akteur: Akteur, organisationId: string, p: PositionEntwurf, v: VehikelZeile | null) {
  if (p.fondsId) {
    await ladeFonds(tx, p.fondsId);
    verlangeBearbeiterAm(akteur, p.fondsId);
  } else if (v?.investorId === organisationId) {
    const feld = p.vehikelId ? "vehikelId" : "organisationId";
    ungueltig([{ feld, code: "investor_is_company", meldung: "The company cannot invest in itself" }]);
  }
  if (p.anteilsklasseId) {
    const [k] = await tx.select().from(anteilsklasse).where(eq(anteilsklasse.id, p.anteilsklasseId));
    if (!k) throw new Fachfehler(404, "share_class_not_found", "Share class not found.");
    if (k.organisationId !== organisationId) throw new Fachfehler(409, "share_class_mismatch", "The class belongs to a different company than the round.");
  }
}

/**
 * Der einzige Weg, eine Finanzierungsrunde als Entwurf anzulegen: die Route der Oberfläche und die Bestätigung einer Auslesung gehen hierher.
 * Rechte: Mindestrolle bearbeiter an einem Fonds der Rechtsgrundlage oder an einem Fonds, der mit einer Position einsteigt, und zusätzlich
 * bearbeiter an jedem Fonds der Positionen (`pruefePosition`). Der Entwurf zählt nirgends, bis ihn jemand abschließt. Die Positionen kommen in der Reihenfolge der Eingabe zurück.
 */
export interface RundenDublette {
  id: string;
  bezeichnung: string;
  datum: string;
  gleichesDatum: boolean;
  gleicherPreis: boolean;
}

/**
 * Runden desselben Unternehmens mit gleichem Datum oder gleichem Preis je Anteil (Entwürfe eingeschlossen). Das ist ein Hinweis, kein Fehler:
 * Zwei Runden am selben Tag oder zum selben Preis kommen vor (Nachzügler, Tranchen), meist ist es aber ein doppelt erfasster Abschluss.
 * Gemeldet werden nur Runden, die die Person auch in der Rundenliste sähe (globale Verwalter, Rolle an einem Fonds der Rechtsgrundlage oder
 * Rolle an einem Fonds mit Position in der Runde); Id, Datum und Bezeichnung sind alles, was der Hinweis enthält.
 */
export async function findeRundenDubletten(tx: Tx, akteur: Akteur, organisationId: string, w: { datum: string; preisJeAnteil: string }): Promise<RundenDublette[]> {
  const zeilen = await tx
    .select()
    .from(finanzierungsrunde)
    .where(and(eq(finanzierungsrunde.organisationId, organisationId), or(eq(finanzierungsrunde.datum, w.datum), sql`${finanzierungsrunde.preisJeAnteil} = ${w.preisJeAnteil}::numeric`)))
    .orderBy(desc(finanzierungsrunde.datum), asc(finanzierungsrunde.id));
  if (zeilen.length === 0) return [];
  let sichtbar = zeilen;
  if (!akteur.globalVerwalter) {
    const grundlage = await verwandteFonds(tx, organisationId);
    if (![...grundlage].some((f) => hatRolle(akteur, f, "betrachter"))) {
      const { rows } = await tx.execute<{ runde_id: string; fonds_id: string }>(sql`SELECT runde_id, fonds_id FROM rundenposition WHERE fonds_id IS NOT NULL AND runde_id IN (${sql.join(zeilen.map((z) => sql`${z.id}`), sql`, `)})`);
      const erlaubt = new Set(rows.filter((r) => hatRolle(akteur, r.fonds_id, "betrachter")).map((r) => r.runde_id));
      sichtbar = zeilen.filter((z) => erlaubt.has(z.id));
    }
  }
  return sichtbar.map((z) => ({ id: z.id, bezeichnung: z.bezeichnung, datum: z.datum, gleichesDatum: z.datum === w.datum, gleicherPreis: z.preisJeAnteil !== null && new Decimal(z.preisJeAnteil).equals(w.preisJeAnteil) }));
}

export const BRUECKE_OHNE_ANTEILE = () => new Fachfehler(409, "round_bridge_without_shares", "A bridge round has no valuation and no positions with shares.");

/** Eine Brückenrunde: Darlehen zwischen zwei Runden, ohne Bewertung und Anteile. Sie ist sofort abgeschlossen (es gibt nichts zu prüfen oder zu buchen). */
async function legeBrueckenrundeAn(tx: Tx, protokoll: Protokollant, akteur: Akteur, organisationId: string, e: RundenEntwurf) {
  pruefeDatumsfenster("datum", e.datum);
  const org = await ladeOrganisation(tx, organisationId);
  await verlangeRundenrecht(tx, akteur, org.id, "bearbeiter");
  if (e.positionen.length > 0) throw BRUECKE_OHNE_ANTEILE();
  if (e.preMoney !== undefined || e.preisJeAnteil !== undefined || e.postMoney !== undefined || e.anteileGesamtNach !== undefined) throw BRUECKE_OHNE_ANTEILE();
  const [runde] = await tx
    .insert(finanzierungsrunde)
    .values({ organisationId: org.id, art: "bruecke", bezeichnung: e.bezeichnung, datum: e.datum, status: "abgeschlossen", abgeschlossenAm: new Date(), abgeschlossenVon: protokoll.akteur })
    .returning();
  if (!runde) throw new Error("Runde nicht angelegt");
  await protokoll("anlegen", "finanzierungsrunde", runde.id, null, runde);
  return { runde, positionen: [] as PositionZeile[], dubletten: [] as RundenDublette[] };
}

export async function legeRundenentwurfAn(tx: Tx, protokoll: Protokollant, akteur: Akteur, organisationId: string, e: RundenEntwurf): Promise<{ runde: RundeZeile; positionen: PositionZeile[]; dubletten: RundenDublette[] }> {
  if (e.art === "bruecke") return legeBrueckenrundeAn(tx, protokoll, akteur, organisationId, e);
  if (e.preMoney === undefined) ungueltig([{ feld: "preMoney", code: "required", meldung: "Pre-money is required for an equity round" }]);
  if (e.preisJeAnteil === undefined) ungueltig([{ feld: "preisJeAnteil", code: "required", meldung: "Price per share is required for an equity round" }]);
  const entwurf = e as RundenEntwurf & { preMoney: string; preisJeAnteil: string };
  e = entwurf;
  pruefeDatumsfenster("datum", e.datum);
  const org = await ladeOrganisation(tx, organisationId);
  await verlangeRundenrecht(tx, akteur, org.id, "bearbeiter", e.positionen.flatMap((p) => (p.fondsId ? [p.fondsId] : [])));
  // Eine Position je Fonds und je Vehikel; zwei Vehikel desselben Investors dürfen in derselben Runde stehen.
  const doppelt = new Set<string>();
  const vehikelJe: (VehikelZeile | null)[] = [];
  for (const p of e.positionen) {
    const v = p.fondsId ? null : await vehikelDerPosition(tx, protokoll, p);
    const schluessel = p.fondsId ? `f:${p.fondsId}` : `v:${v!.id}`;
    if (doppelt.has(schluessel)) throw new Fachfehler(409, "round_position_exists", "This investor already has a position in the round.");
    doppelt.add(schluessel);
    await pruefePosition(tx, akteur, org.id, p, v);
    vehikelJe.push(v);
  }
  const volumen = e.positionen.reduce((s, p) => s.plus(p.betrag), new Decimal(0));
  const w = wirksam(entwurf, volumen, poolMitAufstockung(poolBeiRunde(await ladePoolBestand(tx, org.id), e.datum, null), e.poolAufstockung));
  // Vor dem Anlegen, damit die neue Runde sich nicht selbst meldet; gewarnt wird, geblockt nicht.
  const dubletten = await findeRundenDubletten(tx, akteur, org.id, entwurf);
  const [runde] = await tx
    .insert(finanzierungsrunde)
    .values({ organisationId: org.id, bezeichnung: e.bezeichnung, datum: e.datum, art: "eigenkapital", preMoney: entwurf.preMoney, postMoney: w.postMoney, preisJeAnteil: entwurf.preisJeAnteil, anteileGesamtNach: w.anteileGesamtNach, status: "entwurf" })
    .returning();
  if (!runde) throw new Error("Runde nicht angelegt");
  await protokoll("anlegen", "finanzierungsrunde", runde.id, null, runde);
  const positionen: PositionZeile[] = [];
  for (const [i, p] of e.positionen.entries()) {
    const [zeile] = await tx
      .insert(rundenposition)
      .values({ rundeId: runde.id, fondsId: p.fondsId ?? null, vehikelId: vehikelJe[i]?.id ?? null, betrag: p.betrag, anteile: p.anteile, rolle: p.rolle, anteilsklasseId: p.anteilsklasseId ?? null })
      .returning();
    await protokoll("anlegen", "rundenposition", zeile!.id, null, zeile);
    positionen.push(zeile!);
  }
  return { runde, positionen, dubletten };
}

// Laden ---------------------------------------------------------------------------------------------------------------------------

export type RundeZeile = typeof finanzierungsrunde.$inferSelect;
export type PositionZeile = typeof rundenposition.$inferSelect;

/** Lädt die Runde und sperrt die Zeile bis zum Ende der Transaktion. */
export async function sperreRunde(tx: Tx, id: string): Promise<RundeZeile> {
  const [zeile] = await tx.select().from(finanzierungsrunde).where(eq(finanzierungsrunde.id, id)).for("update");
  if (!zeile) throw new Fachfehler(404, "round_not_found", "Financing round not found.");
  return zeile;
}

export function verlangeEntwurf(r: RundeZeile): void {
  if (r.status !== "entwurf") throw new Fachfehler(409, "round_not_draft", "The round is closed and can no longer be changed.", { status: r.status });
}

export type RundenAntwortPosition = {
  id: string;
  /** Fonds oder, bei Positionen Dritter, der Investor (Organisation) hinter dem Vehikel. */
  investor: { art: "fonds" | "organisation"; id: string; name: string };
  /** Vehikel einer Position Dritter; bei Fonds `null`. */
  vehikel: { id: string; name: string } | null;
  betrag: string;
  anteile: string;
  rolle: "lead" | "co_lead" | "co";
  anteilsklasse: { id: string; name: string } | null;
  /** Das Instrument (und seine Beteiligung), das beim Abschließen aus der Position des eigenen Fonds entstanden ist. */
  instrumentId: string | null;
  beteiligungId: string | null;
  /** Nur bei Positionen von Organisationen: Einzahlungen minus Rückzahlungen und der Rest zur Zusage. Informativ. */
  gezahlt: string | null;
  offen: string | null;
  /** Vorgänge, die das Abschließen für den eigenen Fonds gebucht hat. */
  buchungen: { vorgangId: string; art: string; storniert: boolean }[];
}

export type RundenAntwort = {
  id: string;
  organisationId: string;
  /** `bruecke`: Brückenrunde ohne Bewertung und Positionen (die vier Bewertungsfelder sind dann `null`). */
  art: "eigenkapital" | "bruecke";
  bezeichnung: string;
  datum: string;
  preMoney: string | null;
  postMoney: string | null;
  preisJeAnteil: string | null;
  anteileGesamtNach: string | null;
  status: "entwurf" | "abgeschlossen";
  abgeschlossenAm: string | null;
  abgeschlossenVon: string | null;
  wiedergeoeffnetAm: string | null;
  wiedergeoeffnetVon: string | null;
  wiedereroeffnungGrund: string | null;
  positionen: RundenAntwortPosition[];
  pruefung: Rundenpruefung;
}

const reihenfolge = { lead: 0, co_lead: 1, co: 2 } as const;

/** Prüfung einer Brückenrunde: nichts zu prüfen, immer schließbar (sie hat keine Positionen und keine Bewertung). */
const KEINE_PRUEFUNG: Rundenpruefung = { volumen: "0.00", postMoneyErwartet: "0.00", anteileErwartet: "0", anteileVergeben: "0", abweichungen: [], schliessbar: true };

/** Bewertungswerte einer Eigenkapitalrunde (die Datenbank garantiert sie bei `eigenkapital`). */
export function rundenWerte(r: RundeZeile): RundenWerte {
  return { preMoney: r.preMoney!, postMoney: r.postMoney!, preisJeAnteil: r.preisJeAnteil!, anteileGesamtNach: r.anteileGesamtNach! };
}

/**
 * Runden einer Organisation mit Positionen, Zahlungsstand, Buchungen und Prüfung; neueste zuerst. `nurId` lädt genau eine. Die Prüfung
 * rechnet mit dem Pool der Mitarbeiterbeteiligung (Pool sichtbar = Runden sichtbar, Entscheidung 486).
 */
export async function ladeRundenAntwort(tx: Tx, organisationId: string, nurId?: string): Promise<RundenAntwort[]> {
  const runden = await tx
    .select()
    .from(finanzierungsrunde)
    .where(nurId ? eq(finanzierungsrunde.id, nurId) : eq(finanzierungsrunde.organisationId, organisationId))
    .orderBy(sql`${finanzierungsrunde.datum} DESC`, sql`${finanzierungsrunde.erstelltAm} DESC`, sql`${finanzierungsrunde.id} DESC`);
  if (runden.length === 0) return [];
  const poolBestand = await ladePoolBestand(tx, runden[0]!.organisationId);
  const rundeIds = runden.map((r) => r.id);
  const positionen = await tx
    .select({ p: rundenposition, fondsName: fonds.name, organisationId: organisation.id, organisationName: organisation.name, vehikelName: vehikel.name, klasseName: anteilsklasse.name, instrumentBeteiligungId: instrument.beteiligungId })
    .from(rundenposition)
    .leftJoin(instrument, eq(instrument.id, rundenposition.instrumentId))
    .leftJoin(fonds, eq(fonds.id, rundenposition.fondsId))
    .leftJoin(vehikel, eq(vehikel.id, rundenposition.vehikelId))
    .leftJoin(organisation, eq(organisation.id, vehikel.investorId))
    .leftJoin(anteilsklasse, eq(anteilsklasse.id, rundenposition.anteilsklasseId))
    .where(inArray(rundenposition.rundeId, rundeIds))
    .orderBy(asc(rundenposition.id));
  const positionIds = positionen.map((x) => x.p.id);
  const zahlungen = positionIds.length
    ? await tx
        .select({
          positionId: rundenpositionZahlung.positionId,
          gezahlt: sql<string>`coalesce(sum(CASE WHEN ${rundenpositionZahlung.art} = 'einzahlung' THEN ${rundenpositionZahlung.betrag} ELSE -${rundenpositionZahlung.betrag} END), 0)::text`,
        })
        .from(rundenpositionZahlung)
        .where(inArray(rundenpositionZahlung.positionId, positionIds))
        .groupBy(rundenpositionZahlung.positionId)
    : [];
  const gezahltJe = new Map(zahlungen.map((z) => [z.positionId, z.gezahlt]));
  const buchungen = positionIds.length
    ? await tx
        .select({
          positionId: rundeBuchung.positionId,
          vorgangId: rundeBuchung.vorgangId,
          art: rundeBuchung.art,
          storniert: sql<boolean>`EXISTS (SELECT 1 FROM vorgang s WHERE s.storniert_vorgang_id = ${rundeBuchung.vorgangId})`,
        })
        .from(rundeBuchung)
        .where(inArray(rundeBuchung.positionId, positionIds))
        .orderBy(asc(rundeBuchung.erstelltAm), asc(rundeBuchung.vorgangId))
    : [];

  return runden.map((r) => {
    const eigene: RundenAntwortPosition[] = positionen
      .filter((x) => x.p.rundeId === r.id)
      .map(({ p, fondsName, organisationId, organisationName, vehikelName, klasseName, instrumentBeteiligungId }) => {
        const gezahlt = p.vehikelId ? new Decimal(gezahltJe.get(p.id) ?? 0) : null;
        return {
          id: p.id,
          investor: p.fondsId ? { art: "fonds" as const, id: p.fondsId, name: fondsName ?? "" } : { art: "organisation" as const, id: organisationId as string, name: organisationName ?? "" },
          vehikel: p.vehikelId ? { id: p.vehikelId, name: vehikelName ?? "" } : null,
          betrag: p.betrag,
          anteile: new Decimal(p.anteile).toFixed(0),
          rolle: p.rolle,
          anteilsklasse: p.anteilsklasseId ? { id: p.anteilsklasseId, name: klasseName ?? "" } : null,
          instrumentId: p.instrumentId ?? null,
          beteiligungId: instrumentBeteiligungId ?? null,
          gezahlt: gezahlt ? gezahlt.toFixed(2) : null,
          offen: gezahlt ? new Decimal(p.betrag).minus(gezahlt).toFixed(2) : null,
          buchungen: buchungen.filter((b) => b.positionId === p.id).map((b) => ({ vorgangId: b.vorgangId, art: b.art, storniert: b.storniert })),
        };
      })
      .sort((a, b) => reihenfolge[a.rolle] - reihenfolge[b.rolle] || new Decimal(b.betrag).cmp(a.betrag) || a.id.localeCompare(b.id));
    return {
      id: r.id,
      organisationId: r.organisationId,
      art: r.art,
      bezeichnung: r.bezeichnung,
      datum: r.datum,
      preMoney: r.preMoney,
      postMoney: r.postMoney,
      preisJeAnteil: r.preisJeAnteil,
      anteileGesamtNach: r.anteileGesamtNach === null ? null : new Decimal(r.anteileGesamtNach).toFixed(0),
      status: r.status,
      abgeschlossenAm: r.abgeschlossenAm?.toISOString() ?? null,
      abgeschlossenVon: r.abgeschlossenVon,
      wiedergeoeffnetAm: r.wiedergeoeffnetAm?.toISOString() ?? null,
      wiedergeoeffnetVon: r.wiedergeoeffnetVon,
      wiedereroeffnungGrund: r.wiedereroeffnungGrund,
      positionen: eigene,
      pruefung: r.art === "bruecke" ? KEINE_PRUEFUNG : pruefeRunde(rundenWerte(r), eigene, poolBeiRunde(poolBestand, r.datum, r.id)),
    };
  });
}

// Abschluss mit Buchungen des eigenen Fonds ------------------------------------------------------------------------------------------

export interface FondsBuchungWunsch {
  positionId: string;
  /** Zusage in Höhe der Position buchen (Standard: ja). */
  zusage: boolean;
  /** Valuta der Zusage; Standard ist das Rundendatum. */
  zusageValuta?: string | undefined;
  auszahlungen: { valuta: string; betrag: string }[];
  /** Art des Instruments, das aus der Position entsteht (Standard: offene Beteiligung). */
  art?: (typeof instrumentArt.enumValues)[number] | undefined;
  /** Bezeichnung des Instruments (Standard: „<Runde>-Anteile“ bzw. Art und Runde). */
  bezeichnung?: string | undefined;
}

export type FondsBuchungErgebnis = {
  positionId: string;
  fondsId: string;
  beteiligungId: string;
  beteiligungAngelegt: boolean;
  /** Das Instrument, das aus der Position entstanden ist (oder bei erneutem Abschluss schon war). */
  instrumentId: string;
  instrumentAngelegt: boolean;
  /** Die Tranche über den Betrag der Position, wenn die Zusage gebucht wurde. */
  trancheId: string | null;
  vorgangIds: string[];
}

/** Beteiligung des Fonds am Unternehmen; fehlt sie, wird sie mit dem Rundendatum als Erstinvestment angelegt (ohne Instrument, das kommt aus der Runde). */
export async function ladeOderLegeBeteiligungAn(tx: Tx, protokoll: Protokollant, fondsId: string, organisationId: string, datum: string, art: (typeof instrumentArt.enumValues)[number]) {
  const [vorhanden] = await tx
    .select()
    .from(beteiligung)
    .where(and(eq(beteiligung.fondsId, fondsId), eq(beteiligung.organisationId, organisationId)))
    .for("update");
  if (vorhanden) return { id: vorhanden.id, angelegt: false };
  const [neu] = await tx.insert(beteiligung).values({ fondsId, organisationId, instrument: art, erstinvestment: datum }).returning();
  if (!neu) throw new Error("Beteiligung nicht angelegt");
  await protokoll("anlegen", "beteiligung", neu.id, null, neu);
  return { id: neu.id, angelegt: true };
}

/**
 * Je eigener Fonds-Position der Runde: Beteiligung (Fonds × Unternehmen) suchen oder anlegen, ein Instrument aus der Position anlegen (Art, Runde und
 * Anteilsklasse gesetzt), die Zusage in Höhe der Position mit einer Tranche buchen und optional erste Auszahlungen auf diese Tranche, alle über
 * `bucheVorgang` (Invarianten, Periodensperre, Protokoll). Positionen, zu denen es keinen Wunsch gibt, bekommen den Standard (Zusage an, keine Auszahlung),
 * soweit die Person am Fonds bearbeiten darf und die Position noch kein Instrument hat; bei erneutem Abschluss nach einer Wiedereröffnung bleiben
 * gebuchte Vorgänge und Instrument bestehen (Entscheidung 205).
 */
export async function bucheFondsBuchungen(tx: Tx, protokoll: Protokollant, akteur: Akteur, runde: RundeZeile, positionen: readonly PositionZeile[], wuensche: readonly FondsBuchungWunsch[]): Promise<FondsBuchungErgebnis[]> {
  const ergebnisse: FondsBuchungErgebnis[] = [];
  for (const w of wuensche) {
    const position = positionen.find((p) => p.id === w.positionId);
    if (!position) {
      throw new Fachfehler(400, "invalid_input", "The input is invalid.", { felder: [{ feld: "fondsBuchungen.positionId", code: "position_unknown", meldung: "The position does not belong to this round" }] });
    }
    if (!position.fondsId) {
      throw new Fachfehler(400, "invalid_input", "The input is invalid.", { felder: [{ feld: "fondsBuchungen.positionId", code: "position_not_own_fund", meldung: "Bookings exist only for positions of a fund on this platform" }] });
    }
  }
  // Alle eigenen Positionen in stabiler Reihenfolge; ausdrückliche Wünsche zuerst gelten, der Rest bekommt den Standard.
  const eigene = positionen.filter((p) => p.fondsId).sort((a, b) => a.id.localeCompare(b.id));
  for (const position of eigene) {
    const ausdruecklich = wuensche.find((x) => x.positionId === position.id);
    const fondsId = position.fondsId as string;
    if (ausdruecklich) verlangeBearbeiterAm(akteur, fondsId);
    else if (position.instrumentId || !hatRolle(akteur, fondsId, "bearbeiter")) continue;
    const w: FondsBuchungWunsch = ausdruecklich ?? { positionId: position.id, zusage: true, auszahlungen: [] };
    if (ausdruecklich?.zusage) {
      const { rows } = await tx.execute<{ vorgang_id: string }>(sql`
        SELECT rb.vorgang_id FROM runde_buchung rb
        WHERE rb.position_id = ${position.id} AND rb.art = 'zusage' AND NOT EXISTS (SELECT 1 FROM vorgang s WHERE s.storniert_vorgang_id = rb.vorgang_id)`);
      if (rows.length > 0) throw new Fachfehler(409, "round_commitment_exists", "A commitment of the fund from this round already exists for this position.", { vorgangId: rows[0]!.vorgang_id });
    }
    const art = w.art ?? "offene_beteiligung";
    const b = await ladeOderLegeBeteiligungAn(tx, protokoll, fondsId, runde.organisationId, runde.datum, art);
    // Das Instrument dieser Position: bei erneutem Abschluss das vorhandene, sonst ein neues aus Art, Runde und Anteilsklasse.
    let instrumentId = position.instrumentId;
    let instrumentAngelegt = false;
    if (!instrumentId) {
      const bezeichnung = w.bezeichnung ?? (art === "offene_beteiligung" ? `${runde.bezeichnung}-Anteile` : `${INSTRUMENT_BEZEICHNUNG[art]} ${runde.bezeichnung}`);
      const neu = await legeInstrumentAn(tx, protokoll, b.id, { art, bezeichnung, rundeId: runde.id, anteilsklasseId: position.anteilsklasseId });
      instrumentId = neu.id;
      instrumentAngelegt = true;
      await tx.update(rundenposition).set({ instrumentId }).where(eq(rundenposition.id, position.id));
    } else {
      const [vorhanden] = await tx.select({ id: instrument.id }).from(instrument).where(eq(instrument.id, instrumentId));
      if (!vorhanden) throw new Fachfehler(404, "instrument_not_found", "Instrument not found.");
    }
    const vorgangIds: string[] = [];
    let trancheId: string | null;
    const buche = async (vorgangArt: "zusage" | "auszahlung", valuta: string, betrag: string, bemerkung: string, tranchenId?: string) => {
      const { vorgang: v } = await bucheVorgang(tx, protokoll, b.id, { art: vorgangArt, valuta, betrag, bemerkung, instrumentId: instrumentId!, ...(tranchenId ? { trancheId: tranchenId } : {}) });
      await tx.insert(rundeBuchung).values({ vorgangId: v.id, rundeId: runde.id, positionId: position.id, art: vorgangArt });
      vorgangIds.push(v.id);
    };
    // Die Tranche der Runde: bei erneutem Abschluss (Wiedereröffnung, Storno der Zusage) die vorhandene, sonst eine über den Betrag der Position.
    const [vorhandeneTranche] = await tx.select({ id: tranche.id }).from(tranche).where(eq(tranche.instrumentId, instrumentId)).orderBy(tranche.nummer).limit(1);
    if (w.zusage) {
      await buche("zusage", w.zusageValuta ?? runde.datum, position.betrag, `Runde ${runde.bezeichnung}`);
      trancheId = vorhandeneTranche?.id ?? (await legeTrancheAn(tx, protokoll, instrumentId, { bezeichnung: runde.bezeichnung, betrag: position.betrag, geplantAm: runde.datum })).tranche.id;
    } else {
      trancheId = vorhandeneTranche?.id ?? null;
    }
    for (const a of w.auszahlungen) await buche("auszahlung", a.valuta, a.betrag, `Runde ${runde.bezeichnung}`, trancheId ?? undefined);
    ergebnisse.push({ positionId: position.id, fondsId, beteiligungId: b.id, beteiligungAngelegt: b.angelegt, instrumentId, instrumentAngelegt, trancheId, vorgangIds });
  }
  return ergebnisse;
}

/** Hat die Position Buchungen aus dem Abschluss, ein daraus entstandenes Instrument oder Zahlungen von Co-Investoren? Dann lässt sie sich nicht entfernen. */
export async function positionVerwendet(tx: Tx, positionId: string): Promise<boolean> {
  const { rows } = await tx.execute<{ n: number }>(sql`
    SELECT (SELECT count(*) FROM runde_buchung WHERE position_id = ${positionId}) + (SELECT count(*) FROM rundenposition_zahlung WHERE position_id = ${positionId})
      + (SELECT count(*) FROM rundenposition WHERE id = ${positionId} AND instrument_id IS NOT NULL) AS n`);
  return Number(rows[0]?.n) > 0;
}
