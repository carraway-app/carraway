import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import type { Pool, PoolClient } from "pg";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import { z } from "zod";
import type { Db } from "@carraway/db";
import { sichtbareFonds, type Akteur } from "../anmeldung/akteur";
import { fehlerFelder, type Logger } from "../beobachtung/protokoll";
import { EREIGNIS_KANAL, idsAusMeldung, ladeSichtbareEreignisse } from "../ereignisse/quelle";
import { FEED_TABELLEN } from "../routen/aenderungen";
import { lese } from "../zeitlimit";
import type { LiveUmgebung } from "./route";

/**
 * Live-Aktualisierung über WebSocket (#161) unter `/api/v1/live`.
 *
 * Aufbau: Die Upgrade-Anfrage läuft durch die App (`GET /live`, Rechteprüfung und Herkunft, `live/route.ts`); nur wenn sie 204 liefert,
 * wird die Verbindung angenommen. Danach abonniert der Client Tabellen der Änderungsabfrage:
 *
 *   → `{"type":"subscribe","tables":["deal","beteiligung"]}` (oder `["*"]` für alle), `{"type":"unsubscribe","tables":[…]}`, `{"type":"ping"}`
 *   ← `{"type":"ready"}`, `{"type":"subscribed","tables":[…]}`, `{"type":"change","data":{…}}` (Ereignis wie in `/changes`), `{"type":"pong"}`,
 *     `{"type":"error","code":"…"}`
 *
 * Quelle sind die NOTIFY-Meldungen des Triggers auf `aenderung` (gemeinsam mit den Webhooks, `ereignisse/quelle.ts`). Jede Meldung wird je
 * Verbindung nach deren Fonds gefiltert (gleiche Sichtbarkeit wie `/changes`); Verbindungen mit gleichen Fonds teilen sich eine Abfrage.
 * Die Rechte werden alle `ERNEUERN_MS` mit den Kopfzeilen des Aufbaus neu ermittelt; endet die Sitzung oder der Schlüssel, schließt die
 * Verbindung. Live ist ein Hinweis, keine lückenlose Zustellung: Nach einem neuen Aufbau holt der Client Verpasstes über `/changes`.
 *
 * Grenzen: Nachrichten des Clients höchstens 4 KiB und `NACHRICHTEN_JE_MINUTE`, höchstens `JE_ZUGANG` Verbindungen je Person bzw. Schlüssel
 * und `GESAMT` je Prozess; ein Client, der nicht mitliest (Puffer über 1 MiB), wird getrennt.
 */

export const LIVE_PFAD = "/api/v1/live";

export interface LiveGrenzen {
  jeZugang: number;
  gesamt: number;
  nachrichtenJeMinute: number;
  erneuernMs: number;
  herzschlagMs: number;
  buendelnMs: number;
}
export const STANDARD_LIVE_GRENZEN: LiveGrenzen = { jeZugang: 5, gesamt: 1000, nachrichtenJeMinute: 60, erneuernMs: 30_000, herzschlagMs: 30_000, buendelnMs: 200 };

const MAX_NACHRICHT = 4096;
const MAX_PUFFER = 1024 * 1024;

const nachrichtSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("subscribe"), tables: z.array(z.string().max(100)).min(1).max(200) }),
  z.object({ type: z.literal("unsubscribe"), tables: z.array(z.string().max(100)).min(1).max(200) }),
  z.object({ type: z.literal("ping") }),
]);

interface Verbindung {
  ws: WebSocket;
  akteur: Akteur;
  fonds: string[] | "alle";
  zugang: string;
  /** Kopfzeilen des Aufbaus, die für die erneute Prüfung nötig sind (nur im Speicher). */
  kopf: Record<string, string>;
  abos: Set<string>;
  nachrichten: number[];
  lebt: boolean;
}

export interface LiveOptionen {
  db: Db;
  pool: Pick<Pool, "connect">;
  /** Die App; ihre Route `GET /live` prüft Anmeldung, Rechte und Herkunft. */
  app: { fetch: (anfrage: Request, umgebung?: unknown) => Response | Promise<Response> };
  logger?: Logger;
  grenzen?: Partial<LiveGrenzen>;
}

const zugangVon = (a: Akteur) => (a.quelle === "schluessel" ? `schluessel:${a.schluesselId}` : `person:${a.id}`);
const fondsVon = (a: Akteur) => sichtbareFonds(a);

function lehneAb(socket: Duplex, status: number, code: string) {
  const text = JSON.stringify({ error: { code, message: code } });
  const grund = { 401: "Unauthorized", 403: "Forbidden", 404: "Not Found", 426: "Upgrade Required", 429: "Too Many Requests", 503: "Service Unavailable" }[status] ?? "Bad Request";
  socket.end(`HTTP/1.1 ${status} ${grund}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(text)}\r\nConnection: close\r\n\r\n${text}`);
}

export class LiveDienst {
  readonly #opt: LiveOptionen;
  readonly #grenzen: LiveGrenzen;
  readonly #wss = new WebSocketServer({ noServer: true, maxPayload: MAX_NACHRICHT, perMessageDeflate: false });
  readonly #verbindungen = new Set<Verbindung>();
  #horcher: PoolClient | null = null;
  #horchenStartet: Promise<void> | null = null;
  #puffer: string[] = [];
  #buendel: NodeJS.Timeout | null = null;
  #takte: NodeJS.Timeout[] = [];
  #beendet = false;

  constructor(opt: LiveOptionen) {
    this.#opt = opt;
    this.#grenzen = { ...STANDARD_LIVE_GRENZEN, ...opt.grenzen };
    this.#takte.push(setInterval(() => void this.#erneuereAlle(), this.#grenzen.erneuernMs));
    this.#takte.push(setInterval(() => this.#herzschlag(), this.#grenzen.herzschlagMs));
    for (const t of this.#takte) t.unref();
  }

  get anzahl(): number {
    return this.#verbindungen.size;
  }

  /** Hängt den Dienst an den HTTP-Server (Upgrade nur unter `LIVE_PFAD`). */
  haengeAn(server: Pick<Server, "on">): void {
    server.on("upgrade", (anfrage: IncomingMessage, socket: Duplex, kopf: Buffer) => {
      void this.#upgrade(anfrage, socket, kopf).catch((fehler) => {
        this.#opt.logger?.("error", "Live: Aufbau fehlgeschlagen", fehlerFelder(fehler));
        if (!socket.destroyed) lehneAb(socket, 503, "internal_error");
      });
    });
  }

  async beende(): Promise<void> {
    this.#beendet = true;
    for (const t of this.#takte) clearInterval(t);
    if (this.#buendel) clearTimeout(this.#buendel);
    for (const v of this.#verbindungen) v.ws.close(1001, "server_shutdown");
    this.#verbindungen.clear();
    this.#horcher?.release();
    this.#horcher = null;
    this.#wss.close();
  }

  /** Prüft die Anfrage über die App (Route `GET /live`); gibt den Akteur oder Status und Code zurück. */
  async #pruefe(kopf: Record<string, string>, anfrage?: IncomingMessage): Promise<{ akteur: Akteur } | { status: number; code: string }> {
    let akteur: Akteur | undefined;
    const umgebung: LiveUmgebung & { incoming?: IncomingMessage } = { carrawayLive: (a) => (akteur = a), ...(anfrage ? { incoming: anfrage } : {}) };
    const antwort = await this.#opt.app.fetch(new Request(`http://live.intern${LIVE_PFAD}`, { method: "GET", headers: kopf }), umgebung);
    if (antwort.status === 204 && akteur) return { akteur };
    const code = await antwort
      .json()
      .then((k: unknown) => (k as { error?: { code?: string } })?.error?.code ?? "forbidden")
      .catch(() => "forbidden");
    return { status: antwort.status, code };
  }

  async #upgrade(anfrage: IncomingMessage, socket: Duplex, erstesStueck: Buffer): Promise<void> {
    const pfad = (anfrage.url ?? "").split("?")[0];
    if (pfad !== LIVE_PFAD) return lehneAb(socket, 404, "not_found");
    if (this.#beendet || this.#verbindungen.size >= this.#grenzen.gesamt) return lehneAb(socket, 503, "live_connection_limit");
    const kopf: Record<string, string> = {};
    for (const name of ["cookie", "authorization", "origin", "upgrade", "x-forwarded-for", "user-agent"]) {
      const wert = anfrage.headers[name];
      if (typeof wert === "string") kopf[name] = wert;
    }
    const ergebnis = await this.#pruefe(kopf, anfrage);
    if (!("akteur" in ergebnis)) return lehneAb(socket, ergebnis.status, ergebnis.code);
    const zugang = zugangVon(ergebnis.akteur);
    if ([...this.#verbindungen].filter((v) => v.zugang === zugang).length >= this.#grenzen.jeZugang) return lehneAb(socket, 429, "live_connection_limit");
    this.#wss.handleUpgrade(anfrage, socket, erstesStueck, (ws) => this.#verbinde(ws, ergebnis.akteur, kopf));
  }

  #verbinde(ws: WebSocket, akteur: Akteur, kopf: Record<string, string>): void {
    const v: Verbindung = { ws, akteur, fonds: fondsVon(akteur), zugang: zugangVon(akteur), kopf, abos: new Set(), nachrichten: [], lebt: true };
    this.#verbindungen.add(v);
    ws.on("message", (daten, binaer) => this.#nachricht(v, daten, binaer));
    ws.on("pong", () => (v.lebt = true));
    ws.on("close", () => this.#verbindungen.delete(v));
    ws.on("error", () => ws.terminate());
    this.#sende(v, { type: "ready" });
    this.#horche().catch((fehler) => this.#opt.logger?.("error", "Live: Horchen nicht gestartet", fehlerFelder(fehler)));
  }

  #sende(v: Verbindung, nachricht: unknown): void {
    if (v.ws.readyState !== v.ws.OPEN) return;
    if (v.ws.bufferedAmount > MAX_PUFFER) {
      v.ws.close(1013, "slow_consumer");
      return;
    }
    v.ws.send(JSON.stringify(nachricht));
  }

  #nachricht(v: Verbindung, daten: RawData, binaer: boolean): void {
    const jetzt = Date.now();
    v.nachrichten = v.nachrichten.filter((t) => t > jetzt - 60_000);
    v.nachrichten.push(jetzt);
    if (v.nachrichten.length > this.#grenzen.nachrichtenJeMinute) {
      v.ws.close(1008, "too_many_requests");
      return;
    }
    let roh: unknown;
    try {
      if (binaer) throw new Error("binär");
      roh = JSON.parse(Buffer.isBuffer(daten) ? daten.toString("utf8") : Buffer.concat(daten as Buffer[]).toString("utf8"));
    } catch {
      return this.#sende(v, { type: "error", code: "invalid_message" });
    }
    const n = nachrichtSchema.safeParse(roh);
    if (!n.success) return this.#sende(v, { type: "error", code: "invalid_message" });
    if (n.data.type === "ping") return this.#sende(v, { type: "pong" });
    const tabellen = n.data.tables.includes("*") ? FEED_TABELLEN : n.data.tables;
    const unbekannt = tabellen.filter((t) => !FEED_TABELLEN.includes(t));
    if (unbekannt.length > 0) return this.#sende(v, { type: "error", code: "invalid_table", tables: unbekannt.slice(0, 10) });
    for (const t of tabellen) {
      if (n.data.type === "subscribe") v.abos.add(t);
      else v.abos.delete(t);
    }
    this.#sende(v, { type: "subscribed", tables: [...v.abos].sort() });
  }

  #herzschlag(): void {
    for (const v of this.#verbindungen) {
      if (!v.lebt) {
        v.ws.terminate();
        this.#verbindungen.delete(v);
        continue;
      }
      v.lebt = false;
      v.ws.ping();
    }
  }

  /** Ermittelt die Rechte aller Verbindungen neu; endet der Zugang, schließt die Verbindung (4401 nicht angemeldet, 4403 keine Rechte). */
  async #erneuereAlle(): Promise<void> {
    for (const v of [...this.#verbindungen]) {
      try {
        const ergebnis = await this.#pruefe(v.kopf);
        if ("akteur" in ergebnis) {
          v.akteur = ergebnis.akteur;
          v.fonds = fondsVon(ergebnis.akteur);
        } else {
          this.#verbindungen.delete(v);
          v.ws.close(ergebnis.status === 401 ? 4401 : 4403, ergebnis.code.slice(0, 100));
        }
      } catch (fehler) {
        this.#opt.logger?.("warn", "Live: Rechte nicht erneuert", fehlerFelder(fehler));
      }
    }
  }

  /** Startet das Horchen auf NOTIFY (einmal, bei der ersten Verbindung); nach einem Fehler neu, solange es Verbindungen gibt. */
  #horche(): Promise<void> {
    if (this.#horcher || this.#beendet) return Promise.resolve();
    this.#horchenStartet ??= (async () => {
      try {
        const client = await this.#opt.pool.connect();
        client.on("notification", (m) => {
          if (m.channel !== EREIGNIS_KANAL || this.#verbindungen.size === 0) return;
          this.#puffer.push(...idsAusMeldung(m.payload));
          this.#buendel ??= setTimeout(() => void this.#verteile(), this.#grenzen.buendelnMs);
        });
        client.on("error", (fehler) => {
          this.#opt.logger?.("warn", "Live: Verbindung zur Datenbank verloren", fehlerFelder(fehler));
          client.release(true);
          this.#horcher = null;
          setTimeout(() => {
            if (this.#verbindungen.size > 0) this.#horche().catch(() => undefined);
          }, 5000).unref();
        });
        await client.query(`LISTEN ${EREIGNIS_KANAL}`);
        this.#horcher = client;
      } finally {
        this.#horchenStartet = null;
      }
    })();
    return this.#horchenStartet;
  }

  /** Wartet, bis das Horchen läuft (Tests). */
  async bereit(): Promise<void> {
    await this.#horche();
  }

  async #verteile(): Promise<void> {
    this.#buendel = null;
    const ids = [...new Set(this.#puffer.splice(0, this.#puffer.length))];
    const gruppen = new Map<string, { fonds: string[] | "alle"; verbindungen: Verbindung[]; tabellen: Set<string> }>();
    for (const v of this.#verbindungen) {
      if (v.abos.size === 0) continue;
      const schluessel = v.fonds === "alle" ? "alle" : [...v.fonds].sort().join(",");
      const g = gruppen.get(schluessel) ?? { fonds: v.fonds, verbindungen: [], tabellen: new Set<string>() };
      g.verbindungen.push(v);
      for (const t of v.abos) g.tabellen.add(t);
      gruppen.set(schluessel, g);
    }
    for (const g of gruppen.values()) {
      try {
        const ereignisse = await lese(this.#opt.db, (tx) => ladeSichtbareEreignisse(tx, ids, g.fonds, [...g.tabellen]));
        for (const e of ereignisse) for (const v of g.verbindungen) if (v.abos.has(e.table)) this.#sende(v, { type: "change", data: e });
      } catch (fehler) {
        this.#opt.logger?.("error", "Live: Verteilen fehlgeschlagen", fehlerFelder(fehler));
      }
    }
  }
}
