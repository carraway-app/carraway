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

const buchung = "/fonds/" + ID.fonds + "/buchungen";
const vorschau = (betrag: string, art = "abruf") => `/fonds/${ID.fonds}/fondsbewegungen/vorschau?art=${art}&valuta=2025-02-01&betrag=${betrag}`;
const detail = (id: string) => `/fondsbewegungen/${id}`;
const freigabe = (id: string) => `/fonds/${ID.fonds}/bewegungen/${id}/mitteilungen/freigeben`;
const abruf = { typ: "fondsbewegung", art: "abruf", valuta: "2025-02-01", betrag: "0.01" };
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
    expect(gleich).toMatchObject({ betrag: "0.05", waehrung: "EUR", verteilungsbasis: "anteil", verteilungsquelle: "berechnet", aufteilung: [
      { organisationId: ID.orgA, investor: "Alpha Beispiel", zusage: "2500000.00", anteil: "0.500000", betrag: "0.03" },
      { organisationId: ID.orgB, investor: "Beta Beispiel", betrag: "0.02" },
    ] });
    expect(gleich.aufteilung[0].zeichnungId).toEqual(expect.any(String));
    await db.update(s.fonds).set({ lpVerteilungNachZusage: true }).where(eq(s.fonds.id, ID.fonds));
    const vor = await json(await get(vorschau("0.05", "ausschuettung")));
    expect(vor).toMatchObject({ art: "ausschuettung", verteilungsbasis: "zusage", aufteilung: [{ betrag: "0.01" }, { betrag: "0.04" }] });
    expect(await anzahl(db, "fonds_bewegung")).toBe(0);
    expect(await anzahl(db, "aenderung", "tabelle = 'fonds_bewegung'")).toBe(0);
    const { bewegung } = await json(await post(buchung, { ...abruf, art: "ausschuettung", betrag: "0.05" }));
    expect(await json(await get(detail(bewegung.id)))).toMatchObject(vor);
  });

  it("zeigt freigegebene Beträge nach einer Namensänderung und spiegelt sie im Storno", async () => {
    await zeichnungenAnlegen();
    const { bewegung } = await json(await post(buchung, abruf));
    expect((await post(freigabe(bewegung.id), {})).status).toBe(409);
    expect((await post(freigabe(bewegung.id), {}, "andere-freigabe")).status).toBe(201);
    await db.update(s.organisation).set({ name: "Zeta Beispiel" }).where(eq(s.organisation.id, ID.orgA));
    expect(await json(await get(vorschau("0.01")))).toMatchObject({ aufteilung: [{ organisationId: ID.orgB, betrag: "0.01" }, { organisationId: ID.orgA, betrag: "0.00" }] });
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
    expect(await json(await get(vorschau("0.01")))).toMatchObject({ verteilungsbasis: null, verteilungsquelle: null, aufteilung: [] });
    const { bewegung } = await json(await post(buchung, abruf));
    expect(await json(await get(detail(bewegung.id)))).toMatchObject({ verteilungsbasis: null, verteilungsquelle: null, aufteilung: [] });
    expect((await get(vorschau("0.001"))).status).toBe(400);
    const ueber = await get(vorschau("10000000"));
    expect(ueber.status).toBe(409);
    expect((await json(ueber)).fehler.code).toBe("ABRUF_UEBER_ZEICHNUNGSKAPITAL");
    await db.insert(s.periodensperre).values({ fondsId: ID.fonds, gesperrtBis: "2025-02-01", gesetztVon: "test" });
    const gesperrt = await get(vorschau("0.01"));
    expect(gesperrt.status).toBe(409);
    expect((await json(gesperrt)).fehler.code).toBe("PERIODE_GESPERRT");
  });

  it("beschränkt Detail und Vorschau auf interne Fondsrollen und verlangt für die Vorschau Bearbeiterrechte", async () => {
    await zeichnungenAnlegen();
    await legePersonAn(db, betrachter);
    await legePersonAn(db, fremderFonds);
    await legeInvestorAn(db, investor, [ID.orgA]);
    const { bewegung } = await json(await post(buchung, abruf));
    expect((await get(detail(bewegung.id), betrachter)).status).toBe(200);
    expect((await get(vorschau("0.01"), betrachter)).status).toBe(403);
    for (const als of [fremderFonds, investor]) {
      expect((await get(detail(bewegung.id), als)).status).toBe(403);
      expect((await get(vorschau("0.01"), als)).status).toBe(403);
    }
  });
});
