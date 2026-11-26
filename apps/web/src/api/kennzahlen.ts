import { auspackenPortfolio, type PortfolioEingabe } from "./abbildung-portfolio";
import { queryOptions } from "@tanstack/react-query";
import { api } from "./client";
import { useApiMutation } from "./mutationen";

/**
 * Kennzahlen der Portfoliounternehmen: Katalog, Auswahl je Fonds, Zeitreihen, Werte und Anfragen. Alles unter einem Schlüsselpräfix,
 * damit Schreibvorgänge genau diesen Teil entwerten.
 */
const wurzel = ["kennzahlen"] as const;

export type Szenario = "ist" | "plan" | "forecast";
export const SZENARIEN: readonly Szenario[] = ["ist", "plan", "forecast"];

const ladeKatalog = async (alle: boolean) => (await auspackenPortfolio(api.api.v1.metrics.catalog.$get, { query: { alle: alle ? "true" : "false" } })).daten;
const ladeAuswahl = async (fondsId: string) => (await auspackenPortfolio(api.api.v1.funds[":id"].metrics.selection.$get, { param: { id: fondsId } })).daten;
const ladeReihe = (beteiligungId: string) => auspackenPortfolio(api.api.v1.investments[":id"].metrics.$get, { param: { id: beteiligungId }, query: {} });
const ladeUebersicht = (fondsId: string, periode: string) => auspackenPortfolio(api.api.v1.funds[":id"].metrics.overview.$get, { param: { id: fondsId }, query: { periode } });
const ladeAbfragen = async (fondsId: string) => (await auspackenPortfolio(api.api.v1.funds[":id"].metrics["metric-requests"].$get, { param: { id: fondsId }, query: {} })).daten;
const ladeAbfrage = (id: string) => auspackenPortfolio(api.api.v1.metrics["metric-requests"][":id"].$get, { param: { id } });

export type Katalog = Awaited<ReturnType<typeof ladeKatalog>>;
export type KatalogEintrag = Katalog[number];
export type AuswahlZeile = Awaited<ReturnType<typeof ladeAuswahl>>[number];
export type Zeitreihe = Awaited<ReturnType<typeof ladeReihe>>;
export type Reihe = Zeitreihe["kennzahlen"][number];
export type Punkt = Reihe["punkte"][number];
export type OffenerWert = Zeitreihe["offen"][number];
export type Uebersicht = Awaited<ReturnType<typeof ladeUebersicht>>;
export type AbfrageZeile = Awaited<ReturnType<typeof ladeAbfragen>>[number];
export type AbfrageDetail = Awaited<ReturnType<typeof ladeAbfrage>>;
export type NeueDefinition = PortfolioEingabe<typeof api.api.v1.metrics.catalog.$post>["json"];
export type NeueAbfrage = PortfolioEingabe<(typeof api.api.v1.investments)[":id"]["metrics"]["metric-requests"]["$post"]>["json"];
export type NeuerWert = PortfolioEingabe<(typeof api.api.v1.investments)[":id"]["metrics"]["values"]["$post"]>["json"];
/** Link, der nur beim Anlegen oder bei einem neuen Link ausgegeben wird (die Datenbank kennt nur den Hash). */
export interface Link {
  token: string;
  pfad: string;
  ablauf: string;
}

export const kennzahlKatalog = (alle = false) => queryOptions({ queryKey: [...wurzel, "katalog", alle], queryFn: () => ladeKatalog(alle) });
export const kennzahlAuswahl = (fondsId: string) => queryOptions({ queryKey: [...wurzel, "auswahl", fondsId], queryFn: () => ladeAuswahl(fondsId) });
export const kennzahlReihe = (beteiligungId: string) => queryOptions({ queryKey: [...wurzel, "reihe", beteiligungId], queryFn: () => ladeReihe(beteiligungId) });
export const kennzahlUebersicht = (fondsId: string, periode: string) => queryOptions({ queryKey: [...wurzel, "uebersicht", fondsId, periode], queryFn: () => ladeUebersicht(fondsId, periode) });
export const kennzahlAbfragen = (fondsId: string) => queryOptions({ queryKey: [...wurzel, "abfragen", fondsId], queryFn: () => ladeAbfragen(fondsId) });
export const kennzahlAbfrage = (id: string) => queryOptions({ queryKey: [...wurzel, "abfrage", id], queryFn: () => ladeAbfrage(id) });

const alles = () => [wurzel] as const;

export const useDefinitionAnlegen = () =>
  useApiMutation({ aufruf: (json: NeueDefinition) => auspackenPortfolio(api.api.v1.metrics.catalog.$post, { json }), invalidiert: alles });

export const useVersionAnlegen = () =>
  useApiMutation({
    aufruf: ({ schluessel, json }: { schluessel: string; json: { bezeichnungDe?: string; bezeichnungEn?: string; einheit?: string; periodizitaet?: "monat" | "quartal" | "jahr"; aggregation?: "summe" | "stand" | "durchschnitt"; pflicht?: boolean; gueltigAb?: string } }) =>
      auspackenPortfolio(api.api.v1.metrics.catalog[":metricKey"].versions.$post, { param: { schluessel }, json }),
    invalidiert: alles,
  });

export const useAusserKraft = () =>
  useApiMutation({ aufruf: (schluessel: string) => auspackenPortfolio(api.api.v1.metrics.catalog[":metricKey"].$delete, { param: { schluessel } }), invalidiert: alles });

export const useAuswahlSetzen = (fondsId: string) =>
  useApiMutation({ aufruf: (schluessel: string[]) => auspackenPortfolio(api.api.v1.funds[":id"].metrics.selection.$put, { param: { id: fondsId }, json: { schluessel } }), invalidiert: alles });

export const useWertAnlegen = (beteiligungId: string) =>
  useApiMutation({ aufruf: (json: NeuerWert) => auspackenPortfolio(api.api.v1.investments[":id"].metrics.values.$post, { param: { id: beteiligungId }, json }), invalidiert: alles });

export const useWertAendern = () =>
  useApiMutation({
    aufruf: ({ id, json }: { id: string; json: { wert?: string; kommentar?: string | null } }) => auspackenPortfolio(api.api.v1.metrics.values[":id"].$patch, { param: { id }, json }),
    invalidiert: alles,
  });

export const useWertBestaetigen = () =>
  useApiMutation({ aufruf: (id: string) => auspackenPortfolio(api.api.v1.metrics.values[":id"].confirm.$post, { param: { id } }), invalidiert: alles });

export const useWertVerwerfen = () =>
  useApiMutation({ aufruf: (id: string) => auspackenPortfolio(api.api.v1.metrics.values[":id"].discard.$post, { param: { id } }), invalidiert: alles });

export const useAbfrageAnlegen = (beteiligungId: string) =>
  useApiMutation({
    aufruf: async (json: NeueAbfrage) => (await auspackenPortfolio(api.api.v1.investments[":id"].metrics["metric-requests"].$post, { param: { id: beteiligungId }, json })) as { abfrage: { id: string }; link: Link },
    invalidiert: alles,
  });

export const useNeuerLink = () =>
  useApiMutation({
    aufruf: async (id: string) => (await auspackenPortfolio(api.api.v1.metrics["metric-requests"][":id"]["renew-link"].$post, { param: { id } })) as { abfrage: { id: string }; link: Link },
    invalidiert: alles,
  });

export const useAbfrageWiderrufen = () =>
  useApiMutation({ aufruf: (id: string) => auspackenPortfolio(api.api.v1.metrics["metric-requests"][":id"].revoke.$post, { param: { id } }), invalidiert: alles });

export const useAbfrageBestaetigen = () =>
  useApiMutation({ aufruf: (id: string) => auspackenPortfolio(api.api.v1.metrics["metric-requests"][":id"].confirm.$post, { param: { id } }), invalidiert: alles });
