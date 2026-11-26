import { queryOptions, type QueryClient } from "@tanstack/react-query";
import type { InferRequestType } from "hono/client";
import { schluessel } from "./abfragen";
import { api, auspacken } from "./client";
import { useApiMutation } from "./mutationen";

/** Verwaltung (nur Verwalter): Benutzer, Rollen je Fonds, API-Schlüssel, Periodensperre. Alles unter einem Schlüsselpräfix, damit Schreibvorgänge genau diesen Teil entwerten. */
export const verwaltung = ["verwaltung"] as const;

const ladeBenutzer = async () => (await auspacken(api.api.v1.benutzer.$get())).daten;
const ladeRollen = async (fondsId: string) => (await auspacken(api.api.v1.fonds[":id"].rollen.$get({ param: { id: fondsId } }))).daten;
const ladeSchluessel = async () => (await auspacken(api.api.v1["api-schluessel"].$get())).daten;
const ladeSperre = (fondsId: string) => auspacken(api.api.v1.fonds[":id"].periodensperre.$get({ param: { id: fondsId } }));


export type BenutzerZeile = Awaited<ReturnType<typeof ladeBenutzer>>[number];
export type RollenZeile = Awaited<ReturnType<typeof ladeRollen>>[number];
export type SchluesselZeile = Awaited<ReturnType<typeof ladeSchluessel>>[number];
export type Periodensperre = Awaited<ReturnType<typeof ladeSperre>>;
export type NeuerBenutzer = InferRequestType<typeof api.api.v1.benutzer.$post>["json"];
export type NeuerSchluessel = InferRequestType<(typeof api.api.v1)["api-schluessel"]["$post"]>["json"];

const ladeAufbewahrung = () => auspacken(api.api.v1.dokumente.aufbewahrung.$get());
export type Aufbewahrung = Awaited<ReturnType<typeof ladeAufbewahrung>>;
export const aufbewahrungAnsicht = () => queryOptions({ queryKey: [...verwaltung, "aufbewahrung"], queryFn: ladeAufbewahrung });

const ladeBetrieb = () => auspacken(api.api.v1.betrieb.status.$get());
export type Betriebsstatus = Awaited<ReturnType<typeof ladeBetrieb>>;
/** Betriebsstatus (nur globale Verwalter); die Seite lädt ihn alle 30 Sekunden neu. */
export const betriebsstatus = () => queryOptions({ queryKey: [...verwaltung, "betrieb"], queryFn: ladeBetrieb, refetchInterval: 30_000 });

export const benutzerListe = () => queryOptions({ queryKey: [...verwaltung, "benutzer"], queryFn: ladeBenutzer });
/** Schlüssel der Zeichnungen und Closings eines Fonds; die Erweiterung LP-Portal hängt ihre Zugänge darunter. */
export const fondsInvestorSchluessel = [...schluessel.fonds, "investorenzugaenge"] as const;
const ladeFondsInvestorenzugaenge = (fondsId: string) =>
  auspacken(api.api.v1.fonds[":fondsId"].investorenzugaenge.$get({ param: { fondsId } }));

export const fondsInvestorenzugaenge = (fondsId: string) =>
  queryOptions({ queryKey: [...fondsInvestorSchluessel, fondsId], queryFn: () => ladeFondsInvestorenzugaenge(fondsId) });

const ladeZeichnungsOrganisationen = async () => {
  const daten: { id: string; name: string }[] = [];
  let cursor: string | undefined;
  do {
    const seite = await auspacken(api.api.v1.organisationen.$get({ query: { art: "investor", limit: "200", cursor } }));
    daten.push(...seite.daten.map(({ id, name }) => ({ id, name })));
    cursor = seite.naechsterCursor ?? undefined;
  } while (cursor);
  return daten;
};

export const zeichnungsOrganisationen = () =>
  queryOptions({ queryKey: [...schluessel.organisationListe, "zeichnungsorganisationen"], queryFn: ladeZeichnungsOrganisationen });

const zeichnungenApi = api.api.v1.fonds[":fondsId"].investorenzugaenge.zeichnungen;
type ZeichnungenEingabe = InferRequestType<typeof zeichnungenApi.$post>["json"];

export const useFondsZeichnungenAnlegen = (fondsId: string) =>
  useApiMutation({
    aufruf: (json: ZeichnungenEingabe) => auspacken(zeichnungenApi.$post({ param: { fondsId }, json })),
    invalidiert: () => [[...fondsInvestorSchluessel, fondsId]],
  });

const closingApi = api.api.v1.fonds[":fondsId"].investorenzugaenge.closings;
type ClosingEingabe = InferRequestType<typeof closingApi.$post>["json"];

export const useFondsClosingAnlegen = (fondsId: string) =>
  useApiMutation({
    aufruf: (json: ClosingEingabe) => auspacken(closingApi.$post({ param: { fondsId }, json })),
    invalidiert: () => [[...fondsInvestorSchluessel, fondsId]],
  });

const zusageAenderungApi = api.api.v1.fonds[":fondsId"].investorenzugaenge.zusageaenderungen;
type ZusageAenderungEingabe = InferRequestType<typeof zusageAenderungApi.$post>["json"];

/** Verringerung der Zusage oder Austritt eines Investors (Issue #132). */
export const useFondsZusageAendern = (fondsId: string) =>
  useApiMutation({
    aufruf: (json: ZusageAenderungEingabe) => auspacken(zusageAenderungApi.$post({ param: { fondsId }, json })),
    invalidiert: () => [[...fondsInvestorSchluessel, fondsId]],
  });

const closingKorrekturApi = closingApi[":closingId"].korrektur;
type ClosingKorrekturEingabe = InferRequestType<typeof closingKorrekturApi.$post>["json"];

/** Stornierung eines weiteren Closings (Issue #126): stellt den Stand vor dem Closing wieder her. */
export const useFondsClosingStornieren = (fondsId: string) =>
  useApiMutation({
    aufruf: ({ closingId, grund }: { closingId: string; grund: string }) => auspacken(closingApi[":closingId"].storno.$post({ param: { fondsId, closingId }, json: { grund } })),
    invalidiert: () => [[...fondsInvestorSchluessel, fondsId]],
  });

/** Korrektur: Storno des Closings und neues Closing in einem Schritt. */
export const useFondsClosingKorrigieren = (fondsId: string) =>
  useApiMutation({
    aufruf: ({ closingId, ...json }: { closingId: string } & ClosingKorrekturEingabe) => auspacken(closingKorrekturApi.$post({ param: { fondsId, closingId }, json })),
    invalidiert: () => [[...fondsInvestorSchluessel, fondsId]],
  });

export const fondsRollen = (fondsId: string) => queryOptions({ queryKey: [...verwaltung, "rollen", fondsId], queryFn: () => ladeRollen(fondsId) });
export const schluesselListe = () => queryOptions({ queryKey: [...verwaltung, "schluessel"], queryFn: ladeSchluessel });
export const periodensperre = (fondsId: string) => queryOptions({ queryKey: [...verwaltung, "sperre", fondsId], queryFn: () => ladeSperre(fondsId) });

export const useBenutzerAnlegen = () =>
  useApiMutation({
    aufruf: (json: NeuerBenutzer) => auspacken(api.api.v1.benutzer.$post({ json })),
    invalidiert: () => [[...verwaltung, "benutzer"]],
  });

export const useEinladungSenden = () =>
  useApiMutation({
    aufruf: ({ id, sprache }: { id: string; sprache: "de" | "en" }) => auspacken(api.api.v1.benutzer[":id"].einladung.$post({ param: { id }, json: { sprache } })),
    invalidiert: () => [[...verwaltung, "benutzer"]],
  });

export const useBenutzerAendern = () =>
  useApiMutation({
    aufruf: ({ id, json }: { id: string; json: { aktiv?: boolean; globalVerwalter?: boolean } }) => auspacken(api.api.v1.benutzer[":id"].$patch({ param: { id }, json })),
    invalidiert: () => [[...verwaltung, "benutzer"], [...verwaltung, "rollen"], schluessel.fonds],
  });

export const useRolleSetzen = (fondsId: string) =>
  useApiMutation({
    aufruf: ({ benutzerId, rolle }: { benutzerId: string; rolle: "betrachter" | "bearbeiter" | "freigeber" | "verwalter" }) =>
      auspacken(api.api.v1.fonds[":id"].rollen[":benutzerId"].$put({ param: { id: fondsId, benutzerId }, json: { rolle } })),
    invalidiert: () => [[...verwaltung, "rollen", fondsId], [...verwaltung, "benutzer"]],
  });

export const useRolleEntziehen = (fondsId: string) =>
  useApiMutation({
    aufruf: (benutzerId: string) => auspacken(api.api.v1.fonds[":id"].rollen[":benutzerId"].$delete({ param: { id: fondsId, benutzerId } })),
    invalidiert: () => [[...verwaltung, "rollen", fondsId], [...verwaltung, "benutzer"]],
  });

/**
 * Legt einen Schlüssel an. Bewusst keine Mutation: Deren Ergebnis bliebe im Cache von TanStack Query. Der Klartext
 * steht nur in der Antwort dieses einen Aufrufs; der Aufrufer hält ihn im eigenen Zustand und entwertet danach die Liste.
 */
export const legeSchluesselAn = (json: NeuerSchluessel) => auspacken(api.api.v1["api-schluessel"].$post({ json }));
export const schluesselListeEntwerten = (qc: QueryClient) => qc.invalidateQueries({ queryKey: [...verwaltung, "schluessel"] });

export const useSchluesselWiderrufen = () =>
  useApiMutation({
    aufruf: (id: string) => auspacken(api.api.v1["api-schluessel"][":id"].$delete({ param: { id } })),
    invalidiert: () => [[...verwaltung, "schluessel"]],
  });

export const useVariantenNachholen = () =>
  useApiMutation({
    aufruf: () => auspacken(api.api.v1.berichte["varianten-nachholen"].$post({ json: {} })),
    invalidiert: () => [["berichte"], ["portal"]],
  });

export const useSperreSetzen = (fondsId: string) =>
  useApiMutation({
    aufruf: (json: { gesperrtBis: string; grund?: string }) => auspacken(api.api.v1.fonds[":id"].periodensperre.$put({ param: { id: fondsId }, json })),
    invalidiert: () => [[...verwaltung, "sperre", fondsId]],
  });

// Rollen, Nutzergruppen und Fondszugriff (Rechtemodell, docs/rechte-modell.md) ------------------------------------------

const ladeRechteStand = () => auspacken(api.api.v1.rechte.$get());
export type RechteStand = Awaited<ReturnType<typeof ladeRechteStand>>;
export type RechteRolle = RechteStand["rollen"][number];
export type RechteGruppe = RechteStand["gruppen"][number];
export type RolleEingabe = InferRequestType<typeof api.api.v1.rechte.rollen.$post>["json"];
export type GruppeEingabe = InferRequestType<typeof api.api.v1.rechte.gruppen.$post>["json"];

const rechteSchluessel = [...verwaltung, "rechte"] as const;
export const rechteStand = () => queryOptions({ queryKey: rechteSchluessel, queryFn: ladeRechteStand });
// Gruppen ändern die wirksamen Rechte: auch die Benutzerliste und `/ich` (eigene Gruppe) neu laden.
const nachRechten = () => [rechteSchluessel, [...verwaltung, "benutzer"], ["ich"]];

export const useFondsOffenSetzen = () =>
  useApiMutation({ aufruf: (fondsOffen: boolean) => auspacken(api.api.v1.rechte.einstellung.$put({ json: { fondsOffen } })), invalidiert: nachRechten });

export const useRolleSpeichern = () =>
  useApiMutation({
    aufruf: ({ id, werte }: { id?: string; werte: RolleEingabe }) =>
      id ? auspacken(api.api.v1.rechte.rollen[":id"].$patch({ param: { id }, json: werte })) : auspacken(api.api.v1.rechte.rollen.$post({ json: werte })),
    invalidiert: nachRechten,
  });

export const useRechteRolleLoeschen = () =>
  useApiMutation({ aufruf: (id: string) => auspacken(api.api.v1.rechte.rollen[":id"].$delete({ param: { id } })), invalidiert: nachRechten });

export const useGruppeSpeichern = () =>
  useApiMutation({
    aufruf: ({ id, werte }: { id?: string; werte: GruppeEingabe }) =>
      id ? auspacken(api.api.v1.rechte.gruppen[":id"].$patch({ param: { id }, json: werte })) : auspacken(api.api.v1.rechte.gruppen.$post({ json: werte })),
    invalidiert: nachRechten,
  });

export const useGruppeLoeschen = () =>
  useApiMutation({ aufruf: (id: string) => auspacken(api.api.v1.rechte.gruppen[":id"].$delete({ param: { id } })), invalidiert: nachRechten });
