import { and, asc, eq, sql } from "drizzle-orm";
import { abrufAnteil, lpZahlung, fonds, fondsBewegung, fondsMitteilung, organisation, type FondsBewegung } from "@carraway/db";
import { Decimal } from "@carraway/rechenkern";
import { Fachfehler } from "../fehler";
import { heute, type Protokollant } from "../schreiben";
import type { Tx } from "../zeitlimit";
import { ladeVerteilungsgrundlageZum, verteileBewegungsbetrag } from "./lp-verteilung";
import { pruefeZusagenVollstaendig } from "./zusagen";
import { pruefePeriodensperre } from "./zustand";

/**
 * Abrufe und Ausschüttungen des Fonds (`fonds_bewegung`), von Hand erfasst. Wie Vorgänge sind sie unveränderlich: Korrektur = Storno
 * (Gegenbuchung derselben Art mit negiertem Betrag und Verweis auf das Original). Summen über `betrag` ergeben damit immer den
 * gültigen Stand; Kennzahlen lassen Storno und Original gemeinsam aus dem Zahlungsstrom heraus.
 */

export interface BewegungEingabe {
  art: "abruf" | "ausschuettung";
  valuta: string;
  betrag: string;
  faelligAm?: string | undefined;
  bemerkung?: string | null | undefined;
}

/** Sperrt die Fondszeile bis zum Ende der Transaktion: serialisiert alle Buchungen von Fondsbewegungen je Fonds. */
export async function sperreFonds(tx: Tx, fondsId: string) {
  const [f] = await tx.select().from(fonds).where(eq(fonds.id, fondsId)).for("update");
  if (!f) throw new Fachfehler(404, "fund_not_found", "Fund not found.");
  return f;
}

/** Netto abgerufenes Kapital des Fonds (Stornos mindern), alle Valuta. */
export async function abgerufen(tx: Tx, fondsId: string): Promise<Decimal> {
  const { rows } = await tx.execute<{ summe: string }>(sql`SELECT coalesce(sum(betrag), 0)::text AS summe FROM fonds_bewegung WHERE fonds_id = ${fondsId} AND art = 'abruf'`);
  return new Decimal(rows[0]?.summe ?? 0);
}

/** Prüft die Buchbarkeit auch in der Vorschau. Für die Buchung hält der Aufrufer die Fondszeile gesperrt. */
export async function pruefeFondsbewegung(tx: Tx, f: Pick<typeof fonds.$inferSelect, "id" | "zeichnungskapital">, eingabe: BewegungEingabe) {
  await pruefePeriodensperre(tx, f.id, eingabe.valuta);
  // Abrufe und Ausschüttungen verteilen nach Zusagen; unvollständige Zusagen sperren sie (Issue #275).
  await pruefeZusagenVollstaendig(tx, f.id);
  if (eingabe.art !== "abruf" && eingabe.faelligAm) throw new Fachfehler(400, "invalid_input", "A due date belongs to a capital call.");
  const betrag = new Decimal(eingabe.betrag);
  if (eingabe.art === "abruf") {
    if (eingabe.faelligAm && eingabe.faelligAm < eingabe.valuta) throw new Fachfehler(400, "due_date_before_call", "The due date is before the call.");
    const bisher = await abgerufen(tx, f.id);
    if (bisher.plus(betrag).greaterThan(f.zeichnungskapital)) {
      throw new Fachfehler(409, "call_exceeds_subscribed_capital", "The calls would exceed the subscribed capital.", {
        zeichnungskapital: new Decimal(f.zeichnungskapital).toFixed(2),
        abgerufen: bisher.toFixed(2),
        betrag: betrag.toFixed(2),
      });
    }
  }
  return betrag.toFixed(2);
}

/** Bucht einen Abruf oder eine Ausschüttung. Abrufe dürfen das Zeichnungskapital in Summe nicht übersteigen. */
export async function bucheFondsbewegung(tx: Tx, protokoll: Protokollant, fondsId: string, eingabe: BewegungEingabe) {
  const f = await sperreFonds(tx, fondsId);
  const betrag = await pruefeFondsbewegung(tx, f, eingabe);
  const [zeile] = await tx
    .insert(fondsBewegung)
    .values({ fondsId, art: eingabe.art, valuta: eingabe.valuta, betrag, faelligAm: eingabe.art === "abruf" ? eingabe.faelligAm ?? eingabe.valuta : null, bemerkung: eingabe.bemerkung ?? null })
    .returning();
  if (!zeile) throw new Error("Fondsbewegung nicht angelegt");
  if (zeile.art === "abruf") {
    const { aufteilung } = await ladeBewegungsaufteilung(tx, fondsId, betrag, zeile.valuta);
    await speichereAbrufanteile(tx, zeile.id, aufteilung);
  }
  await protokoll("anlegen", "fonds_bewegung", zeile.id, null, zeile);
  return zeile;
}

export async function speichereAbrufanteile(tx: Tx, bewegungId: string, aufteilung: { organisationId: string; betrag: string }[]) {
  if (aufteilung.length) await tx.insert(abrufAnteil).values(aufteilung.map(({ organisationId, betrag }) => ({ bewegungId, organisationId, betrag }))).onConflictDoNothing();
}

/** Aufteilung eines Betrags nach der Verteilungsgrundlage, die am Datum `valuta` galt (weitere Closings, Issue #113). */
export async function ladeBewegungsaufteilung(tx: Tx, fondsId: string, betrag: string, valuta: string) {
  const { zeichnungen, gewichte, verteilungsbasis } = await ladeVerteilungsgrundlageZum(tx, fondsId, valuta);
  const teile = verteileBewegungsbetrag(betrag, gewichte);
  return {
    verteilungsbasis,
    verteilungsquelle: verteilungsbasis === null ? null : "berechnet" as const,
    aufteilung: zeichnungen.map((z, i) => ({ ...z, betrag: teile[i]! })),
  };
}

export async function ladeGebuchteBewegungsaufteilung(tx: Tx, bewegung: Pick<FondsBewegung, "id" | "fondsId" | "betrag" | "valuta" | "storniertBewegungId">) {
  // Ein Storno wird wie sein Original aufgeteilt, auch wenn dazwischen ein Closing wirksam wurde.
  const [original] = bewegung.storniertBewegungId ? await tx.select({ valuta: fondsBewegung.valuta }).from(fondsBewegung).where(eq(fondsBewegung.id, bewegung.storniertBewegungId)) : [];
  const valuta = original?.valuta ?? bewegung.valuta;
  // Freigegebene Mitteilungen bewahren die damaligen Centbeträge. Am Storno erscheinen die entsprechenden Gegenbeträge.
  const mitteilungen = await tx.select({ organisationId: fondsMitteilung.organisationId, investor: organisation.name, betrag: fondsMitteilung.betrag })
    .from(fondsMitteilung)
    .innerJoin(organisation, eq(organisation.id, fondsMitteilung.organisationId))
    .where(and(eq(fondsMitteilung.fondsId, bewegung.fondsId), eq(fondsMitteilung.bewegungId, bewegung.storniertBewegungId ?? bewegung.id)))
    .orderBy(asc(organisation.name), asc(organisation.id));
  const gebucht = mitteilungen.length ? [] : await tx.select({ organisationId: abrufAnteil.organisationId, investor: organisation.name, betrag: abrufAnteil.betrag })
    .from(abrufAnteil).innerJoin(organisation, eq(organisation.id, abrufAnteil.organisationId))
    .where(eq(abrufAnteil.bewegungId, bewegung.storniertBewegungId ?? bewegung.id)).orderBy(asc(organisation.name), asc(organisation.id));
  if (!mitteilungen.length && !gebucht.length) return ladeBewegungsaufteilung(tx, bewegung.fondsId, bewegung.betrag, valuta);

  const { zeichnungen } = await ladeVerteilungsgrundlageZum(tx, bewegung.fondsId, valuta);
  const zeichnungJeOrganisation = new Map(zeichnungen.map((z) => [z.organisationId, z]));
  return {
    verteilungsbasis: null,
    verteilungsquelle: mitteilungen.length ? "mitteilungen" as const : "buchung" as const,
    aufteilung: (mitteilungen.length ? mitteilungen : gebucht).map((m) => {
      const z = zeichnungJeOrganisation.get(m.organisationId);
      return {
        ...m,
        zeichnungId: z?.zeichnungId ?? null,
        zusage: z?.zusage ?? null,
        anteil: z?.anteil ?? null,
        betrag: bewegung.storniertBewegungId ? new Decimal(m.betrag).neg().toFixed(2) : m.betrag,
      };
    }),
  };
}

/** Storno einer Fondsbewegung: Gegenbuchung mit negiertem Betrag, Valuta nicht vor dem Original (Vorgabe: heute oder die des Originals). */
export async function storniereFondsbewegung(tx: Tx, protokoll: Protokollant, id: string, grund: string, gewuenschteValuta: string | undefined) {
  const [original] = await tx.select().from(fondsBewegung).where(eq(fondsBewegung.id, id));
  if (!original) throw new Fachfehler(404, "fund_movement_not_found", "Fund movement not found.");
  await sperreFonds(tx, original.fondsId);
  if (original.storniertBewegungId) throw new Fachfehler(409, "reversal_not_allowed", "A reversal cannot itself be reversed.");
  const [schon] = await tx.select({ id: fondsBewegung.id }).from(fondsBewegung).where(eq(fondsBewegung.storniertBewegungId, id));
  if (schon) throw new Fachfehler(409, "already_reversed", "The fund movement is already reversed.");
  if (gewuenschteValuta !== undefined && gewuenschteValuta < original.valuta) {
    throw new Fachfehler(400, "invalid_input", "The input is invalid.", {
      felder: [{ feld: "valuta", code: "reversal_before_original", meldung: `The value date of the reversal must not be before that of the original (${original.valuta})` }],
    });
  }
  const heutigerTag = heute();
  const stornoValuta = gewuenschteValuta ?? (heutigerTag > original.valuta ? heutigerTag : original.valuta);
  await pruefePeriodensperre(tx, original.fondsId, stornoValuta);
  const zahlungen = await tx.select().from(lpZahlung).where(eq(lpZahlung.bewegungId, id));
  const aufgehoben = new Set(zahlungen.filter((z) => z.valuta <= stornoValuta).map((z) => z.storniertZahlungId));
  if (zahlungen.some((z) => !z.storniertZahlungId && !aufgehoben.has(z.id))) {
    throw new Fachfehler(409, "call_has_payments", "Reverse the incoming payments for the call first.");
  }
  const [storno] = await tx
    .insert(fondsBewegung)
    .values({
      fondsId: original.fondsId,
      art: original.art,
      valuta: stornoValuta,
      betrag: new Decimal(original.betrag).neg().toFixed(2),
      bemerkung: `Storno: ${grund}`,
      storniertBewegungId: original.id,
    })
    .returning();
  if (!storno) throw new Error("Storno nicht angelegt");
  await protokoll("storno", "fonds_bewegung", original.id, original, { grund, stornoBewegungId: storno.id });
  await protokoll("anlegen", "fonds_bewegung", storno.id, null, storno);
  return { storno, original };
}
