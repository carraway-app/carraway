import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { Schluesselring } from "../geheimnis/krypto";
import { verarbeiteMailAuftraege } from "../mail/auftraege";
import type { MailKonfiguration } from "../mail/konfiguration";
import { FakeMailer } from "../mail/mailer";
import { json, leeren, oeffneTestdb } from "./hilfen";
import { cookieKopf, erstelleTestApp, jsonKopf, legeInvestorAn, legePersonAn, meldeAn, person, TESTORIGIN, TESTPASSWORT, totpCode, TESTGEHEIMNIS, type Testperson } from "./hilfen-auth";

/**
 * Passwort zurücksetzen und Einladung per Mail: einmalige, kurzlebige Token (nur als Hash gespeichert), gleiche Antwort für jede Adresse, Begrenzung je IP
 * und Adresse, der zweite Faktor bleibt, andere Sitzungen enden. Der Versand läuft über den `FakeMailer`; alle Personen und Adressen sind erfunden.
 */

const { db, pool } = oeffneTestdb();
const ring = new Schluesselring(randomBytes(32));
const MAIL: MailKonfiguration = { host: "smtp.example.org", port: 25, tls: "keine", absender: "carraway@example.org", limitProStunde: 200 };
const NEUES_PASSWORT = "Neues-Passwort-nur-lokal-2";

const t = erstelleTestApp(db, { mail: MAIL, schluessel: ring, passwortAntwortMinMs: 0, passwortLimit: { proAdresse: 3, proIp: 50, fensterMs: 3_600_000 } });
const ohneMail = erstelleTestApp(db, { mail: undefined });
const mitFloor = erstelleTestApp(db, { mail: MAIL, schluessel: ring, passwortAntwortMinMs: 250, passwortLimit: { proAdresse: 50, proIp: 50, fensterMs: 3_600_000 } });
const knappeIp = erstelleTestApp(db, { mail: MAIL, schluessel: ring, passwortAntwortMinMs: 0, passwortLimit: { proAdresse: 50, proIp: 3, fensterMs: 3_600_000 } });

const verwalter = person("pw-verwalter", { globalVerwalter: true });
const anna = person("pw-anna");
const gesperrt = person("pw-gesperrt", { aktiv: false });

const roh = (app: ReturnType<typeof erstelleTestApp>, pfad: string, body?: unknown, cookie?: string) =>
  app.app.request(`/api/v1${pfad}`, { method: body === undefined ? "GET" : "POST", headers: jsonKopf(cookie, TESTORIGIN), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const vergessen = (app: ReturnType<typeof erstelleTestApp>, email: string, sprache?: "de" | "en") => roh(app, "/passwort/vergessen", { email, ...(sprache ? { sprache } : {}) });
const einloesen = (token: string, newPassword = NEUES_PASSWORT) => roh(t, "/auth/reset-password", { token, newPassword });
const anmelden = (email: string, password: string) => roh(t, "/auth/sign-in/email", { email, password });

/** Sendet alle wartenden Mails und gibt die Nachrichten zurück. */
async function versende() {
  const mailer = new FakeMailer();
  await verarbeiteMailAuftraege(db, { mailer, ring, limitProStunde: 1000 });
  return mailer.gesendet;
}
const tokenAus = (text: string) => /#token=([A-Za-z0-9_-]+)/.exec(text)?.[1] ?? "";

beforeEach(async () => {
  await leeren(db);
  await db.execute(sql`DELETE FROM anmeldeversuch`);
  await db.execute(sql`DELETE FROM verifizierung`);
  await db.execute(sql`DELETE FROM benutzer WHERE email NOT LIKE '%@test.example'`);
  for (const p of [verwalter, anna, gesperrt]) await legePersonAn(db, p);
});
afterAll(async () => {
  await leeren(db);
  await db.execute(sql`DELETE FROM anmeldeversuch`);
  await db.execute(sql`DELETE FROM verifizierung`);
  await pool.end();
});

describe("Passwort vergessen", () => {
  it("ohne eingerichteten Mailversand: Anmeldeseite blendet es aus, die Anfrage ist 409 MAIL_NICHT_EINGERICHTET", async () => {
    expect((await json(await roh(ohneMail, "/umgebung"))).anmeldung.passwortZuruecksetzen).toBe(false);
    expect((await json(await roh(t, "/umgebung"))).anmeldung.passwortZuruecksetzen).toBe(true);
    const antwort = await vergessen(ohneMail, anna.email);
    expect(antwort.status).toBe(409);
    expect((await json(antwort)).fehler.code).toBe("MAIL_NICHT_EINGERICHTET");
  });

  it("bekannte, unbekannte, gesperrte und technische Adressen bekommen dieselbe Antwort; nur bekannte lösen eine Mail aus", async () => {
    const [technisch] = await db.insert(s.benutzer).values({ name: "Technisch", email: "technisch@extern.example", technisch: true, emailVerified: true }).returning();
    expect(technisch).toBeDefined();
    const antworten = [];
    for (const email of [anna.email, "niemand@extern.example", gesperrt.email, "technisch@extern.example"]) {
      const a = await vergessen(t, email);
      antworten.push({ status: a.status, koerper: await a.text() });
    }
    expect(new Set(antworten.map((a) => JSON.stringify(a))).size).toBe(1);
    expect(antworten[0]).toEqual({ status: 200, koerper: JSON.stringify({ ok: true }) });
    const mails = await versende();
    expect(mails).toHaveLength(1);
    expect(mails[0]!.an).toBe(anna.email);
    // Für die übrigen Adressen bleibt nichts zurück: kein Auftrag, kein Token.
    expect((await db.select().from(s.mailAuftrag)).map((m) => m.empfaenger)).toEqual([anna.email]);
    expect((await db.select().from(s.verifizierung)).length).toBe(1);
  });

  it("die Antwort wartet mindestens die Mindestdauer, für bekannte wie für unbekannte Adressen", async () => {
    for (const email of [anna.email, "niemand@extern.example"]) {
      const start = performance.now();
      expect((await vergessen(mitFloor, email)).status).toBe(200);
      expect(performance.now() - start).toBeGreaterThanOrEqual(240);
    }
  });

  it("ungültige Adresse ist 400, ohne Hinweis auf Konten", async () => {
    const antwort = await vergessen(t, "kein-adresse");
    expect(antwort.status).toBe(400);
    expect((await json(antwort)).fehler.code).toBe("EINGABE_UNGUELTIG");
  });

  it("Token steht nur als Hash in der Datenbank, gilt höchstens 30 Minuten und die Mail nennt Link, Dauer und den bleibenden zweiten Faktor", async () => {
    await vergessen(t, anna.email, "en");
    const [mail] = await versende();
    const token = tokenAus(mail!.text);
    expect(token.length).toBeGreaterThanOrEqual(30);
    expect(mail!.text).toContain(`${TESTORIGIN}/passwort-setzen#token=${token}`);
    expect(mail!.betreff).toBe("Reset your password");
    expect(mail!.text).toContain("30 minutes");
    expect(mail!.text).toContain("second factor");
    const zeilen = await db.select().from(s.verifizierung);
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]!.identifier).not.toContain(token);
    expect(zeilen[0]!.identifier).not.toContain("reset-password");
    expect(zeilen[0]!.identifier.startsWith("pw1:")).toBe(true);
    const dauerMs = zeilen[0]!.expiresAt.getTime() - Date.now();
    expect(dauerMs).toBeLessThanOrEqual(30 * 60_000);
    expect(dauerMs).toBeGreaterThan(29 * 60_000);
  });

  it("eine Anfrage von außen unterbricht keine laufende Anmeldung der Person: der wartende zweite Faktor gilt weiter", async () => {
    const passwortSchritt = await anmelden(anna.email, TESTPASSWORT);
    expect((await json(passwortSchritt)).twoFactorRedirect).toBe(true);
    const zwischen = cookieKopf(passwortSchritt.headers.getSetCookie());
    // Jemand fordert (ohne Anmeldung) das Zurücksetzen für diese Adresse an, zweimal, damit auch das Ersetzen früherer Token läuft.
    expect((await vergessen(t, anna.email)).status).toBe(200);
    expect((await vergessen(t, anna.email)).status).toBe(200);
    const code = await roh(t, "/auth/two-factor/verify-totp", { code: totpCode(TESTGEHEIMNIS) }, zwischen);
    expect(code.status).toBe(200);
    expect((await roh(t, "/ich", undefined, cookieKopf(code.headers.getSetCookie()))).status).toBe(200);
  });

  it("Mail-Sprache: eigene Einstellung vor dem Hinweis der Oberfläche, sonst Deutsch", async () => {
    await vergessen(t, anna.email);
    expect((await versende())[0]!.betreff).toBe("Passwort zurücksetzen");
    await db.insert(s.benutzerEinstellung).values({ benutzerId: (await db.select().from(s.benutzer).where(eq(s.benutzer.email, anna.email)))[0]!.id, sprache: "en" });
    await db.execute(sql`DELETE FROM anmeldeversuch`);
    await vergessen(t, anna.email, "de");
    expect((await versende())[0]!.betreff).toBe("Reset your password");
  });

  it("Zurücksetzen: neues Passwort gilt, das alte nicht, andere Sitzungen enden, der zweite Faktor wird weiter verlangt", async () => {
    const alteSitzung = await meldeAn(t.app, anna);
    expect((await roh(t, "/ich", undefined, alteSitzung)).status).toBe(200);
    await vergessen(t, anna.email);
    const token = tokenAus((await versende())[0]!.text);

    const erledigt = await einloesen(token);
    expect(erledigt.status).toBe(200);
    // andere Sitzungen sind beendet
    expect((await roh(t, "/ich", undefined, alteSitzung)).status).toBe(401);
    // altes Passwort geht nicht mehr
    expect((await anmelden(anna.email, TESTPASSWORT)).status).toBeGreaterThanOrEqual(400);
    // neues Passwort führt in den zweiten Faktor, nicht in eine Sitzung
    const neu = await anmelden(anna.email, NEUES_PASSWORT);
    expect(neu.status).toBe(200);
    expect((await json(neu)).twoFactorRedirect).toBe(true);
    const zwischen = cookieKopf(neu.headers.getSetCookie());
    expect((await roh(t, "/ich", undefined, zwischen)).status).toBe(401);
    // der zweite Faktor ist unverändert da und löst die Anmeldung ein
    const [b] = await db.select().from(s.benutzer).where(eq(s.benutzer.email, anna.email));
    expect(b!.twoFactorEnabled).toBe(true);
    expect(await db.select().from(s.zweiFaktor).where(eq(s.zweiFaktor.userId, b!.id))).toHaveLength(1);
    const code = await roh(t, "/auth/two-factor/verify-totp", { code: totpCode(TESTGEHEIMNIS) }, zwischen);
    expect(code.status).toBe(200);
    expect((await roh(t, "/ich", undefined, cookieKopf(code.headers.getSetCookie()))).status).toBe(200);
  });

  it("ein Token gilt genau einmal und verfällt mit einer neuen Anfrage", async () => {
    await vergessen(t, anna.email);
    const erstes = tokenAus((await versende())[0]!.text);
    await vergessen(t, anna.email);
    const zweites = tokenAus((await versende())[0]!.text);
    expect(zweites).not.toBe(erstes);
    expect(await db.select().from(s.verifizierung)).toHaveLength(1);
    // das frühere Token ist durch das neue ersetzt
    const veraltet = await einloesen(erstes);
    expect(veraltet.status).toBe(400);
    expect((await einloesen(zweites)).status).toBe(200);
    // Wiederverwendung scheitert und ändert das Passwort nicht
    const nochmal = await einloesen(zweites, "Dritt-Passwort-nur-lokal-3");
    expect(nochmal.status).toBe(400);
    expect((await json(await anmelden(anna.email, NEUES_PASSWORT))).twoFactorRedirect).toBe(true);
  });

  it("ein abgelaufenes Token wird abgelehnt", async () => {
    await vergessen(t, anna.email);
    const token = tokenAus((await versende())[0]!.text);
    await db.execute(sql`UPDATE verifizierung SET expires_at = now() - interval '1 minute'`);
    const antwort = await einloesen(token);
    expect(antwort.status).toBe(400);
    expect((await anmelden(anna.email, TESTPASSWORT)).status).toBe(200);
  });

  it("zu kurzes neues Passwort wird abgelehnt und verbraucht das Token nicht", async () => {
    await vergessen(t, anna.email);
    const token = tokenAus((await versende())[0]!.text);
    expect((await einloesen(token, "zu-kurz")).status).toBe(400);
    expect((await einloesen(token)).status).toBe(200);
  });

  it("ein unbekanntes Token ist 400; zu viele Fehlversuche je IP sperren auch das Einlösen", async () => {
    const roh400 = await einloesen("gibt-es-nicht-0123456789");
    expect(roh400.status).toBe(400);
    for (let i = 0; i < 12; i++) await einloesen(`falsch-${i}`);
    const gesperrtAntwort = await einloesen("noch-ein-falsches");
    expect(gesperrtAntwort.status).toBe(429);
  });

  it("Begrenzung je Adresse: die vierte Anfrage ist 429, auch für eine unbekannte Adresse", async () => {
    for (const email of [anna.email, "niemand@extern.example"]) {
      const stati = [];
      for (let i = 0; i < 4; i++) stati.push((await vergessen(t, email)).status);
      expect(stati).toEqual([200, 200, 200, 429]);
    }
  });

  it("Begrenzung je IP gilt über Adressen hinweg", async () => {
    const stati = [];
    for (let i = 0; i < 4; i++) stati.push((await vergessen(knappeIp, `person${i}@extern.example`)).status);
    expect(stati).toEqual([200, 200, 200, 429]);
  });

  it("Protokoll: Anfrage und Zurücksetzen stehen im Änderungsprotokoll, ohne Token", async () => {
    await vergessen(t, anna.email);
    const token = tokenAus((await versende())[0]!.text);
    await einloesen(token);
    const zeilen = await db.select().from(s.aenderung).where(sql`${s.aenderung.aktion} IN ('passwort_anfordern', 'passwort_zuruecksetzen')`);
    expect(zeilen.map((z) => z.aktion).sort()).toEqual(["passwort_anfordern", "passwort_zuruecksetzen"]);
    expect(JSON.stringify(await db.select().from(s.aenderung))).not.toContain(token);
  });

  it("Better Auth bietet seinen eigenen Anfrageweg nicht an", async () => {
    expect((await roh(t, "/auth/request-password-reset", { email: anna.email })).status).toBe(404);
    expect((await roh(t, "/auth/forget-password", { email: anna.email })).status).toBe(404);
    expect(await db.select().from(s.mailAuftrag)).toHaveLength(0);
  });

  it("auch Investor-Benutzer des LP-Portals setzen ihr Passwort zurück und bleiben im Portal", async () => {
    const investor: Testperson = person("pw-investor");
    await legeInvestorAn(db, investor, []);
    await vergessen(t, investor.email);
    const mail = (await versende())[0]!;
    expect(mail.an).toBe(investor.email);
    expect((await einloesen(tokenAus(mail.text))).status).toBe(200);
    expect((await json(await anmelden(investor.email, NEUES_PASSWORT))).twoFactorRedirect).toBe(true);
    expect(await db.select().from(s.investorBenutzer).where(eq(s.investorBenutzer.benutzerId, (await db.select().from(s.benutzer).where(eq(s.benutzer.email, investor.email)))[0]!.id))).toHaveLength(1);
  });
});

describe("Einladung per Mail", () => {
  const einladen = (body: object, als: Testperson | null = verwalter, app = t) =>
    app.request("/benutzer", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), als });

  it("ohne eingerichteten Mailversand bleibt es beim Startpasswort: Anlage ohne Passwort ist 409", async () => {
    const antwort = await einladen({ name: "Neue Person", email: "neu@extern.example" }, verwalter, ohneMail);
    expect(antwort.status).toBe(409);
    expect((await json(antwort)).fehler.code).toBe("MAIL_NICHT_EINGERICHTET");
    expect(await db.select().from(s.benutzer).where(eq(s.benutzer.email, "neu@extern.example"))).toHaveLength(0);
    // mit Startpasswort geht es wie bisher
    const mitPasswort = await einladen({ name: "Neue Person", email: "neu@extern.example", passwort: "Start-Passwort-nur-lokal-1" }, verwalter, ohneMail);
    expect(mitPasswort.status).toBe(201);
    expect((await json(mitPasswort)).einladung).toBe(false);
  });

  it("Anlage ohne Passwort sendet eine Einladung (72 Stunden); Passwort festlegen, dann zweiten Faktor einrichten", async () => {
    const antwort = await einladen({ name: "Neue Person", email: "neu@extern.example", sprache: "en" });
    expect(antwort.status).toBe(201);
    expect(await json(antwort)).toMatchObject({ einladung: true, email: "neu@extern.example" });
    const [mail] = await versende();
    expect(mail!.an).toBe("neu@extern.example");
    expect(mail!.betreff).toBe("Invitation to Carraway");
    expect(mail!.text).toContain("72 hours");
    const token = tokenAus(mail!.text);
    const [zeile] = await db.select().from(s.verifizierung);
    expect(zeile!.identifier).not.toContain(token);
    const dauerMs = zeile!.expiresAt.getTime() - Date.now();
    expect(dauerMs).toBeGreaterThan(71 * 3_600_000);
    expect(dauerMs).toBeLessThanOrEqual(72 * 3_600_000);

    // bis dahin kein Zugang, und die Verwaltung zeigt die offene Einladung
    expect((await anmelden("neu@extern.example", NEUES_PASSWORT)).status).toBeGreaterThanOrEqual(400);
    const liste = await json(await t.request("/benutzer", { als: verwalter }));
    expect(liste.daten.find((b: { email: string }) => b.email === "neu@extern.example")).toMatchObject({ einladungOffen: true, passwortAendern: false });

    expect((await einloesen(token)).status).toBe(200);
    expect((await einloesen(token)).status).toBe(400);
    const angemeldet = await anmelden("neu@extern.example", NEUES_PASSWORT);
    expect(angemeldet.status).toBe(200);
    const cookie = cookieKopf(angemeldet.headers.getSetCookie());
    const ich = await json(await roh(t, "/ich", undefined, cookie));
    // weiter wie bei Startpasswort: zweiter Faktor ist Pflicht, ein Passwortwechsel nicht mehr
    expect(ich).toMatchObject({ passwortAendern: false, zweiFaktorErforderlich: true, zweiFaktorAktiv: false });
    const nachher = await json(await t.request("/benutzer", { als: verwalter }));
    expect(nachher.daten.find((b: { email: string }) => b.email === "neu@extern.example").einladungOffen).toBe(false);
  });

  it("erneut einladen ersetzt den Link; nach dem Festlegen des Passworts ist es 409", async () => {
    const neu = await json(await einladen({ name: "Neue Person", email: "neu@extern.example" }));
    const erster = tokenAus((await versende())[0]!.text);
    const nochmal = await t.request(`/benutzer/${neu.id}/einladung`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}), als: verwalter });
    expect(nochmal.status).toBe(204);
    const zweiter = tokenAus((await versende())[0]!.text);
    expect((await einloesen(erster)).status).toBe(400);
    expect((await einloesen(zweiter)).status).toBe(200);
    const spaet = await t.request(`/benutzer/${neu.id}/einladung`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}), als: verwalter });
    expect(spaet.status).toBe(409);
    expect((await json(spaet)).fehler.code).toBe("EINLADUNG_NICHT_MOEGLICH");
    expect(await db.select().from(s.verifizierung)).toHaveLength(0);
  });

  it("nur globale Verwalter laden ein", async () => {
    expect((await einladen({ name: "Neue Person", email: "neu@extern.example" }, anna)).status).toBe(403);
    expect((await einladen({ name: "Neue Person", email: "neu@extern.example" }, null)).status).toBe(401);
  });

  it("Protokoll: Anlage und Einladung stehen im Änderungsprotokoll", async () => {
    await einladen({ name: "Neue Person", email: "neu@extern.example" });
    const aktionen = (await db.select().from(s.aenderung).where(eq(s.aenderung.tabelle, "benutzer"))).map((z) => z.aktion);
    expect(aktionen).toEqual(expect.arrayContaining(["anlegen", "einladen"]));
  });
});
