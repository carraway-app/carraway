import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { erstelleApp } from "../app";
import { leseBetriebszustand, richteHerzschlagEin, schreibeHerzschlag } from "../beobachtung/betrieb";
import { Metriken } from "../beobachtung/metriken";
import { erstelleLogger, fehlerFelder } from "../beobachtung/protokoll";
import { datenbankUrl, ladeKonfiguration, KonfigurationsFehler } from "../konfiguration";
import { json, oeffneTestdb } from "./hilfen";

const { db, pool } = oeffneTestdb();
const TOKEN = "metriken-token-nur-fuer-tests-0123456789";

const zeilenLogger = () => {
  const zeilen: Record<string, unknown>[] = [];
  return { zeilen, logger: erstelleLogger("api", { ausgabe: (z) => zeilen.push(JSON.parse(z)) }) };
};

beforeAll(async () => {
  await db.execute(sql`CREATE SCHEMA IF NOT EXISTS pgboss`);
  await db.execute(sql`DROP TABLE IF EXISTS pgboss.carraway_herzschlag`);
});
afterAll(async () => {
  await db.execute(sql`DROP TABLE IF EXISTS pgboss.carraway_herzschlag`);
  await pool.end();
});

describe("Konfiguration für den Betrieb", () => {
  it("METRIKEN_TOKEN braucht mindestens 24 Zeichen, ohne Token bleibt der Endpunkt aus", () => {
    expect(() => ladeKonfiguration({ METRIKEN_TOKEN: "kurz" })).toThrow(KonfigurationsFehler);
    expect(ladeKonfiguration({ METRIKEN_TOKEN: TOKEN }).metrikenToken).toBe(TOKEN);
    expect(ladeKonfiguration({}).metrikenToken).toBeUndefined();
  });

  it("bei NODE_ENV=production gibt es nie das öffentliche Entwicklungsgeheimnis, auch nicht hinter localhost", () => {
    const basis = { NODE_ENV: "production", CARRAWAY_UMGEBUNG: "demo", APP_ORIGIN: "http://localhost:8787" };
    expect(() => ladeKonfiguration(basis)).toThrow(/BETTER_AUTH_SECRET/);
    expect(() => ladeKonfiguration({ ...basis, BETTER_AUTH_SECRET: "carraway-nur-lokale-entwicklung-nicht-geheim-0123456789" })).toThrow(/BETTER_AUTH_SECRET/);
    expect(ladeKonfiguration({ ...basis, BETTER_AUTH_SECRET: "x".repeat(40) }).geheimnis).toHaveLength(40);
  });

  it("DATABASE_URL hat nur außerhalb der Produktion eine lokale Vorgabe", () => {
    expect(datenbankUrl({})).toContain("localhost");
    expect(() => datenbankUrl({ NODE_ENV: "production" })).toThrow(/DATABASE_URL/);
    expect(datenbankUrl({ NODE_ENV: "production", DATABASE_URL: "postgres://a@b/c" })).toBe("postgres://a@b/c");
  });

  it("die Oberfläche wird nur mit WEB_AUSLIEFERN=1 ausgeliefert", () => {
    expect(ladeKonfiguration({}).webVerzeichnis).toBeUndefined();
    expect(ladeKonfiguration({ WEB_AUSLIEFERN: "1", WEB_VERZEICHNIS: "/app/web" }).webVerzeichnis).toBe("/app/web");
  });
});

describe("Logs", () => {
  it("Fehler tragen weder Abfrageparameter noch Meldungstext einer Datenbankabfrage", async () => {
    const geheim = "geheim.person@example.org";
    const fehler = await db.execute(sql`SELECT ${geheim}::integer`).catch((e: unknown) => e);
    expect(fehler).toBeInstanceOf(Error);
    const felder = JSON.stringify(fehlerFelder(fehler));
    expect(felder).not.toContain("geheim");
    expect(felder).toContain("pgCode");
    expect(felder).toContain("Datenbankabfrage fehlgeschlagen");
  });

  it("die Zeile je Anfrage nennt Muster, Status, Dauer und Anfrage-ID, aber keine Abfragezeichenfolge", async () => {
    const { zeilen, logger } = zeilenLogger();
    const app = erstelleApp(db, { logger });
    const id = "11111111-2222-3333-4444-555555555555";
    const antwort = await app.request(`/api/v1/funds/${id}/overview?asOf=geheim-wert`, { headers: { "X-Request-Id": "abc-12345678" } });
    expect(antwort.status).toBe(401);
    expect(antwort.headers.get("X-Request-Id")).toBe("abc-12345678");
    const zeile = zeilen.find((z) => z.meldung === "anfrage")!;
    expect(zeile).toMatchObject({ stufe: "info", dienst: "api", methode: "GET", status: 401, anfrageId: "abc-12345678" });
    expect(typeof zeile.dauerMs).toBe("number");
    expect(zeile.route).toBe("/api/v1/funds/:id/overview");
    expect(JSON.stringify(zeile)).not.toContain("geheim-wert");
    expect(JSON.stringify(zeile)).not.toContain(id);
  });

  it("eine auffällige X-Request-Id wird ersetzt, unbekannte Pfade heißen unbekannt", async () => {
    const { zeilen, logger } = zeilenLogger();
    const app = erstelleApp(db, { logger });
    const antwort = await app.request("/gibt-es-nicht-123", { headers: { "X-Request-Id": "<script>alert(1)</script>" } });
    const id = antwort.headers.get("X-Request-Id")!;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(zeilen[0]).toMatchObject({ route: "unbekannt", status: 404, anfrageId: id });
  });
});

describe("Gesundheit mit Worker und Warteschlange", () => {
  it("meldet den Worker als unbekannt, solange nie ein Herzschlag kam, und bleibt trotzdem 200", async () => {
    const antwort = await erstelleApp(db).request("/api/v1/health");
    expect(antwort.status).toBe(200);
    const koerper = await json(antwort);
    expect(koerper).toMatchObject({ ok: true, database: true, worker: { status: "unknown", heartbeatAgeSeconds: null } });
    expect(koerper.queue).toHaveProperty("outbox");
  });

  it("zeigt einen frischen Herzschlag als ok und einen alten als ausgefallen", async () => {
    await richteHerzschlagEin(db);
    await schreibeHerzschlag(db, "worker@test", 3);
    expect((await leseBetriebszustand(db)).worker.status).toBe("ok");
    await db.execute(sql`UPDATE pgboss.carraway_herzschlag SET zeit = now() - interval '2 minutes'`);
    const zustand = await leseBetriebszustand(db);
    expect(zustand.worker.status).toBe("ausgefallen");
    expect(zustand.worker.herzschlagAlterSekunden).toBeGreaterThan(100);
    expect((await erstelleApp(db).request("/api/v1/health")).status).toBe(200);
  });
});

describe("Metriken", () => {
  // Der Ausgangskorb der Neuberechnung ist Zustand der Datenbank: Frühere Testdateien (Aufträge aus Fachaktionen) hinterlassen Zeilen, die der Zähler sonst mitzählt.
  beforeEach(async () => {
    await db.execute(sql`DELETE FROM snapshot_auftrag`);
  });

  it("ohne Token in der Konfiguration gibt es den Endpunkt nicht", async () => {
    expect((await erstelleApp(db, { metrikenToken: undefined }).request("/metriken")).status).toBe(404);
  });

  it("verlangt den Token und liefert das Prometheus-Textformat", async () => {
    const app = erstelleApp(db, { metrikenToken: TOKEN, pool });
    expect((await app.request("/metriken")).status).toBe(401);
    expect((await app.request("/metriken", { headers: { Authorization: "Bearer falsch" } })).status).toBe(401);
    expect((await app.request("/metriken", { headers: { Authorization: TOKEN } })).status).toBe(401);
    await app.request("/api/v1/health");
    const antwort = await app.request("/metriken", { headers: { Authorization: `Bearer ${TOKEN}` } });
    expect(antwort.status).toBe(200);
    expect(antwort.headers.get("Content-Type")).toContain("text/plain; version=0.0.4");
    const text = await antwort.text();
    expect(text).toContain("# TYPE carraway_http_anfrage_dauer_sekunden histogram");
    expect(text).toContain('carraway_http_anfrage_dauer_sekunden_count{methode="GET",route="/api/v1/health",status="2xx"} 1');
    expect(text).toMatch(/carraway_db_pool_verbindungen\{zustand="gesamt"\} \d+/);
    expect(text).toContain("carraway_ausgangskorb_auftraege 0");
    expect(text).toContain("carraway_worker_lebt");
    expect(text).toContain('carraway_http_anfrage_dauer_sekunden_bucket{methode="GET",route="/api/v1/health",status="2xx",le="+Inf"} 1');
  });

  it("Labelwerte werden maskiert und Histogramm-Buckets sind kumulativ", () => {
    const m = new Metriken();
    m.anfrage("GET", 'a"b\\c', 200, 0.004);
    m.anfrage("GET", 'a"b\\c', 200, 0.2);
    const text = m.rendere(undefined, undefined);
    expect(text).toContain('route="a\\"b\\\\c"');
    expect(text).toMatch(/le="0.005"\} 1\n/);
    expect(text).toMatch(/le="0.25"\} 2\n/);
    expect(text).toMatch(/_sum\{[^}]*\} 0.204/);
  });
});

describe("Oberfläche vom selben Ursprung", () => {
  let verzeichnis: string;
  let app: ReturnType<typeof erstelleApp>;

  beforeAll(async () => {
    verzeichnis = await mkdtemp(join(tmpdir(), "carraway-web-"));
    await mkdir(join(verzeichnis, "assets"));
    await writeFile(join(verzeichnis, "index.html"), "<!doctype html><title>Carraway</title>");
    await writeFile(join(verzeichnis, "assets", "app-abc123.js"), "console.log(1)");
    await writeFile(join(verzeichnis, "favicon.svg"), "<svg xmlns='http://www.w3.org/2000/svg'/>");
    app = erstelleApp(db, { webVerzeichnis: verzeichnis });
  });
  afterAll(() => rm(verzeichnis, { recursive: true, force: true }));

  it("index.html ohne Zwischenspeicher, auch unter / und als Rückfall für Deep-Links", async () => {
    for (const pfad of ["/", "/index.html", "/portfolio/fonds/abc", "/anmelden"]) {
      const antwort = await app.request(pfad);
      expect(antwort.status, pfad).toBe(200);
      expect(antwort.headers.get("Content-Type")).toContain("text/html");
      expect(antwort.headers.get("Cache-Control")).toBe("no-cache");
      expect(antwort.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(await antwort.text()).toContain("<title>Carraway</title>");
    }
  });

  it("Dateien mit Hash im Namen gelten ein Jahr, andere eine Stunde; ETag liefert 304", async () => {
    const asset = await app.request("/assets/app-abc123.js");
    expect(asset.status).toBe(200);
    expect(asset.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(asset.headers.get("Content-Type")).toContain("text/javascript");
    const icon = await app.request("/favicon.svg");
    expect(icon.headers.get("Cache-Control")).toBe("public, max-age=3600");
    expect(icon.headers.get("Content-Type")).toBe("image/svg+xml");
    const etag = asset.headers.get("ETag")!;
    const wieder = await app.request("/assets/app-abc123.js", { headers: { "If-None-Match": etag } });
    expect(wieder.status).toBe(304);
  });

  it("HEAD liefert keinen Körper", async () => {
    const antwort = await app.request("/", { method: "HEAD" });
    expect(antwort.status).toBe(200);
    expect(await antwort.text()).toBe("");
  });

  it("fehlende Dateien und fehlende Assets sind 404 als JSON, nie HTML", async () => {
    for (const pfad of ["/assets/gibt-es-nicht.js", "/fehlt.png", "/assets/"]) {
      const antwort = await app.request(pfad);
      expect(antwort.status, pfad).toBe(404);
      expect(antwort.headers.get("Content-Type")).toContain("application/json");
    }
  });

  it("die API und /metriken bleiben unberührt, Pfade aus dem Verzeichnis heraus liefern nichts", async () => {
    const api = await app.request("/api/v1/gibt-es-nicht");
    expect(api.headers.get("Content-Type")).toContain("application/json");
    expect(api.status).toBeGreaterThanOrEqual(401);
    expect((await app.request("/api/v1/health")).status).toBe(200);
    expect((await app.request("/metriken")).status).toBe(404);
    const heraus = await app.request("/..%2f..%2f..%2fetc%2fpasswd");
    expect(await heraus.text()).not.toContain("root:");
    const heraus2 = await app.request("/%2e%2e/%2e%2e/etc/passwd.txt");
    expect(heraus2.status).toBe(404);
  });

  it("ohne WEB_AUSLIEFERN bleibt die API reine API", async () => {
    expect((await erstelleApp(db).request("/")).status).toBe(404);
  });
});
