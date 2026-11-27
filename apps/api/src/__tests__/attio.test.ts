import { afterAll, beforeEach, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { aktivitaet, deal, feldDefinition, organisation, person, providerConnection, providerRun } from "@carraway/db";
import type { Transport } from "../http/oeffentlicher-abruf";
import { requestFor } from "../integrationen/http";
import { attio } from "../integrationen/attio";
import { mappingSchema } from "../integrationen/provider";
import { processPage } from "../integrationen/runs";
import { ladeKonfiguration } from "../konfiguration";
import { leeren, oeffneTestdb } from "./hilfen";
import { erstelleTestApp, person as testPerson } from "./hilfen-auth";

const { db, pool } = oeffneTestdb();
const app = erstelleTestApp(db);
const ring = ladeKonfiguration().schluessel!;
const credential = "test-only-access-token";
const responses: Record<string, object[]> = {
  "/v2/objects/companies/records/query": [{ id: { record_id: "c" }, values: { name: [{ value: "Example" }], domains: [{ domain: "example.test" }], segment: [{ value: "Research" }] } }],
  "/v2/objects/people/records/query": [{ id: { record_id: "p" }, values: { name: [{ first_name: "Alex", last_name: "Example" }], email_addresses: [{ email_address: "alex@example.test" }], company: [{ target_record_id: "c" }] } }],
  "/v2/objects/deals/records/query": [{ id: { record_id: "d" }, values: { name: [{ value: "Review" }], associated_company: [{ target_record_id: "c" }], stage: [{ status: { title: "Review" } }] } }],
  "/v2/lists/leads/entries/query": [{ id: { entry_id: "e" }, parent_object: "companies", parent_record_id: "c", entry_values: {} }],
  "/v2/notes": [{ id: { note_id: "n" }, parent_object: "deals", parent_record_id: "d", title: "Call", content_plaintext: "Example note", created_at: "2026-01-02" }],
};
const transport: Transport = async ({ url, headers, body, ip }) => {
  expect(url.origin).toBe(attio.origin);
  expect(headers?.authorization).toBe("Bearer " + credential);
  expect(ip).toBe("93.184.216.34");
  if (url.pathname.endsWith("/query")) expect(JSON.parse(body!)).toEqual({ limit: 50, offset: 0, sorts: [{ attribute: "created_at", direction: "asc" }, { attribute: url.pathname.includes("/lists/") ? "entry_id" : "record_id", direction: "asc" }] });
  expect(responses[url.pathname]).toBeDefined();
  return { status: 200, kopf: {}, rumpf: (async function* () { yield Buffer.from(JSON.stringify({ data: responses[url.pathname] })); })(), abbrechen() {} };
};
const step = () => processPage(db, ring, { transport, aufloeser: async () => ["93.184.216.34"] });
beforeEach(() => leeren(db));
afterAll(() => pool.end());
it("previews all streams as administrator, stores an encrypted credential, applies the approved snapshot and allows cancellation", async () => {
  const [field] = await db.insert(feldDefinition).values({ objekt: "organisation", typ: "text", name: "Segment", schluessel: "segment" }).returning();
  const setup = { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ credential, mapping: { fields: [{ resource: "organization", source: "segment", target: field!.id }], lists: ["leads"], stages: { Review: "screening" } } }) };
  expect((await app.requestApi("/integrations/attio", { ...setup, als: testPerson("reader") })).status).toBe(403);
  expect((await app.requestApi("/integrations/attio", setup)).status).toBe(200);
  expect((await db.select().from(providerConnection))[0]?.credential).toMatch(/^f1\./);
  expect(await (await app.requestApi("/integrations")).text()).not.toContain(credential);
  const run = await (await app.requestApi("/integrations/attio/preview", { method: "POST" })).json() as { id: string };
  for (let i = 0; i < 5; i++) await step();
  expect(await db.select().from(organisation)).toHaveLength(0);
  const history = await (await app.requestApi("/integrations/attio/runs")).json();
  expect(history).toMatchObject({ data: [{ id: run.id, status: "preview", received: 5 }] });
  expect((await app.requestApi("/integrations/runs/" + run.id + "/apply", { method: "POST" })).status).toBe(202);
  await step();
  expect(await db.select().from(deal)).toEqual(expect.arrayContaining([expect.objectContaining({ titel: "Review", phase: "pruefung" }), expect.objectContaining({ titel: "Example" })]));
  expect((await db.select().from(organisation))[0]?.felder).toEqual({ [field!.id]: "Research" });
  expect((await db.select().from(aktivitaet))[0]?.notiz).toBe("Example note");
  expect((await db.select().from(person))[0]?.organisationId).toBe((await db.select().from(organisation))[0]?.id);
  const next = await (await app.requestApi("/integrations/attio/preview", { method: "POST" })).json() as { id: string };
  expect((await app.requestApi("/integrations/runs/" + next.id + "/cancel", { method: "POST" })).status).toBe(200);
  await step();
  expect((await db.select().from(providerRun).where(eq(providerRun.id, next.id)))[0]?.status).toBe("cancelled");
});
it("uses Attio offset pagination and honors a throttled HTTP response", async () => {
  const page = await attio.page(async (_path, query) => {
    expect(query).toMatchObject({ offset: 50, limit: 50, sorts: [{ attribute: "created_at", direction: "asc" }, { attribute: "record_id", direction: "asc" }] });
    return { data: Array.from({ length: 50 }, () => responses["/v2/objects/companies/records/query"]![0]) };
  }, "organization", "50", mappingSchema.parse({}));
  expect(page.next).toBe("100");
  const request = requestFor(attio, credential, { aufloeser: async () => ["93.184.216.34"], transport: async () => ({
    status: 429, kopf: { "retry-after": "62" }, rumpf: (async function* () { yield Buffer.alloc(0); })(), abbrechen() {},
  }) });
  await expect(request("/v2/notes")).rejects.toMatchObject({ code: "provider_rate_limit", retrySeconds: 62 });
  await expect(request("https://example.test/v2/notes")).rejects.toMatchObject({ code: "invalid_page_url" });
  await expect(requestFor(attio, credential, { aufloeser: async () => ["127.0.0.1"], transport })("/v2/notes")).rejects.toThrow();
});

it("isolates an invalid attribute without losing its record identity", async () => {
  const page = await attio.page(async () => ({ data: [{ id: { record_id: "bad" }, values: { name: "invalid" } }, ...responses["/v2/objects/companies/records/query"]!] }),
    "organization", null, mappingSchema.parse({}));
  expect(page.records).toMatchObject([{ externalId: "bad", invalidReason: "invalid_record" }, { externalId: "c", name: "Example" }]);
});
