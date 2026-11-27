import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { json, leeren, oeffneTestdb } from "./hilfen";
import { erstelleTestApp, person } from "./hilfen-auth";

/**
 * Abfragen auf demselben Client laufen nacheinander. pg reiht eine zweite Abfrage auf einem beschäftigten Client nur noch ein und
 * warnt ab der dritten (DeprecationWarning, ab pg@9 ein Fehler). Der Wächter meldet schon die zweite parallele Abfrage, die Warnung
 * selbst wird zusätzlich als Fehler gewertet.
 */

type Abfrage = (...args: unknown[]) => unknown;
interface ClientIntern {
  _activeQuery: unknown;
  _queryQueue: unknown[];
}

const { db, pool } = oeffneTestdb();
const t = erstelleTestApp(db);
const anna = person("pg-parallel-anna", { globalVerwalter: true });

// Die Client-Klasse des Pools (pg ist keine direkte Abhängigkeit dieses Pakets).
const prototyp = (pool as unknown as { Client: { prototype: { query: Abfrage } } }).Client.prototype;
const original = prototyp.query;
const parallel: string[] = [];
const warnungen: string[] = [];
const aufWarnung = (w: Error) => {
  if (w.name === "DeprecationWarning" && w.message.includes("client.query()")) warnungen.push(w.message);
};

beforeAll(() => {
  process.on("warning", aufWarnung);
  prototyp.query = function (this: ClientIntern, ...args: unknown[]) {
    if (this._activeQuery || this._queryQueue.length > 0) {
      const text = typeof args[0] === "string" ? args[0] : (args[0] as { text?: string } | undefined)?.text;
      parallel.push(String(text ?? "").slice(0, 200));
    }
    return original.apply(this, args);
  };
});

afterEach(async () => {
  // Warnungen kommen erst im nächsten Durchlauf der Ereignisschleife an.
  await new Promise((fertig) => setImmediate(fertig));
  const gefunden = { warnungen: warnungen.splice(0), parallel: parallel.splice(0) };
  expect(gefunden).toEqual({ warnungen: [], parallel: [] });
});
afterAll(async () => {
  prototyp.query = original;
  process.off("warning", aufWarnung);
  await leeren(db);
  await pool.end();
});

describe("keine parallelen Abfragen auf einem Client", () => {
  it("Einstellungsseite: Kalender-Link und Kontosicherheit", async () => {
    await leeren(db);
    const link = await t.request("/settings/calendar-link", { als: anna });
    expect(link.status).toBe(200);
    const sicherheit = await t.request("/account/security", { als: anna });
    expect(sicherheit.status).toBe(200);
    expect(await json(sicherheit)).toMatchObject({ passwordSet: true });
  });

  it("CRM-Abfrage: Zeilen und Gesamtzahl", async () => {
    await leeren(db);
    await db.insert(s.organisation).values([
      { name: "Muster Alpha GmbH", art: "unternehmen" },
      { name: "Muster Beta AG", art: "unternehmen" },
    ]);
    const antwort = await t.request("/crm/objekte/organisation/abfrage", {
      method: "POST",
      als: anna,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ spalten: [{ feld: "name" }] }),
    });
    expect(antwort.status).toBe(200);
    expect(await json(antwort)).toMatchObject({ gesamt: 2 });
  });
});
