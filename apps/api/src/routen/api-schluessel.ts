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
    .array(z.object({ fundId: z.uuid(), permission: z.enum(["read", "write"]) }))
    .min(1)
    .max(50),
  /** Ablaufzeitpunkt; Standard 90 Tage, höchstens 365 Tage. */
  expiresAt: z.iso.datetime({ offset: true }).optional(),
});

/** Rechte der Schlüssel heißen in der Datenbank `lesen` und `schreiben`, an der Schnittstelle `read` und `write`. */
const RECHT_AN_API = { lesen: "read", schreiben: "write" } as const;
const RECHT_AUS_API = { read: "lesen", write: "schreiben" } as const;

function status(z: { ablauf: Date; widerrufenAm: Date | null }): "active" | "expired" | "revoked" {
  if (z.widerrufenAm) return "revoked";
  return z.ablauf <= new Date() ? "expired" : "active";
}

/** Stand eines Schlüssels im Änderungsprotokoll (Namen der Datenbank, unverändert). */
const protokollAnsicht = (z: typeof apiSchluessel.$inferSelect) => ({
  id: z.id,
  name: z.name,
  benutzerId: z.benutzerId,
  vorschau: z.vorschau,
  scopes: z.scopes as SchluesselScope[],
  ablauf: z.ablauf.toISOString(),
  erstelltAm: z.erstelltAm.toISOString(),
  zuletztGenutzt: z.zuletztGenutzt?.toISOString() ?? null,
  widerrufenAm: z.widerrufenAm?.toISOString() ?? null,
  status: status(z) === "active" ? "aktiv" : status(z) === "expired" ? "abgelaufen" : "widerrufen",
});

const ansicht = (z: typeof apiSchluessel.$inferSelect) => ({
  id: z.id,
  name: z.name,
  userId: z.benutzerId,
  preview: z.vorschau,
  scopes: (z.scopes as SchluesselScope[]).map((s) => ({ fundId: s.fondsId, permission: RECHT_AN_API[s.recht] })),
  expiresAt: z.ablauf.toISOString(),
  createdAt: z.erstelltAm.toISOString(),
  lastUsedAt: z.zuletztGenutzt?.toISOString() ?? null,
  revokedAt: z.widerrufenAm?.toISOString() ?? null,
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
      return c.json({ data: zeilen.map(ansicht) }, 200);
    })
    .post("/", pruefe("json", neuerSchluessel), async (c) => {
      const eingabe = c.req.valid("json");
      const jetzt = Date.now();
      const ablauf = eingabe.expiresAt ? new Date(eingabe.expiresAt) : new Date(jetzt + STANDARD_LAUFZEIT_TAGE * TAG_MS);
      if (ablauf.getTime() <= jetzt || ablauf.getTime() > jetzt + HOECHSTE_LAUFZEIT_TAGE * TAG_MS) {
        throw new Fachfehler(400, "invalid_input", "The input is invalid.", {
          felder: [{ feld: "expiresAt", code: "expiry_out_of_range", meldung: `Expiry must be in the future and at most ${HOECHSTE_LAUFZEIT_TAGE} days away` }],
        });
      }
      const schluessel = erzeugeSchluessel();
      const akteur = aktuellerAkteur(c);
      const ergebnis = await schreibe(db, c, async (tx, protokoll) => {
        const fondsIds = [...new Set(eingabe.scopes.map((s) => s.fundId))];
        const vorhanden = await tx.select({ id: fonds.id }).from(fonds).where(inArray(fonds.id, fondsIds));
        if (vorhanden.length !== fondsIds.length) throw new Fachfehler(404, "fund_not_found", "Fund not found.");
        const [technisch] = await tx
          .insert(benutzer)
          .values({ name: `API: ${eingabe.name}`, email: `schluessel-${randomUUID()}@technisch.invalid`, emailVerified: true, technisch: true })
          .returning();
        if (!technisch) throw new Error("Technischer Benutzer nicht angelegt");
        const [zeile] = await tx
          .insert(apiSchluessel)
          .values({ name: eingabe.name, benutzerId: technisch.id, scopes: eingabe.scopes.map((s): SchluesselScope => ({ fondsId: s.fundId, recht: RECHT_AUS_API[s.permission] })), ablauf, hash: schluessel.hash, vorschau: schluessel.vorschau, erstelltVon: akteur.id })
          .returning();
        if (!zeile) throw new Error("API-Schlüssel nicht angelegt");
        await protokoll("anlegen", "api_schluessel", zeile.id, null, protokollAnsicht(zeile));
        return zeile;
      });
      return c.json({ ...ansicht(ergebnis), key: schluessel.klartext }, 201);
    })
    .delete("/:id", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const nachher = await schreibe(db, c, async (tx, protokoll) => {
        const [vorher] = await tx.select().from(apiSchluessel).where(eq(apiSchluessel.id, id)).for("update");
        if (!vorher) throw new Fachfehler(404, "key_not_found", "API key not found.");
        if (vorher.widerrufenAm) return vorher;
        const [neu] = await tx.update(apiSchluessel).set({ widerrufenAm: new Date() }).where(eq(apiSchluessel.id, id)).returning();
        await protokoll("widerrufen", "api_schluessel", id, protokollAnsicht(vorher), protokollAnsicht(neu!));
        return neu!;
      });
      return c.json(ansicht(nachher), 200);
    });
}
