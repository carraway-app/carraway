import { ausFonds, type FondsEingabe } from "./abbildung-fonds";
import { queryOptions } from "@tanstack/react-query";
import { schluessel } from "./abfragen-kern";
import { api } from "./client";
import { useApiMutation } from "./mutationen";

/** Verwaltungsvergütung, Fondskosten und Kapitalkonten der Investoren (Issue #157). */

const kosten = api.api.v1.funds[":id"]["fees-and-expenses"];
export type KostenEingabe = FondsEingabe<typeof kosten.$post>["json"];

export const fondsKosten = (fondsId: string, stichtag?: string, stand?: string) => queryOptions({
  queryKey: [...schluessel.bewegungen, fondsId, "kosten", stichtag ?? null, stand ?? null],
  queryFn: () => ausFonds(kosten.$get, { param: { id: fondsId }, query: { stichtag, stand } }),
});
export type KostenListe = Awaited<ReturnType<NonNullable<ReturnType<typeof fondsKosten>["queryFn"]>>>;
export type Kostenbuchung = KostenListe["buchungen"][number];

export const fondsKapitalkonten = (fondsId: string, stichtag?: string, stand?: string) => queryOptions({
  queryKey: [...schluessel.bewegungen, fondsId, "kapitalkonten", stichtag ?? null, stand ?? null],
  queryFn: () => ausFonds(api.api.v1.funds[":id"]["capital-accounts"].$get, { param: { id: fondsId }, query: { stichtag, stand } }),
});
export type Kapitalkonten = Awaited<ReturnType<NonNullable<ReturnType<typeof fondsKapitalkonten>["queryFn"]>>>;

export const ladeKostenVorschau = (fondsId: string, json: KostenEingabe) => ausFonds(kosten.preview.$post, { param: { id: fondsId }, json });
export type KostenVorschau = Awaited<ReturnType<typeof ladeKostenVorschau>>;

export const useKostenBuchen = (fondsId: string) =>
  useApiMutation({
    aufruf: (json: KostenEingabe) => ausFonds(kosten.$post, { param: { id: fondsId }, json }),
    invalidiert: () => [[...schluessel.bewegungen, fondsId]],
  });

export const useKostenStorno = (fondsId: string) =>
  useApiMutation({
    aufruf: ({ kostenId, grund }: { kostenId: string; grund: string }) => ausFonds(kosten[":costEntryId"].reverse.$post, { param: { id: fondsId, kostenId }, json: { grund } }),
    invalidiert: () => [[...schluessel.bewegungen, fondsId]],
  });
