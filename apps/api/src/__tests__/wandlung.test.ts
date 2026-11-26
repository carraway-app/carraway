import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { erstelleTestApp, idVon, person } from "./hilfen-auth";
import { leeren, oeffneTestdb, vehikelVon } from "./hilfen";
import { anzahl, aufrufe, auftraege, grundbestand, ID, json, leereAuftraege, protokollZeilen } from "./hilfen-instrumente";
import { vorgaengeEinfuegen } from "./instrument-hilfen";
import { geldlos } from "../instrumente/geldfluss";

const { db, pool } = oeffneTestdb();
const { get, post } = aufrufe(erstelleTestApp(db));

const KONDITION = { gueltigAb: "2026-01-01", satzFix: "0.06", methode: "30E/360", zinsperiode: "jaehrlich", anker: "2027-01-01" };
const RUNDE_NEU = { bezeichnung: "Serie A", preMoney: "8000000", postMoney: "10000000", preisJeAnteil: "12.5", anteileGesamtNach: "800000" };
const wandlung = (koerper: object, id: string = ID.wandel) => post(`/beteiligungen/${id}/wandlung`, koerper, "bearbeiter");
const basis = { cutoff: "2026-07-01", zinsenWandeln: true, preisregel: { rundenpreisJeAnteil: "12.5", discount: "0.2" }, nennwertJeAnteil: "1", runde: { neu: RUNDE_NEU } };

/** Summe einer Art auf einem Instrument (Quelle und Ziel liegen in derselben Beteiligung). */
const summeInstrument = async (instrumentId: string, art: s.Vorgang["art"]) =>
  (await db.select().from(s.vorgang).where(and(eq(s.vorgang.instrumentId, instrumentId), eq(s.vorgang.art, art)))).reduce((x, v) => x + Math.round(Number(v.betrag) * 100), 0) / 100;

beforeEach(async () => {
  await grundbestand(db);
  const b = ID.wandel;
  await post(`/beteiligungen/${b}/vorgaenge`, { art: "zusage", valuta: "2026-01-01", betrag: "200000" });
  await post(`/beteiligungen/${b}/vorgaenge`, { art: "auszahlung", valuta: "2026-01-01", betrag: "100000" });
  await post(`/beteiligungen/${b}/konditionen`, KONDITION);
  await leereAuftraege(db);
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

describe("POST /beteiligungen/:id/wandlung", () => {
  it("mit Abschlag und Zinsen im Wandlungsbetrag: Darlehen erlischt, Anteile entstehen, alles geht auf", async () => {
    const antwort = await wandlung(basis);
    expect(antwort.status).toBe(201);
    const d = await json(antwort);
    // Rechenkern: 100.000 × 6 % × 180/360 = 3.000, Preis 12,50 × 0,8 = 10, 103.000 ÷ 10 = 10.300 Anteile
    expect(d.ergebnis).toMatchObject({ restkapital: "100000", zinsenGebucht: "3000", wandlungsbetrag: "103000", preisJeAnteil: "10", anzahlAnteile: "10300", nominal: "10300", agio: "92700", massgeblich: "abschlag" });
    expect(d.ergebnis.schritte.length).toBeGreaterThan(5);
    expect(d.wandlung).toMatchObject({ nominal: "10300.00", agio: "92700.00", spitzenbetrag: "0.00", zinsenGebucht: "3000.00", anzahlAnteile: "10300" });

    // Vorgänge am Quell-Instrument (Wandeldarlehen): Zins 3.000, Tilgung 100.000 (= restkapital)
    expect(await summeInstrument(d.quellInstrumentId, "zins")).toBe(3000);
    expect(await summeInstrument(d.quellInstrumentId, "tilgung")).toBe(100000);
    const tilgung = (await db.select().from(s.vorgang).where(and(eq(s.vorgang.instrumentId, d.quellInstrumentId), eq(s.vorgang.art, "tilgung"))))[0]!;
    expect(tilgung.bemerkung).toBe("Wandlung: Tilgung durch Wandlung in Anteile");
    expect(tilgung.bemerkung).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
    expect(tilgung.valuta).toBe("2026-07-01");

    // Ziel: ein neues Eigenkapital-Instrument in derselben Beteiligung (keine zweite Beteiligung) mit Nominal plus Agio
    expect(d.zielBeteiligungId).toBe(ID.wandel);
    expect(await anzahl(db, "beteiligung")).toBe(3);
    const instrumente = await db.select().from(s.instrument).where(eq(s.instrument.beteiligungId, ID.wandel));
    const quelle = instrumente.find((i) => i.id === d.quellInstrumentId)!;
    const ziel = instrumente.find((i) => i.id === d.zielInstrumentId)!;
    expect(quelle).toMatchObject({ art: "wandeldarlehen", status: "gewandelt" });
    expect(ziel).toMatchObject({ art: "offene_beteiligung", status: "aktiv", bezeichnung: "Serie A-Anteile" });
    expect(ziel.rundeId).toBe(d.rundeId);
    expect(await summeInstrument(ziel.id, "auszahlung")).toBe(103000);
    expect(await summeInstrument(ziel.id, "zusage")).toBe(103000);
    expect(d.wandlung).toMatchObject({ darlehenBeteiligungId: ID.wandel, zielBeteiligungId: ID.wandel, quellInstrumentId: quelle.id, zielInstrumentId: ziel.id });
    // Bücher gehen auf: Darlehen getilgt + gewandelte Zinsen = Einlage ins Ziel + Spitzenbetrag
    expect((await summeInstrument(quelle.id, "tilgung")) + (await summeInstrument(quelle.id, "zins"))).toBe((await summeInstrument(ziel.id, "auszahlung")) + Number(d.wandlung.spitzenbetrag));

    // Die Beteiligung bleibt aktiv und spiegelt jetzt das aktive Eigenkapital; eine Bewertung am Cut-off in Höhe der Einlage (das Darlehen ist erloschen)
    expect((await db.select().from(s.beteiligung).where(eq(s.beteiligung.id, ID.wandel)))[0]).toMatchObject({ status: "aktiv", instrument: "offene_beteiligung" });
    const bewertungen = await db.select().from(s.bewertung);
    expect(bewertungen).toHaveLength(1);
    expect(bewertungen[0]).toMatchObject({ beteiligungId: ID.wandel, stichtag: "2026-07-01", wert: "103000.00", methode: "anschaffungskosten" });

    // Runde inline angelegt, Position des Fonds
    const [position] = await db.select().from(s.rundenposition);
    expect(position).toMatchObject({ fondsId: ID.fonds, betrag: "103000.00", anteile: "10300", rolle: "co" });
    expect((await db.select().from(s.finanzierungsrunde))[0]).toMatchObject({ organisationId: ID.orgC, bezeichnung: "Serie A", datum: "2026-07-01" });

    // Protokoll und Neuberechnung
    expect((await protokollZeilen(db, "wandlung")).map((z) => z.akteur)).toEqual([await idVon(db, person("bearbeiter"))]);
    expect(await anzahl(db, "aenderung", "tabelle = 'vorgang'")).toBe(6); // zwei aus dem Aufbau, vier aus der Wandlung
    expect(await anzahl(db, "aenderung", "tabelle = 'instrument' AND aktion = 'wandlung'")).toBe(1);
    expect(await auftraege(db)).toBe(1);

    // Die Wandlung ist im Detail sichtbar und nicht wiederholbar
    const nochmal = await wandlung(basis);
    expect(nochmal.status).toBe(409);
    expect((await json(nochmal)).fehler.code).toBe("BEREITS_GEWANDELT");
  });

  it("mit Bewertungsobergrenze, Zinsauszahlung und Spitzenbetrag in einer bestehenden Runde", async () => {
    const [runde] = await db
      .insert(s.finanzierungsrunde)
      .values({ organisationId: ID.orgC, bezeichnung: "Serie A", datum: "2026-06-30", preMoney: "8000000", postMoney: "10000000", preisJeAnteil: "12.5000", anteileGesamtNach: "800000" })
      .returning();
    await db.insert(s.rundenposition).values({ rundeId: runde!.id, vehikelId: await vehikelVon(db, ID.orgA), betrag: "1900000.00", anteile: "152000", rolle: "lead" });
    const antwort = await wandlung({
      ...basis,
      zinsenWandeln: false,
      preisregel: { discount: "0.2", bewertungsobergrenze: { betrag: "3650000", anteileVorRunde: "500000" } },
      runde: { id: runde!.id },
    });
    expect(antwort.status).toBe(201);
    const d = await json(antwort);
    // Preis aus der Obergrenze 3.650.000 ÷ 500.000 = 7,30; 100.000 ÷ 7,30 = 13.698 Anteile, Spitzenbetrag 4,60
    expect(d.ergebnis).toMatchObject({ massgeblich: "bewertungsobergrenze", preisJeAnteil: "7.3", anzahlAnteile: "13698", wandlungsbetrag: "100000" });
    expect(d.wandlung).toMatchObject({ spitzenbetrag: "4.60", nominal: "13698.00", agio: "86297.40", zinsenGebucht: "3000.00" });
    // Zinsen werden ausgezahlt (nicht gewandelt): das Ziel nimmt nur Kapital abzüglich Spitzenbetrag auf
    expect(await summeInstrument(d.quellInstrumentId, "tilgung")).toBe(100000);
    expect(await summeInstrument(d.quellInstrumentId, "zins")).toBe(3000);
    expect(await summeInstrument(d.zielInstrumentId, "auszahlung")).toBe(99995.4);
    const tilgungen = await db.select().from(s.vorgang).where(and(eq(s.vorgang.instrumentId, d.quellInstrumentId), eq(s.vorgang.art, "tilgung")));
    expect(tilgungen.map((t) => t.betrag).sort()).toEqual(["4.60", "99995.40"]);
    // Position des Fonds in der bestehenden Runde
    const positionen = await db.select().from(s.rundenposition).where(eq(s.rundenposition.rundeId, runde!.id));
    expect(positionen).toHaveLength(2);
    expect(positionen.find((p) => p.fondsId === ID.fonds)).toMatchObject({ betrag: "99995.40", anteile: "13698" });
  });

  describe("Anteilsklasse der neuen Anteile", () => {
    const runde = async () =>
      (await db.insert(s.finanzierungsrunde).values({ organisationId: ID.orgC, bezeichnung: "Serie A", datum: "2026-06-30", preMoney: "8000000", postMoney: "10000000", preisJeAnteil: "12.5000", anteileGesamtNach: "800000" }).returning())[0]!;
    const klasse = async (organisationId: string, name: string) => (await db.insert(s.anteilsklasse).values({ organisationId, name }).returning())[0]!;
    const ergebnis = async (d: { zielInstrumentId: string; rundeId: string }) => {
      const [ziel] = await db.select().from(s.instrument).where(eq(s.instrument.id, d.zielInstrumentId));
      const [position] = await db.select().from(s.rundenposition).where(and(eq(s.rundenposition.rundeId, d.rundeId), eq(s.rundenposition.fondsId, ID.fonds)));
      return { instrument: ziel!.anteilsklasseId, position: position!.anteilsklasseId };
    };

    it("übernimmt die angegebene Klasse auf Instrument und Rundenposition", async () => {
      const r = await runde();
      const k = await klasse(ID.orgC, "Serie A");
      const antwort = await wandlung({ ...basis, runde: { id: r.id }, anteilsklasseId: k.id });
      expect(antwort.status).toBe(201);
      expect(await ergebnis(await json(antwort))).toEqual({ instrument: k.id, position: k.id });
    });

    it("leitet die eindeutige Klasse der übrigen Positionen der Runde ab", async () => {
      const r = await runde();
      const k = await klasse(ID.orgC, "Serie A");
      await db.insert(s.rundenposition).values([
        { rundeId: r.id, vehikelId: await vehikelVon(db, ID.orgA), betrag: "1.00", anteile: "1", rolle: "lead", anteilsklasseId: k.id },
        { rundeId: r.id, vehikelId: await vehikelVon(db, ID.orgB), betrag: "1.00", anteile: "1", rolle: "co", anteilsklasseId: k.id },
        { rundeId: r.id, vehikelId: await vehikelVon(db, ID.orgC), betrag: "1.00", anteile: "1", rolle: "co" },
      ]);
      const vorschau = await post(`/beteiligungen/${ID.wandel}/wandlung/vorschau`, { ...basis, runde: { id: r.id } }, "bearbeiter");
      expect((await json(vorschau)).anteilsklasseId).toBe(k.id);
      const antwort = await wandlung({ ...basis, runde: { id: r.id } });
      expect(antwort.status).toBe(201);
      expect(await ergebnis(await json(antwort))).toEqual({ instrument: k.id, position: k.id });
    });

    it("lässt die Klasse leer, wenn die Runde mehrere Klassen hat oder neu ist", async () => {
      const r = await runde();
      const k1 = await klasse(ID.orgC, "Serie A");
      const k2 = await klasse(ID.orgC, "Seed");
      await db.insert(s.rundenposition).values([
        { rundeId: r.id, vehikelId: await vehikelVon(db, ID.orgA), betrag: "1.00", anteile: "1", rolle: "lead", anteilsklasseId: k1.id },
        { rundeId: r.id, vehikelId: await vehikelVon(db, ID.orgB), betrag: "1.00", anteile: "1", rolle: "co", anteilsklasseId: k2.id },
      ]);
      const mehrere = await json(await wandlung({ ...basis, runde: { id: r.id } }));
      expect(await ergebnis(mehrere)).toEqual({ instrument: null, position: null });
    });

    it("lässt die Klasse bei einer neuen Runde ohne Angabe leer", async () => {
      const d = await json(await wandlung(basis));
      expect(await ergebnis(d)).toEqual({ instrument: null, position: null });
    });

    it("lehnt die Klasse eines anderen Unternehmens ab, ohne etwas zu buchen", async () => {
      const k = await klasse(ID.orgA, "Fremd");
      const antwort = await wandlung({ ...basis, anteilsklasseId: k.id });
      expect(antwort.status).toBe(409);
      expect((await json(antwort)).fehler.code).toBe("ANTEILSKLASSE_PASST_NICHT");
      expect(await db.select().from(s.rundenposition)).toHaveLength(0);
      expect((await wandlung({ ...basis, anteilsklasseId: "00000000-0000-4000-8000-0000000000ee" })).status).toBe(404);
    });
  });

  it("rundet den Spitzenbetrag auf Cent und lässt den Rest im Agio, sodass die Bücher auf den Cent aufgehen", async () => {
    const antwort = await wandlung({ ...basis, preisregel: { rundenpreisJeAnteil: "20", bewertungsobergrenze: { betrag: "4000000", anteileVorRunde: "350000" } } });
    const d = await json(antwort);
    // Preis 4.000.000 ÷ 350.000 = 11,428571…; 103.000 ÷ Preis = 9.012,5 → 9.012 Anteile, Spitzenbetrag 5,7142857… → 5,71
    expect(d.ergebnis).toMatchObject({ anzahlAnteile: "9012", massgeblich: "bewertungsobergrenze" });
    expect(d.wandlung).toMatchObject({ spitzenbetrag: "5.71", nominal: "9012.00", agio: "93982.29" });
    expect(await summeInstrument(d.zielInstrumentId, "auszahlung")).toBe(102994.29);
    expect(Math.round(((await summeInstrument(d.quellInstrumentId, "tilgung")) + (await summeInstrument(d.quellInstrumentId, "zins"))) * 100)).toBe(Math.round((102994.29 + 5.71) * 100));
  });

  it("fügt Eigenkapital zu einem bereits vorhandenen Eigenkapital-Instrument derselben Beteiligung hinzu und setzt die Bewertung fort", async () => {
    // Die Beteiligung hat schon Eigenkapital (bewertet mit 50.000) und das Wandeldarlehen (Buchwert 100.000, noch ohne Bewertung des Darlehens)
    await post(`/beteiligungen/${ID.wandel}/instrumente`, { art: "offene_beteiligung", bezeichnung: "Anteile Seed" });
    await db.insert(s.bewertung).values({ beteiligungId: ID.wandel, stichtag: "2026-03-31", wert: "150000.00", methode: "letzte_runde", status: "freigegeben" as const });
    const d = await json(await wandlung({ ...basis, instrumentId: (await db.select().from(s.instrument).where(and(eq(s.instrument.beteiligungId, ID.wandel), eq(s.instrument.art, "wandeldarlehen"))))[0]!.id }));
    expect(d.zielBeteiligungId).toBe(ID.wandel);
    // 150.000 − Buchwert des erloschenen Darlehens (100.000) + 103.000 umgewandelt
    expect((await db.select().from(s.bewertung).where(and(eq(s.bewertung.beteiligungId, ID.wandel), eq(s.bewertung.stichtag, "2026-07-01"))))[0]!.wert).toBe("153000.00");
    expect((await db.select().from(s.instrument).where(eq(s.instrument.beteiligungId, ID.wandel))).map((i) => `${i.art}:${i.status}`).sort()).toEqual(["offene_beteiligung:aktiv", "offene_beteiligung:aktiv", "wandeldarlehen:gewandelt"]);
  });

  it("zwei Wandeldarlehen in einer Beteiligung: ohne Angabe des Instruments 400, mit Angabe wird genau dieses gewandelt", async () => {
    const zweites = await json(await post(`/beteiligungen/${ID.wandel}/instrumente`, { art: "wandeldarlehen", bezeichnung: "Wandeldarlehen 2026 II" }));
    await post(`/beteiligungen/${ID.wandel}/vorgaenge`, { art: "zusage", valuta: "2026-01-01", betrag: "50000", instrumentId: zweites.id });
    await post(`/beteiligungen/${ID.wandel}/vorgaenge`, { art: "auszahlung", valuta: "2026-01-01", betrag: "50000", instrumentId: zweites.id });
    await post(`/beteiligungen/${ID.wandel}/konditionen`, { ...KONDITION, instrumentId: zweites.id });
    const ohne = await wandlung(basis);
    expect(ohne.status).toBe(400);
    expect((await json(ohne)).fehler.felder[0]).toMatchObject({ feld: "instrumentId", code: "instrument_erforderlich" });
    const d = await json(await wandlung({ ...basis, instrumentId: zweites.id }));
    expect(d.quellInstrumentId).toBe(zweites.id);
    expect(await summeInstrument(zweites.id, "tilgung")).toBe(50000);
    const instrumente = await db.select().from(s.instrument).where(eq(s.instrument.beteiligungId, ID.wandel));
    expect(instrumente.filter((i) => i.status === "gewandelt").map((i) => i.id)).toEqual([zweites.id]);
    // das andere Wandeldarlehen ist noch aktiv und wandelbar (Beteiligung bleibt aktiv)
    expect((await wandlung({ ...basis, runde: { id: d.rundeId } })).status).toBe(409); // Position des Fonds in dieser Runde gibt es schon
  });

  it("ein bestehender Bewertungseintrag am Cut-off wird ersetzt, die Neuberechnung angefordert", async () => {
    await db.insert(s.bewertung).values({ beteiligungId: ID.wandel, stichtag: "2026-07-01", wert: "99000.00", methode: "sonstige", status: "freigegeben" as const });
    await leereAuftraege(db);
    expect((await wandlung(basis)).status).toBe(201);
    const zeilen = await db.select().from(s.bewertung).where(eq(s.bewertung.beteiligungId, ID.wandel));
    // 99.000 − Buchwert des erloschenen Darlehens (100.000, nicht unter null) + 103.000 umgewandelt
    expect(zeilen.find((w) => w.status === "freigegeben")!.wert).toBe("103000.00");
    expect(zeilen.find((w) => w.status === "ersetzt")!.wert).toBe("99000.00");
    expect(await auftraege(db)).toBe(1);
  });

  it("lehnt falsches Instrument, fehlende Konditionen, fremde Runde, doppelte Position und unmögliche Daten ab", async () => {
    const falsch = await wandlung(basis, ID.darlehen);
    expect(falsch.status).toBe(409);
    expect((await json(falsch)).fehler.code).toBe("INSTRUMENT_PASST_NICHT");

    await db.update(s.beteiligung).set({ instrument: "wandeldarlehen" }).where(eq(s.beteiligung.id, ID.darlehen));
    await db.update(s.instrument).set({ art: "wandeldarlehen" }).where(eq(s.instrument.beteiligungId, ID.darlehen));
    const ohne = await wandlung(basis, ID.darlehen);
    expect((await json(ohne)).fehler.code).toBe("KEINE_KONDITIONEN");

    const [fremd] = await db.insert(s.finanzierungsrunde).values({ organisationId: ID.orgA, bezeichnung: "Fremd", datum: "2026-06-30", preMoney: "1", postMoney: "2", preisJeAnteil: "1.0000", anteileGesamtNach: "10" }).returning();
    const rundeFremd = await wandlung({ ...basis, runde: { id: fremd!.id } });
    expect(rundeFremd.status).toBe(409);
    expect((await json(rundeFremd)).fehler.code).toBe("RUNDE_PASST_NICHT");

    const [eigen] = await db.insert(s.finanzierungsrunde).values({ organisationId: ID.orgC, bezeichnung: "Eigen", datum: "2026-06-30", preMoney: "1", postMoney: "2", preisJeAnteil: "1.0000", anteileGesamtNach: "10" }).returning();
    await db.insert(s.rundenposition).values({ rundeId: eigen!.id, fondsId: ID.fonds, betrag: "1.00", anteile: "1", rolle: "co" });
    const doppelt = await wandlung({ ...basis, runde: { id: eigen!.id } });
    expect((await json(doppelt)).fehler.code).toBe("RUNDENPOSITION_VORHANDEN");
    expect((await wandlung({ ...basis, runde: { id: "00000000-0000-4000-8000-0000000000ee" } })).status).toBe(404);

    const frueh = await wandlung({ ...basis, cutoff: "2025-12-31" });
    expect(frueh.status).toBe(400); // vor dem ersten Vorgang des Fonds
    expect((await json(frueh)).fehler.felder[0]).toMatchObject({ feld: "cutoff", code: "stichtag_ausserhalb" });
    // Der Rechenkern meldet weiterhin einen Cut-off vor der ersten Auszahlung (Fonds hat frühere Vorgänge)
    await vorgaengeEinfuegen(db, { beteiligungId: ID.eigen, art: "zusage", valuta: "2025-01-01", betrag: "1.00" });
    const frueh2 = await wandlung({ ...basis, cutoff: "2025-12-31" });
    expect(frueh2.status).toBe(409);
    expect((await json(frueh2)).fehler).toMatchObject({ code: "BERECHNUNG_FEHLGESCHLAGEN", beteiligungId: ID.wandel });

    const ungueltig = await wandlung({ ...basis, preisregel: { discount: "2" }, nennwertJeAnteil: "0", cutoff: "irgendwann" });
    expect(ungueltig.status).toBe(400);
    expect((await wandlung(basis, "00000000-0000-4000-8000-0000000000ff")).status).toBe(404);
    expect(await anzahl(db, "wandlung")).toBe(0);
    expect(await anzahl(db, "vorgang", "art = 'zins'")).toBe(0);
  });
});

describe("Kennzahlen nach der Wandlung: Umbuchungen sind kein Geld", () => {
  /** Wandlung mit Spitzenbetrag 4,60 (siehe oben): Tilgung durch Wandlung 99.995,40 (kein Geld), Spitzenbetrag 4,60 (bar), Einlage 99.995,40 (kein Geld). */
  const wandeln = async () => {
    const [runde] = await db
      .insert(s.finanzierungsrunde)
      .values({ organisationId: ID.orgC, bezeichnung: "Serie A", datum: "2026-06-30", preMoney: "8000000", postMoney: "10000000", preisJeAnteil: "12.5000", anteileGesamtNach: "800000" })
      .returning();
    await db.insert(s.rundenposition).values({ rundeId: runde!.id, vehikelId: await vehikelVon(db, ID.orgA), betrag: "1900000.00", anteile: "152000", rolle: "lead" });
    const antwort = await wandlung({ ...basis, zinsenWandeln: false, preisregel: { discount: "0.2", bewertungsobergrenze: { betrag: "3650000", anteileVorRunde: "500000" } }, runde: { id: runde!.id } });
    expect(antwort.status).toBe(201);
    return json(antwort);
  };

  it("Beteiligung: Investiert sind die Auszahlungen, Rückfluss nur der Spitzenbetrag, IRR und Multiple rechnen mit echtem Geld; Buchungen tragen die Marke", async () => {
    await wandeln();
    const d = await json(await get(`/beteiligungen/${ID.wandel}?stichtag=2026-12-31`));
    const k = d.kennzahlen;
    expect(Number(k.investiert.wert)).toBe(100000);
    expect(Number(k.rueckfluesse.wert)).toBe(4.6);
    // Multiple = (Bewertung + Rückflüsse) ÷ Investiert mit der Bewertung 99.995,40 aus der Wandlung
    expect(Number(k.multiple.wert)).toBeCloseTo((99995.4 + 4.6) / 100000, 6);
    expect(k.irr.schritte.find((x: { bezeichnung: string }) => x.bezeichnung.startsWith("Auszahlungen"))).toMatchObject({ wert: "100000" });
    const marke = (d.vorgaenge as { art: string; betrag: string; ohneGeldfluss: boolean }[]).filter((v) => v.ohneGeldfluss).map((v) => `${v.art}:${v.betrag}`).sort();
    expect(marke).toEqual(["auszahlung:99995.40", "tilgung:99995.40", "zusage:99995.40"]);
    // Position und Buchwert bleiben: Investiert 199.995,40 − Tilgungen 100.000 (das Darlehen geht auf null), Offene Zusage unverändert
    const inst = await json(await get(`/beteiligungen/${ID.wandel}/instrumentdaten?stichtag=2026-12-31`));
    expect(inst.buchwert.wert).toBe("99995.40");
    expect(inst.zustand).toMatchObject({ tilgungen: "100000.00", investiert: "100000.00", offeneZusage: "100000.00", zusage: "299995.40" });
    const quelle = inst.instrumente.find((i: { art: string }) => i.art === "wandeldarlehen");
    expect(quelle).toMatchObject({ offenesKapital: "0.00", tilgungen: "100000.00" });
    expect(inst.instrumente.find((i: { art: string }) => i.art === "offene_beteiligung")).toMatchObject({ ausgezahlt: "99995.40" });
  });

  it("Fondsübersicht, Währungssicht und Portfolioliste stimmen mit der Beteiligung überein", async () => {
    await wandeln();
    const ue = await json(await get(`/fonds/${ID.fonds}/uebersicht?stichtag=2026-12-31`));
    const zeile = ue.beteiligungen.find((b: { id: string }) => b.id === ID.wandel);
    expect(zeile).toMatchObject({ investiert: "100000.00", rueckfluesse: "4.60", zusage: "200000.00" });
    const sicht = await json(await get(`/beteiligungen/${ID.wandel}/waehrungssicht?stichtag=2026-12-31`));
    expect(sicht.kennzahlen.investiert.fonds).toBe("100000.00");
    expect(sicht.kennzahlen.rueckfluesse.fonds).toBe("4.60");
    const summe = (feld: "investiert" | "rueckfluesse") => ue.beteiligungen.reduce((x: number, b: Record<string, string>) => x + Number(b[feld]), 0);
    // Summe der Zeilen = Summe je Vorgang ohne Umbuchungen (Prüfung des Berichts)
    const { rows } = await db.execute(sql`
      SELECT coalesce(sum(v.betrag) FILTER (WHERE v.art = 'auszahlung' AND NOT ${geldlos("v")}), 0)::float AS investiert,
             coalesce(sum(v.betrag) FILTER (WHERE v.art IN ('rueckfluss', 'tilgung', 'zinszahlung', 'dividende') AND NOT ${geldlos("v")}), 0)::float AS rueck
      FROM vorgang v JOIN beteiligung be ON be.id = v.beteiligung_id WHERE be.fonds_id = ${ID.fonds}`);
    expect(summe("investiert")).toBeCloseTo(Number(rows[0]!.investiert), 2);
    expect(summe("rueckfluesse")).toBeCloseTo(Number(rows[0]!.rueck), 2);
  });

  it("Journal: Umbuchungen der Wandlung haben keine Kassenwirkung, der Spitzenbetrag schon (Zeilen und Summen)", async () => {
    await wandeln();
    const j = await json(await get(`/fonds/${ID.fonds}/journal`));
    const zeilen = (j.daten as { typ: string; betrag: string; kassenwirkung: string | null; ohneGeldfluss: boolean; bemerkung?: string | null; valuta: string }[]).filter((z) => z.valuta === "2026-07-01" && z.betrag !== null);
    const nach = (typ: string, betrag: string) => zeilen.find((z) => z.typ === typ && z.betrag === betrag)!;
    expect(nach("tilgung", "99995.40")).toMatchObject({ kassenwirkung: null, ohneGeldfluss: true });
    expect(nach("auszahlung", "99995.40")).toMatchObject({ kassenwirkung: null, ohneGeldfluss: true });
    expect(nach("tilgung", "4.60")).toMatchObject({ kassenwirkung: "4.60", ohneGeldfluss: false });
    const summen = j.summen as { nachTyp: { typ: string; kassenwirkung: string | null }[] };
    expect(Number(summen.nachTyp.find((x) => x.typ === "tilgung")!.kassenwirkung)).toBe(4.6);
    expect(Number(summen.nachTyp.find((x) => x.typ === "auszahlung")!.kassenwirkung)).toBe(-100000);
  });

  it("Wandlung ohne Spitzenbetrag: die einzige Tilgung ist Umbuchung, Rückflüsse bleiben 0", async () => {
    const antwort = await wandlung(basis);
    expect(antwort.status).toBe(201);
    const d = await json(await get(`/beteiligungen/${ID.wandel}?stichtag=2026-12-31`));
    expect(Number(d.kennzahlen.investiert.wert)).toBe(100000);
    expect(Number(d.kennzahlen.rueckfluesse.wert)).toBe(0);
    expect(d.kennzahlen.multiple.wert).not.toBeNull();
  });
});

describe("Cut-off: Stichtag-Schutz", () => {
  it("lehnt einen fernen Cut-off in Vorschau und Buchung ab, die Buchung auch einen Cut-off nach heute", async () => {
    for (const pfad of ["wandlung", "wandlung/vorschau"]) {
      const antwort = await post(`/beteiligungen/${ID.wandel}/${pfad}`, { ...basis, cutoff: "9999-12-31" });
      expect(antwort.status).toBe(400);
      expect((await json(antwort)).fehler.felder[0]).toMatchObject({ feld: "cutoff", code: "stichtag_ausserhalb" });
    }
    const vorFonds = await post(`/beteiligungen/${ID.wandel}/wandlung/vorschau`, { ...basis, cutoff: "2020-01-01" });
    expect(vorFonds.status).toBe(400);
    // innerhalb des Jahres in der Zukunft ist die Vorschau möglich, die Buchung nicht
    const zukunft = new Date(Date.now() + 200 * 86_400_000).toISOString().slice(0, 10);
    expect((await post(`/beteiligungen/${ID.wandel}/wandlung/vorschau`, { ...basis, cutoff: zukunft })).status).toBe(200);
    const gebucht = await post(`/beteiligungen/${ID.wandel}/wandlung`, { ...basis, cutoff: zukunft });
    expect(gebucht.status).toBe(400);
    expect((await json(gebucht)).fehler.felder[0]).toMatchObject({ feld: "cutoff", code: "stichtag_ausserhalb" });
    expect(await anzahl(db, "wandlung")).toBe(0);
  });
});

describe("POST /beteiligungen/:id/wandlung/vorschau", () => {
  it("liefert dasselbe Ergebnis mit Schritten und geplanten Vorgängen, ohne zu schreiben", async () => {
    const vorher = await anzahl(db, "vorgang");
    const antwort = await post(`/beteiligungen/${ID.wandel}/wandlung/vorschau`, basis);
    expect(antwort.status).toBe(200);
    const d = await json(antwort);
    expect(d.vorschau).toBe(true);
    expect(d.ergebnis).toMatchObject({ wandlungsbetrag: "103000", anzahlAnteile: "10300", agio: "92700" });
    expect(d.vorgaenge.map((v: { beteiligung: string; art: string; betrag: string }) => [v.beteiligung, v.art, v.betrag])).toEqual([
      ["darlehen", "zins", "3000.00"],
      ["darlehen", "tilgung", "100000.00"],
      ["ziel", "zusage", "103000.00"],
      ["ziel", "auszahlung", "103000.00"],
    ]);
    // Das Ziel ist die Beteiligung selbst; das neue Eigenkapital-Instrument entsteht erst mit der Buchung
    expect(d).toMatchObject({ zielBeteiligungId: ID.wandel, zielInstrumentId: null });
    expect(typeof d.quellInstrumentId).toBe("string");
    expect(await anzahl(db, "instrument")).toBe(3);
    expect(await anzahl(db, "vorgang")).toBe(vorher);
    expect(await anzahl(db, "wandlung")).toBe(0);
    expect(await anzahl(db, "finanzierungsrunde")).toBe(0);
    expect(await anzahl(db, "beteiligung")).toBe(3);
    expect(await auftraege(db)).toBe(0);
    expect((await post(`/beteiligungen/${ID.wandel}/wandlung/vorschau`, { ...basis, cutoff: "kaputt" })).status).toBe(400);
    expect((await post(`/beteiligungen/${ID.darlehen}/wandlung/vorschau`, basis)).status).toBe(409);
    // und danach ist die Beteiligung weiterhin gewandelt werden
    expect((await post(`/beteiligungen/${ID.wandel}/wandlung`, basis)).status).toBe(201);
    expect((await get(`/beteiligungen/${ID.wandel}/instrumentdaten`)).status).toBe(200);
  });
});
