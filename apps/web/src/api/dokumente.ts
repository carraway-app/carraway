import { queryOptions } from "@tanstack/react-query";
import { api, auspacken, ladeMitSitzung } from "./client";
import { useApiMutation } from "./mutationen";

/** Dokumente (Etappe 13). Abfragen über den typisierten Client, Hochladen (multipart) als einfacher Aufruf. Die KI-Auslesung bringt die Erweiterung KI mit (`ee/web`). */

export const MAX_DOKUMENT = 25 * 1024 * 1024;
export const ZIEL_TYPEN = ["beteiligung", "deal", "vorgang", "organisation", "fonds", "bewertung", "finanzierungsrunde"] as const;
export type ZielTyp = (typeof ZIEL_TYPEN)[number];
export const KLASSIFIKATIONEN = ["vertrag", "beschluss", "bewertung", "bericht", "beleg", "sonstiges"] as const;
export type Klassifikation = (typeof KLASSIFIKATIONEN)[number];

export const wurzel = ["dokumente"] as const;

const ladeListe = async (zielTyp: ZielTyp, zielId: string) => (await auspacken(api.api.v1.dokumente.$get({ query: { zielTyp, zielId } }))).daten;
const ladeDetail = (id: string, stand?: string) => auspacken(api.api.v1.dokumente[":id"].$get({ param: { id }, query: { stand } }));

export type DokumentZeile = Awaited<ReturnType<typeof ladeListe>>[number];
export type DokumentDetail = Awaited<ReturnType<typeof ladeDetail>>;

export const dokumenteZiel = (typ: ZielTyp, id: string) => queryOptions({ queryKey: [...wurzel, "ziel", typ, id], queryFn: () => ladeListe(typ, id) });
export const dokumentDetail = (id: string, stand?: string) => queryOptions({ queryKey: [...wurzel, "detail", id, stand ?? null], queryFn: () => ladeDetail(id, stand) });
/** Normale Links (Cookie und Rechte prüft die API). `seite` öffnet den Browser-Betrachter an dieser Seite. */
export const dokumentDateiUrl = (id: string, optionen: { inline?: boolean; seite?: number } = {}) =>
  `/api/v1/dokumente/${id}/datei${optionen.inline ? "?inline=1" : ""}${optionen.seite ? `#page=${optionen.seite}` : ""}`;
export const dokumentSeiteUrl = (id: string, seite?: number) => `/dokumente/${id}${seite ? `?seite=${seite}` : ""}`;

export const json = (pfad: string, methode: string, koerper?: unknown) =>
  auspacken(ladeMitSitzung(`${window.location.origin}/api/v1${pfad}`, { method: methode, headers: { "Content-Type": "application/json" }, ...(koerper === undefined ? {} : { body: JSON.stringify(koerper) }) })) as Promise<Record<string, unknown>>;

export interface UploadEingabe {
  datei: File;
  ziele: { typ: ZielTyp; id: string }[];
  klassifikation: Klassifikation;
  vertraulich: boolean;
}

export const useDokumentHochladen = () =>
  useApiMutation({
    aufruf: ({ datei, ziele, klassifikation, vertraulich }: UploadEingabe) => {
      const f = new FormData();
      f.append("datei", datei);
      f.append("ziele", JSON.stringify(ziele));
      f.append("klassifikation", klassifikation);
      f.append("vertraulich", String(vertraulich));
      return auspacken(ladeMitSitzung(`${window.location.origin}/api/v1/dokumente`, { method: "POST", body: f })) as Promise<Record<string, unknown>>;
    },
    invalidiert: () => [wurzel],
  });

export const useDokumentErsetzen = () =>
  useApiMutation({
    aufruf: ({ id, datei }: { id: string; datei: File }) => {
      const f = new FormData();
      f.append("datei", datei);
      return auspacken(ladeMitSitzung(`${window.location.origin}/api/v1/dokumente/${id}/ersetzen`, { method: "POST", body: f })) as Promise<Record<string, unknown>>;
    },
    invalidiert: () => [wurzel],
  });

export const useDokumentLoeschen = () =>
  useApiMutation({
    aufruf: (id: string) => auspacken(ladeMitSitzung(`${window.location.origin}/api/v1/dokumente/${id}`, { method: "DELETE" })),
    invalidiert: () => [wurzel],
  });
