import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { erstelleTestApp, legePersonAn, person } from "./hilfen-auth";
import { leeren, oeffneTestdb } from "./hilfen";
import { anzahl, aufrufe, auftraege, grundbestand, ID, json, leereAuftraege, protokollZeilen } from "./hilfen-instrumente";

const { db, pool } = oeffneTestdb();
const { get, post, put } = aufrufe(erstelleTestApp(db));

const F1 = ID.fonds;
const F2 = ID.anderer;
const B_ANDERER_FONDS = "00000000-0000-4000-8000-0000000000c2";
const bearbeiterF1 = person("buchung-bearbeiter-f1", { rollen: { [F1]: "bearbeiter" } });
const betrachterF1 = person("buchung-betrachter-f1", { rollen: { [F1]: "betrachter" } });
const bearbeiterF2 = person("buchung-bearbeiter-f2", { rollen: { [F2]: "bearbeiter" } });

const buche = (fonds: string, koerper: unknown, als?: Parameters<typeof post>[2]) => post(`/funds/${fonds}/postings`, koerper, als);
const sperre = (gesperrtBis: string) => put(`/fonds/${F1}/periodensperre`, { gesperrtBis, grund: "Abschluss" });

beforeEach(async () => {
  await grundbestand(db);
  await db.insert(s.beteiligung).values({ id: B_ANDERER_FONDS, fondsId: F2, organisationId: ID.orgA, instrument: "offene_beteiligung", erstinvestment: "2025-01-01" });
  for (const p of [bearbeiterF1, betrachterF1, bearbeiterF2]) await legePersonAn(db, p);
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

describe("POST /fonds/:id/buchungen: Vorgänge", () => {
  it("bucht jede Vorgangsart über dieselbe Logik wie die Route der Beteiligung (Protokoll, Snapshot-Auftrag)", async () => {
    await leereAuftraege(db);
    const zusage = await buche(F1, { kind: "commitment", investmentId: ID.darlehen, valueDate: "2025-01-10", amount: "100000", remark: "Vertrag" }, bearbeiterF1);
    expect(zusage.status).toBe(201);
    const z = await json(zusage);
    expect(z).toMatchObject({ kind: "commitment", transaction: { type: "commitment", amount: "100000.00", investmentId: ID.darlehen, remark: "Vertrag" } });
    expect(await auftraege(db)).toBe(1);
    const zeilen = await protokollZeilen(db, "vorgang", "anlegen");
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]).toMatchObject({ akteur_name: bearbeiterF1.name, datensatz_id: z.transaction.id });

    expect((await buche(F1, { kind: "disbursement", investmentId: ID.darlehen, valueDate: "2025-02-01", amount: "60000" }, bearbeiterF1)).status).toBe(201);
    expect((await buche(F1, { kind: "repayment", investmentId: ID.darlehen, valueDate: "2025-06-01", amount: "10000" }, bearbeiterF1)).status).toBe(201);
    expect((await buche(F1, { kind: "return_flow", investmentId: ID.eigen, valueDate: "2025-07-01", amount: "2500.50" }, bearbeiterF1)).status).toBe(201);
    const wb = await buche(F1, { kind: "impairment", investmentId: ID.darlehen, valueDate: "2025-08-01", amount: "5000" }, bearbeiterF1);
    expect(wb.status).toBe(201);
    expect((await json(wb)).bookValue).toBe("45000.00");
    expect(await anzahl(db, "vorgang")).toBe(5);
  });

  it("wendet die Invarianten an: Auszahlung über Zusage, Tilgung bei offener Beteiligung, nicht aktive Beteiligung", async () => {
    await buche(F1, { kind: "commitment", investmentId: ID.darlehen, valueDate: "2025-01-10", amount: "1000" });
    const zuViel = await buche(F1, { kind: "disbursement", investmentId: ID.darlehen, valueDate: "2025-02-01", amount: "1000.01" });
    expect(zuViel.status).toBe(409);
    expect((await json(zuViel)).error.code).toBe("disbursement_exceeds_commitment");
    const falsch = await buche(F1, { kind: "repayment", investmentId: ID.eigen, valueDate: "2025-02-01", amount: "10" });
    expect((await json(falsch)).error.code).toBe("instrument_mismatch");
    await db.update(s.beteiligung).set({ status: "exit" }).where(eq(s.beteiligung.id, ID.eigen));
    const inaktiv = await buche(F1, { kind: "commitment", investmentId: ID.eigen, valueDate: "2025-02-01", amount: "10" });
    expect((await json(inaktiv)).error.code).toBe("investment_not_active");
    expect(await anzahl(db, "vorgang")).toBe(1);
  });

  it("respektiert die Periodensperre mit gesperrtBis", async () => {
    await sperre("2025-03-31");
    const antwort = await buche(F1, { kind: "commitment", investmentId: ID.darlehen, valueDate: "2025-03-31", amount: "10" });
    expect(antwort.status).toBe(409);
    expect((await json(antwort)).error).toMatchObject({ code: "period_locked", lockedUntil: "2025-03-31" });
    expect((await buche(F1, { kind: "commitment", investmentId: ID.darlehen, valueDate: "2025-04-01", amount: "10" })).status).toBe(201);
  });

  it("lehnt eine Beteiligung eines anderen Fonds ab und prüft die Rolle an beiden Fonds", async () => {
    const fremd = await buche(F1, { kind: "commitment", investmentId: B_ANDERER_FONDS, valueDate: "2025-04-01", amount: "10" });
    expect(fremd.status).toBe(409);
    expect((await json(fremd)).error.code).toBe("investment_not_in_fund");
    // Bearbeiter von F1 darf nicht über den Pfad von F1 in die Beteiligung von F2 buchen (Rolle am Fonds der Beteiligung fehlt)
    expect((await buche(F1, { kind: "commitment", investmentId: B_ANDERER_FONDS, valueDate: "2025-04-01", amount: "10" }, bearbeiterF1)).status).toBe(403);
    expect((await buche(F1, { kind: "commitment", investmentId: ID.darlehen, valueDate: "2025-04-01", amount: "10" }, bearbeiterF2)).status).toBe(403);
    expect((await buche(F1, { kind: "commitment", investmentId: ID.darlehen, valueDate: "2025-04-01", amount: "10" }, betrachterF1)).status).toBe(403);
    const unbekannt = await buche(F1, { kind: "commitment", investmentId: "00000000-0000-4000-8000-0000000000ff", valueDate: "2025-04-01", amount: "10" });
    expect((await json(unbekannt)).error.code).toBe("investment_not_found");
    expect(await anzahl(db, "vorgang")).toBe(0);
  });

  it("verlangt gültige Eingaben je Typ und sammelt Feldfehler", async () => {
    const antwort = await buche(F1, { kind: "disbursement", investmentId: ID.darlehen, valueDate: "morgen", amount: "-5" });
    expect(antwort.status).toBe(400);
    expect((await json(antwort)).error.fields.map((f: { field: string }) => f.field).sort()).toEqual(["amount", "valueDate"]);
    expect((await buche(F1, { kind: "unknown", valueDate: "2025-01-01", amount: "5" })).status).toBe(400);
    expect((await buche(F1, { kind: "fund_posting", type: "interest", valueDate: "2025-01-01", amount: "5" })).status).toBe(400);
    expect((await buche(F1, { kind: "commitment", valueDate: "2025-01-01", amount: "5" })).status).toBe(400);
  });
});

describe("POST /fonds/:id/buchungen: Fondsbewegungen", () => {
  it("bucht Abruf und Ausschüttung mit Protokoll und Snapshot-Auftrag", async () => {
    await leereAuftraege(db);
    const abruf = await buche(F1, { kind: "fund_posting", type: "capital_call", valueDate: "2025-03-01", amount: "2500000", remark: "Erster Abruf" }, bearbeiterF1);
    expect(abruf.status).toBe(201);
    const a = await json(abruf);
    expect(a).toMatchObject({ kind: "fund_posting", movement: { type: "capital_call", amount: "2500000.00", valueDate: "2025-03-01", fundId: F1, reversedMovementId: null } });
    expect(await auftraege(db)).toBe(1);
    const zeilen = await protokollZeilen(db, "fonds_bewegung", "anlegen");
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]).toMatchObject({ akteur_name: bearbeiterF1.name, datensatz_id: a.movement.id });
    expect((await buche(F1, { kind: "fund_posting", type: "distribution", valueDate: "2025-09-01", amount: "100000" }, bearbeiterF1)).status).toBe(201);
    expect(await anzahl(db, "fonds_bewegung")).toBe(2);
    // Das Änderungsprotokoll ordnet die Zeilen dem Fonds zu
    const fondsZeilen = await db.execute(sql`SELECT count(*)::int AS n FROM aenderung WHERE tabelle = 'fonds_bewegung' AND fonds_id = ${F1}`);
    expect(Number(fondsZeilen.rows[0]?.n)).toBe(2);
  });

  it("Abrufe dürfen das Zeichnungskapital in Summe nicht übersteigen, Ausschüttungen schon", async () => {
    expect((await buche(F1, { kind: "fund_posting", type: "capital_call", valueDate: "2025-03-01", amount: "9000000" })).status).toBe(201);
    const zuViel = await buche(F1, { kind: "fund_posting", type: "capital_call", valueDate: "2025-04-01", amount: "1000000.01" });
    expect(zuViel.status).toBe(409);
    expect((await json(zuViel)).error).toMatchObject({ code: "call_exceeds_subscribed_capital", subscribedCapital: "10000000.00", called: "9000000.00", amount: "1000000.01" });
    expect((await buche(F1, { kind: "fund_posting", type: "capital_call", valueDate: "2025-04-01", amount: "1000000" })).status).toBe(201);
    expect((await buche(F1, { kind: "fund_posting", type: "distribution", valueDate: "2025-05-01", amount: "12000000" })).status).toBe(201);
    expect(await anzahl(db, "fonds_bewegung")).toBe(3);
  });

  it("respektiert die Periodensperre (API und Trigger) und das Fondsrecht", async () => {
    await sperre("2025-06-30");
    const antwort = await buche(F1, { kind: "fund_posting", type: "capital_call", valueDate: "2025-06-30", amount: "1" });
    expect(antwort.status).toBe(409);
    expect((await json(antwort)).error).toMatchObject({ code: "period_locked", lockedUntil: "2025-06-30" });
    expect((await buche(F1, { kind: "fund_posting", type: "capital_call", valueDate: "2025-07-01", amount: "1" })).status).toBe(201);
    // Der Trigger greift auch, wenn ein Weg die Prüfung der API umgeht
    await expect(db.insert(s.fondsBewegung).values({ fondsId: F1, art: "ausschuettung", valuta: "2025-06-01", betrag: "1.00" })).rejects.toThrow();
    expect((await buche(F1, { kind: "fund_posting", type: "capital_call", valueDate: "2025-08-01", amount: "1" }, betrachterF1)).status).toBe(403);
    expect((await buche(F1, { kind: "fund_posting", type: "capital_call", valueDate: "2025-08-01", amount: "1" }, bearbeiterF2)).status).toBe(403);
    expect((await buche(ID.fonds.replace(/f1$/, "ee"), { kind: "fund_posting", type: "capital_call", valueDate: "2025-08-01", amount: "1" })).status).toBe(404);
  });
});

describe("POST /fondsbewegungen/:id/storno", () => {
  const abrufBuchen = async (valuta = "2025-03-01", betrag = "1000000") => {
    const antwort = await buche(F1, { kind: "fund_posting", type: "capital_call", valueDate: valuta, amount: betrag });
    return (await json(antwort)).movement.id as string;
  };
  const storno = (id: string, koerper: unknown = { grund: "Falscher Betrag" }, als?: Parameters<typeof post>[2]) => post(`/fondsbewegungen/${id}/storno`, koerper, als);

  it("bucht die Gegenbuchung mit negiertem Betrag; die Summe ergibt null, Zeilen bleiben unveränderlich", async () => {
    const id = await abrufBuchen();
    const antwort = await storno(id, { grund: "Falscher Betrag", valuta: "2025-03-05" }, bearbeiterF1);
    expect(antwort.status).toBe(201);
    const d = await json(antwort);
    expect(d.storno).toMatchObject({ art: "abruf", betrag: "-1000000.00", valuta: "2025-03-05", storniertBewegungId: id, bemerkung: "Storno: Falscher Betrag" });
    expect(d.original.id).toBe(id);
    const summe = await db.execute(sql`SELECT sum(betrag)::text AS s FROM fonds_bewegung WHERE fonds_id = ${F1}`);
    expect(Number(summe.rows[0]?.s)).toBe(0);
    expect(await protokollZeilen(db, "fonds_bewegung", "storno")).toHaveLength(1);
    await expect(db.execute(sql`UPDATE fonds_bewegung SET bemerkung = 'x' WHERE id = ${id}`)).rejects.toThrow();
    await expect(db.execute(sql`DELETE FROM fonds_bewegung WHERE id = ${id}`)).rejects.toThrow();
    // Das Zeichnungskapital steht danach wieder zur Verfügung
    expect((await buche(F1, { kind: "fund_posting", type: "capital_call", valueDate: "2025-04-01", amount: "10000000" })).status).toBe(201);
  });

  it("lehnt ein zweites Storno, ein Storno des Storno, eine frühere Valuta, die Periodensperre und fehlende Rechte ab", async () => {
    const id = await abrufBuchen("2025-03-10");
    const frueher = await storno(id, { grund: "x", valuta: "2025-03-09" });
    expect(frueher.status).toBe(400);
    expect((await json(frueher)).error.fields[0]).toMatchObject({ field: "valuta", code: "reversal_before_original" });
    expect((await storno(id, { grund: "x" }, betrachterF1)).status).toBe(403);
    expect((await storno(id, { grund: "x" }, bearbeiterF2)).status).toBe(403);
    expect((await storno(id, { grund: "" })).status).toBe(400);
    const erstes = await storno(id, { grund: "Fehler", valuta: "2025-03-20" });
    expect(erstes.status).toBe(201);
    const zweites = await storno(id);
    expect(zweites.status).toBe(409);
    expect((await json(zweites)).error.code).toBe("already_reversed");
    const stornoId = (await json(erstes)).storno.id as string;
    const vomStorno = await storno(stornoId);
    expect(vomStorno.status).toBe(409);
    expect((await json(vomStorno)).error.code).toBe("reversal_not_allowed");
    expect((await storno("00000000-0000-4000-8000-0000000000ff")).status).toBe(404);

    const spaeter = await abrufBuchen("2025-05-05", "1");
    await sperre("2025-12-31");
    const gesperrt = await storno(spaeter, { grund: "x", valuta: "2025-12-31" });
    expect(gesperrt.status).toBe(409);
    expect((await json(gesperrt)).error.code).toBe("period_locked");
  });

  it("Storno und Original fallen aus Zahlungsstrom und Anzahl der Kennzahlen heraus, die Summen bleiben", async () => {
    await buche(F1, { kind: "commitment", investmentId: ID.darlehen, valueDate: "2025-01-10", amount: "100000" });
    const behalten = await abrufBuchen("2025-02-01", "500000");
    const falsch = await abrufBuchen("2025-03-01", "700000");
    await storno(falsch, { grund: "Falscher Betrag", valuta: "2025-03-15" });
    const ansicht = await get(`/fonds/${F1}/uebersicht?stichtag=2025-12-31&stand=${encodeURIComponent(new Date(Date.now() + 60_000).toISOString())}`);
    const u = await json(ansicht);
    expect(Number(u.kennzahlen.abgerufen.wert)).toBe(500000);
    expect(u.kennzahlen.abgerufen.schritte[0].wert).toBe("1");
    // Mit einem Wissensstand vor dem Storno zählt die Fehlbuchung noch
    const vorher = await db.execute(sql`SELECT erfasst_am FROM fonds_bewegung WHERE id = ${falsch}`);
    const stand = new Date(new Date(String(vorher.rows[0]?.erfasst_am)).getTime() + 1).toISOString();
    const frueh = await json(await get(`/fonds/${F1}/uebersicht?stichtag=2025-12-31&stand=${encodeURIComponent(stand)}`));
    expect(Number(frueh.kennzahlen.abgerufen.wert)).toBe(1200000);
    // Vor der Valuta des Storno zählt die Fehlbuchung ebenfalls noch
    const zwischen = await json(await get(`/fonds/${F1}/uebersicht?stichtag=2025-03-10`));
    expect(Number(zwischen.kennzahlen.abgerufen.wert)).toBe(1200000);
    void behalten;
  });
});
