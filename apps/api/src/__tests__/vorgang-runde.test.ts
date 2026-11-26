import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { erstelleTestApp, legePersonAn, person } from "./hilfen-auth";
import { leeren, oeffneTestdb, vehikelVon } from "./hilfen";
import { aufrufe, grundbestand, ID, json, protokollZeilen } from "./hilfen-instrumente";

/**
 * Zuordnung der Vorgänge zu Finanzierungsrunden (`vorgang_runde`) und Brückenrunden (`art = bruecke`). Alle Daten sind erfunden.
 */

const { db, pool } = oeffneTestdb();
const { get, post, put, patch, delete: loesche } = aufrufe(erstelleTestApp(db));

const R_SEED = "00000000-0000-4000-8000-0000000000e1";
const R_A = "00000000-0000-4000-8000-0000000000e2";
const R_B = "00000000-0000-4000-8000-0000000000e3";
const P_FONDS = "00000000-0000-4000-8000-0000000000c1";
const P_ORG = "00000000-0000-4000-8000-0000000000c2";
const P_FONDS_A = "00000000-0000-4000-8000-0000000000c3";
const P_ORG_A = "00000000-0000-4000-8000-0000000000c4";
const B_F2 = "00000000-0000-4000-8000-0000000000b9";
const FALSCH = "00000000-0000-4000-8000-0000000000ff";

const bearbeiterF1 = person("vr-bearbeiter-f1", { rollen: { [ID.fonds]: "bearbeiter" } });
const betrachterF1 = person("vr-betrachter-f1", { rollen: { [ID.fonds]: "betrachter" } });
const bearbeiterF2 = person("vr-bearbeiter-f2", { rollen: { [ID.anderer]: "bearbeiter" } });
const betrachterF2 = person("vr-betrachter-f2", { rollen: { [ID.anderer]: "betrachter" } });
const ohneRolle = person("vr-ohne-rolle", { rollen: {} });

const BRUECKE = { art: "bruecke", bezeichnung: "Brücke 2026", datum: "2026-03-01" };
const zeile = async (vorgangId: string) => (await db.select().from(s.vorgangRunde).where(eq(s.vorgangRunde.vorgangId, vorgangId)))[0];
const buchung = async (beteiligungId: string, koerper: object, als: Parameters<typeof post>[2] = "a") => {
  const antwort = await post(`/investments/${beteiligungId}/transactions`, koerper, als);
  expect(antwort.status, await antwort.clone().text()).toBe(201);
  return json(antwort);
};

/** Unternehmen A: Seed und Serie A (bewertet, mit Positionen), dazu ein Unternehmen B der anderen Fonds-Seite (Runde R_B) und eine Beteiligung des zweiten Fonds an A. */
beforeEach(async () => {
  await grundbestand(db);
  for (const p of [bearbeiterF1, betrachterF1, bearbeiterF2, betrachterF2, ohneRolle]) await legePersonAn(db, p);
  await db.insert(s.finanzierungsrunde).values([
    { id: R_SEED, organisationId: ID.orgA, bezeichnung: "Seed", datum: "2025-01-10", preMoney: "2000000.00", postMoney: "2300000.00", preisJeAnteil: "2.0000", anteileGesamtNach: "1150000" },
    { id: R_A, organisationId: ID.orgA, bezeichnung: "Serie A", datum: "2025-09-01", preMoney: "5750000.00", postMoney: "6250000.00", preisJeAnteil: "5.0000", anteileGesamtNach: "1250000" },
    { id: R_B, organisationId: ID.orgB, bezeichnung: "Seed B", datum: "2025-02-01", preMoney: "1000000.00", postMoney: "1100000.00", preisJeAnteil: "1.0000", anteileGesamtNach: "1100000" },
  ]);
  await db.insert(s.rundenposition).values([
    { id: P_FONDS, rundeId: R_SEED, fondsId: ID.fonds, betrag: "100000.00", anteile: "50000", rolle: "lead" },
    { id: P_ORG, rundeId: R_SEED, vehikelId: await vehikelVon(db, ID.orgB), betrag: "200000.00", anteile: "100000", rolle: "co" },
    { id: P_FONDS_A, rundeId: R_A, fondsId: ID.fonds, betrag: "200000.00", anteile: "40000", rolle: "lead" },
    { id: P_ORG_A, rundeId: R_A, vehikelId: await vehikelVon(db, ID.orgB), betrag: "300000.00", anteile: "60000", rolle: "co" },
  ]);
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

describe("Standardzuordnung beim Buchen", () => {
  it("folgt der Runde des Instruments und protokolliert die Zuordnung", async () => {
    await db.update(s.instrument).set({ rundeId: R_A }).where(eq(s.instrument.beteiligungId, ID.eigen));
    const zusage = await buchung(ID.eigen, { type: "commitment", valueDate: "2025-09-02", amount: "200000" });
    expect(zusage.transaction.roundId).toBe(R_A);
    expect(await zeile(zusage.transaction.id)).toMatchObject({ rundeId: R_A, quelle: "automatisch" });
    const zeilen = await protokollZeilen(db, "vorgang_runde", "anlegen");
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]).toMatchObject({ datensatz_id: zusage.transaction.id, nachher: { rundeId: R_A, quelle: "automatisch", fondsId: ID.fonds } });
  });

  it("ohne Runde am Instrument und ohne Angabe bleibt der Vorgang ohne Runde", async () => {
    const v = await buchung(ID.eigen, { type: "commitment", valueDate: "2025-09-02", amount: "1000" });
    expect(v.transaction.roundId).toBeNull();
    expect(await zeile(v.transaction.id)).toBeUndefined();
  });

  it("eine ausdrückliche rundeId hat Vorrang (manuell), null heißt bewusst keine Runde", async () => {
    await db.update(s.instrument).set({ rundeId: R_A }).where(eq(s.instrument.beteiligungId, ID.eigen));
    const ausdruecklich = await buchung(ID.eigen, { type: "commitment", valueDate: "2025-09-02", amount: "1000", roundId: R_SEED });
    expect(ausdruecklich.transaction.roundId).toBe(R_SEED);
    expect(await zeile(ausdruecklich.transaction.id)).toMatchObject({ rundeId: R_SEED, quelle: "manuell" });
    const keine = await buchung(ID.eigen, { type: "commitment", valueDate: "2025-09-02", amount: "1000", roundId: null });
    expect(keine.transaction.roundId).toBeNull();
    expect(await zeile(keine.transaction.id)).toBeUndefined();
  });

  it("lehnt eine Runde eines anderen Unternehmens ab und bucht dann nichts", async () => {
    const antwort = await post(`/investments/${ID.eigen}/transactions`, { type: "commitment", valueDate: "2025-09-02", amount: "1000", roundId: R_B }, "a");
    expect(antwort.status).toBe(409);
    expect((await json(antwort)).error.code).toBe("transaction_round_foreign");
    expect(await db.select().from(s.vorgang)).toHaveLength(0);
    expect((await post(`/investments/${ID.eigen}/transactions`, { type: "commitment", valueDate: "2025-09-02", amount: "1000", roundId: FALSCH }, "a")).status).toBe(404);
  });

  it("der Journal-Weg (POST /fonds/:id/buchungen) nimmt rundeId ebenfalls an", async () => {
    const antwort = await post(`/funds/${ID.fonds}/postings`, { kind: "commitment", investmentId: ID.eigen, valueDate: "2025-09-02", amount: "1000", roundId: R_A }, "a");
    expect(antwort.status).toBe(201);
    expect((await json(antwort)).transaction.roundId).toBe(R_A);
  });

  it("ein Storno erbt die Runde des stornierten Vorgangs", async () => {
    const v = await buchung(ID.eigen, { type: "commitment", valueDate: "2025-09-02", amount: "5000", roundId: R_SEED });
    const storno = await json(await post(`/transactions/${v.transaction.id}/reverse`, { reason: "Irrtum" }, "a"));
    expect(await zeile(storno.reversal.id)).toMatchObject({ rundeId: R_SEED, quelle: "automatisch" });
    // Ein Storno eines Vorgangs ohne Runde bleibt ohne Runde.
    const ohne = await buchung(ID.eigen, { type: "commitment", valueDate: "2025-09-02", amount: "5000" });
    const stornoOhne = await json(await post(`/transactions/${ohne.transaction.id}/reverse`, { reason: "Irrtum" }, "a"));
    expect(await zeile(stornoOhne.reversal.id)).toBeUndefined();
  });
});

describe("PUT /transactions/:id/round", () => {
  it("ordnet zu, ändert und entfernt; jede Änderung steht im Änderungsprotokoll", async () => {
    const v = await buchung(ID.eigen, { type: "commitment", valueDate: "2025-09-02", amount: "1000" });
    const id = v.transaction.id as string;
    const zu = await put(`/transactions/${id}/round`, { roundId: R_SEED }, bearbeiterF1);
    expect(zu.status).toBe(200);
    expect(await json(zu)).toEqual({ transactionId: id, roundId: R_SEED, source: "manual", changed: true });
    expect(await zeile(id)).toMatchObject({ rundeId: R_SEED, quelle: "manuell" });
    const um = await json(await put(`/transactions/${id}/round`, { roundId: R_A }, bearbeiterF1));
    expect(um).toMatchObject({ roundId: R_A, changed: true });
    const gleich = await json(await put(`/transactions/${id}/round`, { roundId: R_A }, bearbeiterF1));
    expect(gleich.changed).toBe(false);
    const weg = await json(await put(`/transactions/${id}/round`, { roundId: null }, bearbeiterF1));
    expect(weg).toEqual({ transactionId: id, roundId: null, source: null, changed: true });
    expect(await zeile(id)).toBeUndefined();
    const aktionen = (await protokollZeilen(db, "vorgang_runde")).map((z) => z.aktion);
    expect(aktionen).toEqual(["anlegen", "aendern", "loeschen"]);
    const geaendert = (await protokollZeilen(db, "vorgang_runde", "aendern"))[0]!;
    // Die Fonds-Zuordnung der Protokollzeile (für den Änderungsfeed) stammt aus dem protokollierten Stand.
    const { rows: fondsZeilen } = await db.execute<{ fonds_id: string | null }>(sql`SELECT fonds_id::text FROM aenderung WHERE tabelle = 'vorgang_runde' AND datensatz_id = ${id}`);
    expect(fondsZeilen.length).toBe(3);
    for (const z of fondsZeilen) expect(z.fonds_id).toBe(ID.fonds);
    expect(geaendert.vorher).toMatchObject({ rundeId: R_SEED, fondsId: ID.fonds });
    expect(geaendert.nachher).toMatchObject({ rundeId: R_A, quelle: "manuell", fondsId: ID.fonds });
    // Der Vorgang selbst ist unverändert.
    expect((await db.select().from(s.vorgang).where(eq(s.vorgang.id, id)))[0]).toMatchObject({ betrag: "1000.00", valuta: "2025-09-02" });
  });

  it("lehnt fremde und unbekannte Runden, unbekannte Vorgänge und fehlende Rechte ab", async () => {
    const v = await buchung(ID.eigen, { type: "commitment", valueDate: "2025-09-02", amount: "1000" });
    const id = v.transaction.id as string;
    const fremd = await put(`/transactions/${id}/round`, { roundId: R_B }, bearbeiterF1);
    expect(fremd.status).toBe(409);
    expect((await json(fremd)).error.code).toBe("transaction_round_foreign");
    expect((await put(`/transactions/${id}/round`, { roundId: FALSCH }, bearbeiterF1)).status).toBe(404);
    expect((await put(`/transactions/${FALSCH}/round`, { roundId: R_A }, bearbeiterF1)).status).toBe(404);
    expect((await put(`/transactions/${id}/round`, { roundId: R_A }, betrachterF1)).status).toBe(403);
    expect((await put(`/transactions/${id}/round`, { roundId: R_A }, bearbeiterF2)).status).toBe(403);
    expect((await put(`/transactions/${id}/round`, {}, bearbeiterF1)).status).toBe(400);
    expect(await zeile(id)).toBeUndefined();
  });
});

describe("GET /beteiligungen/:id (Zeilen der Transaktionen)", () => {
  it("trägt je Vorgang die zugeordnete Runde oder null", async () => {
    const mit = await buchung(ID.eigen, { type: "commitment", valueDate: "2025-09-02", amount: "1000" });
    const ohne = await buchung(ID.eigen, { type: "commitment", valueDate: "2025-09-03", amount: "2000" });
    await put(`/transactions/${mit.transaction.id}/round`, { roundId: R_SEED }, bearbeiterF1);
    const d = await json(await get(`/beteiligungen/${ID.eigen}?stichtag=2026-12-31`, "a"));
    const nach = (id: string) => (d.vorgaenge as { id: string; runde: unknown }[]).find((v) => v.id === id)!;
    expect(nach(mit.transaction.id).runde).toEqual({ id: R_SEED, bezeichnung: "Seed", art: "eigenkapital", datum: "2025-01-10" });
    expect(nach(ohne.transaction.id).runde).toBeNull();
  });
});

describe("Runde abschließen und Löschen", () => {
  it("die Zusage des Rundenabschlusses gehört zur Runde", async () => {
    const neu = await json(
      await post(`/organisationen/${ID.orgC}/finanzierungsrunden`, { bezeichnung: "Serie B", datum: "2026-03-15", preMoney: "8000000.00", preisJeAnteil: "10.0000", positionen: [{ fondsId: ID.fonds, betrag: "1500000.00", anteile: "150000", rolle: "lead" }] }, "a"),
    );
    const ab = await json(await post(`/finanzierungsrunden/${neu.id}/abschliessen`, {}, "a"));
    const vorgangId = ab.buchungen[0].vorgangIds[0] as string;
    expect(await zeile(vorgangId)).toMatchObject({ rundeId: neu.id, quelle: "automatisch" });
  });

  it("eine Runde mit zugeordneten Vorgängen lässt sich nicht löschen", async () => {
    const neu = await json(await post(`/organisationen/${ID.orgC}/finanzierungsrunden`, { bezeichnung: "Entwurf", datum: "2026-03-15", preMoney: "1000.00", preisJeAnteil: "1.0000" }, "a"));
    const v = await buchung(ID.wandel, { type: "commitment", valueDate: "2026-03-16", amount: "1000" });
    expect((await put(`/transactions/${v.transaction.id}/round`, { roundId: neu.id }, "a")).status).toBe(200);
    const antwort = await loesche(`/finanzierungsrunden/${neu.id}`, undefined, "a");
    expect(antwort.status).toBe(409);
    expect((await json(antwort)).error.code).toBe("round_in_use");
    await put(`/transactions/${v.transaction.id}/round`, { roundId: null }, "a");
    expect((await loesche(`/finanzierungsrunden/${neu.id}`, undefined, "a")).status).toBe(204);
  });
});

describe("GET /organisationen/:id/rundentransaktionen", () => {
  beforeEach(async () => {
    // Zweiter Fonds hält ebenfalls Anteile an Unternehmen A.
    await db.insert(s.beteiligung).values({ id: B_F2, fondsId: ID.anderer, organisationId: ID.orgA, instrument: "offene_beteiligung", erstinvestment: "2025-01-01" });
    const [b] = await db.select().from(s.beteiligung).where(eq(s.beteiligung.id, B_F2));
    const { legeHauptinstrumentAn } = await import("../instrumente/hauptinstrument");
    await legeHauptinstrumentAn(db, b!);
  });

  it("ordnet Vorgänge desselben Tages logisch: Zusage vor Auszahlung vor Zins vor Tilgung, erst danach nach Erfassung", async () => {
    const [i] = await db.select().from(s.instrument).where(eq(s.instrument.beteiligungId, ID.eigen));
    const basis = { beteiligungId: ID.eigen, instrumentId: i!.id, valuta: "2025-04-01" };
    // Die Auszahlung ist früher erfasst als die Zusage (und hat die kleinere Id): ohne logische Reihenfolge stünde sie vorn.
    const [rueck] = await db.insert(s.vorgang).values({ ...basis, art: "rueckfluss", betrag: "5.00", erfasstAm: new Date("2025-04-01T08:00:00Z"), id: "00000000-0000-4000-8000-000000000a01" }).returning();
    const [aus] = await db.insert(s.vorgang).values({ ...basis, art: "auszahlung", betrag: "100.00", erfasstAm: new Date("2025-04-01T08:01:00Z"), id: "00000000-0000-4000-8000-000000000a02" }).returning();
    const [zus] = await db.insert(s.vorgang).values({ ...basis, art: "zusage", betrag: "100.00", erfasstAm: new Date("2025-04-01T08:02:00Z"), id: "00000000-0000-4000-8000-000000000a03" }).returning();
    const [dann] = await db.insert(s.vorgang).values({ ...basis, valuta: "2025-04-02", art: "zusage", betrag: "1.00", erfasstAm: new Date("2025-04-01T07:00:00Z"), id: "00000000-0000-4000-8000-000000000a04" }).returning();
    const d = await json(await get(`/organisationen/${ID.orgA}/rundentransaktionen`, "a"));
    const ids = [...d.runden.flatMap((r: { transaktionen: { id: string }[] }) => r.transaktionen), ...d.ohneRunde].map((t: { id: string }) => t.id);
    const mine = ids.filter((x: string) => [rueck, aus, zus, dann].some((v) => v!.id === x));
    // Im Gruppenaufbau je Runde bzw. ohne Runde bleibt die Folge pro Gruppe logisch; sortiert über alle Gruppen gilt dasselbe
    const alle = [...d.runden.flatMap((r: { transaktionen: { id: string; art: string; valuta: string }[] }) => r.transaktionen), ...d.ohneRunde] as { id: string; art: string; valuta: string }[];
    const reihenfolge = ["zusage", "auszahlung", "rueckfluss"];
    const tag = alle.filter((t) => t.valuta === "2025-04-01" && mine.includes(t.id));
    expect(tag.map((t) => t.art)).toEqual(reihenfolge);
    expect(mine).toHaveLength(4);
  });

  it("gruppiert nach Runde und ohne Runde, mit Anteilen an der Zusage der Position", { retry: { count: 1, condition: /"code":"query_too_long"/ } }, async () => {
    await db.update(s.instrument).set({ rundeId: R_SEED }).where(eq(s.instrument.beteiligungId, ID.eigen));
    await db.update(s.rundenposition).set({ instrumentId: (await db.select().from(s.instrument).where(eq(s.instrument.beteiligungId, ID.eigen)))[0]!.id }).where(eq(s.rundenposition.id, P_FONDS));
    const zusage = await buchung(ID.eigen, { type: "commitment", valueDate: "2025-01-12", amount: "100000" });
    const auszahlung = await buchung(ID.eigen, { type: "disbursement", valueDate: "2025-01-15", amount: "100000" });
    const ohne = await buchung(ID.eigen, { type: "commitment", valueDate: "2025-12-01", amount: "5000", roundId: null });
    const f2 = await buchung(B_F2, { type: "commitment", valueDate: "2025-09-05", amount: "7000", roundId: R_A });
    const stornoAntwort = await post(`/transactions/${ohne.transaction.id}/reverse`, { reason: "Irrtum" }, "a");
    expect(stornoAntwort.status, await stornoAntwort.clone().text()).toBe(201);
    const storno = await json(stornoAntwort);

    const antwort = await get(`/organisationen/${ID.orgA}/rundentransaktionen`, "a");
    expect(antwort.status, await antwort.clone().text()).toBe(200);
    const d = await json(antwort);
    expect(d.organisationId).toBe(ID.orgA);
    expect(d.runden.map((r: { id: string }) => r.id)).toEqual([R_A, R_SEED]);
    expect(d.runden[0]).toMatchObject({ bezeichnung: "Serie A", art: "eigenkapital", status: "abgeschlossen" });
    const seed = d.runden[1].transaktionen;
    expect(seed.map((t: { id: string }) => t.id)).toEqual([zusage.transaction.id, auszahlung.transaction.id]);
    expect(seed[0]).toMatchObject({ art: "zusage", betrag: "100000.00", valuta: "2025-01-12", fonds: { id: ID.fonds, name: "Testfonds Eins" }, beteiligungId: ID.eigen, anteile: "50000", storniert: false, storniertVorgangId: null, quelle: "automatisch" });
    expect(seed[0].instrument).toMatchObject({ art: "offene_beteiligung" });
    expect(seed[1]).toMatchObject({ art: "auszahlung", anteile: null, tranche: null });
    expect(d.runden[0].transaktionen.map((t: { id: string }) => t.id)).toEqual([f2.transaction.id]);
    expect(d.runden[0].transaktionen[0]).toMatchObject({ fonds: { id: ID.anderer }, quelle: "manuell" });
    expect(d.ohneRunde.map((t: { id: string }) => t.id)).toEqual([ohne.transaction.id, storno.reversal.id]);
    expect(d.ohneRunde[0]).toMatchObject({ storniert: true, quelle: null });
    expect(d.ohneRunde[1]).toMatchObject({ storniertVorgangId: ohne.transaction.id, betrag: "-5000.00", storniert: false });
  });

  it("zeigt nur Vorgänge der Fonds, die die Person sehen darf", async () => {
    const eins = await buchung(ID.eigen, { type: "commitment", valueDate: "2025-01-12", amount: "100", roundId: R_SEED });
    const zwei = await buchung(B_F2, { type: "commitment", valueDate: "2025-01-13", amount: "200", roundId: R_SEED });
    const ids = async (als: Parameters<typeof get>[1]) => {
      const antwort = await get(`/organisationen/${ID.orgA}/rundentransaktionen`, als);
      if (antwort.status !== 200) return antwort.status;
      const d = await json(antwort);
      return [...d.runden.flatMap((r: { transaktionen: { id: string }[] }) => r.transaktionen), ...d.ohneRunde].map((t: { id: string }) => t.id).sort();
    };
    expect(await ids("a")).toEqual([eins.transaction.id, zwei.transaction.id].sort());
    expect(await ids(betrachterF1)).toEqual([eins.transaction.id]);
    expect(await ids(betrachterF2)).toEqual([zwei.transaction.id]);
    expect(await ids(ohneRolle)).toBe(403);
    expect((await get(`/organisationen/${FALSCH}/rundentransaktionen`, "a")).status).toBe(404);
  });
});

describe("Brückenrunde", () => {
  const anlegen = (koerper: object = BRUECKE, als: Parameters<typeof post>[2] = "a", org: string = ID.orgA) => post(`/organisationen/${org}/finanzierungsrunden`, koerper, als);

  it("wird ohne Bewertung als abgeschlossene Runde angelegt", async () => {
    const antwort = await anlegen();
    expect(antwort.status).toBe(201);
    const r = await json(antwort);
    expect(r).toMatchObject({ art: "bruecke", status: "abgeschlossen", bezeichnung: "Brücke 2026", datum: "2026-03-01", preMoney: null, postMoney: null, preisJeAnteil: null, anteileGesamtNach: null, positionen: [] });
    expect(r.pruefung).toMatchObject({ schliessbar: true, abweichungen: [] });
    expect((await protokollZeilen(db, "finanzierungsrunde", "anlegen"))).toHaveLength(1);
    // Die Liste der Runden führt sie mit art.
    const liste = await json(await get(`/organisationen/${ID.orgA}/finanzierungsrunden`, "a"));
    expect(liste.daten.find((x: { id: string }) => x.id === r.id)).toMatchObject({ art: "bruecke" });
  });

  it("lehnt Bewertung und Positionen ab, ebenso Abschließen, Wiedereröffnen und Positionen nachträglich", async () => {
    expect((await anlegen({ ...BRUECKE, preMoney: "1000.00" })).status).toBe(400);
    expect((await anlegen({ ...BRUECKE, positionen: [{ fondsId: ID.fonds, betrag: "100.00", anteile: "10", rolle: "lead" }] })).status).toBe(400);
    expect((await anlegen({ bezeichnung: "Ohne Preis", datum: "2026-03-01" })).status).toBe(400);
    const r = await json(await anlegen());
    const position = await post(`/finanzierungsrunden/${r.id}/positionen`, { fondsId: ID.fonds, betrag: "100.00", anteile: "10", rolle: "lead" }, "a");
    expect(position.status).toBe(409);
    expect((await json(position)).error.code).toBe("round_bridge_without_shares");
    expect((await json(await post(`/finanzierungsrunden/${r.id}/abschliessen`, {}, "a"))).error.code).toBe("round_type_bridge");
    expect((await json(await post(`/finanzierungsrunden/${r.id}/wiedereroeffnen`, { grund: "Test" }, "a"))).error.code).toBe("round_type_bridge");
    const bewertung = await patch(`/finanzierungsrunden/${r.id}`, { preMoney: "5.00" }, "a");
    expect(bewertung.status).toBe(409);
    expect((await patch(`/finanzierungsrunden/${r.id}`, { bezeichnung: "Brücke II", datum: "2026-04-01" }, "a")).status).toBe(200);
    expect((await get(`/finanzierungsrunden/${r.id}`, "a").then(json)).bezeichnung).toBe("Brücke II");
  });

  it("eigene Felder (Volumen, Notizen) gehen an einer Brückenrunde wie an jeder Runde", async () => {
    const r = await json(await anlegen());
    const feld = await post("/crm/felder", { objekt: "runde", name: "Notiz", typ: "text" }, "a");
    expect(feld.status).toBe(201);
    const definition = await json(feld);
    const gesetzt = await put(`/finanzierungsrunden/${r.id}/felder`, { werte: { [definition.id]: "Überbrückung bis zur nächsten Runde" } }, bearbeiterF1);
    expect(gesetzt.status).toBe(200);
    const gelesen = await json(await get(`/finanzierungsrunden/${r.id}/felder`, betrachterF1));
    expect(JSON.stringify(gelesen)).toContain("Überbrückung bis zur nächsten Runde");
  });

  it("PATCH ohne tatsächliche Änderung der Art ist kein Fehler", async () => {
    const r = await json(await anlegen());
    const antwort = await patch(`/finanzierungsrunden/${r.id}`, { art: "bruecke" }, "a");
    expect(antwort.status).toBe(200);
    expect((await json(antwort)).art).toBe("bruecke");
  });

  it("lässt sich zu Eigenkapital und zurück umstellen, solange nichts daran hängt", async () => {
    const r = await json(await anlegen());
    const zuEigenkapital = await patch(`/finanzierungsrunden/${r.id}`, { art: "eigenkapital" }, "a");
    expect(zuEigenkapital.status).toBe(400);
    const ok = await json(await patch(`/finanzierungsrunden/${r.id}`, { art: "eigenkapital", preMoney: "1000.00", preisJeAnteil: "1.0000" }, "a"));
    expect(ok).toMatchObject({ art: "eigenkapital", status: "entwurf", preMoney: "1000.00", postMoney: "1000.00" });
    const zurueck = await json(await patch(`/finanzierungsrunden/${r.id}`, { art: "bruecke" }, "a"));
    expect(zurueck).toMatchObject({ art: "bruecke", status: "abgeschlossen", preMoney: null });
    // Mit Position (Entwurf) nicht.
    const entwurf = await json(await anlegen({ bezeichnung: "E", datum: "2026-05-01", preMoney: "1000.00", preisJeAnteil: "1.0000", positionen: [{ fondsId: ID.fonds, betrag: "100.00", anteile: "100", rolle: "lead" }] }));
    expect((await json(await patch(`/finanzierungsrunden/${entwurf.id}`, { art: "bruecke" }, "a"))).error.code).toBe("round_bridge_without_shares");
  });

  it("nimmt Darlehensinstrumente auf, Eigenkapital nicht; die Wandlung verlangt eine Eigenkapitalrunde", async () => {
    const r = await json(await anlegen(BRUECKE, "a", ID.orgC));
    const darlehen = await post(`/beteiligungen/${ID.wandel}/instrumente`, { art: "wandeldarlehen", bezeichnung: "Brückendarlehen", rundeId: r.id }, "a");
    expect(darlehen.status).toBe(201);
    const eigenkapital = await post(`/beteiligungen/${ID.wandel}/instrumente`, { art: "offene_beteiligung", rundeId: r.id }, "a");
    expect(eigenkapital.status).toBe(409);
    expect((await json(eigenkapital)).error.code).toBe("instrument_round_bridge");
    const stille = await post(`/beteiligungen/${ID.wandel}/instrumente`, { art: "stille_beteiligung", rundeId: r.id }, "a");
    expect((await json(stille)).error.code).toBe("instrument_round_bridge");
    const d = await json(darlehen);
    const umstellen = await patch(`/instrumente/${d.id}`, { art: "offene_beteiligung" }, "a");
    expect(umstellen.status).toBe(409);
    expect((await json(umstellen)).error.code).toBe("instrument_round_bridge");

    // Das Darlehen bucht auf die Brücke (Instrument), die Wandlung auf die Zielrunde.
    await buchung(ID.wandel, { type: "commitment", valueDate: "2026-01-01", amount: "200000", instrumentId: d.id });
    await buchung(ID.wandel, { type: "disbursement", valueDate: "2026-01-01", amount: "100000", instrumentId: d.id });
    await post(`/beteiligungen/${ID.wandel}/konditionen`, { gueltigAb: "2026-01-01", satzFix: "0.06", methode: "30E/360", zinsperiode: "jaehrlich", anker: "2027-01-01", instrumentId: d.id }, "a");
    const vorherZeilen = await db.select().from(s.vorgangRunde);
    expect(vorherZeilen.filter((z) => z.rundeId === r.id)).toHaveLength(2);
    const basis = { cutoff: "2026-07-01", zinsenWandeln: true, preisregel: { rundenpreisJeAnteil: "12.5", discount: "0.2" }, nennwertJeAnteil: "1", instrumentId: d.id };
    const zurBruecke = await post(`/beteiligungen/${ID.wandel}/wandlung`, { ...basis, runde: { id: r.id } }, "a");
    expect(zurBruecke.status).toBe(409);
    expect((await json(zurBruecke)).error.code).toBe("round_not_equity");

    const ziel = await json(await post(`/organisationen/${ID.orgC}/finanzierungsrunden`, { bezeichnung: "Serie A", datum: "2026-07-01", preMoney: "8000000.00", preisJeAnteil: "12.5000", positionen: [{ organisationId: ID.orgA, betrag: "1000000.00", anteile: "80000", rolle: "lead" }] }, "a"));
    await post(`/finanzierungsrunden/${ziel.id}/abschliessen`, {}, "a");
    const w = await json(await post(`/beteiligungen/${ID.wandel}/wandlung`, { ...basis, runde: { id: ziel.id } }, "a"));
    const ids = Object.values(w.vorgangIds) as string[];
    expect(ids.length).toBeGreaterThanOrEqual(4);
    for (const id of ids) expect(await zeile(id), id).toMatchObject({ rundeId: ziel.id, quelle: "automatisch" });
    // Zusage und Auszahlung des Darlehens davor bleiben auf der Brücke.
    expect((await db.select().from(s.vorgangRunde).where(eq(s.vorgangRunde.rundeId, r.id)))).toHaveLength(2);
    const transaktionen = await json(await get(`/organisationen/${ID.orgC}/rundentransaktionen`, "a"));
    const ziele = transaktionen.runden.find((x: { id: string }) => x.id === ziel.id).transaktionen;
    expect(ziele.length).toBeGreaterThanOrEqual(4);
    expect(ziele.find((t: { art: string; instrument: { art: string } }) => t.art === "zusage" && t.instrument.art === "offene_beteiligung").anteile).toBe(w.wandlung.anzahlAnteile);
  });

  it("verändert Kapitaltabelle, Exit-Szenario, Kennzahlen und die Bewertung nach letzter Runde nicht", async () => {
    await buchung(ID.eigen, { type: "commitment", valueDate: "2025-01-12", amount: "300000" });
    await buchung(ID.eigen, { type: "disbursement", valueDate: "2025-01-15", amount: "300000" });
    const stichtag = "2026-12-31";
    const lesen = async () => ({
      kapital: await json(await get(`/beteiligungen/${ID.eigen}/kapitaltabelle?stichtag=${stichtag}`, "a")),
      wasserfall: await json(await post(`/beteiligungen/${ID.eigen}/wasserfall`, { exitwert: "10000000", exitdatum: stichtag }, "a")),
      beteiligung: await json(await get(`/beteiligungen/${ID.eigen}?stichtag=${stichtag}`, "a")),
      runden: await json(await get(`/beteiligungen/${ID.eigen}/runden?alle=1`, "a")),
      fonds: await json(await get(`/fonds/${ID.fonds}/beteiligungen?stichtag=${stichtag}`, "a")),
    });
    const bewertungVorschlag = async () => {
      const antwort = await post(`/fonds/${ID.fonds}/bewertungsrunde`, { stichtag: "2026-06-30", vorschlag: "letzte_runde" }, "a");
      expect(antwort.status).toBe(201);
      const d = await json(antwort);
      const zeilen = (await db.select().from(s.bewertung).where(and(eq(s.bewertung.beteiligungId, ID.eigen), eq(s.bewertung.status, "entwurf")))).map((b) => ({ wert: b.wert, methode: b.methode, begruendung: b.begruendung }));
      expect((await post(`/bewertungsrunden/${d.runde.id}/verwerfen`, undefined, "a")).status).toBe(200);
      return zeilen;
    };
    const vorher = await lesen();
    const bewertungVorher = await bewertungVorschlag();
    expect(bewertungVorher).toEqual([expect.objectContaining({ methode: "letzte_runde", wert: "450000.00" })]);

    // Brückenrunde nach der letzten bewerteten Runde, dazu ein Darlehen daran und eine Buchung auf einer anderen Beteiligung.
    const bruecke = await json(await anlegen({ ...BRUECKE, datum: "2026-03-01" }));
    const darlehen = await post(`/beteiligungen/${ID.eigen}/instrumente`, { art: "darlehen", bezeichnung: "Brückendarlehen", rundeId: bruecke.id }, "a");
    expect(darlehen.status).toBe(201);
    const darlehenId = (await json(darlehen)).id as string;

    // Das neue Instrument selbst erscheint in den Listen der Instrumente; alles andere bleibt gleich.
    const ohneDarlehen = (wert: unknown): unknown =>
      JSON.parse(JSON.stringify(wert, (schluessel, v) => (schluessel === "instrumente" && Array.isArray(v) ? v.filter((i: { id?: string }) => i.id !== darlehenId) : v)));
    const nachher = ohneDarlehen(await lesen()) as Awaited<ReturnType<typeof lesen>>;
    expect(nachher).toEqual(vorher);
    expect(await bewertungVorschlag()).toEqual(bewertungVorher);
    // Kapitaltabelle: Zeilen führen keine Brücke; die letzte Runde bleibt Serie A.
    expect(nachher.kapital.letzteRunde).toMatchObject({ bezeichnung: "Serie A" });
    // Die Brücke steht in der Rundenliste der Organisation.
    const liste = await json(await get(`/organisationen/${ID.orgA}/finanzierungsrunden`, "a"));
    expect(liste.daten.map((x: { art: string }) => x.art).sort()).toEqual(["bruecke", "eigenkapital", "eigenkapital"]);
  });
});
