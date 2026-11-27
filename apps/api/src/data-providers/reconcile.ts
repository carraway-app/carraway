import { and, eq, inArray } from "drizzle-orm";
import { organisation, providerConnection, providerSuggestion as suggestion } from "@carraway/db";
import { Fachfehler } from "../fehler";
import { legeEintragAn, legeEreignisAn, meldeEintrag, meldeEreignis } from "../register/dienst";
import type { Protokollant } from "../schreiben";
import type { Tx } from "../zeitlimit";
import { recordLink } from "./links";
import { columnFor, type DataProvider, type Retrieved } from "./types";

export const stale = () => new Fachfehler(409, "provider_review_stale", "The record changed. Retrieve it again.");
export async function activeCompany(tx: Tx, id: string, lock = false) {
  const query = tx.select().from(organisation).where(eq(organisation.id, id));
  const [company] = await (lock ? query.for("update") : query);
  if (!company || company.art !== "unternehmen" || company.zusammengefuehrtIn || company.archiviertAm) throw new Fachfehler(404, "organization_not_found", "Active company not found.");
  return company;
}
const sizes: Record<string, number> = { name: 300, city: 200, legalForm: 100, sector: 200 };
export async function reconcile(tx: Tx, audit: Protokollant, id: string, adapter: DataProvider, result: Retrieved, retrievedAt: Date, connectionId: string, previousDigest?: string) {
  const company = await activeCompany(tx, id, true);
  const [connection] = await tx.select({ id: providerConnection.id }).from(providerConnection).where(eq(providerConnection.id, connectionId)).for("share");
  if (!connection) throw new Fachfehler(409, "provider_key_missing", "The connection was removed.");
  if (adapter.search) await recordLink(tx, connectionId, id, result, previousDigest);
  const source = new URL(result.sourceUrl);
  if (!["http:", "https:"].includes(source.protocol) || source.username || source.password) throw new Fachfehler(502, "provider_response_invalid", "Invalid source URL.");
  const rows = await tx.select().from(suggestion).where(and(eq(suggestion.organizationId, id), eq(suggestion.provider, adapter.id), eq(suggestion.current, true)));
  if (rows.some(r => r.retrievedAt > retrievedAt)) throw stale();
  const values = Object.entries(result.fields).filter((v): v is [string, string] => Boolean(v[1]?.trim()));
  const previous = new Map(rows.map(r => [r.field, r]));
  for (const old of rows) if (!values.some(([field]) => field === old.field)) await tx.update(suggestion).set({ current: false }).where(eq(suggestion.id, old.id));
  for (const [field, value] of values) {
    if (value.length > (sizes[field] ?? 32000)) continue;
    const old = previous.get(field);
    const column = columnFor(field);
    const previousValue = column ? company[column] : null;
    if (old && old.value === value && old.reference === result.reference && old.sourceUrl === result.sourceUrl &&
        (old.status === "rejected" || (old.status === "accepted" ? !column || old.value === previousValue : old.previousValue === previousValue))) {
      if (old.status === "pending") await tx.update(suggestion).set({ retrievedAt }).where(eq(suggestion.id, old.id));
      continue;
    }
    if (old) await tx.update(suggestion).set({ current: false }).where(eq(suggestion.id, old.id));
    await tx.insert(suggestion).values({ organizationId: id, provider: adapter.id, reference: result.reference,
      sourceUrl: result.sourceUrl, field, value, previousValue, retrievedAt });
  }
  const origin = "anbieter:" + adapter.id;
  const snapshot = result.entry && await legeEintragAn(tx, audit, id, result.entry, origin);
  if (snapshot?.neu) await meldeEintrag(tx, id, snapshot.eintrag.firma, snapshot.eintrag.standDatum);
  let events = 0;
  for (const event of result.events ?? []) {
    const saved = await legeEreignisAn(tx, audit, id, event, origin, snapshot?.eintrag.id);
    if (saved.neu) {
      events++;
      await meldeEreignis(tx, id, saved.ereignis, company.name);
    }
  }
  await adapter.saveRounds?.(tx, id, result, retrievedAt);
  return { entries: snapshot?.neu ? 1 : 0, events };
}
export async function review(tx: Tx, audit: Protokollant, id: string, suggestionId: string, decision: "accepted" | "rejected", providers: readonly string[]) {
  const company = await activeCompany(tx, id, true);
  const [row] = await tx.select().from(suggestion).where(and(eq(suggestion.organizationId, id), eq(suggestion.id, suggestionId), inArray(suggestion.provider, [...providers]))).for("update");
  if (!row || !row.current || row.status !== "pending") throw stale();
  const column = columnFor(row.field);
  if (decision === "accepted" && column) {
    if (company[column] !== row.previousValue) throw stale();
    const [updated] = await tx.update(organisation).set({ [column]: row.value }).where(eq(organisation.id, id)).returning();
    await audit("aendern", "organisation", id, company, updated);
  }
  await tx.update(suggestion).set({ status: decision, reviewedAt: new Date(), reviewedBy: audit.akteur }).where(eq(suggestion.id, row.id));
  await audit("provider_reviewed", "provider_suggestion", row.id, null, { decision, provider: row.provider, field: row.field });
}
