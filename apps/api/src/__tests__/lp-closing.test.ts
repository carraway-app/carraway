import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { Decimal } from "@carraway/rechenkern";
import { kontenAusVerteilung, ladeKapitalkonten, ladeVerteilung } from "../berichte/daten";
import { ladeVerteilungsgrundlageZum } from "../instrumente/lp-verteilung";
import { json, leeren, oeffneTestdb } from "./hilfen";
import { aufrufe, grundbestand, ID, protokollZeilen } from "./hilfen-instrumente";
import { erstelleTestApp, legeInvestorAn, legePersonAn, person, type Testperson } from "./hilfen-auth";

/** Weiteres Closing (Issue #113): Beitritt und Aufstockung mit Wirksamkeitsdatum, stichtagsbezogene Verteilung, Ausgleich. Alle Daten sind erfunden. */

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
const verwalterF1 = person("verwalter-f1-closing", { rollen: { [ID.fonds]: "verwalter" } });
const investor1 = person("closing-inv1");
const investor3 = person("closing-inv3");
const freigeber = person("closing-freigeber", { rollen: { [ID.fonds]: "freigeber" } });

const abruf = (valueDate: string, amount: string) => ({ kind: "fund_posting", type: "capital_call", valueDate, amount });
const aufteilung = async (bewegungId: string) => {
  const antwort = await json(await get(`/fondsbewegungen/${bewegungId}`));
  return Object.fromEntries(antwort.aufteilung.map((a: { organisationId: string; betrag: string }) => [a.organisationId, a.betrag])) as Record<string, string>;
};
const summe = (teile: Record<string, string>) => Decimal.sum(...Object.values(teile).map((x) => new Decimal(x))).toFixed(2);

let abruf1 = "";
let abruf2 = "";

beforeEach(async () => {
  await grundbestand(db);
  await db.insert(s.organisation).values([
    { id: INV1, name: "Erster Investor Beispiel", art: "investor" },
    { id: INV2, name: "Zweiter Investor Beispiel", art: "investor" },
    { id: INV3, name: "Dritter Investor Beispiel", art: "investor" },
  ]);
  await legePersonAn(db, verwalterF1);
  await legePersonAn(db, freigeber);
  await legeInvestorAn(db, investor1, [INV1]);
  await legeInvestorAn(db, investor3, [INV3]);
  // Ersterfassung: 6 und 4 Millionen bei 10 Millionen Zeichnungskapital, danach der erste Abruf.
  expect((await post(`${zugangsPfad}/zeichnungen`, { zeichnungen: [{ organisationId: INV1, zusage: "6000000" }, { organisationId: INV2, zusage: "4000000" }] })).status).toBe(201);
  abruf1 = (await json(await post(`/funds/${ID.fonds}/postings`, abruf("2026-05-01", "1000000.01")))).movement.id;
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

const closing = (zusatz: object = {}) => ({
  wirksamAm: "2026-06-01",
  zusagen: [
    { organisationId: INV3, zusage: "5000000", ausgleich: { betrag: "12345.67", datum: "2026-06-15" } },
    { organisationId: INV1, zusage: "1000000" },
  ],
  ...zusatz,
});

describe("Weiteres Closing", () => {
  it("nimmt einen Investor nach dem ersten Abruf auf: Zusagen, Zeichnungskapital, Ausgleich und Protokoll", async () => {
    const antwort = await post(closingPfad, closing({ bemerkung: "Zweites Closing" }));
    expect(antwort.status).toBe(201);
    const ergebnis = await json(antwort);
    expect(ergebnis.zeichnungskapital).toBe("16000000.00");
    expect(ergebnis.zusagen).toEqual(expect.arrayContaining([
      expect.objectContaining({ organisationId: INV3, zusage: "5000000.00", ausgleichBetrag: "12345.67", ausgleichDatum: "2026-06-15", beitritt: true }),
      expect.objectContaining({ organisationId: INV1, zusage: "1000000.00", ausgleichBetrag: null, ausgleichDatum: null, beitritt: false }),
    ]));

    const zeichnungen = await db.select().from(s.fondsZeichnung).where(eq(s.fondsZeichnung.fondsId, ID.fonds));
    const je = Object.fromEntries(zeichnungen.map((z) => [z.organisationId, z]));
    expect(je[INV1]).toMatchObject({ zusage: "7000000.00", anteil: "0.437500" });
    expect(je[INV2]).toMatchObject({ zusage: "4000000.00", anteil: "0.250000" });
    expect(je[INV3]).toMatchObject({ zusage: "5000000.00", anteil: "0.312500" });

    const sicht = await json(await get(zugangsPfad));
    expect(sicht.closingMoeglich).toBe(true);
    expect(sicht.closings).toEqual([expect.objectContaining({ wirksamAm: "2026-06-01", bemerkung: "Zweites Closing", zusagen: expect.arrayContaining([expect.objectContaining({ organisationId: INV3, name: "Dritter Investor Beispiel", ausgleichBetrag: "12345.67" })]) })]);
    expect(await protokollZeilen(db, "fonds_closing", "anlegen")).toHaveLength(1);
    expect(await protokollZeilen(db, "fonds_zeichnung", "anlegen")).toHaveLength(3); // zwei Erstzeichnungen, ein Beitritt
    expect(await protokollZeilen(db, "fonds_zeichnung", "aendern")).toHaveLength(2);
  });

  it("lässt den früheren Abruf unverändert und verteilt spätere nach den dann gültigen Zusagen, in Summe genau", async () => {
    const vorher = await aufteilung(abruf1);
    expect(vorher).toEqual({ [INV1]: "600000.01", [INV2]: "400000.00" });
    expect((await post(closingPfad, closing())).status).toBe(201);

    expect(await aufteilung(abruf1)).toEqual(vorher);
    // Ein Abruf mit Valuta vor dem Wirksamkeitsdatum, erst später gebucht, behält ebenfalls die frühere Aufteilung.
    const nachgetragen = (await json(await post(`/funds/${ID.fonds}/postings`, abruf("2026-05-20", "100.01")))).movement.id;
    expect(await aufteilung(nachgetragen)).toEqual({ [INV1]: "60.01", [INV2]: "40.00" });

    // Valuta gleich dem Wirksamkeitsdatum: schon die neue Grundlage.
    const amTag = (await json(await post(`/funds/${ID.fonds}/postings`, abruf("2026-06-01", "1600000.03")))).movement.id;
    abruf2 = (await json(await post(`/funds/${ID.fonds}/postings`, abruf("2026-07-01", "1600000.03")))).movement.id;
    for (const id of [amTag, abruf2]) {
      const teile = await aufteilung(id);
      expect(Object.keys(teile).sort()).toEqual([INV1, INV2, INV3]);
      expect(summe(teile)).toBe("1600000.03");
      expect(teile).toEqual({ [INV1]: "700000.01", [INV2]: "400000.01", [INV3]: "500000.01" });
    }
    // Die Vorschau eines Abrufs vor dem Beitritt folgt der Grundlage seiner Valuta.
    const vorschau = await json(await get(`/funds/${ID.fonds}/fund-movements/preview?type=capital_call&valueDate=2026-05-10&amount=100.00`));
    expect(vorschau.allocation.map((a: { organizationId: string }) => a.organizationId).sort()).toEqual([INV1, INV2]);
  });

  it("Kostenbuchungen behalten ihre Aufteilung, sperren frühere Closings und werden im NAV-Anteil ausgeglichen (Issue #157)", async () => {
    const kosten = `${fondsPfad}/kosten`;
    const vorher = await json(await post(kosten, { art: "verwaltungsverguetung", valuta: "2026-05-15", betrag: "1000.00" }));
    expect(Object.fromEntries(vorher.aufteilung.map((a: { organisationId: string; betrag: string }) => [a.organisationId, a.betrag]))).toEqual({ [INV1]: "600.00", [INV2]: "400.00" });
    expect((await json(await post(closingPfad, closing({ wirksamAm: "2026-05-15" })))).error.code).toBe("lp_closing_before_movement");
    expect((await post(closingPfad, closing())).status).toBe(201);
    const nachher = await json(await post(kosten, { art: "fondskosten", valuta: "2026-06-02", betrag: "160.00" }));
    expect(Object.fromEntries(nachher.aufteilung.map((a: { organisationId: string; betrag: string }) => [a.organisationId, a.betrag]))).toEqual({ [INV1]: "70.00", [INV2]: "40.00", [INV3]: "50.00" });
    const closingId = (await json(await get(zugangsPfad))).closings[0].id as string;
    expect((await json(await post(`${closingPfad}/${closingId}/storno`, { grund: "Test" }))).error.code).toBe("lp_closing_movement_posted");

    const verteilung = await ladeVerteilung(db, ID.fonds, "2026-07-01", undefined);
    const konten = kontenAusVerteilung(verteilung, "16000.00");
    const je = Object.fromEntries(konten.map((k) => [k.organisationId, k]));
    expect([je[INV1]!.verwaltungsverguetung, je[INV2]!.verwaltungsverguetung, je[INV3]!.verwaltungsverguetung]).toEqual(["600.00", "400.00", "0.00"]);
    // Der später beigetretene Investor trug die frühere Vergütung nicht: sein NAV-Anteil steigt um seinen Anteil daran, die Summe bleibt der NAV.
    expect(Number(je[INV3]!.kostenausgleich)).toBeGreaterThan(0);
    expect(summe(Object.fromEntries(konten.map((k) => [k.organisationId, k.navAnteil!])))).toBe("16000.00");
  });

  it("hält Kapitalkonten und Grundlagen an Stichtagen vor und nach dem Beitritt reproduzierbar", async () => {
    const stand0 = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 20));
    expect((await post(closingPfad, closing())).status).toBe(201);
    abruf2 = (await json(await post(`/funds/${ID.fonds}/postings`, abruf("2026-07-01", "1600000.03")))).movement.id;

    const konten = async (stichtag: string, stand?: string) => Object.fromEntries((await ladeKapitalkonten(db, ID.fonds, stichtag, stand, "0")).map((k) => [k.investor, k]));
    const vor = await konten("2026-05-31");
    expect(Object.keys(vor)).toEqual(["Erster Investor Beispiel", "Zweiter Investor Beispiel"]);
    expect(vor["Erster Investor Beispiel"]).toMatchObject({ zusage: "6000000.00", anteil: "0.600000", abgerufen: "600000.01", offeneZusage: "5399999.99" });
    expect(vor["Zweiter Investor Beispiel"]).toMatchObject({ zusage: "4000000.00", abgerufen: "400000.00" });

    const nach = await konten("2026-07-31");
    expect(nach["Erster Investor Beispiel"]).toMatchObject({ zusage: "7000000.00", anteil: "0.437500", abgerufen: "1300000.02" });
    expect(nach["Zweiter Investor Beispiel"]).toMatchObject({ zusage: "4000000.00", abgerufen: "800000.01" });
    expect(nach["Dritter Investor Beispiel"]).toMatchObject({ zusage: "5000000.00", abgerufen: "500000.01", offeneZusage: "4499999.99" });
    const gesamt = Decimal.sum(...Object.values(nach).map((k) => k.abgerufen)).toFixed(2);
    expect(gesamt).toBe("2600000.04");

    // Am Tag des Beitritts gilt die neue Grundlage, am Tag davor die alte.
    expect(Object.keys(await konten("2026-06-01"))).toHaveLength(3);
    expect(Object.keys(await konten("2026-05-31"))).toHaveLength(2);

    // Wissensstand vor Erfassung des Closings: derselbe Stichtag nach dem Beitritt zeigt noch die alte Grundlage.
    const altesWissen = await konten("2026-07-31", stand0);
    expect(Object.keys(altesWissen)).toHaveLength(2);
    expect(altesWissen["Erster Investor Beispiel"]).toMatchObject({ zusage: "6000000.00" });

    expect((await ladeVerteilungsgrundlageZum(db, ID.fonds, "2026-05-31")).zeichnungen.map((z) => z.zusage)).toEqual(["6000000.00", "4000000.00"]);
    expect((await ladeVerteilungsgrundlageZum(db, ID.fonds, "2026-06-01")).zeichnungen.map((z) => z.zusage)).toEqual(["5000000.00", "7000000.00", "4000000.00"]);
    const verteilung = await ladeVerteilung(db, ID.fonds, "2026-07-31", undefined);
    expect(verteilung.bewegungen.map((b) => b.teile)).toEqual([["0.00", "600000.01", "400000.00"], ["500000.01", "700000.01", "400000.01"]]); // Reihenfolge nach Name: Dritter, Erster, Zweiter
  });

  it("verlangt Rechte und wehrt unzulässige Closings ab", async () => {
    expect((await anfrage("POST", closingPfad, verwalterF1, closing())).status).toBe(403); // nur globale Verwalter, wie bei den Zeichnungen
    expect((await anfrage("POST", closingPfad, investor1, closing())).status).toBe(403);
    const fehler = async (body: unknown) => (await json(await post(closingPfad, body))).error.code;
    expect(await fehler(closing({ wirksamAm: "2026-05-01" }))).toBe("lp_closing_before_movement");
    expect(await fehler(closing({ wirksamAm: "2026-04-30" }))).toBe("lp_closing_before_movement");
    expect(await fehler(closing({ zusagen: [{ organisationId: INV3, zusage: "1" }, { organisationId: INV3, zusage: "2" }] }))).toBe("lp_subscription_duplicate");
    expect(await fehler(closing({ zusagen: [{ organisationId: ID.orgA, zusage: "1000" }] }))).toBe("organization_not_investor");
    expect(await fehler(closing({ zusagen: [{ organisationId: INV3, zusage: "1000", ausgleich: { betrag: "0", datum: "2026-06-15" } }] }))).toBe("invalid_input");
    expect(await fehler(closing({ zusagen: [{ organisationId: INV3, zusage: "0" }] }))).toBe("invalid_input");
    await db.execute(sql`INSERT INTO periodensperre (fonds_id, gesperrt_bis, gesetzt_von) VALUES (${ID.fonds}, '2026-06-30', 'system')`);
    expect(await fehler(closing({ wirksamAm: "2026-06-30" }))).toBe("period_locked");
    await db.execute(sql`DELETE FROM periodensperre`);
    expect((await post(closingPfad, closing())).status).toBe(201);
    expect(await fehler(closing({ wirksamAm: "2026-05-15" }))).toBe("lp_closing_before_previous");
    expect(await db.select().from(s.fondsClosing)).toHaveLength(1);
  });

  it("verlangt die Ersterfassung der Zeichnungen", async () => {
    const antwort = await post(`/fonds/${ID.anderer}/investorenzugaenge/closings`, closing());
    expect((await json(antwort)).error.code).toBe("lp_closing_without_initial");
  });

  it("ein Closing ohne Ausgleich ist möglich", async () => {
    const antwort = await post(closingPfad, closing({ zusagen: [{ organisationId: INV3, zusage: "2000000" }] }));
    expect(antwort.status).toBe(201);
    expect((await db.select().from(s.fondsClosingZusage))[0]).toMatchObject({ zusage: "2000000.00", ausgleichBetrag: null, ausgleichDatum: null });
    expect((await db.select().from(s.fonds).where(eq(s.fonds.id, ID.fonds)))[0]!.zeichnungskapital).toBe("12000000.00");
  });
});

describe("Closing stornieren und korrigieren (Issue #126)", () => {
  const stornoPfad = (id: string) => `${closingPfad}/${id}/storno`;
  const korrekturPfad = (id: string) => `${closingPfad}/${id}/korrektur`;
  const legeAn = async (body: object = closing()) => (await json(await post(closingPfad, body))).id as string;
  const zeichnungen = async () => Object.fromEntries((await db.select().from(s.fondsZeichnung).where(eq(s.fondsZeichnung.fondsId, ID.fonds))).map((z) => [z.organisationId, z]));
  const kapital = async () => (await db.select().from(s.fonds).where(eq(s.fonds.id, ID.fonds)))[0]!.zeichnungskapital;
  const fehler = async (antwort: Response) => (await json(antwort)).error.code as string;

  it("stellt Zusagen, Anteile und Zeichnungskapital vor dem Closing wieder her und behält den Vorgang", async () => {
    const vorher = await zeichnungen();
    const id = await legeAn();
    expect(Object.keys(await zeichnungen())).toHaveLength(3);
    const antwort = await post(stornoPfad(id), { grund: "Zusage falsch erfasst" });
    expect(antwort.status).toBe(200);
    expect((await json(antwort)).zeichnungskapital).toBe("10000000.00");

    const nachher = await zeichnungen();
    expect(Object.keys(nachher).sort()).toEqual([INV1, INV2]);
    for (const org of [INV1, INV2]) expect(nachher[org]).toMatchObject({ zusage: vorher[org]!.zusage, anteil: vorher[org]!.anteil });
    expect(await kapital()).toBe("10000000.00");

    // Unveränderliche Historie: das Closing, seine Zusagen und Momentaufnahmen bleiben, der Storno ist ein eigener Vorgang.
    expect(await db.select().from(s.fondsClosing)).toHaveLength(1);
    expect(await db.select().from(s.fondsClosingZusage)).toHaveLength(2);
    expect(await db.select().from(s.fondsClosingStorno)).toEqual([expect.objectContaining({ closingId: id, grund: "Zusage falsch erfasst", ersetztDurch: null })]);
    expect(await protokollZeilen(db, "fonds_closing_storno", "stornieren")).toHaveLength(1);
    expect(await protokollZeilen(db, "fonds_zeichnung", "loeschen")).toHaveLength(1);
    expect(await protokollZeilen(db, "fonds_zeichnung", "aendern")).toHaveLength(4); // zwei beim Closing, zwei beim Storno
    const sicht = await json(await get(zugangsPfad));
    expect(sicht.closings).toEqual([expect.objectContaining({ id, stornierbar: false, storno: expect.objectContaining({ grund: "Zusage falsch erfasst", ersetztDurch: null }) })]);

    // Spätere Abrufe verteilen wieder nach den ursprünglichen Zusagen; Stichtage nach dem früheren Wirksamkeitsdatum zeigen keinen Beitritt.
    const spaeter = (await json(await post(`/funds/${ID.fonds}/postings`, abruf("2026-07-01", "1000000.00")))).movement.id;
    expect(await aufteilung(spaeter)).toEqual({ [INV1]: "600000.00", [INV2]: "400000.00" });
    expect(Object.keys((await ladeKapitalkonten(db, ID.fonds, "2026-07-31", undefined, "0")).reduce((a, k) => ({ ...a, [k.investor]: k }), {}))).toHaveLength(2);
    expect((await ladeVerteilungsgrundlageZum(db, ID.fonds, "2026-07-31")).zeichnungen.map((z) => z.zusage)).toEqual(["6000000.00", "4000000.00"]);
  });

  it("lehnt das Storno ab, sobald ab dem Wirksamkeitsdatum eine Kapitalbewegung gebucht ist", async () => {
    const id = await legeAn();
    expect((await post(`/funds/${ID.fonds}/postings`, abruf("2026-06-01", "1600000.03"))).status).toBe(201);
    const antwort = await post(stornoPfad(id), { grund: "Irrtum" });
    expect(antwort.status).toBe(409);
    const body = await json(antwort);
    expect(body.error.code).toBe("lp_closing_movement_posted");
    expect(body.error.message).toContain("2026-06-01");
    expect(await db.select().from(s.fondsClosingStorno)).toHaveLength(0);
    expect(Object.keys(await zeichnungen())).toHaveLength(3);
    expect(await kapital()).toBe("16000000.00");
    // Auch Korrektur geht dann nicht.
    expect(await fehler(await post(korrekturPfad(id), { ...closing(), grund: "Irrtum" }))).toBe("lp_closing_movement_posted");
  });

  it("storniert nur das letzte nicht stornierte Closing, einmal und nur im eigenen Fonds", async () => {
    const erstes = await legeAn();
    const zweites = await legeAn({ wirksamAm: "2026-07-01", zusagen: [{ organisationId: INV3, zusage: "1000000" }] });
    expect(await fehler(await post(stornoPfad(erstes), { grund: "x" }))).toBe("lp_closing_not_latest");
    expect((await post(stornoPfad(zweites), { grund: "x" })).status).toBe(200);
    expect(await fehler(await post(stornoPfad(zweites), { grund: "x" }))).toBe("lp_closing_reversed");
    // Danach ist das erste das letzte aktive.
    expect(await kapital()).toBe("16000000.00");
    expect((await post(stornoPfad(erstes), { grund: "y" })).status).toBe(200);
    expect(await kapital()).toBe("10000000.00");
    expect(await fehler(await post(`/fonds/${ID.anderer}/investorenzugaenge/closings/${erstes}/storno`, { grund: "z" }))).toBe("lp_closing_not_found");
    expect(await fehler(await post(stornoPfad("00000000-0000-4000-8000-000000000999"), { grund: "z" }))).toBe("lp_closing_not_found");
    expect((await post(stornoPfad(erstes), {})).status).toBe(400);
  });

  it("korrigiert ein Closing als Storno plus neues Closing in einer Transaktion", async () => {
    const id = await legeAn();
    const korrigiert = { wirksamAm: "2026-05-15", bemerkung: "Berichtigt", zusagen: [{ organisationId: INV3, zusage: "2000000" }], grund: "Betrag und Datum falsch" };
    const antwort = await post(korrekturPfad(id), korrigiert);
    expect(antwort.status).toBe(201);
    const neu = await json(antwort);
    expect(neu.ersetzt).toBe(id);
    expect(neu.zeichnungskapital).toBe("12000000.00");
    const z = await zeichnungen();
    expect(z[INV1]).toMatchObject({ zusage: "6000000.00", anteil: "0.500000" });
    expect(z[INV3]).toMatchObject({ zusage: "2000000.00", anteil: "0.166667" });
    expect(await db.select().from(s.fondsClosingStorno)).toEqual([expect.objectContaining({ closingId: id, ersetztDurch: neu.id })]);
    const sicht = await json(await get(zugangsPfad));
    expect(sicht.closings.map((cl: { id: string; stornierbar: boolean }) => [cl.id === id, cl.stornierbar])).toEqual([[false, true], [true, false]]); // nach Wirksamkeitsdatum sortiert
    // Der frühere Abruf (Valuta vor dem neuen Wirksamkeitsdatum) behält seine Aufteilung.
    expect(await aufteilung(abruf1)).toEqual({ [INV1]: "600000.01", [INV2]: "400000.00" });

    // Scheitert das neue Closing, bleibt das alte bestehen.
    const fehlerhaft = { wirksamAm: "2026-05-01", zusagen: [{ organisationId: INV3, zusage: "1" }], grund: "Test" };
    expect(await fehler(await post(korrekturPfad(neu.id), fehlerhaft))).toBe("lp_closing_before_movement");
    expect(await db.select().from(s.fondsClosingStorno)).toHaveLength(1);
    expect(await kapital()).toBe("12000000.00");
    expect((await json(await get(zugangsPfad))).closings.find((cl: { id: string }) => cl.id === neu.id).stornierbar).toBe(true);
  });

  it("hält den Wissensstand vor der Stornierung reproduzierbar", async () => {
    const id = await legeAn();
    abruf2 = "";
    await new Promise((r) => setTimeout(r, 20));
    const standMitClosing = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 20));
    expect((await post(stornoPfad(id), { grund: "Irrtum" })).status).toBe(200);
    await new Promise((r) => setTimeout(r, 20));
    const standNachStorno = new Date().toISOString();

    const konten = async (stichtag: string, stand?: string) => (await ladeKapitalkonten(db, ID.fonds, stichtag, stand, "0")).map((k) => [k.investor, k.zusage]);
    // Heute und nach der Stornierung: ursprüngliche Zusagen.
    expect(await konten("2026-07-31")).toEqual([["Erster Investor Beispiel", "6000000.00"], ["Zweiter Investor Beispiel", "4000000.00"]]);
    expect(await konten("2026-07-31", standNachStorno)).toEqual(await konten("2026-07-31"));
    // Mit dem Wissen vor der Stornierung gilt das Closing weiter.
    expect(await konten("2026-07-31", standMitClosing)).toEqual([["Dritter Investor Beispiel", "5000000.00"], ["Erster Investor Beispiel", "7000000.00"], ["Zweiter Investor Beispiel", "4000000.00"]]);
    expect(await konten("2026-05-31", standMitClosing)).toHaveLength(2);
    expect((await ladeVerteilungsgrundlageZum(db, ID.fonds, "2026-07-31", standMitClosing)).zeichnungen.map((z) => z.zusage)).toEqual(["5000000.00", "7000000.00", "4000000.00"]);
  });

  it("lässt nach dem Storno ein neues Closing auch mit früherem Wirksamkeitsdatum zu", async () => {
    const id = await legeAn({ wirksamAm: "2026-08-01", zusagen: [{ organisationId: INV3, zusage: "1000000" }] });
    expect((await post(stornoPfad(id), { grund: "Irrtum" })).status).toBe(200);
    expect((await post(closingPfad, closing({ wirksamAm: "2026-06-01" }))).status).toBe(201);
    expect(await kapital()).toBe("16000000.00");
  });

  it("verlangt dieselben Rechte wie das Anlegen und beachtet die Periodensperre", async () => {
    const id = await legeAn();
    for (const als of [verwalterF1, investor1]) {
      expect((await anfrage("POST", stornoPfad(id), als, { grund: "x" })).status).toBe(403);
      expect((await anfrage("POST", korrekturPfad(id), als, { ...closing(), grund: "x" })).status).toBe(403);
    }
    await db.execute(sql`INSERT INTO periodensperre (fonds_id, gesperrt_bis, gesetzt_von) VALUES (${ID.fonds}, '2026-06-30', 'system')`);
    expect(await fehler(await post(stornoPfad(id), { grund: "x" }))).toBe("period_locked");
    expect(await db.select().from(s.fondsClosingStorno)).toHaveLength(0);
  });
});
