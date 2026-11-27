import { randomUUID } from "node:crypto";
import { transient } from "./retry";
import { Fachfehler } from "../fehler";
import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { providerConnection, providerItem, providerRun, providerSource, type Db } from "@carraway/db";
import type { Schluesselring } from "../geheimnis/krypto";
import type { Tx } from "../zeitlimit";
import { schreibe, type Protokollant } from "../schreiben";
import type { AbrufOptionen } from "../http/oeffentlicher-abruf";
import { requestFor } from "./http";
import { match, dealPhase, customValues, importRecord, type ApplyRecord } from "./records";
import { mappingSchema, ProviderError, streams, type CrmProvider, type Mapping, type RecordData } from "./provider";
import { providers } from "./providers";

import { credentialAad } from "./connection";
export const active = ["reading", "preview", "applying"];
export type Run = typeof providerRun.$inferSelect;
export type Finish = (tx: Tx, audit: Protokollant, run: Run) => Promise<boolean>;
export async function clearItems(tx: Tx, runId: string) {
  await tx.delete(providerItem).where(eq(providerItem.runId, runId));
}
function rowFailure(error: unknown): string {
  if (error instanceof ProviderError || error instanceof Fachfehler && error.code === "resolution_missing") return error.code;
  // SQL data exceptions (for example an invalid date) are confined to the record savepoint.
  const cause = error instanceof Error ? error.cause : undefined;
  if (cause && typeof cause === "object" && "code" in cause && /^22[0-9A-Z]{3}$/.test(String(cause.code))) return "invalid_record";
  throw error;
}
async function inspectRecord(tx: Tx, run: Run, row: RecordData, mapping: Mapping) {
  if (!row.externalId) throw new ProviderError("missing_external_id");
  if (row.invalidReason) throw new ProviderError(row.invalidReason);
  if (row.resource === "organization" && !row.name || row.resource === "person" && !(row.firstName || row.lastName || row.name)) throw new ProviderError("missing_name");
  if (row.resource === "deal" && !row.externalId.startsWith("list/") && (!row.organizationId || !row.name)) throw new ProviderError("deal_requires_company_and_title");
  await customValues(tx, row);
  const found = await match(tx, run.connectionId, row);
  if (found.source && run.kind === "import") return true;
  if (row.resource === "deal") await dealPhase(tx, row, mapping, found.source);
  for (const [resource, id] of [["organization", row.organizationId], ["person", row.personId], ["deal", row.dealId]] as const) {
    if (!id) continue;
    const [parent] = await tx.select({ reason: providerItem.skipReason }).from(providerItem)
      .where(and(eq(providerItem.runId, run.id), eq(providerItem.resource, resource), eq(providerItem.externalId, id)));
    if (parent && !parent.reason) continue;
    const [link] = await tx.select({ archived: providerSource.archived }).from(providerSource)
      .where(and(eq(providerSource.connectionId, run.connectionId), eq(providerSource.resource, resource), eq(providerSource.externalId, id)));
    if (!link || link.archived) throw new ProviderError("missing_related_record");
  }
  return !!found.id;
}
async function stageRecord(tx: Tx, run: Run, row: RecordData, sequence: number, mapping: Mapping) {
  // An unusable ID cannot identify a missing source during the final inventory check.
  const usableId = row.externalId && Buffer.from(row.externalId).toString("utf8") === row.externalId && !row.externalId.includes("\0") && Buffer.byteLength(row.externalId) <= 1024;
  const identity = { runId: run.id, sequence, resource: row.resource, externalId: usableId ? row.externalId : randomUUID() };
  try {
    return await tx.transaction(async recordTx => {
      if (!usableId) throw new ProviderError("missing_external_id");
      const [saved] = await recordTx.insert(providerItem).values({ ...identity, data: row }).onConflictDoNothing().returning({ id: providerItem.id });
      if (saved) return { matched: await inspectRecord(recordTx, run, row, mapping) };
    });
  } catch (error) {
    const reason = rowFailure(error);
    const [saved] = await tx.insert(providerItem).values({ ...identity, data: {}, skipReason: reason }).onConflictDoNothing().returning({ id: providerItem.id });
    if (saved) return { matched: false, reason };
  }
}
export interface WorkerOptions extends AbrufOptionen {
  registry?: readonly CrmProvider[];
  sync?: { apply: ApplyRecord; finish: Finish };
}
/** Claim one page. The lease expires on worker loss. Recheck the claim inside the write transaction after HTTP. */
export async function processPage(db: Db, ring: Schluesselring | undefined, options: WorkerOptions = {}) {
  const kind = options.sync ? "sync" : "import";
  const run = await db.transaction(async tx => {
    const [next] = await tx.select().from(providerRun).where(and(eq(providerRun.kind, kind), inArray(providerRun.status, ["reading", "applying"]), lte(providerRun.availableAt, sql`now()`)))
      .orderBy(asc(providerRun.availableAt)).limit(1).for("update", { skipLocked: true });
    if (!next) return;
    const [claimed] = await tx.update(providerRun).set({ availableAt: new Date(Date.now() + 180_000) }).where(eq(providerRun.id, next.id)).returning();
    return claimed;
  });
  if (!run) return;
  const claim = and(eq(providerRun.id, run.id), eq(providerRun.status, run.status), eq(providerRun.availableAt, run.availableAt));
  let fetching = false;
  try {
    const mapping = mappingSchema.parse(run.mapping);
    const cursor = (run.cursor ?? { stream: 0, token: null }) as { stream: number; token: string | null };
    const sources = streams(mapping);
    let records: RecordData[] = [];
    let next: typeof cursor | null = null;
    if (run.status === "reading") {
      const [conn] = await db.select().from(providerConnection).where(eq(providerConnection.id, run.connectionId));
      const provider = (options.registry ?? providers).find(p => p.id === conn?.provider);
      if (!conn || !provider || !ring) throw new ProviderError("connection_unavailable");
      const request = requestFor(provider, ring.entschluessele(conn.credential, credentialAad(conn.id)), options);
      fetching = true;
      const page = await provider.page(request, sources[cursor.stream]!, cursor.token, mapping);
      fetching = false;
      if (page.next !== null && (page.next === cursor.token || run.pages >= 100_000)) throw new ProviderError("invalid_pagination");
      records = page.records;
      next = page.next !== null ? { ...cursor, token: page.next } : cursor.stream + 1 < sources.length ? { stream: cursor.stream + 1, token: null } : null;
    }
    await schreibe(db, run.actor, async (tx, audit) => {
      const [current] = await tx.select().from(providerRun).where(claim).for("update");
      if (!current) return;
      const progress: Partial<typeof providerRun.$inferInsert> = { availableAt: new Date(), retries: 0, error: null };
      const reasons = { ...run.skipReasons };
      progress.skipReasons = reasons;
      const skip = (reason: string) => { reasons[reason] = (reasons[reason] ?? 0) + 1; };
      if (run.status === "reading") {
        let matched = run.matched;
        let received = run.received;
        for (const row of records) {
          const staged = await stageRecord(tx, run, row, received, mapping);
          if (!staged) continue;
          received++;
          if (staged.matched) matched++;
          if ("reason" in staged && staged.reason) skip(staged.reason);
        }
        Object.assign(progress, { cursor: next, pages: run.pages + 1, received, matched,
          status: next ? "reading" : options.sync ? "applying" : "preview" });
      } else {
        // Serialize duplicate matching across providers, including the first insertion of a domain or email.
        await tx.execute(sql`select pg_advisory_xact_lock(168170169)`);
        const offset = typeof run.cursor === "number" ? run.cursor : run.applied;
        const items = await tx.select().from(providerItem).where(and(eq(providerItem.runId, run.id), gte(providerItem.sequence, offset))).orderBy(asc(providerItem.sequence)).limit(40);
        let applied = run.applied;
        for (const item of items) {
          if (item.skipReason) continue;
          try {
            await tx.transaction(recordTx => (options.sync?.apply ?? importRecord)(recordTx, audit, run.connectionId, item.data as RecordData, mapping));
            applied++;
          } catch (error) { skip(rowFailure(error)); }
        }
        progress.applied = applied;
        progress.cursor = offset + items.length;
        // Without an identity a malformed row could be any missing source. Defer archival to a complete scan.
        if (progress.cursor === run.received && (!options.sync || reasons.missing_external_id || await options.sync.finish(tx, audit, run))) {
          progress.status = "completed";
          await audit("provider_completed", "provider_run", run.id, null, { received: run.received, matched: run.matched, applied, skipReasons: reasons });
          await clearItems(tx, run.id);
        }
      }
      await tx.update(providerRun).set(progress).where(eq(providerRun.id, run.id));
    });
  } catch (error) {
    // Provider payloads, SQL bound values and credentials must never enter logs or status responses.
    const code = error instanceof ProviderError || error instanceof Fachfehler ? error.code : "provider_processing_failed";
    const advised = error instanceof ProviderError ? error.retrySeconds : undefined;
    const delay = advised !== undefined || fetching && transient(error) ? Math.max(advised ?? 0, 2 ** run.retries) : undefined;
    await db.transaction(async tx => {
      const retry = delay !== undefined && run.retries < 8;
      const changed = await tx.update(providerRun).set({ status: retry ? run.status : "failed", error: code, retries: run.retries + 1,
        availableAt: new Date(Date.now() + Math.min(delay ?? 0, 31_536_000) * 1000) }).where(claim).returning({ id: providerRun.id });
      if (!retry && changed.length) await clearItems(tx, run.id);
    });
  }
}
