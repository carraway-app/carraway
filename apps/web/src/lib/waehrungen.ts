import type { Sprache } from "@carraway/ui";

/**
 * Währungen, die die Anwendung zur Auswahl anbietet: die Referenzwährungen der EZB und häufige weitere (ISO 4217). Die Reihenfolge der Auswahl:
 * zuerst die Leitwährungen, danach alphabetisch nach Code. Ein Code, der schon gespeichert ist, aber hier fehlt, bleibt in der Auswahl sichtbar.
 */
export const LEITWAEHRUNGEN = ["EUR", "USD", "GBP", "CHF"] as const;

const WEITERE = [
  "AED", "ARS", "AUD", "BGN", "BRL", "CAD", "CLP", "CNY", "COP", "CZK", "DKK", "HKD", "HUF", "IDR", "ILS", "INR", "ISK", "JPY", "KRW", "MXN", "MYR", "NOK", "NZD", "PHP", "PLN", "RON", "SAR", "SEK", "SGD", "THB", "TRY", "TWD", "UAH", "ZAR",
] as const;

export const WAEHRUNGEN: readonly string[] = [...LEITWAEHRUNGEN, ...WEITERE];

/** Name der Währung in der Sprache der Anwendung (`US-Dollar`); ohne Namen der Laufzeit bleibt es beim Code. */
export function waehrungsname(code: string, sprache: Sprache): string {
  try {
    return new Intl.DisplayNames([sprache === "de" ? "de-DE" : "en-GB"], { type: "currency" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Auswahlpunkte (`USD – US-Dollar`); `zusaetzlich` nimmt gespeicherte Codes auf, die nicht in der Liste stehen. */
export function waehrungsOptionen(sprache: Sprache, zusaetzlich: readonly string[] = []): { code: string; label: string }[] {
  const bekannt = new Set(WAEHRUNGEN);
  const fremde = [...new Set(zusaetzlich)].filter((c) => /^[A-Z]{3}$/.test(c) && !bekannt.has(c)).sort();
  return [...LEITWAEHRUNGEN, ...[...WEITERE, ...fremde].sort()].map((code) => ({ code, label: `${code} – ${waehrungsname(code, sprache)}` }));
}
