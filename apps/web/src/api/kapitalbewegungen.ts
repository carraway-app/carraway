import { queryOptions } from "@tanstack/react-query";
import { schluessel } from "./abfragen-kern";
import { api, auspacken } from "./client";

export type Kapitalart = "abruf" | "ausschuettung";
export type AufteilungsEingabe = { art: Kapitalart; valuta: string; faelligAm?: string; betrag: string };

export const ladeAufteilungsVorschau = (fondsId: string, query: AufteilungsEingabe) =>
  auspacken(api.api.v1.fonds[":id"].fondsbewegungen.vorschau.$get({ param: { id: fondsId }, query }));

const ladeBewegungsDetails = (id: string) => auspacken(api.api.v1.fondsbewegungen[":id"].$get({ param: { id } }));

export const bewegungsDetails = (fondsId: string, id: string) => queryOptions({
  queryKey: [...schluessel.bewegungen, fondsId, "detail", id],
  queryFn: () => ladeBewegungsDetails(id),
});

export type BewegungsAufteilung = Awaited<ReturnType<typeof ladeAufteilungsVorschau> | ReturnType<typeof ladeBewegungsDetails>>;

export const fondsKapitalstand = (fondsId: string, stichtag: string, stand?: string) => queryOptions({
  queryKey: [...schluessel.bewegungen, fondsId, "kapitalstand", stichtag, stand ?? null],
  queryFn: () => auspacken(api.api.v1.fonds[":id"].bewegungen.kapitalstand.$get({ param: { id: fondsId }, query: { stichtag, stand } })),
});

const zahlungen = api.api.v1.fondsbewegungen[":id"].zahlungen;

export const zahlungsstand = (fondsId: string, id: string, stichtag: string, stand?: string) => queryOptions({
  queryKey: [...schluessel.bewegungen, fondsId, id, "zahlungen", stichtag, stand ?? null],
  queryFn: () => auspacken(zahlungen.$get({ param: { id }, query: { stichtag, stand } })),
});

export type Zahlungsbuchung = { organisationId: string; valuta: string; betrag: string; belegreferenz?: string } | { zahlungId: string; valuta: string; grund: string };
export const bucheZahlung = (id: string, json: Zahlungsbuchung) => "zahlungId" in json
  ? auspacken(zahlungen.storno.$post({ param: { id }, json }))
  : auspacken(zahlungen.$post({ param: { id }, json }));

export const kapitalHerkunft = (fondsId: string, stichtag: string, stand: string, bewegungId?: string) => queryOptions({
  queryKey: [...schluessel.bewegungen, fondsId, "herkunft", stichtag, stand, bewegungId ?? null],
  queryFn: () => auspacken(api.api.v1.fonds[":id"].bewegungen.herkunft.$get({ param: { id: fondsId }, query: { stichtag, stand, bewegungId } })),
});
