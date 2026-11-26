import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { webhook, webhookZustellung, type Db } from "@carraway/db";
import { aktuellerAkteur, type Akteur } from "../anmeldung/akteur";
import { Fachfehler } from "../fehler";
import type { Schluesselring } from "../geheimnis/krypto";
import type { Aufloeser } from "../postfach/ziel";
import { pruefe } from "../pruefung";
import { idParam, MINDESTENS_EIN_FELD, mindestensEins, optionalerText, schreibe } from "../schreiben";
import { erzeugeGeheimnis } from "../webhooks/senden";
import { privateZieleErlaubt, pruefeWebhookZiel, ZielFehler } from "../webhooks/ziel";
import { geheimnisAad } from "../webhooks/zustellung";
import { lese, type Tx } from "../zeitlimit";
import { FEED_TABELLEN } from "./aenderungen";

/**
 * Webhooks (#154): Endpunkte, die bei Änderungen eine signierte Nachricht bekommen (Zustellung im Worker, `webhooks/zustellung.ts`).
 *
 * - Ein Endpunkt gehört dem Zugang, der ihn anlegt: einer Person (Sitzung) oder einem API-Schlüssel. Zugestellt wird nur, was dieser Zugang
 *   zum Zeitpunkt der Zustellung in der Änderungsabfrage sähe; endet der Zugang (Person deaktiviert, Schlüssel widerrufen), schaltet sich der
 *   Endpunkt ab. Sehen und ändern kann ihn nur sein Eigentümer; globale Verwalter sehen alle Endpunkte und können sie abschalten oder löschen.
 * - Das Geheimnis der Signatur erscheint genau einmal (Anlage und `rotate-secret`) und liegt nur verschlüsselt in der Datenbank.
 * - Ziel nur `https` mit öffentlicher Adresse (`webhooks/ziel.ts`), geprüft beim Anlegen, beim Ändern und bei jedem Versuch.
 * - `tables` nennt die Tabellen der Änderungsabfrage (Namen des Protokolls); leer = alle.
 */

/** Höchstens so viele Endpunkte je Zugang. */
export const HOECHSTE_ANZAHL = 20;

const tabellen = z.array(z.enum(FEED_TABELLEN as [string, ...string[]])).max(FEED_TABELLEN.length);

const neuerWebhook = z.object({
  url: z.string().trim().min(1).max(2000),
  description: optionalerText(200),
  tables: tabellen.default([]),
});

const aenderung = z
  .object({
    url: z.string().trim().min(1).max(2000).optional(),
    description: optionalerText(200),
    tables: tabellen.optional(),
    active: z.boolean().optional(),
  })
  .refine(mindestensEins, MINDESTENS_EIN_FELD);

const zustellAbfrage = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(200).optional(),
});

type Zeile = typeof webhook.$inferSelect;

const ansicht = (w: Zeile) => ({
  id: w.id,
  url: w.url,
  description: w.beschreibung,
  tables: w.tabellen,
  active: w.aktiv,
  consecutiveFailures: w.fehlerInFolge,
  disabledAt: w.deaktiviertAm?.toISOString() ?? null,
  disabledReason: w.deaktiviertGrund,
  ownerId: w.benutzerId,
  apiKeyId: w.apiSchluesselId,
  createdAt: w.erstelltAm.toISOString(),
  updatedAt: w.geaendertAm.toISOString(),
});

/** Stand im Änderungsprotokoll: ohne Geheimnis. */
const protokollAnsicht = (w: Zeile) => ({
  id: w.id,
  url: w.url,
  beschreibung: w.beschreibung,
  tabellen: w.tabellen,
  aktiv: w.aktiv,
  benutzerId: w.benutzerId,
  apiSchluesselId: w.apiSchluesselId,
  deaktiviertGrund: w.deaktiviertGrund,
});

const kodiere = (am: Date, id: string) => Buffer.from(JSON.stringify([am.toISOString(), id])).toString("base64url");
function dekodiere(cursor: string): [Date, string] | null {
  try {
    const w: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (Array.isArray(w) && typeof w[0] === "string" && typeof w[1] === "string" && z.uuid().safeParse(w[1]).success && !Number.isNaN(Date.parse(w[0]))) return [new Date(w[0]), w[1]];
  } catch {
    // ungültiger Cursor
  }
  return null;
}

export interface WebhookOptionen {
  ring: Schluesselring | undefined;
  aufloeser?: Aufloeser;
  privateErlaubt?: boolean;
}

export function webhookRouten(db: Db, opt: WebhookOptionen) {
  const privateErlaubt = opt.privateErlaubt ?? privateZieleErlaubt();

  async function pruefeZiel(url: string): Promise<string> {
    try {
      return (await pruefeWebhookZiel(url, { aufloeser: opt.aufloeser, privateErlaubt })).url.toString();
    } catch (e) {
      if (!(e instanceof ZielFehler)) throw e;
      const meldung = e.code === "webhook_url_invalid" ? "The URL must be an https address with a host name." : e.code === "webhook_target_forbidden" ? "This target is not allowed (local and private addresses are blocked)." : "The host name of the URL cannot be resolved.";
      throw new Fachfehler(400, e.code, meldung);
    }
  }

  function ring(): Schluesselring {
    if (!opt.ring) throw new Fachfehler(503, "secret_missing", "The key for encrypting secrets is missing in this installation.");
    return opt.ring;
  }

  /** Endpunkt des Akteurs (globale Verwalter: jeder); sonst 404, damit fremde Endpunkte nicht erkennbar sind. */
  async function eigener(tx: Tx, akteur: Akteur, id: string, sperren = false): Promise<Zeile> {
    const abfrage = tx.select().from(webhook).where(eq(webhook.id, id));
    const [w] = sperren ? await abfrage.for("update") : await abfrage;
    if (!w || (w.benutzerId !== akteur.id && !akteur.globalVerwalter)) throw new Fachfehler(404, "webhook_not_found", "Webhook not found.");
    return w;
  }

  return new Hono()
    .get("/", async (c) => {
      const akteur = aktuellerAkteur(c);
      const zeilen = await lese(db, (tx) =>
        tx
          .select()
          .from(webhook)
          .where(akteur.globalVerwalter ? undefined : eq(webhook.benutzerId, akteur.id))
          .orderBy(asc(webhook.erstelltAm), asc(webhook.id)),
      );
      return c.json({ data: zeilen.map(ansicht) }, 200);
    })
    .post("/", pruefe("json", neuerWebhook), async (c) => {
      const eingabe = c.req.valid("json");
      const akteur = aktuellerAkteur(c);
      const schluesselring = ring();
      const url = await pruefeZiel(eingabe.url);
      const geheimnis = erzeugeGeheimnis();
      const zeile = await schreibe(db, c, async (tx, protokoll) => {
        const [anzahl] = await tx.select({ n: count() }).from(webhook).where(eq(webhook.benutzerId, akteur.id));
        if ((anzahl?.n ?? 0) >= HOECHSTE_ANZAHL) throw new Fachfehler(409, "webhook_limit_reached", `At most ${HOECHSTE_ANZAHL} webhooks per access are allowed.`);
        const id = crypto.randomUUID();
        const [neu] = await tx
          .insert(webhook)
          .values({
            id,
            benutzerId: akteur.id,
            apiSchluesselId: akteur.quelle === "schluessel" ? (akteur.schluesselId ?? null) : null,
            url,
            beschreibung: eingabe.description ?? null,
            tabellen: [...new Set(eingabe.tables)],
            geheimnisVerschluesselt: schluesselring.verschluessele(geheimnis, geheimnisAad(id)),
          })
          .returning();
        await protokoll("anlegen", "webhook", id, null, protokollAnsicht(neu!));
        return neu!;
      });
      return c.json({ ...ansicht(zeile), secret: geheimnis }, 201);
    })
    .get("/:id", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const akteur = aktuellerAkteur(c);
      return c.json(ansicht(await lese(db, (tx) => eigener(tx, akteur, id))), 200);
    })
    .patch("/:id", pruefe("param", idParam), pruefe("json", aenderung), async (c) => {
      const { id } = c.req.valid("param");
      const eingabe = c.req.valid("json");
      const akteur = aktuellerAkteur(c);
      const url = eingabe.url === undefined ? undefined : await pruefeZiel(eingabe.url);
      const zeile = await schreibe(db, c, async (tx, protokoll) => {
        const vorher = await eigener(tx, akteur, id, true);
        // Nur der Eigentümer schaltet einen Endpunkt wieder ein oder ändert ihn; globale Verwalter können fremde Endpunkte nur abschalten.
        const fremd = vorher.benutzerId !== akteur.id;
        if (fremd && (url !== undefined || eingabe.tables !== undefined || eingabe.description !== undefined || eingabe.active === true)) {
          throw new Fachfehler(403, "forbidden", "Only the owner can change this webhook; administrators can only disable it.");
        }
        const einschalten = eingabe.active === true && !vorher.aktiv;
        const abschalten = eingabe.active === false && vorher.aktiv;
        const [neu] = await tx
          .update(webhook)
          .set({
            ...(url !== undefined ? { url } : {}),
            ...(eingabe.description !== undefined ? { beschreibung: eingabe.description } : {}),
            ...(eingabe.tables !== undefined ? { tabellen: [...new Set(eingabe.tables)] } : {}),
            ...(einschalten ? { aktiv: true, fehlerInFolge: 0, deaktiviertAm: null, deaktiviertGrund: null } : {}),
            ...(abschalten ? { aktiv: false, deaktiviertAm: new Date(), deaktiviertGrund: "manual" } : {}),
            geaendertAm: new Date(),
          })
          .where(eq(webhook.id, id))
          .returning();
        await protokoll("aendern", "webhook", id, protokollAnsicht(vorher), protokollAnsicht(neu!));
        return neu!;
      });
      return c.json(ansicht(zeile), 200);
    })
    .delete("/:id", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const akteur = aktuellerAkteur(c);
      await schreibe(db, c, async (tx, protokoll) => {
        const vorher = await eigener(tx, akteur, id, true);
        await tx.delete(webhook).where(eq(webhook.id, id));
        await protokoll("loeschen", "webhook", id, protokollAnsicht(vorher), null);
      });
      return c.body(null, 204);
    })
    .post("/:id/rotate-secret", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const akteur = aktuellerAkteur(c);
      const schluesselring = ring();
      const geheimnis = erzeugeGeheimnis();
      const zeile = await schreibe(db, c, async (tx, protokoll) => {
        const vorher = await eigener(tx, akteur, id, true);
        if (vorher.benutzerId !== akteur.id) throw new Fachfehler(403, "forbidden", "Only the owner can rotate the secret of this webhook.");
        const [neu] = await tx.update(webhook).set({ geheimnisVerschluesselt: schluesselring.verschluessele(geheimnis, geheimnisAad(id)), geaendertAm: new Date() }).where(eq(webhook.id, id)).returning();
        await protokoll("aendern", "webhook", id, protokollAnsicht(vorher), { ...protokollAnsicht(neu!), geheimnisErneuert: true });
        return neu!;
      });
      return c.json({ ...ansicht(zeile), secret: geheimnis }, 200);
    })
    .post("/:id/test", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const akteur = aktuellerAkteur(c);
      const zustellung = await schreibe(db, c, async (tx) => {
        const w = await eigener(tx, akteur, id);
        if (w.benutzerId !== akteur.id) throw new Fachfehler(403, "forbidden", "Only the owner can send a test event.");
        if (!w.aktiv) throw new Fachfehler(409, "webhook_inactive", "The webhook is disabled.");
        const [z] = await tx.insert(webhookZustellung).values({ webhookId: id, art: "ping" }).returning({ id: webhookZustellung.id });
        return z!;
      });
      // Der Worker übergibt die Zustellung im nächsten Takt an die Warteschlange.
      return c.json({ deliveryId: zustellung.id, status: "pending" as const }, 202);
    })
    .get("/:id/deliveries", pruefe("param", idParam), pruefe("query", zustellAbfrage), async (c) => {
      const { id } = c.req.valid("param");
      const { limit, cursor } = c.req.valid("query");
      const position = cursor ? dekodiere(cursor) : null;
      if (cursor && !position) throw new Fachfehler(400, "invalid_input", "The input is invalid.", { felder: [{ feld: "cursor", code: "invalid_format", meldung: "Invalid cursor" }] });
      const akteur = aktuellerAkteur(c);
      const zeilen = await lese(db, async (tx) => {
        await eigener(tx, akteur, id);
        // Reihenfolge auf Millisekunden gekürzt, damit der Cursor (JavaScript-Zeitpunkt) Zeilen derselben Millisekunde nicht überspringt.
        const am = sql`date_trunc('milliseconds', ${webhookZustellung.erstelltAm})`;
        return tx
          .select()
          .from(webhookZustellung)
          .where(and(eq(webhookZustellung.webhookId, id), position ? sql`(${am}, ${webhookZustellung.id}) < (${position[0].toISOString()}::timestamptz, ${position[1]}::uuid)` : undefined))
          .orderBy(desc(am), desc(webhookZustellung.id))
          .limit(limit + 1);
      });
      const seite = zeilen.slice(0, limit);
      const letzte = seite.at(-1);
      return c.json(
        {
          data: seite.map((z) => ({
            id: z.id,
            eventId: z.aenderungId,
            type: z.art,
            status: z.status,
            attempts: z.versuche,
            lastAttemptAt: z.letzterVersuchAm?.toISOString() ?? null,
            httpStatus: z.httpStatus,
            error: z.fehler,
            durationMs: z.dauerMs,
            createdAt: z.erstelltAm.toISOString(),
            deliveredAt: z.zugestelltAm?.toISOString() ?? null,
          })),
          nextCursor: zeilen.length > limit && letzte ? kodiere(letzte.erstelltAm, letzte.id) : null,
        },
        200,
      );
    });
}
