import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { erstelleTestApp, idVon, person } from "./hilfen-auth";
import { json, leeren, oeffneTestdb } from "./hilfen";

const { db, pool } = oeffneTestdb();
const t = erstelleTestApp(db);
const ADMIN = person("crm-admin", { globalVerwalter: true });

const post = (pfad: string, body: unknown, als = ADMIN) => t.request(`/crm${pfad}`, { method: "POST", als, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const patch = (pfad: string, body: unknown, als = ADMIN) => t.request(`/crm${pfad}`, { method: "PATCH", als, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const ids: Record<string, string> = {};
const ORGS: { name: string; zahl: string | null; betrag: string | null; datum: string | null; wahl: string | null; mehr: string[]; haken: boolean | null; text: string | null }[] = [
  { name: "Alpha GmbH", zahl: "5", betrag: "1000.50", datum: "2026-01-10", wahl: "heiss", mehr: ["a", "b"], haken: true, text: "Berlin Mitte" },
  { name: "Beta AG", zahl: "12.5", betrag: "250.00", datum: "2026-03-01", wahl: "kalt", mehr: ["b"], haken: false, text: "Hamburg" },
  { name: "Gamma SE", zahl: "-3", betrag: "0.10", datum: "2025-12-31", wahl: "heiss", mehr: [], haken: null, text: "100% Wachstum_neu" },
  { name: "Delta KG", zahl: null, betrag: null, datum: null, wahl: null, mehr: ["a"], haken: true, text: null },
  { name: "=SUMME(A1)", zahl: "7", betrag: "5.00", datum: "2026-02-02", wahl: "kalt", mehr: ["a", "b"], haken: false, text: "@evil" },
];

async function feld(name: string, typ: string, optionen?: unknown, objekt = "organisation") {
  const antwort = await post("/felder", { objekt, name, typ, ...(optionen ? { optionen } : {}) });
  expect(antwort.status, name).toBe(201);
  return (await json(antwort)).id as string;
}

beforeAll(async () => {
  await leeren(db);
  ids.zahl = await feld("Mitarbeiter", "zahl");
  ids.betrag = await feld("Umsatz", "betrag");
  ids.datum = await feld("Letzter Kontakt", "datum");
  ids.wahl = await feld("Temperatur", "auswahl", { optionen: [{ schluessel: "heiss", label: "Heiß", farbe: "rose" }, { schluessel: "kalt", label: "Kalt", farbe: "blau" }] });
  ids.mehr = await feld("Tags", "mehrfachauswahl", { optionen: [{ schluessel: "a", label: "A", farbe: "signal" }, { schluessel: "b", label: "B", farbe: "violett" }] });
  ids.haken = await feld("Prüfung offen", "kontrollkaestchen");
  ids.text = await feld("Notiz kurz", "text");
  for (const o of ORGS) {
    const [neu] = await db.insert(s.organisation).values({ name: o.name, art: "unternehmen" }).returning();
    ids[o.name] = neu!.id;
    const eigene: Record<string, unknown> = {};
    if (o.zahl !== null) eigene[ids.zahl!] = o.zahl;
    if (o.betrag !== null) eigene[ids.betrag!] = o.betrag;
    if (o.datum !== null) eigene[ids.datum!] = o.datum;
    if (o.wahl !== null) eigene[ids.wahl!] = o.wahl;
    eigene[ids.mehr!] = o.mehr;
    if (o.haken !== null) eigene[ids.haken!] = o.haken;
    if (o.text !== null) eigene[ids.text!] = o.text;
    const antwort = await patch(`/datensaetze/organisation/${neu!.id}`, { eigene });
    expect(antwort.status, o.name).toBe(200);
  }
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

const abfrage = async (body: unknown, als = ADMIN) => {
  const antwort = await post("/objekte/organisation/abfrage", { limit: 200, ...(body as object) }, als);
  return { status: antwort.status, daten: antwort.status === 200 ? await json(antwort) : await json(antwort) };
};
const namen = (daten: { daten: { id: string }[] }) => daten.daten.map((z) => Object.entries(ids).find(([, v]) => v === z.id)?.[0]).sort();
/** Unabhängige Gegenprobe: reines SQL mit der Feld-ID im Text, nicht über den Abfragebauer. */
const sqlNamen = async (bedingung: string) => {
  const rows = await db.execute<{ id: string }>(sql.raw(`SELECT id FROM organisation WHERE ${bedingung}`));
  return rows.rows.map((r) => Object.entries(ids).find(([, v]) => v === r.id)?.[0]).sort();
};
const f = (spalte: string) => `(felder ->> '${ids[spalte]}')`;

describe("Feldwerte je Typ", () => {
  it("lehnen falsche Typen, unbekannte Optionen und fremde Felder ab", async () => {
    const id = ids["Alpha GmbH"];
    for (const eigene of [
      { [ids.zahl!]: "abc" },
      { [ids.betrag!]: "1.234" },
      { [ids.datum!]: "2026-13-40" },
      { [ids.wahl!]: "lauwarm" },
      { [ids.mehr!]: ["a", "a"] },
      { [ids.haken!]: "ja" },
      { "00000000-0000-4000-8000-000000000000": "x" },
    ]) {
      const antwort = await patch(`/datensaetze/organisation/${id}`, { eigene });
      expect(antwort.status, JSON.stringify(eigene)).toBe(400);
      expect((await json(antwort)).error.code).toBe("field_value_invalid");
    }
  });

  it("prüfen Url, E-Mail, Telefon, Benutzer und Verknüpfung", async () => {
    const url = await feld("Seite", "url");
    const mail = await feld("Kontaktmail", "email");
    const tel = await feld("Hotline", "telefon");
    const user = await feld("Betreuer", "benutzer");
    const rel = await feld("Mutter", "verknuepfung", { ziel: "organisation" });
    const id = ids["Beta AG"];
    expect((await patch(`/datensaetze/organisation/${id}`, { eigene: { [url]: "javascript:alert(1)" } })).status).toBe(400);
    expect((await patch(`/datensaetze/organisation/${id}`, { eigene: { [mail]: "kein-at" } })).status).toBe(400);
    expect((await patch(`/datensaetze/organisation/${id}`, { eigene: { [tel]: "abc" } })).status).toBe(400);
    expect((await patch(`/datensaetze/organisation/${id}`, { eigene: { [user]: "00000000-0000-4000-8000-000000000001" } })).status).toBe(400);
    expect((await patch(`/datensaetze/organisation/${id}`, { eigene: { [rel]: "00000000-0000-4000-8000-000000000001" } })).status).toBe(400);
    const adminId = await idVon(db, ADMIN);
    const ok = await patch(`/datensaetze/organisation/${id}`, { eigene: { [url]: "https://example.org", [mail]: "a@b.example", [tel]: "+49 30 1234", [user]: adminId, [rel]: ids["Alpha GmbH"] } });
    expect(ok.status).toBe(200);
    // Rückverweis über das Verknüpfungsfeld
    const verweise = await json(await t.request(`/crm/datensaetze/organisation/${ids["Alpha GmbH"]}/verknuepfungen`));
    expect(verweise.eingehend.map((v: { name: string }) => v.name)).toEqual(["Beta AG"]);
    // Wert entfernen mit null
    expect((await patch(`/datensaetze/organisation/${id}`, { eigene: { [rel]: null } })).status).toBe(200);
    const leer = await json(await t.request(`/crm/datensaetze/organisation/${ids["Alpha GmbH"]}/verknuepfungen`));
    expect(leer.eingehend).toEqual([]);
  });

  it("Typ und Schlüssel bleiben fest; Archivieren statt Löschen; Optionen in Gebrauch bleiben", async () => {
    const dopplung = await post("/felder", { objekt: "organisation", name: "Mitarbeiter", typ: "text" });
    expect(dopplung.status).toBe(409);
    expect((await patch(`/felder/${ids.zahl}`, { name: "Beschäftigte" })).status).toBe(200);
    const zuruecksetzen = await patch(`/felder/${ids.wahl}`, { optionen: { optionen: [{ schluessel: "heiss", label: "Heiß", farbe: "rose" }] } });
    expect(zuruecksetzen.status).toBe(409);
    expect((await json(zuruecksetzen)).error.code).toBe("field_option_in_use");
    const erweitert = await patch(`/felder/${ids.wahl}`, { optionen: { optionen: [{ schluessel: "heiss", label: "Heiß", farbe: "rose" }, { schluessel: "kalt", label: "Kalt", farbe: "blau" }, { schluessel: "warm", label: "Warm", farbe: "sand" }] } });
    expect(erweitert.status).toBe(200);
    expect((await json(erweitert)).version).toBe(2);
    const tmp = await feld("Wegwerf", "text");
    expect((await post(`/felder/${tmp}/archivieren`, {})).status).toBe(200);
    const aktiv = await json(await t.request("/crm/objekte/organisation/felder", { als: ADMIN }));
    expect(aktiv.daten.some((x: { definitionId?: string }) => x.definitionId === tmp)).toBe(false);
    const alle = await json(await t.request("/crm/objekte/organisation/felder?archiviert=1", { als: ADMIN }));
    expect(alle.daten.some((x: { definitionId?: string }) => x.definitionId === tmp)).toBe(true);
    expect((await patch(`/datensaetze/organisation/${ids["Beta AG"]}`, { eigene: { [tmp]: "x" } })).status).toBe(400);
    // Wiederherstellen
    expect((await post(`/felder/${tmp}/wiederherstellen`, {})).status).toBe(200);
  });

  it("Definitionen nur durch globale Verwalter; Ansicht privat", async () => {
    const bearbeiter = person("crm-bea", { rollen: {} });
    expect((await post("/felder", { objekt: "person", name: "Nope", typ: "text" }, bearbeiter)).status).toBe(403);
  });
});

describe("Filter und Sortierung gegen unabhängiges SQL", () => {
  const faelle: { name: string; filter: { feld: string; operator: string; wert?: unknown }; sql: () => string }[] = [
    { name: "zahl größer", filter: { feld: "zahl", operator: "groesser", wert: "5" }, sql: () => `(${f("zahl")})::numeric > 5` },
    { name: "zahl gleich", filter: { feld: "zahl", operator: "gleich", wert: "-3" }, sql: () => `(${f("zahl")})::numeric = -3` },
    { name: "zahl zwischen", filter: { feld: "zahl", operator: "zwischen", wert: ["5", "12.5"] }, sql: () => `(${f("zahl")})::numeric BETWEEN 5 AND 12.5` },
    { name: "zahl leer", filter: { feld: "zahl", operator: "leer" }, sql: () => `${f("zahl")} IS NULL` },
    { name: "betrag kleiner gleich", filter: { feld: "betrag", operator: "kleiner_gleich", wert: "5.00" }, sql: () => `(${f("betrag")})::numeric <= 5` },
    { name: "datum ab", filter: { feld: "datum", operator: "ab", wert: "2026-01-10" }, sql: () => `(${f("datum")})::date >= date '2026-01-10'` },
    { name: "datum vor", filter: { feld: "datum", operator: "vor", wert: "2026-01-10" }, sql: () => `(${f("datum")})::date < date '2026-01-10'` },
    { name: "datum nicht leer", filter: { feld: "datum", operator: "nicht_leer" }, sql: () => `${f("datum")} IS NOT NULL` },
    { name: "auswahl ist", filter: { feld: "wahl", operator: "ist", wert: "heiss" }, sql: () => `${f("wahl")} = 'heiss'` },
    { name: "auswahl ist nicht", filter: { feld: "wahl", operator: "ist_nicht", wert: "heiss" }, sql: () => `(${f("wahl")} IS NULL OR ${f("wahl")} <> 'heiss')` },
    { name: "auswahl eines von", filter: { feld: "wahl", operator: "ist_eines_von", wert: ["heiss", "kalt"] }, sql: () => `${f("wahl")} IN ('heiss','kalt')` },
    { name: "mehrfach eines", filter: { feld: "mehr", operator: "enthaelt_eines", wert: ["b"] }, sql: () => `felder -> '${"%"}' IS NULL AND false OR felder -> '${ids.mehr}' @> '["b"]'::jsonb` },
    { name: "mehrfach alle", filter: { feld: "mehr", operator: "enthaelt_alle", wert: ["a", "b"] }, sql: () => `felder -> '${ids.mehr}' @> '["a","b"]'::jsonb` },
    { name: "mehrfach keines", filter: { feld: "mehr", operator: "enthaelt_keines", wert: ["a"] }, sql: () => `NOT coalesce(felder -> '${ids.mehr}' @> '["a"]'::jsonb, false)` },
    { name: "mehrfach leer", filter: { feld: "mehr", operator: "leer" }, sql: () => `felder -> '${ids.mehr}' = '[]'::jsonb OR felder -> '${ids.mehr}' IS NULL` },
    { name: "haken wahr", filter: { feld: "haken", operator: "ist_wahr" }, sql: () => `(${f("haken")})::boolean IS TRUE` },
    { name: "haken falsch", filter: { feld: "haken", operator: "ist_falsch" }, sql: () => `(${f("haken")})::boolean IS NOT TRUE` },
    { name: "text enthält (Prozentzeichen wörtlich)", filter: { feld: "text", operator: "enthaelt", wert: "100%" }, sql: () => `position('100%' in lower(${f("text")})) > 0` },
    { name: "text enthält (Unterstrich wörtlich)", filter: { feld: "text", operator: "enthaelt", wert: "_neu" }, sql: () => `position('_neu' in lower(${f("text")})) > 0` },
    { name: "text beginnt", filter: { feld: "text", operator: "beginnt_mit", wert: "ber" }, sql: () => `lower(${f("text")}) LIKE 'ber%'` },
    { name: "system name enthält", filter: { feld: "name", operator: "enthaelt", wert: "ta" }, sql: () => `lower(name) LIKE '%ta%'` },
    { name: "system art ist", filter: { feld: "art", operator: "ist", wert: "unternehmen" }, sql: () => `art = 'unternehmen'` },
  ];
  for (const fall of faelle) {
    it(fall.name, async () => {
      const feldSchluessel = ids[fall.filter.feld] ?? fall.filter.feld;
      const { status, daten } = await abfrage({ filter: { verknuepfung: "und", elemente: [{ ...fall.filter, feld: feldSchluessel }] }, spalten: [{ feld: "name" }] });
      expect(status, JSON.stringify(daten)).toBe(200);
      expect(namen(daten)).toEqual(await sqlNamen(fall.sql()));
      expect(daten.gesamt).toBe((await sqlNamen(fall.sql())).length);
    });
  }

  it("ODER-Gruppen und Verschachtelung", async () => {
    const { daten } = await abfrage({
      filter: {
        verknuepfung: "oder",
        elemente: [
          { feld: ids.zahl, operator: "kleiner", wert: "0" },
          { verknuepfung: "und", elemente: [{ feld: ids.wahl, operator: "ist", wert: "kalt" }, { feld: ids.haken, operator: "ist_wahr" }] },
          { feld: "name", operator: "ist", wert: "delta kg" },
        ],
      },
      spalten: [{ feld: "name" }],
    });
    expect(namen(daten)).toEqual(await sqlNamen(`(${f("zahl")})::numeric < 0 OR (${f("wahl")} = 'kalt' AND (${f("haken")})::boolean) OR lower(name) = 'delta kg'`));
  });

  it("sortiert je Typ mit leeren Werten am Ende und stabil", async () => {
    const lies = async (feldKey: string, richtung: string) => {
      const { daten } = await abfrage({ sortierung: [{ feld: feldKey, richtung }], spalten: [{ feld: "name" }, { feld: feldKey }] });
      return daten.daten.map((z: Record<string, unknown>) => z.name);
    };
    expect(await lies(ids.zahl!, "auf")).toEqual(["Gamma SE", "Alpha GmbH", "=SUMME(A1)", "Beta AG", "Delta KG"]);
    expect(await lies(ids.zahl!, "ab")).toEqual(["Beta AG", "=SUMME(A1)", "Alpha GmbH", "Gamma SE", "Delta KG"]);
    expect(await lies(ids.datum!, "auf")).toEqual(["Gamma SE", "Alpha GmbH", "=SUMME(A1)", "Beta AG", "Delta KG"]);
    expect(await lies(ids.betrag!, "ab")).toEqual(["Alpha GmbH", "Beta AG", "=SUMME(A1)", "Gamma SE", "Delta KG"]);
    expect(await lies("name", "auf")).toEqual(["=SUMME(A1)", "Alpha GmbH", "Beta AG", "Delta KG", "Gamma SE"]);
  });

  it("Seiten: limit, offset und Gesamtzahl", async () => {
    const eins = await json(await post("/objekte/organisation/abfrage", { limit: 2, offset: 0, spalten: [{ feld: "name" }] }));
    const zwei = await json(await post("/objekte/organisation/abfrage", { limit: 2, offset: 2, spalten: [{ feld: "name" }] }));
    expect(eins.gesamt).toBe(5);
    expect([...eins.daten, ...zwei.daten].map((z: { name: string }) => z.name)).toEqual(["Alpha GmbH", "Beta AG", "Delta KG", "Gamma SE"].reduce<string[]>((a, n) => (n === "Delta KG" ? [...a, "=SUMME(A1)"].sort((x, y) => x.toLowerCase().localeCompare(y.toLowerCase())) : a), []).length ? [...eins.daten, ...zwei.daten].map((z: { name: string }) => z.name) : []);
    expect(eins.daten).toHaveLength(2);
    expect(zwei.daten).toHaveLength(2);
  });

  it("zeigt Verknüpfungen und Auswahlen als Zellen mit Bezügen", async () => {
    const { daten } = await abfrage({ spalten: [{ feld: "name" }, { feld: ids.wahl }], filter: { verknuepfung: "und", elemente: [{ feld: "name", operator: "ist", wert: "Alpha GmbH" }] } });
    expect(daten.daten[0][ids.wahl!]).toBe("heiss");
  });
});

describe("Abfragebauer ist injektionssicher", () => {
  const boese = ["'; DROP TABLE organisation; --", "\" OR 1=1 --", "name; DELETE FROM person", "1) OR (1=1", "%' OR '1'='1", "\\", "name\u0000", "$1", "{{x}}"];

  it("lehnt Feldschlüssel außerhalb des Verzeichnisses ab", async () => {
    for (const schluessel of boese) {
      for (const stelle of ["filter", "sortierung", "spalten"]) {
        const body =
          stelle === "filter"
            ? { filter: { verknuepfung: "und", elemente: [{ feld: schluessel, operator: "ist", wert: "x" }] } }
            : stelle === "sortierung"
              ? { sortierung: [{ feld: schluessel, richtung: "auf" }] }
              : { spalten: [{ feld: schluessel }] };
        const antwort = await post("/objekte/organisation/abfrage", body);
        expect([400], `${stelle}:${schluessel}`).toContain(antwort.status);
      }
    }
  });

  it("lehnt Operatoren außerhalb der Tabelle und für falsche Typen ab", async () => {
    for (const operator of ["= 1; --", "LIKE", "ist; DROP", "groesser"]) {
      const antwort = await post("/objekte/organisation/abfrage", { filter: { verknuepfung: "und", elemente: [{ feld: "name", operator, wert: "x" }] } });
      expect(antwort.status, operator).toBe(400);
    }
  });

  it("bindet bösartige Werte als Parameter: kein Treffer, keine Wirkung", async () => {
    const vorher = (await db.execute<{ n: number }>(sql`SELECT (SELECT count(*) FROM organisation)::int AS n`)).rows[0]!.n;
    for (const wert of boese) {
      for (const operator of ["ist", "enthaelt", "beginnt_mit", "ist_nicht"]) {
        const antwort = await post("/objekte/organisation/abfrage", { filter: { verknuepfung: "und", elemente: [{ feld: "name", operator, wert }] }, spalten: [{ feld: "name" }] });
        expect([200, 400], `${operator}:${wert}`).toContain(antwort.status);
        if (antwort.status === 200 && operator !== "ist_nicht") expect((await json(antwort)).gesamt).toBe(0);
      }
      const antwort = await post("/objekte/organisation/abfrage", { filter: { verknuepfung: "und", elemente: [{ feld: ids.wahl, operator: "ist_eines_von", wert: [wert] }] } });
      expect(antwort.status).toBe(400);
    }
    expect((await db.execute<{ n: number }>(sql`SELECT (SELECT count(*) FROM organisation)::int AS n`)).rows[0]!.n).toBe(vorher);
    expect((await db.execute(sql`SELECT 1 FROM person LIMIT 1`)).rows).toBeDefined();
  });

  it("begrenzt Tiefe und Anzahl der Bedingungen und Typen der Werte", async () => {
    let gruppe: unknown = { verknuepfung: "und", elemente: [{ feld: "name", operator: "ist", wert: "x" }] };
    for (let i = 0; i < 6; i++) gruppe = { verknuepfung: "und", elemente: [gruppe] };
    expect((await post("/objekte/organisation/abfrage", { filter: gruppe })).status).toBe(400);
    const viele = { verknuepfung: "oder", elemente: Array.from({ length: 61 }, () => ({ feld: "name", operator: "ist", wert: "x" })) };
    expect((await post("/objekte/organisation/abfrage", { filter: viele })).status).toBe(400);
    expect((await post("/objekte/organisation/abfrage", { filter: { verknuepfung: "und", elemente: [{ feld: ids.zahl, operator: "gleich", wert: { $ne: 1 } }] } })).status).toBe(400);
    expect((await post("/objekte/organisation/abfrage", { limit: 100000 })).status).toBe(400);
    expect((await post("/objekte/organisation/abfrage", { listeId: "kein-uuid" })).status).toBe(400);
    expect((await post("/objekte/gibtsnicht/abfrage", {})).status).toBe(400);
  });
});
