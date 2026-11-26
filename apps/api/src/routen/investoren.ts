import { pruefeFonds } from "../fonds-pruefung";
import { fondsAnApi } from "../fonds-vertrag";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { bericht, fonds, fondsBewegung, fondsClosing, fondsClosingBasis, fondsClosingStand, fondsClosingStorno, fondsClosingZusage, fondsZeichnung, investorZugang, organisation, type Db } from "@carraway/db";
import { Decimal, verteileAnteilig } from "@carraway/rechenkern";
import { abgerufen, sperreFonds } from "../instrumente/fondsbewegung";
import { ladeKapitalstand } from "../instrumente/kapitalstand";
import { pruefePeriodensperre } from "../instrumente/zustand";
import { bereitsZusammengefuehrtFehler, Fachfehler } from "../fehler";
import { schreibe, textEingabe, type Protokollant } from "../schreiben";
import { lese, type Tx } from "../zeitlimit";

/**
 * Zeichnungen, Closings und Zusageänderungen der Investoren eines Fonds (Kapital, Kern). Die Zugänge der Investoren zum LP-Portal
 * (Investor-Benutzer, Einladung, Verknüpfung) gehören zur Erweiterung LP-Portal (`ee/api/src/portal`); diese Routen teilen sich nur den Pfad.
 */

const fondsParam = z.object({ fondsId: z.uuid() });
const zeichnungenEingabe = z.strictObject({
  zeichnungen: z.array(z.strictObject({
    organisationId: z.uuid().transform((id) => id.toLowerCase()),
    zusage: z.string().regex(/^\d{1,16}(\.\d{1,2})?$/).refine((wert) => /[1-9]/.test(wert), "Positive commitment expected"),
  })).min(1).max(200),
});
const betragEingabe = z.string().regex(/^\d{1,16}(\.\d{1,2})?$/).refine((wert) => /[1-9]/.test(wert), "Positive amount expected");
const closingEingabe = z.strictObject({
  /** Tag, ab dem die Zusagen gelten; spätere Abrufe verteilen sich danach, frühere behalten ihre Aufteilung. */
  wirksamAm: z.iso.date(),
  bemerkung: textEingabe(2000).optional(),
  zusagen: z.array(z.strictObject({
    organisationId: z.uuid().transform((id) => id.toLowerCase()),
    /** Neue Zusage eines beitretenden Investors oder Zuwachs (Aufstockung) eines bestehenden. */
    zusage: betragEingabe,
    /** Vertraglich vereinbarter Ausgleich (Equalisation); dokumentiert nur, ohne Wirkung auf Verteilung und Kapitalkonten. */
    ausgleich: z.strictObject({ betrag: betragEingabe, datum: z.iso.date() }).optional(),
  })).min(1).max(200),
});
type ClosingEingabe = z.infer<typeof closingEingabe>;
const closingParam = z.object({ fondsId: z.uuid(), closingId: z.uuid() });
const stornoEingabe = z.strictObject({ grund: textEingabe(2000) });
const betragNullOk = z.string().regex(/^\d{1,16}(\.\d{1,2})?$/);
/** Verringerung der Zusage oder Austritt von Investoren (Issue #132). */
const zusageAenderungEingabe = z.strictObject({
  art: z.enum(["verringerung", "austritt"]),
  wirksamAm: z.iso.date(),
  bemerkung: textEingabe(2000).optional(),
  investoren: z.array(z.strictObject({
    organisationId: z.uuid().transform((id) => id.toLowerCase()),
    /** Neue Gesamtzusage; nur bei einer Verringerung. */
    neueZusage: betragNullOk.optional(),
    /** Vereinbarte Rückzahlung oder Abfindung; dokumentiert nur, ohne Wirkung auf Verteilung und Kapitalkonten. */
    ausgleich: z.strictObject({ betrag: betragEingabe, datum: z.iso.date() }).optional(),
  })).min(1).max(200),
}).superRefine((e, ctx) => {
  e.investoren.forEach((i, index) => {
    if (e.art === "verringerung" && i.neueZusage === undefined) ctx.addIssue({ code: "custom", path: ["investoren", index, "neueZusage"], message: "New commitment required" });
    if (e.art === "austritt" && i.neueZusage !== undefined) ctx.addIssue({ code: "custom", path: ["investoren", index, "neueZusage"], message: "A withdrawal has no new commitment" });
  });
});
const korrekturEingabe = closingEingabe.extend({ grund: textEingabe(2000) });

/** Organisation für einen Zugang: gibt es sie, ist sie nicht zusammengeführt und von der Art `investor`? Die Zeile bleibt gesperrt (hält die Zusammenführung auf). */
export async function ladeInvestorOrganisation(tx: Tx, id: string) {
  const [zeile] = await tx.select().from(organisation).where(eq(organisation.id, id)).for("update");
  if (!zeile) throw new Fachfehler(404, "organization_not_found", "Organization not found.");
  if (zeile.zusammengefuehrtIn) throw bereitsZusammengefuehrtFehler(zeile.zusammengefuehrtIn);
  if (zeile.art !== "investor") throw new Fachfehler(409, "organization_not_investor", "Only organizations of type investor can be assigned to an investor access.");
  return zeile;
}

/** Eine Ersteinrichtung darf keine LP-Verteilung für schon gebuchte Bewegungen oder angelegte Berichte verändern. */
async function hatFondsaktivitaet(tx: Tx, fondsId: string): Promise<boolean> {
  const { rows } = await tx.execute<{ aktiv: boolean }>(sql`
    SELECT EXISTS (SELECT 1 FROM ${fondsBewegung} WHERE ${fondsBewegung.fondsId} = ${fondsId})
      OR EXISTS (SELECT 1 FROM fonds_kosten WHERE fonds_id = ${fondsId})
      OR EXISTS (SELECT 1 FROM ${bericht} WHERE ${bericht.fondsId} = ${fondsId}) AS aktiv
  `);
  return rows[0]!.aktiv;
}

/** Weitere Closings des Fonds, älteste zuerst, mit Zusagen und Ausgleich. `beitritt`: der Investor hatte vorher keine Zusage im Fonds. */
async function ladeClosings(tx: Tx, fondsId: string) {
  const closings = await tx.select().from(fondsClosing).where(eq(fondsClosing.fondsId, fondsId)).orderBy(asc(fondsClosing.wirksamAm), asc(fondsClosing.erfasstAm), asc(fondsClosing.id));
  if (closings.length === 0) return [];
  const zusagen = await tx
    .select({ closingId: fondsClosingZusage.closingId, organisationId: fondsClosingZusage.organisationId, name: organisation.name, zusage: fondsClosingZusage.zusage, ausgleichBetrag: fondsClosingZusage.ausgleichBetrag, ausgleichDatum: fondsClosingZusage.ausgleichDatum })
    .from(fondsClosingZusage)
    .innerJoin(fondsClosing, eq(fondsClosing.id, fondsClosingZusage.closingId))
    .innerJoin(organisation, eq(organisation.id, fondsClosingZusage.organisationId))
    .where(eq(fondsClosing.fondsId, fondsId))
    .orderBy(asc(organisation.name), asc(organisation.id));
  const basis = await tx
    .select({ closingId: fondsClosingBasis.closingId, organisationId: fondsClosingBasis.organisationId })
    .from(fondsClosingBasis)
    .innerJoin(fondsClosing, eq(fondsClosing.id, fondsClosingBasis.closingId))
    .where(eq(fondsClosing.fondsId, fondsId));
  const vorher = new Set(basis.map((b) => `${b.closingId}:${b.organisationId}`));
  const stornos = await tx
    .select({ closingId: fondsClosingStorno.closingId, grund: fondsClosingStorno.grund, ersetztDurch: fondsClosingStorno.ersetztDurch, storniertAm: fondsClosingStorno.storniertAm })
    .from(fondsClosingStorno)
    .innerJoin(fondsClosing, eq(fondsClosing.id, fondsClosingStorno.closingId))
    .where(eq(fondsClosing.fondsId, fondsId));
  const stornoJe = new Map(stornos.map((st) => [st.closingId, st]));
  const letzteAktive = closings.filter((c) => !stornoJe.has(c.id)).at(-1)?.id;
  return closings.map((c) => ({
    id: c.id,
    art: c.art as "closing" | "verringerung" | "austritt",
    wirksamAm: c.wirksamAm,
    bemerkung: c.bemerkung,
    erfasstAm: c.erfasstAm.toISOString(),
    /** Storno-Vorgang, falls das Closing storniert wurde; es bleibt mit seinen Zusagen sichtbar. */
    storno: stornoJe.has(c.id) ? { grund: stornoJe.get(c.id)!.grund, ersetztDurch: stornoJe.get(c.id)!.ersetztDurch, storniertAm: stornoJe.get(c.id)!.storniertAm.toISOString() } : null,
    /** Nur das letzte nicht stornierte Closing lässt sich stornieren oder korrigieren. */
    stornierbar: c.id === letzteAktive,
    zusagen: zusagen.filter((z) => z.closingId === c.id).map(({ closingId, ...z }) => ({ ...z, beitritt: !vorher.has(`${closingId}:${z.organisationId}`) })),
  }));
}

type VorgangArt = "closing" | "verringerung" | "austritt";
interface VorgangZeile {
  organisationId: string;
  /** Closing: Zuwachs. */
  zusage?: string;
  /** Verringerung: neue Gesamtzusage (unter der bisherigen, nicht unter dem Abgerufenen). */
  neueZusage?: string;
  ausgleich?: { betrag: string; datum: string };
}
interface Vorgang { art: VorgangArt; wirksamAm: string; bemerkung?: string | undefined; zeilen: VorgangZeile[] }

/**
 * Legt einen datierten Vorgang an, der die Zusagen ab `wirksamAm` ändert (alle in `fonds_closing`, Momentaufnahmen vorher in
 * `fonds_closing_basis`, nachher in `fonds_closing_stand`):
 * - `closing` (Issue #113): Beitritt oder Aufstockung, das Zeichnungskapital steigt um die Summe der Zusagen.
 * - `verringerung` (Issue #132): die Zusage sinkt auf `neueZusage`, höchstens bis zum bereits Abgerufenen des Investors.
 * - `austritt` (Issue #132): die Zusage sinkt auf das Abgerufene (null, wenn nichts abgerufen wurde); der Investor bekommt danach keine
 *   Anteile künftiger Bewegungen mehr. Bereits Abgerufenes und Eingezahltes bleibt unverändert im Kapitalkonto.
 * Davor gilt die bisherige Verteilung. Stornierte Vorgänge (Issue #126) zählen für die Reihenfolge nicht mit.
 */
async function legeVorgangAn(tx: Tx, protokoll: Protokollant, fondsId: string, { art, wirksamAm, bemerkung, zeilen: eingabe }: Vorgang) {
  if (new Set(eingabe.map((z) => z.organisationId)).size !== eingabe.length) {
    throw new Fachfehler(400, "lp_subscription_duplicate", "Each investor organization may appear only once in a closing.");
  }
  const f = await sperreFonds(tx, fondsId);
  const bestand = await tx.select().from(fondsZeichnung).where(eq(fondsZeichnung.fondsId, fondsId)).for("update");
  if (bestand.length === 0) {
    throw new Fachfehler(409, "lp_closing_without_initial", "A further closing requires the initial entry of subscriptions.");
  }
  await pruefePeriodensperre(tx, fondsId, wirksamAm);
  const [letztes] = await tx.select({ wirksamAm: fondsClosing.wirksamAm }).from(fondsClosing).leftJoin(fondsClosingStorno, eq(fondsClosingStorno.closingId, fondsClosing.id)).where(and(eq(fondsClosing.fondsId, fondsId), isNull(fondsClosingStorno.closingId))).orderBy(sql`${fondsClosing.wirksamAm} DESC`).limit(1);
  if (letztes && wirksamAm < letztes.wirksamAm) {
    throw new Fachfehler(409, "lp_closing_before_previous", `The effective date must not be before that of the last closing (${letztes.wirksamAm}).`, { letztes: letztes.wirksamAm });
  }
  const { rows: spaeteste } = await tx.execute<{ valuta: string | null }>(letzteKapitalvaluta(fondsId));
  const letzteValuta = spaeteste[0]?.valuta ?? null;
  if (letzteValuta !== null && letzteValuta >= wirksamAm) {
    throw new Fachfehler(409, "lp_closing_before_movement", `The effective date must be after the last capital movement (${letzteValuta}) so that posted movements keep their allocation.`, { letzteBewegung: letzteValuta });
  }
  for (const z of eingabe.toSorted((a, b) => a.organisationId.localeCompare(b.organisationId))) {
    const org = await ladeInvestorOrganisation(tx, z.organisationId);
    if (org.archiviertAm && art === "closing") throw new Fachfehler(404, "organization_not_found", "The investor organization is archived.");
  }

  const vorhanden = new Map(bestand.map((b) => [b.organisationId, b]));
  // Neue Zusage je betroffenem Investor und der Betrag, der in `fonds_closing_zusage` steht (Zuwachs bzw. Verringerung).
  const neu = new Map<string, { zusage: Decimal; betrag: Decimal; ausgetreten: boolean }>();
  const abgerufenJe = art === "closing" ? null : (await ladeKapitalstand(tx, fondsId, wirksamAm)).jeLp;
  for (const z of eingabe) {
    const alt = vorhanden.get(z.organisationId);
    if (art === "closing") {
      if (alt?.ausgetreten) throw new Fachfehler(409, "lp_withdrawn", "The investor has withdrawn from the fund; their commitment cannot be increased.", { organisationId: z.organisationId });
      const zuwachs = new Decimal(z.zusage ?? 0);
      neu.set(z.organisationId, { zusage: new Decimal(alt?.zusage ?? 0).plus(zuwachs), betrag: zuwachs, ausgetreten: false });
      continue;
    }
    if (!alt) throw new Fachfehler(404, "lp_subscription_not_found", "The investor has no commitment in this fund.", { organisationId: z.organisationId });
    if (alt.ausgetreten) throw new Fachfehler(409, "lp_withdrawn", "The investor has already withdrawn from the fund.", { organisationId: z.organisationId });
    const bisher = new Decimal(abgerufenJe!.get(z.organisationId)?.abgerufen ?? 0);
    const zusageNeu = art === "austritt" ? bisher : new Decimal(z.neueZusage ?? 0);
    if (art === "verringerung") {
      if (!zusageNeu.gt(0)) throw new Fachfehler(400, "lp_commitment_zero", "A commitment of zero is a withdrawal; please record it as a withdrawal.");
      if (!zusageNeu.lt(alt.zusage)) throw new Fachfehler(400, "lp_commitment_not_lower", "The new commitment must be lower than the previous one.", { zusage: new Decimal(alt.zusage).toFixed(2), neueZusage: zusageNeu.toFixed(2) });
      if (zusageNeu.lt(bisher)) throw new Fachfehler(409, "lp_commitment_below_called", `The new commitment must not be lower than the amount already called (${bisher.toFixed(2)}).`, { abgerufen: bisher.toFixed(2), neueZusage: zusageNeu.toFixed(2) });
    }
    neu.set(z.organisationId, { zusage: zusageNeu, betrag: new Decimal(alt.zusage).minus(zusageNeu), ausgetreten: art === "austritt" });
  }

  // Neuer Stand: Anteile wie bei der Ersterfassung (größter Rest, Reihenfolge nach Organisations-ID); Ausgetretene haben Anteil null.
  const gesamt = new Map(bestand.map((b) => [b.organisationId, { zusage: new Decimal(b.zusage), ausgetreten: b.ausgetreten }]));
  for (const [organisationId, n] of neu) gesamt.set(organisationId, { zusage: n.zusage, ausgetreten: n.ausgetreten });
  const sortiert = [...gesamt.entries()].sort(([a], [b]) => a.localeCompare(b));
  if (sortiert.every(([, g]) => g.ausgetreten)) throw new Fachfehler(409, "lp_last_investor", "The last remaining investor cannot withdraw.");
  const gewichte = sortiert.map(([, g]) => (g.ausgetreten ? new Decimal(0) : g.zusage));
  const anteile = verteileAnteilig("10000", gewichte).map((a) => a.div(10000));
  if (sortiert.some(([, g], i) => !g.ausgetreten && !anteile[i]!.gt(0))) {
    throw new Fachfehler(400, "lp_subscription_share_too_small", "At least one commitment results in a share of zero at six decimal places.");
  }
  const kapitalNeu = new Decimal(f.zeichnungskapital).plus(Decimal.sum(0, ...[...neu.entries()].map(([organisationId, n]) => n.zusage.minus(vorhanden.get(organisationId)?.zusage ?? 0))));
  if ((await abgerufen(tx, fondsId)).greaterThan(kapitalNeu)) {
    throw new Fachfehler(409, "subscribed_capital_below_calls", "After this transaction the subscribed capital would be below the amounts already called.");
  }

  const [closing] = await tx.insert(fondsClosing).values({ fondsId, art, wirksamAm, bemerkung: bemerkung ?? null, erfasstVon: protokoll.akteur }).returning();
  if (!closing) throw new Error("Closing nicht angelegt");
  const basis = await tx.insert(fondsClosingBasis).values(bestand.map((b) => ({ closingId: closing.id, organisationId: b.organisationId, zusage: b.zusage, anteil: b.anteil, ausgetreten: b.ausgetreten }))).returning();
  const zusagenZeilen = await tx.insert(fondsClosingZusage).values(eingabe.map((z) => ({
    closingId: closing.id,
    organisationId: z.organisationId,
    zusage: neu.get(z.organisationId)!.betrag.toFixed(2),
    ausgleichBetrag: z.ausgleich ? new Decimal(z.ausgleich.betrag).toFixed(2) : null,
    ausgleichDatum: z.ausgleich?.datum ?? null,
  }))).returning();

  const aenderungen: { aktion: "anlegen" | "aendern"; tabelle: string; datensatzId: string; vorher?: unknown; nachher: unknown }[] = [];
  for (const [i, [organisationId, g]] of sortiert.entries()) {
    const alt = vorhanden.get(organisationId);
    const werte = { zusage: g.zusage.toFixed(2), anteil: anteile[i]!.toFixed(6), ausgetreten: g.ausgetreten };
    if (alt) {
      const [geaendert] = await tx.update(fondsZeichnung).set(werte).where(eq(fondsZeichnung.id, alt.id)).returning();
      aenderungen.push({ aktion: "aendern", tabelle: "fonds_zeichnung", datensatzId: alt.id, vorher: alt, nachher: geaendert });
    } else {
      const [angelegt] = await tx.insert(fondsZeichnung).values({ fondsId, organisationId, ...werte }).returning();
      aenderungen.push({ aktion: "anlegen", tabelle: "fonds_zeichnung", datensatzId: angelegt!.id, nachher: angelegt });
    }
  }
  const stand = await tx.insert(fondsClosingStand).values(sortiert.map(([organisationId, g], i) => ({ closingId: closing.id, organisationId, zusage: g.zusage.toFixed(2), anteil: anteile[i]!.toFixed(6), ausgetreten: g.ausgetreten }))).returning();
  const [fondsNeu] = await tx.update(fonds).set({ zeichnungskapital: kapitalNeu.toFixed(2) }).where(eq(fonds.id, fondsId)).returning({ id: fonds.id, zeichnungskapital: fonds.zeichnungskapital });
  await protokoll("anlegen", "fonds_closing", closing.id, null, { ...closing, zusagen: zusagenZeilen, basis, stand });
  await protokoll.mehrere(aenderungen);
  await protokoll("aendern", "fonds", fondsId, { zeichnungskapital: f.zeichnungskapital }, { zeichnungskapital: fondsNeu!.zeichnungskapital });
  return { id: closing.id, art, wirksamAm, zeichnungskapital: fondsNeu!.zeichnungskapital, zusagen: zusagenZeilen.map(({ id, organisationId, zusage, ausgleichBetrag, ausgleichDatum }) => ({ id, organisationId, zusage, ausgleichBetrag, ausgleichDatum, beitritt: art === "closing" && !vorhanden.has(organisationId) })) };
}

/** Weiteres Closing (Issue #113); siehe `legeVorgangAn`. */
function legeClosingAn(tx: Tx, protokoll: Protokollant, fondsId: string, { wirksamAm, bemerkung, zusagen }: ClosingEingabe) {
  return legeVorgangAn(tx, protokoll, fondsId, { art: "closing", wirksamAm, bemerkung, zeilen: zusagen });
}

/** Das letzte nicht stornierte Closing des Fonds. */
async function letztesAktivesClosing(tx: Tx, fondsId: string) {
  const [letztes] = await tx
    .select({ id: fondsClosing.id })
    .from(fondsClosing)
    .leftJoin(fondsClosingStorno, eq(fondsClosingStorno.closingId, fondsClosing.id))
    .where(and(eq(fondsClosing.fondsId, fondsId), isNull(fondsClosingStorno.closingId)))
    .orderBy(desc(fondsClosing.wirksamAm), desc(fondsClosing.erfasstAm), desc(fondsClosing.id))
    .limit(1);
  return letztes?.id ?? null;
}

/**
 * Storniert ein weiteres Closing (Issue #126) als eigenen Vorgang: Das Closing bleibt mit Zusagen und Momentaufnahmen erhalten, der
 * Stand vor dem Closing (`fonds_closing_basis`) wird in `fonds_zeichnung` und im Zeichnungskapital wiederhergestellt. Das geht nur für das
 * letzte nicht stornierte Closing und nur, solange ab seinem Wirksamkeitsdatum keine Kapitalbewegung gebucht ist.
 */
/** Späteste Valuta der Kapitalbewegungen und Kostenbuchungen (Issue #157): beide behalten ihre festgeschriebene Aufteilung. */
const letzteKapitalvaluta = (fondsId: string) => sql`SELECT greatest(
  (SELECT max(valuta) FROM ${fondsBewegung} WHERE ${fondsBewegung.fondsId} = ${fondsId}),
  (SELECT max(valuta) FROM fonds_kosten WHERE fonds_id = ${fondsId}))::text AS valuta`;

async function storniereClosing(tx: Tx, protokoll: Protokollant, fondsId: string, closingId: string, grund: string) {
  const f = await sperreFonds(tx, fondsId);
  const [closing] = await tx.select().from(fondsClosing).where(and(eq(fondsClosing.id, closingId), eq(fondsClosing.fondsId, fondsId)));
  if (!closing) throw new Fachfehler(404, "lp_closing_not_found", "Closing not found.");
  const [schonStorniert] = await tx.select({ id: fondsClosingStorno.closingId }).from(fondsClosingStorno).where(eq(fondsClosingStorno.closingId, closingId));
  if (schonStorniert) throw new Fachfehler(409, "lp_closing_reversed", "The closing has already been reversed.");
  if ((await letztesAktivesClosing(tx, fondsId)) !== closingId) {
    throw new Fachfehler(409, "lp_closing_not_latest", "Only the last closing that has not been reversed can be reversed or corrected. Reverse the later closings first.");
  }
  const { rows: spaeteste } = await tx.execute<{ valuta: string | null }>(letzteKapitalvaluta(fondsId));
  const letzteValuta = spaeteste[0]?.valuta ?? null;
  if (letzteValuta !== null && letzteValuta >= closing.wirksamAm) {
    throw new Fachfehler(409, "lp_closing_movement_posted", `A capital movement has been posted since the effective date (${closing.wirksamAm}) (value date ${letzteValuta}). The closing can no longer be reversed.`, { letzteBewegung: letzteValuta, wirksamAm: closing.wirksamAm });
  }
  await pruefePeriodensperre(tx, fondsId, closing.wirksamAm);

  const basis = await tx.select().from(fondsClosingBasis).where(eq(fondsClosingBasis.closingId, closingId));
  const nachher = await tx.select().from(fondsClosingStand).where(eq(fondsClosingStand.closingId, closingId));
  const aktuell = await tx.select().from(fondsZeichnung).where(eq(fondsZeichnung.fondsId, fondsId)).for("update");
  const gleich = aktuell.length === nachher.length && aktuell.every((z) => {
    const n = nachher.find((x) => x.organisationId === z.organisationId);
    return n !== undefined && new Decimal(n.zusage).eq(z.zusage) && new Decimal(n.anteil).eq(z.anteil) && n.ausgetreten === z.ausgetreten;
  });
  if (!gleich) throw new Fachfehler(409, "lp_closing_state_mismatch", "The subscriptions of the fund differ from the state after the closing. The closing cannot be undone automatically.");

  // Das Zeichnungskapital kehrt um die Änderung durch den Vorgang zurück (Zuwachs beim Closing, Verringerung bei Austritt und Verringerung).
  const aenderung = Decimal.sum(0, ...nachher.map((n) => n.zusage)).minus(Decimal.sum(0, ...basis.map((b) => b.zusage)));
  const kapitalNeu = new Decimal(f.zeichnungskapital).minus(aenderung);
  if ((await abgerufen(tx, fondsId)).greaterThan(kapitalNeu)) {
    throw new Fachfehler(409, "subscribed_capital_below_calls", "After the reversal the subscribed capital would be below the amounts already called.");
  }
  const [storno] = await tx.insert(fondsClosingStorno).values({ closingId, grund, storniertVon: protokoll.akteur }).returning();
  const vorher = new Map(basis.map((b) => [b.organisationId, b]));
  const aenderungen: { aktion: string; tabelle: string; datensatzId: string; vorher?: unknown; nachher?: unknown }[] = [];
  for (const z of aktuell.toSorted((a, b) => a.organisationId.localeCompare(b.organisationId))) {
    const alt = vorher.get(z.organisationId);
    if (alt) {
      const [neu] = await tx.update(fondsZeichnung).set({ zusage: alt.zusage, anteil: alt.anteil, ausgetreten: alt.ausgetreten }).where(eq(fondsZeichnung.id, z.id)).returning();
      aenderungen.push({ aktion: "aendern", tabelle: "fonds_zeichnung", datensatzId: z.id, vorher: z, nachher: neu });
    } else {
      await tx.delete(fondsZeichnung).where(eq(fondsZeichnung.id, z.id));
      aenderungen.push({ aktion: "loeschen", tabelle: "fonds_zeichnung", datensatzId: z.id, vorher: z });
    }
  }
  const [fondsNeu] = await tx.update(fonds).set({ zeichnungskapital: kapitalNeu.toFixed(2) }).where(eq(fonds.id, fondsId)).returning({ zeichnungskapital: fonds.zeichnungskapital });
  await protokoll("stornieren", "fonds_closing_storno", closingId, null, storno);
  await protokoll.mehrere(aenderungen);
  await protokoll("aendern", "fonds", fondsId, { zeichnungskapital: f.zeichnungskapital }, { zeichnungskapital: fondsNeu!.zeichnungskapital });
  return { closingId, zeichnungskapital: fondsNeu!.zeichnungskapital };
}

export function fondsInvestorRouten(db: Db) {
  return new Hono()
    .get("/", pruefeFonds("param", fondsParam), async (c) => {
      const { fondsId } = c.req.valid("param");
      const sicht = await lese(db, async (tx) => {
        const [vorhanden] = await tx.select({ zeichnungskapital: fonds.zeichnungskapital, waehrung: fonds.waehrung }).from(fonds).where(eq(fonds.id, fondsId));
        if (!vorhanden) throw new Fachfehler(404, "fund_not_found", "Fund not found.");
        const zeichnungen = await tx
          .select({ id: organisation.id, name: organisation.name, art: organisation.art, zusammengefuehrtIn: organisation.zusammengefuehrtIn, zusage: fondsZeichnung.zusage, anteil: fondsZeichnung.anteil, ausgetreten: fondsZeichnung.ausgetreten })
          .from(fondsZeichnung)
          .innerJoin(organisation, eq(organisation.id, fondsZeichnung.organisationId))
          .where(eq(fondsZeichnung.fondsId, fondsId))
          .orderBy(asc(organisation.name), asc(organisation.id));
        const organisationen = zeichnungen.filter((z) => z.art === "investor" && !z.zusammengefuehrtIn).map(({ id, name }) => ({ id, name }));
        // Bisher abgerufener Betrag je Investor: untere Grenze für eine verringerte Zusage.
        const abgerufenJe = zeichnungen.length > 0 ? (await ladeKapitalstand(tx, fondsId, "9999-12-31")).jeLp : null;
        const closings = await ladeClosings(tx, fondsId);
        const initialisierungMoeglich = zeichnungen.length === 0 && new Decimal(vorhanden.zeichnungskapital).gt(0) && !(await hatFondsaktivitaet(tx, fondsId));
        return { ...vorhanden, organisationen, initialisierungMoeglich, closings, closingMoeglich: zeichnungen.length > 0, zeichnungen: zeichnungen.map(({ id, name, zusage, anteil, ausgetreten }) => ({ id, name, zusage, anteil, ausgetreten, abgerufen: abgerufenJe?.get(id)?.abgerufen ?? "0.00" })) };
      });
      return c.json(fondsAnApi(sicht), 200);
    })
    .post("/subscriptions", pruefeFonds("param", fondsParam), pruefeFonds("json", zeichnungenEingabe), async (c) => {
      const { fondsId } = c.req.valid("param");
      const { zeichnungen } = c.req.valid("json");
      const organisationIds = new Set(zeichnungen.map((z) => z.organisationId));
      if (organisationIds.size !== zeichnungen.length) {
        throw new Fachfehler(400, "lp_subscription_duplicate", "Each investor organization may subscribe to the fund only once.");
      }
      const ergebnis = await schreibe(db, c, async (tx, protokoll) => {
        // Dieselbe Fondszeile sperrt Bewegungen und Stammdaten. Der Fonds-Fremdschlüssel serialisiert auch die Berichtsanlage.
        const f = await sperreFonds(tx, fondsId);
        const [vorhanden] = await tx.select({ id: fondsZeichnung.id }).from(fondsZeichnung).where(eq(fondsZeichnung.fondsId, fondsId)).limit(1);
        if (vorhanden || await hatFondsaktivitaet(tx, fondsId)) {
          throw new Fachfehler(409, "lp_subscription_initial_locked", "The initial entry is only possible before subscriptions, capital movements and reports.");
        }
        const sortiert = zeichnungen.toSorted((a, b) => a.organisationId.localeCompare(b.organisationId));
        const zusagen = sortiert.map((z) => new Decimal(z.zusage));
        if (!Decimal.sum(...zusagen).eq(f.zeichnungskapital)) {
          throw new Fachfehler(409, "lp_commitments_capital_mismatch", "The sum of the commitments must equal the subscribed capital.");
        }
        // Das Verteilungsverfahren arbeitet in Cent. 10.000 Einheiten ergeben eine Million Anteile der kleinsten Einheit.
        const anteile = verteileAnteilig("10000", zusagen).map((a) => a.div(10000));
        if (anteile.some((a) => !a.gt(0))) {
          throw new Fachfehler(400, "lp_subscription_share_too_small", "At least one commitment results in a share of zero at six decimal places.");
        }
        for (const { organisationId } of sortiert) {
          const org = await ladeInvestorOrganisation(tx, organisationId);
          if (org.archiviertAm) throw new Fachfehler(404, "organization_not_found", "The investor organization is archived.");
        }
        const neu = await tx.insert(fondsZeichnung).values(sortiert.map(({ organisationId }, i) => ({
          fondsId, organisationId, zusage: zusagen[i]!.toFixed(2), anteil: anteile[i]!.toFixed(6),
        }))).returning();
        await tx.update(fonds).set({ lpVerteilungNachZusage: true }).where(eq(fonds.id, fondsId));
        await protokoll.mehrere(neu.map((z) => ({ aktion: "anlegen", tabelle: "fonds_zeichnung", datensatzId: z.id, nachher: z })));
        return neu;
      });
      return c.json(fondsAnApi({ daten: ergebnis }), 201);
    })
    /** Weiteres Closing (Issue #113); siehe `legeClosingAn`. */
    .post("/closings", pruefeFonds("param", fondsParam), pruefeFonds("json", closingEingabe), async (c) => {
      const { fondsId } = c.req.valid("param");
      const eingabe = c.req.valid("json");
      const ergebnis = await schreibe(db, c, (tx, protokoll) => legeClosingAn(tx, protokoll, fondsId, eingabe));
      return c.json(fondsAnApi(ergebnis), 201);
    })
    /**
     * Verringerung der Zusage oder Austritt eines Investors (Issue #132) als datierter Vorgang wie ein Closing; Storno über
     * `/closings/:closingId/storno`.
     */
    .post("/commitment-changes", pruefeFonds("param", fondsParam), pruefeFonds("json", zusageAenderungEingabe), async (c) => {
      const { fondsId } = c.req.valid("param");
      const { art, wirksamAm, bemerkung, investoren } = c.req.valid("json");
      const ergebnis = await schreibe(db, c, (tx, protokoll) => legeVorgangAn(tx, protokoll, fondsId, { art, wirksamAm, bemerkung, zeilen: investoren }));
      return c.json(fondsAnApi(ergebnis), 201);
    })
    /** Storno eines weiteren Closings (Issue #126): stellt den Stand vor dem Closing wieder her; siehe `storniereClosing`. */
    .post("/closings/:closingId/reverse", pruefeFonds("param", closingParam), pruefeFonds("json", stornoEingabe), async (c) => {
      const { fondsId, closingId } = c.req.valid("param");
      const { grund } = c.req.valid("json");
      const ergebnis = await schreibe(db, c, (tx, protokoll) => storniereClosing(tx, protokoll, fondsId, closingId, grund));
      return c.json(fondsAnApi(ergebnis));
    })
    /**
     * Korrektur (Issue #126): Storno des Closings und neues Closing mit den berichtigten Angaben in einer Transaktion. Scheitert das
     * neue Closing, bleibt das alte unverändert bestehen.
     */
    .post("/closings/:closingId/correct", pruefeFonds("param", closingParam), pruefeFonds("json", korrekturEingabe), async (c) => {
      const { fondsId, closingId } = c.req.valid("param");
      const { grund, ...eingabe } = c.req.valid("json");
      const ergebnis = await schreibe(db, c, async (tx, protokoll) => {
        const [art] = await tx.select({ art: fondsClosing.art }).from(fondsClosing).where(and(eq(fondsClosing.id, closingId), eq(fondsClosing.fondsId, fondsId)));
        if (art && art.art !== "closing") throw new Fachfehler(409, "lp_correction_closing_only", "A correction is only available for closings. Please reverse a reduction or withdrawal and record it again.");
        await storniereClosing(tx, protokoll, fondsId, closingId, grund);
        const neu = await legeClosingAn(tx, protokoll, fondsId, eingabe);
        const [vorher] = await tx.select().from(fondsClosingStorno).where(eq(fondsClosingStorno.closingId, closingId));
        const [nachher] = await tx.update(fondsClosingStorno).set({ ersetztDurch: neu.id }).where(eq(fondsClosingStorno.closingId, closingId)).returning();
        await protokoll("aendern", "fonds_closing_storno", closingId, vorher, nachher);
        return { ...neu, ersetzt: closingId };
      });
      return c.json(fondsAnApi(ergebnis), 201);
    });
}

/** Wie viele Zugänge von Investor-Benutzern an den Organisationen hängen (für die Zusammenführung von Organisationen). */
export async function investorZugaengeVon(tx: Tx, organisationIds: string[]): Promise<number> {
  if (organisationIds.length === 0) return 0;
  const zeilen = await tx.select({ id: investorZugang.benutzerId }).from(investorZugang).where(inArray(investorZugang.organisationId, organisationIds));
  return zeilen.length;
}
