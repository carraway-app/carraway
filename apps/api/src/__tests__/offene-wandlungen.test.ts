import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { erstelleTestApp, person } from "./hilfen-auth";
import { leeren, oeffneTestdb, vehikelVon } from "./hilfen";
import { aufrufe, grundbestand, ID, json } from "./hilfen-instrumente";
import { legeHauptinstrumentAn } from "../instrumente/hauptinstrument";

// Beträge erfunden. Wandeldarlehen 100.000 am 01.01.2026, 6 % nach 30E/360; Runde am 01.03.2026 zu 12,50 je Anteil, 800.000 Anteile danach.
const { db, pool } = oeffneTestdb();
const { get, post } = aufrufe(erstelleTestApp(db));

const KONDITION = { gueltigAb: "2026-01-01", satzFix: "0.06", methode: "30E/360", zinsperiode: "jaehrlich", anker: "2027-01-01" };
const tabelle = async (stichtag: string, mit = false, als?: ReturnType<typeof person>) => {
  const antwort = await get(`/beteiligungen/${ID.wandel}/kapitaltabelle?stichtag=${stichtag}${mit ? "&offeneWandlungen=true" : ""}`, als);
  expect(antwort.status, await antwort.clone().text()).toBe(200);
  return json(antwort);
};
let rundeId = "";

async function fundstelle(werte: Record<string, string>, beteiligungId: string = ID.wandel, verknuepfen = false) {
  const [d] = await db
    .insert(s.dokument)
    .values({ sha256: "0".repeat(64), dateiname: "vertrag.pdf", mime: "application/pdf", groesse: 1, gespeichertUnter: "test/vertrag.pdf", hochgeladenVon: "test" })
    .returning();
  if (verknuepfen) await db.insert(s.dokumentVerknuepfung).values({ dokumentId: d!.id, zielTyp: "beteiligung", zielId: beteiligungId });
  for (const [feld, wert] of Object.entries(werte)) {
    await db.insert(s.wertQuelle).values({ objektTyp: "beteiligung", objektId: beteiligungId, feld, wert, dokumentId: d!.id, seite: 1, zitat: "erfunden", erstelltVon: "test" });
  }
}

beforeEach(async () => {
  await grundbestand(db);
  await post(`/investments/${ID.wandel}/transactions`, { type: "commitment", valueDate: "2026-01-01", amount: "200000" });
  await post(`/investments/${ID.wandel}/transactions`, { type: "disbursement", valueDate: "2026-01-01", amount: "100000" });
  await post(`/beteiligungen/${ID.wandel}/konditionen`, KONDITION);
  const [runde] = await db
    .insert(s.finanzierungsrunde)
    .values({ organisationId: ID.orgC, bezeichnung: "Serie A", datum: "2026-03-01", preMoney: "8000000", postMoney: "10000000", preisJeAnteil: "12.5000", anteileGesamtNach: "800000" })
    .returning();
  rundeId = runde!.id;
  await db.insert(s.rundenposition).values({ rundeId, vehikelId: await vehikelVon(db, ID.orgA), betrag: "2000000.00", anteile: "160000", rolle: "lead" });
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

describe("GET /beteiligungen/:id/kapitaltabelle mit offenen Wandlungen", () => {
  it("ohne Abschlag und Cap: offen gekennzeichnet, keine geschätzten Anteile, Summen unverändert", async () => {
    const d = await tabelle("2026-07-01", true);
    expect(d.offeneWandlungen.liste).toHaveLength(1);
    expect(d.offeneWandlungen.liste[0]).toMatchObject({ status: "offen", grund: "keine_parameter", fehlend: ["abschlag", "bewertungsobergrenze"], kapital: "100000.00", zinsen: "3000.00", betrag: "103000.00", anteile: null, diesesFonds: true });
    expect(d.offeneWandlungen).toMatchObject({ zinsenWandeln: true, referenzpreis: "12.5000", anteileVorWandlung: "800000", anteile: "0" });
    expect(d.zeilen.some((z: { halter: { art: string } }) => z.halter.art === "wandlung")).toBe(false);
    expect(d.anteileMitWandlungen).toBe("800000");
  });

  it("mit Fundstellen: Cap greift, Anteile wie in der Wandlungsvorschau, eigene Zeile und Klasse, Anteile voll verwässert einschließlich Schätzung", async () => {
    await fundstelle({ wandlungsabschlag: "0.2", bewertungsobergrenze: "6000000.00" });
    const ohne = await tabelle("2026-07-01");
    // 6.000.000 ÷ 800.000 = 7,50 unter 12,50 × 0,8 = 10; 103.000 ÷ 7,50 = 13.733 Anteile
    expect(ohne.offeneWandlungen.liste[0]).toMatchObject({ status: "geschaetzt", grund: null, fehlend: [], abschlag: "0.2", bewertungsobergrenze: "6000000", massgeblich: "bewertungsobergrenze", preisJeAnteil: "7.500000", anteile: "13733" });
    expect(ohne.mitWandlungen).toBe(false);
    expect(ohne.zeilen.some((z: { halter: { art: string } }) => z.halter.art === "wandlung")).toBe(false);

    const vorschau = await post(`/beteiligungen/${ID.wandel}/wandlung/vorschau`, {
      cutoff: "2026-07-01",
      zinsenWandeln: true,
      preisregel: { discount: "0.2", bewertungsobergrenze: { betrag: "6000000", anteileVorRunde: "800000" } },
      nennwertJeAnteil: "1",
      runde: { id: rundeId },
    }, "bearbeiter");
    expect(vorschau.status, await vorschau.clone().text()).toBe(200);
    expect((await json(vorschau)).ergebnis.anzahlAnteile).toBe("13733");

    const mit = await tabelle("2026-07-01", true);
    expect(mit.mitWandlungen).toBe(true);
    expect(mit.anteileVollVerwaessert).toBe("800000");
    expect(mit.anteileMitWandlungen).toBe("813733");
    const zeile = mit.zeilen.find((z: { halter: { art: string } }) => z.halter.art === "wandlung");
    expect(zeile).toMatchObject({ anteile: "13733", ausgegeben: false, diesesFonds: true, anteilUnverwaessert: null, anteilVollVerwaessert: (13733 / 813733).toFixed(6) });
    expect(mit.klassen.find((k: { art: string }) => k.art === "wandlung")).toMatchObject({ anteile: "13733", anteilUnverwaessert: null });
    expect(mit.mitPool).toBe(false);
    expect(mit.diesesFonds).toMatchObject({ anteile: "13733", anteilVollVerwaessert: (13733 / 813733).toFixed(6) });
  });

  it("vor der ersten Runde: kein Referenzpreis, offen; ohne Runde auch keine Zeilen", async () => {
    await fundstelle({ wandlungsabschlag: "0.2" });
    const d = await tabelle("2026-02-01", true);
    expect(d.offeneWandlungen.liste[0]).toMatchObject({ status: "offen", grund: "kein_referenzpreis", fehlend: ["bewertungsobergrenze"] });
    expect(d.mitWandlungen).toBe(false);
  });

  it("zwei offene Wandeldarlehen in einer Beteiligung: Fundstellen nicht zuzuordnen, beide offen", async () => {
    await fundstelle({ wandlungsabschlag: "0.2" });
    const zweites = await json(await post(`/beteiligungen/${ID.wandel}/instrumente`, { art: "wandeldarlehen", bezeichnung: "Wandeldarlehen 2026 II" }, "bearbeiter"));
    await post(`/investments/${ID.wandel}/transactions`, { type: "commitment", valueDate: "2026-02-01", amount: "50000", instrumentId: zweites.id });
    await post(`/investments/${ID.wandel}/transactions`, { type: "disbursement", valueDate: "2026-02-01", amount: "50000", instrumentId: zweites.id });
    const d = await tabelle("2026-07-01", true);
    expect(d.offeneWandlungen.liste).toHaveLength(2);
    for (const w of d.offeneWandlungen.liste) expect(w).toMatchObject({ status: "offen", grund: "parameter_mehrdeutig", anteile: null });
    // Das zweite Darlehen hat keine Konditionen: Zinsen bleiben außen vor.
    expect(d.offeneWandlungen.liste.find((w: { instrumentId: string }) => w.instrumentId === zweites.id)).toMatchObject({ hinweise: ["ohne_zinsen"], betrag: "50000.00" });
  });

  it("Rechte: Wandeldarlehen eines nicht sichtbaren Fonds fehlen ganz, Fundstellen nur aus sichtbaren Dokumenten", async () => {
    // Zweiter Fonds mit eigenem Wandeldarlehen am selben Unternehmen und eigener Fundstelle
    const [fremd] = await db.insert(s.beteiligung).values({ fondsId: ID.anderer, organisationId: ID.orgC, instrument: "wandeldarlehen", erstinvestment: "2025-01-01" }).returning();
    await legeHauptinstrumentAn(db, fremd!);
    await post(`/investments/${fremd!.id}/transactions`, { type: "commitment", valueDate: "2026-01-01", amount: "70000" });
    await post(`/investments/${fremd!.id}/transactions`, { type: "disbursement", valueDate: "2026-01-01", amount: "70000" });
    await fundstelle({ wandlungsabschlag: "0.25" }, fremd!.id, true);
    // Eigene Fundstelle: ein unverknüpftes Dokument sieht nur, wer alle Fonds sieht
    await fundstelle({ wandlungsabschlag: "0.2" });

    const verwalter = await tabelle("2026-07-01", true);
    expect(verwalter.offeneWandlungen.liste).toHaveLength(2);
    expect(verwalter.offeneWandlungen.liste.find((w: { beteiligungId: string }) => w.beteiligungId === fremd!.id)).toMatchObject({ status: "geschaetzt", abschlag: "0.25" });

    const betrachter = person("betrachter-eins", { rollen: { [ID.fonds]: "betrachter" } });
    const d = await tabelle("2026-07-01", true, betrachter);
    expect(d.offeneWandlungen.liste).toHaveLength(1);
    expect(d.offeneWandlungen.liste[0]).toMatchObject({ beteiligungId: ID.wandel, status: "offen", grund: "keine_parameter", abschlag: null });
    const text = JSON.stringify(d);
    expect(text).not.toContain(fremd!.id);
    expect(text).not.toContain("Testfonds Zwei");
    expect(text).not.toContain("70000");
    expect(d.anteileMitWandlungen).toBe("800000");

    // Mit verknüpftem Dokument sieht die Betrachterin die eigene Fundstelle
    await fundstelle({ bewertungsobergrenze: "6000000.00" }, ID.wandel, true);
    const mit = await tabelle("2026-07-01", true, betrachter);
    expect(mit.offeneWandlungen.liste[0]).toMatchObject({ status: "geschaetzt", abschlag: null, bewertungsobergrenze: "6000000", fehlend: ["abschlag"] });
  });

  it("nach der Wandlung zählt das Darlehen nicht mehr, davor schon", async () => {
    await fundstelle({ wandlungsabschlag: "0.2" });
    const w = await post(`/beteiligungen/${ID.wandel}/wandlung`, { cutoff: "2026-07-01", zinsenWandeln: true, preisregel: { discount: "0.2" }, nennwertJeAnteil: "1", runde: { neu: { bezeichnung: "Serie B", datum: "2026-07-01", preMoney: "12000000", postMoney: "15000000", preisJeAnteil: "15", anteileGesamtNach: "1000000" } } }, "bearbeiter");
    expect(w.status, await w.clone().text()).toBe(201);
    expect((await tabelle("2026-07-01", true)).offeneWandlungen.liste).toHaveLength(0);
    const davor = await tabelle("2026-06-30", true);
    expect(davor.offeneWandlungen.liste).toHaveLength(1);
    expect(davor.offeneWandlungen.liste[0]).toMatchObject({ status: "geschaetzt", massgeblich: "abschlag", preisJeAnteil: "10.000000" });
  });
});
