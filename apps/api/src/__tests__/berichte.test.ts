import ExcelJS from "exceljs";
import { sql } from "drizzle-orm";
import { extractText, getDocumentProxy } from "unpdf";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { erzeugeDemodaten, schreibeDemodaten } from "@carraway/db/demo";
import * as s from "@carraway/db";
import { erstelleTestApp } from "./hilfen-auth";
import { json, leeren, oeffneTestdb } from "./hilfen";

const { db, pool } = oeffneTestdb();
const app = erstelleTestApp(db);

const get = (pfad: string) => app.request(`/api/v1${pfad}`);
const WASSER = { de: "ENTWURF", en: "DRAFT" } as const;
let fondsId = "";
let fondsName = "";
let beteiligungId = "";
let beteiligungName = "";
let anzahlBeteiligungen = 0;

async function text(antwort: Response) {
  const dokument = await getDocumentProxy(new Uint8Array(await antwort.arrayBuffer()));
  const { text: t, totalPages } = await extractText(dokument, { mergePages: true });
  return { text: t.replace(/\s+/g, " "), seiten: totalPages };
}

beforeAll(async () => {
  await schreibeDemodaten(db, erzeugeDemodaten({ seed: 1 }));
  const { daten } = await json(await get("/fonds"));
  fondsId = daten[0].id;
  fondsName = daten[0].name;
  const uebersicht = await json(await get(`/fonds/${fondsId}/uebersicht`));
  anzahlBeteiligungen = uebersicht.beteiligungen.length;
  beteiligungId = uebersicht.beteiligungen.find((b: { status: string }) => b.status === "aktiv").id;
  beteiligungName = uebersicht.beteiligungen.find((b: { id: string }) => b.id === beteiligungId).organisation.name;
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

describe.each(["de", "en"] as const)("Berichte (%s)", (sprache) => {
  it("Fondsbericht als PDF: Content-Type, Dateiname, Fondsname, Wasserzeichen", async () => {
    const antwort = await get(`/fonds/${fondsId}/berichte/fondsbericht?sprache=${sprache}&format=pdf`);
    expect(antwort.status).toBe(200);
    expect(antwort.headers.get("Content-Type")).toBe("application/pdf");
    expect(antwort.headers.get("Content-Disposition")).toMatch(/^attachment; filename="[a-z0-9-]+\.pdf"$/);
    const kopie = antwort.clone();
    expect(Buffer.from(await kopie.arrayBuffer()).subarray(0, 5).toString("latin1")).toBe("%PDF-");
    const { text: t, seiten } = await text(antwort);
    expect(t).toContain(fondsName.toUpperCase());
    expect(t).toContain(WASSER[sprache]);
    expect(seiten).toBeGreaterThanOrEqual(3);
  });

  it("Fondsbericht als Excel: Kopfzeile und Zeilenzahl", async () => {
    const antwort = await get(`/fonds/${fondsId}/berichte/fondsbericht?sprache=${sprache}&format=xlsx`);
    expect(antwort.status).toBe(200);
    expect(antwort.headers.get("Content-Type")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(antwort.headers.get("Content-Disposition")).toMatch(/filename="[a-z0-9-]+\.xlsx"/);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await antwort.arrayBuffer()) as ArrayBuffer);
    expect(wb.worksheets).toHaveLength(3);
    const portfolio = wb.getWorksheet("Portfolio")!;
    expect(portfolio.rowCount).toBe(anzahlBeteiligungen + 1);
    expect((portfolio.getRow(1).values as unknown[]).slice(1)[0]).toBe(sprache === "de" ? "Unternehmen" : "Company");
  });

  it("Portfolioliste: ein Blatt", async () => {
    const antwort = await get(`/fonds/${fondsId}/berichte/portfolioliste?sprache=${sprache}`);
    expect(antwort.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await antwort.arrayBuffer()) as ArrayBuffer);
    expect(wb.worksheets).toHaveLength(1);
    expect(wb.worksheets[0]!.rowCount).toBe(anzahlBeteiligungen + 1);
  });

  it("Quartalsbericht: eine Seite mit Name der Beteiligung und Wasserzeichen", async () => {
    const antwort = await get(`/beteiligungen/${beteiligungId}/berichte/quartalsbericht?sprache=${sprache}`);
    expect(antwort.status).toBe(200);
    expect(antwort.headers.get("Content-Type")).toBe("application/pdf");
    expect(antwort.headers.get("Content-Disposition")).toMatch(/filename="[a-z0-9-]+\.pdf"/);
    const { text: t, seiten } = await text(antwort);
    expect(seiten).toBe(1);
    expect(t).toContain(beteiligungName.toUpperCase());
    expect(t).toContain(WASSER[sprache]);
  });

  it("Gremienvorlage: PDF mit Wasserzeichen und den Deals im Investitionsausschuss", async () => {
    const antwort = await get(`/berichte/gremienvorlage?sprache=${sprache}`);
    expect(antwort.status).toBe(200);
    expect(antwort.headers.get("Content-Type")).toBe("application/pdf");
    const { text: t } = await text(antwort);
    expect(t).toContain(WASSER[sprache]);
    const { rows } = await db.execute<{ titel: string }>(sql`SELECT titel FROM deal WHERE phase = 'investitionsausschuss' AND status = 'offen' LIMIT 1`);
    if (rows[0]) expect(t).toContain(rows[0].titel.slice(0, 12));
  });
});

describe("Berichte: Wissensstand und Fehler", () => {
  it("der Wissensstand erscheint im Bericht", async () => {
    const antwort = await get(`/fonds/${fondsId}/berichte/fondsbericht?sprache=de&stand=2026-06-01T12:00:00Z&stichtag=2025-12-31`);
    const { text: t } = await text(antwort);
    expect(t).toContain("01.06.2026");
    expect(t).toContain("31.12.2025");
  });

  it("unbekannter Fonds und unbekannte Beteiligung: 404; ungültige Eingaben: 400", async () => {
    const fremd = "00000000-0000-4000-8000-0000000000ff";
    expect((await get(`/fonds/${fremd}/berichte/fondsbericht`)).status).toBe(404);
    expect((await get(`/beteiligungen/${fremd}/berichte/quartalsbericht`)).status).toBe(404);
    expect((await get(`/fonds/${fondsId}/berichte/fondsbericht?sprache=fr`)).status).toBe(400);
    expect((await get(`/fonds/${fondsId}/berichte/fondsbericht?format=docx`)).status).toBe(400);
    expect((await get(`/beteiligungen/${beteiligungId}/berichte/quartalsbericht?format=xlsx`)).status).toBe(400);
    expect((await get(`/berichte/gremienvorlage?stichtag=heute`)).status).toBe(400);
  });

  it("Gremienvorlage ohne Deals im Ausschuss ist ein gültiges PDF", async () => {
    await db.execute(sql`UPDATE deal SET phase = 'anfrage' WHERE phase = 'investitionsausschuss'`);
    const antwort = await get("/berichte/gremienvorlage");
    expect(antwort.status).toBe(200);
    expect((await text(antwort)).text).toContain("Investitionsausschuss");
  });

  it("Datenwerte mit Sonderzeichen setzen keinen Typst-Code ab", async () => {
    await db.update(s.organisation).set({ name: 'Quote "x" #panic() $ \\ [ ] Test' }).where(sql`id = (SELECT organisation_id FROM beteiligung WHERE id = ${beteiligungId})`);
    const antwort = await get(`/beteiligungen/${beteiligungId}/berichte/quartalsbericht`);
    expect(antwort.status).toBe(200);
    expect((await text(antwort)).text).toContain('QUOTE "X" #PANIC() $ \\ [ ] TEST');
  });
});

describe.skipIf(process.env.SKIP_PERF === "1")("Performance: Fondsbericht als PDF", () => {
  it("unter 2 s für den Demo-Fonds", async () => {
    const url = `/fonds/${fondsId}/berichte/fondsbericht?sprache=de&format=pdf`;
    const kalt = performance.now();
    await (await get(url)).arrayBuffer();
    const kaltMs = performance.now() - kalt;
    const zeiten: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      await (await get(url)).arrayBuffer();
      zeiten.push(performance.now() - t0);
    }
    const sortiert = [...zeiten].sort((a, b) => a - b);
    console.log(`Performance Fondsbericht-PDF (${anzahlBeteiligungen} Beteiligungen): erster Aufruf ${kaltMs.toFixed(0)} ms, Median ${sortiert[2]!.toFixed(0)} ms, max ${sortiert.at(-1)!.toFixed(0)} ms`);
    expect(kaltMs).toBeLessThan(2000);
    expect(sortiert[2]!).toBeLessThan(2000);
  });
});
