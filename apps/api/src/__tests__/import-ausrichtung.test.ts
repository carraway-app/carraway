import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { erzeugeMappe, type Blattzeilen } from "@carraway/import";
import { json, leeren, oeffneTestdb } from "./hilfen";
import { erstelleTestApp, person, type Testperson } from "./hilfen-auth";

/**
 * Import und manuelle Erfassung (Etappe 4b): Manuell angelegte Runden und Fondsbewegungen bekommen keinen Importschlüssel und kollidieren nie mit
 * den Schlüsseln einer Datei; dieselbe Datei erneut übernommen ändert nichts, auch nicht an manuellen Zeilen. Importierte Runden gelten als abgeschlossen.
 */

const { db, pool } = oeffneTestdb();
const t = erstelleTestApp(db);
const ANNA = person("ausr-anna", { globalVerwalter: true });
const BERTA = person("ausr-berta", { globalVerwalter: true });

beforeEach(async () => {
  await leeren(db);
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

function datei(): Blattzeilen {
  return {
    fonds: [{ fonds_kurzname: "FA", name: "Fonds Alpha", vintage: "2021", zeichnungskapital: "10000000.00" }],
    organisationen: [{ organisation_schluessel: "O1", name: "Nordlicht Technik", art: "unternehmen" }],
    beteiligungen: [{ beteiligung_schluessel: "B1", fonds_kurzname: "FA", organisation_schluessel: "O1", instrument: "offene_beteiligung", erstinvestment: "2022-01-15" }],
    vorgaenge: [{ vorgang_schluessel: "V1", beteiligung_schluessel: "B1", art: "zusage", valuta: "2022-01-15", betrag: "500000.00" }],
    finanzierungsrunden: [{ runde_schluessel: "R1", organisation_schluessel: "O1", bezeichnung: "Seed", datum: "2022-01-15", pre_money: "4000000.00", post_money: "4500000.00", preis_je_anteil: "10.0000", anteile_gesamt_nach: "450000" }],
    rundenpositionen: [{ runde_schluessel: "R1", fonds_kurzname: "FA", betrag: "500000.00", anteile: "50000", rolle: "lead" }],
    fondsbewegungen: [{ bewegung_schluessel: "FBW1", fonds_kurzname: "FA", art: "abruf", valuta: "2022-02-01", betrag: "100000.00" }],
  } as Blattzeilen;
}

async function importiere(z: Blattzeilen, als: Testperson = ANNA) {
  const f = new FormData();
  f.append("datei", new File([new Uint8Array(await erzeugeMappe("de", z))], "import.xlsx"));
  const angelegt = await t.request("/import/runs", { method: "POST", body: f, als });
  expect(angelegt.status).toBe(201);
  const id = (await json(angelegt)).id as string;
  const gepruefte = await json(await t.request(`/import/runs/${id}/validate`, { method: "POST", als }));
  const befunde = (await json(await t.request(`/import/runs/${id}/findings?limit=100`, { als }))).daten;
  expect(gepruefte.fehlerAnzahl, JSON.stringify(befunde.filter((b: { schweregrad: string }) => b.schweregrad === "fehler"))).toBe(0);
  const antwort = await t.request(`/import/runs/${id}/apply`, { method: "POST", als: BERTA });
  expect(antwort.status, await antwort.clone().text()).toBe(200);
}
const zaehle = async (tabelle: string, bedingung = "true") => ((await db.execute(sql.raw(`SELECT count(*)::int AS n FROM ${tabelle} WHERE ${bedingung}`))).rows[0] as { n: number }).n;

describe("Import neben manuell angelegten Daten", () => {
  it("importierte Runden sind abgeschlossen; manuelle Runden und Bewegungen haben keinen Importschlüssel und bleiben bei erneutem Import unberührt", async () => {
    await importiere(datei());
    expect(await zaehle("finanzierungsrunde", "status = 'abgeschlossen'")).toBe(1);
    const orgId = ((await db.execute(sql`SELECT id FROM organisation LIMIT 1`)).rows[0] as { id: string }).id;
    const fondsId = ((await db.execute(sql`SELECT id FROM fonds LIMIT 1`)).rows[0] as { id: string }).id;
    const schluesselVorher = await zaehle("import_zuordnung");

    // Manuell: Runde (gleiche Daten wie die importierte, aber ohne Schlüssel) und eine Fondsbewegung
    const runde = await t.request(`/organisationen/${orgId}/finanzierungsrunden`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bezeichnung: "Seed", datum: "2022-01-15", preMoney: "4000000.00", preisJeAnteil: "10.0000", positionen: [{ fondsId, betrag: "1000000", anteile: "100000", rolle: "lead" }] }),
    });
    expect(runde.status).toBe(201);
    const bewegung = await t.request(`/funds/${fondsId}/postings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "fund_posting", type: "capital_call", valueDate: "2022-02-01", amount: "100000" }),
    });
    expect(bewegung.status).toBe(201);
    expect(await zaehle("import_zuordnung")).toBe(schluesselVorher);
    expect(await zaehle("finanzierungsrunde")).toBe(2);
    expect(await zaehle("fonds_bewegung")).toBe(2);

    // Dieselbe Datei erneut: über die Schlüssel wird nichts doppelt angelegt und nichts geändert, die manuellen Zeilen bleiben
    await importiere(datei());
    expect(await zaehle("finanzierungsrunde")).toBe(2);
    expect(await zaehle("finanzierungsrunde", "status = 'entwurf'")).toBe(1);
    expect(await zaehle("rundenposition")).toBe(2);
    expect(await zaehle("fonds_bewegung")).toBe(2);
    expect(await zaehle("vorgang")).toBe(1);
    expect(await zaehle("import_zuordnung")).toBe(schluesselVorher);
  });
});
