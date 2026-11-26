import { Fachfehler } from "../fehler";
import { hatBereich, type Bereich } from "./bereiche";

type Person = Parameters<typeof hatBereich>[0];

/** Namen der Bereiche für Meldungen (wie in der Seitenleiste). */
const NAMEN: Record<Bereich, string> = {
  portfolio: "Portfolio",
  finanzen: "Finance",
  kennzahlen: "Metrics",
  berichte: "Reports",
  meldewesen: "Regulatory reporting",
  dealflow: "Deal flow",
  kontakte: "Contacts",
  dokumente: "Documents",
  daten: "Data import",
  fondsverwaltung: "Fund administration",
};

/** Bereiche aus der Liste, die die Person nicht hat. */
export const fehlendeBereiche = (akteur: Person, bereiche: readonly Bereich[]): Bereich[] => bereiche.filter((b) => !hatBereich(akteur, b));

/**
 * Schreibwege, die Daten mehrerer Bereiche berühren (Zusammenführen, Bestätigen einer Auslesung, Übergang eines Deals, Datenübernahme), prüfen
 * zusätzlich zum Bereich der Route jeden Bereich, in den sie schreiben. Fehlt einer, antwortet die API mit 403 `forbidden`, bevor etwas
 * geschrieben wird.
 */
export function verlangeBereiche(akteur: Person, bereiche: readonly Bereich[]): void {
  const fehlend = fehlendeBereiche(akteur, bereiche);
  if (fehlend.length === 0) return;
  throw new Fachfehler(403, "forbidden", `The operation writes data of the areas ${fehlend.map((b) => NAMEN[b]).join(", ")}; they are not part of the person's roles.`, { bereiche: fehlend });
}
