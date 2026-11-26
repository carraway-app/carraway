import { eq } from "drizzle-orm";
import { afterAll, beforeEach, expect, it } from "vitest";
import * as s from "@carraway/db";
import { ladeZinsansicht } from "../instrumente/zinsansicht";
import { ladeBeteiligungDetail } from "../kennzahlen/beteiligung";
import { buchhaltungAufsetzen } from "./hilfen-buchhaltung";
import { erstelleTestApp, legePersonAn, person } from "./hilfen-auth";
import { json, leeren, oeffneTestdb } from "./hilfen";
import { grundbestand, ID, vorgaengeAnlegen } from "./hilfen-instrumente";
import { ladeGeldloseIds } from "../instrumente/geldfluss";
import { berechneAbgrenzung, ladeZinskontexte } from "../instrumente/zinsen";

const { db, pool } = oeffneTestdb();
const app = erstelleTestApp(db);
const bid = ID.darlehen;
let instrumentId: string;
const request = (path: string, body?: object) => app.requestApi(path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const waiver = (suffix = "") => `/instruments/${instrumentId}/waivers${suffix}`;
const sale = `/investments/${bid}/sale`;
const stand = async () => request(`/instruments/${instrumentId}`).then(json);
const datum = "2025-07-01";
beforeEach(async () => {
  await grundbestand(db);
  [instrumentId] = (await db.select().from(s.instrument).where(eq(s.instrument.beteiligungId, bid))).map((i) => i.id) as [string];
  await vorgaengeAnlegen(db, [
    { art: "zusage", beteiligungId: bid, valuta: "2025-01-01", betrag: "1000" },
    { art: "auszahlung", beteiligungId: bid, valuta: "2025-01-01", betrag: "1000" },
    { art: "wertberichtigung", beteiligungId: bid, valuta: "2025-01-02", betrag: "200" },
  ]);
  await db.insert(s.darlehenKondition).values({ instrumentId, beteiligungId: bid, gueltigAb: "2025-01-01", anker: "2026-01-01", methode: "30E/360", satzFix: "0.1", zinsperiode: "jaehrlich" });
});
afterAll(async () => { await leeren(db); await pool.end(); });

it("bucht Teil- und Vollverzicht samt Zinsen geldlos und storniert die Bestandteile gemeinsam", async () => {
  const body = { date: datum, principal: "250", interest: "20", reason: "Vertragsänderung" };
  const preview = await request(waiver("/preview"), body);
  expect(preview.status).toBe(200);
  const { result } = await json(preview);
  expect(result).toMatchObject({ remainingPrincipal: "750.00", impairmentUsed: "50.00", loss: "220.00", remainingCarryingAmount: "600.00" });
  expect((await request(waiver(), { ...body, interest: "50.01" })).status).toBe(400);
  const posted = await request(waiver(), body);
  expect(posted.status).toBe(201);
  const first = await json(posted);
  expect(first.result).toEqual(result);
  const ids = await ladeGeldloseIds(db, { beteiligungId: bid });
  expect(ids.size).toBe(3);
  expect((await request(`/transactions/${[...ids][0]}/reverse`, { reason: "Test" })).status).toBe(409);
  const [k] = await db.transaction((tx) => ladeZinskontexte(tx, { instrumentIds: [instrumentId] }));
  expect(berechneAbgrenzung(k!, "2026-01-01")?.gesamt).toBe("67.50");
  const rest = await request(waiver(), { ...body, principal: "750", interest: "0" }).then(json);
  expect(rest.result).toMatchObject({ remainingPrincipal: "0.00", impairmentUsed: "150.00", remainingCarryingAmount: "0.00" });
  expect((await request(waiver(`/${first.waiverId}/reverse`), { reason: "Korrektur" })).status).toBe(409);
  for (const w of [rest, first]) expect((await request(waiver(`/${w.waiverId}/reverse`), { reason: "Korrektur" })).status).toBe(201);
  expect(await stand()).toMatchObject({ outstandingPrincipal: "1000.00" });
});

it("überträgt nominales Kapital trotz Wertberichtigung und stellt es mit Verkaufsstorno wieder her", async () => {
  const body = { date: datum, purchasePrice: "300", shareSold: "0.5", instrumentId };
  const preview = await request(sale + "/preview", body);
  expect(preview.status).toBe(200);
  const p = await json(preview);
  expect(p.result).toMatchObject({ principalDisposed: "500.00" });
  const first = await request(sale, body).then(json);
  expect(first.result).toEqual(p.result);
  expect(await stand()).toMatchObject({ outstandingPrincipal: "500.00" });
  expect(await stand()).toMatchObject({ writeDowns: "100.00" });
  const full = await request(sale, { ...body, date: "2025-10-01", shareSold: "1" }).then(json);
  expect(await stand()).toMatchObject({ writeDowns: "0.00" });
  expect(full.result.principalDisposed).toBe("500.00");
  const zinsen = await db.transaction((tx) => ladeZinsansicht(tx, { beteiligungIds: [bid] }, "2026-01-01"));
  expect(zinsen.instrumente[0]).toMatchObject({ gebucht: "62.50", offen: "62.50", gezahlt: "0.00", aufgelaufen: null });
  expect(await stand()).toMatchObject({ outstandingPrincipal: "0.00" });
  for (const v of [full, first]) expect((await request(`/sales/${v.sale.id}/reverse`, { reason: "Korrektur" })).status).toBe(201);
  expect(await stand()).toMatchObject({ outstandingPrincipal: "1000.00" });
});

it("zeigt erlassene gebuchte Zinsen ohne Zahlung und hält Journal, Export und Kennzahlen auseinander", async () => {
  await vorgaengeAnlegen(db, [{ art: "zins", beteiligungId: bid, valuta: "2025-06-01", betrag: "40" }]);
  const vorher = (await ladeBeteiligungDetail(db, bid, datum))!.kennzahlen;
  const w = await request(waiver(), { date: datum, interest: "40", reason: "Zinsverzicht" }).then(json);
  expect(w.result).toMatchObject({ remainingPrincipal: "1000.00", impairmentUsed: "0.00", loss: "40.00" });
  const nachher = (await ladeBeteiligungDetail(db, bid, datum))!.kennzahlen;
  for (const key of ["irr", "multiple", "rueckfluesse"] as const) expect(nachher[key].wert).toBe(vorher[key].wert);
  const zinsen = await db.transaction((tx) => ladeZinsansicht(tx, { beteiligungIds: [bid] }, datum));
  expect(zinsen.instrumente[0]).toMatchObject({ offen: "0.00", gezahlt: "0.00" });
  expect(zinsen.instrumente[0]!.perioden[0]).toMatchObject({ offen: "0.00", gezahlt: "0.00", status: "erlassen" });
  const journal = await request(`/funds/${ID.fonds}/journal?entryType=interest_waiver`).then(json);
  expect(journal.data[0]).toMatchObject({ cashEffect: null, origin: { type: "waiver", id: w.waiverId } });
  await buchhaltungAufsetzen(db, ID.fonds);
  await db.insert(s.buchungsregel).values({ fondsId: ID.fonds, quelle: "interest_waiver", konto: "2300", gegenkonto: "1200", richtung: "S", buchungstext: "Zinsverzicht", geaendertVon: "test" });
  const exportPlan = await request(`/funds/${ID.fonds}/posting-exports/preview`, { transactionIds: [journal.data[0].id] }).then(json);
  expect(exportPlan.rows).toMatchObject([{ type: "interest_waiver", amount: "40.00", account: "2300" }]);
});

it("verlangt Schreibrecht und schützt die Periode bei Vorschau, Buchung und Storno", async () => {
  const body = { date: datum, principal: "100", reason: "Verzicht" };
  const leser = person("leser", { rollen: { [ID.fonds]: "betrachter" } });
  await legePersonAn(db, leser);
  const readonly = await app.requestApi(waiver(), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), als: leser });
  expect(readonly.status).toBe(403);
  const w = await request(waiver(), body).then(json);
  await db.insert(s.periodensperre).values({ fondsId: ID.fonds, gesperrtBis: datum, gesetztVon: "test" });
  for (const [pfad, eingabe] of [[waiver(), body], [waiver("/preview"), body], [waiver(`/${w.waiverId}/reverse`), { reason: "Korrektur" }]] as const) {
    const r = await request(pfad, eingabe);
    expect(r.status).toBe(409);
    expect((await json(r)).error.code).toBe("period_locked");
  }
});

it("serialisiert zwei konkurrierende Vollverzichte auch ohne Wertberichtigung", async () => {
  await vorgaengeAnlegen(db, [{ art: "wertberichtigung", beteiligungId: bid, valuta: datum, betrag: "-200" }]);
  const body = { date: datum, principal: "1000", reason: "Umschuldung" };
  const antworten = await Promise.all([request(waiver(), body), request(waiver(), body)]);
  expect(antworten.map((r) => r.status).sort()).toEqual([201, 400]);
  const w = await json(antworten.find((r) => r.status === 201)!);
  expect(w.result).toMatchObject({ loss: "1000.00", impairmentUsed: "0.00", remainingCarryingAmount: "0.00" });
});

it("verkauft die gleiche Quote von zwei Darlehen einer Beteiligung und lässt deren Buchwerte getrennt", async () => {
  const [zweites] = await db.insert(s.instrument).values({ beteiligungId: bid, art: "stille_beteiligung", bezeichnung: "Stille Beteiligung" }).returning();
  await db.insert(s.vorgang).values((["zusage", "auszahlung"] as const).map((art) => ({ instrumentId: zweites!.id, beteiligungId: bid, art, betrag: "240", valuta: "2025-01-03" })));
  const v = await request(sale, { date: datum, purchasePrice: "300", shareSold: "0.25" }).then(json);
  expect(v.result).toMatchObject({ principalDisposed: "310.00", carryingAmountDisposed: "260.00", result: "40.00" });
  expect(await stand()).toMatchObject({ outstandingPrincipal: "750.00", writeDowns: "150.00" });
  expect(await request(`/instruments/${zweites!.id}`).then(json)).toMatchObject({ outstandingPrincipal: "180.00", writeDowns: "0.00" });
});

it("bewahrt den historischen Teilverkauf und verhindert einen Verzicht über den verbliebenen Buchwert hinaus", async () => {
  await db.insert(s.verkauf).values({
    beteiligungId: bid, instrumentId, datum: "2025-04-01", anteilVerkauft: "0.5", kaufpreis: "400", kosten: "0",
    buchwertVorher: "800", buchwertAbgang: "400", erloes: "400", ergebnis: "0", barzufluss: "400", schritte: [],
  });
  const antwort = await request(waiver(), { date: datum, principal: "1000", reason: "Umschuldung" });
  expect(antwort.status).toBe(409);
  expect((await json(antwort)).error.code).toBe("book_value_negative");
  expect(await stand()).toMatchObject({ outstandingPrincipal: "1000.00", bookValue: "400.00" });
});
