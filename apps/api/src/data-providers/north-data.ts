import { itemList, readPage, validItems } from "./response";
import { z } from "zod";
import { Fachfehler } from "../fehler";
import { eintragWerte } from "../register/typen";
import type { DataProvider } from "./types";

const name = z.object({ name: z.string(), legalForm: z.string().optional() });
const register = z.object({ id: z.string(), city: z.string().optional(), uniqueKey: z.string() });
const base = z.object({ name, address: z.object({ city: z.string(), formattedValue: z.string().optional() }), register: register.optional() });
const results = z.object({ results: itemList(z.object({ company: base.optional() })) });
const role = z.object({ name: z.string(), type: z.string(), demotion: z.boolean().optional(), announce: z.boolean().optional() });
const relation = z.object({ person: z.object({ name: z.object({ firstName: z.string().optional(), lastName: z.string() }) }).optional(), roles: z.array(role) });
const company = base.extend({
  register, subject: z.string().optional(), northDataUrl: z.url().optional(), relatedPersons: z.object({ items: z.array(z.unknown()) }).optional(),
  financials: z.object({ date: z.iso.date(), consolidated: z.boolean(), items: itemList(z.object({
    id: z.string(), value: z.number(), unit: z.string().optional(), estimate: z.boolean().optional(),
  })) }).optional(),
});
const publications = z.object({ publications: itemList(z.object({ id: z.string(), date: z.iso.date(), title: z.string() })).default([]) });
const searchPath = "/_api/search/v1/universal?domain=company&countries=DE&limit=20&query=";
export const northData: DataProvider = {
  id: "north-data", label: "North Data", origin: "https://www.northdata.de",
  allowsPath: p => ["/_api/billing/v1/requests", "/_api/search/v1/universal", "/_api/company/v1/company", "/_api/company/v1/publications"].includes(p),
  credentials: key => ({ "x-api-key": key }), rate: { calls: 30, seconds: 60 },
  test: request => readPage(request, "/_api/billing/v1/requests", z.object({ numberOfRequests: z.number() })),
  async search(request, query) {
    return (await readPage(request, searchPath + encodeURIComponent(query), results)).results.flatMap(({ company: c }) =>
      c?.register ? [{ reference: c.register.uniqueKey, name: c.name.name, location: [c.address.city, c.register.city, c.register.id].filter(Boolean).join(" · ") }] : []);
  },
  async retrieve(request, _company, reference) {
    if (!/^\d{1,40}$/.test(reference)) throw new Fachfehler(400, "invalid_input", "Select a valid register key.");
    const params = "?registerKey=" + reference;
    const c = await readPage(request, "/_api/company/v1/company" + params + "&representatives=true&financials=true", company);
    if (c.register.uniqueKey !== reference) throw new Fachfehler(502, "provider_response_invalid", "Unexpected register key.");
    const pubs = await readPage(request, "/_api/company/v1/publications" + params + "&limit=25&content=false", publications);
    const reported = c.relatedPersons?.items ?? [];
    const relations = validItems(reported, relation);
    const officers = relations.flatMap(({ person, roles }) => person ? roles.filter(r => !r.demotion && !r.announce).map(r => ({
      name: [person.name.firstName, person.name.lastName].filter(Boolean).join(" "), funktion: r.name, signatory: r.type === "AuthorizedSignatory",
    })) : []);
    const fields: Record<string, string | undefined> = {
      name: c.name.name, city: c.address.city, legalForm: c.name.legalForm, registerCourt: c.register.city, registerNumber: c.register.id,
      representatives: officers.map(r => r.name + " (" + r.funktion + ")").join("\n"),
    };
    if (c.financials) for (const item of c.financials.items) {
      if (!item.estimate) fields["financial." + item.id + "." + c.financials.date + (c.financials.consolidated ? ".consolidated" : "")] = [item.value, item.unit].filter(v => v !== undefined).join(" ");
    }
    const parts = /^(HRB|HRA|GnR|PR|VR)\s*(.+)$/.exec(c.register.id);
    const entry = parts && c.register.city && relations.length === reported.length ? eintragWerte.safeParse({ gericht: c.register.city, registerart: parts[1], nummer: parts[2],
      firma: c.name.name, rechtsform: c.name.legalForm, sitz: c.address.city, anschrift: c.address.formattedValue, gegenstand: c.subject,
      vertretung: officers.filter(r => !r.signatory), prokura: officers.filter(r => r.signatory), standDatum: new Date().toISOString().slice(0, 10) }).data : undefined;
    return { reference, sourceUrl: c.northDataUrl ?? "https://www.northdata.de", fields, entry,
      events: pubs.publications.map(p => ({ externeId: p.id, datum: p.date, art: "sonstiges", text: p.title })) };
  },
};
