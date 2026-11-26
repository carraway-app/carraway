import { ausFonds, type FondsEingabe } from "./abbildung-fonds";
import { queryOptions } from "@tanstack/react-query";
import { api } from "./client";
import { useApiMutation } from "./mutationen";

/** Szenarien, Vergleich und Reserven (Etappe 18). Gerechnet wird nur auf dem Server; hier stehen Abfragen, Mutationen und Berichtslinks. */

const wurzel = ["szenarien"] as const;
const reservenWurzel = ["reserven"] as const;

const ladeListe = async (fondsId: string) => (await ausFonds(api.api.v1.funds[":id"].scenarios.$get, { param: { id: fondsId } })).daten;
const ladeDetail = (id: string) => ausFonds(api.api.v1.scenarios[":id"].$get, { param: { id } });
const ladeVorlage = (fondsId: string) => ausFonds(api.api.v1.funds[":id"].scenarios.template.$get, { param: { id: fondsId } });
const ladeVergleich = (fondsId: string, ids: string[]) => ausFonds(api.api.v1.funds[":id"].scenarios.comparison.$get, { param: { id: fondsId }, query: { ids: ids.join(",") } });
const ladeReserven = (fondsId: string, szenarioId?: string) => ausFonds(api.api.v1.funds[":id"].reserves.$get, { param: { id: fondsId }, query: szenarioId ? { szenarioId } : {} });

export type SzenarioKopf = Awaited<ReturnType<typeof ladeListe>>[number];
export type SzenarioDetail = Awaited<ReturnType<typeof ladeDetail>>;
export type SzenarioVorlage = Awaited<ReturnType<typeof ladeVorlage>>;
export type SzenarienVergleich = Awaited<ReturnType<typeof ladeVergleich>>;
export type ReservenDaten = Awaited<ReturnType<typeof ladeReserven>>;
export type NeuesSzenario = FondsEingabe<(typeof api.api.v1.funds)[":id"]["scenarios"]["$post"]>["json"];
export type SzenarioAenderung = FondsEingabe<(typeof api.api.v1.scenarios)[":id"]["$patch"]>["json"];
export type SzenarioAnnahmen = NeuesSzenario["annahmen"];

export const szenarienListe = (fondsId: string) => queryOptions({ queryKey: [...wurzel, "liste", fondsId], queryFn: () => ladeListe(fondsId) });
export const szenarioDetail = (id: string) => queryOptions({ queryKey: [...wurzel, "detail", id], queryFn: () => ladeDetail(id) });
export const szenarioVorlage = (fondsId: string) => queryOptions({ queryKey: [...wurzel, "vorlage", fondsId], queryFn: () => ladeVorlage(fondsId) });
export const szenarienVergleich = (fondsId: string, ids: string[]) => queryOptions({ queryKey: [...wurzel, "vergleich", fondsId, ...ids], queryFn: () => ladeVergleich(fondsId, ids), enabled: ids.length > 0 });
export const fondsReserven = (fondsId: string, szenarioId?: string) => queryOptions({ queryKey: [...reservenWurzel, fondsId, szenarioId ?? ""], queryFn: () => ladeReserven(fondsId, szenarioId) });

/** Normale Links (Cookie und Rechte prüft die API). */
export const szenarioBerichtUrl = (id: string, format: "pdf" | "xlsx", sprache: "de" | "en") => `/api/v1/scenarios/${id}/report?format=${format}&language=${sprache}`;
export const vergleichBerichtUrl = (fondsId: string, ids: string[], format: "pdf" | "xlsx", sprache: "de" | "en") => `/api/v1/funds/${fondsId}/scenarios/report?ids=${ids.join(",")}&format=${format}&language=${sprache}`;

const gueltigmachen = (fondsId: string) => [wurzel, [...reservenWurzel, fondsId]] as const;

export const useSzenarioAnlegen = (fondsId: string) =>
  useApiMutation({
    aufruf: (json: NeuesSzenario) => ausFonds(api.api.v1.funds[":id"].scenarios.$post, { param: { id: fondsId }, json }),
    invalidiert: () => gueltigmachen(fondsId),
  });

export const useSzenarioAendern = (fondsId: string, id: string) =>
  useApiMutation({
    aufruf: (json: SzenarioAenderung) => ausFonds(api.api.v1.scenarios[":id"].$patch, { param: { id }, json }),
    invalidiert: () => gueltigmachen(fondsId),
  });

export const useSzenarioLoeschen = (fondsId: string) =>
  useApiMutation({
    aufruf: (id: string) => ausFonds(api.api.v1.scenarios[":id"].$delete, { param: { id } }),
    invalidiert: () => gueltigmachen(fondsId),
  });

export const useSzenarioDuplizieren = (fondsId: string) =>
  useApiMutation({
    aufruf: (id: string) => ausFonds(api.api.v1.scenarios[":id"].duplicate.$post, { param: { id }, json: {} }),
    invalidiert: () => gueltigmachen(fondsId),
  });

export const useSzenarioFestschreiben = (fondsId: string) =>
  useApiMutation({
    aufruf: (id: string) => ausFonds(api.api.v1.scenarios[":id"].lock.$post, { param: { id } }),
    invalidiert: () => gueltigmachen(fondsId),
  });

export const useReserveSetzen = (fondsId: string, beteiligungId: string) =>
  useApiMutation({
    aufruf: (json: { betrag: string; gueltigAb: string; bemerkung?: string | null }) => ausFonds(api.api.v1.investments[":id"].reserve.$put, { param: { id: beteiligungId }, json }),
    invalidiert: () => [[...reservenWurzel, fondsId]],
  });
