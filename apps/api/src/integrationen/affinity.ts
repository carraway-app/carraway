import { z } from "zod";
import { textAusHtml } from "../http/oeffentlicher-abruf";
import { invalidRecord, mapFields, ProviderError, type CrmProvider, type Mapping, type ProviderRequest, type RecordData, type Resource } from "./provider";

const origin = "https://api.affinity.co";
const object = z.record(z.string(), z.unknown());
const id = z.number().int().positive().safe();
const page = z.object({ data: z.array(z.unknown()), pagination: z.object({ nextUrl: z.string().nullable().optional() }) });
const fields = z.array(z.object({ id: z.string(), value: z.object({ data: z.unknown() }) }));
const asObject = (value: unknown) => object.safeParse(value).data ?? {};
const string = (value: unknown) => typeof value === "string" ? value : undefined;
const fieldSources = (mapping: Mapping, resource: Resource) => mapping.fields.filter(f => f.resource === resource).map(f => f.source).filter(s => !["id", "name", "domain", "firstName", "lastName", "primaryEmailAddress", "organization_ids"].includes(s));

function fieldValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(fieldValue);
  if (value === null || typeof value !== "object") return value;
  const v = asObject(value);
  return v.text ?? v.id ?? v.calculatedValue ?? v.name ?? v.value ?? null;
}
function values(entity: Record<string, unknown>) {
  const result = { ...entity };
  for (const f of fields.parse(entity.fields ?? [])) result[f.id] = fieldValue(f.value.data);
  return result;
}
function nextToken(next: string | null | undefined, pathname: string) {
  if (!next) return null;
  const url = new URL(next, origin);
  const token = url.searchParams.get("cursor");
  if (url.origin !== origin || url.username || url.password || url.pathname !== pathname || !token) throw new ProviderError("invalid_page_url");
  return token;
}
const firstId = (preview: unknown) => {
  const data = asObject(preview).data;
  return Array.isArray(data) && data.length ? String(id.parse(asObject(data[0]).id)) : undefined;
};

async function opportunities(request: ProviderRequest, cursor: string | null, mapping: Mapping) {
  const attrs = [...new Set(fieldSources(mapping, "deal"))];
  const query = new URLSearchParams({ page_size: attrs.length ? "5" : "50" });
  if (cursor) query.set("page_token", cursor);
  const opportunity = z.object({ id, name: z.string(), organization_ids: z.array(id), list_entries: z.array(z.object({ id, list_id: id })).optional() });
  const result = z.object({ opportunities: z.array(z.unknown()),
    next_page_token: z.string().nullish() }).parse(await request("/opportunities?" + query));
  const records: RecordData[] = [];
  for (const raw of result.opportunities) {
    try {
      const item = opportunity.parse(raw);
      const entry = item.list_entries?.[0];
      let extra = {};
      if (entry && attrs.length) {
        const params = new URLSearchParams(attrs.map((key): [string, string] => ["fieldIds", key]));
        const detail = z.object({ entity: object }).parse(await request("/v2/lists/" + entry.list_id + "/list-entries/" + entry.id + "?" + params));
        extra = values(detail.entity);
      }
      records.push(mapFields({ resource: "deal", externalId: String(item.id), name: item.name, organizationId: item.organization_ids[0]?.toString() }, { ...item, ...extra }, mapping));
    } catch (error) {
      records.push(invalidRecord(error, "deal", id.safeParse(asObject(raw).id).data?.toString()));
    }
  }
  return { records, next: result.next_page_token ?? null };
}
export const affinity: CrmProvider = {
  id: "affinity", origin, additionalPaths: ["/opportunities"],
  headers: (url): Record<string, string> => url.pathname.startsWith("/v2/") ? { "x-affinity-api-version": "2026-09-17" } : {},
  async page(request, stream, cursor, mapping) {
    if (stream === "deal") return opportunities(request, cursor, mapping);
    const list = stream.slice(5);
    const pathname = stream === "organization" ? "/v2/companies" : stream === "person" ? "/v2/persons" : stream === "note" ? "/v2/notes" : "/v2/lists/" + encodeURIComponent(list) + "/list-entries";
    const params = new URLSearchParams({ limit: "50" });
    if (cursor) params.set("cursor", cursor);
    if (stream === "note") {
      for (const include of ["companiesPreview", "personsPreview", "opportunitiesPreview"]) params.append("includes", include);
    } else {
      const resource = stream === "organization" || stream === "person" ? stream : "deal";
      for (const key of new Set(fieldSources(mapping, resource))) params.append("fieldIds", key);
    }
    const result = page.parse(await request(pathname + "?" + params));
    const records: RecordData[] = [];
    for (const value of result.data) {
      const raw = asObject(value);
      try {
        const externalId = String(id.parse(raw.id));
        if (stream === "note") {
          const organizationId = firstId(raw.companiesPreview);
          const personId = firstId(raw.personsPreview);
          const dealId = mapping.deals ? firstId(raw.opportunitiesPreview) : undefined;
          if (!organizationId && !personId && !dealId) continue;
          const body = textAusHtml(z.string().parse(asObject(raw.content).html));
          records.push(mapFields({ resource: "note", externalId, organizationId, personId, dealId, body, date: string(raw.createdAt) }, raw, mapping));
        } else if (stream === "organization") {
          records.push(mapFields({ resource: stream, externalId, name: string(raw.name), domain: string(raw.domain) }, values(raw), mapping));
        } else if (stream === "person") {
          records.push(mapFields({ resource: stream, externalId, firstName: string(raw.firstName), lastName: string(raw.lastName), email: string(raw.primaryEmailAddress) }, values(raw), mapping));
        } else {
          const entity = object.parse(raw.entity);
          if (entity.isRedacted === true) throw new ProviderError("restricted_record");
          const parent = String(id.parse(entity.id));
          const link = raw.type === "company" ? { organizationId: parent } : raw.type === "person" ? { personId: parent } : raw.type === "opportunity" && mapping.deals ? { dealId: parent } : null;
          if (link) records.push(mapFields({ resource: "deal", externalId: "list/" + list + "/" + externalId, name: string(entity.name), ...link }, values(entity), mapping));
        }
      } catch (error) {
        const key = id.safeParse(raw.id).data?.toString();
        const resource = stream === "organization" || stream === "person" || stream === "note" ? stream : "deal";
        records.push(invalidRecord(error, resource, resource === "deal" && key ? "list/" + list + "/" + key : key));
      }
    }
    return { records, next: nextToken(result.pagination.nextUrl, pathname) };
  },
};
