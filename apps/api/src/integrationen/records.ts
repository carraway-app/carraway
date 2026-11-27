import { verlangeZustimmendenBeschluss } from "../crm/resolution";
import { createHash, randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { aktivitaet, deal, dealPhasenwechsel, organisation, person, providerConnection, providerSource } from "@carraway/db";
import { setzeHauptunternehmen } from "../crm/datensatz";
import { ladeFelder, wertSchema } from "../crm/felder";
import type { Protokollant } from "../schreiben";
import type { Tx } from "../zeitlimit";
import { ProviderError, type Mapping, type RecordData, type Resource } from "./provider";

const phase = { inbound: "anfrage", initial_meeting: "erstgespraech", screening: "pruefung", due_diligence: "due_diligence", investment_committee: "investitionsausschuss", closing: "closing" } as const;
const tables = { organization: "organisation", person: "person", deal: "deal", note: "aktivitaet" } as const;
export type Source = typeof providerSource.$inferSelect;
export function sourceKey(connectionId: string, resource: string, externalId: string) {
  return and(eq(providerSource.connectionId, connectionId), eq(providerSource.resource, resource), eq(providerSource.externalId, externalId));
}

export function sourcesFor(tx: Tx, resource: Resource, id: string) {
  return tx.select({ provider: providerConnection.provider, externalId: providerSource.externalId, mirrored: providerSource.mirrored, archived: providerSource.archived })
    .from(providerSource).innerJoin(providerConnection, eq(providerSource.connectionId, providerConnection.id))
    .where(and(eq(providerSource.localId, id), eq(providerSource.resource, resource)));
}

function domainOf(value?: string) {
  if (!value) return null;
  try {
    const url = new URL(value.includes("://") ? value : "https://" + value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error();
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch { throw new ProviderError("invalid_domain"); }
}
export async function match(tx: Tx, connectionId: string, row: RecordData) {
  const [source] = await tx.select().from(providerSource).where(sourceKey(connectionId, row.resource, row.externalId));
  if (source) return { id: source.localId, source };
  let hits: { id: string }[] = [];
  if (row.resource === "organization" && row.domain) {
    const domain = domainOf(row.domain);
    hits = await tx.select({ id: organisation.id }).from(organisation).where(and(isNull(organisation.archiviertAm), isNull(organisation.zusammengefuehrtIn),
      sql`split_part(regexp_replace(lower(${organisation.website}), '^(https?://)?(www[.])?', ''), '/', 1) = ${domain}`)).limit(2);
  }
  if (row.resource === "person" && row.email) {
    hits = await tx.select({ id: person.id }).from(person).where(and(isNull(person.archiviertAm), isNull(person.zusammengefuehrtIn), sql`lower(trim(${person.email})) = ${row.email.trim().toLowerCase()}`)).limit(2);
  }
  if (hits.length > 1) throw new ProviderError("ambiguous_duplicate");
  return { id: hits[0]?.id, source: undefined };
}
async function linkedId(tx: Tx, connectionId: string, resource: Resource, externalId?: string) {
  if (!externalId) return null;
  const [link] = await tx.select().from(providerSource).where(sourceKey(connectionId, resource, externalId));
  if (!link || link.archived) throw new ProviderError("missing_related_record");
  return link.localId;
}

/** Only a changed source stage may move an open deal. Legacy links establish a baseline on their next read. */
export async function dealPhase(tx: Tx, row: RecordData, mapping: Mapping, source?: Source, lock = false) {
  const query = source && tx.select({ phase: deal.phase, status: deal.status }).from(deal).where(eq(deal.id, source.localId));
  const [previous] = query ? await (lock ? query.for("update") : query) : [];
  const target = row.stage && Object.hasOwn(mapping.stages, row.stage) ? phase[mapping.stages[row.stage]!] : undefined;
  const changed = !source || (source.sourceStage !== null && source.sourceStage !== row.stage);
  const next = target && changed && (!previous || previous.status === "offen") ? target : previous?.phase ?? "anfrage";
  if (next === "closing" && previous?.phase !== "closing") {
    if (!source) throw new ProviderError("resolution_missing");
    await verlangeZustimmendenBeschluss(tx, source.localId);
  }
  return { previous: previous?.phase, next };
}

export async function customValues(tx: Tx, row: RecordData) {
  const values: Record<string, unknown> = {};
  if (!row.custom || !Object.keys(row.custom).length) return values;
  if (row.resource === "note") throw new ProviderError("invalid_custom_field");
  const defs = await ladeFelder(tx, row.resource === "organization" ? "organisation" : row.resource);
  for (const [id, value] of Object.entries(row.custom)) {
    const def = defs.find(d => d.id === id);
    if (!def || ["benutzer", "verknuepfung"].includes(def.typ)) throw new ProviderError("invalid_custom_field");
    if (value == null) { values[id] = null; continue; }
    const input = typeof value === "number" ? String(value) : value;
    const result = wertSchema(def).safeParse(input);
    if (!result.success) throw new ProviderError("invalid_custom_value");
    values[id] = result.data;
  }
  return values;
}

export type ApplyRecord = (tx: Tx, audit: Protokollant, connectionId: string, row: RecordData, mapping: Mapping) => Promise<void>;
export function digestOf(row: RecordData, mapping: Mapping) {
  return createHash("sha256").update(JSON.stringify([row, mapping.stages])).digest("hex");
}
export const importRecord: ApplyRecord = async (tx, audit, connectionId, row, mapping) => {
  const found = await match(tx, connectionId, row);
  if (found.source) return;
  await saveRecord(tx, audit, connectionId, row, mapping, found.id, false);
};
export async function saveRecord(tx: Tx, audit: Protokollant, connectionId: string, row: RecordData, mapping: Mapping, existingId: string | undefined, overwrite: boolean, source?: Source) {
  const id = existingId ?? randomUUID();
  if (overwrite && existingId && !source?.mirrored) {
    const [owner] = await tx.select({ id: providerSource.localId }).from(providerSource)
      .where(and(eq(providerSource.resource, row.resource), eq(providerSource.localId, id), eq(providerSource.mirrored, true)));
    if (owner) throw new ProviderError("provider_owner_conflict");
    const table = row.resource === "organization" ? organisation : row.resource === "person" ? person : null;
    if (table) {
      const [local] = await tx.select({ archived: table.archiviertAm }).from(table).where(eq(table.id, id)).for("update");
      if (local?.archived) throw new ProviderError("locally_archived");
    }
  }
  const digest = digestOf(row, mapping);
  const custom = await customValues(tx, row);
  const fields = sql`jsonb_strip_nulls(felder || ${JSON.stringify(custom)}::jsonb)`;
  if (!existingId || overwrite) {
    if (row.resource === "organization") {
      if (!row.name) throw new ProviderError("missing_name");
      const domain = domainOf(row.domain);
      const data = { name: row.name, website: domain ? "https://" + domain : null };
      if (existingId) await tx.update(organisation).set({ ...data, felder: fields, archiviertAm: null }).where(eq(organisation.id, id));
      else await tx.insert(organisation).values({ id, art: "unternehmen", ...data, felder: custom });
    } else if (row.resource === "person") {
      if (!row.firstName && !row.lastName && !row.name) throw new ProviderError("missing_name");
      const organizationId = await linkedId(tx, connectionId, "organization", row.organizationId);
      const data = { vorname: row.firstName ?? "", nachname: row.lastName ?? row.name ?? "", email: row.email ?? null, organisationId: organizationId };
      if (existingId) await tx.update(person).set({ ...data, felder: fields, archiviertAm: null }).where(eq(person.id, id));
      else await tx.insert(person).values({ id, ...data, felder: custom });
      await setzeHauptunternehmen(tx, id, organizationId);
    } else if (row.resource === "deal") {
      let organizationId = await linkedId(tx, connectionId, "organization", row.organizationId);
      let title = row.name;
      if (row.externalId.startsWith("list/")) {
        const parentDeal = await linkedId(tx, connectionId, "deal", row.dealId);
        const parentPerson = await linkedId(tx, connectionId, "person", row.personId);
        if (parentDeal) {
          const [parent] = await tx.select().from(deal).where(eq(deal.id, parentDeal));
          organizationId ??= parent?.organisationId ?? null;
          title ??= parent?.titel;
        } else if (parentPerson) {
          const [parent] = await tx.select().from(person).where(eq(person.id, parentPerson));
          organizationId ??= parent?.organisationId ?? null;
          title ??= parent && [parent.vorname, parent.nachname].filter(Boolean).join(" ");
        } else if (organizationId && !title) {
          const [parent] = await tx.select().from(organisation).where(eq(organisation.id, organizationId));
          title = parent?.name;
        }
      }
      if (!organizationId || !title) throw new ProviderError("deal_requires_company_and_title");
      const stage = await dealPhase(tx, row, mapping, source, true);
      const changed = stage.previous !== stage.next;
      const data = { titel: title, organisationId: organizationId };
      if (existingId) await tx.update(deal).set({ ...data, phase: changed ? stage.next : undefined, felder: fields, aktualisiertAm: new Date() }).where(eq(deal.id, id));
      else await tx.insert(deal).values({ id, ...data, phase: stage.next, felder: custom });
      if (changed) await tx.insert(dealPhasenwechsel).values({ dealId: id, vonPhase: stage.previous, nachPhase: stage.next, am: new Date().toISOString().slice(0, 10) });
    } else {
      const data = { titel: row.name || "Note", notiz: row.body ?? "", datum: row.date?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
        organisationId: await linkedId(tx, connectionId, "organization", row.organizationId), personId: await linkedId(tx, connectionId, "person", row.personId), dealId: await linkedId(tx, connectionId, "deal", row.dealId) };
      if (!data.organisationId && !data.personId && !data.dealId) throw new ProviderError("note_requires_parent");
      if (existingId) await tx.update(aktivitaet).set(data).where(eq(aktivitaet.id, id));
      else await tx.insert(aktivitaet).values({ id, art: "notiz", ...data });
    }
  }
  const sourceStage = row.resource === "deal" ? row.stage ?? "" : null;
  await tx.insert(providerSource).values({ connectionId, resource: row.resource, externalId: row.externalId, localId: id, digest, sourceStage, mirrored: overwrite })
    .onConflictDoUpdate({ target: [providerSource.connectionId, providerSource.resource, providerSource.externalId], set: { digest, sourceStage, mirrored: overwrite, archived: false } });
  await audit("provider_import", tables[row.resource], id, null, { connectionId, externalId: row.externalId, matched: !!existingId, mirrored: overwrite });
}
