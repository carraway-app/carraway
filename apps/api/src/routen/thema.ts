import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { benutzerEinstellung, type Db } from "@carraway/db";
import { aktuellerAkteur } from "../anmeldung/akteur";
import { Fachfehler } from "../fehler";
import { pruefe } from "../pruefung";
import { schreibe } from "../schreiben";
import { lese } from "../zeitlimit";

/**
 * Thema der Oberfläche (`system`, `hell`, `dunkel`) der angemeldeten Person. Eigene Route statt `/einstellungen`, weil sie auch
 * Investor-Benutzer des LP-Portals brauchen (die übrigen Einstellungen gibt es nur intern). Gelesen und geändert wird immer nur der
 * eigene Wert; ohne gespeicherten Wert gilt `system`. API-Schlüssel haben kein Thema. Eine Änderung ist eine Anzeigeeinstellung und
 * steht nicht im Änderungsprotokoll.
 */

export const THEMEN = ["system", "hell", "dunkel"] as const;
export type Thema = (typeof THEMEN)[number];

const aendern = z.object({ thema: z.enum(THEMEN) }).strict();

const keinSchluessel = (technisch: boolean) => {
  if (technisch) throw new Fachfehler(403, "TECHNISCHER_BENUTZER", "Ein API-Schlüssel hat kein Thema.");
};

export function themaRouten(db: Db) {
  return new Hono()
    .get("/", async (c) => {
      const akteur = aktuellerAkteur(c);
      keinSchluessel(akteur.technisch);
      const [zeile] = await lese(db, (tx) => tx.select({ thema: benutzerEinstellung.thema }).from(benutzerEinstellung).where(eq(benutzerEinstellung.benutzerId, akteur.id)));
      return c.json({ thema: THEMEN.find((t) => t === zeile?.thema) ?? "system" }, 200);
    })
    .patch("/", pruefe("json", aendern), async (c) => {
      const akteur = aktuellerAkteur(c);
      keinSchluessel(akteur.technisch);
      const { thema } = c.req.valid("json");
      await schreibe(db, c, async (tx) => {
        await tx.insert(benutzerEinstellung).values({ benutzerId: akteur.id, thema }).onConflictDoUpdate({ target: benutzerEinstellung.benutzerId, set: { thema, aktualisiertAm: new Date() } });
      });
      return c.json({ thema }, 200);
    });
}
