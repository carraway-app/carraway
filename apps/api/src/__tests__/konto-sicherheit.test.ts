import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { totpCode as eigenerCode } from "../anmeldung/totp";
import { base32Dekodieren, erstelleTestApp, jsonKopf, legePersonAn, meldeAn, person, TESTGEHEIMNIS, TESTPASSWORT, totpCode } from "./hilfen-auth";
import { json, leeren, oeffneTestdb } from "./hilfen";

const { db, pool } = oeffneTestdb();

beforeEach(async () => {
  await leeren(db);
  await db.execute(sql`DELETE FROM anmeldeversuch`);
  await db.execute(sql`DELETE FROM benutzer`);
});
afterAll(async () => {
  await db.execute(sql`DELETE FROM anmeldeversuch`);
  await db.execute(sql`DELETE FROM benutzer`);
  await pool.end();
});

const NEUES_PASSWORT = "Neues-Passwort-nur-lokal-2";
const anna = person("anna", { globalVerwalter: true });

const mit = (t: ReturnType<typeof erstelleTestApp>, pfad: string, cookie: string, body?: unknown, methode?: string) =>
  t.app.request(`/api/v1${pfad}`, {
    method: methode ?? (body === undefined ? "GET" : "POST"),
    headers: jsonKopf(cookie),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const protokoll = async (aktion: string) => (await db.execute<{ nachher: unknown; vorher: unknown }>(sql`SELECT vorher, nachher FROM aenderung WHERE aktion = ${aktion}`)).rows;

async function zwei(t: ReturnType<typeof erstelleTestApp>) {
  await legePersonAn(db, anna);
  return [await meldeAn(t.app, anna), await meldeAn(t.app, anna)] as const;
}

describe("Eigene Sicherheit: Passwort", () => {
  it("falsches aktuelles Passwort: 400 PASSWORT_FALSCH; zu kurz: 400; unverändert: 400; kein Eintrag im Protokoll", async () => {
    const t = erstelleTestApp(db);
    const [a] = await zwei(t);
    const falsch = await mit(t, "/konto/passwort", a, { aktuell: "falsch-falsch-falsch", neu: NEUES_PASSWORT });
    expect(falsch.status).toBe(400);
    expect((await json(falsch)).fehler.code).toBe("PASSWORT_FALSCH");
    expect((await mit(t, "/konto/passwort", a, { aktuell: TESTPASSWORT, neu: "kurz" })).status).toBe(400);
    const gleich = await mit(t, "/konto/passwort", a, { aktuell: TESTPASSWORT, neu: TESTPASSWORT });
    expect((await json(gleich)).fehler.code).toBe("PASSWORT_UNVERAENDERT");
    expect(await protokoll("passwort_aendern")).toHaveLength(0);
  });

  it("ändert das Passwort, beendet andere Sitzungen (Standard), die eigene bleibt; die Anmeldung gilt mit dem neuen Passwort; das Protokoll enthält kein Passwort", async () => {
    const t = erstelleTestApp(db);
    const [a, b] = await zwei(t);
    const antwort = await mit(t, "/konto/passwort", a, { aktuell: TESTPASSWORT, neu: NEUES_PASSWORT });
    expect(antwort.status).toBe(200);
    expect(await json(antwort)).toMatchObject({ ok: true, andereSitzungenBeendet: 1 });
    expect((await mit(t, "/ich", a)).status).toBe(200);
    expect((await mit(t, "/ich", b)).status).toBe(401);
    const alt = await t.app.request("/api/v1/auth/sign-in/email", { method: "POST", headers: jsonKopf(), body: JSON.stringify({ email: anna.email, password: TESTPASSWORT }) });
    expect(alt.status).toBe(401);
    const neu = await t.app.request("/api/v1/auth/sign-in/email", { method: "POST", headers: jsonKopf(), body: JSON.stringify({ email: anna.email, password: NEUES_PASSWORT }) });
    expect(neu.status).toBe(200);
    const zeilen = await protokoll("passwort_aendern");
    expect(zeilen).toHaveLength(1);
    expect(JSON.stringify(zeilen)).not.toContain(NEUES_PASSWORT);
    expect(JSON.stringify(zeilen)).not.toContain(TESTPASSWORT);
  });

  it("mit andereSitzungenBeenden=false bleiben andere Sitzungen bestehen", async () => {
    const t = erstelleTestApp(db);
    const [a, b] = await zwei(t);
    const antwort = await mit(t, "/konto/passwort", a, { aktuell: TESTPASSWORT, neu: NEUES_PASSWORT, andereSitzungenBeenden: false });
    expect(await json(antwort)).toMatchObject({ andereSitzungenBeendet: 0 });
    expect((await mit(t, "/ich", b)).status).toBe(200);
  });

  it("nach 10 falschen Passwörtern: 429 ZU_VIELE_VERSUCHE, auch mit richtigem Passwort", async () => {
    const t = erstelleTestApp(db);
    const [a] = await zwei(t);
    for (let i = 0; i < 10; i++) expect((await mit(t, "/konto/passwort", a, { aktuell: "falsch-falsch-falsch", neu: NEUES_PASSWORT })).status).toBe(400);
    const gesperrt = await mit(t, "/konto/passwort", a, { aktuell: TESTPASSWORT, neu: NEUES_PASSWORT });
    expect(gesperrt.status).toBe(429);
    expect((await json(gesperrt)).fehler.code).toBe("ZU_VIELE_VERSUCHE");
  });

  it("ohne Anmeldung 401, API-Schlüssel und fremder Ursprung abgelehnt", async () => {
    const t = erstelleTestApp(db);
    expect((await t.request("/konto/sicherheit", { als: null })).status).toBe(401);
    await zwei(t);
    expect((await t.request("/konto/passwort", { method: "POST", origin: "https://fremd.example", als: anna, body: "{}", headers: { "content-type": "application/json" } })).status).toBe(403);
  });
});

describe("Eigene Sicherheit: Sitzungen", () => {
  it("listet nur eigene Sitzungen mit Kennzeichen der aktuellen, ohne Token; fremde Sitzungen bleiben unsichtbar", async () => {
    const t = erstelleTestApp(db);
    const [a, b] = await zwei(t);
    const fremd = person("bernd");
    await legePersonAn(db, fremd);
    const fremdCookie = await meldeAn(t.app, fremd);
    const liste = await json(await mit(t, "/konto/sitzungen", a));
    expect(liste).toHaveLength(2);
    expect(liste.filter((s: { aktuell: boolean }) => s.aktuell)).toHaveLength(1);
    expect(JSON.stringify(liste)).not.toContain("token");
    const fremdeId = (await json(await mit(t, "/konto/sitzungen", fremdCookie)))[0].id;
    expect((await mit(t, `/konto/sitzungen/${fremdeId}`, a, undefined, "DELETE")).status).toBe(404);
    expect((await mit(t, "/ich", fremdCookie)).status).toBe(200);
    expect(b.length).toBeGreaterThan(0);
  });

  it("beendet eine einzelne andere Sitzung, nicht die aktuelle; protokolliert", async () => {
    const t = erstelleTestApp(db);
    const [a, b] = await zwei(t);
    const liste = await json(await mit(t, "/konto/sitzungen", a));
    const eigene = liste.find((s: { aktuell: boolean }) => s.aktuell).id;
    const andere = liste.find((s: { aktuell: boolean }) => !s.aktuell).id;
    const aktuell = await mit(t, `/konto/sitzungen/${eigene}`, a, undefined, "DELETE");
    expect(aktuell.status).toBe(400);
    expect((await json(aktuell)).fehler.code).toBe("SITZUNG_AKTUELL");
    expect((await mit(t, `/konto/sitzungen/${andere}`, a, undefined, "DELETE")).status).toBe(204);
    expect((await mit(t, "/ich", b)).status).toBe(401);
    expect((await mit(t, "/ich", a)).status).toBe(200);
    expect(await protokoll("sitzung_beenden")).toHaveLength(1);
  });

  it("alle anderen beenden lässt die aktuelle bestehen", async () => {
    const t = erstelleTestApp(db);
    const [a, b] = await zwei(t);
    expect(await json(await mit(t, "/konto/sitzungen/andere-beenden", a, {}))).toEqual({ beendet: 1 });
    expect((await mit(t, "/ich", b)).status).toBe(401);
    expect((await mit(t, "/ich", a)).status).toBe(200);
  });
});

describe("Eigene Sicherheit: zweiter Faktor", () => {
  it("Übersicht: Faktor aktiv, Zahl der Wiederherstellungscodes", async () => {
    const t = erstelleTestApp(db);
    const [a] = await zwei(t);
    expect(await json(await mit(t, "/konto/sicherheit", a))).toMatchObject({ passwortVorhanden: true, zweiFaktorAktiv: true, codesUebrig: 1, sitzungenAnzahl: 2 });
  });

  it("Wiederherstellungscodes erneuern: Passwort nötig, neue Codes gelten, alter Code nicht mehr; Codes nicht im Protokoll", async () => {
    const t = erstelleTestApp(db);
    const [a] = await zwei(t);
    expect((await json(await mit(t, "/konto/wiederherstellungscodes", a, { passwort: "falsch-falsch-falsch" }))).fehler.code).toBe("PASSWORT_FALSCH");
    const antwort = await json(await mit(t, "/konto/wiederherstellungscodes", a, { passwort: TESTPASSWORT }));
    expect(antwort.backupCodes).toHaveLength(10);
    expect(await json(await mit(t, "/konto/sicherheit", a))).toMatchObject({ codesUebrig: 10 });
    const zwischen = await t.app.request("/api/v1/auth/sign-in/email", { method: "POST", headers: jsonKopf(), body: JSON.stringify({ email: anna.email, password: TESTPASSWORT }) });
    const cookie = zwischen.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    const mitCode = await t.app.request("/api/v1/auth/two-factor/verify-backup-code", { method: "POST", headers: jsonKopf(cookie), body: JSON.stringify({ code: antwort.backupCodes[0] }) });
    expect(mitCode.status).toBe(200);
    expect(JSON.stringify(await protokoll("wiederherstellungscodes_erneuern"))).not.toContain(antwort.backupCodes[0]);
  });

  it("Neueinrichtung: das alte Geheimnis gilt bis zum gültigen Code des neuen; danach nur noch das neue und die neuen Codes", async () => {
    const t = erstelleTestApp(db);
    const [a] = await zwei(t);
    expect((await json(await mit(t, "/konto/zwei-faktor/neu", a, { passwort: "falsch-falsch-falsch" }))).fehler.code).toBe("PASSWORT_FALSCH");
    const start = await json(await mit(t, "/konto/zwei-faktor/neu", a, { passwort: TESTPASSWORT }));
    const url = new URL(start.totpURI);
    expect(url.searchParams.get("issuer")).toBe("Carraway");
    const neu = url.searchParams.get("secret")!;
    expect(start.backupCodes).toHaveLength(10);
    // Der Ansatz hat noch nichts ersetzt: Das alte Geheimnis meldet weiter an.
    const anmelden = async () => {
      const r = await t.app.request("/api/v1/auth/sign-in/email", { method: "POST", headers: jsonKopf(), body: JSON.stringify({ email: anna.email, password: TESTPASSWORT }) });
      return r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    };
    const pruefeCode = (cookie: string, code: string) => t.app.request("/api/v1/auth/two-factor/verify-totp", { method: "POST", headers: jsonKopf(cookie), body: JSON.stringify({ code }) });
    expect((await pruefeCode(await anmelden(), totpCode(TESTGEHEIMNIS))).status).toBe(200);
    // Falscher Code bestätigt nichts.
    const falsch = await mit(t, "/konto/zwei-faktor/neu/bestaetigen", a, { code: "000000" === totpCode(String.fromCharCode(...base32Dekodieren(neu))) ? "111111" : "000000" });
    expect((await json(falsch)).fehler.code).toBe("CODE_UNGUELTIG");
    const code = eigenerCode(String.fromCharCode(...base32Dekodieren(neu)), Date.now());
    const ok = await mit(t, "/konto/zwei-faktor/neu/bestaetigen", a, { code });
    expect(ok.status).toBe(200);
    // Jetzt gilt das neue Geheimnis (mit der unabhängigen Testimplementierung gerechnet), das alte nicht mehr.
    expect((await pruefeCode(await anmelden(), totpCode(TESTGEHEIMNIS))).status).toBe(401);
    expect((await pruefeCode(await anmelden(), totpCode(neu))).status).toBe(200);
    const mitCode = await t.app.request("/api/v1/auth/two-factor/verify-backup-code", { method: "POST", headers: jsonKopf(await anmelden()), body: JSON.stringify({ code: start.backupCodes[3] }) });
    expect(mitCode.status).toBe(200);
    // Ohne begonnene Einrichtung kein zweites Mal.
    const nochmal = await mit(t, "/konto/zwei-faktor/neu/bestaetigen", a, { code });
    expect((await json(nochmal)).fehler.code).toBe("EINRICHTUNG_ABGELAUFEN");
    const log = JSON.stringify([...(await protokoll("zwei_faktor_neu")), ...(await protokoll("zwei_faktor_neu_beginnen"))]);
    expect(log).not.toContain(neu);
    expect(log).not.toContain(start.backupCodes[0]);
  });

  it("Neueinrichtung ohne aktiven Faktor und abgelaufener Ansatz werden abgewiesen", async () => {
    const t = erstelleTestApp(db);
    const ohne = person("ohne", { zweiFaktor: false, globalVerwalter: true });
    await legePersonAn(db, ohne);
    const cookie = await meldeAn(t.app, ohne);
    expect((await json(await mit(t, "/konto/zwei-faktor/neu", cookie, { passwort: TESTPASSWORT }))).fehler.code).toBe("ZWEI_FAKTOR_AUS");
    expect((await json(await mit(t, "/konto/wiederherstellungscodes", cookie, { passwort: TESTPASSWORT }))).fehler.code).toBe("ZWEI_FAKTOR_AUS");
    const [a] = await zwei(t);
    await mit(t, "/konto/zwei-faktor/neu", a, { passwort: TESTPASSWORT });
    await db.execute(sql`UPDATE verifizierung SET expires_at = now() - interval '1 minute' WHERE identifier LIKE 'zf-neu:%'`);
    expect((await json(await mit(t, "/konto/zwei-faktor/neu/bestaetigen", a, { code: "123456" }))).fehler.code).toBe("EINRICHTUNG_ABGELAUFEN");
  });
});

describe("Eigene Sicherheit: Begrenzung unter Gleichzeitigkeit", () => {
  it("gleichzeitige falsche Passwörter überschreiten die Grenze nicht: genau 10 Prüfungen, der Rest 429", async () => {
    const t = erstelleTestApp(db);
    const [a] = await zwei(t);
    const antworten = await Promise.all(Array.from({ length: 30 }, () => mit(t, "/konto/passwort", a, { aktuell: "falsch-falsch-falsch", neu: NEUES_PASSWORT })));
    const status = antworten.map((r) => r.status);
    expect(status.filter((s) => s === 400)).toHaveLength(10);
    expect(status.filter((s) => s === 429)).toHaveLength(20);
    // Auch das richtige Passwort kommt nicht mehr durch.
    expect((await mit(t, "/konto/passwort", a, { aktuell: TESTPASSWORT, neu: NEUES_PASSWORT })).status).toBe(429);
  });

  it("gleichzeitige falsche Codes bei der Neueinrichtung: genau 10 Prüfungen", async () => {
    const t = erstelleTestApp(db);
    const [a] = await zwei(t);
    await mit(t, "/konto/zwei-faktor/neu", a, { passwort: TESTPASSWORT });
    await db.execute(sql`DELETE FROM anmeldeversuch`);
    const antworten = await Promise.all(Array.from({ length: 25 }, () => mit(t, "/konto/zwei-faktor/neu/bestaetigen", a, { code: "00000a" })));
    const status = antworten.map((r) => r.status);
    expect(status.filter((s) => s === 429)).toHaveLength(15);
    expect(status.filter((s) => s === 400).length).toBe(10);
  });

  it("richtige Eingaben verbrauchen die Grenze nicht", async () => {
    const t = erstelleTestApp(db);
    const [a] = await zwei(t);
    for (let i = 0; i < 12; i++) expect((await mit(t, "/konto/wiederherstellungscodes", a, { passwort: TESTPASSWORT })).status).toBe(200);
  });
});
