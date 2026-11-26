import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { erzeugeDemodaten, schreibeDemodaten } from "@carraway/db/demo";
import { erstelleTestApp } from "./hilfen-auth";
import { leeren, oeffneTestdb } from "./hilfen";
import { aufrufe, json } from "./hilfen-instrumente";

const { db, pool } = oeffneTestdb();
const { get } = aufrufe(erstelleTestApp(db));

const BIS = "2026-09-30";

/** Die Demo bringt je Fonds Kontenrahmen, Regeln und eine Saldenliste des letzten Quartals mit, die die Sichten zeigen. */
describe("Demo-Daten: Buchhaltung", () => {
  const fonds: { id: string; kurzname: string }[] = [];

  beforeAll(async () => {
    await schreibeDemodaten(db, erzeugeDemodaten({ seed: 1 }));
    fonds.push(...(await get("/fonds").then(json)).daten);
  }, 60_000);
  afterAll(async () => {
    await leeren(db);
    await pool.end();
  });

  it("je Fonds eine übernommene Saldenliste für das dritte Quartal 2026 mit ausgeglichenen Salden", async () => {
    expect(fonds).toHaveLength(3);
    for (const f of fonds) {
      const perioden = (await get(`/funds/${f.id}/periods`).then(json)).data;
      expect(perioden).toHaveLength(1);
      expect(perioden[0]).toMatchObject({ periodFrom: "2026-07-01", periodTo: BIS });
      const salden = (await get(`/balance-runs/${perioden[0].runId}/balances`).then(json)).data as { balance: string }[];
      expect(salden.length).toBeGreaterThanOrEqual(7);
      expect(salden.reduce((s, x) => s + Math.round(Number(x.balance) * 100), 0)).toBe(0);
    }
  });

  it("die Bilanz geht auf, die GuV stimmt mit dem Ergebnis der Bilanz überein, es bleiben keine Konten ohne Zuordnung", async () => {
    for (const f of fonds) {
      const wert = (a: { rows: { key: string; value: string }[] }, k: string) => a.rows.find((z) => z.key === k)!.value;
      const bilanz = await get(`/funds/${f.id}/evaluation/balance_sheet?to=${BIS}`).then(json);
      const guv = await get(`/funds/${f.id}/evaluation/income_statement?to=${BIS}`).then(json);
      expect(wert(bilanz, "aktiva"), f.kurzname).toBe(wert(bilanz, "passiva"));
      expect(wert(guv, "guv.ergebnis")).toBe(wert(bilanz, "passiva.ergebnis"));
      expect(bilanz.unassigned).toEqual([]);
      expect(Number(wert(bilanz, "aktiva"))).toBeGreaterThan(0);
      for (const sicht of ["liquidity", "use_of_funds", "portfolio"]) expect((await get(`/funds/${f.id}/evaluation/${sicht}?to=${BIS}`)).status).toBe(200);
    }
  });

  it("zeigt DPI, TVPI, RVPI und Netto-IRR in der Standardübersicht aller drei Demo-Fonds", async () => {
    expect(fonds).toHaveLength(3);
    for (const f of fonds) {
      const { stichtag, kennzahlen } = await get(`/fonds/${f.id}/uebersicht`).then(json);
      expect(stichtag).toBe(BIS);
      expect(Number(kennzahlen.eingezahlt.wert)).toBeGreaterThan(0);
      for (const k of ["dpi", "tvpi", "rvpi", "irr"]) {
        expect(kennzahlen[k].wert, `${f.kurzname} ${k}`).toBeTypeOf("string");
        expect(Number.isFinite(Number(kennzahlen[k].wert))).toBe(true);
      }
    }
  });

  it("zeigt am Beispielabruf die Restzahlung und den zum Quartalsende noch überfälligen LP-Anteil", async () => {
    const { rows: [abruf] } = await db.execute<{ id: string }>(sql`
      SELECT id FROM fonds_bewegung WHERE art = 'abruf' ORDER BY valuta DESC LIMIT 1`);
    const buchungen = async (tag: string) => get(`/fondsbewegungen/${abruf!.id}/zahlungen?stichtag=${tag}`).then(json);
    const faellig = await buchungen("2026-04-15");
    const teilzahlung = { eingezahlt: "139840.00", offen: "139840.00" };
    expect(faellig.positionen).toContainEqual(expect.objectContaining({ ...teilzahlung, ueberfaellig: "0.00" }));
    const lp = faellig.positionen.find((p: { offen: string }) => p.offen === teilzahlung.offen).organisationId;
    const restzahlung = await buchungen("2026-04-22");
    expect(restzahlung.zahlungen.filter((z: { organisationId: string }) => z.organisationId === lp)).toMatchObject([
      { valuta: "2026-04-09", betrag: "139840.00" }, { valuta: "2026-04-22", betrag: "139840.00" },
    ]);
    expect(restzahlung.positionen).toContainEqual(expect.objectContaining({ organisationId: lp, eingezahlt: "279680.00", offen: "0.00" }));
    const quartal = await buchungen(BIS);
    expect(quartal.positionen).toContainEqual(expect.objectContaining({ eingezahlt: "55936.00", offen: "55936.00", ueberfaellig: "55936.00" }));
  });

  it("der Fonds-NAV entspricht am Quartalsende dem Eigenkapital jeder Demo-Bilanz", async () => {
    for (const f of fonds) {
      const uebersicht = await get(`/fonds/${f.id}/uebersicht?stichtag=${BIS}`).then(json);
      const bilanz = await get(`/funds/${f.id}/evaluation/balance_sheet?to=${BIS}`).then(json);
      const eigenkapital = bilanz.rows.find((z: { key: string }) => z.key === "passiva.eigenkapital").value;
      expect(uebersicht.stichtag).toBe(BIS);
      expect(uebersicht.kennzahlen.nav.wert).not.toBeNull();
      expect.soft(Number(uebersicht.kennzahlen.nav.wert).toFixed(2), f.kurzname).toBe(eigenkapital);
    }
  });

  it("die Abstimmung des Portfolios geht auf, nur beim ersten Fonds zeigt sie die gewollte Differenz von 1.000,00", async () => {
    const ergebnis: string[] = [];
    for (const f of fonds) {
      const a = await get(`/funds/${f.id}/reconciliation?to=${BIS}`).then(json);
      ergebnis.push(a.portfolio.total.difference);
      expect(a.liquidity).not.toBeNull();
    }
    expect(ergebnis.filter((d) => d === "0.00")).toHaveLength(2);
    expect(ergebnis.filter((d) => d === "1000.00")).toHaveLength(1);
  });
});
