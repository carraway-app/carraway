import { and, asc, desc, eq, getTableColumns, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { providerConnection as connection, providerSuggestion as suggestion, providerUsage, providerSource, type Db } from "@carraway/db";
import type { AbrufOptionen } from "../http/oeffentlicher-abruf";
import type { Schluesselring } from "../geheimnis/krypto";
import { Fachfehler } from "../fehler";
import { saveConnection } from "../integrationen/connection";
import { pruefe } from "../pruefung";
import { schreibe } from "../schreiben";
import { lese } from "../zeitlimit";
import { linkedRegisters } from "./links";
import { importMetric } from "./metric";
import { callProvider, currentMonth } from "./access";
import { activeCompany, reconcile, review, stale } from "./reconcile";
import { companiesHouse } from "./companies-house";
import { northData } from "./north-data";
import { columnFor, type DataProvider } from "./types";

const { metricValueId: _metricValueId, ...evidenceColumns } = getTableColumns(suggestion);
const providerParam = z.object({ provider: z.string().regex(/^[a-z0-9-]+$/) });
const companyParam = z.object({ id: z.uuid() });
const keySettings = z.strictObject({
  credential: z.string().trim().min(1).max(8192).regex(/^[\x21-\x7e]+$/).optional(),
  monthlyLimit: z.number().int().positive().max(10_000_000).nullable(),
});

export function dataRoutes(db: Db, ring: Schluesselring | undefined, extensions: readonly DataProvider[], http?: AbrufOptionen) {
  const providers = [northData, companiesHouse, ...extensions];
  const ids = providers.map(p => p.id);
  const find = (id: string) => {
    const provider = providers.find(p => p.id === id);
    if (!provider) throw new Fachfehler(404, "not_found", "Unknown data provider.");
    return provider;
  };
  return new Hono()
    .get("/data-providers", async c => {
      const credentials = await db.select({ provider: connection.provider, checkedAt: connection.checkedAt, lastError: connection.lastError, monthlyLimit: connection.monthlyLimit })
        .from(connection).where(inArray(connection.provider, ids));
      const month = currentMonth();
      const counts = await db.select().from(providerUsage).where(eq(providerUsage.month, month));
      return c.json({ month, data: providers.map(p => {
        const key = credentials.find(k => k.provider === p.id);
        return { id: p.id, label: p.label, configured: !!key, checkedAt: key?.checkedAt ?? null, lastError: key?.lastError ?? null,
          monthlyLimit: key?.monthlyLimit ?? null, calls: counts.find(row => row.provider === p.id)?.calls ?? 0 };
      }) });
    })
    .put("/data-providers/:provider", pruefe("param", providerParam), pruefe("json", keySettings), async c => {
      const provider = find(c.req.valid("param").provider);
      const { credential, monthlyLimit } = c.req.valid("json");
      if (!ring) throw new Fachfehler(409, "secret_missing", "Credential encryption is unavailable.");
      await schreibe(db, c, async (tx, audit) => {
        const [existing] = await tx.select().from(connection).where(eq(connection.provider, provider.id)).for("update");
        const id = await saveConnection(tx, ring, provider.id, {}, credential, existing);
        await tx.update(connection).set({ monthlyLimit, ...(credential ? { checkedAt: null, lastError: null } : {}) }).where(eq(connection.id, id));
        await audit("provider_configured", "provider_connection", id, null, { provider: provider.id, monthlyLimit });
      });
      return c.json({ saved: true });
    })
    .delete("/data-providers/:provider", pruefe("param", providerParam), async c => {
      const provider = find(c.req.valid("param").provider);
      await schreibe(db, c, async (tx, audit) => {
        const [existing] = await tx.select({ id: connection.id }).from(connection).where(eq(connection.provider, provider.id)).for("update");
        if (existing) await tx.delete(providerSource).where(eq(providerSource.connectionId, existing.id));
        const [row] = await tx.delete(connection).where(eq(connection.provider, provider.id)).returning({ id: connection.id });
        if (row) await audit("provider_removed", "provider_connection", row.id, null, { provider: provider.id });
      });
      return c.json({ removed: true });
    })
    .post("/data-providers/:provider/test", pruefe("param", providerParam), async c => {
      const provider = find(c.req.valid("param").provider);
      await callProvider(db, ring, provider, request => provider.test(request), http);
      return c.json({ available: true });
    })
    .get("/organizations/:id/provider-data", pruefe("param", companyParam), async c => {
      const id = c.req.valid("param").id;
      const result = await lese(db, async tx => {
        const company = await activeCompany(tx, id);
        const configured = await tx.select({ id: connection.provider }).from(connection).where(inArray(connection.provider, ids));
        const data = await tx.select(evidenceColumns).from(suggestion).where(and(eq(suggestion.organizationId, id), inArray(suggestion.provider, ids), eq(suggestion.current, true)))
          .orderBy(asc(suggestion.provider), asc(suggestion.field));
        const accepted = await tx.selectDistinctOn([suggestion.field], evidenceColumns).from(suggestion)
          .where(and(eq(suggestion.organizationId, id), inArray(suggestion.provider, ids), eq(suggestion.status, "accepted")))
          .orderBy(suggestion.field, desc(suggestion.reviewedAt), desc(suggestion.id));
        const provenance = accepted.filter(s => {
          const column = columnFor(s.field);
          return column && company[column] === s.value;
        });
        const links = await linkedRegisters(tx, id);
        return { provenance, providers: configured.map(k => ({ id: k.id, label: find(k.id).label, reference: links.find(l => l.provider === k.id)?.reference ?? null, searchable: !!find(k.id).search })), data };
      });
      return c.json(result);
    })
    .post("/organizations/:id/provider-data/search", pruefe("param", companyParam), pruefe("json", z.strictObject({ provider: z.string(), query: z.string().trim().min(1).max(200) })), async c => {
      await lese(db, tx => activeCompany(tx, c.req.valid("param").id));
      const body = c.req.valid("json");
      const provider = find(body.provider);
      const search = provider.search;
      if (!search) throw new Fachfehler(400, "invalid_input", "This provider uses the company website.");
      const data = await callProvider(db, ring, provider, request => search(request, body.query), http);
      return c.json({ data });
    })
    .post("/organizations/:id/provider-data/fetch", pruefe("param", companyParam), pruefe("json", z.strictObject({ provider: z.string(), reference: z.string().min(1).max(200).optional() })), async c => {
      const id = c.req.valid("param").id;
      const company = await lese(db, tx => activeCompany(tx, id));
      const body = c.req.valid("json");
      const provider = find(body.provider);
      const started = new Date();
      const linked = provider.search ? (await linkedRegisters(db, id)).find(l => l.provider === provider.id) : undefined;
      const { value, connectionId } = await callProvider(db, ring, provider, async (request, connectionId) =>
        ({ value: await provider.retrieve(request, company, body.reference ?? linked?.reference ?? ""), connectionId }), http);
      await schreibe(db, c, async (tx, audit) => {
        const current = await activeCompany(tx, id, true);
        if (!provider.search && current.website !== company.website) throw stale();
        await reconcile(tx, audit, id, provider, value, started, connectionId, linked?.digest);
      });
      return c.json({ retrieved: true });
    })
    .post("/investments/:id/metrics/provider-values", pruefe("param", companyParam),
      pruefe("json", z.strictObject({ suggestionId: z.uuid(), metricKey: z.string().regex(/^[a-z][a-z0-9_]{1,59}$/), periodStart: z.iso.date() })), async c => {
        const { suggestionId, metricKey, periodStart } = c.req.valid("json");
        const id = await schreibe(db, c, (tx, audit) => importMetric(tx, audit, c.req.valid("param").id, suggestionId, metricKey, periodStart, ids));
        return c.json({ id }, 201);
      })
    .post("/organizations/:id/provider-data/:suggestionId/review", pruefe("param", companyParam.extend({ suggestionId: z.uuid() })),
      pruefe("json", z.strictObject({ decision: z.enum(["accepted", "rejected"]) })), async c => {
        const { id, suggestionId } = c.req.valid("param");
        await schreibe(db, c, (tx, audit) => review(tx, audit, id, suggestionId, c.req.valid("json").decision, ids));
        return c.json({ reviewed: true });
      });
}
