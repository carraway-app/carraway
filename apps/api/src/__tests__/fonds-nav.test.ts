import { eq } from "drizzle-orm";
import { Decimal } from "@carraway/rechenkern";
import ExcelJS from "exceljs";
import { afterAll, beforeEach, expect, it } from "vitest";
import * as s from "@carraway/db";
import { ladeLpBerichtDaten } from "../berichte/daten";
import { kontrolliereBericht } from "../berichte/kontrolle";
import { erzeugeRechenregeln } from "../export/rechenregeln";
import { berechneFondsUebersicht, ladeNavBestandteile } from "../kennzahlen/fonds";
import { leeren, oeffneTestdb } from "./hilfen";
import { erstelleTestApp, legePersonAn, person } from "./hilfen-auth";
import { buchhaltungAufsetzen, uebernehmeSalden } from "./hilfen-buchhaltung";
import { aufrufe, grundbestand, ID, json } from "./hilfen-instrumente";

const { db, pool } = oeffneTestdb();
const { get, post } = aufrufe(erstelleTestApp(db));
const f = ID.fonds;
const q1 = "2025-03-31", q2 = "2025-06-30", q3 = "2025-09-30", q4 = "2025-12-31";
const berechne = (tag: string, stand?: string) => berechneFondsUebersicht(db, f, tag, stand);
async function kontrolle(tag: string, stand?: string) {
  const [bericht] = await db.insert(s.bericht).values({ fondsId: f, stichtag: tag, art: "fondsbericht", format: "pdf", sprache: "de", freigabestufen: [], erstelltVon: "test" }).returning();
  return (await kontrolliereBericht(db, bericht!, stand)).pruefungen.find((p) => p.schluessel === "nav_summe");
}
beforeEach(async () => {
  await grundbestand(db);
  await buchhaltungAufsetzen(db, f);
  await db.insert(s.bewertung).values({ beteiligungId: ID.eigen, stichtag: q1, wert: "1000.00", methode: "letzte_runde", status: "freigegeben", freigegebenAm: new Date("2025-04-01") });
  await db.insert(s.fondsZeichnung).values({ fondsId: f, organisationId: ID.orgB, zusage: "1000", anteil: "1" });
});
afterAll(async () => { await leeren(db); await pool.end(); });

it("ein Teilverkauf zum Wertansatz tauscht Forderung gegen Bank, erst die Ausschüttung mindert den NAV", async () => {
  for (const art of ["commitment", "disbursement"]) {
    expect((await post(`/investments/${ID.eigen}/transactions`, { type: art, valueDate: "2025-01-02", amount: "1000" })).status).toBe(201);
  }
  const verkauft = await post(`/beteiligungen/${ID.eigen}/verkauf`, {
    datum: q2, kaufpreis: "500.00", anteilVerkauft: 0.5, treuhand: { betrag: "199.99", freigabeAm: q3 },
  }, "bearbeiter");
  expect(verkauft.status).toBe(201);
  const { forderung } = await json(verkauft);
  expect((await post(`/forderungen/${forderung.id}/erfuellt`, { datum: q3 }, "bearbeiter")).status).toBe(200);
  await db.insert(s.fondsBewegung).values({ fondsId: f, valuta: q4, art: "ausschuettung", betrag: "80.15" });

  for (const [tag, portfolio, bank, offen, eigenkapital] of [
    [q1, "1000.00", "20.00", "0.00", "1007.66"],
    [q2, "500.00", "320.01", "199.99", "1007.66"],
    [q3, "500.00", "520.00", "0.00", "1007.66"],
    [q4, "500.00", "439.85", "0.00", "927.51"],
  ] as const) {
    await uebernehmeSalden(db, f, tag, { "0100": portfolio, "1200": bank, "1400": offen, "3300": "-12.34", "2000": `-${eigenkapital}` });
    const u = await berechne(tag);
    expect(u.beteiligungen.find((b) => b.id === ID.eigen)?.offeneForderungen).toBe(offen);
    expect(u.portfoliowert).toBe(portfolio);
    expect(u.kennzahlen.nav.wert).toBe(eigenkapital);
    expect(await kontrolle(tag)).toMatchObject({ status: "ok" });
  }
});

it("übersetzt die Bilanzsalden nur bei Übernahme und stimmt gegen die unabhängige Eigenkapitalseite ab", async () => {
  const alt = await uebernehmeSalden(db, f, q2, { "0100": "999.99", "1200": "12.34", "2000": "-1012.33" }, new Date("2025-07-01"));
  const wechsel = new Date("2025-08-01");
  await db.update(s.saldenlauf).set({ ersetztAm: wechsel }).where(eq(s.saldenlauf.id, alt));
  await uebernehmeSalden(db, f, q2, { "0100": "1000", "1200": "23.45", "2000": "-1023.45" }, wechsel);
  await db.delete(s.kontenregel).where(eq(s.kontenregel.fondsId, f));
  const stand = "2025-07-31T23:59:59Z";
  expect(await kontrolle(q2, stand)).toMatchObject({ status: "abweichung", details: [{ nav: "1012.34", eigenkapital: "1012.33", differenz: "0.01" }] });
  expect(await kontrolle(q2, wechsel.toISOString())).toMatchObject({ status: "ok" });
  const u = await json(await get(`/fonds/${f}/uebersicht?stichtag=${q2}&stand=${stand}`));
  const bestand = await ladeNavBestandteile(db, f, q2, stand);
  expect(bestand.portfolio).toEqual([{ beteiligungId: ID.eigen, bewertungId: expect.any(String), bezeichnung: "Alpha Beispiel", datum: q1, wert: "1000.00" }]);
  expect(bestand.salden).toContainEqual(expect.objectContaining({ id: expect.any(String), konto: "1200", gruppe: "bank", saldo: "12.34" }));
  const lp = await ladeLpBerichtDaten(db, f, q2, stand, stand);
  expect(u.kennzahlen.nav.wert).toBe("1012.34");
  expect(lp?.kennzahlen.nav.wert).toBe(u.kennzahlen.nav.wert);
  expect(lp?.kapitalkonten[0]?.navAnteil).toBe("1012.34");
  const xlsx = await get(`/funds/${f}/reports/fund-report?format=xlsx&stichtag=${q2}&stand=${stand}`);
  expect(xlsx.status).toBe(200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await xlsx.arrayBuffer());
  expect(wb.getWorksheet("Kennzahlen")?.getCell("B2").value).toBe(1012.34);
  expect(wb.getWorksheet("Herkunft")?.getColumn(3).values).toContain("Bankguthaben laut Saldenliste");
  expect(wb.getWorksheet("Herkunft")?.getColumn(3).values).toContainEqual(expect.stringContaining("bis zum Zahlungseingang"));
  expect(erzeugeRechenregeln(wechsel)).toContain("Bankguthaben + weitere Vermögenswerte − Verbindlichkeiten");
});

it("hält fehlende Bankzeilen, unbekannte Konten und fehlende Perioden von echten Nullsalden auseinander", async () => {
  await uebernehmeSalden(db, f, q1, { "1200": "0.00" }, new Date("2025-04-05"));
  await uebernehmeSalden(db, f, q2, { "2000": "0.00" });
  await uebernehmeSalden(db, f, q3, { "1200": "0.00", "9999": "0.01" });
  expect((await berechne(q1)).kennzahlen.nav.wert).toBe("1000");
  expect((await berechne(q1, "2025-04-04")).kennzahlen.nav.wert).toBeNull();
  for (const tag of [q2, q3, q4]) {
    const u = await berechne(tag);
    expect(u.portfoliowert).toBe("1000.00");
    for (const k of ["nav", "tvpi", "rvpi", "irr"] as const) expect(u.kennzahlen[k].wert).toBeNull();
    expect(await kontrolle(tag)).toMatchObject({ code: "NAV_SALDEN_FEHLEN", status: "abweichung" });
    expect((await ladeLpBerichtDaten(db, f, tag, undefined, new Date().toISOString()))?.kapitalkonten[0]?.navAnteil).toBeNull();
  }
});

it("erneuert gespeicherte Quartalszahlen bei Übernahme und beim Lesen eines alten Snapshots", async () => {
  const url = `/fonds/${f}/uebersicht?stichtag=${q1}`;
  const vorher = await json(await get(url));
  expect(vorher.snapshot).not.toBeNull();
  expect(vorher.kennzahlen.nav.wert).toBeNull();
  await uebernehmeSalden(db, f, q1, { "1200": "10.10" });
  const nachher = await json(await get(url));
  expect(nachher.kennzahlen.nav.wert).toBe("1010.1");
  await db.update(s.kennzahlSnapshot).set({ daten: { kennzahlen: { nav: { wert: "1000" } } } }).where(eq(s.kennzahlSnapshot.fondsId, f));
  expect((await json(await get(url))).kennzahlen.nav.wert).toBe("1010.1");
});

it("erklärt den NAV centgenau aus Bewertungen und vorzeichenrichtigen Salden desselben Laufs", async () => {
  await db.insert(s.bewertung).values({ beteiligungId: ID.darlehen, stichtag: q2, wert: "123.45", methode: "sonstige", status: "freigegeben", freigegebenAm: new Date("2025-07-01") });
  const lauf = await uebernehmeSalden(db, f, q2, { "0100": "1123.45", "1200": "10.01", "1400": "33.33", "3300": "-15.06", "2000": "-1151.73" }, new Date("2025-07-02"));
  const stand = "2025-07-03T10:00:00Z";
  const schnitt = `stichtag=${q2}&stand=${stand}`;
  const quelle = await json(await get(`/fonds/${f}/nav-einzelwerte?${schnitt}`));
  expect(quelle.portfolio).toMatchObject([{ bezeichnung: "Alpha Beispiel", datum: q1, wert: "1000.00" }, { bezeichnung: "Beta Beispiel", datum: q2, wert: "123.45" }]);
  expect(quelle.salden).toMatchObject([{ konto: "1200", saldo: "10.01", laufId: lauf }, { konto: "1400", saldo: "33.33", laufId: lauf }, { konto: "3300", saldo: "-15.06", laufId: lauf }]);
  const werte: string[] = [...quelle.portfolio.map((p: { wert: string }) => p.wert), ...quelle.salden.map((p: { saldo: string }) => p.saldo)];
  expect(Decimal.sum(...werte).toFixed(2)).toBe((await berechne(q2, stand)).kennzahlen.nav.wert);
});

it("öffnet eine ersetzte Bewertung mit ihrer damaligen Freigabe und den damals sichtbaren Belegen", async () => {
  const [alt] = await db.select().from(s.bewertung);
  const wechsel = new Date("2025-08-01");
  await db.update(s.bewertung).set({ status: "ersetzt", ersetztAm: wechsel }).where(eq(s.bewertung.id, alt!.id));
  await db.insert(s.bewertung).values({ beteiligungId: ID.eigen, stichtag: q1, wert: "950.00", methode: "sonstige", status: "freigegeben", freigegebenAm: wechsel });
  for (const [tag, name] of [["2025-06-20", "Grundlage.pdf"], ["2025-08-01", "Nachtrag.pdf"]] as const) {
    const [d] = await db.insert(s.dokument).values({ dateiname: name, sha256: name.padEnd(64, "0"), mime: "application/pdf", groesse: 100, gespeichertUnter: name, hochgeladenVon: "test", hochgeladenAm: new Date(tag) }).returning();
    await db.insert(s.dokumentVerknuepfung).values({ zielTyp: "bewertung", zielId: alt!.id, dokumentId: d!.id, erstelltAm: new Date(tag) });
    await db.insert(s.wertQuelle).values({ objektTyp: "bewertung", objektId: alt!.id, feld: "wert", wert: "1000.00", dokumentId: d!.id, seite: 2, zitat: "1.000,00", erstelltVon: "test", erstelltAm: new Date(tag) });
  }
  const schnitt = `stichtag=${q2}&stand=2025-07-03T10:00:00Z`;
  const path = `/fonds/${f}/nav-einzelwerte?${schnitt}`;
  const quelle = await json(await get(path));
  expect(quelle.portfolio).toMatchObject([{ bewertungId: alt!.id, wert: "1000.00", nachweise: [{ dateiname: "Grundlage.pdf", seite: 2 }] }]);
  const dokumentId = quelle.portfolio[0].nachweise[0].dokumentId;
  await db.insert(s.wertQuelle).values({ objektTyp: "bewertung", objektId: alt!.id, feld: "notiz", wert: "Nachtrag", dokumentId, seite: 3, zitat: "Ergänzung", erstelltVon: "test", erstelltAm: wechsel });
  const detail = await json(await get(`/documents/${dokumentId}?stand=2025-07-03T10:00:00Z`));
  expect(detail.fundstellen).toMatchObject([{ feld: "wert", seite: 2 }]);
  expect((await get(`/documents/${dokumentId}?stand=2025-06-19T23:59:59Z`)).status).toBe(404);
  const bewertungen = `/beteiligungen/${ID.eigen}/bewertungen?bewertungId=${alt!.id}&${schnitt}`;
  expect((await json(await get(bewertungen))).daten).toMatchObject([{ id: alt!.id, status: "freigegeben", ersetztAm: null, freigegebenAm: alt!.freigegebenAm!.toISOString() }]);
  const fremd = person("anderer-fonds", { rollen: { [ID.anderer]: "betrachter" } });
  expect((await get(path, fremd)).status).toBe(403);
  expect((await get(bewertungen, fremd)).status).toBe(403);
  expect((await get(`/documents/${quelle.portfolio[0].nachweise[0].dokumentId}`, fremd)).status).toBe(404);
});

it("zeigt Personen mit Portfolio am Fonds nur die dort erlaubten Einzelwerte", async () => {
  const leser = person("portfolio-herkunft");
  const mitglied = await legePersonAn(db, leser);
  const rolle = await json(await post("/permissions/roles", { name: "Herkunft", areas: ["portfolio", "finance", "documents"] }));
  expect((await post("/permissions/groups", { name: "Herkunft", level: "viewer", roleIds: [rolle.id], memberIds: [mitglied], fundsRestricted: true, areasPerFund: true, fundIds: [f, ID.anderer], fundAreas: { [f]: ["portfolio"], [ID.anderer]: ["finance", "documents"] } })).status).toBe(201);
  await uebernehmeSalden(db, f, q2, { "1200": "3.45" }, new Date("2025-07-01"));
  const url = `/fonds/${f}/nav-einzelwerte?stichtag=${q2}&stand=2025-07-03T10:00:00Z`;
  expect((await json(await get(url))).salden).toHaveLength(1);
  expect(await json(await get(url, leser))).toMatchObject({ portfolio: [{ bezeichnung: "Alpha Beispiel", nachweise: [] }], salden: [] });
});

it("bindet die Einzelwerte eines veralteten Snapshots bis zur Neuberechnung an dessen Datenstand", async () => {
  await uebernehmeSalden(db, f, q1, { "1200": "1.23" });
  const pfad = `/fonds/${f}/uebersicht?stichtag=${q1}`;
  const snapshot = await json(await get(pfad));
  expect(snapshot.kennzahlen.nav.wert).toBe("1001.23");
  const [bewertung] = await db.select().from(s.bewertung);
  const wechsel = new Date();
  await db.update(s.bewertung).set({ ersetztAm: wechsel, status: "ersetzt" }).where(eq(s.bewertung.id, bewertung!.id));
  await db.insert(s.bewertung).values({ beteiligungId: ID.eigen, stichtag: q1, wert: "55.00", methode: "sonstige", freigegebenAm: wechsel, status: "freigegeben" });
  const veraltet = await json(await get(pfad));
  expect(veraltet.snapshot.veraltet).toBe(true);
  expect(veraltet.quellenstand).toBe(snapshot.quellenstand);
  const params = new URLSearchParams({ stand: veraltet.quellenstand, stichtag: q1 });
  expect((await json(await get(`/fonds/${f}/nav-einzelwerte?${params}`))).portfolio).toMatchObject([{ bewertungId: bewertung!.id, wert: "1000.00" }]);
});
