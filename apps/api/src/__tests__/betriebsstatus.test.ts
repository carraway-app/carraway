import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DateiSpeicher } from "../berichte/speicher";
import { leseBetriebszustand, richteHerzschlagEin, schreibeHerzschlag } from "../beobachtung/betrieb";
import { Metriken } from "../beobachtung/metriken";
import { speicherBeschreibbar } from "../routen/betrieb";
import { json, leeren, oeffneTestdb } from "./hilfen";
import { erstelleTestApp, legePersonAn, person, type TestApp } from "./hilfen-auth";

/** Betriebsstatus für globale Verwalter (Verwaltung → Betrieb) und die Rückstände in den Metriken. Alle Daten sind erfunden. */

const { db, pool } = oeffneTestdb();
const ADMIN = person("betr-admin", { globalVerwalter: true });
const NORMAL = person("betr-normal");
let verzeichnis = "";
let t: TestApp;

beforeAll(async () => {
  await db.execute(sql`CREATE SCHEMA IF NOT EXISTS pgboss`);
  await db.execute(sql`DROP TABLE IF EXISTS pgboss.carraway_herzschlag`);
  verzeichnis = await mkdtemp(join(tmpdir(), "carraway-betrieb-"));
  t = erstelleTestApp(db, { speicher: new DateiSpeicher(verzeichnis) });
});
beforeEach(async () => {
  await leeren(db);
  await db.execute(sql`DROP TABLE IF EXISTS pgboss.carraway_herzschlag`);
  for (const p of [ADMIN, NORMAL]) await legePersonAn(db, p);
});
afterAll(async () => {
  await db.execute(sql`DROP TABLE IF EXISTS pgboss.carraway_herzschlag`);
  await leeren(db);
  await pool.end();
  await chmod(verzeichnis, 0o755).catch(() => undefined);
  await rm(verzeichnis, { recursive: true, force: true });
});

describe("GET /operations/status", () => {
  it("verlangt Anmeldung und globale Verwaltung", async () => {
    expect((await t.request("/operations/status", { als: null })).status).toBe(401);
    expect((await t.request("/operations/status", { als: NORMAL })).status).toBe(403);
  });

  it("meldet ohne Worker eine Warnung und sonst alles in Ordnung", async () => {
    const antwort = await t.request("/operations/status", { als: ADMIN });
    expect(antwort.status).toBe(200);
    const k = await json(antwort);
    expect(k.database).toEqual({ reachable: true });
    expect(k.migrations).toMatchObject({ ok: true, message: null });
    expect(k.migrations.applied).toBe(k.migrations.known);
    expect(k.worker).toMatchObject({ status: "unknown", heartbeatAgeSeconds: null, thresholdSeconds: 30 });
    expect(k.storage).toEqual({ writable: true });
    expect(k.smtp).toEqual({ configured: false });
    // Angaben der Erweiterungen (z. B. KI-Anbieter) gibt es nur im Build „Voll“; der Kern allein meldet keine.
    expect(k.extensions).toEqual({});
    expect(k.backlogs.mail).toEqual({ count: 0, oldestSeconds: 0 });
    expect(k.backlogs.extraction).toEqual({ count: 0, oldestSeconds: 0 });
    expect(k.backlogs.snapshots).toEqual({ count: 0, oldestSeconds: 0 });
    expect(k.status).toBe("warning");

    await richteHerzschlagEin(db);
    await schreibeHerzschlag(db, "worker@test", 1);
    const mitWorker = await json(await t.request("/operations/status", { als: ADMIN }));
    expect(mitWorker.worker.status).toBe("ok");
    expect(mitWorker.status).toBe("ok");
  });

  it("zeigt Rückstände mit Anzahl und Alter und warnt bei altem Verzug", async () => {
    await richteHerzschlagEin(db);
    await schreibeHerzschlag(db, "worker@test", 1);
    await db.execute(sql`INSERT INTO mail_auftrag (empfaenger, vorlage, betreff, erstellt_von, status, naechster_versuch_am) VALUES
      ('a@example.org', 'v', 'b', 'system', 'wartend', now() - interval '10 minutes'),
      ('b@example.org', 'v', 'b', 'system', 'wartend', now() + interval '1 hour'),
      ('c@example.org', 'v', 'b', 'system', 'gesendet', now() - interval '1 day')`);
    const k = await json(await t.request("/operations/status", { als: ADMIN }));
    // Fällig ist nur die erste Mail; die zweite wartet auf den nächsten Versuch, die dritte ist gesendet.
    expect(k.backlogs.mail.count).toBe(1);
    expect(k.backlogs.mail.oldestSeconds).toBeGreaterThan(590);
    expect(k.status).toBe("warning");
  });

  it("meldet eine nicht beschreibbare Ablage als Fehler", async () => {
    await richteHerzschlagEin(db);
    await schreibeHerzschlag(db, "worker@test", 1);
    await chmod(verzeichnis, 0o555);
    try {
      // Als Superuser (CI-Container) bleibt das Verzeichnis beschreibbar; dann gilt nur die Untersuchung der Probe selbst.
      const beschreibbar = await speicherBeschreibbar(new DateiSpeicher(verzeichnis));
      const k = await json(await t.request("/operations/status", { als: ADMIN }));
      expect(k.storage.writable).toBe(beschreibbar);
      if (!beschreibbar) expect(k.status).toBe("error");
    } finally {
      await chmod(verzeichnis, 0o755);
    }
    expect(await speicherBeschreibbar({ schreibe: () => Promise.reject(new Error("voll")), lese: () => Promise.reject(new Error("x")) })).toBe(false);
  });

  it("enthält keine Zugangsdaten und keine Adressen", async () => {
    const text = await (await t.request("/operations/status", { als: ADMIN })).text();
    expect(text).not.toMatch(/postgres:\/\/|password|passwort|secret/i);
  });
});

describe("Rückstände in den Metriken", () => {
  it("rendert Anzahl und Verzug je Warteschlange und das Alter des Herzschlags", async () => {
    await richteHerzschlagEin(db);
    await schreibeHerzschlag(db, "worker@test", 1);
    await db.execute(sql`INSERT INTO mail_auftrag (empfaenger, vorlage, betreff, erstellt_von, status, naechster_versuch_am) VALUES ('a@example.org', 'v', 'b', 'system', 'wartend', now() - interval '1 minute')`);
    const text = new Metriken().rendere(undefined, await leseBetriebszustand(db));
    expect(text).toContain("carraway_rueckstand_mail_auftraege 1");
    expect(text).toMatch(/carraway_rueckstand_mail_verzug_sekunden (5\d|6\d)/);
    expect(text).toContain("carraway_rueckstand_auslesung_auftraege 0");
    expect(text).toMatch(/carraway_worker_herzschlag_alter_sekunden \d/);
  });
});
