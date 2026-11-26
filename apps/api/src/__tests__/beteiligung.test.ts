import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { erstelleTestApp } from "./hilfen-auth";
import { json, leeren, oeffneTestdb, vehikelVon } from "./hilfen";
import { vorgaengeEinfuegen } from "./instrument-hilfen";

const { db, pool } = oeffneTestdb();
const app = erstelleTestApp(db);

const ID = {
  fonds: "00000000-0000-4000-8000-0000000000f1",
  orgA: "00000000-0000-4000-8000-00000000000a",
  inv: "00000000-0000-4000-8000-0000000000a1",
  deal: "00000000-0000-4000-8000-0000000000e1",
  b: "00000000-0000-4000-8000-0000000000b1",
  falsch: "00000000-0000-4000-8000-0000000000d1",
  runde: "00000000-0000-4000-8000-0000000000c1",
};
const get = (pfad: string) => app.request(`/api/v1/beteiligungen/${pfad}`);

beforeAll(async () => {
  await leeren(db);
  await db.insert(s.organisation).values([
    { id: ID.orgA, name: "Alpha Beispiel", art: "unternehmen", sektor: "Software" },
    { id: ID.inv, name: "Investor Beispiel", art: "investor" },
  ]);
  await db.insert(s.fonds).values({ id: ID.fonds, name: "Testfonds Eins", kurzname: "TF1", vintage: 2024, zeichnungskapital: "10000000.00" });
  await db.insert(s.deal).values({ id: ID.deal, organisationId: ID.orgA, fondsId: ID.fonds, titel: "Alpha Seed", phase: "closing", status: "investiert" });
  await db.insert(s.beteiligung).values({ id: ID.b, fondsId: ID.fonds, organisationId: ID.orgA, dealId: ID.deal, instrument: "offene_beteiligung", erstinvestment: "2023-01-01" });
  await vorgaengeEinfuegen(db, [
    { beteiligungId: ID.b, art: "zusage", valuta: "2023-01-01", betrag: "1000000.00" },
    { id: ID.falsch, beteiligungId: ID.b, art: "auszahlung", valuta: "2023-02-01", betrag: "300000.00" },
    { beteiligungId: ID.b, art: "auszahlung", valuta: "2023-02-05", betrag: "-300000.00", storniertVorgangId: ID.falsch },
    { beteiligungId: ID.b, art: "auszahlung", valuta: "2023-02-05", betrag: "250000.00" },
    { beteiligungId: ID.b, art: "auszahlung", valuta: "2024-06-01", betrag: "250000.00" },
    { beteiligungId: ID.b, art: "rueckfluss", valuta: "2025-06-01", betrag: "100000.00" },
    { beteiligungId: ID.b, art: "zins", valuta: "2024-12-31", betrag: "5000.00" },
  ]);
  await db.insert(s.bewertung).values([
    { beteiligungId: ID.b, stichtag: "2023-12-31", wert: "260000.00", methode: "anschaffungskosten", status: "freigegeben" as const },
    { beteiligungId: ID.b, stichtag: "2024-12-31", wert: "600000.00", methode: "letzte_runde", status: "freigegeben" as const, begruendung: "Runde" },
    { beteiligungId: ID.b, stichtag: "2025-12-31", wert: "700000.00", methode: "letzte_runde", status: "freigegeben" as const },
  ]);
  await db.insert(s.finanzierungsrunde).values({ id: ID.runde, organisationId: ID.orgA, bezeichnung: "Seed-Runde", datum: "2023-02-05", preMoney: "2000000.00", postMoney: "2750000.00", preisJeAnteil: "2.0000", anteileGesamtNach: "1375000" });
  await db.insert(s.rundenposition).values([
    { rundeId: ID.runde, vehikelId: await vehikelVon(db, ID.inv), betrag: "500000.00", anteile: "250000", rolle: "co" },
    { rundeId: ID.runde, fondsId: ID.fonds, betrag: "250000.00", anteile: "125000", rolle: "lead" },
  ]);
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

describe("GET /beteiligungen/:id", () => {
  it("liefert Stammdaten, Organisation, Fonds, Deal und Runden mit Positionen", async () => {
    const d = await json(await get(`${ID.b}?stichtag=2025-12-31`));
    expect(d.stichtag).toBe("2025-12-31");
    expect(d.beteiligung).toMatchObject({ id: ID.b, instrument: "offene_beteiligung", status: "aktiv", erstinvestment: "2023-01-01" });
    expect(d.organisation).toMatchObject({ id: ID.orgA, name: "Alpha Beispiel", sektor: "Software" });
    expect(d.fonds).toMatchObject({ id: ID.fonds, kurzname: "TF1" });
    expect(d.deal).toMatchObject({ id: ID.deal, titel: "Alpha Seed", phase: "closing" });
    expect(d.runden).toHaveLength(1);
    expect(d.runden[0].positionen.map((p: { rolle: string }) => p.rolle)).toEqual(["lead", "co"]);
    expect(d.runden[0].positionen[0]).toMatchObject({ investor: { art: "fonds", name: "Testfonds Eins" }, diesesFonds: true });
    expect(d.runden[0].positionen[1]).toMatchObject({ investor: { art: "organisation", name: "Investor Beispiel" }, diesesFonds: false });
  });

  it("markiert Storno-Paare in den Vorgängen", async () => {
    const d = await json(await get(`${ID.b}?stichtag=2025-12-31`));
    const original = d.vorgaenge.find((v: { id: string }) => v.id === ID.falsch);
    const storno = d.vorgaenge.find((v: { storniertVorgangId: string | null }) => v.storniertVorgangId === ID.falsch);
    expect(original).toMatchObject({ storniert: true, istStorno: false, stornoVorgangId: storno.id });
    expect(storno).toMatchObject({ istStorno: true, storniert: false });
    expect(d.vorgaenge).toHaveLength(7);
  });

  it("zeigt alle Bewertungsstichtage, Vorgänge und Runden aber nur bis zum Stichtag", async () => {
    const d = await json(await get(`${ID.b}?stichtag=2024-06-30`));
    expect(d.bewertungsverlauf.map((w: { stichtag: string }) => w.stichtag)).toEqual(["2023-12-31", "2024-12-31", "2025-12-31"]);
    expect(d.vorgaenge.every((v: { valuta: string }) => v.valuta <= "2024-06-30")).toBe(true);
    const frueh = await json(await get(`${ID.b}?stichtag=2023-01-31`));
    expect(frueh.runden).toHaveLength(0);
  });

  it("rechnet Kennzahlen mit Herkunft", async () => {
    const k = (await json(await get(`${ID.b}?stichtag=2025-12-31`))).kennzahlen;
    expect(k.investiert.wert).toBe("500000");
    expect(k.rueckfluesse.wert).toBe("100000");
    expect(k.bewertung.wert).toBe("700000");
    expect(Number(k.multiple.wert)).toBeCloseTo(1.6, 10);
    for (const name of ["investiert", "rueckfluesse", "bewertung", "multiple", "irr"]) expect(k[name].schritte.length).toBeGreaterThan(0);
    // IRR: -250k (05.02.2023), -250k (01.06.2024), +100k (01.06.2025), +700k (31.12.2025), Storno-Paar ausgenommen.
    expect(Number(k.irr.wert)).toBeGreaterThan(0.2);
    expect(Number(k.irr.wert)).toBeLessThan(0.45);
  });

  it("der Stichtag verändert die Kennzahlen reproduzierbar", async () => {
    const k = (await json(await get(`${ID.b}?stichtag=2024-12-31`))).kennzahlen;
    expect(k.investiert.wert).toBe("500000");
    expect(k.rueckfluesse.wert).toBe("0");
    expect(k.bewertung.wert).toBe("600000");
    const frueh = (await json(await get(`${ID.b}?stichtag=2023-12-31`))).kennzahlen;
    expect(frueh.investiert.wert).toBe("250000");
    expect(frueh.bewertung.wert).toBe("260000");
  });

  it("ohne Stichtag gilt der letzte Bewertungsstichtag des Fonds", async () => {
    expect((await json(await get(ID.b))).stichtag).toBe("2025-12-31");
  });

  it("unbekannte Beteiligung ist 404, ungültige Id 400", async () => {
    const a = await get("00000000-0000-4000-8000-0000000000ff");
    expect(a.status).toBe(404);
    expect((await json(a)).fehler.code).toBe("BETEILIGUNG_NICHT_GEFUNDEN");
    expect((await get("abc")).status).toBe(400);
  });
});
