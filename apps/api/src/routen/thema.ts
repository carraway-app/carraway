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

/** In der Datenbank stehen `system`, `hell` und `dunkel`; an der Schnittstelle `system`, `light` und `dark`. */
const THEMA_AN_API = { system: "system", hell: "light", dunkel: "dark" } as const;
const THEMA_AUS_API = { system: "system", light: "hell", dark: "dunkel" } as const;

const aendern = z.object({ theme: z.enum(["system", "light", "dark"]) }).strict();

const keinSchluessel = (technisch: boolean) => {
  if (technisch) throw new Fachfehler(403, "technical_user", "An API key has no theme.");
};

export function themaRouten(db: Db) {
  return new Hono()
    .get("/", async (c) => {
      const akteur = aktuellerAkteur(c);
      keinSchluessel(akteur.technisch);
      const [zeile] = await lese(db, (tx) => tx.select({ thema: benutzerEinstellung.thema }).from(benutzerEinstellung).where(eq(benutzerEinstellung.benutzerId, akteur.id)));
      return c.json({ theme: THEMA_AN_API[THEMEN.find((t) => t === zeile?.thema) ?? "system"] }, 200);
    })
    .patch("/", pruefe("json", aendern), async (c) => {
      const akteur = aktuellerAkteur(c);
      keinSchluessel(akteur.technisch);
      const thema = THEMA_AUS_API[c.req.valid("json").theme];
      await schreibe(db, c, async (tx) => {
        await tx.insert(benutzerEinstellung).values({ benutzerId: akteur.id, thema }).onConflictDoUpdate({ target: benutzerEinstellung.benutzerId, set: { thema, aktualisiertAm: new Date() } });
      });
      return c.json({ theme: THEMA_AN_API[thema] }, 200);
    });
}
