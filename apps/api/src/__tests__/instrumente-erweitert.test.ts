import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { erstelleTestApp, person } from "./hilfen-auth";
import { leeren, oeffneTestdb, vehikelVon } from "./hilfen";
import { aufrufe, grundbestand, ID, json, protokollZeilen } from "./hilfen-instrumente";

// SAFE (#149), Optionsscheine (#150), Anteilsübertragung (#151) und Buchwert je Instrument nach Verkauf der ganzen Beteiligung (#208).
// Alle Beträge erfunden. Grundlage: Runde „Serie A“ der Alpha Beispiel am 01.03.2026 zu 12,50 je Anteil, 800.000 Anteile danach;
// Investor X (Vehikel) hält 160.000 Anteile der Klasse „Serie A“ (2.000.000 investiert), der Fonds 80.000 (1.000.000), Rest Stammanteile.
const { db, pool } = oeffneTestdb();
const { get, post, patch } = aufrufe(erstelleTestApp(db));

const ORG = ID.orgA;
const X = "00000000-0000-4000-8000-0000000000e1";
const Y = "00000000-0000-4000-8000-0000000000e2";
let rundeId = "";
let klasseId = "";
let positionX = "";
let positionFonds = "";
let hauptEigen = "";

const tabelle = async (stichtag: string, beteiligungId: string = ID.eigen, extra = "") => {
  const antwort = await get(`/beteiligungen/${beteiligungId}/kapitaltabelle?stichtag=${stichtag}${extra}`);
  expect(antwort.status, await antwort.clone().text()).toBe(200);
  return json(antwort);
};
const instrumente = async (beteiligungId: string = ID.eigen) => (await json(await get(`/beteiligungen/${beteiligungId}/instrumente`))).daten as { id: string; art: string; buchwert: string; buchwertabgang: string; status: string; optionsschein: Record<string, unknown> | null }[];
const zeile = (d: { zeilen: { id: string }[] }, id: string) => d.zeilen.find((z) => z.id === id) as unknown as Record<string, unknown> & { anteile: string; investiert: string };
const uebertragen = (koerper: object) => post(`/organisationen/${ID.orgA}/share-transfers`, koerper);
const summe = async (instrumentId: string, art: s.Vorgang["art"]) =>
  (await db.select().from(s.vorgang).where(and(eq(s.vorgang.instrumentId, instrumentId), eq(s.vorgang.art, art)))).reduce((x, v) => x + Math.round(Number(v.betrag) * 100), 0) / 100;

beforeEach(async () => {
  await grundbestand(db);
  await db.insert(s.organisation).values([
    { id: X, name: "Investor X Beispiel", art: "investor" },
    { id: Y, name: "Investor Y Beispiel", art: "investor" },
  ]);
  hauptEigen = (await db.select().from(s.instrument).where(eq(s.instrument.beteiligungId, ID.eigen)))[0]!.id;
  const [k] = await db.insert(s.anteilsklasse).values({ organisationId: ID.orgA, name: "Serie A", rang: 1, praeferenzFaktor: "1" }).returning();
  klasseId = k!.id;
  const [runde] = await db
    .insert(s.finanzierungsrunde)
    .values({ organisationId: ID.orgA, bezeichnung: "Serie A", datum: "2026-03-01", preMoney: "7000000", postMoney: "10000000", preisJeAnteil: "12.5000", anteileGesamtNach: "800000" })
    .returning();
  rundeId = runde!.id;
  const [px, pf] = await db
    .insert(s.rundenposition)
    .values([
      { rundeId, vehikelId: await vehikelVon(db, X), betrag: "2000000.00", anteile: "160000", rolle: "lead", anteilsklasseId: klasseId },
      { rundeId, fondsId: ID.fonds, betrag: "1000000.00", anteile: "80000", rolle: "co", anteilsklasseId: klasseId, instrumentId: hauptEigen },
    ])
    .returning();
  positionX = px!.id;
  positionFonds = pf!.id;
  await post(`/investments/${ID.eigen}/transactions`, { type: "commitment", valueDate: "2026-03-01", amount: "1000000" });
  await post(`/investments/${ID.eigen}/transactions`, { type: "disbursement", valueDate: "2026-03-01", amount: "1000000" });
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

describe("SAFE (#149)", () => {
  async function legeSafeAn() {
    const antwort = await post(`/beteiligungen/${ID.eigen}/instrumente`, { art: "safe", bezeichnung: "SAFE 2026", wandlungsabschlag: "0.2", bewertungsobergrenze: "6000000.00" });
    expect(antwort.status, await antwort.clone().text()).toBe(201);
    const safe = await json(antwort);
    await post(`/investments/${ID.eigen}/transactions`, { type: "commitment", valueDate: "2026-04-01", amount: "250000", instrumentId: safe.id });
    await post(`/investments/${ID.eigen}/transactions`, { type: "disbursement", valueDate: "2026-04-01", amount: "250000", instrumentId: safe.id });
    return safe.id as string;
  }

  it("Instrument mit Abschlag und Bewertungsobergrenze; „Zinsen wandeln“ und Optionsschein-Felder gibt es beim SAFE nicht", async () => {
    expect((await post(`/beteiligungen/${ID.eigen}/instrumente`, { art: "safe", zinsenWandeln: true })).status).toBe(409);
    expect((await json(await post(`/beteiligungen/${ID.eigen}/instrumente`, { art: "safe", ausuebungspreis: "1" }))).error.code).toBe("instrument_not_warrant");
    const id = await legeSafeAn();
    const i = (await instrumente()).find((x) => x.id === id)!;
    expect(i).toMatchObject({ art: "safe", wandlungsabschlag: "0.200000", bewertungsobergrenze: "6000000.00", zinsenWandeln: null, darlehensartig: false, buchwert: "250000.00" });
    // Abschlag am Darlehen: weiter nur Wandeldarlehen und SAFE
    expect((await patch(`/instrumente/${hauptEigen}`, { wandlungsabschlag: "0.1" })).status).toBe(409);
  });

  it("offene Wandlung in der voll verwässerten Sicht: ohne Zinsen, ohne Annahme, Cap greift", async () => {
    const id = await legeSafeAn();
    const d = await tabelle("2026-07-01", ID.eigen, "&offeneWandlungen=true");
    const w = d.offeneWandlungen.liste.find((x: { instrumentId: string }) => x.instrumentId === id);
    // Cap 6.000.000 ÷ 800.000 = 7,50 unter 12,50 × 0,8 = 10,00; 250.000 ÷ 7,50 = 33.333 Anteile (abgerundet)
    expect(w).toMatchObject({ art: "safe", status: "geschaetzt", kapital: "250000.00", zinsen: "0.00", hinweise: [], zinsenWandeln: false, zinsenWandelnAngenommen: false, massgeblich: "bewertungsobergrenze", anteile: "33333" });
    expect(d.anteileMitWandlungen).toBe("833333");
  });

  it("Wandlung über die vorhandene Wandellogik: keine Konditionen nötig, keine Zinsbuchung, SAFE gewandelt", async () => {
    const id = await legeSafeAn();
    const [r2] = await db
      .insert(s.finanzierungsrunde)
      .values({ organisationId: ID.orgA, bezeichnung: "Serie B", datum: "2026-06-01", preMoney: "15000000", postMoney: "20000000", preisJeAnteil: "20.0000", anteileGesamtNach: "1000000" })
      .returning();
    const antwort = await post(`/beteiligungen/${ID.eigen}/wandlung`, {
      instrumentId: id,
      cutoff: "2026-06-01",
      zinsenWandeln: true,
      preisregel: { discount: "0.2", bewertungsobergrenze: { betrag: "6000000", anteileVorRunde: "800000" } },
      nennwertJeAnteil: "1",
      runde: { id: r2!.id },
      rolle: "co",
    });
    expect(antwort.status, await antwort.clone().text()).toBe(201);
    const d = await json(antwort);
    // 250.000 ÷ 7,50 = 33.333 Anteile, Spitzenbetrag 2,50
    expect(d.ergebnis).toMatchObject({ zinsenGebucht: "0", wandlungsbetrag: "250000", preisJeAnteil: "7.5", anzahlAnteile: "33333", massgeblich: "bewertungsobergrenze" });
    expect(d.wandlung.zinsenWandeln).toBe(false);
    expect(await summe(id, "zins")).toBe(0);
    expect(await summe(id, "tilgung")).toBe(250000);
    const nachher = await instrumente();
    expect(nachher.find((x) => x.id === id)).toMatchObject({ status: "gewandelt", buchwert: "0.00" });
    expect(nachher.find((x) => x.id === d.zielInstrumentId)).toMatchObject({ art: "offene_beteiligung", buchwert: "249997.50" });
  });
});

describe("Optionsscheine (#150)", () => {
  async function legeOptionsscheineAn(werte: object = {}) {
    const antwort = await post(`/beteiligungen/${ID.eigen}/instrumente`, { art: "optionsschein", bezeichnung: "Optionsscheine zur Venture Debt", optionsscheinAnzahl: "20000", ausuebungspreis: "1.25", ausgabeAm: "2026-01-15", laufzeitBis: "2031-01-14", ...werte });
    expect(antwort.status, await antwort.clone().text()).toBe(201);
    return (await json(antwort)).id as string;
  }

  it("Anzahl und Ausübungspreis sind Pflicht, Laufzeit nicht vor der Ausgabe", async () => {
    expect((await post(`/beteiligungen/${ID.eigen}/instrumente`, { art: "optionsschein" })).status).toBe(400);
    expect((await post(`/beteiligungen/${ID.eigen}/instrumente`, { art: "optionsschein", optionsscheinAnzahl: "10", ausuebungspreis: "1", ausgabeAm: "2026-02-01", laufzeitBis: "2026-01-01" })).status).toBe(400);
    expect((await post(`/beteiligungen/${ID.eigen}/instrumente`, { art: "darlehen", optionsscheinAnzahl: "10" })).status).toBe(409);
  });

  it("voll verwässert: nicht ausgeübte Optionsscheine als eigene Zeile des Fonds; unverwässert unverändert", async () => {
    const id = await legeOptionsscheineAn();
    const d = await tabelle("2026-07-01");
    expect(d.anteileUnverwaessert).toBe("800000");
    expect(d.anteileVollVerwaessert).toBe("820000");
    expect(d.mitOptionsscheinen).toBe(true);
    expect(zeile(d, `optionsschein:${id}`)).toMatchObject({ anteile: "20000", ausgegeben: false, diesesFonds: true, anteilUnverwaessert: null, anteilVollVerwaessert: "0.024390" });
    expect(d.klassen.find((k: { art: string }) => k.art === "optionsschein")).toMatchObject({ anteile: "20000", anteilUnverwaessert: null });
    // Fonds voll verwässert: 80.000 + 20.000 von 820.000
    expect(d.diesesFonds).toMatchObject({ anteile: "100000", anteilUnverwaessert: "0.100000", anteilVollVerwaessert: "0.121951" });
    // vor der Ausgabe und nach dem Ende der Laufzeit nicht
    expect((await tabelle("2026-01-14")).anteileVollVerwaessert).toBe("0");
    expect((await tabelle("2031-01-15")).zeilen.some((z: { halter: { art: string } }) => z.halter.art === "optionsschein")).toBe(false);
  });

  it("Exit-Wasserfall: nicht ausgeübte Optionsscheine wie eine Option mit dem Ausübungspreis, eigene Gruppe, zählen zum Fonds", async () => {
    const id = await legeOptionsscheineAn();
    const antwort = await post(`/beteiligungen/${ID.eigen}/wasserfall`, { exitwert: "41000000", exitdatum: "2026-07-01" });
    expect(antwort.status, await antwort.clone().text()).toBe(200);
    const w = await json(antwort);
    const z = w.zeilen.find((x: { id: string }) => x.id === `optionsschein:${id}`);
    expect(z).toMatchObject({ halter: { art: "optionsschein", id }, diesesFonds: true, optionsschein: { instrumentId: id, ausuebungspreis: "1.2500", imGeld: true } });
    expect(Number(z.gesamt)).toBeGreaterThan(0);
    expect(w.klassen.some((k: { art: string }) => k.art === "optionsschein")).toBe(true);
    const eigene = w.zeilen.filter((x: { diesesFonds: boolean }) => x.diesesFonds).reduce((a: number, x: { gesamt: string }) => a + Number(x.gesamt), 0);
    expect(Number(w.fonds.gesamt)).toBeCloseTo(eigene, 2);
    expect(w.schritte.some((x: { bezeichnung: string }) => x.bezeichnung.startsWith("Optionsscheine: nicht ausgeübte Anteile"))).toBe(true);
  });

  it("Ausübung nach der Runde: Zusage und Auszahlung auf dem Instrument, Anteile kommen unverwässert hinzu", async () => {
    const id = await legeOptionsscheineAn();
    const antwort = await post(`/instrumente/${id}/exercises`, { date: "2026-05-01", shares: "5000" });
    expect(antwort.status, await antwort.clone().text()).toBe(201);
    const d = await json(antwort);
    expect(d.exercise).toMatchObject({ shares: "5000", pricePerShare: "1.2500", amount: "6250.00" });
    expect(d.remainingWarrants).toBe("15000");
    expect(d.instrument.optionsschein).toMatchObject({ ausgeuebt: "5000", offen: "15000", status: "laufend" });
    expect(await summe(id, "zusage")).toBe(6250);
    expect(await summe(id, "auszahlung")).toBe(6250);
    expect((await instrumente()).find((x) => x.id === id)!.buchwert).toBe("6250.00");
    expect((await protokollZeilen(db, "optionsschein_ausuebung")).length).toBe(1);
    const t = await tabelle("2026-07-01");
    expect(t.anteileUnverwaessert).toBe("805000");
    expect(t.anteileVollVerwaessert).toBe("820000");
    expect(zeile(t, `ausuebung:${d.exercise.id}`)).toMatchObject({ anteile: "5000", investiert: "6250.00", ausgegeben: true, diesesFonds: true, halter: { art: "fonds", id: ID.fonds } });
    expect(zeile(t, `optionsschein:${id}`).anteile).toBe("15000");
    expect(zeile(t, "stamm").anteile).toBe("560000");
    // vor der Ausübung noch alles offen
    expect((await tabelle("2026-04-30")).anteileUnverwaessert).toBe("800000");
  });

  it("Ausübung vor einer Runde steckt in deren Gesamtzahl: weniger Stammanteile, gleiche Gesamtzahl", async () => {
    const id = await legeOptionsscheineAn();
    const d = await json(await post(`/instrumente/${id}/exercises`, { date: "2026-02-01", shares: "5000" }));
    const t = await tabelle("2026-07-01");
    expect(t.anteileUnverwaessert).toBe("800000");
    expect(zeile(t, "stamm").anteile).toBe("555000");
    expect(zeile(t, `ausuebung:${d.exercise.id}`).anteile).toBe("5000");
  });

  it("nicht mehr als offen, nur in der Laufzeit, nur Optionsscheine; Anzahl nicht unter die ausgeübten", async () => {
    const id = await legeOptionsscheineAn();
    await post(`/instrumente/${id}/exercises`, { date: "2026-05-01", shares: "15000" });
    expect((await json(await post(`/instrumente/${id}/exercises`, { date: "2026-06-01", shares: "5001" }))).error.code).toBe("warrant_exercise_invalid");
    expect((await post(`/instrumente/${id}/exercises`, { date: "2026-01-10", shares: "1" })).status).toBe(409);
    expect((await json(await post(`/instrumente/${hauptEigen}/exercises`, { date: "2026-05-01", shares: "1" }))).error.code).toBe("instrument_mismatch");
    expect((await json(await patch(`/instrumente/${id}`, { optionsscheinAnzahl: "14999" }))).error.code).toBe("warrant_exercised");
    expect((await patch(`/instrumente/${id}`, { optionsscheinAnzahl: "16000" })).status).toBe(200);
  });
});

describe("Anteilsübertragung (#151)", () => {
  it("zwischen Dritten: Anteile und anteilige Präferenzbasis wandern, Gesamtzahl gleich, Rückfluss des Fonds im Wasserfall unverändert", async () => {
    const vorher = await json(await post(`/beteiligungen/${ID.eigen}/wasserfall`, { exitwert: "2500000", exitdatum: "2026-07-01" }));
    const antwort = await uebertragen({ date: "2026-05-01", source: positionX, buyerOrganizationId: Y, shares: "40000", pricePerShare: "15" });
    expect(antwort.status, await antwort.clone().text()).toBe(201);
    const u = await json(antwort);
    expect(u).toMatchObject({ source: positionX, shares: "40000", pricePerShare: "15.000000", purchasePrice: "600000.00", saleId: null, buyerInstrumentId: null, seller: { type: "investor", id: X }, buyer: { type: "investor", id: Y } });
    const t = await tabelle("2026-07-01");
    expect(t.anteileUnverwaessert).toBe("800000");
    expect(zeile(t, positionX)).toMatchObject({ anteile: "120000", investiert: "1500000.00" });
    expect(zeile(t, `uebertragung:${u.id}`)).toMatchObject({ anteile: "40000", investiert: "500000.00", klasseId, runde: { id: rundeId }, halter: { art: "organisation", id: Y }, uebertragung: { id: u.id, kaufpreis: "600000.00", quelleId: positionX } });
    // Herkunft der mitgenommenen Präferenzbasis: 2.000.000 × 40.000 ÷ 160.000 = 500.000
    expect((zeile(t, `uebertragung:${u.id}`).uebertragung as { schritte: { wert: string }[] }).schritte.at(-1)?.wert).toBe("500000");
    // vor dem Datum gilt der alte Stand
    expect(zeile(await tabelle("2026-04-30"), positionX).anteile).toBe("160000");
    const nachher = await json(await post(`/beteiligungen/${ID.eigen}/wasserfall`, { exitwert: "2500000", exitdatum: "2026-07-01" }));
    expect(nachher.fonds.gesamt).toBe(vorher.fonds.gesamt);
    expect(nachher.zeilen.find((z: { id: string }) => z.id === `uebertragung:${u.id}`).praeferenz).toBe("416666.67");
  });

  it("Zugang eines eigenen Fonds aus Stammanteilen: Beteiligung und Instrument entstehen, Zusage und Auszahlung des Kaufpreises", async () => {
    const antwort = await uebertragen({ date: "2026-05-01", source: "stamm", buyerFundId: ID.anderer, shares: "10000", pricePerShare: "10" });
    expect(antwort.status, await antwort.clone().text()).toBe(201);
    const u = await json(antwort);
    expect(u.buyerInstrumentId).not.toBeNull();
    const [b] = await db.select().from(s.beteiligung).where(and(eq(s.beteiligung.fondsId, ID.anderer), eq(s.beteiligung.organisationId, ID.orgA)));
    expect(b).toBeTruthy();
    expect(await summe(u.buyerInstrumentId, "zusage")).toBe(100000);
    expect(await summe(u.buyerInstrumentId, "auszahlung")).toBe(100000);
    const t = await tabelle("2026-07-01", b!.id);
    expect(zeile(t, "stamm").anteile).toBe("550000");
    expect(zeile(t, `uebertragung:${u.id}`)).toMatchObject({ anteile: "10000", investiert: "0.00", klasseId: null, diesesFonds: true });
  });

  it("Abgang eines eigenen Fonds: Verkauf des Instruments der Position mit anteiligem Buchwertabgang", async () => {
    const antwort = await uebertragen({ date: "2026-05-01", source: positionFonds, buyerOrganizationId: Y, shares: "20000", pricePerShare: "20" });
    expect(antwort.status, await antwort.clone().text()).toBe(201);
    const u = await json(antwort);
    const [v] = await db.select().from(s.verkauf).where(eq(s.verkauf.id, u.saleId));
    // 20.000 von 80.000 = 0,25; Buchwertabgang 250.000, Erlös 400.000
    expect(v).toMatchObject({ instrumentId: hauptEigen, anteilVerkauft: "0.250000", kaufpreis: "400000.00", buchwertAbgang: "250000.00", ergebnis: "150000.00", barzufluss: "400000.00" });
    expect((await instrumente()).find((x) => x.id === hauptEigen)).toMatchObject({ buchwert: "750000.00", status: "aktiv" });
    expect(zeile(await tabelle("2026-07-01"), positionFonds)).toMatchObject({ anteile: "60000", investiert: "750000.00" });
    // Der Käufer kann weiterverkaufen (Quelle ist die Übertragung)
    const weiter = await uebertragen({ date: "2026-06-01", source: `uebertragung:${u.id}`, buyerOrganizationId: X, shares: "20000", pricePerShare: "21" });
    expect(weiter.status, await weiter.clone().text()).toBe(201);
    expect((await json(weiter)).seller).toMatchObject({ type: "investor", id: Y });
    const t = await tabelle("2026-07-01");
    expect(t.zeilen.some((z: { id: string }) => z.id === `uebertragung:${u.id}`)).toBe(false);
    expect(t.anteileUnverwaessert).toBe("800000");
  });

  it("Anteil am Bestand auf sechs Stellen (1 von 3); Verkauf und Vorgänge der Übertragung lassen sich nicht einzeln stornieren", async () => {
    await db.update(s.rundenposition).set({ anteile: "3" }).where(eq(s.rundenposition.id, positionFonds));
    const u = await json(await uebertragen({ date: "2026-05-01", source: positionFonds, buyerFundId: ID.anderer, shares: "1", pricePerShare: "100000" }));
    const [v] = await db.select().from(s.verkauf).where(eq(s.verkauf.id, u.saleId));
    // 1.000.000 × 0,333333 = 333.333,00
    expect(v).toMatchObject({ anteilVerkauft: "0.333333", buchwertAbgang: "333333.00" });
    expect((await json(await post(`/verkaeufe/${u.saleId}/storno`, { grund: "Test" }))).error.code).toBe("reversal_not_allowed");
    const [kauf] = await db.select().from(s.vorgang).where(and(eq(s.vorgang.instrumentId, u.buyerInstrumentId), eq(s.vorgang.art, "auszahlung")));
    expect((await json(await post(`/transactions/${kauf!.id}/reverse`, { reason: "Test" }))).error).toMatchObject({ code: "reversal_not_allowed", transferId: u.id });
  });

  it("Prüfungen: zu viele Anteile, unbekannte Quelle, Käufer gleich Verkäufer, rückdatiert ohne Deckung für spätere", async () => {
    expect((await json(await uebertragen({ date: "2026-05-01", source: positionX, buyerOrganizationId: Y, shares: "160001", pricePerShare: "1" }))).error.code).toBe("share_transfer_exceeds_holding");
    expect((await json(await uebertragen({ date: "2026-02-01", source: positionX, buyerOrganizationId: Y, shares: "1", pricePerShare: "1" }))).error.code).toBe("share_transfer_source_not_found");
    expect((await json(await uebertragen({ date: "2026-05-01", source: "00000000-0000-4000-8000-000000000999", buyerOrganizationId: Y, shares: "1", pricePerShare: "1" }))).error.code).toBe("share_transfer_source_not_found");
    expect((await json(await uebertragen({ date: "2026-05-01", source: positionX, buyerOrganizationId: X, shares: "1", pricePerShare: "1" }))).error.code).toBe("share_transfer_invalid");
    expect((await uebertragen({ date: "2026-05-01", source: positionX, shares: "1", pricePerShare: "1" })).status).toBe(400);
    expect((await uebertragen({ date: "2026-06-01", source: positionX, buyerOrganizationId: Y, shares: "40000", pricePerShare: "1" })).status).toBe(201);
    // Am 01.05. hält X noch 160.000; 130.000 davon ließen der Übertragung am 01.06. nur 30.000 statt 40.000.
    expect((await json(await uebertragen({ date: "2026-05-01", source: positionX, buyerOrganizationId: Y, shares: "130000", pricePerShare: "1" }))).error.code).toBe("share_transfer_exceeds_holding");
    expect((await json(await get(`/organisationen/${ID.orgA}/share-transfers`))).data).toHaveLength(1);
  });

  it("Rechte: lesen wie die Runden, schreiben nur mit bearbeiter am Unternehmen", async () => {
    const fremd = person("fremd", { rollen: { [ID.anderer]: "bearbeiter" } });
    expect((await post(`/organisationen/${ID.orgA}/share-transfers`, { date: "2026-05-01", source: positionX, buyerOrganizationId: Y, shares: "1", pricePerShare: "1" }, fremd)).status).toBe(403);
    expect((await get(`/organisationen/${ID.orgA}/share-transfers`, fremd)).status).toBe(403);
    // Recht nur am Käuferfonds genügt nicht, um Anteile anderer zu übernehmen (Stammanteile oder Positionen fremder Fonds).
    expect((await post(`/organisationen/${ID.orgA}/share-transfers`, { date: "2026-05-01", source: "stamm", buyerFundId: ID.anderer, shares: "1", pricePerShare: "1" }, fremd)).status).toBe(403);
    expect((await post(`/organisationen/${ID.orgA}/share-transfers`, { date: "2026-05-01", source: positionFonds, buyerFundId: ID.anderer, shares: "1", pricePerShare: "1" }, fremd)).status).toBe(403);
    // Bearbeiter am Unternehmen (über den Fonds der Position), aber nicht am Käuferfonds: abgewiesen.
    const nurPosition = person("nurposition", { rollen: { [ID.fonds]: "bearbeiter" } });
    expect((await post(`/organisationen/${ID.orgA}/share-transfers`, { date: "2026-05-01", source: "stamm", buyerFundId: ID.anderer, shares: "1", pricePerShare: "1" }, nurPosition)).status).toBe(403);
    // Recht am Unternehmen über einen anderen haltenden Fonds, aber keine Rolle am Fonds, dessen Position abgegeben wird: abgewiesen.
    await db.insert(s.beteiligung).values({ fondsId: ID.anderer, organisationId: ID.orgA, instrument: "offene_beteiligung", erstinvestment: "2026-03-01" });
    const ohneVerkaeufer = person("ohneverkaeufer", { rollen: { [ID.anderer]: "bearbeiter" } });
    const abgewiesen = await post(`/organisationen/${ID.orgA}/share-transfers`, { date: "2026-05-01", source: positionFonds, buyerOrganizationId: Y, shares: "1", pricePerShare: "1" }, ohneVerkaeufer);
    expect(abgewiesen.status).toBe(403);
    // Dieselbe Person darf Anteile zwischen Dritten übertragen (Rechtsgrundlage am Unternehmen)
    expect((await post(`/organisationen/${ID.orgA}/share-transfers`, { date: "2026-05-01", source: positionX, buyerOrganizationId: Y, shares: "1", pricePerShare: "1" }, ohneVerkaeufer)).status).toBe(201);
    const leser = person("leser", { rollen: { [ID.fonds]: "betrachter" } });
    expect((await get(`/organisationen/${ID.orgA}/share-transfers`, leser)).status).toBe(200);
  });
});

describe("Buchwert je Instrument nach Verkauf der ganzen Beteiligung (#208)", () => {
  async function zweitesInstrument() {
    const zweites = await json(await post(`/beteiligungen/${ID.eigen}/instrumente`, { art: "offene_beteiligung", bezeichnung: "Serie-B-Anteile" }));
    await post(`/investments/${ID.eigen}/transactions`, { type: "commitment", valueDate: "2026-04-01", amount: "500000", instrumentId: zweites.id });
    await post(`/investments/${ID.eigen}/transactions`, { type: "disbursement", valueDate: "2026-04-01", amount: "500000", instrumentId: zweites.id });
    return zweites.id as string;
  }

  it("Teilverkauf: Abgang anteilig nach Buchwert verteilt, Summe der Instrumente = Abgang der Beteiligung", async () => {
    const zweites = await zweitesInstrument();
    const v = await post(`/beteiligungen/${ID.eigen}/verkauf`, { datum: "2026-06-01", kaufpreis: "500000", anteilVerkauft: "0.333333" });
    expect(v.status, await v.clone().text()).toBe(201);
    const abgang = (await json(v)).verkauf.buchwertAbgang as string;
    // 1.500.000 × 0,333333 = 499.999,50; verteilt 1.000.000 : 500.000 = 2 : 1 → 333.333,00 und 166.666,50
    expect(abgang).toBe("499999.50");
    const liste = await instrumente();
    const a = liste.find((x) => x.id === hauptEigen)!;
    const b = liste.find((x) => x.id === zweites)!;
    expect([a.buchwertabgang, b.buchwertabgang]).toEqual(["333333.00", "166666.50"]);
    expect([a.buchwert, b.buchwert]).toEqual(["666667.00", "333333.50"]);
    // Ein späterer Verkauf nur des zweiten Instruments rechnet mit dessen gemindertem Buchwert
    const nur = await json(await post(`/beteiligungen/${ID.eigen}/verkauf/vorschau`, { datum: "2026-06-15", kaufpreis: "10000", anteilVerkauft: "1", instrumentId: zweites }));
    expect(nur.ergebnis.buchwertVorher).toBe("333333.50");
  });

  it("Vollverkauf: alle Instrumente auf null, wie die Beteiligung", async () => {
    await zweitesInstrument();
    const v = await post(`/beteiligungen/${ID.eigen}/verkauf`, { datum: "2026-06-01", kaufpreis: "2000000", anteilVerkauft: "1" });
    expect(v.status, await v.clone().text()).toBe(201);
    const liste = await instrumente();
    expect(liste.map((x) => x.buchwert)).toEqual(["0.00", "0.00"]);
    expect(liste.map((x) => x.buchwertabgang)).toEqual(["1000000.00", "500000.00"]);
    // Stichtag vor dem Verkauf: noch kein Abgang
    const frueher = (await json(await get(`/beteiligungen/${ID.eigen}/instrumentdaten?stichtag=2026-05-31`))) as { instrumente: { buchwert: string }[] };
    expect(frueher.instrumente.map((x) => x.buchwert)).toEqual(["1000000.00", "500000.00"]);
    // Der Storno des Verkaufs nimmt auch die Abgänge je Instrument zurück
    const verkaufId = (await json(v)).verkauf.id as string;
    expect((await post(`/verkaeufe/${verkaufId}/storno`, { grund: "Testfall" })).status).toBe(201);
    expect((await instrumente()).map((x) => x.buchwert)).toEqual(["1000000.00", "500000.00"]);
  });
});

describe("Storno von Ausübung und Übertragung als Ganzes (#216)", () => {
  async function optionsscheineAusgeuebt(anzahl = "5000") {
    const id = (await json(await post(`/beteiligungen/${ID.eigen}/instrumente`, { art: "optionsschein", bezeichnung: "Optionsscheine", optionsscheinAnzahl: "20000", ausuebungspreis: "1.25", ausgabeAm: "2026-01-15", laufzeitBis: "2031-01-14" }))).id as string;
    const d = await json(await post(`/instrumente/${id}/exercises`, { date: "2026-05-01", shares: anzahl }));
    return { id, ausuebungId: d.exercise.id as string };
  }

  it("Ausübung: Zusage und Auszahlung per Storno-Vorgang, Anteile verschwinden, Optionsscheine wieder offen; zweites Storno und Einzel-Storno abgewiesen", async () => {
    const { id, ausuebungId } = await optionsscheineAusgeuebt();
    const [auszahlung] = await db.select().from(s.vorgang).where(and(eq(s.vorgang.instrumentId, id), eq(s.vorgang.art, "auszahlung"), isNull(s.vorgang.storniertVorgangId)));
    expect((await json(await post(`/transactions/${auszahlung!.id}/reverse`, { reason: "Test" }))).error).toMatchObject({ code: "reversal_not_allowed", exerciseId: ausuebungId });
    const antwort = await post(`/instrumente/${id}/exercises/${ausuebungId}/reverse`, { reason: "Irrtum" });
    expect(antwort.status, await antwort.clone().text()).toBe(201);
    const d = await json(antwort);
    expect(d.reversalTransactionIds).toHaveLength(2);
    expect(d.instrument.optionsschein).toMatchObject({ ausgeuebt: "0", offen: "20000", ausuebungen: [] });
    expect((await instrumente()).find((x) => x.id === id)!.buchwert).toBe("0.00");
    const t = await tabelle("2026-07-01");
    expect(t.anteileUnverwaessert).toBe("800000");
    expect(t.zeilen.some((z: { id: string }) => z.id === `ausuebung:${ausuebungId}`)).toBe(false);
    expect(zeile(t, "stamm").anteile).toBe("560000");
    expect((await json(await post(`/instrumente/${id}/exercises/${ausuebungId}/reverse`, { reason: "Nochmal" }))).error.code).toBe("warrant_exercise_already_reversed");
    // Die Vorgänge selbst lassen sich nicht nochmals stornieren
    expect((await post(`/transactions/${auszahlung!.id}/reverse`, { reason: "Test" })).status).toBe(409);
    // Danach lässt sich der volle Bestand wieder ausüben
    expect((await post(`/instrumente/${id}/exercises`, { date: "2026-05-02", shares: "20000" })).status).toBe(201);
    expect((await json(await post(`/instrumente/${id}/exercises/00000000-0000-4000-8000-000000000999/reverse`, { reason: "x" }))).error.code).toBe("warrant_exercise_not_found");
  });

  it("Option Pool Shuffle: Anteile vor der Runde zählen ausgeübte Optionsscheine nach der letzten Runde mit, stornierte nicht", async () => {
    const { id, ausuebungId } = await optionsscheineAusgeuebt();
    const vorschlag = async () =>
      (await json(await post(`/organisationen/${ORG}/finanzierungsrunden/pool-vorschlag`, { datum: "2026-09-01", preMoney: "13500000.00", volumen: "1500000.00", zielAnteil: "0.15", basis: "pre_money" }))).anteileVorher;
    expect(await vorschlag()).toBe("805000");
    await post(`/instrumente/${id}/exercises/${ausuebungId}/reverse`, { reason: "x" });
    expect(await vorschlag()).toBe("800000");
  });

  it("Ausübung: gesperrte Periode und Rechte wie beim Anlegen", async () => {
    const { id, ausuebungId } = await optionsscheineAusgeuebt();
    const fremd = person("fremd", { rollen: { [ID.anderer]: "bearbeiter" } });
    expect((await post(`/instrumente/${id}/exercises/${ausuebungId}/reverse`, { reason: "x" }, fremd)).status).toBe(403);
    const leser = person("leser", { rollen: { [ID.fonds]: "betrachter" } });
    expect((await post(`/instrumente/${id}/exercises/${ausuebungId}/reverse`, { reason: "x" }, leser)).status).toBe(403);
    expect((await json(await post(`/instrumente/${id}/exercises/${ausuebungId}/reverse`, {}))).error.code).toBe("invalid_input");
    await db.insert(s.periodensperre).values({ fondsId: ID.fonds, gesperrtBis: "2026-05-31", gesetztVon: "test" });
    expect((await json(await post(`/instrumente/${id}/exercises/${ausuebungId}/reverse`, { reason: "x" }))).error.code).toBe("period_locked");
    expect((await tabelle("2026-07-01")).anteileUnverwaessert).toBe("805000");
  });

  it("Ausgeübte Optionsscheine als Quelle einer Übertragung; erst die Übertragung, dann die Ausübung stornieren", async () => {
    const { id, ausuebungId } = await optionsscheineAusgeuebt();
    const antwort = await uebertragen({ date: "2026-06-01", source: `ausuebung:${ausuebungId}`, buyerOrganizationId: Y, shares: "2000", pricePerShare: "10" });
    expect(antwort.status, await antwort.clone().text()).toBe(201);
    const u = await json(antwort);
    expect(u).toMatchObject({ source: `ausuebung:${ausuebungId}`, seller: { type: "fund", id: ID.fonds }, buyer: { type: "investor", id: Y }, purchasePrice: "20000.00" });
    // Anschaffungskosten der übertragenen Anteile: 2.000 × 1,25 = 2.500 von 6.250 Buchwert (ohne Kaufpreis der Scheine) = 0,4
    const [v] = await db.select().from(s.verkauf).where(eq(s.verkauf.id, u.saleId));
    expect(v).toMatchObject({ instrumentId: id, anteilVerkauft: "0.400000", buchwertAbgang: "2500.00" });
    const t = await tabelle("2026-07-01");
    expect(zeile(t, `ausuebung:${ausuebungId}`).anteile).toBe("3000");
    expect(zeile(t, `uebertragung:${u.id}`)).toMatchObject({ anteile: "2000", investiert: "2500.00", halter: { art: "organisation", id: Y } });
    // Ausübung mit abhängiger Übertragung: 409
    expect((await json(await post(`/instrumente/${id}/exercises/${ausuebungId}/reverse`, { reason: "x" }))).error.code).toBe("warrant_exercise_reversal_dependent");
    expect((await post(`/organisationen/${ORG}/share-transfers/${u.id}/reverse`, { reason: "Korrektur" })).status).toBe(201);
    expect((await instrumente()).find((x) => x.id === id)!.buchwert).toBe("6250.00");
    expect((await post(`/instrumente/${id}/exercises/${ausuebungId}/reverse`, { reason: "x" })).status).toBe(201);
    expect((await tabelle("2026-07-01")).anteileUnverwaessert).toBe("800000");
  });

  it("Übertragung mit Abgang und Zugang eigener Fonds: Verkauf und Zugangs-Instrument werden zurückgenommen, Bestände wie vorher", async () => {
    const u = await json(await uebertragen({ date: "2026-05-01", source: positionFonds, buyerFundId: ID.anderer, shares: "20000", pricePerShare: "20" }));
    expect((await instrumente()).find((x) => x.id === hauptEigen)!.buchwert).toBe("750000.00");
    const antwort = await post(`/organisationen/${ORG}/share-transfers/${u.id}/reverse`, { reason: "Falscher Käufer" });
    expect(antwort.status, await antwort.clone().text()).toBe(201);
    expect((await json(antwort)).reversedAt).not.toBeNull();
    const [v] = await db.select().from(s.verkauf).where(eq(s.verkauf.id, u.saleId));
    expect(v!.storniertAm).not.toBeNull();
    expect((await instrumente()).find((x) => x.id === hauptEigen)).toMatchObject({ buchwert: "1000000.00", status: "aktiv" });
    expect(await summe(u.buyerInstrumentId, "auszahlung")).toBe(0);
    expect((await db.select().from(s.instrument).where(eq(s.instrument.id, u.buyerInstrumentId)))[0]!.status).toBe("abgeschrieben");
    const t = await tabelle("2026-07-01");
    expect(zeile(t, positionFonds)).toMatchObject({ anteile: "80000", investiert: "1000000.00" });
    expect(t.zeilen.some((z: { id: string }) => z.id === `uebertragung:${u.id}`)).toBe(false);
    // In der Liste bleibt die stornierte Übertragung stehen, markiert
    const liste = (await json(await get(`/organisationen/${ORG}/share-transfers`))).data as { id: string; reversedAt: string | null }[];
    expect(liste.find((x) => x.id === u.id)!.reversedAt).not.toBeNull();
    expect((await json(await post(`/organisationen/${ORG}/share-transfers/${u.id}/reverse`, { reason: "x" }))).error.code).toBe("share_transfer_already_reversed");
    // Quelle einer stornierten Übertragung ist nicht mehr wählbar
    expect((await json(await uebertragen({ date: "2026-06-01", source: `uebertragung:${u.id}`, buyerOrganizationId: Y, shares: "1", pricePerShare: "1" }))).error.code).toBe("share_transfer_source_not_found");
  });

  it("Übertragung: spätere Übertragung aus dem Bestand, gesperrte Periode, benutztes Zugangs-Instrument und Rechte", async () => {
    const u = await json(await uebertragen({ date: "2026-05-01", source: positionFonds, buyerFundId: ID.anderer, shares: "20000", pricePerShare: "20" }));
    const weiter = await json(await uebertragen({ date: "2026-06-01", source: `uebertragung:${u.id}`, buyerOrganizationId: Y, shares: "5000", pricePerShare: "21" }));
    expect((await json(await post(`/organisationen/${ORG}/share-transfers/${u.id}/reverse`, { reason: "x" }))).error.code).toBe("share_transfer_reversal_dependent");
    // Rechte: nur am Käuferfonds oder nur am Unternehmen genügt nicht
    const nurKaeufer = person("nurkaeufer", { rollen: { [ID.anderer]: "bearbeiter" } });
    expect((await post(`/organisationen/${ORG}/share-transfers/${u.id}/reverse`, { reason: "x" }, nurKaeufer)).status).toBe(403);
    const nurVerkaeufer = person("nurverkaeufer", { rollen: { [ID.fonds]: "bearbeiter" } });
    expect((await post(`/organisationen/${ORG}/share-transfers/${u.id}/reverse`, { reason: "x" }, nurVerkaeufer)).status).toBe(403);
    // Die spätere Übertragung zuerst stornieren, dann gesperrte Periode beim Käuferfonds
    expect((await post(`/organisationen/${ORG}/share-transfers/${weiter.id}/reverse`, { reason: "x" })).status).toBe(201);
    await db.insert(s.periodensperre).values({ fondsId: ID.anderer, gesperrtBis: "2026-05-31", gesetztVon: "test" });
    expect((await json(await post(`/organisationen/${ORG}/share-transfers/${u.id}/reverse`, { reason: "x" }))).error.code).toBe("period_locked");
    await db.delete(s.periodensperre);
    // Ohne Sperre und ohne weitere Buchung ist die Übertragung trotz des stornierten Weiterverkaufs stornierbar (aufgehobene Paare zählen nicht)
    const ok = await post(`/organisationen/${ORG}/share-transfers/${u.id}/reverse`, { reason: "ok" });
    expect(ok.status, await ok.clone().text()).toBe(201);
    const u2 = await json(await uebertragen({ date: "2026-07-01", source: positionFonds, buyerFundId: ID.anderer, shares: "1000", pricePerShare: "20" }));
    // Auf dem Zugangs-Instrument wurde inzwischen etwas gebucht: kein Storno
    const [b] = await db.select().from(s.beteiligung).where(and(eq(s.beteiligung.fondsId, ID.anderer), eq(s.beteiligung.organisationId, ORG)));
    await post(`/investments/${b!.id}/transactions`, { type: "commitment", valueDate: "2026-07-10", amount: "1000", instrumentId: u2.buyerInstrumentId });
    expect((await json(await post(`/organisationen/${ORG}/share-transfers/${u2.id}/reverse`, { reason: "x" }))).error.code).toBe("share_transfer_reversal_instrument_used");
    expect((await json(await post(`/organisationen/${ORG}/share-transfers/00000000-0000-4000-8000-000000000999/reverse`, { reason: "x" }))).error.code).toBe("share_transfer_not_found");
  });
});
