import { beteiligung, bewertung } from "@carraway/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { erstelleTestApp } from "./hilfen-auth";
import { leeren, oeffneTestdb } from "./hilfen";
import { aufrufe, grundbestand, ID, json } from "./hilfen-instrumente";
import { ladeExitListe, ladePortfolioListe } from "../berichte/daten";
import { berechneFondsUebersicht } from "../kennzahlen/fonds";
import { ladeBeteiligungDetail } from "../kennzahlen/beteiligung";
import { ermittleBeteiligungsstatus, vollausstiegDurchVerkauf } from "../kennzahlen/beteiligungsstatus";

/**
 * Wirksamer Beteiligungsstatus zum Stichtag und Wissensstand (Issue 108): Fondsübersicht, Beteiligungsakte, Portfolio- und Exitliste
 * treffen dieselbe Entscheidung. Alle Daten sind erfunden.
 */

const { db, pool } = oeffneTestdb();
const { post } = aufrufe(erstelleTestApp(db));
const b = ID.eigen;
const NAME = "Alpha Beispiel";

const verkaufen = (koerper: object) => post(`/beteiligungen/${b}/verkauf`, koerper, "bearbeiter");
const pause = () => new Promise((r) => setTimeout(r, 15));
const jetzt = async () => {
  await pause();
  const t = new Date().toISOString();
  await pause();
  return t;
};

const portfolio = (stichtag: string, stand?: string) => db.transaction((tx) => ladePortfolioListe(tx, ID.fonds, stichtag, stand, stand ?? "jetzt"));
const exits = (stichtag: string, stand?: string) => db.transaction((tx) => ladeExitListe(tx, ID.fonds, stichtag, stand, stand ?? "jetzt"));
const uebersicht = (stichtag: string, stand?: string) => db.transaction((tx) => berechneFondsUebersicht(tx, ID.fonds, stichtag, stand));
const akte = (stichtag: string, stand?: string) => db.transaction((tx) => ladeBeteiligungDetail(tx, b, stichtag, stand));
const status = (stichtag: string, stand?: string) => db.transaction((tx) => ermittleBeteiligungsstatus(tx, { fondsId: ID.fonds }, stichtag, stand));

/** Alle vier Sichten melden dasselbe: `aktiv` (in der Portfolioliste, nicht in der Exitliste) oder `exit` (umgekehrt). */
async function pruefeSicht(stichtag: string, erwartet: "aktiv" | "exit", stand?: string) {
  const [p, e, u, a] = await Promise.all([portfolio(stichtag, stand), exits(stichtag, stand), uebersicht(stichtag, stand), akte(stichtag, stand)]);
  const inPortfolio = p!.zeilen.some((z) => z.organisation === NAME);
  const inExit = e!.zeilen.some((z) => z.organisation === NAME);
  expect({ inPortfolio, inExit }, `Listen am ${stichtag}`).toEqual({ inPortfolio: erwartet === "aktiv", inExit: erwartet === "exit" });
  expect(u.beteiligungen.find((z) => z.id === b)?.status, `Übersicht am ${stichtag}`).toBe(erwartet);
  expect(a?.beteiligung.status, `Akte am ${stichtag}`).toBe(erwartet);
}

beforeEach(async () => {
  await grundbestand(db);
  await db.update(beteiligung).set({ erstinvestment: "2024-01-01" });
  await post(`/investments/${b}/transactions`, { type: "commitment", valueDate: "2024-01-01", amount: "1000000" });
  await post(`/investments/${b}/transactions`, { type: "disbursement", valueDate: "2024-02-01", amount: "500000" });
  await db.insert(bewertung).values({ beteiligungId: b, stichtag: "2024-12-31", wert: "450000.00", methode: "letzte_runde", status: "freigegeben" as const });
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

describe("vollausstiegDurchVerkauf (reine Regel)", () => {
  const i = (id: string, erstelltUs: number) => ({ id, erstelltUs: BigInt(erstelltUs) });
  const v = (instrumentId: string | null, datum: string, anteil: string, erfasstUs: number) => ({ instrumentId, datum, anteil, erfasstUs: BigInt(erfasstUs) });

  it("Teilverkauf ist kein Ausstieg, Vollverkauf der ganzen Beteiligung schon", () => {
    expect(vollausstiegDurchVerkauf([i("a", 1)], [v(null, "2025-06-30", "0.500000", 10)])).toBeNull();
    expect(vollausstiegDurchVerkauf([i("a", 1)], [v(null, "2025-06-30", "0.500000", 10), v(null, "2026-06-30", "1.000000", 20)])).toBe("2026-06-30");
  });

  it("alle Instrumente einzeln voll verkauft; ein später angelegtes Instrument bleibt im Bestand", () => {
    expect(vollausstiegDurchVerkauf([i("a", 1), i("b", 2)], [v("a", "2025-01-01", "1", 10)])).toBeNull();
    expect(vollausstiegDurchVerkauf([i("a", 1), i("b", 2)], [v("a", "2025-01-01", "1", 10), v("b", "2025-03-01", "1", 20)])).toBe("2025-03-01");
    expect(vollausstiegDurchVerkauf([i("a", 1), i("b", 30)], [v(null, "2025-06-30", "1", 10)])).toBeNull();
    expect(vollausstiegDurchVerkauf([i("a", 1), i("b", 10)], [v(null, "2025-06-30", "1", 10)])).toBeNull();
  });

  it("ohne Verkauf kein Ausstieg", () => {
    expect(vollausstiegDurchVerkauf([i("a", 1)], [])).toBeNull();
    expect(vollausstiegDurchVerkauf([], [])).toBeNull();
  });
});

describe("Beteiligungsstatus zum Stichtag", () => {
  it("Vollverkauf: davor aktiv in der Portfolioliste, danach ausgeschieden in der Exitliste", async () => {
    expect((await verkaufen({ datum: "2025-06-30", kaufpreis: "700000", anteilVerkauft: 1 })).status).toBe(201);
    await pruefeSicht("2024-12-31", "aktiv");
    await pruefeSicht("2025-06-29", "aktiv");
    await pruefeSicht("2025-06-30", "exit");
    await pruefeSicht("2025-12-31", "exit");

    const frueh = await exits("2025-12-31");
    expect(frueh!.zeilen.find((z) => z.organisation === NAME)).toMatchObject({ art: "verkauf", datum: "2025-06-30" });
    // Portfoliowert vor dem Verkauf mit dem Wertansatz, danach ohne
    expect((await uebersicht("2024-12-31")).portfoliowert).toBe("450000.00");
    expect((await uebersicht("2025-12-31")).portfoliowert).toBe("0.00");
  });

  it("Teilverkauf lässt die Restposition im Bestand; der spätere Vollverkauf ändert das frühere Quartal nicht", async () => {
    expect((await verkaufen({ datum: "2025-06-30", kaufpreis: "300000", anteilVerkauft: 0.4 })).status).toBe(201);
    await pruefeSicht("2025-12-31", "aktiv");
    expect((await portfolio("2025-12-31"))!.zeilen.find((z) => z.organisation === NAME)).toBeDefined();

    expect((await verkaufen({ datum: "2026-06-30", kaufpreis: "400000", anteilVerkauft: 1 })).status).toBe(201);
    await pruefeSicht("2025-12-31", "aktiv");
    await pruefeSicht("2026-03-31", "aktiv");
    await pruefeSicht("2026-12-31", "exit");
    expect((await exits("2026-12-31"))!.zeilen.find((z) => z.organisation === NAME)).toMatchObject({ art: "verkauf", datum: "2026-06-30" });
    // Der Teilverkauf am 30.06.2025 ordnet die Beteiligung nicht als ausgeschieden ein.
    expect((await exits("2025-12-31"))!.zeilen.find((z) => z.organisation === NAME)).toBeUndefined();
  });

  it("rückwirkend erfasster Verkauf: mit dem damaligen Wissensstand aktiv, mit dem aktuellen ausgeschieden", async () => {
    const davor = await jetzt();
    // Verkauf zum 30.06.2025, aber erst jetzt erfasst
    expect((await verkaufen({ datum: "2025-06-30", kaufpreis: "700000", anteilVerkauft: 1 })).status).toBe(201);
    const danach = await jetzt();

    await pruefeSicht("2025-12-31", "aktiv", davor);
    await pruefeSicht("2025-12-31", "exit", danach);
    await pruefeSicht("2025-12-31", "exit");
    expect((await status("2025-12-31", davor)).get(b)).toEqual({ status: "aktiv", austritt: null });
  });

  it("stornierter Verkauf: damals ausgeschieden, mit dem Wissen nach dem Storno und heute aktiv", async () => {
    const d = await json(await verkaufen({ datum: "2025-06-30", kaufpreis: "700000", anteilVerkauft: 1 }));
    const vorStorno = await jetzt();
    const storno = await post(`/verkaeufe/${d.verkauf.id}/storno`, { grund: "Kaufvertrag nicht vollzogen" }, "bearbeiter");
    expect(storno.status).toBe(201);
    const nachStorno = await jetzt();

    await pruefeSicht("2025-12-31", "exit", vorStorno);
    await pruefeSicht("2025-12-31", "aktiv", nachStorno);
    await pruefeSicht("2025-12-31", "aktiv");
    // Der damalige Stand erklärt auch die Zahlen: Portfoliowert ohne den Wertansatz, die Exitliste mit Erlös
    expect((await uebersicht("2025-12-31", vorStorno)).portfoliowert).toBe("0.00");
    expect((await exits("2025-12-31", vorStorno))!.zeilen.find((z) => z.organisation === NAME)).toMatchObject({ art: "verkauf", datum: "2025-06-30" });
  });

  it("Ausscheiden ohne Verkauf (Insolvenz): vor dem Datum aktiv, danach in der Exitliste", async () => {
    expect((await post(`/beteiligungen/${b}/insolvenz`, { datum: "2025-09-30" }, "bearbeiter")).status).toBe(200);
    const vorher = await status("2025-06-30");
    expect(vorher.get(b)).toEqual({ status: "aktiv", austritt: null });
    const nachher = await status("2025-12-31");
    expect(nachher.get(b)).toMatchObject({ status: "insolvent", austritt: { datum: "2025-09-30", durchVerkauf: false } });
    expect((await exits("2025-06-30"))!.zeilen.find((z) => z.organisation === NAME)).toBeUndefined();
    expect((await exits("2025-12-31"))!.zeilen.find((z) => z.organisation === NAME)).toMatchObject({ art: "insolvenz", datum: "2025-09-30" });
  });
});
