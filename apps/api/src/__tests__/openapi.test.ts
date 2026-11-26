import { Validator } from "@seriousme/openapi-schema-validator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { REGELN } from "../rechte/tabelle";
import { json, oeffneTestdb } from "./hilfen";
import { erstelleTestApp } from "./hilfen-auth";

const { db, pool } = oeffneTestdb();
const t = erstelleTestApp(db);

type Operation = { parameters?: { name?: string; in?: string; required?: boolean; schema?: Record<string, unknown>; $ref?: string }[]; requestBody?: { content: Record<string, { schema: Record<string, unknown> }> }; "x-carraway-zugriff": unknown; security: unknown[] };
let doc: { openapi: string; paths: Record<string, Record<string, Operation>>; components: { schemas: Record<string, unknown> } };

beforeAll(async () => {
  const antwort = await t.request("/openapi.json", { als: null });
  expect(antwort.status).toBe(200);
  doc = await json(antwort);
});
afterAll(async () => {
  await pool.end();
});

const alsPfad = (muster: string) => muster.replace(/:([A-Za-z0-9_]+)/g, "{$1}").replace(/\*/g, "{pfad}");

describe("OpenAPI 3.1", () => {
  it("ist ohne Anmeldung abrufbar und ein gültiges OpenAPI-3.1-Dokument (Schema-Validator)", async () => {
    expect(doc.openapi).toBe("3.1.0");
    const ergebnis = await new Validator().validate(doc as never);
    expect(ergebnis.valid, JSON.stringify(ergebnis.errors)).toBe(true);
    // Gegenprobe: Der Validator erkennt ein kaputtes Dokument.
    const kaputt = { ...doc, paths: { "/x": { get: { responses: 42 } } } };
    expect((await new Validator().validate(kaputt as never)).valid).toBe(false);
  });

  it("deckt jede Route der Berechtigungstabelle ab und kennt keine Route ohne Regel", () => {
    const fehlend = REGELN.filter((r) => !doc.paths[alsPfad(r.muster)]?.[r.methode.toLowerCase()]).map((r) => `${r.methode} ${r.muster}`);
    expect(fehlend).toEqual([]);
    const ohneRegel: string[] = [];
    for (const [pfad, methoden] of Object.entries(doc.paths)) for (const [methode, op] of Object.entries(methoden)) if (!op["x-carraway-zugriff"]) ohneRegel.push(`${methode} ${pfad}`);
    expect(ohneRegel).toEqual([]);
    const anzahl = Object.values(doc.paths).reduce((n, m) => n + Object.keys(m).length, 0);
    expect(anzahl).toBe(REGELN.length);
  });

  it("Schemata aus den Zod-Validatoren: Körper, Abfrage, Pfad, Idempotency-Key, Zugriff", () => {
    const neu = doc.paths["/organisationen"]!.post!;
    const schema = neu.requestBody!.content["application/json"]!.schema as { properties: Record<string, { enum?: string[] }>; required: string[] };
    expect(Object.keys(schema.properties)).toEqual(expect.arrayContaining(["name", "art", "sektor", "ort", "website", "dubletteBestaetigt"]));
    expect(schema.properties.art!.enum).toEqual(["unternehmen", "investor", "berater", "sonstige"]);
    expect(schema.required).toEqual(expect.arrayContaining(["name", "art"]));
    expect(neu.parameters!.some((p) => p.$ref === "#/components/parameters/IdempotencyKey")).toBe(true);
    expect(neu["x-carraway-zugriff"]).toMatchObject({ zugriff: "rolle", rolle: "bearbeiter" });

    const liste = doc.paths["/organisationen"]!.get!;
    expect(liste.parameters!.map((p) => p.name)).toEqual(expect.arrayContaining(["suche", "art", "limit", "cursor", "geaendertSeit"]));
    const detail = doc.paths["/organisationen/{id}"]!.get!;
    expect(detail.parameters![0]).toMatchObject({ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } });
    expect(doc.paths["/fonds"]!.get!.parameters!.map((p) => p.name)).toContain("geaendertSeit");
    expect(doc.paths["/beteiligungen/{id}/instrumentdaten"]!.get!.parameters!.map((p) => p.name)).toEqual(expect.arrayContaining(["stichtag", "stand"]));
    expect(doc.paths["/stapel"]!.post!.requestBody!.content["application/json"]!.schema).toMatchObject({ properties: { operationen: { maxItems: 100 } } });
    expect(doc.paths["/import/laeufe"]!.post!.requestBody!.content["multipart/form-data"]).toBeDefined();
    const upload = doc.paths["/dokumente"]!.post!.requestBody!.content["multipart/form-data"]!.schema as { required: string[]; properties: Record<string, unknown> };
    expect(upload.required).toEqual(["datei", "ziele"]);
    expect(Object.keys(upload.properties)).toEqual(expect.arrayContaining(["datei", "ziele", "klassifikation", "vertraulich"]));
    expect(doc.paths["/dokumente/{id}/ersetzen"]!.post!.requestBody!.content["multipart/form-data"]).toBeDefined();
    expect(doc.paths["/dokumente/{id}/datei"]!.get!.parameters!.map((p) => p.name)).toEqual(expect.arrayContaining(["id", "inline"]));
    expect(doc.paths["/dokumente/suche"]!.get!.parameters!.map((p) => p.name)).toEqual(expect.arrayContaining(["q", "limit"]));
    expect(doc.paths["/dokumente/{id}"]!.delete!["x-carraway-zugriff"]).toMatchObject({ zugriff: "rolle", rolle: "verwalter" });
    expect(doc.paths["/aenderungen"]!.get!.parameters!.map((p) => p.name)).toEqual(expect.arrayContaining(["seit", "tabelle", "cursor", "limit"]));
    expect(doc.paths["/export"]!.get!["x-carraway-zugriff"]).toMatchObject({ zugriff: "globalverwalter" });
    expect(doc.paths["/gesundheit"]!.get!.security).toEqual([]);
    expect(doc.paths["/zinslaeufe/{id}/buchen"]!.post!["x-carraway-zugriff"]).toMatchObject({ rolle: "freigeber", nurMensch: true });
    expect(Object.keys(doc.components.schemas)).toEqual(expect.arrayContaining(["Fehlerantwort", "Feldfehler"]));
  });

  it("Docs-Seite: ohne Anmeldung, aus dem Dokument gerendert, ohne Skripte und externe Adressen", async () => {
    const antwort = await t.request("/docs", { als: null });
    expect(antwort.status).toBe(200);
    expect(antwort.headers.get("content-type")).toContain("text/html");
    expect(antwort.headers.get("content-security-policy")).toContain("default-src 'none'");
    const html = await antwort.text();
    expect(html).toContain("<title>Carraway API</title>");
    expect(html).toContain("/organisationen/{id}");
    expect(html).toContain("openapi.json");
    expect(html).not.toMatch(/<script|<link|<img|src="|href="https?:/i);
    expect(html.match(/<details/g)!.length).toBe(REGELN.length);
  });
});
