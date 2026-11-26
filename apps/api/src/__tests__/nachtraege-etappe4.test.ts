import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { erstelleTestApp, idVon, person } from "./hilfen-auth";
import { leeren, oeffneTestdb } from "./hilfen";
import { anzahl, aufrufe, grundbestand, ID, json, leereAuftraege } from "./hilfen-instrumente";

/** Nachträge aus Etappe 4 (Etappe 5): Treuhand im NAV, Verkaufs-Storno, Vorschau, Hinweise, Codes, Sicht, Wandlung. */

const { db, pool } = oeffneTestdb();
const { get, post, put } = aufrufe(erstelleTestApp(db));

const b = ID.eigen;
/** Schuldner des Verkäuferdarlehens: ein anderes Unternehmen (der Käufer); das Darlehen entsteht in einer eigenen Beteiligung des Fonds. */
const KAEUFER = "00000000-0000-4000-8000-0000000000e1";
const verkaufen = (koerper: object, id: string = b) => post(`/beteiligungen/${id}/verkauf`, koerper, "bearbeiter");
const uebersichtAm = async (stichtag: string) =>
  (await json(await get(`/fonds/${ID.fonds}/uebersicht?stichtag=${stichtag}&stand=${encodeURIComponent(new Date(Date.now() + 5000).toISOString())}`)));
const summe = async (beteiligungId: string, art: s.Vorgang["art"]) =>
  (await db.select().from(s.vorgang).where(and(eq(s.vorgang.beteiligungId, beteiligungId), eq(s.vorgang.art, art)))).reduce((x, v) => x + Math.round(Number(v.betrag) * 100), 0) / 100;
const gueltigeBewertung = async (beteiligungId: string, stichtag: string) =>
  (await db.select().from(s.bewertung).where(and(eq(s.bewertung.beteiligungId, beteiligungId), eq(s.bewertung.stichtag, stichtag), eq(s.bewertung.status, "freigegeben"))))[0];

const voll = {
  datum: "2026-06-30",
  kaufpreis: "700000",
  kosten: "10000",
  treuhand: { betrag: "50000", freigabeAm: "2027-06-30" },
  verkaeuferdarlehen: { betrag: "100000", satz: "0.05", methode: "act/365", faelligAm: "2028-06-30", schuldnerOrganisationId: KAEUFER },
  anteilVerkauft: 1,
};

beforeEach(async () => {
  await grundbestand(db);
  await db.insert(s.organisation).values({ id: KAEUFER, name: "Käufer Beispiel", art: "unternehmen" });
  // Buchwert 400.000: 500.000 investiert, 100.000 wertberichtigt; Bewertung 450.000
  await post(`/beteiligungen/${b}/vorgaenge`, { art: "zusage", valuta: "2025-01-01", betrag: "1000000" });
  await post(`/beteiligungen/${b}/vorgaenge`, { art: "auszahlung", valuta: "2025-02-01", betrag: "500000" });
  await post(`/beteiligungen/${b}/vorgaenge`, { art: "wertberichtigung", valuta: "2025-12-31", betrag: "100000" });
  await db.insert(s.bewertung).values({ beteiligungId: b, stichtag: "2025-12-31", wert: "450000.00", methode: "letzte_runde", status: "freigegeben" });
  await leereAuftraege(db);
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

describe("Treuhandforderungen im NAV", () => {
  it("weist die offene Forderung neben dem Verkäuferdarlehen bis zur Erfüllung aus", async () => {
    const d = await json(await verkaufen(voll));
    const uebersicht = await uebersichtAm("2026-06-30");
    expect(uebersicht.portfoliowert).toBe("100000.00");
    expect(uebersicht.kennzahlen.nav.wert).toBeNull();
    expect(uebersicht.beteiligungen.find((z: { id: string }) => z.id === b)).toMatchObject({ offeneForderungen: "50000.00" });
    // Detailansicht: Wertansatz der ausgeschiedenen Beteiligung = offene Forderung
    expect((await json(await get(`/beteiligungen/${b}?stichtag=2026-06-30`))).kennzahlen.bewertung.wert).toBe("50000");

    expect((await post(`/forderungen/${d.forderung.id}/erfuellt`, { datum: "2027-06-30" }, "bearbeiter")).status).toBe(200);
    const offenAm = async (tag: string) => (await uebersichtAm(tag)).beteiligungen.find((z: { id: string }) => z.id === b).offeneForderungen;
    expect(await offenAm("2026-12-31")).toBe("50000.00");
    expect(await offenAm("2027-06-30")).toBe("0.00");
  });
});

describe("Storno eines Verkaufs", () => {
  it("lehnt das Storno des Barzuflusses einzeln ab und verweist auf den ganzen Verkauf", async () => {
    const d = await json(await verkaufen(voll));
    const antwort = await post(`/vorgaenge/${d.verkauf.rueckflussVorgangId}/storno`, { grund: "Versehen" }, "bearbeiter");
    expect(antwort.status).toBe(409);
    expect((await json(antwort)).fehler).toMatchObject({ code: "VERKAUF_STORNO_UEBER_VERKAUF", verkaufId: d.verkauf.id });
    expect(await summe(b, "rueckfluss")).toBe(540000);
  });

  it("stellt den Zustand vor dem Verkauf wieder her: Rückfluss, Buchwert, Status, Bewertung, Treuhand, Verkäuferdarlehen", async () => {
    const d = await json(await verkaufen(voll));
    expect(await json(await get(`/beteiligungen/${b}/instrumentdaten`))).toMatchObject({ buchwert: { wert: "0.00" } });
    const antwort = await post(`/verkaeufe/${d.verkauf.id}/storno`, { grund: "Kaufvertrag nicht vollzogen" }, "bearbeiter");
    expect(antwort.status).toBe(201);
    const st = await json(antwort);
    expect(st).toMatchObject({ status: "aktiv", verkaeuferdarlehenBeteiligungId: d.verkaeuferdarlehenBeteiligungId });
    expect(st.verkauf.storniertAm).not.toBeNull();
    expect(st.verkauf.storniertVon).toBe(await idVon(db, person("bearbeiter")));

    // Rückfluss neutralisiert, Beteiligung aktiv, Buchwert wie vorher (der Abgang entfällt)
    expect(await summe(b, "rueckfluss")).toBe(0);
    expect((await db.select().from(s.beteiligung).where(eq(s.beteiligung.id, b)))[0]!.status).toBe("aktiv");
    const daten = await json(await get(`/beteiligungen/${b}/instrumentdaten`));
    expect(daten.buchwert.wert).toBe("400000.00");
    expect(daten.zustand.buchwertabgang).toBe("0.00");
    // Bewertung des Verkaufs zurückgenommen: die frühere von 450.000 gilt wieder
    expect(await gueltigeBewertung(b, "2026-06-30")).toBeUndefined();
    expect((await uebersichtAm("2026-06-30")).portfoliowert).toBe("450000.00");
    // Forderung gestrichen, kein NAV-Beitrag
    const forderung = (await db.select().from(s.forderung))[0]!;
    expect(forderung.storniertAm).not.toBeNull();
    expect((await post(`/forderungen/${forderung.id}/erfuellt`, {})).status).toBe(409);
    // Verkäuferdarlehen: Vorgänge neutralisiert, keine Bewertung mehr
    const darlehen = d.verkaeuferdarlehenBeteiligungId as string;
    expect(await summe(darlehen, "auszahlung")).toBe(0);
    expect(await summe(darlehen, "zusage")).toBe(0);
    expect(await gueltigeBewertung(darlehen, "2026-06-30")).toBeUndefined();

    // zweites Storno und neuer Verkauf
    const nochmal = await post(`/verkaeufe/${d.verkauf.id}/storno`, { grund: "Nochmal" });
    expect(nochmal.status).toBe(409);
    expect((await json(nochmal)).fehler.code).toBe("VERKAUF_BEREITS_STORNIERT");
    const neu = await verkaufen({ datum: "2026-06-30", kaufpreis: "700000", anteilVerkauft: 1 });
    expect(neu.status).toBe(201);
    expect((await json(neu)).ergebnis).toMatchObject({ buchwertVorher: "400000.00", buchwertAbgang: "400000.00" });
  });

  it("stellt eine ersetzte Bewertung am Verkaufstag wieder her und nimmt Kaufpreisanpassungen mit zurück", async () => {
    await db.insert(s.bewertung).values({ beteiligungId: b, stichtag: "2026-06-30", wert: "480000.00", methode: "dcf", begruendung: "Planung", status: "freigegeben" });
    const d = await json(await verkaufen({ datum: "2026-06-30", kaufpreis: "700000", anteilVerkauft: 1 }));
    expect((await gueltigeBewertung(b, "2026-06-30"))!.wert).toBe("0.00");
    await post(`/beteiligungen/${b}/kaufpreisanpassung`, { datum: "2027-01-31", betrag: "20000", grund: "Earn-out" }, "bearbeiter");
    expect(await summe(b, "rueckfluss")).toBe(720000);
    expect((await post(`/verkaeufe/${d.verkauf.id}/storno`, { grund: "Rückabwicklung" }, "bearbeiter")).status).toBe(201);
    expect(await summe(b, "rueckfluss")).toBe(0);
    expect(await gueltigeBewertung(b, "2026-06-30")).toMatchObject({ wert: "480000.00", methode: "dcf" });
    const historie = await db.select().from(s.bewertung).where(and(eq(s.bewertung.beteiligungId, b), eq(s.bewertung.stichtag, "2026-06-30")));
    expect(historie.map((w) => `${w.status}:${w.wert}`).sort()).toEqual(["ersetzt:0.00", "ersetzt:480000.00", "freigegeben:480000.00"]);
    // Kaufpreisanpassung nach dem Storno nicht mehr möglich (kein gültiger Verkauf)
    expect((await post(`/beteiligungen/${b}/kaufpreisanpassung`, { datum: "2027-02-28", betrag: "5", grund: "x" })).status).toBe(409);
  });

  it("macht erfüllte Forderungen rückgängig; ein benutztes Verkäuferdarlehen und ein späterer Verkauf verhindern das Storno", async () => {
    const d = await json(await verkaufen(voll));
    await post(`/forderungen/${d.forderung.id}/erfuellt`, { datum: "2027-06-30" }, "bearbeiter");
    expect(await summe(b, "rueckfluss")).toBe(590000);
    // Auf dem Verkäuferdarlehen wird getilgt: nicht mehr unbenutzt
    await post(`/beteiligungen/${d.verkaeuferdarlehenBeteiligungId}/vorgaenge`, { art: "tilgung", valuta: "2027-01-01", betrag: "1000" }, "bearbeiter");
    const genutzt = await post(`/verkaeufe/${d.verkauf.id}/storno`, { grund: "x" }, "bearbeiter");
    expect(genutzt.status).toBe(409);
    expect((await json(genutzt)).fehler.code).toBe("VERKAUF_STORNO_DARLEHEN_GENUTZT");
    expect(await summe(b, "rueckfluss")).toBe(590000);
  });

  it("nimmt eine erfüllte Treuhandforderung mit zurück", async () => {
    const { verkaeuferdarlehen: _ohne, ...ohneDarlehen } = voll;
    void _ohne;
    const d = await json(await verkaufen(ohneDarlehen));
    await post(`/forderungen/${d.forderung.id}/erfuellt`, { datum: "2027-06-30" }, "bearbeiter");
    expect(await summe(b, "rueckfluss")).toBe(690000);
    expect((await post(`/verkaeufe/${d.verkauf.id}/storno`, { grund: "Rückabwicklung" }, "bearbeiter")).status).toBe(201);
    expect(await summe(b, "rueckfluss")).toBe(0);
    expect((await uebersichtAm("2027-06-30")).portfoliowert).toBe("450000.00");
    // der Storno-Vorgang der erfüllten Forderung hängt am Original
    expect(await anzahl(db, "vorgang", "art = 'rueckfluss' AND storniert_vorgang_id IS NOT NULL")).toBe(2);
  });

  it("ein später gebuchter Teilverkauf muss zuerst storniert werden", async () => {
    const erster = await json(await verkaufen({ datum: "2026-06-30", kaufpreis: "300000", anteilVerkauft: 0.5 }));
    const zweiter = await json(await verkaufen({ datum: "2026-12-31", kaufpreis: "100000", anteilVerkauft: 0.5 }));
    const antwort = await post(`/verkaeufe/${erster.verkauf.id}/storno`, { grund: "x" });
    expect(antwort.status).toBe(409);
    expect((await json(antwort)).fehler).toMatchObject({ code: "VERKAUF_STORNO_SPAETERER_VERKAUF", verkaufId: zweiter.verkauf.id });
    expect((await post(`/verkaeufe/${zweiter.verkauf.id}/storno`, { grund: "y" })).status).toBe(201);
    expect((await post(`/verkaeufe/${erster.verkauf.id}/storno`, { grund: "z" })).status).toBe(201);
    expect(await anzahl(db, "verkauf", "storniert_am IS NOT NULL")).toBe(2);
    expect((await json(await get(`/beteiligungen/${b}/instrumentdaten`))).buchwert.wert).toBe("400000.00");
    expect((await post(`/verkaeufe/00000000-0000-4000-8000-0000000000ee/storno`, { grund: "x" })).status).toBe(404);
    expect((await post(`/verkaeufe/${erster.verkauf.id}/storno`, {})).status).toBe(400);
  });
});

describe("Verkaufsvorschau", () => {
  it("liefert dieselbe Auswertung wie die Buchung und schreibt nichts", async () => {
    const vorher = { vorgang: await anzahl(db, "vorgang"), verkauf: await anzahl(db, "verkauf"), beteiligung: await anzahl(db, "beteiligung"), bewertung: await anzahl(db, "bewertung"), aenderung: await anzahl(db, "aenderung") };
    const vorschau = await post(`/beteiligungen/${b}/verkauf/vorschau`, voll, "bearbeiter");
    expect(vorschau.status).toBe(200);
    const v = await json(vorschau);
    expect(v).toMatchObject({ vorschau: true, status: "exit", forderung: { art: "treuhand", betrag: "50000.00", faelligAm: "2027-06-30" }, verkaeuferdarlehen: { betrag: "100000.00" } });
    expect({ vorgang: await anzahl(db, "vorgang"), verkauf: await anzahl(db, "verkauf"), beteiligung: await anzahl(db, "beteiligung"), bewertung: await anzahl(db, "bewertung"), aenderung: await anzahl(db, "aenderung") }).toEqual(vorher);

    const gebucht = await json(await verkaufen(voll));
    expect(gebucht.ergebnis).toEqual(v.ergebnis);
    expect(v.ergebnis).toMatchObject({ buchwertVorher: "400000.00", buchwertAbgang: "400000.00", erloes: "690000.00", ergebnis: "290000.00", barzufluss: "540000.00" });
  });

  it("meldet dieselben Fehler wie die Buchung", async () => {
    const zuViel = { ...voll, kaufpreis: "100000", kosten: "0", treuhand: { betrag: "60000", freigabeAm: "2027-01-01" }, verkaeuferdarlehen: { ...voll.verkaeuferdarlehen, betrag: "50000" } };
    const vorschau = await post(`/beteiligungen/${b}/verkauf/vorschau`, zuViel);
    const buchung = await verkaufen(zuViel);
    expect(vorschau.status).toBe(409);
    expect((await json(vorschau)).fehler.code).toBe("VERKAUF_UNGUELTIG");
    expect((await json(buchung)).fehler.code).toBe("VERKAUF_UNGUELTIG");
    expect((await post(`/beteiligungen/${b}/verkauf/vorschau`, { ...voll, anteilVerkauft: 2 })).status).toBe(400);
    expect((await post(`/beteiligungen/00000000-0000-4000-8000-0000000000ff/verkauf/vorschau`, voll)).status).toBe(404);
    await verkaufen({ datum: "2026-06-30", kaufpreis: "1000", anteilVerkauft: 1 });
    expect((await json(await post(`/beteiligungen/${b}/verkauf/vorschau`, voll))).fehler.code).toBe("BETEILIGUNG_NICHT_AKTIV");
  });
});

describe("Zinslauf: Hinweise, Codes, Abgrenzung", () => {
  const KONDITION = { gueltigAb: "2025-01-01", satzFix: "0.06", methode: "30E/360", zinsperiode: "jaehrlich", anker: "2026-01-01" };
  async function darlehen(kondition: object = KONDITION) {
    await post(`/beteiligungen/${ID.darlehen}/vorgaenge`, { art: "zusage", valuta: "2025-01-01", betrag: "200000" });
    await post(`/beteiligungen/${ID.darlehen}/vorgaenge`, { art: "auszahlung", valuta: "2025-01-01", betrag: "100000" });
    await post(`/beteiligungen/${ID.darlehen}/konditionen`, kondition);
  }

  it("GET /zinslaeufe/:id liefert hinweise.ohneKonditionen mit Namen der Organisation", async () => {
    await darlehen();
    const lauf = await json(await post("/zinslaeufe", { fondsId: ID.fonds, stichtag: "2026-12-31" }, "rechner"));
    expect(lauf.hinweise.ohneKonditionen).toEqual([ID.wandel]);
    expect(lauf.hinweise.ohneKonditionenDetails).toEqual([{ beteiligungId: ID.wandel, instrumentId: expect.any(String), organisation: "Gamma Beispiel", instrument: "wandeldarlehen" }]);
    const gelesen = await json(await get(`/zinslaeufe/${lauf.id}`));
    expect(gelesen.hinweise).toEqual(lauf.hinweise);
    // Konditionen nachgetragen: der Hinweis entfällt
    await post(`/beteiligungen/${ID.wandel}/vorgaenge`, { art: "zusage", valuta: "2025-01-01", betrag: "1000" });
    await post(`/beteiligungen/${ID.wandel}/konditionen`, KONDITION);
    expect((await json(await get(`/zinslaeufe/${lauf.id}`))).hinweise).toEqual({ ohneKonditionen: [], ohneKonditionenDetails: [] });
  });

  it("der Kontrollbericht trägt je Prüfung einen stabilen Code und Parameter", async () => {
    await darlehen();
    const lauf = await json(await post("/zinslaeufe", { fondsId: ID.fonds, stichtag: "2026-12-31" }, "rechner"));
    const k = await json(await get(`/zinslaeufe/${lauf.id}/kontrolle`));
    expect(k.pruefungen.map((p: { code: string }) => p.code)).toEqual(["ZINSLAUF_SUMME_ABWEICHUNG", "ZINSPERIODE_DOPPELT", "DARLEHEN_NICHT_ABGEDECKT", "DARLEHEN_OHNE_KONDITIONEN", "KAPITAL_NULL"]);
    const summeP = k.pruefungen[0];
    expect(summeP).toMatchObject({ status: "ok", hinweisCode: "ZINSLAUF_NOCH_NICHT_GEBUCHT", hinweisParams: { status: "berechnet" } });
    const ohne = k.pruefungen.find((p: { code: string }) => p.code === "DARLEHEN_OHNE_KONDITIONEN");
    expect(ohne).toMatchObject({ status: "abweichung", params: { anzahl: 1 } });
    expect(ohne.details[0].beteiligungId).toBe(ID.wandel);
    expect(k.pruefungen.every((p: { schluessel: string; bezeichnung: string }) => p.schluessel && p.bezeichnung)).toBe(true);
  });

  it("Fehler der Abgrenzung tragen einen Code und Parameter", async () => {
    await darlehen({ ...KONDITION, gewinnabhaengigSatz: "0.1", kappungSatz: "0.02" });
    const a = await json(await get(`/fonds/${ID.fonds}/abgrenzung?stichtag=2026-07-01`));
    expect(a.darlehen[0]).toMatchObject({ fehlerCode: "BERECHNUNG_FEHLGESCHLAGEN", fehlerParams: { beteiligungId: ID.darlehen } });
    expect(a.darlehen[0].fehlerParams.grund).toContain("Jahresüberschuss");
    expect(a.darlehen[0].fehler).toContain("Jahresüberschuss");
    await put(`/beteiligungen/${ID.darlehen}/jahresueberschuss/2025`, { betrag: "30000" });
    await put(`/beteiligungen/${ID.darlehen}/jahresueberschuss/2026`, { betrag: "30000" });
    const ok = await json(await get(`/fonds/${ID.fonds}/abgrenzung?stichtag=2026-07-01`));
    expect(ok.darlehen[0]).toMatchObject({ fehler: null, fehlerCode: null, fehlerParams: null });
  });
});

describe("Instrumentdaten mit Stichtag und Wissensstand, Runden", () => {
  it("schneidet Vorgänge, Konditionen und Verkäufe nach Stichtag und Erfassungszeitpunkt", async () => {
    await post(`/beteiligungen/${b}/vorgaenge`, { art: "auszahlung", valuta: "2025-06-01", betrag: "100000" });
    const zwischen = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 15));
    await verkaufen({ datum: "2026-06-30", kaufpreis: "300000", anteilVerkauft: 0.5 });
    const heutig = await json(await get(`/beteiligungen/${b}/instrumentdaten`));
    expect(heutig.zustand.investiert).toBe("600000.00");
    expect(heutig.verkaeufe).toHaveLength(1);
    expect(heutig.zustand.buchwertabgang).not.toBe("0.00");

    // Stichtag vor der zweiten Auszahlung
    const frueh = await json(await get(`/beteiligungen/${b}/instrumentdaten?stichtag=2025-05-31`));
    expect(frueh.zustand).toMatchObject({ investiert: "500000.00", wertberichtigungen: "0.00", buchwertabgang: "0.00" });
    expect(frueh.verkaeufe).toHaveLength(0);
    // Wissensstand vor dem Verkauf
    const damals = await json(await get(`/beteiligungen/${b}/instrumentdaten?stand=${encodeURIComponent(zwischen)}`));
    expect(damals.verkaeufe).toHaveLength(0);
    expect(damals.zustand).toMatchObject({ investiert: "600000.00", buchwertabgang: "0.00" });
    expect(damals.buchwert.wert).toBe("500000.00");
    expect((await get(`/beteiligungen/${b}/instrumentdaten?stichtag=gestern`)).status).toBe(400);
  });

  it("GET /beteiligungen/:id/runden liefert mit alle=1 auch Runden nach dem Stichtag", async () => {
    await db.insert(s.finanzierungsrunde).values([
      { organisationId: ID.orgA, bezeichnung: "Seed", datum: "2025-03-01", preMoney: "1000000.00", postMoney: "1200000.00", preisJeAnteil: "2.0000", anteileGesamtNach: "600000" },
      { organisationId: ID.orgA, bezeichnung: "Serie A", datum: "2026-05-01", preMoney: "3000000.00", postMoney: "3500000.00", preisJeAnteil: "5.0000", anteileGesamtNach: "700000" },
    ]);
    const bis = await json(await get(`/beteiligungen/${b}/runden?stichtag=2025-12-31`));
    expect(bis.daten.map((r: { bezeichnung: string }) => r.bezeichnung)).toEqual(["Seed"]);
    const alle = await json(await get(`/beteiligungen/${b}/runden?stichtag=2025-12-31&alle=1`));
    expect(alle.daten.map((r: { bezeichnung: string }) => r.bezeichnung)).toEqual(["Seed", "Serie A"]);
    // Das Detail der Beteiligung schneidet weiterhin am Stichtag
    expect((await json(await get(`/beteiligungen/${b}?stichtag=2025-12-31`))).runden).toHaveLength(1);
    expect((await get(`/beteiligungen/00000000-0000-4000-8000-0000000000ff/runden`)).status).toBe(404);
    expect((await get(`/beteiligungen/${b}/runden?alle=2`)).status).toBe(400);
  });
});

describe("Wandlung: Vorschau und Buchung prüfen den Cut-off gleich", () => {
  const KONDITION = { gueltigAb: "2026-01-01", satzFix: "0.06", methode: "30E/360", zinsperiode: "jaehrlich", anker: "2027-01-01" };
  const RUNDE = { bezeichnung: "Serie A", preMoney: "8000000", postMoney: "10000000", preisJeAnteil: "12.5", anteileGesamtNach: "800000" };
  const eingabe = (cutoff: string) => ({ cutoff, zinsenWandeln: true, preisregel: { rundenpreisJeAnteil: "12.5", discount: "0.2" }, nennwertJeAnteil: "1", runde: { neu: RUNDE } });

  beforeEach(async () => {
    await post(`/beteiligungen/${ID.wandel}/vorgaenge`, { art: "zusage", valuta: "2026-01-01", betrag: "200000" });
    await post(`/beteiligungen/${ID.wandel}/vorgaenge`, { art: "auszahlung", valuta: "2026-01-01", betrag: "100000" });
    await post(`/beteiligungen/${ID.wandel}/konditionen`, KONDITION);
  });

  it("derselbe Fehler bei Cut-off vor dem ersten Vorgang; ein zukünftiges Datum ist in der Vorschau rechenbar, aber nicht buchbar", async () => {
    const vorschau = await post(`/beteiligungen/${ID.wandel}/wandlung/vorschau`, eingabe("2020-01-01"));
    const buchung = await post(`/beteiligungen/${ID.wandel}/wandlung`, eingabe("2020-01-01"));
    expect(vorschau.status).toBe(400);
    expect(buchung.status).toBe(400);
    expect((await json(vorschau)).fehler.felder).toEqual((await json(buchung)).fehler.felder);

    const morgen = new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10);
    const zukunft = await post(`/beteiligungen/${ID.wandel}/wandlung/vorschau`, eingabe(morgen));
    expect(zukunft.status).toBe(200);
    expect((await json(zukunft)).buchbar).toBe(false);
    expect((await post(`/beteiligungen/${ID.wandel}/wandlung`, eingabe(morgen))).status).toBe(400);
    expect(await anzahl(db, "wandlung")).toBe(0);

    const vorschauOk = await json(await post(`/beteiligungen/${ID.wandel}/wandlung/vorschau`, eingabe("2026-07-01")));
    expect(vorschauOk.buchbar).toBe(true);
    const gebucht = await json(await post(`/beteiligungen/${ID.wandel}/wandlung`, eingabe("2026-07-01")));
    expect(gebucht.ergebnis).toEqual(vorschauOk.ergebnis);
  });
});
