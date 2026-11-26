import { Validator } from "@seriousme/openapi-schema-validator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { REGELN } from "../rechte/tabelle";
import { json, oeffneTestdb } from "./hilfen";
import { erstelleTestApp } from "./hilfen-auth";

const { db, pool } = oeffneTestdb();
const t = erstelleTestApp(db);

type Operation = { parameters?: { name?: string; in?: string; required?: boolean; schema?: Record<string, unknown>; $ref?: string }[]; requestBody?: { content: Record<string, { schema: Record<string, unknown> }> }; "x-carraway-access": unknown; security: unknown[] };
let doc: { openapi: string; paths: Record<string, Record<string, Operation>>; components: { schemas: Record<string, unknown> } };

beforeAll(async () => {
  const antwort = await t.request("/openapi.json", { als: null });
  expect(antwort.status).toBe(200);
  doc = await json(antwort);
});
afterAll(async () => {
  await pool.end();
});

const alsPfad = (muster: string) => muster.replace(/:([A-Za-z0-9_]+)/g, "{$1}").replace(/\*/g, "{path}");

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
    for (const [pfad, methoden] of Object.entries(doc.paths)) for (const [methode, op] of Object.entries(methoden)) if (!op["x-carraway-access"]) ohneRegel.push(`${methode} ${pfad}`);
    expect(ohneRegel).toEqual([]);
    const anzahl = Object.values(doc.paths).reduce((n, m) => n + Object.keys(m).length, 0);
    expect(anzahl).toBe(REGELN.length);
  });

  it("Schemata aus den Zod-Validatoren: Körper, Abfrage, Pfad, Idempotency-Key, Zugriff", () => {
    const neu = doc.paths["/organizations"]!.post!;
    const schema = neu.requestBody!.content["application/json"]!.schema as { properties: Record<string, { enum?: string[] }>; required: string[] };
    expect(Object.keys(schema.properties)).toEqual(expect.arrayContaining(["name", "kind", "sector", "city", "website", "duplicateConfirmed"]));
    expect(schema.properties.kind!.enum).toEqual(["company", "investor", "advisor", "other"]);
    expect(schema.required).toEqual(expect.arrayContaining(["name", "kind"]));
    expect(neu.parameters!.some((p) => p.$ref === "#/components/parameters/IdempotencyKey")).toBe(true);
    expect(neu["x-carraway-access"]).toMatchObject({ access: "role", role: "editor" });

    const liste = doc.paths["/organizations"]!.get!;
    expect(liste.parameters!.map((p) => p.name)).toEqual(expect.arrayContaining(["search", "kind", "limit", "cursor", "changedSince"]));
    const detail = doc.paths["/organizations/{id}"]!.get!;
    expect(detail.parameters![0]).toMatchObject({ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } });
    expect(doc.paths["/funds"]!.get!.parameters!.map((p) => p.name)).toContain("changedSince");
    expect(doc.paths["/investments/{id}/instrument-data"]!.get!.parameters!.map((p) => p.name)).toEqual(expect.arrayContaining(["asOf", "knowledgeDate"]));
    expect(doc.paths["/batch"]!.post!.requestBody!.content["application/json"]!.schema).toMatchObject({ properties: { operations: { maxItems: 100 } } });
    expect(doc.paths["/import/runs"]!.post!.requestBody!.content["multipart/form-data"]).toBeDefined();
    const upload = doc.paths["/documents"]!.post!.requestBody!.content["multipart/form-data"]!.schema as { required: string[]; properties: Record<string, unknown> };
    expect(upload.required).toEqual(["file", "targets"]);
    expect(Object.keys(upload.properties)).toEqual(expect.arrayContaining(["file", "targets", "classification", "confidential"]));
    expect(doc.paths["/documents/{id}/replace"]!.post!.requestBody!.content["multipart/form-data"]).toBeDefined();
    expect(doc.paths["/documents/{id}/file"]!.get!.parameters!.map((p) => p.name)).toEqual(expect.arrayContaining(["id", "inline"]));
    expect(doc.paths["/documents/search"]!.get!.parameters!.map((p) => p.name)).toEqual(expect.arrayContaining(["q", "limit"]));
    expect(doc.paths["/documents/{id}"]!.delete!["x-carraway-access"]).toMatchObject({ access: "role", role: "admin" });
    expect(doc.paths["/changes"]!.get!.parameters!.map((p) => p.name)).toEqual(expect.arrayContaining(["since", "table", "cursor", "limit"]));
    expect(doc.paths["/export"]!.get!["x-carraway-access"]).toMatchObject({ access: "global_admin" });
    expect(doc.paths["/health"]!.get!.security).toEqual([]);
    expect(doc.paths["/interest-runs/{id}/post"]!.post!["x-carraway-access"]).toMatchObject({ role: "approver", humanOnly: true });
    expect(doc.paths["/funds/{fundId}/investor-access/closings"]!.post!.parameters)
      .toContainEqual(expect.objectContaining({ name: "fundId", in: "path", required: true }));
    expect(doc.paths["/funds/{id}/fees-and-expenses"]!.post!.requestBody!.content["application/json"]!.schema)
      .toMatchObject({ properties: { type: { enum: ["management_fee", "fund_expense"] } } });
    expect(Object.keys(doc.components.schemas)).toEqual(expect.arrayContaining(["ErrorResponse", "FieldError"]));
  });

  it("beschreibt die englischen Buchhaltungsrouten einschließlich Upload und Belegprüfung", () => {
    expect(doc.paths["/funds/{id}/balance-runs"]!.post!.requestBody!.content["multipart/form-data"]!.schema)
      .toMatchObject({ required: ["file", "periodFrom", "periodTo"] });
    expect(doc.paths["/vouchers/{id}/stage"]!.post!.requestBody!.content["application/json"]!.schema)
      .toMatchObject({ properties: { stage: { enum: ["review", "approval"] }, result: { enum: ["ok", "returned"] } } });
    for (const pfad of ["/belege", "/stapel", "/fonds/{id}/buchungen", "/beteiligungen/{id}/vorgaenge", "/vorgaenge/{id}/storno"]) {
      expect(doc.paths[pfad]).toBeUndefined();
    }
  });

  it("veröffentlicht die englischen Berichts- und Meldeschemata", () => {
    expect(doc.paths["/reports"]!.post!.requestBody!.content["application/json"]!.schema).toMatchObject({
      properties: { reportType: { enum: expect.arrayContaining(["fund_report", "lp_report", "pai_statement"]) }, fundId: { format: "uuid" } },
    });
    const definition = doc.paths["/reporting-definitions"]!.post!.requestBody!.content["application/json"]!.schema;
    expect(definition).toMatchObject({ properties: { definition: { properties: { sections: {}, rules: {} } } } });
    expect(doc.paths["/funds/{id}/reports/fund-report"]!.get!.parameters!.map((p) => p.name)).toEqual(
      expect.arrayContaining(["asOf", "knowledgeDate", "language", "currencyView", "comparisonCurrency"]),
    );
    for (const pfad of ["/berichte", "/meldelaeufe", "/meldedefinitionen", "/dokumente", "/import/laeufe", "/beschlussvorlagen"]) {
      expect(doc.paths[pfad]).toBeUndefined();
    }
  });

  it("weist deutsche Dokumentpfade, Felder und Enum-Werte am HTTP-Eingang ab", async () => {
    const alt = await t.requestApi("/dokumente");
    expect(alt.status).toBe(403);
    const liste = await t.requestApi("/documents?status=active");
    expect(liste.status).toBe(200);
    const daten = await liste.json();
    expect(daten).toHaveProperty("data");
    expect(daten).not.toHaveProperty("daten");
    const falsch = await t.requestApi("/documents?status=aktiv");
    expect(falsch.status).toBe(400);
    expect(await falsch.json()).toMatchObject({ error: { code: "invalid_input", fields: [{ field: "status" }] } });
  });

  it("Docs-Seite: ohne Anmeldung, aus dem Dokument gerendert, ohne Skripte und externe Adressen", async () => {
    const antwort = await t.request("/docs", { als: null });
    expect(antwort.status).toBe(200);
    expect(antwort.headers.get("content-type")).toContain("text/html");
    expect(antwort.headers.get("content-security-policy")).toContain("default-src 'none'");
    const html = await antwort.text();
    expect(html).toContain("<title>Carraway API</title>");
    expect(html).toContain("/organizations/{id}");
    expect(html).toContain("openapi.json");
    expect(html).not.toMatch(/<script|<link|<img|src="|href="https?:/i);
    expect(html.match(/<details/g)!.length).toBe(REGELN.length);
  });
});
