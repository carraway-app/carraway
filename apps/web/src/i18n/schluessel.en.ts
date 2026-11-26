/** Englische Texte zu `schluessel.ts`; die deutsche Fassung ist die Quelle (Entscheidung 13). */

import type { schluesselDe } from "./schluessel";

export const schluesselEn: typeof schluesselDe = {
  titel: "Funding and accounting",
  einleitung:
    "These keys apply to vouchers, the booking export and the funding and statutory reports. The current state always applies; a report run keeps the values it used.",
  felder: {
    foerderprogramm: "Funding programme",
    projektnummer: "Project number",
    vertragsnummer: "Contract number",
    partnernummer: "Partner number",
    buchungskreis: "Company code",
    sitzland: "Country of the company (ISO code, e.g. DE)",
    region: "Region of the company",
  },
  stammdaten: {
    titel: "Master data of the company (view only)",
    land: "Country",
    region: "Region",
    keine: "not recorded",
    beiOrganisation: "Change country and region on the organisation",
  },
  keinProgramm: "No funding programme",
  sitzlandHilfe: "Two capital letters per ISO 3166-1. Applies to the company in all funds.",
  programmeHinweis: "Global administrators create new funding programmes in the administration.",
  speichern: "Save keys",
  gespeichert: "The keys are saved.",
  geaendertVon: (wann: string) => `Last changed on ${wann}`,
  lesen: "You have read access only; the keys cannot be changed.",
  laedt: "Loading keys",
};
