import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { Decimal } from "@carraway/rechenkern";
import { berechneAnteile } from "../instrumente/zusagen";
import { json, leeren, oeffneTestdb } from "./hilfen";
import { aufrufe, grundbestand, ID, protokollZeilen } from "./hilfen-instrumente";
import { erstelleTestApp, legePersonAn, person, type Testperson } from "./hilfen-auth";

/** Schrittweise Erfassung der LP-Zusagen und Abdeckung des Zeichnungskapitals (Issue #275). Alle Daten sind erfunden. */

const { db, pool } = oeffneTestdb();
const t = erstelleTestApp(db);
const { get, post, patch, delete: entferne } = aufrufe(t);

const INV1 = "00000000-0000-4000-8000-0000000000b1";
const INV2 = "00000000-0000-4000-8000-0000000000b2";
const INV3 = "00000000-0000-4000-8000-0000000000b3";
const zugangsPfad = `/funds/${ID.fonds}/investor-access`;
const zeichnungsPfad = `${zugangsPfad}/subscriptions`;
const abruf = { kind: "fund_posting", type: "capital_call", valueDate: "2026-05-01", amount: "1000.00" };
const verwalterF1 = person("verwalter-f1-zusagen", { rollen: { [ID.fonds]: "verwalter", [ID.anderer]: "verwalter" } });
const alsPerson = (methode: string, pfad: string, als: Testperson, body?: unknown) =>
  t.request(pfad, { method: methode, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), als });
const verteilungNachZusage = async (fondsId: string) => (await db.select().from(s.fonds).where(eq(s.fonds.id, fondsId)))[0]!.lpVerteilungNachZusage;
const zeichnung = (organizationId: string, commitment: string) => ({ organizationId, commitment });
const fehlercode = async (antwort: Response) => (await json(antwort)).error.code as string;
const anteile = async () => Object.fromEntries((await db.select().from(s.fondsZeichnung).where(eq(s.fondsZeichnung.fondsId, ID.fonds))).map((z) => [z.organisationId, z.anteil]));

beforeEach(async () => {
  await grundbestand(db);
  await db.insert(s.organisation).values([
    { id: INV1, name: "Erster Investor Beispiel", art: "investor" },
    { id: INV2, name: "Zweiter Investor Beispiel", art: "investor" },
    { id: INV3, name: "Dritter Investor Beispiel", art: "investor" },
  ]);
  await legePersonAn(db, verwalterF1);
  // Zeichnungskapital 30 Mio.
  await db.update(s.fonds).set({ zeichnungskapital: "30000000.00" }).where(eq(s.fonds.id, ID.fonds));
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

describe("Anteile aus Zusage und Zeichnungskapital", () => {
  it("rechnet unvollständig je Zusage abgerundet und vollständig nach dem größten Rest", () => {
    const d = (werte: string[]) => werte.map((w) => new Decimal(w));
    expect(berechneAnteile("30000000", d(["10000000"])).map((a) => a.toFixed(6))).toEqual(["0.333333"]);
    expect(berechneAnteile("300", d(["100", "100"])).map((a) => a.toFixed(6))).toEqual(["0.333333", "0.333333"]);
    expect(berechneAnteile("300", d(["100", "100", "100"])).map((a) => a.toFixed(6))).toEqual(["0.333334", "0.333333", "0.333333"]);
    expect(berechneAnteile("300", [])).toEqual([]);
  });
});

describe("LP-Zusagen schrittweise erfassen", () => {
  it("speichert eine Teilzusage, hält die Anteile beim Hinzufügen stabil und zeigt die Abdeckung", async () => {
    const erste = await post(zeichnungsPfad, { subscriptions: [zeichnung(INV1, "10000000")] });
    expect(erste.status).toBe(201);
    expect((await json(erste)).daten).toEqual([expect.objectContaining({ organisationId: INV1, zusage: "10000000.00", anteil: "0.333333" })]);
    let sicht = await json(await get(zugangsPfad));
    expect(sicht).toMatchObject({ abgedeckt: "10000000.00", vollstaendig: false, erfassungMoeglich: true, closingMoeglich: false });
    const fonds = (await json(await get("/funds"))).daten.find((f: { id: string }) => f.id === ID.fonds);
    expect(fonds).toMatchObject({ abgedeckt: "10000000.00", zusagenVollstaendig: false });

    expect((await post(zeichnungsPfad, { subscriptions: [zeichnung(INV2, "5000000")] })).status).toBe(201);
    expect(await anteile()).toEqual({ [INV1]: "0.333333", [INV2]: "0.166666" });

    // Ändern und Entfernen einzelner Zusagen; die übrigen Anteile bleiben, wo sich ihre Zusage nicht ändert.
    const geaendert = await patch(`${zeichnungsPfad}/${INV2}`, { commitment: "6000000" });
    expect(geaendert.status).toBe(200);
    expect(await json(geaendert)).toMatchObject({ organisationId: INV2, zusage: "6000000.00", anteil: "0.200000", abgedeckt: "16000000.00" });
    expect(await anteile()).toEqual({ [INV1]: "0.333333", [INV2]: "0.200000" });
    expect((await entferne(`${zeichnungsPfad}/${INV2}`)).status).toBe(204);
    expect(await anteile()).toEqual({ [INV1]: "0.333333" });
    expect(await fehlercode(await entferne(`${zeichnungsPfad}/${INV2}`))).toBe("lp_subscription_not_found");
    expect(await protokollZeilen(db, "fonds_zeichnung", "loeschen")).toHaveLength(1);

    // Vervollständigen: die Anteile ergeben genau 1, ein abgerundeter Anteil steigt höchstens um 0,000001.
    expect((await post(zeichnungsPfad, { subscriptions: [zeichnung(INV2, "10000000"), zeichnung(INV3, "10000000")] })).status).toBe(201);
    const voll = await anteile();
    expect(Decimal.sum(...Object.values(voll)).toFixed(6)).toBe("1.000000");
    expect(new Decimal(voll[INV1]!).minus("0.333333").abs().lte("0.000001")).toBe(true);
    sicht = await json(await get(zugangsPfad));
    expect(sicht).toMatchObject({ abgedeckt: "30000000.00", vollstaendig: true, erfassungMoeglich: true, closingMoeglich: true });
  });

  it("lehnt eine Überschreitung des Zeichnungskapitals und doppelte Investoren ab", async () => {
    expect(await fehlercode(await post(zeichnungsPfad, { subscriptions: [zeichnung(INV1, "30000000.01")] }))).toBe("lp_commitments_exceed_capital");
    expect(await db.select().from(s.fondsZeichnung)).toHaveLength(0);
    expect((await post(zeichnungsPfad, { subscriptions: [zeichnung(INV1, "20000000")] })).status).toBe(201);
    expect(await fehlercode(await post(zeichnungsPfad, { subscriptions: [zeichnung(INV2, "10000000.01")] }))).toBe("lp_commitments_exceed_capital");
    expect(await fehlercode(await post(zeichnungsPfad, { subscriptions: [zeichnung(INV1, "1000")] }))).toBe("lp_subscription_duplicate");
    expect(await fehlercode(await patch(`${zeichnungsPfad}/${INV1}`, { commitment: "30000000.01" }))).toBe("lp_commitments_exceed_capital");
    expect(await anteile()).toEqual({ [INV1]: "0.666666" });
    // Das Zeichnungskapital darf während der Erfassung nicht unter die Summe der Zusagen sinken; darüber werden die Anteile neu gerechnet.
    expect(await fehlercode(await patch(`/funds/${ID.fonds}`, { subscribedCapital: "19999999.99" }))).toBe("lp_commitments_exceed_capital");
    expect((await patch(`/funds/${ID.fonds}`, { subscribedCapital: "40000000" })).status).toBe(200);
    expect(await anteile()).toEqual({ [INV1]: "0.500000" });
    expect((await patch(`/funds/${ID.fonds}`, { subscribedCapital: "20000000" })).status).toBe(200);
    expect(await anteile()).toEqual({ [INV1]: "1.000000" });
  });

  it("sperrt verteilende Vorgänge bei unvollständigen Zusagen und gibt sie bei 100 % frei", async () => {
    expect((await post(zeichnungsPfad, { subscriptions: [zeichnung(INV1, "10000000")] })).status).toBe(201);
    const gesperrt = await post(`/funds/${ID.fonds}/postings`, abruf);
    expect(gesperrt.status).toBe(409);
    expect((await json(gesperrt)).error).toMatchObject({ code: "lp_commitments_incomplete", subscribedCapital: "30000000.00", sum: "10000000.00" });
    expect(await fehlercode(await post(`/funds/${ID.fonds}/postings`, { ...abruf, type: "distribution" }))).toBe("lp_commitments_incomplete");
    expect(await fehlercode(await post(`/funds/${ID.fonds}/fees-and-expenses`, { art: "fondskosten", valuta: "2026-05-01", betrag: "100.00", verteilung: "grundlage" }))).toBe("lp_commitments_incomplete");
    expect(await fehlercode(await post(`/funds/${ID.fonds}/fees-and-expenses/preview`, { art: "verwaltungsverguetung", valuta: "2026-05-01", berechnung: { satz: "0.02", von: "2026-01-01", bis: "2026-03-31" } }))).toBe("lp_commitments_incomplete");
    expect(await fehlercode(await post("/reports", { art: "lp_bericht", fondsId: ID.fonds, sprache: "de" }))).toBe("lp_commitments_incomplete");
    expect(await fehlercode(await post(`${zugangsPfad}/closings`, { effectiveDate: "2026-06-01", commitments: [zeichnung(INV2, "1000")] }))).toBe("lp_commitments_incomplete");
    expect(await db.select().from(s.fondsBewegung)).toHaveLength(0);
    expect(await db.select().from(s.bericht)).toHaveLength(0);

    // Ein Bericht ohne LP-Verteilung hält die Erfassung nicht auf; nach dem Vervollständigen ist der Abruf möglich.
    expect((await post("/reports", { art: "portfolioliste", fondsId: ID.fonds, sprache: "de" })).status).toBe(201);
    expect((await json(await get(zugangsPfad))).erfassungMoeglich).toBe(true);
    expect((await post(zeichnungsPfad, { subscriptions: [zeichnung(INV2, "20000000")] })).status).toBe(201);
    expect((await json(await get(zugangsPfad))).erfassungMoeglich).toBe(false);
    expect((await post(`/funds/${ID.fonds}/postings`, abruf)).status).toBe(201);
    expect(await fehlercode(await patch(`${zeichnungsPfad}/${INV2}`, { commitment: "1000" }))).toBe("lp_subscription_initial_locked");
  });

  it("lässt Fonds ohne Zusagen und Bestandsfonds mit fest gespeicherten Anteilen unverändert", async () => {
    // Ohne Zusagen bucht der Fonds wie bisher (keine Verteilung).
    expect((await post(`/funds/${ID.fonds}/postings`, abruf)).status).toBe(201);
    // Bestandsfonds mit fest gespeicherten Anteilen (Verteilung nach Anteil) und einer Summe unter dem Zeichnungskapital.
    await db.insert(s.fondsZeichnung).values([{ fondsId: ID.anderer, organisationId: INV1, zusage: "1000.00", anteil: "1.000000" }]);
    expect((await post(`/funds/${ID.anderer}/postings`, abruf)).status).toBe(201);
    expect((await json(await get(`/funds/${ID.anderer}/investor-access`))).vollstaendig).toBe(true);
  });
  it("lässt Anteile über das Zeichnungskapital nur von globalen Verwaltern neu rechnen", async () => {
    expect((await post(zeichnungsPfad, { subscriptions: [zeichnung(INV1, "10000000")] })).status).toBe(201);
    // Verwalter des Fonds: keine neue Rechnung der Anteile über die Stammdaten.
    const verwalter = await alsPerson("PATCH", `/funds/${ID.fonds}`, verwalterF1, { subscribedCapital: "20000000" });
    expect(verwalter.status).toBe(403);
    expect(await anteile()).toEqual({ [INV1]: "0.333333" });
    expect((await db.select().from(s.fonds).where(eq(s.fonds.id, ID.fonds)))[0]!.zeichnungskapital).toBe("30000000.00");
    // Andere Stammdaten bleiben für Verwalter des Fonds änderbar.
    expect((await alsPerson("PATCH", `/funds/${ID.fonds}`, verwalterF1, { name: "Umbenannter Fonds" })).status).toBe(200);
    // Globaler Verwalter bei offener Erfassung: Anteile werden neu gerechnet.
    expect((await patch(`/funds/${ID.fonds}`, { subscribedCapital: "20000000" })).status).toBe(200);
    expect(await anteile()).toEqual({ [INV1]: "0.500000" });
    expect(await verteilungNachZusage(ID.fonds)).toBe(true);
  });

  it("schaltet die Verteilungsart über die Stammdaten nicht um und rechnet bei Bestandsfonds keine Anteile neu", async () => {
    // Bestandsfonds mit fest gespeicherten Anteilen (Verteilung nach Anteil), Summe der Zusagen gleich dem Zeichnungskapital.
    await db.update(s.fonds).set({ zeichnungskapital: "1000.00" }).where(eq(s.fonds.id, ID.anderer));
    await db.insert(s.fondsZeichnung).values([
      { fondsId: ID.anderer, organisationId: INV1, zusage: "600.00", anteil: "0.700000" },
      { fondsId: ID.anderer, organisationId: INV2, zusage: "400.00", anteil: "0.300000" },
    ]);
    const anteileAnderer = async () => Object.fromEntries((await db.select().from(s.fondsZeichnung).where(eq(s.fondsZeichnung.fondsId, ID.anderer))).map((z) => [z.organisationId, z.anteil]));
    for (const antwort of [await alsPerson("PATCH", `/funds/${ID.anderer}`, verwalterF1, { subscribedCapital: "2000" }), await patch(`/funds/${ID.anderer}`, { subscribedCapital: "2000" })]) {
      expect(await fehlercode(antwort)).toBe("lp_commitments_capital_mismatch");
    }
    expect((await alsPerson("PATCH", `/funds/${ID.anderer}`, verwalterF1, { subscribedCapital: "1000" })).status).toBe(200);
    expect(await anteileAnderer()).toEqual({ [INV1]: "0.700000", [INV2]: "0.300000" });
    expect(await verteilungNachZusage(ID.anderer)).toBe(false);
    // Auch über die Zusagen-Routen bleibt ein Bestandsfonds gesperrt, selbst ohne Kapitalbewegungen.
    const andererPfad = `/funds/${ID.anderer}/investor-access`;
    expect((await json(await get(andererPfad))).erfassungMoeglich).toBe(false);
    expect(await fehlercode(await post(`${andererPfad}/subscriptions`, { subscriptions: [zeichnung(INV3, "1")] }))).toBe("lp_subscription_initial_locked");
    expect(await fehlercode(await patch(`${andererPfad}/subscriptions/${INV1}`, { commitment: "500" }))).toBe("lp_subscription_initial_locked");
    expect(await fehlercode(await entferne(`${andererPfad}/subscriptions/${INV2}`))).toBe("lp_subscription_initial_locked");
    expect(await anteileAnderer()).toEqual({ [INV1]: "0.700000", [INV2]: "0.300000" });
    expect(await verteilungNachZusage(ID.anderer)).toBe(false);
  });
});
