import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { erstelleTestApp, legePersonAn, person } from "./hilfen-auth";
import { leeren, oeffneTestdb } from "./hilfen";
import { anzahl, aufrufe, grundbestand, ID, json, protokollZeilen } from "./hilfen-instrumente";

/**
 * Portfolio-Modell, Phase 2: Instrumente und Tranchen der API, Vorgänge je Instrument (mehrere Instrumente in einer Beteiligung), Eindeutigkeit
 * je Fonds und Unternehmen. Alle Daten sind erfunden.
 */

const { db, pool } = oeffneTestdb();
const { get, post, patch } = aufrufe(erstelleTestApp(db));

const betrachter = person("instrument-betrachter", { rollen: { [ID.fonds]: "betrachter" } });
const bearbeiter = person("instrument-bearbeiter", { rollen: { [ID.fonds]: "bearbeiter" } });

const vorgang = (b: string, koerper: unknown, als?: Parameters<typeof post>[2]) => post(`/beteiligungen/${b}/vorgaenge`, koerper, als);
type Zeile = Record<string, unknown> & { id: string; art: string; tranchen: unknown[] };
const instrumente = async (b: string) => (await json(await get(`/beteiligungen/${b}/instrumente`))).daten as Zeile[];
const neuesInstrument = async (b: string, koerper: object) => {
  const antwort = await post(`/beteiligungen/${b}/instrumente`, koerper);
  expect(antwort.status).toBe(201);
  return (await json(antwort)) as Zeile;
};

beforeEach(async () => {
  await grundbestand(db);
  for (const p of [betrachter, bearbeiter]) await legePersonAn(db, p);
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

describe("Instrumente einer Beteiligung", () => {
  it("legt Instrumente an, listet sie mit Zusage, Ausgezahltem, offener Zusage und offenem Kapital und führt das Hauptinstrument in der Beteiligung nach", async () => {
    // Die Beteiligung des Grundbestands hat ihr Hauptinstrument aus den Stammdaten (hier: Darlehen).
    await vorgang(ID.darlehen, { art: "zusage", valuta: "2025-01-01", betrag: "300000" });
    await vorgang(ID.darlehen, { art: "auszahlung", valuta: "2025-02-01", betrag: "100000" });
    await vorgang(ID.darlehen, { art: "tilgung", valuta: "2025-06-01", betrag: "20000" });
    const [haupt] = await instrumente(ID.darlehen);
    expect(haupt).toMatchObject({ art: "darlehen", status: "aktiv", istHauptinstrument: true, darlehensartig: true, zusage: "300000.00", ausgezahlt: "100000.00", offeneZusage: "200000.00", offenesKapital: "80000.00", tranchen: [] });

    const eigenkapital = await neuesInstrument(ID.darlehen, { art: "offene_beteiligung", bezeichnung: "Anteile Seed" });
    expect(eigenkapital).toMatchObject({ art: "offene_beteiligung", bezeichnung: "Anteile Seed", status: "aktiv", darlehensartig: false, offenesKapital: null, zusage: "0.00", runde: null });
    const liste = await instrumente(ID.darlehen);
    expect(liste.map((i) => i.art)).toEqual(["darlehen", "offene_beteiligung"]);
    // Das Hauptinstrument ist das erste aktive; die Beteiligung spiegelt es weiter (Excel, öffentliche API und Import lesen es noch).
    expect((await db.select().from(s.beteiligung).where(eq(s.beteiligung.id, ID.darlehen)))[0]!.instrument).toBe("darlehen");
    expect((await protokollZeilen(db, "instrument", "anlegen")).length).toBe(1);
    expect((await get(`/instrumente/${eigenkapital.id}`).then(json)).bezeichnung).toBe("Anteile Seed");
  });

  it("nimmt Runde und Anteilsklasse des Unternehmens, lehnt fremde ab und leitet die Bezeichnung aus Art und Runde ab", async () => {
    const [runde] = await db.insert(s.finanzierungsrunde).values({ organisationId: ID.orgB, bezeichnung: "Serie A", datum: "2025-03-01", preMoney: "1000000", postMoney: "1100000", preisJeAnteil: "10", anteileGesamtNach: "110000" }).returning();
    const [fremdeRunde] = await db.insert(s.finanzierungsrunde).values({ organisationId: ID.orgA, bezeichnung: "Seed", datum: "2024-03-01", preMoney: "1000000", postMoney: "1100000", preisJeAnteil: "10", anteileGesamtNach: "110000" }).returning();
    const [klasse] = await db.insert(s.anteilsklasse).values({ organisationId: ID.orgB, name: "Serie A" }).returning();
    const i = await neuesInstrument(ID.darlehen, { art: "offene_beteiligung", rundeId: runde!.id, anteilsklasseId: klasse!.id });
    expect(i).toMatchObject({ bezeichnung: "Offene Beteiligung Serie A", runde: { id: runde!.id, bezeichnung: "Serie A" }, anteilsklasse: { id: klasse!.id, name: "Serie A" } });

    const fremd = await post(`/beteiligungen/${ID.darlehen}/instrumente`, { art: "offene_beteiligung", rundeId: fremdeRunde!.id });
    expect(fremd.status).toBe(409);
    expect((await json(fremd)).fehler.code).toBe("RUNDE_PASST_NICHT");
    expect((await post(`/beteiligungen/${ID.darlehen}/instrumente`, { art: "offene_beteiligung", rundeId: "00000000-0000-4000-8000-0000000000ee" })).status).toBe(404);
    expect((await post(`/beteiligungen/${ID.darlehen}/instrumente`, { art: "unbekannt" })).status).toBe(400);
    expect((await post(`/beteiligungen/00000000-0000-4000-8000-0000000000ff/instrumente`, { art: "darlehen" })).status).toBe(404);
  });

  it("ändert Bezeichnung und Felder; die Art nur, solange das Instrument keine Vorgänge, Tranchen oder Konditionen hat", async () => {
    const leer = await neuesInstrument(ID.darlehen, { art: "darlehen" });
    const umgestellt = await patch(`/instrumente/${leer.id}`, { art: "venture_debt", bezeichnung: "Venture Debt 2025" });
    expect(umgestellt.status).toBe(200);
    expect(await json(umgestellt)).toMatchObject({ art: "venture_debt", bezeichnung: "Venture Debt 2025" });

    await vorgang(ID.darlehen, { art: "zusage", valuta: "2025-01-01", betrag: "1000", instrumentId: leer.id });
    const gesperrt = await patch(`/instrumente/${leer.id}`, { art: "gesellschafterdarlehen" });
    expect(gesperrt.status).toBe(409);
    expect((await json(gesperrt)).fehler.code).toBe("INSTRUMENT_ART_GESPERRT");
    expect((await patch(`/instrumente/${leer.id}`, { bezeichnung: "Umbenannt" })).status).toBe(200);
    expect((await patch(`/instrumente/${leer.id}`, {})).status).toBe(400);
    expect((await patch(`/instrumente/00000000-0000-4000-8000-0000000000ee`, { bezeichnung: "x" })).status).toBe(404);
    expect(await protokollZeilen(db, "instrument", "aendern")).toHaveLength(2);
  });

  it("Rechte: lesen als Betrachter, schreiben ab Bearbeiter", async () => {
    const i = await neuesInstrument(ID.darlehen, { art: "darlehen" });
    expect((await get(`/beteiligungen/${ID.darlehen}/instrumente`, betrachter)).status).toBe(200);
    expect((await post(`/beteiligungen/${ID.darlehen}/instrumente`, { art: "darlehen" }, betrachter)).status).toBe(403);
    expect((await patch(`/instrumente/${i.id}`, { bezeichnung: "Neu" }, betrachter)).status).toBe(403);
    expect((await post(`/instrumente/${i.id}/tranchen`, { bezeichnung: "T", betrag: "1" }, betrachter)).status).toBe(403);
    expect((await patch(`/instrumente/${i.id}`, { bezeichnung: "Neu" }, bearbeiter)).status).toBe(200);
  });
});

describe("Tranchen eines Instruments", () => {
  it("nummeriert je Instrument, prüft die Summe gegen die Zusage (TRANCHEN_UEBER_ZUSAGE) und zeigt den Stand", async () => {
    const a = await neuesInstrument(ID.darlehen, { art: "darlehen" });
    const b = await neuesInstrument(ID.darlehen, { art: "venture_debt" });
    await vorgang(ID.darlehen, { art: "zusage", valuta: "2025-01-01", betrag: "300000", instrumentId: a.id });

    const t1 = await post(`/instrumente/${a.id}/tranchen`, { bezeichnung: "Tranche 1", betrag: "100000", frist: "2025-02-01" });
    expect(t1.status).toBe(201);
    expect(await json(t1)).toMatchObject({ nummer: 1, bezeichnung: "Tranche 1", geplantAm: "2025-02-01", frist: "2025-02-01", betrag: "100000.00", zusageVorgang: null, stand: { zahlung: "zugesagt", bedingung: null, ausgezahlt: "0.00", offen: "100000.00" } });
    const t2 = await json(await post(`/instrumente/${a.id}/tranchen`, { bezeichnung: "Tranche 2", betrag: "200000", bedingung: "Umsatz über Plan" }));
    expect(t2).toMatchObject({ nummer: 2, stand: { zahlung: "zugesagt", bedingung: "offen" } });

    const zuViel = await post(`/instrumente/${a.id}/tranchen`, { bezeichnung: "Tranche 3", betrag: "0.01" });
    expect(zuViel.status).toBe(409);
    expect((await json(zuViel)).fehler).toMatchObject({ code: "TRANCHEN_UEBER_ZUSAGE", zusage: "300000.00", tranchen: "300000.00", betrag: "0.01" });
    // Ein anderes Instrument zählt für sich: Die Zusage von `a` hilft `b` nicht, die Nummer beginnt dort bei 1.
    const ohneZusage = await post(`/instrumente/${b.id}/tranchen`, { bezeichnung: "Tranche 1", betrag: "1000" });
    expect(ohneZusage.status).toBe(409);
    expect(await anzahl(db, "tranche")).toBe(2);

    const liste = (await json(await get(`/instrumente/${a.id}/tranchen`))).daten;
    expect(liste.map((t: { nummer: number }) => t.nummer)).toEqual([1, 2]);
    expect((await instrumente(ID.darlehen)).find((i) => i.id === a.id)!.tranchen).toHaveLength(2);
  });

  it("zusageErhoehen bucht die fehlende Zusage im selben Schritt, ein Fehler danach rollt sie mit zurück", async () => {
    const i = await neuesInstrument(ID.darlehen, { art: "darlehen" });
    await vorgang(ID.darlehen, { art: "zusage", valuta: "2025-01-01", betrag: "50000", instrumentId: i.id });
    const antwort = await post(`/instrumente/${i.id}/tranchen`, { bezeichnung: "Tranche 1", betrag: "80000", zusageErhoehen: true, zusageValuta: "2025-03-01" });
    expect(antwort.status).toBe(201);
    const t = await json(antwort);
    expect(t.zusageVorgang).toMatchObject({ art: "zusage", betrag: "30000.00", valuta: "2025-03-01" });
    expect((await instrumente(ID.darlehen)).find((x) => x.id === i.id)).toMatchObject({ zusage: "80000.00" });
    // Mit ausreichender Zusage bucht `zusageErhoehen` nichts.
    const nochmal = await json(await post(`/instrumente/${i.id}/tranchen`, { bezeichnung: "Tranche 2", betrag: "1", zusageErhoehen: true }));
    expect(nochmal.zusageVorgang).toMatchObject({ betrag: "1.00" });

    // Ein nicht aktives Instrument nimmt keine Zusage mehr: alles wird zurückgerollt, die Tranche entsteht nicht.
    const vorher = await anzahl(db, "tranche");
    await db.update(s.instrument).set({ status: "verkauft" }).where(eq(s.instrument.id, i.id));
    const nichtAktiv = await post(`/instrumente/${i.id}/tranchen`, { bezeichnung: "Tranche 3", betrag: "500", zusageErhoehen: true });
    expect(nichtAktiv.status).toBe(409);
    expect((await json(nichtAktiv)).fehler.code).toBe("INSTRUMENT_NICHT_AKTIV");
    expect(await anzahl(db, "tranche")).toBe(vorher);
  });

  it("ändert Tranchen (Betrag nicht unter das Ausgezahlte, nicht über die Zusage) und meldet die Bedingung als erfüllt", async () => {
    const i = await neuesInstrument(ID.darlehen, { art: "darlehen" });
    await vorgang(ID.darlehen, { art: "zusage", valuta: "2025-01-01", betrag: "100000", instrumentId: i.id });
    const t = await json(await post(`/instrumente/${i.id}/tranchen`, { bezeichnung: "Tranche 1", betrag: "60000", bedingung: "Meilenstein" }));

    expect((await vorgang(ID.darlehen, { art: "auszahlung", valuta: "2025-02-01", betrag: "10000", instrumentId: i.id, trancheId: t.id })).status).toBe(409);
    const erfuellt = await post(`/tranchen/${t.id}/erfuellt`, { datum: "2025-01-31", nachweis: "Bericht" });
    expect(erfuellt.status).toBe(200);
    expect(await json(erfuellt)).toMatchObject({ erfuelltAm: "2025-01-31", nachweis: "Bericht", stand: { bedingung: "erfuellt" } });
    expect((await post(`/tranchen/${t.id}/erfuellt`, {})).status).toBe(409);

    const gezahlt = await vorgang(ID.darlehen, { art: "auszahlung", valuta: "2025-02-01", betrag: "40000", instrumentId: i.id, trancheId: t.id });
    expect(gezahlt.status).toBe(201);
    expect((await json(gezahlt)).vorgang).toMatchObject({ trancheId: t.id, meilensteinId: t.id, instrumentId: i.id });
    const teilweise = await json(await get(`/instrumente/${i.id}/tranchen`));
    expect(teilweise.daten[0].stand).toMatchObject({ zahlung: "teilweise_gezahlt", ausgezahlt: "40000.00", offen: "20000.00" });

    const zuWenig = await patch(`/tranchen/${t.id}`, { betrag: "39999.99" });
    expect(zuWenig.status).toBe(409);
    expect((await json(zuWenig)).fehler.code).toBe("MEILENSTEIN_BETRAG_UEBERSCHRITTEN");
    const zuViel = await patch(`/tranchen/${t.id}`, { betrag: "100000.01" });
    expect(zuViel.status).toBe(409);
    expect((await json(zuViel)).fehler.code).toBe("TRANCHEN_UEBER_ZUSAGE");
    const ok = await patch(`/tranchen/${t.id}`, { betrag: "40000", bezeichnung: "Tranche 1 (gekürzt)", frist: "2025-05-01" });
    expect(ok.status).toBe(200);
    expect(await json(ok)).toMatchObject({ betrag: "40000.00", bezeichnung: "Tranche 1 (gekürzt)", geplantAm: "2025-05-01", stand: { zahlung: "gezahlt" } });
    expect((await patch(`/tranchen/00000000-0000-4000-8000-0000000000ee`, { betrag: "1" })).status).toBe(404);
    expect((await patch(`/tranchen/${t.id}`, {})).status).toBe(400);
  });

  it("die alte Meilenstein-Route legt die Tranche am Instrument an, ohne Prüfung gegen die Zusage, und bleibt bei den alten Namen", async () => {
    const antwort = await post(`/beteiligungen/${ID.wandel}/meilensteine`, { bezeichnung: "Alt", betrag: "1000", frist: "2025-09-30" });
    expect(antwort.status).toBe(201);
    const t = await json(antwort);
    expect(t).toMatchObject({ nummer: 1, frist: "2025-09-30", geplantAm: "2025-09-30" });
    expect((await db.select().from(s.tranche).where(eq(s.tranche.id, t.id)))[0]!.instrumentId).toBe((await instrumente(ID.wandel))[0]!.id);
    expect((await protokollZeilen(db, "meilenstein", "anlegen")).length).toBe(1);
  });
});

describe("Vorgänge je Instrument", () => {
  it("bucht auf ein Instrument; bei mehreren Instrumenten ist es Pflicht, eines ohne Angabe ist das einzige", async () => {
    expect((await vorgang(ID.eigen, { art: "zusage", valuta: "2025-01-01", betrag: "1000" })).status).toBe(201);
    const [einziges] = await instrumente(ID.eigen);
    const eins = await json(await vorgang(ID.eigen, { art: "rueckfluss", valuta: "2025-02-01", betrag: "10" }));
    expect(eins.vorgang.instrumentId).toBe(einziges!.id);

    const zweites = await neuesInstrument(ID.eigen, { art: "stille_beteiligung" });
    const ohne = await vorgang(ID.eigen, { art: "zusage", valuta: "2025-01-01", betrag: "1000" });
    expect(ohne.status).toBe(400);
    expect((await json(ohne)).fehler.felder[0]).toMatchObject({ feld: "instrumentId", code: "instrument_erforderlich" });
    expect((await vorgang(ID.eigen, { art: "wertberichtigung", valuta: "2025-12-31", betrag: "1" })).status).toBe(400);
    expect((await vorgang(ID.eigen, { art: "zusage", valuta: "2025-01-01", betrag: "1000", instrumentId: zweites.id })).status).toBe(201);

    const anderswoId = (await neuesInstrument(ID.darlehen, { art: "darlehen" })).id;
    const falsch = await vorgang(ID.eigen, { art: "zusage", valuta: "2025-01-01", betrag: "1", instrumentId: anderswoId });
    expect(falsch.status).toBe(409);
    expect((await json(falsch)).fehler.code).toBe("INSTRUMENT_FALSCHE_BETEILIGUNG");
    expect((await vorgang(ID.eigen, { art: "zusage", valuta: "2025-01-01", betrag: "1", instrumentId: "00000000-0000-4000-8000-0000000000ee" })).status).toBe(404);
  });

  it("Zusage, Kapitalverlauf und Berichtigung gelten je Instrument: Eigenkapital und Darlehen in einer Beteiligung", async () => {
    const eigenkapital = await neuesInstrument(ID.darlehen, { art: "offene_beteiligung" });
    const darlehen = await neuesInstrument(ID.darlehen, { art: "darlehen" });
    const venture = await neuesInstrument(ID.darlehen, { art: "venture_debt" });
    for (const [i, betrag] of [[eigenkapital.id, "100000"], [darlehen.id, "50000"], [venture.id, "80000"]] as const) {
      expect((await vorgang(ID.darlehen, { art: "zusage", valuta: "2025-01-01", betrag, instrumentId: i })).status).toBe(201);
    }
    expect((await vorgang(ID.darlehen, { art: "auszahlung", valuta: "2025-02-01", betrag: "100000", instrumentId: eigenkapital.id })).status).toBe(201);
    // Die Zusage der anderen Instrumente reicht nicht aus: höchstens 50.000 auf dem Darlehen.
    const ueber = await vorgang(ID.darlehen, { art: "auszahlung", valuta: "2025-02-01", betrag: "50000.01", instrumentId: darlehen.id });
    expect(ueber.status).toBe(409);
    expect((await json(ueber)).fehler).toMatchObject({ code: "AUSZAHLUNG_UEBER_ZUSAGE", zusage: "50000.00", investiert: "50000.01" });
    expect((await vorgang(ID.darlehen, { art: "auszahlung", valuta: "2025-02-01", betrag: "50000", instrumentId: darlehen.id })).status).toBe(201);
    expect((await vorgang(ID.darlehen, { art: "auszahlung", valuta: "2025-02-01", betrag: "30000", instrumentId: venture.id })).status).toBe(201);

    // Tilgung höchstens in Höhe des offenen Kapitals des Instruments (nicht der Beteiligung: dort wären 180.000 offen).
    const tilgung = await vorgang(ID.darlehen, { art: "tilgung", valuta: "2025-06-01", betrag: "30000.01", instrumentId: venture.id });
    expect(tilgung.status).toBe(409);
    expect((await json(tilgung)).fehler.code).toBe("KAPITALVERLAUF_UNGUELTIG");
    expect((await vorgang(ID.darlehen, { art: "tilgung", valuta: "2025-06-01", betrag: "30000", instrumentId: venture.id })).status).toBe(201);
    const aufEigenkapital = await vorgang(ID.darlehen, { art: "tilgung", valuta: "2025-06-01", betrag: "1", instrumentId: eigenkapital.id });
    expect(aufEigenkapital.status).toBe(409);
    expect((await json(aufEigenkapital)).fehler.code).toBe("INSTRUMENT_PASST_NICHT");

    // Auflösung höchstens bis zur Berichtigung des Instruments: Die Berichtigung des Eigenkapitals hilft dem Darlehen nicht.
    expect((await vorgang(ID.darlehen, { art: "wertberichtigung", valuta: "2025-12-31", betrag: "40000", instrumentId: eigenkapital.id })).status).toBe(201);
    const aufloesung = await vorgang(ID.darlehen, { art: "wertberichtigung", valuta: "2026-03-31", betrag: "-1", instrumentId: darlehen.id });
    expect(aufloesung.status).toBe(409);
    expect((await json(aufloesung)).fehler.code).toBe("AUFLOESUNG_UEBER_BERICHTIGUNG");
    const liste = await instrumente(ID.darlehen);
    expect(liste.find((i) => i.id === venture.id)).toMatchObject({ ausgezahlt: "30000.00", offenesKapital: "0.00" });
    expect(liste.find((i) => i.id === eigenkapital.id)).toMatchObject({ wertberichtigungen: "40000.00", buchwert: "60000.00" });
  });

  it("Storno prüft die Invarianten je Instrument", async () => {
    const a = await neuesInstrument(ID.darlehen, { art: "darlehen" });
    const b = await neuesInstrument(ID.darlehen, { art: "darlehen" });
    await vorgang(ID.darlehen, { art: "zusage", valuta: "2025-01-01", betrag: "200000", instrumentId: a.id });
    await vorgang(ID.darlehen, { art: "zusage", valuta: "2025-01-01", betrag: "200000", instrumentId: b.id });
    const auszahlungA = await json(await vorgang(ID.darlehen, { art: "auszahlung", valuta: "2025-02-01", betrag: "100000", instrumentId: a.id }));
    await vorgang(ID.darlehen, { art: "auszahlung", valuta: "2025-02-01", betrag: "100000", instrumentId: b.id });
    await vorgang(ID.darlehen, { art: "tilgung", valuta: "2025-06-01", betrag: "60000", instrumentId: a.id });
    // Die Auszahlung von A lässt sich nicht stornieren, weil A sonst negatives Kapital hätte, obwohl B genug hat.
    const storno = await post(`/vorgaenge/${auszahlungA.vorgang.id}/storno`, { grund: "Test" });
    expect(storno.status).toBe(409);
    expect((await json(storno)).fehler.code).toBe("KAPITALVERLAUF_UNGUELTIG");
  });

  it("Zinszahlung nur auf darlehensartigen Instrumenten, Dividende nur auf Eigenkapital; beglichene Zinsbuchung muss zum Instrument passen", async () => {
    const eigenkapital = await neuesInstrument(ID.darlehen, { art: "offene_beteiligung" });
    const darlehen = await neuesInstrument(ID.darlehen, { art: "gesellschafterdarlehen" });
    const anderes = await neuesInstrument(ID.darlehen, { art: "darlehen" });
    const zinsbuchung = async (i: string, betrag = "500.00") =>
      (await db.insert(s.vorgang).values({ beteiligungId: ID.darlehen, instrumentId: i, art: "zins", valuta: "2025-12-31", betrag }).returning())[0]!;
    const zins = await zinsbuchung(darlehen.id);

    const gezahlt = await vorgang(ID.darlehen, { art: "zinszahlung", valuta: "2026-01-15", betrag: "500", instrumentId: darlehen.id, beglichenVorgangId: zins.id });
    expect(gezahlt.status).toBe(201);
    const zahlung = (await json(gezahlt)).vorgang;
    expect(zahlung).toMatchObject({ art: "zinszahlung", beglichenVorgangId: zins.id, instrumentId: darlehen.id });
    // ohne Verweis ist die Zinszahlung ebenfalls zulässig
    expect((await vorgang(ID.darlehen, { art: "zinszahlung", valuta: "2026-01-16", betrag: "5", instrumentId: darlehen.id })).status).toBe(201);

    const auf = await vorgang(ID.darlehen, { art: "zinszahlung", valuta: "2026-01-15", betrag: "1", instrumentId: eigenkapital.id });
    expect(auf.status).toBe(409);
    expect((await json(auf)).fehler.code).toBe("INSTRUMENT_PASST_NICHT");
    const fremdeBuchung = await vorgang(ID.darlehen, { art: "zinszahlung", valuta: "2026-01-15", betrag: "1", instrumentId: anderes.id, beglichenVorgangId: zins.id });
    expect(fremdeBuchung.status).toBe(409);
    expect((await json(fremdeBuchung)).fehler).toMatchObject({ code: "ZINSZAHLUNG_BEZUG_UNGUELTIG", grund: "anderes_instrument" });
    const keinZins = await vorgang(ID.darlehen, { art: "zinszahlung", valuta: "2026-01-15", betrag: "1", instrumentId: darlehen.id, beglichenVorgangId: zahlung.id });
    expect((await json(keinZins)).fehler).toMatchObject({ code: "ZINSZAHLUNG_BEZUG_UNGUELTIG", grund: "keine_zinsbuchung" });
    expect((await vorgang(ID.darlehen, { art: "zinszahlung", valuta: "2026-01-15", betrag: "1", instrumentId: darlehen.id, beglichenVorgangId: "00000000-0000-4000-8000-0000000000ee" })).status).toBe(409);

    expect((await vorgang(ID.darlehen, { art: "dividende", valuta: "2026-04-01", betrag: "2500", instrumentId: eigenkapital.id })).status).toBe(201);
    const aufDarlehen = await vorgang(ID.darlehen, { art: "dividende", valuta: "2026-04-01", betrag: "1", instrumentId: darlehen.id });
    expect(aufDarlehen.status).toBe(409);
    expect((await json(aufDarlehen)).fehler.code).toBe("INSTRUMENT_PASST_NICHT");
    // Ein stornierter Zins taugt nicht als Bezug.
    const stornierter = await zinsbuchung(darlehen.id, "10.00");
    expect((await post(`/vorgaenge/${stornierter.id}/storno`, { grund: "Fehler" })).status).toBe(201);
    const nachStorno = await vorgang(ID.darlehen, { art: "zinszahlung", valuta: "2026-01-15", betrag: "1", instrumentId: darlehen.id, beglichenVorgangId: stornierter.id });
    expect((await json(nachStorno)).fehler).toMatchObject({ code: "ZINSZAHLUNG_BEZUG_UNGUELTIG", grund: "storniert" });
    expect(await anzahl(db, "vorgang", "art = 'dividende'")).toBe(1);
  });

  it("eine Tranche eines anderen Instruments wird abgelehnt; ohne Instrument gilt das der Tranche", async () => {
    const a = await neuesInstrument(ID.darlehen, { art: "darlehen" });
    const b = await neuesInstrument(ID.darlehen, { art: "venture_debt" });
    for (const i of [a, b]) await vorgang(ID.darlehen, { art: "zusage", valuta: "2025-01-01", betrag: "10000", instrumentId: i.id });
    const tranche = await json(await post(`/instrumente/${a.id}/tranchen`, { bezeichnung: "T1", betrag: "5000" }));
    const falsch = await vorgang(ID.darlehen, { art: "auszahlung", valuta: "2025-02-01", betrag: "1000", instrumentId: b.id, trancheId: tranche.id });
    expect(falsch.status).toBe(409);
    expect((await json(falsch)).fehler.code).toBe("TRANCHE_FALSCHES_INSTRUMENT");
    const abgeleitet = await vorgang(ID.darlehen, { art: "auszahlung", valuta: "2025-02-01", betrag: "1000", trancheId: tranche.id });
    expect(abgeleitet.status).toBe(201);
    expect((await json(abgeleitet)).vorgang.instrumentId).toBe(a.id);
    // Mit dem alten Namen `meilensteinId` ebenso
    expect((await vorgang(ID.darlehen, { art: "auszahlung", valuta: "2025-02-02", betrag: "1000", meilensteinId: tranche.id })).status).toBe(201);
    const [t] = await db.select().from(s.tranche).where(and(eq(s.tranche.id, tranche.id)));
    expect(t!.instrumentId).toBe(a.id);
  });

  it("POST /fonds/:id/buchungen übernimmt Instrument, Tranche, Zinszahlung und Dividende", async () => {
    const eigenkapital = await neuesInstrument(ID.darlehen, { art: "offene_beteiligung" });
    const darlehen = await neuesInstrument(ID.darlehen, { art: "darlehen" });
    const buchen = (koerper: object) => post(`/fonds/${ID.fonds}/buchungen`, koerper);
    const zusage = await buchen({ typ: "zusage", beteiligungId: ID.darlehen, valuta: "2025-01-01", betrag: "10000", instrumentId: darlehen.id });
    expect(zusage.status).toBe(201);
    expect((await json(zusage)).vorgang.instrumentId).toBe(darlehen.id);
    const ohne = await buchen({ typ: "zusage", beteiligungId: ID.darlehen, valuta: "2025-01-01", betrag: "10000" });
    expect(ohne.status).toBe(400);
    expect((await buchen({ typ: "zinszahlung", beteiligungId: ID.darlehen, valuta: "2025-07-01", betrag: "100", instrumentId: darlehen.id })).status).toBe(201);
    expect((await buchen({ typ: "dividende", beteiligungId: ID.darlehen, valuta: "2025-07-01", betrag: "100", instrumentId: eigenkapital.id })).status).toBe(201);
    expect((await buchen({ typ: "dividende", beteiligungId: ID.darlehen, valuta: "2025-07-01", betrag: "100", instrumentId: darlehen.id })).status).toBe(409);
  });
});

describe("Eindeutigkeit je Fonds und Unternehmen", () => {
  it("lässt je Fonds und Unternehmen nur eine Beteiligung zu; weitere Instrumente hängen an ihr", async () => {
    await expect(db.insert(s.beteiligung).values({ fondsId: ID.fonds, organisationId: ID.orgA, instrument: "darlehen", erstinvestment: "2025-01-01" })).rejects.toThrow();
    // anderer Fonds oder anderes Unternehmen geht
    await db.insert(s.beteiligung).values({ fondsId: ID.anderer, organisationId: ID.orgA, instrument: "darlehen", erstinvestment: "2025-01-01" });
    // Konditionen sind je Instrument und Datum eindeutig, nicht je Beteiligung: zwei Darlehen mit gleichem Gültigkeitsdatum
    const a = await neuesInstrument(ID.darlehen, { art: "darlehen" });
    const b = await neuesInstrument(ID.darlehen, { art: "venture_debt" });
    const kondition = { gueltigAb: "2025-01-01", satzFix: "0.06", methode: "30E/360", zinsperiode: "jaehrlich", anker: "2026-01-01" };
    expect((await post(`/beteiligungen/${ID.darlehen}/konditionen`, { ...kondition, instrumentId: a.id })).status).toBe(201);
    expect((await post(`/beteiligungen/${ID.darlehen}/konditionen`, { ...kondition, instrumentId: b.id, satzFix: "0.08" })).status).toBe(201);
    const doppelt = await post(`/beteiligungen/${ID.darlehen}/konditionen`, { ...kondition, instrumentId: a.id });
    expect(doppelt.status).toBe(409);
    expect((await json(doppelt)).fehler.code).toBe("KONDITION_VORHANDEN");
    // ohne Instrument bei zwei darlehensartigen: Pflicht
    expect((await post(`/beteiligungen/${ID.darlehen}/konditionen`, { ...kondition, gueltigAb: "2026-01-01" })).status).toBe(400);
    expect((await post(`/beteiligungen/${ID.darlehen}/konditionen`, { ...kondition, gueltigAb: "2026-01-01", instrumentId: (await neuesInstrument(ID.darlehen, { art: "offene_beteiligung" })).id })).status).toBe(409);
  });
});

describe("Zinslauf je Instrument", () => {
  const kondition = (satz: string, instrumentId: string) => ({ gueltigAb: "2025-01-01", satzFix: satz, methode: "30E/360", zinsperiode: "jaehrlich", anker: "2026-01-01", instrumentId });

  it("zwei Darlehen in einer Beteiligung werden unabhängig berechnet und gebucht, ein Storno gibt nur die Periode seines Instruments frei", async () => {
    // Das Wandeldarlehen des Grundbestands (ohne Konditionen) soll den Lauf nicht stören.
    await db.update(s.beteiligung).set({ status: "exit" }).where(eq(s.beteiligung.id, ID.wandel));
    const eins = (await instrumente(ID.darlehen))[0]!;
    const zwei = await neuesInstrument(ID.darlehen, { art: "venture_debt" });
    for (const [i, betrag] of [[eins.id, "100000"], [zwei.id, "50000"]] as const) {
      await vorgang(ID.darlehen, { art: "zusage", valuta: "2025-01-01", betrag, instrumentId: i });
      await vorgang(ID.darlehen, { art: "auszahlung", valuta: "2025-01-01", betrag, instrumentId: i });
    }
    expect((await post(`/beteiligungen/${ID.darlehen}/konditionen`, kondition("0.06", eins.id))).status).toBe(201);
    expect((await post(`/beteiligungen/${ID.darlehen}/konditionen`, kondition("0.08", zwei.id))).status).toBe(201);

    const lauf = await json(await post("/zinslaeufe", { fondsId: ID.fonds, stichtag: "2026-01-01" }, "rechner"));
    expect(lauf.positionen.map((p: { instrumentId: string; betragGebucht: string }) => [p.instrumentId, p.betragGebucht]).sort()).toEqual([[eins.id, "6000.00"], [zwei.id, "4000.00"]].sort());
    expect(lauf.hinweise.ohneKonditionen).toEqual([]);
    expect(lauf.summe).toEqual({ anzahl: 2, gebucht: "10000.00" });
    expect((await post(`/zinslaeufe/${lauf.id}/pruefen`, {}, "a")).status).toBe(200);
    expect((await post(`/zinslaeufe/${lauf.id}/freigeben`, {}, "b")).status).toBe(200);
    expect((await post(`/zinslaeufe/${lauf.id}/buchen`, {}, "c")).status).toBe(200);

    const zinsen = await db.select().from(s.vorgang).where(eq(s.vorgang.art, "zins"));
    expect(zinsen.map((z) => [z.instrumentId, z.betrag]).sort()).toEqual([[eins.id, "6000.00"], [zwei.id, "4000.00"]].sort());
    expect(await anzahl(db, "zinsperiode_gebucht")).toBe(2);
    const kontrolle = await json(await get(`/zinslaeufe/${lauf.id}/kontrolle`));
    expect(kontrolle.gesamt).toBe("ok");
    // Nichts mehr zu berechnen
    expect((await json(await post("/zinslaeufe", { fondsId: ID.fonds, stichtag: "2026-01-01" }, "rechner"))).positionen).toEqual([]);

    // Storno der Zinsbuchung des zweiten Darlehens: nur dessen Periode wird wieder berechnet
    const storno = await post(`/vorgaenge/${zinsen.find((z) => z.instrumentId === zwei.id)!.id}/storno`, { grund: "Satz falsch" });
    expect(storno.status).toBe(201);
    const neu = await json(await post("/zinslaeufe", { fondsId: ID.fonds, stichtag: "2026-01-01" }, "rechner"));
    expect(neu.positionen.map((p: { instrumentId: string; betragGebucht: string }) => [p.instrumentId, p.betragGebucht])).toEqual([[zwei.id, "4000.00"]]);
    const liste = await instrumente(ID.darlehen);
    expect(liste.find((i) => i.id === eins.id)).toMatchObject({ zinsen: "6000.00" });
    expect(liste.find((i) => i.id === zwei.id)).toMatchObject({ zinsen: "0.00" });
  });

  it("ein nicht aktives Instrument nimmt am Zinslauf nicht teil, die Beteiligung bleibt aktiv", async () => {
    const eins = (await instrumente(ID.darlehen))[0]!;
    const zwei = await neuesInstrument(ID.darlehen, { art: "darlehen" });
    for (const i of [eins.id, zwei.id]) {
      await vorgang(ID.darlehen, { art: "zusage", valuta: "2025-01-01", betrag: "100000", instrumentId: i });
      await vorgang(ID.darlehen, { art: "auszahlung", valuta: "2025-01-01", betrag: "100000", instrumentId: i });
      await post(`/beteiligungen/${ID.darlehen}/konditionen`, kondition("0.06", i));
    }
    await db.update(s.instrument).set({ status: "getilgt" }).where(eq(s.instrument.id, eins.id));
    const lauf = await json(await post("/zinslaeufe", { fondsId: ID.fonds, stichtag: "2026-01-01" }, "rechner"));
    expect(lauf.positionen.map((p: { instrumentId: string }) => p.instrumentId)).toEqual([zwei.id]);
  });
});

describe("Verkauf und Insolvenz je Instrument", () => {
  const verkauf = { datum: "2026-06-30", kaufpreis: "70000", anteilVerkauft: 1 };

  async function aufsetzen() {
    const eigenkapital = await neuesInstrument(ID.eigen, { art: "stille_beteiligung", bezeichnung: "Stille Beteiligung" });
    const haupt = (await instrumente(ID.eigen))[0]!;
    for (const [i, betrag] of [[haupt.id, "100000"], [eigenkapital.id, "50000"]] as const) {
      await vorgang(ID.eigen, { art: "zusage", valuta: "2025-01-01", betrag, instrumentId: i });
      await vorgang(ID.eigen, { art: "auszahlung", valuta: "2025-02-01", betrag, instrumentId: i });
    }
    return { haupt, zweites: eigenkapital };
  }

  it("der Verkauf der ganzen Beteiligung setzt alle aktiven Instrumente auf verkauft und die Beteiligung auf Exit; das Storno stellt sie wieder her", async () => {
    const { haupt, zweites } = await aufsetzen();
    const antwort = await post(`/beteiligungen/${ID.eigen}/verkauf`, { ...verkauf, kaufpreis: "200000" }, bearbeiter);
    expect(antwort.status).toBe(201);
    const d = await json(antwort);
    expect(d.status).toBe("exit");
    expect(d.ergebnis).toMatchObject({ buchwertVorher: "150000.00", ergebnis: "50000.00" });
    expect((await db.select().from(s.instrument).where(eq(s.instrument.beteiligungId, ID.eigen))).map((i) => i.status)).toEqual(["verkauft", "verkauft"]);
    expect(d.verkauf.instrumentId).toBeNull();
    const storno = await post(`/verkaeufe/${d.verkauf.id}/storno`, { grund: "Rückabwicklung" }, bearbeiter);
    expect(storno.status).toBe(201);
    expect((await db.select().from(s.instrument).where(eq(s.instrument.beteiligungId, ID.eigen))).map((i) => i.status)).toEqual(["aktiv", "aktiv"]);
    expect(haupt.id).not.toBe(zweites.id);
  });

  it("der Verkauf eines gewählten Instruments lässt die übrigen aktiv; erst der Verkauf des letzten beendet die Beteiligung; ein Storno holt nur dessen Instrument zurück", async () => {
    const { haupt, zweites } = await aufsetzen();
    const erster = await json(await post(`/beteiligungen/${ID.eigen}/verkauf`, { ...verkauf, kaufpreis: "70000", instrumentId: zweites.id }, bearbeiter));
    expect(erster.ergebnis).toMatchObject({ buchwertVorher: "50000.00", buchwertAbgang: "50000.00", ergebnis: "20000.00" });
    expect(erster.status).toBe("aktiv");
    expect(erster.verkauf.instrumentId).toBe(zweites.id);
    const nachErstem = await db.select().from(s.instrument).where(eq(s.instrument.beteiligungId, ID.eigen));
    expect(nachErstem.find((i) => i.id === zweites.id)!.status).toBe("verkauft");
    expect(nachErstem.find((i) => i.id === haupt.id)!.status).toBe("aktiv");
    // Das verkaufte Instrument nimmt keinen Verkauf mehr an
    const nochmal = await post(`/beteiligungen/${ID.eigen}/verkauf`, { ...verkauf, instrumentId: zweites.id }, bearbeiter);
    expect((await json(nochmal)).fehler.code).toBe("INSTRUMENT_NICHT_AKTIV");
    const zweiter = await json(await post(`/beteiligungen/${ID.eigen}/verkauf`, { ...verkauf, datum: "2026-12-31", kaufpreis: "130000", instrumentId: haupt.id }, bearbeiter));
    expect(zweiter.status).toBe("exit");
    expect((await db.select().from(s.instrument).where(eq(s.instrument.beteiligungId, ID.eigen))).every((i) => i.status === "verkauft")).toBe(true);
    // Storno des zweiten (zuerst): nur das Hauptinstrument wird wieder aktiv, das früher verkaufte bleibt verkauft
    expect((await post(`/verkaeufe/${zweiter.verkauf.id}/storno`, { grund: "x" }, bearbeiter)).status).toBe(201);
    const danach = await db.select().from(s.instrument).where(eq(s.instrument.beteiligungId, ID.eigen));
    expect(danach.find((i) => i.id === haupt.id)!.status).toBe("aktiv");
    expect(danach.find((i) => i.id === zweites.id)!.status).toBe("verkauft");
    expect((await db.select().from(s.beteiligung).where(eq(s.beteiligung.id, ID.eigen)))[0]!.status).toBe("aktiv");
  });

  it("Verkäuferdarlehen an das verkaufte Unternehmen selbst: ein Darlehen-Instrument in derselben Beteiligung, die aktiv bleibt", async () => {
    await aufsetzen();
    const d = await json(
      await post(`/beteiligungen/${ID.eigen}/verkauf`, { ...verkauf, kaufpreis: "200000", verkaeuferdarlehen: { betrag: "30000", satz: "0.05", methode: "act/365", faelligAm: "2028-06-30" } }, bearbeiter),
    );
    expect(d.verkaeuferdarlehenBeteiligungId).toBe(ID.eigen);
    const darlehen = (await db.select().from(s.instrument).where(eq(s.instrument.id, d.verkaeuferdarlehenInstrumentId)))[0]!;
    expect(darlehen).toMatchObject({ art: "darlehen", status: "aktiv", beteiligungId: ID.eigen });
    expect(d.status).toBe("aktiv");
    expect((await db.select().from(s.instrument).where(eq(s.instrument.beteiligungId, ID.eigen))).filter((i) => i.status === "verkauft")).toHaveLength(2);
    const [kondition] = await db.select().from(s.darlehenKondition).where(eq(s.darlehenKondition.instrumentId, darlehen.id));
    expect(kondition).toMatchObject({ zinsperiode: "endfaellig", faelligAm: "2028-06-30" });
    // Eine Bewertung am Verkaufstag: der Rest der Beteiligung (null) plus das Verkäuferdarlehen
    expect((await db.select().from(s.bewertung).where(and(eq(s.bewertung.beteiligungId, ID.eigen), eq(s.bewertung.stichtag, "2026-06-30"))))[0]!.wert).toBe("30000.00");
    // Storno: das Darlehen entfällt (abgeschrieben), die übrigen Instrumente sind wieder aktiv
    expect((await post(`/verkaeufe/${d.verkauf.id}/storno`, { grund: "Rückabwicklung" }, bearbeiter)).status).toBe(201);
    const nachher = await db.select().from(s.instrument).where(eq(s.instrument.beteiligungId, ID.eigen));
    expect(nachher.find((i) => i.id === darlehen.id)!.status).toBe("abgeschrieben");
    expect(nachher.filter((i) => i.status === "aktiv")).toHaveLength(2);
  });

  it("Insolvenz setzt die aktiven Instrumente auf abgeschrieben und berichtigt je Instrument auf null", async () => {
    const { haupt, zweites } = await aufsetzen();
    const antwort = await post(`/beteiligungen/${ID.eigen}/insolvenz`, { datum: "2026-03-15", wertberichtigungAufNull: true }, bearbeiter);
    expect(antwort.status).toBe(200);
    const d = await json(antwort);
    expect(d.beteiligung.status).toBe("insolvent");
    expect(d.wertberichtigungen.map((w: { instrumentId: string; betrag: string }) => [w.instrumentId, w.betrag]).sort()).toEqual([[haupt.id, "100000.00"], [zweites.id, "50000.00"]].sort());
    expect((await db.select().from(s.instrument).where(eq(s.instrument.beteiligungId, ID.eigen))).map((i) => i.status)).toEqual(["abgeschrieben", "abgeschrieben"]);
    expect((await instrumente(ID.eigen)).map((i) => i.buchwert)).toEqual(["0.00", "0.00"]);
  });
});
