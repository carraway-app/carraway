import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { erzeugeMappe } from "@carraway/import";
import { json, leeren, oeffneTestdb } from "./hilfen";
import { erstelleTestApp, person, type Testperson } from "./hilfen-auth";

const { db, pool } = oeffneTestdb();
const t = erstelleTestApp(db);
const ANNA = person("schreib-anna", { globalVerwalter: true });
const BERTA = person("schreib-berta", { globalVerwalter: true });

const FA = "00000000-0000-4000-8000-0000000000a1";
const FB = "00000000-0000-4000-8000-0000000000b1";
const BA = "00000000-0000-4000-8000-0000000000a2";
const BB = "00000000-0000-4000-8000-0000000000b2";
const ORG = "00000000-0000-4000-8000-0000000000c1";

beforeEach(async () => {
  await leeren(db);
  await db.execute(sql`INSERT INTO fonds (id, name, kurzname, vintage, zeichnungskapital) VALUES (${FA}, 'Fonds Alpha', 'FA', 2021, 10000000), (${FB}, 'Fonds Bravo', 'FB', 2022, 10000000)`);
  await db.execute(sql`INSERT INTO organisation (id, name, art) VALUES (${ORG}, 'Nordlicht Technik', 'unternehmen')`);
  await db.execute(sql`INSERT INTO beteiligung (id, fonds_id, organisation_id, instrument, erstinvestment) VALUES (${BA}, ${FA}, ${ORG}, 'offene_beteiligung', '2022-01-01'), (${BB}, ${FB}, ${ORG}, 'offene_beteiligung', '2022-01-01')`);
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

const post = (pfad: string, koerper: unknown, als: Testperson = ANNA, kopf: Record<string, string> = {}) =>
  t.request(pfad, { method: "POST", headers: { "content-type": "application/json", ...kopf }, body: JSON.stringify(koerper), als });
const vorgang = (beteiligung: string, art: string, betrag: string, als?: Testperson, kopf?: Record<string, string>) => post(`/investments/${beteiligung}/transactions`, { type: art, valueDate: "2022-02-01", amount: betrag }, als, kopf);
const zaehle = async (tabelle: string) => ((await db.execute(sql.raw(`SELECT count(*)::int AS n FROM ${tabelle}`))).rows[0] as { n: number }).n;

describe("Änderungsabfrage", () => {
  async function bestand() {
    for (const [b, betrag] of [[BA, "100.00"], [BA, "50.00"], [BB, "70.00"], [BB, "30.00"], [BA, "10.00"]] as const) {
      expect((await vorgang(b, "commitment", betrag)).status).toBe(201);
    }
    expect((await post("/organisationen", { name: "Sternwind Energie", art: "unternehmen" })).status).toBe(201);
  }
  type Zeile = { id: string; at: string; table: string; action: string; fundId: string | null; recordId: string };
  const lies = async (abfrage: string, als: Testperson = ANNA) => (await json(await t.request(`/changes${abfrage}`, { als })));

  it("seitenweise in fester Reihenfolge ohne Lücken und Doppelte, Cursor führt weiter", async () => {
    await bestand();
    const gesamt = (await lies("?limit=1000")).data as Zeile[];
    expect(gesamt.length).toBe(await zaehle("aenderung WHERE aktion <> 'gelesen'"));
    const gesehen: Zeile[] = [];
    let cursor: string | null = null;
    let seiten = 0;
    for (;;) {
      const seite = await lies(`?limit=2${cursor ? `&cursor=${cursor}` : ""}`);
      gesehen.push(...seite.data);
      cursor = seite.nextCursor;
      seiten++;
      if (!seite.hasMore) break;
    }
    expect(seiten).toBe(Math.ceil(gesamt.length / 2));
    expect(gesehen.map((z) => z.id)).toEqual(gesamt.map((z) => z.id));
    expect(new Set(gesehen.map((z) => z.id)).size).toBe(gesehen.length);
    // Reihenfolge nach Zeitpunkt (Mikrosekunden) und ID
    for (let i = 1; i < gesehen.length; i++) expect(gesehen[i - 1]!.at <= gesehen[i]!.at).toBe(true);
    // Mit dem letzten Cursor kommt nichts mehr, bis etwas Neues geschrieben wird.
    expect((await lies(`?cursor=${cursor}`)).data).toEqual([]);
    expect((await vorgang(BA, "commitment", "1.00")).status).toBe(201);
    const neu = await lies(`?cursor=${cursor}`);
    expect(neu.data).toHaveLength(1);
    expect(neu.data[0]).toMatchObject({ table: "vorgang", action: "anlegen", fundId: FA });
  });

  it("Filter nach Tabelle und Zeitpunkt; Lesezugriffe und Benutzerverwaltung erscheinen nicht", async () => {
    await bestand();
    const nurVorgang = (await lies("?table=vorgang&limit=1000")).data as Zeile[];
    expect(nurVorgang).toHaveLength(5);
    expect(nurVorgang.every((z) => z.table === "vorgang")).toBe(true);
    const zeitpunkt = nurVorgang[2]!.at;
    const ab = (await lies(`?table=vorgang&since=${zeitpunkt}`)).data as Zeile[];
    expect(ab.every((z) => z.at > zeitpunkt)).toBe(true);
    await db.execute(sql`INSERT INTO aenderung (akteur, aktion, tabelle, datensatz_id) VALUES ('x', 'gelesen', 'vorgang', ${BA}), ('x', 'anlegen', 'benutzer', ${BA})`);
    const alle = (await lies("?limit=1000")).data as Zeile[];
    expect(alle.some((z) => z.action === "gelesen" || z.table === "benutzer")).toBe(false);
    expect((await t.request("/changes?table=benutzer", { als: ANNA })).status).toBe(400);
    expect((await t.request("/changes?cursor=kaputt", { als: ANNA })).status).toBe(400);
    expect((await t.request("/changes?since=gestern", { als: ANNA })).status).toBe(400);
  });

  it("gefiltert nach den Fonds der Person: Fonds B bleibt unsichtbar, Kontakte ohne Fonds sind sichtbar", async () => {
    await bestand();
    const carl = person("schreib-carl", { rollen: { [FA]: "bearbeiter" } });
    const daten = (await lies("?limit=1000", carl)).data as Zeile[];
    expect(daten.length).toBeGreaterThan(0);
    expect(daten.every((z) => z.fundId === FA || z.fundId === null)).toBe(true);
    expect(daten.filter((z) => z.table === "vorgang")).toHaveLength(3);
    expect(daten.some((z) => z.fundId === FB || z.recordId === BB)).toBe(false);
    expect(daten.some((z) => z.table === "organisation")).toBe(true);
    // Die Verwalterin sieht beides.
    const alle = (await lies("?limit=1000")).data as Zeile[];
    expect(alle.filter((z) => z.table === "vorgang")).toHaveLength(5);
    // Wer nur Fonds B sieht, bekommt keine Zeile von Fonds A.
    const dora = person("schreib-dora", { rollen: { [FB]: "betrachter" } });
    const doras = (await lies("?limit=1000", dora)).data as Zeile[];
    expect(doras.filter((z) => z.table === "vorgang")).toHaveLength(2);
    // ohne Rolle: 403
    expect((await t.request("/changes", { als: person("schreib-ohne") })).status).toBe(403);
  });

  it("Fonds-ID am Protokoll wird vom Trigger gesetzt (auch für Bewertungen und Beteiligungen), Kontakte bleiben leer", async () => {
    await bestand();
    const zeilen = (await db.execute(sql`SELECT tabelle, fonds_id FROM aenderung WHERE aktion = 'anlegen'`)).rows as { tabelle: string; fonds_id: string | null }[];
    expect(zeilen.filter((z) => z.tabelle === "vorgang").every((z) => z.fonds_id === FA || z.fonds_id === FB)).toBe(true);
    expect(zeilen.find((z) => z.tabelle === "organisation")!.fonds_id).toBeNull();
    expect(await zaehle(`aenderung WHERE fonds_id IS NULL AND tabelle = 'vorgang'`)).toBe(0);
  });
});

describe("geaendertSeit an den Listen", () => {
  const zeitpunkt = async () => ((await db.execute(sql`SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS t`)).rows[0] as { t: string }).t;
  const pause = () => new Promise((r) => setTimeout(r, 30));

  it("Organisationen, Personen und Fonds: nur Angelegtes und Geändertes seit dem Zeitpunkt", async () => {
    await pause();
    const seit = await zeitpunkt();
    await pause();
    const neu = await json(await post("/organisationen", { name: "Sternwind Energie", art: "unternehmen" }));
    const personNeu = await json(await post("/personen", { vorname: "Erika", nachname: "Muster" }));
    const liste = (await json(await t.request(`/organisationen?geaendertSeit=${encodeURIComponent(seit)}`))).daten as { id: string }[];
    expect(liste.map((o) => o.id)).toEqual([neu.id]);
    expect(((await json(await t.request(`/personen?geaendertSeit=${encodeURIComponent(seit)}`))).daten as { id: string }[]).map((p) => p.id)).toEqual([personNeu.id]);
    // Änderung eines älteren Datensatzes taucht über das Protokoll auf.
    const patch = await t.request(`/organisationen/${ORG}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ ort: "Hamburg" }) });
    expect(patch.status).toBe(200);
    const nachher = (await json(await t.request(`/organisationen?geaendertSeit=${encodeURIComponent(seit)}`))).daten as { id: string }[];
    expect(nachher.map((o) => o.id).sort()).toEqual([ORG, neu.id].sort());
    // Fonds: Beginn des Protokolls
    expect(((await json(await t.request(`/fonds?geaendertSeit=${encodeURIComponent(seit)}`))).daten as unknown[]).length).toBe(0);
    expect(((await json(await t.request(`/fonds?geaendertSeit=2000-01-01T00:00:00Z`))).daten as unknown[]).length).toBe(2);
    expect((await t.request("/organisationen?geaendertSeit=gestern")).status).toBe(400);
    expect((await t.request("/fonds?geaendertSeit=gestern")).status).toBe(400);
  });

  it("Deals und Zinsläufe nehmen den Parameter ebenfalls", async () => {
    expect((await t.request(`/deals?geaendertSeit=2000-01-01T00:00:00Z`)).status).toBe(200);
    expect((await t.request(`/zinslaeufe?fondsId=${FA}&geaendertSeit=2000-01-01T00:00:00Z`)).status).toBe(200);
    expect((await t.request(`/reports?geaendertSeit=2000-01-01T00:00:00Z`)).status).toBe(200);
  });
});

describe("Idempotency-Key", () => {
  const org = { name: "Sternwind Energie", art: "unternehmen" };

  it("gleicher Schlüssel und Körper: dieselbe Antwort ohne zweite Ausführung; anderer Körper: 409; je Akteur getrennt", async () => {
    const a = await post("/organisationen", org, ANNA, { "Idempotency-Key": "schluessel-1" });
    expect(a.status).toBe(201);
    expect(a.headers.get("idempotent-replayed")).toBeNull();
    const erste = await json(a);
    const b = await post("/organisationen", org, ANNA, { "Idempotency-Key": "schluessel-1" });
    expect(b.status).toBe(201);
    expect(b.headers.get("idempotent-replayed")).toBe("true");
    expect(await json(b)).toEqual(erste);
    expect(await zaehle("organisation WHERE name = 'Sternwind Energie'")).toBe(1);
    const c = await post("/organisationen", { ...org, ort: "Köln" }, ANNA, { "Idempotency-Key": "schluessel-1" });
    expect(c.status).toBe(409);
    expect((await json(c)).error.code).toBe("idempotency_conflict");
    // anderer Pfad mit demselben Schlüssel ist ebenfalls ein Konflikt
    expect((await post("/personen", { vorname: "A", nachname: "B" }, ANNA, { "Idempotency-Key": "schluessel-1" })).status).toBe(409);
    // anderer Akteur, gleicher Schlüssel: eigene Anfrage
    const d = await post("/organisationen", { ...org, name: "Andere Firma" }, BERTA, { "Idempotency-Key": "schluessel-1" });
    expect(d.status).toBe(201);
    expect(await zaehle("organisation WHERE name IN ('Sternwind Energie', 'Andere Firma')")).toBe(2);
  });

  it("auch Fehlerantworten (4xx) werden wiedergegeben; ohne Schlüssel führt jede Anfrage aus; ungültiger Schlüssel: 400", async () => {
    const schlecht = { name: "", art: "unternehmen" };
    const a = await post("/organisationen", schlecht, ANNA, { "Idempotency-Key": "k-fehler" });
    expect(a.status).toBe(400);
    const b = await post("/organisationen", schlecht, ANNA, { "Idempotency-Key": "k-fehler" });
    expect(b.status).toBe(400);
    expect(b.headers.get("idempotent-replayed")).toBe("true");
    expect(await json(b)).toEqual(await json(a));
    await post("/organisationen", org);
    await post("/organisationen", { ...org, dubletteBestaetigt: true });
    expect(await zaehle("organisation WHERE name = 'Sternwind Energie'")).toBe(2);
    expect((await post("/organisationen", org, ANNA, { "Idempotency-Key": "mit leerzeichen" })).status).toBe(400);
    expect((await post("/organisationen", org, ANNA, { "Idempotency-Key": "x".repeat(201) })).status).toBe(400);
  });

  it("läuft die erste Anfrage noch: 409 idempotency_in_progress; nach 24 Stunden gilt der Schlüssel nicht mehr", async () => {
    await t.request("/fonds", { als: ANNA }); // legt die Person an
    const id = ((await db.execute(sql`SELECT id FROM benutzer WHERE email = ${ANNA.email}`)).rows[0] as { id: string }).id;
    const koerperHash = createHash("sha256").update(JSON.stringify({ name: org.name, kind: "company" })).digest("hex");
    const anfrageHash = createHash("sha256").update(`POST\n/organizations\n${koerperHash}`).digest("hex");
    await db.execute(sql`INSERT INTO idempotenz_schluessel (akteur, schluessel, methode, pfad, anfrage_hash) VALUES (${id}, 'laeuft', 'POST', '/organizations', ${anfrageHash})`);
    const a = await post("/organisationen", org, ANNA, { "Idempotency-Key": "laeuft" });
    expect(a.status).toBe(409);
    expect((await json(a)).error.code).toBe("idempotency_in_progress");
    expect(a.headers.get("retry-after")).toBe("1");
    expect(await zaehle("organisation WHERE name = 'Sternwind Energie'")).toBe(0);
    await db.execute(sql`DELETE FROM idempotenz_schluessel`);
    const erste = await post("/organisationen", org, ANNA, { "Idempotency-Key": "alt" });
    expect(erste.status).toBe(201);
    // Nach 24 Stunden wird die Antwort verworfen: dieselbe Anfrage läuft neu und trifft jetzt die Dublette der ersten Anlage.
    await db.execute(sql`UPDATE idempotenz_schluessel SET erstellt_am = now() - interval '25 hours'`);
    const neu = await post("/organisationen", org, ANNA, { "Idempotency-Key": "alt" });
    expect(neu.status).toBe(409);
    expect((await json(neu)).error.code).toBe("possible_duplicate");
  });

  it("Antwort ist gespeichert (Status, Text, Hash); Serverfehler geben den Schlüssel frei", async () => {
    await post("/organisationen", org, ANNA, { "Idempotency-Key": "speicher" });
    const zeile = (await db.execute(sql`SELECT status, antwort, antwort_hash FROM idempotenz_schluessel WHERE schluessel = 'speicher'`)).rows[0] as { status: number; antwort: string; antwort_hash: string };
    expect(zeile.status).toBe(201);
    expect(zeile.antwort).toContain("Sternwind Energie");
    expect(zeile.antwort_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("Upload (multipart): derselbe Inhalt mit anderem Trennzeichen ist dieselbe Anfrage", async () => {
    const datei = await erzeugeMappe("de", {});
    const hochladen = () => {
      const f = new FormData();
      f.append("datei", new File([new Uint8Array(datei)], "leer.xlsx"));
      return t.request("/import/runs", { method: "POST", body: f, headers: { "Idempotency-Key": "upload-1" }, als: ANNA });
    };
    const a = await hochladen();
    const b = await hochladen();
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.headers.get("idempotent-replayed")).toBe("true");
    expect((await json(a)).id).toBe((await json(b)).id);
    expect(await zaehle("import_lauf")).toBe(1);
  });
});

describe("Stapel", () => {
  const stapel = (operationen: unknown[], als: Testperson = ANNA, kopf: Record<string, string> = {}) => post("/batch", { operations: operationen }, als, kopf);
  const op = (methode: string, pfad: string, koerper?: unknown) => ({ method: methode, path: pfad, ...(koerper === undefined ? {} : { body: koerper }) });

  it("führt mehrere Schreibaufrufe in einer Transaktion aus; spätere Operationen sehen frühere", async () => {
    const antwort = await stapel([
      op("POST", `/investments/${BA}/transactions`, { type: "commitment", valueDate: "2022-02-01", amount: "100.00" }),
      op("POST", `/investments/${BA}/transactions`, { type: "disbursement", valueDate: "2022-03-01", amount: "100.00" }),
      op("POST", "/organizations", { name: "Sternwind Energie", kind: "company" }),
      op("POST", "/people", { firstName: "Erika", lastName: "Muster" }),
    ]);
    expect(antwort.status).toBe(200);
    const k = await json(antwort);
    expect(k.results.map((e: { status: number }) => e.status)).toEqual([201, 201, 201, 201]);
    expect(k.results[1].body.bookValue).toBe("100.00");
    expect(await zaehle("vorgang")).toBe(2);
    expect(await zaehle("organisation")).toBe(2);
    // Protokollzeilen im selben Zug
    expect(await zaehle("aenderung WHERE aktion = 'anlegen' AND tabelle IN ('vorgang', 'organisation', 'person')")).toBe(4);
  });

  it("alles oder nichts: ein Fehler rollt alles zurück, alle Fehler werden gesammelt", async () => {
    const antwort = await stapel([
      op("POST", "/organizations", { name: "Sternwind Energie", kind: "company" }),
      op("POST", `/investments/${BA}/transactions`, { type: "disbursement", valueDate: "2022-03-01", amount: "999.00" }), // über der Zusage
      op("POST", "/organizations", { name: "", kind: "company" }), // ungültig
      op("POST", `/investments/${BA}/transactions`, { type: "commitment", valueDate: "2022-02-01", amount: "10.00" }),
    ]);
    expect(antwort.status).toBe(409);
    const f = (await json(antwort)).error;
    expect(f.code).toBe("batch_failed");
    expect(f.operations).toHaveLength(4);
    expect(f.operations.map((o: { ok: boolean }) => o.ok)).toEqual([true, false, false, true]);
    expect(f.operations[0].rolledBack).toBe(true);
    expect(f.operations[1].error.code).toBe("disbursement_exceeds_commitment");
    expect(f.operations[2].error.code).toBe("invalid_input");
    expect(f.operations[2].error.fields[0].field).toBe("name");
    expect(await zaehle("vorgang")).toBe(0);
    expect(await zaehle("organisation")).toBe(1);
    expect(await zaehle("aenderung WHERE aktion = 'anlegen'")).toBe(0);
  });

  it("Rechte gelten je Operation: eine Operation an einem fremden Fonds bricht den Stapel", async () => {
    const carl = person("schreib-carl2", { rollen: { [FA]: "bearbeiter" } });
    const antwort = await stapel(
      [op("POST", `/investments/${BA}/transactions`, { type: "commitment", valueDate: "2022-02-01", amount: "10.00" }), op("POST", `/investments/${BB}/transactions`, { type: "commitment", valueDate: "2022-02-01", amount: "10.00" })],
      carl,
    );
    expect(antwort.status).toBe(409);
    const f = (await json(antwort)).error;
    expect(f.operations[1]).toMatchObject({ ok: false, status: 403, error: { code: "forbidden" } });
    expect(await zaehle("vorgang")).toBe(0);
    // ohne Rolle: gar kein Zugang
    expect((await stapel([op("POST", "/organizations", { name: "X Y", kind: "company" })], person("schreib-ohne2"))).status).toBe(403);
  });

  it("nicht erlaubte und ungültige Operationen: 400 mit Feldern, Grenzen", async () => {
    for (const pfad of ["/batch", "/import/runs", "/auth/sign-in/email", "/reports", "/users", "/api-keys", "/export", "/../organisationen", "/organisationen?x=1"]) {
      const a = await stapel([op("POST", pfad, {})]);
      expect(a.status, pfad).toBe(400);
      expect((await json(a)).error.code).toBe("invalid_input");
    }
    expect((await stapel([])).status).toBe(400);
    expect((await stapel(Array.from({ length: 101 }, () => op("POST", "/people", { firstName: "A", lastName: "B" })))).status).toBe(400);
    expect((await stapel([{ method: "GET", path: "/fonds" }])).status).toBe(400);
    const hundert = await stapel(Array.from({ length: 100 }, (_, i) => op("POST", "/people", { firstName: "Person", lastName: `Nr${i}`, duplicateConfirmed: true })));
    expect(hundert.status).toBe(200);
    expect(await zaehle("person")).toBe(100);
  });

  it("unbekannte Wege einzeln gemeldet; Stapel mit Idempotency-Key wird wiedergegeben; Stapel in einem Stapel geht nicht", async () => {
    const a = await stapel([op("POST", "/gibt-es-nicht", {})]);
    expect(a.status).toBe(409);
    expect((await json(a)).error.operations[0]).toMatchObject({ ok: false, status: 403 });
    const k = { "Idempotency-Key": "stapel-1" };
    const ersterLauf = await stapel([op("POST", "/people", { firstName: "Erika", lastName: "Muster" })], ANNA, k);
    const zweiterLauf = await stapel([op("POST", "/people", { firstName: "Erika", lastName: "Muster" })], ANNA, k);
    expect(zweiterLauf.headers.get("idempotent-replayed")).toBe("true");
    expect(await json(zweiterLauf)).toEqual(await json(ersterLauf));
    expect(await zaehle("person")).toBe(1);
  });

  it("Startpasswort-Sperre und Origin-Prüfung gelten auch im Stapel (Cookie ohne Origin wird abgelehnt)", async () => {
    const roh = await t.request("/batch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operations: [op("POST", "/people", { firstName: "A", lastName: "B" })] }), origin: null });
    expect(roh.status).toBe(403);
    expect((await json(roh)).error.code).toBe("origin_invalid");
    expect(await zaehle("person")).toBe(0);
  });
});
