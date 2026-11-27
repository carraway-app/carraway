import type { organisation } from "@carraway/db";
import type { Provider, ProviderRequest } from "../integrationen/provider";
import type { EintragWerte, EreignisWerte } from "../register/typen";
import type { Tx } from "../zeitlimit";

export type Company = typeof organisation.$inferSelect;
export interface Candidate { reference: string; name: string; location?: string }
export interface FundingMention {
  announcedOn: string; roundType: string;
  amount?: string; currency?: string; investors: string[];
}
export interface Retrieved {
  reference: string;
  sourceUrl: string;
  fields: Record<string, string | undefined>;
  entry?: EintragWerte;
  events?: EreignisWerte[];
  rounds?: FundingMention[];
}
export interface DataProvider extends Provider {
  label: string;
  /** Reserve the first provider attempt before contacting an independent source website. */
  reserveBeforeRun?: boolean;
  rate: { calls: number; seconds: number };
  test(request: ProviderRequest): Promise<unknown>;
  search?(request: ProviderRequest, query: string): Promise<Candidate[]>;
  retrieve(request: ProviderRequest, company: Company, reference: string): Promise<Retrieved>;
  saveRounds?(tx: Tx, companyId: string, result: Retrieved, retrievedAt: Date): Promise<void>;
}
export const columns = { name: "name", city: "ort", legalForm: "rechtsform", sector: "sektor" } as const;
export function columnFor(field: string) {
  return Object.hasOwn(columns, field) ? columns[field as keyof typeof columns] : undefined;
}
