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

const neuerSchluessel = async (scopes: { fondsId: string; recht: "lesen" | "schreiben" }[], zusatz: object = {}) => {
  const antwort = await anfrage("POST", "/api-schluessel", STANDARD, { name: "Importjob", scopes, ...zusatz });
  expect(antwort.status).toBe(201);
  return (await json(antwort)) as { id: string; schluessel: string; benutzerId: string; ablauf: string; vorschau: string; scopes: unknown[] };
};

describe("Anlegen, Anzeigen, Widerrufen", () => {
  it("der Schlüssel erscheint genau einmal; in der Datenbank liegt nur der SHA-256-Hash", async () => {
    const neu = await neuerSchluessel([{ fondsId: F1, recht: "lesen" }]);
    expect(neu.schluessel).toMatch(/^cwk_[A-Za-z0-9_-]{43}$/);
    expect(neu.vorschau).toBe(neu.schluessel.slice(0, 10));
    const [zeile] = await db.select().from(s.apiSchluessel);
    expect(zeile!.hash).toBe(createHash("sha256").update(neu.schluessel).digest("hex"));
    expect(JSON.stringify(zeile)).not.toContain(neu.schluessel);

    const liste = await json(await anfrage("GET", "/api-schluessel", STANDARD));
    expect(liste.daten).toHaveLength(1);
    expect(liste.daten[0]).toMatchObject({ id: neu.id, name: "Importjob", status: "aktiv", scopes: [{ fondsId: F1, recht: "lesen" }], zuletztGenutzt: null });
    expect(JSON.stringify(liste)).not.toContain(neu.schluessel);
    expect(JSON.stringify(liste)).not.toContain(zeile!.hash);
    const protokoll = await protokollZeilen(db, "api_schluessel", "anlegen");
    expect(JSON.stringify(protokoll)).not.toContain(neu.schluessel);
    expect(JSON.stringify(protokoll)).not.toContain(zeile!.hash);
  });

  it("jeder Schlüssel bekommt einen eigenen technischen Benutzer", async () => {
    const a = await neuerSchluessel([{ fondsId: F1, recht: "lesen" }]);
    const b = await neuerSchluessel([{ fondsId: F1, recht: "lesen" }]);
    expect(a.benutzerId).not.toBe(b.benutzerId);
    const [benutzer] = await db.select().from(s.benutzer).where(sql`${s.benutzer.id} = ${a.benutzerId}`);
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
    expect((await anfrage("POST", "/api-schluessel", verwalterF1, { name: "X", scopes: [{ fondsId: F1, recht: "lesen" }] })).status).toBe(403);
    expect((await anfrage("GET", "/api-schluessel", verwalterF1)).status).toBe(403);
    for (const falsch of [
      { name: "X", scopes: [] },
      { name: "", scopes: [{ fondsId: F1, recht: "lesen" }] },
      { name: "X", scopes: [{ fondsId: F1, recht: "verwalten" }] },
      { name: "X", scopes: [{ fondsId: "keine-uuid", recht: "lesen" }] },
    ]) {
      expect((await anfrage("POST", "/api-schluessel", STANDARD, falsch)).status).toBe(400);
    }
    const unbekannt = await anfrage("POST", "/api-schluessel", STANDARD, { name: "X", scopes: [{ fondsId: "00000000-0000-4000-8000-0000000000ff", recht: "lesen" }] });
    expect(unbekannt.status).toBe(404);
    expect(await db.select().from(s.apiSchluessel)).toHaveLength(0);
  });

  it("Ablauf: Standard 90 Tage, höchstens 365 Tage, nie in der Vergangenheit", async () => {
    const standard = await neuerSchluessel([{ fondsId: F1, recht: "lesen" }]);
    const tage = (new Date(standard.ablauf).getTime() - Date.now()) / 86_400_000;
    expect(tage).toBeGreaterThan(89.9);
    expect(tage).toBeLessThan(90.1);
    const zuLang = new Date(Date.now() + 400 * 86_400_000).toISOString();
    const vorbei = new Date(Date.now() - 1000).toISOString();
    for (const ablauf of [zuLang, vorbei]) {
      const antwort = await anfrage("POST", "/api-schluessel", STANDARD, { name: "X", scopes: [{ fondsId: F1, recht: "lesen" }], ablauf });
      expect(antwort.status).toBe(400);
      expect((await json(antwort)).fehler.felder[0].feld).toBe("ablauf");
    }
    const fest = new Date(Date.now() + 30 * 86_400_000).toISOString();
    expect((await neuerSchluessel([{ fondsId: F1, recht: "lesen" }], { ablauf: fest })).ablauf).toBe(fest);
  });

  it("Widerruf: der Schlüssel gilt sofort nicht mehr, der Widerruf ist wiederholbar und protokolliert", async () => {
    const neu = await neuerSchluessel([{ fondsId: F1, recht: "lesen" }]);
    expect((await mitSchluessel(neu.schluessel, "GET", `/fonds/${F1}/uebersicht`)).status).toBe(200);
    const widerrufen = await anfrage("DELETE", `/api-schluessel/${neu.id}`, STANDARD);
    expect(widerrufen.status).toBe(200);
    expect((await json(widerrufen)).status).toBe("widerrufen");
    const nochmal = await anfrage("DELETE", `/api-schluessel/${neu.id}`, STANDARD);
    expect(nochmal.status).toBe(200);
    const abgelehnt = await mitSchluessel(neu.schluessel, "GET", `/fonds/${F1}/uebersicht`);
    expect(abgelehnt.status).toBe(401);
    expect((await json(abgelehnt)).fehler.code).toBe("NICHT_ANGEMELDET");
    expect(await protokollZeilen(db, "api_schluessel", "widerrufen")).toHaveLength(1);
    expect((await anfrage("DELETE", "/api-schluessel/00000000-0000-4000-8000-0000000000ff", STANDARD)).status).toBe(404);
  });
});

describe("Benutzung des Schlüssels", () => {
  it("lesen: Lesen im eigenen Fonds, nicht schreiben, nichts in fremden Fonds; Liste zeigt nur den eigenen Fonds", async () => {
    const { schluessel } = await neuerSchluessel([{ fondsId: F1, recht: "lesen" }]);
    expect((await mitSchluessel(schluessel, "GET", `/fonds/${F1}/uebersicht`)).status).toBe(200);
    expect((await mitSchluessel(schluessel, "GET", `/fonds/${F2}/uebersicht`)).status).toBe(403);
    const liste = await json(await mitSchluessel(schluessel, "GET", "/fonds"));
    expect(liste.daten.map((f: { id: string }) => f.id)).toEqual([F1]);
    const schreiben = await mitSchluessel(schluessel, "POST", `/beteiligungen/${ID.eigen}/vorgaenge`, { art: "zusage", valuta: "2025-01-01", betrag: "1000" });
    expect(schreiben.status).toBe(403);
    expect((await json(schreiben)).fehler.code).toBe("KEINE_BERECHTIGUNG");
    expect((await mitSchluessel(schluessel, "POST", "/organisationen", { name: "Nordwind Technik", art: "unternehmen" })).status).toBe(403);
  });

  it("schreiben: Vorgänge im Scope, nicht in anderen Fonds; Protokoll nennt den technischen Benutzer", async () => {
    const neu = await neuerSchluessel([{ fondsId: F1, recht: "schreiben" }]);
    const antwort = await mitSchluessel(neu.schluessel, "POST", `/beteiligungen/${ID.eigen}/vorgaenge`, { art: "zusage", valuta: "2025-01-01", betrag: "1000" });
    expect(antwort.status).toBe(201);
    const [zeile] = await protokollZeilen(db, "vorgang", "anlegen");
    expect(zeile).toMatchObject({ akteur: neu.benutzerId, akteur_name: "API: Importjob" });
    await db.insert(s.beteiligung).values({ id: "00000000-0000-4000-8000-0000000000c2", fondsId: F2, organisationId: ID.orgA, instrument: "offene_beteiligung", erstinvestment: "2025-01-01" });
    expect((await mitSchluessel(neu.schluessel, "POST", `/beteiligungen/00000000-0000-4000-8000-0000000000c2/vorgaenge`, { art: "zusage", valuta: "2025-01-01", betrag: "1000" })).status).toBe(403);
  });

  it("mehrere Scopes: je Fonds das höchste Recht", async () => {
    const { schluessel } = await neuerSchluessel([
      { fondsId: F1, recht: "lesen" },
      { fondsId: F2, recht: "schreiben" },
      { fondsId: F2, recht: "lesen" },
    ]);
    expect((await mitSchluessel(schluessel, "POST", `/fonds/${F2}/neuberechnen`)).status).toBe(202);
    expect((await mitSchluessel(schluessel, "POST", `/fonds/${F1}/neuberechnen`)).status).toBe(403);
    expect((await json(await mitSchluessel(schluessel, "GET", "/fonds"))).daten).toHaveLength(2);
  });

  it("technische Benutzer geben nicht frei: 403 TECHNISCHER_BENUTZER bei Prüfen, Freigeben, Verwerfen und Buchen, auch mit Schreibscope", async () => {
    const { schluessel } = await neuerSchluessel([{ fondsId: F1, recht: "schreiben" }]);
    for (const aktion of ["pruefen", "freigeben", "verwerfen", "buchen"]) {
      const antwort = await mitSchluessel(schluessel, "POST", `/zinslaeufe/${LAUF_F1}/${aktion}`, {});
      expect(antwort.status, aktion).toBe(403);
      expect((await json(antwort)).fehler.code).toBe("TECHNISCHER_BENUTZER");
    }
    // Ein Mensch mit derselben Berechtigung (Freigeber) darf es.
    const freigeber = person("freigeber-f1", { rollen: { [F1]: "freigeber" } });
    await legePersonAn(db, freigeber);
    expect((await anfrage("POST", `/zinslaeufe/${LAUF_F1}/pruefen`, freigeber, {})).status).toBe(200);
  });

  it("Benutzerverwaltung, Schlüsselverwaltung und Periodensperre sind für Schlüssel verschlossen", async () => {
    const { schluessel } = await neuerSchluessel([{ fondsId: F1, recht: "schreiben" }]);
    for (const [methode, pfad] of [
      ["GET", "/benutzer"],
      ["GET", "/api-schluessel"],
      ["GET", `/fonds/${F1}/periodensperre`],
      ["GET", `/fonds/${F1}/rollen`],
    ] as const) {
      expect((await mitSchluessel(schluessel, methode, pfad)).status, pfad).toBe(403);
    }
  });

  it("bereits ausgegebene Schlüssel mit dem alten Präfix fdk_ werden weiter angenommen", async () => {
    await neuerSchluessel([{ fondsId: F1, recht: "lesen" }]);
    const alt = "fdk_" + "a".repeat(43);
    await db.execute(sql`UPDATE api_schluessel SET hash = ${createHash("sha256").update(alt).digest("hex")}`);
    expect((await mitSchluessel(alt, "GET", "/fonds")).status).toBe(200);
  });

  it("abgelaufene, unbekannte und falsch geformte Schlüssel: 401", async () => {
    const neu = await neuerSchluessel([{ fondsId: F1, recht: "lesen" }]);
    await db.execute(sql`UPDATE api_schluessel SET ablauf = now() - interval '1 second'`);
    expect((await mitSchluessel(neu.schluessel, "GET", "/fonds")).status).toBe(401);
    for (const falsch of ["cwk_unbekannt-unbekannt-unbekannt-unbekannt", "irgendein-token", "cwk_", "x".repeat(60)]) {
      expect((await mitSchluessel(falsch, "GET", "/fonds")).status, falsch).toBe(401);
    }
    const ohnePraefix = await t.app.request("/api/v1/fonds", { headers: { authorization: neu.schluessel } });
    expect(ohnePraefix.status).toBe(401);
  });

  it("ein gesperrter technischer Benutzer macht den Schlüssel unbrauchbar", async () => {
    const neu = await neuerSchluessel([{ fondsId: F1, recht: "lesen" }]);
    expect((await mitSchluessel(neu.schluessel, "GET", "/fonds")).status).toBe(200);
    await db.execute(sql`UPDATE benutzer SET aktiv = false WHERE id = ${neu.benutzerId}`);
    expect((await mitSchluessel(neu.schluessel, "GET", "/fonds")).status).toBe(401);
  });

  it("zuletzt_genutzt wird gesetzt; Anfragen mit Schlüssel brauchen keinen Origin, ein fremder Origin wird trotzdem abgelehnt", async () => {
    const neu = await neuerSchluessel([{ fondsId: F1, recht: "schreiben" }]);
    expect((await mitSchluessel(neu.schluessel, "POST", `/fonds/${F1}/neuberechnen`)).status).toBe(202);
    expect((await mitSchluessel(neu.schluessel, "POST", `/fonds/${F1}/neuberechnen`, undefined, { origin: "https://boese.example" })).status).toBe(403);
    const [zeile] = await db.select().from(s.apiSchluessel);
    expect(zeile!.zuletztGenutzt).not.toBeNull();
    const liste = await json(await anfrage("GET", "/api-schluessel", STANDARD));
    expect(liste.daten[0].zuletztGenutzt).not.toBeNull();
  });

  it("ein Schlüssel zusammen mit einem Sitzungscookie zählt als Schlüssel (kein Rechtegewinn durch Mischen)", async () => {
    const { schluessel } = await neuerSchluessel([{ fondsId: F1, recht: "lesen" }]);
    const antwort = await t.request("/benutzer", { als: STANDARD, headers: { authorization: `Bearer ${schluessel}` } });
    expect(antwort.status).toBe(403);
  });
});
