import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { erstelleTestApp, idVon, person } from "./hilfen-auth";
import { leeren, oeffneTestdb } from "./hilfen";
import { anzahl, aufrufe, auftraege, grundbestand, ID, json, leereAuftraege, protokollZeilen } from "./hilfen-instrumente";
import { legeHauptinstrumentAn } from "../instrumente/hauptinstrument";

const { db, pool } = oeffneTestdb();
const { get, post } = aufrufe(erstelleTestApp(db));

const b = ID.eigen;
/** Schuldner des Verkäuferdarlehens: ein anderes Unternehmen (der Käufer); das Darlehen entsteht in einer eigenen Beteiligung des Fonds. */
const KAEUFER = "00000000-0000-4000-8000-0000000000e1";
const verkaufen = (koerper: object, id: string = b) => post(`/beteiligungen/${id}/verkauf`, koerper, "bearbeiter");
const summe = async (beteiligungId: string, art: s.Vorgang["art"]) =>
  (await db.select().from(s.vorgang).where(and(eq(s.vorgang.beteiligungId, beteiligungId), eq(s.vorgang.art, art)))).reduce((x, v) => x + Math.round(Number(v.betrag) * 100), 0) / 100;

beforeEach(async () => {
  await grundbestand(db);
  await db.insert(s.organisation).values({ id: KAEUFER, name: "Käufer Beispiel", art: "unternehmen" });
  // Buchwert 400.000: 500.000 investiert, 100.000 wertberichtigt; Bewertung 450.000
  await post(`/investments/${b}/transactions`, { type: "commitment", valueDate: "2025-01-01", amount: "1000000" });
  await post(`/investments/${b}/transactions`, { type: "disbursement", valueDate: "2025-02-01", amount: "500000" });
  await post(`/investments/${b}/transactions`, { type: "impairment", valueDate: "2025-12-31", amount: "100000" });
  await db.insert(s.bewertung).values({ beteiligungId: b, stichtag: "2025-12-31", wert: "450000.00", methode: "letzte_runde", status: "freigegeben" as const });
  await leereAuftraege(db);
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

describe("POST /beteiligungen/:id/verkauf", () => {
  const voll = {
    datum: "2026-06-30",
    kaufpreis: "700000",
    kosten: "10000",
    treuhand: { betrag: "50000", freigabeAm: "2027-06-30" },
    verkaeuferdarlehen: { betrag: "100000", satz: "0.05", methode: "act/365", faelligAm: "2028-06-30", schuldnerOrganisationId: KAEUFER },
    anteilVerkauft: 1,
  };

  it("vollständiger Verkauf mit Treuhand und Verkäuferdarlehen", async () => {
    const antwort = await verkaufen(voll);
    expect(antwort.status).toBe(201);
    const d = await json(antwort);
    // Buchwert 500.000 − 100.000 = 400.000; Erlös 700.000 − 10.000 = 690.000; Ergebnis 290.000; Bar 690.000 − 50.000 − 100.000
    expect(d.ergebnis).toMatchObject({ buchwertVorher: "400000.00", buchwertAbgang: "400000.00", erloes: "690000.00", ergebnis: "290000.00", barzufluss: "540000.00" });
    expect(d.ergebnis.schritte.length).toBeGreaterThan(8);
    expect(d.status).toBe("exit");
    expect(await summe(b, "rueckfluss")).toBe(540000);

    expect(d.forderung).toMatchObject({ art: "treuhand", betrag: "50000.00", faelligAm: "2027-06-30", erfuelltAm: null });

    // Verkäuferdarlehen: neues Darlehen mit Konditionen, Zusage und Auszahlung
    const [darlehen] = await db.select().from(s.beteiligung).where(eq(s.beteiligung.id, d.verkaeuferdarlehenBeteiligungId));
    expect(darlehen).toMatchObject({ fondsId: ID.fonds, organisationId: KAEUFER, instrument: "darlehen", status: "aktiv", erstinvestment: "2026-06-30" });
    expect(await summe(darlehen!.id, "auszahlung")).toBe(100000);
    expect(await summe(darlehen!.id, "zusage")).toBe(100000);
    const [kondition] = await db.select().from(s.darlehenKondition).where(eq(s.darlehenKondition.beteiligungId, darlehen!.id));
    expect(kondition).toMatchObject({ satzFix: "0.050000", methode: "act/365", zinsperiode: "endfaellig", anker: "2028-06-30", faelligAm: "2028-06-30", gueltigAb: "2026-06-30" });

    // Status, Bewertung 0, Protokoll, Neuberechnung
    expect((await db.select().from(s.beteiligung).where(eq(s.beteiligung.id, b)))[0]!.status).toBe("exit");
    expect((await db.select().from(s.bewertung).where(and(eq(s.bewertung.beteiligungId, b), eq(s.bewertung.stichtag, "2026-06-30"))))[0]!.wert).toBe("0.00");
    expect((await protokollZeilen(db, "verkauf")).map((z) => z.akteur)).toEqual([await idVon(db, person("bearbeiter"))]);
    expect(await protokollZeilen(db, "forderung", "anlegen")).toHaveLength(1);
    expect(await auftraege(db)).toBe(1);

    // Instrumentdaten: Verkauf mit Ergebnis, Forderung
    const daten = await get(`/beteiligungen/${b}/instrumentdaten`).then(json);
    expect(daten.verkaeufe).toHaveLength(1);
    expect(daten.verkaeufe[0]).toMatchObject({ ergebnis: "290000.00", ergebnisMitAnpassungen: "290000.00" });
    expect(daten.forderungen).toHaveLength(1);

    // nach dem Exit ist kein weiterer Verkauf möglich
    const nochmal = await verkaufen(voll);
    expect(nochmal.status).toBe(409);
    expect((await json(nochmal)).error.code).toBe("investment_not_active");
  });

  it("Treuhandbetrag wird bei Freigabe als Rückfluss gebucht, nur einmal", async () => {
    const d = await json(await verkaufen(voll));
    const erfuellt = await post(`/forderungen/${d.forderung.id}/erfuellt`, { datum: "2027-06-30" }, "bearbeiter");
    expect(erfuellt.status).toBe(200);
    expect((await json(erfuellt)).forderung).toMatchObject({ erfuelltAm: "2027-06-30" });
    expect(await summe(b, "rueckfluss")).toBe(590000);
    const nochmal = await post(`/forderungen/${d.forderung.id}/erfuellt`, {});
    expect(nochmal.status).toBe(409);
    expect((await json(nochmal)).error.code).toBe("receivable_settled");
    expect((await post(`/forderungen/00000000-0000-4000-8000-0000000000ee/erfuellt`, {})).status).toBe(404);
  });

  it("Kaufpreisanpassung plus und minus fließt in Rückflüsse und Ergebnis", async () => {
    await verkaufen(voll);
    const plus = await post(`/beteiligungen/${b}/kaufpreisanpassung`, { datum: "2027-01-31", betrag: "20000", grund: "Earn-out erreicht" }, "bearbeiter");
    expect(plus.status).toBe(201);
    expect((await json(plus)).vorgang).toMatchObject({ art: "rueckfluss", betrag: "20000.00", bemerkung: "Kaufpreisanpassung: Earn-out erreicht" });
    expect((await post(`/beteiligungen/${b}/kaufpreisanpassung`, { datum: "2027-02-28", betrag: "-5000", grund: "Gewährleistung" })).status).toBe(201);
    expect(await summe(b, "rueckfluss")).toBe(555000);
    const daten = await get(`/beteiligungen/${b}/instrumentdaten`).then(json);
    expect(daten.verkaeufe[0].anpassungen).toHaveLength(2);
    expect(daten.verkaeufe[0].ergebnisMitAnpassungen).toBe("305000.00");
    expect(await protokollZeilen(db, "kaufpreisanpassung", "anlegen")).toHaveLength(2);
    expect((await post(`/beteiligungen/${b}/kaufpreisanpassung`, { datum: "2027-02-28", betrag: "0", grund: "x" })).status).toBe(400);
  });

  it("Kaufpreisanpassung ohne Verkauf wird abgelehnt", async () => {
    const antwort = await post(`/beteiligungen/${ID.darlehen}/kaufpreisanpassung`, { datum: "2027-01-31", betrag: "100", grund: "Test" });
    expect(antwort.status).toBe(409);
    expect((await json(antwort)).error.code).toBe("no_sale");
  });

  it("Teilverkauf lässt die Beteiligung aktiv, halbiert die Bewertung, der zweite Verkauf rechnet mit dem Rest", async () => {
    const erster = await json(await verkaufen({ datum: "2026-06-30", kaufpreis: "300000", anteilVerkauft: 0.5 }));
    expect(erster.ergebnis).toMatchObject({ buchwertVorher: "400000.00", buchwertAbgang: "200000.00", ergebnis: "100000.00", barzufluss: "300000.00" });
    expect(erster.status).toBe("aktiv");
    expect(erster.forderung).toBeNull();
    expect(erster.verkaeuferdarlehenBeteiligungId).toBeNull();
    expect((await db.select().from(s.bewertung).where(and(eq(s.bewertung.beteiligungId, b), eq(s.bewertung.stichtag, "2026-06-30"))))[0]!.wert).toBe("225000.00");

    const daten = await get(`/beteiligungen/${b}/instrumentdaten`).then(json);
    expect(daten.buchwert.wert).toBe("200000.00");
    expect(daten.zustand.buchwertabgang).toBe("200000.00");

    const zweiter = await json(await verkaufen({ datum: "2026-12-31", kaufpreis: "250000", anteilVerkauft: "1" }));
    expect(zweiter.ergebnis).toMatchObject({ buchwertVorher: "200000.00", buchwertAbgang: "200000.00", ergebnis: "50000.00" });
    expect(zweiter.status).toBe("exit");
  });

  it("rundet den anteiligen Buchwertabgang auf Cent", async () => {
    const d = await json(await verkaufen({ datum: "2026-06-30", kaufpreis: "100000", anteilVerkauft: "0.333333" }));
    // 400.000 × 0,333333 = 133.333,20
    expect(d.ergebnis).toMatchObject({ buchwertAbgang: "133333.20", ergebnis: "-33333.20" });
  });

  it("lehnt unmögliche Aufteilungen, Doppelbeteiligung, ungültige Eingaben und fremde Zustände ab, ohne etwas zu schreiben", async () => {
    const zuViel = await verkaufen({ ...voll, kaufpreis: "100000", kosten: "0", treuhand: { betrag: "60000", freigabeAm: "2027-01-01" }, verkaeuferdarlehen: { ...voll.verkaeuferdarlehen, betrag: "50000" } });
    expect(zuViel.status).toBe(409);
    expect((await json(zuViel)).error.code).toBe("sale_invalid");

    // Der Fonds hält gegenüber dem Schuldner schon ein Darlehen: das Verkäuferdarlehen kommt nicht noch einmal dazu.
    const [vorhanden] = await db.insert(s.beteiligung).values({ fondsId: ID.fonds, organisationId: KAEUFER, instrument: "darlehen", erstinvestment: "2025-01-01" }).returning();
    await legeHauptinstrumentAn(db, vorhanden!);
    const doppelt = await verkaufen(voll);
    expect(doppelt.status).toBe(409);
    expect((await json(doppelt)).error.code).toBe("investment_exists");
    // anderer Schuldner löst es; hat der Fonds an ihm schon eine Beteiligung (hier das Wandeldarlehen), kommt das Darlehen als weiteres Instrument dazu
    const ok = await verkaufen({ ...voll, verkaeuferdarlehen: { ...voll.verkaeuferdarlehen, schuldnerOrganisationId: ID.orgC } });
    expect(ok.status).toBe(201);
    expect((await json(ok)).verkaeuferdarlehenBeteiligungId).toBe(ID.wandel);
    expect((await db.select().from(s.instrument).where(eq(s.instrument.beteiligungId, ID.wandel))).map((i) => i.art).sort()).toEqual(["darlehen", "wandeldarlehen"]);

    expect(await anzahl(db, "verkauf")).toBe(1);
  });

  it("schützt Verkaufsdatum und Fälligkeit des Verkäuferdarlehens", async () => {
    const fern = await verkaufen({ datum: "9999-12-31", kaufpreis: "1", anteilVerkauft: 1 });
    expect(fern.status).toBe(400);
    expect((await json(fern)).error.fields[0]).toMatchObject({ field: "datum", code: "as_of_out_of_range" });
    const fernFaellig = await verkaufen({ ...voll, verkaeuferdarlehen: { ...voll.verkaeuferdarlehen, faelligAm: "9999-12-31" } });
    expect(fernFaellig.status).toBe(400);
    expect((await json(fernFaellig)).error.fields[0]).toMatchObject({ field: "verkaeuferdarlehen.faelligAm", code: "date_out_of_range" });
    expect(await anzahl(db, "verkauf")).toBe(0);
  });

  it("validiert die Eingabe", async () => {
    for (const falsch of [
      { ...voll, anteilVerkauft: 0 },
      { ...voll, anteilVerkauft: 1.5 },
      { ...voll, kaufpreis: "-1" },
      { ...voll, verkaeuferdarlehen: { ...voll.verkaeuferdarlehen, faelligAm: "2026-06-30" } },
      { ...voll, treuhand: { betrag: "1", freigabeAm: "2026-01-01" } },
      { ...voll, datum: "morgen" },
    ]) {
      expect((await verkaufen(falsch)).status).toBe(400);
    }
    expect((await verkaufen(voll, "00000000-0000-4000-8000-0000000000ff")).status).toBe(404);
    expect(await anzahl(db, "verkauf")).toBe(0);
  });
});

describe("POST /beteiligungen/:id/insolvenz", () => {
  it("setzt Status und Bewertung null und führt auf Wunsch die Wertberichtigung auf null", async () => {
    const antwort = await post(`/beteiligungen/${b}/insolvenz`, { datum: "2026-03-15", wertberichtigungAufNull: true }, "bearbeiter");
    expect(antwort.status).toBe(200);
    const d = await json(antwort);
    expect(d.beteiligung.status).toBe("insolvent");
    expect(d.wertberichtigung).toMatchObject({ art: "wertberichtigung", betrag: "400000.00", valuta: "2026-03-15" });
    expect((await db.select().from(s.bewertung).where(and(eq(s.bewertung.beteiligungId, b), eq(s.bewertung.stichtag, "2026-03-15"))))[0]!.wert).toBe("0.00");
    const daten = await get(`/beteiligungen/${b}/instrumentdaten`).then(json);
    expect(daten.buchwert.wert).toBe("0.00");
    expect(await protokollZeilen(db, "beteiligung", "insolvenz")).toHaveLength(1);
    expect(await auftraege(db)).toBe(1);
    const nochmal = await post(`/beteiligungen/${b}/insolvenz`, { datum: "2026-03-16" });
    expect(nochmal.status).toBe(409);
    expect((await json(nochmal)).error.code).toBe("investment_not_active");
  });

  it("ohne Wertberichtigung bleibt der Buchwert, eine vorhandene Bewertung am Tag wird auf null gesetzt", async () => {
    await db.insert(s.bewertung).values({ beteiligungId: b, stichtag: "2026-03-31", wert: "300000.00", methode: "dcf", status: "freigegeben" as const });
    await leereAuftraege(db);
    const d = await json(await post(`/beteiligungen/${b}/insolvenz`, { datum: "2026-03-31" }));
    expect(d.wertberichtigung).toBeNull();
    const am = await db.select().from(s.bewertung).where(and(eq(s.bewertung.beteiligungId, b), eq(s.bewertung.stichtag, "2026-03-31")));
    expect(am).toHaveLength(2);
    const geltend = am.find((w) => w.status === "freigegeben")!;
    const alt = am.find((w) => w.status === "ersetzt")!;
    expect(geltend.wert).toBe("0.00");
    expect(geltend.ersetztBewertungId).toBe(alt.id);
    expect(alt.wert).toBe("300000.00");
    expect((await get(`/beteiligungen/${b}/instrumentdaten`).then(json)).buchwert.wert).toBe("400000.00");
    expect(await auftraege(db)).toBe(1);
    expect((await post(`/beteiligungen/${b}/insolvenz`, { datum: "gestern" })).status).toBe(400);
    expect((await post(`/beteiligungen/00000000-0000-4000-8000-0000000000ff/insolvenz`, { datum: "2026-03-31" })).status).toBe(404);
  });
});
