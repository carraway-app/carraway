import { readFileSync } from "node:fs";
import { z } from "zod";
import { afterAll, beforeEach, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { deal, feldDefinition, organisation, providerConnection, providerRun, providerSource } from "@carraway/db";
import { ladeKonfiguration } from "../konfiguration";
import { credentialAad } from "../integrationen/connection";
import { processPage } from "../integrationen/runs";
import { mappingSchema, type CrmProvider } from "../integrationen/provider";
import { leeren, oeffneTestdb } from "./hilfen";
import { randomUUID } from "node:crypto";

const { db, pool } = oeffneTestdb();
const ring = ladeKonfiguration().schluessel!;
beforeEach(() => leeren(db));
afterAll(() => pool.end());
it("stages a complete snapshot, preserves matched data and repeats by source ID", async () => {
  const id = randomUUID();
  const mapping = mappingSchema.parse({ deals: false, notes: false });
  await db.insert(providerConnection).values({ id, provider: "fixture", credential: ring.verschluessele("example-token", credentialAad(id)), mapping });
  await db.insert(organisation).values({ name: "Existing", website: "https://www.example.test/about", art: "unternehmen" });
  const provider: CrmProvider = { id: "fixture", origin: "https://example.test", page: async (_request, stream) => ({
    records: stream === "organization" ? [{ resource: "organization", externalId: "company-1", name: "Remote", domain: "example.test" }] : [], next: null,
  }) };
  for (let i = 0; i < 2; i++) {
    const [run] = await db.insert(providerRun).values({ connectionId: id, actor: "system", kind: "import", mapping }).returning();
    const step = () => processPage(db, ring, { registry: [provider] });
    await step();
    await step();
    expect((await db.select().from(providerRun).where(eq(providerRun.id, run!.id)))[0]).toMatchObject({ status: "preview", matched: 1, applied: 0 });
    await db.update(providerRun).set({ status: "applying" }).where(eq(providerRun.id, run!.id));
    await step();
    expect((await db.select().from(providerRun).where(eq(providerRun.id, run!.id)))[0]?.status).toBe("completed");
  }
  expect(await db.select().from(providerSource)).toHaveLength(1);
  expect((await db.select().from(organisation)).map(o => o.name)).toEqual(["Existing"]);
});

async function preview(provider: CrmProvider, options: Parameters<typeof processPage>[2] = {}) {
  const mapping = mappingSchema.parse({ notes: false, stages: { Signed: "closing" } });
  const id = randomUUID();
  await db.insert(providerConnection).values({ id, provider: provider.id, credential: ring.verschluessele("fixture", credentialAad(id)), mapping });
  const [run] = await db.insert(providerRun).values({ connectionId: id, actor: "system", kind: "import", mapping }).returning();
  const where = eq(providerRun.id, run!.id);
  return { step: () => processPage(db, ring, { registry: [provider], ...options }),
    state: async () => (await db.select().from(providerRun).where(where))[0]!,
    apply: () => db.update(providerRun).set({ status: "applying" }).where(where),
    wake: () => db.update(providerRun).set({ availableAt: new Date(0) }).where(where) };
}

it("reports missing resolutions before approval and imports the remaining fund-independent deal", async () => {
  const run = await preview({ id: "fixture", origin: "https://fixture.example", page: async (_, stream) => ({
    records: stream === "organization" ? [{ resource: "organization", externalId: "c", name: "Company" }] : stream === "deal" ? [
      { resource: "deal", externalId: "closing", organizationId: "c", name: "Needs approval", stage: "Signed" },
      { resource: "deal", externalId: "good", organizationId: "c", name: "Open deal" },
    ] : [], next: null }) });
  for (let i = 0; i < 3; i++) await run.step();
  expect(await run.state()).toMatchObject({ status: "preview", skipReasons: { resolution_missing: 1 } });
  await run.apply();
  await run.step();
  expect(await run.state()).toMatchObject({ status: "completed", applied: 2, skipReasons: { resolution_missing: 1 } });
  expect(await db.select().from(deal)).toMatchObject([{ titel: "Open deal", fondsId: null }]);
});

it("isolates invalid records and their dependants, including field validation that changes after preview", async () => {
  const [field] = await db.insert(feldDefinition).values({ objekt: "deal", typ: "text", name: "Category", schluessel: "category" }).returning();
  const run = await preview({ id: "fixture", origin: "https://fixture.example", page: async (_, stream) => ({
    records: stream === "organization" ? [{ resource: "organization", externalId: "org", name: "Valid" }] : stream === "person" ? [
      { resource: "person", externalId: "empty" }, { resource: "person", externalId: "ok", name: "Good" },
    ] : [{ resource: "deal", externalId: "no-org", name: "Incomplete" },
      { resource: "deal", externalId: "bad-ref", name: "Missing", organizationId: "unknown" },
      { resource: "deal", externalId: "bad-field", name: "Invalid", organizationId: "org", custom: { [field!.id]: { unsupported: true } } },
      { resource: "deal", externalId: "valid-at-preview", name: "Valid", organizationId: "org", custom: { [field!.id]: "Category" } },
      { resource: "deal", externalId: "after", name: "Following", organizationId: "org" }], next: null }) });
  for (let i = 0; i < 3; i++) await run.step();
  expect(await run.state()).toMatchObject({ status: "preview", skipReasons: { missing_name: 1, deal_requires_company_and_title: 1, missing_related_record: 1, invalid_custom_value: 1 } });
  await db.update(feldDefinition).set({ archiviertAm: new Date() }).where(eq(feldDefinition.id, field!.id));
  await run.apply();
  await run.step();
  expect(await run.state()).toMatchObject({ status: "completed", applied: 3, skipReasons: { invalid_custom_value: 1, invalid_custom_field: 1 } });
  expect(await db.select().from(deal)).toMatchObject([{ titel: "Following" }]);
});

it("counts overlapping page identities once and advances past a full application batch", async () => {
  const run = await preview({ id: "fixture", origin: "https://fixture.example", page: async (_, stream, token) => ({
    records: stream === "organization" ? Array.from({ length: 41 }, (_, i) => ({ resource: "organization", name: "Company " + i, externalId: String(i + (token ? 40 : 0)) })) : [],
    next: stream === "organization" && !token ? "more" : null }) });
  for (let i = 0; i < 4; i++) await run.step();
  expect(await run.state()).toMatchObject({ received: 81, status: "preview" });
  await run.apply();
  for (let i = 0; i < 3; i++) await run.step();
  expect(await run.state()).toMatchObject({ status: "completed", applied: 81 });
});

it.each(["network", "timeout", "502", "schema"])("retries %s at the saved page with increasing backoff", async failure => {
  const tokens: (string | null)[] = [];
  let failures = 2;
  const run = await preview({ id: "fixture", origin: "https://fixture.example", page: async (request, stream, token) => {
    tokens.push(token);
    if (stream === "organization" && token) z.object({ data: z.array(z.string()) }).parse(await request("/v2/page"));
    return { records: [], next: stream === "organization" && !token ? "second" : null };
  } }, { aufloeser: async () => ["93.184.216.34"], transport: async () => {
    const failing = failures-- > 0;
    if (failing && failure === "network") throw Object.assign(new Error(), { code: "ECONNRESET" });
    if (failing && failure === "timeout") throw new DOMException("Timed out", "TimeoutError");
    return { status: failing && failure === "502" ? 502 : 200, kopf: {}, abbrechen() {},
      rumpf: (async function* () { yield Buffer.from(JSON.stringify(failing ? {} : { data: [] })); })() };
  } });
  await run.step();
  await run.step();
  const first = await run.state();
  expect(first).toMatchObject({ status: "reading", pages: 1, retries: 1 });
  expect(first.availableAt.getTime()).toBeGreaterThan(Date.now());
  await run.wake();
  await run.step();
  expect((await run.state()).availableAt.getTime()).toBeGreaterThan(first.availableAt.getTime());
  await run.wake();
  await run.step();
  expect(await run.state()).toMatchObject({ pages: 2, retries: 0 });
  expect(tokens).toEqual([null, "second", "second", "second"]);
});

it("rejects dotted and oversized mapping keys", () => {
  for (const key of ["..", "a.b", "x".repeat(161)]) {
    expect(mappingSchema.safeParse({ lists: [key] }).success).toBe(false);
    expect(mappingSchema.safeParse({ fields: [{ resource: "organization", source: key, target: "name" }] }).success).toBe(false);
  }
});

it("keeps reading when a provider string cannot be stored in PostgreSQL JSON", async () => {
  const run = await preview({ id: "fixture", origin: "https://fixture.example", page: async (_, stream) => ({
    records: stream === "organization" ? [{ resource: "organization", externalId: "broken", name: "Invalid\u0000text" },
      { resource: "organization", externalId: "good", name: "Valid" }] : [], next: null }) });
  for (let i = 0; i < 3; i++) await run.step();
  expect(await run.state()).toMatchObject({ status: "preview", skipReasons: { invalid_record: 1 } });
  await run.apply();
  await run.step();
  expect(await run.state()).toMatchObject({ status: "completed", applied: 1 });
});

it("documents who can see unassigned deals and when related contacts are archived", () => {
  const guide = readFileSync(new URL("../../../../docs/integrations/crm.md", import.meta.url), "utf8");
  expect(guide).toMatch(/without a fund[^.]+Dealflow access/i);
  expect(guide).toMatch(/contacts remain active[^.]+company/i);
});
