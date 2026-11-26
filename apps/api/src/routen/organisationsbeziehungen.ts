import { and, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { beziehungArt, organisationsbeziehung, type Db } from "@carraway/db";
import { Fachfehler, fehlerAntwort } from "../fehler";
import { ladeBeziehungen } from "../kontakte/beziehungen";
import { pruefe } from "../pruefung";
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
  .refine((w) => (w.zuOrganisationId === undefined) !== (w.fondsId === undefined), { message: "Entweder zuOrganisationId oder fondsId angeben", path: ["zuOrganisationId"] });

/** Beziehungen zwischen Organisationen und zu Fonds (Co-Investor, Berater, Investor). */
export function beziehungRouten(db: Db) {
  return new Hono()
    .get("/", pruefe("query", z.object({ organisationId: z.uuid() })), async (c) => {
      const { organisationId } = c.req.valid("query");
      const daten = await lese(db, (tx) => ladeBeziehungen(tx, c, organisationId));
      return c.json({ daten }, 200);
    })
    .post("/", pruefe("json", neueBeziehung), async (c) => {
      const werte = c.req.valid("json");
      if (werte.zuOrganisationId === werte.vonOrganisationId) {
        throw new Fachfehler(400, "EINGABE_UNGUELTIG", "Die Eingabe ist ungültig.", {
          felder: [{ feld: "zuOrganisationId", code: "invalid_value", meldung: "Eine Organisation steht nicht in Beziehung zu sich selbst" }],
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
        if (vorhanden) throw new Fachfehler(409, "BEZIEHUNG_VORHANDEN", "Diese Beziehung gibt es bereits.");
        const [zeile] = await tx.insert(organisationsbeziehung).values(werte).returning();
        if (!zeile) throw new Error("Beziehung nicht angelegt");
        await protokoll("anlegen", "organisationsbeziehung", zeile.id, null, zeile);
        return zeile;
      });
      return c.json(neu, 201);
    })
    .delete("/:id", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const vorher = await schreibe(db, c, async (tx, protokoll) => {
        const [zeile] = await tx.delete(organisationsbeziehung).where(eq(organisationsbeziehung.id, id)).returning();
        if (!zeile) return null;
        await protokoll("loeschen", "organisationsbeziehung", id, zeile, null);
        return zeile;
      });
      if (!vorher) return fehlerAntwort(c, 404, "BEZIEHUNG_NICHT_GEFUNDEN", "Beziehung nicht gefunden.");
      return c.body(null, 204);
    });
}
