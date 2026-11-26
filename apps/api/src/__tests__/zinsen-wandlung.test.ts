import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { erstelleTestApp } from "./hilfen-auth";
import { leeren, oeffneTestdb } from "./hilfen";
import { aufrufe, grundbestand, ID, json, leereAuftraege } from "./hilfen-instrumente";

/** Zinsansichten nach einer Wandlung: Zinsen, die in Anteile gewandelt wurden, sind durch die Wandlung beglichen und nie offen. */

const { db, pool } = oeffneTestdb();
const { get, post } = aufrufe(erstelleTestApp(db));

const KONDITION = { gueltigAb: "2026-01-01", satzFix: "0.06", methode: "30E/360", zinsperiode: "jaehrlich", anker: "2027-01-01" };
const RUNDE_NEU = { bezeichnung: "Serie A", preMoney: "8000000", postMoney: "10000000", preisJeAnteil: "12.5", anteileGesamtNach: "800000" };
const basis = { cutoff: "2026-07-01", zinsenWandeln: true, preisregel: { rundenpreisJeAnteil: "12.5", discount: "0.2" }, nennwertJeAnteil: "1", runde: { neu: RUNDE_NEU } };
const wandle = (koerper: object) => post(`/beteiligungen/${ID.wandel}/wandlung`, koerper, "bearbeiter");

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

describe("Zinsansichten nach einer Wandlung", () => {
  it("Zinsen, die mit gewandelt werden: gewandelt statt offen, in Beteiligung, Fonds und Instrumentdaten", async () => {
    expect((await wandle(basis)).status).toBe(201);
    const a = await json(await get(`/beteiligungen/${ID.wandel}/zinsen?stichtag=2026-12-31`));
    const i = a.instrumente.find((x: { art: string }) => x.art === "wandeldarlehen");
    expect(i).toMatchObject({ status: "gewandelt", gebucht: "3000.00", kapitalisiert: "0.00", gezahlt: "0.00", gewandelt: "3000.00", offen: "0.00", naechsteFaelligkeit: null });
    expect(i.perioden).toHaveLength(1);
    expect(i.perioden[0]).toMatchObject({ bis: "2026-07-01", betrag: "3000.00", gezahlt: "0.00", gewandelt: "3000.00", offen: "0.00", status: "gewandelt", faellig: null });
    expect(a.summe).toMatchObject({ gebucht: "3000.00", gezahlt: "0.00", gewandelt: "3000.00", offen: "0.00" });

    const f = await json(await get(`/fonds/${ID.fonds}/zinsen?stichtag=2026-12-31`));
    expect(f.instrumente.find((x: { art: string }) => x.art === "wandeldarlehen")).toMatchObject({ gewandelt: "3000.00", offen: "0.00" });
    expect(f.summe).toMatchObject({ gewandelt: "3000.00", offen: "0.00", gezahlt: "0.00" });

    const d = await json(await get(`/beteiligungen/${ID.wandel}/instrumentdaten?stichtag=2026-12-31`));
    expect(d.instrumente.find((x: { art: string }) => x.art === "wandeldarlehen")).toMatchObject({ gewandelteZinsen: "3000.00", offeneZinsen: "0.00", gezahlteZinsen: "0.00" });

    // Vor dem Cut-off gibt es die Zinsbuchung noch nicht.
    const frueh = await json(await get(`/beteiligungen/${ID.wandel}/zinsen?stichtag=2026-06-30`));
    expect(frueh.summe).toMatchObject({ gebucht: "0.00", gewandelt: "0.00", offen: "0.00" });
  });

  it("Zinsen, die ausgezahlt werden: bleiben eine offene Forderung, bis die Zahlung erfasst ist", async () => {
    expect((await wandle({ ...basis, zinsenWandeln: false })).status).toBe(201);
    const a = await json(await get(`/beteiligungen/${ID.wandel}/zinsen?stichtag=2026-12-31`));
    const i = a.instrumente.find((x: { art: string }) => x.art === "wandeldarlehen");
    expect(i).toMatchObject({ gebucht: "3000.00", gewandelt: "0.00", offen: "3000.00" });
    expect(i.perioden[0]).toMatchObject({ gewandelt: "0.00", offen: "3000.00", status: "offen" });
    expect(a.summe).toMatchObject({ gewandelt: "0.00", offen: "3000.00" });
    const f = await json(await get(`/fonds/${ID.fonds}/zinsen?stichtag=2026-12-31`));
    expect(f.summe).toMatchObject({ gewandelt: "0.00", offen: "3000.00" });
  });
});
