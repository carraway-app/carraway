import { sql } from "drizzle-orm";
import type { Context } from "hono";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as s from "@carraway/db";
import { erzeugeDemodaten, schreibeDemodaten } from "@carraway/db/demo";
import { erstelleTestApp, idVon, legePersonAn, person, STANDARD, type Testperson } from "./hilfen-auth";
import { akteurAus, schreibe } from "../schreiben";
import { json, leeren, oeffneTestdb } from "./hilfen";

const { db, pool } = oeffneTestdb();
const app = erstelleTestApp(db);

const FONDS = "00000000-0000-4000-8000-0000000000f1";
const FONDS2 = "00000000-0000-4000-8000-0000000000f2";
const FREMD = "00000000-0000-4000-8000-0000000000ff";

/** Eine zweite Person für zustimmende Beschlüsse: Der Übergang ins Portfolio braucht eine andere Person als die, die zugestimmt hat (Vier-Augen-Prinzip). */
const FREIGEBER = person("freigeber", { globalVerwalter: true });

const senden = (methode: string, pfad: string, body?: unknown, kopf: Record<string, string> = {}, als?: Testperson) =>
  app.request(`/api/v1${pfad}`, {
    ...(als ? { als } : {}),
    method: methode,
    headers: { "content-type": "application/json", ...kopf },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const post = (pfad: string, body?: unknown, kopf?: Record<string, string>, als?: Testperson) => senden("POST", pfad, body, kopf, als);
const patch = (pfad: string, body: unknown) => senden("PATCH", pfad, body);
const hole = (pfad: string) => app.request(`/api/v1${pfad}`);

const zeilen = async <T = Record<string, unknown>>(abfrage: ReturnType<typeof sql>) => (await db.execute(abfrage)).rows as T[];
const anzahl = async (tabelle: string) => Number((await zeilen<{ n: number }>(sql.raw(`SELECT count(*)::int AS n FROM "${tabelle}"`)))[0]?.n);
const protokoll = (tabelle: string, datensatzId?: string) =>
  zeilen<{ aktion: string; akteur: string; tabelle: string; datensatz_id: string; vorher: any; nachher: any }>( // eslint-disable-line @typescript-eslint/no-explicit-any
    datensatzId
      ? sql`SELECT * FROM aenderung WHERE tabelle = ${tabelle} AND datensatz_id = ${datensatzId} ORDER BY am, id`
      : sql`SELECT * FROM aenderung WHERE tabelle = ${tabelle} ORDER BY am, id`,
  );

/** Legt Organisation, Deal (per API) an und liefert die Ids. */
async function neuerDeal(name = "Alpha Beispiel", extra: Record<string, unknown> = {}) {
  const antwort = await post("/deals", { titel: `${name}, Seed-Runde`, organisation: { name, art: "unternehmen" }, dubletteBestaetigt: true, ...extra });
  expect(antwort.status).toBe(201);
  const d = await json(antwort);
  return { id: d.id as string, organisationId: d.organisationId as string };
}

const zustimmung = (dealId: string) =>
  post(`/deals/${dealId}/beschluesse`, { gremium: "Investitionsausschuss", datum: "2026-03-01", ergebnis: "zugestimmt", fondsId: FONDS, betrag: "1000000.00" }, {}, FREIGEBER);

beforeAll(async () => {
  await leeren(db);
});
beforeEach(async () => {
  await leeren(db);
  await db.insert(s.fonds).values([
    { id: FONDS, name: "Testfonds Eins", kurzname: "TF1", vintage: 2024, zeichnungskapital: "10000000.00" },
    { id: FONDS2, name: "Testfonds Zwei", kurzname: "TF2", vintage: 2025, zeichnungskapital: "5000000.00" },
  ]);
});
afterEach(() => {
  vi.unstubAllEnvs();
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

describe("Organisationen schreiben", () => {
  it("POST legt an, schreibt Protokoll mit der Benutzer-ID und dem Namen und antwortet 201; ein gesendeter X-Akteur zählt nicht", async () => {
    const antwort = await post("/organisationen", { name: "  Velmora Robotik GmbH ", art: "unternehmen", sektor: "Robotik" }, { "X-Akteur": "Beispiel Person" });
    expect(antwort.status).toBe(201);
    const org = await json(antwort);
    expect(org).toMatchObject({ name: "Velmora Robotik GmbH", art: "unternehmen", sektor: "Robotik" });
    const [zeile, ...rest] = await protokoll("organisation", org.id);
    expect(rest).toHaveLength(0);
    expect(zeile).toMatchObject({ aktion: "anlegen", akteur: await idVon(db, STANDARD), akteur_name: STANDARD.name, vorher: null });
    expect(zeile?.nachher).toMatchObject({ id: org.id, name: "Velmora Robotik GmbH" });
  });

  it("mit AKTEUR_HEADER_VERTRAUEN=1 gilt X-Akteur nur dort, wo es keine angemeldete Person gibt (kein Weg über die Routen)", async () => {
    vi.stubEnv("AKTEUR_HEADER_VERTRAUEN", "1");
    const org = await json(await post("/organisationen", { name: "Nordwind Technik", art: "unternehmen" }, { "X-Akteur": "Beispiel Person" }));
    expect((await protokoll("organisation", org.id))[0]?.akteur).toBe(await idVon(db, STANDARD));
    const ohnePerson = (kopf?: string) => ({ get: () => undefined, req: { header: () => kopf } }) as unknown as Context;
    expect(akteurAus(ohnePerson(" Beispiel Person "))).toBe("Beispiel Person");
    expect(akteurAus(ohnePerson("x".repeat(500)))).toHaveLength(200);
    expect(akteurAus(ohnePerson(undefined))).toBe("system");
    vi.stubEnv("AKTEUR_HEADER_VERTRAUEN", "");
    expect(akteurAus(ohnePerson("Beispiel Person"))).toBe("system");
  });

  it("400 sammelt alle Feldfehler", async () => {
    const antwort = await post("/organisationen", { name: "   ", art: "unbekannt", website: 5 });
    expect(antwort.status).toBe(400);
    const { error: fehler } = await json(antwort);
    expect(fehler.code).toBe("invalid_input");
    expect(fehler.fields.map((f: { field: string }) => f.field).sort()).toEqual(["art", "name", "website"]);
    expect(await anzahl("organisation")).toBe(0);
    expect(await anzahl("aenderung")).toBe(0);
  });

  it("409 possible_duplicate mit Kandidaten, nichts wird geschrieben; Bestätigung legt trotzdem an", async () => {
    const vorhanden = await json(await post("/organisationen", { name: "Velmora Robotik GmbH", art: "unternehmen" }));
    const antwort = await post("/organisationen", { name: "velmora robotik", art: "unternehmen" });
    expect(antwort.status).toBe(409);
    const { error: fehler } = await json(antwort);
    expect(fehler.code).toBe("possible_duplicate");
    expect(fehler.kandidaten).toHaveLength(1);
    expect(fehler.kandidaten[0]).toMatchObject({ id: vorhanden.id, name: "Velmora Robotik GmbH" });
    expect(fehler.kandidaten[0].score).toBeGreaterThanOrEqual(0.9);
    expect(await anzahl("organisation")).toBe(1);
    expect(await anzahl("aenderung")).toBe(1);

    const bestaetigt = await post("/organisationen", { name: "velmora robotik", art: "unternehmen", dubletteBestaetigt: true });
    expect(bestaetigt.status).toBe(201);
    expect(await anzahl("organisation")).toBe(2);
  });

  it("GET /organisationen/dubletten findet 'Velmora Robotik GmbH' für 'velmora robotik'", async () => {
    await db.insert(s.organisation).values([
      { name: "Velmora Robotik GmbH", art: "unternehmen" },
      { name: "Nordwind Technik AG", art: "unternehmen" },
      { name: "Velmora Robotik GmbH & Co. KG", art: "unternehmen", ort: "Beispielstadt" },
    ]);
    const antwort = await hole("/organisationen/dubletten?name=velmora%20robotik");
    expect(antwort.status).toBe(200);
    const { daten } = await json(antwort);
    expect(daten.map((d: { name: string }) => d.name).sort()).toEqual(["Velmora Robotik GmbH", "Velmora Robotik GmbH & Co. KG"]);
    for (const d of daten) expect(d.score).toBe(1);
    const ohne = await json(await hole("/organisationen/dubletten?name=Zufallsname%20Bau"));
    expect(ohne.daten).toEqual([]);
    const aehnlich = await json(await hole("/organisationen/dubletten?name=Velmora%20Robotics"));
    expect(aehnlich.daten.length).toBeGreaterThan(0);
    expect(aehnlich.daten[0].score).toBeLessThan(1);
  });

  it("GET /organisationen/dubletten ohne Name liefert 400", async () => {
    const antwort = await hole("/organisationen/dubletten");
    expect(antwort.status).toBe(400);
    expect((await json(antwort)).error.fields[0].field).toBe("name");
  });

  it("PATCH ändert Felder, protokolliert vorher und nachher, leert mit null", async () => {
    const [org] = await db.insert(s.organisation).values({ name: "Corvan Systeme", art: "unternehmen", ort: "Altstadt" }).returning();
    const antwort = await patch(`/organisationen/${org!.id}`, { sektor: "Software", ort: null });
    expect(antwort.status).toBe(200);
    expect(await json(antwort)).toMatchObject({ name: "Corvan Systeme", sektor: "Software", ort: null });
    const [zeile] = await protokoll("organisation", org!.id);
    expect(zeile).toMatchObject({ aktion: "aendern" });
    expect(zeile?.vorher).toMatchObject({ ort: "Altstadt", sektor: null });
    expect(zeile?.nachher).toMatchObject({ ort: null, sektor: "Software" });
  });

  it("PATCH: 404 bei unbekannter Id, 400 ohne Feld oder mit falscher Id", async () => {
    expect((await patch(`/organisationen/${FREMD}`, { name: "Neu" })).status).toBe(404);
    expect((await json(await patch(`/organisationen/${FREMD}`, { name: "Neu" }))).error.code).toBe("organization_not_found");
    expect((await patch(`/organisationen/${FREMD}`, {})).status).toBe(400);
    expect((await patch("/organisationen/keine-id", { name: "Neu" })).status).toBe(400);
  });
});

describe("Website nur http und https", () => {
  it("lehnt javascript: ab und nimmt https an (POST und PATCH Organisation, Deal mit neuer Organisation)", async () => {
    const schlecht = await post("/organisationen", { name: "Web Beispiel", art: "unternehmen", website: "javascript:alert(1)" });
    expect(schlecht.status).toBe(400);
    const fehler = (await json(schlecht)).error;
    expect(fehler.code).toBe("invalid_input");
    expect(fehler.fields[0].field).toBe("website");
    expect((await post("/organisationen", { name: "Web Beispiel", art: "unternehmen", website: "ftp://x.example" })).status).toBe(400);
    expect((await post("/organisationen", { name: "Web Beispiel", art: "unternehmen", website: "www.beispiel.example" })).status).toBe(400);
    const gut = await post("/organisationen", { name: "Web Beispiel", art: "unternehmen", website: "https://www.beispiel.example" });
    expect(gut.status).toBe(201);
    const { id } = await json(gut);
    expect((await patch(`/organisationen/${id}`, { website: "javascript:alert(1)" })).status).toBe(400);
    expect((await patch(`/organisationen/${id}`, { website: "http://neu.example" })).status).toBe(200);
    expect((await patch(`/organisationen/${id}`, { website: null })).status).toBe(200);
    const deal = await post("/deals", { titel: "Web Deal", organisation: { name: "Web Zwei", website: "javascript:alert(1)" } });
    expect(deal.status).toBe(400);
    expect((await json(deal)).error.fields[0].field).toBe("organisation.website");
  });
});

describe("Personen", () => {
  it("POST legt an und protokolliert; GET filtert nach Organisation", async () => {
    const [org] = await db.insert(s.organisation).values({ name: "Alpha Beispiel", art: "unternehmen" }).returning();
    const [andere] = await db.insert(s.organisation).values({ name: "Beta Beispiel", art: "unternehmen" }).returning();
    const antwort = await post("/personen", { vorname: "Erika", nachname: "Muster", email: "erika@beispiel.example", organisationId: org!.id });
    expect(antwort.status).toBe(201);
    const p = await json(antwort);
    expect((await protokoll("person", p.id))[0]).toMatchObject({ aktion: "anlegen" });
    await post("/personen", { vorname: "Max", nachname: "Beispiel", organisationId: andere!.id });
    await post("/personen", { vorname: "Ohne", nachname: "Organisation" });

    const alle = await json(await hole("/personen"));
    expect(alle.daten).toHaveLength(3);
    const gefiltert = await json(await hole(`/personen?organisationId=${org!.id}`));
    expect(gefiltert.daten).toHaveLength(1);
    expect(gefiltert.daten[0]).toMatchObject({ vorname: "Erika", organisation: { id: org!.id, name: "Alpha Beispiel" } });
    expect((await hole("/personen?organisationId=nix")).status).toBe(400);
  });

  it("POST: 400 sammelt Fehler, 404 bei unbekannter Organisation", async () => {
    const antwort = await post("/personen", { vorname: "", email: "kaputt" });
    expect(antwort.status).toBe(400);
    const felder = (await json(antwort)).error.fields.map((f: { field: string }) => f.field).sort();
    expect(felder).toEqual(["email", "nachname", "vorname"]);
    const fremd = await post("/personen", { vorname: "A", nachname: "B", organisationId: FREMD });
    expect(fremd.status).toBe(404);
    expect((await json(fremd)).error.code).toBe("organization_not_found");
    expect(await anzahl("person")).toBe(0);
  });

  it("PATCH ändert, protokolliert vorher/nachher; 404 und 400", async () => {
    const [p] = await db.insert(s.person).values({ vorname: "Erika", nachname: "Muster", funktion: "Leitung" }).returning();
    const antwort = await patch(`/personen/${p!.id}`, { funktion: "Geschäftsführung" });
    expect(antwort.status).toBe(200);
    const [zeile] = await protokoll("person", p!.id);
    expect(zeile?.vorher).toMatchObject({ funktion: "Leitung" });
    expect(zeile?.nachher).toMatchObject({ funktion: "Geschäftsführung" });
    expect((await patch(`/personen/${FREMD}`, { funktion: "x" })).status).toBe(404);
    expect((await patch(`/personen/${p!.id}`, {})).status).toBe(400);
    expect((await patch(`/personen/${p!.id}`, { organisationId: FREMD })).status).toBe(404);
  });
});

describe("Deals anlegen und ändern", () => {
  it("POST mit bestehender Organisation legt Deal und ersten Phaseneintrag an", async () => {
    const [org] = await db.insert(s.organisation).values({ name: "Alpha Beispiel", art: "unternehmen" }).returning();
    const antwort = await post("/deals", { titel: "Alpha, Seed", organisationId: org!.id, ticket: "750000.50", quelle: "Empfehlung", fondsId: FONDS });
    expect(antwort.status).toBe(201);
    const d = await json(antwort);
    expect(d).toMatchObject({ phase: "anfrage", status: "offen", ticket: "750000.50", fondsId: FONDS });
    const verlauf = await zeilen(sql`SELECT von_phase, nach_phase FROM deal_phasenwechsel WHERE deal_id = ${d.id}`);
    expect(verlauf).toEqual([{ von_phase: null, nach_phase: "anfrage" }]);
    expect(await protokoll("deal", d.id)).toHaveLength(1);
    expect(await anzahl("aenderung")).toBe(2);
  });

  it("POST legt die Organisation inline an, alles in einer Transaktion mit Protokoll", async () => {
    const antwort = await post("/deals", { titel: "Neu, Seed", organisation: { name: "Lumeo Energie", sektor: "Energie" } });
    expect(antwort.status).toBe(201);
    const d = await json(antwort);
    expect(d.organisation).toMatchObject({ name: "Lumeo Energie", art: "unternehmen", sektor: "Energie" });
    expect((await protokoll("organisation", d.organisationId))[0]).toMatchObject({ aktion: "anlegen" });
    expect(await anzahl("aenderung")).toBe(3);
  });

  it("POST mit inline-Organisation prüft Dubletten; nichts wird geschrieben", async () => {
    await db.insert(s.organisation).values({ name: "Velmora Robotik GmbH", art: "unternehmen" });
    const antwort = await post("/deals", { titel: "Velmora, Seed", organisation: { name: "Velmora Robotik" } });
    expect(antwort.status).toBe(409);
    expect((await json(antwort)).error.code).toBe("possible_duplicate");
    expect(await anzahl("deal")).toBe(0);
    expect(await anzahl("organisation")).toBe(1);
    expect(await anzahl("aenderung")).toBe(0);
  });

  it("POST: 400 bei fehlender oder doppelter Organisationsangabe und ungültigem Betrag, 404 bei Fremd-Ids", async () => {
    const keine = await post("/deals", { titel: "x" });
    expect(keine.status).toBe(400);
    const beide = await post("/deals", { titel: "x", organisationId: FREMD, organisation: { name: "y" } });
    expect(beide.status).toBe(400);
    const sammeln = await post("/deals", { titel: "", ticket: "1,5", organisationId: "nix" });
    expect(sammeln.status).toBe(400);
    expect((await json(sammeln)).error.fields.map((f: { field: string }) => f.field).sort()).toEqual(["organisationId", "ticket", "titel"]);
    expect((await post("/deals", { titel: "x", organisationId: FREMD })).status).toBe(404);
    const [org] = await db.insert(s.organisation).values({ name: "Alpha Beispiel", art: "unternehmen" }).returning();
    const fonds = await post("/deals", { titel: "x", organisationId: org!.id, fondsId: FREMD });
    expect(fonds.status).toBe(404);
    expect((await json(fonds)).error.code).toBe("fund_not_found");
    expect(await anzahl("deal")).toBe(0);
  });

  it("PATCH ändert Titel, Ticket, Quelle, Betreuung, Fonds mit Protokoll", async () => {
    const { id } = await neuerDeal();
    const antwort = await patch(`/deals/${id}`, { titel: "Neuer Titel", ticket: "1200000.00", quelle: "Messe", betreuung: "Person A", fondsId: FONDS });
    expect(antwort.status).toBe(200);
    expect(await json(antwort)).toMatchObject({ titel: "Neuer Titel", ticket: "1200000.00", quelle: "Messe", betreuung: "Person A", fondsId: FONDS });
    const eintraege = await protokoll("deal", id);
    expect(eintraege.at(-1)).toMatchObject({ aktion: "aendern" });
    expect(eintraege.at(-1)?.vorher).toMatchObject({ titel: "Alpha Beispiel, Seed-Runde", ticket: null });
    expect(eintraege.at(-1)?.nachher).toMatchObject({ titel: "Neuer Titel", ticket: "1200000.00" });
    expect((await patch(`/deals/${id}`, { ticket: null })).status).toBe(200);
  });

  it("PATCH: 404, 400 und 404 für unbekannten Fonds", async () => {
    const { id } = await neuerDeal();
    expect((await patch(`/deals/${FREMD}`, { titel: "x" })).status).toBe(404);
    expect((await patch(`/deals/${id}`, {})).status).toBe(400);
    expect((await patch(`/deals/${id}`, { ticket: "-5" })).status).toBe(400);
    expect((await patch(`/deals/${id}`, { fondsId: FREMD })).status).toBe(404);
  });
});

describe("Deals ändern nur solange offen", () => {
  it("PATCH auf abgesagten oder investierten Deal ist 409 deal_not_open und ändert nichts", async () => {
    const { id } = await neuerDeal();
    await post(`/deals/${id}/absage`, { grund: "Passt nicht" });
    const antwort = await patch(`/deals/${id}`, { titel: "Anders" });
    expect(antwort.status).toBe(409);
    expect((await json(antwort)).error.code).toBe("deal_not_open");
    expect((await json(await hole(`/deals/${id}`))).titel).toBe("Alpha Beispiel, Seed-Runde");
    await post(`/deals/${id}/wiederaufnahme`);
    expect((await patch(`/deals/${id}`, { titel: "Anders" })).status).toBe(200);

    const { id: zweiter } = await neuerDeal("Beta Beispiel");
    await zustimmung(zweiter);
    expect((await post(`/deals/${zweiter}/beteiligung`, { fondsId: FONDS, instrument: "offene_beteiligung", erstinvestment: "2026-04-01" })).status).toBe(201);
    const investiert = await patch(`/deals/${zweiter}`, { titel: "Anders" });
    expect(investiert.status).toBe(409);
    expect((await json(investiert)).error.code).toBe("deal_not_open");
  });
});

describe("Phasen, Absage und Wiederaufnahme", () => {
  it("Phasenwechsel schreibt Verlauf und aktualisiert den Deal", async () => {
    const { id } = await neuerDeal();
    const a = await post(`/deals/${id}/phase`, { nachPhase: "erstgespraech", am: "2030-03-02", bemerkung: "Gespräch geführt" });
    expect(a.status).toBe(200);
    expect((await json(a)).deal).toMatchObject({ phase: "erstgespraech", status: "offen" });
    await post(`/deals/${id}/phase`, { nachPhase: "pruefung", am: "2030-03-10" });
    await post(`/deals/${id}/phase`, { nachPhase: "erstgespraech", am: "2030-03-12", bemerkung: "zurück" });
    const verlauf = await zeilen(sql`SELECT von_phase, nach_phase, am::text, bemerkung FROM deal_phasenwechsel WHERE deal_id = ${id} ORDER BY am, erfasst_am`);
    expect(verlauf.map((v) => [v.von_phase, v.nach_phase, v.am])).toEqual([
      [null, "anfrage", expect.any(String)],
      ["anfrage", "erstgespraech", "2030-03-02"],
      ["erstgespraech", "pruefung", "2030-03-10"],
      ["pruefung", "erstgespraech", "2030-03-12"],
    ]);
    expect(verlauf[1]?.bemerkung).toBe("Gespräch geführt");
    const eintraege = (await protokoll("deal", id)).filter((e) => e.aktion === "phasenwechsel");
    expect(eintraege).toHaveLength(3);
    expect(eintraege[0]?.vorher).toMatchObject({ phase: "anfrage" });
    expect(eintraege[0]?.nachher).toMatchObject({ phase: "erstgespraech" });
    expect((await protokoll("deal_phasenwechsel")).length).toBe(4);
  });

  it("Phasenwechsel: 409 bei gleicher Phase, 400 bei ungültiger Phase, 404", async () => {
    const { id } = await neuerDeal();
    const gleich = await post(`/deals/${id}/phase`, { nachPhase: "anfrage" });
    expect(gleich.status).toBe(409);
    expect((await json(gleich)).error.code).toBe("stage_unchanged");
    const ungueltig = await post(`/deals/${id}/phase`, { nachPhase: "irgendwo", am: "gestern" });
    expect(ungueltig.status).toBe(400);
    expect((await json(ungueltig)).error.fields.map((f: { field: string }) => f.field).sort()).toEqual(["am", "nachPhase"]);
    expect((await post(`/deals/${FREMD}/phase`, { nachPhase: "pruefung" })).status).toBe(404);
  });

  it("Closing ohne zustimmenden Beschluss wird mit 409 resolution_missing abgelehnt, auch bei Ablehnung oder Vertagung", async () => {
    const { id } = await neuerDeal();
    const ohne = await post(`/deals/${id}/phase`, { nachPhase: "closing" });
    expect(ohne.status).toBe(409);
    expect((await json(ohne)).error.code).toBe("resolution_missing");
    await post(`/deals/${id}/beschluesse`, { gremium: "Investitionsausschuss", datum: "2026-03-01", ergebnis: "abgelehnt" });
    await post(`/deals/${id}/beschluesse`, { gremium: "Investitionsausschuss", datum: "2026-03-02", ergebnis: "vertagt" });
    expect((await post(`/deals/${id}/phase`, { nachPhase: "closing" })).status).toBe(409);
    expect((await json(await hole(`/deals/${id}`))).phase).toBe("anfrage");
    expect(await anzahl("deal_phasenwechsel")).toBe(1);

    // Ein älterer Beschluss hebt die spätere Vertagung nicht auf, erst ein neuerer zustimmender.
    expect((await zustimmung(id)).status).toBe(201);
    expect((await post(`/deals/${id}/phase`, { nachPhase: "closing" })).status).toBe(409);
    await post(`/deals/${id}/beschluesse`, { gremium: "Investitionsausschuss", datum: "2026-03-03", ergebnis: "zugestimmt", fondsId: FONDS }, {}, FREIGEBER);
    const mit = await post(`/deals/${id}/phase`, { nachPhase: "closing" });
    expect(mit.status).toBe(200);
    expect((await json(mit)).deal.phase).toBe("closing");
  });

  it("Zustimmung, danach Ablehnung: Closing ist wieder 409; ein noch späterer Beschluss zählt", async () => {
    const { id } = await neuerDeal();
    await zustimmung(id);
    await post(`/deals/${id}/beschluesse`, { gremium: "Investitionsausschuss", datum: "2026-03-05", ergebnis: "abgelehnt" });
    const antwort = await post(`/deals/${id}/phase`, { nachPhase: "closing" });
    expect(antwort.status).toBe(409);
    expect((await json(antwort)).error.code).toBe("resolution_missing");
    await post(`/deals/${id}/beschluesse`, { gremium: "Investitionsausschuss", datum: "2026-03-10", ergebnis: "zugestimmt", fondsId: FONDS }, {}, FREIGEBER);
    expect((await post(`/deals/${id}/phase`, { nachPhase: "closing" })).status).toBe(200);
  });

  it("bei gleichem Datum entscheidet der zuletzt angelegte Beschluss", async () => {
    const { id } = await neuerDeal();
    const beschluss = (ergebnis: string) => post(`/deals/${id}/beschluesse`, { gremium: "Investitionsausschuss", datum: "2026-03-01", ergebnis, ...(ergebnis === "zugestimmt" ? { fondsId: FONDS } : {}) }, {}, FREIGEBER);
    await beschluss("zugestimmt");
    await beschluss("vertagt");
    expect((await post(`/deals/${id}/phase`, { nachPhase: "closing" })).status).toBe(409);
  });

  it("Absage setzt Status und Grund, danach sind Phasenwechsel und zweite Absage 409; Wiederaufnahme öffnet wieder", async () => {
    const { id } = await neuerDeal();
    expect((await post(`/deals/${id}/absage`, {})).status).toBe(400);
    const absage = await post(`/deals/${id}/absage`, { grund: "Bewertung zu hoch" });
    expect(absage.status).toBe(200);
    expect(await json(absage)).toMatchObject({ status: "abgesagt", absagegrund: "Bewertung zu hoch" });
    const eintrag = (await protokoll("deal", id)).find((e) => e.aktion === "absagen");
    expect(eintrag?.vorher).toMatchObject({ status: "offen", absagegrund: null });
    expect(eintrag?.nachher).toMatchObject({ status: "abgesagt", absagegrund: "Bewertung zu hoch" });

    const phase = await post(`/deals/${id}/phase`, { nachPhase: "pruefung" });
    expect(phase.status).toBe(409);
    expect((await json(phase)).error.code).toBe("deal_not_open");
    expect((await post(`/deals/${id}/absage`, { grund: "nochmal" })).status).toBe(409);

    const wieder = await post(`/deals/${id}/wiederaufnahme`);
    expect(wieder.status).toBe(200);
    expect(await json(wieder)).toMatchObject({ status: "offen", absagegrund: null });
    const nochmal = await post(`/deals/${id}/wiederaufnahme`);
    expect(nochmal.status).toBe(409);
    expect((await json(nochmal)).error.code).toBe("deal_not_declined");
    expect((await post(`/deals/${FREMD}/absage`, { grund: "x" })).status).toBe(404);
    expect((await post(`/deals/${FREMD}/wiederaufnahme`)).status).toBe(404);
  });
});

describe("Beschlüsse und Deal-Detail", () => {
  it("POST legt Beschluss an und protokolliert; 400 und 404", async () => {
    const { id } = await neuerDeal();
    const antwort = await post(`/deals/${id}/beschluesse`, {
      gremium: "Investitionsausschuss",
      datum: "2026-03-05",
      ergebnis: "zugestimmt",
      fondsId: FONDS,
      betrag: "900000.00",
      auflagen: "Berichtspflicht quartalsweise",
      protokoll: "Einstimmig beschlossen.",
    });
    expect(antwort.status).toBe(201);
    const b = await json(antwort);
    expect(b).toMatchObject({ dealId: id, ergebnis: "zugestimmt", betrag: "900000.00" });
    expect((await protokoll("beschluss", b.id))[0]).toMatchObject({ aktion: "anlegen" });

    const falsch = await post(`/deals/${id}/beschluesse`, { gremium: "", datum: "05.03.2026", ergebnis: "ja", betrag: "-1" });
    expect(falsch.status).toBe(400);
    expect((await json(falsch)).error.fields.map((f: { field: string }) => f.field).sort()).toEqual(["betrag", "datum", "ergebnis", "gremium"]);
    expect((await post(`/deals/${FREMD}/beschluesse`, { gremium: "G", datum: "2026-03-05", ergebnis: "vertagt" })).status).toBe(404);
  });

  it("GET /deals/:id liefert Organisation, Personen, Verlauf, Aktivitäten, Beschlüsse und Beteiligungen", async () => {
    const { id, organisationId } = await neuerDeal("Detail Beispiel", { fondsId: FONDS });
    await post("/personen", { vorname: "Erika", nachname: "Muster", organisationId });
    await post("/aktivitaeten", { art: "gespraech", datum: "2026-03-02", titel: "Erstgespräch", dealId: id });
    await post(`/deals/${id}/phase`, { nachPhase: "pruefung", am: "2030-03-03" });
    await zustimmung(id);
    await post(`/deals/${id}/beteiligung`, { fondsId: FONDS, instrument: "offene_beteiligung", erstinvestment: "2030-04-01", zusage: "500000.00" });

    const antwort = await hole(`/deals/${id}`);
    expect(antwort.status).toBe(200);
    const d = await json(antwort);
    expect(d).toMatchObject({ id, status: "investiert", phase: "closing" });
    expect(d.organisation).toMatchObject({ id: organisationId, name: "Detail Beispiel" });
    expect(d.fonds).toMatchObject({ id: FONDS, kurzname: "TF1" });
    expect(d.personen).toHaveLength(1);
    expect(d.phasenverlauf.map((p: { nachPhase: string }) => p.nachPhase)).toEqual(["anfrage", "pruefung", "closing"]);
    expect(d.aktivitaeten).toHaveLength(1);
    expect(d.beschluesse).toHaveLength(1);
    expect(d.beteiligungen).toHaveLength(1);
    expect(d.beteiligungen[0]).toMatchObject({ instrument: "offene_beteiligung", fonds: { id: FONDS } });

    expect((await hole(`/deals/${FREMD}`)).status).toBe(404);
    expect((await hole("/deals/keine-id")).status).toBe(400);
  });
});

describe("Übergang ins Portfolio", () => {
  const uebergang = { fondsId: FONDS, instrument: "offene_beteiligung", erstinvestment: "2026-04-01", zusage: "750000.00" };

  it("legt genau eine Beteiligung mit Zusage an, verknüpft Deal und Organisation, setzt Status und protokolliert", async () => {
    const { id, organisationId } = await neuerDeal();
    await zustimmung(id);
    const antwort = await post(`/deals/${id}/beteiligung`, uebergang);
    expect(antwort.status).toBe(201);
    const ergebnis = await json(antwort);
    expect(ergebnis.beteiligung).toMatchObject({ fondsId: FONDS, organisationId, dealId: id, instrument: "offene_beteiligung", erstinvestment: "2026-04-01", status: "aktiv" });
    expect(ergebnis.zusage).toMatchObject({ art: "zusage", betrag: "750000.00", valuta: "2026-04-01", beteiligungId: ergebnis.beteiligung.id });
    expect(ergebnis.deal).toMatchObject({ status: "investiert", phase: "closing", fondsId: FONDS });

    expect(await anzahl("beteiligung")).toBe(1);
    expect(await anzahl("vorgang")).toBe(1);
    const verlauf = await zeilen(sql`SELECT von_phase, nach_phase FROM deal_phasenwechsel WHERE deal_id = ${id}`);
    expect(verlauf).toContainEqual({ von_phase: "anfrage", nach_phase: "closing" });
    expect(verlauf).toHaveLength(2);
    expect((await protokoll("beteiligung"))).toHaveLength(1);
    expect((await protokoll("vorgang"))).toHaveLength(1);
    expect((await protokoll("deal", id)).at(-1)).toMatchObject({ aktion: "uebergang_portfolio" });
  });

  it("ohne Zusage entsteht kein Vorgang", async () => {
    const { id } = await neuerDeal();
    await zustimmung(id);
    const antwort = await post(`/deals/${id}/beteiligung`, { ...uebergang, zusage: undefined, instrument: "darlehen" });
    expect(antwort.status).toBe(201);
    expect((await json(antwort)).zusage).toBeNull();
    expect(await anzahl("vorgang")).toBe(0);
  });

  it("409 resolution_missing ohne zustimmenden Beschluss, nichts wird angelegt", async () => {
    const { id } = await neuerDeal();
    await post(`/deals/${id}/beschluesse`, { gremium: "Investitionsausschuss", datum: "2026-03-01", ergebnis: "vertagt" });
    const antwort = await post(`/deals/${id}/beteiligung`, uebergang);
    expect(antwort.status).toBe(409);
    expect((await json(antwort)).error.code).toBe("resolution_missing");
    expect(await anzahl("beteiligung")).toBe(0);
    expect(await anzahl("vorgang")).toBe(0);
    expect((await json(await hole(`/deals/${id}`))).status).toBe("offen");
  });

  it("Zustimmung, danach Ablehnung: Übergang ist 409 resolution_missing", async () => {
    const { id } = await neuerDeal();
    await zustimmung(id);
    await post(`/deals/${id}/beschluesse`, { gremium: "Investitionsausschuss", datum: "2026-03-05", ergebnis: "abgelehnt" });
    const antwort = await post(`/deals/${id}/beteiligung`, uebergang);
    expect(antwort.status).toBe(409);
    expect((await json(antwort)).error.code).toBe("resolution_missing");
    expect(await anzahl("beteiligung")).toBe(0);
  });

  it("Bereiche je Fonds: die erfassende Person muss Freigeber im Dealflow des Fonds sein, nicht nur in einem anderen Bereich", async () => {
    const { id } = await neuerDeal();
    await zustimmung(id);
    // Erfasst von einer Person, die am Fonds Freigeber ist, über ihre Gruppe aber nur Kontakte hat (Bereiche je Fonds).
    const andere = person("beschluss-nur-kontakte", { rollen: { [FONDS]: "freigeber" } });
    const andereId = await legePersonAn(db, andere);
    const [rolle] = await db.insert(s.rechterolle).values({ name: "Beschluss nur Kontakte", bereiche: ["kontakte", "dealflow"] }).returning();
    const [gruppe] = await db.insert(s.nutzergruppe).values({ name: "Beschluss nur Kontakte", stufe: "freigeber", fondsBeschraenkt: true, bereicheJeFonds: true }).returning();
    await db.insert(s.nutzergruppeRolle).values({ gruppeId: gruppe!.id, rolleId: rolle!.id });
    await db.insert(s.nutzergruppeFonds).values({ gruppeId: gruppe!.id, fondsId: FONDS, bereiche: ["kontakte"] });
    await db.insert(s.nutzergruppeMitglied).values({ gruppeId: gruppe!.id, benutzerId: andereId });
    await db.execute(sql`UPDATE beschluss SET erfasst_von = ${andereId} WHERE deal_id = ${id}`);
    const antwort = await post(`/deals/${id}/beteiligung`, uebergang);
    expect(antwort.status).toBe(409);
    expect((await json(antwort)).error.code).toBe("resolution_fund_mismatch");
    // Mit Dealflow am Fonds gilt der Beschluss.
    await db.execute(sql`UPDATE nutzergruppe_fonds SET bereiche = '{kontakte,dealflow}' WHERE gruppe_id = ${gruppe!.id}`);
    expect((await post(`/deals/${id}/beteiligung`, uebergang)).status).toBe(201);
    await db.delete(s.nutzergruppe);
    await db.delete(s.rechterolle);
  });

  it("Zusage über dem beschlossenen Betrag ist 409 commitment_exceeds_resolution, gleicher oder kleinerer Betrag geht", async () => {
    const { id } = await neuerDeal();
    await zustimmung(id); // Betrag 1000000.00
    const zuHoch = await post(`/deals/${id}/beteiligung`, { ...uebergang, zusage: "1000000.01" });
    expect(zuHoch.status).toBe(409);
    expect((await json(zuHoch)).error.code).toBe("commitment_exceeds_resolution");
    expect(await anzahl("beteiligung")).toBe(0);
    expect(await anzahl("vorgang")).toBe(0);
    expect((await json(await hole(`/deals/${id}`))).status).toBe("offen");

    const gleich = await post(`/deals/${id}/beteiligung`, { ...uebergang, zusage: "1000000.00" });
    expect(gleich.status).toBe(201);
    expect((await json(gleich)).zusage).toMatchObject({ betrag: "1000000.00" });
  });

  it("ohne Betrag im Beschluss ist jede Zusage zulässig", async () => {
    const { id } = await neuerDeal();
    await post(`/deals/${id}/beschluesse`, { gremium: "Investitionsausschuss", datum: "2026-03-01", ergebnis: "zugestimmt", fondsId: FONDS }, {}, FREIGEBER);
    expect((await post(`/deals/${id}/beteiligung`, { ...uebergang, zusage: "99999999.00" })).status).toBe(201);
  });

  it("409 investment_exists, wenn der Fonds die Organisation mit diesem Instrument schon hält", async () => {
    const { id, organisationId } = await neuerDeal();
    const zweiter = await post("/deals", { titel: "Zweite Runde", organisationId });
    const zweiterId = (await json(zweiter)).id as string;
    await zustimmung(id);
    await zustimmung(zweiterId);
    expect((await post(`/deals/${id}/beteiligung`, uebergang)).status).toBe(201);

    const doppelt = await post(`/deals/${zweiterId}/beteiligung`, uebergang);
    expect(doppelt.status).toBe(409);
    expect((await json(doppelt)).error.code).toBe("investment_exists");
    expect(await anzahl("beteiligung")).toBe(1);
    expect(await anzahl("vorgang")).toBe(1);
    expect((await json(await hole(`/deals/${zweiterId}`))).status).toBe("offen");

    // anderer Fonds ist erlaubt, wenn der Beschluss für ihn gilt (sonst 409 resolution_fund_mismatch)
    expect((await post(`/deals/${zweiterId}/beteiligung`, { ...uebergang, fondsId: FONDS2 })).status).toBe(409);
    await post(`/deals/${zweiterId}/beschluesse`, { gremium: "Investitionsausschuss", datum: "2026-03-02", ergebnis: "zugestimmt", fondsId: FONDS2 }, {}, FREIGEBER);
    expect((await post(`/deals/${zweiterId}/beteiligung`, { ...uebergang, fondsId: FONDS2 })).status).toBe(201);
    expect(await anzahl("beteiligung")).toBe(2);
  });

  it("409 deal_not_open bei abgesagtem Deal; 404 und 400", async () => {
    const { id } = await neuerDeal();
    await zustimmung(id);
    await post(`/deals/${id}/absage`, { grund: "Passt nicht" });
    const antwort = await post(`/deals/${id}/beteiligung`, uebergang);
    expect(antwort.status).toBe(409);
    expect((await json(antwort)).error.code).toBe("deal_not_open");

    expect((await post(`/deals/${FREMD}/beteiligung`, uebergang)).status).toBe(404);
    const offen = await neuerDeal("Zweite Firma");
    const fremderFonds = await post(`/deals/${offen.id}/beteiligung`, { ...uebergang, fondsId: FREMD });
    expect(fremderFonds.status).toBe(404);
    expect((await json(fremderFonds)).error.code).toBe("fund_not_found");
    const falsch = await post(`/deals/${offen.id}/beteiligung`, { fondsId: "x", instrument: "aktie", erstinvestment: "bald", zusage: "0" });
    expect(falsch.status).toBe(400);
    expect((await json(falsch)).error.fields.map((f: { field: string }) => f.field).sort()).toEqual(["erstinvestment", "fondsId", "instrument", "zusage"]);
  });
});

describe("Aktivitäten und Wiedervorlagen", () => {
  it("POST legt an, GET liefert neueste zuerst und filtert", async () => {
    const { id, organisationId } = await neuerDeal();
    const { id: anderer } = await neuerDeal("Beta Beispiel");
    const a1 = await post("/aktivitaeten", { art: "gespraech", datum: "2026-03-01", titel: "Erstgespräch", dealId: id, organisationId });
    expect(a1.status).toBe(201);
    expect((await protokoll("aktivitaet", (await json(a1)).id))[0]).toMatchObject({ aktion: "anlegen" });
    await post("/aktivitaeten", { art: "notiz", datum: "2026-03-10", titel: "Notiz", dealId: id, organisationId });
    await post("/aktivitaeten", { art: "termin", datum: "2026-03-05", titel: "Termin", dealId: id });
    await post("/aktivitaeten", { art: "mail", datum: "2026-03-20", titel: "Andere Firma", dealId: anderer });

    const deal = await json(await hole(`/aktivitaeten?dealId=${id}`));
    expect(deal.daten.map((a: { titel: string }) => a.titel)).toEqual(["Notiz", "Termin", "Erstgespräch"]);
    const org = await json(await hole(`/aktivitaeten?organisationId=${organisationId}`));
    expect(org.daten.map((a: { titel: string }) => a.titel)).toEqual(["Notiz", "Termin", "Erstgespräch"]);
    expect((await json(await hole("/aktivitaeten"))).daten).toHaveLength(4);
    expect((await hole("/aktivitaeten?dealId=x")).status).toBe(400);
  });

  it("POST: 400 ohne Verknüpfung und bei Formfehlern, 404 bei Fremd-Ids", async () => {
    const ohne = await post("/aktivitaeten", { art: "gespraech", datum: "2026-03-01", titel: "Ohne" });
    expect(ohne.status).toBe(400);
    const sammeln = await post("/aktivitaeten", { art: "fax", datum: "morgen", titel: "", wiedervorlage: "irgendwann", dealId: FREMD });
    expect(sammeln.status).toBe(400);
    expect((await json(sammeln)).error.fields.map((f: { field: string }) => f.field).sort()).toEqual(["art", "datum", "titel", "wiedervorlage"]);
    const basis = { art: "notiz", datum: "2026-03-01", titel: "X" };
    expect((await post("/aktivitaeten", { ...basis, dealId: FREMD })).status).toBe(404);
    expect((await json(await post("/aktivitaeten", { ...basis, personId: FREMD }))).error.code).toBe("person_not_found");
    expect((await json(await post("/aktivitaeten", { ...basis, organisationId: FREMD }))).error.code).toBe("organization_not_found");
    expect(await anzahl("aktivitaet")).toBe(0);
  });

  it("Wiedervorlagen: fällige bis zum Datum, älteste zuerst, erledigte verschwinden", async () => {
    const { id, organisationId } = await neuerDeal();
    const mk = async (titel: string, wiedervorlage?: string) =>
      (await json(await post("/aktivitaeten", { art: "notiz", datum: "2026-03-01", titel, dealId: id, organisationId, ...(wiedervorlage ? { wiedervorlage } : {}) }))).id as string;
    await mk("Ohne Termin");
    const spaet = await mk("Später", "2026-06-01");
    const frueh = await mk("Früh", "2026-04-01");
    const mitte = await mk("Mitte", "2026-05-01");

    const bisMai = await json(await hole("/wiedervorlagen?bis=2026-05-01"));
    expect(bisMai.daten.map((w: { titel: string }) => w.titel)).toEqual(["Früh", "Mitte"]);
    expect(bisMai.daten[0]).toMatchObject({ id: frueh, deal: { id }, organisation: { id: organisationId } });
    expect((await json(await hole("/wiedervorlagen?bis=2026-03-31"))).daten).toEqual([]);

    const erledigt = await post(`/aktivitaeten/${frueh}/erledigt`);
    expect(erledigt.status).toBe(200);
    expect((await json(erledigt)).wiedervorlageErledigtAm).not.toBeNull();
    expect((await protokoll("aktivitaet", frueh)).at(-1)).toMatchObject({ aktion: "aendern" });
    const danach = await json(await hole("/wiedervorlagen?bis=2026-12-31"));
    expect(danach.daten.map((w: { id: string }) => w.id)).toEqual([mitte, spaet]);
    expect((await hole("/wiedervorlagen?bis=kaputt")).status).toBe(400);
    expect((await post(`/aktivitaeten/${FREMD}/erledigt`)).status).toBe(404);
    expect((await json(await post(`/aktivitaeten/${FREMD}/erledigt`))).error.code).toBe("activity_not_found");
  });
});

describe("Zeitgrenzen in Schreibtransaktionen", () => {
  const kontext = { get: () => undefined, req: { header: () => undefined } } as unknown as Context;
  const einstellung = async (name: string, ausfuehrer: Pick<typeof db, "execute">) =>
    ((await ausfuehrer.execute(sql.raw(`SHOW ${name}`))).rows[0] as Record<string, string>)[name];

  it("statement_timeout und lock_timeout gelten in der Schreibtransaktion und bleiben nicht im Pool zurück", async () => {
    const innen = await schreibe(db, kontext, async (tx) => ({
      statement: await einstellung("statement_timeout", tx),
      sperre: await einstellung("lock_timeout", tx),
    }));
    expect(innen).toEqual({ statement: "5s", sperre: "2s" });
    expect(await einstellung("statement_timeout", db)).toBe("0");
    expect(await einstellung("lock_timeout", db)).toBe("0");
  });

  it("wartet eine Schreibanfrage zu lange auf eine Sperre, kommt 503 lock_too_long", async () => {
    const { id } = await neuerDeal();
    const halter = await pool.connect();
    try {
      await halter.query("BEGIN");
      await halter.query("SELECT id FROM deal WHERE id = $1 FOR UPDATE", [id]);
      const antwort = await patch(`/deals/${id}`, { titel: "Gesperrt" });
      expect(antwort.status).toBe(503);
      expect((await json(antwort)).error.code).toBe("lock_too_long");
    } finally {
      await halter.query("ROLLBACK");
      halter.release();
    }
    expect((await patch(`/deals/${id}`, { titel: "Frei" })).status).toBe(200);
  });
});

describe("Änderungsprotokoll und Transaktionen", () => {
  it("Zeilen in aenderung lassen sich nicht ändern oder löschen", async () => {
    await post("/organisationen", { name: "Protokoll Beispiel", art: "unternehmen" });
    await expect(db.execute(sql`UPDATE aenderung SET akteur = 'jemand'`)).rejects.toThrow();
    await expect(db.execute(sql`DELETE FROM aenderung`)).rejects.toThrow();
    expect(await anzahl("aenderung")).toBe(1);
  });

  it("scheitert eine Anfrage nach Teilarbeit, bleibt nichts zurück (Rollback samt Protokoll)", async () => {
    // Die Organisation wird zuerst angelegt, erst danach scheitert der unbekannte Fonds.
    const antwort = await post("/deals", { titel: "x", organisation: { name: "Rollback Beispiel" }, fondsId: FREMD });
    expect(antwort.status).toBe(404);
    expect(await anzahl("organisation")).toBe(0);
    expect(await anzahl("deal")).toBe(0);
    expect(await anzahl("aenderung")).toBe(0);
  });
});

describe("Dealflow-Trichter", () => {
  const D = (n: number) => `00000000-0000-4000-8000-0000000000d${n}`;
  const O = (n: number) => `00000000-0000-4000-8000-0000000000e${n}`;
  const PHASEN = ["anfrage", "erstgespraech", "pruefung", "due_diligence", "investitionsausschuss", "closing"] as const;
  type Phase = (typeof PHASEN)[number];

  async function legeAn(nr: number, werte: Partial<s.NeuerDeal>, verlauf: [Phase, string][]) {
    await db.insert(s.organisation).values({ id: O(nr), name: `Trichter Firma ${nr}`, art: "unternehmen" });
    const letzte = verlauf.at(-1)![0];
    await db.insert(s.deal).values({ id: D(nr), organisationId: O(nr), titel: `Deal ${nr}`, phase: letzte, ...werte });
    await db.insert(s.dealPhasenwechsel).values(
      verlauf.map(([nachPhase, am], i) => ({ dealId: D(nr), vonPhase: i === 0 ? null : verlauf[i - 1]![0], nachPhase, am })),
    );
  }

  async function fixture() {
    await legeAn(1, { fondsId: FONDS, quelle: "Empfehlung" }, [["anfrage", "2026-01-05"], ["erstgespraech", "2026-01-10"], ["pruefung", "2026-01-20"]]);
    await legeAn(2, { fondsId: FONDS, quelle: "Empfehlung" }, [["anfrage", "2026-01-07"]]);
    await legeAn(3, { fondsId: FONDS, quelle: "Messe", status: "abgesagt", absagegrund: "Bewertung zu hoch" }, [["anfrage", "2026-02-01"], ["erstgespraech", "2026-02-05"]]);
    // Phase übersprungen: erstgespraech zählt als erreicht
    await legeAn(4, { fondsId: FONDS, quelle: "Messe", status: "investiert" }, [
      ["anfrage", "2026-03-01"], ["pruefung", "2026-03-10"], ["due_diligence", "2026-03-20"], ["investitionsausschuss", "2026-03-25"], ["closing", "2026-04-01"],
    ]);
    await legeAn(5, { fondsId: FONDS2, status: "abgesagt", absagegrund: "Passt nicht" }, [["anfrage", "2026-01-15"]]);
  }

  /** Unabhängige Zählung in einfachem SQL (Unterabfragen statt Aggregat), gleiche Kohortenregel. */
  async function zaehleUnabhaengig(von: string | null, bis: string | null, fondsId: string | null) {
    const ergebnis: Record<string, { erreicht: number; aktuell: number }> = {};
    for (const phase of PHASEN) {
      const [z] = await zeilen<{ erreicht: number; aktuell: number }>(sql`
        SELECT
          (SELECT count(*)::int FROM deal d
            WHERE (${fondsId}::uuid IS NULL OR d.fonds_id = ${fondsId}::uuid)
              AND (SELECT min(am) FROM deal_phasenwechsel w WHERE w.deal_id = d.id) IS NOT NULL
              AND (${von}::date IS NULL OR (SELECT min(am) FROM deal_phasenwechsel w WHERE w.deal_id = d.id) >= ${von}::date)
              AND (${bis}::date IS NULL OR (SELECT min(am) FROM deal_phasenwechsel w WHERE w.deal_id = d.id) <= ${bis}::date)
              AND EXISTS (SELECT 1 FROM deal_phasenwechsel w WHERE w.deal_id = d.id AND w.nach_phase >= ${phase}::deal_phase)) AS erreicht,
          (SELECT count(*)::int FROM deal d
            WHERE (${fondsId}::uuid IS NULL OR d.fonds_id = ${fondsId}::uuid)
              AND d.status = 'offen' AND d.phase = ${phase}::deal_phase
              AND (SELECT min(am) FROM deal_phasenwechsel w WHERE w.deal_id = d.id) IS NOT NULL
              AND (${von}::date IS NULL OR (SELECT min(am) FROM deal_phasenwechsel w WHERE w.deal_id = d.id) >= ${von}::date)
              AND (${bis}::date IS NULL OR (SELECT min(am) FROM deal_phasenwechsel w WHERE w.deal_id = d.id) <= ${bis}::date)) AS aktuell`);
      ergebnis[phase] = { erreicht: z!.erreicht, aktuell: z!.aktuell };
    }
    return ergebnis;
  }

  it("zählt erreichte und aktuelle Deals je Phase, Konversion, Quellen und Absagegründe als Zahlen", async () => {
    await fixture();
    const antwort = await hole("/dealflow/trichter");
    expect(antwort.status).toBe(200);
    const t = await json(antwort);
    expect(t.filter).toEqual({ von: null, bis: null, fondsId: null });
    expect(t.gesamt).toEqual({ deals: 5, offen: 2, abgesagt: 2, investiert: 1 });
    expect(t.phasen).toEqual([
      { phase: "anfrage", erreicht: 5, aktuell: 1, konversionZurNaechsten: 0.6 },
      { phase: "erstgespraech", erreicht: 3, aktuell: 0, konversionZurNaechsten: 0.6667 },
      { phase: "pruefung", erreicht: 2, aktuell: 1, konversionZurNaechsten: 0.5 },
      { phase: "due_diligence", erreicht: 1, aktuell: 0, konversionZurNaechsten: 1 },
      { phase: "investitionsausschuss", erreicht: 1, aktuell: 0, konversionZurNaechsten: 1 },
      { phase: "closing", erreicht: 1, aktuell: 0, konversionZurNaechsten: null },
    ]);
    expect(t.quellen).toEqual([
      { quelle: "Empfehlung", anzahl: 2 },
      { quelle: "Messe", anzahl: 2 },
      { quelle: null, anzahl: 1 },
    ]);
    expect(t.absagegruende).toEqual([
      { absagegrund: "Bewertung zu hoch", anzahl: 1 },
      { absagegrund: "Passt nicht", anzahl: 1 },
    ]);
    for (const p of t.phasen) {
      expect(typeof p.erreicht).toBe("number");
      expect(typeof p.aktuell).toBe("number");
    }
  });

  it("stimmt mit einer unabhängigen SQL-Zählung überein, auch mit Zeitraum und Fonds", async () => {
    await fixture();
    for (const [von, bis, fondsId] of [
      [null, null, null],
      ["2026-02-01", "2026-02-28", null],
      ["2026-01-01", "2026-01-31", null],
      [null, "2026-01-31", FONDS],
      [null, null, FONDS2],
    ] as const) {
      const abfrage = new URLSearchParams();
      if (von) abfrage.set("von", von);
      if (bis) abfrage.set("bis", bis);
      if (fondsId) abfrage.set("fondsId", fondsId);
      const t = await json(await hole(`/dealflow/trichter?${abfrage}`));
      const erwartet = await zaehleUnabhaengig(von, bis, fondsId);
      for (const p of t.phasen) expect({ erreicht: p.erreicht, aktuell: p.aktuell }, `${abfrage} ${p.phase}`).toEqual(erwartet[p.phase]);
    }
    const nurFebruar = await json(await hole("/dealflow/trichter?von=2026-02-01&bis=2026-02-28"));
    expect(nurFebruar.gesamt.deals).toBe(1);
    expect(nurFebruar.absagegruende).toEqual([{ absagegrund: "Bewertung zu hoch", anzahl: 1 }]);
    const nurFonds2 = await json(await hole(`/dealflow/trichter?fondsId=${FONDS2}`));
    expect(nurFonds2.gesamt.deals).toBe(1);
  });

  it("stimmt auch auf den Demo-Daten mit der unabhängigen Zählung überein", async () => {
    await schreibeDemodaten(db, erzeugeDemodaten({ seed: 1 }));
    const t = await json(await hole("/dealflow/trichter"));
    expect(t.gesamt.deals).toBe(70);
    const erwartet = await zaehleUnabhaengig(null, null, null);
    for (const p of t.phasen) expect({ erreicht: p.erreicht, aktuell: p.aktuell }, p.phase).toEqual(erwartet[p.phase]);
    const [quellen] = await zeilen<{ n: number }>(sql`SELECT count(DISTINCT quelle)::int AS n FROM deal`);
    expect(t.quellen).toHaveLength(quellen!.n);
    const [abgesagt] = await zeilen<{ n: number }>(sql`SELECT count(*)::int AS n FROM deal WHERE status = 'abgesagt'`);
    expect(t.absagegruende.reduce((summe: number, g: { anzahl: number }) => summe + g.anzahl, 0)).toBe(abgesagt!.n);
  });

  it("400 bei ungültigen Parametern, 404 bei unbekanntem Fonds", async () => {
    const falsch = await hole("/dealflow/trichter?von=gestern&bis=2026-01-01&fondsId=x");
    expect(falsch.status).toBe(400);
    expect((await json(falsch)).error.fields.map((f: { field: string }) => f.field).sort()).toEqual(["fondsId", "von"]);
    expect((await hole("/dealflow/trichter?von=2026-05-01&bis=2026-01-01")).status).toBe(400);
    const fremd = await hole(`/dealflow/trichter?fondsId=${FREMD}`);
    expect(fremd.status).toBe(404);
    expect((await json(fremd)).error.code).toBe("fund_not_found");
  });
});
