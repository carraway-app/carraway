import { afterAll, beforeEach, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { aenderung, kennzahlWert, organisation, providerConnection, providerSuggestion, registerBeobachtung, registerEreignis, registerMeldung, registereintrag, webhook, webhookAusgang } from "@carraway/db";
import { grundbestand, ID } from "./hilfen-instrumente";
import { json as responseJson, leeren, oeffneTestdb } from "./hilfen";
import { erstelleTestApp, idVon, person, STANDARD } from "./hilfen-auth";
import type { AbrufOptionen, Transport } from "../http/oeffentlicher-abruf";
import { northData } from "../data-providers/north-data";
import { companiesHouse } from "../data-providers/companies-house";
import { callProvider } from "../data-providers/access";
import { refreshLinked } from "../data-providers/monitor";
import { pruefeBeobachtung } from "../register/beobachtung";
import { ladeKonfiguration } from "../konfiguration";

const { db, pool } = oeffneTestdb();
beforeEach(() => leeren(db));
afterAll(() => pool.end());
const key = "credential-for-fixtures-only";
const reference = "123456789";
const northCompany = {
  name: { name: "Fixture GmbH", legalForm: "GmbH" }, address: { city: "Bonn" }, register: { uniqueKey: reference, city: "Bonn", id: "HRB 123" },
  northDataUrl: "https://www.northdata.de/fixture", relatedPersons: { items: [{ person: { name: { firstName: "Alex", lastName: "Example" } }, roles: [{ name: "Director", type: "Director" }] }] },
  financials: { date: "2025-12-31", consolidated: false, items: [{ id: "Revenue", value: 200, unit: "EUR" }, { id: "Employees", value: 1, estimate: true }] },
};
const json = (method: string, body?: unknown) => ({ method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
function fake(handler: (request: Parameters<Transport>[0]) => unknown, status = 200): AbrufOptionen {
  return { aufloeser: async () => ["93.184.216.34"], transport: async req => {
    const value = handler(req);
    return { status, kopf: { "retry-after": "45" }, rumpf: (async function* () { yield Buffer.from(JSON.stringify(value)); })(), abbrechen() {} };
  } };
}
const ring = ladeKonfiguration().schluessel!;
it("uses administrator-only keys and reconciles exact register identities against the reviewed local value", async () => {
  const logs: unknown[] = [];
  const http = fake(({ url, headers, ip }) => {
    expect(url.origin).toBe(northData.origin);
    expect(headers?.["x-api-key"]).toBe(key);
    expect(headers?.authorization).toBeUndefined();
    expect(ip).toBe("93.184.216.34");
    if (url.pathname.endsWith("universal")) return { results: [{ company: northCompany }] };
    if (url.pathname.endsWith("requests")) return { numberOfRequests: 1 };
    expect(url.searchParams.get("registerKey")).toBe(reference);
    if (url.pathname.endsWith("publications")) return { publications: [{ id: "fixture-event", date: "2026-01-04", title: "Annual accounts" }] };
    return northCompany;
  });
  const app = erstelleTestApp(db, { providerHttp: http, logger: (...args) => logs.push(args) });
  const [org] = await db.insert(organisation).values({ name: "Local", art: "unternehmen" }).returning();
  const id = org!.id;
  const url = "/organizations/" + id + "/provider-data";
  const admin = "/data-providers/north-data";
  const setup = json("PUT", { credential: key, monthlyLimit: 40 });
  expect(await (await app.requestApi(url)).json()).toEqual({ providers: [], data: [], provenance: [] });
  expect((await app.requestApi(admin, { ...setup, als: person("viewer") })).status).toBe(403);
  expect((await app.requestApi(admin, setup)).status).toBe(200);
  expect((await db.select().from(providerConnection))[0]?.credential).toMatch(/^f1\./);
  expect((await app.requestApi(admin + "/test", { method: "POST" })).status).toBe(200);
  expect(await (await app.requestApi("/integrations")).json()).toMatchObject({ data: [] });
  expect((await app.requestApi("/integrations/north-data/preview", { method: "POST" })).status).toBe(404);
  expect(await (await app.requestApi(url + "/search", json("POST", { provider: northData.id, query: "Fixture" }))).json()).toMatchObject({ data: [{ reference }] });
  const fetch = () => app.requestApi(url + "/fetch", json("POST", { provider: northData.id, reference }));
  expect((await fetch()).status).toBe(200);
  const [other] = await db.insert(organisation).values({ name: "Other", art: "unternehmen" }).returning();
  expect((await app.requestApi("/organizations/" + other!.id + "/provider-data/fetch", json("POST", { provider: northData.id, reference }))).status).toBe(409);
  const suggestions = () => db.select().from(providerSuggestion).where(eq(providerSuggestion.current, true));
  const rows = await suggestions();
  expect(rows.map(r => r.field)).toContain("financial.Revenue.2025-12-31");
  expect(rows.map(r => r.field)).not.toContain("financial.Employees.2025-12-31");
  expect((await db.select().from(registereintrag))[0]?.vertretung).toEqual([{ name: "Alex Example", funktion: "Director" }]);
  expect((await db.select().from(organisation))[0]?.name).toBe("Local");
  const review = (sid: string, decision: string) => app.requestApi(url + "/" + sid + "/review", json("POST", { decision }));
  const name = rows.find(r => r.field === "name")!;
  const location = rows.find(r => r.field === "city")!;
  expect((await review(location.id, "rejected")).status).toBe(200);
  await db.update(organisation).set({ name: "User edit" }).where(eq(organisation.id, id));
  expect((await review(name.id, "accepted")).status).toBe(409);
  expect((await fetch()).status).toBe(200);
  const updated = (await suggestions()).find(r => r.field === "name")!;
  expect(updated.id).not.toBe(name.id);
  await db.insert(webhook).values({ benutzerId: await idVon(db, STANDARD), url: "https://fixture.example/changes", geheimnisVerschluesselt: "fixture" });
  expect((await review(updated.id, "accepted")).status).toBe(200);
  const feed = await responseJson(await app.requestApi("/changes?table=organisation"));
  expect(feed.data).toMatchObject([{ recordId: id, action: "aendern",
    before: { id, name: "User edit" }, after: { id, name: northCompany.name.name } }]);
  expect(await db.select().from(webhookAusgang).where(eq(webhookAusgang.aenderungId, feed.data[0].id))).toHaveLength(1);
  expect((await suggestions()).find(r => r.field === "city")).toMatchObject({ id: location.id, status: "rejected" });
  expect((await db.select().from(organisation).where(eq(organisation.id, id)))[0]?.name).toBe(northCompany.name.name);
  const monitor = { name: northData.id, refresh: (orgId: string) => refreshLinked(db, ring, northData, orgId, http) };
  expect(await pruefeBeobachtung(db, monitor)).toMatchObject({ geprueft: 0 });
  await db.insert(registerBeobachtung).values({ organisationId: id, aktiv: true });
  expect(await pruefeBeobachtung(db, monitor, { max: 1 })).toMatchObject({ geprueft: 1, fehler: 0 });
  expect(await db.select().from(registerEreignis)).toHaveLength(1);
  expect(await db.select().from(registerMeldung)).toHaveLength(2);
  const settings = await (await app.requestApi("/data-providers")).text();
  expect(JSON.parse(settings).data).toContainEqual(expect.objectContaining({ id: northData.id, calls: 10 }));
  expect((await app.requestApi(admin, { method: "DELETE" })).status).toBe(200);
  expect(await (await app.requestApi(url)).json()).toMatchObject({ providers: [], data: expect.arrayContaining([expect.objectContaining({ id: updated.id, status: "accepted", sourceUrl: northCompany.northDataUrl })]) });
  expect([settings, JSON.stringify(await db.select().from(aenderung)), JSON.stringify(logs)].join(" ")).not.toContain(key);
});

it("maps Companies House Basic authentication, officers and recent filings, and enforces concurrent monthly limits", async () => {
  const http = fake(({ url, headers }) => {
    expect(headers?.authorization).toBe("Basic " + Buffer.from(key + ":").toString("base64"));
    if (url.pathname === "/search/companies") return { items: [{ company_number: "SC000001", title: "Fixture Ltd" }] };
    if (url.pathname.endsWith("officers")) return { total_results: 2, items: [{ name: "A. Example", officer_role: "director" }, { name: "Former", officer_role: "director", resigned_on: "2020-01-01" }] };
    if (url.pathname.endsWith("filing-history")) return { items: [{ transaction_id: "filing-1", date: "2026-01-01", type: "AA", description: "accounts" }] };
    return { company_number: "SC000001", company_name: "Fixture Ltd", type: "ltd", registered_office_address: { locality: "Edinburgh" },
      links: { officers: "/company/SC000001/officers", filing_history: "/company/SC000001/filing-history" } };
  });
  const app = erstelleTestApp(db, { providerHttp: http });
  const [org] = await db.insert(organisation).values({ name: "Local Ltd", art: "unternehmen" }).returning();
  const admin = "/data-providers/companies-house";
  expect((await app.requestApi(admin, json("PUT", { credential: key, monthlyLimit: 4 }))).status).toBe(200);
  expect((await app.requestApi("/organizations/" + org!.id + "/provider-data/fetch", json("POST", { provider: companiesHouse.id, reference: "SC000001" }))).status).toBe(200);
  expect((await db.select().from(providerSuggestion)).find(r => r.field === "representatives")?.value).toBe("A. Example (director)");
  const attempts = await Promise.all([0, 1].map(() => app.requestApi(admin + "/test", { method: "POST" })));
  expect(attempts.map(r => r.status).sort()).toEqual([200, 409]);
});

it("redacts errors and persists Retry-After across calls and processes", async () => {
  const app = erstelleTestApp(db);
  await app.requestApi("/data-providers/north-data", json("PUT", { credential: key, monthlyLimit: null }));
  let calls = 0;
  const run = (status: number) => callProvider(db, ring, northData, r => northData.test(r), fake(() => { calls++; return { error: key }; }, status));
  await expect(run(401)).rejects.toMatchObject({ code: "provider_key_invalid" });
  expect(await db.select().from(providerConnection)).toMatchObject([{ lastError: "provider_key_invalid" }]);
  await expect(run(200)).rejects.toMatchObject({ code: "provider_response_invalid" });
  await expect(run(429)).rejects.toMatchObject({ code: "provider_rate_limited" });
  await expect(run(200)).rejects.toMatchObject({ code: "provider_rate_limited" });
  expect(calls).toBe(5);
  expect(await (await app.requestApi("/data-providers")).text()).not.toContain(key);
});

it("imports a reviewed annual figure only into the chosen company's investment and requires the reported unit", async () => {
  await grundbestand(db);
  const app = erstelleTestApp(db);
  const [row] = await db.insert(providerSuggestion).values({ organizationId: ID.orgA, provider: northData.id, reference, field: "financial.Revenue.2025-12-31",
    value: "200 EUR", sourceUrl: northCompany.northDataUrl, retrievedAt: new Date() }).returning();
  const apply = (id: string, metricKey: string) => app.requestApi("/investments/" + id + "/metrics/provider-values", json("POST", { suggestionId: row!.id, metricKey, periodStart: "2025-01-01" }));
  expect((await apply(ID.darlehen, "umsatz")).status).toBe(409);
  expect((await apply(ID.eigen, "kundenzahl")).status).toBe(400);
  expect(await db.select().from(kennzahlWert)).toHaveLength(0);
  expect((await apply(ID.eigen, "umsatz")).status).toBe(201);
  expect((await apply(ID.eigen, "umsatz")).status).toBe(409);
  const [draft] = await db.select().from(kennzahlWert);
  expect(await db.select().from(kennzahlWert)).toMatchObject([{ wert: "200", quelle: "import", status: "entwurf", quellenangabe: expect.stringContaining(northCompany.northDataUrl) }]);
  expect((await app.requestApi("/metrics/values/" + draft!.id + "/discard", { method: "POST" })).status).toBe(200);
  expect((await apply(ID.eigen, "umsatz")).status).toBe(201);
  expect((await apply(ID.eigen, "umsatz")).status).toBe(409);
});

it("retries only the failed officer page, counts each request and keeps valid distinct entries", async () => {
  const app = erstelleTestApp(db);
  const [org] = await db.insert(organisation).values({ name: "Fixture", art: "unternehmen" }).returning();
  await app.requestApi("/data-providers/companies-house", json("PUT", { credential: key, monthlyLimit: 4 }));
  const offsets: string[] = [];
  const officer = { name: "A", officer_role: "director", links: { officer: { appointments: "/officers/first/appointments" } } };
  const http = fake(({ url }) => {
    if (!url.pathname.endsWith("officers")) return { company_number: "SC000001", company_name: "Fixture", type: "ltd", registered_office_address: {}, links: { officers: "officers" } };
    const offset = url.searchParams.get("start_index")!;
    offsets.push(offset);
    if (offset === "0") return { total_results: 4, items: [officer, { invalid: true }] };
    if (offsets.length === 2) throw Object.assign(new Error(), { code: "ECONNRESET" });
    return { total_results: 5, items: [officer, { ...officer, links: { officer: { appointments: "/officers/other/appointments" } } }, { name: "B", officer_role: "secretary" }] };
  });
  const value = await callProvider(db, ring, companiesHouse, r => companiesHouse.retrieve(r, org!, "SC000001"), http);
  expect(value.fields.representatives).toBe("A (director)\nA (director)\nB (secretary)");
  expect(offsets).toEqual(["0", "2", "2"]);
  expect((await app.requestApi("/data-providers/companies-house/test", { method: "POST" })).status).toBe(409);
});

it("keeps valid North Data publications, figures and candidates alongside malformed rows", async () => {
  const [org] = await db.insert(organisation).values({ name: "Fixture", art: "unternehmen" }).returning();
  const results = await northData.search!(async () => ({ results: [{ company: {} }, { company: northCompany }] }), "Fixture");
  expect(results).toHaveLength(1);
  const payload = { ...northCompany, financials: { ...northCompany.financials, items: [null, ...northCompany.financials.items] } };
  const value = await northData.retrieve(async path => path.includes("publications") ? { publications: [null, { id: "ok", date: "2026-02-03", title: "Report" }] } : payload, org!, reference);
  expect(value.events).toHaveLength(1);
  expect(value.fields["financial.Revenue.2025-12-31"]).toBe("200 EUR");
});

it("keeps valid field suggestions when an adjacent provider field exceeds the local limit", async () => {
  const [org] = await db.insert(organisation).values({ name: "Local", art: "unternehmen" }).returning();
  const app = erstelleTestApp(db, { providerHttp: fake(({ url }) => url.pathname.endsWith("publications") ? {} :
    { ...northCompany, address: { city: "X".repeat(201) } }) });
  await app.requestApi("/data-providers/north-data", json("PUT", { credential: key, monthlyLimit: 10 }));
  const response = await app.requestApi("/organizations/" + org!.id + "/provider-data/fetch", json("POST", { provider: northData.id, reference }));
  expect(response.status).toBe(200);
  const fields = (await db.select().from(providerSuggestion)).map(r => r.field);
  expect(fields).toContain("name");
  expect(fields).not.toContain("city");
});

it("keeps a partial officer list out of the register snapshot while retaining independent fields", async () => {
  const [org] = await db.insert(organisation).values({ name: "Local", art: "unternehmen" }).returning();
  const value = await northData.retrieve(async path => path.includes("publications") ? {} :
    { ...northCompany, relatedPersons: { items: [...northCompany.relatedPersons.items, { malformed: true }] } }, org!, reference);
  expect(value.entry).toBeUndefined();
  expect(value.fields.name).toBe(northCompany.name.name);
});

it("requires a fresh review when another provider's suggestion for the same field was accepted", async () => {
  const [org] = await db.insert(organisation).values({ name: "Local", art: "unternehmen" }).returning();
  const app = erstelleTestApp(db, { providerHttp: fake(({ url }) => {
    if (url.origin === companiesHouse.origin) return { company_number: "SC000001", company_name: "UK name", type: "ltd", registered_office_address: {}, links: {} };
    return url.pathname.endsWith("publications") ? {} : northCompany;
  }) });
  const path = "/organizations/" + org!.id + "/provider-data";
  for (const [provider, ref] of [[northData.id, reference], [companiesHouse.id, "SC000001"]]) {
    await app.requestApi("/data-providers/" + provider, json("PUT", { credential: key, monthlyLimit: 10 }));
    expect((await app.requestApi(path + "/fetch", json("POST", { provider, reference: ref }))).status).toBe(200);
  }
  const rows = await db.select().from(providerSuggestion).where(eq(providerSuggestion.field, "name"));
  expect(rows).toHaveLength(2);
  const accept = (provider: string) => app.requestApi(path + "/" + rows.find(row => row.provider === provider)!.id + "/review", json("POST", { decision: "accepted" }));
  expect((await accept(companiesHouse.id)).status).toBe(200);
  expect((await accept(northData.id)).status).toBe(409);
  expect((await db.select().from(organisation))[0]?.name).toBe("UK name");
});

it("keeps the last provider check intact on invalid input and local rate limits", async () => {
  const app = erstelleTestApp(db, { providerHttp: fake(() => ({ numberOfRequests: 1 })) });
  const [org] = await db.insert(organisation).values({ name: "Local", art: "unternehmen" }).returning();
  await app.requestApi("/data-providers/north-data", json("PUT", { credential: key, monthlyLimit: null }));
  expect((await app.requestApi("/data-providers/north-data/test", { method: "POST" })).status).toBe(200);
  const status = () => db.select({ lastError: providerConnection.lastError, checkedAt: providerConnection.checkedAt }).from(providerConnection);
  const checked = await status();
  expect((await app.requestApi("/organizations/" + org!.id + "/provider-data/fetch", json("POST", { provider: northData.id, reference: "invalid" }))).status).toBe(400);
  expect.soft(await status()).toEqual(checked);
  await db.update(providerConnection).set({ recentRequests: Array(northData.rate.calls).fill(Date.now()) });
  expect((await app.requestApi("/data-providers/north-data/test", { method: "POST" })).status).toBe(429);
  expect(await status()).toEqual(checked);
});
