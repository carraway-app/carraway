import { createHash } from "node:crypto";
import { initialisiereEinrichtung } from "../anmeldung/einrichtung";
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { istZweiFaktorOffen } from "../anmeldung/akteur";
import { KonfigurationsFehler, ladeKonfiguration } from "../konfiguration";
import { json, leeren, oeffneTestdb } from "./hilfen";
import {
  base32Dekodieren,
  cookieKopf,
  erstelleTestApp,
  jsonKopf,
  legePersonAn,
  meldeAn,
  person,
  TESTGEHEIMNIS,
  TESTORIGIN,
  TESTPASSWORT,
  totpCode,
} from "./hilfen-auth";

const SETUP_TOKEN = "test-only-setup-token";
const startAusgabe: string[] = [];
const starteEinrichtung = (vorgabe?: string) => initialisiereEinrichtung(db, vorgabe, (zeile) => startAusgabe.push(zeile));

const { db, pool } = oeffneTestdb();

beforeEach(async () => {
  startAusgabe.length = 0;
  await leeren(db);
  await db.execute(sql`DELETE FROM anmeldeversuch`);
  await db.execute(sql`DELETE FROM benutzer`);
});
afterAll(async () => {
  await db.execute(sql`DELETE FROM anmeldeversuch`);
  await db.execute(sql`DELETE FROM benutzer`);
  await pool.end();
});

/** Roher Aufruf der App ohne die Zutaten der Test-App: so sieht ein Browser die Anmeldung. */
const roh = (t: ReturnType<typeof erstelleTestApp>, pfad: string, optionen: { methode?: string; body?: unknown; cookie?: string; kopf?: Record<string, string>; origin?: string | null } = {}) =>
  t.app.request(`/api/v1${pfad}`, {
    method: optionen.methode ?? (optionen.body === undefined ? "GET" : "POST"),
    headers: { ...jsonKopf(optionen.cookie, optionen.origin === undefined ? TESTORIGIN : optionen.origin), ...optionen.kopf },
    ...(optionen.body === undefined ? {} : { body: JSON.stringify(optionen.body) }),
  });

const melden = (t: ReturnType<typeof erstelleTestApp>, email: string, passwort = TESTPASSWORT, kopf?: Record<string, string>) =>
  roh(t, "/auth/sign-in/email", { body: { email, password: passwort }, kopf });

describe("Einrichtungs-Token", () => {
  const eingabe = { name: "Erste Person", email: "erste@test.example", password: TESTPASSWORT };
  const gespeicherteToken = async () => (await db.execute(sql`SELECT value FROM verifizierung WHERE identifier = 'carraway:initial-setup'`)).rows;

  it("rotiert beim Start, speichert nur den Hash und verbraucht das Token mit dem ersten Konto", async () => {
    const t = erstelleTestApp(db);
    const einrichten = (token?: string) => roh(t, "/setup", { body: { ...eingabe, token } });
    await starteEinrichtung();
    const erstes = startAusgabe[0]!.split(" ").at(-1)!;
    await starteEinrichtung();
    expect(startAusgabe).toHaveLength(2);
    expect(startAusgabe[1]).toMatch(/^Carraway \/setup token: [A-Za-z0-9_-]{43}$/);
    const aktuelles = startAusgabe[1]!.split(" ").at(-1)!;
    expect(aktuelles).not.toBe(erstes);
    expect(await gespeicherteToken()).toEqual([{ value: createHash("sha256").update(aktuelles).digest("hex") }]);
    expect((await einrichten()).status).toBe(400);
    expect((await einrichten(erstes)).status).toBe(403);
    expect((await einrichten("falsch")).status).toBe(403);
    expect((await einrichten(aktuelles)).status).toBe(201);
    expect(await gespeicherteToken()).toEqual([]);
    await starteEinrichtung();
    expect(startAusgabe).toHaveLength(2);
    expect(await gespeicherteToken()).toEqual([]);
    expect((await json(await einrichten(aktuelles))).error.code).toBe("registration_closed");
  });

  it("verwendet die Vorgabe ohne Logausgabe und sperrt das Raten je IP und Adresse auch bei gleichzeitigen Anfragen", async () => {
    await starteEinrichtung();
    await starteEinrichtung(SETUP_TOKEN);
    expect(startAusgabe).toHaveLength(1);
    expect(startAusgabe.join("")).not.toContain(SETUP_TOKEN);
    const t = erstelleTestApp(db, { proxyVertrauen: true, anmeldeLimit: { versuche: 2, fensterMs: 60_000 } });
    const versuch = (token: string, ip = "192.0.2.1", email = eingabe.email) => roh(t, "/setup", { body: { ...eingabe, email, token }, kopf: { "X-Forwarded-For": ip } });
    const antworten = await Promise.all(Array.from({ length: 4 }, () => versuch("falsch")));
    expect(antworten.map((a) => a.status).sort()).toEqual([403, 403, 429, 429]);
    const gesperrt = await versuch(SETUP_TOKEN);
    expect(gesperrt.status).toBe(429);
    expect(gesperrt.headers.get("Retry-After")).toBe("60");
    expect((await versuch(SETUP_TOKEN, "192.0.2.2")).status).toBe(429);
    expect((await versuch(SETUP_TOKEN, "192.0.2.1", "andere@test.example")).status).toBe(429);
    expect((await versuch(SETUP_TOKEN, "192.0.2.2", "andere@test.example")).status).toBe(201);
  });
});

describe("Registrierung, Anmeldung und Abmeldung", () => {
  it("Registrierung über Better Auth ist geschlossen; die erste Person richtet die Installation über /setup ein, danach ist auch das zu", async () => {
    await starteEinrichtung(SETUP_TOKEN);
    const t = erstelleTestApp(db);
    const zu = await roh(t, "/auth/sign-up/email", { body: { name: "Erste Person", email: "erste@test.example", password: TESTPASSWORT } });
    expect(zu.status).toBeGreaterThanOrEqual(400); // disableSignUp der Bibliothek
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM benutzer`)).rows[0]).toEqual({ n: 0 });
    expect((await json(await roh(t, "/environment"))).setupOpen).toBe(true);

    const erste = await roh(t, "/setup", { body: { token: SETUP_TOKEN, name: "Erste Person", email: "erste@test.example", password: TESTPASSWORT } });
    expect(erste.status).toBe(201);
    const melde = await melden(t, "erste@test.example");
    const cookie = cookieKopf(melde.headers.getSetCookie());
    const ich = await json(await roh(t, "/me", { cookie }));
    expect(ich).toMatchObject({ email: "erste@test.example", globalAdmin: true, technicalUser: false, twoFactorEnabled: false, twoFactorSetupRequired: true });

    expect((await json(await roh(t, "/environment"))).setupOpen).toBe(false);
    const zweite = await roh(t, "/setup", { body: { token: SETUP_TOKEN, name: "Zweite Person", email: "zweite@test.example", password: TESTPASSWORT } });
    expect(zweite.status).toBe(403);
    expect((await json(zweite)).error.code).toBe("registration_closed");
  });

  it("gleichzeitige Einrichtungen ergeben genau eine Verwalterin", async () => {
    await starteEinrichtung(SETUP_TOKEN);
    const t = erstelleTestApp(db);
    const antworten = await Promise.all([1, 2, 3, 4].map((n) => roh(t, "/setup", { body: { token: SETUP_TOKEN, name: `Person ${n}`, email: `p${n}@test.example`, password: TESTPASSWORT } })));
    expect(antworten.filter((a) => a.status === 201)).toHaveLength(1);
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM benutzer`)).rows[0]).toEqual({ n: 1 });
  });

  it("offene Registrierung setzt eine abgeschlossene Einrichtung voraus und vergibt keine Verwaltung", async () => {
    await starteEinrichtung(SETUP_TOKEN);
    const t = erstelleTestApp(db, { registrierungOffen: true });
    const erste = await roh(t, "/auth/sign-up/email", { body: { name: "Erste Person", email: "erste@test.example", password: TESTPASSWORT } });
    expect(erste.status).toBe(403);
    expect((await roh(t, "/setup", { body: { token: SETUP_TOKEN, name: "Erste Person", email: "erste@test.example", password: TESTPASSWORT } })).status).toBe(201);
    const zweite = await roh(t, "/auth/sign-up/email", { body: { name: "Zweite Person", email: "zweite@test.example", password: TESTPASSWORT } });
    expect(zweite.status).toBe(200);
    const ich = await json(await roh(t, "/me", { cookie: cookieKopf(zweite.headers.getSetCookie()) }));
    expect(ich).toMatchObject({ email: "zweite@test.example", globalAdmin: false, roles: [] });
  });

  it("zu kurze Passwörter werden abgelehnt", async () => {
    const t = erstelleTestApp(db);
    const antwort = await roh(t, "/auth/sign-up/email", { body: { name: "Erste Person", email: "erste@test.example", password: "kurz" } });
    expect(antwort.status).toBe(400);
  });

  it("melden an, abmelden beendet die Sitzung", async () => {
    const t = erstelleTestApp(db);
    const p = person("anna", { zweiFaktor: false });
    await legePersonAn(db, p);
    const antwort = await melden(t, p.email);
    expect(antwort.status).toBe(200);
    const cookie = cookieKopf(antwort.headers.getSetCookie());
    expect((await roh(t, "/me", { cookie })).status).toBe(200);

    const raus = await roh(t, "/auth/sign-out", { body: {}, cookie });
    expect(raus.status).toBe(200);
    expect((await roh(t, "/me", { cookie })).status).toBe(401); // das Sitzungstoken ist serverseitig ungültig
  });

  it("falsches Passwort oder unbekannte Adresse: 401 ohne Sitzung", async () => {
    const t = erstelleTestApp(db);
    const p = person("anna", { zweiFaktor: false });
    await legePersonAn(db, p);
    for (const [email, passwort] of [[p.email, "falsches-Passwort-123"], ["niemand@test.example", TESTPASSWORT]] as const) {
      const antwort = await melden(t, email, passwort);
      expect(antwort.status).toBe(401);
      expect(antwort.headers.getSetCookie().some((c) => c.includes("session_token"))).toBe(false);
    }
  });

  it("gesperrte Benutzer (aktiv = false) kommen mit einer vorhandenen Sitzung nicht mehr durch", async () => {
    const t = erstelleTestApp(db);
    const p = person("anna", { zweiFaktor: false });
    await legePersonAn(db, p);
    const cookie = cookieKopf((await melden(t, p.email)).headers.getSetCookie());
    expect((await roh(t, "/me", { cookie })).status).toBe(200);
    await db.execute(sql`UPDATE benutzer SET aktiv = false WHERE email = ${p.email}`);
    expect((await roh(t, "/me", { cookie })).status).toBe(401);
  });

  it("Cookies sind httpOnly und SameSite=Lax; Secure gilt nur bei https-Ursprung (nicht auf localhost)", async () => {
    const p = person("anna", { zweiFaktor: false });
    await legePersonAn(db, p);
    const lokal = await melden(erstelleTestApp(db), p.email);
    const cookieLokal = lokal.headers.getSetCookie().find((c) => c.includes("session_token"))!;
    expect(cookieLokal).toMatch(/HttpOnly/i);
    expect(cookieLokal).toMatch(/SameSite=Lax/i);
    expect(cookieLokal).not.toMatch(/Secure/i);

    const sicher = erstelleTestApp(db, { appOrigins: ["https://fonds.beispiel.example"] });
    const antwort = await sicher.app.request("/api/v1/auth/sign-in/email", {
      method: "POST",
      headers: jsonKopf(undefined, "https://fonds.beispiel.example"),
      body: JSON.stringify({ email: p.email, password: TESTPASSWORT }),
    });
    const cookieSicher = antwort.headers.getSetCookie().find((c) => c.includes("session_token"))!;
    expect(cookieSicher).toMatch(/HttpOnly/i);
    expect(cookieSicher).toMatch(/SameSite=Lax/i);
    expect(cookieSicher).toMatch(/Secure/i);
    expect(cookieSicher).toMatch(/^__Secure-/);
  });
});

describe("Abweichende Pfadschreibweisen umgehen weder die Registrierungssperre noch die Begrenzung", () => {
  const post = (t: ReturnType<typeof erstelleTestApp>, pfad: string, body: unknown, kopf: Record<string, string> = {}) =>
    t.app.request(`/api/v1${pfad}`, { method: "POST", headers: { ...kopf }, body: JSON.stringify(body) });

  it("Registrierung bei geschlossener Registrierung: keine Variante legt einen Benutzer an", async () => {
    const t = erstelleTestApp(db);
    await starteEinrichtung(SETUP_TOKEN);
    await roh(t, "/setup", { body: { token: SETUP_TOKEN, name: "Erste Person", email: "erste@test.example", password: TESTPASSWORT } });
    const eindringling = { name: "Eindringling", email: "eindringling@test.example", password: TESTPASSWORT };
    for (const variante of ["/auth/sign-up/email", "/auth/sign-up/email/", "/auth//sign-up/email", "/auth/SIGN-UP/email", "/auth/sign-up%2Femail", "/auth/sign-up/%65mail"]) {
      expect((await post(t, variante, eindringling, jsonKopf())).status, variante).toBeGreaterThanOrEqual(400);
    }
    expect((await db.execute(sql`SELECT count(*)::int AS n FROM benutzer WHERE email = 'eindringling@test.example'`)).rows[0]).toEqual({ n: 0 });
    // Nicht kanonische Schreibweisen kommen gar nicht erst bei Better Auth an.
    for (const variante of ["/auth/sign-up/email/", "/auth//sign-up/email", "/auth/SIGN-UP/email", "/auth/sign-up%2Femail", "/auth/sign-up/%65mail"]) {
      expect((await post(t, variante, {}, jsonKopf())).status, variante).toBe(404);
    }
  });

  it("Anmeldung: nach 10 Fehlversuchen gilt die Sperre auch für jede Schreibweise des Pfads, richtige Daten helfen nicht", async () => {
    const t = erstelleTestApp(db, { proxyVertrauen: true });
    const p = person("anna", { zweiFaktor: false });
    await legePersonAn(db, p);
    const ip = { "X-Forwarded-For": "203.0.113.50" };
    for (let i = 0; i < 10; i++) expect((await melden(t, p.email, "falsches-Passwort-123", ip)).status).toBe(401);
    for (const variante of ["/auth/sign-in/email/", "/auth//sign-in/email", "/auth/SIGN-IN/email", "/auth/sign-in%2Femail", "/auth/sign-in/%65mail"]) {
      const antwort = await post(t, variante, { email: p.email, password: TESTPASSWORT }, { ...jsonKopf(), ...ip });
      expect([404, 429], variante).toContain(antwort.status);
      expect(antwort.headers.getSetCookie().some((c) => c.includes("session_token")), variante).toBe(false);
    }
    const gesperrt = await melden(t, p.email, TESTPASSWORT, ip);
    expect(gesperrt.status).toBe(429);
    expect((await json(gesperrt)).error.code).toBe("too_many_attempts");
  });

  it("zweiter Faktor: die Begrenzung hängt am normalisierten Pfad der Bibliothek, nicht am Rohpfad", async () => {
    const t = erstelleTestApp(db, { proxyVertrauen: true });
    const p = person("anna", { globalVerwalter: true });
    await legePersonAn(db, p);
    const ip = { "X-Forwarded-For": "203.0.113.51" };
    const zwischen = cookieKopf((await melden(t, p.email, TESTPASSWORT, ip)).headers.getSetCookie());
    const falsch = totpCode(TESTGEHEIMNIS) === "000000" ? "111111" : "000000";
    for (let i = 0; i < 10; i++) await roh(t, "/auth/two-factor/verify-totp", { body: { code: falsch }, cookie: zwischen, kopf: ip });
    for (const variante of ["/auth/two-factor/verify-totp/", "/auth/TWO-FACTOR/verify-totp", "/auth/two-factor%2Fverify-totp", "/auth//two-factor/verify-totp"]) {
      const antwort = await post(t, variante, { code: totpCode(TESTGEHEIMNIS) }, { ...jsonKopf(zwischen), ...ip });
      expect([404, 429], variante).toContain(antwort.status);
    }
    expect((await roh(t, "/auth/two-factor/verify-totp", { body: { code: totpCode(TESTGEHEIMNIS) }, cookie: zwischen, kopf: ip })).status).toBe(429);
  });

  it("zweiter Faktor mit trustDevice: das Mitsenden umgeht die Sperre nicht (TOTP und Wiederherstellungscode)", async () => {
    const t = erstelleTestApp(db, { proxyVertrauen: true });
    // Better Auth sperrt ein Konto selbst nach wenigen Fehlversuchen; die Begrenzung je IP zählt über Konten hinweg, deshalb 10 Konten.
    const konten = await Promise.all(
      Array.from({ length: 11 }, async (_, i) => {
        const p = person(`anna${i}`, { globalVerwalter: true });
        return { p, id: await legePersonAn(db, p) };
      }),
    );
    const falsch = totpCode(TESTGEHEIMNIS) === "000000" ? "111111" : "000000";
    const faelle = [
      { pfad: "/auth/two-factor/verify-totp", falsch: () => falsch, richtig: () => totpCode(TESTGEHEIMNIS), ip: "203.0.113.61" },
      { pfad: "/auth/two-factor/verify-backup-code", falsch: () => "ersatz-falsch", richtig: (id: string) => `ersatz-${id.slice(0, 8)}`, ip: "203.0.113.62" },
    ];
    for (const f of faelle) {
      const kopf = { "X-Forwarded-For": f.ip };
      const zwischenFuer = async (email: string) => cookieKopf((await melden(t, email, TESTPASSWORT, kopf)).headers.getSetCookie());
      for (const k of konten.slice(0, 10)) {
        const antwort = await roh(t, f.pfad, { body: { code: f.falsch(), trustDevice: true }, cookie: await zwischenFuer(k.p.email), kopf });
        expect([400, 401], f.pfad).toContain(antwort.status);
      }
      const letzte = konten[10]!;
      for (const trustDevice of [true, false, undefined]) {
        const gesperrt = await roh(t, f.pfad, { body: { code: f.richtig(letzte.id), trustDevice }, cookie: await zwischenFuer(letzte.p.email), kopf });
        expect(gesperrt.status, f.pfad).toBe(429);
        expect((await json(gesperrt)).error.code, f.pfad).toBe("too_many_attempts");
        expect(gesperrt.headers.getSetCookie().some((c) => c.includes("session_token")), f.pfad).toBe(false);
      }
    }
  });

  it("nicht benutzte Wege des zweiten Faktors (Code per E-Mail, TOTP-Adresse, neue Wiederherstellungscodes, Abschalten) antworten 404", async () => {
    const t = erstelleTestApp(db);
    const p = person("otp-anna", { globalVerwalter: true });
    await legePersonAn(db, p);
    const zwischen = cookieKopf((await melden(t, p.email)).headers.getSetCookie());
    for (const pfad of ["verify-otp", "send-otp", "get-totp-uri", "generate-backup-codes", "disable"]) {
      for (const trustDevice of [true, undefined]) {
        const antwort = await roh(t, `/auth/two-factor/${pfad}`, { body: { code: "123456", password: TESTPASSWORT, trustDevice }, cookie: zwischen });
        expect(antwort.status, pfad).toBe(404);
        expect(antwort.headers.getSetCookie().some((c) => c.includes("session_token") || c.includes("trust_device")), pfad).toBe(false);
      }
    }
    // Die benutzten Wege bleiben offen.
    const ok = await roh(t, "/auth/two-factor/verify-totp", { body: { code: totpCode(TESTGEHEIMNIS) }, cookie: zwischen });
    expect(ok.status).toBe(200);
  });

  it("ein vom Client gesendeter interner IP-Kopf ändert die Zuordnung nicht", async () => {
    const t = erstelleTestApp(db, { proxyVertrauen: false });
    for (let i = 0; i < 10; i++) await melden(t, `niemand${i}@test.example`, "falsches-Passwort-123", { "x-carraway-ip": `198.51.100.${i}` });
    expect((await melden(t, "noch-einer@test.example", "falsches-Passwort-123", { "x-carraway-ip": "198.51.100.99" })).status).toBe(429);
  });
});

describe("Zweiter Faktor (TOTP)", () => {
  it("ohne zweiten Faktor: Anmeldung gelingt, jede Route außer /me und der Einrichtung liefert 403 two_factor_required", async () => {
    const t = erstelleTestApp(db);
    const p = person("anna", { zweiFaktor: false, globalVerwalter: true });
    await legePersonAn(db, p);
    const cookie = cookieKopf((await melden(t, p.email)).headers.getSetCookie());
    expect(await json(await roh(t, "/me", { cookie }))).toMatchObject({ twoFactorEnabled: false, twoFactorSetupRequired: true });
    for (const pfad of ["/funds", "/deals", "/users", "/organizations"]) {
      const antwort = await roh(t, pfad, { cookie });
      expect(antwort.status, pfad).toBe(403);
      expect((await json(antwort)).error.code, pfad).toBe("two_factor_required");
    }
    // Die Einrichtung selbst bleibt erreichbar.
    const einrichten = await roh(t, "/auth/two-factor/enable", { body: { password: TESTPASSWORT }, cookie });
    expect(einrichten.status).toBe(200);
  });

  it("Einrichtung: Geheimnis aus der URI, falscher Code scheitert, richtiger Code schaltet den Zugang frei, danach verlangt die Anmeldung den Code", async () => {
    const t = erstelleTestApp(db);
    const p = person("anna", { zweiFaktor: false, globalVerwalter: true });
    await legePersonAn(db, p);
    let cookie = cookieKopf((await melden(t, p.email)).headers.getSetCookie());

    const einrichten = await json(await roh(t, "/auth/two-factor/enable", { body: { password: TESTPASSWORT }, cookie }));
    expect(einrichten.backupCodes.length).toBeGreaterThan(0);
    // Der Aussteller erscheint in der Authenticator-App.
    expect(new URL(einrichten.totpURI).searchParams.get("issuer")).toBe("Carraway");
    const geheimnis = new URL(einrichten.totpURI).searchParams.get("secret")!;
    expect(base32Dekodieren(geheimnis).length).toBeGreaterThanOrEqual(20);

    const falsch = await roh(t, "/auth/two-factor/verify-totp", { body: { code: "000000" === totpCode(geheimnis) ? "111111" : "000000" }, cookie });
    expect(falsch.status).toBe(401);
    expect((await roh(t, "/funds", { cookie })).status).toBe(403);

    const richtig = await roh(t, "/auth/two-factor/verify-totp", { body: { code: totpCode(geheimnis) }, cookie });
    expect(richtig.status).toBe(200);
    cookie = cookieKopf(richtig.headers.getSetCookie());
    expect(await json(await roh(t, "/me", { cookie }))).toMatchObject({ twoFactorEnabled: true, twoFactorSetupRequired: false });
    expect((await roh(t, "/funds", { cookie })).status).toBe(200);

    // Neue Anmeldung: erst Passwort, dann Code.
    const anmeldung = await melden(t, p.email);
    expect(await json(anmeldung)).toMatchObject({ twoFactorRedirect: true });
    const zwischen = cookieKopf(anmeldung.headers.getSetCookie());
    expect((await roh(t, "/funds", { cookie: zwischen })).status).toBe(401); // noch keine Sitzung
    const mitCode = await roh(t, "/auth/two-factor/verify-totp", { body: { code: totpCode(geheimnis) }, cookie: zwischen });
    expect(mitCode.status).toBe(200);
    expect((await roh(t, "/funds", { cookie: cookieKopf(mitCode.headers.getSetCookie()) })).status).toBe(200);
  });

  it("TOTP-Codes nach RFC 6238: Testvektor und Anmeldung mit dem berechneten Code; ein Code aus einem weit entfernten Zeitfenster gilt nicht", async () => {
    // RFC 6238, Anhang B (SHA-1, Geheimnis „12345678901234567890“, auf sechs Stellen gekürzt): Zeit 59 → 287082, 1111111109 → 081804.
    const rfc = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    expect(totpCode(rfc, 0, 59_000)).toBe("287082");
    expect(totpCode(rfc, 0, 1_111_111_109_000)).toBe("081804");

    const t = erstelleTestApp(db);
    const p = person("anna", { globalVerwalter: true });
    await legePersonAn(db, p);
    expect((await meldeAn(t.app, p)).length).toBeGreaterThan(0);

    const anmeldung = await melden(t, p.email);
    const zwischen = cookieKopf(anmeldung.headers.getSetCookie());
    const weitWeg = await roh(t, "/auth/two-factor/verify-totp", { body: { code: totpCode(TESTGEHEIMNIS, 20) }, cookie: zwischen });
    expect(weitWeg.status).toBe(401);
  });

  it("ein Wiederherstellungscode ersetzt den TOTP-Code genau einmal", async () => {
    const t = erstelleTestApp(db);
    const p = person("anna", { globalVerwalter: true });
    const id = await legePersonAn(db, p);
    const code = `ersatz-${id.slice(0, 8)}`;
    const zwischen = cookieKopf((await melden(t, p.email)).headers.getSetCookie());
    const erster = await roh(t, "/auth/two-factor/verify-backup-code", { body: { code }, cookie: zwischen });
    expect(erster.status).toBe(200);
    const zwischen2 = cookieKopf((await melden(t, p.email)).headers.getSetCookie());
    expect((await roh(t, "/auth/two-factor/verify-backup-code", { body: { code }, cookie: zwischen2 })).status).toBe(401);
  });

  it("ZWEI_FAKTOR_PFLICHT=false (Bereitstellung): Personen ohne zweiten Faktor kommen direkt durch", async () => {
    const t = erstelleTestApp(db, { zweiFaktorPflicht: false });
    const p = person("anna", { zweiFaktor: false, globalVerwalter: true });
    await legePersonAn(db, p);
    const cookie = cookieKopf((await melden(t, p.email)).headers.getSetCookie());
    expect((await roh(t, "/funds", { cookie })).status).toBe(200);
    expect(await json(await roh(t, "/me", { cookie }))).toMatchObject({ twoFactorSetupRequired: false });
  });

  it("wer nur über OIDC kommt (kein Passwort-Zugang), braucht bei uns keinen zweiten Faktor; wer ein Passwort hat, schon", () => {
    const pflicht = { zweiFaktorPflicht: true };
    expect(istZweiFaktorOffen(pflicht, { zweiFaktorAktiv: false, hatPasswort: true })).toBe(true);
    expect(istZweiFaktorOffen(pflicht, { zweiFaktorAktiv: false, hatPasswort: false })).toBe(false);
    expect(istZweiFaktorOffen(pflicht, { zweiFaktorAktiv: true, hatPasswort: true })).toBe(false);
    expect(istZweiFaktorOffen({ zweiFaktorPflicht: false }, { zweiFaktorAktiv: false, hatPasswort: true })).toBe(false);
  });
});

describe("Begrenzung der Fehlversuche", () => {
  const ip = (n: number) => ({ "X-Forwarded-For": `203.0.113.${n}` });

  it("nach 10 Fehlversuchen je Konto: 429 too_many_attempts, auch von anderen Adressen und auch mit richtigem Passwort", async () => {
    const t = erstelleTestApp(db, { proxyVertrauen: true });
    const p = person("anna", { zweiFaktor: false });
    await legePersonAn(db, p);
    for (let i = 0; i < 10; i++) expect((await melden(t, p.email, "falsches-Passwort-123", ip(i + 1))).status).toBe(401);
    const gesperrt = await melden(t, p.email, TESTPASSWORT, ip(200));
    expect(gesperrt.status).toBe(429);
    expect((await json(gesperrt)).error.code).toBe("too_many_attempts");
    expect(gesperrt.headers.get("Retry-After")).toBe("900");
    // Ein anderes Konto von einer anderen Adresse ist nicht betroffen.
    const q = person("berta", { zweiFaktor: false });
    await legePersonAn(db, q);
    expect((await melden(t, q.email, TESTPASSWORT, ip(201))).status).toBe(200);
  });

  it("nach 10 Fehlversuchen je IP-Adresse (verschiedene Konten): 429 für diese Adresse", async () => {
    const t = erstelleTestApp(db, { proxyVertrauen: true });
    const p = person("anna", { zweiFaktor: false });
    await legePersonAn(db, p);
    for (let i = 0; i < 10; i++) expect((await melden(t, `niemand${i}@test.example`, "falsches-Passwort-123", ip(7))).status).toBe(401);
    expect((await melden(t, p.email, TESTPASSWORT, ip(7))).status).toBe(429);
    expect((await melden(t, p.email, TESTPASSWORT, ip(8))).status).toBe(200);
  });

  it("prüft die Grenze beim Bestätigen des Passworts je Sitzungskonto und IP", async () => {
    const t = erstelleTestApp(db, { proxyVertrauen: true, anmeldeLimit: { versuche: 1, fensterMs: 60_000 } });
    const p = person("passwort-pruefen", { zweiFaktor: false });
    await legePersonAn(db, p);
    const cookie = await meldeAn(t.app, p);
    const pruefen = (nr: number) => roh(t, "/auth/verify-password", { cookie, body: { password: TESTPASSWORT }, kopf: ip(nr) });
    expect((await pruefen(1)).status).toBe(200);
    const versuche = await Promise.all([1, 2].map(() => roh(t, "/auth/verify-password", { cookie, body: { password: "abweichend" }, kopf: ip(1) })));
    expect(versuche.map(v => v.status).sort()).toEqual([400, 429]);
    expect((await pruefen(2)).status).toBe(429);
    expect((await db.execute(sql`SELECT schluessel FROM anmeldeversuch ORDER BY schluessel`)).rows).toEqual([
      { schluessel: "ip:203.0.113.1" }, { schluessel: `konto:${p.email}` },
    ]);
    expect((await roh(t, "/auth/verify-password/", { cookie, body: { password: TESTPASSWORT } })).status).toBe(404);
  });

  it("Fehlversuche beim zweiten Faktor zählen je IP-Adresse ebenfalls", async () => {
    const t = erstelleTestApp(db, { proxyVertrauen: true });
    const p = person("anna", { globalVerwalter: true });
    await legePersonAn(db, p);
    const zwischen = cookieKopf((await melden(t, p.email, TESTPASSWORT, ip(9))).headers.getSetCookie());
    const falsch = totpCode(TESTGEHEIMNIS) === "000000" ? "111111" : "000000";
    let letzte = 0;
    for (let i = 0; i < 12; i++) letzte = (await roh(t, "/auth/two-factor/verify-totp", { body: { code: falsch }, cookie: zwischen, kopf: ip(9) })).status;
    expect(letzte).toBe(429);
  });

  it("Wege mit Passwortprüfung (Einrichten des zweiten Faktors, Passwort ändern) zählen in dieselbe Begrenzung: nach 10 falschen Passwörtern 429", async () => {
    for (const [pfad, ipNr, koerper] of [
      ["/auth/two-factor/enable", 31, (falsch: string) => ({ password: falsch })],
      ["/auth/change-password", 32, (falsch: string) => ({ currentPassword: falsch, newPassword: "Neues-Passwort-nur-lokal-2" })], // gitleaks:allow
    ] as const) {
      const t = erstelleTestApp(db, { proxyVertrauen: true });
      const p = person(`passwort${ipNr}`, { zweiFaktor: false });
      await legePersonAn(db, p);
      const kopf = ip(ipNr);
      const cookie = cookieKopf((await melden(t, p.email, TESTPASSWORT, kopf)).headers.getSetCookie());
      for (let i = 0; i < 10; i++) {
        const antwort = await roh(t, pfad, { body: koerper("falsches-Passwort-123"), cookie, kopf });
        expect([400, 401], pfad).toContain(antwort.status);
      }
      const gesperrt = await roh(t, pfad, { body: koerper(TESTPASSWORT), cookie, kopf });
      expect(gesperrt.status, pfad).toBe(429);
      expect((await json(gesperrt)).error.code, pfad).toBe("too_many_attempts");
    }
  });

  it("ohne vertrauenswürdigen Proxy wird X-Forwarded-For ignoriert (ein Client kann der Begrenzung nicht ausweichen)", async () => {
    const t = erstelleTestApp(db, { proxyVertrauen: false });
    for (let i = 0; i < 10; i++) await melden(t, `niemand${i}@test.example`, "falsches-Passwort-123", ip(i + 1));
    expect((await melden(t, "noch-einer@test.example", "falsches-Passwort-123", ip(99))).status).toBe(429);
  });
});

describe("CSRF: Ursprungsprüfung", () => {
  it("zustandsändernde Anfragen mit fremdem Origin: 403 origin_invalid, auch mit gültiger Sitzung", async () => {
    const t = erstelleTestApp(db);
    const antwort = await t.request("/organisationen", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Nordwind Technik", art: "unternehmen" }),
      origin: "https://boese.example",
    });
    expect(antwort.status).toBe(403);
    expect((await json(antwort)).error.code).toBe("origin_invalid");
    const anzahl = (await db.execute(sql`SELECT count(*)::int AS n FROM organisation`)).rows[0] as { n: number };
    expect(anzahl.n).toBe(0);
  });

  it("Cookie ohne Origin bei zustandsänderndem Aufruf wird abgelehnt; Lesen und der konfigurierte Ursprung gehen", async () => {
    const t = erstelleTestApp(db);
    const ohne = await t.request("/organisationen", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Nordwind Technik", art: "unternehmen" }),
      origin: null,
    });
    expect(ohne.status).toBe(403);
    expect((await t.request("/organisationen", { origin: "https://boese.example" })).status).toBe(200); // GET ändert nichts
    const gut = await t.request("/organisationen", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Nordwind Technik", art: "unternehmen" }),
    });
    expect(gut.status).toBe(201);
  });

  it("auch die Anmeldung selbst prüft den Ursprung", async () => {
    const t = erstelleTestApp(db);
    const p = person("anna", { zweiFaktor: false });
    await legePersonAn(db, p);
    const antwort = await roh(t, "/auth/sign-in/email", { body: { email: p.email, password: TESTPASSWORT }, origin: "https://boese.example" });
    expect(antwort.status).toBe(403);
  });

  it("mehrere erlaubte Ursprünge sind möglich", async () => {
    const t = erstelleTestApp(db, { appOrigins: [TESTORIGIN, "http://localhost:4173"] });
    const antwort = await t.request("/organisationen", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Nordwind Technik", art: "unternehmen" }),
      origin: "http://localhost:4173",
    });
    expect(antwort.status).toBe(201);
  });
});

describe("Umgebung", () => {
  it("GET /environment braucht keine Anmeldung und nennt Umgebung und Anmeldemöglichkeiten", async () => {
    const t = erstelleTestApp(db, { umgebung: "test" });
    const antwort = await t.request("/environment", { als: null });
    expect(antwort.status).toBe(200);
    expect(await json(antwort)).toEqual({
      environment: "test",
      setupOpen: expect.any(Boolean),
      pseudonymized: false,
      // Anmeldeanbieter (Single Sign-On) bringt nur die Erweiterung mit (ee/api/src/__tests__/sso.test.ts).
      signIn: { twoFactorRequired: true, registrationOpen: false, providers: [], passwordResetAvailable: false },
    });
    for (const [umgebung, erwartet] of [["demo", "demo"], ["echt", "production"]] as const) {
      expect((await json(await erstelleTestApp(db, { umgebung }).request("/environment", { als: null }))).environment).toBe(erwartet);
    }
  });

  it("GET /health bleibt ohne Anmeldung erreichbar", async () => {
    expect((await erstelleTestApp(db).request("/health", { als: null })).status).toBe(200);
  });
});

describe("Konfiguration", () => {
  it("Standardwerte: demo, lokaler Ursprung, Zwei-Faktor-Pflicht an, Registrierung zu", () => {
    const k = ladeKonfiguration({});
    expect(k).toMatchObject({ umgebung: "demo", appOrigins: ["http://localhost:5173"], zweiFaktorPflicht: true, registrierungOffen: false, proxyVertrauen: false });
    expect(k.anmeldeLimit).toEqual({ versuche: 10, fensterMs: 900_000 });
  });

  it("im Betrieb (NODE_ENV=production) muss die Umgebung benannt sein; unbekannte Werte werden abgelehnt", () => {
    expect(() => ladeKonfiguration({ NODE_ENV: "production" })).toThrow(KonfigurationsFehler);
    expect(() => ladeKonfiguration({ CARRAWAY_UMGEBUNG: "produktiv" })).toThrow(/ungültig/);
  });

  it("außerhalb von localhost ist ein eigenes Geheimnis Pflicht, auch in demo und test", () => {
    const hosted = { CARRAWAY_UMGEBUNG: "demo", APP_ORIGIN: "https://demo.beispiel.example" };
    expect(() => ladeKonfiguration(hosted)).toThrow(/BETTER_AUTH_SECRET/);
    expect(() => ladeKonfiguration({ ...hosted, CARRAWAY_UMGEBUNG: "test", BETTER_AUTH_SECRET: "kurz" })).toThrow(/BETTER_AUTH_SECRET/);
    expect(ladeKonfiguration({ ...hosted, BETTER_AUTH_SECRET: "y".repeat(40) }).geheimnis).toBe("y".repeat(40));
    expect(() => ladeKonfiguration({ APP_ORIGIN: "http://localhost:5173,https://demo.beispiel.example" })).toThrow(/BETTER_AUTH_SECRET/);
    expect(ladeKonfiguration({ APP_ORIGIN: "http://127.0.0.1:5173" }).umgebung).toBe("demo");
  });

  it("echt verlangt ein Geheimnis ab 32 Zeichen und https-Ursprünge", () => {
    const echt = { CARRAWAY_UMGEBUNG: "echt", APP_ORIGIN: "https://fonds.beispiel.example", BETTER_AUTH_SECRET: "x".repeat(32) };
    expect(ladeKonfiguration(echt)).toMatchObject({ umgebung: "echt", geheimnis: "x".repeat(32) });
    expect(() => ladeKonfiguration({ ...echt, BETTER_AUTH_SECRET: undefined })).toThrow(/BETTER_AUTH_SECRET/);
    expect(() => ladeKonfiguration({ ...echt, BETTER_AUTH_SECRET: "kurz" })).toThrow(/BETTER_AUTH_SECRET/);
    expect(() => ladeKonfiguration({ ...echt, APP_ORIGIN: "http://fonds.beispiel.example" })).toThrow(/https/);
  });

  it("ZWEI_FAKTOR_PFLICHT, PROXY_VERTRAUEN und REGISTRIERUNG_OFFEN lassen sich schalten", () => {
    expect(ladeKonfiguration({ ZWEI_FAKTOR_PFLICHT: "0", PROXY_VERTRAUEN: "1", REGISTRIERUNG_OFFEN: "true" })).toMatchObject({
      zweiFaktorPflicht: false,
      proxyVertrauen: true,
      registrierungOffen: true,
    });
  });
});
