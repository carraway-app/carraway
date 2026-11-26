import { inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { Context } from "hono";
import { deal } from "@carraway/db";
import { aktuellerAkteur, sichtbareFonds } from "../anmeldung/akteur";
import { hatBereich, type Bereich } from "./bereiche";

/**
 * Filter für Listen und eingebettete Daten: nur Fonds (und Datensätze), an denen die Person mindestens
 * Betrachter ist. Globale Verwalter und sichtbare Fonds ohne Einschränkung liefern `undefined` (kein Filter).
 * Eingebettete Daten eines anderen Bereichs (z. B. Beteiligungen auf der Seite einer Organisation) nennen ihren Bereich: Ohne ihn ist nichts sichtbar.
 */

/** Bedingung für eine Spalte mit Fonds-ID (nicht leer). */
export function fondsSichtbar(c: Context, spalte: AnyPgColumn, bereich?: Bereich): SQL | undefined {
  const akteur = aktuellerAkteur(c);
  if (bereich && !hatBereich(akteur, bereich)) return sql`false`;
  // Bereiche je Fonds: nur Fonds, an denen die Person diesen Bereich hat (ohne Angabe: der Bereich der Route).
  const fonds = sichtbareFonds(akteur, "betrachter", bereich);
  if (fonds === "alle") return undefined;
  return fonds.length ? inArray(spalte, fonds) : sql`false`;
}

/** Deals ohne Fonds sieht jede Person mit einer Rolle, Deals eines Fonds nur, wer dort Dealflow sieht; ohne den Bereich Dealflow keine Deals. */
export function dealSichtbar(c: Context): SQL | undefined {
  const akteur = aktuellerAkteur(c);
  if (!hatBereich(akteur, "dealflow")) return sql`false`;
  const fonds = sichtbareFonds(akteur, "betrachter", "dealflow");
  if (fonds === "alle") return undefined;
  return fonds.length ? or(isNull(deal.fondsId), inArray(deal.fondsId, fonds)) : isNull(deal.fondsId);
}

/** Darf die Person die Fonds-ID sehen? (`null` = kein Fonds, immer sichtbar.) */
export function darfFondsSehen(c: Context, fondsId: string | null, bereich?: Bereich): boolean {
  const akteur = aktuellerAkteur(c);
  if (bereich && !hatBereich(akteur, bereich)) return false;
  if (fondsId === null) return true;
  const fonds = sichtbareFonds(akteur, "betrachter", bereich);
  return fonds === "alle" || fonds.includes(fondsId);
}
