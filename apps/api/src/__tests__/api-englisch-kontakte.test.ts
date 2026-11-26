import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { ansicht } from "@carraway/db";
import { erstelleTestApp, idVon, STANDARD } from "./hilfen-auth";
import { json, leeren, oeffneTestdb } from "./hilfen";

const { db, pool } = oeffneTestdb();
const { requestEnglisch: request } = erstelleTestApp(db);
const sende = (pfad: string, koerper: unknown, method = "POST") =>
  request(pfad, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(koerper) });

beforeAll(() => leeren(db));
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

it("akzeptiert die englischen Namen für Pfad, Feld und Enum und gibt nur die englischen Namen zurück", async () => {
  expect((await request("/personen")).ok).toBe(false);

  const person = await sende("/people", { firstName: "Toni", lastName: "Stein", jobTitle: "Leitung" });
  expect(person.status).toBe(201);
  const p = await json(person);
  expect(p).toMatchObject({ firstName: "Toni", lastName: "Stein", jobTitle: "Leitung" });
  expect(p).not.toHaveProperty("vorname");

  const org = await sende("/organizations", { name: "Beispielbetrieb", kind: "company", city: "Bremen" });
  expect(org.status).toBe(201);
  expect(await json(org)).toMatchObject({ name: "Beispielbetrieb", kind: "company", city: "Bremen" });

  const alt = await sende("/organizations", { name: "Zweiter Beispielbetrieb", kind: "unternehmen" });
  expect(alt.status).toBe(400);
  expect((await json(alt)).error.fields).toEqual([expect.objectContaining({ field: "kind" })]);
  expect((await request("/organizations?suche=Beispiel")).status).toBe(400);

  const liste = await request("/organizations?kind=company&search=Beispiel");
  expect(liste.status).toBe(200);
  expect(await json(liste)).toEqual({ data: [expect.objectContaining({ kind: "company" })], nextCursor: null });
});

it("bildet Feldschlüssel, Filteroperatoren und Enumerationen vorhandener Ansichten beim Lesen ab", async () => {
  const konfig = {
    spalten: [{ feld: "vorname" }],
    sortierung: [{ feld: "nachname", richtung: "auf" }],
    filter: { verknuepfung: "und", elemente: [{ verknuepfung: "oder", elemente: [{ feld: "vorname", operator: "ist", wert: "Toni" }] }] },
  };
  // Bestehender Datenbankeintrag, direkt in der bisherigen Form erfasst.
  expect((await request("/crm/views?object=person")).status).toBe(200);
  const [alt] = await db.insert(ansicht).values({ objekt: "person", name: "Beispielansicht", konfig, besitzerId: await idVon(db, STANDARD) }).returning();
  const gelesen = await json(await request("/crm/views?object=person"));
  const config = {
    columns: [{ field: "firstName" }],
    sort: [{ field: "lastName", direction: "asc" }],
    filter: { conjunction: "and", conditions: [{ conjunction: "or", conditions: [{ field: "firstName", operator: "is", value: "Toni" }] }] },
  };
  expect(gelesen.data).toEqual([expect.objectContaining({ id: alt!.id, object: "person", kind: "table", config })]);

  const gespeichert = await sende(`/crm/views/${alt!.id}`, { config }, "PATCH");
  expect(gespeichert.status).toBe(200);
  const [dbZeile] = await db.select().from(ansicht).where(eq(ansicht.id, alt!.id));
  expect(dbZeile?.konfig).toEqual(konfig);
});

it("Postfach und Vorschläge liefern englische Einstellungen und erhalten freie Sperrlisteneinträge", async () => {
  const einstellung = await sende("/contact-suggestions/settings", { mode: "suggestion", ownDomains: [], blocklist: ["example.org"] }, "PUT");
  expect(einstellung.status).toBe(200);
  expect(await json(einstellung)).toEqual({ mode: "suggestion", ownDomains: [], blocklist: ["example.org"] });

  const teilnahme = await sende("/mailbox/contacts", { participating: true, blocklist: ["mail.example.org"] }, "PUT");
  expect(teilnahme.status).toBe(200);
  expect(await json(teilnahme)).toMatchObject({ participating: true, blocklist: ["mail.example.org"] });
});
