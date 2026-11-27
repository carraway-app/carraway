import { expect, it } from "vitest";
import { affinity } from "../integrationen/affinity";
import { requestFor } from "../integrationen/http";
import { mappingSchema } from "../integrationen/provider";

it("reads v2 field IDs, same-endpoint cursor pages, list entries and note previews, and v1 opportunity relationships", async () => {
  const custom = "930c2ee1-ed34-4bc9-aa0d-4aae46281a1f";
  const mapping = mappingSchema.parse({ lists: ["12"], fields: [{ resource: "organization", source: "field-53", target: custom }, { resource: "deal", source: "field-47", target: "stage" }] });
  const paths: string[] = [];
  const field = { id: "field-47", value: { type: "dropdown", data: { text: "Review" } } };
  const request = requestFor(affinity, "test-credential", {
    aufloeser: async () => ["93.184.216.34"],
    transport: async ({ url, headers }) => {
      expect(url.origin).toBe("https://api.affinity.co");
      expect(headers?.authorization).toBe("Bearer test-credential");
      expect(headers?.["x-affinity-api-version"]).toBe(url.pathname.startsWith("/v2/") ? "2026-09-17" : undefined);
      paths.push(url.pathname + url.search);
      const data: Record<string, object> = {
        "/v2/companies": { data: [{ id: 14, name: "Example", domain: "example.test", fields: [{ id: "field-53", value: { type: "text", data: "Custom value" } }] }], pagination: { nextUrl: "https://api.affinity.co/v2/companies?cursor=page2" } },
        "/v2/persons": { data: [{ id: 15, firstName: "Alex", lastName: "Example", primaryEmailAddress: "alex@example.test" }], pagination: {} },
        "/opportunities": { opportunities: [{ id: 17, name: "Example deal", organization_ids: [14], list_entries: [{ id: 4, list_id: 12 }] }], next_page_token: "more" },
        "/v2/lists/12/list-entries/4": { entity: { fields: [field] } },
        "/v2/lists/12/list-entries": { data: [{ id: 4, type: "company", entity: { id: 14, name: "Example", fields: [field] } }], pagination: {} },
        "/v2/notes": { data: [{ id: 13, content: { html: "<p>Call</p>" }, companiesPreview: { data: [{ id: 14 }] } }], pagination: {} },
      };
      return { status: 200, kopf: {}, rumpf: (async function* () { yield Buffer.from(JSON.stringify(data[url.pathname])); })(), abbrechen() {} };
    },
  });
  expect(await affinity.page(request, "organization", null, mapping)).toMatchObject({ next: "page2", records: [{ custom: { [custom]: "Custom value" } }] });
  await affinity.page(request, "organization", "page2", mapping);
  expect(paths[1]).toContain("cursor=page2&fieldIds=field-53");
  expect((await affinity.page(request, "person", null, mapping)).records[0]).toMatchObject({ email: "alex@example.test" });
  expect(await affinity.page(request, "deal", "next", mapping)).toMatchObject({ next: "more", records: [{ externalId: "17", organizationId: "14", stage: "Review" }] });
  expect((await affinity.page(request, "list/12", null, mapping)).records[0]).toMatchObject({ externalId: "list/12/4", organizationId: "14", stage: "Review" });
  expect((await affinity.page(request, "note", null, mapping)).records[0]).toMatchObject({ body: "Call", organizationId: "14" });
  expect(paths.join(" ")).toContain("includes=companiesPreview");
  await expect(affinity.page(async () => ({ data: [], pagination: { nextUrl: "https://external.test/v2/companies?cursor=bad" } }), "organization", null, mapping)).rejects.toMatchObject({ code: "invalid_page_url" });
});

it("retains invalid source identities and the valid siblings on the same page", async () => {
  const mapping = mappingSchema.parse({});
  const page = await affinity.page(async () => ({ data: [{ id: 1, fields: "invalid" }, { id: 2, name: "Valid" }, null], pagination: {} }), "organization", null, mapping);
  expect(page.records).toMatchObject([{ externalId: "1", invalidReason: "invalid_record" }, { externalId: "2", name: "Valid" }, { invalidReason: "missing_external_id" }]);
});
