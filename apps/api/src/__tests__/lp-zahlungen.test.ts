import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import ExcelJS from "exceljs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { Decimal, xirr } from "@carraway/rechenkern";
import { dateiSchluessel, sha256 } from "../berichte/speicher";
import { ladeKapitalstand } from "../instrumente/kapitalstand";
import { berechneFondsUebersicht } from "../kennzahlen/fonds";
import { erstelleTestApp, legePersonAn, person } from "./hilfen-auth";
import { leeren, oeffneTestdb } from "./hilfen";
import { buchhaltungAufsetzen, uebernehmeSalden } from "./hilfen-buchhaltung";
import { aufrufe, ID, json } from "./hilfen-instrumente";

const { db, pool } = oeffneTestdb();
const dateien = new Map<string, Uint8Array>();
const { post, get } = aufrufe(erstelleTestApp(db, { speicher: {
  schreibe: async (key, bytes) => { dateien.set(key, bytes); }, lese: async (key) => dateien.get(key)!,
} }));
const buchungen = `/funds/${ID.fonds}/postings`;
const aufruf = { kind: "fund_posting", type: "capital_call", amount: "200000", valueDate: "2025-01-01", dueDate: "2025-02-01" };
const zahlung = (id: string, organisationId: string, betrag: string, valuta = aufruf.dueDate) =>
  post(`/fondsbewegungen/${id}/zahlungen`, { organisationId, betrag, valuta });
const stand = (tag: string, wissen?: string) => ladeKapitalstand(db, ID.fonds, tag, wissen);
const abruf = async () => (await json(await post(buchungen, aufruf))).movement.id as string;

beforeEach(async () => {
  await leeren(db);
  dateien.clear();
  await db.insert(s.fonds).values({ id: ID.fonds, name: "Beispielfonds", kurzname: "BF", vintage: 2024, zeichnungskapital: "1000000" });
  await db.insert(s.organisation).values([{ id: ID.orgA, name: "Investor A", art: "investor" }, { id: ID.orgB, name: "Investor B", art: "investor" }]);
  await db.insert(s.fondsZeichnung).values([ID.orgA, ID.orgB].map((organisationId) => ({ fondsId: ID.fonds, organisationId, zusage: "500000", anteil: "0.5" })));
});
afterAll(async () => { await leeren(db); await pool.end(); });

describe("Abrufe und Zahlungseingänge je LP", () => {
  it("behält ohne Portfolio- oder Saldenstichtag heute bei und berücksichtigt spätere Zahlungseingänge", async () => {
    const id = await abruf();
    expect((await zahlung(id, ID.orgA, "100000")).status).toBe(201);
    const uebersicht = () => get(`/fonds/${ID.fonds}/uebersicht`).then(json);
    const heute = new Date().toISOString().slice(0, 10);
    expect(await uebersicht()).toMatchObject({ stichtag: heute, snapshot: { veraltet: false } });

    await buchhaltungAufsetzen(db, ID.fonds);
    await uebernehmeSalden(db, ID.fonds, "2025-01-31", { "1200": "0.00" });
    expect(await uebersicht()).toMatchObject({
      stichtag: "2025-02-01", kennzahlen: { eingezahlt: { wert: "100000" } }, snapshot: { veraltet: false },
    });
  });

  it("stimmt Teilzahlungen je LP mit dem Fonds ab und grenzt die Fälligkeit tagesgenau ab", async () => {
    const falsch = await get(`/funds/${ID.fonds}/fund-movements/preview?type=capital_call&amount=200000&valueDate=2025-01-10&dueDate=2025-01-09`);
    expect((await json(falsch)).error.code).toBe("due_date_before_call");
    const id = await abruf();
    expect((await json(await get(`/fondsbewegungen/${id}`))).faelligAm).toBe(aufruf.dueDate);
    expect((await zahlung(id, ID.orgA, "100000")).status).toBe(201);
    expect((await zahlung(id, ID.orgB, "40000")).status).toBe(201);
    const tag = await json(await get(`/fonds/${ID.fonds}/bewegungen/kapitalstand?stichtag=2025-02-01`));
    expect(tag.fonds).toMatchObject({ abgerufen: "200000.00", eingezahlt: "140000.00", offen: "60000.00", ueberfaellig: "0.00" });
    expect(tag.konten).toMatchObject([
      { organisationId: ID.orgA, abgerufen: "100000.00", eingezahlt: "100000.00", offen: "0.00" },
      { organisationId: ID.orgB, abgerufen: "100000.00", eingezahlt: "40000.00", offen: "60000.00" },
    ]);
    expect((await stand("2025-02-02")).fonds.ueberfaellig).toBe("60000.00");
    expect((await stand("2025-01-31")).fonds.eingezahlt).toBe("0.00");
  });

  it("schließt am Tag der Restzahlung, hält den früheren Wissensstand und öffnet mit begründetem Storno", async () => {
    const id = await abruf();
    await zahlung(id, ID.orgB, "40000");
    const zeit = (await db.execute<{ t: string }>(sql`SELECT clock_timestamp()::text AS t`)).rows[0]!.t;
    const rest = await json(await zahlung(id, ID.orgB, "60000", "2025-03-01"));
    expect((await stand("2025-03-01", zeit)).jeLp.get(ID.orgB)!.offen).toBe("60000.00");
    const pfad = `/fondsbewegungen/${id}/zahlungen/storno`;
    const korrektur = { zahlungId: rest.id, valuta: "2025-03-02", grund: "Doppelt erfasst" };
    expect((await json(await post(pfad, korrektur)))).toMatchObject({ betrag: "-60000.00", storniertZahlungId: rest.id, grund: korrektur.grund });
    expect((await post(pfad, korrektur)).status).toBe(409);
    expect((await stand("2025-02-28")).jeLp.get(ID.orgB)!.offen).toBe("60000.00");
    expect((await stand("2025-03-01")).jeLp.get(ID.orgB)!.offen).toBe("0.00");
    expect((await stand("2025-03-02")).jeLp.get(ID.orgB)!.offen).toBe("60000.00");
    expect((await zahlung(id, ID.orgB, "60000", "2025-02-28")).status).toBe(409);
    expect((await post(`/fondsbewegungen/${id}/storno`, { grund: "Korrektur" })).status).toBe(409);
  });

  it("erhält den Zahlungsstand vor dem Storno des vollständigen Abrufs", async () => {
    const id = await abruf();
    const original = await json(await zahlung(id, ID.orgA, "100000"));
    const pfad = `/fondsbewegungen/${id}`;
    expect((await post(pfad + "/zahlungen/storno", { zahlungId: original.id, valuta: "2025-03-01", grund: "Fehlbuchung" })).status).toBe(201);
    expect((await post(pfad + "/storno", { valuta: "2025-02-28", grund: "Abruf aufgehoben" })).status).toBe(409);
    expect((await post(pfad + "/storno", { valuta: "2025-03-01", grund: "Abruf aufgehoben" })).status).toBe(201);
    expect((await stand("2025-02-28")).fonds).toMatchObject({ abgerufen: "200000.00", eingezahlt: "100000.00" });
    expect((await stand("2025-03-01")).fonds).toMatchObject({ abgerufen: "0.00", eingezahlt: "0.00", offen: "0.00" });
    expect((await zahlung(id, ID.orgB, "1000")).status).toBe(409);
  });

  it("rechnet die Multiples mit den Eingängen und XIRR mit deren Wertstellung", async () => {
    const id = await abruf();
    await zahlung(id, ID.orgA, "100000");
    await zahlung(id, ID.orgB, "40000", "2025-05-01");
    await post(buchungen, { kind: "fund_posting", type: "distribution", amount: "154000", valueDate: "2026-02-01" });
    await buchhaltungAufsetzen(db, ID.fonds);
    await uebernehmeSalden(db, ID.fonds, "2026-02-01", { "1200": "35000.00", "2000": "-35000.00" });
    const { kennzahlen: k } = await berechneFondsUebersicht(db, ID.fonds, "2026-02-01");
    expect([k.dpi.wert, k.tvpi.wert, k.rvpi.wert]).toEqual(["1.1", "1.35", "0.25"]);
    const erwartet = xirr([{ datum: "2025-02-01", betrag: "-100000" }, { datum: "2025-05-01", betrag: "-40000" }, { datum: "2026-02-01", betrag: "189000" }]);
    expect(k.irr.wert).toBe(erwartet!.toString());
  });

  it("liefert deutsche und englische Excel-Beträge aus demselben Zahlungsstand", async () => {
    const id = await abruf();
    await zahlung(id, ID.orgB, "40000");
    for (const [sprache, called, paid, open] of [
      ["de", "Abrufe", "Eingezahltes Kapital", "Offene Abrufe"],
      ["en", "Capital calls", "Paid-in capital", "Outstanding calls"],
    ]) {
      const antwort = await get(`/funds/${ID.fonds}/reports/fund-report?format=xlsx&sprache=${sprache}&stichtag=2025-02-01`);
      expect(antwort.status).toBe(200);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await antwort.arrayBuffer());
      const werte = new Map();
      wb.worksheets[0]!.eachRow((r) => werte.set(r.getCell(1).text, r.getCell(2).value));
      expect([werte.get(called), werte.get(paid), werte.get(open)]).toEqual([200000, 40000, 160000]);
    }
  });

  it("erhält die freigegebene Altdatei und klärt eine Altbuchung nur in Höhe belegter Eingänge", async () => {
    const [alt] = await db.insert(s.fondsBewegung).values({ fondsId: ID.fonds, art: "abruf", valuta: aufruf.valueDate, betrag: aufruf.amount }).returning();
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Kennzahlen").addRow(["Paid-in capital", 200000]);
    const bytes = new Uint8Array(await wb.xlsx.writeBuffer());
    const id = randomUUID();
    const hash = sha256(bytes);
    const key = dateiSchluessel(id, hash, "xlsx");
    dateien.set(key, bytes);
    await db.insert(s.bericht).values({ id, fondsId: ID.fonds, art: "fondsbericht", format: "xlsx", sprache: "en", stichtag: aufruf.dueDate,
      status: "freigegeben", stand: new Date(), erstelltVon: "system", freigabestufen: [], dateiName: "fund.xlsx", dateiSchluessel: key, dateiSha256: hash, dateiGroesse: bytes.length });
    expect((await stand(aufruf.dueDate)).fonds).toMatchObject({ eingezahlt: "0.00", ungeklaert: "200000.00" });
    const beleg = await post(`/fondsbewegungen/${alt!.id}/zahlungen`, { organisationId: ID.orgB, betrag: "40000", valuta: aufruf.dueDate, belegreferenz: "Kontoauszug 2, Position 4" });
    expect(await json(beleg)).toMatchObject({ belegreferenz: "Kontoauszug 2, Position 4" });
    expect((await stand(aufruf.dueDate)).jeLp.get(ID.orgB)).toMatchObject({ eingezahlt: "40000.00", ungeklaert: "60000.00" });
    const download = await get(`/reports/${id}/file`);
    expect(download.status).toBe(200);
    expect(sha256(new Uint8Array(await download.arrayBuffer()))).toBe(hash);
  });

  it("prüft Schreibrecht und Periodensperre und serialisiert konkurrierende Teilzahlungen", async () => {
    const id = await abruf();
    const betrachter = person("lp-lesen", { rollen: { [ID.fonds]: "betrachter" } });
    await legePersonAn(db, betrachter);
    const pfad = `/fondsbewegungen/${id}/zahlungen`;
    expect((await get(pfad, betrachter)).status).toBe(200);
    expect((await post(pfad, { organisationId: ID.orgA, betrag: "5", valuta: aufruf.dueDate }, betrachter)).status).toBe(403);
    const parallel = await Promise.all([zahlung(id, ID.orgA, "70000"), zahlung(id, ID.orgA, "70000")]);
    expect(parallel.map((r) => r.status).sort()).toEqual([201, 409]);
    await db.insert(s.periodensperre).values({ fondsId: ID.fonds, gesperrtBis: aufruf.dueDate, gesetztVon: "system" });
    expect((await json(await zahlung(id, ID.orgB, "1000"))).error.code).toBe("period_locked");
  });
});

const zeitpunkt = async () => (await db.execute<{ stand: string }>(sql`SELECT to_json(clock_timestamp()) #>> '{}' AS stand`)).rows[0]!.stand;
const herkunft = (tag: string, wissen: string, bewegungId?: string) =>
  `/fonds/${ID.fonds}/bewegungen/herkunft?${new URLSearchParams({ stichtag: tag, stand: wissen, ...(bewegungId ? { bewegungId } : {}) })}`;

it("führt vom Kapitalwert zu LP-Anteil, Teilzahlung und Stornopaar am identischen Schnitt", async () => {
  const id = await abruf();
  const tag = "2025-03-31";
  const original = await json(await post(`/fondsbewegungen/${id}/zahlungen`, {
    organisationId: ID.orgA, betrag: "1234.56", valuta: "2025-02-02", belegreferenz: "Auszug 8",
  }));
  const vorStorno = await zeitpunkt();
  const gegenbuchung = await json(await post(`/fondsbewegungen/${id}/zahlungen/storno`, { zahlungId: original.id, valuta: "2025-03-01", grund: "Doppelte Buchung" }));
  const jetzt = await zeitpunkt();
  const vorher = await json(await get(herkunft(tag, vorStorno, id)));
  expect(vorher.abgerufen).toMatchObject([
    { bewegungId: id, id: ID.orgA, betrag: "100000.00", offen: "98765.44" },
    { bewegungId: id, id: ID.orgB, betrag: "100000.00", offen: "100000.00" },
  ]);
  expect(vorher.eingezahlt).toMatchObject([{ id: original.id, art: "teilzahlung", betrag: "1234.56", referenz: "Auszug 8", storniert: false }]);
  const nachher = await json(await get(herkunft(tag, jetzt)));
  expect(nachher.eingezahlt).toMatchObject([
    { id: original.id, gegenbuchungId: gegenbuchung.id, storniert: true },
    { id: gegenbuchung.id, gegenbuchungId: original.id, art: "storno", betrag: "-1234.56", grund: "Doppelte Buchung" },
  ]);
  for (const [schnitt, liste] of [[vorStorno, vorher], [jetzt, nachher]] as const) {
    const summe = (await stand(tag, schnitt)).fonds;
    for (const feld of ["abgerufen", "eingezahlt"] as const) {
      expect(Decimal.sum(...liste[feld].map((p: { betrag: string }) => p.betrag)).toFixed(2)).toBe(summe[feld]);
    }
  }
  expect((await json(await get(herkunft("2025-01-31", jetzt)))).eingezahlt).toEqual([]);
  const storno = await json(await post(`/fondsbewegungen/${id}/storno`, { valuta: "2025-03-02", grund: "Aufgehoben" }));
  const ende = await json(await get(herkunft(tag, await zeitpunkt(), id)));
  expect(ende.eingezahlt).toMatchObject([{ art: "teilzahlung", storniert: true }, { art: "storno" }]);
  expect(ende.abgerufen).toMatchObject([
    { id, storniert: true, gegenbuchungId: storno.storno.id, betrag: "200000.00" },
    { id: storno.storno.id, art: "storno", gegenbuchungId: id, betrag: "-200000.00" },
  ]);
});

it("liefert zum Abruf die freigegebenen Dateien und wahrt Wissensstand und Fondsrechte auch beim Download", async () => {
  const id = await abruf();
  const tag = "2025-03-31";
  const vorher = await zeitpunkt();
  const freigabe = await post(`/fonds/${ID.fonds}/bewegungen/${id}/mitteilungen/freigeben`, {}, "freigabe");
  expect(freigabe.status).toBe(201);
  const [dateiSchluessel, bytes] = [...dateien.entries()][0]!;
  const [beleg] = await db.insert(s.beleg).values({
    fondsId: ID.fonds, art: "kapitalabruf", bezugArt: "fonds_bewegung", bezugId: id, sprache: "de", status: "freigegeben",
    vorlage: {}, daten: {}, belegnummer: "B-000001", belegnummerLfd: 1, erstelltVon: "system", freigegebenAm: sql`now()`,
    dateiName: "Abrufbeleg.pdf", dateiSchluessel, dateiSha256: sha256(bytes), dateiGroesse: bytes.length,
  }).returning();
  const nachher = await zeitpunkt();
  const lesen = person("herkunft-belege", { rollen: { [ID.fonds]: "betrachter" } });
  const daten = await json(await get(herkunft(tag, nachher, id), lesen));
  expect(daten.nachweise.abruf).toMatchObject({ id, betrag: "200000.00" });
  expect(daten.nachweise.mitteilungen).toHaveLength(2);
  expect(daten.nachweise.belege).toMatchObject([{ id: beleg!.id, datei: "Abrufbeleg.pdf" }]);
  const belegDatei = await get(`/vouchers/${beleg!.id}/file`, lesen);
  expect(belegDatei.status).toBe(200);
  expect(sha256(new Uint8Array(await belegDatei.arrayBuffer()))).toBe(sha256(bytes));
  const m = daten.nachweise.mitteilungen[0];
  const download = (fondsId: string, wissen: string) => `/fonds/${fondsId}/bewegungen/mitteilungen/${m.id}/datei?${new URLSearchParams({ stichtag: tag, stand: wissen })}`;
  const pdf = await get(download(ID.fonds, nachher), lesen);
  expect(pdf.status).toBe(200);
  expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString()).toBe("%PDF");
  expect((await json(await get(herkunft(tag, vorher, id), lesen))).nachweise).toMatchObject({ mitteilungen: [], belege: [] });
  expect((await get(download(ID.fonds, vorher), lesen)).status).toBe(404);
  await db.insert(s.fonds).values({ id: ID.anderer, name: "Weiterer Fonds", kurzname: "WF", vintage: 2024, zeichnungskapital: "0" });
  const fremd = person("herkunft-weiterer", { rollen: { [ID.anderer]: "betrachter" } });
  expect((await get(herkunft(tag, nachher, id), fremd)).status).toBe(403);
  expect((await get(download(ID.fonds, nachher), fremd)).status).toBe(403);
  expect((await get(download(ID.anderer, nachher), fremd)).status).toBe(404);
  expect(await json(await get(herkunft(tag, nachher, id).replace(ID.fonds, ID.anderer), fremd))).toMatchObject({ abgerufen: [], eingezahlt: [], nachweise: null });
});

describe("Liquiditätsabstimmung nach tatsächlichen LP-Zahlungen (Issue #173)", () => {
  it("zählt Teil- und Restzahlung ab Wertstellung, ein Storno ab seiner eigenen Wertstellung; die Abrufe bleiben im Rechenweg sichtbar", async () => {
    const id = await abruf();
    // LP A: Teilzahlung im ersten Quartal, Rest im zweiten. LP B: Zahlung, Storno und neue Zahlung im ersten Quartal, Storno der neuen Zahlung im zweiten.
    expect((await zahlung(id, ID.orgA, "60000", "2025-01-20")).status).toBe(201);
    expect((await zahlung(id, ID.orgA, "40000", "2025-04-05")).status).toBe(201);
    const b1 = await json(await zahlung(id, ID.orgB, "100000", "2025-02-01"));
    expect((await post(`/fondsbewegungen/${id}/zahlungen/storno`, { zahlungId: b1.id, valuta: "2025-03-10", grund: "Falsches Konto" })).status).toBe(201);
    const b2 = await json(await zahlung(id, ID.orgB, "100000", "2025-03-15"));
    expect((await post(`/fondsbewegungen/${id}/zahlungen/storno`, { zahlungId: b2.id, valuta: "2025-04-10", grund: "Rücklastschrift" })).status).toBe(201);

    await buchhaltungAufsetzen(db, ID.fonds);
    const abstimmung = async (bis: string) => {
      const a = (await get(`/funds/${ID.fonds}/reconciliation?to=${bis}`).then(json)).liquidity as { carraway: string; steps: { symbol: string; label: string; value: string }[] };
      return { carraway: a.carraway, steps: a.steps.slice(0, 3).map((x) => `${x.symbol}${x.label}: ${x.value}`) };
    };
    for (const bis of ["2025-03-31", "2025-06-30"]) await uebernehmeSalden(db, ID.fonds, bis, { "1200": "0.00" });
    // 31.03.: A 60.000, B 100.000 (erste Zahlung storniert, zweite noch nicht) = 160.000; der Rest von A fehlt noch.
    expect(await abstimmung("2025-03-31")).toEqual({
      carraway: "160000.00",
      steps: ["Abrufe: 200000.00", "−Zum Periodenende nicht eingegangen: 40000.00", "=Eingegangene LP-Zahlungen (Wertstellung bis Periodenende): 160000.00"],
    });
    // 30.06.: A vollständig 100.000, B nach dem zweiten Storno nichts.
    expect((await abstimmung("2025-06-30")).carraway).toBe("100000.00");
    // Dieselbe Größe wie „Eingezahltes Kapital“ der Fondskennzahlen.
    for (const tag of ["2025-03-31", "2025-06-30"]) expect((await abstimmung(tag)).carraway).toBe(new Decimal((await stand(tag)).fonds.eingezahlt).toFixed(2));
  });
});
