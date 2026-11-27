import { z } from "zod";
import { invalidRecord, mapFields, type CrmProvider, type Mapping, type ProviderRequest, type RecordData } from "./provider";

const object = z.record(z.string(), z.unknown());
const response = z.object({ data: z.array(z.unknown()) });
const strings = (value: unknown) => typeof value === "string" ? value : undefined;
const asObject = (value: unknown) => object.safeParse(value).data ?? {};
const pageSize = 50;

function valueOf(item: Record<string, unknown>) {
  const status = asObject(item.status);
  const option = asObject(item.option);
  return item.value ?? item.domain ?? item.email_address ?? item.target_record_id ?? item.full_name ?? status.title ?? option.title ?? item.currency_value ?? item.phone_number ?? null;
}
function attributes(raw: unknown) {
  const pairs = Object.entries(asObject(raw)).map(([slug, entries]) => {
    const values = z.array(object).parse(entries).filter(e => !e.active_until).map(valueOf);
    return [slug, values.length > 1 ? values : values[0] ?? null];
  });
  return Object.fromEntries(pairs) as Record<string, unknown>;
}
function first(value: unknown) { return strings(Array.isArray(value) ? value[0] : value); }
function record(raw: Record<string, unknown>, stream: "organization" | "person" | "deal", mapping: Mapping) {
  const values = attributes(raw.values);
  const names = asObject(raw.values).name;
  const name = Array.isArray(names) ? asObject(names[0]) : {};
  const data: RecordData = { externalId: z.string().min(1).parse(asObject(raw.id).record_id), resource: stream, name: first(values.name) };
  if (stream === "organization") data.domain = first(values.domains);
  if (stream === "person") Object.assign(data, { firstName: strings(name.first_name), lastName: strings(name.last_name), email: first(values.email_addresses), organizationId: first(values.company) });
  if (stream === "deal") Object.assign(data, { stage: first(values.stage), organizationId: first(values.associated_company) });
  return mapFields(data, values, mapping);
}
async function parentType(request: ProviderRequest, id: string, cache: Map<string, string>) {
  if (!z.uuid().safeParse(id).success) return id;
  if (cache.has(id)) return cache.get(id);
  const result = z.object({ data: z.object({ api_slug: z.string() }) }).parse(await request("/v2/objects/" + encodeURIComponent(id)));
  cache.set(id, result.data.api_slug);
  return result.data.api_slug;
}
export const attio: CrmProvider = {
  id: "attio", origin: "https://api.attio.com",
  async page(request, stream, cursor, mapping) {
    const offset = Number(cursor ?? 0);
    const query = { limit: pageSize, offset, sorts: [
      { attribute: "created_at", direction: "asc" }, { attribute: stream.startsWith("list/") ? "entry_id" : "record_id", direction: "asc" },
    ] };
    const standard = { organization: "companies", person: "people", deal: "deals" } as const;
    if (stream === "organization" || stream === "person" || stream === "deal") {
      const { data } = response.parse(await request("/v2/objects/" + standard[stream] + "/records/query", query));
      return { records: data.map(raw => {
        const item = asObject(raw);
        try { return record(item, stream, mapping); }
        catch (error) { return invalidRecord(error, stream, strings(asObject(item.id).record_id)); }
      }), next: data.length === pageSize ? String(offset + data.length) : null };
    }
    const notes = stream === "note";
    const list = stream.slice(5);
    const { data } = response.parse(await (notes ? request("/v2/notes?limit=" + pageSize + "&offset=" + offset) : request("/v2/lists/" + encodeURIComponent(list) + "/entries/query", query)));
    const records: RecordData[] = [];
    const objects = new Map<string, string>();
    for (const raw of data) {
      const item = asObject(raw);
      const id = strings(asObject(item.id)[notes ? "note_id" : "entry_id"]);
      try {
        const parent = await parentType(request, z.string().parse(item.parent_object), objects);
        const parentId = z.string().parse(item.parent_record_id);
        const link = parent === "companies" ? { organizationId: parentId } : parent === "people" ? { personId: parentId } : parent === "deals" && mapping.deals ? { dealId: parentId } : null;
        if (!link) continue;
        if (notes) records.push(mapFields({ resource: "note", externalId: z.string().parse(asObject(item.id).note_id), name: strings(item.title), body: strings(item.content_plaintext), date: strings(item.created_at), ...link }, item, mapping));
        else {
          const values = attributes(item.entry_values);
          records.push(mapFields({ resource: "deal", externalId: "list/" + list + "/" + z.string().parse(asObject(item.id).entry_id), name: first(values.name), stage: first(values.stage ?? values.status), ...link }, values, mapping));
        }
      } catch (error) {
        records.push(invalidRecord(error, notes ? "note" : "deal", notes || !id ? id : "list/" + list + "/" + id));
      }
    }
    return { records, next: data.length === pageSize ? String(offset + data.length) : null };
  },
};
