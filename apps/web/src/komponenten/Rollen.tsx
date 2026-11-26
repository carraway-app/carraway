/** Kontaktrollen: Begriff bleibt erhalten (Gründung, Geschäftsführung, Co-Investor, Beratung, Investor, Sonstige). Angezeigt und gepflegt werden sie als Etiketten in der gemeinsamen Tabelle der Kontakte und Unternehmen (`crm/Verbindungen.tsx`). */

export const KONTAKT_ROLLEN = ["gruender", "geschaeftsfuehrung", "co_investor", "berater", "investor_lp", "sonstige"] as const;

export interface RollenZeile {
  id: string;
  rolle: string;
  von: string | null;
  bis: string | null;
  person?: { id: string; vorname: string; nachname: string };
  organisation?: { id: string; name: string };
}
