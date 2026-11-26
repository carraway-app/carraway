import { auspackenPortfolio, type PortfolioEingabe } from "./abbildung-portfolio";
import { queryOptions } from "@tanstack/react-query";
import { api } from "./client";
import { schluessel } from "./abfragen";
import { useApiMutation } from "./mutationen";

/** Handelsregister (Etappe 18): Abfragen und Mutationen am Unternehmen und an der Beteiligung. */

const wurzel = ["register"] as const;

const ladeRegister = (id: string) => auspackenPortfolio(api.api.v1.organizations[":id"].register.$get, { param: { id } });
const ladeHinweise = async (id: string) => (await auspackenPortfolio(api.api.v1.investments[":id"]["register-notices"].$get, { param: { id } })).daten;
const ladeMeldungen = async (organisationId: string) => (await auspackenPortfolio(api.api.v1.register.notifications.$get, { query: { organisationId } })).daten;

const ladeStatus = () => auspackenPortfolio(api.api.v1.register.status.$get);
const ladeAlleMeldungen = async (nurUngelesen: boolean) => (await auspackenPortfolio(api.api.v1.register.notifications.$get, { query: { ...(nurUngelesen ? { ungelesen: "true" as const } : {}), limit: "100" } })).daten;
const ladeSuche = async (frage: { firma?: string; nummer?: string }) => (await auspackenPortfolio(api.api.v1.register.search.$get, { query: frage })).daten;

export type RegisterStatus = Awaited<ReturnType<typeof ladeStatus>>;
export type SammelMeldung = Awaited<ReturnType<typeof ladeAlleMeldungen>>[number];
export type RegisterTreffer = Awaited<ReturnType<typeof ladeSuche>>[number];
export type RegisterDaten = Awaited<ReturnType<typeof ladeRegister>>;
export type RegisterHinweis = Awaited<ReturnType<typeof ladeHinweise>>[number];
export type RegisterMeldung = Awaited<ReturnType<typeof ladeMeldungen>>[number];
export type NeuerEintrag = PortfolioEingabe<(typeof api.api.v1.organizations)[":id"]["register"]["entries"]["$post"]>["json"];
export type NeuesEreignis = PortfolioEingabe<(typeof api.api.v1.organizations)[":id"]["register"]["events"]["$post"]>["json"];

export const registerOrganisation = (id: string) => queryOptions({ queryKey: [...wurzel, "organisation", id], queryFn: () => ladeRegister(id) });
export const registerHinweise = (beteiligungId: string) => queryOptions({ queryKey: [...wurzel, "hinweise", beteiligungId], queryFn: () => ladeHinweise(beteiligungId), retry: false });
export const registerMeldungen = (organisationId: string) => queryOptions({ queryKey: [...wurzel, "meldungen", organisationId], queryFn: () => ladeMeldungen(organisationId) });

/** Anbieter für Registerdaten (eingerichtet oder nicht). */
export const registerStatus = () => queryOptions({ queryKey: [...wurzel, "status"], queryFn: ladeStatus });
/** Alle Meldungen aus dem Register über alle Unternehmen, neueste zuerst. */
export const alleRegisterMeldungen = (nurUngelesen: boolean) => queryOptions({ queryKey: [...wurzel, "meldungen-alle", nurUngelesen], queryFn: () => ladeAlleMeldungen(nurUngelesen) });
/** Suche beim Anbieter; nur nach ausdrücklicher Eingabe, ohne Wiederholung (ein Abruf kostet beim Anbieter). */
export const registerSuche = (frage: { firma?: string; nummer?: string }) => queryOptions({ queryKey: [...wurzel, "suche", frage.firma ?? "", frage.nummer ?? ""], queryFn: () => ladeSuche(frage), retry: false, staleTime: 60_000 });

/** Nach jeder Änderung am Register gelten alle Registerabfragen als veraltet; Stammdaten können sich geändert haben. */
const alles = (organisationId: string) => [wurzel, schluessel.organisationDetail(organisationId), schluessel.organisationListe] as const;

export const useEintragErfassen = (organisationId: string) =>
  useApiMutation({
    aufruf: (json: NeuerEintrag) => auspackenPortfolio(api.api.v1.organizations[":id"].register.entries.$post, { param: { id: organisationId }, json }),
    invalidiert: () => alles(organisationId),
  });

export const useUebernehmen = (organisationId: string) =>
  useApiMutation({
    aufruf: (felder: ("firma" | "sitz" | "rechtsform" | "geschaeftsfuehrung")[]) => auspackenPortfolio(api.api.v1.organizations[":id"].register.apply.$post, { param: { id: organisationId }, json: { felder } }),
    invalidiert: () => [...alles(organisationId), schluessel.beteiligungen],
  });

export const useEreignisErfassen = (organisationId: string) =>
  useApiMutation({
    aufruf: (json: NeuesEreignis) => auspackenPortfolio(api.api.v1.organizations[":id"].register.events.$post, { param: { id: organisationId }, json }),
    invalidiert: () => alles(organisationId),
  });

export const useEreignisErledigen = (organisationId: string) =>
  useApiMutation({
    aufruf: (ereignisId: string) => auspackenPortfolio(api.api.v1.organizations[":id"].register.events[":eventId"].resolve.$post, { param: { id: organisationId, ereignisId } }),
    invalidiert: () => alles(organisationId),
  });

export const useBeobachtung = (organisationId: string) =>
  useApiMutation({
    aufruf: (aktiv: boolean) => auspackenPortfolio(api.api.v1.organizations[":id"].register.monitoring.$put, { param: { id: organisationId }, json: { aktiv } }),
    invalidiert: () => alles(organisationId),
  });

export const useRegisterAbruf = (organisationId: string) =>
  useApiMutation({
    aufruf: () => auspackenPortfolio(api.api.v1.organizations[":id"].register.fetch.$post, { param: { id: organisationId }, json: {} }),
    invalidiert: () => alles(organisationId),
  });

export const useMeldungGelesen = (organisationId: string) =>
  useApiMutation({
    aufruf: (id: string) => auspackenPortfolio(api.api.v1.register.notifications[":id"]["mark-read"].$post, { param: { id } }),
    invalidiert: () => alles(organisationId),
  });

/** Meldung aus der Gesamtliste als gelesen markieren (kein einzelnes Unternehmen offen). */
export const useMeldungGelesenGesamt = () =>
  useApiMutation({
    aufruf: (id: string) => auspackenPortfolio(api.api.v1.register.notifications[":id"]["mark-read"].$post, { param: { id } }),
    invalidiert: () => [wurzel],
  });

/** Sammelaktualisierung aus einer JSON- oder CSV-Datei; mit `nurPruefen` wird nichts übernommen. */
export const useRegisterImport = () =>
  useApiMutation({
    aufruf: (json: { format: "json" | "csv"; inhalt: string; nurPruefen: boolean }) => auspackenPortfolio(api.api.v1.register.import.$post, { json }),
    invalidiert: () => [wurzel, schluessel.organisationListe],
  });
