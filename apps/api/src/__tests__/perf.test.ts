import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { erzeugeDemodaten, schreibeDemodaten } from "@carraway/db/demo";
import { erstelleTestApp } from "./hilfen-auth";
import { json, leeren, oeffneTestdb } from "./hilfen";

const { db, pool } = oeffneTestdb();
const app = erstelleTestApp(db);

const GRENZE_MS = 100;
const WIEDERHOLUNGEN = 20;

/** Mit SKIP_PERF=1 überspringen, z. B. auf langsamen Runnern. */
describe.skipIf(process.env.SKIP_PERF === "1")("Performance: /funds/:id/overview", () => {
  beforeAll(async () => {
    // Deutlich mehr als die Standard-Demo: 600 Beteiligungen auf drei Fonds.
    await schreibeDemodaten(db, erzeugeDemodaten({ seed: 1, umfang: { beteiligungen: 600, deals: 700 } }));
    await db.execute(sql`ANALYZE`);
  });
  afterAll(async () => {
    await leeren(db);
    await pool.end();
  });

  it(`Median der Serverzeit unter ${GRENZE_MS} ms`, async () => {
    const liste = await app.requestApi("/api/v1/funds");
    expect(liste.status).toBe(200);
    const { data } = await json(liste);
    const fonds = data[0].id as string;
    const pfad = `/api/v1/funds/${fonds}/overview`;
    const aufwaermen = await app.requestApi(pfad); // Aufwärmen: Verbindung, Plancache
    expect(aufwaermen.status).toBe(200);

    const zeiten: number[] = [];
    for (let i = 0; i < WIEDERHOLUNGEN; i++) {
      const antwort = await app.requestApi(pfad);
      expect(antwort.status).toBe(200);
      const dauer = /dur=([\d.]+)/.exec(antwort.headers.get("Server-Timing") ?? "")?.[1];
      zeiten.push(Number(dauer));
    }
    const sortiert = [...zeiten].sort((a, b) => a - b);
    const median = (sortiert[9]! + sortiert[10]!) / 2;
    const anzahl = (await json(await app.requestApi(pfad))).investments.length;
    console.log(`Performance /overview (${anzahl} Beteiligungen im Fonds): Median ${median.toFixed(1)} ms, min ${sortiert[0]} ms, max ${sortiert.at(-1)} ms; Werte: ${zeiten.join(", ")}`);
    expect(median).toBeLessThan(GRENZE_MS);
  });
});
