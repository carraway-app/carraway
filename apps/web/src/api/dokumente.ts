import { queryOptions } from "@tanstack/react-query";
import { api } from "./client";
import { useApiMutation } from "./mutationen";
import { ausBerichteBereich, bereichAbruf } from "./abbildung-berichte";

const ausDokumenten = ausBerichteBereich("document");

/** Dokumente (Etappe 13). Abfragen über den typisierten Client, Hochladen (multipart) als einfacher Aufruf. Die KI-Auslesung bringt die Erweiterung KI mit (`ee/web`). */

export const MAX_DOKUMENT = 25 * 1024 * 1024;
export const ZIEL_TYPEN = ["beteiligung", "deal", "vorgang", "organisation", "fonds", "bewertung", "finanzierungsrunde"] as const;
export type ZielTyp = (typeof ZIEL_TYPEN)[number];
export const KLASSIFIKATIONEN = ["vertrag", "beschluss", "bewertung", "bericht", "beleg", "sonstiges"] as const;
export type Klassifikation = (typeof KLASSIFIKATIONEN)[number];

export const wurzel = ["dokumente"] as const;

const ladeListe = async (zielTyp: ZielTyp, zielId: string) => (await ausDokumenten(api.api.v1.documents.$get, { query: { zielTyp, zielId } })).daten;
const ladeDetail = (id: string, stand?: string) => ausDokumenten(api.api.v1.documents[":id"].$get, { param: { id }, query: { stand } });

export type DokumentZeile = Awaited<ReturnType<typeof ladeListe>>[number];
export type DokumentDetail = Awaited<ReturnType<typeof ladeDetail>>;

export const dokumenteZiel = (typ: ZielTyp, id: string) => queryOptions({ queryKey: [...wurzel, "ziel", typ, id], queryFn: () => ladeListe(typ, id) });
export const dokumentDetail = (id: string, stand?: string) => queryOptions({ queryKey: [...wurzel, "detail", id, stand ?? null], queryFn: () => ladeDetail(id, stand) });
/** Normale Links (Cookie und Rechte prüft die API). `seite` öffnet den Browser-Betrachter an dieser Seite. */
export const dokumentDateiUrl = (id: string, optionen: { inline?: boolean; seite?: number } = {}) =>
  `/api/v1/documents/${id}/file${optionen.inline ? "?inline=1" : ""}${optionen.seite ? `#page=${optionen.seite}` : ""}`;
export const dokumentSeiteUrl = (id: string, seite?: number) => `/dokumente/${id}${seite ? `?seite=${seite}` : ""}`;

export interface UploadEingabe {
  datei: File;
  ziele: { typ: ZielTyp; id: string }[];
  klassifikation: Klassifikation;
  vertraulich: boolean;
}

export const useDokumentHochladen = () =>
  useApiMutation({
    aufruf: async ({ datei, ziele, klassifikation, vertraulich }: UploadEingabe) => {
      const { berichtAnApi } = await import("@carraway/api/berichte-vertrag");
      const { targets, classification, confidential } = berichtAnApi("document", { ziele, klassifikation, vertraulich });
      const f = new FormData();
      f.append("file", datei);
      f.append("targets", JSON.stringify(targets));
      f.append("classification", classification);
      f.append("confidential", String(confidential));
      return bereichAbruf("document", "/documents", "POST", f) as Promise<Record<string, unknown>>;
    },
    invalidiert: () => [wurzel],
  });

export const useDokumentErsetzen = () =>
  useApiMutation({
    aufruf: ({ id, datei }: { id: string; datei: File }) => {
      const f = new FormData();
      f.append("file", datei);
      return bereichAbruf("document", `/documents/${id}/replace`, "POST", f) as Promise<Record<string, unknown>>;
    },
    invalidiert: () => [wurzel],
  });

export const useDokumentLoeschen = () =>
  useApiMutation({
    aufruf: (id: string) => ausDokumenten(api.api.v1.documents[":id"].$delete, { param: { id } }),
    invalidiert: () => [wurzel],
  });
