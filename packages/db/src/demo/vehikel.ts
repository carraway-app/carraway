import { createHash } from "node:crypto";
import type * as s from "../schema";
import { abgeleiteteId } from "./zufall";

export type DemoVehikel = typeof s.vehikel.$inferInsert & { id: string };

/** Vehikel je Investor in der Reihenfolge der Investoren: ein bis drei, damit Auswahl und Gruppierung etwas zu zeigen haben. */
const ANZAHL = [3, 2, 1, 2, 1] as const;
const NAMEN = ["Fonds I", "Wachstumsfonds II", "Opportunity SPV"] as const;
const ARTEN = ["fonds", "fonds", "spv"] as const;

/**
 * Erfundene Vehikel der Demo-Investoren (docs/portfolio-model.md, „Co-investor vehicles“). Ids und Werte sind aus dem Investor abgeleitet
 * und verbrauchen keine Zufallszahlen, damit alle übrigen Demo-Daten unverändert bleiben. Das erste Vehikel jedes Investors ist Standard.
 */
export function erzeugeVehikel(investoren: readonly { id: string; name: string }[]): DemoVehikel[] {
  return investoren.flatMap((inv, i) =>
    Array.from({ length: ANZAHL[i % ANZAHL.length] as number }, (_, k) => ({
      id: abgeleiteteId(inv.id, `vehikel-${k}`),
      investorId: inv.id,
      name: `${inv.name} ${NAMEN[k] as string}`,
      art: ARTEN[k] as (typeof ARTEN)[number],
      auflagejahr: 2014 + i + 3 * k,
      standard: k === 0,
    })),
  );
}

/** Vehikel eines Investors für eine Position: fest aus dem Schlüssel gewählt (gleiche Eingabe, gleiches Vehikel), ohne Zufallszahlen. */
export function vehikelFuer(vehikel: readonly DemoVehikel[], investorId: string, schluessel: string): string {
  const eigene = vehikel.filter((v) => v.investorId === investorId);
  if (eigene.length === 0) throw new Error(`Demo: Investor ${investorId} hat kein Vehikel`);
  const zahl = Number.parseInt(createHash("sha1").update(schluessel).digest("hex").slice(0, 8), 16);
  return (eigene[zahl % eigene.length] as DemoVehikel).id;
}
