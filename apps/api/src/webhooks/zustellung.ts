import { and, eq, sql } from "drizzle-orm";
import { webhook, webhookZustellung, type Db } from "@carraway/db";
import { eigentuemerFonds, ladeSichtbareEreignisse, type Ereignis } from "../ereignisse/quelle";
import type { Schluesselring } from "../geheimnis/krypto";
import type { Aufloeser } from "../postfach/ziel";
import { schreibe } from "../schreiben";
import { lese, type Tx } from "../zeitlimit";
import { echterSender, signiere, type Sender } from "./senden";
import { pruefeWebhookZiel, ZielFehler } from "./ziel";

/**
 * Zustellung der Webhooks im Worker.
 *
 * 1. `verteileWebhooks` leert den Ausgangskorb (`webhook_ausgang`, gefüllt vom Trigger auf `aenderung`) in Stücken: Für jeden aktiven Endpunkt
 *    entsteht eine Zeile in `webhook_zustellung`, wenn sein Eigentümer die Änderung heute sehen darf und die Tabelle abonniert ist. Danach
 *    übergibt er alle noch nicht übergebenen Zustellungen (auch Testereignisse aus der API) an pg-boss.
 * 2. `stelleZu` stellt eine Zustellung zu. Rechte, Endpunkt und Ziel werden bei **jedem Versuch** neu geprüft: Wer die Rechte verliert, bekommt
 *    nichts mehr, auch keine Wiederholung. pg-boss wiederholt gescheiterte Versuche mit wachsender Wartezeit (`VERSUCHE`); nach dem letzten gilt
 *    die Zustellung als gescheitert. `ABSCHALTEN_NACH` gescheiterte Zustellungen in Folge schalten den Endpunkt ab.
 *
 * Das Zustellprotokoll enthält nie Nutzdaten, Geheimnis, Signatur, Kopfzeilen oder Antworttexte.
 */

export const WEBHOOK_ZUSTELLUNG = "webhook-zustellung";
/** Versuche je Zustellung (erster plus Wiederholungen). */
export const VERSUCHE = 8;
/** Gescheiterte Zustellungen in Folge, nach denen ein Endpunkt abgeschaltet wird. */
export const ABSCHALTEN_NACH = 5;
/** Zeitlimit je Versuch. */
export const ZEITLIMIT_MS = 10_000;
/** Aufbewahrung des Zustellprotokolls. */
export const AUFBEWAHRUNG_TAGE = 30;

/** Einstellungen der Warteschlange (pg-boss): Wartezeit 30 s, verdoppelt, höchstens eine Stunde. */
export const WARTESCHLANGE = { retryLimit: VERSUCHE - 1, retryDelay: 30, retryBackoff: true, retryDelayMax: 3600, expireInSeconds: 120 } as const;

export interface ZustellJob {
  zustellungId: string;
}

const STUECK = 500;

export const geheimnisAad = (webhookId: string) => `webhook:${webhookId}`;

async function schalteAb(tx: Tx, webhookId: string, grund: "too_many_failures" | "owner_inactive") {
  await tx.update(webhook).set({ aktiv: false, deaktiviertAm: new Date(), deaktiviertGrund: grund, geaendertAm: new Date() }).where(and(eq(webhook.id, webhookId), eq(webhook.aktiv, true)));
}

/** Verteilt den Ausgangskorb auf die Endpunkte und übergibt offene Zustellungen an `einreihen`. Gibt die Zahl der übergebenen Zustellungen zurück. */
export async function verteileWebhooks(db: Db, einreihen: (job: ZustellJob) => Promise<unknown>): Promise<number> {
  for (;;) {
    const weiter = await schreibe(db, "system", async (tx) => {
      const { rows } = await tx.execute<{ aenderung_id: string }>(sql`
        DELETE FROM webhook_ausgang WHERE nr IN (SELECT nr FROM webhook_ausgang ORDER BY nr LIMIT ${STUECK} FOR UPDATE SKIP LOCKED)
        RETURNING aenderung_id`);
      if (rows.length === 0) return false;
      const ids = rows.map((r) => r.aenderung_id);
      const endpunkte = await tx.select({ id: webhook.id, benutzerId: webhook.benutzerId, apiSchluesselId: webhook.apiSchluesselId, tabellen: webhook.tabellen }).from(webhook).where(eq(webhook.aktiv, true));
      for (const w of endpunkte) {
        const fonds = await eigentuemerFonds(tx, w);
        if (fonds === null) {
          await schalteAb(tx, w.id, "owner_inactive");
          continue;
        }
        const ereignisse = await ladeSichtbareEreignisse(tx, ids, fonds, w.tabellen);
        if (ereignisse.length > 0) await tx.insert(webhookZustellung).values(ereignisse.map((e) => ({ webhookId: w.id, aenderungId: e.id })));
      }
      return rows.length === STUECK;
    });
    if (!weiter) break;
  }
  let anzahl = 0;
  for (;;) {
    const stueck = await schreibe(db, "system", async (tx) => {
      const { rows } = await tx.execute<{ id: string }>(sql`
        UPDATE webhook_zustellung SET eingereiht_am = now()
        WHERE id IN (SELECT id FROM webhook_zustellung WHERE eingereiht_am IS NULL ORDER BY erstellt_am, id LIMIT ${STUECK} FOR UPDATE SKIP LOCKED)
        RETURNING id`);
      // Bricht `einreihen` ab, rollt die Transaktion zurück und die Zustellungen bleiben offen (nächster Takt). Doppelt eingereihte Jobs sind harmlos:
      // `stelleZu` stellt nur Zustellungen im Status `pending` zu.
      for (const r of rows) await einreihen({ zustellungId: r.id });
      return rows.length;
    });
    anzahl += stueck;
    if (stueck < STUECK) break;
  }
  return anzahl;
}

export interface ZustellOptionen {
  ring: Schluesselring | undefined;
  sender?: Sender;
  aufloeser?: Aufloeser;
  privateErlaubt?: boolean;
  /** Letzter Versuch dieser Zustellung: Ein Fehlschlag wird endgültig. */
  letzterVersuch: boolean;
}

export type ZustellErgebnis = "delivered" | "retry" | "failed" | "skipped" | "unknown";

/** Fehlercode eines Versuchs (nur Codes, nie Texte der Gegenseite). */
function fehlerCode(fehler: unknown): string {
  if (fehler instanceof ZielFehler) return fehler.code;
  const name = (fehler as { name?: unknown })?.name;
  if (name === "AbortError" || name === "TimeoutError") return "timeout";
  const code = (fehler as { code?: unknown })?.code;
  if (typeof code === "string" && /^(CERT_|ERR_TLS|UNABLE_TO|DEPTH_ZERO|SELF_SIGNED|ERR_SSL)/.test(code)) return "tls_failed";
  return "connection_failed";
}

/** Rumpf einer Nachricht: Kennung des Ereignisses, Art, Zeitpunkt der Nachricht, Endpunkt und das Ereignis wie in der Änderungsabfrage. */
export function nachricht(art: "change" | "ping", id: string, webhookId: string, daten: Ereignis | { message: string }): string {
  return JSON.stringify({ id, type: art, createdAt: new Date().toISOString(), webhookId, data: daten });
}

/** Stellt eine Zustellung zu (ein Versuch). `retry`: der Worker wirft, damit pg-boss wiederholt. */
export async function stelleZu(db: Db, zustellungId: string, opt: ZustellOptionen): Promise<ZustellErgebnis> {
  const vorbereitet = await lese(db, async (tx) => {
    const [z] = await tx.select({ zustellung: webhookZustellung, webhook }).from(webhookZustellung).innerJoin(webhook, eq(webhook.id, webhookZustellung.webhookId)).where(eq(webhookZustellung.id, zustellungId));
    if (!z || z.zustellung.status !== "pending") return { art: "fertig" as const };
    if (!z.webhook.aktiv) return { art: "auslassen" as const, grund: "webhook_inactive", z };
    const fonds = await eigentuemerFonds(tx, z.webhook);
    if (fonds === null) return { art: "auslassen" as const, grund: "owner_inactive", z };
    if (z.zustellung.art === "ping") return { art: "senden" as const, z, rumpf: nachricht("ping", z.zustellung.id, z.webhook.id, { message: "Test event from Carraway." }) };
    const [ereignis] = await ladeSichtbareEreignisse(tx, [z.zustellung.aenderungId!], fonds, z.webhook.tabellen);
    if (!ereignis) return { art: "auslassen" as const, grund: "not_visible", z };
    return { art: "senden" as const, z, rumpf: nachricht("change", ereignis.id, z.webhook.id, ereignis) };
  });
  if (vorbereitet.art === "fertig") return "unknown";
  const { z } = vorbereitet;
  if (vorbereitet.art === "auslassen") {
    await schreibe(db, "system", async (tx) => {
      await tx.update(webhookZustellung).set({ status: "skipped", fehler: vorbereitet.grund }).where(and(eq(webhookZustellung.id, zustellungId), eq(webhookZustellung.status, "pending")));
      if (vorbereitet.grund === "owner_inactive") await schalteAb(tx, z.webhook.id, "owner_inactive");
    });
    return "skipped";
  }

  const start = performance.now();
  let httpStatus: number | null = null;
  let fehler: string | null = null;
  try {
    if (!opt.ring) throw Object.assign(new Error("secret_unavailable"), { code: "secret_unavailable" });
    let geheimnis: string;
    try {
      geheimnis = opt.ring.entschluessele(z.webhook.geheimnisVerschluesselt, geheimnisAad(z.webhook.id));
    } catch {
      throw Object.assign(new Error("secret_unavailable"), { code: "secret_unavailable" });
    }
    const ziel = await pruefeWebhookZiel(z.webhook.url, { aufloeser: opt.aufloeser, privateErlaubt: opt.privateErlaubt });
    const zeitstempel = Math.floor(Date.now() / 1000);
    const ereignisId = (JSON.parse(vorbereitet.rumpf) as { id: string }).id;
    const antwort = await (opt.sender ?? echterSender)({
      url: ziel.url,
      ip: ziel.ip,
      rumpf: vorbereitet.rumpf,
      zeitlimitMs: ZEITLIMIT_MS,
      kopf: {
        "content-type": "application/json",
        "user-agent": "Carraway-Webhooks/1",
        "carraway-signature": signiere(geheimnis, zeitstempel, vorbereitet.rumpf),
        "carraway-event-id": ereignisId,
        "carraway-delivery-id": z.zustellung.id,
        "carraway-webhook-id": z.webhook.id,
      },
    });
    httpStatus = antwort.status;
    if (antwort.status >= 300 && antwort.status < 400) fehler = "redirect_not_followed";
    else if (antwort.status < 200 || antwort.status >= 300) fehler = "http_status";
  } catch (e) {
    fehler = (e as { code?: unknown })?.code === "secret_unavailable" ? "secret_unavailable" : fehlerCode(e);
  }
  const dauerMs = Math.round(performance.now() - start);
  const zugestellt = fehler === null;
  const endgueltig = !zugestellt && opt.letzterVersuch;
  await schreibe(db, "system", async (tx) => {
    await tx
      .update(webhookZustellung)
      .set({
        versuche: sql`${webhookZustellung.versuche} + 1`,
        letzterVersuchAm: new Date(),
        httpStatus,
        fehler,
        dauerMs,
        ...(zugestellt ? { status: "delivered", zugestelltAm: new Date() } : endgueltig ? { status: "failed" } : {}),
      })
      .where(and(eq(webhookZustellung.id, zustellungId), eq(webhookZustellung.status, "pending")));
    if (zugestellt) await tx.update(webhook).set({ fehlerInFolge: 0 }).where(eq(webhook.id, z.webhook.id));
    if (endgueltig) {
      const [w] = await tx.update(webhook).set({ fehlerInFolge: sql`${webhook.fehlerInFolge} + 1` }).where(eq(webhook.id, z.webhook.id)).returning({ fehlerInFolge: webhook.fehlerInFolge });
      if (w && w.fehlerInFolge >= ABSCHALTEN_NACH) await schalteAb(tx, z.webhook.id, "too_many_failures");
    }
  });
  return zugestellt ? "delivered" : endgueltig ? "failed" : "retry";
}

/** Löscht Zeilen des Zustellprotokolls, die älter als `AUFBEWAHRUNG_TAGE` sind (außer offenen). */
export async function raeumeZustellungenAuf(db: Db): Promise<number> {
  return schreibe(db, "system", async (tx) => {
    const geloescht = await tx
      .delete(webhookZustellung)
      .where(and(sql`${webhookZustellung.erstelltAm} < now() - make_interval(days => ${AUFBEWAHRUNG_TAGE})`, sql`${webhookZustellung.status} <> 'pending'`))
      .returning({ id: webhookZustellung.id });
    return geloescht.length;
  });
}
