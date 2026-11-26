import { queryOptions, useQueryClient } from "@tanstack/react-query";
import { schluessel } from "./abfragen";
import { api, ApiFehler, auspacken } from "./client";
import { crmSchluessel } from "./crm";
import { useApiMutation } from "./mutationen";

const kartenfelderSchluessel = ["dealflow", "kartenfelder"] as const;

const ladeArbeitsliste = () => auspacken(api.api.v1.dealflow.arbeitsliste.$get());
export const dealArbeitsliste = () => queryOptions({ queryKey: schluessel.dealArbeitsliste, queryFn: ladeArbeitsliste });

export type Arbeitsdeal = Awaited<ReturnType<typeof ladeArbeitsliste>>["deals"][number];
export type Zuordnung = Pick<Arbeitsdeal, "investmentmanagerId" | "projektleiterId">;

export const dealZustaendige = (id: string) => queryOptions({
  queryKey: [...schluessel.deals, "zustaendige", id],
  queryFn: () => auspacken(api.api.v1.deals[":id"].zustaendige.$get({ param: { id } })),
});

export const dealKartenfelder = () => queryOptions({
  queryKey: kartenfelderSchluessel,
  queryFn: () => auspacken(api.api.v1.dealflow.kartenfelder.$get()),
});

export const useDealKartenfelderSpeichern = () => useApiMutation({
  aufruf: (felder: string[]) => auspacken(api.api.v1.dealflow.kartenfelder.$put({ json: { felder } })),
  invalidiert: () => [kartenfelderSchluessel],
});

export const istZuordnungskonflikt = (fehler: unknown) => fehler instanceof ApiFehler && fehler.code === "DEAL_ZUORDNUNG_KONFLIKT";

export function useDealZuordnen() {
  const qc = useQueryClient();
  return useApiMutation({
    aufruf: async ({ deal, ...aenderung }: { deal: Arbeitsdeal } & Partial<Zuordnung>) => {
      const json = {
        ...aenderung,
        erwartetInvestmentmanagerId: deal.investmentmanagerId,
        erwartetProjektleiterId: deal.projektleiterId,
      };
      try {
        return await auspacken(api.api.v1.deals[":id"].zuordnung.$patch({ param: { id: deal.id }, json }));
      } catch (fehler) {
        if (fehler instanceof ApiFehler && fehler.status === 409) {
          await qc.invalidateQueries({ queryKey: schluessel.dealArbeitsliste });
        }
        throw fehler;
      }
    },
    invalidiert: (_ergebnis, { deal }) => [
      schluessel.dealArbeitsliste, schluessel.dealDetail(deal.id), schluessel.dealListe, crmSchluessel.wurzel,
    ],
  });
}
