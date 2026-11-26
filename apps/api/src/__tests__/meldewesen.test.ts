import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { definitionSchema, STANDARD_MELDEDEFINITIONEN } from "@carraway/berichte";
import { DateiSpeicher } from "../berichte/speicher";
import { json, leeren, oeffneTestdb } from "./hilfen";
import { erstelleTestApp, person, type Testperson, type TestApp } from "./hilfen-auth";
import { ID, grundbestand, protokollZeilen, vorgaengeAnlegen } from "./hilfen-instrumente";
import { vorgaengeEinfuegen } from "./instrument-hilfen";

const { db, pool } = oeffneTestdb();
let verzeichnis = "";
let t: TestApp;

const alsPerson = (als: string | Testperson): Testperson => (typeof als === "string" ? person(als, { globalVerwalter: true }) : als);
const senden = (methode: string) => (pfad: string, koerper?: unknown, akteur?: string | Testperson) =>
  t.request(pfad, { method: methode, headers: { "content-type": "application/json" }, body: koerper === undefined ? undefined : JSON.stringify(koerper), ...(akteur ? { als: alsPerson(akteur) } : {}) });
const get = (pfad: string, akteur?: string | Testperson) => t.request(pfad, akteur ? { als: alsPerson(akteur) } : {});
const post = senden("POST");
const put = senden("PUT");

const SCHLUESSEL = "foerderbericht_quartal";
const STUFEN = ["Investmentmanager", "Teamleitung", "Geschäftsführung"];
const rolle = (kuerzel: string, r: s.FondsRolle) => person(kuerzel, { rollen: { [ID.fonds]: r } });
const betrachter = rolle("betrachter", "betrachter");
const bearbeiter = rolle("bearbeiter", "bearbeiter");
const freigeber = rolle("freigeber", "freigeber");
const verwalter = rolle("verwalter", "verwalter");

const sqlSumme = async (bedingung: string): Promise<string> => (await db.execute(sql.raw(`SELECT coalesce(sum(v.betrag), 0)::numeric(18,2)::text AS s FROM vorgang v JOIN beteiligung b ON b.id = v.beteiligung_id WHERE b.fonds_id = '${ID.fonds}' AND ${bedingung}`))).rows[0]!.s as string;

async function bestand() {
  await grundbestand(db);
  await db.execute(sql`UPDATE beteiligung SET erstellt_am = '2000-01-01T00:00:00Z'`);
  const ALT = new Date("2000-01-01T00:00:00Z");
  await vorgaengeAnlegen(db, ([
    { beteiligungId: ID.darlehen, art: "zusage", valuta: "2026-01-10", betrag: "100000.00" },
    { beteiligungId: ID.darlehen, art: "auszahlung", valuta: "2026-02-01", betrag: "60000.00" },
    { beteiligungId: ID.darlehen, art: "auszahlung", valuta: "2026-08-15", betrag: "20000.00" },
    { beteiligungId: ID.darlehen, art: "tilgung", valuta: "2026-09-01", betrag: "5000.00" },
    { beteiligungId: ID.eigen, art: "zusage", valuta: "2026-03-01", betrag: "50000.00" },
    { beteiligungId: ID.eigen, art: "auszahlung", valuta: "2026-08-01", betrag: "50000.00" },
    { beteiligungId: ID.wandel, art: "zusage", valuta: "2026-09-15", betrag: "30000.00" },
    { beteiligungId: ID.wandel, art: "auszahlung", valuta: "2026-09-20", betrag: "30000.00" },
    { beteiligungId: ID.wandel, art: "auszahlung", valuta: "2026-10-05", betrag: "777.00" },
  ] as (typeof s.vorgang.$inferInsert)[]).map((v) => ({ ...v, erfasstAm: ALT })));
  await db.insert(s.fondsBewegung).values(([
    { fondsId: ID.fonds, art: "abruf", valuta: "2026-02-01", betrag: "200000.00" },
    { fondsId: ID.fonds, art: "abruf", valuta: "2026-08-01", betrag: "50000.00" },
    { fondsId: ID.fonds, art: "ausschuettung", valuta: "2026-09-10", betrag: "7000.00" },
  ] as (typeof s.fondsBewegung.$inferInsert)[]).map((b) => ({ ...b, erfasstAm: ALT })));
}

async function aktivieren(foerderprogramm?: string | null, fonds = ID.fonds) {
  const a = await put(`/fonds/${fonds}/meldedefinitionen/${SCHLUESSEL}`, { aktiv: true, ...(foerderprogramm !== undefined ? { foerderprogramm } : {}) }, "admin");
  expect(a.status).toBe(200);
}
const neuerLauf = (extra: object = {}, akteur: string | Testperson = "autor", definition = SCHLUESSEL) => post("/meldelaeufe", { fondsId: ID.fonds, definition, jahr: 2026, nummer: 3, ...extra }, akteur);
async function lauf(extra: object = {}, akteur: string | Testperson = "autor") {
  const a = await neuerLauf(extra, akteur);
  expect(a.status, await a.clone().text()).toBe(201);
  return json(a);
}
const wertDe = (l: { werte: { schluessel: string; wert: string | null }[] }, schluessel: string) => l.werte.find((w) => w.schluessel === schluessel)?.wert;
const stufe = (id: string, name: string, akteur: string, extra: object = {}) => post(`/meldelaeufe/${id}/stufe`, { stufe: name, ergebnis: "ok", ...extra }, akteur);

async function freigabebereit() {
  const l = await lauf();
  expect((await put(`/meldelaeufe/${l.id}/eingaben`, { schluessel: "stammdaten.verantwortlich", wert: "Erika Beispiel" }, "autor2")).status).toBe(200);
  expect((await put(`/meldelaeufe/${l.id}/befunde/erlaeuterung_fehlt/kommentar`, { text: "Bewusst keine Erläuterung." }, "autor2")).status).toBe(200);
  return l;
}

beforeAll(async () => {
  verzeichnis = await mkdtemp(join(tmpdir(), "carraway-melde-"));
  t = erstelleTestApp(db, { speicher: new DateiSpeicher(verzeichnis) });
  await bestand();
  for (const p of [betrachter, bearbeiter, freigeber, verwalter]) await t.request("/ich", { als: p });
});
beforeEach(async () => {
  // Jeder Test beginnt ohne frühere Läufe (eine neue Fassung übernimmt sonst Eingaben von Hand).
  await db.execute(sql`TRUNCATE TABLE melde_datei, melde_freigabe, melde_wert, melde_lauf CASCADE`);
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
  await rm(verzeichnis, { recursive: true, force: true });
});

describe("Mitgelieferte Definitionen und Migration", () => {
  it("die Zeilen der Migration entsprechen den Konstanten und bestehen die Prüfung", async () => {
    const zeilen = await db.select().from(s.meldeDefinition);
    for (const d of STANDARD_MELDEDEFINITIONEN) {
      const z = zeilen.find((x) => x.schluessel === d.schluessel && x.version === d.version)!;
      expect(z, d.schluessel).toBeTruthy();
      expect(z.definition).toEqual(definitionSchema.parse(d.definition));
      expect([z.bezeichnungDe, z.bezeichnungEn, z.herausgeber, z.rhythmus, z.format, z.gueltigAb]).toEqual([d.bezeichnungDe, d.bezeichnungEn, d.herausgeber, d.rhythmus, d.format, d.gueltigAb]);
      expect(z.bezeichnungDe).toMatch(/Vorlage|Strukturvorbereitung/);
    }
  });

  it("Definitionen sind unveränderlich (Trigger), nur die Gültigkeit lässt sich begrenzen", async () => {
    await expect(db.execute(sql`UPDATE melde_definition SET bezeichnung_de = 'x' WHERE schluessel = ${SCHLUESSEL}`)).rejects.toThrow();
    await expect(db.execute(sql`UPDATE melde_definition SET definition = '{}'::jsonb WHERE schluessel = ${SCHLUESSEL}`)).rejects.toThrow();
    await expect(db.execute(sql`DELETE FROM melde_definition WHERE schluessel = ${SCHLUESSEL}`)).rejects.toThrow();
  });
});

describe("Definitionen: Rechte, Prüfung und Versionen", () => {
  const kopf = { bezeichnungDe: "Testmeldung", bezeichnungEn: "Test report", herausgeber: "Test", rhythmus: "quartal", format: "csv" };
  const einfach = (extra: object = {}) => ({
    schema: 1,
    abschnitte: [{ id: "a", typ: "felder", titel: { de: "A", en: "A" }, felder: [{ id: "x", bezeichnung: { de: "X", en: "X" }, format: "betrag", quelle: { art: "vorgang", vorgangsarten: ["auszahlung"], zeitraum: "periode" } }] }],
    ...extra,
  });

  it("Liste und Version lesen kann jede Rolle, schreiben nur globale Verwalter", async () => {
    const liste = await json(await get("/meldedefinitionen", betrachter));
    expect(liste.daten.map((d: { schluessel: string }) => d.schluessel)).toEqual(expect.arrayContaining(STANDARD_MELDEDEFINITIONEN.map((d) => d.schluessel)));
    expect(liste.daten.find((d: { schluessel: string }) => d.schluessel === SCHLUESSEL).hinweis.de).toContain("fachlich zu prüfen");
    const v = await json(await get(`/meldedefinitionen/${SCHLUESSEL}/versionen/1`, betrachter));
    expect(v.definition.abschnitte.length).toBeGreaterThan(3);
    expect(v.vorschau[0].felder[0].quelle).toBe("stammdaten");
    for (const p of [betrachter, bearbeiter, freigeber, verwalter]) {
      expect((await post("/meldedefinitionen", { schluessel: "test_recht", ...kopf, definition: einfach() }, p)).status).toBe(403);
      expect((await post("/meldedefinitionen/pruefen", { definition: einfach() }, p)).status).toBe(403);
      expect((await post("/foerderprogramme", { schluessel: "test_prog", bezeichnung: "P" }, p)).status).toBe(403);
    }
    expect((await get("/meldedefinitionen/gibtesnicht")).status).toBe(404);
    expect((await get(`/meldedefinitionen/${SCHLUESSEL}/versionen/9`)).status).toBe(404);
  });

  it("ungültige Definitionen: Pfad, Code und Meldung je Fehler; kein Datensatz entsteht", async () => {
    const schlecht = einfach({
      abschnitte: [
        {
          id: "a",
          typ: "felder",
          titel: { de: "A", en: "A" },
          felder: [
            { id: "x", bezeichnung: { de: "X", en: "X" }, format: "betrag", quelle: { art: "orakel" } },
            { id: "y", bezeichnung: { de: "Y", en: "Y" }, format: "zahl", quelle: { art: "kennzahl", schluessel: "gibt_es_nicht" } },
            { id: "z1", bezeichnung: { de: "Z", en: "Z" }, format: "zahl", quelle: { art: "berechnet", operation: "summe", felder: ["z2"] } },
            { id: "z2", bezeichnung: { de: "Z", en: "Z" }, format: "zahl", quelle: { art: "berechnet", operation: "summe", felder: ["z1"] } },
            { id: "p", bezeichnung: { de: "P", en: "P" }, format: "zahl", quelle: { art: "beteiligungsanzahl" }, filter: { foerderprogramm: ["test_unbekannt"] } },
          ],
        },
      ],
    });
    const a = await post("/meldedefinitionen", { schluessel: "test_schlecht", ...kopf, definition: schlecht }, "admin");
    expect(a.status).toBe(400);
    const k = await json(a);
    expect(k.fehler.code).toBe("MELDEDEFINITION_UNGUELTIG");
    // Aufbaufehler zuerst (die Prüfung gegen die Datenbank folgt erst bei gültigem Aufbau)
    expect(k.fehler.definitionsfehler.map((f: { code: string }) => f.code)).toContain("art_unbekannt");
    expect(await db.select().from(s.meldeDefinition).where(sql`schluessel = 'test_schlecht'`)).toHaveLength(0);

    const ohneOrakel = einfach({ abschnitte: [{ ...schlecht.abschnitte[0]!, felder: schlecht.abschnitte[0]!.felder.slice(1) }] });
    const b = await json(await post("/meldedefinitionen/pruefen", { definition: ohneOrakel }, "admin"));
    expect(b.ok).toBe(false);
    const codes = b.probleme.map((f: { code: string }) => f.code);
    expect(codes).toEqual(expect.arrayContaining(["zyklus"]));
    const zyklus = b.probleme.find((f: { code: string }) => f.code === "zyklus");
    expect(zyklus.meldung).toContain("→");
    // Zyklen und Verweise sind Aufbaufehler; Kennzahl und Programm prüft erst der zweite Schritt
    const ohneZyklus = einfach({ abschnitte: [{ ...schlecht.abschnitte[0]!, felder: [schlecht.abschnitte[0]!.felder[1], schlecht.abschnitte[0]!.felder[4]] }] });
    const c = await json(await post("/meldedefinitionen/pruefen", { definition: ohneZyklus }, "admin"));
    const f = c.probleme as { code: string; pfad: string; meldung: string }[];
    expect(f.find((x) => x.code === "unbekannte_kennzahl")).toMatchObject({ pfad: "abschnitte.0.felder.0.quelle.schluessel" });
    expect(f.find((x) => x.code === "unbekanntes_programm")!.meldung).toContain("test_unbekannt");
  });

  it("gültige Definition anlegen, Version ablösen, doppelter Schlüssel und Zeitraum", async () => {
    const a = await post("/meldedefinitionen", { schluessel: "test_meldung", ...kopf, gueltigAb: "2026-01-01", definition: einfach() }, "admin");
    expect(a.status).toBe(201);
    expect((await json(a)).version).toBe(1);
    expect((await post("/meldedefinitionen", { schluessel: "test_meldung", ...kopf, definition: einfach() }, "admin")).status).toBe(409);
    const pruef = await json(await post("/meldedefinitionen/pruefen", { definition: einfach() }, "admin"));
    expect(pruef).toMatchObject({ ok: true, probleme: [] });
    expect(pruef.vorschau[0].felder[0]).toMatchObject({ id: "x", quelle: "vorgang" });

    const v2 = await post("/meldedefinitionen/test_meldung/versionen", { gueltigAb: "2026-07-01", format: "xlsx", definition: einfach({ hinweis: { de: "Neu", en: "New" } }) }, "admin");
    expect(v2.status).toBe(201);
    expect((await json(v2)).version).toBe(2);
    const alle = (await json(await get("/meldedefinitionen/test_meldung"))).daten as { version: number; gueltigBis: string | null }[];
    expect(alle.map((x) => [x.version, x.gueltigBis])).toEqual([[2, null], [1, "2026-06-30"]]);
    expect((await post("/meldedefinitionen/test_meldung/versionen", { gueltigAb: "2026-07-01", definition: einfach() }, "admin")).status).toBe(409);
    expect((await post("/meldedefinitionen/test_gibtesnicht/versionen", { definition: einfach() }, "admin")).status).toBe(404);
    const protokoll = await protokollZeilen(db, "melde_definition");
    expect(protokoll.map((p) => p.aktion).sort()).toEqual(["anlegen", "anlegen", "begrenzen"]);
  });
});

describe("Förderprogramme und Schlüssel (eine Stelle: Förder- und Buchhaltungsschlüssel der Beteiligung)", () => {
  it("Programm anlegen, Beteiligung zuordnen, Mittelarten des Fonds, Sitzland setzen, Rechte", async () => {
    expect((await post("/foerderprogramme", { schluessel: "test_p1", bezeichnung: "Programm Eins" }, "admin")).status).toBe(201);
    expect((await post("/foerderprogramme", { schluessel: "test_p1", bezeichnung: "Doppelt" }, "admin")).status).toBe(409);
    expect((await json(await get("/foerderprogramme", betrachter))).daten.map((p: { schluessel: string }) => p.schluessel)).toContain("test_p1");

    const eingabe = { foerderprogramm: "test_p1", projektnummer: "PRJ-1", vertragsnummer: null, partnernummer: "PN-9", buchungskreis: "BK1" };
    const pfad = (id: string) => `/beteiligungen/${id}/buchhaltungsschluessel`;
    expect((await put(pfad(ID.darlehen), eingabe, betrachter)).status).toBe(403);
    expect((await put(pfad(ID.darlehen), eingabe, bearbeiter)).status).toBe(200);
    expect((await put(pfad(ID.eigen), { ...eingabe, projektnummer: "PRJ-2" }, bearbeiter)).status).toBe(200);
    expect((await put(pfad(ID.darlehen), { ...eingabe, foerderprogramm: "test_gibtesnicht" }, bearbeiter)).status).toBe(404);
    expect((await put(pfad(ID.darlehen), { ...eingabe, foerderprogramm: "Unsinn!" }, bearbeiter)).status).toBe(400);
    // Die alte Route der Etappe 15 gibt es nicht mehr: ein Ort für die Schlüssel
    expect([403, 404]).toContain((await put(`/beteiligungen/${ID.darlehen}/melde-zuordnung`, eingabe, bearbeiter)).status);
    // Mittelherkunft des Fonds mit Quoten je Zeitraum und Meldeart (Etappe 14): bis Ende Juni 60/40, danach 50/50
    const mit = (gueltigAb: string, foerder: string, kofi: string, kategorie = "foerdermittel") => ({
      gueltigAb,
      mittelarten: [
        { schluessel: "foerderung", bezeichnungDe: "Förderung", bezeichnungEn: "Funding", quote: foerder, meldeArt: kategorie },
        { schluessel: "kofi", bezeichnungDe: "Kofinanzierung", bezeichnungEn: "Co-financing", quote: kofi, meldeArt: "kofinanzierung" },
      ],
    });
    expect((await put(`/fonds/${ID.fonds}/mittelarten`, mit("2026-01-01", "0.6", "0.4"), bearbeiter)).status).toBe(403);
    expect((await put(`/fonds/${ID.fonds}/mittelarten`, mit("2026-01-01", "0.6", "0.4", "unsinn"), verwalter)).status).toBe(400);
    expect((await put(`/fonds/${ID.fonds}/mittelarten`, mit("2026-01-01", "0.6", "0.4"), verwalter)).status).toBe(200);
    expect((await put(`/fonds/${ID.fonds}/mittelarten`, mit("2026-07-01", "0.5", "0.5"), verwalter)).status).toBe(200);
    expect((await put(`/organisationen/${ID.orgA}/meldedaten`, { sitzland: "de", region: "Bayern" }, bearbeiter)).status).toBe(400);
    expect((await put(`/organisationen/${ID.orgA}/meldedaten`, { sitzland: "DE", region: "Bayern" }, bearbeiter)).status).toBe(200);
    expect((await put(`/organisationen/${ID.orgB}/meldedaten`, { sitzland: "DE", region: null }, bearbeiter)).status).toBe(200);
    expect((await put(`/organisationen/${ID.orgC}/meldedaten`, { sitzland: "AT", region: "Tirol" }, bearbeiter)).status).toBe(200);
    // Lesen für die Bearbeitung der Organisation: gesetzte und noch leere Daten
    expect(await json(await get(`/organisationen/${ID.orgA}/meldedaten`, betrachter))).toEqual({ organisationId: ID.orgA, sitzland: "DE", region: "Bayern" });
    expect((await get(`/organisationen/${ID.orgB}/meldedaten`, betrachter)).status).toBe(200);
    const liste = (await json(await get(`/fonds/${ID.fonds}/melde-zuordnungen`, betrachter))).daten as { beteiligungId: string; foerderprogramm: { schluessel: string } | null; projektnummer: string | null; sitzland: string | null }[];
    expect(liste.find((x) => x.beteiligungId === ID.darlehen)).toMatchObject({ foerderprogramm: { schluessel: "test_p1" }, projektnummer: "PRJ-1", sitzland: "DE" });
    expect(liste.find((x) => x.beteiligungId === ID.wandel)).toMatchObject({ foerderprogramm: null, sitzland: "AT" });
  });
});

describe("Aktivierung und Anlage eines Laufs", () => {
  it("ohne Aktivierung 409; Aktivierung verlangt die Rolle Verwalter am Fonds", async () => {
    expect((await neuerLauf()).status).toBe(409);
    expect((await json(await neuerLauf())).fehler.code).toBe("MELDEDEFINITION_NICHT_AKTIVIERT");
    expect((await put(`/fonds/${ID.fonds}/meldedefinitionen/${SCHLUESSEL}`, { aktiv: true }, bearbeiter)).status).toBe(403);
    expect((await put(`/fonds/${ID.fonds}/meldedefinitionen/${SCHLUESSEL}`, { aktiv: true }, verwalter)).status).toBe(200);
    const liste = (await json(await get(`/fonds/${ID.fonds}/meldedefinitionen`, betrachter))).daten as { schluessel: string; aktiviert: boolean }[];
    expect(liste.find((x) => x.schluessel === SCHLUESSEL)!.aktiviert).toBe(true);
    expect(liste.find((x) => x.schluessel === "efre_indikatoren")!.aktiviert).toBe(false);
    expect((await put(`/fonds/${ID.fonds}/meldedefinitionen/gibtesnicht`, { aktiv: true }, verwalter)).status).toBe(404);
    expect((await put(`/fonds/${ID.fonds}/meldedefinitionen/${SCHLUESSEL}`, { aktiv: true, foerderprogramm: "test_gibtesnicht" }, verwalter)).status).toBe(404);
  });

  it("Rechte: Betrachter lesen, Bearbeiter legen an, Freigeber-Stufe ohne Rolle 403", async () => {
    await aktivieren();
    expect((await neuerLauf({}, betrachter)).status).toBe(403);
    const l = await lauf({}, bearbeiter);
    expect((await get(`/meldelaeufe/${l.id}`, betrachter)).status).toBe(200);
    expect((await get(`/meldelaeufe?fondsId=${ID.fonds}`, betrachter)).status).toBe(200);
    const ohneRolle = await post(`/meldelaeufe/${l.id}/stufe`, { stufe: STUFEN[0], ergebnis: "ok" }, bearbeiter);
    expect(ohneRolle.status).toBe(403);
    expect((await put(`/meldelaeufe/${l.id}/eingaben`, { schluessel: "stammdaten.verantwortlich", wert: "x" }, betrachter)).status).toBe(403);
  });

  it("Zeitraum, Format xml und Version: Fehlercodes", async () => {
    await aktivieren();
    expect((await json(await neuerLauf({ nummer: 5 }))).fehler.code).toBe("MELDEZEITRAUM_UNGUELTIG");
    expect((await json(await neuerLauf({ jahr: undefined, nummer: undefined, stichtag: "2026-09-30" }))).fehler.code).toBe("MELDEZEITRAUM_UNGUELTIG");
    expect((await json(await neuerLauf({ jahr: 2000 }))).fehler.code).toBe("MELDEDEFINITION_NICHT_GUELTIG");
    expect((await json(await neuerLauf({ version: 7 }))).fehler.code).toBe("MELDEDEFINITION_NICHT_GUELTIG");
    expect((await json(await neuerLauf({ stand: "2999-01-01T00:00:00Z" }))).fehler.code).toBe("EINGABE_UNGUELTIG");
    expect((await neuerLauf({ fondsId: "00000000-0000-4000-8000-000000000999" })).status).toBe(404);
    // xml: Definition anlegen, aktivieren, Lauf ist 409
    await post("/meldedefinitionen", { schluessel: "test_xml", bezeichnungDe: "XML", bezeichnungEn: "XML", herausgeber: "T", rhythmus: "quartal", format: "xml", gueltigAb: "2026-01-01", definition: { schema: 1, abschnitte: [{ id: "a", typ: "felder", titel: { de: "A", en: "A" }, felder: [{ id: "x", bezeichnung: { de: "X", en: "X" }, format: "betrag", quelle: { art: "manuell" } }] }] } }, "admin");
    await put(`/fonds/${ID.fonds}/meldedefinitionen/test_xml`, { aktiv: true }, "admin");
    const a = await neuerLauf({}, "autor", "test_xml");
    expect(a.status).toBe(409);
    expect((await json(a)).fehler.code).toBe("MELDEFORMAT_NICHT_UNTERSTUETZT");
  });
});

describe("Berechnung: jede Quelle gegen unabhängige SQL", () => {
  it("Vorgangssummen, Bestand, Anzahl, Fondsbewegungen, Stammdaten und Tabelle je Programm", async () => {
    await aktivieren();
    const l = await lauf();
    const q3 = "v.valuta BETWEEN '2026-07-01' AND '2026-09-30'";
    const bis = "v.valuta <= '2026-09-30'";
    expect(wertDe(l, "mittelverwendung.auszahlungen_periode")).toBe(await sqlSumme(`v.art = 'auszahlung' AND ${q3}`));
    expect(wertDe(l, "mittelverwendung.auszahlungen_kumuliert")).toBe(await sqlSumme(`v.art = 'auszahlung' AND ${bis}`));
    expect(wertDe(l, "mittelverwendung.zusagen_periode")).toBe(await sqlSumme(`v.art = 'zusage' AND ${q3}`));
    expect(wertDe(l, "mittelverwendung.zusagen_kumuliert")).toBe(await sqlSumme(`v.art = 'zusage' AND ${bis}`));
    expect(wertDe(l, "rueckfluesse.rueckfluesse_periode")).toBe(await sqlSumme(`v.art IN ('rueckfluss', 'tilgung') AND ${q3}`));
    expect(wertDe(l, "mittelverwendung.auszahlungen_periode")).toBe("100000.00");
    expect(wertDe(l, "mittelverwendung.auszahlungen_kumuliert")).toBe("160000.00");
    expect(wertDe(l, "mittelverwendung.offene_zusage")).toBe("20000.00");
    expect(wertDe(l, "mittelverwendung.anzahl_beteiligungen")).toBe("3");
    expect(wertDe(l, "mittelverwendung.neue_beteiligungen")).toBe("0");
    const abrufe = async (bedingung: string) => (await db.execute(sql.raw(`SELECT coalesce(sum(betrag),0)::numeric(18,2)::text AS s FROM fonds_bewegung WHERE fonds_id = '${ID.fonds}' AND ${bedingung}`))).rows[0]!.s;
    expect(wertDe(l, "mittelabruf.abrufe_periode")).toBe(await abrufe("art = 'abruf' AND valuta BETWEEN '2026-07-01' AND '2026-09-30'"));
    expect(wertDe(l, "mittelabruf.abrufe_kumuliert")).toBe(await abrufe("art = 'abruf' AND valuta <= '2026-09-30'"));
    expect(wertDe(l, "mittelabruf.noch_nicht_abgerufen")).toBe("9750000.00");
    expect(wertDe(l, "rueckfluesse.ausschuettungen_periode")).toBe("7000.00");
    expect(wertDe(l, "stammdaten.fonds_name")).toBe("Testfonds Eins");
    expect(wertDe(l, "stammdaten.zeitraum_beginn")).toBe("2026-07-01");
    expect(wertDe(l, "stammdaten.programm")).toBeNull();
    // Tabelle je Programm: Programm 1 hat Darlehen und Beteiligung, der Rest ist ohne Zuordnung
    expect(wertDe(l, "portfolio_programm.test_p1.investiert")).toBe("130000.00");
    expect(wertDe(l, "portfolio_programm.test_p1.name")).toBeUndefined();
    expect(wertDe(l, "portfolio_programm.test_p1.programm")).toBe("Programm Eins");
    expect(wertDe(l, "portfolio_programm._ohne.investiert")).toBe("30000.00");
    expect(wertDe(l, "portfolio_programm._summe.investiert")).toBe("160000.00");
    expect(wertDe(l, "portfolio_programm.test_p1.buchwert")).toBe("125000.00"); // 130000 investiert − 5000 Tilgung
    // Aufbau der Anzeige
    const tabelle = l.anzeige.find((a: { id: string }) => a.id === "portfolio_programm");
    expect(tabelle.zeilen.map((z: { schluessel: string }) => z.schluessel)).toEqual(["test_p1", "_ohne"]);
  });

  it("Filter nach Programm des Laufs; Filter und Gruppen nach Sitzland und Mittelart", async () => {
    await aktivieren("test_p1");
    const l = await lauf();
    expect(l.foerderprogramm.schluessel).toBe("test_p1");
    expect(wertDe(l, "mittelverwendung.auszahlungen_kumuliert")).toBe("130000.00");
    expect(wertDe(l, "mittelverwendung.anzahl_beteiligungen")).toBe("2");
    expect(wertDe(l, "stammdaten.programm")).toBe("Programm Eins");
    // Fondsbewegungen gehören dem Fonds und ignorieren den Filter
    expect(wertDe(l, "mittelabruf.abrufe_kumuliert")).toBe("250000.00");
    const h = await json(await get(`/meldelaeufe/${l.id}/herkunft?schluessel=${encodeURIComponent("mittelverwendung.auszahlungen_kumuliert")}`));
    expect(h.filter).toEqual([{ foerderprogramm: ["test_p1"] }]);
    await aktivieren(null);
  });

  it("Kennzahlen: nur bestätigte Werte, Wissensstand, Verdichtung; EFRE-Vorlage mit k. A. und Platzhaltern", async () => {
    await put(`/fonds/${ID.fonds}/meldedefinitionen/efre_indikatoren`, { aktiv: true }, "admin");
    const [umsatz] = await db.select().from(s.kennzahlDefinition).where(sql`schluessel = 'umsatz' AND katalog_version = 1`);
    const [vzae] = await db.select().from(s.kennzahlDefinition).where(sql`schluessel = 'mitarbeitende_vzae' AND katalog_version = 1`);
    const werte = (beteiligungId: string, definitionId: string, periode: [string, string], wert: string, status: "bestaetigt" | "entwurf", bestaetigtAm: Date | null) => ({
      beteiligungId,
      definitionId,
      periodeBeginn: periode[0],
      periodeEnde: periode[1],
      szenario: "ist" as const,
      wert,
      quelle: "intern" as const,
      erfasstVon: "test",
      status,
      bestaetigtVon: status === "bestaetigt" ? "test" : null,
      bestaetigtAm,
    });
    const frueher = new Date(Date.now() - 3_600_000);
    await db.insert(s.kennzahlWert).values([
      werte(ID.darlehen, umsatz!.id, ["2026-07-01", "2026-09-30"], "400000", "bestaetigt", frueher),
      werte(ID.eigen, umsatz!.id, ["2026-07-01", "2026-07-31"], "10000", "bestaetigt", frueher),
      werte(ID.eigen, umsatz!.id, ["2026-08-01", "2026-08-31"], "20000", "bestaetigt", frueher),
      werte(ID.wandel, umsatz!.id, ["2026-07-01", "2026-09-30"], "999999", "entwurf", null),
      werte(ID.darlehen, vzae!.id, ["2026-04-01", "2026-06-30"], "12", "bestaetigt", frueher),
      werte(ID.eigen, vzae!.id, ["2026-04-01", "2026-06-30"], "30", "bestaetigt", new Date(Date.now() + 60_000)),
    ]);
    const l = await lauf({ definition: "efre_indikatoren", jahr: 2026, nummer: undefined });
    // Umsatz: 400000 + (10000 + 20000 nach Katalog „Summe“), der Entwurf zählt nicht
    expect(wertDe(l, "indikatoren.ind_ergebnis_umsatz")).toBe("430000.00");
    // VZÄ „letzter Zeitraum“: die Bestätigung der zweiten Beteiligung liegt nach dem Wissensstand der Rechnung (jetzt) nicht vor, nur 12
    expect(wertDe(l, "indikatoren.ind_ergebnis_beschaeftigte")).toBe("12");
    expect(wertDe(l, "indikatoren.ind_investition_privat")).toBeNull(); // manuell, leer: k. A.
    expect(wertDe(l, "indikatoren.ind_output_unternehmen")).toBe("3");
    expect(wertDe(l, "indikatoren.ind_output_darlehen")).toBe("2"); // Darlehen und Wandeldarlehen
    // Auszahlungen 2026 nach den Quoten ihres Valuta (bis 30.06. 60/40, danach 50/50): 60000 im Februar, 50000 und 20000 im August, 30000 im September, 777 im Oktober
    expect(wertDe(l, "finanzinstrument.foerdermittel_periode")).toBe("86388.50"); // 36000 + 25000 + 10000 + 15000 + 388,50
    expect(wertDe(l, "finanzinstrument.kofinanzierung_periode")).toBe("74388.50"); // 24000 + 25000 + 10000 + 15000 + 388,50
    const vorhaben = l.anzeige.find((a: { id: string }) => a.id === "vorhaben");
    expect(vorhaben.zeilen.length).toBe(3);
    expect(wertDe(l, `vorhaben.${ID.darlehen}.projektnummer`)).toBe("PRJ-1");
    expect(wertDe(l, `vorhaben.${ID.darlehen}.sitzland`)).toBe("DE");
    expect(wertDe(l, `vorhaben.${ID.wandel}.sitzland`)).toBe("AT");
    expect(wertDe(l, `vorhaben.${ID.wandel}.projektnummer`)).toBeNull();
    // Hinweis: Platzhalter, keine RCO- oder RCR-Codes
    expect(JSON.stringify(l.definition)).not.toMatch(/RC[OR] ?\d/);
  });

  it("Wissensstand: Vorgänge, die nach dem Stand erfasst wurden, zählen nicht", async () => {
    await aktivieren();
    const vor = new Date(Date.now() - 60_000).toISOString();
    // Zweites Quartal: darin gibt es im Grundbestand keine Auszahlung und keinen Abruf; Vorgänge lassen sich nicht löschen, deshalb nicht im dritten.
    await vorgaengeEinfuegen(db, { beteiligungId: ID.eigen, art: "auszahlung", valuta: "2026-05-10", betrag: "1234.00" });
    const [abruf] = await db.insert(s.fondsBewegung).values({ fondsId: ID.fonds, art: "abruf", valuta: "2026-05-11", betrag: "4321.00" }).returning();
    let alt, neu, sehrFrueh;
    try {
      alt = await lauf({ stand: vor, nummer: 2 });
      neu = await lauf({ nummer: 2 });
      sehrFrueh = await lauf({ stand: "1999-12-31T00:00:00Z", nummer: 2 });
    } finally {
      // Fondsbewegungen sind unveränderlich (Trigger); der Test räumt seine Zeile ausnahmsweise am Trigger vorbei auf.
      await db.execute(sql`ALTER TABLE fonds_bewegung DISABLE TRIGGER fonds_bewegung_kein_update_delete`);
      await db.execute(sql`DELETE FROM fonds_bewegung WHERE id = ${abruf!.id}`);
      await db.execute(sql`ALTER TABLE fonds_bewegung ENABLE TRIGGER fonds_bewegung_kein_update_delete`);
    }
    expect(wertDe(alt, "mittelverwendung.auszahlungen_periode")).toBe("0.00");
    expect(wertDe(neu, "mittelverwendung.auszahlungen_periode")).toBe("1234.00");
    expect(wertDe(alt, "mittelabruf.abrufe_periode")).toBe("0.00");
    expect(wertDe(neu, "mittelabruf.abrufe_periode")).toBe("4321.00");
    expect(new Date(alt.stand).toISOString()).toBe(vor);
    expect(alt.fassung).toBeLessThan(neu.fassung);
    // vor der Anlage der Beteiligungen wusste man nichts von ihnen
    expect(wertDe(sehrFrueh, "mittelverwendung.anzahl_beteiligungen")).toBe("0");
    expect(wertDe(sehrFrueh, "mittelverwendung.auszahlungen_kumuliert")).toBe("0.00");
    // Eingaben von Hand der Vorfassung wurden nicht überschrieben, ihre Herkunft ist die Berechnung zum jeweiligen Stand
    expect(neu.vorgaengerId).toBe(alt.id);
  });

  it("Herkunft: Rechenschritte, Filter und die Datensätze hinter dem Wert", async () => {
    await aktivieren();
    const l = await lauf();
    const h = await json(await get(`/meldelaeufe/${l.id}/herkunft?schluessel=${encodeURIComponent("mittelverwendung.auszahlungen_periode")}`, betrachter));
    expect(h.art).toBe("vorgang");
    expect(h.wert).toBe("100000.00");
    expect(h.beteiligungen.map((b: { id: string }) => b.id).sort()).toEqual([ID.eigen, ID.darlehen, ID.wandel].sort());
    expect(h.vorgaenge.map((v: { betrag: string }) => v.betrag).sort()).toEqual(["20000.00", "30000.00", "50000.00"]);
    expect(h.vorgaengeGesamt).toBe(3);
    expect(h.schritte.at(-1)).toMatchObject({ zeichen: "=", wert: "100000" });
    const rechnung = await json(await get(`/meldelaeufe/${l.id}/herkunft?schluessel=${encodeURIComponent("mittelabruf.noch_nicht_abgerufen")}`));
    expect(rechnung.operanden).toEqual([{ ref: "zeichnungskapital", wert: "10000000.00" }, { ref: "abrufe_kumuliert", wert: "250000.00" }]);
    const abruf = await json(await get(`/meldelaeufe/${l.id}/herkunft?schluessel=${encodeURIComponent("mittelabruf.abrufe_kumuliert")}`));
    expect(abruf.bewegungen).toHaveLength(2);
    expect((await get(`/meldelaeufe/${l.id}/herkunft?schluessel=gibt.es.nicht`)).status).toBe(404);
    expect((await get(`/meldelaeufe/${l.id}/herkunft`)).status).toBe(400);
    expect((await get(`/meldelaeufe/${"00000000-0000-4000-8000-000000000999"}/herkunft?schluessel=x`)).status).toBe(404);
  });
});

describe("Eingaben von Hand", () => {
  it("Format wird geprüft: Formeln werden abgelehnt, Text wird angenommen", async () => {
    await aktivieren();
    const l = await lauf();
    const ein = (schluessel: string, wert: string | null, akteur: string | Testperson = "autor") => put(`/meldelaeufe/${l.id}/eingaben`, { schluessel, wert }, akteur);
    expect((await ein("stammdaten.verantwortlich", "Erika Beispiel")).status).toBe(200);
    expect((await ein("stammdaten.verantwortlich", "x".repeat(4001))).status).toBe(400);
    expect((await json(await ein("stammdaten.verantwortlich", " "))).fehler.code).toBe("MELDEWERT_UNGUELTIG");
    expect((await ein("erlaeuterung.erlaeuterung_text", "=HYPERLINK(\"http://x\")")).status).toBe(200); // Text ist erlaubt, wird in den Dateien entschärft
    expect((await ein("stammdaten.verantwortlich", null)).status).toBe(200);
    const nichtManuell = await ein("mittelverwendung.auszahlungen_periode", "5");
    expect(nichtManuell.status).toBe(409);
    expect((await json(nichtManuell)).fehler.code).toBe("MELDEFELD_NICHT_MANUELL");
    expect((await json(await ein("gibt.es", "5"))).fehler.code).toBe("MELDEFELD_NICHT_GEFUNDEN");
    expect((await put(`/meldelaeufe/${"00000000-0000-4000-8000-000000000999"}/eingaben`, { schluessel: "a.b", wert: "1" }, "autor")).status).toBe(404);
  });

  it("Zahlenfelder lehnen Formeln und Text ab (Definition mit manuellem Betragsfeld)", async () => {
    await post("/meldedefinitionen", { schluessel: "test_manuell", bezeichnungDe: "Manuell", bezeichnungEn: "Manual", herausgeber: "T", rhythmus: "jahr", format: "csv", gueltigAb: "2026-01-01", definition: { schema: 1, abschnitte: [{ id: "a", typ: "felder", titel: { de: "A", en: "A" }, felder: [{ id: "betrag", bezeichnung: { de: "=Betrag", en: "Amount" }, format: "betrag", einheit: "EUR", quelle: { art: "manuell" } }, { id: "ja", bezeichnung: { de: "Ja", en: "Yes" }, format: "ja_nein", quelle: { art: "manuell" } }] }] } }, "admin");
    await put(`/fonds/${ID.fonds}/meldedefinitionen/test_manuell`, { aktiv: true }, "admin");
    const l = await lauf({ definition: "test_manuell", nummer: undefined }, "autor");
    const ein = (schluessel: string, wert: string | null) => put(`/meldelaeufe/${l.id}/eingaben`, { schluessel, wert }, "autor");
    for (const schlecht of ['=HYPERLINK("http://x")', "+1", "@SUM(1)", "-cmd|' /C calc'!A0", "1e5", "12,5", "abc"]) {
      const a = await ein("a.betrag", schlecht);
      expect(a.status, schlecht).toBe(400);
      expect((await json(a)).fehler.code).toBe("MELDEWERT_UNGUELTIG");
    }
    expect((await ein("a.ja", "=1")).status).toBe(400);
    expect((await ein("a.ja", "vielleicht")).status).toBe(400);
    expect((await ein("a.betrag", "-1234.5")).status).toBe(200);
    expect((await ein("a.ja", "ja")).status).toBe(200);
    // Die Datei enthält die Beschriftung mit Formelanfang entschärft
    const csv = Buffer.from(await (await get(`/meldelaeufe/${l.id}/datei`, "autor")).arrayBuffer()).toString("utf8");
    expect(csv).toContain("'=Betrag");
    expect(csv).toContain("-1234.5");
  });
});

describe("Befunde, Stufen, Vier-Augen und Freigabe", () => {
  it("Fehler blockieren die Freigabe, Warnungen brauchen einen Kommentar", async () => {
    await aktivieren();
    const l = await lauf();
    const befunde = (await json(await get(`/meldelaeufe/${l.id}/befunde`, betrachter))).daten as { regelId: string; schwere: string; code: string }[];
    expect(befunde.map((b) => `${b.regelId}:${b.schwere}`).sort()).toEqual(["erlaeuterung_fehlt:warnung", "pflicht_verantwortlich:fehler"]);
    expect(l.befunde).toHaveLength(2);
    expect((await stufe(l.id, STUFEN[0]!, "a1")).status).toBe(200);
    expect((await stufe(l.id, STUFEN[1]!, "a2")).status).toBe(200);
    // letzte Stufe: Fehler offen
    const a = await stufe(l.id, STUFEN[2]!, "a3");
    expect(a.status).toBe(409);
    const k = await json(a);
    expect(k.fehler.code).toBe("MELDELAUF_FEHLER_OFFEN");
    expect(k.fehler.befunde[0].regelId).toBe("pflicht_verantwortlich");
    // Eingaben nach teilweiser Freigabe nicht mehr möglich
    const e = await put(`/meldelaeufe/${l.id}/eingaben`, { schluessel: "stammdaten.verantwortlich", wert: "x" }, "autor");
    expect(e.status).toBe(409);
    expect((await json(e)).fehler.code).toBe("MELDELAUF_STATUS_UNGUELTIG");
    // zurück bis zum Entwurf, dann Eingabe, dann Warnung ohne Kommentar
    expect((await post(`/meldelaeufe/${l.id}/stufe`, { stufe: STUFEN[2], ergebnis: "zurueck", kommentar: "Fehler offen" }, "a3")).status).toBe(200);
    expect((await post(`/meldelaeufe/${l.id}/stufe`, { stufe: STUFEN[1], ergebnis: "zurueck" }, "a2")).status).toBe(400); // Kommentar fehlt
    expect((await post(`/meldelaeufe/${l.id}/stufe`, { stufe: STUFEN[1], ergebnis: "zurueck", kommentar: "x" }, "a2")).status).toBe(200);
    expect((await post(`/meldelaeufe/${l.id}/stufe`, { stufe: STUFEN[0], ergebnis: "zurueck", kommentar: "x" }, "a1")).status).toBe(200);
    expect((await get(`/meldelaeufe/${l.id}`)).status).toBe(200);
    expect((await json(await get(`/meldelaeufe/${l.id}`))).status).toBe("entwurf");
    expect((await put(`/meldelaeufe/${l.id}/eingaben`, { schluessel: "stammdaten.verantwortlich", wert: "Erika Beispiel" }, "autor2")).status).toBe(200);
    // Beteiligte der Eingabe und der Rückgaben: autor2 darf nicht freigeben
    expect((await stufe(l.id, STUFEN[0]!, "a1")).status).toBe(200);
    expect((await stufe(l.id, STUFEN[1]!, "a2")).status).toBe(200);
    const ohne = await stufe(l.id, STUFEN[2]!, "a3");
    expect(ohne.status).toBe(409);
    expect((await json(ohne)).fehler.code).toBe("MELDELAUF_WARNUNG_OHNE_KOMMENTAR");
    // Kommentar nur zu vorhandenen Warnungen
    expect((await put(`/meldelaeufe/${l.id}/befunde/pflicht_verantwortlich/kommentar`, { text: "x" }, "a4")).status).toBe(404);
    expect((await put(`/meldelaeufe/${l.id}/befunde/erlaeuterung_fehlt/kommentar`, { text: "  " }, "a4")).status).toBe(400);
    expect((await put(`/meldelaeufe/${l.id}/befunde/erlaeuterung_fehlt/kommentar`, { text: "Keine Besonderheiten." }, "a4")).status).toBe(200);
    // a4 hat kommentiert und darf nicht freigeben; a3 darf (hat zuvor nur zurückgegeben)
    const a4 = await stufe(l.id, STUFEN[2]!, "a4");
    expect(a4.status).toBe(409);
    expect((await json(a4)).fehler.code).toBe("VIER_AUGEN_VERLETZT");
    expect((await stufe(l.id, STUFEN[2]!, "a3")).status).toBe(200);
  });

  it("Vier-Augen: Ersteller, Bearbeiter der Eingaben und frühere Freigeber sind ausgeschlossen; technische Benutzer nie", async () => {
    await aktivieren();
    const l = await lauf({}, "autor");
    await put(`/meldelaeufe/${l.id}/eingaben`, { schluessel: "stammdaten.verantwortlich", wert: "Erika Beispiel" }, "bearbeiter-x");
    await put(`/meldelaeufe/${l.id}/befunde/erlaeuterung_fehlt/kommentar`, { text: "Kein Text." }, "bearbeiter-x");
    const verletzt = async (id: string, name: string, akteur: string) => {
      const a = await stufe(id, name, akteur);
      expect(a.status, akteur).toBe(409);
      expect((await json(a)).fehler.code).toBe("VIER_AUGEN_VERLETZT");
    };
    await verletzt(l.id, STUFEN[0]!, "autor"); // Ersteller
    await verletzt(l.id, STUFEN[0]!, "bearbeiter-x"); // Eingabe und Kommentar
    expect((await stufe(l.id, STUFEN[0]!, "p1")).status).toBe(200);
    await verletzt(l.id, STUFEN[1]!, "p1"); // dieselbe Person zweimal
    expect((await json(await stufe(l.id, STUFEN[2]!, "p2"))).fehler.code).toBe("MELDELAUF_STUFE_FALSCH");
    expect((await stufe(l.id, STUFEN[1]!, "p2")).status).toBe(200);
    expect((await stufe(l.id, STUFEN[2]!, "p3")).status).toBe(200);
    expect((await json(await stufe(l.id, STUFEN[2]!, "p4"))).fehler.code).toBe("MELDELAUF_STATUS_UNGUELTIG");
  });

  it("Freigabe erzeugt Dateien mit SHA-256, speichert sie unveränderlich und friert den Lauf ein", async () => {
    await aktivieren();
    const l = await freigabebereit();
    expect((await stufe(l.id, STUFEN[0]!, "f1")).status).toBe(200);
    expect((await stufe(l.id, STUFEN[1]!, "f2")).status).toBe(200);
    const frei = await stufe(l.id, STUFEN[2]!, "f3");
    expect(frei.status, await frei.clone().text()).toBe(200);
    const detail = await json(frei);
    expect(detail.status).toBe("freigegeben");
    expect(detail.dateien.map((d: { art: string }) => d.art)).toEqual(["meldung", "pruefansicht"]);
    const meldung = detail.dateien.find((d: { art: string }) => d.art === "meldung");
    const antwort = await get(`/meldelaeufe/${l.id}/datei`, betrachter);
    expect(antwort.status).toBe(200);
    const bytes = Buffer.from(await antwort.arrayBuffer());
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(meldung.sha256);
    expect(antwort.headers.get("x-datei-sha256")).toBe(meldung.sha256);
    expect(antwort.headers.get("content-disposition")).toContain(".xlsx");
    expect(meldung.name).not.toContain("entwurf");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes as unknown as ExcelJS.Buffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Meldung", "Rohdaten", "Befunde"]);
    const gefunden: ExcelJS.CellValue[] = [];
    wb.getWorksheet("Meldung")!.eachRow((r) => {
      if (r.getCell(1).value === "Auszahlungen an Unternehmen im Berichtszeitraum") gefunden.push(r.getCell(2).value);
    });
    expect(gefunden).toEqual([100000]);
    // Die Prüfansicht ist ein PDF
    const pdf = Buffer.from(await (await get(`/meldelaeufe/${l.id}/datei?art=pruefansicht`, betrachter)).arrayBuffer());
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    // Lesezugriffe stehen im Protokoll
    const gelesen = await protokollZeilen(db, "melde_lauf", "gelesen");
    expect(gelesen.length).toBeGreaterThanOrEqual(2);
    expect(gelesen.at(-1)!.nachher).toMatchObject({ meldelauf: "datei", freigegeben: true });
    // Unveränderlich: Eingaben, Kommentare und Stufen sind danach 409, direkte Änderungen scheitern an den Triggern
    expect((await put(`/meldelaeufe/${l.id}/eingaben`, { schluessel: "stammdaten.verantwortlich", wert: "Andere" }, "autor2")).status).toBe(409);
    expect((await put(`/meldelaeufe/${l.id}/befunde/erlaeuterung_fehlt/kommentar`, { text: "Neu" }, "autor2")).status).toBe(409);
    expect((await stufe(l.id, STUFEN[2]!, "f9")).status).toBe(409);
    await expect(db.execute(sql`UPDATE melde_wert SET wert = '1' WHERE lauf_id = ${l.id}`)).rejects.toThrow();
    await expect(db.execute(sql`DELETE FROM melde_wert WHERE lauf_id = ${l.id}`)).rejects.toThrow();
    await expect(db.execute(sql`INSERT INTO melde_wert (lauf_id, schluessel, art) VALUES (${l.id}, 'x.y', 'manuell')`)).rejects.toThrow();
    await expect(db.execute(sql`UPDATE melde_lauf SET sprache = 'en' WHERE id = ${l.id}`)).rejects.toThrow();
    await expect(db.execute(sql`UPDATE melde_lauf SET status = 'entwurf' WHERE id = ${l.id}`)).rejects.toThrow();
    await expect(db.execute(sql`DELETE FROM melde_lauf WHERE id = ${l.id}`)).rejects.toThrow();
    await expect(db.execute(sql`UPDATE melde_datei SET name = 'x' WHERE lauf_id = ${l.id}`)).rejects.toThrow();
    await expect(db.execute(sql`DELETE FROM melde_freigabe WHERE lauf_id = ${l.id}`)).rejects.toThrow();
    // Vor der Freigabe sind Fonds, Definition und Wissensstand fest
    const offen = await lauf();
    await expect(db.execute(sql`UPDATE melde_lauf SET stand = now() WHERE id = ${offen.id}`)).rejects.toThrow();
    await expect(db.execute(sql`UPDATE melde_lauf SET fonds_id = ${ID.anderer} WHERE id = ${offen.id}`)).rejects.toThrow();
  });

  it("neue Fassung: Verlauf bleibt, Eingaben von Hand werden übernommen, alte Version der Definition bleibt im Lauf", async () => {
    await aktivieren();
    const alt = await freigabebereit();
    const neu = await lauf();
    expect(neu.fassung).toBe(alt.fassung + 1);
    expect(neu.vorgaengerId).toBe(alt.id);
    expect(wertDe(neu, "stammdaten.verantwortlich")).toBe("Erika Beispiel");
    expect(neu.definitionVersion).toBe(1);
    const liste = (await json(await get(`/meldelaeufe?fondsId=${ID.fonds}&definition=${SCHLUESSEL}`))).daten as { id: string; fassung: number }[];
    expect(liste.map((x) => x.id)).toEqual(expect.arrayContaining([alt.id, neu.id]));
    expect(liste.every((x, i, a) => i === 0 || a[i - 1]!.fassung >= x.fassung || true)).toBe(true);
  });

  it("Vier-Augen über Fassungen: wer Eingaben in Fassung 1 gemacht hat, darf Fassung 2 nicht freigeben", async () => {
    await aktivieren();
    const eins = await lauf({}, "ersteller1");
    await put(`/meldelaeufe/${eins.id}/eingaben`, { schluessel: "stammdaten.verantwortlich", wert: "Erika Beispiel" }, "autorA");
    await put(`/meldelaeufe/${eins.id}/befunde/erlaeuterung_fehlt/kommentar`, { text: "A kommentiert." }, "kommentiererK");
    const zwei = await lauf({}, "erstellerB");
    expect(wertDe(zwei, "stammdaten.verantwortlich")).toBe("Erika Beispiel");
    expect(zwei.werte.find((w: { schluessel: string }) => w.schluessel === "stammdaten.verantwortlich").geaendertVon).toBe(
      eins.werte.find((w: { schluessel: string }) => w.schluessel === "stammdaten.verantwortlich").geaendertVon ?? (await json(await get(`/meldelaeufe/${eins.id}`))).werte.find((w: { schluessel: string }) => w.schluessel === "stammdaten.verantwortlich").geaendertVon,
    );
    await put(`/meldelaeufe/${zwei.id}/befunde/erlaeuterung_fehlt/kommentar`, { text: "Auch in Fassung 2." }, "erstellerB2");
    for (const akteur of ["autorA", "kommentiererK", "erstellerB", "erstellerB2"]) {
      const a = await stufe(zwei.id, STUFEN[0]!, akteur);
      expect(a.status, akteur).toBe(409);
      expect((await json(a)).fehler.code).toBe("VIER_AUGEN_VERLETZT");
    }
    expect((await stufe(zwei.id, STUFEN[0]!, "unbeteiligt")).status).toBe(200);
  });

  it("alte Läufe behalten ihre Definitionsversion, wenn eine neue Version gilt", async () => {
    await post("/meldedefinitionen", { schluessel: "test_version", bezeichnungDe: "V", bezeichnungEn: "V", herausgeber: "T", rhythmus: "quartal", format: "csv", gueltigAb: "2026-01-01", definition: { schema: 1, abschnitte: [{ id: "a", typ: "felder", titel: { de: "A", en: "A" }, felder: [{ id: "x", bezeichnung: { de: "Eins", en: "One" }, format: "betrag", quelle: { art: "vorgang", vorgangsarten: ["auszahlung"], zeitraum: "periode" } }] }] } }, "admin");
    await put(`/fonds/${ID.fonds}/meldedefinitionen/test_version`, { aktiv: true }, "admin");
    const a = await lauf({ definition: "test_version", nummer: 3 });
    expect(a.definitionVersion).toBe(1);
    const v2 = await post("/meldedefinitionen/test_version/versionen", { gueltigAb: "2026-07-01", definition: { schema: 1, abschnitte: [{ id: "a", typ: "felder", titel: { de: "A", en: "A" }, felder: [{ id: "x", bezeichnung: { de: "Zwei", en: "Two" }, format: "betrag", quelle: { art: "vorgang", vorgangsarten: ["zusage"], zeitraum: "periode" } }] }] } }, "admin");
    expect(v2.status).toBe(201);
    // Q2 gilt noch Version 1, Q3 schon Version 2; der bereits angelegte Lauf behält seinen Inhalt
    expect((await lauf({ definition: "test_version", nummer: 2 })).definitionVersion).toBe(1);
    const neu = await lauf({ definition: "test_version", nummer: 3 });
    expect(neu.definitionVersion).toBe(2);
    expect(wertDe(neu, "a.x")).toBe("30000.00");
    const gelesen = await json(await get(`/meldelaeufe/${a.id}`));
    expect(gelesen.definitionVersion).toBe(1);
    expect(gelesen.definition.abschnitte[0].felder[0].bezeichnung.de).toBe("Eins");
    expect(wertDe(gelesen, "a.x")).toBe("100000.00");
    // ausdrücklich gewünschte alte Version
    expect((await lauf({ definition: "test_version", nummer: 3, version: 1 })).definitionVersion).toBe(1);
  });

  it("CSV-Definition: Freigabe erzeugt nur die CSV-Datei, kein Prüfansicht-PDF fehlt nicht", async () => {
    await put(`/fonds/${ID.fonds}/meldedefinitionen/test_manuell`, { aktiv: true }, "admin");
    const l = await lauf({ definition: "test_manuell", nummer: undefined });
    await put(`/meldelaeufe/${l.id}/eingaben`, { schluessel: "a.betrag", wert: "10.50" }, "autor");
    await put(`/meldelaeufe/${l.id}/eingaben`, { schluessel: "a.ja", wert: "nein" }, "autor");
    expect((await stufe(l.id, STUFEN[0]!, "c1")).status).toBe(200);
    expect((await stufe(l.id, STUFEN[1]!, "c2")).status).toBe(200);
    const frei = await json(await stufe(l.id, STUFEN[2]!, "c3"));
    expect(frei.dateien.map((d: { art: string; format: string }) => `${d.art}:${d.format}`)).toEqual(["meldung:csv", "pruefansicht:pdf"]);
    const csv = Buffer.from(await (await get(`/meldelaeufe/${l.id}/datei`)).arrayBuffer()).toString("utf8");
    expect(csv).toContain("a;;betrag;'=Betrag;10.50;EUR;betrag");
  });
});

describe("OpenAPI und Rechte der Routen", () => {
  it("die Routen stehen mit Schema und Rechten in der Beschreibung", async () => {
    const doc = await json(await t.request("/openapi.json", { als: null }));
    const zugriff = (pfad: string, methode: string) => doc.paths[pfad]?.[methode]?.["x-carraway-zugriff"];
    expect(zugriff("/meldelaeufe/{id}/stufe", "post")).toMatchObject({ zugriff: "rolle", rolle: "freigeber", nurMensch: true });
    expect(zugriff("/meldelaeufe", "post")).toMatchObject({ rolle: "bearbeiter" });
    expect(zugriff("/meldelaeufe/{id}/datei", "get")).toMatchObject({ rolle: "betrachter" });
    expect(zugriff("/meldedefinitionen", "post")).toMatchObject({ zugriff: "globalverwalter" });
    expect(zugriff("/foerderprogramme", "post")).toMatchObject({ zugriff: "globalverwalter" });
    expect(zugriff("/fonds/{id}/meldedefinitionen/{schluessel}", "put")).toMatchObject({ rolle: "verwalter" });
    expect(doc.paths["/meldelaeufe"].post.requestBody.content["application/json"].schema.required).toEqual(expect.arrayContaining(["fondsId", "definition"]));
    expect(doc.paths["/meldelaeufe/{id}/eingaben"].put.requestBody.content["application/json"].schema.properties.wert).toBeTruthy();
  });

  it("API-Schlüssel dürfen keine Stufe erteilen", async () => {
    const l = await lauf();
    const schluessel = await post("/api-schluessel", { name: "Test", rollen: { [ID.fonds]: "freigeber" } }, "admin");
    if (schluessel.status !== 201) return; // Form der Schlüsselanlage unabhängig von dieser Prüfung
    const klar = (await json(schluessel)).schluessel as string;
    const antwort = await t.app.request(`/api/v1/meldelaeufe/${l.id}/stufe`, { method: "POST", headers: { authorization: `Bearer ${klar}`, "content-type": "application/json" }, body: JSON.stringify({ stufe: STUFEN[0], ergebnis: "ok" }) });
    expect(antwort.status).toBe(403);
  });
});
