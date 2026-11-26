import { ausFonds, type FondsEingabe } from "./abbildung-fonds";
import { queryOptions } from "@tanstack/react-query";
import { schluessel } from "./abfragen-kern";
import { api } from "./client";
import { useApiMutation } from "./mutationen";

const fondsApi = api.api.v1.funds;
const fondsIdApi = fondsApi[":id"];

const ladeStammdaten = (id: string) => ausFonds(fondsIdApi.$get, { param: { id } });

export type FondsDaten = Awaited<ReturnType<typeof ladeStammdaten>>;
export type NeuerFonds = FondsEingabe<typeof fondsApi.$post>["json"];
export type FondsAenderung = FondsEingabe<typeof fondsIdApi.$patch>["json"];

export const fondsStammdaten = (id: string) =>
  queryOptions({ queryKey: [...schluessel.fonds, id, "stammdaten"], queryFn: () => ladeStammdaten(id) });

export const useFondsAnlegen = () =>
  useApiMutation({
    aufruf: (json: NeuerFonds) => ausFonds(fondsApi.$post, { json }),
    invalidiert: () => [schluessel.fonds],
  });

export const useFondsAendern = () =>
  useApiMutation({
    aufruf: ({ id, json }: { id: string; json: FondsAenderung }) => ausFonds(fondsIdApi.$patch, { param: { id }, json }),
    invalidiert: () => [schluessel.fonds],
  });
