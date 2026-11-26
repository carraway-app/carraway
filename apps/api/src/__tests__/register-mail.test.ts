import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { Schluesselring } from "../geheimnis/krypto";
import { verarbeiteMailAuftraege } from "../mail/auftraege";
import type { MailKonfiguration } from "../mail/konfiguration";
import { FakeMailer } from "../mail/mailer";
import { TestAnbieter, type RegisterAbruf } from "../register/anbieter";
import { pruefeBeobachtung } from "../register/beobachtung";
import { json, leeren, oeffneTestdb } from "./hilfen";
import { erstelleTestApp, idVon, legePersonAn, person, TESTORIGIN } from "./hilfen-auth";
import { aufrufe, grundbestand, ID } from "./hilfen-instrumente";

/**
 * Registerereignisse und Mail (Etappen 17 und 18): Hinweise nur an Personen mit Opt-in und Rolle an einem Fonds mit Beteiligung am Unternehmen, nur für
 * Insolvenz, Kapitalerhöhung und Löschung, ohne Registerinhalt in der Mail. Alle Daten und Registernummern sind erfunden.
 */

const { db, pool } = oeffneTestdb();
const ring = new Schluesselring(randomBytes(32));
const MAIL: MailKonfiguration = { host: "smtp.example.org", port: 25, tls: "keine", absender: "carraway@example.org", limitProStunde: 200 };
const anbieter = new TestAnbieter(new Map());
const t = erstelleTestApp(db, { registerAnbieter: anbieter, mail: MAIL, schluessel: ring });
const { get, put, post } = aufrufe(t);

const verwalter = person("regmail-verwalter", { rollen: { [ID.fonds]: "verwalter" } });
const mitOptIn = person("regmail-optin", { rollen: { [ID.fonds]: "betrachter" } });
const ohneOptIn = person("regmail-ohne-optin", { rollen: { [ID.fonds]: "betrachter" } });
const andererFonds = person("regmail-fremd", { rollen: { [ID.anderer]: "betrachter" } });
const GEHEIM = "Insolvenzverwalter Dr. Beispiel, Aktenzeichen 99 IN 999/26";

const abruf = (ereignisse: RegisterAbruf["ereignisse"], zusatz: Record<string, unknown> = {}): RegisterAbruf => ({
  eintrag: {
    gericht: "Amtsgericht Beispielstadt",
    registerart: "HRB",
    nummer: "HRB 99001",
    firma: "Alpha Beispiel GmbH",
    rechtsform: "GmbH",
    sitz: "Beispielstadt",
    kapital: "25000.00",
    kapitalWaehrung: "EUR",
    vertretung: [{ name: "Erika Beispiel", funktion: "Geschäftsführerin" }],
    prokura: [],
    standDatum: "2026-03-01",
    ...zusatz,
  } as RegisterAbruf["eintrag"],
  ereignisse,
});

const verarbeite = (mailer: FakeMailer) => verarbeiteMailAuftraege(db, { mailer, ring, limitProStunde: 200 });

beforeEach(async () => {
  await grundbestand(db);
  for (const p of [verwalter, mitOptIn, ohneOptIn, andererFonds]) await legePersonAn(db, p);
  await db.insert(s.benutzerEinstellung).values([
    { benutzerId: await idVon(db, mitOptIn), mailRegisterEreignis: true, sprache: "en" },
    { benutzerId: await idVon(db, andererFonds), mailRegisterEreignis: true },
  ]);
  anbieter["daten"].clear();
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

async function beobachte() {
  const r = await post(`/organisationen/${ID.orgA}/register/eintraege`, abruf([]).eintrag, verwalter);
  expect(r.status).toBe(201);
  expect((await put(`/organisationen/${ID.orgA}/register/beobachtung`, { aktiv: true }, verwalter)).status).toBe(200);
}

describe("Registerereignisse per Mail", () => {
  it("Opt-in in den Einstellungen: Standard aus, änderbar", async () => {
    expect(await json(await get("/settings", ohneOptIn))).toMatchObject({ mailOnRegisterEvent: false });
    expect(await json(await get("/settings", mitOptIn))).toMatchObject({ mailOnRegisterEvent: true });
    const r = await put("/settings", { mailOnRegisterEvent: true }, ohneOptIn);
    expect(await json(r)).toMatchObject({ mailOnRegisterEvent: true });
  });

  it("die Beobachtung meldet eine Insolvenz nur an Personen mit Opt-in und Rolle an einem Fonds mit Beteiligung; die Mail enthält keinen Registerinhalt", async () => {
    await beobachte();
    anbieter.setze(abruf([{ datum: "2026-07-02", art: "insolvenz", text: GEHEIM, externeId: "ins-1" }], { standDatum: "2026-07-01" }));
    const lauf = await pruefeBeobachtung(db, anbieter, { mail: { konfig: MAIL, ring, appBasis: TESTORIGIN } });
    expect(lauf.neueEreignisse).toBe(1);
    const aufträge = await db.select().from(s.mailAuftrag);
    expect(aufträge).toHaveLength(1);
    expect(aufträge[0]).toMatchObject({ vorlage: "register_ereignis", bezugArt: "register_ereignis" });
    const mailer = new FakeMailer();
    await verarbeite(mailer);
    expect(mailer.gesendet).toHaveLength(1);
    const m = mailer.gesendet[0]!;
    expect(m.an).toBe(mitOptIn.email);
    expect(m.betreff).toBe("Register event: Alpha Beispiel");
    expect(m.text).toContain("Insolvency");
    expect(m.text).toContain(`${TESTORIGIN}/organisationen/${ID.orgA}`);
    for (const geheim of ["99 IN 999", "Beispiel, Aktenzeichen", "HRB 99001", "Erika", "25000", "Beispielstadt"]) expect(m.text + m.html).not.toContain(geheim);
    // Zweiter Lauf: kein neues Ereignis, keine zweite Mail.
    await pruefeBeobachtung(db, anbieter, { mail: { konfig: MAIL, ring, appBasis: TESTORIGIN } });
    expect(await db.select().from(s.mailAuftrag)).toHaveLength(1);
  });

  it("andere Ereignisarten lösen keine Mail aus; ohne Mailversand bleibt die Meldung in der Oberfläche", async () => {
    await beobachte();
    anbieter.setze(abruf([{ datum: "2026-07-02", art: "sitzverlegung", text: "Sitz verlegt.", externeId: "sv-1" }], { standDatum: "2026-07-01" }));
    await pruefeBeobachtung(db, anbieter, { mail: { konfig: MAIL, ring, appBasis: TESTORIGIN } });
    expect(await db.select().from(s.mailAuftrag)).toHaveLength(0);
    anbieter.setze(abruf([{ datum: "2026-08-02", art: "kapitalerhoehung", text: "Kapital erhöht.", externeId: "ke-1" }], { standDatum: "2026-08-01" }));
    await pruefeBeobachtung(db, anbieter); // ohne Mailkontext
    expect(await db.select().from(s.mailAuftrag)).toHaveLength(0);
    expect((await db.select().from(s.registerMeldung).where(eq(s.registerMeldung.art, "ereignis"))).length).toBe(2);
  });

  it("Abruf über die API (mit Mailversand) meldet eine Kapitalerhöhung an die Person mit Opt-in", async () => {
    await beobachte();
    anbieter.setze(abruf([{ datum: "2026-08-02", art: "kapitalerhoehung", text: "Kapital erhöht.", externeId: "ke-2" }], { standDatum: "2026-08-01" }));
    const r = await post(`/organisationen/${ID.orgA}/register/abruf`, { gericht: "Amtsgericht Beispielstadt", registerart: "HRB", nummer: "HRB 99001" }, verwalter);
    expect(r.status).toBe(200);
    const mailer = new FakeMailer();
    await verarbeite(mailer);
    expect(mailer.gesendet.map((m) => m.an)).toEqual([mitOptIn.email]);
    expect(mailer.gesendet[0]!.betreff).toBe("Register event: Alpha Beispiel");
  });
});
