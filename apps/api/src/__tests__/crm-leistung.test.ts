import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { erstelleTestApp, person } from "./hilfen-auth";
import { json, leeren, oeffneTestdb } from "./hilfen";
import { median, messeInRunden, perzentil } from "./hilfen-leistung";

const { db, pool } = oeffneTestdb();
const t = erstelleTestApp(db);
const ADMIN = person("crm-perf-admin", { globalVerwalter: true });

const UNTERNEHMEN = 10_000;
const KONTAKTE = 50_000;
const GRENZE_P95_MS = 150;
const WIEDERHOLUNGEN = 25;

const post = (pfad: string, body: unknown) => t.request(`/crm${pfad}`, { method: "POST", als: ADMIN, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/**
 * Leistung der Listen: 10.000 Unternehmen und 50.000 Kontakte mit eigenen Feldern; die Serverzeit (Kopfzeile `Server-Timing`) je Abfrage, 95. Perzentil unter 150 ms. Bis zu drei Messrunden je Fall: Es zählt die beste Runde (siehe `hilfen-leistung.ts`), damit Lastspitzen der Maschine nicht als Verschlechterung gelten.
 * Mit SKIP_PERF=1 überspringen, z. B. auf langsamen Runnern.
 */
const SUCH_FONDS = "00000000-0000-4000-8000-0000000000e1";

describe.skipIf(process.env.SKIP_PERF === "1")(`CRM-Listen: ${UNTERNEHMEN} Unternehmen, ${KONTAKTE} Kontakte`, () => {
  const f: Record<string, string> = {};
  beforeAll(async () => {
    await leeren(db);
    for (const [name, typ, optionen] of [
      ["Mitarbeiter", "zahl", undefined],
      ["Stufe", "auswahl", { optionen: [{ schluessel: "a", label: "A", farbe: "signal" }, { schluessel: "b", label: "B", farbe: "blau" }, { schluessel: "c", label: "C", farbe: "grau" }] }],
      ["Hinweis", "text", undefined],
    ] as const) {
      const antwort = await post("/felder", { objekt: "person", name, typ, ...(optionen ? { optionen } : {}) });
      f[name] = (await json(antwort)).id;
    }
    const org = (await json(await post("/felder", { objekt: "organisation", name: "Mitarbeiter", typ: "zahl" }))).id as string;
    await db.execute(sql`
      INSERT INTO organisation (name, art, ort, sektor, felder)
      SELECT 'Unternehmen ' || lpad(i::text, 5, '0') || ' ' || (ARRAY['GmbH','AG','SE','KG'])[1 + i % 4],
             (ARRAY['unternehmen','investor','berater','sonstige'])[1 + i % 4]::organisation_art,
             (ARRAY['Berlin','Hamburg','München','Köln','Leipzig'])[1 + i % 5],
             (ARRAY['Software','Industrie','Gesundheit'])[1 + i % 3],
             jsonb_build_object(${org}::text, (i % 500)::text)
      FROM generate_series(1, ${UNTERNEHMEN}) AS i`);
    await db.execute(sql`
      INSERT INTO person (vorname, nachname, email, funktion, organisation_id, felder)
      SELECT (ARRAY['Anna','Ben','Cara','David','Eva','Felix'])[1 + i % 6],
             'Nachname' || lpad((i % 9973)::text, 5, '0'),
             'kontakt' || i || '@beispiel.example',
             (ARRAY['CEO','CFO','CTO','Beirat'])[1 + i % 4],
             (SELECT id FROM organisation ORDER BY id OFFSET (i % ${UNTERNEHMEN}) LIMIT 1),
             jsonb_build_object(${f.Mitarbeiter}::text, (i % 1000)::text, ${f.Stufe}::text, (ARRAY['a','b','c'])[1 + i % 3], ${f.Hinweis}::text, 'Hinweis ' || (i % 100))
      FROM generate_series(1, ${KONTAKTE}) AS i`);
    // Ein Fonds mit 2.000 Beteiligungen für die Suche im Suchfeld (Issue #296).
    await db.execute(sql`INSERT INTO fonds (id, name, kurzname, vintage, zeichnungskapital) VALUES (${SUCH_FONDS}, 'Suchfonds', 'SF', 2024, 10000000.00)`);
    await db.execute(sql`
      INSERT INTO beteiligung (fonds_id, organisation_id, instrument, erstinvestment)
      SELECT ${SUCH_FONDS}, id, 'offene_beteiligung', '2025-01-01' FROM organisation ORDER BY name LIMIT 2000`);
    await db.execute(sql`ANALYZE`);
  }, 180_000);
  afterAll(async () => {
    await leeren(db);
    await pool.end();
  });

  const faelle: [string, string, () => unknown][] = [
    ["Kontakte, Standardsortierung", "person", () => ({ limit: 50, spalten: [{ feld: "name" }, { feld: "unternehmen" }, { feld: "email" }, { feld: f.Stufe }] })],
    ["Kontakte, Seite 500", "person", () => ({ limit: 50, offset: 25_000, spalten: [{ feld: "name" }, { feld: "email" }] })],
    ["Kontakte nach eigenem Zahlenfeld", "person", () => ({ limit: 50, sortierung: [{ feld: f.Mitarbeiter, richtung: "ab" }], spalten: [{ feld: "name" }, { feld: f.Mitarbeiter }] })],
    ["Kontakte nach Auswahlfeld gefiltert", "person", () => ({ limit: 50, filter: { verknuepfung: "und", elemente: [{ feld: f.Stufe, operator: "ist", wert: "b" }, { feld: f.Mitarbeiter, operator: "groesser", wert: "900" }] }, spalten: [{ feld: "name" }] })],
    ["Kontakte nach Unternehmen sortiert", "person", () => ({ limit: 50, sortierung: [{ feld: "unternehmen", richtung: "auf" }], spalten: [{ feld: "name" }, { feld: "unternehmen" }] })],
    ["Kontakte, Schnellsuche", "person", () => ({ limit: 50, suche: "nachname0042", spalten: [{ feld: "name" }, { feld: "email" }] })],
    ["Kontakte, Textfilter und Funktion", "person", () => ({ limit: 50, filter: { verknuepfung: "oder", elemente: [{ feld: "funktion", operator: "ist", wert: "cto" }, { feld: f.Hinweis, operator: "enthaelt", wert: "hinweis 7" }] }, spalten: [{ feld: "name" }] })],
    ["Unternehmen, Standardsortierung", "organisation", () => ({ limit: 50, spalten: [{ feld: "name" }, { feld: "art" }, { feld: "ort" }, { feld: "kontakte" }] })],
    ["Unternehmen, Filter und eigenes Feld", "organisation", () => ({ limit: 50, filter: { verknuepfung: "und", elemente: [{ feld: "ort", operator: "ist", wert: "berlin" }, { feld: "art", operator: "ist", wert: "investor" }] }, sortierung: [{ feld: "name", richtung: "ab" }], spalten: [{ feld: "name" }] })],
    ["Unternehmen, Namenssuche", "organisation", () => ({ limit: 50, suche: "unternehmen 0420", spalten: [{ feld: "name" }] })],
  ];

  for (const [name, objekt, body] of faelle) {
    it(`${name}: 95. Perzentil unter ${GRENZE_P95_MS} ms`, async () => {
      await post(`/objekte/${objekt}/abfrage`, body()); // Aufwärmen
      const messung = await messeInRunden(
        async () => {
          const zeiten: number[] = [];
          for (let i = 0; i < WIEDERHOLUNGEN; i++) {
            const antwort = await post(`/objekte/${objekt}/abfrage`, body());
            expect(antwort.status).toBe(200);
            zeiten.push(Number(/dur=([\d.]+)/.exec(antwort.headers.get("Server-Timing") ?? "")?.[1]));
          }
          return zeiten;
        },
        (zeiten) => perzentil(zeiten, 0.95),
        GRENZE_P95_MS,
      );
      console.log(`CRM-Leistung ${name}: Median ${median(messung.zeiten).toFixed(1)} ms, p95 ${messung.wert.toFixed(1)} ms (Runden: ${messung.runden.map((r) => r.toFixed(1)).join(", ")}; Lastfaktor ${messung.lastfaktor.toFixed(2)}), max ${Math.max(...messung.zeiten).toFixed(1)} ms`);
      expect(messung.wert, `p95 je Runde: ${messung.runden.join(", ")} ms, Lastfaktor ${messung.lastfaktor.toFixed(2)}`).toBeLessThan(messung.grenze);
    }, 60_000);
  }

  // Suchfelder für Verknüpfungen und Wertfelder mit Vorschlägen (Issue #274): Serverzeit je Abfrage wie oben.
  const sucheFaelle: [string, string][] = [
    ["Suchfeld Investor-Organisation", "/search?q=unternehmen%2004&limit=10&object=organization&kind=investor"],
    ["Suchfeld Organisation", "/search?q=unternehmen%200420&limit=10&object=organization"],
    ["Vorschläge Ort", "/organizations/values?field=city&q=ber"],
    ["Vorschläge Funktion", "/people/values?q=gesch"],
    ["Suchfeld Beteiligung im Fonds", `/search?q=unternehmen%200420&limit=10&object=investment&fundId=${SUCH_FONDS}`],
  ];
  for (const [name, pfad] of sucheFaelle) {
    it(`${name}: 95. Perzentil unter ${GRENZE_P95_MS} ms`, async () => {
      await t.request(pfad, { als: ADMIN }); // Aufwärmen
      const messung = await messeInRunden(
        async () => {
          const zeiten: number[] = [];
          for (let i = 0; i < WIEDERHOLUNGEN; i++) {
            const antwort = await t.request(pfad, { als: ADMIN });
            expect(antwort.status).toBe(200);
            zeiten.push(Number(/dur=([\d.]+)/.exec(antwort.headers.get("Server-Timing") ?? "")?.[1]));
          }
          return zeiten;
        },
        (zeiten) => perzentil(zeiten, 0.95),
        GRENZE_P95_MS,
      );
      console.log(`CRM-Leistung ${name}: Median ${median(messung.zeiten).toFixed(1)} ms, p95 ${messung.wert.toFixed(1)} ms`);
      expect(messung.wert, `p95 je Runde: ${messung.runden.join(", ")} ms`).toBeLessThan(messung.grenze);
    }, 60_000);
  }
});
