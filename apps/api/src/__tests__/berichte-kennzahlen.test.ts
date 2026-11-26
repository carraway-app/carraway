import { sql } from "drizzle-orm";
import { extractText, getDocumentProxy } from "unpdf";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { json, leeren, oeffneTestdb } from "./hilfen";
import { erstelleTestApp, legePersonAn, person, type Testperson } from "./hilfen-auth";
import { grundbestand, ID } from "./hilfen-instrumente";

/** Kennzahlen des Unternehmens im Quartalsbericht (Abschnitt `unternehmenskennzahlen`). Alle Daten sind erfunden. */

const { db, pool } = oeffneTestdb();
const t = erstelleTestApp(db);
const verwalter = person("bk-verwalter", { rollen: { [ID.fonds]: "verwalter" } });
const bearbeiter = person("bk-bearbeiter", { rollen: { [ID.fonds]: "bearbeiter" } });

const senden = (methode: string) => (pfad: string, koerper?: unknown, als?: Testperson) =>
  t.request(pfad, { method: methode, headers: { "content-type": "application/json" }, body: koerper === undefined ? undefined : JSON.stringify(koerper), ...(als ? { als } : {}) });
const get = (pfad: string, als?: Testperson) => t.request(pfad, als ? { als } : {});
const post = senden("POST");
const put = senden("PUT");

const Q3 = { periodeBeginn: "2026-07-01", periodeEnde: "2026-09-30" };

async function text(antwort: Response) {
  expect(antwort.status).toBe(200);
  const dokument = await getDocumentProxy(new Uint8Array(await antwort.arrayBuffer()));
  const { text: t, totalPages } = await extractText(dokument, { mergePages: true });
  return { text: t.replace(/\s+/g, " "), seiten: totalPages };
}

async function bestaetigt(schluessel: string, wert: string, szenario: "ist" | "plan", zeitraum = Q3) {
  const [d] = await db.select().from(s.kennzahlDefinition).where(sql`${s.kennzahlDefinition.schluessel} = ${schluessel}`);
  await db.insert(s.kennzahlWert).values({ beteiligungId: ID.eigen, definitionId: d!.id, ...zeitraum, szenario, wert, quelle: "intern", erfasstVon: "test", status: "bestaetigt", bestaetigtVon: "test", bestaetigtAm: new Date("2026-10-05T10:00:00Z") });
}

beforeEach(async () => {
  await grundbestand(db);
  for (const p of [verwalter, bearbeiter]) await legePersonAn(db, p);
  await put(`/fonds/${ID.fonds}/kennzahlen/auswahl`, { schluessel: ["umsatz", "ebitda", "liquiditaet", "esg_verstoesse_ungc"] }, verwalter);
  await bestaetigt("umsatz", "1234567.89", "ist");
  await bestaetigt("umsatz", "1300000", "plan");
  await bestaetigt("ebitda", "-80000", "ist");
  await bestaetigt("ebitda", "-120000", "plan");
  // ältere Periode: zählt nicht, solange es eine neuere gibt; für Liquidität die einzige
  await bestaetigt("liquiditaet", "40000.00", "ist", { periodeBeginn: "2026-06-01", periodeEnde: "2026-06-30" });
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

const bericht = (sprache: "de" | "en", extra = "") => get(`/investments/${ID.eigen}/reports/quarterly-report?stichtag=2026-09-30&sprache=${sprache}${extra}`, bearbeiter);

describe("Quartalsbericht mit Kennzahlen des Unternehmens", () => {
  it("zeigt je ausgewählter Kennzahl den zuletzt bestätigten Ist-Wert gegen den Plan, mit Abweichung, in Deutsch", async () => {
    const { text: x, seiten } = await text(await bericht("de"));
    expect(seiten).toBe(1);
    expect(x).toContain("Kennzahlen des Unternehmens");
    // Umsatz Ist 1.234.567,89 gegen Plan 1.300.000: −65.432,11 (−5,0 %)
    expect(x).toMatch(/Umsatz Q3 2026 1\.234\.567,89 €/);
    expect(x).toContain("1.300.000,00 €");
    expect(x).toMatch(/-65\.432,11 €/);
    expect(x).toContain("-5,0 %");
    // EBITDA mit negativem Plan: +40.000 (+33,3 %)
    expect(x).toContain("+40.000,00 €");
    expect(x).toContain("+33,3 %");
    // Liquidität nur aus Juni, ohne Plan: Abweichung „–“; Ja/Nein ohne Wert
    expect(x).toMatch(/Liquidität 06\/2026 40\.000,00 € –/);
    expect(x).toMatch(/Verstöße gegen UNGC oder OECD-Leitsätze – – – –/);
    expect(x).toContain("Zuletzt bestätigter Ist-Wert je Kennzahl");
  });

  it("Englisch mit englischen Bezeichnungen und Hinweis", async () => {
    const { text: x } = await text(await bericht("en"));
    expect(x).toContain("Company key figures");
    expect(x).toContain("Revenue");
    expect(x).toContain("Latest confirmed actual per key figure");
    expect(x).toMatch(/Violations of UNGC or OECD guidelines/);
    expect(x).toContain("-5.0%");
  });

  it("Entwürfe, nicht bestätigte Werte und spätere Zeiträume als der Stichtag zählen nicht; ein Wissensstand davor ergibt keinen Wert", async () => {
    const [d] = await db.select().from(s.kennzahlDefinition).where(sql`${s.kennzahlDefinition.schluessel} = 'umsatz'`);
    await db.insert(s.kennzahlWert).values({ beteiligungId: ID.eigen, definitionId: d!.id, ...Q3, szenario: "ist", wert: "999", quelle: "intern", erfasstVon: "test", status: "eingereicht" });
    await db.insert(s.kennzahlWert).values({ beteiligungId: ID.eigen, definitionId: d!.id, periodeBeginn: "2026-10-01", periodeEnde: "2026-12-31", szenario: "ist", wert: "888", quelle: "intern", erfasstVon: "test", status: "bestaetigt", bestaetigtVon: "test", bestaetigtAm: new Date("2026-10-06T10:00:00Z") });
    const { text: x } = await text(await bericht("de"));
    expect(x).toContain("1.234.567,89 €");
    expect(x).not.toContain("999,00");
    expect(x).not.toContain("888,00");
    const frueh = await text(await bericht("de", "&stand=2026-10-01T00:00:00Z"));
    expect(frueh.text).not.toContain("1.234.567,89");
    expect(frueh.text).toMatch(/Umsatz – – – –/);
  });

  it("die Vorlage steuert den Abschnitt: weglassen, eigene Kennzahlenliste, Reihenfolge; der Freigabeweg nimmt die festgehaltene Vorlage", async () => {
    expect((await put(`/funds/${ID.fonds}/report-templates/quarterly_report`, { abschnitte: ["vorgaenge", "bewertungsverlauf"] }, verwalter)).status).toBe(200);
    expect((await text(await bericht("de"))).text).not.toContain("Kennzahlen des Unternehmens");
    expect((await put(`/funds/${ID.fonds}/report-templates/quarterly_report`, { unternehmenskennzahlen: ["ebitda"] }, verwalter)).status).toBe(200);
    const nur = (await text(await bericht("de"))).text;
    expect(nur).toContain("EBITDA");
    expect(nur).not.toContain("Umsatz Q3");
    // Freigabeweg: Vorlage wird bei der Anlage festgehalten, spätere Änderungen wirken nicht mehr
    const angelegt = await json(await post("/reports", { art: "quartalsbericht", beteiligungId: ID.eigen, stichtag: "2026-09-30", sprache: "de" }, bearbeiter));
    await put(`/funds/${ID.fonds}/report-templates/quarterly_report`, { unternehmenskennzahlen: ["umsatz"] }, verwalter);
    const datei = (await text(await get(`/reports/${angelegt.id}/file`, bearbeiter))).text;
    expect(datei).toContain("EBITDA");
    expect(datei).not.toContain("Umsatz Q3");
    expect(datei).toContain("ENTWURF");
  });

  it("Prüfung der Vorlage: unbekannte Kennzahl 404, falsche Form 400, nur für den Quartalsbericht; alte Vorlagen ohne das Feld bleiben lesbar", async () => {
    const vorlage = (koerper: object, art = "quarterly_report") => put(`/funds/${ID.fonds}/report-templates/${art}`, koerper, verwalter);
    expect((await vorlage({ unternehmenskennzahlen: ["gibt_es_nicht"] })).status).toBe(404);
    expect((await vorlage({ unternehmenskennzahlen: ["Umsatz"] })).status).toBe(400);
    expect((await vorlage({ unternehmenskennzahlen: ["umsatz", "umsatz"] })).status).toBe(400);
    expect((await vorlage({ unternehmenskennzahlen: ["umsatz"] }, "fund_report")).status).toBe(400);
    expect((await vorlage({ abschnitte: ["unbekannt"] })).status).toBe(400);
    // eine früher gespeicherte Vorlage mit leeren Abschnitten und ohne das neue Feld ergibt die Standardabschnitte
    await db.execute(sql`INSERT INTO bericht_vorlage (fonds_id, art, konfiguration, geaendert_von) VALUES (${ID.fonds}, 'quartalsbericht', '{"einheit":"TEUR","abschnitte":[],"kennzahlen":[],"spalten":[]}'::jsonb, 'alt') ON CONFLICT (fonds_id, art) DO UPDATE SET konfiguration = EXCLUDED.konfiguration`);
    const gelesen = await json(await get(`/funds/${ID.fonds}/report-templates`, verwalter));
    const q = gelesen.daten.find((x: { art: string }) => x.art === "quartalsbericht");
    expect(q.konfiguration).toMatchObject({ einheit: "TEUR", abschnitte: ["bewertungsverlauf", "vorgaenge", "unternehmenskennzahlen"], unternehmenskennzahlen: [] });
    expect((await text(await bericht("de"))).text).toContain("Kennzahlen des Unternehmens");
  });

  it("ohne Auswahl im Fonds steht ein Hinweis statt einer leeren Tabelle", async () => {
    await put(`/fonds/${ID.fonds}/kennzahlen/auswahl`, { schluessel: [] }, verwalter);
    const { text: x } = await text(await bericht("de"));
    expect(x).toContain("keine Kennzahlen des Unternehmens ausgewählt");
  });
});
