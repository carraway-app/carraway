import { sql } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { erstelleTestApp, idVon, legePersonAn, person, STANDARD } from "./hilfen-auth";
import { stichtageZumNeuRechnen } from "../kennzahlen/snapshot";
import { arbeiteAb, NEUBERECHNUNG, starteJobs, verteileAuftraege } from "../jobs";
import { json, leeren, oeffneTestdb, TESTDB_URL } from "./hilfen";
import { vorgaengeEinfuegen } from "./instrument-hilfen";

const { db, pool } = oeffneTestdb();
const app = erstelleTestApp(db);
let boss: PgBoss;

const ID = {
  fonds: "00000000-0000-4000-8000-0000000000f1",
  anderer: "00000000-0000-4000-8000-0000000000f2",
  orgA: "00000000-0000-4000-8000-00000000000a",
  orgB: "00000000-0000-4000-8000-00000000000b",
  b1: "00000000-0000-4000-8000-0000000000b1",
  b2: "00000000-0000-4000-8000-0000000000b2",
  falsch: "00000000-0000-4000-8000-0000000000d1",
};

const T1 = "2026-01-10T09:00:00Z";
const KORREKTUR = "2026-03-10T09:00:00Z";
const ZWISCHEN = "2026-02-01T00:00:00Z";

const get = (pfad: string) => app.request(`/api/v1${pfad}`);
const post = (pfad: string, koerper?: unknown) =>
  app.request(`/api/v1${pfad}`, { method: "POST", headers: { "content-type": "application/json" }, body: koerper === undefined ? undefined : JSON.stringify(koerper) });
const anzahl = async (tabelle: string) => Number((await db.execute(sql.raw(`SELECT count(*)::int AS n FROM "${tabelle}"`))).rows[0]?.n);
const abgerufen = (u: { kennzahlen: { abgerufen: { wert: string | null } } }) => u.kennzahlen.abgerufen.wert;

async function grundbestand() {
  await leeren(db);
  await db.insert(s.organisation).values([
    { id: ID.orgA, name: "Alpha Beispiel", art: "unternehmen", sektor: "Software" },
    { id: ID.orgB, name: "Beta Beispiel", art: "unternehmen", sektor: "Energie" },
  ]);
  await db.insert(s.fonds).values([
    { id: ID.fonds, name: "Testfonds Eins", kurzname: "TF1", vintage: 2024, zeichnungskapital: "10000000.00" },
    { id: ID.anderer, name: "Testfonds Zwei", kurzname: "TF2", vintage: 2024, zeichnungskapital: "10000000.00" },
  ]);
  await db.insert(s.beteiligung).values([
    { id: ID.b1, fondsId: ID.fonds, organisationId: ID.orgA, instrument: "offene_beteiligung", erstinvestment: "2025-01-01" },
    { id: ID.b2, fondsId: ID.anderer, organisationId: ID.orgB, instrument: "offene_beteiligung", erstinvestment: "2025-01-01" },
  ]);
  const erfasstAm = new Date(T1);
  await vorgaengeEinfuegen(db, [
    { beteiligungId: ID.b1, art: "zusage", valuta: "2025-01-01", betrag: "1000000.00", erfasstAm },
    // Fehlbuchung (300.000 statt 250.000), später storniert und richtig neu gebucht.
    { id: ID.falsch, beteiligungId: ID.b1, art: "auszahlung", valuta: "2025-02-01", betrag: "300000.00", erfasstAm },
  ]);
  await db.insert(s.bewertung).values({ beteiligungId: ID.b1, stichtag: "2025-12-31", wert: "320000.00", methode: "letzte_runde", status: "freigegeben" as const, erfasstAm });
  await db.insert(s.fondsBewegung).values({ fondsId: ID.fonds, art: "abruf", valuta: "2025-02-01", betrag: "330000.00", erfasstAm });
  await vorgaengeEinfuegen(db, [
    { beteiligungId: ID.b1, art: "auszahlung", valuta: "2025-02-01", betrag: "-300000.00", storniertVorgangId: ID.falsch, erfasstAm: new Date(KORREKTUR) },
    { beteiligungId: ID.b1, art: "auszahlung", valuta: "2025-02-01", betrag: "250000.00", erfasstAm: new Date(KORREKTUR) },
  ]);
  await db.execute(sql`DELETE FROM snapshot_auftrag`);
}

beforeAll(async () => {
  boss = await starteJobs(TESTDB_URL);
});
beforeEach(async () => {
  await boss.deleteAllJobs(NEUBERECHNUNG);
  await grundbestand();
});
afterAll(async () => {
  await boss.stop({ graceful: false, timeout: 5000 });
  await leeren(db);
  await pool.end();
});

describe("Wissensstand (?stand=)", () => {
  it("eine spätere Korrektur ändert die heutige Sicht, nicht die Sicht davor", async () => {
    const heute = await json(await get(`/fonds/${ID.fonds}/uebersicht?stichtag=2025-12-31&stand=2026-06-01T00:00:00Z`));
    const davor = await json(await get(`/fonds/${ID.fonds}/uebersicht?stichtag=2025-12-31&stand=${ZWISCHEN}`));
    expect(heute.beteiligungen[0].investiert).toBe("250000.00");
    expect(davor.beteiligungen[0].investiert).toBe("300000.00");
    expect(davor.beteiligungen[0].multiple.wert).not.toBe(heute.beteiligungen[0].multiple.wert);
    // Ohne stand: aktueller Stand wie bei einem späten stand.
    const aktuell = await json(await get(`/fonds/${ID.fonds}/uebersicht?stichtag=2025-12-31`));
    expect(aktuell.beteiligungen[0].investiert).toBe("250000.00");
  });

  it("filtert auch Bewertungen und Fondsbewegungen nach Erfassungszeit", async () => {
    const vorErfassung = await json(await get(`/fonds/${ID.fonds}/uebersicht?stichtag=2025-12-31&stand=2025-12-31T00:00:00Z`));
    expect(vorErfassung.portfoliowert).toBe("0.00");
    expect(abgerufen(vorErfassung)).toBe("0");
    expect(vorErfassung.beteiligungen[0].investiert).toBe("0.00");
    const danach = await json(await get(`/fonds/${ID.fonds}/uebersicht?stichtag=2025-12-31&stand=${ZWISCHEN}`));
    expect(danach.portfoliowert).toBe("320000.00");
    expect(abgerufen(danach)).toBe("330000");
  });

  it("rechnet live und legt keinen Snapshot an; snapshot ist null", async () => {
    const antwort = await json(await get(`/fonds/${ID.fonds}/uebersicht?stichtag=2025-12-31&stand=${ZWISCHEN}`));
    expect(antwort.snapshot).toBeNull();
    expect(await anzahl("kennzahl_snapshot")).toBe(0);
  });

  it("lehnt einen ungültigen Zeitstempel mit 400 ab", async () => {
    const antwort = await get(`/fonds/${ID.fonds}/uebersicht?stand=gestern`);
    expect(antwort.status).toBe(400);
    expect((await json(antwort)).fehler.code).toBe("EINGABE_UNGUELTIG");
  });
});

describe("Snapshots", () => {
  it("rechnet beim ersten Aufruf einmal synchron und speichert das Ergebnis", async () => {
    expect(await anzahl("kennzahl_snapshot")).toBe(0);
    const antwort = await get(`/fonds/${ID.fonds}/uebersicht`);
    expect(antwort.status).toBe(200);
    const erste = await json(antwort);
    expect(erste.snapshot.veraltet).toBe(false);
    expect(new Date(erste.snapshot.berechnetAm).getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(await anzahl("kennzahl_snapshot")).toBe(1);

    const zweite = await json(await get(`/fonds/${ID.fonds}/uebersicht`));
    expect(zweite.snapshot.berechnetAm).toBe(erste.snapshot.berechnetAm);
    expect(zweite.kennzahlen).toEqual(erste.kennzahlen);
    expect(zweite.beteiligungen).toEqual(erste.beteiligungen);
    const [zeile] = (await db.execute<{ stand_bis: string | null; stichtag: string }>(sql`SELECT stand_bis::text, stichtag::text FROM kennzahl_snapshot`)).rows;
    expect(zeile?.stand_bis).toBeTruthy();
    expect(zeile?.stichtag).toBe("2025-12-31");
  });

  it("liest den gespeicherten Stand: nach neuen Eingangsdaten ist er veraltet, bis der Worker gerechnet hat", async () => {
    const vorher = await json(await get(`/fonds/${ID.fonds}/uebersicht`));
    expect(vorher.beteiligungen[0].investiert).toBe("250000.00");

    await vorgaengeEinfuegen(db, { beteiligungId: ID.b1, art: "auszahlung", valuta: "2025-06-01", betrag: "50000.00" });
    const veraltet = await json(await get(`/fonds/${ID.fonds}/uebersicht`));
    expect(veraltet.snapshot.veraltet).toBe(true);
    expect(veraltet.snapshot.berechnetAm).toBe(vorher.snapshot.berechnetAm);
    expect(veraltet.beteiligungen[0].investiert).toBe("250000.00");

    // Der Trigger hat einen Auftrag angelegt; der Worker reiht ihn ein und rechnet ihn ab.
    expect(await anzahl("snapshot_auftrag")).toBe(1);
    expect(await verteileAuftraege(db, boss)).toBe(1);
    expect(await anzahl("snapshot_auftrag")).toBe(0);
    expect(await arbeiteAb(db, boss)).toBe(1);

    const aktuell = await json(await get(`/fonds/${ID.fonds}/uebersicht`));
    expect(aktuell.snapshot.veraltet).toBe(false);
    expect(aktuell.beteiligungen[0].investiert).toBe("300000.00");
    expect(new Date(aktuell.snapshot.berechnetAm).getTime()).toBeGreaterThan(new Date(vorher.snapshot.berechnetAm).getTime());
  });

  it("jede Art von Eingangsdaten (Vorgang, Bewertung, Fondsbewegung) macht den Snapshot veraltet", async () => {
    await get(`/fonds/${ID.fonds}/uebersicht`);
    await db.insert(s.bewertung).values({ beteiligungId: ID.b1, stichtag: "2025-09-30", wert: "1.00", methode: "sonstige", status: "freigegeben" as const });
    expect((await json(await get(`/fonds/${ID.fonds}/uebersicht`))).snapshot.veraltet).toBe(true);
    await verteileAuftraege(db, boss);
    await arbeiteAb(db, boss);
    expect((await json(await get(`/fonds/${ID.fonds}/uebersicht`))).snapshot.veraltet).toBe(false);
    await db.insert(s.fondsBewegung).values({ fondsId: ID.fonds, art: "abruf", valuta: "2025-07-01", betrag: "10.00" });
    expect((await json(await get(`/fonds/${ID.fonds}/uebersicht`))).snapshot.veraltet).toBe(true);
  });

  it("Eingangsdaten eines anderen Fonds lassen den Snapshot unberührt", async () => {
    await get(`/fonds/${ID.fonds}/uebersicht`);
    await vorgaengeEinfuegen(db, { beteiligungId: ID.b2, art: "zusage", valuta: "2025-06-01", betrag: "10.00" });
    expect((await json(await get(`/fonds/${ID.fonds}/uebersicht`))).snapshot.veraltet).toBe(false);
  });

  it("der Worker rechnet alle vorhandenen Stichtage des Fonds neu", async () => {
    await get(`/fonds/${ID.fonds}/uebersicht`);
    await get(`/fonds/${ID.fonds}/uebersicht?stichtag=2025-06-30`);
    expect(await anzahl("kennzahl_snapshot")).toBe(2);
    await db.insert(s.fondsBewegung).values({ fondsId: ID.fonds, art: "abruf", valuta: "2025-03-01", betrag: "10.00" });
    await verteileAuftraege(db, boss);
    await arbeiteAb(db, boss);
    expect((await json(await get(`/fonds/${ID.fonds}/uebersicht`))).snapshot.veraltet).toBe(false);
    expect((await json(await get(`/fonds/${ID.fonds}/uebersicht?stichtag=2025-06-30`))).snapshot.veraltet).toBe(false);
  });

  it("mehrere Änderungen ergeben einen Auftrag und einen Job", async () => {
    await get(`/fonds/${ID.fonds}/uebersicht`);
    for (let i = 1; i <= 3; i++) {
      await db.insert(s.fondsBewegung).values({ fondsId: ID.fonds, art: "abruf", valuta: `2025-0${i}-15`, betrag: "1.00" });
    }
    expect(await anzahl("snapshot_auftrag")).toBe(1);
    await verteileAuftraege(db, boss);
    await db.insert(s.fondsBewegung).values({ fondsId: ID.fonds, art: "abruf", valuta: "2025-04-15", betrag: "1.00" });
    expect(await anzahl("snapshot_auftrag")).toBe(1);
    await verteileAuftraege(db, boss);
    // `short`-Warteschlange mit singletonKey: nur ein wartender Job je Fonds.
    expect(await arbeiteAb(db, boss)).toBe(1);
  });

  it("ein Schreibweg der API (Übergang ins Portfolio) stößt die Neuberechnung an", async () => {
    await get(`/fonds/${ID.fonds}/uebersicht?stichtag=2025-12-31`);
    const dealId = "00000000-0000-4000-8000-0000000000e1";
    await db.insert(s.deal).values({ id: dealId, organisationId: ID.orgB, fondsId: ID.fonds, titel: "Übergang", phase: "investitionsausschuss", status: "offen" });
    const freigeber = await legePersonAn(db, person("snapshot-freigeber", { globalVerwalter: true }));
    await db.insert(s.beschluss).values({ dealId, gremium: "Investitionsausschuss", datum: "2026-03-01", ergebnis: "zugestimmt", betrag: "500000.00", fondsId: ID.fonds, erfasstVon: freigeber });
    expect(await anzahl("snapshot_auftrag")).toBe(0);
    const antwort = await post(`/deals/${dealId}/beteiligung`, { fondsId: ID.fonds, instrument: "offene_beteiligung", erstinvestment: "2026-03-15", zusage: "400000.00" });
    expect(antwort.status).toBe(201);
    expect(await anzahl("snapshot_auftrag")).toBe(1);
    expect((await json(await get(`/fonds/${ID.fonds}/uebersicht?stichtag=2025-12-31`))).snapshot.veraltet).toBe(true);
    await verteileAuftraege(db, boss);
    await arbeiteAb(db, boss);
    expect((await json(await get(`/fonds/${ID.fonds}/uebersicht?stichtag=2025-12-31`))).snapshot.veraltet).toBe(false);
  });
});

describe("Standard-Stichtag", () => {
  it("ist der spätere von letztem Bewertungsstichtag und letzter Vorgangs-Valuta, höchstens heute", async () => {
    expect((await json(await get(`/fonds/${ID.fonds}/uebersicht`))).stichtag).toBe("2025-12-31");
    await vorgaengeEinfuegen(db, { beteiligungId: ID.b1, art: "auszahlung", valuta: "2026-03-15", betrag: "10.00" });
    const antwort = await json(await get(`/fonds/${ID.fonds}/uebersicht`));
    expect(antwort.stichtag).toBe("2026-03-15");
    expect(antwort.beteiligungen[0].investiert).toBe("250010.00");
    // Eine Valuta in der Zukunft verschiebt den Standard nicht über heute hinaus.
    await vorgaengeEinfuegen(db, { beteiligungId: ID.b1, art: "auszahlung", valuta: "2999-01-01", betrag: "10.00" });
    expect((await json(await get(`/fonds/${ID.fonds}/uebersicht`))).stichtag).toBe("2026-03-15");
  });
});

describe("Welche Stichtage gespeichert werden", () => {
  it("ein Stichtag mitten im Quartal wird live gerechnet und nichts gespeichert", async () => {
    const antwort = await json(await get(`/fonds/${ID.fonds}/uebersicht?stichtag=2025-08-17`));
    expect(antwort.snapshot).toBeNull();
    expect(antwort.stichtag).toBe("2025-08-17");
    expect(await anzahl("kennzahl_snapshot")).toBe(0);
    for (let i = 0; i < 3; i++) await get(`/fonds/${ID.fonds}/uebersicht?stichtag=2025-08-1${i}`);
    expect(await anzahl("kennzahl_snapshot")).toBe(0);
  });

  it("ein Quartalsende wird einmal gespeichert", async () => {
    const erste = await json(await get(`/fonds/${ID.fonds}/uebersicht?stichtag=2025-09-30`));
    expect(erste.snapshot.veraltet).toBe(false);
    const zweite = await json(await get(`/fonds/${ID.fonds}/uebersicht?stichtag=2025-09-30`));
    expect(zweite.snapshot.berechnetAm).toBe(erste.snapshot.berechnetAm);
    expect(await anzahl("kennzahl_snapshot")).toBe(1);
  });

  it("der Standard-Stichtag wird gespeichert, auch wenn er kein Quartalsende ist", async () => {
    await db.insert(s.bewertung).values({ beteiligungId: ID.b1, stichtag: "2026-01-15", wert: "1.00", methode: "sonstige", status: "freigegeben" as const });
    const antwort = await json(await get(`/fonds/${ID.fonds}/uebersicht`));
    expect(antwort.stichtag).toBe("2026-01-15");
    expect(antwort.snapshot).not.toBeNull();
    expect(await anzahl("kennzahl_snapshot")).toBe(1);
  });

  it("Neuberechnung für einen Stichtag mitten im Quartal wird mit 400 abgelehnt", async () => {
    const antwort = await post(`/fonds/${ID.fonds}/neuberechnen?stichtag=2025-08-17`);
    expect(antwort.status).toBe(400);
    expect((await json(antwort)).fehler.code).toBe("EINGABE_UNGUELTIG");
    expect(await anzahl("snapshot_auftrag")).toBe(0);
  });

  it("ein Quartalsende in der Zukunft oder vor dem Start des Fonds wird live gerechnet und nicht gespeichert", async () => {
    for (const st of ["2999-12-31", "2024-12-31", "2000-03-31"]) {
      const antwort = await json(await get(`/fonds/${ID.fonds}/uebersicht?stichtag=${st}`));
      expect(antwort.snapshot).toBeNull();
      expect(antwort.stichtag).toBe(st);
    }
    expect(await anzahl("kennzahl_snapshot")).toBe(0);
    const abgelehnt = await post(`/fonds/${ID.fonds}/neuberechnen?stichtag=2999-12-31`);
    expect(abgelehnt.status).toBe(400);
  });

  it("je Job gilt eine Obergrenze und behält die richtigen Stichtage", async () => {
    // Fenster: erstes Quartalsende ab dem ersten Eingang (2025-03-31) bis zum Standard-Stichtag (2025-12-31).
    for (const st of ["2025-03-31", "2025-06-30", "2025-09-30", "2999-12-31", "2024-12-31", "2025-11-11"]) {
      await db.execute(sql`INSERT INTO kennzahl_snapshot (fonds_id, stichtag, daten) VALUES (${ID.fonds}, ${st}::date, '{}'::jsonb)`);
    }
    const alle = await stichtageZumNeuRechnen(db, ID.fonds);
    expect(alle).toEqual(["2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31"]);
    expect(await stichtageZumNeuRechnen(db, ID.fonds, 2)).toEqual(["2025-09-30", "2025-12-31"]);
  });
});

describe("POST /fonds/:id/neuberechnen", () => {
  it("antwortet mit 202, legt einen Auftrag an und protokolliert", async () => {
    const antwort = await post(`/fonds/${ID.fonds}/neuberechnen?stichtag=2025-06-30`);
    expect(antwort.status).toBe(202);
    expect(await json(antwort)).toEqual({ angefordert: true, fondsId: ID.fonds, stichtag: "2025-06-30" });
    const { rows } = await db.execute<{ stichtag: string | null }>(sql`SELECT stichtag::text FROM snapshot_auftrag`);
    expect(rows).toEqual([{ stichtag: "2025-06-30" }]);
    const protokoll = await db.execute<{ aktion: string; akteur: string }>(sql`SELECT aktion, akteur FROM aenderung WHERE tabelle = 'fonds'`);
    expect(protokoll.rows).toEqual([{ aktion: "neuberechnung", akteur: await idVon(db, STANDARD) }]);

    await verteileAuftraege(db, boss);
    expect(await arbeiteAb(db, boss)).toBe(1);
    expect(await anzahl("kennzahl_snapshot")).toBe(1);
    const uebersicht = await json(await get(`/fonds/${ID.fonds}/uebersicht?stichtag=2025-06-30`));
    expect(uebersicht.snapshot.veraltet).toBe(false);
  });

  it("ohne Stichtag werden alle Snapshots des Fonds neu gerechnet", async () => {
    await get(`/fonds/${ID.fonds}/uebersicht`);
    const vorher = (await json(await get(`/fonds/${ID.fonds}/uebersicht`))).snapshot.berechnetAm;
    expect((await post(`/fonds/${ID.fonds}/neuberechnen`)).status).toBe(202);
    await verteileAuftraege(db, boss);
    await arbeiteAb(db, boss);
    const nachher = (await json(await get(`/fonds/${ID.fonds}/uebersicht`))).snapshot.berechnetAm;
    expect(new Date(nachher).getTime()).toBeGreaterThan(new Date(vorher).getTime());
  });

  it("unbekannter Fonds ist 404, ungültiger Stichtag 400", async () => {
    const fremd = await post("/fonds/00000000-0000-4000-8000-0000000000ff/neuberechnen");
    expect(fremd.status).toBe(404);
    expect((await json(fremd)).fehler.code).toBe("FONDS_NICHT_GEFUNDEN");
    const schlecht = await post(`/fonds/${ID.fonds}/neuberechnen?stichtag=morgen`);
    expect(schlecht.status).toBe(400);
    expect(await anzahl("snapshot_auftrag")).toBe(0);
  });
});
