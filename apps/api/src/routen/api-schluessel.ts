import { randomUUID } from "node:crypto";
import { asc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { apiSchluessel, benutzer, fonds, type Db } from "@carraway/db";
import { aktuellerAkteur, erzeugeSchluessel, type SchluesselScope } from "../anmeldung/akteur";
import { Fachfehler } from "../fehler";
import { pruefe } from "../pruefung";
import { idParam, schreibe, textEingabe } from "../schreiben";
import { lese } from "../zeitlimit";

const TAG_MS = 24 * 60 * 60 * 1000;
export const STANDARD_LAUFZEIT_TAGE = 90;
export const HOECHSTE_LAUFZEIT_TAGE = 365;

const neuerSchluessel = z.object({
  name: textEingabe(100),
  scopes: z
    .array(z.object({ fondsId: z.uuid(), recht: z.enum(["lesen", "schreiben"]) }))
    .min(1)
    .max(50),
  /** Ablaufzeitpunkt; Standard 90 Tage, höchstens 365 Tage. */
  ablauf: z.iso.datetime({ offset: true }).optional(),
});

function status(z: { ablauf: Date; widerrufenAm: Date | null }): "aktiv" | "abgelaufen" | "widerrufen" {
  if (z.widerrufenAm) return "widerrufen";
  return z.ablauf <= new Date() ? "abgelaufen" : "aktiv";
}

const ansicht = (z: typeof apiSchluessel.$inferSelect) => ({
  id: z.id,
  name: z.name,
  benutzerId: z.benutzerId,
  vorschau: z.vorschau,
  scopes: z.scopes as SchluesselScope[],
  ablauf: z.ablauf.toISOString(),
  erstelltAm: z.erstelltAm.toISOString(),
  zuletztGenutzt: z.zuletztGenutzt?.toISOString() ?? null,
  widerrufenAm: z.widerrufenAm?.toISOString() ?? null,
  status: status(z),
});

/**
 * API-Schlüssel (globale Verwalter): Anlage zeigt den Schlüssel genau einmal, in der Datenbank liegt nur sein
 * SHA-256-Hash. Jeder Schlüssel gehört einem eigenen technischen Benutzer; seine Rechte sind die Scopes
 * (lesen = Betrachter, schreiben = Bearbeiter, nie Freigabe).
 */
export function apiSchluesselRouten(db: Db) {
  return new Hono()
    .get("/", async (c) => {
      const zeilen = await lese(db, (tx) => tx.select().from(apiSchluessel).orderBy(asc(apiSchluessel.erstelltAm), asc(apiSchluessel.id)));
      return c.json({ daten: zeilen.map(ansicht) }, 200);
    })
    .post("/", pruefe("json", neuerSchluessel), async (c) => {
      const eingabe = c.req.valid("json");
      const jetzt = Date.now();
      const ablauf = eingabe.ablauf ? new Date(eingabe.ablauf) : new Date(jetzt + STANDARD_LAUFZEIT_TAGE * TAG_MS);
      if (ablauf.getTime() <= jetzt || ablauf.getTime() > jetzt + HOECHSTE_LAUFZEIT_TAGE * TAG_MS) {
        throw new Fachfehler(400, "EINGABE_UNGUELTIG", "Die Eingabe ist ungültig.", {
          felder: [{ feld: "ablauf", code: "ablauf_ausserhalb", meldung: `Ablauf muss in der Zukunft und höchstens ${HOECHSTE_LAUFZEIT_TAGE} Tage entfernt liegen` }],
        });
      }
      const schluessel = erzeugeSchluessel();
      const akteur = aktuellerAkteur(c);
      const ergebnis = await schreibe(db, c, async (tx, protokoll) => {
        const fondsIds = [...new Set(eingabe.scopes.map((s) => s.fondsId))];
        const vorhanden = await tx.select({ id: fonds.id }).from(fonds).where(inArray(fonds.id, fondsIds));
        if (vorhanden.length !== fondsIds.length) throw new Fachfehler(404, "FONDS_NICHT_GEFUNDEN", "Fonds nicht gefunden.");
        const [technisch] = await tx
          .insert(benutzer)
          .values({ name: `API: ${eingabe.name}`, email: `schluessel-${randomUUID()}@technisch.invalid`, emailVerified: true, technisch: true })
          .returning();
        if (!technisch) throw new Error("Technischer Benutzer nicht angelegt");
        const [zeile] = await tx
          .insert(apiSchluessel)
          .values({ name: eingabe.name, benutzerId: technisch.id, scopes: eingabe.scopes, ablauf, hash: schluessel.hash, vorschau: schluessel.vorschau, erstelltVon: akteur.id })
          .returning();
        if (!zeile) throw new Error("API-Schlüssel nicht angelegt");
        await protokoll("anlegen", "api_schluessel", zeile.id, null, ansicht(zeile));
        return zeile;
      });
      return c.json({ ...ansicht(ergebnis), schluessel: schluessel.klartext }, 201);
    })
    .delete("/:id", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const nachher = await schreibe(db, c, async (tx, protokoll) => {
        const [vorher] = await tx.select().from(apiSchluessel).where(eq(apiSchluessel.id, id)).for("update");
        if (!vorher) throw new Fachfehler(404, "SCHLUESSEL_NICHT_GEFUNDEN", "API-Schlüssel nicht gefunden.");
        if (vorher.widerrufenAm) return vorher;
        const [neu] = await tx.update(apiSchluessel).set({ widerrufenAm: new Date() }).where(eq(apiSchluessel.id, id)).returning();
        await protokoll("widerrufen", "api_schluessel", id, ansicht(vorher), ansicht(neu!));
        return neu!;
      });
      return c.json(ansicht(nachher), 200);
    });
}
