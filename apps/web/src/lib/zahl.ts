import type { Sprache } from "@carraway/ui";

const LOCALE: Record<Sprache, string> = { de: "de-DE", en: "en-GB" };

/** Preis in Euro mit zwei bis vier Nachkommastellen (Preis je Anteil), z. B. `12,35 €` bzw. `€12.35`. */
export function formatPreis(wert: number | string, sprache: Sprache): string {
  return new Intl.NumberFormat(LOCALE[sprache], { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(Number(wert));
}

/** Stückzahl oder Anteile mit Tausendertrennung und höchstens vier Nachkommastellen. */
export function formatAnzahl(wert: number | string, sprache: Sprache): string {
  return new Intl.NumberFormat(LOCALE[sprache], { maximumFractionDigits: 4 }).format(Number(wert));
}

/** Betrag in Millionen Euro ohne Einheit für Beschriftungen von Diagrammen (eine Nachkommastelle, bei kleinen Werten zwei). */
export function formatMio(wert: number | string, sprache: Sprache, nachkomma = 1): string {
  return new Intl.NumberFormat(LOCALE[sprache], { minimumFractionDigits: nachkomma, maximumFractionDigits: nachkomma }).format(Number(wert) / 1_000_000);
}

const dezimalText = /^\d+(\.\d+)?$/;
const ohneNullenAmEnde = (text: string) => text.replace(/0+$/, "");

/**
 * Prozent-Eingabe (`6,5`) als Anteil für die API (`0.065`). Reine Stellenverschiebung im Text, keine Gleitkommarechnung;
 * eine ungültige Eingabe bleibt unverändert, damit die API sie am Feld meldet.
 */
export function prozentZuAnteil(eingabe: string): string {
  const roh = eingabe.replace(/\s/g, "").replace(",", ".");
  if (roh === "" || !dezimalText.test(roh)) return roh;
  const [ganz = "0", rest = ""] = roh.split(".");
  const a = ganz.padStart(2, "0");
  const vorne = a.slice(0, -2).replace(/^0+/, "") || "0";
  const hinten = ohneNullenAmEnde(a.slice(-2) + rest);
  return hinten ? `${vorne}.${hinten}` : vorne;
}

/** Anteil der API (`0.065000`) als Prozentwert für Eingabefelder (`6.5`), wieder nur durch Stellenverschiebung. */
export function anteilZuProzent(anteil: string | null | undefined): string {
  if (!anteil || !dezimalText.test(anteil)) return "";
  const [ganz = "0", rest = ""] = anteil.split(".");
  const f = rest.padEnd(2, "0");
  const vorne = (ganz + f.slice(0, 2)).replace(/^0+/, "") || "0";
  const hinten = ohneNullenAmEnde(f.slice(2));
  return hinten ? `${vorne}.${hinten}` : vorne;
}

/** Anteil der API als Anzeige in Prozent, bis zu vier Nachkommastellen: `0.065` ergibt `6,5 %`. */
export function formatSatz(anteil: string | null | undefined, sprache: Sprache): string {
  const prozent = anteilZuProzent(anteil);
  if (prozent === "") return "–";
  const text = new Intl.NumberFormat(LOCALE[sprache], { maximumFractionDigits: 4 }).format(Number(prozent));
  return sprache === "de" ? `${text}\u00A0%` : `${text}%`;
}

/** Betrag mit Cent in Euro oder einer anderen Währung (Zinsen, Buchwerte, Ergebnisse); `formatBetrag` der UI rundet auf ganze Einheiten. */
export function formatBetragCent(wert: number | string, sprache: Sprache, waehrung = "EUR"): string {
  return new Intl.NumberFormat(LOCALE[sprache], { style: "currency", currency: waehrung, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(wert as number | `${number}`);
}
