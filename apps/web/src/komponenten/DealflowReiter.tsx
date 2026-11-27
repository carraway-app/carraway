import type { ReactNode } from "react";
import { useRouter } from "@tanstack/react-router";
import { ChartLineUpIcon, FileTextIcon, KanbanIcon, Tabs, TrayIcon, UserCircleIcon } from "@carraway/ui";
import { useT } from "../i18n";

export type DealflowSicht = "pipeline" | "meine" | "eingang" | "beschluesse" | "auswertung";

/**
 * Reiter des Dealflows: Pipeline, Meine Deals, Ohne Zuordnung, Beschlussvorlagen und Auswertung sind Sichten desselben Bereichs, jede mit eigener
 * Adresse. „Meine Deals“ gibt es nur hier (kein zweiter Umschalter). Die Reiterleiste bleibt unter dem Kopf stehen.
 */
export function DealflowReiter({ aktiv, ohneZuordnung, children }: { aktiv: DealflowSicht; ohneZuordnung?: number | undefined; children: ReactNode }) {
  const t = useT();
  const router = useRouter();
  const wechsle = (id: string) => {
    if (id === "beschluesse") void router.navigate({ to: "/decision-proposals", search: {} });
    else if (id === "auswertung") void router.navigate({ to: "/dealflow/analytics", search: {} });
    else void router.navigate({ to: "/dealflow", search: id === "pipeline" ? {} : { bereich: id as "eingang" | "meine" } });
  };
  return (
    <Tabs
      fest
      aria-label={t.dealflow.navigation}
      aktiv={aktiv}
      onWechsel={wechsle}
      tabs={[
        { id: "pipeline", label: t.dealflow.pipeline, icon: KanbanIcon },
        { id: "meine", label: t.dealflow.meineDeals, icon: UserCircleIcon },
        { id: "eingang", label: t.dealflow.eingang, icon: TrayIcon, ...(ohneZuordnung !== undefined ? { zaehler: ohneZuordnung, zaehlerLabel: t.dealflow.etikett(ohneZuordnung) } : {}) },
        { id: "beschluesse", label: t.beschlussvorlagen.titel, icon: FileTextIcon },
        { id: "auswertung", label: t.dealflow.auswertung, icon: ChartLineUpIcon },
      ]}
    >
      {children}
    </Tabs>
  );
}
