import { z } from "zod";

export const resources = ["organization", "person", "deal", "note"] as const;
export const stageValues = ["inbound", "initial_meeting", "screening", "due_diligence", "investment_committee", "closing"] as const;
const sourceKey = z.string().min(1).max(160).regex(/^[\w-]+$/);
const targets: Record<typeof resources[number], readonly string[]> = {
  organization: ["name", "domain"], person: ["firstName", "lastName", "email", "organizationId"],
  deal: ["name", "organizationId", "stage"], note: ["name", "body"],
};
export const mappingSchema = z.strictObject({
  deals: z.boolean().default(true),
  notes: z.boolean().default(true),
  lists: z.array(sourceKey).max(30).default([]),
  fields: z.array(z.strictObject({
    resource: z.enum(resources),
    source: sourceKey,
    target: z.union([z.enum(["name", "firstName", "lastName", "email", "domain", "organizationId", "stage", "body"]), z.uuid()]),
  })).max(100).default([]),
  stages: z.record(z.string().min(1).max(200), z.enum(stageValues)).default({}),
}).refine(m => new Set(m.lists).size === m.lists.length, "Duplicate list ID")
  .refine(m => new Set(m.fields.map(f => f.resource + "/" + f.target)).size === m.fields.length, "Each target may have only one source")
  .refine(m => m.fields.every(f => targets[f.resource].includes(f.target) || (f.resource !== "note" && z.uuid().safeParse(f.target).success)), "Unsupported target for this record type");
export type Mapping = z.infer<typeof mappingSchema>;
export type Resource = typeof resources[number];
export interface RecordData {
  resource: Resource;
  externalId: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  domain?: string;
  organizationId?: string;
  personId?: string;
  dealId?: string;
  stage?: string;
  body?: string;
  date?: string;
  custom?: Record<string, unknown>;
  invalidReason?: string;
}
export interface ProviderRequest {
  (path: string, body?: object): Promise<unknown>;
}
export interface ProviderPage {
  records: RecordData[];
  next: string | null;
}
export interface Provider {
  id: string;
  origin: string;
  allowsPath?: (path: string) => boolean;
  credentials?: (key: string) => Record<string, string>;
  additionalPaths?: readonly string[];
  headers?: (url: URL) => Record<string, string>;
}
export interface CrmProvider extends Provider {
  page(request: ProviderRequest, stream: string, cursor: string | null, mapping: Mapping): Promise<ProviderPage>;
}
export class ProviderError extends Error {
  constructor(readonly code: string, readonly retrySeconds?: number) { super(code); }
}
/** Preserve even malformed identities in a sync inventory. Transport and page errors propagate. */
export function invalidRecord(error: unknown, resource: Resource, externalId: string | undefined): RecordData {
  if (!(error instanceof z.ZodError || error instanceof ProviderError && ["invalid_field_value", "restricted_record"].includes(error.code))) throw error;
  return { resource, externalId: externalId ?? "", invalidReason: !externalId ? "missing_external_id" :
    error instanceof ProviderError ? error.code : "invalid_record" };
}
export function streams(mapping: Mapping) {
  return ["organization", "person", ...(mapping.deals ? ["deal"] : []), ...mapping.lists.map(id => "list/" + id), ...(mapping.notes ? ["note"] : [])];
}
export function mapFields(record: RecordData, values: Record<string, unknown>, mapping: Mapping): RecordData {
  const custom: Record<string, unknown> = {};
  for (const field of mapping.fields.filter(f => f.resource === record.resource)) {
    const value = Object.hasOwn(values, field.source) ? values[field.source] : null;
    if (z.uuid().safeParse(field.target).success) custom[field.target] = value ?? null;
    else {
      const first = Array.isArray(value) ? value[0] : value;
      if (first != null && typeof first === "object") throw new ProviderError("invalid_field_value");
      Object.assign(record, { [field.target]: first == null ? undefined : String(first) });
    }
  }
  return { ...record, custom };
}
