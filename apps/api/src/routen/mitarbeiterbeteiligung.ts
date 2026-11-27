import { portfolioAnApi } from "../portfolio-vertrag";
import { pruefePortfolio } from "../portfolio-pruefung";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { finanzierungsrunde, mitarbeiterpool, mitarbeiterzuteilung, poolAenderung, zuteilungAustritt, type Db } from "@carraway/db";
import { aufteilung, Decimal, einheitenBeimExit, poolStand, vergleiche, VESTING_TAKTE } from "@carraway/rechenkern";
import { aktuellerAkteur, fuerBereich, type Akteur } from "../anmeldung/akteur";
import { hatBereich } from "../rechte/bereiche";
import { Fachfehler, type Feldfehler } from "../fehler";
import { kernZuteilung, ladeAustritte, mitAustritten, standDesPools, type AustrittKern, type PoolErfassung, type ZuteilungKern } from "../kapital/pool";
import { verlangeRundenLeserecht, verlangeRundenrecht } from "../kapital/runden";
import { heute, idParam, ladeOrganisation, MINDESTENS_EIN_FELD, mindestensEins, nurGesetzte, schreibe, textEingabe, type Protokollant } from "../schreiben";
import { lese, type Tx } from "../zeitlimit";

/**
 * Mitarbeiterbeteiligung eines Unternehmens (ESOP/VSOP): Pools mit Verlauf der Größe (Schaffung, Aufstockung, optional einer Runde im Pre-
 * oder Post-Money zugeordnet), je Pool grob erfasst (vergebene Einheiten, mittlerer Basispreis) oder einzeln mit Zuteilungen je Person oder
 * Vertrag (Entscheidungen 486 und 522). Pools: Rechte wie bei den Runden des Unternehmens; lesen darf, wer die Runden lesen darf
 * (`verlangeRundenLeserecht`), anlegen und ändern verlangt dasselbe wie das Anlegen einer Runde (`verlangeRundenrecht`, bearbeiter).
 * Einzelzuteilungen gehören zum eigenen Bereich `einzelzuteilungen`: Ihre Routen liegen dort (`rechte/bereiche.ts`), die Liste der Pools
 * liefert sie nur mit diesem Bereich, sonst nur die Summen. Kennung (Pseudonym) ist der Standard, der Name optional; er steht nie im
 * Änderungsprotokoll (Platzhalter) und lässt sich mit Anonymisieren löschen. Die Regeln (Vesting, Stand des Pools) rechnet der Rechenkern
 * (`mitarbeiterbeteiligung.ts`).
 *
 * Erfassung: Zuteilungen nur bei `einzeln`; die erste Zuteilung stellt einen grob erfassten Pool um. Der Wechsel grob → einzeln behält die
 * Schätzung (Vergleich der Vollständigkeit), zurück nur ohne Zuteilungen (`pool_has_grants`). Grob: vergebene Einheiten höchstens die Größe nach allen Änderungen (`granted_exceeds_pool`).
 *
 * Regeln über mehrere Datensätze: Die Größe eines Pools ist zu keinem Datum negativ (`pool_negative`), und die nicht verfallenen
 * Zuteilungen übersteigen die Größe zu keinem Datum (`grant_exceeds_pool`): Zuteilungen bis zu einem Datum ≤ Größe zu diesem Datum.
 *
 * Austritte (Leaver) je Zuteilung, auch mehrere (aggregierte Zuteilung): Art (`good_leaver`, `bad_leaver`), Austrittsdatum, betroffene
 * Einheiten und Regel für die gevesteten Einheiten (`bleiben`, `verfallen`, `rueckkauf`). Ohne Regel gilt die übliche Vorgabe (Good
 * Leaver: bleiben, Bad Leaver: verfallen), ohne Einheiten alle noch nicht betroffenen; Rückkaufpreis nur bei Rückkauf (leer: Basispreis).
 * Die betroffenen Einheiten aller Austritte zusammen höchstens die Anzahl, kein Austritt vor der Zuteilung, eine ausgeübte Zuteilung hat
 * keine Austritte. Anlegen, Ändern und Entfernen antworten mit der ganzen Zuteilung.
 */

export const anzahlEingabe = z.string().regex(/^[1-9]\d{0,17}$/, "Whole number greater than zero expected");
const aenderungEingabe = z.string().regex(/^-?[1-9]\d{0,17}$/, "Non-zero whole number expected");
const preisEingabe = z.string().regex(/^\d{1,14}(\.\d{1,4})?$/, "Amount of zero or more with at most four decimal places expected");
const bruchEingabe = z.string().regex(/^(0(\.\d{1,4})?|1(\.0{1,4})?)$/, "Fraction from 0 to 1 with at most four decimal places expected");
const monate = z.number().int().min(0).max(240);
export const art = z.enum(["esop", "vsop"]);
const regel = z.enum(["wie_anteile", "anteilig"]);
export const basis = z.enum(["pre_money", "post_money"]);
const kategorie = z.enum(["gruender", "fuehrung", "mitarbeitende", "beirat", "sonstige"]);
const status = z.enum(["zugeteilt", "gevestet", "verfallen", "ausgeuebt"]);
const leaverArt = z.enum(["good_leaver", "bad_leaver"]);
const leaverGevestet = z.enum(["bleiben", "verfallen", "rueckkauf"]);
const erfassung = z.enum(["grob", "einzeln"]);
const ausloeser = z.enum(["einfach", "doppelt"]);
const takt = z.number().int().refine((t) => VESTING_TAKTE.includes(t), "Vesting interval of 1, 3, 6 or 12 months expected");
const vergebenEingabe = z.string().regex(/^(0|[1-9]\d{0,17})$/, "Whole number of zero or more expected");

const aenderungKoerper = {
  datum: z.iso.date(),
  beschluss: textEingabe(500).nullable().optional(),
  dokumentId: z.uuid().nullable().optional(),
  rundeId: z.uuid().nullable().optional(),
  basis: basis.nullable().optional(),
};

export const neuerPool = z.object({
  art,
  bezeichnung: textEingabe(100),
  regel: regel.default("wie_anteile"),
  notiz: textEingabe(2000).nullable().optional(),
  erfassung: erfassung.default("grob"),
  vergeben: vergebenEingabe.nullable().optional(),
  basispreisMittel: preisEingabe.nullable().optional(),
  groesse: anzahlEingabe,
  ...aenderungKoerper,
});
const poolAenderungEingabe = z
  .object({
    bezeichnung: textEingabe(100).optional(),
    regel: regel.optional(),
    notiz: textEingabe(2000).nullable().optional(),
    erfassung: erfassung.optional(),
    vergeben: vergebenEingabe.nullable().optional(),
    basispreisMittel: preisEingabe.nullable().optional(),
  })
  .refine(mindestensEins, MINDESTENS_EIN_FELD);
const neueAenderung = z.object({ anzahl: aenderungEingabe, ...aenderungKoerper });
const aenderungAendern = z
  .object({ anzahl: aenderungEingabe.optional(), datum: aenderungKoerper.datum.optional(), beschluss: aenderungKoerper.beschluss, dokumentId: aenderungKoerper.dokumentId, rundeId: aenderungKoerper.rundeId, basis: aenderungKoerper.basis })
  .refine(mindestensEins, MINDESTENS_EIN_FELD);

const zuteilungBasis = {
  kategorie,
  bezeichnung: textEingabe(200).nullable(),
  anzahl: anzahlEingabe,
  basispreis: preisEingabe,
  zugeteiltAm: z.iso.date(),
  vestingBeginn: z.iso.date().nullable(),
  cliffMonate: monate,
  vestingMonate: monate,
  beschleunigung: bruchEingabe,
  status,
  statusAm: z.iso.date().nullable(),
  leaverRegel: textEingabe(500).nullable(),
  kennung: textEingabe(100).nullable(),
  name: textEingabe(200).nullable(),
  taktMonate: takt,
  ausloeser,
  ausuebungsfristMonate: monate.nullable(),
  laufzeitBis: z.iso.date().nullable(),
};
export const neueZuteilung = z.object({
  kategorie: zuteilungBasis.kategorie,
  bezeichnung: zuteilungBasis.bezeichnung.optional(),
  anzahl: zuteilungBasis.anzahl,
  basispreis: zuteilungBasis.basispreis.default("0"),
  zugeteiltAm: zuteilungBasis.zugeteiltAm,
  vestingBeginn: zuteilungBasis.vestingBeginn.optional(),
  cliffMonate: zuteilungBasis.cliffMonate.default(12),
  vestingMonate: zuteilungBasis.vestingMonate.default(48),
  beschleunigung: zuteilungBasis.beschleunigung.default("0"),
  status: zuteilungBasis.status.default("zugeteilt"),
  statusAm: zuteilungBasis.statusAm.optional(),
  leaverRegel: zuteilungBasis.leaverRegel.optional(),
  kennung: zuteilungBasis.kennung.optional(),
  name: zuteilungBasis.name.optional(),
  taktMonate: zuteilungBasis.taktMonate.default(1),
  ausloeser: zuteilungBasis.ausloeser.default("einfach"),
  ausuebungsfristMonate: zuteilungBasis.ausuebungsfristMonate.optional(),
  laufzeitBis: zuteilungBasis.laufzeitBis.optional(),
});
const zuteilungAenderung = z
  .object(Object.fromEntries(Object.entries(zuteilungBasis).map(([k, v]) => [k, v.optional()])) as { [K in keyof typeof zuteilungBasis]: z.ZodOptional<(typeof zuteilungBasis)[K]> })
  .refine(mindestensEins, MINDESTENS_EIN_FELD);

const austrittBasis = { art: leaverArt, austrittAm: z.iso.date(), anzahl: anzahlEingabe, gevestet: leaverGevestet, rueckkaufpreis: preisEingabe.nullable() };
/** Ohne Einheiten: alle noch nicht von anderen Austritten betroffenen; ohne Regel die Vorgabe der Art. */
export const neuerAustritt = z.object({
  art: austrittBasis.art,
  austrittAm: austrittBasis.austrittAm,
  anzahl: austrittBasis.anzahl.optional(),
  gevestet: austrittBasis.gevestet.optional(),
  rueckkaufpreis: austrittBasis.rueckkaufpreis.optional(),
});
const austrittAenderung = z
  .object(Object.fromEntries(Object.entries(austrittBasis).map(([k, v]) => [k, v.optional()])) as { [K in keyof typeof austrittBasis]: z.ZodOptional<(typeof austrittBasis)[K]> })
  .refine(mindestensEins, MINDESTENS_EIN_FELD);

const poolParam = z.object({ id: z.uuid(), poolId: z.uuid() });
const aenderungParam = z.object({ id: z.uuid(), poolId: z.uuid(), aenderungId: z.uuid() });
const zuteilungParam = z.object({ id: z.uuid(), poolId: z.uuid(), zuteilungId: z.uuid() });
const austrittParam = z.object({ id: z.uuid(), poolId: z.uuid(), zuteilungId: z.uuid(), austrittId: z.uuid() });
const stichtagAbfrage = z.object({ stichtag: z.iso.date().optional() });

type Pool = typeof mitarbeiterpool.$inferSelect;
type Aenderung = typeof poolAenderung.$inferSelect;
type Zuteilung = typeof mitarbeiterzuteilung.$inferSelect;
type Austritt = typeof zuteilungAustritt.$inferSelect;
type ZuteilungMitAustritten = Zuteilung & { austritte: Austritt[] };

function ungueltig(felder: Feldfehler[]): never {
  throw new Fachfehler(400, "invalid_input", "The input is invalid.", { felder });
}

export async function ladePool(tx: Tx, organisationId: string, poolId: string, sperren = false): Promise<Pool> {
  const abfrage = tx.select().from(mitarbeiterpool).where(and(eq(mitarbeiterpool.id, poolId), eq(mitarbeiterpool.organisationId, organisationId)));
  const [pool] = sperren ? await abfrage.for("update") : await abfrage;
  if (!pool) throw new Fachfehler(404, "employee_pool_not_found", "Employee pool not found.");
  return pool;
}

async function ladeAenderung(tx: Tx, poolId: string, aenderungId: string, sperren = true): Promise<Aenderung> {
  const abfrage = tx.select().from(poolAenderung).where(and(eq(poolAenderung.id, aenderungId), eq(poolAenderung.poolId, poolId)));
  const [a] = sperren ? await abfrage.for("update") : await abfrage;
  if (!a) throw new Fachfehler(404, "pool_change_not_found", "Pool change not found.");
  return a;
}

async function pruefeNameFrei(tx: Tx, organisationId: string, bezeichnung: string, ausser?: string) {
  const [vorhanden] = await tx.select({ id: mitarbeiterpool.id }).from(mitarbeiterpool).where(and(eq(mitarbeiterpool.organisationId, organisationId), eq(mitarbeiterpool.bezeichnung, bezeichnung)));
  if (vorhanden && vorhanden.id !== ausser) throw new Fachfehler(409, "employee_pool_name_exists", "This company already has a pool with this name.");
}

/** Eine Regel `anteilig` gibt es nur bei VSOP. */
function pruefeRegel(a: "esop" | "vsop", r: "wie_anteile" | "anteilig") {
  if (a === "esop" && r === "anteilig") ungueltig([{ feld: "regel", code: "rule_vsop_only", meldung: "Pro-rata reduction of all proceeds is only available for VSOP" }]);
}

/** Runde und Basis gehören zusammen; die Runde muss zum Unternehmen gehören. */
async function pruefeRundenbezug(tx: Tx, organisationId: string, e: { rundeId?: string | null | undefined; basis?: string | null | undefined }) {
  const runde = e.rundeId ?? null;
  const b = e.basis ?? null;
  if ((runde === null) !== (b === null)) ungueltig([{ feld: runde === null ? "rundeId" : "basis", code: "round_and_basis", meldung: "Round and pre- or post-money go together" }]);
  if (runde === null) return;
  const [r] = await tx.select({ organisationId: finanzierungsrunde.organisationId, art: finanzierungsrunde.art }).from(finanzierungsrunde).where(eq(finanzierungsrunde.id, runde)).for("share");
  if (!r) throw new Fachfehler(404, "round_not_found", "Financing round not found.");
  if (r.organisationId !== organisationId) throw new Fachfehler(409, "round_mismatch", "The round belongs to a different company than the pool.");
  // Pre- oder Post-Money setzen eine Bewertung voraus: Eine Brückenrunde hat keine, ihr lässt sich keine Änderung zuordnen (wie beim Anlegen).
  if (r.art === "bruecke") throw new Fachfehler(409, "pool_change_bridge", "A pool change cannot be assigned to a bridge round; it has no valuation.");
}

/**
 * Sperrt die Runden (gemeinsam, in fester Reihenfolge) vor dem Pool: Die Pfade der Runde (`laden` in `kapital/runden.ts`) sperren erst die Runde
 * und dann die Pools; dieselbe Reihenfolge vermeidet Verklemmungen. Abschließen, Wiedereröffnen, Umstellen und Löschen der Runde warten, bis die
 * Transaktion endet, und eine hier geprüfte Runde ändert ihren Status nicht zwischen Prüfung und Schreiben.
 */
async function sperreRunden(tx: Tx, ids: readonly (string | null | undefined)[]) {
  for (const rundeId of [...new Set(ids.filter((i): i is string => !!i))].sort()) await tx.select({ id: finanzierungsrunde.id }).from(finanzierungsrunde).where(eq(finanzierungsrunde.id, rundeId)).for("share");
}

/**
 * Eine Änderung mit Bezug zu einer Runde folgt ihr (Entscheidung 495): Ändern, Löschen und eine neue Zuordnung beim Ändern nur, solange die
 * Runde ein Entwurf ist. Das Anlegen darf auf abgeschlossene Runden verweisen (Erfassung des Bestands zu einer früheren Runde).
 */
async function verlangeRundeOffen(tx: Tx, a: Pick<Aenderung, "rundeId">) {
  if (a.rundeId === null) return;
  const [r] = await tx.select({ status: finanzierungsrunde.status }).from(finanzierungsrunde).where(eq(finanzierungsrunde.id, a.rundeId)).for("share");
  if (r && r.status !== "entwurf") throw new Fachfehler(409, "pool_change_round_fixed", "The change is assigned to a closed round and can no longer be changed or deleted. Reopen the round first.", { rundeId: a.rundeId });
}

/** Zuteilung: Status mit Datum, Datum nicht vor der Zuteilung. */
function pruefeZuteilung(z: { status: string; statusAm: string | null; zugeteiltAm: string; laufzeitBis?: string | null }) {
  const felder: Feldfehler[] = [];
  if ((z.status === "verfallen" || z.status === "ausgeuebt") && z.statusAm === null) felder.push({ feld: "statusAm", code: "status_without_date", meldung: "Forfeited and exercised require a date" });
  if (z.statusAm !== null && vergleiche(z.statusAm, z.zugeteiltAm) < 0) felder.push({ feld: "statusAm", code: "before_grant", meldung: "The date is before the grant" });
  if (z.laufzeitBis != null && vergleiche(z.laufzeitBis, z.zugeteiltAm) < 0) felder.push({ feld: "laufzeitBis", code: "before_grant", meldung: "The expiry is before the grant" });
  if (felder.length) ungueltig(felder);
}

/**
 * Sieht die Person Einzelzuteilungen? Nur mit dem Bereich Einzelzuteilungen und dem Leserecht der Runden in diesem Bereich (gleiche Fonds wie
 * beim Pool, Stufe am Bereich Einzelzuteilungen). Ohne ihn liefert die Liste der Pools nur Summen.
 */
export async function siehtEinzelzuteilungen(tx: Tx, akteur: Akteur, organisationId: string): Promise<boolean> {
  if (akteur.globalVerwalter) return true;
  if (!hatBereich(akteur, "einzelzuteilungen")) return false;
  try {
    await verlangeRundenLeserecht(tx, fuerBereich(akteur, "einzelzuteilungen"), organisationId);
    return true;
  } catch (e) {
    if (e instanceof Fachfehler && e.status === 403) return false;
    throw e;
  }
}

/**
 * Zuteilungen gibt es nur in einem einzeln erfassten Pool: Die erste Zuteilung eines grob erfassten Pools stellt ihn auf `einzeln` um (die
 * Schätzung bleibt als Vergleichswert, protokolliert wie jede Änderung des Pools).
 */
export async function stelleAufEinzeln(tx: Tx, protokoll: Protokollant, pool: Pool): Promise<Pool> {
  if (pool.erfassung === "einzeln") return pool;
  const [neu] = await tx.update(mitarbeiterpool).set({ erfassung: "einzeln" }).where(eq(mitarbeiterpool.id, pool.id)).returning();
  await protokoll("aendern", "mitarbeiterpool", pool.id, pool, neu);
  return neu!;
}

/**
 * Angaben mit möglichem Personenbezug stehen nie im Änderungsprotokoll: Das Protokoll ist unveränderlich, ein Wert ließe sich dort nach dem
 * Anonymisieren nicht mehr löschen. Name, Kennung (Pseudonym, etwa eine Personalnummer) und die Freitexte Bezeichnung und Leaver-Notiz
 * erscheinen nur als Platzhalter („gesetzt“) oder leer; Zahlen, Daten und Regeln bleiben nachvollziehbar. Austritte enthalten keine solchen Angaben.
 */
export const VERDECKT_IM_PROTOKOLL = "[hidden]";
const PERSONENFELDER = ["name", "kennung", "bezeichnung", "leaverRegel"] as const;
export function zuteilungFuersProtokoll<T extends Partial<Record<(typeof PERSONENFELDER)[number], string | null>>>(z: T, organisationId: string) {
  const verdeckt = Object.fromEntries(PERSONENFELDER.filter((f) => f in z).map((f) => [f, z[f] ? VERDECKT_IM_PROTOKOLL : null]));
  return { ...z, ...verdeckt, organisationId };
}

/** Austritte passen zur Zuteilung: zusammen höchstens ihre Anzahl, keiner vor der Zuteilung, keine bei einer ausgeübten Zuteilung. */
function pruefeAustritteDerZuteilung(z: Pick<Zuteilung, "anzahl" | "zugeteiltAm" | "status">, austritte: readonly Pick<Austritt, "austrittAm" | "anzahl">[]) {
  if (austritte.length === 0) return;
  const felder: Feldfehler[] = [];
  const summe = austritte.reduce((s, a) => s.plus(a.anzahl), new Decimal(0));
  if (summe.greaterThan(z.anzahl)) felder.push({ feld: "anzahl", code: "below_leavers", meldung: `The leavers cover ${summe.toFixed(0)} units, more than granted` });
  if (austritte.some((a) => vergleiche(a.austrittAm, z.zugeteiltAm) < 0)) felder.push({ feld: "zugeteiltAm", code: "after_leaving", meldung: "The grant is after a leaver" });
  if (z.status === "ausgeuebt") felder.push({ feld: "status", code: "exercised_with_leaver", meldung: "An exercised grant has no leavers" });
  if (felder.length) ungueltig(felder);
}

/** Ohne Regel für die gevesteten Einheiten gilt die übliche Vorgabe: Good Leaver behält sie, beim Bad Leaver verfallen sie. */
function vorgabeGevestet(art: "good_leaver" | "bad_leaver"): "bleiben" | "verfallen" {
  return art === "good_leaver" ? "bleiben" : "verfallen";
}

/** Ein Austritt: nicht vor der Zuteilung, Preis nur beim Rückkauf, mit den übrigen Austritten nicht über der Anzahl, nicht bei ausgeübten. */
function pruefeAustritt(a: Pick<Austritt, "austrittAm" | "anzahl" | "gevestet" | "rueckkaufpreis">, z: Pick<Zuteilung, "anzahl" | "zugeteiltAm" | "status">, andere: readonly Pick<Austritt, "anzahl">[]) {
  const felder: Feldfehler[] = [];
  if (vergleiche(a.austrittAm, z.zugeteiltAm) < 0) felder.push({ feld: "austrittAm", code: "before_grant", meldung: "The leaver is before the grant" });
  const frei = andere.reduce((s, o) => s.minus(o.anzahl), new Decimal(z.anzahl));
  if (new Decimal(a.anzahl).greaterThan(frei)) felder.push({ feld: "anzahl", code: "exceeds_count", meldung: `More affected units than still granted (${Decimal.max(0, frei).toFixed(0)} without leaver)` });
  if (a.rueckkaufpreis !== null && a.gevestet !== "rueckkauf") felder.push({ feld: "rueckkaufpreis", code: "price_without_buyback", meldung: "A buyback price only applies to a buyback" });
  if (z.status === "ausgeuebt") felder.push({ feld: "art", code: "exercised_with_leaver", meldung: "An exercised grant has no leavers" });
  if (felder.length) ungueltig(felder);
}

/**
 * Prüft die Regeln über alle Änderungen und Zuteilungen eines Pools: Größe nie negativ, Zuteilungen nie über der Größe. Geprüft wird an
 * jedem Datum, an dem sich etwas ändert.
 */
export function pruefeBestand(aenderungen: readonly Pick<Aenderung, "datum" | "anzahl">[], zuteilungen: readonly ZuteilungKern[], pool?: PoolErfassung) {
  if (pool?.erfassung === "grob" && pool.vergeben !== null) {
    const groesse = aenderungen.reduce((s, a) => s.plus(a.anzahl), new Decimal(0));
    if (new Decimal(pool.vergeben).greaterThan(groesse)) throw new Fachfehler(409, "granted_exceeds_pool", "The granted units exceed the pool size.", { groesse: groesse.toFixed(0), vergeben: new Decimal(pool.vergeben).toFixed(0) });
  }
  const daten = [...new Set([...aenderungen.map((a) => a.datum), ...zuteilungen.flatMap((z) => [z.zugeteiltAm, z.statusAm, ...z.austritte.map((a) => a.austrittAm)]).filter((d): d is string => d !== null)])].sort();
  const kern = zuteilungen.map(kernZuteilung);
  for (const datum of daten) {
    const stand = poolStand(aenderungen, kern, datum);
    if (stand.groesse.isNegative()) throw new Fachfehler(409, "pool_negative", "The pool size would be negative on this date.", { datum, groesse: stand.groesse.toFixed(0) });
    if (stand.ausstehend.plus(stand.ausgeuebt).greaterThan(stand.groesse)) {
      throw new Fachfehler(409, "grant_exceeds_pool", "The grants exceed the pool size.", { datum, groesse: stand.groesse.toFixed(0), zugeteilt: stand.ausstehend.plus(stand.ausgeuebt).toFixed(0) });
    }
  }
}

export async function bestandDesPools(tx: Tx, poolId: string) {
  const aenderungen = await tx.select().from(poolAenderung).where(eq(poolAenderung.poolId, poolId)).orderBy(asc(poolAenderung.datum), asc(poolAenderung.erstelltAm));
  const zeilen = await tx.select().from(mitarbeiterzuteilung).where(eq(mitarbeiterzuteilung.poolId, poolId)).orderBy(asc(mitarbeiterzuteilung.zugeteiltAm), asc(mitarbeiterzuteilung.erstelltAm));
  const zuteilungen = mitAustritten(zeilen, await ladeAustritte(tx, zeilen.map((z) => z.id)));
  return { aenderungen, zuteilungen };
}

const aenderungAntwort = (a: Aenderung) => ({ id: a.id, datum: a.datum, anzahl: new Decimal(a.anzahl).toFixed(0), beschluss: a.beschluss, dokumentId: a.dokumentId, rundeId: a.rundeId, basis: a.basis });

/** Das Dokument eines Beschlusses muss mit dem Unternehmen oder der zugeordneten Runde verknüpft sein. */
async function pruefeDokument(tx: Tx, organisationId: string, e: { dokumentId?: string | null | undefined; rundeId?: string | null | undefined }) {
  if (!e.dokumentId) return;
  const ziele = [sql`(v.ziel_typ = 'organisation' AND v.ziel_id = ${organisationId})`, ...(e.rundeId ? [sql`(v.ziel_typ = 'finanzierungsrunde' AND v.ziel_id = ${e.rundeId})`] : [])];
  const { rows } = await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM dokument_verknuepfung v WHERE v.dokument_id = ${e.dokumentId} AND (${sql.join(ziele, sql` OR `)})`);
  if (!rows[0]?.n) ungueltig([{ feld: "dokumentId", code: "document_not_linked", meldung: "The document is not linked to the company or the round" }]);
}

const austrittAntwort = (a: Austritt) => ({
  id: a.id,
  art: a.art,
  austrittAm: a.austrittAm,
  anzahl: new Decimal(a.anzahl).toFixed(0),
  gevestet: a.gevestet,
  rueckkaufpreis: a.rueckkaufpreis === null ? null : new Decimal(a.rueckkaufpreis).toFixed(4),
});

function zuteilungAntwort(z: ZuteilungMitAustritten, stichtag: string) {
  const vesting = kernZuteilung(z);
  const vorher = vergleiche(z.zugeteiltAm, stichtag) > 0;
  const a = aufteilung(vesting, stichtag);
  return {
    id: z.id,
    kategorie: z.kategorie,
    bezeichnung: z.bezeichnung,
    anzahl: new Decimal(z.anzahl).toFixed(0),
    basispreis: new Decimal(z.basispreis).toFixed(4),
    zugeteiltAm: z.zugeteiltAm,
    vestingBeginn: z.vestingBeginn,
    cliffMonate: z.cliffMonate,
    vestingMonate: z.vestingMonate,
    beschleunigung: new Decimal(z.beschleunigung).toFixed(4),
    status: z.status,
    statusAm: z.statusAm,
    leaverRegel: z.leaverRegel,
    /** Kennung (Pseudonym) und optionaler Name; nach dem Anonymisieren beide leer. */
    kennung: z.kennung,
    name: z.name,
    anonymisiertAm: z.anonymisiertAm ? z.anonymisiertAm.toISOString() : null,
    taktMonate: z.taktMonate,
    ausloeser: z.ausloeser,
    ausuebungsfristMonate: z.ausuebungsfristMonate,
    laufzeitBis: z.laufzeitBis,
    /** Laufzeitende erreicht, aber noch Einheiten ausstehend (Hinweis: Status prüfen). */
    laufzeitAbgelaufen: !vorher && z.laufzeitBis !== null && vergleiche(z.laufzeitBis, stichtag) <= 0 && a.verbleibend.greaterThan(0),
    /** Alle Austritte nach Datum, auch die nach dem Stichtag. */
    austritte: z.austritte.map(austrittAntwort),
    /** Von den Austritten bis zum Stichtag betroffene Einheiten (gleich der Anzahl: alle ausgeschieden). */
    betroffen: vorher ? "0" : a.betroffen.toFixed(0),
    /** Gevestet zum Stichtag (nach Plan, Status und Austritten) und Einheiten bei einem Exit zum Stichtag (mit Beschleunigung). */
    gevestet: vorher ? "0" : a.gevestet.toFixed(0),
    beimExit: vorher ? "0" : einheitenBeimExit(vesting, stichtag).toFixed(0),
    /** Zum Stichtag verfallen (Status oder Austritt) und zurückgekauft (beides zurück im freien Pool), verbleibend = ausstehend. */
    verfallen: vorher ? "0" : a.verfallen.toFixed(0),
    rueckgekauft: vorher ? "0" : a.rueckgekauft.toFixed(0),
    verbleibend: vorher ? "0" : a.verbleibend.toFixed(0),
    rueckkaufBetrag: vorher ? "0.00" : a.rueckkaufBetrag.toFixed(2),
  };
}

/** `einzelSichtbar`: Hat die Person den Bereich Einzelzuteilungen? Ohne ihn bleiben die Zuteilungen leer, die Summen im Stand gelten weiter. */
function poolAntwort(p: Pool, aenderungen: Aenderung[], zuteilungen: ZuteilungMitAustritten[], stichtag: string, einzelSichtbar = true) {
  const stand = standDesPools(p, aenderungen, zuteilungen, stichtag);
  return {
    id: p.id,
    organisationId: p.organisationId,
    art: p.art,
    bezeichnung: p.bezeichnung,
    regel: p.regel,
    notiz: p.notiz,
    erfassung: p.erfassung,
    /** Schätzung der vergebenen Einheiten und mittlerer Basispreis; bei `einzeln` der Vergleichswert für die Vollständigkeit. */
    vergeben: p.vergeben === null ? null : new Decimal(p.vergeben).toFixed(0),
    basispreisMittel: p.basispreisMittel === null ? null : new Decimal(p.basispreisMittel).toFixed(4),
    einzelSichtbar,
    stand: {
      stichtag,
      groesse: stand.groesse.toFixed(0),
      ausstehend: stand.ausstehend.toFixed(0),
      ausgeuebt: stand.ausgeuebt.toFixed(0),
      verfallen: stand.verfallen.toFixed(0),
      rueckgekauft: stand.rueckgekauft.toFixed(0),
      frei: stand.frei.toFixed(0),
      vollVerwaessert: stand.vollVerwaessert.toFixed(0),
    },
    aenderungen: aenderungen.map(aenderungAntwort),
    zuteilungen: einzelSichtbar ? zuteilungen.map((z) => zuteilungAntwort(z, stichtag)) : [],
  };
}

/** Legt einen Pool mit seiner ersten Änderung (Schaffung) an; die Rechte prüft der Aufrufer. */
export async function legePoolAn(tx: Tx, protokoll: Protokollant, organisationId: string, e: Omit<z.infer<typeof neuerPool>, "erfassung"> & { erfassung?: "grob" | "einzeln" }) {
  pruefeRegel(e.art, e.regel);
  await ladeOrganisation(tx, organisationId);
  await pruefeNameFrei(tx, organisationId, e.bezeichnung);
  await pruefeRundenbezug(tx, organisationId, e);
  const erfassungDesPools = e.erfassung ?? "grob";
  pruefeBestand([{ datum: e.datum, anzahl: e.groesse }], [], { erfassung: erfassungDesPools, vergeben: e.vergeben ?? null });
  const [pool] = await tx
    .insert(mitarbeiterpool)
    .values({ organisationId, art: e.art, bezeichnung: e.bezeichnung, regel: e.regel, notiz: e.notiz ?? null, erfassung: erfassungDesPools, vergeben: e.vergeben ?? null, basispreisMittel: e.basispreisMittel ?? null })
    .returning();
  await pruefeDokument(tx, organisationId, e);
  const [erste] = await tx.insert(poolAenderung).values({ poolId: pool!.id, datum: e.datum, anzahl: e.groesse, beschluss: e.beschluss ?? null, dokumentId: e.dokumentId ?? null, rundeId: e.rundeId ?? null, basis: e.basis ?? null }).returning();
  await protokoll("anlegen", "mitarbeiterpool", pool!.id, null, pool);
  await protokoll("anlegen", "pool_aenderung", erste!.id, null, { ...erste, organisationId });
  return { pool: pool!, aenderung: erste! };
}

function sortiereAustritte(austritte: Austritt[]): Austritt[] {
  return [...austritte].sort((a, b) => vergleiche(a.austrittAm, b.austrittAm) || a.erstelltAm.getTime() - b.erstelltAm.getTime() || a.id.localeCompare(b.id));
}

/** Rechte, Pool gesperrt, Zuteilung mit Austritten und Bestand des Pools für das Schreiben eines Austritts. */
async function ladeZuteilungZumSchreiben(tx: Tx, c: Parameters<typeof aktuellerAkteur>[0], organisationId: string, poolId: string, zuteilungId: string) {
  await ladeOrganisation(tx, organisationId);
  await verlangeRundenrecht(tx, aktuellerAkteur(c), organisationId, "bearbeiter");
  await ladePool(tx, organisationId, poolId, true);
  const bestand = await bestandDesPools(tx, poolId);
  const zuteilung = bestand.zuteilungen.find((z) => z.id === zuteilungId);
  if (!zuteilung) throw new Fachfehler(404, "grant_not_found", "Grant not found.");
  return { zuteilung, bestand };
}

/** Prüft den Pool mit den neuen Austritten der Zuteilung (Austrittsdaten zählen als Prüfdaten). */
function pruefePoolMit(bestand: Awaited<ReturnType<typeof bestandDesPools>>, zuteilungId: string, austritte: readonly AustrittKern[]) {
  pruefeBestand(bestand.aenderungen, bestand.zuteilungen.map((z) => (z.id === zuteilungId ? { ...z, austritte } : z)));
}

/** Mount unter `/organisationen/:id`. */
export function organisationMitarbeiterRouten(db: Db) {
  return new Hono()
    .get("/employee-pools", pruefePortfolio("param", idParam, { query: stichtagAbfrage }), pruefePortfolio("query", stichtagAbfrage), async (c) => {
      const { id } = c.req.valid("param");
      const stichtag = c.req.valid("query").stichtag ?? heute();
      const daten = await lese(db, async (tx) => {
        await ladeOrganisation(tx, id);
        await verlangeRundenLeserecht(tx, aktuellerAkteur(c), id);
        const pools = await tx.select().from(mitarbeiterpool).where(eq(mitarbeiterpool.organisationId, id)).orderBy(asc(mitarbeiterpool.erstelltAm), asc(mitarbeiterpool.id));
        if (pools.length === 0) return [];
        const ids = pools.map((p) => p.id);
        const aenderungen = await tx.select().from(poolAenderung).where(inArray(poolAenderung.poolId, ids)).orderBy(asc(poolAenderung.datum), asc(poolAenderung.erstelltAm));
        const zeilen = await tx.select().from(mitarbeiterzuteilung).where(inArray(mitarbeiterzuteilung.poolId, ids)).orderBy(asc(mitarbeiterzuteilung.zugeteiltAm), asc(mitarbeiterzuteilung.erstelltAm));
        const zuteilungen = mitAustritten(zeilen, await ladeAustritte(tx, zeilen.map((z) => z.id)));
        const einzelSichtbar = await siehtEinzelzuteilungen(tx, aktuellerAkteur(c), id);
        return pools.map((p) => poolAntwort(p, aenderungen.filter((a) => a.poolId === p.id), zuteilungen.filter((z) => z.poolId === p.id), stichtag, einzelSichtbar));
      });
      return c.json(portfolioAnApi({ daten }), 200);
    })
    .post("/employee-pools", pruefePortfolio("param", idParam), pruefePortfolio("json", neuerPool), async (c) => {
      const { id } = c.req.valid("param");
      const e = c.req.valid("json");
      const neu = await schreibe(db, c, async (tx, protokoll) => {
        await ladeOrganisation(tx, id);
        await verlangeRundenrecht(tx, aktuellerAkteur(c), id, "bearbeiter");
        const { pool, aenderung } = await legePoolAn(tx, protokoll, id, e);
        return poolAntwort(pool, [aenderung], [], heute(), await siehtEinzelzuteilungen(tx, aktuellerAkteur(c), id));
      });
      return c.json(portfolioAnApi(neu), 201);
    })
    .patch("/employee-pools/:poolId", pruefePortfolio("param", poolParam), pruefePortfolio("json", poolAenderungEingabe), async (c) => {
      const { id, poolId } = c.req.valid("param");
      const e = c.req.valid("json");
      const nachher = await schreibe(db, c, async (tx, protokoll) => {
        await ladeOrganisation(tx, id);
        await verlangeRundenrecht(tx, aktuellerAkteur(c), id, "bearbeiter");
        const vorher = await ladePool(tx, id, poolId, true);
        const werte = nurGesetzte(e);
        pruefeRegel(vorher.art, werte.regel ?? vorher.regel);
        if (e.bezeichnung !== undefined) await pruefeNameFrei(tx, id, e.bezeichnung, poolId);
        const bestand = await bestandDesPools(tx, poolId);
        const zusammen = { ...vorher, ...werte };
        // Zurück zur groben Erfassung nur ohne Zuteilungen: sonst zählten erfasste Zuteilungen stillschweigend nicht mehr.
        if (zusammen.erfassung === "grob" && bestand.zuteilungen.length > 0) throw new Fachfehler(409, "pool_has_grants", "The pool has individual grants; remove them before switching back to rough recording.");
        pruefeBestand(bestand.aenderungen, bestand.zuteilungen, zusammen);
        const [neu] = await tx.update(mitarbeiterpool).set(werte).where(eq(mitarbeiterpool.id, poolId)).returning();
        await protokoll("aendern", "mitarbeiterpool", poolId, vorher, neu);
        return poolAntwort(neu!, bestand.aenderungen, bestand.zuteilungen, heute(), await siehtEinzelzuteilungen(tx, aktuellerAkteur(c), id));
      });
      return c.json(portfolioAnApi(nachher), 200);
    })
    .post("/employee-pools/:poolId/changes", pruefePortfolio("param", poolParam), pruefePortfolio("json", neueAenderung), async (c) => {
      const { id, poolId } = c.req.valid("param");
      const e = c.req.valid("json");
      const neu = await schreibe(db, c, async (tx, protokoll) => {
        await ladeOrganisation(tx, id);
        await verlangeRundenrecht(tx, aktuellerAkteur(c), id, "bearbeiter");
        await sperreRunden(tx, [e.rundeId]);
        const pool = await ladePool(tx, id, poolId, true);
        await pruefeRundenbezug(tx, id, e);
        const bestand = await bestandDesPools(tx, poolId);
        pruefeBestand([...bestand.aenderungen, { datum: e.datum, anzahl: e.anzahl }], bestand.zuteilungen, pool);
        await pruefeDokument(tx, id, e);
        const [zeile] = await tx.insert(poolAenderung).values({ poolId, datum: e.datum, anzahl: e.anzahl, beschluss: e.beschluss ?? null, dokumentId: e.dokumentId ?? null, rundeId: e.rundeId ?? null, basis: e.basis ?? null }).returning();
        await protokoll("anlegen", "pool_aenderung", zeile!.id, null, { ...zeile, organisationId: id });
        return aenderungAntwort(zeile!);
      });
      return c.json(portfolioAnApi(neu), 201);
    })
    .patch("/employee-pools/:poolId/changes/:changeId", pruefePortfolio("param", aenderungParam), pruefePortfolio("json", aenderungAendern), async (c) => {
      const { id, poolId, aenderungId } = c.req.valid("param");
      const e = c.req.valid("json");
      const nachher = await schreibe(db, c, async (tx, protokoll) => {
        await ladeOrganisation(tx, id);
        await verlangeRundenrecht(tx, aktuellerAkteur(c), id, "bearbeiter");
        await sperreRunden(tx, [(await ladeAenderung(tx, poolId, aenderungId, false)).rundeId, e.rundeId]);
        const pool = await ladePool(tx, id, poolId, true);
        const vorher = await ladeAenderung(tx, poolId, aenderungId);
        await sperreRunden(tx, [vorher.rundeId]);
        await verlangeRundeOffen(tx, vorher);
        const werte = nurGesetzte(e);
        const zusammen = { ...vorher, ...werte };
        await pruefeRundenbezug(tx, id, zusammen);
        // Eine neue Zuordnung braucht einen Entwurf: Mit der Zuordnung zu einer abgeschlossenen Runde wäre die Änderung sofort gesperrt.
        if (zusammen.rundeId !== vorher.rundeId) await verlangeRundeOffen(tx, zusammen);
        if (e.dokumentId !== undefined || zusammen.rundeId !== vorher.rundeId) await pruefeDokument(tx, id, zusammen);
        const bestand = await bestandDesPools(tx, poolId);
        pruefeBestand(bestand.aenderungen.map((a) => (a.id === aenderungId ? zusammen : a)), bestand.zuteilungen, pool);
        const [neu] = await tx.update(poolAenderung).set(werte).where(eq(poolAenderung.id, aenderungId)).returning();
        await protokoll("aendern", "pool_aenderung", aenderungId, { ...vorher, organisationId: id }, { ...neu, organisationId: id });
        return aenderungAntwort(neu!);
      });
      return c.json(portfolioAnApi(nachher), 200);
    })
    .delete("/employee-pools/:poolId/changes/:changeId", pruefePortfolio("param", aenderungParam), async (c) => {
      const { id, poolId, aenderungId } = c.req.valid("param");
      await schreibe(db, c, async (tx, protokoll) => {
        await ladeOrganisation(tx, id);
        await verlangeRundenrecht(tx, aktuellerAkteur(c), id, "bearbeiter");
        await sperreRunden(tx, [(await ladeAenderung(tx, poolId, aenderungId, false)).rundeId]);
        const pool = await ladePool(tx, id, poolId, true);
        const vorher = await ladeAenderung(tx, poolId, aenderungId);
        await sperreRunden(tx, [vorher.rundeId]);
        await verlangeRundeOffen(tx, vorher);
        const bestand = await bestandDesPools(tx, poolId);
        const rest = bestand.aenderungen.filter((a) => a.id !== aenderungId);
        if (rest.length === 0) throw new Fachfehler(409, "pool_last_change", "The only change of a pool cannot be deleted; it sets its size.");
        pruefeBestand(rest, bestand.zuteilungen, pool);
        await tx.delete(poolAenderung).where(eq(poolAenderung.id, aenderungId));
        await protokoll("loeschen", "pool_aenderung", aenderungId, { ...vorher, organisationId: id }, null);
      });
      return c.body(null, 204);
    })
    .post("/employee-pools/:poolId/grants", pruefePortfolio("param", poolParam), pruefePortfolio("json", neueZuteilung), async (c) => {
      const { id, poolId } = c.req.valid("param");
      const e = c.req.valid("json");
      const neu = await schreibe(db, c, async (tx, protokoll) => {
        await ladeOrganisation(tx, id);
        await verlangeRundenrecht(tx, aktuellerAkteur(c), id, "bearbeiter");
        await stelleAufEinzeln(tx, protokoll, await ladePool(tx, id, poolId, true));
        const werte = {
          ...e,
          bezeichnung: e.bezeichnung ?? null,
          vestingBeginn: e.vestingBeginn ?? null,
          statusAm: e.statusAm ?? null,
          leaverRegel: e.leaverRegel ?? null,
          kennung: e.kennung ?? null,
          name: e.name ?? null,
          ausuebungsfristMonate: e.ausuebungsfristMonate ?? null,
          laufzeitBis: e.laufzeitBis ?? null,
        };
        pruefeZuteilung(werte);
        const bestand = await bestandDesPools(tx, poolId);
        pruefeBestand(bestand.aenderungen, [...bestand.zuteilungen, { ...werte, austritte: [] }]);
        const [zeile] = await tx.insert(mitarbeiterzuteilung).values({ poolId, ...werte }).returning();
        await protokoll("anlegen", "mitarbeiterzuteilung", zeile!.id, null, zuteilungFuersProtokoll(zeile!, id));
        return zuteilungAntwort({ ...zeile!, austritte: [] }, heute());
      });
      return c.json(portfolioAnApi(neu), 201);
    })
    .patch("/employee-pools/:poolId/grants/:grantId", pruefePortfolio("param", zuteilungParam), pruefePortfolio("json", zuteilungAenderung), async (c) => {
      const { id, poolId, zuteilungId } = c.req.valid("param");
      const e = c.req.valid("json");
      const nachher = await schreibe(db, c, async (tx, protokoll) => {
        await ladeOrganisation(tx, id);
        await verlangeRundenrecht(tx, aktuellerAkteur(c), id, "bearbeiter");
        await ladePool(tx, id, poolId, true);
        const [vorher] = await tx.select().from(mitarbeiterzuteilung).where(and(eq(mitarbeiterzuteilung.id, zuteilungId), eq(mitarbeiterzuteilung.poolId, poolId))).for("update");
        if (!vorher) throw new Fachfehler(404, "grant_not_found", "Grant not found.");
        const werte = nurGesetzte(e);
        if (vorher.anonymisiertAm !== null && (werte.name || werte.kennung)) throw new Fachfehler(409, "grant_anonymized", "The grant is anonymized; name and reference cannot be set again.");
        const zusammen = { ...vorher, ...werte };
        // Zurück auf zugeteilt oder gevestet: das Datum des früheren Status entfällt, wenn nichts anderes angegeben ist.
        if ((zusammen.status === "zugeteilt" || zusammen.status === "gevestet") && e.statusAm === undefined) zusammen.statusAm = null;
        pruefeZuteilung(zusammen);
        const bestand = await bestandDesPools(tx, poolId);
        const austritte = bestand.zuteilungen.find((z) => z.id === zuteilungId)?.austritte ?? [];
        pruefeAustritteDerZuteilung(zusammen, austritte);
        pruefeBestand(bestand.aenderungen, bestand.zuteilungen.map((z) => (z.id === zuteilungId ? { ...zusammen, austritte } : z)));
        const { id: _id, poolId: _pool, erstelltAm: _am, ...neueWerte } = zusammen;
        const [neu] = await tx.update(mitarbeiterzuteilung).set(neueWerte).where(eq(mitarbeiterzuteilung.id, zuteilungId)).returning();
        await protokoll("aendern", "mitarbeiterzuteilung", zuteilungId, zuteilungFuersProtokoll(vorher, id), zuteilungFuersProtokoll(neu!, id));
        return zuteilungAntwort({ ...neu!, austritte }, heute());
      });
      return c.json(portfolioAnApi(nachher), 200);
    })
    /** Entfernt eine Zuteilung mit ihren Austritten (Fehlerfassung oder Löschung von Beschäftigtendaten); der Bestand muss weiter stimmen. */
    .delete("/employee-pools/:poolId/grants/:grantId", pruefePortfolio("param", zuteilungParam), async (c) => {
      const { id, poolId, zuteilungId } = c.req.valid("param");
      await schreibe(db, c, async (tx, protokoll) => {
        const { zuteilung, bestand } = await ladeZuteilungZumSchreiben(tx, c, id, poolId, zuteilungId);
        pruefeBestand(bestand.aenderungen, bestand.zuteilungen.filter((z) => z.id !== zuteilungId));
        await tx.delete(mitarbeiterzuteilung).where(eq(mitarbeiterzuteilung.id, zuteilungId));
        const { austritte: _austritte, ...zeile } = zuteilung;
        await protokoll("loeschen", "mitarbeiterzuteilung", zuteilungId, zuteilungFuersProtokoll(zeile, id), null);
      });
      return c.body(null, 204);
    })
    /** Anonymisiert eine Zuteilung (etwa nach dem Austritt): Name, Kennung und die Freitexte werden gelöscht, die Zahlen bleiben für Kapitaltabelle und Wasserfall. */
    .post("/employee-pools/:poolId/grants/:grantId/anonymize", pruefePortfolio("param", zuteilungParam), async (c) => {
      const { id, poolId, zuteilungId } = c.req.valid("param");
      const nachher = await schreibe(db, c, async (tx, protokoll) => {
        const { zuteilung } = await ladeZuteilungZumSchreiben(tx, c, id, poolId, zuteilungId);
        const { austritte, ...vorher } = zuteilung;
        const [neu] = await tx.update(mitarbeiterzuteilung).set({ name: null, kennung: null, bezeichnung: null, leaverRegel: null, anonymisiertAm: vorher.anonymisiertAm ?? new Date() }).where(eq(mitarbeiterzuteilung.id, zuteilungId)).returning();
        await protokoll("aendern", "mitarbeiterzuteilung", zuteilungId, zuteilungFuersProtokoll(vorher, id), zuteilungFuersProtokoll(neu!, id));
        return zuteilungAntwort({ ...neu!, austritte }, heute());
      });
      return c.json(portfolioAnApi(nachher), 200);
    })
    .post("/employee-pools/:poolId/grants/:grantId/departures", pruefePortfolio("param", zuteilungParam), pruefePortfolio("json", neuerAustritt), async (c) => {
      const { id, poolId, zuteilungId } = c.req.valid("param");
      const e = c.req.valid("json");
      const neu = await schreibe(db, c, async (tx, protokoll) => {
        const { zuteilung, bestand } = await ladeZuteilungZumSchreiben(tx, c, id, poolId, zuteilungId);
        // Ohne Einheiten: alle, die noch keinen Austritt haben.
        const frei = zuteilung.austritte.reduce((s, a) => s.minus(a.anzahl), new Decimal(zuteilung.anzahl));
        if (e.anzahl === undefined && !frei.greaterThan(0)) ungueltig([{ feld: "anzahl", code: "exceeds_count", meldung: "All units already have a leaver" }]);
        const werte = { art: e.art, austrittAm: e.austrittAm, anzahl: e.anzahl ?? frei.toFixed(0), gevestet: e.gevestet ?? vorgabeGevestet(e.art), rueckkaufpreis: e.rueckkaufpreis ?? null };
        pruefeAustritt(werte, zuteilung, zuteilung.austritte);
        pruefePoolMit(bestand, zuteilungId, [...zuteilung.austritte, werte]);
        const [zeile] = await tx.insert(zuteilungAustritt).values({ zuteilungId, ...werte }).returning();
        await protokoll("anlegen", "zuteilung_austritt", zeile!.id, null, { ...zeile, organisationId: id });
        return zuteilungAntwort({ ...zuteilung, austritte: sortiereAustritte([...zuteilung.austritte, zeile!]) }, heute());
      });
      return c.json(portfolioAnApi(neu), 201);
    })
    .patch("/employee-pools/:poolId/grants/:grantId/departures/:departureId", pruefePortfolio("param", austrittParam), pruefePortfolio("json", austrittAenderung), async (c) => {
      const { id, poolId, zuteilungId, austrittId } = c.req.valid("param");
      const e = c.req.valid("json");
      const nachher = await schreibe(db, c, async (tx, protokoll) => {
        const { zuteilung, bestand } = await ladeZuteilungZumSchreiben(tx, c, id, poolId, zuteilungId);
        const vorher = zuteilung.austritte.find((a) => a.id === austrittId);
        if (!vorher) throw new Fachfehler(404, "leaver_not_found", "Leaver not found.");
        const zusammen = { ...vorher, ...nurGesetzte(e) };
        // Andere Art ohne Regel: die Vorgabe der neuen Art; ohne Rückkauf entfällt der Rückkaufpreis.
        if (e.art !== undefined && e.art !== vorher.art && e.gevestet === undefined) zusammen.gevestet = vorgabeGevestet(e.art);
        if (zusammen.gevestet !== "rueckkauf" && e.rueckkaufpreis === undefined) zusammen.rueckkaufpreis = null;
        const andere = zuteilung.austritte.filter((a) => a.id !== austrittId);
        pruefeAustritt(zusammen, zuteilung, andere);
        pruefePoolMit(bestand, zuteilungId, [...andere, zusammen]);
        const { id: _id, zuteilungId: _z, erstelltAm: _am, ...neueWerte } = zusammen;
        const [neu] = await tx.update(zuteilungAustritt).set(neueWerte).where(eq(zuteilungAustritt.id, austrittId)).returning();
        const austritte = sortiereAustritte([...andere, neu!]);
        await protokoll("aendern", "zuteilung_austritt", austrittId, { ...vorher, organisationId: id }, { ...neu, organisationId: id });
        return zuteilungAntwort({ ...zuteilung, austritte }, heute());
      });
      return c.json(portfolioAnApi(nachher), 200);
    })
    .delete("/employee-pools/:poolId/grants/:grantId/departures/:departureId", pruefePortfolio("param", austrittParam), async (c) => {
      const { id, poolId, zuteilungId, austrittId } = c.req.valid("param");
      const nachher = await schreibe(db, c, async (tx, protokoll) => {
        const { zuteilung, bestand } = await ladeZuteilungZumSchreiben(tx, c, id, poolId, zuteilungId);
        const vorher = zuteilung.austritte.find((a) => a.id === austrittId);
        if (!vorher) throw new Fachfehler(404, "leaver_not_found", "Leaver not found.");
        const austritte = zuteilung.austritte.filter((a) => a.id !== austrittId);
        // Ohne den Austritt bleiben Einheiten zugeteilt, die vorher frei wurden: der Pool muss sie tragen.
        pruefePoolMit(bestand, zuteilungId, austritte);
        await tx.delete(zuteilungAustritt).where(eq(zuteilungAustritt.id, austrittId));
        await protokoll("loeschen", "zuteilung_austritt", austrittId, { ...vorher, organisationId: id }, null);
        return zuteilungAntwort({ ...zuteilung, austritte }, heute());
      });
      return c.json(portfolioAnApi(nachher), 200);
    });
}
