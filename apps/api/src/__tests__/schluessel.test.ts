import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { json, leeren, oeffneTestdb } from "./hilfen";
import { grundbestand, ID, protokollZeilen } from "./hilfen-instrumente";
import { erstelleTestApp, legePersonAn, person, STANDARD, TESTORIGIN, type Testperson } from "./hilfen-auth";

const { db, pool } = oeffneTestdb();
const t = erstelleTestApp(db);

const F1 = ID.fonds;
const F2 = ID.anderer;
const LAUF_F1 = "00000000-0000-4000-8000-0000000000e1";
const verwalterF1 = person("verwalter-f1", { rollen: { [F1]: "verwalter" } });

beforeEach(async () => {
  await grundbestand(db);
  await db.insert(s.zinslauf).values({ id: LAUF_F1, fondsId: F1, stichtag: "2026-12-31", berechnetVon: "x" });
  await db.execute(sql`DELETE FROM snapshot_auftrag`);
  await legePersonAn(db, verwalterF1);
});
afterAll(async () => {
  await leeren(db);
  await db.execute(sql`DELETE FROM api_schluessel`);
  await db.execute(sql`DELETE FROM benutzer WHERE technisch`);
  await pool.end();
});

const anfrage = (methode: string, pfad: string, als: Testperson | null, body?: unknown) =>
  t.request(pfad, { method: methode, als, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

/** Aufruf nur mit Schlüssel: kein Cookie, kein Origin, wie ein Skript oder eine Schnittstelle. */
const mitSchluessel = (schluessel: string, methode: string, pfad: string, body?: unknown, kopf: Record<string, string> = {}) =>
  t.app.request(`/api/v1${pfad}`, {
    method: methode,
    headers: { authorization: `Bearer ${schluessel}`, ...(body === undefined ? {} : { "content-type": "application/json" }), ...kopf },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const neuerSchluessel = async (scopes: { fundId: string; permission: "read" | "write" }[], zusatz: object = {}) => {
  const antwort = await anfrage("POST", "/api-keys", STANDARD, { name: "Importjob", scopes, ...zusatz });
  expect(antwort.status).toBe(201);
  return (await json(antwort)) as { id: string; key: string; userId: string; expiresAt: string; preview: string; scopes: unknown[] };
};

describe("Anlegen, Anzeigen, Widerrufen", () => {
  it("der Schlüssel erscheint genau einmal; in der Datenbank liegt nur der SHA-256-Hash", async () => {
    const neu = await neuerSchluessel([{ fundId: F1, permission: "read" }]);
    expect(neu.key).toMatch(/^cwk_[A-Za-z0-9_-]{43}$/);
    expect(neu.preview).toBe(neu.key.slice(0, 10));
    const [zeile] = await db.select().from(s.apiSchluessel);
    expect(zeile!.hash).toBe(createHash("sha256").update(neu.key).digest("hex"));
    expect(JSON.stringify(zeile)).not.toContain(neu.key);

    const liste = await json(await anfrage("GET", "/api-keys", STANDARD));
    expect(liste.data).toHaveLength(1);
    expect(liste.data[0]).toMatchObject({ id: neu.id, name: "Importjob", status: "active", scopes: [{ fundId: F1, permission: "read" }], lastUsedAt: null });
    expect(JSON.stringify(liste)).not.toContain(neu.key);
    expect(JSON.stringify(liste)).not.toContain(zeile!.hash);
    const protokoll = await protokollZeilen(db, "api_schluessel", "anlegen");
    expect(JSON.stringify(protokoll)).not.toContain(neu.key);
    expect(JSON.stringify(protokoll)).not.toContain(zeile!.hash);
  });

  it("jeder Schlüssel bekommt einen eigenen technischen Benutzer", async () => {
    const a = await neuerSchluessel([{ fundId: F1, permission: "read" }]);
    const b = await neuerSchluessel([{ fundId: F1, permission: "read" }]);
    expect(a.userId).not.toBe(b.userId);
    const [benutzer] = await db.select().from(s.benutzer).where(sql`${s.benutzer.id} = ${a.userId}`);
    expect(benutzer).toMatchObject({ technisch: true, globalVerwalter: false, name: "API: Importjob" });
    // Mit dem technischen Benutzer kann man sich nicht anmelden (kein Passwort-Konto).
    const anmeldung = await t.app.request("/api/v1/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: TESTORIGIN },
      body: JSON.stringify({ email: benutzer!.email, password: "irgendein-Passwort-123" }), // gitleaks:allow
    });
    expect(anmeldung.status).toBe(401);
  });

  it("nur globale Verwalter verwalten Schlüssel; Eingaben werden geprüft", async () => {
    expect((await anfrage("POST", "/api-keys", verwalterF1, { name: "X", scopes: [{ fundId: F1, permission: "read" }] })).status).toBe(403);
    expect((await anfrage("GET", "/api-keys", verwalterF1)).status).toBe(403);
    for (const falsch of [
      { name: "X", scopes: [] },
      { name: "", scopes: [{ fundId: F1, permission: "read" }] },
      { name: "X", scopes: [{ fundId: F1, permission: "admin" }] },
      { name: "X", scopes: [{ fundId: "keine-uuid", permission: "read" }] },
    ]) {
      expect((await anfrage("POST", "/api-keys", STANDARD, falsch)).status).toBe(400);
    }
    const unbekannt = await anfrage("POST", "/api-keys", STANDARD, { name: "X", scopes: [{ fundId: "00000000-0000-4000-8000-0000000000ff", permission: "read" }] });
    expect(unbekannt.status).toBe(404);
    expect(await db.select().from(s.apiSchluessel)).toHaveLength(0);
  });

  it("Ablauf: Standard 90 Tage, höchstens 365 Tage, nie in der Vergangenheit", async () => {
    const standard = await neuerSchluessel([{ fundId: F1, permission: "read" }]);
    const tage = (new Date(standard.expiresAt).getTime() - Date.now()) / 86_400_000;
    expect(tage).toBeGreaterThan(89.9);
    expect(tage).toBeLessThan(90.1);
    const zuLang = new Date(Date.now() + 400 * 86_400_000).toISOString();
    const vorbei = new Date(Date.now() - 1000).toISOString();
    for (const expiresAt of [zuLang, vorbei]) {
      const antwort = await anfrage("POST", "/api-keys", STANDARD, { name: "X", scopes: [{ fundId: F1, permission: "read" }], expiresAt });
      expect(antwort.status).toBe(400);
      expect((await json(antwort)).error.fields[0].field).toBe("expiresAt");
    }
    const fest = new Date(Date.now() + 30 * 86_400_000).toISOString();
    expect((await neuerSchluessel([{ fundId: F1, permission: "read" }], { expiresAt: fest })).expiresAt).toBe(fest);
  });

  it("Widerruf: der Schlüssel gilt sofort nicht mehr, der Widerruf ist wiederholbar und protokolliert", async () => {
    const neu = await neuerSchluessel([{ fundId: F1, permission: "read" }]);
    expect((await mitSchluessel(neu.key, "GET", `/funds/${F1}/overview`)).status).toBe(200);
    const widerrufen = await anfrage("DELETE", `/api-keys/${neu.id}`, STANDARD);
    expect(widerrufen.status).toBe(200);
    expect((await json(widerrufen)).status).toBe("revoked");
    const nochmal = await anfrage("DELETE", `/api-keys/${neu.id}`, STANDARD);
    expect(nochmal.status).toBe(200);
    const abgelehnt = await mitSchluessel(neu.key, "GET", `/funds/${F1}/overview`);
    expect(abgelehnt.status).toBe(401);
    expect((await json(abgelehnt)).error.code).toBe("not_authenticated");
    expect(await protokollZeilen(db, "api_schluessel", "widerrufen")).toHaveLength(1);
    expect((await anfrage("DELETE", "/api-keys/00000000-0000-4000-8000-0000000000ff", STANDARD)).status).toBe(404);
  });
});

describe("Benutzung des Schlüssels", () => {
  it("lesen: Lesen im eigenen Fonds, nicht schreiben, nichts in fremden Fonds; Liste zeigt nur den eigenen Fonds", async () => {
    const { key: schluessel } = await neuerSchluessel([{ fundId: F1, permission: "read" }]);
    expect((await mitSchluessel(schluessel, "GET", `/funds/${F1}/overview`)).status).toBe(200);
    expect((await mitSchluessel(schluessel, "GET", `/funds/${F2}/overview`)).status).toBe(403);
    const liste = await json(await mitSchluessel(schluessel, "GET", "/funds"));
    expect(liste.data.map((f: { id: string }) => f.id)).toEqual([F1]);
    const schreiben = await mitSchluessel(schluessel, "POST", `/investments/${ID.eigen}/transactions`, { type: "commitment", valueDate: "2025-01-01", amount: "1000" });
    expect(schreiben.status).toBe(403);
    expect((await json(schreiben)).error.code).toBe("forbidden");
    expect((await mitSchluessel(schluessel, "POST", "/organisationen", { name: "Nordwind Technik", art: "unternehmen" })).status).toBe(403);
  });

  it("schreiben: Vorgänge im Scope, nicht in anderen Fonds; Protokoll nennt den technischen Benutzer", async () => {
    const neu = await neuerSchluessel([{ fundId: F1, permission: "write" }]);
    const antwort = await mitSchluessel(neu.key, "POST", `/investments/${ID.eigen}/transactions`, { type: "commitment", valueDate: "2025-01-01", amount: "1000" });
    expect(antwort.status).toBe(201);
    const [zeile] = await protokollZeilen(db, "vorgang", "anlegen");
    expect(zeile).toMatchObject({ akteur: neu.userId, akteur_name: "API: Importjob" });
    await db.insert(s.beteiligung).values({ id: "00000000-0000-4000-8000-0000000000c2", fondsId: F2, organisationId: ID.orgA, instrument: "offene_beteiligung", erstinvestment: "2025-01-01" });
    expect((await mitSchluessel(neu.key, "POST", `/investments/00000000-0000-4000-8000-0000000000c2/transactions`, { type: "commitment", valueDate: "2025-01-01", amount: "1000" })).status).toBe(403);
  });

  it("mehrere Scopes: je Fonds das höchste Recht", async () => {
    const { key: schluessel } = await neuerSchluessel([
      { fundId: F1, permission: "read" },
      { fundId: F2, permission: "write" },
      { fundId: F2, permission: "read" },
    ]);
    expect((await mitSchluessel(schluessel, "POST", `/funds/${F2}/recalculate`)).status).toBe(202);
    expect((await mitSchluessel(schluessel, "POST", `/funds/${F1}/recalculate`)).status).toBe(403);
    expect((await json(await mitSchluessel(schluessel, "GET", "/funds"))).data).toHaveLength(2);
  });

  it("technische Benutzer geben nicht frei: 403 technical_user bei Prüfen, Freigeben, Verwerfen und Buchen, auch mit Schreibscope", async () => {
    const { key: schluessel } = await neuerSchluessel([{ fundId: F1, permission: "write" }]);
    for (const aktion of ["review", "approve", "discard", "post"]) {
      const antwort = await mitSchluessel(schluessel, "POST", `/interest-runs/${LAUF_F1}/${aktion}`, {});
      expect(antwort.status, aktion).toBe(403);
      expect((await json(antwort)).error.code).toBe("technical_user");
    }
    // Ein Mensch mit derselben Berechtigung (Freigeber) darf es.
    const freigeber = person("freigeber-f1", { rollen: { [F1]: "freigeber" } });
    await legePersonAn(db, freigeber);
    expect((await anfrage("POST", `/interest-runs/${LAUF_F1}/review`, freigeber, {})).status).toBe(200);
  });

  it("Benutzerverwaltung, Schlüsselverwaltung und Periodensperre sind für Schlüssel verschlossen", async () => {
    const { key: schluessel } = await neuerSchluessel([{ fundId: F1, permission: "write" }]);
    for (const [methode, pfad] of [
      ["GET", "/users"],
      ["GET", "/api-keys"],
      ["GET", `/funds/${F1}/period-lock`],
      ["GET", `/funds/${F1}/roles`],
    ] as const) {
      expect((await mitSchluessel(schluessel, methode, pfad)).status, pfad).toBe(403);
    }
  });

  it("bereits ausgegebene Schlüssel mit dem alten Präfix fdk_ werden weiter angenommen", async () => {
    await neuerSchluessel([{ fundId: F1, permission: "read" }]);
    const alt = "fdk_" + "a".repeat(43);
    await db.execute(sql`UPDATE api_schluessel SET hash = ${createHash("sha256").update(alt).digest("hex")}`);
    expect((await mitSchluessel(alt, "GET", "/funds")).status).toBe(200);
  });

  it("abgelaufene, unbekannte und falsch geformte Schlüssel: 401", async () => {
    const neu = await neuerSchluessel([{ fundId: F1, permission: "read" }]);
    await db.execute(sql`UPDATE api_schluessel SET ablauf = now() - interval '1 second'`);
    expect((await mitSchluessel(neu.key, "GET", "/funds")).status).toBe(401);
    for (const falsch of ["cwk_unbekannt-unbekannt-unbekannt-unbekannt", "irgendein-token", "cwk_", "x".repeat(60)]) {
      expect((await mitSchluessel(falsch, "GET", "/funds")).status, falsch).toBe(401);
    }
    const ohnePraefix = await t.app.request("/api/v1/funds", { headers: { authorization: neu.key } });
    expect(ohnePraefix.status).toBe(401);
  });

  it("ein gesperrter technischer Benutzer macht den Schlüssel unbrauchbar", async () => {
    const neu = await neuerSchluessel([{ fundId: F1, permission: "read" }]);
    expect((await mitSchluessel(neu.key, "GET", "/funds")).status).toBe(200);
    await db.execute(sql`UPDATE benutzer SET aktiv = false WHERE id = ${neu.userId}`);
    expect((await mitSchluessel(neu.key, "GET", "/funds")).status).toBe(401);
  });

  it("zuletzt_genutzt wird gesetzt; Anfragen mit Schlüssel brauchen keinen Origin, ein fremder Origin wird trotzdem abgelehnt", async () => {
    const neu = await neuerSchluessel([{ fundId: F1, permission: "write" }]);
    expect((await mitSchluessel(neu.key, "POST", `/funds/${F1}/recalculate`)).status).toBe(202);
    expect((await mitSchluessel(neu.key, "POST", `/funds/${F1}/recalculate`, undefined, { origin: "https://boese.example" })).status).toBe(403);
    const [zeile] = await db.select().from(s.apiSchluessel);
    expect(zeile!.zuletztGenutzt).not.toBeNull();
    const liste = await json(await anfrage("GET", "/api-keys", STANDARD));
    expect(liste.data[0].lastUsedAt).not.toBeNull();
  });

  it("ein Schlüssel zusammen mit einem Sitzungscookie zählt als Schlüssel (kein Rechtegewinn durch Mischen)", async () => {
    const { key: schluessel } = await neuerSchluessel([{ fundId: F1, permission: "read" }]);
    const antwort = await t.request("/users", { als: STANDARD, headers: { authorization: `Bearer ${schluessel}` } });
    expect(antwort.status).toBe(403);
  });
});
