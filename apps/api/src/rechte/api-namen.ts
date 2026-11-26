import { z } from "zod";
import { fondsRolle, type FondsRolle } from "@carraway/db";
import { BEREICHE, type Bereich, type RegelBereich } from "./bereiche";

/**
 * Englische Namen der Fondsrollen (Stufen) und Bereiche an der Schnittstelle (Entscheidung 520, Issue 184). In der Datenbank und in der
 * Berechtigungstabelle bleiben die deutschen Werte; Anfragen werden an der Grenze hineingewandelt, Antworten hinaus.
 */

export const STUFE_AN_API: Record<FondsRolle, string> = { betrachter: "viewer", bearbeiter: "editor", freigeber: "approver", verwalter: "admin" };
const STUFE_AUS_API = Object.fromEntries(Object.entries(STUFE_AN_API).map(([de, en]) => [en, de])) as Record<string, FondsRolle>;

export const BEREICH_AN_API: Record<RegelBereich, string> = {
  allgemein: "general",
  alle: "all",
  portfolio: "portfolio",
  finanzen: "finance",
  kennzahlen: "metrics",
  berichte: "reports",
  meldewesen: "regulatory_reporting",
  dealflow: "dealflow",
  kontakte: "contacts",
  dokumente: "documents",
  daten: "data",
  fondsverwaltung: "fund_administration",
};
const BEREICH_AUS_API = Object.fromEntries(Object.entries(BEREICH_AN_API).map(([de, en]) => [en, de])) as Record<string, Bereich>;

export const stufeAnApi = (s: FondsRolle): string => STUFE_AN_API[s];
export const stufeAnApiOderNull = (s: FondsRolle | null): string | null => (s === null ? null : STUFE_AN_API[s]);
export const bereichAnApi = (b: RegelBereich): string => BEREICH_AN_API[b];

/** Eingabe einer Stufe (`viewer`, `editor`, `approver`, `admin`) als Wert der Datenbank. */
export const stufeEingabe = z.enum(fondsRolle.enumValues.map((s) => STUFE_AN_API[s]) as [string, ...string[]]).transform((v) => STUFE_AUS_API[v]!);
/** Eingabe eines Bereichs (`finance`, `metrics` …) als Wert der Datenbank. */
export const bereichEingabe = z.enum(BEREICHE.map((b) => BEREICH_AN_API[b]) as [string, ...string[]]).transform((v) => BEREICH_AUS_API[v]!);

/** Englische Namen der Bereiche (ohne `general` und `all`) für `z.enum` und `z.partialRecord`. */
export const BEREICHE_API = BEREICHE.map((b) => BEREICH_AN_API[b]) as [string, ...string[]];
export const bereichAusApi = (b: string): Bereich => BEREICH_AUS_API[b]!;

/** Stufen je Bereich `{ bereich: stufe }` für die Antwort. */
export function stufenJeBereichAnApi(werte: Partial<Record<string, FondsRolle>>): Record<string, string> {
  return Object.fromEntries(Object.entries(werte).flatMap(([b, s]) => (s === undefined ? [] : [[BEREICH_AN_API[b as Bereich] ?? b, STUFE_AN_API[s]]])));
}
