import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { fondsKosten, fondsKostenAnteil, organisation, type Fonds, type FondsKosten } from "@carraway/db";
import { Decimal, pruefeKostenaufteilung, verwaltungsverguetung, type Rechenschritt } from "@carraway/rechenkern";
import { Fachfehler } from "../fehler";
import { bisStand } from "../kennzahlen/zeitstand";
import { heute, type Protokollant } from "../schreiben";
import type { Tx } from "../zeitlimit";
import { ladeVerteilungsgrundlageZum, verteileBewegungsbetrag } from "../instrumente/lp-verteilung";
import { pruefePeriodensperre } from "../instrumente/zustand";
import { sperreFonds } from "../instrumente/fondsbewegung";

/**
 * Verwaltungsvergütung und Fondskosten (Issue #157). Eine Kostenbuchung trägt einen Betrag oder berechnet ihn aus Jahressatz und
 * Zeitraum (Basis: Summe der Zusagen der Investoren mit Gewicht zu Beginn des Zeitraums) und verteilt ihn auf die Investoren:
 * nach der Verteilungsgrundlage zur Valuta (wie Abrufe, größter Rest) oder nach ausdrücklich angegebenen Anteilen. Die Anteile
 * werden beim Buchen festgeschrieben; ein Storno negiert Betrag und Anteile. Kosten sind keine Zahlungen zwischen Fonds und
 * Investoren, sie erscheinen deshalb nicht im Zahlungsstrom des Fonds, sondern auf den Kapitalkonten.
 */

type Abfrage = Pick<Tx, "execute" | "select">;

export interface KostenEingabe {
  art: "verwaltungsverguetung" | "fondskosten";
  valuta: string;
  betrag?: string | undefined;
  /** Berechnung aus dem Jahressatz (statt `betrag`). */
  berechnung?: { satz: string; von: string; bis: string } | undefined;
  verteilung: "grundlage" | "manuell";
  anteile?: { organisationId: string; betrag: string }[] | undefined;
  bemerkung?: string | null | undefined;
}

export interface KostenVorschlag {
  art: KostenEingabe["art"];
  valuta: string;
  betrag: string;
  verteilung: KostenEingabe["verteilung"];
  verteilungsbasis: "zusage" | "anteil" | null;
  zeitraumVon: string | null;
  zeitraumBis: string | null;
  satz: string | null;
  /** Rechenweg der Vergütung, wenn sie aus dem Jahressatz berechnet wurde. */
  berechnung: Rechenschritt[] | null;
  aufteilung: { organisationId: string; investor: string; zusage: string; anteil: string; ausgetreten: boolean; betrag: string }[];
}

const ungueltig = (meldung: string, details: Record<string, unknown> = {}) => new Fachfehler(400, "cost_allocation_invalid", meldung, details);

/** Rechnet Betrag und Aufteilung, ohne zu buchen (Vorschau und Buchung nutzen dieselbe Rechnung). */
export async function rechneKosten(tx: Abfrage, f: Pick<Fonds, "id">, e: KostenEingabe): Promise<KostenVorschlag> {
  if ((e.betrag === undefined) === (e.berechnung === undefined)) throw new Fachfehler(400, "invalid_input", "Provide either an amount or a calculation from the annual rate.");
  let betrag: Decimal;
  let berechnung: Rechenschritt[] | null = null;
  if (e.berechnung) {
    if (e.berechnung.bis < e.berechnung.von) throw new Fachfehler(400, "invalid_input", "The end of the period is before its start.");
    const basisGrundlage = await ladeVerteilungsgrundlageZum(tx, f.id, e.berechnung.von);
    const basis = basisGrundlage.zeichnungen.filter((z) => !z.ausgetreten).reduce((s, z) => s.plus(z.zusage), new Decimal(0));
    const v = verwaltungsverguetung({ basis, satzProJahr: e.berechnung.satz, von: e.berechnung.von, bis: e.berechnung.bis });
    betrag = v.wert;
    berechnung = [{ ...v.schritte[0]!, bezeichnung: `Summe der Zusagen am ${e.berechnung.von}` }, ...v.schritte.slice(1)];
    if (!betrag.greaterThan(0)) throw new Fachfehler(400, "invalid_input", "The calculated fee is zero.");
  } else {
    betrag = new Decimal(e.betrag!);
  }
  const grundlage = await ladeVerteilungsgrundlageZum(tx, f.id, e.valuta);
  if (grundlage.zeichnungen.length === 0 || grundlage.verteilungsbasis === null) throw new Fachfehler(409, "no_subscriptions", "The fund has no investors at the value date.");
  let teile: string[];
  if (e.verteilung === "grundlage") {
    if (e.anteile && e.anteile.length > 0) throw ungueltig("Shares belong to a manual allocation.");
    if (grundlage.gewichte.every((g) => new Decimal(g).isZero())) throw ungueltig("No investor has a weight in the allocation at the value date.");
    teile = verteileBewegungsbetrag(betrag.toFixed(2), grundlage.gewichte);
  } else {
    const anteile = e.anteile ?? [];
    const bekannt = new Set(grundlage.zeichnungen.map((z) => z.organisationId));
    const fremd = anteile.filter((a) => !bekannt.has(a.organisationId)).map((a) => a.organisationId);
    if (fremd.length) throw ungueltig("Not every investor in the allocation holds a subscription at the value date.", { organisationen: fremd });
    if (new Set(anteile.map((a) => a.organisationId)).size !== anteile.length) throw ungueltig("An investor appears more than once in the allocation.");
    const grund = pruefeKostenaufteilung(betrag, anteile.map((a) => a.betrag));
    if (grund) throw ungueltig(grund === "summe" ? `The shares do not add up to the amount ${betrag.toFixed(2)}.` : "Shares must be non-negative amounts in cents.", { grund });
    const je = new Map(anteile.map((a) => [a.organisationId, new Decimal(a.betrag).toFixed(2)]));
    teile = grundlage.zeichnungen.map((z) => je.get(z.organisationId) ?? "0.00");
  }
  return {
    art: e.art,
    valuta: e.valuta,
    betrag: betrag.toFixed(2),
    verteilung: e.verteilung,
    verteilungsbasis: grundlage.verteilungsbasis,
    zeitraumVon: e.berechnung?.von ?? null,
    zeitraumBis: e.berechnung?.bis ?? null,
    satz: e.berechnung ? new Decimal(e.berechnung.satz).toString() : null,
    berechnung,
    aufteilung: grundlage.zeichnungen.map((z, i) => ({ organisationId: z.organisationId, investor: z.investor, zusage: z.zusage, anteil: z.anteil, ausgetreten: z.ausgetreten, betrag: teile[i]! })),
  };
}

export async function bucheKosten(tx: Tx, protokoll: Protokollant, fondsId: string, e: KostenEingabe) {
  const f = await sperreFonds(tx, fondsId);
  await pruefePeriodensperre(tx, fondsId, e.valuta);
  const v = await rechneKosten(tx, f, e);
  const [zeile] = await tx.insert(fondsKosten).values({
    fondsId, art: v.art, valuta: v.valuta, betrag: v.betrag, verteilung: v.verteilung,
    zeitraumVon: v.zeitraumVon, zeitraumBis: v.zeitraumBis, satz: v.satz, bemerkung: e.bemerkung ?? null,
  }).returning();
  if (!zeile) throw new Error("Kostenbuchung nicht angelegt");
  await tx.insert(fondsKostenAnteil).values(v.aufteilung.map((a) => ({ kostenId: zeile.id, organisationId: a.organisationId, betrag: a.betrag })));
  await protokoll("anlegen", "fonds_kosten", zeile.id, null, { ...zeile, anteile: v.aufteilung.map(({ organisationId, betrag }) => ({ organisationId, betrag })) });
  return { ...zeile, berechnung: v.berechnung, aufteilung: v.aufteilung };
}

/** Storno: Gegenbuchung mit negiertem Betrag und negierten Anteilen; Valuta nicht vor dem Original (Vorgabe: heute oder die des Originals). */
export async function storniereKosten(tx: Tx, protokoll: Protokollant, fondsId: string, kostenId: string, grund: string, gewuenschteValuta: string | undefined) {
  const [original] = await tx.select().from(fondsKosten).where(and(eq(fondsKosten.id, kostenId), eq(fondsKosten.fondsId, fondsId)));
  if (!original) throw new Fachfehler(404, "cost_entry_not_found", "Cost entry not found.");
  await sperreFonds(tx, fondsId);
  if (original.storniertKostenId) throw new Fachfehler(409, "reversal_not_allowed", "A reversal cannot itself be reversed.");
  const [schon] = await tx.select({ id: fondsKosten.id }).from(fondsKosten).where(eq(fondsKosten.storniertKostenId, kostenId));
  if (schon) throw new Fachfehler(409, "already_reversed", "The cost entry is already reversed.");
  if (gewuenschteValuta !== undefined && gewuenschteValuta < original.valuta) {
    throw new Fachfehler(400, "invalid_input", "The input is invalid.", {
      felder: [{ feld: "valuta", code: "reversal_before_original", meldung: `The value date of the reversal must not be before that of the original (${original.valuta})` }],
    });
  }
  const heutigerTag = heute();
  const valuta = gewuenschteValuta ?? (heutigerTag > original.valuta ? heutigerTag : original.valuta);
  await pruefePeriodensperre(tx, fondsId, valuta);
  const anteile = await tx.select().from(fondsKostenAnteil).where(eq(fondsKostenAnteil.kostenId, kostenId));
  const [storno] = await tx.insert(fondsKosten).values({
    fondsId, art: original.art, valuta, betrag: new Decimal(original.betrag).neg().toFixed(2), verteilung: original.verteilung,
    zeitraumVon: original.zeitraumVon, zeitraumBis: original.zeitraumBis, satz: original.satz, bemerkung: `Storno: ${grund}`, storniertKostenId: original.id,
  }).returning();
  if (!storno) throw new Error("Storno nicht angelegt");
  if (anteile.length) await tx.insert(fondsKostenAnteil).values(anteile.map((a) => ({ kostenId: storno.id, organisationId: a.organisationId, betrag: new Decimal(a.betrag).neg().toFixed(2) })));
  await protokoll("storno", "fonds_kosten", original.id, original, { grund, stornoKostenId: storno.id });
  await protokoll("anlegen", "fonds_kosten", storno.id, null, storno);
  return { storno, original };
}

export interface Kostenbuchung {
  id: string;
  art: FondsKosten["art"];
  valuta: string;
  betrag: string;
  verteilung: FondsKosten["verteilung"];
  zeitraumVon: string | null;
  zeitraumBis: string | null;
  satz: string | null;
  bemerkung: string | null;
  storniertKostenId: string | null;
  storniertDurchId: string | null;
  erfasstAm: string;
  anteile: { organisationId: string; investor: string; betrag: string }[];
}

/** Kostenbuchungen eines Fonds bis zum Stichtag und Wissensstand (Stornos als eigene Zeilen), mit festgeschriebenen Anteilen. */
export async function ladeKostenbuchungen(tx: Abfrage, fondsId: string, stichtag?: string, stand?: string): Promise<Kostenbuchung[]> {
  const { rows } = await tx.execute<Omit<Kostenbuchung, "anteile">>(sql`
    SELECT k.id, k.art::text AS art, k.valuta::text, k.betrag::text, k.verteilung::text AS verteilung,
      k.zeitraum_von::text AS "zeitraumVon", k.zeitraum_bis::text AS "zeitraumBis", k.satz::text, k.bemerkung,
      k.storniert_kosten_id AS "storniertKostenId",
      (SELECT s.id FROM fonds_kosten s WHERE s.storniert_kosten_id = k.id${stichtag ? sql` AND s.valuta <= ${stichtag}::date` : sql``}${bisStand(sql.raw("s.erfasst_am"), stand)}) AS "storniertDurchId",
      to_json(k.erfasst_am) #>> '{}' AS "erfasstAm"
    FROM fonds_kosten k
    WHERE k.fonds_id = ${fondsId}${stichtag ? sql` AND k.valuta <= ${stichtag}::date` : sql``}${bisStand(sql.raw("k.erfasst_am"), stand)}
    ORDER BY k.valuta, k.erfasst_am, k.id`);
  if (rows.length === 0) return [];
  const anteile = await tx
    .select({ kostenId: fondsKostenAnteil.kostenId, organisationId: fondsKostenAnteil.organisationId, investor: organisation.name, betrag: fondsKostenAnteil.betrag })
    .from(fondsKostenAnteil)
    .innerJoin(organisation, eq(organisation.id, fondsKostenAnteil.organisationId))
    .where(inArray(fondsKostenAnteil.kostenId, rows.map((r) => r.id)))
    .orderBy(asc(organisation.name), asc(fondsKostenAnteil.organisationId));
  return rows.map((r) => ({ ...r, satz: r.satz === null ? null : new Decimal(r.satz).toString(), anteile: anteile.filter((a) => a.kostenId === r.id).map(({ kostenId: _k, ...a }) => a) }));
}
