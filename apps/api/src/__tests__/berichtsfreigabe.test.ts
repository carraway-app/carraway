import { createHash } from "node:crypto";
import { chmod, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as warte } from "node:timers/promises";
import ExcelJS from "exceljs";
import { eq, sql } from "drizzle-orm";
import { extractText, getDocumentProxy } from "unpdf";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { erzeugeDemodaten, schreibeDemodaten } from "@carraway/db/demo";
import * as s from "@carraway/db";
import { Decimal } from "@carraway/rechenkern";
import { DateiSpeicher } from "../berichte/speicher";
import { json, leeren, loescheBewegungen, oeffneTestdb } from "./hilfen";
import { erstelleTestApp, idVon, legePersonAn, person, type Testperson, type TestApp } from "./hilfen-auth";

const { db, pool } = oeffneTestdb();
let verzeichnis = "";
let t: TestApp;

/** Wer handelt: ein Kürzel ergibt eine eigene Person mit Verwaltung aller Fonds, oder eine Testperson mit Rollen. */
const alsPerson = (als: string | Testperson): Testperson => (typeof als === "string" ? person(als, { globalVerwalter: true }) : als);
const senden = (methode: string) => async (pfad: string, koerper?: unknown, akteur?: string | Testperson) =>
  t.request(pfad, {
    method: methode,
    headers: { "content-type": "application/json" },
    body: koerper === undefined ? undefined : JSON.stringify(koerper),
    ...(akteur ? { als: alsPerson(akteur) } : {}),
  });
const get = (pfad: string, akteur?: string | Testperson) => t.request(pfad, akteur ? { als: alsPerson(akteur) } : {});
const post = senden("POST");
const put = senden("PUT");
const benutzer = (kuerzel: string) => idVon(db, person(kuerzel));

const STUFEN = ["Investmentmanager", "Teamleitung", "Geschäftsführung"];
let fondsId = "";
let stichtag = "";

async function text(antwort: Response | Uint8Array) {
  const bytes = antwort instanceof Uint8Array ? antwort : new Uint8Array(await antwort.arrayBuffer());
  const dokument = await getDocumentProxy(new Uint8Array(bytes));
  const { text: t, totalPages } = await extractText(dokument, { mergePages: true });
  return { text: t.replace(/\s+/g, " "), seiten: totalPages };
}
const normal = (x: string) => x.replace(/\s+/g, "").toUpperCase();

async function anlegen(koerper: object, akteur = "autor") {
  const antwort = await post("/reports", koerper, akteur);
  expect(antwort.status).toBe(201);
  return json(antwort);
}
const stufe = (id: string, stufeName: string, akteur: string, extra: object = {}) => post(`/reports/${id}/stage`, { stufe: stufeName, ergebnis: "ok", ...extra }, akteur);
async function freigeben(id: string, akteure = ["a1", "a2", "a3"], extra: object = {}) {
  let letzte: Response | undefined;
  for (const [i, akteur] of akteure.entries()) letzte = await stufe(id, STUFEN[i]!, akteur, i === akteure.length - 1 ? extra : {});
  return letzte!;
}

beforeAll(async () => {
  verzeichnis = await mkdtemp(join(tmpdir(), "carraway-berichte-"));
  t = erstelleTestApp(db, { speicher: new DateiSpeicher(verzeichnis) });
  await schreibeDemodaten(db, erzeugeDemodaten({ seed: 1 }));
  const { daten } = await json(await get("/fonds"));
  fondsId = daten[0].id;
  stichtag = (await json(await get(`/fonds/${fondsId}/uebersicht`))).stichtag;
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
  await rm(verzeichnis, { recursive: true, force: true });
});

describe("Bericht anlegen und lesen", () => {
  it("legt einen Entwurf mit den Stufen des Fonds an und liefert ihn in Liste und Detail", async () => {
    const b = await anlegen({ art: "lp_bericht", fondsId, sprache: "de" });
    expect(b).toMatchObject({ art: "lp_bericht", format: "pdf", status: "entwurf", naechsteStufe: 0, erstelltVon: await benutzer("autor"), freigabestufen: STUFEN, stichtag, stand: null });
    const detail = await json(await get(`/reports/${b.id}`));
    expect(detail).toMatchObject({ id: b.id, protokoll: [], abschnitte: [], naechsteStufeName: "Investmentmanager" });
    const liste = await json(await get(`/reports?fondsId=${fondsId}&art=lp_bericht`));
    expect(liste.daten.map((x: { id: string }) => x.id)).toContain(b.id);
    expect((await json(await get(`/reports?status=freigegeben&fondsId=${fondsId}`))).daten.every((x: { status: string }) => x.status === "freigegeben")).toBe(true);
  });

  it("prüft die Eingaben", async () => {
    const fremd = "00000000-0000-4000-8000-0000000000ff";
    const fehler = async (koerper: object) => (await post("/reports", koerper)).status;
    expect(await fehler({ art: "quartalsbericht", fondsId })).toBe(400);
    expect(await fehler({ art: "lp_bericht" })).toBe(400);
    expect(await fehler({ art: "lp_bericht", fondsId, format: "xlsx" })).toBe(400);
    expect(await fehler({ art: "quartalsbericht", beteiligungId: fremd })).toBe(404);
    expect(await fehler({ art: "lp_bericht", fondsId: fremd })).toBe(404);
    expect(await fehler({ art: "lp_bericht", fondsId, sprache: "fr" })).toBe(400);
    expect(await fehler({ art: "lp_bericht", fondsId, stichtag: "2100-01-01" })).toBe(400);
    expect(await fehler({ art: "unbekannt", fondsId })).toBe(400);
    expect((await get(`/reports/${fremd}`)).status).toBe(404);
    expect((await get(`/reports/${fremd}/file`)).status).toBe(404);
    expect((await json(await get(`/reports/${fremd}`))).error.code).toBe("report_not_found");
  });

  it("der Entwurf liefert die Datei mit Wasserzeichen, ohne sie zu speichern", async () => {
    const b = await anlegen({ art: "lp_bericht", fondsId, sprache: "de" });
    const antwort = await get(`/reports/${b.id}/file`);
    expect(antwort.status).toBe(200);
    expect(antwort.headers.get("Content-Type")).toBe("application/pdf");
    expect(antwort.headers.get("Content-Disposition")).toMatch(/entwurf\.pdf"$/);
    expect(antwort.headers.get("X-File-Sha256")).toBeNull();
    expect((await text(antwort)).text).toContain("ENTWURF");
  });
});

describe("Freigabe in Stufen", () => {
  it("gibt den Quartalsstand aller Demo-Fonds ohne Überschreibung frei", async () => {
    const { daten } = await json(await get("/fonds"));
    for (const fonds of daten) {
      const bericht = await anlegen({ art: "fondsbericht", fondsId: fonds.id, stichtag: "2026-09-30" });
      const antwort = await freigeben(bericht.id);
      expect(await json(antwort), fonds.kurzname).toMatchObject({ status: "freigegeben", kontrolleUeberschrieben: null });
    }
  });

  it("drei Stufen mit verschiedenen Akteuren; die Datei ist ohne Wasserzeichen, gespeichert und unveränderlich abrufbar", async () => {
    const b = await anlegen({ art: "lp_bericht", fondsId, sprache: "de" });
    // falsche Stufe, gleicher Akteur
    const falsch = await stufe(b.id, "Teamleitung", "a1");
    expect(falsch.status).toBe(409);
    expect((await json(falsch)).error).toMatchObject({ code: "report_stage_wrong", erwartet: "Investmentmanager" });

    const eins = await stufe(b.id, "Investmentmanager", "a1");
    expect(await json(eins)).toMatchObject({ status: "geprueft", naechsteStufe: 1 });
    const doppelt = await stufe(b.id, "Teamleitung", "a1");
    expect(doppelt.status).toBe(409);
    expect((await json(doppelt)).error.code).toBe("four_eyes_violated");
    expect((await stufe(b.id, "Teamleitung", "a2")).status).toBe(200);
    expect((await stufe(b.id, "Geschäftsführung", "a2")).status).toBe(409);
    // Datei ist noch nicht eingefroren
    expect(((await text(await get(`/reports/${b.id}/file`))).text)).toContain("ENTWURF");

    const vorher = Date.now();
    const fertig = await stufe(b.id, "Geschäftsführung", "a3");
    expect(fertig.status).toBe(200);
    const f = await json(fertig);
    expect(f).toMatchObject({ status: "freigegeben", naechsteStufe: 3, kontrolleUeberschrieben: null });
    expect(f.dateiSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(new Date(f.stand).getTime()).toBeGreaterThanOrEqual(vorher - 1000);
    expect(f.dateiSchluessel).toBe(`berichte/${b.id}/${f.dateiSha256}.pdf`);

    const detail = await json(await get(`/reports/${b.id}`));
    expect(detail.protokoll.map((p: { stufe: string; akteur: string; ergebnis: string }) => `${p.stufe}:${p.akteur}:${p.ergebnis}`)).toEqual([
      `Investmentmanager:${await benutzer("a1")}:ok`,
      `Teamleitung:${await benutzer("a2")}:ok`,
      `Geschäftsführung:${await benutzer("a3")}:ok`,
    ]);
    expect(detail.naechsteStufeName).toBeNull();

    const antwort = await get(`/reports/${b.id}/file`);
    expect(antwort.headers.get("X-File-Sha256")).toBe(f.dateiSha256);
    const bytes = new Uint8Array(await antwort.arrayBuffer());
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(f.dateiSha256);
    const gespeichert = await readFile(join(verzeichnis, f.dateiSchluessel));
    expect(Buffer.from(bytes).equals(gespeichert)).toBe(true);
    const { text: pdf } = await text(bytes);
    expect(pdf.toUpperCase()).not.toContain("ENTWURF");
    expect(pdf).toContain("Freigegeben");

    // weitere Stufen sind nicht mehr möglich
    expect((await stufe(b.id, "Geschäftsführung", "a4")).status).toBe(409);
    // Datenbankschutz
    await expect(db.update(s.bericht).set({ erstelltVon: "x" }).where(eq(s.bericht.id, b.id))).rejects.toThrow();
  });

  it("Rückgabe: die zuletzt erteilte Freigabe entfällt, die Stufe darf neu und von einem anderen Akteur erteilt werden", async () => {
    const b = await anlegen({ art: "lp_bericht", fondsId });
    await stufe(b.id, "Investmentmanager", "a1");
    await stufe(b.id, "Teamleitung", "a2");
    const ohneKommentar = await post(`/reports/${b.id}/stage`, { stufe: "Geschäftsführung", ergebnis: "zurueck" }, "a3");
    expect(ohneKommentar.status).toBe(400);
    const zurueck = await post(`/reports/${b.id}/stage`, { stufe: "Geschäftsführung", ergebnis: "zurueck", kommentar: "Zahlen unklar" }, "a3");
    expect(await json(zurueck)).toMatchObject({ status: "geprueft", naechsteStufe: 1 });
    // Teamleitung muss neu prüfen; a1 hat noch gültig geprüft, a2 darf es wieder
    expect((await json(await get(`/reports/${b.id}`))).naechsteStufeName).toBe("Teamleitung");
    expect((await stufe(b.id, "Teamleitung", "a1")).status).toBe(409);
    expect((await stufe(b.id, "Teamleitung", "a2")).status).toBe(200);
    // Rückgabe bis zum Entwurf
    await post(`/reports/${b.id}/stage`, { stufe: "Geschäftsführung", ergebnis: "zurueck", kommentar: "nochmal" }, "a3");
    await post(`/reports/${b.id}/stage`, { stufe: "Teamleitung", ergebnis: "zurueck", kommentar: "alles neu" }, "a2");
    expect(await json(await get(`/reports/${b.id}`))).toMatchObject({ status: "entwurf", naechsteStufe: 0 });
    const protokoll = (await json(await get(`/reports/${b.id}`))).protokoll;
    expect(protokoll.filter((p: { ergebnis: string }) => p.ergebnis === "zurueck")).toHaveLength(3);
    // a1 darf nach der Rückgabe wieder prüfen
    expect((await stufe(b.id, "Investmentmanager", "a1")).status).toBe(200);
    await expect(db.execute(sql`UPDATE bericht_freigabe SET akteur = 'x'`)).rejects.toThrow();
  });

  it("die Stufen sind je Fonds konfigurierbar; bestehende Berichte behalten ihre", async () => {
    const alt = await anlegen({ art: "portfolioliste", fondsId });
    expect((await put(`/funds/${fondsId}/approval-stages`, { stages: ["Prüfung", "Freigabe"] }, "chef")).status).toBe(200);
    expect(await json(await get(`/funds/${fondsId}/approval-stages`))).toEqual({ stages: ["Prüfung", "Freigabe"] });
    const neu = await anlegen({ art: "portfolioliste", fondsId });
    expect(neu.freigabestufen).toEqual(["Prüfung", "Freigabe"]);
    expect((await json(await get(`/reports/${alt.id}`))).freigabestufen).toEqual(STUFEN);
    await stufe(neu.id, "Prüfung", "a1");
    const final = await stufe(neu.id, "Freigabe", "a2");
    expect(final.status).toBe(200);
    expect((await json(final)).status).toBe("freigegeben");
    expect((await put(`/funds/${fondsId}/approval-stages`, { stages: [] })).status).toBe(400);
    expect((await put(`/funds/${fondsId}/approval-stages`, { stages: ["A", "a"] })).status).toBe(400);
    await put(`/funds/${fondsId}/approval-stages`, { stages: STUFEN });
  });

  it("ein freigegebener Bericht bleibt nach neuen Buchungen unverändert, das Neuerzeugen mit dem alten Stand ergibt dieselben Zahlen", async () => {
    const b = await anlegen({ art: "fondsbericht", fondsId, format: "xlsx" });
    const fertig = await json(await freigeben(b.id));
    const vorher = new Uint8Array(await (await get(`/reports/${b.id}/file`)).arrayBuffer());
    // neue Buchung nach der Freigabe
    await db.insert(s.fondsBewegung).values({ fondsId, art: "abruf", valuta: stichtag, betrag: "1234567.00", bemerkung: "nach Freigabe" });
    const nachher = new Uint8Array(await (await get(`/reports/${b.id}/file`)).arrayBuffer());
    expect(createHash("sha256").update(nachher).digest("hex")).toBe(fertig.dateiSha256);
    expect(Buffer.from(nachher).equals(Buffer.from(vorher))).toBe(true);
    // ein Entwurf zum früheren Stand zeigt die alte Summe, einer ohne Stand die neue
    const lesen = async (stand?: string) => {
      const n = await anlegen({ art: "fondsbericht", fondsId, format: "xlsx", ...(stand ? { stand } : {}) });
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load((await (await get(`/reports/${n.id}/file`)).arrayBuffer()) as ArrayBuffer);
      return Number(wb.getWorksheet("Kennzahlen")!.getRow(8).getCell(2).value);
    };
    const wbAlt = new ExcelJS.Workbook();
    await wbAlt.xlsx.load(vorher.buffer as ArrayBuffer);
    const abgerufenAlt = Number(wbAlt.getWorksheet("Kennzahlen")!.getRow(7).getCell(2).value);
    const wbNeu = new ExcelJS.Workbook();
    const neuDraft = await anlegen({ art: "fondsbericht", fondsId, format: "xlsx" });
    await wbNeu.xlsx.load((await (await get(`/reports/${neuDraft.id}/file`)).arrayBuffer()) as ArrayBuffer);
    expect(Number(wbNeu.getWorksheet("Kennzahlen")!.getRow(7).getCell(2).value)).toBeCloseTo(abgerufenAlt + 1234567, 2);
    const reproduziert = await anlegen({ art: "fondsbericht", fondsId, format: "xlsx", stand: fertig.stand });
    const wbRep = new ExcelJS.Workbook();
    await wbRep.xlsx.load((await (await get(`/reports/${reproduziert.id}/file`)).arrayBuffer()) as ArrayBuffer);
    expect(Number(wbRep.getWorksheet("Kennzahlen")!.getRow(7).getCell(2).value)).toBe(abgerufenAlt);
    void lesen;
    await loescheBewegungen(db, "nach Freigabe");
  });

  it("eine veränderte gespeicherte Datei wird erkannt (500 file_corrupt)", async () => {
    const b = await anlegen({ art: "exitliste", fondsId });
    const f = await json(await freigeben(b.id));
    const pfad = join(verzeichnis, f.dateiSchluessel);
    await chmod(pfad, 0o644);
    const original = await readFile(pfad);
    await writeFile(pfad, Buffer.concat([original, Buffer.from("x")]));
    const antwort = await get(`/reports/${b.id}/file`);
    expect(antwort.status).toBe(500);
    expect((await json(antwort)).error.code).toBe("file_corrupt");
    await writeFile(pfad, original);
    await chmod(pfad, 0o444);
    expect((await get(`/reports/${b.id}/file`)).status).toBe(200);
  });

  it("freigegebene Dateien werden schreibgeschützt abgelegt, der Speicher überschreibt nichts", async () => {
    const dateien = (await readdir(join(verzeichnis, "berichte"), { recursive: true })).filter((x) => x.endsWith(".pdf") || x.endsWith(".xlsx"));
    expect(dateien.length).toBeGreaterThan(0);
    const speicher = new DateiSpeicher(verzeichnis);
    await speicher.schreibe("berichte/test/a.bin", new Uint8Array([1, 2, 3]));
    await speicher.schreibe("berichte/test/a.bin", new Uint8Array([1, 2, 3]));
    await expect(speicher.schreibe("berichte/test/a.bin", new Uint8Array([9]))).rejects.toThrow();
    await expect(speicher.schreibe("../ausserhalb", new Uint8Array([1]))).rejects.toThrow();
    await expect(speicher.lese("berichte/test/gibtsnicht.bin")).rejects.toThrow();
  });
});

describe("Freitextabschnitte", () => {
  it("lassen sich im Entwurf setzen, erscheinen im Bericht und werden mit der Freigabe freigegeben", async () => {
    const b = await anlegen({ art: "lp_bericht", fondsId, sprache: "en" });
    const a = await put(`/reports/${b.id}/sections/foreword`, { textDe: "Deutscher Text.", textEn: "English foreword text." }, "autor");
    expect(a.status).toBe(200);
    expect(await json(a)).toMatchObject({ schluessel: "vorwort", status: "entwurf", textEn: "English foreword text." });
    await put(`/reports/${b.id}/sections/foreword`, { textDe: "Neu." }, "autor");
    const detail = await json(await get(`/reports/${b.id}`));
    expect(detail.abschnitte).toHaveLength(1);
    expect(detail.abschnitte[0]).toMatchObject({ textDe: "Neu.", textEn: "English foreword text." });
    expect(detail.abschnitte[0].geaendertVon).toBe(await benutzer("autor"));
    expect((await text(await get(`/reports/${b.id}/file`))).text).toContain("English foreword text.");

    expect((await stufe(b.id, "Investmentmanager", "a1")).status).toBe(200);
    const gesperrt = await put(`/reports/${b.id}/sections/foreword`, { textEn: "zu spät" }, "autor");
    expect(gesperrt.status).toBe(409);
    expect((await json(gesperrt)).error.code).toBe("report_not_draft");
    // nach Rückgabe wieder editierbar
    await post(`/reports/${b.id}/stage`, { stufe: "Teamleitung", ergebnis: "zurueck", kommentar: "Text anpassen" }, "a2");
    expect((await put(`/reports/${b.id}/sections/outlook`, { textEn: "The outlook is calm." }, "autor")).status).toBe(200);

    await stufe(b.id, "Investmentmanager", "a1");
    await stufe(b.id, "Teamleitung", "a2");
    const fertig = await json(await stufe(b.id, "Geschäftsführung", "a3"));
    expect(fertig.status).toBe("freigegeben");
    const frei = await json(await get(`/reports/${b.id}`));
    expect(frei.abschnitte.every((x: { status: string }) => x.status === "freigegeben")).toBe(true);
    const { text: pdf } = await text(await get(`/reports/${b.id}/file`));
    expect(pdf).toContain("English foreword text.");
    expect(pdf).toContain("The outlook is calm.");
    expect(pdf.toUpperCase()).not.toContain("DRAFT");
    expect((await put(`/reports/${b.id}/sections/foreword`, { textEn: "x" })).status).toBe(409);
    await expect(db.update(s.berichtAbschnitt).set({ textEn: "x" }).where(eq(s.berichtAbschnitt.berichtId, b.id))).rejects.toThrow();
  });

  it("andere Arten, Schlüssel außerhalb der Vorlage und leere Eingaben werden abgelehnt", async () => {
    const andere = await anlegen({ art: "fondsbericht", fondsId });
    const a = await put(`/reports/${andere.id}/sections/foreword`, { textDe: "x" });
    expect(a.status).toBe(409);
    expect((await json(a)).error.code).toBe("section_unknown");
    const b = await anlegen({ art: "lp_bericht", fondsId });
    expect((await put(`/reports/${b.id}/sections/geheim`, { textDe: "x" })).status).toBe(400);
    expect((await put(`/reports/${b.id}/sections/foreword`, {})).status).toBe(400);
    expect((await put(`/funds/${fondsId}/report-templates/lp_report`, { abschnitte: ["kennzahlen", "kapitalkonten"] })).status).toBe(200);
    const ohneVorwort = await anlegen({ art: "lp_bericht", fondsId });
    const fehlt = await put(`/reports/${ohneVorwort.id}/sections/foreword`, { textDe: "x" });
    expect(fehlt.status).toBe(409);
    expect((await json(fehlt)).error.code).toBe("section_unknown");
    await put(`/funds/${fondsId}/report-templates/lp_report`, {});
  });
});

describe("Vorlagen je Fonds", () => {
  it("ohne Vorlage gelten die Standardwerte, eine Vorlage ändert Abschnitte, Reihenfolge und Einheit des Berichts", async () => {
    const liste = await json(await get(`/funds/${fondsId}/report-templates`));
    expect(liste.daten.map((x: { art: string }) => x.art)).toEqual(["fondsbericht", "quartalsbericht", "lp_bericht", "gremienvorlage", "portfolioliste", "exitliste", "pai_erklaerung"]);
    expect(liste.daten.find((x: { art: string }) => x.art === "exitliste")).toMatchObject({ angepasst: false });

    const b = await anlegen({ art: "lp_bericht", fondsId, sprache: "de" });
    const standard = (await text(await get(`/reports/${b.id}/file`))).text;
    expect(standard).toContain("Kapitalkonten der Investoren");
    expect(standard).toContain("Bewertungsmethoden");

    const gesetzt = await put(`/funds/${fondsId}/report-templates/lp_report`, { einheit: "TEUR", abschnitte: ["portfolio", "kennzahlen"], kennzahlen: ["nav"], spalten: ["unternehmen", "bewertung"] }, "chef");
    expect(gesetzt.status).toBe(200);
    expect(await json(gesetzt)).toMatchObject({ angepasst: true, konfiguration: { einheit: "TEUR" } });
    // der bereits angelegte Bericht behält die Vorlage vom Zeitpunkt der Anlage
    expect((await text(await get(`/reports/${b.id}/file`))).text).toContain("Kapitalkonten der Investoren");
    const b2 = await anlegen({ art: "lp_bericht", fondsId, sprache: "de" });
    const geaendert = (await text(await get(`/reports/${b2.id}/file`))).text;
    expect(geaendert).not.toContain("Kapitalkonten der Investoren");
    expect(geaendert).not.toContain("Bewertungsmethoden");
    expect(geaendert).toContain("TEUR");
    expect(geaendert.indexOf("Portfolio")).toBeLessThan(geaendert.indexOf("Kennzahlen des Fonds"));
    expect(normal(geaendert)).not.toContain(normal("TVPI"));
    expect((await json(await get(`/funds/${fondsId}/report-templates`))).daten.find((x: { art: string }) => x.art === "lp_bericht").angepasst).toBe(true);
    expect((await s_protokoll("bericht_vorlage")).length).toBeGreaterThan(0);

    const ungueltig = await put(`/funds/${fondsId}/report-templates/lp_report`, { abschnitte: ["kennzahlen", "gibtsnicht"], einheit: "MEUR" });
    expect(ungueltig.status).toBe(400);
    expect((await json(ungueltig)).error.fields.length).toBeGreaterThanOrEqual(2);
    expect((await put(`/funds/${fondsId}/report-templates/gibtsnicht`, {})).status).toBe(400);
    await put(`/funds/${fondsId}/report-templates/lp_report`, {});
  });

  it("die alten Download-Routen lesen die Vorlage ebenfalls", async () => {
    await put(`/funds/${fondsId}/report-templates/fund_report`, { abschnitte: ["kennzahlen"], einheit: "TEUR" });
    const t = (await text(await get(`/funds/${fondsId}/reports/fund-report?sprache=de`))).text;
    expect(t).toContain("TEUR");
    expect(t).not.toContain("Herkunft der Kennzahlen");
    await put(`/funds/${fondsId}/report-templates/fund_report`, {});
  });
});

async function s_protokoll(tabelle: string) {
  return (await db.execute(sql`SELECT 1 FROM aenderung WHERE tabelle = ${tabelle}`)).rows;
}

describe("LP-Bericht: Kapitalkonten", () => {
  it("die Kapitalkonten summieren sich auf die Summen des Fonds (unabhängiges SQL), auf den Cent", async () => {
    const b = await anlegen({ art: "lp_bericht", fondsId });
    const antwort = await get(`/reports/${b.id}/file`);
    const { text: t } = await text(antwort);
    expect(t).toContain("Kapitalkonten der Investoren");
    // Unabhängige Summen aus SQL
    const { rows } = await db.execute<{ abruf: string; ausschuettung: string; zusage: string; anzahl: number }>(sql`
      SELECT (SELECT coalesce(sum(betrag), 0) FROM fonds_bewegung WHERE fonds_id = ${fondsId} AND art = 'abruf' AND valuta <= ${stichtag}::date)::text AS abruf,
             (SELECT coalesce(sum(betrag), 0) FROM fonds_bewegung WHERE fonds_id = ${fondsId} AND art = 'ausschuettung' AND valuta <= ${stichtag}::date)::text AS ausschuettung,
             (SELECT coalesce(sum(zusage), 0) FROM fonds_zeichnung WHERE fonds_id = ${fondsId})::text AS zusage,
             (SELECT count(*)::int FROM fonds_zeichnung WHERE fonds_id = ${fondsId}) AS anzahl`);
    expect(rows[0]!.anzahl).toBe(5);
    const fonds = (await db.select().from(s.fonds).where(eq(s.fonds.id, fondsId)))[0]!;
    expect(rows[0]!.zusage).toBe(fonds.zeichnungskapital);
    // Kontrollbericht des LP-Berichts prüft Kapitalkonten gegen den Fonds
    const k = await json(await get(`/reports/${b.id}/checks`));
    const konten = k.pruefungen.find((p: { code: string }) => p.code === "KAPITALKONTEN_ABWEICHUNG");
    expect(konten.status).toBe("ok");
    // Der Text enthält die Summen als Zahl in deutscher Schreibweise
    const de = (w: string) => new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(w));
    expect(t).toContain(de(rows[0]!.abruf));
    expect(t).toContain(de(rows[0]!.zusage));
    if (new Decimal(rows[0]!.ausschuettung).greaterThan(0)) expect(t).toContain(de(rows[0]!.ausschuettung));
  });

  it("englische Fassung mit Prozentwerten ohne Leerzeichen", async () => {
    const b = await anlegen({ art: "lp_bericht", fondsId, sprache: "en" });
    const { text: t } = await text(await get(`/reports/${b.id}/file`));
    expect(t).toContain("Investor capital accounts");
    expect(t).toMatch(/\d+\.\d%/);
    expect(t).not.toMatch(/\d+\.\d %/);
  });
});

describe("Kontrollbericht", () => {
  it("die abgestimmten Daten sind grün, jede Prüfung hat Code und Parameter", async () => {
    const b = await anlegen({ art: "fondsbericht", fondsId });
    const k = await json(await get(`/reports/${b.id}/checks`));
    expect(k.pruefungen.map((p: { code: string }) => p.code)).toEqual(["PORTFOLIO_SUMME_ABWEICHUNG", "NAV_ABWEICHUNG", "BEWERTUNG_FEHLT", "ABRUFE_UEBER_ZEICHNUNG", "ENTWURF_BEWERTUNG_OFFEN"]);
    expect(k).toMatchObject({ gesamt: "ok", stichtag });
    expect(k.pruefungen.every((p: { schluessel: string; bezeichnung: string; params: object }) => p.schluessel && p.bezeichnung && typeof p.params === "object")).toBe(true);
    const grem = await anlegen({ art: "gremienvorlage", fondsId });
    expect((await json(await get(`/reports/${grem.id}/checks`))).pruefungen).toEqual([]);
  });

  let beteiligungId = "";
  let bisherigerWert = "";
  async function aktive() {
    const { rows } = await db.execute<{ id: string }>(sql`SELECT id FROM beteiligung WHERE fonds_id = ${fondsId} AND status = 'aktiv' AND erstinvestment <= ${stichtag}::date ORDER BY id LIMIT 1`);
    return rows[0]!.id;
  }

  it("eine fehlende Bewertung zum Stichtag macht die Kontrolle rot und sperrt die Freigabe (409 checks_failed)", async () => {
    beteiligungId = await aktive();
    bisherigerWert = (await db.execute<{ wert: string }>(sql`SELECT wert FROM bewertung WHERE beteiligung_id = ${beteiligungId} AND stichtag = ${stichtag} AND status = 'freigegeben'`)).rows[0]!.wert;
    await db.execute(sql`UPDATE bewertung SET status = 'ersetzt', ersetzt_am = now() WHERE beteiligung_id = ${beteiligungId} AND stichtag = ${stichtag}::date AND status = 'freigegeben'`);
    const b = await anlegen({ art: "fondsbericht", fondsId });
    const k = await json(await get(`/reports/${b.id}/checks`));
    expect(k.gesamt).toBe("abweichung");
    const fehlt = k.pruefungen.find((p: { code: string }) => p.code === "BEWERTUNG_FEHLT");
    expect(fehlt).toMatchObject({ status: "abweichung", params: { anzahl: 1 } });
    expect(fehlt.details[0].beteiligungId).toBe(beteiligungId);

    const freigabenVorher = await s_zeilen("bericht", "freigeben");
    await stufe(b.id, "Investmentmanager", "a1");
    await stufe(b.id, "Teamleitung", "a2");
    const rot = await stufe(b.id, "Geschäftsführung", "a3");
    expect(rot.status).toBe(409);
    const d = await json(rot);
    expect(d.error.code).toBe("checks_failed");
    expect(d.error.pruefungen.map((p: { code: string }) => p.code)).toContain("BEWERTUNG_FEHLT");
    expect(await json(await get(`/reports/${b.id}`))).toMatchObject({ status: "geprueft", naechsteStufe: 2 });
    expect(await s_zeilen("bericht", "freigeben")).toBe(freigabenVorher);

    // Überschreibung nur mit Begründung und nur in der letzten Stufe
    expect((await post(`/reports/${b.id}/stage`, { stufe: "Geschäftsführung", ergebnis: "ok", kontrolleUeberschreiben: {} }, "a3")).status).toBe(400);
    const ueber = await stufe(b.id, "Geschäftsführung", "a3", { kontrolleUeberschreiben: { grund: "Bewertung liegt in der Sitzung vor, Nachtrag folgt" } });
    expect(ueber.status).toBe(200);
    const f = await json(ueber);
    expect(f.status).toBe("freigegeben");
    expect(f.kontrolleUeberschrieben).toMatchObject({ grund: "Bewertung liegt in der Sitzung vor, Nachtrag folgt", akteur: await benutzer("a3") });
    expect(f.kontrolleUeberschrieben.pruefungen).toContainEqual(expect.objectContaining({ code: "BEWERTUNG_FEHLT" }));
    const protokoll = (await json(await get(`/reports/${b.id}`))).protokoll;
    expect(protokoll.at(-1).kontrolleUeberschreibung).toBe("Bewertung liegt in der Sitzung vor, Nachtrag folgt");
    expect(await s_zeilen("bericht", "kontrolle_ueberschrieben")).toBe(1);
    // Die Kontrolle des freigegebenen Berichts bleibt rot (mit seinem Stand), unabhängig von späteren Korrekturen
    expect((await json(await get(`/reports/${b.id}/checks`))).gesamt).toBe("abweichung");
  });

  it("Überschreibung außerhalb der letzten Stufe wird abgelehnt", async () => {
    const b = await anlegen({ art: "fondsbericht", fondsId });
    const r = await stufe(b.id, "Investmentmanager", "a1", { kontrolleUeberschreiben: { grund: "x" } });
    expect(r.status).toBe(400);
  });

  it("Entwürfe zum Stichtag und ein falscher NAV werden gemeldet", async () => {
    // Bewertung wieder herstellen und einen Entwurf anlegen
    await db.insert(s.bewertung).values({ beteiligungId, stichtag, wert: bisherigerWert, methode: "sonstige", begruendung: "Wiederherstellung", status: "freigegeben" });
    const entwurf = await post(`/beteiligungen/${beteiligungId}/bewertungen`, { stichtag: "2026-10-31", wert: "5.00", methode: "dcf", begruendung: "Planung" }, "autor");
    expect(entwurf.status).toBe(201);
    const b = await anlegen({ art: "portfolioliste", fondsId, stichtag: "2026-10-31" });
    const k = await json(await get(`/reports/${b.id}/checks`));
    const e = k.pruefungen.find((p: { code: string }) => p.code === "ENTWURF_BEWERTUNG_OFFEN");
    expect(e).toMatchObject({ status: "abweichung", params: { anzahl: 1 } });
    // Abrufe über Zeichnungskapital
    const kapital = (await db.select().from(s.fonds).where(eq(s.fonds.id, fondsId)))[0]!.zeichnungskapital;
    await db.insert(s.fondsBewegung).values({ fondsId, art: "abruf", valuta: stichtag, betrag: new Decimal(kapital).plus(1).toFixed(2), bemerkung: "Test" });
    const k2 = await json(await get(`/reports/${b.id}/checks`));
    expect(k2.pruefungen.find((p: { code: string }) => p.code === "ABRUFE_UEBER_ZEICHNUNG").status).toBe("abweichung");
    await loescheBewegungen(db, "Test");
  });
});

async function s_zeilen(tabelle: string, aktion: string) {
  return (await db.execute(sql`SELECT 1 FROM aenderung WHERE tabelle = ${tabelle} AND aktion = ${aktion}`)).rows.length;
}

describe.each(["de", "en"] as const)("Listen, Gremienvorlage und Quartalsbericht im Workflow (%s)", (sprache) => {
  const de = sprache === "de";

  it("Portfolioliste als Excel und PDF: Zeilen und Summen stimmen mit unabhängigem SQL überein", async () => {
    const b = await anlegen({ art: "portfolioliste", fondsId, format: "xlsx", sprache });
    const antwort = await get(`/reports/${b.id}/file`);
    expect(antwort.headers.get("Content-Type")).toContain("spreadsheetml");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await antwort.arrayBuffer()) as ArrayBuffer);
    const blatt = wb.getWorksheet(de ? "Portfolioliste" : "Portfolio list")!;
    const { rows } = await db.execute<{ n: number; zusage: string; investiert: string }>(sql`
      SELECT count(DISTINCT be.id)::int AS n,
        coalesce(sum(v.betrag) FILTER (WHERE v.art = 'zusage'), 0)::text AS zusage,
        coalesce(sum(v.betrag) FILTER (WHERE v.art = 'auszahlung'), 0)::text AS investiert
      FROM beteiligung be LEFT JOIN vorgang v ON v.beteiligung_id = be.id AND v.valuta <= ${stichtag}::date
      WHERE be.fonds_id = ${fondsId} AND be.erstinvestment <= ${stichtag}::date AND be.status <> 'exit'`);
    expect(blatt.rowCount).toBe(1 + rows[0]!.n + 1);
    const summe = blatt.getRow(blatt.rowCount);
    expect(summe.getCell(6).value).toBeCloseTo(Number(rows[0]!.zusage), 2);
    expect(summe.getCell(7).value).toBeCloseTo(Number(rows[0]!.investiert), 2);
    expect((blatt.getRow(1).values as unknown[]).slice(1, 3)).toEqual(de ? ["Unternehmen", "Sektor"] : ["Company", "Sector"]);
    // keine ausgeschiedene Beteiligung in der Liste
    const { rows: exits } = await db.execute<{ name: string }>(sql`SELECT o.name FROM beteiligung be JOIN organisation o ON o.id = be.organisation_id WHERE be.fonds_id = ${fondsId} AND be.status = 'exit' LIMIT 1`);
    const namen = blatt.getColumn(1).values.map(String);
    if (exits[0]) expect(namen).not.toContain(exits[0].name);

    const pdf = await anlegen({ art: "portfolioliste", fondsId, sprache });
    const { text: t } = await text(await get(`/reports/${pdf.id}/file`));
    expect(t).toContain(de ? "Summe" : "Total");
    expect(t).toContain(de ? "ENTWURF" : "DRAFT");
  });

  it("Exitliste: Art, Erlös und IRR je Exit, offene Treuhand wird ausgewiesen", async () => {
    const b = await anlegen({ art: "exitliste", fondsId, format: "xlsx", sprache });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await (await get(`/reports/${b.id}/file`)).arrayBuffer()) as ArrayBuffer);
    const blatt = wb.getWorksheet(de ? "Exitliste" : "Exit list")!;
    const { rows } = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM beteiligung WHERE fonds_id = ${fondsId} AND status <> 'aktiv'`);
    expect(blatt.rowCount).toBeGreaterThanOrEqual(2);
    expect(blatt.rowCount - 2).toBeLessThanOrEqual(rows[0]!.n);
    const arten = blatt.getColumn(2).values.slice(2, -1).map(String);
    for (const a of arten) expect(de ? ["Verkauf", "Insolvenz", "Rückzahlung", "Liquidation"] : ["Sale", "Insolvency", "Repayment", "Liquidation"]).toContain(a);
    const exit = blatt.getRow(2);
    expect(Number(exit.getCell(5).value)).toBeGreaterThan(0);
    expect(typeof exit.getCell(7).value === "number" || exit.getCell(7).value === null).toBe(true);
  });

  it("Gremienvorlage mit Beschlussvorschlag, Aktivitäten und Beschlüssen des Zeitraums", async () => {
    const { rows } = await db.execute<{ titel: string; vorschlag: string; fonds_id: string }>(sql`SELECT titel, beschlussvorschlag AS vorschlag, fonds_id FROM deal WHERE phase = 'investitionsausschuss' AND status = 'offen' AND beschlussvorschlag IS NOT NULL ORDER BY id LIMIT 1`);
    expect(rows[0]).toBeDefined();
    const { rows: letzter } = await db.execute<{ datum: string; titel: string }>(sql`SELECT b.datum::text AS datum, d.titel FROM beschluss b JOIN deal d ON d.id = b.deal_id WHERE b.datum <= '2026-11-20' ORDER BY b.datum DESC, b.id LIMIT 1`);
    const b = await anlegen({ art: "gremienvorlage", fondsId: rows[0]!.fonds_id, sprache, stichtag: letzter[0]!.datum });
    const { text: t } = await text(await get(`/reports/${b.id}/file`));
    expect(normal(t)).toContain(normal(de ? "Beschlussvorschlag" : "Proposed resolution"));
    expect(normal(t)).toContain(normal(de ? "Aktivitäten" : "Activities"));
    expect(t).toContain(de ? "Beschlüsse des Zeitraums" : "Resolutions of the period");
    expect(t).toContain(rows[0]!.vorschlag.slice(0, 20));
    expect(t).toContain(rows[0]!.titel.split(",")[0]);
    expect(normal(t)).toContain(normal(letzter[0]!.titel));
  });

  it("Quartalsbericht je Beteiligung durch alle Stufen, Datei ohne Wasserzeichen", async () => {
    const { rows } = await db.execute<{ id: string; name: string }>(sql`SELECT be.id, o.name FROM beteiligung be JOIN organisation o ON o.id = be.organisation_id WHERE be.fonds_id = ${fondsId} AND be.status = 'aktiv' AND be.erstinvestment <= '2025-12-31' ORDER BY be.id LIMIT 1`);
    const b = await anlegen({ art: "quartalsbericht", beteiligungId: rows[0]!.id, stichtag: "2025-12-31", sprache });
    expect(b.fondsId).toBe(fondsId);
    const f = await json(await freigeben(b.id));
    expect(f.status).toBe("freigegeben");
    const { text: t, seiten } = await text(await get(`/reports/${b.id}/file`));
    expect(seiten).toBe(1);
    expect(t).toContain(rows[0]!.name.toUpperCase());
    expect(t.toUpperCase()).not.toContain(de ? "ENTWURF" : "DRAFT");
  });
});

describe("Gleichzeitigkeit", () => {
  it("wartet bei einer Berichtsänderung länger als das allgemeine Schreib-Sperrlimit", async () => {
    const b = await anlegen({ art: "lp_bericht", fondsId, sprache: "en" });
    const { antwort } = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM bericht WHERE id = ${b.id} FOR UPDATE`);
      const { rows } = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`);
      const antwort = put(`/reports/${b.id}/sections/foreword`, { textEn: "Neues Vorwort." }, "autor");
      // Die Wartezeit beginnt erst, wenn Postgres die konkurrierende Anfrage als blockiert meldet.
      await expect.poll(async () => {
        const { rows: wartende } = await db.execute<{ blockiert: boolean }>(sql`
          SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE ${rows[0]!.pid} = ANY(pg_blocking_pids(pid))) AS blockiert
        `);
        return wartende[0]?.blockiert;
      }).toBe(true);
      await warte(2200);
      return { antwort };
    });
    expect((await antwort).status).toBe(200);
  });

  it("zwei gleichzeitige Freigaben der letzten Stufe: eine gewinnt, die andere sieht den freigegebenen Bericht", async () => {
    const b = await anlegen({ art: "exitliste", fondsId });
    await stufe(b.id, "Investmentmanager", "a1");
    await stufe(b.id, "Teamleitung", "a2");
    const [x, y] = await Promise.all([stufe(b.id, "Geschäftsführung", "a3"), stufe(b.id, "Geschäftsführung", "a4")]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    const verlierer = await json(x.status === 409 ? x : y);
    expect(verlierer.error.code).toBe("report_status_invalid");
    expect(await s_zeilen("bericht", "freigeben")).toBeGreaterThan(0);
  });

  it("Abschnittsänderung gegen die Freigabe: der Text steht entweder in der Datei oder die Änderung wird abgelehnt", async () => {
    const b = await anlegen({ art: "lp_bericht", fondsId, sprache: "en" });
    await stufe(b.id, "Investmentmanager", "a1");
    await stufe(b.id, "Teamleitung", "a2");
    // Entwurfsstufe ist erreicht (geprueft): Änderung wird ohnehin abgelehnt; nach Rückgabe auf 0 ist sie möglich
    await post(`/reports/${b.id}/stage`, { stufe: "Geschäftsführung", ergebnis: "zurueck", kommentar: "x" }, "a3");
    await post(`/reports/${b.id}/stage`, { stufe: "Teamleitung", ergebnis: "zurueck", kommentar: "y" }, "a2");
    await put(`/reports/${b.id}/sections/foreword`, { textEn: "Erster Stand des Vorworts." }, "autor");
    await stufe(b.id, "Investmentmanager", "a1");
    await stufe(b.id, "Teamleitung", "a2");
    const [frei, abschnitt] = await Promise.all([stufe(b.id, "Geschäftsführung", "a3"), put(`/reports/${b.id}/sections/foreword`, { textEn: "Gleichzeitig geänderter Text." }, "autor")]);
    expect(frei.status).toBe(200);
    const { text: t } = await text(await get(`/reports/${b.id}/file`));
    const zeile = (await json(await get(`/reports/${b.id}`))).abschnitte[0];
    // Der gespeicherte Abschnitt und die freigegebene Datei stimmen immer überein
    expect(t).toContain(zeile.textEn);
    expect([200, 409]).toContain(abschnitt.status);
    expect(zeile.status).toBe("freigegeben");
  });
});

describe.skipIf(process.env.SKIP_PERF === "1")("Performance der Berichte (Demo-Fonds)", () => {
  it("Erzeugung unter 2 s, Freigabe der letzten Stufe unter 3 s", async () => {
    const zeiten: string[] = [];
    const messen = async (name: string, f: () => Response | Promise<Response>) => {
      const t0 = performance.now();
      const antwort = await f();
      await antwort.arrayBuffer();
      const ms = performance.now() - t0;
      zeiten.push(`${name} ${ms.toFixed(0)} ms`);
      return ms;
    };
    for (const [art, format] of [["lp_bericht", "pdf"], ["fondsbericht", "pdf"], ["portfolioliste", "xlsx"], ["portfolioliste", "pdf"], ["exitliste", "xlsx"], ["gremienvorlage", "pdf"]] as const) {
      const b = await anlegen({ art, format, fondsId });
      expect(await messen(`${art}.${format} Entwurf`, () => get(`/reports/${b.id}/file`))).toBeLessThan(2000);
    }
    const b = await anlegen({ art: "lp_bericht", fondsId });
    await stufe(b.id, "Investmentmanager", "p1");
    await stufe(b.id, "Teamleitung", "p2");
    expect(await messen("lp_bericht Freigabe (Kontrolle, Datei, Speicher)", () => stufe(b.id, "Geschäftsführung", "p3"))).toBeLessThan(3000);
    expect(await messen("lp_bericht Download freigegeben", () => get(`/reports/${b.id}/file`))).toBeLessThan(500);
    expect(await messen("Kontrollbericht", () => get(`/reports/${b.id}/checks`))).toBeLessThan(1000);
    console.log(`Performance Berichte (Demo-Fonds): ${zeiten.join("; ")}`);
  });
});

describe("Sicherheitsregeln der Berichtsfreigabe", () => {
  it("Vier-Augen auf jeder Stufe: weder der Ersteller noch ein Bearbeiter von Abschnitten darf eine Stufe erteilen", async () => {
    const b = await anlegen({ art: "lp_bericht", fondsId }, "ersteller");
    await put(`/reports/${b.id}/sections/foreword`, { textDe: "Text" }, "redakteur");
    for (const akteur of ["ersteller", "redakteur"]) {
      const r = await stufe(b.id, "Investmentmanager", akteur);
      expect(r.status, akteur).toBe(409);
      expect((await json(r)).error.code).toBe("four_eyes_violated");
    }
    expect((await stufe(b.id, "Investmentmanager", "pruefer1")).status).toBe(200);
    expect((await stufe(b.id, "Teamleitung", "ersteller")).status).toBe(409);
    expect((await stufe(b.id, "Teamleitung", "pruefer2")).status).toBe(200);
    // auch die letzte Stufe: der Ersteller darf nicht freigeben
    const final = await stufe(b.id, "Geschäftsführung", "ersteller");
    expect(final.status).toBe(409);
    expect((await json(final)).error.code).toBe("four_eyes_violated");
    expect((await stufe(b.id, "Geschäftsführung", "pruefer3")).status).toBe(200);
  });

  it("die Vorlage wird bei der Anlage festgehalten: spätere Änderungen von Vorlage und Stufen betreffen den Bericht nicht", async () => {
    await put(`/funds/${fondsId}/report-templates/lp_report`, { einheit: "EUR", abschnitte: ["kennzahlen", "portfolio"] });
    await put(`/funds/${fondsId}/approval-stages`, { stages: ["Eins", "Zwei"] });
    const b = await anlegen({ art: "lp_bericht", fondsId });
    expect(b.konfiguration).toMatchObject({ einheit: "EUR", abschnitte: ["kennzahlen", "portfolio"] });
    expect(b.freigabestufen).toEqual(["Eins", "Zwei"]);
    await put(`/funds/${fondsId}/report-templates/lp_report`, { einheit: "TEUR", abschnitte: ["kapitalkonten"] });
    await put(`/funds/${fondsId}/approval-stages`, { stages: ["X", "Y", "Z"] });
    const t = (await text(await get(`/reports/${b.id}/file`))).text;
    expect(t).toContain("Kennzahlen des Fonds");
    expect(t).not.toContain("TEUR");
    expect(t).not.toContain("Kapitalkonten der Investoren");
    // der Vorwort-Abschnitt stand nicht in der festgehaltenen Vorlage
    expect((await put(`/reports/${b.id}/sections/foreword`, { textDe: "x" })).status).toBe(409);
    expect((await json(await get(`/reports/${b.id}`))).naechsteStufeName).toBe("Eins");
    expect((await stufe(b.id, "Eins", "p1")).status).toBe(200);
    const fertig = await stufe(b.id, "Zwei", "p2");
    expect(fertig.status).toBe(200);
    expect((await text(await get(`/reports/${b.id}/file`))).text).not.toContain("TEUR");
    await put(`/funds/${fondsId}/report-templates/lp_report`, {});
    await put(`/funds/${fondsId}/approval-stages`, { stages: STUFEN });
  });

  it("der Wissensstand darf nicht in der Zukunft liegen", async () => {
    const morgen = new Date(Date.now() + 86_400_000).toISOString();
    const antwort = await post("/reports", { art: "lp_bericht", fondsId, stand: morgen });
    expect(antwort.status).toBe(400);
    expect((await json(antwort)).error.fields[0]).toMatchObject({ field: "stand", code: "knowledge_date_in_future" });
    expect((await post("/reports", { art: "lp_bericht", fondsId, stand: new Date(Date.now() - 1000).toISOString() })).status).toBe(201);
  });

  it("mindestens zwei Stufen; Vorlagen und Stufen ändern nur Verwalter des Fonds", async () => {
    expect((await put(`/funds/${fondsId}/approval-stages`, { stages: ["Allein"] })).status).toBe(400);
    const verwalter = person("verwalter-bf", { rollen: { [fondsId]: "verwalter" } });
    const freigeber = person("freigeber-bf", { rollen: { [fondsId]: "freigeber" } });
    for (const p of [verwalter, freigeber]) await legePersonAn(db, p);
    for (const [pfad, koerper] of [
      [`/funds/${fondsId}/approval-stages`, { stages: STUFEN }],
      [`/funds/${fondsId}/report-templates/fund_report`, {}],
    ] as const) {
      const nein = await put(pfad, koerper, freigeber);
      expect(nein.status).toBe(403);
      expect((await json(nein)).error.code).toBe("forbidden");
      expect((await put(pfad, koerper, verwalter)).status).toBe(200);
      expect((await put(pfad, koerper)).status).toBe(200); // globale Verwalter sind überall Verwalter
    }
  });
});
