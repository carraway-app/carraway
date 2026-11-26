import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as s from "@carraway/db";
import { erstelleTestApp, person } from "./hilfen-auth";
import { leeren, oeffneTestdb, vehikelVon } from "./hilfen";
import { aufrufe, grundbestand, ID, json } from "./hilfen-instrumente";

// Beträge erfunden. Wandeldarlehen 100.000 am 01.01.2026, 6 % nach 30E/360; Runde am 01.03.2026 zu 12,50 je Anteil, 800.000 Anteile danach.
const { db, pool } = oeffneTestdb();
const { get, post, patch } = aufrufe(erstelleTestApp(db));

const KONDITION = { gueltigAb: "2026-01-01", satzFix: "0.06", methode: "30E/360", zinsperiode: "jaehrlich", anker: "2027-01-01" };
const betrachter = person("wandlungsparameter-betrachter", { rollen: { [ID.fonds]: "betrachter" } });
const tabelle = async (stichtag: string) => {
  const antwort = await get(`/beteiligungen/${ID.wandel}/kapitaltabelle?stichtag=${stichtag}&offeneWandlungen=true`);
  expect(antwort.status, await antwort.clone().text()).toBe(200);
  return json(antwort);
};
const wandeldarlehen = async (beteiligungId: string = ID.wandel) => (await db.select().from(s.instrument).where(eq(s.instrument.beteiligungId, beteiligungId)))[0]!;

async function fundstelle(werte: Record<string, string>) {
  const [d] = await db
    .insert(s.dokument)
    .values({ sha256: "0".repeat(64), dateiname: "vertrag.pdf", mime: "application/pdf", groesse: 1, gespeichertUnter: "test/vertrag.pdf", hochgeladenVon: "test" })
    .returning();
  for (const [feld, wert] of Object.entries(werte)) {
    await db.insert(s.wertQuelle).values({ objektTyp: "beteiligung", objektId: ID.wandel, feld, wert, dokumentId: d!.id, seite: 1, zitat: "erfunden", erstelltVon: "test" });
  }
}

beforeEach(async () => {
  await grundbestand(db);
  await post(`/beteiligungen/${ID.wandel}/vorgaenge`, { art: "zusage", valuta: "2026-01-01", betrag: "200000" });
  await post(`/beteiligungen/${ID.wandel}/vorgaenge`, { art: "auszahlung", valuta: "2026-01-01", betrag: "100000" });
  await post(`/beteiligungen/${ID.wandel}/konditionen`, KONDITION);
  const [runde] = await db
    .insert(s.finanzierungsrunde)
    .values({ organisationId: ID.orgC, bezeichnung: "Serie A", datum: "2026-03-01", preMoney: "8000000", postMoney: "10000000", preisJeAnteil: "12.5000", anteileGesamtNach: "800000" })
    .returning();
  await db.insert(s.rundenposition).values({ rundeId: runde!.id, vehikelId: await vehikelVon(db, ID.orgA), betrag: "2000000.00", anteile: "160000", rolle: "lead" });
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

describe("Wandlungsparameter am Instrument", () => {
  it("PATCH setzt, liest und leert Abschlag, Bewertungsobergrenze und „Zinsen wandeln“", async () => {
    const i = await wandeldarlehen();
    expect(i).toMatchObject({ wandlungsabschlag: null, bewertungsobergrenze: null, zinsenWandeln: null });
    const r = await patch(`/instrumente/${i.id}`, { wandlungsabschlag: "0.2", bewertungsobergrenze: "6000000", zinsenWandeln: false }, "bearbeiter");
    expect(r.status, await r.clone().text()).toBe(200);
    expect(await json(r)).toMatchObject({ wandlungsabschlag: "0.200000", bewertungsobergrenze: "6000000.00", zinsenWandeln: false });
    const gelesen = await json(await get(`/instrumente/${i.id}`));
    expect(gelesen).toMatchObject({ wandlungsabschlag: "0.200000", bewertungsobergrenze: "6000000.00", zinsenWandeln: false });
    const daten = await json(await get(`/beteiligungen/${ID.wandel}/instrumentdaten`));
    expect(daten.instrumente[0]).toMatchObject({ wandlungsabschlag: "0.200000", zinsenWandeln: false });
    expect(daten.beteiligung.waehrung).toBe("EUR");
    const leer = await patch(`/instrumente/${i.id}`, { wandlungsabschlag: null, bewertungsobergrenze: null, zinsenWandeln: null }, "bearbeiter");
    expect(await json(leer)).toMatchObject({ wandlungsabschlag: null, bewertungsobergrenze: null, zinsenWandeln: null });
  });

  it("lehnt ungültige Werte ab und lässt die Parameter nur am Wandeldarlehen zu", async () => {
    const i = await wandeldarlehen();
    for (const koerper of [{ wandlungsabschlag: "1" }, { wandlungsabschlag: "-0.1" }, { wandlungsabschlag: "20" }, { wandlungsabschlag: "0.1234567" }, { bewertungsobergrenze: "0" }, { bewertungsobergrenze: "-5" }, { bewertungsobergrenze: "1.234" }]) {
      expect((await patch(`/instrumente/${i.id}`, koerper, "bearbeiter")).status, JSON.stringify(koerper)).toBe(400);
    }
    const darlehen = await json(await post(`/beteiligungen/${ID.wandel}/instrumente`, { art: "darlehen", bezeichnung: "Darlehen" }, "bearbeiter"));
    const abgelehnt = await patch(`/instrumente/${darlehen.id}`, { wandlungsabschlag: "0.2" }, "bearbeiter");
    expect(abgelehnt.status).toBe(409);
    expect((await json(abgelehnt)).fehler.code).toBe("INSTRUMENT_KEIN_WANDELDARLEHEN");
    expect((await post(`/beteiligungen/${ID.wandel}/instrumente`, { art: "darlehen", zinsenWandeln: true }, "bearbeiter")).status).toBe(409);
    const neu = await post(`/beteiligungen/${ID.wandel}/instrumente`, { art: "wandeldarlehen", bezeichnung: "Wandeldarlehen II", wandlungsabschlag: "0.15", zinsenWandeln: true }, "bearbeiter");
    expect(neu.status, await neu.clone().text()).toBe(201);
    expect(await json(neu)).toMatchObject({ wandlungsabschlag: "0.150000", bewertungsobergrenze: null, zinsenWandeln: true });
  });

  it("Rechte: lesen ist Betrachtern erlaubt, ändern nur ab Bearbeiter im Bereich Portfolio", async () => {
    const i = await wandeldarlehen();
    expect((await patch(`/instrumente/${i.id}`, { zinsenWandeln: true }, betrachter)).status).toBe(403);
    expect((await get(`/instrumente/${i.id}`, betrachter)).status).toBe(200);
  });

  it("Schätzung nutzt die Felder ohne jede Fundstelle", async () => {
    const i = await wandeldarlehen();
    await patch(`/instrumente/${i.id}`, { wandlungsabschlag: "0.2", bewertungsobergrenze: "6000000" }, "bearbeiter");
    const d = await tabelle("2026-07-01");
    expect(d.offeneWandlungen.liste[0]).toMatchObject({ status: "geschaetzt", abschlag: "0.2", bewertungsobergrenze: "6000000", massgeblich: "bewertungsobergrenze", preisJeAnteil: "7.500000", anteile: "13733", zinsenWandeln: true, zinsenWandelnAngenommen: true });
  });

  it("zwei Wandeldarlehen je Beteiligung: jedes mit eigenen Werten geschätzt statt parameter_mehrdeutig", async () => {
    const erstes = await wandeldarlehen();
    const zweites = await json(await post(`/beteiligungen/${ID.wandel}/instrumente`, { art: "wandeldarlehen", bezeichnung: "Wandeldarlehen II" }, "bearbeiter"));
    await post(`/beteiligungen/${ID.wandel}/vorgaenge`, { art: "zusage", valuta: "2026-01-01", betrag: "50000", instrumentId: zweites.id });
    await post(`/beteiligungen/${ID.wandel}/vorgaenge`, { art: "auszahlung", valuta: "2026-01-01", betrag: "50000", instrumentId: zweites.id });
    await patch(`/instrumente/${erstes.id}`, { wandlungsabschlag: "0.2" }, "bearbeiter");
    await patch(`/instrumente/${zweites.id}`, { wandlungsabschlag: "0.1" }, "bearbeiter");
    const d = await tabelle("2026-07-01");
    const liste = d.offeneWandlungen.liste as { instrumentId: string; status: string; abschlag: string; preisJeAnteil: string }[];
    expect(liste.find((w) => w.instrumentId === erstes.id)).toMatchObject({ status: "geschaetzt", abschlag: "0.2", preisJeAnteil: "10.000000" });
    expect(liste.find((w) => w.instrumentId === zweites.id)).toMatchObject({ status: "geschaetzt", abschlag: "0.1", preisJeAnteil: "11.250000" });
  });

  it("Feld hat Vorrang vor der Fundstelle; ein fehlendes Feld fällt auf die Fundstelle zurück", async () => {
    const i = await wandeldarlehen();
    await fundstelle({ wandlungsabschlag: "0.3", bewertungsobergrenze: "6000000.00" });
    await patch(`/instrumente/${i.id}`, { wandlungsabschlag: "0.2" }, "bearbeiter");
    const d = await tabelle("2026-07-01");
    // Abschlag vom Instrument (0,2), Cap als Rückfall aus der Fundstelle
    expect(d.offeneWandlungen.liste[0]).toMatchObject({ status: "geschaetzt", abschlag: "0.2", bewertungsobergrenze: "6000000", anteile: "13733" });
  });

  it("zwei Darlehen: Felder am Instrument lösen die Mehrdeutigkeit der Fundstellen für diese Felder, der Rückfall bleibt mehrdeutig", async () => {
    const erstes = await wandeldarlehen();
    const zweites = await json(await post(`/beteiligungen/${ID.wandel}/instrumente`, { art: "wandeldarlehen", bezeichnung: "Wandeldarlehen II" }, "bearbeiter"));
    await post(`/beteiligungen/${ID.wandel}/vorgaenge`, { art: "zusage", valuta: "2026-01-01", betrag: "50000", instrumentId: zweites.id });
    await post(`/beteiligungen/${ID.wandel}/vorgaenge`, { art: "auszahlung", valuta: "2026-01-01", betrag: "50000", instrumentId: zweites.id });
    await fundstelle({ wandlungsabschlag: "0.2" });
    await patch(`/instrumente/${erstes.id}`, { wandlungsabschlag: "0.2" }, "bearbeiter");
    const d = await tabelle("2026-07-01");
    const liste = d.offeneWandlungen.liste as { instrumentId: string; status: string; grund: string | null }[];
    expect(liste.find((w) => w.instrumentId === erstes.id)).toMatchObject({ status: "geschaetzt" });
    expect(liste.find((w) => w.instrumentId === zweites.id)).toMatchObject({ status: "offen", grund: "parameter_mehrdeutig" });
  });

  it("„Zinsen wandeln“ nein: keine Zinsen im Betrag, keine Annahme mehr", async () => {
    const i = await wandeldarlehen();
    await patch(`/instrumente/${i.id}`, { wandlungsabschlag: "0.2", zinsenWandeln: false }, "bearbeiter");
    const w = (await tabelle("2026-07-01")).offeneWandlungen.liste[0];
    expect(w).toMatchObject({ zinsenWandeln: false, zinsenWandelnAngenommen: false, zinsen: "0.00", betrag: "100000.00", anteile: "10000" });
    await patch(`/instrumente/${i.id}`, { zinsenWandeln: true }, "bearbeiter");
    expect((await tabelle("2026-07-01")).offeneWandlungen.liste[0]).toMatchObject({ zinsenWandeln: true, zinsenWandelnAngenommen: false, zinsen: "3000.00", betrag: "103000.00" });
  });

  it("Art wechselt weg vom Wandeldarlehen: die Parameter entfallen", async () => {
    const neu = await json(await post(`/beteiligungen/${ID.wandel}/instrumente`, { art: "wandeldarlehen", bezeichnung: "Wandeldarlehen II", wandlungsabschlag: "0.2", zinsenWandeln: true }, "bearbeiter"));
    const r = await patch(`/instrumente/${neu.id}`, { art: "darlehen" }, "bearbeiter");
    expect(r.status, await r.clone().text()).toBe(200);
    expect(await json(r)).toMatchObject({ art: "darlehen", wandlungsabschlag: null, zinsenWandeln: null });
  });
});
