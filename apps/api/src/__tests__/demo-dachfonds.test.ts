import { Decimal } from "@carraway/rechenkern";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { erzeugeDemodaten, schreibeDemoDachfonds, schreibeDemodaten } from "@carraway/db/demo";
import { berechneFondsUebersicht } from "../kennzahlen/fonds";
import { erstelleTestApp } from "./hilfen-auth";
import { leeren, oeffneTestdb } from "./hilfen";
import { aufrufe, json } from "./hilfen-instrumente";

const { db, pool } = oeffneTestdb();
const { get } = aufrufe(erstelleTestApp(db));
const STICHTAG = "2026-09-30";

/** Demo-Daten des Dachfonds (Issue #160): ein zusätzlicher Fonds, die Kennzahlen der übrigen Fonds bleiben gleich. */
describe("Demo-Daten: Dachfonds", () => {
  const daten = erzeugeDemodaten({ seed: 1 });
  const vorher = new Map<string, string | null>();
  let dachId = "";

  beforeAll(async () => {
    await schreibeDemodaten(db, daten);
    for (const f of daten.fonds) vorher.set(f.id!, (await berechneFondsUebersicht(db, f.id!, STICHTAG)).kennzahlen.nav.wert);
    dachId = (await schreibeDemoDachfonds(db))!.fondsId;
  }, 120_000);
  afterAll(async () => {
    await leeren(db);
    await pool.end();
  });

  it("lässt die NAV der übrigen Fonds unverändert", async () => {
    for (const f of daten.fonds) expect((await berechneFondsUebersicht(db, f.id!, STICHTAG)).kennzahlen.nav.wert).toBe(vorher.get(f.id!));
  });

  it("rechnet die NAV des Dachfonds aus Zielfonds (Fortschreibung und Durchrechnung) und Bank", async () => {
    const jungster = [...daten.fonds].sort((a, b) => a.vintage - b.vintage || a.name.localeCompare(b.name)).at(-1)!;
    const durchgerechnet = new Decimal(vorher.get(jungster.id!)!).times("0.16").toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    // Fremde Zielfonds: 2.840.000 + 500.000 und 870.000 + 600.000; Bank 10.000.000 − 6.200.000 − 180.000
    const erwartet = new Decimal("3340000").plus("1470000").plus(durchgerechnet).plus("3620000");
    const u = await berechneFondsUebersicht(db, dachId, STICHTAG);
    expect(new Decimal(u.kennzahlen.nav.wert!).equals(erwartet)).toBe(true);
    const liste = await json(await get(`/fonds/${dachId}/target-funds?asOf=${STICHTAG}`));
    expect(liste.data).toHaveLength(3);
    expect(liste.data.map((x: { metrics: { value: { method: string } } }) => x.metrics.value.method).sort()).toEqual(["look_through", "reported_nav", "reported_nav"]);
  });

  it("liefert das Dashboard ohne Angaben zum Quartalsende mit Saldenlisten, mit NAV über alle Fonds", async () => {
    const start = Date.now();
    const r = await get("/portfolio/dashboard");
    const dauer = Date.now() - start;
    expect(r.status).toBe(200);
    const d = await json(r);
    expect(d.asOf).toBe(STICHTAG);
    expect(d.totals.nav.value).not.toBeNull();
    expect(d.totals.tvpi.value).not.toBeNull();
    expect(d.history.total.at(-1).nav).not.toBeNull();
    // Kein Leistungstest; die Dauer steht im Protokoll (ohne Snapshots rechnet alles live).
    console.info(`Dashboard der Demo ohne Snapshots: ${dauer} ms`);
  }, 120_000);

  it("zieht im Manager-Profil den Anteil am eigenen Zielfonds ab", async () => {
    const d = await json(await get(`/manager-profile?asOf=${STICHTAG}`));
    expect(d.name).toBe("Beispiel Kapitalverwaltung");
    expect(d.internalHoldings.filter((x: { eliminated: boolean }) => x.eliminated)).toHaveLength(1);
    expect(d.totals.nav.value).not.toBeNull();
  });
});
