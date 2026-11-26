export const JOURNAL_TYPEN_AN_API = {
  abruf: "capital_call",
  ausschuettung: "distribution",
  auszahlung: "disbursement",
  bewertung: "valuation",
  dividende: "dividend",
  insolvenz: "insolvency",
  rueckfluss: "return_flow",
  tilgung: "repayment",
  verkauf: "sale",
  wandlung: "conversion",
  wertberichtigung: "impairment",
  zins: "interest",
  zinszahlung: "interest_payment",
  zusage: "commitment",
} as const;

export function journalTypenAnApi(typen: string) {
  return typen.split(",").map((typ) => {
    const name = typ.trim() as keyof typeof JOURNAL_TYPEN_AN_API;
    return Object.hasOwn(JOURNAL_TYPEN_AN_API, name) ? JOURNAL_TYPEN_AN_API[name] : name;
  }).join(",");
}
