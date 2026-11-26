import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { erzeugeDemodaten, schreibeDemodaten } from "@carraway/db/demo";
import { erstelleTestApp } from "./hilfen-auth";
import { verarbeiteNeuberechnung } from "../jobs";
import { json, leeren, oeffneTestdb } from "./hilfen";
import { lastfaktor, median, messeInRunden, perzentil } from "./hilfen-leistung";

const { db, pool } = oeffneTestdb();
const app = erstelleTestApp(db);

const p95 = (werte: number[]) => perzentil(werte, 0.95);

/**
 * Referenzdatensatz (Performance-Regel 2 in TECH-STACK.md): 5 Fonds, 500 Beteiligungen, rund 100.000 Zahlungen. Budgets:
 * Übersicht p95 unter 100 ms (aus dem Snapshot), Neuberechnung eines Fonds unter 1 s, Fondsbericht als PDF unter 2 s.
 * Die Messungen laufen in bis zu drei Runden, es zählt die beste (`hilfen-leistung.ts`; Lastspitzen der Maschine sind keine Verschlechterung).
 * Die Zahlen werden ausgegeben und am Ende mit den Budgets verglichen. Mit SKIP_PERF=1 überspringen, z. B. auf langsamen Runnern.
 * Nicht messbar in diesem Test: Seitenwechsel aus dem Cache (Oberfläche). Der Import einer Datei mit rund 10.000 Zeilen hat
 * seinen eigenen Messtest (`import-leistung.test.ts`).
 */
const ZAHLUNGEN = 100_000;
const ergebnis: Record<string, string> = {};

describe.skipIf(process.env.SKIP_PERF === "1")("Referenzdatensatz: 5 Fonds, 500 Beteiligungen, 100.000 Zahlungen", () => {
  const fonds: { id: string; name: string }[] = [];

  beforeAll(async () => {
    const t0 = performance.now();
    await schreibeDemodaten(db, erzeugeDemodaten({ seed: 1, umfang: { beteiligungen: 500, deals: 600, fonds: 5, zahlungen: ZAHLUNGEN } }));
    await db.execute(sql`ANALYZE`);
    const zahlen = (await db.execute<{ vorgang: number; bewertung: number; bewegung: number; beteiligung: number }>(sql`
      SELECT (SELECT count(*)::int FROM vorgang) AS vorgang, (SELECT count(*)::int FROM bewertung) AS bewertung,
             (SELECT count(*)::int FROM fonds_bewegung) AS bewegung, (SELECT count(*)::int FROM beteiligung) AS beteiligung`)).rows[0];
    console.log(`Referenzdatensatz geschrieben in ${(performance.now() - t0).toFixed(0)} ms: ${JSON.stringify(zahlen)}`);
    expect(zahlen?.vorgang).toBeGreaterThanOrEqual(ZAHLUNGEN);
    ergebnis["Datensatz"] = `${zahlen?.beteiligung} Beteiligungen, ${zahlen?.vorgang} Vorgänge (davon ${ZAHLUNGEN} zusätzliche Zahlungen), ${zahlen?.bewertung} Bewertungen`;
    const liste = await app.requestApi("/api/v1/funds");
    expect(liste.status).toBe(200);
    const { data } = await json(liste);
    expect(data).toHaveLength(5);
    fonds.push(...data);
  }, 300_000);
  afterAll(async () => {
    console.log(`\nReferenzdatensatz, Ergebnis gegen die Budgets aus TECH-STACK.md:\n${Object.entries(ergebnis).map(([k, v]) => `  ${k}: ${v}`).join("\n")}`);
    await leeren(db);
    await pool.end();
  });

  it("Neuberechnung eines Fonds unter 1 s, alle Snapshots danach vorhanden", async () => {
    const messung = await messeInRunden(
      async () => {
        const zeiten: number[] = [];
        for (const f of fonds) {
          const t0 = performance.now();
          const stichtage = await verarbeiteNeuberechnung(db, { fondsId: f.id, stichtag: null });
          zeiten.push(performance.now() - t0);
          expect(stichtage.length).toBeGreaterThanOrEqual(1);
        }
        return zeiten;
      },
      (z) => Math.max(...z),
      1000,
    );
    const zeiten = messung.zeiten;
    const anzahl = Number((await db.execute(sql`SELECT count(*)::int AS n FROM kennzahl_snapshot`)).rows[0]?.n);
    console.log(`Neuberechnung je Fonds (ms): ${zeiten.map((z) => z.toFixed(0)).join(", ")}; Snapshots: ${anzahl}`);
    ergebnis["Neuberechnung je Fonds (Budget unter 1 s)"] = `Maximum ${Math.max(...zeiten).toFixed(0)} ms, Werte ${zeiten.map((z) => z.toFixed(0)).join(", ")} ms`;
    expect(messung.wert, `Maximum je Runde: ${messung.runden.map((r) => r.toFixed(0)).join(", ")} ms, Lastfaktor ${messung.lastfaktor.toFixed(2)}`).toBeLessThan(messung.grenze);
    expect(anzahl).toBeGreaterThanOrEqual(5);
  });

  it("Übersicht aus dem Snapshot: p95 der Serverzeit unter 100 ms", async () => {
    let groesster = 0;
    const messung = await messeInRunden(
      async () => {
        const zeiten: number[] = [];
        for (const f of fonds) {
          await app.requestApi(`/api/v1/funds/${f.id}/overview`); // Aufwärmen
          for (let i = 0; i < 20; i++) {
            const antwort = await app.requestApi(`/api/v1/funds/${f.id}/overview`);
            expect(antwort.status).toBe(200);
            const koerper = await json(antwort);
            expect(koerper.snapshot).not.toBeNull();
            groesster = Math.max(groesster, koerper.investments.length);
            zeiten.push(Number(/dur=([\d.]+)/.exec(antwort.headers.get("Server-Timing") ?? "")?.[1]));
          }
        }
        return zeiten;
      },
      p95,
      100,
    );
    const zeiten = messung.zeiten;
    const wert = p95(zeiten);
    console.log(`Übersicht (Snapshot, bis ${groesster} Beteiligungen je Fonds): p95 ${wert.toFixed(1)} ms, Median ${median(zeiten)} ms, max ${Math.max(...zeiten)} ms (${zeiten.length} Messungen)`);
    ergebnis["Übersicht aus dem Snapshot (Budget p95 unter 100 ms)"] = `p95 ${wert.toFixed(1)} ms (${zeiten.length} Messungen)`;
    expect(wert, `p95 je Runde: ${messung.runden.join(", ")} ms, Lastfaktor ${messung.lastfaktor.toFixed(2)}`).toBeLessThan(messung.grenze);
  });

  it("Journal: erste Seite (100 Zeilen, mit Summen) p95 der Serverzeit unter 100 ms", async () => {
    let zeilen = 0;
    const messung = await messeInRunden(
      async () => {
        const zeiten: number[] = [];
        for (const f of fonds) {
          await app.requestApi(`/api/v1/funds/${f.id}/journal?limit=100`); // Aufwärmen
          for (let i = 0; i < 20; i++) {
            const antwort = await app.requestApi(`/api/v1/funds/${f.id}/journal?limit=100`);
            expect(antwort.status).toBe(200);
            const koerper = await json(antwort);
            expect(koerper.data).toHaveLength(100);
            expect(koerper.totals.total.count).toBeGreaterThan(100);
            zeilen = Math.max(zeilen, koerper.totals.total.count);
            zeiten.push(Number(/dur=([\d.]+)/.exec(antwort.headers.get("Server-Timing") ?? "")?.[1]));
          }
        }
        return zeiten;
      },
      p95,
      100,
    );
    const zeiten = messung.zeiten;
    const wert = p95(zeiten);
    console.log(`Journal (erste Seite, bis ${zeilen} Zeilen je Fonds): p95 ${wert.toFixed(1)} ms, Median ${median(zeiten)} ms, max ${Math.max(...zeiten)} ms (${zeiten.length} Messungen)`);
    ergebnis["Journal, erste Seite (Budget p95 unter 100 ms)"] = `p95 ${wert.toFixed(1)} ms (${zeiten.length} Messungen, bis ${zeilen} Zeilen je Fonds)`;
    // Die Serverzeit kommt ungekürzt aus dem Header (eine Nachkommastelle, keine Obergrenze); die Meldung nennt den echten Wert.
    expect(wert, `Journal p95 je Runde: ${messung.runden.join(", ")} ms, Lastfaktor ${messung.lastfaktor.toFixed(2)}, Median ${median(zeiten)} ms, Werte ${zeiten.join(", ")}`).toBeLessThan(messung.grenze);
  });

  it("Fondsbericht als PDF unter 2 s (größter Fonds)", async () => {
    const jeFonds = (await db.execute<{ fonds_id: string; n: number }>(sql`SELECT fonds_id, count(*)::int AS n FROM beteiligung GROUP BY fonds_id ORDER BY n DESC LIMIT 1`)).rows[0]!;
    const url = `/api/v1/funds/${jeFonds.fonds_id}/reports/fund-report?language=de&format=pdf`;
    const zeit = async () => {
      const t0 = performance.now();
      const antwort = await app.requestApi(url);
      expect(antwort.status).toBe(200);
      expect((await antwort.arrayBuffer()).byteLength).toBeGreaterThan(1000);
      return performance.now() - t0;
    };
    const kalt = await zeit();
    const warm = [await zeit(), await zeit(), await zeit(), await zeit(), await zeit()].sort((a, b) => a - b);
    console.log(`Fondsbericht-PDF (${jeFonds.n} Beteiligungen): erster Aufruf ${kalt.toFixed(0)} ms, Median ${warm[2]!.toFixed(0)} ms, max ${warm[4]!.toFixed(0)} ms`);
    ergebnis["Fondsbericht als PDF (Budget unter 2 s)"] = `erster Aufruf ${kalt.toFixed(0)} ms, Median ${warm[2]!.toFixed(0)} ms (${jeFonds.n} Beteiligungen)`;
    const grenze = 2000 * lastfaktor();
    expect(kalt, `erster Aufruf, Grenze ${grenze.toFixed(0)} ms`).toBeLessThan(grenze);
    expect(warm[2]!, `Median, Grenze ${grenze.toFixed(0)} ms`).toBeLessThan(grenze);
  });
});
