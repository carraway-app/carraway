import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { erzeugeDemodaten, schreibeDemodaten } from "@carraway/db/demo";
import { wertSchema, type FeldDef } from "../crm/felder";
import { erstelleTestApp, person } from "./hilfen-auth";
import { json, leeren, oeffneTestdb } from "./hilfen";

const { db, pool } = oeffneTestdb();
const t = erstelleTestApp(db);
const ADMIN = person("crm-demo-admin", { globalVerwalter: true });

beforeAll(async () => {
  await schreibeDemodaten(db, erzeugeDemodaten({ seed: 1 }));
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

describe("CRM-Demodaten", () => {
  it("alle Werte eigener Felder passen zu ihren Definitionen", async () => {
    const defs = (await db.select().from(s.feldDefinition)) as FeldDef[];
    expect(defs.length).toBeGreaterThanOrEqual(8);
    const nachId = new Map(defs.map((d) => [d.id, d]));
    let werte = 0;
    for (const [tabelle, objekt] of [[s.organisation, "organisation"], [s.person, "person"], [s.deal, "deal"]] as const) {
      const zeilen = await db.select({ felder: tabelle.felder }).from(tabelle);
      for (const z of zeilen)
        for (const [id, wert] of Object.entries(z.felder)) {
          const d = nachId.get(id);
          expect(d, id).toBeTruthy();
          expect(d!.objekt).toBe(objekt);
          expect(wertSchema(d!).safeParse(wert).success, `${d!.name}: ${JSON.stringify(wert)}`).toBe(true);
          werte++;
        }
    }
    expect(werte).toBeGreaterThan(50);
  });

  it("Beschäftigungen: höchstens eine Hauptzeile je Person, gespiegelt in person.organisation_id", async () => {
    const falsch = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM person p LEFT JOIN beschaeftigung b ON b.person_id = p.id AND b.haupt WHERE p.organisation_id IS DISTINCT FROM b.organisation_id`);
    expect(falsch.rows[0]!.n).toBe(0);
    const frueher = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM beschaeftigung WHERE NOT haupt AND bis IS NOT NULL`);
    expect(frueher.rows[0]!.n).toBeGreaterThan(0);
  });

  it("Listen, Kontakte an Deals und Aufgaben sind da; die Abfrage liefert eigene Felder und Listenfelder", async () => {
    const listen = await json(await t.request("/crm/listen", { als: ADMIN }));
    expect(listen.daten.map((l: { name: string }) => l.name).sort()).toEqual(["Co-Investoren 2026", "Deals in der Prüfung", "LP-Pipeline"]);
    const co = listen.daten.find((l: { name: string }) => l.name === "Co-Investoren 2026");
    const felder = (await json(await t.request(`/crm/objekte/organisation/felder?listeId=${co.id}`, { als: ADMIN }))).daten;
    const gespraech = felder.find((f: { name: string }) => f.name === "Status Gespräch");
    const interesse = felder.find((f: { name: string }) => f.name === "Interesse");
    const antwort = await json(
      await t.request("/crm/objekte/organisation/abfrage", { method: "POST", als: ADMIN, headers: { "content-type": "application/json" }, body: JSON.stringify({ listeId: co.id, spalten: [{ feld: "name" }, { feld: interesse.schluessel }, { feld: gespraech.schluessel }] }) }),
    );
    expect(antwort.gesamt).toBeGreaterThan(0);
    expect(antwort.daten.every((z: Record<string, unknown>) => ["offen", "terminiert", "gefuehrt"].includes(z[gespraech.schluessel] as string))).toBe(true);
    const aufgaben = await json(await t.request("/crm/aufgaben", { als: ADMIN }));
    expect(aufgaben.daten.length).toBeGreaterThan(0);
    expect((await db.select().from(s.dealKontakt)).length).toBeGreaterThan(0);
  });
});
