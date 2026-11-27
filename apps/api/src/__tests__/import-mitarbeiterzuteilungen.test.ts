import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { erzeugeMappe, type Blattzeilen } from "@carraway/import";
import { json, leeren, oeffneTestdb } from "./hilfen";
import { erstelleTestApp, legePersonAn, person, type Testperson } from "./hilfen-auth";

/**
 * Einzelzuteilungen der Mitarbeiterbeteiligung über die Datenübernahme (Issue #300): Blatt „Mitarbeiterzuteilungen“ mit Kennung statt Namen, der Pool muss
 * am Unternehmen bestehen, Prüflauf mit Befunden (Pool unbekannt, über dem Pool, Status ohne Datum), Übernahme stellt einen grob erfassten Pool auf einzeln
 * um und ist wiederholbar. Die Datei schreibt in den Bereich Einzelzuteilungen.
 */

const { db, pool } = oeffneTestdb();
const t = erstelleTestApp(db);
const ANNA = person("mz-anna", { globalVerwalter: true });
const BERTA = person("mz-berta", { globalVerwalter: true });
const OHNE = person("mz-ohne-einzel");
const FREMD = person("mz-fremder-fonds");

beforeEach(async () => {
  await leeren(db);
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

const grundlage: Blattzeilen = {
  fonds: [
    { fonds_kurzname: "FA", name: "Fonds Alpha", vintage: "2021", zeichnungskapital: "10000000.00" },
    { fonds_kurzname: "FB", name: "Fonds Beta", vintage: "2022", zeichnungskapital: "5000000.00" },
  ],
  organisationen: [{ organisation_schluessel: "O1", name: "Nordlicht Technik", art: "unternehmen" }],
  beteiligungen: [{ beteiligung_schluessel: "B1", fonds_kurzname: "FA", organisation_schluessel: "O1", instrument: "offene_beteiligung", erstinvestment: "2022-01-15" }],
} as Blattzeilen;

const zuteilung = (schluessel: string, werte: Record<string, string> = {}) => ({ zuteilung_schluessel: schluessel, organisation_schluessel: "O1", pool: "ESOP", kategorie: "mitarbeitende", anzahl: "10000", zugeteilt_am: "2023-01-01", ...werte });

async function laufe(z: Blattzeilen, als: Testperson = ANNA) {
  const f = new FormData();
  f.append("datei", new File([new Uint8Array(await erzeugeMappe("de", z))], "import.xlsx"));
  const angelegt = await t.request("/import/runs", { method: "POST", body: f, als });
  expect(angelegt.status).toBe(201);
  const id = (await json(angelegt)).id as string;
  const pruefung = await t.request(`/import/runs/${id}/validate`, { method: "POST", als });
  const befunde = pruefung.status === 200 ? (await json(await t.request(`/import/runs/${id}/findings?limit=100`, { als }))).daten : [];
  return { id, status: pruefung.status, befunde: befunde as { code: string; schweregrad: string; meldung: string }[] };
}

async function importiere(z: Blattzeilen) {
  const { id, befunde } = await laufe(z);
  expect(befunde.filter((b) => b.schweregrad === "fehler"), JSON.stringify(befunde)).toHaveLength(0);
  const antwort = await t.request(`/import/runs/${id}/apply`, { method: "POST", als: BERTA });
  expect(antwort.status, await antwort.clone().text()).toBe(200);
}

const zeilen = async <T>(q: ReturnType<typeof sql>) => (await db.execute(q)).rows as T[];

async function mitPool() {
  await importiere(grundlage);
  const [org] = await zeilen<{ id: string }>(sql`SELECT id FROM organisation LIMIT 1`);
  const antwort = await t.request(`/organisationen/${org!.id}/mitarbeiterpools`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ art: "esop", bezeichnung: "ESOP", groesse: "30000", datum: "2022-06-01", vergeben: "15000" }),
    als: ANNA,
  });
  expect(antwort.status).toBe(201);
  return org!.id;
}

describe("Import von Mitarbeiterzuteilungen", () => {
  it("übernimmt Zuteilungen mit Kennung in einen bestehenden Pool, stellt ihn auf einzeln um und ist wiederholbar; Kennung nicht im Protokoll", async () => {
    await mitPool();
    const datei = { mitarbeiterzuteilungen: [zuteilung("Z1", { kennung: "M-101", vesting_takt: "3", beschleunigung: "0.5", ausloeser: "doppelt" }), zuteilung("Z2", { kategorie: "fuehrung", anzahl: "5000", basispreis: "1.25" })] } as Blattzeilen;
    await importiere(datei);
    const zut = await zeilen<{ kennung: string | null; anzahl: string; vesting_takt_monate: number; beschleunigung_ausloeser: string; basispreis: string }>(sql`SELECT kennung, anzahl::text, vesting_takt_monate, beschleunigung_ausloeser::text, basispreis::text FROM mitarbeiterzuteilung ORDER BY kennung NULLS LAST`);
    expect(zut).toMatchObject([
      { kennung: "M-101", anzahl: "10000", vesting_takt_monate: 3, beschleunigung_ausloeser: "doppelt" },
      { kennung: null, anzahl: "5000", basispreis: "1.2500" },
    ]);
    const [p] = await zeilen<{ erfassung: string; vergeben: string }>(sql`SELECT erfassung::text, vergeben::text FROM mitarbeiterpool`);
    expect(p).toEqual({ erfassung: "einzeln", vergeben: "15000" });
    const protokoll = await zeilen<{ nachher: unknown }>(sql`SELECT nachher FROM aenderung WHERE tabelle = 'mitarbeiterzuteilung'`);
    expect(protokoll).toHaveLength(2);
    expect(JSON.stringify(protokoll)).not.toContain("M-101");
    // Dieselbe Datei erneut: nichts doppelt
    await importiere(datei);
    expect(await zeilen(sql`SELECT id FROM mitarbeiterzuteilung`)).toHaveLength(2);
  });

  it("meldet unbekannten Pool, Zuteilungen über dem Pool und Status ohne Datum", async () => {
    await mitPool();
    const unbekannt = await laufe({ mitarbeiterzuteilungen: [zuteilung("Z1", { pool: "VSOP" })] } as Blattzeilen);
    expect(unbekannt.befunde.map((b) => b.code)).toContain("POOL_UNBEKANNT");
    const zuViel = await laufe({ mitarbeiterzuteilungen: [zuteilung("Z1", { anzahl: "20000" }), zuteilung("Z2", { anzahl: "20000" })] } as Blattzeilen);
    expect(zuViel.befunde.map((b) => b.code)).toContain("ZUTEILUNG_UEBER_POOL");
    const ohneDatum = await laufe({ mitarbeiterzuteilungen: [zuteilung("Z1", { status: "verfallen" })] } as Blattzeilen);
    expect(ohneDatum.befunde.map((b) => b.code)).toContain("ZUTEILUNG_STATUS_DATUM");
  });

  it("zwei gleichzeitige Übernahmen überzeichnen den Pool nicht: eine gelingt, die andere scheitert an der frischen Prüfung", async () => {
    await mitPool();
    const a = await laufe({ mitarbeiterzuteilungen: [zuteilung("ZA", { anzahl: "20000" })] } as Blattzeilen);
    const b = await laufe({ mitarbeiterzuteilungen: [zuteilung("ZB", { anzahl: "20000" })] } as Blattzeilen);
    expect([...a.befunde, ...b.befunde].filter((x) => x.schweregrad === "fehler")).toHaveLength(0);
    const antworten = await Promise.all([a.id, b.id].map((id) => t.request(`/import/runs/${id}/apply`, { method: "POST", als: BERTA })));
    expect(antworten.map((x) => x.status).sort()).toEqual([200, 409]);
    const [summe] = await zeilen<{ n: string }>(sql`SELECT coalesce(sum(anzahl), 0)::text AS n FROM mitarbeiterzuteilung`);
    expect(summe!.n).toBe("20000");
  });

  it("ohne Recht am Unternehmen nur der Befund zur Berechtigung, nie ob ein Pool besteht", async () => {
    await mitPool();
    const fremdId = await legePersonAn(db, FREMD);
    const rolle = await json(await t.request("/permissions/roles", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Daten mit Einzel", areas: ["portfolio", "finance", "contacts", "data", "individual_grants"] }), als: ANNA }));
    const [fb] = await zeilen<{ id: string }>(sql`SELECT id FROM fonds WHERE kurzname = 'FB'`);
    const gruppe = await t.request("/permissions/groups", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Nur Fonds Beta", level: "approver", fundsRestricted: true, fundIds: [fb!.id], roleIds: [rolle.id], memberIds: [fremdId] }),
      als: ANNA,
    });
    expect(gruppe.status).toBe(201);
    const { id, status } = await laufe({ mitarbeiterzuteilungen: [zuteilung("Z1"), zuteilung("Z2", { pool: "Gibt es nicht" })] } as Blattzeilen, FREMD);
    expect(status).toBe(200);
    // Alle gespeicherten Befunde des Laufs (auch die, die die eingeschränkte Sicht ausblendet)
    const codes = (await zeilen<{ code: string }>(sql`SELECT code FROM import_befund WHERE lauf_id = ${id}`)).map((x) => x.code);
    expect(codes.filter((c) => c === "KEINE_BERECHTIGUNG_EINZELZUTEILUNGEN")).toHaveLength(2);
    expect(codes).not.toContain("POOL_UNBEKANNT");
  });

  it("ohne den Bereich Einzelzuteilungen lehnt die Prüfung eine Datei mit Zuteilungen ab", async () => {
    await mitPool();
    const ohneId = await legePersonAn(db, OHNE);
    const rolle = await json(await t.request("/permissions/roles", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Daten ohne Einzel", areas: ["portfolio", "finance", "contacts", "data"] }), als: ANNA }));
    const [fonds] = await zeilen<{ id: string }>(sql`SELECT id FROM fonds LIMIT 1`);
    const gruppe = await t.request("/permissions/groups", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Daten", level: "approver", fundsRestricted: true, fundIds: [fonds!.id], roleIds: [rolle.id], memberIds: [ohneId] }),
      als: ANNA,
    });
    expect(gruppe.status).toBe(201);
    const { status } = await laufe({ mitarbeiterzuteilungen: [zuteilung("Z1")] } as Blattzeilen, OHNE);
    expect(status).toBe(403);
  });
});
