import { pruefeFonds } from "../fonds-pruefung";
import { fondsAnApi } from "../fonds-vertrag";
import { portfolioAnApi } from "../portfolio-vertrag";
import { pruefePortfolio } from "../portfolio-pruefung";
import { and, asc, eq, gte, isNull, lte, or, type SQL } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { beteiligung, gremienmandat, gremiumArt, mandatRolle, organisation, person, type Db } from "@carraway/db";
import { Fachfehler } from "../fehler";
import { idParam, ladeFonds, ladePerson, MINDESTENS_EIN_FELD, mindestensEins, nurGesetzte, optionalerText, schreibe } from "../schreiben";
import { lese, type Tx } from "../zeitlimit";

/**
 * Gremienmandate des Fonds je Beteiligung (Issue #156): Sitze in Beirat, Aufsichtsrat oder Board eines Beteiligungsunternehmens mit Person,
 * Rolle und Zeitraum. Ein Mandat ohne Ende läuft noch. Mandate sind Stammdaten: ändern und löschen, jede Änderung steht im Änderungsprotokoll.
 */

const zeitraumPasst = (w: { beginn?: string | null | undefined; ende?: string | null | undefined }) => !w.beginn || !w.ende || w.ende >= w.beginn;
const ZEITRAUM = { message: "The end must not be before the start", path: ["ende"] };

const neuesMandat = z
  .object({
    gremium: z.enum(gremiumArt.enumValues),
    gremiumName: optionalerText(200),
    personId: z.uuid(),
    rolle: z.enum(mandatRolle.enumValues),
    beginn: z.iso.date(),
    ende: z.iso.date().nullable().optional(),
    bemerkung: optionalerText(2000),
  })
  .refine(zeitraumPasst, ZEITRAUM);

const mandatAenderung = z
  .object({
    gremium: z.enum(gremiumArt.enumValues).optional(),
    gremiumName: optionalerText(200),
    personId: z.uuid().optional(),
    rolle: z.enum(mandatRolle.enumValues).optional(),
    beginn: z.iso.date().optional(),
    ende: z.iso.date().nullable().optional(),
    bemerkung: optionalerText(2000),
  })
  .refine(mindestensEins, MINDESTENS_EIN_FELD)
  .refine(zeitraumPasst, ZEITRAUM);

const mandatParam = z.object({ id: z.uuid(), mandatId: z.uuid() });
const listenAbfrage = z.object({
  /** Nur Mandate, die an diesem Tag laufen (Beginn bis Ende, je einschließlich). */
  stichtag: z.iso.date().optional(),
});

const spalten = {
  id: gremienmandat.id,
  beteiligungId: gremienmandat.beteiligungId,
  gremium: gremienmandat.gremium,
  gremiumName: gremienmandat.gremiumName,
  rolle: gremienmandat.rolle,
  beginn: gremienmandat.beginn,
  ende: gremienmandat.ende,
  bemerkung: gremienmandat.bemerkung,
  person: { id: person.id, vorname: person.vorname, nachname: person.nachname },
  organisation: { id: organisation.id, name: organisation.name },
};

const laufendAm = (stichtag: string): SQL => and(lte(gremienmandat.beginn, stichtag), or(isNull(gremienmandat.ende), gte(gremienmandat.ende, stichtag)))!;

async function ladeBeteiligung(tx: Tx, id: string) {
  const [b] = await tx.select().from(beteiligung).where(eq(beteiligung.id, id));
  if (!b) throw new Fachfehler(404, "investment_not_found", "Investment not found.");
  return b;
}

async function ladeMandate(tx: Tx, bedingung: SQL | undefined) {
  return tx
    .select(spalten)
    .from(gremienmandat)
    .innerJoin(person, eq(person.id, gremienmandat.personId))
    .innerJoin(beteiligung, eq(beteiligung.id, gremienmandat.beteiligungId))
    .innerJoin(organisation, eq(organisation.id, beteiligung.organisationId))
    .where(bedingung)
    .orderBy(asc(organisation.name), asc(gremienmandat.gremium), asc(gremienmandat.beginn), asc(person.nachname), asc(gremienmandat.id));
}

async function ladeMandat(tx: Tx, beteiligungId: string, mandatId: string) {
  const [m] = await tx.select().from(gremienmandat).where(and(eq(gremienmandat.id, mandatId), eq(gremienmandat.beteiligungId, beteiligungId))).for("update");
  if (!m) throw new Fachfehler(404, "mandate_not_found", "Mandate not found.");
  return m;
}

/** Mandate eines Fonds über alle Beteiligungen; mit `stichtag` nur die an dem Tag laufenden. Wird auch von der Werte-Schnittstelle genutzt. */
export async function ladeFondsMandate(tx: Tx, fondsId: string, stichtag?: string) {
  return ladeMandate(tx, and(eq(beteiligung.fondsId, fondsId), stichtag ? laufendAm(stichtag) : undefined));
}

/** Mount unter `/beteiligungen`. */
export function beteiligungMandatRouten(db: Db) {
  return new Hono()
    .get("/:id/board-mandates", pruefePortfolio("param", idParam), pruefePortfolio("query", listenAbfrage), async (c) => {
      const { id } = c.req.valid("param");
      const { stichtag } = c.req.valid("query");
      const daten = await lese(db, async (tx) => {
        await ladeBeteiligung(tx, id);
        return ladeMandate(tx, and(eq(gremienmandat.beteiligungId, id), stichtag ? laufendAm(stichtag) : undefined));
      });
      return c.json(portfolioAnApi({ daten }), 200);
    })
    .post("/:id/board-mandates", pruefePortfolio("param", idParam), pruefePortfolio("json", neuesMandat), async (c) => {
      const { id } = c.req.valid("param");
      const e = c.req.valid("json");
      const neu = await schreibe(db, c, async (tx, protokoll) => {
        await ladeBeteiligung(tx, id);
        await ladePerson(tx, e.personId);
        const [zeile] = await tx
          .insert(gremienmandat)
          .values({ beteiligungId: id, gremium: e.gremium, gremiumName: e.gremiumName ?? null, personId: e.personId, rolle: e.rolle, beginn: e.beginn, ende: e.ende ?? null, bemerkung: e.bemerkung ?? null })
          .returning();
        if (!zeile) throw new Error("Mandat nicht angelegt");
        await protokoll("anlegen", "gremienmandat", zeile.id, null, zeile);
        return zeile;
      });
      return c.json(portfolioAnApi(neu), 201);
    })
    .patch("/:id/board-mandates/:mandateId", pruefePortfolio("param", mandatParam), pruefePortfolio("json", mandatAenderung), async (c) => {
      const { id, mandatId } = c.req.valid("param");
      const aenderungen = nurGesetzte(c.req.valid("json"));
      const neu = await schreibe(db, c, async (tx, protokoll) => {
        const vorher = await ladeMandat(tx, id, mandatId);
        if (aenderungen.personId) await ladePerson(tx, aenderungen.personId);
        const beginn = aenderungen.beginn ?? vorher.beginn;
        const ende = aenderungen.ende === undefined ? vorher.ende : aenderungen.ende;
        if (!zeitraumPasst({ beginn, ende })) {
          throw new Fachfehler(400, "invalid_input", "The input is invalid.", { felder: [{ feld: "ende", code: "invalid_value", meldung: ZEITRAUM.message }] });
        }
        const [nachher] = await tx.update(gremienmandat).set(aenderungen).where(eq(gremienmandat.id, mandatId)).returning();
        await protokoll("aendern", "gremienmandat", mandatId, vorher, nachher);
        return nachher;
      });
      return c.json(portfolioAnApi(neu), 200);
    })
    .delete("/:id/board-mandates/:mandateId", pruefePortfolio("param", mandatParam), async (c) => {
      const { id, mandatId } = c.req.valid("param");
      await schreibe(db, c, async (tx, protokoll) => {
        const vorher = await ladeMandat(tx, id, mandatId);
        await tx.delete(gremienmandat).where(eq(gremienmandat.id, mandatId));
        await protokoll("loeschen", "gremienmandat", mandatId, vorher, null);
      });
      return c.body(null, 204);
    });
}

/** Mount unter `/funds`: Mandate aller Beteiligungen eines Fonds. */
export function fondsMandatRouten(db: Db) {
  return new Hono().get("/:id/board-mandates", pruefeFonds("param", idParam), pruefeFonds("query", listenAbfrage), async (c) => {
    const { id } = c.req.valid("param");
    const { stichtag } = c.req.valid("query");
    const daten = await lese(db, async (tx) => {
      await ladeFonds(tx, id);
      return ladeFondsMandate(tx, id, stichtag);
    });
    return c.json(fondsAnApi({ daten }), 200);
  });
}
