import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { json, leeren, oeffneTestdb } from "./hilfen";
import { erstelleTestApp, person } from "./hilfen-auth";

/** Suchfelder für Verknüpfungen und Vorschläge für Wertfelder (Issue #274). Alle Daten sind erfunden. */

const { db, pool } = oeffneTestdb();
const t = erstelleTestApp(db);
const ADMIN = person("suchfeld-admin", { globalVerwalter: true });
const OHNE = person("suchfeld-ohne-rolle");
const F1 = "00000000-0000-4000-8000-0000000000f1";
const F2 = "00000000-0000-4000-8000-0000000000f2";
const NUR_F1 = person("suchfeld-nur-f1", { rollen: { [F1]: "betrachter" } });
const holen = async (pfad: string, als = ADMIN) => t.request(pfad, { als });

beforeEach(async () => {
  await leeren(db);
  await db.insert(s.organisation).values([
    { name: "Nordlicht Kapital GmbH", art: "investor", ort: "Hamburg", sektor: "Software" },
    { name: "Nordlicht Technik GmbH", art: "unternehmen", ort: "Hamburg", sektor: "Software" },
    { name: "Nordlicht Archiv GmbH", art: "investor", ort: "Berlin", sektor: "Software", archiviertAm: new Date() },
    { name: "Südwind Beteiligungen AG", art: "investor", ort: " Berlin ", sektor: "Energie" },
    { name: "Westhafen Partner", art: "berater", ort: "", sektor: "Software" },
  ]);
  const organisationen = await db.select().from(s.organisation);
  const org = (name: string) => organisationen.find((o) => o.name === name)!.id;
  await db.insert(s.fonds).values([
    { id: F1, name: "Testfonds Eins", kurzname: "TF1", vintage: 2024, zeichnungskapital: "10000000.00" },
    { id: F2, name: "Testfonds Zwei", kurzname: "TF2", vintage: 2024, zeichnungskapital: "10000000.00" },
  ]);
  await db.insert(s.beteiligung).values([
    { fondsId: F1, organisationId: org("Nordlicht Technik GmbH"), instrument: "offene_beteiligung", erstinvestment: "2025-01-01" },
    { fondsId: F2, organisationId: org("Nordlicht Technik GmbH"), instrument: "darlehen", erstinvestment: "2025-01-01" },
    { fondsId: F2, organisationId: org("Westhafen Partner"), instrument: "darlehen", erstinvestment: "2025-01-01" },
  ]);
  await db.insert(s.person).values([
    { vorname: "Anna", nachname: "Muster", funktion: "Geschäftsführerin" },
    { vorname: "Ben", nachname: "Beispiel", funktion: " Geschäftsführerin " },
    { vorname: "Clara", nachname: "Probe", funktion: "Investment Manager" },
    { vorname: "Dora", nachname: "Archiv", funktion: "Investment Manager", archiviertAm: new Date() },
    { vorname: "Emil", nachname: "Leer", funktion: "" },
  ]);
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

describe("Suche für Verknüpfungsfelder", () => {
  it("beschränkt auf Organisationen einer Art und lässt die übrigen Gruppen leer", async () => {
    const antwort = await json(await holen("/search?q=nordlicht&limit=10&object=organization&kind=investor"));
    expect(antwort.organizations.map((o: { name: string }) => o.name)).toEqual(["Nordlicht Kapital GmbH"]);
    expect(antwort.people).toEqual([]);
    expect(antwort.deals).toEqual([]);
    expect(antwort.documents).toEqual([]);
    const alle = await json(await holen("/search?q=nordlicht&limit=10&object=organization"));
    expect(alle.organizations.map((o: { name: string }) => o.name).sort()).toEqual(["Nordlicht Kapital GmbH", "Nordlicht Technik GmbH"]);
    expect((await holen("/search?q=nordlicht&object=fund")).status).toBe(400);
  });
});

describe("Suche nach Beteiligungen", () => {
  it("findet Beteiligungen nach dem Namen des Unternehmens, begrenzt auf einen Fonds und auf sichtbare Fonds", async () => {
    const alle = await json(await holen("/search?q=nordlicht&limit=10&object=investment"));
    expect(alle.investments.map((b: { fundId: string; organization: { name: string } }) => [b.organization.name, b.fundId]).sort()).toEqual([
      ["Nordlicht Technik GmbH", F1],
      ["Nordlicht Technik GmbH", F2],
    ]);
    expect(alle.organizations).toEqual([]);
    const einFonds = await json(await holen(`/search?q=nordlicht&limit=10&object=investment&fundId=${F2}`));
    expect(einFonds.investments.map((b: { fundId: string }) => b.fundId)).toEqual([F2]);
    expect(einFonds.investments[0]).toMatchObject({ instrument: "loan", organization: { name: "Nordlicht Technik GmbH" } });
    // Ohne Zugriff auf den Fonds bleibt die Trefferliste leer, auch bei ausdrücklicher Fondsangabe.
    const eingeschraenkt = await json(await holen("/search?q=nordlicht&limit=10&object=investment", NUR_F1));
    expect(eingeschraenkt.investments.map((b: { fundId: string }) => b.fundId)).toEqual([F1]);
    expect((await json(await holen(`/search?q=nordlicht&object=investment&fundId=${F2}`, NUR_F1))).investments).toEqual([]);
    // Die globale Suche liefert keine Beteiligungen.
    expect((await json(await holen("/search?q=nordlicht"))).investments).toEqual([]);
  });
});

describe("Vorschläge für Wertfelder", () => {
  it("liefert erfasste Werte nach Häufigkeit, ohne leere und archivierte, gefiltert und mit Leserechten", async () => {
    const sektoren = await json(await holen("/organizations/values?field=sector"));
    expect(sektoren.data).toEqual([{ value: "Software", count: 3 }, { value: "Energie", count: 1 }]);
    const orte = await json(await holen("/organizations/values?field=city&q=ber"));
    expect(orte.data).toEqual([{ value: "Berlin", count: 1 }]);
    expect((await holen("/organizations/values?field=name")).status).toBe(400);
    expect((await holen("/organizations/values?field=city", OHNE)).status).toBe(403);
  });

  it("liefert erfasste Funktionen von Personen nach Häufigkeit, ohne leere und archivierte", async () => {
    const alle = await json(await holen("/people/values"));
    expect(alle.data).toEqual([{ value: "Geschäftsführerin", count: 2 }, { value: "Investment Manager", count: 1 }]);
    const gefiltert = await json(await holen("/people/values?q=manag"));
    expect(gefiltert.data).toEqual([{ value: "Investment Manager", count: 1 }]);
    expect((await holen("/people/values", OHNE)).status).toBe(403);
  });
});