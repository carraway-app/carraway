import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { erstelleTestApp } from "./hilfen-auth";
import { leeren, oeffneTestdb } from "./hilfen";
import { anzahl, aufrufe, grundbestand, ID, json, leereAuftraege } from "./hilfen-instrumente";

/**
 * Wandlung mit vertraglich abweichenden Beträgen (Entscheidung 508): Preis 10,00 je Anteil (12,50 mit 20 % Abschlag), Darlehen 100.000,
 * Zinsen bis zum Cut-off 3.000. Der nicht gewandelte Rest wird zurückgezahlt (Geldfluss) oder erlassen (Verzicht, ohne Geldfluss).
 */

const { db, pool } = oeffneTestdb();
const { get, post } = aufrufe(erstelleTestApp(db));

const KONDITION = { gueltigAb: "2026-01-01", satzFix: "0.06", methode: "30E/360", zinsperiode: "jaehrlich", anker: "2027-01-01" };
const RUNDE_NEU = { bezeichnung: "Serie A", preMoney: "8000000", postMoney: "10000000", preisJeAnteil: "12.5", anteileGesamtNach: "800000" };
const basis = { cutoff: "2026-07-01", zinsenWandeln: true, preisregel: { rundenpreisJeAnteil: "12.5", discount: "0.2" }, nennwertJeAnteil: "1", runde: { neu: RUNDE_NEU } };
const wandle = (koerper: object) => post(`/beteiligungen/${ID.wandel}/wandlung`, koerper, "bearbeiter");
const vorschau = (koerper: object) => post(`/beteiligungen/${ID.wandel}/wandlung/vorschau`, koerper, "bearbeiter");

const vorgaengeVon = async (instrumentId: string) => db.select().from(s.vorgang).where(eq(s.vorgang.instrumentId, instrumentId));
const betraege = (zeilen: { art: string; betrag: string }[], art: string) => zeilen.filter((v) => v.art === art).map((v) => Number(v.betrag)).sort((a, b) => a - b);

beforeEach(async () => {
  await grundbestand(db);
  const b = ID.wandel;
  await post(`/investments/${b}/transactions`, { type: "commitment", valueDate: "2026-01-01", amount: "200000" });
  await post(`/investments/${b}/transactions`, { type: "disbursement", valueDate: "2026-01-01", amount: "100000" });
  await post(`/beteiligungen/${b}/konditionen`, KONDITION);
  await leereAuftraege(db);
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

describe("Wandlung mit abweichenden Beträgen", () => {
  it("Rest zurückgezahlt: Anteile nur aus dem gewandelten Betrag, Rückzahlung und Zinszahlung sind Rückfluss", async () => {
    const antwort = await wandle({ ...basis, gewandeltesDarlehen: "90000", gewandelteZinsen: "2000", darlehenRest: "zurueckgezahlt", zinsenRest: "zurueckgezahlt" });
    expect(antwort.status).toBe(201);
    const d = await json(antwort);
    expect(d.ergebnis).toMatchObject({ restkapital: "100000", zinsenGebucht: "3000", darlehenGewandelt: "90000", zinsenGewandelt: "2000", darlehenRest: "10000", zinsenRest: "1000", wandlungsbetrag: "92000", anzahlAnteile: "9200", restbehandlung: { darlehen: "zurueckgezahlt", zinsen: "zurueckgezahlt" } });
    expect(d.wandlung).toMatchObject({ wandlungsbetrag: "92000.00", anzahlAnteile: "9200", spitzenbetrag: "0.00", zinsenGebucht: "3000.00" });

    const quelle = await vorgaengeVon(d.quellInstrumentId);
    expect(betraege(quelle, "zins")).toEqual([1000, 2000]);
    expect(betraege(quelle, "zinszahlung")).toEqual([1000]);
    expect(betraege(quelle, "tilgung")).toEqual([10000, 90000]);
    // Die Zinszahlung begleicht die Zinsbuchung des Rests
    const zinsrest = quelle.find((v) => v.art === "zins" && Number(v.betrag) === 1000)!;
    expect(quelle.find((v) => v.art === "zinszahlung")!.beglichenVorgangId).toBe(zinsrest.id);
    // Das Ziel nimmt nur den gewandelten Betrag auf
    const ziel = await vorgaengeVon(d.zielInstrumentId);
    expect(betraege(ziel, "zusage")).toEqual([92000]);
    expect(betraege(ziel, "auszahlung")).toEqual([92000]);
    const [position] = await db.select().from(s.rundenposition);
    expect(position).toMatchObject({ betrag: "92000.00", anteile: "9200" });
    expect((await db.select().from(s.bewertung))[0]).toMatchObject({ wert: "92000.00" });

    // Kennzahlen: Rückfluss = Rückzahlung 10.000 + Zinszahlung 1.000; die Wandlung selbst ist kein Geld
    const b = await json(await get(`/beteiligungen/${ID.wandel}?stichtag=2026-12-31`));
    expect(Number(b.kennzahlen.investiert.wert)).toBe(100000);
    expect(Number(b.kennzahlen.rueckfluesse.wert)).toBe(11000);
    const marke = (b.vorgaenge as { art: string; betrag: string; ohneGeldfluss: boolean }[]).filter((v) => v.ohneGeldfluss).map((v) => `${v.art}:${v.betrag}`).sort();
    expect(marke).toEqual(["auszahlung:92000.00", "tilgung:90000.00", "zusage:92000.00"]);

    // Zinsansicht: 2.000 gewandelt, 1.000 gezahlt, nichts offen
    const z = await json(await get(`/beteiligungen/${ID.wandel}/zinsen?stichtag=2026-12-31`));
    expect(z.summe).toMatchObject({ gebucht: "3000.00", gewandelt: "2000.00", gezahlt: "1000.00", offen: "0.00" });
    const inst = await json(await get(`/beteiligungen/${ID.wandel}/instrumentdaten?stichtag=2026-12-31`));
    expect(inst.instrumente.find((i: { art: string }) => i.art === "wandeldarlehen")).toMatchObject({ offenesKapital: "0.00", gewandelteZinsen: "2000.00", offeneZinsen: "0.00" });
  });

  it("Rest erlassen: ohne Geldfluss, als Verzicht gekennzeichnet, kein Rückfluss; erlassene Zinsen werden nie Forderung", async () => {
    const antwort = await wandle({ ...basis, gewandeltesDarlehen: "95000", gewandelteZinsen: "0", darlehenRest: "erlassen", zinsenRest: "erlassen" });
    expect(antwort.status).toBe(201);
    const d = await json(antwort);
    expect(d.ergebnis).toMatchObject({ darlehenRest: "5000", zinsenRest: "3000", wandlungsbetrag: "95000", anzahlAnteile: "9500", restbehandlung: { darlehen: "erlassen", zinsen: "erlassen" } });
    const quelle = await vorgaengeVon(d.quellInstrumentId);
    expect(betraege(quelle, "zins")).toEqual([]);
    expect(betraege(quelle, "tilgung")).toEqual([5000, 95000]);
    expect(quelle.find((v) => Number(v.betrag) === 5000)!.bemerkung).toBe("Wandlung: nicht gewandeltes Darlehen erlassen (Verzicht, ohne Geldfluss)");

    const b = await json(await get(`/beteiligungen/${ID.wandel}?stichtag=2026-12-31`));
    expect(Number(b.kennzahlen.investiert.wert)).toBe(100000);
    expect(Number(b.kennzahlen.rueckfluesse.wert)).toBe(0);
    const marke = (b.vorgaenge as { art: string; betrag: string; ohneGeldfluss: boolean }[]).filter((v) => v.ohneGeldfluss).map((v) => `${v.art}:${v.betrag}`).sort();
    expect(marke).toEqual(["auszahlung:95000.00", "tilgung:5000.00", "tilgung:95000.00", "zusage:95000.00"]);
    // Das Darlehen geht auf null, ohne dass Zinsen offen bleiben
    const inst = await json(await get(`/beteiligungen/${ID.wandel}/instrumentdaten?stichtag=2026-12-31`));
    expect(inst.instrumente.find((i: { art: string }) => i.art === "wandeldarlehen")).toMatchObject({ offenesKapital: "0.00", offeneZinsen: "0.00" });
    expect((await json(await get(`/beteiligungen/${ID.wandel}/zinsen?stichtag=2026-12-31`))).summe).toMatchObject({ gebucht: "0.00", offen: "0.00" });
  });

  it("Spitzenbetrag aus dem gewandelten Betrag bleibt bar; der Rest kommt dazu (Zinsen werden nicht gewandelt)", async () => {
    // 50.003 ÷ 10 = 5.000 Anteile, Spitzenbetrag 3; Rest des Darlehens 49.997 zurückgezahlt; Zinsen 3.000 bleiben offen
    const antwort = await wandle({ ...basis, zinsenWandeln: false, gewandeltesDarlehen: "50003" });
    expect(antwort.status).toBe(201);
    const d = await json(antwort);
    expect(d.wandlung).toMatchObject({ spitzenbetrag: "3.00", wandlungsbetrag: "50003.00", anzahlAnteile: "5000" });
    expect(d.ergebnis.restbehandlung).toEqual({ darlehen: "zurueckgezahlt", zinsen: null });
    const quelle = await vorgaengeVon(d.quellInstrumentId);
    expect(betraege(quelle, "tilgung")).toEqual([3, 49997, 50000]);
    const ziel = await vorgaengeVon(d.zielInstrumentId);
    expect(betraege(ziel, "zusage")).toEqual([50000]);
    const b = await json(await get(`/beteiligungen/${ID.wandel}?stichtag=2026-12-31`));
    expect(Number(b.kennzahlen.rueckfluesse.wert)).toBe(50000);
    expect((await json(await get(`/beteiligungen/${ID.wandel}/zinsen?stichtag=2026-12-31`))).summe).toMatchObject({ gebucht: "3000.00", offen: "3000.00" });
  });

  it("ohne Angabe bleibt alles wie errechnet", async () => {
    const d = await json(await wandle(basis));
    expect(d.ergebnis).toMatchObject({ darlehenRest: "0", zinsenRest: "0", restbehandlung: { darlehen: null, zinsen: null } });
    expect(betraege(await vorgaengeVon(d.quellInstrumentId), "tilgung")).toEqual([100000]);
  });

  it("Vorschau nennt Beträge und Vorgänge, schreibt nichts", async () => {
    const antwort = await vorschau({ ...basis, gewandeltesDarlehen: "90000", darlehenRest: "erlassen" });
    expect(antwort.status).toBe(200);
    const d = await json(antwort);
    expect(d.ergebnis).toMatchObject({ darlehenGewandelt: "90000", zinsenGewandelt: "3000", darlehenRest: "10000", wandlungsbetrag: "93000" });
    expect((d.vorgaenge as { art: string; betrag: string; schluessel?: string }[]).filter((v) => v.schluessel === "erlass").map((v) => v.betrag)).toEqual(["10000.00"]);
    expect(await anzahl(db, "wandlung")).toBe(0);
    expect(await anzahl(db, "vorgang", "art = 'zins'")).toBe(0);
  });

  it("lehnt Beträge über dem Stand, Zinsen ohne Zinswandlung, nichts Gewandeltes und ein Darlehen unter dem Spitzenbetrag ab; es entsteht nichts", async () => {
    const fehler = async (koerper: object) => {
      const antwort = await wandle({ ...basis, ...koerper });
      expect(antwort.status).toBe(400);
      return (await json(antwort)).error.fields[0];
    };
    expect(await fehler({ gewandeltesDarlehen: "100000.01" })).toMatchObject({ field: "gewandeltesDarlehen", code: "exceeds_outstanding" });
    expect(await fehler({ gewandelteZinsen: "3000.01" })).toMatchObject({ field: "gewandelteZinsen", code: "exceeds_outstanding" });
    expect(await fehler({ zinsenWandeln: false, gewandelteZinsen: "1" })).toMatchObject({ field: "gewandelteZinsen", code: "interest_not_converted" });
    expect(await fehler({ gewandeltesDarlehen: "0", gewandelteZinsen: "0" })).toMatchObject({ field: "gewandeltesDarlehen", code: "nothing_converted" });
    expect(await fehler({ gewandeltesDarlehen: "-5" })).toMatchObject({ field: "gewandeltesDarlehen" });
    // 5 Zinsen-Cent über dem Preis: gewandelt 0 Darlehen, 3.000 Zinsen ergeben ohne Rest 0 Spitzenbetrag; mit Preis 7,30 bleibt 4,60 Spitzenbetrag
    expect(await fehler({ gewandeltesDarlehen: "0", zinsenWandeln: true, preisregel: { rundenpreisJeAnteil: "12.5", discount: "0.2", bewertungsobergrenze: { betrag: "3650000", anteileVorRunde: "500000" } } })).toMatchObject({ field: "gewandeltesDarlehen", code: "below_residual_amount" });
    expect(await anzahl(db, "wandlung")).toBe(0);
    expect(await anzahl(db, "vorgang", "art IN ('zins', 'tilgung', 'zinszahlung')")).toBe(0);
    const [quelle] = await db.select().from(s.instrument).where(and(eq(s.instrument.beteiligungId, ID.wandel), eq(s.instrument.art, "wandeldarlehen")));
    expect(quelle!.status).toBe("aktiv");
  });
});
