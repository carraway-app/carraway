import { Fachfehler } from "../fehler";
import { hatBereich, type Bereich } from "./bereiche";

type Person = Parameters<typeof hatBereich>[0];

/** Namen der Bereiche für Meldungen (wie in der Seitenleiste). */
const NAMEN: Record<Bereich, string> = {
  portfolio: "Portfolio",
  finanzen: "Finanzen",
  kennzahlen: "Kennzahlen",
  berichte: "Berichte",
  meldewesen: "Meldewesen",
  dealflow: "Dealflow",
  kontakte: "Kontakte",
  dokumente: "Dokumente",
  daten: "Datenübernahme",
  fondsverwaltung: "Fondsverwaltung",
};

/** Bereiche aus der Liste, die die Person nicht hat. */
export const fehlendeBereiche = (akteur: Person, bereiche: readonly Bereich[]): Bereich[] => bereiche.filter((b) => !hatBereich(akteur, b));

/**
 * Schreibwege, die Daten mehrerer Bereiche berühren (Zusammenführen, Bestätigen einer Auslesung, Übergang eines Deals, Datenübernahme), prüfen
 * zusätzlich zum Bereich der Route jeden Bereich, in den sie schreiben. Fehlt einer, antwortet die API mit 403 `KEINE_BERECHTIGUNG`, bevor etwas
 * geschrieben wird.
 */
export function verlangeBereiche(akteur: Person, bereiche: readonly Bereich[]): void {
  const fehlend = fehlendeBereiche(akteur, bereiche);
  if (fehlend.length === 0) return;
  throw new Fachfehler(403, "KEINE_BERECHTIGUNG", `Der Vorgang schreibt Daten der Bereiche ${fehlend.map((b) => NAMEN[b]).join(", ")}; sie gehören nicht zu den Rollen der Person.`, { bereiche: fehlend });
}
