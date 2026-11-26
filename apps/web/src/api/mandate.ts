import { ausFonds } from "./abbildung-fonds";
import { auspackenPortfolio, type PortfolioEingabe } from "./abbildung-portfolio";
import { queryOptions } from "@tanstack/react-query";
import { schluessel } from "./abfragen-kern";
import { api } from "./client";
import { useApiMutation } from "./mutationen";

/** Gremienmandate je Beteiligung und je Fonds (Issue #156). */

const ladeBeteiligungMandate = async (beteiligungId: string) => (await auspackenPortfolio(api.api.v1.investments[":id"]["board-mandates"].$get, { param: { id: beteiligungId }, query: {} })).daten;
const ladeFondsMandate = async (fondsId: string, stichtag?: string) =>
  (await ausFonds(api.api.v1.funds[":id"]["board-mandates"].$get, { param: { id: fondsId }, query: stichtag ? { stichtag } : {} })).daten;

const MANDATE = "mandate";

export const beteiligungMandate = (beteiligungId: string) =>
  queryOptions({ queryKey: [...schluessel.beteiligungen, beteiligungId, MANDATE], queryFn: () => ladeBeteiligungMandate(beteiligungId) });
export const fondsMandate = (fondsId: string, stichtag?: string) =>
  queryOptions({ queryKey: [MANDATE, "fonds", fondsId, stichtag ?? null], queryFn: () => ladeFondsMandate(fondsId, stichtag) });

export type Mandat = Awaited<ReturnType<typeof ladeBeteiligungMandate>>[number];
export type NeuesMandat = PortfolioEingabe<(typeof api.api.v1.investments)[":id"]["board-mandates"]["$post"]>["json"];
export type MandatAenderung = PortfolioEingabe<(typeof api.api.v1.investments)[":id"]["board-mandates"][":mandateId"]["$patch"]>["json"];
export type Gremium = NeuesMandat["gremium"];
export type MandatRolle = NeuesMandat["rolle"];

/** Mandate stehen an der Beteiligung und in der Liste des Fonds: beide neu laden. */
const geaendert = (beteiligungId: string) => [[...schluessel.beteiligungen, beteiligungId, MANDATE], [MANDATE]];

export const useMandatAnlegen = (beteiligungId: string) =>
  useApiMutation({
    aufruf: (json: NeuesMandat) => auspackenPortfolio(api.api.v1.investments[":id"]["board-mandates"].$post, { param: { id: beteiligungId }, json }),
    invalidiert: () => geaendert(beteiligungId),
  });

export const useMandatAendern = (beteiligungId: string) =>
  useApiMutation({
    aufruf: ({ mandatId, ...json }: { mandatId: string } & MandatAenderung) => auspackenPortfolio(api.api.v1.investments[":id"]["board-mandates"][":mandateId"].$patch, { param: { id: beteiligungId, mandatId }, json }),
    invalidiert: () => geaendert(beteiligungId),
  });

export const useMandatLoeschen = (beteiligungId: string) =>
  useApiMutation({
    aufruf: async (mandatId: string) => {
      await auspackenPortfolio(api.api.v1.investments[":id"]["board-mandates"][":mandateId"].$delete, { param: { id: beteiligungId, mandatId } });
    },
    invalidiert: () => geaendert(beteiligungId),
  });
