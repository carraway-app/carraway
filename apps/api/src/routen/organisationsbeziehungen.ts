import { kontaktJson, pruefeKontakt } from "../kontakte/http";
import { and, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { beziehungArt, organisationsbeziehung, type Db } from "@carraway/db";
import { Fachfehler, fehlerAntwort } from "../fehler";
import { ladeBeziehungen } from "../kontakte/beziehungen";
import { idParam, ladeFonds, ladeOrganisation, optionalerText, schreibe } from "../schreiben";
import { lese } from "../zeitlimit";


const neueBeziehung = z
  .object({
    vonOrganisationId: z.uuid(),
    /** Ziel ist entweder eine andere Organisation (Co-Investor von, Berater von) oder ein Fonds (Investor in Fonds). */
    zuOrganisationId: z.uuid().optional(),
    fondsId: z.uuid().optional(),
    art: z.enum(beziehungArt.enumValues),
    bemerkung: optionalerText(1000),
  })
  .refine((w) => (w.zuOrganisationId === undefined) !== (w.fondsId === undefined), { message: "Provide either toOrganizationId or fundId", path: ["zuOrganisationId"] });

/** Beziehungen zwischen Organisationen und zu Fonds (Co-Investor, Berater, Investor). */
export function beziehungRouten(db: Db) {
  return new Hono()
    .get("/", pruefeKontakt("query", z.object({ organisationId: z.uuid() })), async (c) => {
      const { organisationId } = c.req.valid("query");
      const daten = await lese(db, (tx) => ladeBeziehungen(tx, c, organisationId));
      return kontaktJson(c, { daten }, 200);
    })
    .post("/", pruefeKontakt("json", neueBeziehung), async (c) => {
      const werte = c.req.valid("json");
      if (werte.zuOrganisationId === werte.vonOrganisationId) {
        throw new Fachfehler(400, "invalid_input", "The input is invalid.", {
          felder: [{ feld: "zuOrganisationId", code: "invalid_value", meldung: "An organization cannot be related to itself" }],
        });
      }
      const neu = await schreibe(db, c, async (tx, protokoll) => {
        await ladeOrganisation(tx, werte.vonOrganisationId);
        if (werte.zuOrganisationId) await ladeOrganisation(tx, werte.zuOrganisationId);
        if (werte.fondsId) await ladeFonds(tx, werte.fondsId);
        const [vorhanden] = await tx
          .select({ id: organisationsbeziehung.id })
          .from(organisationsbeziehung)
          .where(
            and(
              eq(organisationsbeziehung.vonOrganisationId, werte.vonOrganisationId),
              eq(organisationsbeziehung.art, werte.art),
              werte.zuOrganisationId ? eq(organisationsbeziehung.zuOrganisationId, werte.zuOrganisationId) : isNull(organisationsbeziehung.zuOrganisationId),
              werte.fondsId ? eq(organisationsbeziehung.fondsId, werte.fondsId) : isNull(organisationsbeziehung.fondsId),
            ),
          );
        if (vorhanden) throw new Fachfehler(409, "relationship_exists", "This relationship already exists.");
        const [zeile] = await tx.insert(organisationsbeziehung).values(werte).returning();
        if (!zeile) throw new Error("Beziehung nicht angelegt");
        await protokoll("anlegen", "organisationsbeziehung", zeile.id, null, zeile);
        return zeile;
      });
      return kontaktJson(c, neu, 201);
    })
    .delete("/:id", pruefeKontakt("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const vorher = await schreibe(db, c, async (tx, protokoll) => {
        const [zeile] = await tx.delete(organisationsbeziehung).where(eq(organisationsbeziehung.id, id)).returning();
        if (!zeile) return null;
        await protokoll("loeschen", "organisationsbeziehung", id, zeile, null);
        return zeile;
      });
      if (!vorher) return fehlerAntwort(c, 404, "relationship_not_found", "Relationship not found.");
      return c.body(null, 204);
    });
}
