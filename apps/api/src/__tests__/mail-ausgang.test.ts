import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, onTestFinished } from "vitest";
import * as s from "@carraway/db";
import { erzeugeDemodaten, schreibeDemodaten } from "@carraway/db/demo";
import { DateiSpeicher } from "../berichte/speicher";
import { Schluesselring } from "../geheimnis/krypto";
import { MAX_VERSUCHE, verarbeiteMailAuftraege, WARTEZEIT_MINUTEN } from "../mail/auftraege";
import type { MailKonfiguration } from "../mail/konfiguration";
import { FakeMailer, MailFehler } from "../mail/mailer";
import { json, leeren, oeffneTestdb } from "./hilfen";
import { erstelleTestApp, idVon, legeInvestorAn, legePersonAn, person, TESTORIGIN, type Testperson } from "./hilfen-auth";
import { grundbestand, ID } from "./hilfen-instrumente";

/**
 * Ausgehende Mail (Etappe 17): Ausgangskorb, Wiederholung, Stundenlimit, Vorlagen mit Link, Protokoll ohne Inhalt, Auslöser (Kennzahlen-Link,
 * Mitteilung im Portal, Berichtsfreigabe) und Verwaltung. Es gibt keinen echten SMTP-Aufruf: Der Versand läuft über den `FakeMailer`.
 */

const { db, pool } = oeffneTestdb();
const ring = new Schluesselring(randomBytes(32));
const MAIL: MailKonfiguration = { host: "smtp.example.org", port: 25, tls: "keine", absender: "carraway@example.org", limitProStunde: 200 };
let speicherPfad = "";
let t: ReturnType<typeof erstelleTestApp>;
/** Dieselbe Datenbank, aber ohne Mail-Einrichtung. */
const ohneMail = erstelleTestApp(db, { mail: undefined });

const bearbeiter = person("mail-bearbeiter", { rollen: { [ID.fonds]: "bearbeiter" } });
const betrachter = person("mail-betrachter", { rollen: { [ID.fonds]: "betrachter" } });
const verwalter = person("mail-verwalter", { globalVerwalter: true });
const freigeber = person("mail-freigeber", { rollen: { [ID.fonds]: "freigeber" } });

const senden = (app: typeof t, methode: string) => (pfad: string, koerper?: unknown, als?: Testperson | null) =>
  app.request(pfad, { method: methode, headers: { "content-type": "application/json" }, body: koerper === undefined ? undefined : JSON.stringify(koerper), ...(als !== undefined ? { als } : {}) });
const post = (pfad: string, koerper?: unknown, als?: Testperson | null) => senden(t, "POST")(pfad, koerper, als);
const put = (pfad: string, koerper?: unknown, als?: Testperson | null) => senden(t, "PUT")(pfad, koerper, als);
const get = (pfad: string, als?: Testperson | null) => t.request(pfad, als !== undefined ? { als } : {});

const PERSON_A = "00000000-0000-4000-8000-0000000000e1"; // Kontakt der Organisation A mit Adresse
const PERSON_OHNE = "00000000-0000-4000-8000-0000000000e2"; // ohne Adresse
const PERSON_B = "00000000-0000-4000-8000-0000000000e3"; // Kontakt der Organisation B
const Q3 = { periodeBeginn: "2026-07-01", periodeEnde: "2026-09-30" };
const faellig = () => new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
const jetzt = (offsetMs = 0) => () => new Date(Date.now() + offsetMs);

const verarbeite = (mailer: FakeMailer, optionen: Partial<Parameters<typeof verarbeiteMailAuftraege>[1]> = {}) =>
  verarbeiteMailAuftraege(db, { mailer, ring, limitProStunde: 200, ...optionen });
const auftraege = async () => (await db.select().from(s.mailAuftrag).orderBy(s.mailAuftrag.erstelltAm)) as (typeof s.mailAuftrag.$inferSelect)[];

async function neueAbfrageMitMail(extra: object = {}, als = bearbeiter) {
  const antwort = await post(`/beteiligungen/${ID.eigen}/kennzahlen/abfragen`, { ...Q3, faelligAm: faellig(), schluessel: ["umsatz", "ebitda"], empfaengerPersonId: PERSON_A, ...extra }, als);
  return { antwort, daten: antwort.status === 201 ? await json(antwort) : await json(antwort) };
}

beforeAll(async () => {
  speicherPfad = await mkdtemp(join(tmpdir(), "carraway-mail-"));
  t = erstelleTestApp(db, { mail: MAIL, schluessel: ring, speicher: new DateiSpeicher(speicherPfad) });
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
  await rm(speicherPfad, { recursive: true, force: true });
});

describe("Ausgangskorb und Versand", () => {
  beforeEach(async () => {
    await grundbestand(db);
    await db.insert(s.person).values([
      { id: PERSON_A, vorname: "Anna", nachname: "Alpha", email: "anna@alpha.example.com", organisationId: ID.orgA },
      { id: PERSON_OHNE, vorname: "Olaf", nachname: "Ohne", email: null, organisationId: ID.orgA },
      { id: PERSON_B, vorname: "Bruno", nachname: "Beta", email: "bruno@beta.example.com", organisationId: ID.orgB },
    ]);
    for (const p of [bearbeiter, betrachter, verwalter, freigeber]) await legePersonAn(db, p);
  });

  it("Kennzahlen-Link per Mail: der Auftrag entsteht mit der Anfrage, der Link steht in der Mail und bleibt in der Antwort kopierbar", async () => {
    const { antwort, daten } = await neueAbfrageMitMail();
    expect(antwort.status).toBe(201);
    const token = daten.link.token as string;
    const [auftrag] = await auftraege();
    expect(auftrag).toMatchObject({ empfaenger: "anna@alpha.example.com", vorlage: "kennzahl_abfrage", status: "wartend", versuche: 0, sprache: "de", bezugArt: "kennzahl_abfrage", bezugId: daten.abfrage.id });
    // Im Korb steht der Inhalt nur verschlüsselt; der Klartext des Links ist nirgends in der Zeile.
    expect(auftrag!.inhaltVerschluesselt).toBeTruthy();
    expect(JSON.stringify(auftrag)).not.toContain(token);

    const mailer = new FakeMailer();
    expect(await verarbeite(mailer)).toMatchObject({ gesendet: 1, wiederholt: 0, fehlgeschlagen: 0 });
    expect(mailer.gesendet).toHaveLength(1);
    const m = mailer.gesendet[0]!;
    const link = `${TESTORIGIN}/external/requests/${token}`;
    expect(m.an).toBe("anna@alpha.example.com");
    expect(m.betreff).toBe("Kennzahlen-Abfrage: Alpha Beispiel");
    expect(m.text).toContain(link);
    expect(m.html).toContain(`href="${link}"`);
    expect(m.html).not.toMatch(/<img|<script|track/i);
    // Der Link aus der Mail funktioniert tatsächlich (öffentlicher Endpunkt).
    expect((await t.request(`/extern/abfragen/${token}`, { als: null })).status).toBe(200);

    const [fertig] = await auftraege();
    expect(fertig).toMatchObject({ status: "gesendet", versuche: 1, inhaltVerschluesselt: null, letzterFehler: null });
    expect(fertig!.gesendetAm).toBeInstanceOf(Date);
    // Ein zweiter Lauf sendet nichts mehr.
    expect(await verarbeite(mailer)).toMatchObject({ gesendet: 0 });
    expect(mailer.gesendet).toHaveLength(1);
  });

  it("Protokoll: Empfänger, Vorlage und Bezug stehen drin, nie Inhalt, Link oder Token", async () => {
    const { daten } = await neueAbfrageMitMail({ sprache: "en" });
    const token = daten.link.token as string;
    await verarbeite(new FakeMailer());
    const zeilen = (await db.execute(sql`SELECT aktion, vorher, nachher FROM aenderung WHERE tabelle = 'mail_auftrag' ORDER BY am, id`)).rows as { aktion: string; vorher: unknown; nachher: Record<string, unknown> }[];
    expect(zeilen.map((z) => z.aktion)).toEqual(["anlegen", "gesendet"]);
    for (const z of zeilen) expect(z.nachher).toMatchObject({ empfaenger: "anna@alpha.example.com", vorlage: "kennzahl_abfrage", bezugArt: "kennzahl_abfrage", bezugId: daten.abfrage.id });
    const alles = JSON.stringify(zeilen);
    expect(alles).not.toContain(token);
    expect(alles).not.toContain("external/requests");
    expect(alles).not.toMatch(/inhalt|html|betreff/i);
    // Auch die Änderungsabfrage und der Vollexport führen den Korb nicht.
    expect(await (await get("/changes?limit=1000", verwalter)).text()).not.toContain("mail_auftrag");
    // Sprache der Anfrage bestimmt die Sprache der Mail.
    expect((await auftraege())[0]!.sprache).toBe("en");
  });

  it("Empfänger: nur eine Person mit Adresse aus dem Unternehmen der Beteiligung; sonst 400 und keine Anfrage", async () => {
    for (const personId of [PERSON_OHNE, PERSON_B, "00000000-0000-4000-8000-0000000000ff"]) {
      const { antwort, daten } = await neueAbfrageMitMail({ empfaengerPersonId: personId });
      expect(antwort.status).toBe(400);
      expect(daten.error.code).toBe("mail_recipient_invalid");
    }
    expect(Number((await db.execute(sql`SELECT count(*)::int AS n FROM kennzahl_abfrage`)).rows[0]!.n)).toBe(0);
    expect(await auftraege()).toHaveLength(0);
  });

  it("ohne eingerichteten Versand: 409 mail_not_configured, und die Anfrage wird nicht angelegt", async () => {
    const antwort = await senden(ohneMail, "POST")(`/beteiligungen/${ID.eigen}/kennzahlen/abfragen`, { ...Q3, faelligAm: faellig(), schluessel: ["umsatz"], empfaengerPersonId: PERSON_A }, bearbeiter);
    expect(antwort.status).toBe(409);
    expect((await json(antwort)).error.code).toBe("mail_not_configured");
    expect(Number((await db.execute(sql`SELECT count(*)::int AS n FROM kennzahl_abfrage`)).rows[0]!.n)).toBe(0);
    // Ohne Mail geht die Anfrage wie bisher, der Link bleibt zum Kopieren.
    const ohne = await senden(ohneMail, "POST")(`/beteiligungen/${ID.eigen}/kennzahlen/abfragen`, { ...Q3, faelligAm: faellig(), schluessel: ["umsatz"] }, bearbeiter);
    expect(ohne.status).toBe(201);
    expect((await json(ohne)).link.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("Link später senden: neuer Link, der alte ist sofort ungültig; Betrachter dürfen es nicht", async () => {
    const roh = await post(`/beteiligungen/${ID.eigen}/kennzahlen/abfragen`, { ...Q3, faelligAm: faellig(), schluessel: ["umsatz"] }, bearbeiter);
    const { abfrage, link } = await json(roh);
    expect((await post(`/kennzahlen/abfragen/${abfrage.id}/per-mail`, { personId: PERSON_A }, betrachter)).status).toBe(403);
    const antwort = await post(`/kennzahlen/abfragen/${abfrage.id}/per-mail`, { personId: PERSON_A }, bearbeiter);
    expect(antwort.status).toBe(200);
    const neu = (await json(antwort)).link.token as string;
    expect(neu).not.toBe(link.token);
    expect((await t.request(`/extern/abfragen/${link.token}`, { als: null })).status).toBe(404);
    expect((await t.request(`/extern/abfragen/${neu}`, { als: null })).status).toBe(200);
    const mailer = new FakeMailer();
    await verarbeite(mailer);
    expect(mailer.gesendet[0]!.text).toContain(`/external/requests/${neu}`);
    expect(mailer.gesendet[0]!.text).not.toContain(link.token);
    // Eine widerrufene Anfrage bekommt keinen Link per Mail.
    await post(`/kennzahlen/abfragen/${abfrage.id}/widerrufen`, undefined, bearbeiter);
    expect((await post(`/kennzahlen/abfragen/${abfrage.id}/per-mail`, { personId: PERSON_A }, bearbeiter)).status).toBe(409);
  });

  it("Wiederholung mit Wartezeit und Obergrenze: vorübergehende Fehler werden wiederholt, danach endgültig fehlgeschlagen und der Inhalt gelöscht", async () => {
    await neueAbfrageMitMail();
    const mailer = new FakeMailer();
    mailer.fehler.push(new MailFehler("SMTP_ETIMEDOUT", false));
    expect(await verarbeite(mailer)).toMatchObject({ gesendet: 0, wiederholt: 1 });
    let [a] = await auftraege();
    expect(a).toMatchObject({ status: "wartend", versuche: 1, letzterFehler: "SMTP_ETIMEDOUT" });
    expect(a!.inhaltVerschluesselt).toBeTruthy();
    expect(a!.naechsterVersuchAm.getTime()).toBeGreaterThan(Date.now() + (WARTEZEIT_MINUTEN[0]! - 0.5) * 60_000);
    // Vor Ablauf der Wartezeit passiert nichts.
    expect(await verarbeite(mailer)).toMatchObject({ gesendet: 0, wiederholt: 0 });
    // Danach klappt es.
    expect(await verarbeite(mailer, { jetzt: jetzt(2 * 60_000) })).toMatchObject({ gesendet: 1 });
    [a] = await auftraege();
    expect(a).toMatchObject({ status: "gesendet", versuche: 2, letzterFehler: null });

    // Dauerhaft fehlerhaft: nach MAX_VERSUCHE Schluss.
    await db.delete(s.mailAuftrag);
    await db.execute(sql`TRUNCATE TABLE aenderung`);
    await neueAbfrageMitMail({ periodeBeginn: "2026-01-01", periodeEnde: "2026-03-31" });
    const kaputt = new FakeMailer();
    for (let i = 0; i < MAX_VERSUCHE; i++) kaputt.fehler.push(new MailFehler("SMTP_ECONNECTION", false));
    for (let i = 0; i < MAX_VERSUCHE; i++) await verarbeite(kaputt, { jetzt: jetzt((i + 1) * 3 * 3600_000) });
    [a] = await auftraege();
    expect(a).toMatchObject({ status: "fehlgeschlagen", versuche: MAX_VERSUCHE, letzterFehler: "SMTP_ECONNECTION", inhaltVerschluesselt: null });
    expect(kaputt.gesendet).toHaveLength(0);
    const protokoll = (await db.execute(sql`SELECT aktion FROM aenderung WHERE tabelle = 'mail_auftrag' ORDER BY am, id`)).rows.map((r) => r.aktion);
    expect(protokoll).toEqual(["anlegen", "fehlgeschlagen"]);
  });

  it("dauerhafte Fehler (Adresse abgelehnt) werden sofort beendet, ohne Wiederholung", async () => {
    await neueAbfrageMitMail();
    const mailer = new FakeMailer();
    mailer.fehler.push(new MailFehler("SMTP_550", true));
    expect(await verarbeite(mailer)).toMatchObject({ fehlgeschlagen: 1, wiederholt: 0 });
    expect((await auftraege())[0]).toMatchObject({ status: "fehlgeschlagen", versuche: 1, inhaltVerschluesselt: null });
  });

  it("Stundenlimit je Installation: darüber bleibt es liegen und geht in der nächsten Stunde raus", async () => {
    for (const periode of [["2026-01-01", "2026-03-31"], ["2026-04-01", "2026-06-30"], ["2026-07-01", "2026-09-30"]]) {
      await neueAbfrageMitMail({ periodeBeginn: periode[0], periodeEnde: periode[1] });
    }
    const mailer = new FakeMailer();
    const e = await verarbeite(mailer, { limitProStunde: 2 });
    expect(e).toMatchObject({ gesendet: 2, begrenzt: true });
    expect((await verarbeite(mailer, { limitProStunde: 2 })).gesendet).toBe(0);
    expect(mailer.gesendet).toHaveLength(2);
    expect((await auftraege()).filter((a) => a.status === "wartend")).toHaveLength(1);
    expect((await verarbeite(mailer, { limitProStunde: 2, jetzt: jetzt(61 * 60_000) })).gesendet).toBe(1);
  });

  it("Aufbewahrung: abgeschlossene Aufträge werden nach 90 Tagen gelöscht, wartende nie; das Protokoll bleibt", async () => {
    await neueAbfrageMitMail();
    await neueAbfrageMitMail({ periodeBeginn: "2026-01-01", periodeEnde: "2026-03-31" });
    const mailer = new FakeMailer();
    await verarbeite(mailer, { max: 1 });
    expect((await auftraege()).map((a) => a.status).sort()).toEqual(["gesendet", "wartend"]);
    await verarbeite(mailer, { max: 0, jetzt: jetzt(89 * 86_400_000) });
    expect(await auftraege()).toHaveLength(2);
    await verarbeite(mailer, { max: 0, jetzt: jetzt(91 * 86_400_000) });
    expect((await auftraege()).map((a) => a.status)).toEqual(["wartend"]);
    expect(Number((await db.execute(sql`SELECT count(*)::int AS n FROM aenderung WHERE tabelle = 'mail_auftrag' AND aktion = 'gesendet'`)).rows[0]!.n)).toBe(1);
  });

  it("zwei Worker holen denselben Auftrag nicht doppelt", async () => {
    await neueAbfrageMitMail();
    const a = new FakeMailer();
    const b = new FakeMailer();
    await Promise.all([verarbeite(a), verarbeite(b)]);
    expect(a.gesendet.length + b.gesendet.length).toBe(1);
  });

  it("ein beschädigter oder fehlender Inhalt endet als Fehler, nicht als Versand", async () => {
    await neueAbfrageMitMail();
    await db.update(s.mailAuftrag).set({ inhaltVerschluesselt: "f1.abcd1234.AAAA.AAAA.AAAA" });
    const mailer = new FakeMailer();
    expect(await verarbeite(mailer)).toMatchObject({ fehlgeschlagen: 1 });
    expect(mailer.gesendet).toHaveLength(0);
    expect((await auftraege())[0]!.letzterFehler).toBe("GEHEIMNIS_FEHLER");
  });
});

describe("Mitteilung im Portal per Mail", () => {
  const FONDS = ID.fonds;
  const INV_A = "00000000-0000-4000-8000-0000000000d1";
  const INV_B = "00000000-0000-4000-8000-0000000000d2";
  const BEWEGUNG = "00000000-0000-4000-8000-0000000000d3";
  const investorA = person("mail-inv-a");
  const investorB = person("mail-inv-b");
  const gesperrt = person("mail-inv-gesperrt", { aktiv: false });

  beforeEach(async () => {
    await grundbestand(db);
    await db.insert(s.organisation).values([
      { id: INV_A, name: "Investor Eins Beispiel", art: "investor" },
      { id: INV_B, name: "Investor Zwei Beispiel", art: "investor" },
    ]);
    await db.insert(s.fondsZeichnung).values([
      { fondsId: FONDS, organisationId: INV_A, zusage: "600000.00", anteil: "0.600000" },
      { fondsId: FONDS, organisationId: INV_B, zusage: "400000.00", anteil: "0.400000" },
    ]);
    await db.insert(s.fondsBewegung).values({ id: BEWEGUNG, fondsId: FONDS, art: "abruf", valuta: "2026-01-15", betrag: "100000.00" });
    for (const p of [freigeber, bearbeiter]) await legePersonAn(db, p);
    await legeInvestorAn(db, investorA, [INV_A]);
    await legeInvestorAn(db, investorB, [INV_B]);
    await legeInvestorAn(db, gesperrt, [INV_A]);
  });

  it("mit `perMail` erhalten die aktiven Investor-Benutzer einen Hinweis ohne Betrag und ohne Datei; Gesperrte nicht", async () => {
    const antwort = await post(`/fonds/${FONDS}/bewegungen/${BEWEGUNG}/mitteilungen/freigeben`, { sprache: "de", perMail: true }, freigeber);
    expect(antwort.status).toBe(201);
    expect((await json(antwort)).mailAuftraege).toBe(2);
    const mailer = new FakeMailer();
    await verarbeite(mailer);
    expect(mailer.gesendet.map((m) => m.an).sort()).toEqual(["mail-inv-a@test.example", "mail-inv-b@test.example"]);
    for (const m of mailer.gesendet) {
      expect(m.betreff).toContain("Neue Mitteilung im Portal");
      expect(m.text).toContain(`${TESTORIGIN}/portal`);
      expect(m.text).not.toMatch(/100[.,]?000|60[.,]?000|40[.,]?000/);
      expect(Object.keys(m).sort()).toEqual(["an", "betreff", "html", "text"]); // kein Anhang
    }
    const rohAuftrag = JSON.stringify(await auftraege());
    expect(rohAuftrag).not.toContain("Beispielfonds");
  });

  it("ohne `perMail` geht keine Mail raus; ohne eingerichteten Versand scheitert `perMail` vollständig (nichts wird freigegeben)", async () => {
    expect((await post(`/fonds/${FONDS}/bewegungen/${BEWEGUNG}/mitteilungen/freigeben`, { sprache: "de" }, freigeber)).status).toBe(201);
    expect(await auftraege()).toHaveLength(0);
    await db.execute(sql`TRUNCATE TABLE fonds_mitteilung`);
    const antwort = await senden(ohneMail, "POST")(`/fonds/${FONDS}/bewegungen/${BEWEGUNG}/mitteilungen/freigeben`, { sprache: "de", perMail: true }, freigeber);
    expect(antwort.status).toBe(409);
    expect((await json(antwort)).error.code).toBe("mail_not_configured");
    expect(Number((await db.execute(sql`SELECT count(*)::int AS n FROM fonds_mitteilung`)).rows[0]!.n)).toBe(0);
  });

  it("eine unbrauchbare Adresse eines Investor-Kontos rollt die Freigabe nicht zurück (diese Person bekommt keinen Hinweis)", async () => {
    const id = await idVon(db, investorB);
    await db.update(s.benutzer).set({ email: "keine adresse" }).where(eq(s.benutzer.id, id));
    try {
      const antwort = await post(`/fonds/${FONDS}/bewegungen/${BEWEGUNG}/mitteilungen/freigeben`, { sprache: "de", perMail: true }, freigeber);
      expect(antwort.status).toBe(201);
      expect((await json(antwort)).mailAuftraege).toBe(1);
      expect(Number((await db.execute(sql`SELECT count(*)::int AS n FROM fonds_mitteilung`)).rows[0]!.n)).toBe(2);
    } finally {
      await db.update(s.benutzer).set({ email: investorB.email }).where(eq(s.benutzer.id, id));
    }
  });

  it("die Sprache des Investor-Benutzers aus den Einstellungen gilt vor der Sprache der Freigabe", async () => {
    const id = await idVon(db, investorA);
    await db.insert(s.benutzerEinstellung).values({ benutzerId: id, sprache: "en" });
    await post(`/fonds/${FONDS}/bewegungen/${BEWEGUNG}/mitteilungen/freigeben`, { sprache: "de", perMail: true }, freigeber);
    const mailer = new FakeMailer();
    await verarbeite(mailer);
    const anA = mailer.gesendet.find((m) => m.an === "mail-inv-a@test.example")!;
    const anB = mailer.gesendet.find((m) => m.an === "mail-inv-b@test.example")!;
    expect(anA.betreff).toContain("New notice in the portal");
    expect(anB.betreff).toContain("Neue Mitteilung im Portal");
  });
});

describe("Verwaltung und Einstellungen", () => {
  beforeEach(async () => {
    await grundbestand(db);
    for (const p of [bearbeiter, betrachter, verwalter]) await legePersonAn(db, p);
  });

  it("Status ohne Geheimnisse; Testmail nur an die eigene Adresse; Korbansicht ohne Inhalt", async () => {
    const geheim = erstelleTestApp(db, { mail: { ...MAIL, benutzer: "robot-benutzer", passwort: "robot-passwort" }, schluessel: ring });
    const status = await geheim.request("/mail/status", { als: verwalter });
    expect(status.status).toBe(200);
    const text = await status.text();
    expect(JSON.parse(text)).toMatchObject({ configured: true, host: "smtp.example.org", port: 25, tls: "none", sender: "carraway@example.org", useAuthentication: true, keyConfigured: true, outbox: { pending: 0, failed: 0 } });
    expect(text).not.toContain("robot-passwort");
    expect(text).not.toContain("robot-benutzer");
    expect(await (await ohneMail.request("/mail/status", { als: verwalter })).json()).toMatchObject({ konfiguriert: false });

    // Testmail: Der Körper kann keinen anderen Empfänger festlegen.
    const test = await post("/mail/test", { an: "fremd@example.org" }, verwalter);
    expect(test.status).toBe(202);
    const mailer = new FakeMailer();
    await verarbeite(mailer);
    expect(mailer.gesendet).toHaveLength(1);
    expect(mailer.gesendet[0]!.an).toBe(verwalter.email);

    const liste = await json(await get("/mail/auftraege", verwalter));
    expect(liste.daten).toHaveLength(1);
    expect(liste.daten[0]).toMatchObject({ vorlage: "testmail", status: "gesendet", versuche: 1, empfaenger: verwalter.email });
    expect(Object.keys(liste.daten[0]).sort()).toEqual(["betreff", "bezugArt", "bezugId", "empfaenger", "erstelltAm", "gesendetAm", "id", "letzterFehler", "naechsterVersuchAm", "status", "versuche", "vorlage"]);
    expect(JSON.stringify(liste)).not.toMatch(/inhalt|html/i);
    expect((await json(await get("/mail/auftraege?status=fehlgeschlagen", verwalter))).daten).toEqual([]);
    expect((await senden(ohneMail, "POST")("/mail/test", {}, verwalter)).status).toBe(409);
  });

  it("nur globale Verwalter: Bearbeiter, Betrachter und ohne Anmeldung kommen nicht an Status, Testmail oder Korb", async () => {
    for (const [methode, pfad] of [["GET", "/mail/status"], ["POST", "/mail/test"], ["GET", "/mail/auftraege"]] as const) {
      for (const als of [bearbeiter, betrachter]) expect((await t.request(pfad, { method: methode, als, headers: { "content-type": "application/json" }, ...(methode === "POST" ? { body: "{}" } : {}) })).status, `${pfad} ${als.name}`).toBe(403);
      expect((await t.request(pfad, { method: methode, als: null, ...(methode === "POST" ? { headers: { "content-type": "application/json" }, body: "{}" } : {}) })).status).toBe(401);
    }
  });

  it("Einstellungen: Standard, ändern, nur die eigenen; ungültige Sprache und leere Änderung sind Eingabefehler", async () => {
    expect(await json(await get("/settings", bearbeiter))).toEqual({ language: "de", mailOnReportApproved: false, mailOnRegisterEvent: false, mailAvailable: true });
    const geaendert = await put("/settings", { language: "en", mailOnReportApproved: true }, bearbeiter);
    expect(await json(geaendert)).toMatchObject({ language: "en", mailOnReportApproved: true });
    expect(await json(await get("/settings", betrachter))).toMatchObject({ language: "de", mailOnReportApproved: false });
    expect((await put("/settings", { language: "fr" }, bearbeiter)).status).toBe(400);
    expect((await put("/settings", {}, bearbeiter)).status).toBe(400);
    expect((await put("/settings", { fremd: true }, bearbeiter)).status).toBe(400);
    expect(await json(await senden(ohneMail, "GET")("/settings", undefined, bearbeiter))).toMatchObject({ mailAvailable: false });
  });
});

describe("Berichtsfreigabe: interne Hinweise mit Opt-in", () => {
  const STUFEN = ["Investmentmanager", "Teamleitung", "Geschäftsführung"];
  let fondsId = "";
  const optIn = person("mail-optin", { rollen: {} });
  const ohneOptIn = person("mail-ohne-optin", { rollen: {} });
  const fremdFonds = person("mail-fremdfonds", { rollen: {} });
  const investor = person("mail-bericht-investor");

  beforeAll(async () => {
    await schreibeDemodaten(db, erzeugeDemodaten({ seed: 1 }));
    const fondsListe = await json(await get("/fonds", person("mail-demo", { globalVerwalter: true })));
    fondsId = fondsListe.daten[0].id;
    const anderer = fondsListe.daten[1].id as string;
    optIn.rollen = { [fondsId]: "betrachter" };
    ohneOptIn.rollen = { [fondsId]: "betrachter" };
    fremdFonds.rollen = { [anderer]: "betrachter" };
    for (const p of [optIn, ohneOptIn, fremdFonds]) await legePersonAn(db, p);
    const [org] = await db.select({ id: s.organisation.id }).from(s.organisation).where(eq(s.organisation.art, "investor")).limit(1);
    await legeInvestorAn(db, investor, [org!.id]);
    for (const p of [optIn, fremdFonds, investor]) await db.insert(s.benutzerEinstellung).values({ benutzerId: await idVon(db, p), mailBerichtFreigegeben: true, sprache: p === optIn ? "en" : "de" });
  });

  it("nach der letzten Stufe bekommen nur Personen mit Opt-in und Rolle am Fonds eine Mail (nicht die freigebende Person, nicht Investoren, nicht andere Fonds); eine unbrauchbare Adresse rollt die Freigabe nicht zurück", async () => {
    const kaputt = person("mail-kaputt-adresse", { rollen: { [fondsId]: "betrachter" } });
    const kaputtId = await legePersonAn(db, kaputt);
    await db.insert(s.benutzerEinstellung).values({ benutzerId: kaputtId, mailBerichtFreigegeben: true });
    await db.update(s.benutzer).set({ email: "keine adresse" }).where(eq(s.benutzer.id, kaputtId));
    onTestFinished(async () => {
      await db.update(s.benutzer).set({ email: kaputt.email }).where(eq(s.benutzer.id, kaputtId));
    });
    const autor = person("mail-autor", { globalVerwalter: true });
    const roh = await post("/reports", { art: "fondsbericht", fondsId }, autor);
    expect(roh.status).toBe(201);
    const bericht = await json(roh);
    let letzte: Response | undefined;
    for (const [i, name] of STUFEN.entries()) letzte = await post(`/reports/${bericht.id}/stage`, { stufe: name, ergebnis: "ok" }, person(`mail-st${i}`, { globalVerwalter: true }));
    expect(letzte!.status).toBe(200);
    const mailer = new FakeMailer();
    await verarbeite(mailer);
    expect(mailer.gesendet.map((m) => m.an)).toEqual([optIn.email]);
    expect(mailer.gesendet[0]!.betreff).toBe("Report released: Fund report");
    expect(mailer.gesendet[0]!.text).toContain(`${TESTORIGIN}/reports/${bericht.id}`);
    // Ohne Mailversand bleibt die Freigabe wie sie war (ohne Fehler).
    const bericht2 = await json(await post("/reports", { art: "fondsbericht", fondsId }, autor));
    let letzte2: Response | undefined;
    for (const [i, name] of STUFEN.entries()) letzte2 = await senden(ohneMail, "POST")(`/reports/${bericht2.id}/stage`, { stufe: name, ergebnis: "ok" }, person(`mail-st${i + 3}`, { globalVerwalter: true }));
    expect(letzte2!.status).toBe(200);
  });
});
