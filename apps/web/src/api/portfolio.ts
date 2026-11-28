import { queryOptions } from "@tanstack/react-query";
import type { InferRequestType } from "hono/client";
import type { HerkunftProps } from "@carraway/ui";
import { api, auspacken } from "./client";
import { auspackenPortfolio, type PortfolioEingabe } from "./abbildung-portfolio";
import { useApiMutation } from "./mutationen";

/**
 * Manager-Profil (Hauswährung), Portfolio-Dashboard und Zielfonds eines Dachfonds. Die Routen sind englisch; gerechnet wird nur auf dem Server. Lädt mit den
 * Seiten, die es brauchen (nicht im Anfangsumfang).
 */

const wurzel = ["portfolio"] as const;

export type StichtagAbfrage = { asOf?: string | undefined; knowledgeDate?: string | undefined };
const bereinigt = (q: StichtagAbfrage) => ({ ...(q.asOf ? { asOf: q.asOf } : {}), ...(q.knowledgeDate ? { knowledgeDate: q.knowledgeDate } : {}) });

const ladeDashboard = (q: StichtagAbfrage & { quarters?: number }) =>
  auspacken(api.api.v1.portfolio.dashboard.$get({ query: { ...bereinigt(q), ...(q.quarters ? { quarters: String(q.quarters) } : {}) } }));
const ladeProfil = (q: StichtagAbfrage) => auspacken(api.api.v1["manager-profile"].$get({ query: bereinigt(q) }));
const ladeZielfonds = (fondsId: string, q: StichtagAbfrage) => auspacken(api.api.v1.funds[":id"]["target-funds"].$get({ param: { id: fondsId }, query: bereinigt(q) }));
const ladeZielfondsDetail = (fondsId: string, id: string, q: StichtagAbfrage) =>
  auspacken(api.api.v1.funds[":id"]["target-funds"][":targetFundId"].$get({ param: { id: fondsId, targetFundId: id }, query: bereinigt(q) }));

export type Dashboard = Awaited<ReturnType<typeof ladeDashboard>>;
export type ManagerProfil = Awaited<ReturnType<typeof ladeProfil>>;
export type ZielfondsListe = Awaited<ReturnType<typeof ladeZielfonds>>;
export type ZielfondsDetail = Awaited<ReturnType<typeof ladeZielfondsDetail>>;
export type ApiKennzahl = Dashboard["totals"]["nav"];
export type NeueZielfondsBewegung = InferRequestType<(typeof api.api.v1.funds)[":id"]["target-funds"][":targetFundId"]["movements"]["$post"]>["json"];
export type NeueZielfondsMeldung = InferRequestType<(typeof api.api.v1.funds)[":id"]["target-funds"][":targetFundId"]["nav-reports"]["$post"]>["json"];
export type NeueZielfondsBeteiligung = InferRequestType<(typeof api.api.v1.funds)[":id"]["target-funds"]["$post"]>["json"];
export type ProfilAenderung = InferRequestType<(typeof api.api.v1)["manager-profile"]["$put"]>["json"];

/** Rechenschritte der englischen API für die Herkunftsanzeige der Oberfläche. */
export const alsRechenschritte = (k: ApiKennzahl): HerkunftProps["schritte"] => k.steps.map((s) => ({ zeichen: s.operator, bezeichnung: s.label, wert: s.value, ...(s.sources ? { quellen: s.sources } : {}) }));

export const portfolioDashboard = (q: StichtagAbfrage & { quarters?: number }) => queryOptions({ queryKey: [...wurzel, "dashboard", q.asOf ?? "", q.knowledgeDate ?? "", q.quarters ?? 8], queryFn: () => ladeDashboard(q) });
export const managerProfil = (q: StichtagAbfrage = {}) => queryOptions({ queryKey: [...wurzel, "profil", q.asOf ?? "", q.knowledgeDate ?? ""], queryFn: () => ladeProfil(q) });
export const zielfondsListe = (fondsId: string, q: StichtagAbfrage = {}) => queryOptions({ queryKey: [...wurzel, "zielfonds", fondsId, q.asOf ?? "", q.knowledgeDate ?? ""], queryFn: () => ladeZielfonds(fondsId, q) });
export const zielfondsDetail = (fondsId: string, id: string, q: StichtagAbfrage = {}) => queryOptions({ queryKey: [...wurzel, "zielfonds", fondsId, id, q.asOf ?? "", q.knowledgeDate ?? ""], queryFn: () => ladeZielfondsDetail(fondsId, id, q) });

// Zielfonds und Profil ändern auch die Kennzahlen der Fonds (NAV des Dachfonds, Summen).
const gueltig = () => [wurzel, ["fonds"], ["kennzahlen"], ["waehrung"]] as const;

export const useProfilAendern = () => useApiMutation({ aufruf: (json: ProfilAenderung) => auspacken(api.api.v1["manager-profile"].$put({ json })), invalidiert: gueltig });

export const useZielfondsAnlegen = (fondsId: string) =>
  useApiMutation({ aufruf: (json: NeueZielfondsBeteiligung) => auspacken(api.api.v1.funds[":id"]["target-funds"].$post({ param: { id: fondsId }, json })), invalidiert: gueltig });

export const useZielfondsBewegung = (fondsId: string, id: string) =>
  useApiMutation({ aufruf: (json: NeueZielfondsBewegung) => auspacken(api.api.v1.funds[":id"]["target-funds"][":targetFundId"].movements.$post({ param: { id: fondsId, targetFundId: id }, json })), invalidiert: gueltig });

export const useZielfondsStorno = (fondsId: string, id: string) =>
  useApiMutation({
    aufruf: (movementId: string) => auspacken(api.api.v1.funds[":id"]["target-funds"][":targetFundId"].movements[":movementId"].reverse.$post({ param: { id: fondsId, targetFundId: id, movementId }, json: {} })),
    invalidiert: gueltig,
  });

export const useZielfondsMeldung = (fondsId: string, id: string) =>
  useApiMutation({ aufruf: (json: NeueZielfondsMeldung) => auspacken(api.api.v1.funds[":id"]["target-funds"][":targetFundId"]["nav-reports"].$post({ param: { id: fondsId, targetFundId: id }, json })), invalidiert: gueltig });

type BeteiligungAnlageRoute = (typeof api.api.v1.funds)[":id"]["investments"]["$post"];
export type NeueBeteiligung = PortfolioEingabe<BeteiligungAnlageRoute>["json"];

const ladeUnternehmen = (fondsId: string, q: string) =>
  auspackenPortfolio(api.api.v1.funds[":id"]["investment-companies"].$get, { param: { id: fondsId }, query: { q } });

export type Beteiligungsunternehmen = Awaited<ReturnType<typeof ladeUnternehmen>>[number];

export const beteiligungsunternehmen = (fondsId: string, q: string) =>
  queryOptions({ queryKey: [...wurzel, "beteiligungsunternehmen", fondsId, q], queryFn: () => ladeUnternehmen(fondsId, q) });

export const useBeteiligungAnlegen = () =>
  useApiMutation({
    aufruf: ({ fondsId, ...json }: NeueBeteiligung & { fondsId: string }) =>
      auspackenPortfolio(api.api.v1.funds[":id"].investments.$post, { param: { id: fondsId }, json }),
    invalidiert: () => [...gueltig(), ["organisationen"], ["beteiligungen"]],
  });
