import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { beispielZeilen } from "@carraway/import/beispiel";
import { erzeugeMappe } from "@carraway/import";
import { json, leeren, oeffneTestdb } from "./hilfen";
import { erstelleTestApp, person } from "./hilfen-auth";
import { lastfaktor } from "./hilfen-leistung";

const { db, pool } = oeffneTestdb();
const t = erstelleTestApp(db);
const ANNA = person("import-leistung-anna", { globalVerwalter: true });
const BERTA = person("import-leistung-berta", { globalVerwalter: true });

/**
 * Leistung des Imports mit einer Excel-Datei von rund 10.000 Zeilen (Datenzeilen über alle Blätter), erzeugt aus dem Generator der
 * Demo-Daten: hochladen, prüfen, übernehmen. Budgets (vorläufig, mit Reserve zur Messung auf dem Entwicklungsrechner):
 * Prüfen unter 3 s, Übernehmen unter 10 s (gemessen: rund 0,3 s und 1,4 s). Die Budgets gelten mal `lastfaktor()` (1 im Normalzustand, siehe `hilfen-leistung.ts`). Mit SKIP_PERF=1 überspringen, z. B. auf langsamen Runnern.
 */
const ZEILEN_ZIEL = 10_000;
const BUDGET_PRUEFEN_MS = 3_000;
const BUDGET_UEBERNEHMEN_MS = 10_000;

describe.skipIf(process.env.SKIP_PERF === "1")("Import einer Datei mit rund 10.000 Zeilen", () => {
  beforeAll(async () => {
    await leeren(db);
  });
  afterAll(async () => {
    await leeren(db);
    await pool.end();
  });

  it(`hochladen, prüfen und übernehmen innerhalb der Budgets (Prüfen ${BUDGET_PRUEFEN_MS} ms, Übernehmen ${BUDGET_UEBERNEHMEN_MS} ms)`, async () => {
    const zeilen = beispielZeilen({ seed: 11, umfang: { beteiligungen: 390, deals: 10, fonds: 5 } });
    // Der Generator erzeugt viele ähnliche Namen; die Prüfung meldet sie als Dubletten, hier ausdrücklich bestätigt.
    for (const z of zeilen.organisationen ?? []) z.dublette_bestaetigt = "ja";
    // Der Generator hängt bei `zahlungen` Zinszahlungen an jede Beteiligung, auch an solche ohne Zinsen; die Importregeln lehnen das ab.
    const summe = Object.values(zeilen).reduce((n, blatt) => n + (blatt?.length ?? 0), 0);
    expect(summe).toBeGreaterThan(ZEILEN_ZIEL * 0.9);
    expect(summe).toBeLessThan(ZEILEN_ZIEL * 1.5);
    const erzeugt = performance.now();
    const datei = await erzeugeMappe("de", zeilen);
    const tErzeugen = performance.now() - erzeugt;

    const form = new FormData();
    form.append("datei", new File([new Uint8Array(datei)], "leistung.xlsx"));
    const t0 = performance.now();
    const hoch = await t.request("/import/laeufe", { method: "POST", body: form, als: ANNA });
    expect(hoch.status).toBe(201);
    const id = (await json(hoch)).id as string;
    const tHochladen = performance.now() - t0;

    const t1 = performance.now();
    const gepruefte = await json(await t.request(`/import/laeufe/${id}/pruefen`, { method: "POST", als: ANNA }));
    const tPruefen = performance.now() - t1;
    if (gepruefte.fehlerAnzahl !== 0) {
      const b = (await json(await t.request(`/import/laeufe/${id}/befunde?limit=1000&schweregrad=fehler`, { als: ANNA }))).daten as { code: string; blatt: string; meldung: string }[];
      const je = new Map<string, number>();
      for (const x of b) je.set(`${x.blatt}/${x.code}: ${x.meldung}`, (je.get(`${x.blatt}/${x.code}: ${x.meldung}`) ?? 0) + 1);
      console.log([...je].slice(0, 8));
    }
    expect(gepruefte.fehlerAnzahl).toBe(0);

    const t2 = performance.now();
    const antwort = await t.request(`/import/laeufe/${id}/uebernehmen`, { method: "POST", als: BERTA });
    const tUebernehmen = performance.now() - t2;
    expect(antwort.status, await antwort.clone().text()).toBe(200);

    const vorgaenge = ((await db.execute(sql`SELECT count(*)::int AS n FROM vorgang`)).rows[0] as { n: number }).n;
    console.log(
      `Import ${summe} Zeilen (${(datei.length / 1024 / 1024).toFixed(1)} MB, ${vorgaenge} Vorgänge): Datei erzeugen ${tErzeugen.toFixed(0)} ms, hochladen ${tHochladen.toFixed(0)} ms, prüfen ${tPruefen.toFixed(0)} ms, übernehmen ${tUebernehmen.toFixed(0)} ms`,
    );
    const faktor = lastfaktor();
    expect(tPruefen, `Lastfaktor ${faktor.toFixed(2)}`).toBeLessThan(BUDGET_PRUEFEN_MS * faktor);
    expect(tUebernehmen, `Lastfaktor ${faktor.toFixed(2)}`).toBeLessThan(BUDGET_UEBERNEHMEN_MS * faktor);
  }, 180_000);
});
