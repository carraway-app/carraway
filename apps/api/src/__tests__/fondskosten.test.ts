import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { berechneFondsUebersicht } from "../kennzahlen/fonds";
import { ladeKapitalkonten } from "../berichte/daten";
import { erstelleTestApp, legePersonAn, person } from "./hilfen-auth";
import { leeren, oeffneTestdb } from "./hilfen";
import { buchhaltungAufsetzen, uebernehmeSalden } from "./hilfen-buchhaltung";
import { aufrufe, ID, json } from "./hilfen-instrumente";

const { db, pool } = oeffneTestdb();
const { post, get } = aufrufe(erstelleTestApp(db));
const kosten = `/fonds/${ID.fonds}/kosten`;
const buchungen = `/funds/${ID.fonds}/postings`;
const buche = (eingabe: Record<string, unknown>) => post(kosten, eingabe);

beforeEach(async () => {
  await leeren(db);
  await db.insert(s.fonds).values({ id: ID.fonds, name: "Beispielfonds", kurzname: "BF", vintage: 2024, zeichnungskapital: "1000000", lpVerteilungNachZusage: true });
  await db.insert(s.organisation).values([
    { id: ID.orgA, name: "Investor A", art: "investor" },
    { id: ID.orgB, name: "Investor B", art: "investor" },
    { id: ID.orgC, name: "Investor C", art: "investor" },
  ]);
  await db.insert(s.fondsZeichnung).values([
    { fondsId: ID.fonds, organisationId: ID.orgA, zusage: "500000", anteil: "0.5" },
    { fondsId: ID.fonds, organisationId: ID.orgB, zusage: "300000", anteil: "0.3" },
    { fondsId: ID.fonds, organisationId: ID.orgC, zusage: "200000", anteil: "0.2" },
  ]);
});
afterAll(async () => { await leeren(db); await pool.end(); });

/** Abruf von 100.000 mit voller Einzahlung, Saldenliste zum Stichtag mit Bank 99.000 (1.000 Kosten bezahlt). */
async function fondsMitNav(stichtag = "2025-06-30") {
  const abruf = (await json(await post(buchungen, { kind: "fund_posting", type: "capital_call", amount: "100000", valueDate: "2025-01-02", dueDate: "2025-01-02" }))).movement.id as string;
  for (const [org, betrag] of [[ID.orgA, "50000"], [ID.orgB, "30000"], [ID.orgC, "20000"]] as const) {
    expect((await post(`/fondsbewegungen/${abruf}/zahlungen`, { organisationId: org, betrag, valuta: "2025-01-02" })).status).toBe(201);
  }
  await buchhaltungAufsetzen(db, ID.fonds);
  await uebernehmeSalden(db, ID.fonds, stichtag, { "1200": "99000.00", "2000": "-100000.00", "6300": "1000.00" });
}

describe("Verwaltungsvergütung und Fondskosten (Issue #157)", () => {
  it("berechnet die Vergütung aus Jahressatz und Zeitraum und verteilt sie nach der Grundlage", async () => {
    const vorschau = await json(await post(`${kosten}/vorschau`, { art: "verwaltungsverguetung", valuta: "2025-07-01", berechnung: { satz: "0.02", von: "2025-07-01", bis: "2025-09-30" } }));
    // 1.000.000 × 0,02 × 92 / 365 = 5.041,0958… → 5.041,10
    expect(vorschau.betrag).toBe("5041.10");
    expect(vorschau.berechnung.map((x: { wert: string }) => x.wert)).toEqual(["1000000", "0.02", "92/365", "5041.10"]);
    expect(vorschau.aufteilung.map((a: { betrag: string }) => a.betrag)).toEqual(["2520.55", "1512.33", "1008.22"]);
    const antwort = await buche({ art: "verwaltungsverguetung", valuta: "2025-07-01", berechnung: { satz: "0.02", von: "2025-07-01", bis: "2025-09-30" } });
    expect(antwort.status).toBe(201);
    const liste = await json(await get(kosten));
    expect(liste.summen).toEqual({ verwaltungsverguetung: "5041.10", fondskosten: "0.00" });
    expect(liste.buchungen[0]).toMatchObject({ satz: "0.02", zeitraumVon: "2025-07-01", zeitraumBis: "2025-09-30", verteilung: "grundlage" });
  });

  it("prüft eine eigene Aufteilung auf Summe und Investoren", async () => {
    const falsch = await json(await buche({ art: "fondskosten", valuta: "2025-03-01", betrag: "100.00", verteilung: "manuell", anteile: [{ organisationId: ID.orgA, betrag: "60.00" }] }));
    expect(falsch.error.code).toBe("cost_allocation_invalid");
    const fremd = await json(await buche({ art: "fondskosten", valuta: "2025-03-01", betrag: "100.00", verteilung: "manuell", anteile: [{ organisationId: ID.fonds, betrag: "100.00" }] }));
    expect(fremd.error.code).toBe("cost_allocation_invalid");
    const gut = await buche({ art: "fondskosten", valuta: "2025-03-01", betrag: "100.00", verteilung: "manuell", anteile: [{ organisationId: ID.orgA, betrag: "60.00" }, { organisationId: ID.orgB, betrag: "40.00" }] });
    expect(gut.status).toBe(201);
    expect((await json(gut)).aufteilung.map((a: { betrag: string }) => a.betrag)).toEqual(["60.00", "40.00", "0.00"]);
    const beides = await json(await buche({ art: "fondskosten", valuta: "2025-03-01", betrag: "1.00", berechnung: { satz: "0.02", von: "2025-01-01", bis: "2025-01-31" } }));
    expect(beides.error.code).toBe("invalid_input");
    const null0 = await buche({ art: "verwaltungsverguetung", valuta: "2025-03-01", berechnung: { satz: "0.0", von: "2025-01-01", bis: "2025-01-31" } });
    expect(null0.status).toBe(400);
  });

  it("ändert Fonds-NAV und Fondskennzahlen nicht, mindert aber die Kapitalkonten und gleicht abweichende Verteilung im NAV-Anteil aus", async () => {
    await fondsMitNav();
    const vorher = (await berechneFondsUebersicht(db, ID.fonds, "2025-06-30")).kennzahlen;
    const kontenVorher = await ladeKapitalkonten(db, ID.fonds, "2025-06-30", undefined, vorher.nav.wert);
    expect(kontenVorher.map((k) => k.navAnteil)).toEqual(["49500.00", "29700.00", "19800.00"]);
    expect(kontenVorher[0]).not.toHaveProperty("fondskosten");

    // 600 anteilig, 400 nur auf A und B (C trägt keine Vergütung).
    expect((await buche({ art: "fondskosten", valuta: "2025-03-01", betrag: "600.00" })).status).toBe(201);
    expect((await buche({ art: "verwaltungsverguetung", valuta: "2025-04-01", betrag: "400.00", verteilung: "manuell", anteile: [{ organisationId: ID.orgA, betrag: "250.00" }, { organisationId: ID.orgB, betrag: "150.00" }] })).status).toBe(201);

    const nachher = (await berechneFondsUebersicht(db, ID.fonds, "2025-06-30")).kennzahlen;
    expect([nachher.nav.wert, nachher.tvpi.wert, nachher.dpi.wert, nachher.irr.wert]).toEqual([vorher.nav.wert, vorher.tvpi.wert, vorher.dpi.wert, vorher.irr.wert]);

    const konten = await json(await get(`/fonds/${ID.fonds}/kapitalkonten?stichtag=2025-06-30`));
    expect(konten.konten.map((k: Record<string, string>) => [k.fondskosten, k.verwaltungsverguetung, k.kostenausgleich, k.navAnteil])).toEqual([
      ["300.00", "250.00", "-50.00", "49450.00"],
      ["180.00", "150.00", "-30.00", "29670.00"],
      ["120.00", "0.00", "80.00", "19880.00"],
    ]);
    const summe = konten.konten.reduce((x: number, k: { navAnteil: string }) => x + Math.round(Number(k.navAnteil) * 100), 0);
    expect(summe).toBe(9_900_000);
    // Fortschreibung: 50.000 − 0 − 250 − 300 + Ergebnis = 49.450
    expect(konten.konten[0].ergebnisanteil).toBe("0.00");
    expect(konten.konten[0].schritte.at(-3)).toMatchObject({ bezeichnung: "NAV-Anteil", wert: "49450.00" });
    expect(konten.konten[2].nettoIrr).not.toBeNull();
    expect(Number(konten.konten[2].nettoIrr)).toBeGreaterThan(Number(konten.konten[0].nettoIrr));

    // Der LP-Bericht trägt die Kosten, die Summen stimmen mit den Buchungen überein.
    const lp = await ladeKapitalkonten(db, ID.fonds, "2025-06-30", undefined, nachher.nav.wert);
    expect(lp.map((k) => [k.verwaltungsverguetung, k.fondskosten])).toEqual([["250.00", "300.00"], ["150.00", "180.00"], ["0.00", "120.00"]]);
  });

  it("storniert mit negierten Anteilen, liest frühere Wissensstände und achtet die Periodensperre", async () => {
    const original = await json(await buche({ art: "fondskosten", valuta: "2025-03-01", betrag: "100.00" }));
    const zeit = (await db.execute<{ t: string }>(sql`SELECT to_json(clock_timestamp()) #>> '{}' AS t`)).rows[0]!.t;
    const storno = await post(`${kosten}/${original.id}/storno`, { grund: "Doppelt erfasst", valuta: "2025-03-05" });
    expect(storno.status).toBe(201);
    expect((await json(await post(`${kosten}/${original.id}/storno`, { grund: "Nochmal" }))).error.code).toBe("already_reversed");
    const jetzt = await json(await get(kosten));
    expect(jetzt.summen.fondskosten).toBe("0.00");
    expect(jetzt.buchungen[1].anteile.map((a: { betrag: string }) => a.betrag)).toEqual(["-50.00", "-30.00", "-20.00"]);
    expect((await json(await get(`${kosten}?stichtag=2025-03-04`))).summen.fondskosten).toBe("100.00");
    expect((await json(await get(`${kosten}?stand=${encodeURIComponent(zeit)}`))).summen.fondskosten).toBe("100.00");

    await db.insert(s.periodensperre).values({ fondsId: ID.fonds, gesperrtBis: "2025-03-31", gesetztVon: "system" });
    expect((await json(await buche({ art: "fondskosten", valuta: "2025-03-15", betrag: "10.00" }))).error.code).toBe("period_locked");
  });

  it("hält Buchungen unveränderlich und Anteile summengleich (Datenbank)", async () => {
    const original = await json(await buche({ art: "fondskosten", valuta: "2025-03-01", betrag: "100.00" }));
    await expect(db.execute(sql`UPDATE fonds_kosten SET betrag = 1 WHERE id = ${original.id}`)).rejects.toThrow();
    await expect(db.transaction(async (tx) => {
      const [k] = await tx.insert(s.fondsKosten).values({ fondsId: ID.fonds, art: "fondskosten", valuta: "2025-03-02", betrag: "10.00", verteilung: "manuell" }).returning();
      await tx.insert(s.fondsKostenAnteil).values({ kostenId: k!.id, organisationId: ID.orgA, betrag: "9.00" });
    })).rejects.toThrow();
  });

  it("zieht gebuchte Kosten in der Liquiditätsabstimmung ab", async () => {
    await fondsMitNav("2025-06-30");
    await buche({ art: "fondskosten", valuta: "2025-03-01", betrag: "1000.00" });
    const a = (await json(await get(`/funds/${ID.fonds}/reconciliation?to=2025-06-30`))).liquidity;
    expect(a).toMatchObject({ carraway: "99000.00", accounting: "99000.00", difference: "0.00" });
    expect(a.steps).toContainEqual({ symbol: "−", label: "Verwaltungsvergütung und Fondskosten (gebucht)", value: "1000.00" });
  });

  it("verlangt Bearbeiter zum Buchen, Betrachter genügt zum Lesen", async () => {
    const betrachter = person("kosten-lesen", { rollen: { [ID.fonds]: "betrachter" } });
    await legePersonAn(db, betrachter);
    expect((await get(kosten, betrachter)).status).toBe(200);
    expect((await get(`/fonds/${ID.fonds}/kapitalkonten`, betrachter)).status).toBe(200);
    expect((await post(kosten, { art: "fondskosten", valuta: "2025-03-01", betrag: "1.00" }, betrachter)).status).toBe(403);
  });
});
