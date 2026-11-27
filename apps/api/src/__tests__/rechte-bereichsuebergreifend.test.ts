import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { STUFE_EN } from "./hilfen-auth";
import { json, leeren, oeffneTestdb } from "./hilfen";
import { grundbestand, ID } from "./hilfen-instrumente";
import { BEREICH_EN, erstelleTestApp, legePersonAn, person, type Testperson } from "./hilfen-auth";

/**
 * Schreibwege, die Daten mehrerer Bereiche berühren, prüfen jeden betroffenen Bereich, nicht nur den der Route (docs/permissions-model.md,
 * „Bereichsübergreifende Schreibwege“). Je Weg: Wer einen Bereich nicht hat, schreibt und liest darüber keine Daten dieses Bereichs.
 * Alle Personen sind erfunden; Rechte nur über Gruppen (keine eigenen Fondsrollen).
 */

const { db, pool } = oeffneTestdb();
const t = erstelleTestApp(db);

const F1 = ID.fonds;
const DEAL = "00000000-0000-4000-8000-0000000000d1";
const ORG_NEU = "00000000-0000-4000-8000-0000000000e1";

const kontaktNurDeals = person("ue-kontakt-dealflow"); // Kontakte + Dealflow, kein Portfolio
const kontaktNurPortfolio = person("ue-kontakt-portfolio"); // Kontakte + Portfolio, kein Dealflow
const nurKontakte = person("ue-kontakte");
const nurDokumente = person("ue-dokumente"); // Dokumente + Kontakte, kein Portfolio
const nurDaten = person("ue-daten");
const datenOhneFinanzen = person("ue-daten-ohne-finanzen");
const vollstaendig = person("ue-voll");
const personen = [kontaktNurDeals, kontaktNurPortfolio, nurKontakte, nurDokumente, nurDaten, datenOhneFinanzen, vollstaendig];

const anfrage = (methode: string, pfad: string, als: Testperson | undefined, body?: unknown, app = t) =>
  app.request(pfad, { method: methode, ...(als ? { als } : {}), headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const ids: Record<string, string> = {};

async function gruppeMit(name: string, bereiche: string[], stufe: string, mitglied: Testperson) {
  const r = await anfrage("POST", "/permissions/roles", undefined, { name: `Rolle ${name}`, areas: bereiche.map((b) => BEREICH_EN[b] ?? b) });
  expect(r.status).toBe(201);
  const g = await anfrage("POST", "/permissions/groups", undefined, { name, level: STUFE_EN[stufe] ?? stufe, roleIds: [(await json(r)).id], memberIds: [ids[mitglied.email]] });
  expect(g.status).toBe(201);
}
const zaehle = async (tabelle: string, bedingung = "true") => ((await db.execute(sql.raw(`SELECT count(*)::int AS n FROM ${tabelle} WHERE ${bedingung}`))).rows[0] as { n: number }).n;
const verweigert = async (antwort: Response, bereich?: string) => {
  expect(antwort.status).toBe(403);
  const { error: fehler } = await json(antwort);
  expect(fehler.code).toBe("forbidden");
  if (bereich) expect(fehler.bereiche).toContain(bereich);
};

beforeEach(async () => {
  await grundbestand(db);
  await db.insert(s.organisation).values({ id: ORG_NEU, name: "Nordlicht Beispiel", art: "unternehmen" });
  await db.insert(s.deal).values({ id: DEAL, organisationId: ID.orgA, fondsId: F1, titel: "Deal im Fonds Eins" });
  await db.execute(sql`DELETE FROM nutzergruppe`);
  await db.execute(sql`DELETE FROM rechterolle`);
  await db.execute(sql`UPDATE rechte_einstellung SET fonds_offen = true`);
  for (const p of personen) ids[p.email] = await legePersonAn(db, p);
  await gruppeMit("Kontakte und Deals", ["kontakte", "dealflow"], "freigeber", kontaktNurDeals);
  await gruppeMit("Kontakte und Portfolio", ["kontakte", "portfolio"], "freigeber", kontaktNurPortfolio);
  await gruppeMit("Nur Kontakte", ["kontakte"], "freigeber", nurKontakte);
  await gruppeMit("Dokumente", ["dokumente", "kontakte"], "freigeber", nurDokumente);
  await gruppeMit("Nur Daten", ["daten"], "freigeber", nurDaten);
  await gruppeMit("Daten ohne Finanzen", ["daten", "kontakte", "portfolio"], "freigeber", datenOhneFinanzen);
  await gruppeMit("Alles", ["kontakte", "dealflow", "portfolio", "dokumente", "daten", "finanzen", "fondsverwaltung"], "freigeber", vollstaendig);
});
afterAll(async () => {
  await db.execute(sql`DELETE FROM nutzergruppe`);
  await db.execute(sql`DELETE FROM rechterolle`);
  await db.execute(sql`UPDATE rechte_einstellung SET fonds_offen = true`);
  await db.execute(sql`TRUNCATE TABLE abfrage_zugriff, kalender_token`);
  await leeren(db);
  await pool.end();
});

describe("Organisationen zusammenführen", () => {
  const zusammen = (als: Testperson) => anfrage("POST", `/organisationen/${ORG_NEU}/zusammenfuehren`, als, { quelleId: ID.orgA });
  const vorschau = async (als: Testperson) => {
    const antwort = await anfrage("POST", `/organisationen/${ORG_NEU}/zusammenfuehren/vorschau`, als, { quelleId: ID.orgA });
    expect(antwort.status).toBe(200);
    return json(antwort);
  };

  it("ohne Portfolio oder ohne Dealflow wird nichts verschoben: Beteiligungen und Deals bleiben bei der Quelle", async () => {
    await verweigert(await zusammen(kontaktNurDeals), "portfolio");
    await verweigert(await zusammen(kontaktNurPortfolio), "dealflow");
    await verweigert(await zusammen(nurKontakte));
    expect(await zaehle("beteiligung", `organisation_id = '${ID.orgA}'`)).toBeGreaterThan(0);
    expect(await zaehle("deal", `organisation_id = '${ID.orgA}'`)).toBe(1);
    expect(await zaehle("organisation", `id = '${ID.orgA}' AND zusammengefuehrt_in IS NOT NULL`)).toBe(0);
  });

  it("die Vorschau zählt Beteiligungen, Runden und Fonds ohne Portfolio nicht und Deals ohne Dealflow nicht", async () => {
    const voll = await vorschau(vollstaendig);
    expect(voll.verschiebt.beteiligungen).toBeGreaterThan(0);
    expect(voll.verschiebt.deals).toBe(1);
    expect(voll.fondsIds).toContain(F1);
    expect(voll.bereichFehlt).toEqual([]);
    expect(voll.darfAusfuehren).toBe(true);

    const ohnePortfolio = await vorschau(kontaktNurDeals);
    expect(ohnePortfolio.verschiebt).toMatchObject({ beteiligungen: 0, runden: 0, rundenpositionen: 0, deals: 1 });
    expect(ohnePortfolio.fondsIds).toEqual([]);
    expect(ohnePortfolio.verdeckteFonds).toBe(false);
    expect(ohnePortfolio.freigabeNoetig).toBe(false);
    expect(ohnePortfolio.bereichFehlt).toEqual(["portfolio"]);
    expect(ohnePortfolio.darfAusfuehren).toBe(false);

    const ohneDeals = await vorschau(kontaktNurPortfolio);
    expect(ohneDeals.verschiebt.deals).toBe(0);
    expect(ohneDeals.verschiebt.beteiligungen).toBeGreaterThan(0);
    expect(ohneDeals.bereichFehlt).toEqual(["dealflow"]);
    expect(ohneDeals.darfAusfuehren).toBe(false);
  });

  it("mit beiden Bereichen und Freigeber am Fonds gelingt es", async () => {
    const antwort = await zusammen(vollstaendig);
    expect(antwort.status).toBe(200);
    expect(await zaehle("beteiligung", `organisation_id = '${ORG_NEU}'`)).toBeGreaterThan(0);
  });
});

describe("Personen zusammenführen", () => {
  const P1 = "00000000-0000-4000-8000-0000000000f1";
  const P2 = "00000000-0000-4000-8000-0000000000f2";
  beforeEach(async () => {
    await db.insert(s.person).values([
      { id: P1, vorname: "Anna", nachname: "Beispiel" },
      { id: P2, vorname: "Anja", nachname: "Beispiel" },
    ]);
  });
  const zusammen = (als: Testperson) => anfrage("POST", `/personen/${P1}/zusammenfuehren`, als, { quelleId: P2 });

  it("hängt die Quelle an einem Deal (Deal-Kontakt), braucht es Dealflow; sonst genügt Kontakte", async () => {
    await db.insert(s.dealKontakt).values({ dealId: DEAL, personId: P2 });
    await verweigert(await zusammen(nurKontakte), "dealflow");
    expect(await zaehle("deal_kontakt", `person_id = '${P2}'`)).toBe(1);
    const vorschau = await json(await anfrage("POST", `/personen/${P1}/zusammenfuehren/vorschau`, nurKontakte, { quelleId: P2 }));
    expect(vorschau.darfAusfuehren).toBe(false);
    expect(vorschau.bereichFehlt).toEqual(["dealflow"]);
    expect((await zusammen(kontaktNurDeals)).status).toBe(200);
    expect(await zaehle("deal_kontakt", `person_id = '${P1}'`)).toBe(1);
  });

  it("ohne Bezug zu Deals genügt der Bereich Kontakte", async () => {
    expect((await zusammen(nurKontakte)).status).toBe(200);
  });
});

describe("Beteiligung aus einem Deal anlegen", () => {
  const koerper = { fondsId: F1, instrument: "offene_beteiligung", erstinvestment: "2025-06-30", zusage: "1000.00" };

  it("ohne Portfolio entsteht keine Beteiligung, kein Instrument und keine Zusage", async () => {
    const vorher = await zaehle("beteiligung");
    await verweigert(await anfrage("POST", `/deals/${DEAL}/beteiligung`, kontaktNurDeals, koerper), "portfolio");
    expect(await zaehle("beteiligung")).toBe(vorher);
    expect(await zaehle("deal", `id = '${DEAL}' AND status = 'investiert'`)).toBe(0);
    // Mit Portfolio läuft die Prüfung weiter (hier scheitert sie am fehlenden Beschluss, nicht an den Rechten).
    const weiter = await anfrage("POST", `/deals/${DEAL}/beteiligung`, vollstaendig, koerper);
    expect(weiter.status).not.toBe(403);
  });
});

describe("Stapel", () => {
  it("jede Operation läuft durch dieselbe Rechtsprüfung samt Bereich: ohne Portfolio kein Zusammenführen und keine Beteiligung aus einem Deal", async () => {
    const antwort = await anfrage("POST", "/batch", kontaktNurDeals, {
      operations: [
        { method: "POST", path: `/organisationen/${ORG_NEU}/zusammenfuehren`, body: { quelleId: ID.orgA } },
        { method: "POST", path: `/deals/${DEAL}/beteiligung`, body: { fondsId: F1, instrument: "offene_beteiligung", erstinvestment: "2025-06-30" } },
        { method: "POST", path: `/investments/${ID.eigen}/transactions`, body: { type: "commitment", valueDate: "2025-01-01", amount: "1000" } },
      ],
    });
    expect(antwort.status).toBe(409);
    const { error: fehler } = await json(antwort);
    expect(fehler.code).toBe("batch_failed");
    expect(fehler.operations.map((o: { status: number }) => o.status)).toEqual([403, 403, 403]);
    expect(await zaehle("organisation", `id = '${ID.orgA}' AND zusammengefuehrt_in IS NOT NULL`)).toBe(0);
  });
});

describe("Kalenderabonnement", () => {
  const tag = (n: number) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const wiedervorlage = (titel: string, benutzerId: string, zusatz: Partial<typeof s.aktivitaet.$inferInsert> = {}) =>
    db.insert(s.aktivitaet).values({ art: "notiz", datum: tag(-3), titel, organisationId: ID.orgA, wiedervorlage: tag(2), zustaendig: benutzerId, ...zusatz });
  const feed = async (als: Testperson) => {
    const link = await anfrage("POST", "/settings/calendar-link", als);
    expect(link.status).toBe(201);
    const antwort = await t.request(`/api/v1/calendar/${(await json(link)).token}.ics`);
    expect(antwort.status).toBe(200);
    return antwort.text();
  };

  it("ohne Kontakte leer; ohne Dealflow ohne die Wiedervorlagen an Deals; mit beiden vollständig", async () => {
    for (const p of [kontaktNurPortfolio, kontaktNurDeals, vollstaendig, nurDaten]) {
      await wiedervorlage("Zur Organisation", ids[p.email]!);
      await wiedervorlage("Zum Deal", ids[p.email]!, { dealId: DEAL, organisationId: null });
    }
    const ohneKontakte = await feed(nurDaten);
    expect(ohneKontakte.match(/BEGIN:VEVENT/g)).toBeNull();
    expect(ohneKontakte).not.toMatch(/Zur Organisation|Zum Deal|Alpha Beispiel/);

    const ohneDeals = await feed(kontaktNurPortfolio);
    expect(ohneDeals).toContain("Zur Organisation");
    expect(ohneDeals).not.toMatch(/Zum Deal|Deal im Fonds Eins/);

    const mitDeals = await feed(kontaktNurDeals);
    expect(mitDeals).toContain("Zur Organisation");
    expect(mitDeals).toContain("Zum Deal");
    expect(mitDeals).toContain("Deal im Fonds Eins");
    expect(await feed(vollstaendig)).toContain("Zum Deal");
  });

  it("der Bereich wird bei jedem Abruf neu geprüft: Entzug leert den Kalender", async () => {
    await wiedervorlage("Zur Organisation", ids[nurKontakte.email]!);
    const link = await anfrage("POST", "/settings/calendar-link", nurKontakte);
    const url = `/api/v1/calendar/${(await json(link)).token}.ics`;
    expect(await (await t.request(url)).text()).toContain("Zur Organisation");
    await db.execute(sql`DELETE FROM nutzergruppe_rolle WHERE gruppe_id IN (SELECT id FROM nutzergruppe WHERE name = 'Nur Kontakte')`);
    expect((await (await t.request(url)).text()).match(/BEGIN:VEVENT/g)).toBeNull();
  });
});

describe("Datenübernahme", () => {
  const lauf = () => `/import/runs/${randomUUID()}`;

  it("schreibt in Kontakte, Portfolio und Finanzen: fehlt einer, 403 bei Prüfung und Übernahme", async () => {
    for (const als of [nurDaten, datenOhneFinanzen]) {
      for (const aktion of ["validate", "apply"]) {
        await verweigert(await anfrage("POST", `${lauf()}/${aktion}`, als), als === nurDaten ? "kontakte" : "finanzen");
      }
    }
    // Mit allen Bereichen läuft die Prüfung weiter (hier: den Lauf gibt es nicht).
    for (const aktion of ["validate", "apply"]) expect((await anfrage("POST", `${lauf()}/${aktion}`, vollstaendig)).status).toBe(404);
  });
});
