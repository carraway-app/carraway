import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { erstelleTestApp, legeInvestorAn, legePersonAn, person } from "./hilfen-auth";
import { leeren, oeffneTestdb } from "./hilfen";
import { anzahl, aufrufe, grundbestand, ID, json } from "./hilfen-instrumente";

const { db, pool } = oeffneTestdb();
const dateien = new Map<string, Uint8Array>();
const { get, post } = aufrufe(erstelleTestApp(db, {
  speicher: {
    schreibe: async (name, daten) => { dateien.set(name, daten); },
    lese: async (name) => dateien.get(name)!,
  },
}));

const buchung = `/funds/${ID.fonds}/postings`;
const vorschau = (betrag: string, art = "capital_call") => `/funds/${ID.fonds}/fund-movements/preview?type=${art}&valueDate=2025-02-01&amount=${betrag}`;
const detail = (id: string) => `/fondsbewegungen/${id}`;
const freigabe = (id: string) => `/fonds/${ID.fonds}/bewegungen/${id}/mitteilungen/freigeben`;
const abruf = { kind: "fund_posting", type: "capital_call", valueDate: "2025-02-01", amount: "0.01" };
const betrachter = person("aufteilung-betrachter", { rollen: { [ID.fonds]: "betrachter" } });
const fremderFonds = person("aufteilung-fremder-fonds", { rollen: { [ID.anderer]: "bearbeiter" } });
const investor = person("aufteilung-investor");

beforeEach(async () => {
  await grundbestand(db);
  dateien.clear();
});

afterAll(async () => {
  await leeren(db);
  await pool.end();
});

async function zeichnungenAnlegen() {
  await db.update(s.organisation).set({ art: "investor" }).where(eq(s.organisation.id, ID.orgA));
  await db.update(s.organisation).set({ art: "investor" }).where(eq(s.organisation.id, ID.orgB));
  await db.insert(s.fondsZeichnung).values([
    { fondsId: ID.fonds, organisationId: ID.orgB, anteil: "0.500000", zusage: "7500000.00" },
    { fondsId: ID.fonds, organisationId: ID.orgA, anteil: "0.500000", zusage: "2500000.00" },
  ]);
}

describe("Aufteilung von Kapitalabrufen und Ausschüttungen", () => {
  it("verteilt in derselben Reihenfolge wie die LP-Konten und nutzt bei neuen Verteilungen die exakten Zusagen", async () => {
    await zeichnungenAnlegen();
    const gleich = await json(await get(vorschau("0.05")));
    expect(gleich).toMatchObject({ amount: "0.05", currency: "EUR", allocationBasis: "share", allocationSource: "calculated", allocation: [
      { organizationId: ID.orgA, investor: "Alpha Beispiel", commitment: "2500000.00", share: "0.500000", amount: "0.03" },
      { organizationId: ID.orgB, investor: "Beta Beispiel", amount: "0.02" },
    ] });
    expect(gleich.allocation[0].subscriptionId).toEqual(expect.any(String));
    await db.update(s.fonds).set({ lpVerteilungNachZusage: true }).where(eq(s.fonds.id, ID.fonds));
    const vor = await json(await get(vorschau("0.05", "distribution")));
    expect(vor).toMatchObject({ type: "distribution", allocationBasis: "commitment", allocation: [{ amount: "0.01" }, { amount: "0.04" }] });
    expect(await anzahl(db, "fonds_bewegung")).toBe(0);
    expect(await anzahl(db, "aenderung", "tabelle = 'fonds_bewegung'")).toBe(0);
    const { movement: bewegung } = await json(await post(buchung, { ...abruf, type: "distribution", amount: "0.05" }));
    expect(await json(await get(detail(bewegung.id)))).toMatchObject({ art: "ausschuettung", betrag: vor.amount, verteilungsbasis: "zusage", aufteilung: vor.allocation.map((a: { organizationId: string; amount: string }) => ({ organisationId: a.organizationId, betrag: a.amount })) });
  });

  it("zeigt freigegebene Beträge nach einer Namensänderung und spiegelt sie im Storno", async () => {
    await zeichnungenAnlegen();
    const { movement: bewegung } = await json(await post(buchung, abruf));
    expect((await post(freigabe(bewegung.id), {})).status).toBe(409);
    expect((await post(freigabe(bewegung.id), {}, "andere-freigabe")).status).toBe(201);
    await db.update(s.organisation).set({ name: "Zeta Beispiel" }).where(eq(s.organisation.id, ID.orgA));
    expect(await json(await get(vorschau("0.01")))).toMatchObject({ allocation: [{ organizationId: ID.orgB, amount: "0.01" }, { organizationId: ID.orgA, amount: "0.00" }] });
    expect(await json(await get(detail(bewegung.id)))).toMatchObject({ verteilungsquelle: "mitteilungen", aufteilung: [{ organisationId: ID.orgB, betrag: "0.00" }, { organisationId: ID.orgA, betrag: "0.01" }] });
    await db.delete(s.fondsZeichnung).where(eq(s.fondsZeichnung.organisationId, ID.orgA));
    await db.insert(s.fondsZeichnung).values({ fondsId: ID.fonds, organisationId: ID.orgC, anteil: "0.500000", zusage: "2500000.00" });
    expect(await json(await get(detail(bewegung.id)))).toMatchObject({ verteilungsquelle: "mitteilungen", aufteilung: [
      { organisationId: ID.orgB, betrag: "0.00" },
      { organisationId: ID.orgA, betrag: "0.01", zeichnungId: null, zusage: null, anteil: null },
    ] });
    const { storno } = await json(await post(`${detail(bewegung.id)}/storno`, { grund: "Korrektur", valuta: "2025-02-01" }));
    expect(await json(await get(detail(bewegung.id)))).toMatchObject({ storniertDurchId: storno.id });
    expect(await json(await get(detail(storno.id)))).toMatchObject({ storniertBewegungId: bewegung.id, verteilungsquelle: "mitteilungen", betrag: "-0.01", aufteilung: [{ betrag: "0.00" }, { betrag: "-0.01" }] });
  });

  it("zeigt fehlende Zeichnungen und verwendet dieselben Buchungsgrenzen in der Vorschau", async () => {
    expect(await json(await get(vorschau("0.01")))).toMatchObject({ allocationBasis: null, allocationSource: null, allocation: [] });
    const { movement: bewegung } = await json(await post(buchung, abruf));
    expect(await json(await get(detail(bewegung.id)))).toMatchObject({ verteilungsbasis: null, verteilungsquelle: null, aufteilung: [] });
    expect((await get(vorschau("0.001"))).status).toBe(400);
    const ueber = await get(vorschau("10000000"));
    expect(ueber.status).toBe(409);
    expect((await json(ueber)).error.code).toBe("call_exceeds_subscribed_capital");
    await db.insert(s.periodensperre).values({ fondsId: ID.fonds, gesperrtBis: "2025-02-01", gesetztVon: "test" });
    const gesperrt = await get(vorschau("0.01"));
    expect(gesperrt.status).toBe(409);
    expect((await json(gesperrt)).error.code).toBe("period_locked");
  });

  it("beschränkt Detail und Vorschau auf interne Fondsrollen und verlangt für die Vorschau Bearbeiterrechte", async () => {
    await zeichnungenAnlegen();
    await legePersonAn(db, betrachter);
    await legePersonAn(db, fremderFonds);
    await legeInvestorAn(db, investor, [ID.orgA]);
    const { movement: bewegung } = await json(await post(buchung, abruf));
    expect((await get(detail(bewegung.id), betrachter)).status).toBe(200);
    expect((await get(vorschau("0.01"), betrachter)).status).toBe(403);
    for (const als of [fremderFonds, investor]) {
      expect((await get(detail(bewegung.id), als)).status).toBe(403);
      expect((await get(vorschau("0.01"), als)).status).toBe(403);
    }
  });
});
