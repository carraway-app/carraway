import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { erstelleTestApp, legePersonAn, person } from "./hilfen-auth";
import { leeren, oeffneTestdb } from "./hilfen";
import { aufrufe, grundbestand, ID, json, protokollZeilen, vorgaengeAnlegen } from "./hilfen-instrumente";

/**
 * Portfolio-Modell, Phase 3: Auswertung je Instrument. Rückflüsse inklusive gezahlter Zinsen und Dividenden, Journal ohne Kasse bei der Zinsbuchung,
 * Zinsansichten, Instrumentdaten und Instrumentfelder je Instrument. Alle Daten sind erfunden.
 */

const { db, pool } = oeffneTestdb();
const { get, post, put } = aufrufe(erstelleTestApp(db));

const betrachter = person("auswertung-betrachter", { rollen: { [ID.fonds]: "betrachter" } });
const fremd = person("auswertung-fremd", { rollen: { [ID.anderer]: "betrachter" } });
const bearbeiter = person("auswertung-bearbeiter", { rollen: { [ID.fonds]: "bearbeiter" } });

const vorgang = (b: string, koerper: unknown) => post(`/investments/${b}/transactions`, koerper);
const zahl = (w: unknown) => Number(w);

beforeEach(async () => {
  await grundbestand(db);
  for (const p of [betrachter, fremd, bearbeiter]) await legePersonAn(db, p);
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

/** Darlehen mit 100.000 ausgezahlt, 6 % jährlich nach 30E/360, eine Zinsbuchung (nicht kapitalisiert) zum 31.12.2025. */
async function darlehenMitZins() {
  expect((await vorgang(ID.darlehen, { type: "commitment", valueDate: "2025-01-01", amount: "100000" })).status).toBe(201);
  expect((await vorgang(ID.darlehen, { type: "disbursement", valueDate: "2025-01-01", amount: "100000" })).status).toBe(201);
  const kond = await post(`/beteiligungen/${ID.darlehen}/konditionen`, { gueltigAb: "2025-01-01", satzFix: "0.06", methode: "30E/360", zinsperiode: "jaehrlich", anker: "2025-12-31" });
  expect(kond.status, await kond.clone().text()).toBe(201);
  await vorgaengeAnlegen(db, [{ beteiligungId: ID.darlehen, art: "zins", valuta: "2025-12-31", betrag: "6000.00", bemerkung: "Jahreszins 2025" }]);
  const [zins] = await db.select().from(s.vorgang).where(eq(s.vorgang.art, "zins"));
  return zins!.id;
}

describe("Kennzahlen: Rückflüsse mit Zinszahlung und Dividende", () => {
  it("eine Zinsbuchung ist kein Rückfluss, erst die Zinszahlung zählt; Herkunft und IRR folgen", async () => {
    const zinsId = await darlehenMitZins();
    const vorher = await json(await get(`/beteiligungen/${ID.darlehen}?stichtag=2026-03-31`));
    expect(zahl(vorher.kennzahlen.rueckfluesse.wert)).toBe(0);
    expect(vorher.kennzahlen.rueckfluesse.schritte.at(-1).bezeichnung).toBe("Rückflüsse kumuliert (inkl. gezahlter Zinsen und Dividenden)");

    expect((await vorgang(ID.darlehen, { type: "interest_payment", valueDate: "2026-01-15", amount: "4000", settledTransactionId: zinsId })).status).toBe(201);
    expect((await vorgang(ID.darlehen, { type: "repayment", valueDate: "2026-02-01", amount: "10000" })).status).toBe(201);
    const nachher = await json(await get(`/beteiligungen/${ID.darlehen}?stichtag=2026-03-31`));
    expect(zahl(nachher.kennzahlen.rueckfluesse.wert)).toBe(14000);
    expect(nachher.kennzahlen.irr.schritte.map((x: { bezeichnung: string }) => x.bezeichnung)).toContain("Rückflüsse inkl. gezahlter Zinsen und Dividenden (2 Zahlungen)");
    // Multiple = (Bewertung 0 + 14.000) ÷ 100.000
    expect(zahl(nachher.kennzahlen.multiple.wert)).toBeCloseTo(0.14, 10);

    // Vorgangszeilen tragen Instrument, Tranche, Kapitalisierung und die beglichene Zinsbuchung.
    const zahlung = nachher.vorgaenge.find((v: { art: string }) => v.art === "zinszahlung");
    expect(zahlung).toMatchObject({ instrumentBezeichnung: "Darlehen", beglichenVorgangId: zinsId, kapitalisiert: false, trancheId: null });
    expect(zahlung.instrumentId).toEqual(expect.any(String));
    expect(nachher.instrumente).toHaveLength(1);
    expect(nachher.instrumente[0]).toMatchObject({ art: "darlehen", gezahlteZinsen: "4000.00", offeneZinsen: "2000.00", ausgezahlt: "100000.00" });

    // Fondsübersicht: dieselbe Regel in der Zeile der Beteiligung; die Zeile nennt alle Instrumente.
    const uebersicht = await json(await get(`/fonds/${ID.fonds}/uebersicht?stichtag=2026-03-31`));
    const zeile = uebersicht.beteiligungen.find((b: { id: string }) => b.id === ID.darlehen);
    expect(zeile.rueckfluesse).toBe("14000.00");
    expect(zeile.instrumente).toEqual([expect.objectContaining({ art: "darlehen", bezeichnung: "Darlehen", status: "aktiv" })]);
  });

  it("Dividenden zählen zu den Rückflüssen des Eigenkapitals", async () => {
    await vorgang(ID.eigen, { type: "commitment", valueDate: "2025-01-01", amount: "50000" });
    await vorgang(ID.eigen, { type: "disbursement", valueDate: "2025-01-01", amount: "50000" });
    expect((await vorgang(ID.eigen, { type: "dividend", valueDate: "2025-12-01", amount: "2000" })).status).toBe(201);
    const d = await json(await get(`/beteiligungen/${ID.eigen}?stichtag=2026-03-31`));
    expect(zahl(d.kennzahlen.rueckfluesse.wert)).toBe(2000);
    expect(zahl(d.kennzahlen.multiple.wert)).toBeCloseTo(0.04, 10);
    expect(d.kennzahlen.irr.wert).not.toBeNull();
  });
});

describe("Journal: Kasse bei Zinszahlung und Dividende", () => {
  it("die Zinsbuchung bewegt keine Kasse, Zinszahlung und Dividende sind Zuflüsse", async () => {
    const zinsId = await darlehenMitZins();
    await vorgang(ID.darlehen, { type: "interest_payment", valueDate: "2026-01-15", amount: "6000", settledTransactionId: zinsId });
    await vorgang(ID.eigen, { type: "commitment", valueDate: "2025-01-01", amount: "50000" });
    await vorgang(ID.eigen, { type: "dividend", valueDate: "2026-02-01", amount: "1000" });
    const j = await json(await get(`/fonds/${ID.fonds}/journal?typ=zins,zinszahlung,dividende`));
    const nach = (typ: string) => j.daten.find((z: { typ: string }) => z.typ === typ);
    expect(nach("zins")).toMatchObject({ kassenwirkung: null, richtung: null });
    expect(nach("zinszahlung")).toMatchObject({ kassenwirkung: "6000.00", richtung: "zufluss" });
    expect(nach("dividende")).toMatchObject({ kassenwirkung: "1000.00", richtung: "zufluss" });
    // Summe der Kasse: nur die beiden Zahlungen.
    expect(j.summen.gesamt.kassenwirkung).toBe("7000.00");
  });
});

describe("GET /beteiligungen/:id/zinsen und /fonds/:id/zinsen", () => {
  it("zeigt je Instrument aufgelaufen, gebucht, kapitalisiert, gezahlt, offen, nächste Fälligkeit und die Perioden mit Status", async () => {
    const zinsId = await darlehenMitZins();
    let a = await json(await get(`/beteiligungen/${ID.darlehen}/zinsen?stichtag=2026-03-31`));
    expect(a).toMatchObject({ beteiligungId: ID.darlehen, stichtag: "2026-03-31", stand: null });
    expect(a.instrumente).toHaveLength(1);
    const i = a.instrumente[0];
    expect(i).toMatchObject({ art: "darlehen", gebucht: "6000.00", kapitalisiert: "0.00", gezahlt: "0.00", offen: "6000.00", aufgelaufen: "1500.00", naechsteFaelligkeit: "2026-12-31", fehler: null });
    expect(i.konditionen).toMatchObject({ satzFix: "0.060000", methode: "30E/360", zinsperiode: "jaehrlich", kapitalisieren: false, versionen: 1 });
    // Die gebuchte Periode ist offen (nichts bezahlt), dazu das laufende Stück seit dem 31.12.2025.
    expect(i.perioden.map((p: { status: string; laufend: boolean }) => [p.status, p.laufend])).toEqual([["offen", false], ["aufgelaufen", true]]);
    expect(i.perioden[0]).toMatchObject({ bis: "2025-12-31", betrag: "6000.00", gezahlt: "0.00", offen: "6000.00", vorgangId: zinsId });
    expect(i.perioden[1]).toMatchObject({ von: "2025-12-31", bis: "2026-03-31", betrag: "1500.00", faellig: "2026-12-31" });
    expect(a.summe).toMatchObject({ aufgelaufen: "1500.00", gebucht: "6000.00", gezahlt: "0.00", offen: "6000.00" });

    // Teilzahlung mit Verweis: offen sinkt, die Periode bleibt offen.
    await vorgang(ID.darlehen, { type: "interest_payment", valueDate: "2026-01-15", amount: "4000", settledTransactionId: zinsId });
    a = await json(await get(`/beteiligungen/${ID.darlehen}/zinsen?stichtag=2026-03-31`));
    expect(a.instrumente[0]).toMatchObject({ gezahlt: "4000.00", offen: "2000.00" });
    expect(a.instrumente[0].perioden[0]).toMatchObject({ status: "offen", gezahlt: "4000.00", offen: "2000.00" });

    // Rest ohne Verweis: Die älteste offene Buchung gilt als beglichen.
    await vorgang(ID.darlehen, { type: "interest_payment", valueDate: "2026-02-15", amount: "2000" });
    a = await json(await get(`/beteiligungen/${ID.darlehen}/zinsen?stichtag=2026-03-31`));
    expect(a.instrumente[0]).toMatchObject({ gezahlt: "6000.00", offen: "0.00" });
    expect(a.instrumente[0].perioden[0]).toMatchObject({ status: "gezahlt", offen: "0.00" });

    // Früherer Stichtag: die Zahlungen von 2026 gibt es noch nicht, die Buchung ist offen, nichts läuft auf.
    const frueh = await json(await get(`/beteiligungen/${ID.darlehen}/zinsen?stichtag=2025-12-31`));
    expect(frueh.instrumente[0]).toMatchObject({ gebucht: "6000.00", gezahlt: "0.00", offen: "6000.00", aufgelaufen: "0.00" });
    // Wissensstand vor der Erfassung: noch keine Zinsbuchung.
    const davor = await json(await get(`/beteiligungen/${ID.darlehen}/zinsen?stichtag=2026-03-31&stand=2000-01-01T00:00:00Z`));
    expect(davor.instrumente[0]).toMatchObject({ gebucht: "0.00", konditionen: null, aufgelaufen: null });
    expect(davor.stand).toBe("2000-01-01T00:00:00.000Z");

    expect((await get(`/beteiligungen/00000000-0000-4000-8000-0000000000ff/zinsen`)).status).toBe(404);
  });

  it("kapitalisierte Zinsen sind nie offen; das Eigenkapital hat keine Zinsansicht", async () => {
    await vorgang(ID.darlehen, { type: "commitment", valueDate: "2025-01-01", amount: "100000" });
    await vorgang(ID.darlehen, { type: "disbursement", valueDate: "2025-01-01", amount: "100000" });
    await vorgaengeAnlegen(db, [{ beteiligungId: ID.darlehen, art: "zins", valuta: "2025-12-31", betrag: "6000.00", kapitalisiert: true }]);
    const a = await json(await get(`/beteiligungen/${ID.darlehen}/zinsen?stichtag=2026-03-31`));
    expect(a.instrumente[0]).toMatchObject({ gebucht: "6000.00", kapitalisiert: "6000.00", offen: "0.00" });
    expect(a.instrumente[0].perioden[0]).toMatchObject({ status: "gebucht", kapitalisiert: true, faellig: null });
    expect((await json(await get(`/beteiligungen/${ID.eigen}/zinsen?stichtag=2026-03-31`))).instrumente).toEqual([]);
  });

  it("Fonds-Ansicht: alle darlehensartigen Instrumente mit Unternehmen und Summen, nur mit Recht am Fonds", async () => {
    await darlehenMitZins();
    const f = await json(await get(`/fonds/${ID.fonds}/zinsen?stichtag=2026-03-31`, betrachter));
    expect(f).toMatchObject({ fondsId: ID.fonds, stichtag: "2026-03-31" });
    // Darlehen (Beta) und Wandeldarlehen (Gamma, ohne Konditionen): beide darlehensartig, das Eigenkapital fehlt.
    expect(f.instrumente.map((i: { organisation: { name: string }; art: string }) => [i.organisation.name, i.art])).toEqual([["Beta Beispiel", "darlehen"], ["Gamma Beispiel", "wandeldarlehen"]]);
    expect(f.instrumente[1]).toMatchObject({ konditionen: null, aufgelaufen: null, gebucht: "0.00", perioden: [] });
    expect(f.summe).toMatchObject({ aufgelaufen: "1500.00", gebucht: "6000.00", gezahlt: "0.00", offen: "6000.00" });
    expect((await get(`/fonds/${ID.fonds}/zinsen?stichtag=2026-03-31`, fremd)).status).toBe(403);
    expect((await get(`/beteiligungen/${ID.darlehen}/zinsen`, fremd)).status).toBe(403);
    expect((await get(`/fonds/00000000-0000-4000-8000-0000000000ff/zinsen`)).status).toBe(404);
  });
});

describe("Instrumentdaten und Instrumentfelder je Instrument", () => {
  it("instrumentdaten nennt je Instrument Zusage, Ausgezahltes, offene Zusage, offenes Kapital, gezahlte Zinsen und Tranchen; Stichtag und Stand schneiden", async () => {
    const zinsId = await darlehenMitZins();
    await vorgang(ID.darlehen, { type: "interest_payment", valueDate: "2026-01-15", amount: "4000", settledTransactionId: zinsId });
    const eigenkapital = await json(await post(`/beteiligungen/${ID.darlehen}/instrumente`, { art: "offene_beteiligung", bezeichnung: "Anteile" }));
    const tranche = await post(`/instrumente/${eigenkapital.id}/tranchen`, { bezeichnung: "Erste", betrag: "30000", zusageErhoehen: true, zusageValuta: "2026-02-01" });
    expect(tranche.status).toBe(201);
    const d = await json(await get(`/beteiligungen/${ID.darlehen}/instrumentdaten?stichtag=2026-03-31`));
    // Alte Felder bleiben (Summe über die Beteiligung)
    expect(d.zustand).toMatchObject({ zusage: "130000.00", investiert: "100000.00", zinszahlungen: "4000.00", dividenden: "0.00" });
    expect(d.instrumente).toHaveLength(2);
    const [darlehen, anteile] = d.instrumente;
    expect(darlehen).toMatchObject({ art: "darlehen", zusage: "100000.00", ausgezahlt: "100000.00", offeneZusage: "0.00", offenesKapital: "100000.00", gezahlteZinsen: "4000.00", offeneZinsen: "2000.00", buchwert: "100000.00" });
    expect(anteile).toMatchObject({ art: "offene_beteiligung", zusage: "30000.00", offeneZusage: "30000.00", gezahlteZinsen: "0.00" });
    expect(anteile.tranchen).toEqual([expect.objectContaining({ bezeichnung: "Erste", stand: expect.objectContaining({ zahlung: "zugesagt", offen: "30000.00" }) })]);
    // Früherer Stichtag: die Zusage der Tranche (Februar 2026) und die Zinszahlung gibt es noch nicht.
    const frueh = await json(await get(`/beteiligungen/${ID.darlehen}/instrumentdaten?stichtag=2025-12-31`));
    expect(frueh.instrumente[0]).toMatchObject({ gezahlteZinsen: "0.00" });
    expect(frueh.instrumente[1]).toMatchObject({ zusage: "0.00" });
    // Wissensstand vor allem: keine Tranchen
    const davor = await json(await get(`/beteiligungen/${ID.darlehen}/instrumentdaten?stand=2000-01-01T00:00:00Z`));
    expect(davor.instrumente.every((x: { tranchen: unknown[] }) => x.tranchen.length === 0)).toBe(true);
  });

  it("instrumentfelder schreibt die Felder des gewählten Instruments und spiegelt das Hauptinstrument in der Beteiligung", async () => {
    const def = await db.insert(s.feldDefinition).values({ objekt: "instrument", schluessel: "kuendigung", name: "Kündigungsfrist", typ: "text", optionen: {}, position: 1 }).returning();
    const feld = def[0]!.id;
    const zweites = await json(await post(`/beteiligungen/${ID.darlehen}/instrumente`, { art: "venture_debt", bezeichnung: "Venture Debt 2026" }));
    // Ohne instrumentId: Hauptinstrument (das Darlehen); die Beteiligung spiegelt es.
    expect((await put(`/beteiligungen/${ID.darlehen}/instrumentfelder`, { werte: { [feld]: "3 Monate" } }, bearbeiter)).status).toBe(200);
    const [haupt] = await db.select().from(s.instrument).where(eq(s.instrument.beteiligungId, ID.darlehen));
    expect(haupt!.felder).toEqual({ [feld]: "3 Monate" });
    expect((await db.select().from(s.beteiligung).where(eq(s.beteiligung.id, ID.darlehen)))[0]!.instrumentFelder).toEqual({ [feld]: "3 Monate" });
    // Mit instrumentId: nur dieses Instrument; die Spiegelung bleibt beim Hauptinstrument.
    const antwort = await put(`/beteiligungen/${ID.darlehen}/instrumentfelder`, { werte: { [feld]: "6 Monate" }, instrumentId: zweites.id }, bearbeiter);
    expect(antwort.status, await antwort.clone().text()).toBe(200);
    expect((await json(antwort)).werte).toEqual({ [feld]: "6 Monate" });
    expect((await db.select().from(s.instrument).where(eq(s.instrument.id, zweites.id)))[0]!.felder).toEqual({ [feld]: "6 Monate" });
    expect((await db.select().from(s.beteiligung).where(eq(s.beteiligung.id, ID.darlehen)))[0]!.instrumentFelder).toEqual({ [feld]: "3 Monate" });
    expect((await json(await get(`/beteiligungen/${ID.darlehen}/instrumentfelder?instrumentId=${zweites.id}`))).werte).toEqual({ [feld]: "6 Monate" });
    expect((await json(await get(`/beteiligungen/${ID.darlehen}/instrumentfelder`))).werte).toEqual({ [feld]: "3 Monate" });
    expect((await protokollZeilen(db, "instrument", "felder_setzen")).length).toBe(2);
    // Ein Instrument einer anderen Beteiligung ist nicht erlaubt.
    const fremdes = await json(await post(`/beteiligungen/${ID.eigen}/instrumente`, { art: "offene_beteiligung" }));
    const falsch = await put(`/beteiligungen/${ID.darlehen}/instrumentfelder`, { werte: { [feld]: "x" }, instrumentId: fremdes.id }, bearbeiter);
    expect(falsch.status).toBe(409);
    expect((await json(falsch)).error.code).toBe("instrument_wrong_investment");
    // Betrachter dürfen lesen, nicht schreiben.
    expect((await put(`/beteiligungen/${ID.darlehen}/instrumentfelder`, { werte: { [feld]: "y" } }, betrachter)).status).toBe(403);
  });
});

describe("Buchungsregeln für Zinszahlung und Dividende", () => {
  it("die Quellen zinszahlung und dividende lassen sich je Fonds zuordnen und stehen in der Liste", async () => {
    const verwalter = person("auswertung-verwalter", { rollen: { [ID.fonds]: "verwalter" } });
    await legePersonAn(db, verwalter);
    for (const quelle of ["interest_payment", "dividend"]) {
      const antwort = await put(`/funds/${ID.fonds}/posting-rules/${quelle}`, { account: "1200", contraAccount: quelle === "interest_payment" ? "1400" : "4900", direction: "debit", taxKey: null, postingText: `${quelle} {organisation}` }, verwalter);
      expect(antwort.status, await antwort.clone().text()).toBe(200);
    }
    const liste = (await json(await get(`/funds/${ID.fonds}/posting-rules`, verwalter))).data as { source: string; contraAccount: string }[];
    expect(liste.map((r) => [r.source, r.contraAccount]).sort()).toEqual([["dividend", "4900"], ["interest_payment", "1400"]]);
    expect((await put(`/funds/${ID.fonds}/posting-rules/unknown`, { account: "1200", contraAccount: "1400", direction: "debit", taxKey: null, postingText: "x" }, verwalter)).status).toBe(400);
  });
});

describe("Instrumentfelder: unbekannte Beteiligung", () => {
  it("antwortet mit 404 statt 500", async () => {
    const unbekannt = "00000000-0000-4000-8000-0000000000ff";
    expect((await get(`/beteiligungen/${unbekannt}/instrumentfelder`)).status).toBe(404);
    expect((await put(`/beteiligungen/${unbekannt}/instrumentfelder`, { werte: { "00000000-0000-4000-8000-0000000000ee": "x" } })).status).toBe(404);
  });
});

describe("Kennzahl-Snapshot und Instrumente", () => {
  it("ein neues Instrument macht den gespeicherten Snapshot veraltet", async () => {
    await vorgang(ID.eigen, { type: "commitment", valueDate: "2025-01-01", amount: "50000" });
    const davor = await json(await get(`/fonds/${ID.fonds}/uebersicht`, betrachter));
    expect(davor.snapshot).toMatchObject({ veraltet: false });
    expect((await post(`/beteiligungen/${ID.eigen}/instrumente`, { art: "venture_debt" })).status).toBe(201);
    const danach = await json(await get(`/fonds/${ID.fonds}/uebersicht`, betrachter));
    expect(danach.snapshot).toMatchObject({ veraltet: true });
  });
});
