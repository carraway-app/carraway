import { ausFonds } from "./abbildung-fonds";
import { buchhaltungsAufruf } from "./abbildung-buchhaltung";
import { queryOptions } from "@tanstack/react-query";
import { schluessel } from "./abfragen-kern";
import { api } from "./client";

export type Kapitalart = "abruf" | "ausschuettung";
export type AufteilungsEingabe = { art: Kapitalart; valuta: string; faelligAm?: string; betrag: string };

export const ladeAufteilungsVorschau = (fondsId: string, query: AufteilungsEingabe) =>
  buchhaltungsAufruf((en) => api.api.v1.funds[":id"]["fund-movements"].preview.$get(en({ param: { id: fondsId }, query })));

const ladeBewegungsDetails = (id: string) => ausFonds(api.api.v1["fund-movements"][":id"].$get, { param: { id } });

export const bewegungsDetails = (fondsId: string, id: string) => queryOptions({
  queryKey: [...schluessel.bewegungen, fondsId, "detail", id],
  queryFn: () => ladeBewegungsDetails(id),
});

export type BewegungsAufteilung = Awaited<ReturnType<typeof ladeAufteilungsVorschau> | ReturnType<typeof ladeBewegungsDetails>>;

export const fondsKapitalstand = (fondsId: string, stichtag: string, stand?: string) => queryOptions({
  queryKey: [...schluessel.bewegungen, fondsId, "kapitalstand", stichtag, stand ?? null],
  queryFn: () => ausFonds(api.api.v1.funds[":id"].movements["capital-position"].$get, { param: { id: fondsId }, query: { stichtag, stand } }),
});

const zahlungen = api.api.v1["fund-movements"][":id"].payments;

export const zahlungsstand = (fondsId: string, id: string, stichtag: string, stand?: string) => queryOptions({
  queryKey: [...schluessel.bewegungen, fondsId, id, "zahlungen", stichtag, stand ?? null],
  queryFn: () => ausFonds(zahlungen.$get, { param: { id }, query: { stichtag, stand } }),
});

export type Zahlungsbuchung = { organisationId: string; valuta: string; betrag: string; belegreferenz?: string } | { zahlungId: string; valuta: string; grund: string };
export const bucheZahlung = (id: string, json: Zahlungsbuchung) => "zahlungId" in json
  ? ausFonds(zahlungen.reverse.$post, { param: { id }, json })
  : ausFonds(zahlungen.$post, { param: { id }, json });

export const kapitalHerkunft = (fondsId: string, stichtag: string, stand: string, bewegungId?: string) => queryOptions({
  queryKey: [...schluessel.bewegungen, fondsId, "herkunft", stichtag, stand, bewegungId ?? null],
  queryFn: () => ausFonds(api.api.v1.funds[":id"].movements.sources.$get, { param: { id: fondsId }, query: { stichtag, stand, bewegungId } }),
});


export const mitteilungDateiUrl = (fundId: string, noticeId: string, asOf: string, knowledgeDate: string) =>
  `/api/v1/funds/${fundId}/movements/notices/${noticeId}/file?${new URLSearchParams({ asOf, knowledgeDate })}`;
