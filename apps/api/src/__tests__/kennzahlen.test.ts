import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { json, leeren, oeffneTestdb } from "./hilfen";
import { erstelleTestApp, legePersonAn, person, type Testperson } from "./hilfen-auth";
import { grundbestand, ID } from "./hilfen-instrumente";

/** Kennzahlen der Portfoliounternehmen: Katalog, Werte, Zeitreihen, Übersicht. Alle Daten sind erfunden. */

const { db, pool } = oeffneTestdb();
const t = erstelleTestApp(db);

const betrachter = person("kz-betrachter", { rollen: { [ID.fonds]: "betrachter" } });
const bearbeiter = person("kz-bearbeiter", { rollen: { [ID.fonds]: "bearbeiter" } });
const verwalter = person("kz-verwalter", { rollen: { [ID.fonds]: "verwalter" } });
const fremd = person("kz-fremd", { rollen: { [ID.anderer]: "verwalter" } });

const senden = (methode: string) => (pfad: string, koerper?: unknown, als?: Testperson) =>
  t.request(pfad, { method: methode, headers: { "content-type": "application/json" }, body: koerper === undefined ? undefined : JSON.stringify(koerper), ...(als ? { als } : {}) });
const get = (pfad: string, als?: Testperson) => t.request(pfad, als ? { als } : {});
const post = senden("POST");
const put = senden("PUT");
const patch = senden("PATCH");
const del = senden("DELETE");

const Q3 = { periodeBeginn: "2026-07-01", periodeEnde: "2026-09-30" };

beforeEach(async () => {
  await grundbestand(db);
  for (const p of [betrachter, bearbeiter, verwalter, fremd]) await legePersonAn(db, p);
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

/** Legt einen Wert über die API an und bestätigt ihn. */
async function bestaetigterWert(beteiligungId: string, schluessel: string, wert: string, szenario = "ist", zeitraum: { periodeBeginn: string; periodeEnde: string } = Q3, als = bearbeiter) {
  const neu = await post(`/beteiligungen/${beteiligungId}/kennzahlen/werte`, { schluessel, szenario, wert, ...zeitraum }, als);
  expect(neu.status).toBe(201);
  const w = await json(neu);
  const ok = await post(`/kennzahlen/werte/${w.id}/bestaetigen`, undefined, als);
  expect(ok.status).toBe(200);
  return json(ok);
}

/** Direkt in der Datenbank (Wert zu einer Kennzahl, ohne API), für große Mengen im Übersichtstest. */
async function wertDirekt(beteiligungId: string, schluessel: string, status: "entwurf" | "eingereicht" | "bestaetigt", zeitraum = Q3, szenario: "ist" | "plan" | "forecast" = "ist", wert = "100") {
  const [d] = await db.select().from(s.kennzahlDefinition).where(sql`${s.kennzahlDefinition.schluessel} = ${schluessel}`).orderBy(sql`${s.kennzahlDefinition.katalogVersion} DESC`).limit(1);
  await db.insert(s.kennzahlWert).values({
    beteiligungId,
    definitionId: d!.id,
    ...zeitraum,
    szenario,
    wert,
    quelle: "intern",
    erfasstVon: "test",
    status,
    ...(status === "bestaetigt" ? { bestaetigtVon: "test", bestaetigtAm: new Date() } : {}),
  });
}

describe("Katalog (versionierte Konfiguration)", () => {
  it("der Standardkatalog steht in Version 1 bereit, mit dem ESG-Block der Nachhaltigkeitsindikatoren", async () => {
    const antwort = await get("/kennzahlen/katalog", betrachter);
    expect(antwort.status).toBe(200);
    const daten = (await json(antwort)).daten as { schluessel: string; katalogVersion: number; kategorie: string; typ: string; einheit: string; periodizitaet: string; aggregation: string }[];
    expect(daten.map((d) => d.schluessel)).toEqual(expect.arrayContaining(["umsatz", "ebitda", "liquiditaet", "mittelabfluss_monat", "mitarbeitende_vzae", "arr", "kundenzahl"]));
    expect(daten.every((d) => d.katalogVersion === 1)).toBe(true);
    expect(daten.find((d) => d.schluessel === "umsatz")).toMatchObject({ kategorie: "finanzen", typ: "betrag", einheit: "EUR", periodizitaet: "monat", aggregation: "summe" });
    expect(daten.find((d) => d.schluessel === "liquiditaet")).toMatchObject({ aggregation: "stand" });
    expect(daten.find((d) => d.schluessel === "mittelabfluss_monat")).toMatchObject({ aggregation: "durchschnitt" });
    const esg = daten.filter((d) => d.kategorie.startsWith("esg_")).map((d) => d.kategorie);
    expect(esg.filter((k) => k === "esg_umwelt").length).toBe(10);
    expect(esg.filter((k) => k === "esg_sozial").length).toBe(3);
    expect(esg.filter((k) => k === "esg_governance").length).toBe(4);
    expect(daten.find((d) => d.schluessel === "esg_thg_scope1")).toMatchObject({ einheit: "t CO2e", periodizitaet: "jahr" });
  });

  it("lesen darf jede Rolle, anlegen, neue Version und außer Kraft nur ein globaler Verwalter (ein Verwalter eines Fonds nicht)", async () => {
    const neu = { schluessel: "test_gmv", bezeichnungDe: "Bruttowarenwert", bezeichnungEn: "Gross merchandise value", einheit: "EUR", typ: "betrag", kategorie: "betrieb", periodizitaet: "monat", aggregation: "summe" };
    expect((await post("/kennzahlen/katalog", neu, bearbeiter)).status).toBe(403);
    expect((await post("/kennzahlen/katalog", neu, betrachter)).status).toBe(403);
    expect((await post("/kennzahlen/katalog", neu, verwalter)).status).toBe(403); // Verwalter eines Fonds, aber nicht global
    expect((await post("/kennzahlen/katalog", neu)).status).toBe(201); // Standardperson ist globaler Verwalter
    for (const als of [bearbeiter, verwalter]) {
      expect((await post("/kennzahlen/katalog/test_gmv/versionen", { einheit: "TEUR" }, als)).status).toBe(403);
      expect((await del("/kennzahlen/katalog/test_gmv", undefined, als)).status).toBe(403);
    }
    expect((await post("/kennzahlen/katalog/test_gmv/versionen", { einheit: "TEUR", gueltigAb: "2099-01-01" })).status).toBe(201);
    expect((await get("/kennzahlen/katalog", betrachter)).status).toBe(200);
  });

  it("Versionen: Bezeichnung ändert sich, Typ und Kategorie bleiben, die alte Version endet am Vortag", async () => {
    const neu = { schluessel: "test_gmv", bezeichnungDe: "Bruttowarenwert", bezeichnungEn: "Gross merchandise value", einheit: "EUR", typ: "betrag", kategorie: "betrieb", periodizitaet: "monat", aggregation: "summe", gueltigAb: "2026-01-01" };
    await post("/kennzahlen/katalog", neu);
    expect((await post("/kennzahlen/katalog", neu)).status).toBe(409);
    const v2 = await post("/kennzahlen/katalog/test_gmv/versionen", { bezeichnungDe: "Bruttowarenvolumen", gueltigAb: "2026-07-01" });
    expect(v2.status).toBe(201);
    expect(await json(v2)).toMatchObject({ katalogVersion: 2, bezeichnungDe: "Bruttowarenvolumen", typ: "betrag", kategorie: "betrieb", gueltigAb: "2026-07-01", gueltigBis: null });
    const alle = ((await json(await get("/kennzahlen/katalog?alle=true"))).daten as { schluessel: string; katalogVersion: number; gueltigBis: string | null }[]).filter((d) => d.schluessel === "test_gmv");
    expect(alle.map((d) => [d.katalogVersion, d.gueltigBis])).toEqual([[2, null], [1, "2026-06-30"]]);
    expect((await post("/kennzahlen/katalog/test_gmv/versionen", { einheit: "TEUR", gueltigAb: "2026-07-01" })).status).toBe(409); // nicht nach dem Beginn der bisherigen
    expect((await post("/kennzahlen/katalog/gibt_es_nicht/versionen", { einheit: "x" })).status).toBe(404);
  });

  it("außer Kraft: gilt nicht mehr im aktuellen Katalog, Version und Werte bleiben", async () => {
    await post("/kennzahlen/katalog", { schluessel: "test_alt", bezeichnungDe: "Alt", bezeichnungEn: "Old", einheit: "Anzahl", typ: "zahl", kategorie: "betrieb", periodizitaet: "quartal", aggregation: "stand", gueltigAb: "2025-01-01" });
    const aus = await del("/kennzahlen/katalog/test_alt");
    expect(aus.status).toBe(200);
    expect((await json(aus)).gueltigBis).not.toBeNull();
    expect(((await json(await get("/kennzahlen/katalog"))).daten as { schluessel: string }[]).some((d) => d.schluessel === "test_alt")).toBe(false);
    expect(((await json(await get("/kennzahlen/katalog?alle=true"))).daten as { schluessel: string }[]).some((d) => d.schluessel === "test_alt")).toBe(true);
    expect((await del("/kennzahlen/katalog/test_alt")).status).toBe(409);
  });

  it("zuletzt bestätigt zählt über Katalogversionen hinweg (der Schlüssel, nicht die Zeile der Definition, bildet die Reihe)", async () => {
    await post("/kennzahlen/katalog", { schluessel: "test_umsatz", bezeichnungDe: "Testumsatz", bezeichnungEn: "Test revenue", einheit: "EUR", typ: "betrag", kategorie: "finanzen", periodizitaet: "quartal", aggregation: "summe", gueltigAb: "2026-01-01" });
    const erst = await bestaetigterWert(ID.eigen, "test_umsatz", "1000.00");
    // Die Katalogversion ändert sich rückwirkend; die Korrektur für denselben Zeitraum nutzt jetzt die neue Version.
    expect((await post("/kennzahlen/katalog/test_umsatz/versionen", { bezeichnungDe: "Testumsatz netto", gueltigAb: "2026-02-01" })).status).toBe(201);
    const korrektur = await bestaetigterWert(ID.eigen, "test_umsatz", "1100.00");
    expect(korrektur.definitionId).not.toBe(erst.definitionId);
    const reihe = await json(await get(`/beteiligungen/${ID.eigen}/kennzahlen?von=2026-01-01&bis=2026-12-31`, betrachter));
    const k = reihe.kennzahlen.find((x: { schluessel: string }) => x.schluessel === "test_umsatz");
    expect(k.bezeichnungDe).toBe("Testumsatz netto");
    expect(k.punkte).toHaveLength(1);
    expect(k.punkte[0].ist).toMatchObject({ id: korrektur.id, wert: "1100" });
  });
});

describe("Auswahl je Fonds", () => {
  it("Verwalter des Fonds ersetzt die Auswahl, Betrachter liest, andere Fonds dürfen nicht", async () => {
    const auswahl = { schluessel: ["umsatz", "liquiditaet", "ebitda"] };
    expect((await put(`/fonds/${ID.fonds}/kennzahlen/auswahl`, auswahl, bearbeiter)).status).toBe(403);
    expect((await put(`/fonds/${ID.fonds}/kennzahlen/auswahl`, auswahl, fremd)).status).toBe(403);
    expect((await put(`/fonds/${ID.fonds}/kennzahlen/auswahl`, auswahl, verwalter)).status).toBe(200);
    const gelesen = await json(await get(`/fonds/${ID.fonds}/kennzahlen/auswahl`, betrachter));
    expect(gelesen.daten.map((d: { schluessel: string }) => d.schluessel)).toEqual(["umsatz", "liquiditaet", "ebitda"]);
    expect(gelesen.daten[0]).toMatchObject({ gueltig: true, definition: { bezeichnungDe: "Umsatz" } });
    expect((await get(`/fonds/${ID.fonds}/kennzahlen/auswahl`, fremd)).status).toBe(403);
    expect((await put(`/fonds/${ID.fonds}/kennzahlen/auswahl`, { schluessel: ["gibt_es_nicht"] }, verwalter)).status).toBe(404);
    expect((await put(`/fonds/${ID.fonds}/kennzahlen/auswahl`, { schluessel: ["umsatz", "umsatz"] }, verwalter)).status).toBe(400);
    const zeilen = await db.execute(sql`SELECT akteur, aktion, tabelle, fonds_id FROM aenderung WHERE tabelle = 'fonds_kennzahl'`);
    expect(zeilen.rows[0]).toMatchObject({ aktion: "aendern", fonds_id: ID.fonds });
  });
});

describe("Werte: Entwurf, Änderung, Bestätigung und Verlauf", () => {
  it("anlegen als Entwurf, ändern, bestätigen; bestätigte Werte ändern sich nie", async () => {
    const neu = await post(`/beteiligungen/${ID.eigen}/kennzahlen/werte`, { schluessel: "umsatz", szenario: "ist", wert: "250000.5", ...Q3, kommentar: "vorläufig" }, bearbeiter);
    expect(neu.status).toBe(201);
    const w = await json(neu);
    expect(w).toMatchObject({ status: "entwurf", quelle: "intern", wert: "250000.5", szenario: "ist", kommentar: "vorläufig" });
    expect(w.erfasstVon).not.toBe("system");
    expect((await post(`/beteiligungen/${ID.eigen}/kennzahlen/werte`, { schluessel: "umsatz", szenario: "ist", wert: "1", ...Q3 }, bearbeiter)).status).toBe(409);
    const geaendert = await patch(`/kennzahlen/werte/${w.id}`, { wert: "251000.00" }, bearbeiter);
    expect(geaendert.status).toBe(200);
    expect((await json(geaendert)).wert).toBe("251000");
    expect((await post(`/kennzahlen/werte/${w.id}/bestaetigen`, undefined, betrachter)).status).toBe(403);
    const ok = await post(`/kennzahlen/werte/${w.id}/bestaetigen`, undefined, bearbeiter);
    expect(ok.status).toBe(200);
    expect(await json(ok)).toMatchObject({ status: "bestaetigt" });
    expect((await patch(`/kennzahlen/werte/${w.id}`, { wert: "1" }, bearbeiter)).status).toBe(409);
    expect((await post(`/kennzahlen/werte/${w.id}/bestaetigen`, undefined, bearbeiter)).status).toBe(409);
    expect((await post(`/kennzahlen/werte/${w.id}/verwerfen`, undefined, bearbeiter)).status).toBe(409);
    const protokoll = await db.execute(sql`SELECT aktion, fonds_id FROM aenderung WHERE tabelle = 'kennzahl_wert' AND datensatz_id = ${w.id} ORDER BY am, id`);
    expect(protokoll.rows.map((r) => (r as { aktion: string }).aktion)).toEqual(["anlegen", "aendern", "bestaetigen"]);
    expect(protokoll.rows.every((r) => (r as { fonds_id: string }).fonds_id === ID.fonds)).toBe(true);
  });

  it("eine Korrektur ist ein neuer Wert; der zuletzt bestätigte zählt, die Historie bleibt, Entwürfe zählen nie", async () => {
    const erst = await bestaetigterWert(ID.eigen, "umsatz", "100.00");
    const korr = await bestaetigterWert(ID.eigen, "umsatz", "120.00");
    const entwurf = await post(`/beteiligungen/${ID.eigen}/kennzahlen/werte`, { schluessel: "umsatz", szenario: "ist", wert: "999.00", ...Q3 }, bearbeiter);
    expect(entwurf.status).toBe(201);
    const reihe = await json(await get(`/beteiligungen/${ID.eigen}/kennzahlen?von=2026-01-01&bis=2026-12-31`, betrachter));
    const k = reihe.kennzahlen.find((x: { schluessel: string }) => x.schluessel === "umsatz");
    expect(k.punkte).toHaveLength(1);
    expect(k.punkte[0].ist).toMatchObject({ id: korr.id, wert: "120" });
    expect(reihe.offen.map((o: { wert: string }) => o.wert)).toEqual(["999"]);
    const historie = await db.execute(sql`SELECT id FROM kennzahl_wert WHERE beteiligung_id = ${ID.eigen} AND status = 'bestaetigt' ORDER BY folge`);
    expect(historie.rows.map((r) => (r as { id: string }).id)).toEqual([erst.id, korr.id]);
  });

  it("Wissensstand: mit `stand` zählen nur Bestätigungen bis dahin", async () => {
    const [d] = await db.select().from(s.kennzahlDefinition).where(sql`${s.kennzahlDefinition.schluessel} = 'umsatz'`);
    const basis = { beteiligungId: ID.eigen, definitionId: d!.id, ...Q3, szenario: "ist" as const, quelle: "intern" as const, erfasstVon: "test", status: "bestaetigt" as const, bestaetigtVon: "test" };
    await db.insert(s.kennzahlWert).values({ ...basis, wert: "100", bestaetigtAm: new Date("2026-10-01T10:00:00Z") });
    await db.insert(s.kennzahlWert).values({ ...basis, wert: "120", bestaetigtAm: new Date("2026-11-01T10:00:00Z") });
    const wertBei = async (stand?: string) => {
      const k = (await json(await get(`/beteiligungen/${ID.eigen}/kennzahlen?von=2026-01-01&bis=2026-12-31${stand ? `&stand=${encodeURIComponent(stand)}` : ""}`, betrachter))).kennzahlen.find((x: { schluessel: string }) => x.schluessel === "umsatz");
      return k?.punkte[0]?.ist?.wert ?? null;
    };
    expect(await wertBei()).toBe("120");
    expect(await wertBei("2026-10-15T00:00:00Z")).toBe("100");
    expect(await wertBei("2026-09-01T00:00:00Z")).toBeNull();
  });

  it("gleicher Bestätigungszeitpunkt: die später angelegte Zeile gewinnt (feste Reihenfolge)", async () => {
    const zeit = new Date("2026-10-05T10:00:00.000Z");
    const [d] = await db.select().from(s.kennzahlDefinition).where(sql`${s.kennzahlDefinition.schluessel} = 'umsatz'`);
    const basis = { beteiligungId: ID.eigen, definitionId: d!.id, ...Q3, szenario: "ist" as const, quelle: "intern" as const, erfasstVon: "test", status: "bestaetigt" as const, bestaetigtVon: "test", bestaetigtAm: zeit };
    await db.insert(s.kennzahlWert).values({ ...basis, wert: "1" });
    const [spaeter] = await db.insert(s.kennzahlWert).values({ ...basis, wert: "2" }).returning();
    const k = (await json(await get(`/beteiligungen/${ID.eigen}/kennzahlen?von=2026-01-01&bis=2026-12-31`, betrachter))).kennzahlen.find((x: { schluessel: string }) => x.schluessel === "umsatz");
    expect(k.punkte[0].ist).toMatchObject({ id: spaeter!.id, wert: "2" });
  });

  it("Eingabe je Typ: negatives EBITDA ist erlaubt, Betrag höchstens zwei Nachkommastellen, Ja/Nein, Zeitraum und unbekannte Kennzahl", async () => {
    const anlegen = (koerper: object) => post(`/beteiligungen/${ID.eigen}/kennzahlen/werte`, { szenario: "ist", ...Q3, ...koerper }, bearbeiter);
    const negativ = await anlegen({ schluessel: "ebitda", wert: "-125000.50" });
    expect(negativ.status).toBe(201);
    expect((await json(negativ)).wert).toBe("-125000.5");
    expect((await anlegen({ schluessel: "liquiditaet", wert: "0" })).status).toBe(201);
    for (const wert of ["12,5", "1.5e3", "abc", "", "1.234", " 5", "--5"]) {
      const a = await anlegen({ schluessel: "arr", wert });
      expect(a.status, wert).toBe(400);
      expect((await json(a)).fehler.code).toBe("KENNZAHL_WERT_UNGUELTIG");
    }
    expect((await anlegen({ schluessel: "esg_verstoesse_ungc", wert: "vielleicht", periodeBeginn: "2026-01-01", periodeEnde: "2026-12-31" })).status).toBe(400);
    expect((await anlegen({ schluessel: "esg_verstoesse_ungc", wert: "nein", periodeBeginn: "2026-01-01", periodeEnde: "2026-12-31" })).status).toBe(201);
    expect((await anlegen({ schluessel: "esg_frauenanteil_leitung", wert: "37.5", periodeBeginn: "2026-01-01", periodeEnde: "2026-12-31" })).status).toBe(201);
    const falscherZeitraum = await anlegen({ schluessel: "umsatz", wert: "1", periodeBeginn: "2026-07-01", periodeEnde: "2026-10-31" });
    expect((await json(falscherZeitraum)).fehler.code).toBe("KENNZAHL_PERIODE_UNGUELTIG");
    const zuFein = await anlegen({ schluessel: "esg_thg_scope1", wert: "5", periodeBeginn: "2026-07-01", periodeEnde: "2026-09-30" });
    expect((await json(zuFein)).fehler.code).toBe("KENNZAHL_PERIODE_ZU_FEIN");
    const monatFuerQuartalskennzahl = await anlegen({ schluessel: "kundenzahl", wert: "10", periodeBeginn: "2026-07-01", periodeEnde: "2026-07-31" });
    expect((await json(monatFuerQuartalskennzahl)).fehler.code).toBe("KENNZAHL_PERIODE_ZU_FEIN");
    expect((await anlegen({ schluessel: "gibt_es_nicht", wert: "1" })).status).toBe(404);
    expect((await post(`/beteiligungen/${ID.eigen}/kennzahlen/werte`, { schluessel: "umsatz", szenario: "ist", wert: "1", periodeBeginn: "2026-07-01" }, bearbeiter)).status).toBe(400);
  });

  it("Zeiträume vor dem Beginn des Katalogs (2026-01-01) lassen sich erfassen: die erste Version gilt rückwärts; eine außer Kraft gesetzte Kennzahl bleibt für spätere Zeiträume unbekannt", async () => {
    const q4 = { periodeBeginn: "2025-10-01", periodeEnde: "2025-12-31" };
    const w = await bestaetigterWert(ID.eigen, "umsatz", "900.00", "ist", q4);
    expect(w.definitionId).toBe((await db.select().from(s.kennzahlDefinition).where(sql`${s.kennzahlDefinition.schluessel} = 'umsatz'`))[0]!.id);
    const reihe = (await json(await get(`/beteiligungen/${ID.eigen}/kennzahlen?von=2025-01-01&bis=2025-12-31`, betrachter))).kennzahlen.find((x: { schluessel: string }) => x.schluessel === "umsatz");
    expect(reihe.punkte).toHaveLength(1);
    expect((await get(`/fonds/${ID.fonds}/kennzahlen/uebersicht?periode=2025-Q4`, betrachter)).status).toBe(200);
    await post("/kennzahlen/katalog", { schluessel: "test_alt2", bezeichnungDe: "Alt", bezeichnungEn: "Old", einheit: "x", typ: "zahl", kategorie: "betrieb", periodizitaet: "quartal", aggregation: "stand", gueltigAb: "2025-01-01" });
    await del("/kennzahlen/katalog/test_alt2");
    const spaeter = await post(`/beteiligungen/${ID.eigen}/kennzahlen/werte`, { schluessel: "test_alt2", szenario: "ist", wert: "1", periodeBeginn: "2026-10-01", periodeEnde: "2026-12-31" }, bearbeiter);
    expect(spaeter.status).toBe(404);
    expect((await post(`/beteiligungen/${ID.eigen}/kennzahlen/werte`, { schluessel: "test_alt2", szenario: "ist", wert: "1", periodeBeginn: "2025-04-01", periodeEnde: "2025-06-30" }, bearbeiter)).status).toBe(201);
  });

  it("Rechte: Betrachter liest, schreibt aber nicht; andere Fonds sehen nichts; verwerfen schließt den Entwurf", async () => {
    const koerper = { schluessel: "umsatz", szenario: "ist", wert: "5", ...Q3 };
    expect((await post(`/beteiligungen/${ID.eigen}/kennzahlen/werte`, koerper, betrachter)).status).toBe(403);
    expect((await post(`/beteiligungen/${ID.eigen}/kennzahlen/werte`, koerper, fremd)).status).toBe(403);
    expect((await get(`/beteiligungen/${ID.eigen}/kennzahlen`, betrachter)).status).toBe(200);
    expect((await get(`/beteiligungen/${ID.eigen}/kennzahlen`, fremd)).status).toBe(403);
    const w = await json(await post(`/beteiligungen/${ID.eigen}/kennzahlen/werte`, koerper, bearbeiter));
    expect((await patch(`/kennzahlen/werte/${w.id}`, { wert: "6" }, fremd)).status).toBe(403);
    expect((await post(`/kennzahlen/werte/${w.id}/verwerfen`, undefined, bearbeiter)).status).toBe(200);
    expect((await patch(`/kennzahlen/werte/${w.id}`, { wert: "6" }, bearbeiter)).status).toBe(409);
    const reihe = await json(await get(`/beteiligungen/${ID.eigen}/kennzahlen`, betrachter));
    expect(reihe.offen).toEqual([]);
    expect((await get(`/beteiligungen/${ID.eigen}/kennzahlen?von=2026-12-01&bis=2026-01-01`, betrachter)).status).toBe(400);
  });
});

describe("Zeitreihe und Abweichung Plan gegen Ist (Referenzfälle aus referenz_kpi.py)", () => {
  it("Umsatz: Ist 1.234.567,89 gegen Plan 1.300.000: −65.432,11 und −5,03 %, mit Rechenweg; Forecast bleibt getrennt", async () => {
    await bestaetigterWert(ID.eigen, "umsatz", "1234567.89");
    await bestaetigterWert(ID.eigen, "umsatz", "1300000.00", "plan");
    await bestaetigterWert(ID.eigen, "umsatz", "1280000.00", "forecast");
    const k = (await json(await get(`/beteiligungen/${ID.eigen}/kennzahlen?von=2026-01-01&bis=2026-12-31`, betrachter))).kennzahlen.find((x: { schluessel: string }) => x.schluessel === "umsatz");
    expect(k.punkte).toHaveLength(1);
    expect(k.punkte[0]).toMatchObject({ periodeBeginn: "2026-07-01", ist: { wert: "1234567.89" }, plan: { wert: "1300000" }, forecast: { wert: "1280000" } });
    expect(k.punkte[0].abweichung).toMatchObject({ absolut: "-65432.11", prozent: "-5.03" });
    expect(k.punkte[0].abweichung.schritte.map((x: { bezeichnung: string }) => x.bezeichnung)).toContain("Abweichung absolut");
    // Mit szenario=ist bleibt die Abweichung (sie braucht den Plan), der Plan selbst erscheint nicht
    const nurIst = (await json(await get(`/beteiligungen/${ID.eigen}/kennzahlen?von=2026-01-01&bis=2026-12-31&szenario=ist`, betrachter))).kennzahlen.find((x: { schluessel: string }) => x.schluessel === "umsatz");
    expect(nurIst.punkte[0]).toMatchObject({ ist: { wert: "1234567.89" }, plan: null, forecast: null, abweichung: { absolut: "-65432.11" } });
    const nurPlan = await json(await get(`/beteiligungen/${ID.eigen}/kennzahlen?von=2026-01-01&bis=2026-12-31&szenario=plan`, betrachter));
    expect(nurPlan.kennzahlen.find((x: { schluessel: string }) => x.schluessel === "umsatz").punkte[0]).toMatchObject({ ist: null, abweichung: null });
  });

  it("EBITDA mit negativem Plan: −80.000 gegen −120.000 ergibt +40.000 und +33,33 %; Plan 0 hat keine relative Abweichung", async () => {
    await bestaetigterWert(ID.eigen, "ebitda", "-80000", "ist");
    await bestaetigterWert(ID.eigen, "ebitda", "-120000", "plan");
    await bestaetigterWert(ID.eigen, "liquiditaet", "5000", "ist");
    await bestaetigterWert(ID.eigen, "liquiditaet", "0", "plan");
    const reihe = (await json(await get(`/beteiligungen/${ID.eigen}/kennzahlen?von=2026-01-01&bis=2026-12-31`, betrachter))).kennzahlen;
    expect(reihe.find((x: { schluessel: string }) => x.schluessel === "ebitda").punkte[0].abweichung).toMatchObject({ absolut: "40000", prozent: "33.33" });
    expect(reihe.find((x: { schluessel: string }) => x.schluessel === "liquiditaet").punkte[0].abweichung).toMatchObject({ absolut: "5000", prozent: null });
  });

  it("Ja/Nein hat keine Abweichung; Zeitraum filtert; ausgewählte Kennzahlen erscheinen auch ohne Werte; Verdichtung nach Aggregation", async () => {
    await put(`/fonds/${ID.fonds}/kennzahlen/auswahl`, { schluessel: ["umsatz", "liquiditaet", "esg_verstoesse_ungc"] }, verwalter);
    const jahr = { periodeBeginn: "2026-01-01", periodeEnde: "2026-12-31" };
    await bestaetigterWert(ID.eigen, "esg_verstoesse_ungc", "nein", "ist", jahr);
    await bestaetigterWert(ID.eigen, "esg_verstoesse_ungc", "ja", "plan", jahr);
    const q1 = { periodeBeginn: "2026-01-01", periodeEnde: "2026-03-31" };
    const q2 = { periodeBeginn: "2026-04-01", periodeEnde: "2026-06-30" };
    await bestaetigterWert(ID.eigen, "umsatz", "100.10", "ist", q1);
    await bestaetigterWert(ID.eigen, "umsatz", "200.20", "ist", q2);
    await bestaetigterWert(ID.eigen, "umsatz", "300.30", "ist", Q3);
    const reihe = (await json(await get(`/beteiligungen/${ID.eigen}/kennzahlen?von=2026-01-01&bis=2026-12-31`, betrachter))).kennzahlen;
    expect(reihe.find((x: { schluessel: string }) => x.schluessel === "esg_verstoesse_ungc").punkte[0]).toMatchObject({ ist: { wert: "nein" }, plan: { wert: "ja" }, abweichung: null });
    const liquiditaet = reihe.find((x: { schluessel: string }) => x.schluessel === "liquiditaet");
    expect(liquiditaet).toMatchObject({ angefordert: true, punkte: [] });
    const umsatz = reihe.find((x: { schluessel: string }) => x.schluessel === "umsatz");
    expect(umsatz.punkte.map((p: { periodeBeginn: string }) => p.periodeBeginn)).toEqual(["2026-01-01", "2026-04-01", "2026-07-01"]);
    expect(umsatz.verdichtung).toMatchObject({ wert: "600.6", zeitraeume: 3 }); // Summe aus der Referenz (100,10 + 200,20 + 300,30)
    const eng = (await json(await get(`/beteiligungen/${ID.eigen}/kennzahlen?von=2026-04-01&bis=2026-06-30`, betrachter))).kennzahlen.find((x: { schluessel: string }) => x.schluessel === "umsatz");
    expect(eng.punkte).toHaveLength(1);
    expect(eng.punkte[0].ist.wert).toBe("200.2");
  });
});

describe("Übersicht je Fonds (Vollständigkeit gegen unabhängiges SQL)", () => {
  it("angefordert, eingereicht und bestätigt je Unternehmen stimmen mit einer eigenen SQL-Abfrage überein", async () => {
    await put(`/fonds/${ID.fonds}/kennzahlen/auswahl`, { schluessel: ["umsatz", "ebitda", "liquiditaet", "mitarbeitende_vzae", "esg_thg_scope1"] }, verwalter);
    const monat = { periodeBeginn: "2026-07-01", periodeEnde: "2026-07-31" };
    const jahr = { periodeBeginn: "2026-01-01", periodeEnde: "2026-12-31" };
    await wertDirekt(ID.eigen, "umsatz", "bestaetigt");
    await wertDirekt(ID.eigen, "ebitda", "eingereicht");
    await wertDirekt(ID.eigen, "liquiditaet", "entwurf");
    await wertDirekt(ID.eigen, "ebitda", "bestaetigt", Q3, "plan");
    await wertDirekt(ID.eigen, "umsatz", "bestaetigt", monat);
    await wertDirekt(ID.eigen, "esg_thg_scope1", "bestaetigt", jahr);
    for (const k of ["umsatz", "ebitda", "liquiditaet"]) await wertDirekt(ID.darlehen, k, "bestaetigt");
    await wertDirekt(ID.darlehen, "mitarbeitende_vzae", "eingereicht");
    await wertDirekt(ID.darlehen, "umsatz", "bestaetigt", Q3, "forecast");

    for (const [periode, beginn, ende] of [["2026-Q3", "2026-07-01", "2026-09-30"], ["2026", "2026-01-01", "2026-12-31"], ["2026-07", "2026-07-01", "2026-07-31"]] as const) {
      const antwort = await get(`/fonds/${ID.fonds}/kennzahlen/uebersicht?periode=${periode}`, betrachter);
      expect(antwort.status, periode).toBe(200);
      const api = await json(antwort);
      const { rows } = await db.execute<{ id: string; angefordert: number; eingereicht: number; bestaetigt: number }>(sql`
        WITH gew AS (
          SELECT k.schluessel, d.id AS definition_id, d.periodizitaet
          FROM fonds_kennzahl k
          JOIN LATERAL (SELECT * FROM kennzahl_definition x WHERE x.schluessel = k.schluessel AND x.gueltig_ab <= ${ende}::date AND (x.gueltig_bis IS NULL OR x.gueltig_bis >= ${ende}::date) ORDER BY x.katalog_version DESC LIMIT 1) d ON true
          WHERE k.fonds_id = ${ID.fonds}
            AND CASE d.periodizitaet WHEN 'jahr' THEN ${periode.length === 4} WHEN 'quartal' THEN ${periode.length === 4 || periode.includes("Q")} ELSE true END
        )
        SELECT b.id,
          (SELECT count(*)::int FROM gew) AS angefordert,
          (SELECT count(*)::int FROM gew g WHERE EXISTS (SELECT 1 FROM kennzahl_wert w JOIN kennzahl_definition x ON x.id = w.definition_id WHERE w.beteiligung_id = b.id AND x.schluessel = g.schluessel AND w.periode_beginn = ${beginn}::date AND w.periode_ende = ${ende}::date AND w.szenario = 'ist' AND w.verworfen_am IS NULL AND w.status IN ('eingereicht', 'bestaetigt'))) AS eingereicht,
          (SELECT count(*)::int FROM gew g WHERE EXISTS (SELECT 1 FROM kennzahl_wert w JOIN kennzahl_definition x ON x.id = w.definition_id WHERE w.beteiligung_id = b.id AND x.schluessel = g.schluessel AND w.periode_beginn = ${beginn}::date AND w.periode_ende = ${ende}::date AND w.szenario = 'ist' AND w.verworfen_am IS NULL AND w.status = 'bestaetigt')) AS bestaetigt
        FROM beteiligung b WHERE b.fonds_id = ${ID.fonds} AND b.status = 'aktiv' ORDER BY b.id`);
      const erwartet = new Map(rows.map((r) => [r.id, r]));
      expect(api.unternehmen).toHaveLength(rows.length);
      for (const u of api.unternehmen as { beteiligungId: string; angefordert: number; eingereicht: number; bestaetigt: number }[]) {
        expect({ a: u.angefordert, e: u.eingereicht, b: u.bestaetigt }, `${periode} ${u.beteiligungId}`).toEqual({ a: erwartet.get(u.beteiligungId)!.angefordert, e: erwartet.get(u.beteiligungId)!.eingereicht, b: erwartet.get(u.beteiligungId)!.bestaetigt });
      }
      expect(api.summe.bestaetigt).toBe(rows.reduce((n, r) => n + r.bestaetigt, 0));
    }
    // feste Erwartung zur Gegenprobe: Quartal 3 – eigen: 4 angefordert (ohne Jahreskennzahl), 2 eingereicht (Umsatz bestätigt, EBITDA eingereicht), 1 bestätigt
    const q3 = await json(await get(`/fonds/${ID.fonds}/kennzahlen/uebersicht?periode=2026-Q3`, betrachter));
    const eigen = q3.unternehmen.find((u: { beteiligungId: string }) => u.beteiligungId === ID.eigen);
    expect(eigen).toMatchObject({ angefordert: 4, eingereicht: 2, bestaetigt: 1 });
    expect(eigen.fehlend.sort()).toEqual(["ebitda", "liquiditaet", "mitarbeitende_vzae"]);
    const wandel = q3.unternehmen.find((u: { beteiligungId: string }) => u.beteiligungId === ID.wandel);
    expect(wandel).toMatchObject({ angefordert: 4, eingereicht: 0, bestaetigt: 0, abfrage: null });
  });

  it("ungültiger Zeitraum, fremder Fonds und unbekannter Fonds", async () => {
    expect((await get(`/fonds/${ID.fonds}/kennzahlen/uebersicht?periode=2026-Q5`, betrachter)).status).toBe(400);
    expect((await get(`/fonds/${ID.fonds}/kennzahlen/uebersicht`, betrachter)).status).toBe(400);
    expect((await get(`/fonds/${ID.fonds}/kennzahlen/uebersicht?periode=2026-Q3`, fremd)).status).toBe(403);
  });
});

describe("Änderungsabfrage und Export", () => {
  it("Kennzahlenwerte stehen im Änderungsverlauf; Katalog ohne Fonds ist für jede Rolle sichtbar", async () => {
    await put(`/fonds/${ID.fonds}/kennzahlen/auswahl`, { schluessel: ["umsatz"] }, verwalter);
    const w = await bestaetigterWert(ID.eigen, "umsatz", "10.00");
    const feed = await json(await get(`/aenderungen?tabelle=kennzahl_wert&limit=100`, betrachter));
    expect(feed.daten.map((z: { aktion: string }) => z.aktion)).toEqual(["anlegen", "bestaetigen"]);
    expect(feed.daten.every((z: { datensatzId: string; fondsId: string }) => z.datensatzId === w.id && z.fondsId === ID.fonds)).toBe(true);
    expect((await json(await get(`/aenderungen?tabelle=kennzahl_wert`, fremd))).daten).toEqual([]);
    const auswahl = await json(await get(`/aenderungen?tabelle=fonds_kennzahl`, betrachter));
    expect(auswahl.daten).toHaveLength(1);
    await post("/kennzahlen/katalog", { schluessel: "test_neu", bezeichnungDe: "Neu", bezeichnungEn: "New", einheit: "x", typ: "zahl", kategorie: "betrieb", periodizitaet: "jahr", aggregation: "stand" });
    expect((await json(await get(`/aenderungen?tabelle=kennzahl_definition`, fremd))).daten.length).toBeGreaterThan(0);
  });
  it("gelöschte Kennzahlenwerte behalten den Fonds über die Beteiligung im protokollierten Stand und sind für fremde Fonds unsichtbar", async () => {
    const geloescht = "00000000-0000-4000-8000-0000000000e1";
    await db.execute(
      sql`INSERT INTO aenderung (akteur, aktion, tabelle, datensatz_id, vorher) VALUES ('system', 'loeschen', 'kennzahl_wert', ${geloescht}::uuid, ${JSON.stringify({ id: geloescht, beteiligungId: ID.eigen })}::jsonb)`,
    );
    const eigen = await json(await get(`/aenderungen?tabelle=kennzahl_wert&limit=100`, betrachter));
    expect(eigen.daten).toHaveLength(1);
    expect(eigen.daten[0]).toMatchObject({ datensatzId: geloescht, fondsId: ID.fonds, aktion: "loeschen" });
    expect((await json(await get(`/aenderungen?tabelle=kennzahl_wert`, fremd))).daten).toEqual([]);
  });
});
