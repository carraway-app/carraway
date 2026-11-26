import { ausFonds } from "./abbildung-fonds";
import { queryOptions } from "@tanstack/react-query";
import { api } from "./client";
import { schluessel } from "./abfragen-kern";

/** Zinsen des Fonds je darlehensartigem Instrument (Fonds → Zinsen). */
const ladeFondsZinsen = (fondsId: string, stichtag?: string, stand?: string) =>
  ausFonds(api.api.v1.funds[":id"].interest.$get, { param: { id: fondsId }, query: { ...(stichtag ? { stichtag } : {}), ...(stand ? { stand } : {}) } });

export type FondsZinsen = Awaited<ReturnType<typeof ladeFondsZinsen>>;

/** Liegt unter `beteiligungen`: jede Buchung an einer Beteiligung entwertet die Ansicht. */
export const fondsZinsen = (fondsId: string, stichtag?: string, stand?: string) =>
  queryOptions({ queryKey: [...schluessel.beteiligungen, "fondszinsen", fondsId, stichtag ?? null, stand ?? null], queryFn: () => ladeFondsZinsen(fondsId, stichtag, stand) });
