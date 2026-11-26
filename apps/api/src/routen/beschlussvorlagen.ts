import { and, asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { beschlussvorlage, fonds, type Db } from "@carraway/db";
import { PLATZHALTER, unbekanntePlatzhalter } from "../beschluss/vorlage";
import { Fachfehler, fehlerAntwort } from "../fehler";
import { fondsSichtbar } from "../rechte/sichtbarkeit";
import { idParam, ladeFonds, MINDESTENS_EIN_FELD, mindestensEins, nurGesetzte, schreibe, textEingabe } from "../schreiben";
import { lese } from "../zeitlimit";
import type { Tx } from "../zeitlimit";
import { berichtPruefung } from "../berichte-pruefung";
import { berichtAnApi } from "../berichte-vertrag";

const pruefeApi = berichtPruefung("resolution");
const anApi = <T>(wert: T) => berichtAnApi("resolution", wert);

/** Der Text darf nur bekannte Platzhalter enthalten; sonst 400 mit der Liste der unbekannten. */
function pruefeText(text: string) {
  const unbekannt = unbekanntePlatzhalter(text);
  if (unbekannt.length > 0) {
    throw new Fachfehler(400, "placeholder_unknown", "The text contains unknown placeholders.", { unbekannt, erlaubt: PLATZHALTER });
  }
}

const textFeld = z.string().trim().min(1).max(20000);

const neueVorlage = z.object({ fondsId: z.uuid(), name: textEingabe(200), text: textFeld });
const aenderungVorlage = z.object({ name: textEingabe(200).optional(), text: textFeld.optional() }).refine(mindestensEins, MINDESTENS_EIN_FELD);

async function pruefeNameFrei(tx: Tx, fondsId: string, name: string, ausser?: string) {
  const [vorhanden] = await tx
    .select({ id: beschlussvorlage.id })
    .from(beschlussvorlage)
    .where(and(eq(beschlussvorlage.fondsId, fondsId), eq(beschlussvorlage.name, name)));
  if (vorhanden && vorhanden.id !== ausser) throw new Fachfehler(409, "template_exists", "The fund already has a template with this name.");
}

/** Textvorlagen für den Beschlussvorschlag, je Fonds von Verwaltern gepflegt. */
export function beschlussvorlageRouten(db: Db) {
  return new Hono()
    .get("/", pruefeApi("query", z.object({ fondsId: z.uuid().optional() })), async (c) => {
      const { fondsId } = c.req.valid("query");
      const zeilen = await lese(db, (tx) =>
        tx
          .select({
            id: beschlussvorlage.id,
            fondsId: beschlussvorlage.fondsId,
            fonds: { id: fonds.id, name: fonds.name, kurzname: fonds.kurzname },
            name: beschlussvorlage.name,
            text: beschlussvorlage.text,
            aktualisiertAm: beschlussvorlage.aktualisiertAm,
          })
          .from(beschlussvorlage)
          .innerJoin(fonds, eq(fonds.id, beschlussvorlage.fondsId))
          .where(and(fondsId ? eq(beschlussvorlage.fondsId, fondsId) : undefined, fondsSichtbar(c, beschlussvorlage.fondsId)))
          .orderBy(asc(fonds.name), asc(beschlussvorlage.name), asc(beschlussvorlage.id)),
      );
      return c.json(anApi({ daten: zeilen, platzhalter: PLATZHALTER }), 200);
    })
    .post("/", pruefeApi("json", neueVorlage), async (c) => {
      const werte = c.req.valid("json");
      pruefeText(werte.text);
      const neu = await schreibe(db, c, async (tx, protokoll) => {
        await ladeFonds(tx, werte.fondsId);
        await pruefeNameFrei(tx, werte.fondsId, werte.name);
        const [zeile] = await tx.insert(beschlussvorlage).values(werte).returning();
        if (!zeile) throw new Error("Vorlage nicht angelegt");
        await protokoll("anlegen", "beschlussvorlage", zeile.id, null, zeile);
        return zeile;
      });
      return c.json(anApi(neu), 201);
    })
    .patch("/:id", pruefeApi("param", idParam), pruefeApi("json", aenderungVorlage), async (c) => {
      const { id } = c.req.valid("param");
      const aenderungen = nurGesetzte(c.req.valid("json"));
      if (aenderungen.text) pruefeText(aenderungen.text);
      const neu = await schreibe(db, c, async (tx, protokoll) => {
        const [vorher] = await tx.select().from(beschlussvorlage).where(eq(beschlussvorlage.id, id)).for("update");
        if (!vorher) throw new Fachfehler(404, "template_not_found", "Template not found.");
        if (aenderungen.name) await pruefeNameFrei(tx, vorher.fondsId, aenderungen.name, id);
        const [nachher] = await tx
          .update(beschlussvorlage)
          .set({ ...aenderungen, aktualisiertAm: new Date() })
          .where(eq(beschlussvorlage.id, id))
          .returning();
        await protokoll("aendern", "beschlussvorlage", id, vorher, nachher);
        return nachher;
      });
      return c.json(anApi(neu), 200);
    })
    .delete("/:id", pruefeApi("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const vorher = await schreibe(db, c, async (tx, protokoll) => {
        const [zeile] = await tx.delete(beschlussvorlage).where(eq(beschlussvorlage.id, id)).returning();
        if (!zeile) return null;
        await protokoll("loeschen", "beschlussvorlage", id, zeile, null);
        return zeile;
      });
      if (!vorher) return fehlerAntwort(c, 404, "template_not_found", "Template not found.");
      return c.body(null, 204);
    });
}
