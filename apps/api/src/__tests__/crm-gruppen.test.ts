import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { erstelleTestApp, idVon, legePersonAn, person } from "./hilfen-auth";
import { json, leeren, oeffneTestdb } from "./hilfen";

const { db, pool } = oeffneTestdb();
const t = erstelleTestApp(db);
const FA = "00000000-0000-4000-8000-0000000000d1";
const FB = "00000000-0000-4000-8000-0000000000d2";
const ADMIN = person("grp-admin", { globalVerwalter: true });
const BEA_A = person("grp-bea-a", { rollen: { [FA]: "bearbeiter" } });

const post = (pfad: string, body: unknown, als = ADMIN) => t.request(`/crm${pfad}`, { method: "POST", als, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const patch = (pfad: string, body: unknown, als = ADMIN) => t.request(`/crm${pfad}`, { method: "PATCH", als, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const ids: Record<string, string> = {};
const ORGS = [
  { name: "Alpha GmbH", zahl: "5", betrag: "1000.50", wahl: "heiss", mehr: ["a", "b"], text: "x" },
  { name: "Beta AG", zahl: "12.5", betrag: "250.00", wahl: "kalt", mehr: ["b"], text: "y" },
  { name: "Gamma SE", zahl: "-3", betrag: "0.10", wahl: "heiss", mehr: [], text: null },
  { name: "Delta KG", zahl: null, betrag: null, wahl: null, mehr: ["a"], text: null },
  { name: "=SUMME(A1)", zahl: "7", betrag: "5.00", wahl: "kalt", mehr: ["a", "b"], text: "z" },
];

async function feld(name: string, typ: string, optionen?: unknown) {
  const antwort = await post("/felder", { objekt: "organisation", name, typ, ...(optionen ? { optionen } : {}) });
  expect(antwort.status, name).toBe(201);
  return (await json(antwort)).id as string;
}

beforeAll(async () => {
  await leeren(db);
  await db.insert(s.fonds).values([
    { id: FA, name: "Fonds A", kurzname: "FA", vintage: 2024, zeichnungskapital: "1000000.00" },
    { id: FB, name: "Fonds B", kurzname: "FB", vintage: 2024, zeichnungskapital: "1000000.00" },
  ]);
  await legePersonAn(db, ADMIN);
  await legePersonAn(db, BEA_A);
  ids.zahl = await feld("Mitarbeiter", "zahl");
  ids.betrag = await feld("Umsatz", "betrag");
  ids.wahl = await feld("Temperatur", "auswahl", { optionen: [{ schluessel: "heiss", label: "Heiß", farbe: "rose" }, { schluessel: "kalt", label: "Kalt", farbe: "blau" }] });
  ids.mehr = await feld("Tags", "mehrfachauswahl", { optionen: [{ schluessel: "a", label: "A", farbe: "signal" }, { schluessel: "b", label: "B", farbe: "violett" }] });
  ids.text = await feld("Notiz kurz", "text");
  ids.wer = await feld("Betreuer", "benutzer");
  for (const o of ORGS) {
    const [neu] = await db.insert(s.organisation).values({ name: o.name, art: "unternehmen" }).returning();
    ids[o.name] = neu!.id;
    const eigene: Record<string, unknown> = { [ids.mehr!]: o.mehr };
    if (o.zahl !== null) eigene[ids.zahl!] = o.zahl;
    if (o.betrag !== null) eigene[ids.betrag!] = o.betrag;
    if (o.wahl !== null) eigene[ids.wahl!] = o.wahl;
    if (o.text !== null) eigene[ids.text!] = o.text;
    if (o.name === "Alpha GmbH" || o.name === "Beta AG") eigene[ids.wer!] = await idVon(db, ADMIN);
    expect((await patch(`/datensaetze/organisation/${neu!.id}`, { eigene })).status, o.name).toBe(200);
  }
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

const gruppen = async (body: unknown, als = ADMIN) => {
  const antwort = await post("/objekte/organisation/gruppen", body, als);
  return { status: antwort.status, daten: await json(antwort) };
};
type G = { gruppen: { wert: string | null; anzahl: number; summen: Record<string, string> }[] };
const kurz = (g: G) => g.gruppen.map((x) => [x.wert, x.anzahl, x.summen]);
const abfrage = async (body: unknown) => json(await post("/objekte/organisation/abfrage", { limit: 200, ...(body as object) }));

describe("Gruppierung der Tabelle", () => {
  it("gruppiert nach einer Auswahl in der Reihenfolge der Optionen, ohne Wert zuletzt, mit Summen als Dezimalzeichenkette", async () => {
    const { status, daten } = await gruppen({ gruppe: ids.wahl, summen: [ids.betrag] });
    expect(status).toBe(200);
    expect(kurz(daten)).toEqual([
      ["heiss", 2, { [ids.betrag!]: "1000.60" }],
      ["kalt", 2, { [ids.betrag!]: "255.00" }],
      [null, 1, { [ids.betrag!]: "0" }],
    ]);
    expect(daten.gesamt).toBe(5);
  });

  it("zählt bei einer Mehrfachauswahl jede Zeile in jeder ihrer Gruppen, leere Listen unter „ohne Wert“", async () => {
    const { daten } = await gruppen({ gruppe: ids.mehr, summen: [ids.betrag, ids.zahl] });
    expect(kurz(daten)).toEqual([
      ["a", 3, { [ids.betrag!]: "1005.50", [ids.zahl!]: "12" }],
      ["b", 3, { [ids.betrag!]: "1255.50", [ids.zahl!]: "24.5" }],
      [null, 1, { [ids.betrag!]: "0.10", [ids.zahl!]: "-3" }],
    ]);
  });

  it("gruppiert nach einer Person im Haus und liefert die Namen in den Bezügen", async () => {
    const adminId = await idVon(db, ADMIN);
    const { daten } = await gruppen({ gruppe: ids.wer });
    expect(daten.gruppen.map((g: { wert: string | null; anzahl: number }) => [g.wert, g.anzahl])).toEqual([
      [adminId, 2],
      [null, 3],
    ]);
    expect(daten.bezuege[`benutzer:${adminId}`]).toBe(ADMIN.name);
  });

  it("nutzt dieselbe Treffermenge wie die Abfrage: Filter und Suche gelten auch für die Gruppen", async () => {
    const filter = { verknuepfung: "und", elemente: [{ feld: ids.betrag, operator: "groesser", wert: "100" }] };
    const { daten } = await gruppen({ gruppe: ids.wahl, summen: [ids.betrag], filter });
    expect(kurz(daten)).toEqual([
      ["heiss", 1, { [ids.betrag!]: "1000.50" }],
      ["kalt", 1, { [ids.betrag!]: "250.00" }],
    ]);
    expect(kurz((await gruppen({ gruppe: ids.wahl, suche: "alpha" })).daten)).toEqual([["heiss", 1, {}]]);
  });

  it("die Zeilen einer Gruppe holt die Abfrage mit einer Bedingung auf dasselbe Feld, passend zur Anzahl", async () => {
    for (const feldId of [ids.mehr!, ids.wahl!]) {
      const { daten } = await gruppen({ gruppe: feldId });
      for (const g of daten.gruppen as { wert: string | null; anzahl: number }[]) {
        const bedingung = g.wert === null ? { feld: feldId, operator: "leer" } : feldId === ids.mehr ? { feld: feldId, operator: "enthaelt_eines", wert: [g.wert] } : { feld: feldId, operator: "ist", wert: g.wert };
        const zeilen = await abfrage({ filter: { verknuepfung: "und", elemente: [bedingung] }, spalten: [{ feld: "name" }] });
        expect(zeilen.gesamt, String(g.wert)).toBe(g.anzahl);
      }
    }
  });

  it("lehnt Felder außerhalb des Verzeichnisses, falsche Typen und zu viele Summen ab; bösartige Schlüssel gelangen nie ins SQL", async () => {
    const boese = ["'; DROP TABLE organisation; --", '" OR 1=1 --', "name; DELETE FROM person", "1) OR (1=1", "%' OR '1'='1", "\\", "name\u0000", "$1", "{{x}}"];
    const vorher = (await db.execute<{ n: number }>(sql`SELECT (SELECT count(*) FROM organisation)::int AS n`)).rows[0]!.n;
    for (const k of boese) {
      expect((await gruppen({ gruppe: k })).status, `gruppe:${k}`).toBe(400);
      expect((await gruppen({ gruppe: ids.wahl, summen: [k] })).status, `summen:${k}`).toBe(400);
    }
    expect((await gruppen({ gruppe: "name" })).status).toBe(400); // Text lässt sich nicht gruppieren
    expect((await gruppen({ gruppe: ids.zahl })).status).toBe(400);
    expect((await gruppen({ gruppe: ids.wahl, summen: ["name"] })).status).toBe(400); // Summe nur für Betrag und Zahl
    expect((await gruppen({ gruppe: ids.wahl, summen: ids.text ? [ids.text] : [] })).status).toBe(400);
    expect((await gruppen({ gruppe: ids.wahl, summen: Array.from({ length: 7 }, () => ids.betrag) })).status).toBe(400);
    expect((await gruppen({ gruppe: ids.wahl, summen: [{ $ne: 1 }] })).status).toBe(400);
    expect((await gruppen({})).status).toBe(400);
    expect((await post("/objekte/gibtsnicht/gruppen", { gruppe: "x" })).status).toBe(400);
    // Böse Werte im Filter bleiben Parameter, auch im ODER-Zweig.
    const filter = { verknuepfung: "oder", elemente: [{ feld: "name", operator: "enthaelt", wert: "'; DROP TABLE organisation; --" }] };
    expect((await gruppen({ gruppe: ids.wahl, filter })).status).toBe(200);
    expect((await db.execute<{ n: number }>(sql`SELECT (SELECT count(*) FROM organisation)::int AS n`)).rows[0]!.n).toBe(vorher);
  });
});

describe("Gruppierung in gespeicherten Ansichten", () => {
  it("speichert die Gruppierung mit der Ansicht und lehnt Felder ab, die sich nicht gruppieren lassen", async () => {
    const konfig = (gruppierung: string) => ({ sortierung: [], spalten: [{ feld: "name" }, { feld: ids.betrag }], gruppierung });
    const ok = await post("/ansichten", { objekt: "organisation", name: "Nach Temperatur", art: "tabelle", konfig: konfig(ids.wahl!), geteilt: false });
    expect(ok.status).toBe(201);
    expect((await json(ok)).konfig.gruppierung).toBe(ids.wahl);
    for (const schlecht of ["name", ids.zahl!, "gibtsnicht"]) {
      expect((await post("/ansichten", { objekt: "organisation", name: "Kaputt", art: "tabelle", konfig: konfig(schlecht), geteilt: false })).status, schlecht).toBe(400);
    }
  });
});

describe("Gruppierung von Deals folgt der Sichtbarkeit", () => {
  it("zeigt keine Deals fremder Fonds in Anzahl und Summe, auch nicht mit ODER-Filter", async () => {
    const org = ids["Alpha GmbH"]!;
    await db.insert(s.deal).values([
      { organisationId: org, titel: "A1", fondsId: FA, phase: "anfrage", ticket: "100.00" },
      { organisationId: org, titel: "A2", fondsId: FA, phase: "anfrage", ticket: "50.00" },
      { organisationId: org, titel: "B1", fondsId: FB, phase: "anfrage", ticket: "9999.00" },
      { organisationId: org, titel: "F1", fondsId: null, phase: "pruefung", ticket: "7.00" },
      { organisationId: org, titel: "B2", fondsId: FB, phase: "pruefung", ticket: "1.00" },
    ]);
    const alsBea = await json(await post("/objekte/deal/gruppen", { gruppe: "phase", summen: ["ticket"] }, BEA_A));
    expect(kurz(alsBea)).toEqual([
      ["anfrage", 2, { ticket: "150.00" }],
      ["pruefung", 1, { ticket: "7.00" }],
    ]);
    expect(alsBea.gesamt).toBe(3);
    const oder = { verknuepfung: "oder", elemente: [{ feld: "titel", operator: "beginnt_mit", wert: "B" }, { feld: "phase", operator: "ist", wert: "anfrage" }] };
    const mitOder = await json(await post("/objekte/deal/gruppen", { gruppe: "phase", summen: ["ticket"], filter: oder }, BEA_A));
    expect(kurz(mitOder)).toEqual([["anfrage", 2, { ticket: "150.00" }]]);
    const alsAdmin = await json(await post("/objekte/deal/gruppen", { gruppe: "phase", summen: ["ticket"] }));
    expect(alsAdmin.gesamt).toBe(5);
    expect(kurz(alsAdmin)[0]).toEqual(["anfrage", 3, { ticket: "10149.00" }]);
  });

  it("liefert die Kontaktwege des Unternehmens als lesbare Felder des Deals (für Schnellaktionen), ohne sie schreibbar zu machen", async () => {
    await db.update(s.organisation).set({ email: "info@alpha.example", telefon: "+49 40 1", website: "https://alpha.example" }).where(eq(s.organisation.id, ids["Alpha GmbH"]!));
    const antwort = await json(await post("/objekte/deal/abfrage", { spalten: [{ feld: "titel" }, { feld: "unternehmenEmail" }, { feld: "unternehmenTelefon" }, { feld: "unternehmenWebsite" }], filter: { verknuepfung: "und", elemente: [{ feld: "unternehmenEmail", operator: "enthaelt", wert: "alpha.example" }] }, limit: 50 }, BEA_A));
    // BEA_A sieht A1, A2 und F1 (B1, B2 gehören zu Fonds B)
    expect(antwort.daten.map((z: { titel: string }) => z.titel).sort()).toEqual(["A1", "A2", "F1"]);
    expect(antwort.daten[0]).toMatchObject({ unternehmenEmail: "info@alpha.example", unternehmenTelefon: "+49 40 1", unternehmenWebsite: "https://alpha.example" });
    const felder = (await json(await t.request("/crm/objekte/deal/felder", { als: ADMIN }))).daten as { schluessel: string; schreibbar: boolean }[];
    expect(felder.find((f) => f.schluessel === "unternehmenEmail")!.schreibbar).toBe(false);
    const schreiben = await t.request(`/crm/datensaetze/deal/${(await db.select().from(s.deal).limit(1))[0]!.id}`, { method: "PATCH", als: ADMIN, headers: { "content-type": "application/json" }, body: JSON.stringify({ system: { unternehmenEmail: "x@y.example" } }) });
    expect(schreiben.status).toBe(400);
  });
});

describe("Gruppierung nach Verknüpfung und Kontrollkästchen", () => {
  const BOESE = ["'; DROP TABLE organisation; --", '" OR 1=1 --', "1) OR (1=1", "%' OR '1'='1", "\\", "name\u0000", "$1", "{{x}}"];

  it("gruppiert nach einem Verknüpfungsfeld, benennt die Ziele und sortiert nach Name, ohne Wert zuletzt", async () => {
    ids.bezug = await feld("Mutterfirma", "verknuepfung", { ziel: "organisation" });
    const setze = async (name: string, ziel: string) => expect((await patch(`/datensaetze/organisation/${ids[name]}`, { eigene: { [ids.bezug!]: ids[ziel] } })).status).toBe(200);
    await setze("Alpha GmbH", "Beta AG");
    await setze("Gamma SE", "Beta AG");
    await setze("Delta KG", "Alpha GmbH");
    const { status, daten } = await gruppen({ gruppe: ids.bezug, summen: [ids.betrag] });
    expect(status).toBe(200);
    expect(kurz(daten)).toEqual([
      [ids["Alpha GmbH"], 1, { [ids.betrag!]: "0" }],
      [ids["Beta AG"], 2, { [ids.betrag!]: "1000.60" }],
      [null, 2, { [ids.betrag!]: "255.00" }],
    ]);
    expect(daten.bezuege[`organisation:${ids["Beta AG"]}`]).toBe("Beta AG");
    expect(daten.gesamt).toBe(5);
    // Die Zeilen einer Gruppe holt die Abfrage mit „ist“ bzw. „leer“, passend zur Anzahl.
    for (const g of daten.gruppen as { wert: string | null; anzahl: number }[]) {
      const bedingung = g.wert === null ? { feld: ids.bezug, operator: "leer" } : { feld: ids.bezug, operator: "ist", wert: g.wert };
      expect((await abfrage({ filter: { verknuepfung: "und", elemente: [bedingung] }, spalten: [{ feld: "name" }] })).gesamt, String(g.wert)).toBe(g.anzahl);
    }
  });

  it("gruppiert Kontakte nach dem Unternehmen (Systemfeld)", async () => {
    await db.insert(s.person).values([
      { vorname: "Anna", nachname: "Alt", organisationId: ids["Beta AG"]! },
      { vorname: "Ben", nachname: "Bauer", organisationId: ids["Beta AG"]! },
      { vorname: "Cara", nachname: "Christ" },
    ]);
    const antwort = await json(await post("/objekte/person/gruppen", { gruppe: "unternehmen" }));
    expect(kurz(antwort)).toEqual([[ids["Beta AG"], 2, {}], [null, 1, {}]]);
    expect(antwort.bezuege[`organisation:${ids["Beta AG"]}`]).toBe("Beta AG");
  });

  it("gruppiert nach einem Kontrollkästchen: ohne Haken zählt als falsch, passend zu ist_wahr und ist_falsch", async () => {
    ids.haken = await feld("Prüfung offen", "kontrollkaestchen");
    for (const [name, wert] of [["Alpha GmbH", true], ["Beta AG", false], ["Delta KG", true]] as const) {
      expect((await patch(`/datensaetze/organisation/${ids[name]}`, { eigene: { [ids.haken!]: wert } })).status).toBe(200);
    }
    const { status, daten } = await gruppen({ gruppe: ids.haken, summen: [ids.betrag] });
    expect(status).toBe(200);
    expect(kurz(daten)).toEqual([
      ["true", 2, { [ids.betrag!]: "1000.50" }],
      ["false", 3, { [ids.betrag!]: "255.10" }],
    ]);
    expect((await abfrage({ filter: { verknuepfung: "und", elemente: [{ feld: ids.haken, operator: "ist_wahr" }] }, spalten: [{ feld: "name" }] })).gesamt).toBe(2);
    expect((await abfrage({ filter: { verknuepfung: "und", elemente: [{ feld: ids.haken, operator: "ist_falsch" }] }, spalten: [{ feld: "name" }] })).gesamt).toBe(3);
  });

  it("zeigt Verknüpfungen auf Deals fremder Fonds als Gruppe ohne Namen", async () => {
    const dealFeld = await feld("Verwandter Deal", "verknuepfung", { ziel: "deal" });
    const org = ids["Alpha GmbH"]!;
    const [eigen] = await db.insert(s.deal).values({ organisationId: org, titel: "Eigener Deal", fondsId: FA, phase: "anfrage" }).returning();
    const [fremd] = await db.insert(s.deal).values({ organisationId: org, titel: "Fremder Deal", fondsId: FB, phase: "anfrage" }).returning();
    expect((await patch(`/datensaetze/organisation/${ids["Alpha GmbH"]}`, { eigene: { [dealFeld]: eigen!.id } })).status).toBe(200);
    expect((await patch(`/datensaetze/organisation/${ids["Beta AG"]}`, { eigene: { [dealFeld]: fremd!.id } })).status).toBe(200);
    const alsBea = await json(await post("/objekte/organisation/gruppen", { gruppe: dealFeld }, BEA_A));
    expect(alsBea.bezuege[`deal:${eigen!.id}`]).toBe("Eigener Deal");
    expect(alsBea.bezuege[`deal:${fremd!.id}`]).toBeNull();
    expect(JSON.stringify(alsBea)).not.toContain("Fremder Deal");
    const alsAdmin = await json(await post("/objekte/organisation/gruppen", { gruppe: dealFeld }));
    expect(alsAdmin.bezuege[`deal:${fremd!.id}`]).toBe("Fremder Deal");
  });

  it("bösartige Werte im Filter der Gruppenzeilen bleiben Parameter oder werden abgelehnt", async () => {
    const vorher = (await db.execute<{ n: number }>(sql`SELECT (SELECT count(*) FROM organisation)::int AS n`)).rows[0]!.n;
    for (const wert of BOESE) {
      for (const bedingung of [{ feld: ids.bezug, operator: "ist", wert }, { feld: ids.bezug, operator: "ist_eines_von", wert: [wert] }, { feld: ids.haken, operator: "ist", wert }, { feld: "name", operator: "ist", wert }]) {
        const antwort = await post("/objekte/organisation/gruppen", { gruppe: ids.bezug, filter: { verknuepfung: "oder", elemente: [bedingung] } });
        expect([200, 400], JSON.stringify(bedingung)).toContain(antwort.status);
      }
      expect((await gruppen({ gruppe: wert })).status, `gruppe:${wert}`).toBe(400);
    }
    expect((await gruppen({ gruppe: ids.bezug, summen: [ids.haken] })).status).toBe(400);
    expect((await db.execute<{ n: number }>(sql`SELECT (SELECT count(*) FROM organisation)::int AS n`)).rows[0]!.n).toBe(vorher);
  });

  it("kürzt bei mehr als 500 Gruppen deterministisch: „ohne Wert“ und die größten bleiben, ein Hinweis meldet das Kürzen", async () => {
    const viele = 503;
    const zielIds = Array.from({ length: viele }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`);
    const [grosse] = await db.insert(s.organisation).values({ name: "Gruppe Gross", art: "unternehmen" }).returning();
    // Zwei Zeilen zeigen auf dasselbe Ziel (größte Gruppe), alle übrigen auf je ein eigenes.
    const werte = Array.from({ length: viele }, (_, i) => ({ name: `Bulk ${i}`, art: "unternehmen" as const, felder: { [ids.bezug!]: i < 2 ? zielIds[0]! : zielIds[i]! } }));
    await db.insert(s.organisation).values(werte);
    const erste = await gruppen({ gruppe: ids.bezug });
    const zweite = await gruppen({ gruppe: ids.bezug });
    expect(erste.status).toBe(200);
    expect(erste.daten.abgeschnitten).toBe(true);
    expect(erste.daten.gruppen).toHaveLength(500);
    expect(erste.daten.gruppen.some((g: { wert: string | null }) => g.wert === null)).toBe(true);
    expect(erste.daten.gruppen.find((g: { wert: string | null; anzahl: number }) => g.wert === zielIds[0])?.anzahl).toBe(2);
    expect(erste.daten.gruppen).toEqual(zweite.daten.gruppen);
    expect(grosse).toBeDefined();
    expect((await gruppen({ gruppe: ids.wahl })).daten.abgeschnitten).toBe(false);
  });
});
