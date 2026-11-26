import { and, asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { kontaktRolle, kontaktrolle, organisation, person, type Db } from "@carraway/db";
import { Fachfehler, fehlerAntwort } from "../fehler";
import { pruefe } from "../pruefung";
import { idParam, ladeOrganisation, ladePerson, MINDESTENS_EIN_FELD, mindestensEins, nurGesetzte, schreibe } from "../schreiben";
import { lese } from "../zeitlimit";

const zeitraumPasst = (w: { von?: string | null | undefined; bis?: string | null | undefined }) => !w.von || !w.bis || w.bis >= w.von;
const ZEITRAUM = { message: "bis darf nicht vor von liegen", path: ["bis"] };

const neueRolle = z
  .object({
    personId: z.uuid(),
    organisationId: z.uuid(),
    rolle: z.enum(kontaktRolle.enumValues),
    von: z.iso.date().nullable().optional(),
    bis: z.iso.date().nullable().optional(),
  })
  .refine(zeitraumPasst, ZEITRAUM);

const aenderungRolle = z
  .object({ rolle: z.enum(kontaktRolle.enumValues).optional(), von: z.iso.date().nullable().optional(), bis: z.iso.date().nullable().optional() })
  .refine(mindestensEins, MINDESTENS_EIN_FELD)
  .refine(zeitraumPasst, ZEITRAUM);

/** Rollen einer Person bei Organisationen (Gründer, Geschäftsführung, Co-Investor, Berater, Investor/LP), auch zeitlich begrenzt. */
export function kontaktrolleRouten(db: Db) {
  return new Hono()
    .get("/", pruefe("query", z.object({ personId: z.uuid().optional(), organisationId: z.uuid().optional() })), async (c) => {
      const { personId, organisationId } = c.req.valid("query");
      const zeilen = await lese(db, (tx) =>
        tx
          .select({
            id: kontaktrolle.id,
            rolle: kontaktrolle.rolle,
            von: kontaktrolle.von,
            bis: kontaktrolle.bis,
            person: { id: person.id, vorname: person.vorname, nachname: person.nachname },
            organisation: { id: organisation.id, name: organisation.name },
          })
          .from(kontaktrolle)
          .innerJoin(person, eq(person.id, kontaktrolle.personId))
          .innerJoin(organisation, eq(organisation.id, kontaktrolle.organisationId))
          .where(and(personId ? eq(kontaktrolle.personId, personId) : undefined, organisationId ? eq(kontaktrolle.organisationId, organisationId) : undefined))
          .orderBy(asc(organisation.name), asc(person.nachname), asc(kontaktrolle.rolle), asc(kontaktrolle.id)),
      );
      return c.json({ daten: zeilen }, 200);
    })
    .post("/", pruefe("json", neueRolle), async (c) => {
      const werte = c.req.valid("json");
      const neu = await schreibe(db, c, async (tx, protokoll) => {
        await ladePerson(tx, werte.personId);
        await ladeOrganisation(tx, werte.organisationId);
        const [vorhanden] = await tx
          .select({ id: kontaktrolle.id, von: kontaktrolle.von })
          .from(kontaktrolle)
          .where(and(eq(kontaktrolle.personId, werte.personId), eq(kontaktrolle.organisationId, werte.organisationId), eq(kontaktrolle.rolle, werte.rolle)));
        if (vorhanden && (vorhanden.von ?? null) === (werte.von ?? null)) throw new Fachfehler(409, "ROLLE_VORHANDEN", "Die Person hat diese Rolle bei der Organisation bereits.");
        const [zeile] = await tx.insert(kontaktrolle).values(werte).returning();
        if (!zeile) throw new Error("Rolle nicht angelegt");
        await protokoll("anlegen", "kontaktrolle", zeile.id, null, zeile);
        return zeile;
      });
      return c.json(neu, 201);
    })
    .patch("/:id", pruefe("param", idParam), pruefe("json", aenderungRolle), async (c) => {
      const { id } = c.req.valid("param");
      const aenderungen = nurGesetzte(c.req.valid("json"));
      const neu = await schreibe(db, c, async (tx, protokoll) => {
        const [vorher] = await tx.select().from(kontaktrolle).where(eq(kontaktrolle.id, id)).for("update");
        if (!vorher) throw new Fachfehler(404, "ROLLE_NICHT_GEFUNDEN", "Rolle nicht gefunden.");
        const von = aenderungen.von === undefined ? vorher.von : aenderungen.von;
        const bis = aenderungen.bis === undefined ? vorher.bis : aenderungen.bis;
        if (!zeitraumPasst({ von, bis })) {
          throw new Fachfehler(400, "EINGABE_UNGUELTIG", "Die Eingabe ist ungültig.", { felder: [{ feld: "bis", code: "invalid_value", meldung: ZEITRAUM.message }] });
        }
        const [nachher] = await tx.update(kontaktrolle).set(aenderungen).where(eq(kontaktrolle.id, id)).returning();
        await protokoll("aendern", "kontaktrolle", id, vorher, nachher);
        return nachher;
      });
      return c.json(neu, 200);
    })
    .delete("/:id", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const antwort = await schreibe(db, c, async (tx, protokoll) => {
        const [vorher] = await tx.delete(kontaktrolle).where(eq(kontaktrolle.id, id)).returning();
        if (!vorher) return null;
        await protokoll("loeschen", "kontaktrolle", id, vorher, null);
        return vorher;
      });
      if (!antwort) return fehlerAntwort(c, 404, "ROLLE_NICHT_GEFUNDEN", "Rolle nicht gefunden.");
      return c.body(null, 204);
    });
}
