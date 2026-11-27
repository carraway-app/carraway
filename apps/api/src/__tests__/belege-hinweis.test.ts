import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import type { Speicher } from "../berichte/speicher";
import { Schluesselring } from "../geheimnis/krypto";
import { verarbeiteMailAuftraege } from "../mail/auftraege";
import type { MailKonfiguration } from "../mail/konfiguration";
import { FakeMailer } from "../mail/mailer";
import { json, leeren, oeffneTestdb } from "./hilfen";
import { erstelleTestApp, idVon, legePersonAn, person, TESTORIGIN, type Testperson } from "./hilfen-auth";
import { buchhaltungAufsetzen, mittelartenAufsetzen } from "./hilfen-buchhaltung";
import { aufrufe, grundbestand, ID } from "./hilfen-instrumente";

/**
 * Hinweis bei der Freigabe eines Belegs (letzte Stufe): derselbe Weg wie bei Berichten und Meldungen, also Opt-in, Rolle am Fonds, nicht an die
 * freigebende Person. Ohne Mailversand bleibt die Freigabe unberührt. Alle Daten sind erfunden.
 */

const { db, pool } = oeffneTestdb();
const ring = new Schluesselring(randomBytes(32));
const MAIL: MailKonfiguration = { host: "smtp.example.org", port: 25, tls: "keine", absender: "carraway@example.org", limitProStunde: 200 };

class TestSpeicher implements Speicher {
  readonly dateien = new Map<string, Uint8Array>();
  async schreibe(schluessel: string, daten: Uint8Array) {
    this.dateien.set(schluessel, daten);
  }
  async lese(schluessel: string) {
    const d = this.dateien.get(schluessel);
    if (!d) throw new Error("fehlt");
    return d;
  }
}
const speicher = new TestSpeicher();
const mitMail = erstelleTestApp(db, { speicher, mail: MAIL, schluessel: ring });
const ohneMail = erstelleTestApp(db, { speicher, mail: undefined });
const { post } = aufrufe(mitMail);
const F1 = ID.fonds;

const erst = person("bh-erst", { rollen: { [F1]: "freigeber" } });
const pruefer = person("bh-pruefer", { rollen: { [F1]: "freigeber" } });
const freigeber = person("bh-freigeber", { rollen: { [F1]: "freigeber" } });
const optIn = person("bh-optin", { rollen: { [F1]: "betrachter" } });
const ohneOptIn = person("bh-ohne-optin", { rollen: { [F1]: "betrachter" } });
const fremd = person("bh-fremd", { rollen: { [ID.anderer]: "betrachter" } });

const anfrage = (app: typeof mitMail, methode: string, pfad: string, als: Testperson, body?: unknown) =>
  app.request(pfad, { method: methode, als, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

async function belegBisZurLetztenStufe(app: typeof mitMail): Promise<{ id: string; letzte: () => Promise<Response> }> {
  await post(`/investments/${ID.darlehen}/transactions`, { type: "commitment", valueDate: "2026-01-01", amount: "200000" });
  const vorgang = await json(await post(`/investments/${ID.darlehen}/transactions`, { type: "disbursement", valueDate: "2026-03-31", amount: "100000" }));
  const beleg = await json(await anfrage(app, "POST", "/vouchers", erst, { language: "de", type: "disbursement", referenceType: "transaction", referenceId: vorgang.transaction.id }));
  expect((await anfrage(app, "POST", `/vouchers/${beleg.id}/stage`, pruefer, { stage: "review", result: "ok" })).status).toBe(200);
  return { id: beleg.id, letzte: () => anfrage(app, "POST", `/vouchers/${beleg.id}/stage`, freigeber, { stage: "approval", result: "ok" }) };
}

beforeEach(async () => {
  await grundbestand(db);
  await buchhaltungAufsetzen(db, F1);
  await mittelartenAufsetzen(db, F1);
  for (const p of [erst, pruefer, freigeber, optIn, ohneOptIn, fremd]) await legePersonAn(db, p);
  await db.delete(s.benutzerEinstellung);
  for (const [p, sprache] of [[optIn, "en"], [fremd, "de"], [freigeber, "de"]] as const) {
    await db.insert(s.benutzerEinstellung).values({ benutzerId: await idVon(db, p), mailBerichtFreigegeben: true, sprache });
  }
  speicher.dateien.clear();
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

const versende = async () => {
  const mailer = new FakeMailer();
  await verarbeiteMailAuftraege(db, { mailer, ring, limitProStunde: 1000 });
  return mailer.gesendet;
};

describe("Belegfreigabe: interne Hinweise mit Opt-in", () => {
  it("nach der letzten Stufe bekommt nur die Person mit Opt-in und Rolle am Fonds eine Mail; die freigebende Person und andere Fonds nicht", async () => {
    const { id, letzte } = await belegBisZurLetztenStufe(mitMail);
    // Nach der ersten Stufe geht noch nichts raus.
    expect(await versende()).toHaveLength(0);
    const antwort = await letzte();
    expect(antwort.status).toBe(200);
    expect((await json(antwort)).status).toBe("approved");
    const gesendet = await versende();
    expect(gesendet.map((m) => m.an)).toEqual([optIn.email]);
    expect(gesendet[0]!.betreff).toBe("Voucher released: Voucher");
    expect(gesendet[0]!.text).toContain(`${TESTORIGIN}/vouchers/${id}`);
    expect(gesendet[0]!.text).toContain("A voucher");
    const [auftrag] = await db.select().from(s.mailAuftrag).where(eq(s.mailAuftrag.bezugId, id));
    expect(auftrag).toMatchObject({ vorlage: "bericht_freigegeben", bezugArt: "beleg", status: "gesendet" });
  });

  it("deutsche Fassung nennt den Beleg und verweist auf ihn", async () => {
    await db.update(s.benutzerEinstellung).set({ sprache: "de" }).where(eq(s.benutzerEinstellung.benutzerId, await idVon(db, optIn)));
    const { letzte } = await belegBisZurLetztenStufe(mitMail);
    await letzte();
    const [mail] = await versende();
    expect(mail!.betreff).toBe("Beleg freigegeben: Beleg");
    expect(mail!.text).toContain("Ein Beleg");
    expect(mail!.text).toContain("Zum Beleg");
  });

  it("Rechtemodell: in einer Gruppe ohne den Bereich Finanzen keine Mail, mit dem Bereich wieder", async () => {
    const [rolle] = await db.insert(s.rechterolle).values({ name: "Nur Kontakte (Hinweis)", bereiche: ["kontakte"] }).returning();
    const [gruppe] = await db.insert(s.nutzergruppe).values({ name: "Hinweis ohne Finanzen", stufe: "betrachter", fondsBeschraenkt: true }).returning();
    await db.insert(s.nutzergruppeRolle).values({ gruppeId: gruppe!.id, rolleId: rolle!.id });
    await db.insert(s.nutzergruppeMitglied).values({ gruppeId: gruppe!.id, benutzerId: await idVon(db, optIn) });
    const a = await belegBisZurLetztenStufe(mitMail);
    expect((await a.letzte()).status).toBe(200);
    expect(await versende()).toHaveLength(0);

    await db.update(s.rechterolle).set({ bereiche: ["kontakte", "finanzen"] }).where(eq(s.rechterolle.id, rolle!.id));
    const b = await belegBisZurLetztenStufe(mitMail);
    expect((await b.letzte()).status).toBe(200);
    expect((await versende()).map((m) => m.an)).toEqual([optIn.email]);
    await db.delete(s.nutzergruppe).where(eq(s.nutzergruppe.id, gruppe!.id));
    await db.delete(s.rechterolle).where(eq(s.rechterolle.id, rolle!.id));
  });

  it("Bereiche je Fonds: Finanzen nur an einem anderen Fonds genügt nicht, Finanzen an diesem Fonds schon", async () => {
    const [rolle] = await db.insert(s.rechterolle).values({ name: "Finanzen je Fonds (Hinweis)", bereiche: ["finanzen", "kontakte"] }).returning();
    // Gruppe mit Bereichen je Fonds: Finanzen nur am anderen Fonds, hier nur Kontakte. Die eigene Rolle am Fonds bringt keine Bereiche mit.
    const [gruppe] = await db.insert(s.nutzergruppe).values({ name: "Hinweis je Fonds", stufe: "betrachter", fondsBeschraenkt: true, bereicheJeFonds: true }).returning();
    await db.insert(s.nutzergruppeRolle).values({ gruppeId: gruppe!.id, rolleId: rolle!.id });
    await db.insert(s.nutzergruppeFonds).values([
      { gruppeId: gruppe!.id, fondsId: ID.anderer, bereiche: ["finanzen"] },
      { gruppeId: gruppe!.id, fondsId: F1, bereiche: ["kontakte"] },
    ]);
    await db.insert(s.nutzergruppeMitglied).values({ gruppeId: gruppe!.id, benutzerId: await idVon(db, optIn) });
    const a = await belegBisZurLetztenStufe(mitMail);
    expect((await a.letzte()).status).toBe(200);
    expect(await versende()).toHaveLength(0);

    await db.update(s.nutzergruppeFonds).set({ bereiche: ["finanzen"] }).where(eq(s.nutzergruppeFonds.fondsId, F1));
    const b = await belegBisZurLetztenStufe(mitMail);
    expect((await b.letzte()).status).toBe(200);
    expect((await versende()).map((m) => m.an)).toEqual([optIn.email]);
    await db.delete(s.nutzergruppe).where(eq(s.nutzergruppe.id, gruppe!.id));
    await db.delete(s.rechterolle).where(eq(s.rechterolle.id, rolle!.id));
  });

  it("ohne Opt-in keine Mail", async () => {
    await db.update(s.benutzerEinstellung).set({ mailBerichtFreigegeben: false });
    const a = await belegBisZurLetztenStufe(mitMail);
    expect((await a.letzte()).status).toBe(200);
    expect(await versende()).toHaveLength(0);
  });

  it("ohne Mailversand bleibt die Freigabe wie sie war, und es entsteht kein Auftrag", async () => {
    const b = await belegBisZurLetztenStufe(ohneMail);
    const antwort = await b.letzte();
    expect(antwort.status).toBe(200);
    expect((await json(antwort)).status).toBe("approved");
    expect(await db.select().from(s.mailAuftrag)).toHaveLength(0);
  });
});
