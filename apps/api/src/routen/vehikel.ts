import { pruefeFonds } from "../fonds-pruefung";
import { fondsAnApi } from "../fonds-vertrag";
import { and, eq, ne } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { rundenposition, vehikel, vehikelArt, vehikelStatus, type Db } from "@carraway/db";
import { aktuellerAkteur } from "../anmeldung/akteur";
import { Fachfehler } from "../fehler";
import { ladeVehikel, ladeVehikelDesInvestors, sucheVehikel, verlangeInvestor, verlangeNameFrei } from "../kapital/vehikel";
import { hatBereich } from "../rechte/bereiche";
import { idParam, ladeOrganisation, MINDESTENS_EIN_FELD, mindestensEins, schreibe, textEingabe } from "../schreiben";
import { lese } from "../zeitlimit";

/**
 * Vehikel der Co-Investoren (docs/portfolio-modell.md, „Vehikel der Co-Investoren“): Auswahlliste für Runden- und Positionsdialoge, Vehikel eines Investors
 * mit ihren Positionen, Anlegen, Ändern und Löschen. Vehikel sind Kontaktdaten; die Positionen je Vehikel folgen den Rechten der Rundenliste.
 */

const auflagejahr = z.number().int().min(1900).max(2100);
const neuesVehikel = z.object({
  name: textEingabe(200),
  art: z.enum(vehikelArt.enumValues).default("fonds"),
  auflagejahr: auflagejahr.nullable().optional(),
  status: z.enum(vehikelStatus.enumValues).default("aktiv"),
  /** Das erste Vehikel eines Investors wird immer Standard; `true` macht ein weiteres zum Standard. */
  standard: z.boolean().optional(),
});
const vehikelAenderung = z
  .object({
    name: textEingabe(200).optional(),
    art: z.enum(vehikelArt.enumValues).optional(),
    auflagejahr: auflagejahr.nullable().optional(),
    status: z.enum(vehikelStatus.enumValues).optional(),
    /** Nur `true`: Das Kennzeichen wandert vom bisherigen Standard-Vehikel hierher (ohne Standard bleibt kein Investor). */
    standard: z.literal(true).optional(),
  })
  .refine(mindestensEins, MINDESTENS_EIN_FELD);
const auswahlAbfrage = z.object({
  suche: z.string().trim().max(200).optional(),
  investorId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(50),
});

/** Mount unter `/vehicles`. */
export function vehikelRouten(db: Db) {
  return new Hono()
    /** Auswahlliste mit Investor, gesucht in Vehikel- und Investornamen. */
    .get("/", pruefeFonds("query", auswahlAbfrage), async (c) => {
      const w = c.req.valid("query");
      const daten = await lese(db, (tx) => sucheVehikel(tx, { suche: w.suche || undefined, investorId: w.investorId, limit: w.limit }));
      return c.json(fondsAnApi({ daten }), 200);
    })
    .patch("/:id", pruefeFonds("param", idParam), pruefeFonds("json", vehikelAenderung), async (c) => {
      const { id } = c.req.valid("param");
      const e = c.req.valid("json");
      const nachher = await schreibe(db, c, async (tx, protokoll) => {
        const vorher = await ladeVehikel(tx, id, true);
        if (e.name !== undefined && e.name !== vorher.name) await verlangeNameFrei(tx, vorher.investorId, e.name, id);
        if (e.standard && !vorher.standard) {
          const bisherige = await tx
            .update(vehikel)
            .set({ standard: false })
            .where(and(eq(vehikel.investorId, vorher.investorId), eq(vehikel.standard, true), ne(vehikel.id, id)))
            .returning();
          for (const b of bisherige) await protokoll("aendern", "vehikel", b.id, { ...b, standard: true }, b);
        }
        const werte = {
          ...(e.name !== undefined ? { name: e.name } : {}),
          ...(e.art !== undefined ? { art: e.art } : {}),
          ...(e.auflagejahr !== undefined ? { auflagejahr: e.auflagejahr } : {}),
          ...(e.status !== undefined ? { status: e.status } : {}),
          ...(e.standard ? { standard: true } : {}),
        };
        const [neu] = await tx.update(vehikel).set(werte).where(eq(vehikel.id, id)).returning();
        await protokoll("aendern", "vehikel", id, vorher, neu);
        return neu!;
      });
      return c.json(fondsAnApi(nachher), 200);
    })
    /** Nur ohne Positionen. Ein gelöschtes Standard-Vehikel gibt das Kennzeichen an das älteste übrige ab. */
    .delete("/:id", pruefeFonds("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      await schreibe(db, c, async (tx, protokoll) => {
        const vorher = await ladeVehikel(tx, id, true);
        const [benutzt] = await tx.select({ id: rundenposition.id }).from(rundenposition).where(eq(rundenposition.vehikelId, id)).limit(1);
        if (benutzt) throw new Fachfehler(409, "vehicle_in_use", "The vehicle has positions in financing rounds and cannot be deleted.");
        await tx.delete(vehikel).where(eq(vehikel.id, id));
        await protokoll("loeschen", "vehikel", id, vorher, null);
        if (vorher.standard) {
          const [naechstes] = await tx.select().from(vehikel).where(eq(vehikel.investorId, vorher.investorId)).orderBy(vehikel.erstelltAm, vehikel.id).limit(1);
          if (naechstes) {
            const [neu] = await tx.update(vehikel).set({ standard: true }).where(eq(vehikel.id, naechstes.id)).returning();
            await protokoll("aendern", "vehikel", naechstes.id, naechstes, neu);
          }
        }
      });
      return c.body(null, 204);
    });
}

/** Mount unter `/organizations/:id`: Vehikel eines Investors. */
export function organisationVehikelRouten(db: Db) {
  return new Hono()
    /** Vehikel des Investors mit ihren Positionen (nur mit Bereich Portfolio und nur Runden, die die Person in der Rundenliste des Unternehmens sähe). */
    .get("/vehicles", pruefeFonds("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const akteur = aktuellerAkteur(c);
      const daten = await lese(db, async (tx) => {
        await ladeOrganisation(tx, id);
        // Die Positionen sind Rundendaten (Bereich Portfolio); ohne ihn bleiben sie leer, die Anzahl je Vehikel bleibt.
        return ladeVehikelDesInvestors(tx, akteur, id, hatBereich(akteur, "portfolio"));
      });
      return c.json(fondsAnApi({ daten }), 200);
    })
    .post("/vehicles", pruefeFonds("param", idParam), pruefeFonds("json", neuesVehikel), async (c) => {
      const { id } = c.req.valid("param");
      const e = c.req.valid("json");
      const neu = await schreibe(db, c, async (tx, protokoll) => {
        const org = await verlangeInvestor(tx, id);
        await verlangeNameFrei(tx, org.id, e.name);
        const vorhandene = await tx.select().from(vehikel).where(eq(vehikel.investorId, org.id)).for("update");
        const standard = vorhandene.length === 0 || e.standard === true;
        if (standard) {
          for (const b of vorhandene.filter((v) => v.standard)) {
            const [neu] = await tx.update(vehikel).set({ standard: false }).where(eq(vehikel.id, b.id)).returning();
            await protokoll("aendern", "vehikel", b.id, b, neu);
          }
        }
        const [zeile] = await tx.insert(vehikel).values({ investorId: org.id, name: e.name, art: e.art, auflagejahr: e.auflagejahr ?? null, status: e.status, standard }).returning();
        if (!zeile) throw new Error("Vehikel nicht angelegt");
        await protokoll("anlegen", "vehikel", zeile.id, null, zeile);
        return zeile;
      });
      return c.json(fondsAnApi(neu), 201);
    });
}
