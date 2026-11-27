import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { Schluesselring } from "../geheimnis/krypto";
import { rotiereGeheimnisse } from "../geheimnis/rotation";
import { gleicheAb } from "../postfach/sync";
import type { ImapVerbindung } from "../postfach/imap";
import { leseZugang, verschluesseleZugang } from "../postfach/zugang";
import { PostfachFehler, type Zugang } from "../postfach/typen";
import { FakeAnbieter } from "../postfach/fake";
import { json, leeren, oeffneTestdb } from "./hilfen";
import { erstelleTestApp, idVon, legeInvestorAn, legePersonAn, person, TESTORIGIN, type Testperson } from "./hilfen-auth";
import { erstelleFakeOAuth, liesAutorisierungsUrl, postfachKonfig } from "./hilfen-postfach";
import { grundbestand, ID } from "./hilfen-instrumente";

/**
 * Anbindung des Postfachs (Etappe 17): OAuth mit PKCE gegen einen Fake-Autorisierungsserver, Prüfung von `state` und `nonce`, verschlüsselte Tokens,
 * Erneuern und Schlüsselwechsel, IMAP-Anmeldung, Trennen und Rechte. Kein Test erreicht einen echten Host.
 */

const { db, pool } = oeffneTestdb();
const ring = new Schluesselring(randomBytes(32));
const RUECKRUF = `${TESTORIGIN}/api/v1/mailbox/callback`;

const anna = person("pf-anna", { rollen: { [ID.fonds]: "bearbeiter" } });
const bernd = person("pf-bernd", { rollen: { [ID.fonds]: "betrachter" } });
const verwalter = person("pf-verwalter", { globalVerwalter: true });
const ohneRolle = person("pf-ohne", { rollen: {} });
const investor = person("pf-investor");

let fake = erstelleFakeOAuth();
let t = erstelleTestApp(db, { schluessel: ring, postfach: postfachKonfig(), abrufer: fake.abrufer });

function neueApp(zusatz: Parameters<typeof erstelleTestApp>[1] = {}, oauth = fake) {
  return erstelleTestApp(db, { schluessel: ring, postfach: postfachKonfig(), abrufer: oauth.abrufer, ...zusatz });
}
const senden = (app: typeof t, methode: string) => (pfad: string, koerper?: unknown, als?: Testperson | null) =>
  app.request(pfad, { method: methode, headers: { "content-type": "application/json" }, body: koerper === undefined ? undefined : JSON.stringify(koerper), ...(als !== undefined ? { als } : {}) });
const post = (pfad: string, koerper?: unknown, als?: Testperson | null, app = t) => senden(app, "POST")(pfad, koerper, als);
const get = (pfad: string, als?: Testperson | null, app = t) => app.request(pfad, als !== undefined ? { als } : {});

/** Startet den Ablauf und gibt Anfrage und Code der Anbieterseite zurück (wie nach dem Klick auf „Zustimmen“). */
async function starte(als = anna, bereich: "mail" | "kalender" = "mail", app = t, oauth = fake) {
  const antwort = await post("/postfach/oauth/start", { anbieter: "microsoft", bereich, zustimmung: true }, als, app);
  expect(antwort.status, await antwort.clone().text()).toBe(200);
  const { url } = await json(antwort);
  return oauth.autorisiere(url);
}
const rueckruf = (code: string, state: string, als = anna, app = t) => get(`/postfach/rueckruf?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`, als, app);
const ziel = (antwort: Response) => new URL(antwort.headers.get("location")!);
const verbindungen = () => db.select().from(s.postfachVerbindung);

beforeEach(async () => {
  await grundbestand(db);
  fake = erstelleFakeOAuth();
  t = neueApp();
  for (const p of [anna, bernd, verwalter, ohneRolle]) await legePersonAn(db, p);
  await legeInvestorAn(db, investor, [ID.orgA]);
  await db.execute(sql`TRUNCATE TABLE postfach_verbindung, oauth_zustand CASCADE`);
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

describe("OAuth mit PKCE", () => {
  it("Start: Adresse des Anbieters mit nur lesenden Berechtigungen, PKCE S256, state und nonce; ohne Zustimmung geht nichts", async () => {
    expect((await post("/postfach/oauth/start", { anbieter: "microsoft", bereich: "mail" }, anna)).status).toBe(400);
    expect((await post("/postfach/oauth/start", { anbieter: "microsoft", bereich: "mail", zustimmung: false }, anna)).status).toBe(400);
    const roh = await post("/postfach/oauth/start", { anbieter: "microsoft", bereich: "mail", zustimmung: true }, anna);
    const { url } = await json(roh);
    expect(url.startsWith("https://login.fake.example/authorize?")).toBe(true);
    const a = liesAutorisierungsUrl(url);
    expect(a).toMatchObject({ clientId: "client-ms", redirectUri: RUECKRUF, challengeMethode: "S256" });
    expect(a.scope.split(" ")).toEqual(["openid", "email", "offline_access", "Mail.Read"]);
    expect(a.scope).not.toMatch(/ReadWrite|Send|Mail\.Read\.Shared/);
    expect(a.state.length).toBeGreaterThanOrEqual(43);
    expect(a.nonce.length).toBeGreaterThanOrEqual(43);
    expect(a.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // Der Kalender fragt nur `Calendars.Read`.
    const kal = liesAutorisierungsUrl((await json(await post("/postfach/oauth/start", { anbieter: "microsoft", bereich: "kalender", zustimmung: true }, anna))).url);
    expect(kal.scope.split(" ")).toEqual(["openid", "email", "offline_access", "Calendars.Read"]);
    // In der Datenbank stehen state und nonce nur als Hash, der Verifier nur verschlüsselt.
    const zeilen = (await db.execute(sql`SELECT * FROM oauth_zustand`)).rows as Record<string, unknown>[];
    expect(zeilen).toHaveLength(2); // die beiden gültigen Starts
    const alles = JSON.stringify(zeilen);
    expect(alles).not.toContain(a.state);
    expect(alles).not.toContain(a.nonce);
    expect(zeilen.every((z) => String(z.verifier_verschluesselt).startsWith("f1."))).toBe(true);
  });

  it("Rückruf: Code gegen Tokens, ID-Token geprüft, Verbindung gespeichert; Tokens nur verschlüsselt, nie in der Antwort", async () => {
    const { code, anfrage } = await starte();
    const antwort = await rueckruf(code, anfrage.state);
    expect(antwort.status).toBe(302);
    expect(ziel(antwort).origin).toBe(TESTORIGIN);
    expect(ziel(antwort).pathname).toBe("/settings/mailbox");
    expect(Object.fromEntries(ziel(antwort).searchParams)).toEqual({ result: "connected", section: "mail" });
    // Der Fake hat PKCE geprüft (Verifier passt zur Challenge); der Tausch kam genau einmal.
    expect(fake.aufrufe.filter((a) => a.felder.grant_type === "authorization_code")).toHaveLength(1);
    expect(fake.aufrufe[0]!.felder).toMatchObject({ client_id: "client-ms", redirect_uri: RUECKRUF });

    const [v] = await verbindungen();
    expect(v).toMatchObject({ bereich: "mail", anbieter: "microsoft", status: "verbunden", inhaltSpeichern: false });
    expect(v!.benutzerId).toBe(await idVon(db, anna));
    expect(v!.zugangVerschluesselt.startsWith("f1.")).toBe(true);
    expect(v!.zugangVerschluesselt).not.toContain("access-");
    const zugang = leseZugang(ring, v!.id, v!.zugangVerschluesselt);
    expect(zugang).toMatchObject({ art: "oauth", adresse: "owner@example.com" });
    if (zugang.art !== "oauth") throw new Error("OAuth erwartet");
    expect(zugang.accessToken).toMatch(/^access-/);
    expect(zugang.refreshToken).toMatch(/^refresh-/);

    const liste = await get("/postfach", anna);
    const text = await liste.text();
    expect(JSON.parse(text).connections[0]).toMatchObject({ scope: "mail", provider: "microsoft", address: "owner@example.com", status: "connected", lastSyncedAt: null });
    expect(text).not.toContain(zugang.accessToken);
    expect(text).not.toContain(zugang.refreshToken);
    expect(text).not.toMatch(/zugang|token/i);
    // Auch Protokoll und Vollexport-Tabellen führen weder Tokens noch Adresse.
    const protokoll = JSON.stringify((await db.execute(sql`SELECT aktion, vorher, nachher FROM aenderung WHERE tabelle = 'postfach_verbindung'`)).rows);
    expect(protokoll).toContain("verbinden");
    expect(protokoll).not.toContain(zugang.accessToken);
    expect(protokoll).not.toContain("owner@example.com");
  });

  it("ein falscher state wird abgelehnt und verbindet nichts; der echte bleibt davon unberührt", async () => {
    const { code, anfrage } = await starte();
    const falsch = await rueckruf(code, "voellig-falscher-state-wert");
    expect(Object.fromEntries(ziel(falsch).searchParams)).toEqual({ error: "mailbox_state_invalid" });
    expect(fake.aufrufe).toHaveLength(0); // der Code wurde gar nicht erst eingelöst
    expect(await verbindungen()).toHaveLength(0);
    const ohne = await get(`/postfach/rueckruf?code=${code}`, anna);
    expect(ziel(ohne).searchParams.get("error")).toBe("mailbox_state_invalid");
    // Mit dem richtigen state klappt es weiterhin.
    expect(ziel(await rueckruf(code, anfrage.state)).searchParams.get("result")).toBe("connected");
  });

  it("der state ist einmalig: eine Wiederholung scheitert, auch mit einem neuen Code", async () => {
    const { code, anfrage } = await starte();
    expect(ziel(await rueckruf(code, anfrage.state)).searchParams.get("result")).toBe("connected");
    const zweiterCode = fake.autorisiere(`https://login.fake.example/authorize?client_id=client-ms&redirect_uri=${encodeURIComponent(RUECKRUF)}&state=${anfrage.state}&nonce=${anfrage.nonce}&code_challenge=${anfrage.challenge}&code_challenge_method=S256&scope=x`).code;
    expect(ziel(await rueckruf(zweiterCode, anfrage.state)).searchParams.get("error")).toBe("mailbox_state_invalid");
    expect(await verbindungen()).toHaveLength(1);
  });

  it("der state ist an die Person gebunden: eine andere angemeldete Person kann ihn nicht einlösen, und er ist danach verbraucht", async () => {
    const { code, anfrage } = await starte(anna);
    const fremd = await rueckruf(code, anfrage.state, bernd);
    expect(ziel(fremd).searchParams.get("error")).toBe("mailbox_state_invalid");
    expect(await verbindungen()).toHaveLength(0);
    expect(fake.aufrufe).toHaveLength(0);
    expect(ziel(await rueckruf(code, anfrage.state, anna)).searchParams.get("error")).toBe("mailbox_state_invalid");
  });

  it("ein abgelaufener state wird abgelehnt", async () => {
    const { code, anfrage } = await starte();
    await db.execute(sql`UPDATE oauth_zustand SET ablauf = now() - interval '1 minute'`);
    expect(ziel(await rueckruf(code, anfrage.state)).searchParams.get("error")).toBe("mailbox_state_invalid");
    expect(await verbindungen()).toHaveLength(0);
  });

  it("ein ID-Token mit falscher nonce wird abgelehnt (keine Verbindung)", async () => {
    const boese = erstelleFakeOAuth({ falscheNonce: true });
    const app = neueApp({ abrufer: boese.abrufer }, boese);
    const { code, anfrage } = await starte(anna, "mail", app, boese);
    const antwort = await rueckruf(code, anfrage.state, anna, app);
    expect(Object.fromEntries(ziel(antwort).searchParams)).toEqual({ error: "mailbox_connection_failed", reason: "NONCE_UNGUELTIG" });
    expect(await verbindungen()).toHaveLength(0);
  });

  it("Ablehnung beim Anbieter, fehlendes Refresh-Token und fehlerhafter Code verbinden nichts", async () => {
    const a = await starte();
    const abgelehnt = await get(`/postfach/rueckruf?error=access_denied&state=${a.anfrage.state}`, anna);
    expect(ziel(abgelehnt).searchParams.get("error")).toBe("mailbox_connection_failed");
    const ohneRefresh = erstelleFakeOAuth({ ohneRefreshToken: true });
    const app2 = neueApp({ abrufer: ohneRefresh.abrufer }, ohneRefresh);
    const b = await starte(anna, "mail", app2, ohneRefresh);
    expect(ziel(await rueckruf(b.code, b.anfrage.state, anna, app2)).searchParams.get("reason")).toBe("REFRESH_TOKEN_FEHLT");
    const c = await starte();
    expect(ziel(await rueckruf("gefaelscht", c.anfrage.state)).searchParams.get("error")).toBe("mailbox_connection_failed");
    expect(await verbindungen()).toHaveLength(0);
  });

  it("ohne Schlüssel (secret_missing) und für nicht eingerichtete Anbieter (mailbox_provider_disabled) gibt es kein Verbinden", async () => {
    const ohneSchluessel = neueApp({ schluessel: undefined });
    const a = await post("/postfach/oauth/start", { anbieter: "microsoft", bereich: "mail", zustimmung: true }, anna, ohneSchluessel);
    expect(a.status).toBe(409);
    expect((await json(a)).error.code).toBe("secret_missing");
    const google = await post("/postfach/oauth/start", { anbieter: "google", bereich: "mail", zustimmung: true }, anna);
    expect(google.status).toBe(409);
    expect((await json(google)).error.code).toBe("mailbox_provider_disabled");
    expect((await get("/postfach", anna)).status).toBe(200);
    expect(await json(await get("/postfach", anna, ohneSchluessel))).toMatchObject({ schluesselVorhanden: false, anbieter: { microsoft: true, google: false, imap: true } });
  });

  it("ein neuer Ablauf ersetzt die bestehende Verbindung desselben Bereichs (eine je Person und Bereich)", async () => {
    const a = await starte();
    await rueckruf(a.code, a.anfrage.state);
    const b = await starte();
    await rueckruf(b.code, b.anfrage.state);
    expect(await verbindungen()).toHaveLength(1);
    const k = await starte(anna, "kalender");
    await rueckruf(k.code, k.anfrage.state);
    expect((await verbindungen()).map((v) => v.bereich).sort()).toEqual(["kalender", "mail"]);
  });
});

/** Eine fertig verbundene Postfach-Verbindung ohne den Umweg über OAuth. */
async function legeVerbindungAn(als: Testperson, zugang: Zugang, optionen: Partial<typeof s.postfachVerbindung.$inferInsert> = {}) {
  const id = crypto.randomUUID();
  await db.insert(s.postfachVerbindung).values({ id, benutzerId: await idVon(db, als), bereich: "mail", anbieter: "microsoft", zugangVerschluesselt: verschluesseleZugang(ring, id, zugang), ...optionen });
  return id;
}
const oauthZugang = (zusatz: Partial<Extract<Zugang, { art: "oauth" }>> = {}): Zugang => ({ art: "oauth", accessToken: "alt-access", refreshToken: "alt-refresh", ablaufMs: Date.now() + 3_600_000, adresse: "owner@example.com", ...zusatz });

describe("Erneuern der Tokens im Worker", () => {
  const opt = (anbieter: FakeAnbieter, oauth = fake) => ({ ring, konfig: postfachKonfig(), abrufer: oauth.abrufer, anbieter: async () => anbieter });

  it("ein abgelaufenes Zugriffstoken wird mit dem Refresh-Token erneuert, der neue Zugang sofort verschlüsselt gespeichert", async () => {
    // Das Refresh-Token muss beim Fake gültig sein: erst über den echten Ablauf verbinden, dann Ablauf in der Datenbank zurückdrehen.
    const a = await starte();
    await rueckruf(a.code, a.anfrage.state);
    const [v] = await verbindungen();
    const vorher = leseZugang(ring, v!.id, v!.zugangVerschluesselt);
    await db.update(s.postfachVerbindung).set({ zugangVerschluesselt: verschluesseleZugang(ring, v!.id, { ...vorher, ablaufMs: Date.now() - 1000 } as Zugang) });
    const anbieter = new FakeAnbieter();
    const e = await gleicheAb(db, opt(anbieter));
    expect(e).toMatchObject({ verbindungen: 1, fehler: 0 });
    expect(fake.aufrufe.filter((x) => x.felder.grant_type === "refresh_token")).toHaveLength(1);
    const [nachher] = await verbindungen();
    const neu = leseZugang(ring, nachher!.id, nachher!.zugangVerschluesselt);
    if (neu.art !== "oauth" || vorher.art !== "oauth") throw new Error("OAuth erwartet");
    expect(neu.accessToken).not.toBe(vorher.accessToken);
    expect(neu.refreshToken).not.toBe(vorher.refreshToken); // rotiert
    expect(neu.ablaufMs).toBeGreaterThan(Date.now());
    expect(nachher).toMatchObject({ status: "verbunden", letzterFehler: null });
    expect(nachher!.letzterAbgleichAm).toBeInstanceOf(Date);
    // Das alte Refresh-Token gilt beim Anbieter nicht mehr: wäre es noch einmal genutzt worden, würde der Fake ablehnen.
    expect(fake.refreshTokenAnzahl()).toBe(1);
  });

  it("zwei gleichzeitige Läufe gleichen dieselbe Verbindung nur einmal ab (rotierende Refresh-Tokens vertragen keinen Doppelaufruf)", async () => {
    const a = await starte();
    await rueckruf(a.code, a.anfrage.state);
    const [v] = await verbindungen();
    const z = leseZugang(ring, v!.id, v!.zugangVerschluesselt);
    await db.update(s.postfachVerbindung).set({ zugangVerschluesselt: verschluesseleZugang(ring, v!.id, { ...z, ablaufMs: 0 } as Zugang) });
    const anbieter = new FakeAnbieter();
    const [e1, e2] = await Promise.all([gleicheAb(db, opt(anbieter)), gleicheAb(db, opt(anbieter))]);
    expect(e1.verbindungen + e2.verbindungen).toBe(1);
    expect(fake.aufrufe.filter((x) => x.felder.grant_type === "refresh_token")).toHaveLength(1);
    expect((await verbindungen())[0]!.status).toBe("verbunden");
  });

  it("ein widerrufener Zugang setzt die Verbindung auf `erneut_anmelden` (nur Fehlercode) und wird nicht mehr abgeholt", async () => {
    const a = await starte();
    await rueckruf(a.code, a.anfrage.state);
    const [v] = await verbindungen();
    const z = leseZugang(ring, v!.id, v!.zugangVerschluesselt);
    await db.update(s.postfachVerbindung).set({ zugangVerschluesselt: verschluesseleZugang(ring, v!.id, { ...z, ablaufMs: 0 } as Zugang) });
    fake.widerrufeAlles();
    const zeilen: string[] = [];
    const e = await gleicheAb(db, { ...opt(new FakeAnbieter()), logger: (stufe, meldung, felder) => zeilen.push(JSON.stringify({ stufe, meldung, ...felder })) });
    expect(e).toMatchObject({ verbindungen: 1, fehler: 1 });
    expect((await verbindungen())[0]).toMatchObject({ status: "erneut_anmelden", letzterFehler: "ZUGANG_UNGUELTIG" });
    // Weder Tokens noch Adressen im Log.
    expect(zeilen.join("\n")).not.toMatch(/owner@example|access-|refresh-/);
    await db.update(s.postfachVerbindung).set({ naechsterAbgleichAm: new Date(0), gesperrtBis: null });
    expect((await gleicheAb(db, opt(new FakeAnbieter()))).verbindungen).toBe(0);
    expect((await json(await get("/postfach", anna))).verbindungen[0]).toMatchObject({ status: "erneut_anmelden", letzterFehler: "ZUGANG_UNGUELTIG" });
  });

  it("ein vorübergehender Fehler des Anbieters merkt sich nur den Code und versucht es später erneut", async () => {
    await legeVerbindungAn(anna, oauthZugang());
    const anbieter = new FakeAnbieter();
    anbieter.fehler = new PostfachFehler("ANBIETER_FEHLER_503");
    const e = await gleicheAb(db, opt(anbieter));
    expect(e.fehler).toBe(1);
    const [v] = await verbindungen();
    expect(v).toMatchObject({ status: "fehler", letzterFehler: "ANBIETER_FEHLER_503" });
    expect(v!.naechsterAbgleichAm.getTime()).toBeGreaterThan(Date.now() + 30 * 60_000);
  });
});

describe("Schlüsselwechsel", () => {
  it("alle Zugänge lassen sich mit dem neuen Schlüssel neu verschlüsseln; danach genügt der neue Schlüssel", async () => {
    const id = await legeVerbindungAn(anna, oauthZugang());
    // Der Ring kapselt den Schlüssel; für den Test wird ein Paar bekannter Schlüssel aufgebaut.
    const a = randomBytes(32);
    const b = randomBytes(32);
    const ringAlt = new Schluesselring(a);
    const ringWechsel = new Schluesselring(b, [a]);
    await db.update(s.postfachVerbindung).set({ zugangVerschluesselt: verschluesseleZugang(ringAlt, id, oauthZugang()) });
    await db.insert(s.mailAuftrag).values({ id: "00000000-0000-4000-8000-0000000000aa", empfaenger: "x@example.org", vorlage: "testmail", betreff: "t", inhaltVerschluesselt: ringAlt.verschluessele("{}", "mail_auftrag:00000000-0000-4000-8000-0000000000aa"), erstelltVon: "test" });
    const e = await rotiereGeheimnisse(db, ringWechsel);
    expect(e).toEqual({ neuVerschluesselt: 2, schonAktuell: 0, unlesbar: 0 });
    const [v] = await verbindungen();
    expect(v!.zugangVerschluesselt.split(".")[1]).toBe(ringWechsel.kennung);
    // Nur noch der neue Schlüssel nötig.
    expect(leseZugang(new Schluesselring(b), id, v!.zugangVerschluesselt)).toMatchObject({ adresse: "owner@example.com", accessToken: "alt-access" });
    // Zweiter Lauf: nichts mehr zu tun.
    expect(await rotiereGeheimnisse(db, ringWechsel)).toEqual({ neuVerschluesselt: 0, schonAktuell: 2, unlesbar: 0 });
    // Fehlt der alte Schlüssel, bleibt der Wert unberührt und wird als unlesbar gezählt.
    await db.update(s.postfachVerbindung).set({ zugangVerschluesselt: verschluesseleZugang(ringAlt, id, oauthZugang()) });
    const vorher = (await verbindungen())[0]!.zugangVerschluesselt;
    expect(await rotiereGeheimnisse(db, new Schluesselring(b))).toMatchObject({ unlesbar: 1 });
    expect((await verbindungen())[0]!.zugangVerschluesselt).toBe(vorher);
  });

  it("ein in eine andere Zeile kopierter Zugang lässt sich nicht entschlüsseln (Bindung an die Zeile)", async () => {
    const id1 = await legeVerbindungAn(anna, oauthZugang());
    const id2 = await legeVerbindungAn(bernd, oauthZugang());
    const [v1] = await db.select().from(s.postfachVerbindung).where(eq(s.postfachVerbindung.id, id1));
    expect(() => leseZugang(ring, id2, v1!.zugangVerschluesselt)).toThrow();
  });
});

describe("IMAP", () => {
  const eingabe = { host: "imap.example.org", port: 993, sicherheit: "tls", benutzer: "robot", passwort: "geheimes-passwort", adresse: "Owner@Example.org", zustimmung: true };
  const oeffentlich = async () => ["93.184.216.34"];
  const fabrikOk = (geoeffnet: string[] = []) => async (): Promise<ImapVerbindung> => ({
    oeffne: async (o) => {
      geoeffnet.push(o);
      return { uidValidity: "1" };
    },
    uidsNach: async () => [],
    uidsSeit: async () => [],
    koepfe: async () => [],
    rohtext: async () => "",
    schliesse: async () => undefined,
  });

  it("verbindet nach einer Probeverbindung; Zugang nur verschlüsselt, nie in der Antwort; Ordner werden geprüft", async () => {
    const geoeffnet: string[] = [];
    const app = neueApp({ imapFabrik: fabrikOk(geoeffnet), aufloeser: oeffentlich });
    const antwort = await post("/postfach/imap", { ...eingabe, ordner: ["INBOX", "Sent"], inhaltSpeichern: true }, anna, app);
    expect(antwort.status, await antwort.clone().text()).toBe(201);
    const text = await antwort.text();
    expect(JSON.parse(text)).toMatchObject({ scope: "mail", provider: "imap", address: "owner@example.org", status: "connected", storeContent: true });
    expect(text).not.toContain("geheimes-passwort");
    expect(geoeffnet).toEqual(["INBOX", "Sent"]);
    const [v] = await verbindungen();
    expect(v!.zugangVerschluesselt).not.toContain("geheimes");
    expect(leseZugang(ring, v!.id, v!.zugangVerschluesselt)).toMatchObject({ art: "imap", host: "imap.example.org", passwort: "geheimes-passwort", ordner: ["INBOX", "Sent"] });
    expect(JSON.stringify((await db.execute(sql`SELECT vorher, nachher FROM aenderung WHERE tabelle = 'postfach_verbindung'`)).rows)).not.toMatch(/geheimes|imap\.example|robot/);
  });

  it("Ziele in privaten und lokalen Bereichen sind verboten (auch über DNS); mit POSTFACH_PRIVATE_ZIELE erlaubt", async () => {
    const app = neueApp({ imapFabrik: fabrikOk(), aufloeser: async () => ["10.0.0.5"] });
    for (const host of ["127.0.0.1", "192.168.1.10", "169.254.169.254", "[::1]".slice(1, -1), "intern.example.org"]) {
      const antwort = await post("/postfach/imap", { ...eingabe, host }, anna, app);
      expect(antwort.status, host).toBe(400);
      expect((await json(antwort)).error.code).toBe("mailbox_target_forbidden");
    }
    expect(await verbindungen()).toHaveLength(0);
    const erlaubt = neueApp({ imapFabrik: fabrikOk(), aufloeser: async () => ["10.0.0.5"], postfach: postfachKonfig({ privateZiele: true }) });
    expect((await post("/postfach/imap", { ...eingabe, host: "intern.example.org" }, anna, erlaubt)).status).toBe(201);
  });

  it("falsches Passwort oder unerreichbarer Server: 502 mailbox_connection_failed, nichts gespeichert", async () => {
    const app = neueApp({
      imapFabrik: async () => {
        throw new PostfachFehler("ZUGANG_UNGUELTIG", true);
      },
      aufloeser: oeffentlich,
    });
    const antwort = await post("/postfach/imap", eingabe, anna, app);
    expect(antwort.status).toBe(502);
    expect((await json(antwort)).error.code).toBe("mailbox_connection_failed");
    expect(await verbindungen()).toHaveLength(0);
  });

  it("IMAP lässt sich abschalten; ohne Zustimmung und mit ungültigen Angaben gibt es 400", async () => {
    const aus = neueApp({ postfach: postfachKonfig({ imap: false }), imapFabrik: fabrikOk(), aufloeser: oeffentlich });
    const a = await post("/postfach/imap", eingabe, anna, aus);
    expect(a.status).toBe(409);
    expect((await json(a)).error.code).toBe("mailbox_provider_disabled");
    const app = neueApp({ imapFabrik: fabrikOk(), aufloeser: oeffentlich });
    for (const kaputt of [{ ...eingabe, zustimmung: false }, { ...eingabe, port: 0 }, { ...eingabe, adresse: "keine-adresse" }, { ...eingabe, sicherheit: "klar" }, { ...eingabe, zusatz: 1 }, { ...eingabe, ordner: [] }]) {
      expect((await post("/postfach/imap", kaputt, anna, app)).status).toBe(400);
    }
  });
});

describe("Eigene Verbindungen, Trennen, Rechte", () => {
  it("nur die eigenen: auch Verwalter sehen, ändern und trennen fremde Verbindungen nicht (404)", async () => {
    const id = await legeVerbindungAn(anna, oauthZugang());
    expect((await json(await get("/postfach", verwalter))).verbindungen).toEqual([]);
    expect((await json(await get("/postfach", bernd))).verbindungen).toEqual([]);
    for (const als of [verwalter, bernd]) {
      const patch = await senden(t, "PATCH")(`/postfach/${id}`, { inhaltSpeichern: true }, als);
      expect(patch.status).toBe(404);
      expect((await json(patch)).error.code).toBe("mailbox_not_found");
      expect((await post(`/postfach/${id}/abgleichen`, undefined, als)).status).toBe(404);
      expect((await senden(t, "DELETE")(`/postfach/${id}`, undefined, als)).status).toBe(404);
    }
    expect(await verbindungen()).toHaveLength(1);
    expect((await json(await get("/postfach", anna))).verbindungen).toHaveLength(1);
  });

  it("Datenschutz-Schalter: Textauszug nur für Postfächer, nur für die Person selbst; Abgleich anfordern", async () => {
    const id = await legeVerbindungAn(anna, oauthZugang());
    const kalender = await legeVerbindungAn(anna, oauthZugang(), { bereich: "kalender" });
    const an = await senden(t, "PATCH")(`/postfach/${id}`, { inhaltSpeichern: true }, anna);
    expect(await json(an)).toMatchObject({ inhaltSpeichern: true });
    expect((await senden(t, "PATCH")(`/postfach/${kalender}`, { inhaltSpeichern: true }, anna)).status).toBe(400);
    expect((await senden(t, "PATCH")(`/postfach/${id}`, { inhaltSpeichern: "ja" }, anna)).status).toBe(400);
    await db.update(s.postfachVerbindung).set({ naechsterAbgleichAm: new Date(Date.now() + 3_600_000) });
    expect((await post(`/postfach/${id}/abgleichen`, undefined, anna)).status).toBe(202);
    const [v] = await db.select().from(s.postfachVerbindung).where(eq(s.postfachVerbindung.id, id));
    expect(v!.naechsterAbgleichAm.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("Trennen löscht den Zugang vollständig; übernommene Aktivitäten bleiben", async () => {
    const id = await legeVerbindungAn(anna, oauthZugang());
    const [akt] = await db.insert(s.aktivitaet).values({ art: "mail", datum: "2026-01-01", titel: "Übernommene Mail", organisationId: ID.orgA }).returning();
    const antwort = await senden(t, "DELETE")(`/postfach/${id}`, undefined, anna);
    expect(antwort.status).toBe(204);
    expect(await verbindungen()).toHaveLength(0);
    expect(JSON.stringify((await db.execute(sql`SELECT * FROM postfach_verbindung`)).rows)).toBe("[]");
    expect(await db.select().from(s.aktivitaet).where(eq(s.aktivitaet.id, akt!.id))).toHaveLength(1);
    const protokoll = (await db.execute(sql`SELECT aktion, vorher FROM aenderung WHERE tabelle = 'postfach_verbindung' AND datensatz_id = ${id}`)).rows as { aktion: string; vorher: Record<string, unknown> }[];
    expect(protokoll).toEqual([{ aktion: "trennen", vorher: { bereich: "mail", anbieter: "microsoft" } }]);
  });

  it("Rechte: ohne Anmeldung 401, ohne Rolle 403, Investor-Benutzer portal_only, API-Schlüssel (technischer Benutzer) nicht", async () => {
    for (const [methode, pfad] of [["GET", "/postfach"], ["POST", "/postfach/oauth/start"], ["POST", "/postfach/imap"], ["GET", "/settings"]] as const) {
      const mit = (als: Testperson | null) => t.request(pfad, { method: methode, als, headers: { "content-type": "application/json" }, ...(methode === "POST" ? { body: "{}" } : {}) });
      expect((await mit(null)).status, `${pfad} anonym`).toBe(401);
      expect((await mit(ohneRolle)).status, `${pfad} ohne Rolle`).toBe(403);
      const inv = await mit(investor);
      expect(inv.status, `${pfad} Investor`).toBe(403);
      expect((await json(inv)).error.code).toBe("portal_only");
    }
    const schluessel = await json(await post("/api-keys", { name: "Lesen", scopes: [{ fundId: ID.fonds, permission: "read" }] }, verwalter));
    const mitSchluessel = await t.app.request("/api/v1/mailbox", { headers: { Authorization: `Bearer ${schluessel.key}` } });
    expect(mitSchluessel.status).toBe(403);
    expect((await json(mitSchluessel)).error.code).toBe("technical_user");
  });
});
