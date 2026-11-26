import { access, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { renderPageAsImage, getDocumentProxy } from "unpdf";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setzePdf } from "@carraway/berichte";
import * as s from "@carraway/db";
import { DateiSpeicher } from "../berichte/speicher";
import { loescheAbgelaufeneDokumente } from "../dokumente/aufbewahrung";
import { IsolierterErkenner } from "../dokumente/isoliert";
import { MAX_VERSUCHE, verarbeiteOfficeTexte, verarbeiteTexterkennung } from "../dokumente/nachverarbeitung";
import { bildMasse, ladeOcrKonfiguration } from "../dokumente/ocr";
import { json, leeren, oeffneTestdb } from "./hilfen";
import { erstelleTestApp, legePersonAn, person, type TestApp } from "./hilfen-auth";
import { erzeugeDocxMitText, legeWeltAn, zaehleZeilen, type Welt } from "./hilfen-dokumente";

/**
 * Nachverarbeitung des Textes im Worker: Office-Auszug in einem Thread mit hartem Zeitlimit, Wiederholung nur nach Absturz, nichts für gelöschte
 * Dokumente; lokale Texterkennung (OCR) an einem erfundenen Scan. Alle Daten sind erfunden.
 */

const { db, pool } = oeffneTestdb();
let verzeichnis = "";
let speicher: DateiSpeicher;
let t: TestApp;
let w: Welt;
const BEARB1 = person("nv-bearb1");
const VERWALTER1 = person("nv-verw1");

beforeAll(async () => {
  verzeichnis = await mkdtemp(join(tmpdir(), "carraway-nachverarbeitung-"));
  speicher = new DateiSpeicher(verzeichnis);
  t = erstelleTestApp(db, { speicher });
});
beforeEach(async () => {
  await leeren(db);
  w = await legeWeltAn(db);
  Object.assign(BEARB1, { rollen: { [w.fonds1]: "bearbeiter" } });
  Object.assign(VERWALTER1, { rollen: { [w.fonds1]: "verwalter" } });
  for (const p of [BEARB1, VERWALTER1]) await legePersonAn(db, p);
});
afterEach(() => {
  delete process.env.OCR;
  vi.unstubAllGlobals();
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
  await rm(verzeichnis, { recursive: true, force: true });
});

function hochladen(bytes: Uint8Array, name: string) {
  const f = new FormData();
  f.append("datei", new File([new Uint8Array(bytes)], name));
  f.append("ziele", JSON.stringify([{ typ: "beteiligung", id: w.beteiligung1 }]));
  return t.request("/documents", { method: "POST", body: f, als: BEARB1 });
}
async function lege(bytes: Uint8Array, name: string) {
  const antwort = await hochladen(bytes, name);
  expect(antwort.status, await antwort.clone().text()).toBe(201);
  return (await json(antwort)) as { id: string; textStatus: string };
}
const zeile = async (id: string) => (await db.select().from(s.dokument).where(eq(s.dokument.id, id)))[0]!;
const seitenVon = async (id: string) => (await db.execute(sql`SELECT seite, text, quelle, konfidenz FROM dokument_seite WHERE dokument_id = ${id} ORDER BY seite`)).rows as { seite: number; text: string; quelle: string; konfidenz: number | null }[];

describe("Office-Auszug im Worker: Zeitlimit, Versuche, gelöschte Dokumente", () => {
  it("ein Zeitlimit beendet den Thread und setzt das Dokument auf fehler, ohne es erneut einzureihen", async () => {
    const d = await lege(erzeugeDocxMitText(["Text eines Dokuments, das zu lange dauert."]), "langsam.docx");
    const lauf = await verarbeiteOfficeTexte(db, speicher, { zeitlimitMs: 1 });
    expect(lauf).toEqual({ verarbeitet: 0, fehler: 1 });
    expect((await zeile(d.id)).textStatus).toBe("fehler");
    expect((await zeile(d.id)).textVersuche).toBe(1);
    expect(await verarbeiteOfficeTexte(db, speicher)).toEqual({ verarbeitet: 0, fehler: 0 });
    expect(await zaehleZeilen(db, "dokument_seite")).toBe(0);
  });

  it("ein Lesefehler ergibt fehler; ein Absturz mitten im Lauf wird nach der Frist wiederholt und endet nach der Höchstzahl der Versuche als fehler", async () => {
    const d = await lege(erzeugeDocxMitText(["Inhalt für den Abbruchtest."]), "abbruch.docx");
    // Der Lauf, in dem der Worker stirbt, hinterlässt Beginn und Versuchszahl; innerhalb der Frist nimmt ihn niemand auf.
    await db.update(s.dokument).set({ textVersuche: 1, textBegonnenAm: new Date() }).where(eq(s.dokument.id, d.id));
    expect(await verarbeiteOfficeTexte(db, speicher)).toEqual({ verarbeitet: 0, fehler: 0 });
    // Nach der Frist: nächster Versuch (Zähler steigt), das Ergebnis wird geschrieben
    await db.update(s.dokument).set({ textBegonnenAm: new Date(Date.now() - 3_600_000) }).where(eq(s.dokument.id, d.id));
    expect(await verarbeiteOfficeTexte(db, speicher)).toEqual({ verarbeitet: 1, fehler: 0 });
    expect((await zeile(d.id)).textVersuche).toBe(2);
    // Ein Dokument, das schon die Höchstzahl an Versuchen hinter sich hat, wird nicht noch einmal gelesen
    const e = await lege(erzeugeDocxMitText(["Zweiter Inhalt."]), "abbruch2.docx");
    await db.update(s.dokument).set({ textVersuche: MAX_VERSUCHE, textBegonnenAm: new Date(Date.now() - 3_600_000) }).where(eq(s.dokument.id, e.id));
    expect(await verarbeiteOfficeTexte(db, speicher)).toEqual({ verarbeitet: 0, fehler: 0 });
    expect((await zeile(e.id)).textStatus).toBe("fehler");
    expect(await seitenVon(e.id)).toEqual([]);
    // Lesefehler der Ausführung
    const f = await lege(erzeugeDocxMitText(["Dritter Inhalt."]), "kaputt.docx");
    const lauf = await verarbeiteOfficeTexte(db, speicher, { ausfuehren: () => Promise.reject(new Error("kaputt")) });
    expect(lauf).toEqual({ verarbeitet: 0, fehler: 1 });
    expect((await zeile(f.id)).textStatus).toBe("fehler");
  });

  it("gelöschte Dokumente werden nicht ausgelesen; wird eines während des Lesens gelöscht, wird kein Text zurückgeschrieben", async () => {
    const a = await lege(erzeugeDocxMitText(["Dokument, das vor dem Lauf gelöscht wird."]), "a.docx");
    expect((await t.request(`/documents/${a.id}`, { method: "DELETE", als: VERWALTER1 })).status).toBe(204);
    expect(await verarbeiteOfficeTexte(db, speicher)).toEqual({ verarbeitet: 0, fehler: 0 });
    expect((await zeile(a.id)).textStatus).toBe("ausstehend");

    const b = await lege(erzeugeDocxMitText(["Dokument, das während des Lesens gelöscht wird."]), "b.docx");
    const lauf = await verarbeiteOfficeTexte(db, speicher, {
      ausfuehren: async (art, bytes, ms) => {
        const { extrahiereOfficeIsoliert } = await import("../dokumente/isoliert");
        const auszug = await extrahiereOfficeIsoliert(art, bytes, ms);
        expect((await t.request(`/documents/${b.id}`, { method: "DELETE", als: VERWALTER1 })).status).toBe(204);
        return auszug;
      },
    });
    expect(lauf).toEqual({ verarbeitet: 0, fehler: 0 });
    expect(await seitenVon(b.id)).toEqual([]);
  });

  it("der Aufbewahrungslauf setzt beim endgültigen Löschen einen Endstand des Textes", async () => {
    const d = await lege(erzeugeDocxMitText(["Dokument für die Aufbewahrung."]), "c.docx");
    expect((await t.request(`/documents/${d.id}`, { method: "DELETE", als: VERWALTER1 })).status).toBe(204);
    const ergebnis = await loescheAbgelaufeneDokumente(db, speicher, { tage: 30, jetzt: () => new Date(Date.now() + 40 * 86_400_000) });
    expect(ergebnis.dokumente).toBe(1);
    const z = await zeile(d.id);
    expect([z.status, z.textStatus]).toEqual(["endgueltig_geloescht", "kein_text"]);
    expect(await verarbeiteOfficeTexte(db, speicher)).toEqual({ verarbeitet: 0, fehler: 0 });
  });
});

// Texterkennung ---------------------------------------------------------------------------------------------------

/** Erfundener Text in großer Schrift, damit die Erkennung stabil ist. */
const ZEILEN = ["Rechnung 4711 vom 3. Maerz 2026", "Gesamtbetrag 1234 Euro netto", "Zahlbar innerhalb von 14 Tagen"];
const seiteTypst = (zeilen: string[]) => `#set page(width: 21cm, height: 12cm, margin: 1.5cm)\n#set text(font: "Instrument Sans", size: 24pt)\n${zeilen.map((z) => `${z}\\`).join("\n")}\n`;

async function pngMitText(zeilen: string[]): Promise<Uint8Array> {
  const pdf = setzePdf(seiteTypst(zeilen));
  return renderPageAsImage(await getDocumentProxy(new Uint8Array(pdf)), 1, { canvasImport: () => import("@napi-rs/canvas"), scale: 2 });
}
/** Ein PDF, das nur aus Bildern besteht (ohne Textebene), wie ein Scan. */
function scanPdf(pngs: Uint8Array[]): Uint8Array {
  const seiten = pngs.map((p) => `#image(bytes((${[...p].join(",")})), width: 100%)`);
  return setzePdf(`#set page(width: 21cm, height: 12cm, margin: 0cm)\n${seiten.join("\n#pagebreak()\n")}\n`);
}

describe("Lokale Texterkennung", () => {
  const konf = () => ladeOcrKonfiguration({ OCR: "lokal", OCR_MAX_SEITEN: "5", OCR_ZEITLIMIT_SEKUNDEN: "120" });
  const erkenner = new IsolierterErkenner();

  it("ist ohne OCR=lokal aus: ein Scan bleibt kein_text, ein Bild nicht_unterstuetzt", async () => {
    const png = await pngMitText(ZEILEN);
    expect((await lege(scanPdf([png]), "scan.pdf")).textStatus).toBe("kein_text");
    expect((await lege(png, "foto.png")).textStatus).toBe("nicht_unterstuetzt");
    expect(await verarbeiteTexterkennung(db, speicher, erkenner, konf())).toEqual({ verarbeitet: 0, kein_text: 0, fehler: 0 });
  });

  it("erkennt Scan und Bild lokal, speichert Seitentext mit quelle ocr und Sicherheit, findet ihn in der Suche; ohne Netz und ohne Zwischenspeicher", async () => {
    process.env.OCR = "lokal";
    vi.stubGlobal("fetch", () => Promise.reject(new Error("Netzzugriff ist in diesem Test nicht erlaubt")));
    const png = await pngMitText(ZEILEN);
    const scan = await lege(scanPdf([png]), "scan.pdf");
    const bild = await lege(png, "foto.png");
    expect([scan.textStatus, bild.textStatus]).toEqual(["ocr_ausstehend", "ocr_ausstehend"]);
    expect(await zaehleZeilen(db, "dokument_seite")).toBe(0);

    const lauf = await verarbeiteTexterkennung(db, speicher, erkenner, konf(), { max: 5 });
    expect(lauf).toEqual({ verarbeitet: 2, kein_text: 0, fehler: 0 });
    for (const id of [scan.id, bild.id]) {
      const z = await zeile(id);
      expect([z.textStatus, z.seitenzahl]).toEqual(["vorhanden", 1]);
      const seiten = await seitenVon(id);
      expect(seiten).toHaveLength(1);
      expect(seiten[0]!.quelle).toBe("ocr");
      expect(seiten[0]!.konfidenz).toBeGreaterThan(50);
      expect(seiten[0]!.text).toContain("4711");
      expect(seiten[0]!.text).toMatch(/Gesamtbetrag/i);
    }
    const treffer = await json(await t.request("/documents/search?q=Gesamtbetrag", { als: BEARB1 }));
    expect(treffer.daten).toHaveLength(2);
    expect(treffer.daten.every((x: { quelle: string }) => x.quelle === "ocr")).toBe(true);
    const seite = await json(await t.request(`/documents/${scan.id}/pages/1`, { als: BEARB1 }));
    expect(seite).toMatchObject({ quelle: "ocr" });
    expect(seite.konfidenz).toBeGreaterThan(50);
    // Es gibt keinen Zwischenspeicher der Sprachdaten im Arbeitsverzeichnis
    expect((await readdir(process.cwd())).filter((n) => n.endsWith(".traineddata") || n.endsWith(".traineddata.gz"))).toEqual([]);
    expect(await access(join(process.cwd(), "eng.traineddata")).then(() => true, () => false)).toBe(false);
    // Das Protokoll hält fest, dass erkannt wurde, nie den Text
    const { rows } = await db.execute<{ nachher: Record<string, unknown> }>(sql`SELECT nachher FROM aenderung WHERE aktion = 'texterkennung' AND datensatz_id = ${scan.id}`);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0]!.nachher)).not.toContain("4711");
  });

  it("Seitengrenze und Zeitlimit enden als fehler; ein leeres Bild ergibt kein_text", async () => {
    process.env.OCR = "lokal";
    const png = await pngMitText(ZEILEN);
    const zwei = await lege(scanPdf([png, png]), "zwei.pdf");
    expect(await verarbeiteTexterkennung(db, speicher, erkenner, { ...konf(), maxSeiten: 1 })).toEqual({ verarbeitet: 0, kein_text: 0, fehler: 1 });
    expect((await zeile(zwei.id)).textStatus).toBe("fehler");
    expect(await seitenVon(zwei.id)).toEqual([]);

    const langsam = await lege(scanPdf([png]), "langsam.pdf");
    expect(await verarbeiteTexterkennung(db, speicher, erkenner, { ...konf(), zeitlimitMs: 1 })).toEqual({ verarbeitet: 0, kein_text: 0, fehler: 1 });
    expect((await zeile(langsam.id)).textStatus).toBe("fehler");

    const leer = await lege(await pngMitText(["."]), "leer.png");
    expect(await verarbeiteTexterkennung(db, speicher, erkenner, konf())).toEqual({ verarbeitet: 0, kein_text: 1, fehler: 0 });
    expect((await zeile(leer.id)).textStatus).toBe("kein_text");
  });

  it("Texterkennung für ein vorhandenes Dokument anfordern: nur mit OCR=lokal, nur wo sie nötig ist, wiederholbar", async () => {
    const png = await pngMitText(ZEILEN);
    const scan = await lege(scanPdf([png]), "alt.pdf");
    expect(scan.textStatus).toBe("kein_text");
    const anfordern = (id: string) => t.request(`/documents/${id}/ocr`, { method: "POST", als: BEARB1 });
    const aus = await anfordern(scan.id);
    expect(aus.status).toBe(409);
    expect((await json(aus)).error.code).toBe("ocr_disabled");

    process.env.OCR = "lokal";
    const ok = await anfordern(scan.id);
    expect(ok.status).toBe(200);
    expect((await json(ok)).textStatus).toBe("ocr_ausstehend");
    expect((await anfordern(scan.id)).status).toBe(200);
    const text = await lege(setzePdf(seiteTypst(["Dieses PDF hat eine Textebene und braucht keine Texterkennung."])), "text.pdf");
    expect(text.textStatus).toBe("vorhanden");
    const unnoetig = await anfordern(text.id);
    expect(unnoetig.status).toBe(409);
    expect((await json(unnoetig)).error.code).toBe("ocr_not_possible");
    const betrachter = person("nv-betr1", { rollen: { [w.fonds1]: "betrachter" } });
    await legePersonAn(db, betrachter);
    expect((await t.request(`/documents/${scan.id}/ocr`, { method: "POST", als: betrachter })).status).toBe(403);
    expect(await verarbeiteTexterkennung(db, speicher, erkenner, konf())).toEqual({ verarbeitet: 1, kein_text: 0, fehler: 0 });
    expect((await zeile(scan.id)).textStatus).toBe("vorhanden");
  });

  it("Speicherschutz: eine riesige Seite (MediaBox) und ein Bild mit gefälschten Maßen werden abgelehnt, bevor etwas gerendert oder dekodiert wird", async () => {
    process.env.OCR = "lokal";
    const riesig = setzePdf(`#set page(width: 400cm, height: 400cm, margin: 0cm)\n#rect(width: 1cm, height: 1cm, fill: gray)\n`);
    const seite = await lege(riesig, "riesig.pdf");
    expect(seite.textStatus).toBe("ocr_ausstehend");
    // Ein echtes PNG, dessen Kopf (IHDR) 60000 x 60000 Pixel behauptet
    const gefaelscht = Buffer.from(await pngMitText(ZEILEN));
    gefaelscht.writeUInt32BE(60_000, 16);
    gefaelscht.writeUInt32BE(60_000, 20);
    const bild = await lege(gefaelscht, "gefaelscht.png");
    const start = performance.now();
    expect(await verarbeiteTexterkennung(db, speicher, erkenner, konf(), { max: 5 })).toEqual({ verarbeitet: 0, kein_text: 0, fehler: 2 });
    expect(performance.now() - start).toBeLessThan(20_000);
    expect((await zeile(seite.id)).textStatus).toBe("fehler");
    expect((await zeile(bild.id)).textStatus).toBe("fehler");
    const { rows } = await db.execute<{ nachher: { grund?: string } }>(sql`SELECT nachher FROM aenderung WHERE aktion = 'texterkennung' ORDER BY id`);
    expect(rows.map((r) => r.nachher.grund)).toEqual(["zu_gross", "zu_gross"]);
  });

  it("Bildmaße aus PNG- und JPEG-Kopf; ein JPEG mit gefälschten Maßen oder ein Kopf ohne Maße wird nicht durchgelassen", () => {
    const png = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]).copy(png);
    png.write("IHDR", 12, "latin1");
    png.writeUInt32BE(800, 16);
    png.writeUInt32BE(600, 20);
    expect(bildMasse(png)).toEqual({ breite: 800, hoehe: 600 });
    // JPEG: SOI, APP0 (Länge 16), SOF0 mit Höhe 50000 und Breite 40000
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(14), Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0xc3, 0x50, 0x9c, 0x40, 0x03]), Buffer.alloc(20)]);
    expect(bildMasse(jpeg)).toEqual({ breite: 40_000, hoehe: 50_000 });
    expect(bildMasse(Buffer.from([0xff, 0xd8, 0xff, 0xd9]))).toBeNull();
    expect(bildMasse(Buffer.from("kein Bild"))).toBeNull();
  });
});
