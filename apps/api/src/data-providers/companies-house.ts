import { itemList, readPage, validItems } from "./response";
import { z } from "zod";
import { Fachfehler } from "../fehler";
import type { DataProvider } from "./types";

const number = z.string().regex(/^[A-Z0-9]{8}$/);
const search = z.object({ items: itemList(z.object({ company_number: number, title: z.string(), address_snippet: z.string().optional() })) });
const profile = z.object({
  company_number: number, company_name: z.string(), type: z.string(), registered_office_address: z.object({ locality: z.string().optional() }),
  sic_codes: z.array(z.string()).optional(), company_status: z.string().optional(),
  links: z.object({ officers: z.string().optional(), filing_history: z.string().optional() }),
});
const officer = z.object({ name: z.string(), officer_role: z.string(), resigned_on: z.string().optional(),
  appointed_on: z.string().optional(), links: z.object({ officer: z.object({ appointments: z.string() }).optional() }).optional() });
const filing = z.object({ transaction_id: z.string(), date: z.iso.date(), description: z.string(), type: z.string() });
export const companiesHouse: DataProvider = {
  id: "companies-house", label: "Companies House", origin: "https://api.company-information.service.gov.uk",
  allowsPath: p => p === "/search/companies" || /^\/company\/[A-Z0-9]{8}(\/(officers|filing-history))?$/.test(p),
  credentials: key => ({ authorization: "Basic " + Buffer.from(key + ":").toString("base64") }),
  rate: { calls: 600, seconds: 300 },
  test: request => readPage(request, "/search/companies?q=limited&items_per_page=1", search),
  async search(request, query) {
    const page = await readPage(request, "/search/companies?items_per_page=20&q=" + encodeURIComponent(query), search);
    return page.items.map(i => ({ reference: i.company_number, name: i.title, location: i.address_snippet }));
  },
  async retrieve(request, _company, reference) {
    if (!number.safeParse(reference).success) throw new Fachfehler(400, "invalid_input", "Select a valid company number.");
    const path = "/company/" + reference;
    const p = await readPage(request, path, profile);
    if (p.company_number !== reference) throw new Fachfehler(502, "provider_response_invalid", "Unexpected company number.");
    const names = new Map<string, string>();
    if (p.links.officers) {
      let offset = 0;
      for (;;) {
        const officers = await readPage(request, path + "/officers?items_per_page=100&start_index=" + offset,
          z.object({ items: z.array(z.unknown()), total_results: z.number().int().nonnegative() }));
        for (const item of validItems(officers.items, officer)) {
          if (item.resigned_on) continue;
          const identity = [item.links?.officer?.appointments ?? item.name, item.officer_role, item.appointed_on];
          names.set(JSON.stringify(identity), item.name + " (" + item.officer_role + ")");
        }
        offset += officers.items.length;
        if (offset >= officers.total_results) break;
        if (!officers.items.length || offset >= 1000) throw new Fachfehler(502, "provider_response_invalid", "Officer list exceeds retrieval limit.");
      }
    }
    const filings = p.links.filing_history ? (await readPage(request, path + "/filing-history?items_per_page=25", z.object({ items: itemList(filing) }))).items : [];
    return {
      reference, sourceUrl: "https://find-and-update.company-information.service.gov.uk/company/" + reference,
      fields: { name: p.company_name, city: p.registered_office_address.locality, legalForm: p.type, sector: p.sic_codes?.join(", "),
        registerNumber: reference, companyStatus: p.company_status, representatives: [...names.values()].join("\n") },
      events: filings.map(f => ({ externeId: f.transaction_id, datum: f.date, art: "sonstiges", text: f.type + " · " + f.description })),
    };
  },
};
