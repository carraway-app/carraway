import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { erstelleTestApp, legePersonAn, person } from "./hilfen-auth";
import { EXPORT_TABELLEN } from "../export/vollexport";
import { leeren, oeffneTestdb, vehikelVon } from "./hilfen";
import { aufrufe, grundbestand, ID, json, protokollZeilen } from "./hilfen-instrumente";

const { db, pool } = oeffneTestdb();
const { get, post, patch } = aufrufe(erstelleTestApp(db));

const ORG_OHNE = "00000000-0000-4000-8000-0000000000d1";
const R1 = "00000000-0000-4000-8000-0000000000e1";
const R2 = "00000000-0000-4000-8000-0000000000e2";
const P_FONDS_1 = "00000000-0000-4000-8000-0000000000c1";
const P_ORG_1 = "00000000-0000-4000-8000-0000000000c2";
const P_FONDS_2 = "00000000-0000-4000-8000-0000000000c3";
const P_ORG_2 = "00000000-0000-4000-8000-0000000000c4";
const FALSCH = "00000000-0000-4000-8000-0000000000ff";

const bearbeiterHalter = person("halter-bearbeiter", { rollen: { [ID.fonds]: "bearbeiter" } });
const betrachterHalter = person("halter-betrachter", { rollen: { [ID.fonds]: "betrachter" } });
const bearbeiterFremd = person("fremd-bearbeiter", { rollen: { [ID.anderer]: "bearbeiter" } });

/**
 * Unternehmen A mit zwei Runden: Seed (Fonds 50.000 Anteile für 100.000, Investor B 100.000 Anteile für 200.000) und Serie A
 * (Fonds 40.000 Anteile für 200.000, Investor B 60.000 für 300.000). Gesamtzahl nach der zweiten Runde: 1.250.000, Post-Money 6.250.000.
 */
beforeEach(async () => {
  await grundbestand(db);
  for (const p of [bearbeiterHalter, betrachterHalter, bearbeiterFremd]) await legePersonAn(db, p);
  await db.insert(s.organisation).values({ id: ORG_OHNE, name: "Delta Beispiel", art: "unternehmen" });
  await db.insert(s.finanzierungsrunde).values([
    { id: R1, organisationId: ID.orgA, bezeichnung: "Seed", datum: "2025-01-10", preMoney: "2000000.00", postMoney: "2300000.00", preisJeAnteil: "2.0000", anteileGesamtNach: "1150000" },
    { id: R2, organisationId: ID.orgA, bezeichnung: "Serie A", datum: "2025-09-01", preMoney: "5750000.00", postMoney: "6250000.00", preisJeAnteil: "5.0000", anteileGesamtNach: "1250000" },
  ]);
  await db.insert(s.rundenposition).values([
    { id: P_FONDS_1, rundeId: R1, fondsId: ID.fonds, betrag: "100000.00", anteile: "50000", rolle: "lead" },
    { id: P_ORG_1, rundeId: R1, vehikelId: await vehikelVon(db, ID.orgB), betrag: "200000.00", anteile: "100000", rolle: "co" },
    { id: P_FONDS_2, rundeId: R2, fondsId: ID.fonds, betrag: "200000.00", anteile: "40000", rolle: "lead" },
    { id: P_ORG_2, rundeId: R2, vehikelId: await vehikelVon(db, ID.orgB), betrag: "300000.00", anteile: "60000", rolle: "co" },
  ]);
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

const klasseSeed = { name: "Seed-Vorzugsanteile", rang: 1, praeferenzFaktor: "1", partizipierend: false, umwandelbar: true };
const klasseAnlegen = async (koerper: object = klasseSeed, als: Parameters<typeof post>[2] = bearbeiterHalter) => post(`/organisationen/${ID.orgA}/anteilsklassen`, koerper, als);
/** Klasse „Seed“ für beide Seed-Positionen (wie im Beispiel der Berechnung von Hand). */
async function seedKlasseZuweisen() {
  const k = await json(await klasseAnlegen());
  for (const p of [P_FONDS_1, P_ORG_1]) expect((await patch(`/rundenpositionen/${p}`, { anteilsklasseId: k.id })).status).toBe(200);
  return k.id as string;
}

describe("Anteilsklassen", () => {
  it("legt eine Klasse an, liest sie, ändert sie und protokolliert beides", async () => {
    const antwort = await klasseAnlegen({ ...klasseSeed, praeferenzFaktor: "1.5", partizipierend: true, capFaktor: "3", kumulierteVerzinsung: "0.08" });
    expect(antwort.status).toBe(201);
    const k = await json(antwort);
    expect(k).toMatchObject({ organisationId: ID.orgA, name: "Seed-Vorzugsanteile", rang: 1, praeferenzFaktor: "1.5000", partizipierend: true, capFaktor: "3.0000", kumulierteVerzinsung: "0.080000", umwandelbar: true });

    const liste = await json(await get(`/organisationen/${ID.orgA}/anteilsklassen`, bearbeiterHalter));
    expect(liste.daten).toHaveLength(1);
    expect(liste.daten[0].verwendet).toBe(0);

    const geaendert = await patch(`/organisationen/${ID.orgA}/anteilsklassen/${k.id}`, { rang: 2, capFaktor: null }, bearbeiterHalter);
    expect(geaendert.status).toBe(200);
    expect(await json(geaendert)).toMatchObject({ rang: 2, capFaktor: null, praeferenzFaktor: "1.5000" });
    expect(await protokollZeilen(db, "anteilsklasse", "anlegen")).toHaveLength(1);
    expect(await protokollZeilen(db, "anteilsklasse", "aendern")).toHaveLength(1);
  });

  it("Standardwerte: Faktor 1, nicht partizipierend, umwandelbar, Rang 1", async () => {
    const k = await json(await klasseAnlegen({ name: "Einfach" }));
    expect(k).toMatchObject({ rang: 1, praeferenzFaktor: "1.0000", partizipierend: false, capFaktor: null, kumulierteVerzinsung: null, umwandelbar: true });
  });

  it("prüft Eingaben: Cap nur bei Partizipation und nicht unter dem Faktor, Namen eindeutig, Zahlenformate", async () => {
    const ohnePart = await klasseAnlegen({ ...klasseSeed, capFaktor: "3" });
    expect(ohnePart.status).toBe(400);
    expect((await json(ohnePart)).error.fields[0]).toMatchObject({ field: "capFaktor", code: "cap_without_participation" });
    const zuKlein = await klasseAnlegen({ ...klasseSeed, praeferenzFaktor: "2", partizipierend: true, capFaktor: "1.5" });
    expect((await json(zuKlein)).error.fields[0]).toMatchObject({ code: "cap_below_preference" });
    for (const falsch of [{ rang: 0 }, { rang: 1.5 }, { praeferenzFaktor: "-1" }, { praeferenzFaktor: "1.23456" }, { kumulierteVerzinsung: "8" }, { name: "  " }, { umwandelbar: "ja" }]) {
      expect((await klasseAnlegen({ ...klasseSeed, ...falsch })).status, JSON.stringify(falsch)).toBe(400);
    }
    expect((await klasseAnlegen()).status).toBe(201);
    const doppelt = await klasseAnlegen();
    expect(doppelt.status).toBe(409);
    expect((await json(doppelt)).error.code).toBe("share_class_name_exists");
  });

  it("PATCH prüft den Stand nach der Änderung und verlangt ein Feld; fremde und unbekannte Klassen sind 404", async () => {
    const k = await json(await klasseAnlegen());
    const url = `/organisationen/${ID.orgA}/anteilsklassen/${k.id}`;
    expect((await patch(url, { capFaktor: "3" }, bearbeiterHalter)).status).toBe(400); // nicht partizipierend
    expect((await patch(url, { partizipierend: true, capFaktor: "3" }, bearbeiterHalter)).status).toBe(200);
    expect((await patch(url, { partizipierend: false }, bearbeiterHalter)).status).toBe(400); // Cap bliebe stehen
    expect((await patch(url, {}, bearbeiterHalter)).status).toBe(400);
    expect((await patch(`/organisationen/${ID.orgA}/anteilsklassen/${FALSCH}`, { rang: 2 }, bearbeiterHalter)).status).toBe(404);
    expect((await patch(`/organisationen/${ID.orgC}/anteilsklassen/${k.id}`, { rang: 2 }, bearbeiterHalter)).status).toBe(404); // F1 hält auch C, aber die Klasse gehört zu A
    const zweite = await json(await klasseAnlegen({ name: "Zweite" }));
    const doppelt = await patch(`/organisationen/${ID.orgA}/anteilsklassen/${zweite.id}`, { name: "Seed-Vorzugsanteile" }, bearbeiterHalter);
    expect(doppelt.status).toBe(409);
  });

  it("Rechte: Bearbeiter eines haltenden Fonds darf schreiben, Betrachter nur lesen, fremde Fonds und Organisationen ohne Halter nicht", async () => {
    expect((await klasseAnlegen(klasseSeed, betrachterHalter)).status).toBe(403);
    expect((await klasseAnlegen(klasseSeed, bearbeiterFremd)).status).toBe(403);
    expect((await get(`/organisationen/${ID.orgA}/anteilsklassen`, bearbeiterFremd)).status).toBe(403);
    expect((await get(`/organisationen/${ID.orgA}/anteilsklassen`, betrachterHalter)).status).toBe(200);
    // Organisation, die kein Fonds hält: nur globale Verwalter
    expect((await post(`/organisationen/${ORG_OHNE}/anteilsklassen`, klasseSeed, bearbeiterHalter)).status).toBe(403);
    expect((await get(`/organisationen/${ORG_OHNE}/anteilsklassen`, betrachterHalter)).status).toBe(403);
    expect((await post(`/organisationen/${ORG_OHNE}/anteilsklassen`, klasseSeed, "global")).status).toBe(201);
    expect((await post(`/organisationen/${FALSCH}/anteilsklassen`, klasseSeed, bearbeiterHalter)).status).toBe(404);
  });
});

describe("Änderungsabfrage und Vollexport", () => {
  it("Anteilsklassen erscheinen im Änderungsstrom nur für Personen mit Rolle an einem haltenden Fonds und stehen im Vollexport", async () => {
    const seit = encodeURIComponent(new Date(Date.now() - 60_000).toISOString());
    const k = await json(await klasseAnlegen());
    const lies = async (als: Parameters<typeof get>[1]) => ((await json(await get(`/changes?since=${seit}&limit=1000`, als))).data as { table: string; recordId: string }[]).filter((z) => z.table === "anteilsklasse");
    expect((await lies(betrachterHalter)).map((z) => z.recordId)).toEqual([k.id]);
    expect(await lies(bearbeiterFremd)).toEqual([]);
    expect(EXPORT_TABELLEN.map((x) => x.name)).toContain("anteilsklasse");
  });
});

describe("Klasse einer Rundenposition", () => {
  it("setzt und entfernt die Klasse, prüft das Unternehmen und protokolliert", async () => {
    const k = await json(await klasseAnlegen());
    const gesetzt = await patch(`/rundenpositionen/${P_FONDS_1}`, { anteilsklasseId: k.id }, bearbeiterHalter);
    expect(gesetzt.status).toBe(200);
    expect(await json(gesetzt)).toMatchObject({ id: P_FONDS_1, anteilsklasseId: k.id });
    const liste = await json(await get(`/organisationen/${ID.orgA}/anteilsklassen`));
    expect(liste.daten[0].verwendet).toBe(1);
    expect((await json(await patch(`/rundenpositionen/${P_FONDS_1}`, { anteilsklasseId: null }, bearbeiterHalter))).anteilsklasseId).toBeNull();
    expect(await protokollZeilen(db, "rundenposition", "aendern")).toHaveLength(2);

    // Klasse eines anderen Unternehmens
    const [fremd] = await db.insert(s.anteilsklasse).values({ organisationId: ID.orgB, name: "Fremd" }).returning();
    const antwort = await patch(`/rundenpositionen/${P_FONDS_1}`, { anteilsklasseId: fremd!.id }, bearbeiterHalter);
    expect(antwort.status).toBe(409);
    expect((await json(antwort)).error.code).toBe("share_class_mismatch");
    expect((await patch(`/rundenpositionen/${P_FONDS_1}`, { anteilsklasseId: FALSCH }, bearbeiterHalter)).status).toBe(404);
    expect((await patch(`/rundenpositionen/${FALSCH}`, { anteilsklasseId: null }, bearbeiterHalter)).status).toBe(404);
    expect((await patch(`/rundenpositionen/${P_FONDS_1}`, {}, bearbeiterHalter)).status).toBe(400);
  });

  it("Rechte: Betrachter und Bearbeiter fremder Fonds dürfen nicht", async () => {
    expect((await patch(`/rundenpositionen/${P_FONDS_1}`, { anteilsklasseId: null }, betrachterHalter)).status).toBe(403);
    expect((await patch(`/rundenpositionen/${P_FONDS_1}`, { anteilsklasseId: null }, bearbeiterFremd)).status).toBe(403);
    expect((await patch(`/rundenpositionen/${P_ORG_1}`, { anteilsklasseId: null }, bearbeiterHalter)).status).toBe(200); // Position eines Co-Investors, Unternehmen vom Fonds gehalten
  });
});

describe("Kapitaltabelle", () => {
  it("zeigt Klassen, Inhaber, ausgegebene Anteile (ohne Pool beide Sichten gleich) und die Position des Fonds", async () => {
    await seedKlasseZuweisen();
    const antwort = await get(`/beteiligungen/${ID.eigen}/kapitaltabelle?stichtag=2026-01-01`, betrachterHalter);
    expect(antwort.status).toBe(200);
    const d = await json(antwort);
    expect(d).toMatchObject({ beteiligungId: ID.eigen, stichtag: "2026-01-01", anteileGesamt: "1250000", anteileUnverwaessert: "1250000", anteileVollVerwaessert: "1250000", mitPool: false, standardSicht: "voll_verwaessert", organisation: { id: ID.orgA, name: "Alpha Beispiel" } });
    expect(d.letzteRunde).toMatchObject({ bezeichnung: "Serie A", postMoney: "6250000.00" });
    // Gründer und übrige: 1.250.000 − 250.000
    const stamm = d.zeilen.find((z: { halter: { art: string } }) => z.halter.art === "stamm");
    expect(stamm).toMatchObject({ id: "stamm", anteile: "1000000", anteilUnverwaessert: "0.800000", anteilVollVerwaessert: "0.800000", klasseId: null, runde: null, ausgegeben: true });
    expect(d.zeilen.reduce((summe: number, z: { anteile: string }) => summe + Number(z.anteile), 0)).toBe(1250000);
    const eigene = d.zeilen.filter((z: { diesesFonds: boolean }) => z.diesesFonds);
    expect(eigene).toHaveLength(2);
    expect(eigene[0]).toMatchObject({ halter: { art: "fonds", name: "Testfonds Eins" }, klasseName: "Seed-Vorzugsanteile", anteile: "50000", anteilUnverwaessert: "0.040000", investiert: "100000.00" });
    expect(d.diesesFonds).toEqual({ anteile: "90000", anteilUnverwaessert: "0.072000", anteilVollVerwaessert: "0.072000", investiert: "300000.00" });
    const seed = d.klassen.find((k: { name: string | null }) => k.name === "Seed-Vorzugsanteile");
    expect(seed).toMatchObject({ art: "klasse", anteile: "150000", anteilUnverwaessert: "0.120000", investiert: "300000.00", rang: 1 });
    expect(d.klassen.find((k: { id: string | null }) => k.id === null)).toMatchObject({ art: "stamm", name: null, anteile: "1100000" });
    // Summe der Anteile je Klasse = ausgegebene Anteile (ohne Pool)
    expect(d.klassen.reduce((summe: number, k: { anteile: string }) => summe + Number(k.anteile), 0)).toBe(1250000);
  });

  it("schneidet nach Stichtag: vor der zweiten Runde nur der Stand der Seed-Runde, vor jeder Runde leer", async () => {
    const d = await json(await get(`/beteiligungen/${ID.eigen}/kapitaltabelle?stichtag=2025-06-30`));
    expect(d.anteileGesamt).toBe("1150000");
    expect(d.letzteRunde.bezeichnung).toBe("Seed");
    expect(d.zeilen.filter((z: { halter: { art: string } }) => z.halter.art !== "stamm")).toHaveLength(2);
    const leer = await json(await get(`/beteiligungen/${ID.eigen}/kapitaltabelle?stichtag=2024-12-31`));
    expect(leer).toMatchObject({ anteileGesamt: "0", letzteRunde: null, zeilen: [], klassen: [] });
  });

  it("Fehler und Rechte: 404, ungültiger Stichtag, fremder Fonds", async () => {
    expect((await get(`/beteiligungen/${FALSCH}/kapitaltabelle`)).status).toBe(404);
    expect((await get(`/beteiligungen/${ID.eigen}/kapitaltabelle?stichtag=gestern`)).status).toBe(400);
    expect((await get(`/beteiligungen/${ID.eigen}/kapitaltabelle`, bearbeiterFremd)).status).toBe(403);
  });
});

describe("Wasserfall", () => {
  const exit = (koerper: object, als: Parameters<typeof post>[2] = betrachterHalter) => post(`/beteiligungen/${ID.eigen}/wasserfall`, { exitdatum: "2026-06-30", ...koerper }, als);

  it("Exit unter der Schwelle: Präferenz der Seed-Klasse zuerst, der Rest an die Stammanteile (von Hand gerechnet)", async () => {
    await seedKlasseZuweisen();
    const antwort = await exit({ exitwert: "1000000" });
    expect(antwort.status).toBe(200);
    const d = await json(antwort);
    expect(d.eingabe).toMatchObject({ exitwert: "1000000.00", kosten: "0.00", nettoErloes: "1000000.00", treuhandAnteil: "0.0000" });
    // Seed-Klasse: 12 % × 1 Mio = 120.000 < Präferenz 300.000: keine Umwandlung, Fonds-Position 1/3 der Präferenz
    expect(d.gewandelt).toEqual([]);
    const seedFonds = d.zeilen.find((z: { id: string }) => z.id === P_FONDS_1);
    expect(seedFonds).toMatchObject({ praeferenz: "100000.00", beteiligung: "0.00", gesamt: "100000.00", multiple: "1.0000", gewandelt: false, diesesFonds: true });
    // Rest 700.000 auf 1.100.000 Stammanteile: 40.000 Anteile der Serie-A-Position ohne Klasse = 25.454,5454…, nach der Methode des größten Rests 25.454,54
    const serieFonds = d.zeilen.find((z: { id: string }) => z.id === P_FONDS_2);
    expect(serieFonds).toMatchObject({ praeferenz: "0.00", gesamt: "25454.54", klasseId: null });
    expect(d.fonds).toMatchObject({ investiert: "300000.00", gesamt: "125454.54", sofort: "125454.54", treuhand: "0.00", multiple: "0.4182" });
    const summe = d.zeilen.reduce((x: number, z: { gesamt: string }) => x + Number(z.gesamt), 0);
    expect(summe.toFixed(2)).toBe("1000000.00");
    expect(d.schritte.length).toBeGreaterThan(5);
    expect(d.schritte[0]).toMatchObject({ bezeichnung: "Verteilbarer Erlös (netto nach Kosten)", wert: "1000000" });
  });

  it("Exit über der Schwelle: die Seed-Klasse wandelt (8 € je Anteil), mit Kosten und Treuhand", async () => {
    await seedKlasseZuweisen();
    const d = await json(await exit({ exitwert: "10500000", kosten: "500000", treuhandAnteil: "0.1" }));
    expect(d.eingabe.nettoErloes).toBe("10000000.00");
    expect(d.gewandelt).toHaveLength(1);
    // 10 Mio ÷ 1.250.000 Anteile = 8,00 je Anteil; Fonds: 90.000 Anteile = 720.000, Treuhand 10 %
    expect(d.fonds).toMatchObject({ gesamt: "720000.00", treuhand: "72000.00", sofort: "648000.00", multiple: "2.4000" });
    expect(d.zeilen.find((z: { id: string }) => z.id === P_FONDS_1)).toMatchObject({ gewandelt: true, praeferenz: "0.00", beteiligung: "400000.00" });
    expect(d.preisJeAnteil).toBe("8.000000");
    const klasse = d.klassen.find((k: { name: string | null }) => k.name === "Seed-Vorzugsanteile");
    expect(klasse).toMatchObject({ gewandelt: true, gesamt: "1200000.00" });
  });

  it("Null-Exit und Treuhand: alles null, keine Fehler", async () => {
    const d = await json(await exit({ exitwert: "0" }));
    expect(d.fonds.gesamt).toBe("0.00");
    expect(d.nichtVerteilt).toBe("0.00");
  });

  it("prüft Eingaben: Kosten über Exitwert, Treuhand ab 1, Formate, Datum", async () => {
    const kosten = await exit({ exitwert: "100", kosten: "100.01" });
    expect(kosten.status).toBe(400);
    expect((await json(kosten)).error.fields[0]).toMatchObject({ field: "kosten", code: "costs_exceed_exit_value" });
    for (const falsch of [{ treuhandAnteil: "1" }, { treuhandAnteil: "0.12345" }, { exitwert: "-5" }, { exitwert: "1.234" }, { exitdatum: "morgen" }, { exitwert: undefined }]) {
      expect((await exit({ exitwert: "1000", ...falsch })).status, JSON.stringify(falsch)).toBe(400);
    }
  });

  it("Beteiligung ohne Anteile aus Runden (Darlehen) und fremde Fonds", async () => {
    const darlehen = await post(`/beteiligungen/${ID.darlehen}/wasserfall`, { exitwert: "1000", exitdatum: "2026-06-30" }, betrachterHalter);
    expect(darlehen.status).toBe(409);
    expect((await json(darlehen)).error.code).toBe("waterfall_no_shares");
    expect((await exit({ exitwert: "1000" }, bearbeiterFremd)).status).toBe(403);
    expect((await post(`/beteiligungen/${FALSCH}/wasserfall`, { exitwert: "1", exitdatum: "2026-06-30" })).status).toBe(404);
  });

  it("schreibt nichts (kein Protokoll, keine Änderung an den Positionen)", async () => {
    await seedKlasseZuweisen();
    const vorher = await db.select().from(s.rundenposition).where(eq(s.rundenposition.id, P_FONDS_1));
    const protokoll = (await protokollZeilen(db, "rundenposition")).length;
    await exit({ exitwert: "5000000" });
    await get(`/beteiligungen/${ID.eigen}/wasserfall/kurve`, betrachterHalter);
    expect(await db.select().from(s.rundenposition).where(eq(s.rundenposition.id, P_FONDS_1))).toEqual(vorher);
    expect((await protokollZeilen(db, "rundenposition")).length).toBe(protokoll);
  });
});

describe("Kurve des Fonds", () => {
  const kurve = (abfrage: string, als: Parameters<typeof get>[1] = betrachterHalter) => get(`/beteiligungen/${ID.eigen}/wasserfall/kurve${abfrage}`, als);

  it("liefert Punkte von 0 bis bis, nicht fallende Rückflüsse und die Knickpunkte (Umwandlung bei 2,5 Mio)", async () => {
    await seedKlasseZuweisen();
    const antwort = await kurve("?bis=10000000&punkte=41&exitdatum=2026-06-30");
    expect(antwort.status).toBe(200);
    const d = await json(antwort);
    expect(d).toMatchObject({ bis: "10000000.00", hoechstwert: "625000000.00", postMoney: "6250000.00", investiert: "300000.00" });
    expect(d.punkte).toHaveLength(41);
    expect(d.punkte[0]).toMatchObject({ exitwert: "0.00", rueckfluss: "0.00" });
    expect(d.punkte.at(-1)).toMatchObject({ exitwert: "10000000.00", rueckfluss: "720000.00", multiple: "2.4000" });
    for (let i = 1; i < d.punkte.length; i++) expect(Number(d.punkte[i].rueckfluss)).toBeGreaterThanOrEqual(Number(d.punkte[i - 1].rueckfluss));
    // Schwelle: Präferenz 300.000 ÷ 12 % = 2,5 Mio; Präferenz voll bei 300.000
    const umwandlung = d.knicke.find((k: { ereignisse: { art: string }[] }) => k.ereignisse.some((e) => e.art === "umwandlung"));
    expect(Math.abs(Number(umwandlung.exitwert) - 2_500_000)).toBeLessThanOrEqual(0.01);
    expect(umwandlung.ereignisse[0]).toMatchObject({ klasseName: "Seed-Vorzugsanteile" });
    expect(d.knicke.some((k: { exitwert: string }) => Math.abs(Number(k.exitwert) - 300_000) <= 0.01)).toBe(true);
  });

  it("stimmt mit dem Wasserfall an einem Punkt überein", async () => {
    await seedKlasseZuweisen();
    const d = await json(await kurve("?bis=4000000&punkte=5&exitdatum=2026-06-30"));
    const mitte = d.punkte[2]; // 2 Mio
    const wf = await json(await post(`/beteiligungen/${ID.eigen}/wasserfall`, { exitwert: mitte.exitwert, exitdatum: "2026-06-30" }, betrachterHalter));
    expect(Math.abs(Number(mitte.rueckfluss) - Number(wf.fonds.gesamt))).toBeLessThanOrEqual(0.02);
  });

  it("Grenzen: 200 Punkte gehen, 201 und 1 nicht; bis genau 100 × Post-Money geht, ein Cent mehr nicht", async () => {
    expect((await kurve("?punkte=200")).status).toBe(200);
    const zuViele = await kurve("?punkte=201");
    expect(zuViele.status).toBe(400);
    expect((await json(zuViele)).error.fields[0]).toMatchObject({ field: "punkte", code: "too_big" });
    expect((await kurve("?punkte=1")).status).toBe(400);
    expect((await kurve("?punkte=abc")).status).toBe(400);
    expect((await kurve("?bis=625000000&punkte=20")).status).toBe(200);
    const drueber = await kurve("?bis=625000000.01&punkte=20");
    expect(drueber.status).toBe(400);
    expect((await json(drueber)).error.fields[0]).toMatchObject({ field: "bis", code: "too_big" });
    expect((await kurve("?bis=0")).status).toBe(400);
    expect((await kurve("?bis=-5")).status).toBe(400);
  });

  it("Standardwerte, Beteiligung ohne Anteile, Rechte", async () => {
    const d = await json(await kurve(""));
    expect(d.punkte).toHaveLength(50);
    expect(d.bis).toBe("31250000.00");
    expect((await get(`/beteiligungen/${ID.darlehen}/wasserfall/kurve`, betrachterHalter)).status).toBe(409);
    expect((await kurve("", bearbeiterFremd)).status).toBe(403);
    expect((await get(`/beteiligungen/${FALSCH}/wasserfall/kurve`)).status).toBe(404);
  });
});
