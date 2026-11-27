import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { beteiligung, fonds, importLauf, importZuordnung, organisation, person as personTabelle, providerConnection } from "@carraway/db";
import { beispielApi, beispielDaten, referenzAdapter, type BeispielDaten } from "@carraway/import/vorsystem-beispiel";
import type { Transport } from "../http/oeffentlicher-abruf";
import { leeren, oeffneTestdb } from "./hilfen";
import { erstelleTestApp, person, type Testperson } from "./hilfen-auth";

const { db, pool } = oeffneTestdb();
const ANNA = person("quelle-anna", { globalVerwalter: true });
const BERTA = person("quelle-berta", { globalVerwalter: true });
const LESER = person("quelle-leser");
const ZUGANG = "test-only-source-token";

let daten: BeispielDaten = beispielDaten();
let api = beispielApi(daten);
/** Ursprung und Anmeldung jeder Anfrage an die Quelle. */
let gesendet: { origin: string; authorization: string | undefined }[] = [];
let adresse = "93.184.216.34";
/** Transport gegen die Beispiel-API im Speicher. */
const transport: Transport = async ({ url, headers, body }) => {
  gesendet.push({ origin: url.origin, authorization: headers?.authorization });
  const antwort = await api(url.pathname, JSON.parse(body!));
  return { status: 200, kopf: {}, rumpf: (async function* () { yield Buffer.from(JSON.stringify(antwort)); })(), abbrechen() {} };
};
/** Zweiter Adapter mit Zugang aus der Umgebung und eigenen Hosts je Kunde. */
const UMGEBUNG = "CARRAWAY_TEST_QUELLE_ZUGANG";
const mitUmgebung = { ...referenzAdapter, id: "example-env", umgebungsvariable: UMGEBUNG, erlaubteHosts: ["*.example.org"] };
const t = erstelleTestApp(db, { erweiterungen: [{ name: "test-quelle", vorsysteme: [referenzAdapter, mitUmgebung] }], providerHttp: { transport, aufloeser: async () => [adresse] } });

beforeEach(async () => {
  await leeren(db);
  daten = beispielDaten();
  api = beispielApi(daten);
  gesendet = [];
  adresse = "93.184.216.34";
  delete process.env[UMGEBUNG];
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

const einrichten = (settings: object = {}, credential: string | null = ZUGANG, als: Testperson = ANNA) =>
  t.requestApi("/import/sources/example", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...(credential ? { credential } : {}), settings }), als });
const pruefen = (als: Testperson = ANNA) => t.requestApi("/import/sources/example/runs", { method: "POST", als });
const uebernehmen = (id: string, als: Testperson = BERTA) => t.requestApi(`/import/runs/${id}/apply`, { method: "POST", als });
type Lauf = { id: string; status: string; errorCount: number; warningCount: number; preview: { counts: Record<string, { newEntry: number; unchanged: number }>; source: { adapter: string; requests: number; findings: unknown[] } } };
const befunde = async (id: string) => ((await (await t.requestApi(`/import/runs/${id}/findings?limit=1000`, { als: ANNA })).json()) as { data: { code: string; severity: string; parameters: Record<string, string> }[] }).data;

describe("Übernahme aus Vorsystem: Verbindung", () => {
  it("nur globale Verwalter sehen und richten Quellen ein; der Zugang ist verschlüsselt und erscheint nirgends", async () => {
    expect((await t.requestApi("/import/sources", { als: LESER })).status).toBe(403);
    const leer = (await (await t.requestApi("/import/sources", { als: ANNA })).json()) as { data: unknown[] };
    expect(leer.data[0]).toEqual({ id: "example", label: "Example API", defaultOrigin: "https://api.example.com", configured: false, credential: null, settings: null });
    expect((await einrichten({}, ZUGANG, LESER)).status).toBe(403);
    expect((await einrichten({}, null)).status).toBe(400);
    expect((await einrichten({ origin: "http://api.example.com" })).status).toBe(400);
    expect((await einrichten({ funds: ["f-1"] })).status).toBe(200);
    const [conn] = await db.select().from(providerConnection);
    expect(conn!.credential).toMatch(/^f1\./);
    expect(conn!.credential).not.toContain(ZUGANG);
    const liste = await (await t.requestApi("/import/sources", { als: ANNA })).text();
    expect(liste).not.toContain(ZUGANG);
    expect(JSON.parse(liste).data[0]).toMatchObject({ configured: true, credential: "stored", settings: { funds: ["f-1"] } });
    // Ohne neuen Zugang bleibt der gespeicherte.
    expect((await einrichten({ funds: [] }, null)).status).toBe(200);
    expect((await db.select().from(providerConnection))[0]!.credential).toBe(conn!.credential);
    const { rows } = await db.execute<{ nachher: string }>(sql`SELECT nachher::text FROM aenderung WHERE aktion = 'import_source_configured'`);
    expect(rows.length).toBe(2);
    expect(rows.every((r) => !r.nachher.includes(ZUGANG))).toBe(true);
  });

  it("ein Prüflauf ohne Verbindung oder mit gescheiterter Quelle meldet einen Code ohne Inhalte der Quelle", async () => {
    expect((await pruefen()).status).toBe(409);
    await einrichten({ funds: ["f-9"] });
    const antwort = await pruefen();
    expect(antwort.status).toBe(502);
    expect(await antwort.json()).toMatchObject({ error: { code: "import_source_read_failed" } });
    expect((await t.requestApi("/import/sources/unknown/runs", { method: "POST", als: ANNA })).status).toBe(404);
  });
});

describe("Übernahme aus Vorsystem: Fonds, Unternehmen und Stammdaten (#163)", () => {
  it("legt ein Unternehmen über mehrere Fonds nur einmal an, mit einer Beteiligung je Fonds; ein erneuter Lauf legt nichts doppelt an", async () => {
    await einrichten();
    const antwort = await pruefen();
    expect(antwort.status).toBe(201);
    const lauf = (await antwort.json()) as Lauf;
    expect(lauf.preview.source).toMatchObject({ adapter: "example" });
    expect(lauf.preview.source.requests).toBeGreaterThan(5);
    // Prüflauf: noch nichts geschrieben.
    expect(await db.select().from(organisation)).toHaveLength(0);
    const gefunden = await befunde(lauf.id);
    expect(gefunden.filter((b) => b.severity === "error")).toEqual([]);
    expect(gefunden).toContainEqual(expect.objectContaining({ code: "source_records_merged", parameters: expect.objectContaining({ von: "c-2b", nach: "c-2", reason: "domain" }) }));
    expect(lauf.status).toBe("validated");

    // Vier Augen: wer den Prüflauf gestartet hat, übernimmt nicht.
    expect((await uebernehmen(lauf.id, ANNA)).status).toBe(409);
    expect((await uebernehmen(lauf.id)).status).toBe(200);

    const orgs = await db.select().from(organisation);
    expect(orgs.map((o) => o.name).sort()).toEqual(["Kiesel Analytics GmbH", "Nordlicht Robotik GmbH", "Weidenbach Kapital AG"]);
    const nordlicht = orgs.find((o) => o.name === "Nordlicht Robotik GmbH")!;
    const kiesel = orgs.find((o) => o.name === "Kiesel Analytics GmbH")!;
    const bets = await db.select().from(beteiligung);
    expect(bets.filter((b) => b.organisationId === nordlicht.id)).toHaveLength(2);
    expect(new Set(bets.filter((b) => b.organisationId === nordlicht.id).map((b) => b.fondsId)).size).toBe(2);
    expect(bets.filter((b) => b.organisationId === kiesel.id)).toHaveLength(2);
    expect(await db.select().from(personTabelle)).toHaveLength(1);
    const { rows: fonds } = await db.execute<{ kurzname: string }>(sql`SELECT kurzname FROM fonds`);
    expect(fonds.map((f) => f.kurzname).sort()).toEqual(["BSP-1", "Beispielfonds Zwei"]);
    const schluessel = await db.select({ s: importZuordnung.schluessel }).from(importZuordnung).where(sql`${importZuordnung.objekt} = 'organisation'`);
    expect(schluessel.map((s) => s.s).sort()).toEqual(["example:c-1", "example:c-2", "example:x-1"]);

    // Zweiter Lauf: alles schon da, nichts Neues.
    const zweiter = (await (await pruefen()).json()) as Lauf;
    expect(zweiter.status).toBe("validated");
    for (const z of Object.values(zweiter.preview.counts)) expect(z.newEntry).toBe(0);
    expect((await uebernehmen(zweiter.id)).status).toBe(200);
    expect(await db.select().from(organisation)).toHaveLength(3);
    expect(await db.select().from(beteiligung)).toHaveLength(4);
  });

  it("ordnet Unternehmen auf Wunsch einer vorhandenen Organisation zu und hält getrennte Unternehmen auseinander", async () => {
    const [vorhanden] = await db.insert(organisation).values({ name: "Nordlicht Robotik", art: "unternehmen" }).returning();
    await einrichten({ organizations: { "c-1": vorhanden!.id }, keepSeparate: ["c-2b"], fundShortNames: { "f-2": "BSP-2" } });
    const lauf = (await (await pruefen()).json()) as Lauf;
    const gefunden = await befunde(lauf.id);
    expect(gefunden.filter((b) => b.code === "source_records_merged")).toEqual([]);
    expect(gefunden.filter((b) => b.severity === "error")).toEqual([]);
    expect((await uebernehmen(lauf.id)).status).toBe(200);
    const orgs = await db.select().from(organisation);
    expect(orgs).toHaveLength(4);
    expect((await db.select().from(beteiligung)).filter((b) => b.organisationId === vorhanden!.id)).toHaveLength(2);
    const { rows } = await db.execute<{ kurzname: string }>(sql`SELECT kurzname FROM fonds ORDER BY kurzname`);
    expect(rows.map((f) => f.kurzname)).toEqual(["BSP-1", "BSP-2"]);
  });
});

describe("Übernahme aus Vorsystem: Runden, Positionen und Vorgänge (#164)", () => {
  const lauf = async () => {
    await einrichten();
    const l = (await (await pruefen()).json()) as Lauf;
    expect((await befunde(l.id)).filter((b) => b.severity === "error")).toEqual([]);
    return l;
  };
  const zahl = async (abfrage: ReturnType<typeof sql>) => (await db.execute<{ n: number }>(abfrage)).rows[0]!.n;

  it("übernimmt Runden mit Positionen Dritter, Vorgänge mit Runde und führt wiederholte Zinsen je Quartal zusammen", async () => {
    const l = await lauf();
    expect(await befunde(l.id)).toContainEqual(expect.objectContaining({ code: "source_conversion_not_imported", severity: "warning" }));
    expect((await uebernehmen(l.id)).status).toBe(200);
    expect(await zahl(sql`SELECT count(*)::int AS n FROM finanzierungsrunde`)).toBe(1);
    const { rows: positionen } = await db.execute<{ fonds_id: string | null; vehikel_id: string | null }>(sql`SELECT fonds_id, vehikel_id FROM rundenposition`);
    expect(positionen).toHaveLength(3);
    expect(positionen.filter((p) => p.vehikel_id !== null)).toHaveLength(1);
    // Zinsen: sechs Monatsbuchungen ergeben zwei Vorgänge je Quartal, mit der Herkunft in der Bemerkung.
    const { rows: zinsen } = await db.execute<{ valuta: string; betrag: string; bemerkung: string }>(sql`SELECT valuta::text, betrag::text, bemerkung FROM vorgang WHERE art = 'zins' ORDER BY valuta`);
    expect(zinsen.map((z) => [z.valuta, z.betrag])).toEqual([["2025-03-31", "3000.00"], ["2025-06-30", "3000.00"]]);
    expect(zinsen[0]!.bemerkung).toContain("t-a2-zins-1");
    expect(await zahl(sql`SELECT count(*)::int AS n FROM vorgang_runde WHERE quelle = 'manuell'`)).toBe(4);
    // 16 Ereignisse: 1 Wandlung nicht gebucht, 6 Monatszinsen zu 2 zusammengeführt.
    expect(await zahl(sql`SELECT count(*)::int AS n FROM vorgang`)).toBe(11);
  });

  it("gleicht Summen je Beteiligung und je Fonds im Abnahmeprotokoll ab", async () => {
    const l = await lauf();
    expect((await uebernehmen(l.id)).status).toBe(200);
    const [gespeichert] = await db.select({ ergebnis: importLauf.ergebnis }).from(importLauf).where(eq(importLauf.id, l.id));
    const ergebnis = gespeichert!.ergebnis as { fonds: { kurzname: string; kontrollsummen: { beteiligung?: string; status: string }[] }[] };
    const eins = ergebnis.fonds.find((f) => f.kurzname === "BSP-1")!;
    expect(eins.kontrollsummen.length).toBeGreaterThanOrEqual(4);
    expect(eins.kontrollsummen.every((k) => k.status === "ok")).toBe(true);
    expect(eins.kontrollsummen.some((k) => k.beteiligung === "example:i-a2")).toBe(true);
    expect((await t.requestApi(`/import/runs/${l.id}/log?format=xlsx`, { als: ANNA })).status).toBe(200);
  });

  it("bucht nicht doppelt, wenn zu einer Periode mit einem einzigen Ereignis später ein zweites kommt", async () => {
    await einrichten({ merge: { types: ["tilgung"], period: "quarter" } });
    const l = (await (await pruefen()).json()) as Lauf;
    expect((await uebernehmen(l.id)).status).toBe(200);
    daten.transactions.push({ id: "t-a2-4", investmentId: "i-a2", type: "REPAYMENT", date: "2025-05-15", amount: "10000.00" });
    const zweiter = (await (await pruefen()).json()) as Lauf;
    expect(await befunde(zweiter.id)).toContainEqual(expect.objectContaining({ code: "transaction_differs" }));
    expect(Object.values(zweiter.preview.counts).every((z) => z.newEntry === 0)).toBe(true);
  });

  it("meldet abweichende Summen der Quelle", async () => {
    daten.totals.push({ fundId: "f-2", investmentId: "i-b1", measure: "DRAWDOWNS", amount: "450000.00" });
    await einrichten();
    const l = (await (await pruefen()).json()) as Lauf;
    expect(await befunde(l.id)).toContainEqual(expect.objectContaining({ code: "control_total_differs" }));
  });

  it("legt bei einem erneuten Lauf nichts doppelt an und meldet ein später hinzugekommenes Ereignis einer übernommenen Periode", async () => {
    const l = await lauf();
    expect((await uebernehmen(l.id)).status).toBe(200);
    const zweiter = (await (await pruefen()).json()) as Lauf;
    for (const z of Object.values(zweiter.preview.counts)) expect(z.newEntry).toBe(0);
    daten.transactions.push({ id: "t-a2-zins-7", investmentId: "i-a2", type: "INTEREST_ACCRUAL", date: "2025-06-15", amount: "500.00" });
    const dritter = (await (await pruefen()).json()) as Lauf;
    expect(await befunde(dritter.id)).toContainEqual(expect.objectContaining({ code: "transaction_differs" }));
    expect(Object.values(dritter.preview.counts).every((z) => z.newEntry === 0)).toBe(true);
  });
});

describe("Übernahme aus Vorsystem: Kennzahlen und Bewertungen (#165)", () => {
  it("übernimmt zugeordnete Kennzahlen mit Periode und Szenario sowie Bewertungen mit Stichtag und Methode", async () => {
    await einrichten({ metrics: { Revenue: "umsatz", Headcount: "mitarbeitende_vzae" } });
    const l = (await (await pruefen()).json()) as Lauf;
    const gefunden = await befunde(l.id);
    expect(gefunden.filter((b) => b.severity === "error")).toEqual([]);
    expect(gefunden).toContainEqual(expect.objectContaining({ code: "source_metric_unmapped", parameters: expect.objectContaining({ kennzahl: "Burn multiple" }) }));
    expect((await uebernehmen(l.id)).status).toBe(200);
    const { rows: werte } = await db.execute<{ schluessel: string; szenario: string; wert: string; status: string; quelle: string; quellenangabe: string }>(sql`
      SELECT k.schluessel, w.szenario::text, w.wert, w.status::text, w.quelle::text, w.quellenangabe FROM kennzahl_wert w JOIN kennzahl_definition k ON k.id = w.definition_id ORDER BY k.schluessel, w.wert`);
    // Nordlicht hat zwei Beteiligungen (zwei Fonds): je Beteiligung ein Wert; Kiesel nur über den ersten Fonds mit Kennzahlen.
    expect(werte.map((w) => [w.schluessel, w.szenario, w.wert])).toEqual([
      ["mitarbeitende_vzae", "ist", "42"], ["mitarbeitende_vzae", "ist", "42"],
      ["umsatz", "ist", "1500000"], ["umsatz", "ist", "1500000"], ["umsatz", "plan", "800000"], ["umsatz", "plan", "800000"],
    ]);
    expect(werte.every((w) => w.status === "bestaetigt" && w.quelle === "import" && w.quellenangabe.startsWith("example:"))).toBe(true);
    const { rows: bew } = await db.execute<{ stichtag: string; wert: string; methode: string; status: string }>(sql`SELECT stichtag::text, wert::text, methode::text, status::text FROM bewertung ORDER BY bewertung.wert`);
    expect(bew).toEqual([{ stichtag: "2024-12-31", wert: "600000.00", methode: "letzte_runde", status: "freigegeben" }, { stichtag: "2024-12-31", wert: "1200000.00", methode: "letzte_runde", status: "freigegeben" }]);
    // Erneuter Lauf: nichts Neues.
    const zweiter = (await (await pruefen()).json()) as Lauf;
    expect(Object.values(zweiter.preview.counts).every((z) => z.newEntry === 0)).toBe(true);
  });

  it("meldet unbekannte Katalogschlüssel und ungültige Werte", async () => {
    daten.metrics.push({ id: "m-5", companyId: "c-1", name: "Headcount", periodStart: "2026-04-01", periodEnd: "2026-06-30", scenario: "ACTUAL", value: "viele" });
    await einrichten({ metrics: { Revenue: "gibt_es_nicht", Headcount: "mitarbeitende_vzae" } });
    const l = (await (await pruefen()).json()) as Lauf;
    const codes = (await befunde(l.id)).map((b) => b.code);
    expect(codes).toContain("metric_unknown");
    expect(codes).toContain("metric_value_invalid");
  });
});

describe("Übernahme aus Vorsystem: Ursprung und Zugang", () => {
  const setze = (quelle: string, settings: object, credential?: string) =>
    t.requestApi(`/import/sources/${quelle}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...(credential ? { credential } : {}), settings }), als: ANNA });

  it("lehnt Ursprünge außerhalb der erlaubten Hosts des Adapters ab", async () => {
    expect((await setze("example", { origin: "https://evil.example" }, ZUGANG)).status).toBe(400);
    expect((await setze("example", { origin: "https://api.example.com:8443" }, ZUGANG)).status).toBe(400);
    expect((await setze("example-env", { origin: "https://evil.example" }, ZUGANG)).status).toBe(400);
    expect((await setze("example-env", { origin: "https://kunde.example.org" }, ZUGANG)).status).toBe(200);
  });

  it("schickt den Zugang aus der Umgebung nur an den Standard-Ursprung", async () => {
    process.env[UMGEBUNG] = "test-only-env-token";
    expect((await setze("example-env", {})).status).toBe(200);
    expect((await t.requestApi("/import/sources/example-env/runs", { method: "POST", als: ANNA })).status).toBe(201);
    expect(new Set(gesendet.map((g) => `${g.origin} ${g.authorization}`))).toEqual(new Set(["https://api.example.com Bearer test-only-env-token"]));
    // Ein anderer Ursprung ohne gespeicherten Zugang wird abgelehnt; mit eigenem Zugang geht nur dieser dorthin.
    expect((await setze("example-env", { origin: "https://kunde.example.org" })).status).toBe(400);
    expect((await setze("example-env", { origin: "https://kunde.example.org" }, ZUGANG)).status).toBe(200);
    gesendet = [];
    await t.requestApi("/import/sources/example-env/runs", { method: "POST", als: ANNA });
    expect(new Set(gesendet.map((g) => `${g.origin} ${g.authorization}`))).toEqual(new Set([`https://kunde.example.org Bearer ${ZUGANG}`]));
  });

  it("verlangt einen neuen Zugang, wenn sich der Ursprung ändert", async () => {
    expect((await setze("example-env", { origin: "https://a.example.org" }, ZUGANG)).status).toBe(200);
    expect((await setze("example-env", { origin: "https://b.example.org" })).status).toBe(400);
    expect((await setze("example-env", { origin: "https://a.example.org", funds: ["f-1"] })).status).toBe(200);
    expect((await setze("example-env", { origin: "https://b.example.org" }, "test-only-other-token")).status).toBe(200);
  });

  it("lässt die Person, die die Verbindung gespeichert hat, nicht übernehmen", async () => {
    const CARLA = person("quelle-carla", { globalVerwalter: true });
    expect((await einrichten({}, ZUGANG, BERTA)).status).toBe(200);
    const l = (await (await pruefen(ANNA)).json()) as Lauf;
    const antwort = await uebernehmen(l.id, BERTA);
    expect(antwort.status).toBe(409);
    expect(await antwort.json()).toMatchObject({ error: { code: "four_eyes_violated" } });
    expect((await uebernehmen(l.id, CARLA)).status).toBe(200);
  });

  it("lässt auch die Person nicht übernehmen, die Zugang und Ursprung gesetzt hat, wenn danach jemand anders nur eine Kleinigkeit speichert", async () => {
    const CARLA = person("quelle-carla", { globalVerwalter: true });
    const DORA = person("quelle-dora", { globalVerwalter: true });
    expect((await einrichten({}, ZUGANG, ANNA)).status).toBe(200);
    expect((await einrichten({ fundShortNames: { "f-2": "BSP-2" } }, null, BERTA)).status).toBe(200);
    const l = (await (await pruefen(CARLA)).json()) as Lauf;
    for (const wer of [ANNA, BERTA, CARLA]) expect((await uebernehmen(l.id, wer)).status).toBe(409);
    expect((await uebernehmen(l.id, DORA)).status).toBe(200);
    // Ein neuer Zugang beginnt die Liste neu.
    expect((await einrichten({}, "test-only-new-token", CARLA)).status).toBe(200);
    const [conn] = await db.select().from(providerConnection);
    expect((conn!.mapping as { editors: string[] }).editors).toHaveLength(1);
  });

  it("lehnt Übernahme und Prüflauf ab, wenn nicht festgehalten ist, wer die Verbindung bearbeitet hat", async () => {
    await einrichten();
    const l = (await (await pruefen()).json()) as Lauf;
    // Lauf ohne Angaben (z. B. aus einem älteren Stand): keine Übernahme.
    await db.execute(sql`UPDATE import_lauf SET vorschau = jsonb_set(vorschau, '{source}', (vorschau->'source') - 'editors') WHERE id = ${l.id}`);
    const antwort = await uebernehmen(l.id);
    expect(antwort.status).toBe(409);
    expect(await antwort.json()).toMatchObject({ error: { code: "import_source_changed" } });
    // Verbindung ohne Angaben: kein neuer Prüflauf, bis sie erneut gespeichert ist.
    await db.execute(sql`UPDATE provider_connection SET mapping = mapping - 'editors'`);
    expect((await pruefen()).status).toBe(409);
    expect((await einrichten({}, null)).status).toBe(200);
    expect((await pruefen()).status).toBe(201);
  });

  it("sperrt die Übernahme, wenn sich die Verbindung nach dem Prüflauf geändert hat", async () => {
    await einrichten();
    const l = (await (await pruefen()).json()) as Lauf;
    expect((await einrichten({ funds: ["f-1"] }, null)).status).toBe(200);
    const antwort = await uebernehmen(l.id);
    expect(antwort.status).toBe(409);
    expect(await antwort.json()).toMatchObject({ error: { code: "import_source_changed" } });
    expect(await db.select().from(organisation)).toHaveLength(0);
  });

  it("API-Schlüssel speichern keine Verbindung und starten keinen Prüflauf", async () => {
    const [f] = await db.insert(fonds).values({ name: "Testfonds", kurzname: "TEST-1", vintage: 2024, zeichnungskapital: "1000000.00" }).returning();
    const schluessel = (await (await t.requestApi("/api-keys", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Job", scopes: [{ fundId: f!.id, permission: "write" }] }), als: ANNA })).json()) as { key?: string };
    expect(schluessel.key).toBeTruthy();
    const mit = (pfad: string, method: string, body?: object) => t.app.request(`/api/v1${pfad}`, { method, headers: { authorization: `Bearer ${schluessel.key}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    for (const antwort of [await mit("/import/sources/example", "PUT", { credential: ZUGANG, settings: {} }), await mit("/import/sources/example/runs", "POST")]) {
      expect(antwort.status).toBe(403);
      expect(await antwort.json()).toMatchObject({ error: { code: "technical_user" } });
    }
  });

  it("verbindet nicht mit privaten Adressen", async () => {
    await einrichten();
    adresse = "10.0.0.5";
    const antwort = await pruefen();
    expect(antwort.status).toBe(502);
    expect(await antwort.json()).toMatchObject({ error: { code: "import_source_read_failed" } });
    expect(gesendet).toEqual([]);
  });
});
