import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { benutzerEinstellung, kalenderToken, type Db } from "@carraway/db";
import { aktuellerAkteur } from "../anmeldung/akteur";
import { pruefe } from "../pruefung";
import { MINDESTENS_EIN_FELD, mindestensEins, nurGesetzte, schreibe } from "../schreiben";
import { lese } from "../zeitlimit";

/**
 * Persönliche Einstellungen (Etappe 17): Sprache der Mails, Opt-ins für Hinweise bei Berichtsfreigaben und bei neuen Registerereignissen und der Link für das
 * Kalenderabonnement (ICS) mit den eigenen Wiedervorlagen. Alles gilt nur für die angemeldete Person.
 */

const aendern = z
  .object({ language: z.enum(["de", "en"]).optional(), mailOnReportApproved: z.boolean().optional(), mailOnRegisterEvent: z.boolean().optional() })
  .strict()
  .refine(mindestensEins, MINDESTENS_EIN_FELD);

export const kalenderTokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
export const KALENDER_TOKEN_FORM = /^[A-Za-z0-9_-]{43}$/;

export function einstellungenRouten(db: Db) {
  const lade = async (benutzerId: string) => {
    const [z] = await lese(db, (tx) => tx.select().from(benutzerEinstellung).where(eq(benutzerEinstellung.benutzerId, benutzerId)));
    return { language: z?.sprache === "en" ? ("en" as const) : ("de" as const), mailOnReportApproved: z?.mailBerichtFreigegeben ?? false, mailOnRegisterEvent: z?.mailRegisterEreignis ?? false };
  };
  return new Hono()
    .get("/", async (c) => {
      const { id } = aktuellerAkteur(c);
      const k = c.get("mail");
      return c.json({ ...(await lade(id)), mailAvailable: Boolean(k?.konfig && k.ring) }, 200);
    })
    .put("/", pruefe("json", aendern), async (c) => {
      const { id } = aktuellerAkteur(c);
      const eingabe = c.req.valid("json");
      const werte = nurGesetzte({ sprache: eingabe.language, mailBerichtFreigegeben: eingabe.mailOnReportApproved, mailRegisterEreignis: eingabe.mailOnRegisterEvent });
      await schreibe(db, c, async (tx, protokoll) => {
        const [vorher] = await tx.select().from(benutzerEinstellung).where(eq(benutzerEinstellung.benutzerId, id));
        const [nachher] = await tx
          .insert(benutzerEinstellung)
          .values({ benutzerId: id, ...werte })
          .onConflictDoUpdate({ target: benutzerEinstellung.benutzerId, set: { ...werte, aktualisiertAm: new Date() } })
          .returning();
        await protokoll(vorher ? "aendern" : "anlegen", "benutzer_einstellung", id, vorher ?? null, nachher);
      });
      return c.json(await lade(id), 200);
    })
    .get("/calendar-link", async (c) => {
      const { id } = aktuellerAkteur(c);
      const [z] = await lese(db, (tx) => tx.select().from(kalenderToken).where(and(eq(kalenderToken.benutzerId, id), isNull(kalenderToken.widerrufenAm))));
      return c.json({ active: Boolean(z), createdAt: z?.erstelltAm.toISOString() ?? null, lastAccessAt: z?.letzterZugriffAm?.toISOString() ?? null }, 200);
    })
    /** Erzeugt den Link (ersetzt einen bestehenden: der alte ist sofort ungültig). Das Token erscheint genau einmal, gespeichert wird nur der Hash. */
    .post("/calendar-link", async (c) => {
      const { id } = aktuellerAkteur(c);
      const token = randomBytes(32).toString("base64url");
      await schreibe(db, c, async (tx, protokoll) => {
        const alt = await tx.update(kalenderToken).set({ widerrufenAm: new Date() }).where(and(eq(kalenderToken.benutzerId, id), isNull(kalenderToken.widerrufenAm))).returning({ id: kalenderToken.id });
        const [neu] = await tx.insert(kalenderToken).values({ benutzerId: id, tokenHash: kalenderTokenHash(token) }).returning({ id: kalenderToken.id });
        await protokoll(alt.length ? "neuer_link" : "anlegen", "kalender_token", neu!.id, null, { ersetzt: alt.length });
      });
      const basis = c.get("mail")?.appBasis ?? "";
      const pfad = `/api/v1/calendar/${token}.ics`;
      return c.json({ token, path: pfad, url: `${basis}${pfad}` }, 201);
    })
    .delete("/calendar-link", async (c) => {
      const { id } = aktuellerAkteur(c);
      await schreibe(db, c, async (tx, protokoll) => {
        const alt = await tx.update(kalenderToken).set({ widerrufenAm: new Date() }).where(and(eq(kalenderToken.benutzerId, id), isNull(kalenderToken.widerrufenAm))).returning({ id: kalenderToken.id });
        for (const a of alt) await protokoll("widerrufen", "kalender_token", a.id, null, null);
      });
      return c.body(null, 204);
    });
}
