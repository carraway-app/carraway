import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { erstelleTestApp, person } from "./hilfen-auth";
import { json, leeren, oeffneTestdb } from "./hilfen";

/** Verknüpfungsfelder prüfen beim Schreiben, ob die schreibende Person das Ziel sehen darf (Deals folgen dem Fonds). */
const { db, pool } = oeffneTestdb();
const t = erstelleTestApp(db);

const FA = "00000000-0000-4000-8000-0000000000d1";
const FB = "00000000-0000-4000-8000-0000000000d2";
const ADMIN = person("bez-admin", { globalVerwalter: true });
const BEA_A = person("bez-bea-a", { rollen: { [FA]: "bearbeiter" } });

const senden = (methode: string) => (pfad: string, body?: unknown, als = ADMIN) =>
  t.request(`/crm${pfad}`, { method: methode, als, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const post = senden("POST");
const patch = senden("PATCH");

let org = "";
let dealA = "";
let dealB = "";
let dealOhne = "";
let feldOrg = "";
let liste = "";
let feldListe = "";
const NICHT_DA = "00000000-0000-4000-8000-000000000042";

beforeAll(async () => {
  await leeren(db);
  await db.insert(s.fonds).values([
    { id: FA, name: "Fonds A", kurzname: "FA", vintage: 2024, zeichnungskapital: "1000000.00" },
    { id: FB, name: "Fonds B", kurzname: "FB", vintage: 2024, zeichnungskapital: "1000000.00" },
  ]);
  org = (await db.insert(s.organisation).values({ name: "Muster Bezug GmbH", art: "unternehmen" }).returning())[0]!.id;
  dealA = (await db.insert(s.deal).values({ organisationId: org, titel: "Deal Eigener Fonds", fondsId: FA, phase: "anfrage" }).returning())[0]!.id;
  dealB = (await db.insert(s.deal).values({ organisationId: org, titel: "Deal Fremder Fonds", fondsId: FB, phase: "anfrage" }).returning())[0]!.id;
  dealOhne = (await db.insert(s.deal).values({ organisationId: org, titel: "Deal Ohne Fonds", fondsId: null, phase: "anfrage" }).returning())[0]!.id;
  feldOrg = (await json(await post("/felder", { objekt: "organisation", name: "Verwandter Deal", typ: "verknuepfung", optionen: { ziel: "deal" } }))).id;
  liste = (await json(await post("/listen", { name: "Bezugsliste", objekt: "organisation" }, BEA_A))).id;
  feldListe = (await json(await post("/felder", { objekt: "organisation", listeId: liste, name: "Listen-Deal", typ: "verknuepfung", optionen: { ziel: "deal" } }, BEA_A))).id;
  await post(`/listen/${liste}/eintraege`, { datensatzIds: [org] }, BEA_A);
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

describe("Verknüpfungsziele beim Schreiben", () => {
  it("Feld am Datensatz (auch Zelle): sichtbare Ziele gehen, fremde antworten wie fehlende", async () => {
    const schreibe = (wert: string | null) => patch(`/datensaetze/organisation/${org}`, { eigene: { [feldOrg]: wert } }, BEA_A);
    expect((await schreibe(dealA)).status).toBe(200);
    expect((await schreibe(dealOhne)).status).toBe(200);
    const fremd = await schreibe(dealB);
    const fehlt = await schreibe(NICHT_DA);
    expect(fremd.status).toBe(400);
    expect(fremd.status).toBe(fehlt.status);
    // Gleiche Antwort ohne die Kennung: kein Hinweis, ob es den Deal gibt.
    const ohneId = (r: unknown) => JSON.stringify(r).replaceAll(dealB, "X").replaceAll(NICHT_DA, "X");
    const fremdJson = await json(fremd);
    expect(ohneId(fremdJson)).toBe(ohneId(await json(fehlt)));
    expect(fremdJson.fehler.code).toBe("FELDWERT_UNGUELTIG");
    // Der bisherige Wert bleibt.
    const [zeile] = await db.select().from(s.organisation).where(eq(s.organisation.id, org));
    expect((zeile!.felder as Record<string, unknown>)[feldOrg]).toBe(dealOhne);
    expect((await schreibe(null)).status).toBe(200);
    // Verwalter sehen alles.
    expect((await patch(`/datensaetze/organisation/${org}`, { eigene: { [feldOrg]: dealB } })).status).toBe(200);
  });

  it("archivierte und zusammengeführte Unternehmen und Kontakte sind keine gültigen Ziele", async () => {
    const orgFeld = (await json(await post("/felder", { objekt: "organisation", name: "Partner", typ: "verknuepfung", optionen: { ziel: "organisation" } }))).id as string;
    const personFeld = (await json(await post("/felder", { objekt: "organisation", name: "Ansprechperson", typ: "verknuepfung", optionen: { ziel: "person" } }))).id as string;
    const [archiv] = await db.insert(s.organisation).values({ name: "Muster Archiv GmbH", art: "unternehmen", archiviertAm: new Date() }).returning();
    const [weg] = await db.insert(s.organisation).values({ name: "Muster Weg GmbH", art: "unternehmen", zusammengefuehrtIn: org }).returning();
    const [lebend] = await db.insert(s.organisation).values({ name: "Muster Lebend GmbH", art: "unternehmen" }).returning();
    const [pArchiv] = await db.insert(s.person).values({ vorname: "Archiv", nachname: "Person", archiviertAm: new Date() }).returning();
    const [pWeg] = await db.insert(s.person).values({ vorname: "Weg", nachname: "Person" }).returning();
    const [pLebend] = await db.insert(s.person).values({ vorname: "Lebend", nachname: "Person" }).returning();
    await db.update(s.person).set({ zusammengefuehrtIn: pLebend!.id }).where(eq(s.person.id, pWeg!.id));
    const schreibe = (feld: string, wert: string) => patch(`/datensaetze/organisation/${lebend!.id}`, { eigene: { [feld]: wert } }, BEA_A);
    for (const [feld, id] of [[orgFeld, archiv!.id], [orgFeld, weg!.id], [personFeld, pArchiv!.id], [personFeld, pWeg!.id]] as const) {
      const antwort = await schreibe(feld, id);
      expect(antwort.status, id).toBe(400);
      expect((await json(antwort)).fehler.felder[0].code).toBe("unknown_record");
    }
    expect((await schreibe(orgFeld, org)).status).toBe(200);
    expect((await schreibe(personFeld, pLebend!.id)).status).toBe(200);
  });

  it("Sammelaktion: die Zeile scheitert mit Feldfehler, es wird nichts gesetzt", async () => {
    await patch(`/datensaetze/organisation/${org}`, { eigene: { [feldOrg]: null } });
    const ergebnis = await json(await post("/objekte/organisation/massenaktion", { ids: [org], aktion: { art: "feld_setzen", feld: feldOrg, wert: dealB } }, BEA_A));
    expect(ergebnis.erfolgreich).toBe(0);
    expect(ergebnis.fehler).toEqual([{ id: org, code: "FELDWERT_UNGUELTIG" }]);
    const ok = await json(await post("/objekte/organisation/massenaktion", { ids: [org], aktion: { art: "feld_setzen", feld: feldOrg, wert: dealA } }, BEA_A));
    expect(ok.erfolgreich).toBe(1);
    const [zeile] = await db.select().from(s.organisation).where(eq(s.organisation.id, org));
    expect((zeile!.felder as Record<string, unknown>)[feldOrg]).toBe(dealA);
  });

  it("Listenfeld vom Typ Verknüpfung prüft ebenso", async () => {
    const schreibe = (wert: string) => patch(`/listen/${liste}/eintraege/${org}`, { felder: { [feldListe]: wert } }, BEA_A);
    expect((await schreibe(dealA)).status).toBe(200);
    const fremd = await schreibe(dealB);
    expect(fremd.status).toBe(400);
    expect((await json(fremd)).fehler.code).toBe("FELDWERT_UNGUELTIG");
    const [eintrag] = await db.select().from(s.listeEintrag);
    expect((eintrag!.felder as Record<string, unknown>)[feldListe]).toBe(dealA);
  });

  it("Import nimmt keine Verknüpfungswerte an", async () => {
    const csv = `Name,Deal\nMuster Import GmbH,${dealB}\n`;
    const antwort = await json(await post("/import", { objekt: "organisation", csv, zuordnung: [{ spalte: 0, feld: "name" }, { spalte: 1, feld: feldOrg }] }, BEA_A));
    expect(antwort.zeilen[0].status).toBe("fehler");
    expect((await db.select().from(s.organisation)).some((o) => o.name === "Muster Import GmbH")).toBe(false);
  });
});

describe("Kurzkarte für die Vorschau an Verweisen", () => {
  const karte = (objekt: string, id: string, als = BEA_A) => t.request(`/crm/datensaetze/${objekt}/${id}/karte`, { als });

  it("liefert Name, Unternehmen und Kontaktwege je Objekt; Deals nehmen die Wege des Unternehmens", async () => {
    await db.update(s.organisation).set({ email: "info@bezug.example", telefon: "+49 40 5", website: "https://bezug.example" }).where(eq(s.organisation.id, org));
    const [p] = await db.insert(s.person).values({ vorname: "Eva", nachname: "Muster", email: "eva@bezug.example", telefon: "+49 40 6", funktion: "Leitung", organisationId: org }).returning();
    const o = await json(await karte("organisation", org));
    expect(o).toMatchObject({ objekt: "organisation", name: "Muster Bezug GmbH", art: "unternehmen", firma: null, email: "info@bezug.example", website: "https://bezug.example" });
    const k = await json(await karte("person", p!.id));
    expect(k).toMatchObject({ name: "Eva Muster", funktion: "Leitung", firma: { id: org, name: "Muster Bezug GmbH" }, email: "eva@bezug.example", telefon: "+49 40 6" });
    const d = await json(await karte("deal", dealA));
    expect(d).toMatchObject({ name: "Deal Eigener Fonds", phase: "anfrage", firma: { id: org }, email: "info@bezug.example" });
  });

  it("zeigt Deals fremder Fonds und fehlende Datensätze gleich als nicht gefunden", async () => {
    const fremd = await karte("deal", dealB);
    const fehlt = await karte("deal", NICHT_DA);
    expect(fremd.status).toBe(404);
    expect(fehlt.status).toBe(404);
    expect(JSON.stringify(await json(fremd)).replace(dealB, "X")).toBe(JSON.stringify(await json(fehlt)).replace(NICHT_DA, "X"));
    expect((await karte("deal", dealB, ADMIN)).status).toBe(200);
    expect((await karte("person", NICHT_DA)).status).toBe(404);
    expect((await karte("unbekannt", org)).status).toBe(400);
  });

  it("verlangt eine Rolle an irgendeinem Fonds", async () => {
    expect((await karte("organisation", org, person("bez-ohne"))).status).toBe(403);
  });
});
