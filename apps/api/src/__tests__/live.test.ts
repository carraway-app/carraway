import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { serve } from "@hono/node-server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import * as s from "@carraway/db";
import { erzeugeSchluessel } from "../anmeldung/akteur";
import { LiveDienst } from "../live/dienst";
import { json, leeren, oeffneTestdb } from "./hilfen";
import { erstelleTestApp, idVon, legePersonAn, meldeAn, person, TESTORIGIN } from "./hilfen-auth";

/**
 * Live-Aktualisierung über WebSocket (#161): Aufbau nur nach Rechteprüfung und mit erlaubter Herkunft, Abonnements je Tabelle, nur Änderungen
 * an sichtbaren Fonds, Begrenzung je Zugang, Trennung, wenn die Anmeldung endet.
 */

const { db, pool } = oeffneTestdb();
const t = erstelleTestApp(db);

const FONDS_A = randomUUID();
const FONDS_B = randomUUID();
const anna = person("live-anna", { rollen: { [FONDS_A]: "betrachter" } });

let server: Server;
let live: LiveDienst;
let adresse: string;
let annaCookie: string;

beforeAll(async () => {
  await leeren(db);
  await db.insert(s.fonds).values([
    { id: FONDS_A, name: "Fonds A", kurzname: "LV-A", vintage: 2024, zeichnungskapital: "1000000.00" },
    { id: FONDS_B, name: "Fonds B", kurzname: "LV-B", vintage: 2024, zeichnungskapital: "1000000.00" },
  ]);
  await legePersonAn(db, anna);
  annaCookie = await meldeAn(t.app, anna);
  server = serve({ fetch: t.app.fetch, port: 0, hostname: "127.0.0.1" }) as Server;
  await new Promise<void>((r) => (server.listening ? r() : server.once("listening", () => r())));
  live = new LiveDienst({ db, pool, app: t.app, grenzen: { jeZugang: 2, erneuernMs: 300, buendelnMs: 20 } });
  live.haengeAn(server);
  adresse = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/live`;
});

beforeEach(async () => {
  await db.update(s.benutzer).set({ aktiv: true }).where(eq(s.benutzer.id, await idVon(db, anna)));
});

afterAll(async () => {
  await live.beende();
  await new Promise((r) => server.close(r));
  await pool.end();
});

interface Client {
  ws: WebSocket;
  nachrichten: Record<string, unknown>[];
  warte: (pruefe: (n: Record<string, unknown>) => boolean, ms?: number) => Promise<Record<string, unknown>>;
  geschlossen: Promise<{ code: number; grund: string }>;
}

/** Baut eine Verbindung auf; lehnt der Server ab, wird mit dem HTTP-Status abgelehnt. */
function verbinde(kopf: Record<string, string>): Promise<Client> {
  return new Promise((aufloesen, ablehnen) => {
    const ws = new WebSocket(adresse, { headers: kopf });
    const nachrichten: Record<string, unknown>[] = [];
    const wartende: { pruefe: (n: Record<string, unknown>) => boolean; fertig: (n: Record<string, unknown>) => void }[] = [];
    ws.on("message", (d) => {
      const n = JSON.parse(String(d)) as Record<string, unknown>;
      nachrichten.push(n);
      for (const w of [...wartende]) {
        if (!w.pruefe(n)) continue;
        wartende.splice(wartende.indexOf(w), 1);
        w.fertig(n);
      }
    });
    const geschlossen = new Promise<{ code: number; grund: string }>((r) => ws.on("close", (code, grund) => r({ code, grund: String(grund) })));
    ws.on("unexpected-response", (_anfrage, antwort) => ablehnen(Object.assign(new Error("abgelehnt"), { status: antwort.statusCode })));
    ws.on("error", (e) => ablehnen(e));
    ws.on("open", () =>
      aufloesen({
        ws,
        nachrichten,
        geschlossen,
        warte: (pruefe, ms = 3000) =>
          new Promise((r, f) => {
            const schon = nachrichten.find(pruefe);
            if (schon) return r(schon);
            const zeit = setTimeout(() => f(new Error(`keine passende Nachricht (bisher: ${JSON.stringify(nachrichten)})`)), ms);
            wartende.push({
              pruefe,
              fertig: (n) => {
                clearTimeout(zeit);
                r(n);
              },
            });
          }),
      }),
    );
  });
}

const annaKopf = () => ({ cookie: annaCookie, origin: TESTORIGIN });

async function aenderung(fondsId: string, tabelle = "beteiligung"): Promise<string> {
  const [z] = await db.insert(s.aenderung).values({ akteur: "system", aktion: "anlegen", tabelle, datensatzId: randomUUID(), fondsId, nachher: { fondsId } }).returning({ id: s.aenderung.id });
  return z!.id;
}

describe("Aufbau", () => {
  it("braucht Anmeldung, erlaubte Herkunft und WebSocket", async () => {
    expect(await verbinde({ origin: TESTORIGIN }).catch((e: { status: number }) => e.status)).toBe(401);
    expect(await verbinde({ cookie: annaCookie, origin: "https://fremd.example" }).catch((e: { status: number }) => e.status)).toBe(403);
    expect(await verbinde({ cookie: annaCookie }).catch((e: { status: number }) => e.status)).toBe(403); // Cookie ohne Herkunft
    const http = await t.app.request("/api/v1/live", { headers: annaKopf() });
    expect(http.status).toBe(426);
    expect((await json(http)).error.code).toBe("upgrade_required");
  });

  it("nimmt API-Schlüssel ohne Herkunft an, aber nie in der Adresse", async () => {
    const schluessel = erzeugeSchluessel();
    const [technisch] = await db.insert(s.benutzer).values({ name: "API: Live", email: `schluessel-${randomUUID()}@technisch.invalid`, emailVerified: true, technisch: true }).returning();
    await db.insert(s.apiSchluessel).values({ name: "Live", benutzerId: technisch!.id, scopes: [{ fondsId: FONDS_B, recht: "lesen" }], ablauf: new Date(Date.now() + 86_400_000), hash: schluessel.hash, vorschau: schluessel.vorschau, erstelltVon: "test" });
    const c = await verbinde({ authorization: `Bearer ${schluessel.klartext}` });
    await c.warte((n) => n.type === "ready");
    c.ws.close();
    await c.geschlossen;
    const inAdresse = await new Promise<number>((r) => {
      const ws = new WebSocket(`${adresse}?token=${schluessel.klartext}`);
      ws.on("unexpected-response", (_a, antwort) => r(antwort.statusCode ?? 0));
      ws.on("error", () => r(0));
    });
    expect(inAdresse).toBe(401);
  });

  it("begrenzt die Verbindungen je Zugang", async () => {
    const a = await verbinde(annaKopf());
    const b = await verbinde(annaKopf());
    expect(await verbinde(annaKopf()).catch((e: { status: number }) => e.status)).toBe(429);
    a.ws.close();
    b.ws.close();
    await Promise.all([a.geschlossen, b.geschlossen]);
  });
});

describe("Abonnements", () => {
  it("liefert nur abonnierte Tabellen sichtbarer Fonds", async () => {
    const c = await verbinde(annaKopf());
    await c.warte((n) => n.type === "ready");
    c.ws.send(JSON.stringify({ type: "subscribe", tables: ["beteiligung", "nicht_da"] }));
    expect(await c.warte((n) => n.type === "error")).toMatchObject({ code: "invalid_table", tables: ["nicht_da"] });
    c.ws.send(JSON.stringify({ type: "subscribe", tables: ["beteiligung"] }));
    expect(await c.warte((n) => n.type === "subscribed")).toMatchObject({ tables: ["beteiligung"] });
    await live.bereit();

    const fremd = await aenderung(FONDS_B);
    const andereTabelle = await aenderung(FONDS_A, "vorgang");
    const eigen = await aenderung(FONDS_A);
    const ereignis = await c.warte((n) => n.type === "change");
    expect(ereignis).toMatchObject({ data: { id: eigen, table: "beteiligung", fundId: FONDS_A } });
    // Ein weiteres Ereignis als Marke: alles davor ist verteilt.
    const marke = await aenderung(FONDS_A);
    await c.warte((n) => n.type === "change" && (n.data as { id: string }).id === marke);
    const ids = c.nachrichten.filter((n) => n.type === "change").map((n) => (n.data as { id: string }).id);
    expect(ids).not.toContain(fremd);
    expect(ids).not.toContain(andereTabelle);

    c.ws.send("kein json");
    expect(await c.warte((n) => n.type === "error" && n.code === "invalid_message")).toBeTruthy();
    c.ws.close();
    await c.geschlossen;
  });

  it("trennt, wenn die Anmeldung endet", async () => {
    const c = await verbinde(annaKopf());
    await c.warte((n) => n.type === "ready");
    await db.update(s.benutzer).set({ aktiv: false }).where(eq(s.benutzer.id, await idVon(db, anna)));
    const ende = await c.geschlossen;
    expect(ende.code).toBe(4401);
  });
});
