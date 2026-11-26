import { queryOptions } from "@tanstack/react-query";
import type { InferRequestType } from "hono/client";
import { api, auspacken } from "./client";
import { useApiMutation } from "./mutationen";

/** Szenarien, Vergleich und Reserven (Etappe 18). Gerechnet wird nur auf dem Server; hier stehen Abfragen, Mutationen und Berichtslinks. */

const wurzel = ["szenarien"] as const;
const reservenWurzel = ["reserven"] as const;

const ladeListe = async (fondsId: string) => (await auspacken(api.api.v1.fonds[":id"].szenarien.$get({ param: { id: fondsId } }))).daten;
const ladeDetail = (id: string) => auspacken(api.api.v1.szenarien[":id"].$get({ param: { id } }));
const ladeVorlage = (fondsId: string) => auspacken(api.api.v1.fonds[":id"].szenarien.vorlage.$get({ param: { id: fondsId } }));
const ladeVergleich = (fondsId: string, ids: string[]) => auspacken(api.api.v1.fonds[":id"].szenarien.vergleich.$get({ param: { id: fondsId }, query: { ids: ids.join(",") } }));
const ladeReserven = (fondsId: string, szenarioId?: string) => auspacken(api.api.v1.fonds[":id"].reserven.$get({ param: { id: fondsId }, query: szenarioId ? { szenarioId } : {} }));

export type SzenarioKopf = Awaited<ReturnType<typeof ladeListe>>[number];
export type SzenarioDetail = Awaited<ReturnType<typeof ladeDetail>>;
export type SzenarioVorlage = Awaited<ReturnType<typeof ladeVorlage>>;
export type SzenarienVergleich = Awaited<ReturnType<typeof ladeVergleich>>;
export type ReservenDaten = Awaited<ReturnType<typeof ladeReserven>>;
export type NeuesSzenario = InferRequestType<(typeof api.api.v1.fonds)[":id"]["szenarien"]["$post"]>["json"];
export type SzenarioAenderung = InferRequestType<(typeof api.api.v1.szenarien)[":id"]["$patch"]>["json"];
export type SzenarioAnnahmen = NeuesSzenario["annahmen"];

export const szenarienListe = (fondsId: string) => queryOptions({ queryKey: [...wurzel, "liste", fondsId], queryFn: () => ladeListe(fondsId) });
export const szenarioDetail = (id: string) => queryOptions({ queryKey: [...wurzel, "detail", id], queryFn: () => ladeDetail(id) });
export const szenarioVorlage = (fondsId: string) => queryOptions({ queryKey: [...wurzel, "vorlage", fondsId], queryFn: () => ladeVorlage(fondsId) });
export const szenarienVergleich = (fondsId: string, ids: string[]) => queryOptions({ queryKey: [...wurzel, "vergleich", fondsId, ...ids], queryFn: () => ladeVergleich(fondsId, ids), enabled: ids.length > 0 });
export const fondsReserven = (fondsId: string, szenarioId?: string) => queryOptions({ queryKey: [...reservenWurzel, fondsId, szenarioId ?? ""], queryFn: () => ladeReserven(fondsId, szenarioId) });

/** Normale Links (Cookie und Rechte prüft die API). */
export const szenarioBerichtUrl = (id: string, format: "pdf" | "xlsx", sprache: "de" | "en") => `/api/v1/szenarien/${id}/bericht?format=${format}&sprache=${sprache}`;
export const vergleichBerichtUrl = (fondsId: string, ids: string[], format: "pdf" | "xlsx", sprache: "de" | "en") => `/api/v1/fonds/${fondsId}/szenarien/bericht?ids=${ids.join(",")}&format=${format}&sprache=${sprache}`;

const gueltigmachen = (fondsId: string) => [wurzel, [...reservenWurzel, fondsId]] as const;

export const useSzenarioAnlegen = (fondsId: string) =>
  useApiMutation({
    aufruf: (json: NeuesSzenario) => auspacken(api.api.v1.fonds[":id"].szenarien.$post({ param: { id: fondsId }, json })),
    invalidiert: () => gueltigmachen(fondsId),
  });

export const useSzenarioAendern = (fondsId: string, id: string) =>
  useApiMutation({
    aufruf: (json: SzenarioAenderung) => auspacken(api.api.v1.szenarien[":id"].$patch({ param: { id }, json })),
    invalidiert: () => gueltigmachen(fondsId),
  });

export const useSzenarioLoeschen = (fondsId: string) =>
  useApiMutation({
    aufruf: (id: string) => auspacken(api.api.v1.szenarien[":id"].$delete({ param: { id } })),
    invalidiert: () => gueltigmachen(fondsId),
  });

export const useSzenarioDuplizieren = (fondsId: string) =>
  useApiMutation({
    aufruf: (id: string) => auspacken(api.api.v1.szenarien[":id"].duplizieren.$post({ param: { id }, json: {} })),
    invalidiert: () => gueltigmachen(fondsId),
  });

export const useSzenarioFestschreiben = (fondsId: string) =>
  useApiMutation({
    aufruf: (id: string) => auspacken(api.api.v1.szenarien[":id"].festschreiben.$post({ param: { id } })),
    invalidiert: () => gueltigmachen(fondsId),
  });

export const useReserveSetzen = (fondsId: string, beteiligungId: string) =>
  useApiMutation({
    aufruf: (json: { betrag: string; gueltigAb: string; bemerkung?: string | null }) => auspacken(api.api.v1.beteiligungen[":id"].reserve.$put({ param: { id: beteiligungId }, json })),
    invalidiert: () => [[...reservenWurzel, fondsId]],
  });
