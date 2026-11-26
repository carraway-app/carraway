import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { ladeKapitalkonten } from "../berichte/daten";
import { ladeVerteilungsgrundlageZum } from "../instrumente/lp-verteilung";
import { json, leeren, oeffneTestdb } from "./hilfen";
import { aufrufe, grundbestand, ID, protokollZeilen } from "./hilfen-instrumente";
import { erstelleTestApp, legeInvestorAn, legePersonAn, person, type Testperson } from "./hilfen-auth";

/** Verringerung der Zusage und Austritt eines Investors (Issue #132): datierter Vorgang mit Storno, stichtagsbezogene Verteilung. Alle Daten sind erfunden. */

const { db, pool } = oeffneTestdb();
const t = erstelleTestApp(db);
const { get, post } = aufrufe(t);
const anfrage = (methode: string, pfad: string, als: Testperson, body?: unknown) =>
  t.request(pfad, { method: methode, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), als });

const INV1 = "00000000-0000-4000-8000-0000000000a1";
const INV2 = "00000000-0000-4000-8000-0000000000a2";
const INV3 = "00000000-0000-4000-8000-0000000000a3";
const fondsPfad = `/fonds/${ID.fonds}`;
const zugangsPfad = `${fondsPfad}/investorenzugaenge`;
const closingPfad = `${zugangsPfad}/closings`;
const aenderungPfad = `${zugangsPfad}/zusageaenderungen`;
const verwalterF1 = person("verwalter-f1-austritt", { rollen: { [ID.fonds]: "verwalter" } });
const investor1 = person("austritt-inv1");

const abruf = (valueDate: string, amount: string) => ({ kind: "fund_posting", type: "capital_call", valueDate, amount });
const aufteilung = async (bewegungId: string) => {
  const antwort = await json(await get(`/fondsbewegungen/${bewegungId}`));
  return Object.fromEntries(antwort.aufteilung.map((a: { organisationId: string; betrag: string }) => [a.organisationId, a.betrag])) as Record<string, string>;
};
const zeichnungen = async () => Object.fromEntries((await db.select().from(s.fondsZeichnung).where(eq(s.fondsZeichnung.fondsId, ID.fonds))).map((z) => [z.organisationId, z]));
const kapital = async () => (await db.select().from(s.fonds).where(eq(s.fonds.id, ID.fonds)))[0]!.zeichnungskapital;
const fehler = async (antwort: Response) => (await json(antwort)).error.code as string;
const konten = async (stichtag: string, stand?: string) => Object.fromEntries((await ladeKapitalkonten(db, ID.fonds, stichtag, stand, "0")).map((k) => [k.investor, k]));
const verringerung = (neueZusage: string, zusatz: object = {}) => ({ art: "verringerung", wirksamAm: "2026-06-01", investoren: [{ organisationId: INV1, neueZusage }], ...zusatz });
const austritt = (organisationId = INV2, zusatz: object = {}) => ({ art: "austritt", wirksamAm: "2026-06-01", investoren: [{ organisationId }], ...zusatz });
const warte = () => new Promise((r) => setTimeout(r, 20));

let abruf1 = "";

beforeEach(async () => {
  await grundbestand(db);
  await db.insert(s.organisation).values([
    { id: INV1, name: "Erster Investor Beispiel", art: "investor" },
    { id: INV2, name: "Zweiter Investor Beispiel", art: "investor" },
    { id: INV3, name: "Dritter Investor Beispiel", art: "investor" },
  ]);
  await legePersonAn(db, verwalterF1);
  await legeInvestorAn(db, investor1, [INV1]);
  // 6 und 4 Millionen bei 10 Millionen Zeichnungskapital; erster Abruf: 600000.01 und 400000.00.
  expect((await post(`${zugangsPfad}/zeichnungen`, { zeichnungen: [{ organisationId: INV1, zusage: "6000000" }, { organisationId: INV2, zusage: "4000000" }] })).status).toBe(201);
  abruf1 = (await json(await post(`/funds/${ID.fonds}/postings`, abruf("2026-05-01", "1000000.01")))).movement.id;
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

describe("Verringerung der Zusage", () => {
  it("senkt Zusage, Anteile und Zeichnungskapital und dokumentiert die Abfindung ohne Wirkung auf die Verteilung", async () => {
    const antwort = await post(aenderungPfad, verringerung("3000000", { investoren: [{ organisationId: INV1, neueZusage: "3000000", ausgleich: { betrag: "1234.50", datum: "2026-06-20" } }] }));
    expect(antwort.status).toBe(201);
    const ergebnis = await json(antwort);
    expect(ergebnis).toMatchObject({ art: "verringerung", zeichnungskapital: "7000000.00" });
    expect(ergebnis.zusagen).toEqual([expect.objectContaining({ organisationId: INV1, zusage: "3000000.00", ausgleichBetrag: "1234.50", ausgleichDatum: "2026-06-20", beitritt: false })]);

    const je = await zeichnungen();
    expect(je[INV1]).toMatchObject({ zusage: "3000000.00", anteil: "0.428571", ausgetreten: false });
    expect(je[INV2]).toMatchObject({ zusage: "4000000.00", anteil: "0.571429" });
    expect(await kapital()).toBe("7000000.00");

    // Früherer Abruf unverändert; späterer verteilt nach der neuen Grundlage; Valuta gleich Wirksamkeitsdatum zählt schon neu.
    expect(await aufteilung(abruf1)).toEqual({ [INV1]: "600000.01", [INV2]: "400000.00" });
    const amTag = (await json(await post(`/funds/${ID.fonds}/postings`, abruf("2026-06-01", "700000.00")))).movement.id;
    expect(await aufteilung(amTag)).toEqual({ [INV1]: "300000.00", [INV2]: "400000.00" });

    const sicht = await json(await get(zugangsPfad));
    expect(sicht.closings).toEqual([expect.objectContaining({ art: "verringerung", wirksamAm: "2026-06-01", stornierbar: true })]);
    expect(await protokollZeilen(db, "fonds_closing", "anlegen")).toHaveLength(1);
    expect(await protokollZeilen(db, "fonds_zeichnung", "aendern")).toHaveLength(2);
  });

  it("lässt die Zusage genau bis zum bereits Abgerufenen sinken und nicht darunter", async () => {
    // Abgerufen sind 600000.01.
    expect(await fehler(await post(aenderungPfad, verringerung("600000.00")))).toBe("lp_commitment_below_called");
    expect(await kapital()).toBe("10000000.00");
    expect((await post(aenderungPfad, verringerung("600000.01"))).status).toBe(201);
    expect((await zeichnungen())[INV1]).toMatchObject({ zusage: "600000.01", ausgetreten: false });
    expect(await kapital()).toBe("4600000.01");
    // Die Abrufe liegen weiter unter dem Zeichnungskapital; die Sicht nennt das Abgerufene je Investor.
    const sicht = await json(await get(zugangsPfad));
    expect(sicht.zeichnungen.find((z: { id: string }) => z.id === INV1)).toMatchObject({ abgerufen: "600000.01" });
  });

  it("hält Stichtage und Wissensstand reproduzierbar", async () => {
    const stand0 = new Date().toISOString();
    await warte();
    expect((await post(aenderungPfad, verringerung("3000000"))).status).toBe(201);
    await post(`/funds/${ID.fonds}/postings`, abruf("2026-07-01", "700000.00"));

    expect((await konten("2026-05-31"))["Erster Investor Beispiel"]).toMatchObject({ zusage: "6000000.00", anteil: "0.600000" });
    expect((await konten("2026-06-01"))["Erster Investor Beispiel"]).toMatchObject({ zusage: "3000000.00" });
    expect((await konten("2026-07-31"))["Erster Investor Beispiel"]).toMatchObject({ zusage: "3000000.00", abgerufen: "900000.01" });
    // Mit dem Wissen vor der Erfassung gilt derselbe spätere Stichtag noch mit der alten Zusage.
    expect((await konten("2026-07-31", stand0))["Erster Investor Beispiel"]).toMatchObject({ zusage: "6000000.00" });
    expect((await ladeVerteilungsgrundlageZum(db, ID.fonds, "2026-05-31")).zeichnungen.map((z) => z.zusage)).toEqual(["6000000.00", "4000000.00"]);
    expect((await ladeVerteilungsgrundlageZum(db, ID.fonds, "2026-06-01")).zeichnungen.map((z) => z.zusage)).toEqual(["3000000.00", "4000000.00"]);
  });

  it("wehrt unzulässige Eingaben ab", async () => {
    expect(await fehler(await post(aenderungPfad, verringerung("6000000")))).toBe("lp_commitment_not_lower");
    expect(await fehler(await post(aenderungPfad, verringerung("7000000")))).toBe("lp_commitment_not_lower");
    expect(await fehler(await post(aenderungPfad, verringerung("0")))).toBe("lp_commitment_zero");
    expect((await post(aenderungPfad, { ...verringerung("1"), investoren: [{ organisationId: INV1 }] })).status).toBe(400);
    expect(await fehler(await post(aenderungPfad, verringerung("3000000", { investoren: [{ organisationId: INV3, neueZusage: "1" }] })))).toBe("lp_subscription_not_found");
    expect(await fehler(await post(aenderungPfad, verringerung("3000000", { wirksamAm: "2026-05-01" })))).toBe("lp_closing_before_movement");
    expect(await db.select().from(s.fondsClosing)).toHaveLength(0);
  });
});

describe("Austritt", () => {
  it("setzt die Zusage auf das Abgerufene; spätere Abrufe verteilen sich nicht mehr auf den Ausgetretenen", async () => {
    const antwort = await post(aenderungPfad, austritt(INV2, { investoren: [{ organisationId: INV2, ausgleich: { betrag: "400000.00", datum: "2026-06-30" } }] }));
    expect(antwort.status).toBe(201);
    expect(await json(antwort)).toMatchObject({ art: "austritt", zeichnungskapital: "6400000.00", zusagen: [expect.objectContaining({ organisationId: INV2, zusage: "3600000.00", ausgleichBetrag: "400000.00" })] });
    const je = await zeichnungen();
    expect(je[INV2]).toMatchObject({ zusage: "400000.00", anteil: "0.000000", ausgetreten: true });
    expect(je[INV1]).toMatchObject({ zusage: "6000000.00", anteil: "1.000000", ausgetreten: false });

    const spaeter = (await json(await post(`/funds/${ID.fonds}/postings`, abruf("2026-07-01", "500000.00")))).movement.id;
    expect(await aufteilung(spaeter)).toEqual({ [INV1]: "500000.00", [INV2]: "0.00" });
    expect(await aufteilung(abruf1)).toEqual({ [INV1]: "600000.01", [INV2]: "400000.00" });

    // Das Kapitalkonto des Ausgetretenen bleibt mit dem Eingezahlten bestehen, ohne offene Zusage.
    const nach = await konten("2026-07-31");
    expect(nach["Zweiter Investor Beispiel"]).toMatchObject({ zusage: "400000.00", abgerufen: "400000.00", offeneZusage: "0.00" });
    expect(nach["Erster Investor Beispiel"]).toMatchObject({ abgerufen: "1100000.01" });
    expect((await konten("2026-05-31"))["Zweiter Investor Beispiel"]).toMatchObject({ zusage: "4000000.00", offeneZusage: "3600000.00" });
  });

  it("setzt die Zusage auf null, wenn nichts abgerufen wurde", async () => {
    expect((await post(closingPfad, { wirksamAm: "2026-06-01", zusagen: [{ organisationId: INV3, zusage: "5000000" }] })).status).toBe(201);
    const antwort = await post(aenderungPfad, austritt(INV3, { wirksamAm: "2026-07-01" }));
    expect(antwort.status).toBe(201);
    expect((await json(antwort)).zeichnungskapital).toBe("10000000.00");
    expect((await zeichnungen())[INV3]).toMatchObject({ zusage: "0.00", anteil: "0.000000", ausgetreten: true });
    expect((await ladeVerteilungsgrundlageZum(db, ID.fonds, "2026-06-15")).zeichnungen.map((z) => z.zusage)).toEqual(["5000000.00", "6000000.00", "4000000.00"]);
    const spaeter = (await json(await post(`/funds/${ID.fonds}/postings`, abruf("2026-08-01", "1000000.00")))).movement.id;
    expect(await aufteilung(spaeter)).toEqual({ [INV3]: "0.00", [INV1]: "600000.00", [INV2]: "400000.00" });
  });

  it("verteilt auch bei Verteilung nach Zusage nichts mehr auf den Ausgetretenen", async () => {
    await db.update(s.fonds).set({ lpVerteilungNachZusage: true }).where(eq(s.fonds.id, ID.fonds));
    expect((await post(aenderungPfad, austritt())).status).toBe(201);
    const spaeter = (await json(await post(`/funds/${ID.fonds}/postings`, abruf("2026-07-01", "100.00")))).movement.id;
    expect(await aufteilung(spaeter)).toEqual({ [INV1]: "100.00", [INV2]: "0.00" });
  });

  it("lässt den letzten Investor nicht austreten und keinen Ausgetretenen aufstocken oder erneut austreten", async () => {
    expect(await fehler(await post(aenderungPfad, { art: "austritt", wirksamAm: "2026-06-01", investoren: [{ organisationId: INV1 }, { organisationId: INV2 }] }))).toBe("lp_last_investor");
    expect((await post(aenderungPfad, austritt())).status).toBe(201);
    expect(await fehler(await post(aenderungPfad, austritt(INV2, { wirksamAm: "2026-07-01" })))).toBe("lp_withdrawn");
    expect(await fehler(await post(closingPfad, { wirksamAm: "2026-07-01", zusagen: [{ organisationId: INV2, zusage: "1000" }] }))).toBe("lp_withdrawn");
    expect(await fehler(await post(aenderungPfad, { ...verringerung("1000"), investoren: [{ organisationId: INV2, neueZusage: "1000" }], wirksamAm: "2026-07-01" }))).toBe("lp_withdrawn");
    expect((await post(aenderungPfad, { art: "austritt", wirksamAm: "2026-07-01", investoren: [{ organisationId: INV1, neueZusage: "1" }] })).status).toBe(400);
  });
});

describe("Storno von Verringerung und Austritt", () => {
  const stornoPfad = (id: string) => `${closingPfad}/${id}/storno`;
  const legeAn = async (body: object) => (await json(await post(aenderungPfad, body))).id as string;

  it("stellt Zusage, Anteil, Austritt und Zeichnungskapital wieder her und behält den Vorgang", async () => {
    const vorher = await zeichnungen();
    const id = await legeAn(austritt());
    const antwort = await post(stornoPfad(id), { grund: "Austritt irrtümlich erfasst" });
    expect(antwort.status).toBe(200);
    expect((await json(antwort)).zeichnungskapital).toBe("10000000.00");
    const nachher = await zeichnungen();
    for (const org of [INV1, INV2]) expect(nachher[org]).toMatchObject({ zusage: vorher[org]!.zusage, anteil: vorher[org]!.anteil, ausgetreten: false });
    expect(await kapital()).toBe("10000000.00");
    expect(await db.select().from(s.fondsClosing)).toHaveLength(1);
    expect(await db.select().from(s.fondsClosingStorno)).toEqual([expect.objectContaining({ closingId: id })]);
    const spaeter = (await json(await post(`/funds/${ID.fonds}/postings`, abruf("2026-07-01", "1000000.00")))).movement.id;
    expect(await aufteilung(spaeter)).toEqual({ [INV1]: "600000.00", [INV2]: "400000.00" });

    const idV = await legeAn(verringerung("3000000", { wirksamAm: "2026-08-01" }));
    expect((await post(stornoPfad(idV), { grund: "Zurückgenommen" })).status).toBe(200);
    expect((await zeichnungen())[INV1]).toMatchObject({ zusage: "6000000.00", anteil: "0.600000" });
    expect(await kapital()).toBe("10000000.00");
  });

  it("lehnt das Storno ab, sobald ab dem Wirksamkeitsdatum eine Kapitalbewegung gebucht ist", async () => {
    const id = await legeAn(austritt());
    await post(`/funds/${ID.fonds}/postings`, abruf("2026-06-15", "1000.00"));
    expect(await fehler(await post(stornoPfad(id), { grund: "Irrtum" }))).toBe("lp_closing_movement_posted");
    expect((await zeichnungen())[INV2]).toMatchObject({ ausgetreten: true });
    expect(await db.select().from(s.fondsClosingStorno)).toHaveLength(0);
  });

  it("hält den Wissensstand vor der Stornierung reproduzierbar", async () => {
    const id = await legeAn(austritt());
    await warte();
    const standMitAustritt = new Date().toISOString();
    await warte();
    expect((await post(stornoPfad(id), { grund: "Irrtum" })).status).toBe(200);
    expect((await konten("2026-07-31"))["Zweiter Investor Beispiel"]).toMatchObject({ zusage: "4000000.00" });
    expect((await konten("2026-07-31", standMitAustritt))["Zweiter Investor Beispiel"]).toMatchObject({ zusage: "400000.00", offeneZusage: "0.00" });
    const grundlage = await ladeVerteilungsgrundlageZum(db, ID.fonds, "2026-07-31", standMitAustritt);
    expect(grundlage.gewichte).toEqual(["6000000.00", "0"]);
  });

  it("verlangt dieselben Rechte wie ein Closing; eine Korrektur gibt es nur für Closings", async () => {
    for (const als of [verwalterF1, investor1]) expect((await anfrage("POST", aenderungPfad, als, austritt())).status).toBe(403);
    expect(await db.select().from(s.fondsClosing)).toHaveLength(0);
    const id = await legeAn(austritt());
    const korrektur = await post(`${closingPfad}/${id}/korrektur`, { grund: "x", wirksamAm: "2026-06-01", zusagen: [{ organisationId: INV3, zusage: "1000" }] });
    expect(korrektur.status).toBe(409);
    expect(await fehler(korrektur)).toBe("lp_correction_closing_only");
    expect(await db.select().from(s.fondsClosingStorno)).toHaveLength(0);
  });
});
