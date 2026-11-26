import { queryOptions } from "@tanstack/react-query";
import type { InferRequestType } from "hono/client";
import { schluessel } from "./abfragen-kern";
import { api, auspacken } from "./client";
import { useApiMutation } from "./mutationen";

const fondsApi = api.api.v1.fonds;
const fondsIdApi = fondsApi[":id"];

const ladeStammdaten = (id: string) => auspacken(fondsIdApi.$get({ param: { id } }));

export type FondsDaten = Awaited<ReturnType<typeof ladeStammdaten>>;
export type NeuerFonds = InferRequestType<typeof fondsApi.$post>["json"];
export type FondsAenderung = InferRequestType<typeof fondsIdApi.$patch>["json"];

export const fondsStammdaten = (id: string) =>
  queryOptions({ queryKey: [...schluessel.fonds, id, "stammdaten"], queryFn: () => ladeStammdaten(id) });

export const useFondsAnlegen = () =>
  useApiMutation({
    aufruf: (json: NeuerFonds) => auspacken(fondsApi.$post({ json })),
    invalidiert: () => [schluessel.fonds],
  });

export const useFondsAendern = () =>
  useApiMutation({
    aufruf: ({ id, json }: { id: string; json: FondsAenderung }) => auspacken(fondsIdApi.$patch({ param: { id }, json })),
    invalidiert: () => [schluessel.fonds],
  });
