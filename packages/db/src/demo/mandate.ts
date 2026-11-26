import type * as s from "../schema";
import type { Demodaten } from "./erzeuge";
import { abgeleiteteId, plusTage } from "./zufall";

export type DemoMandat = typeof s.gremienmandat.$inferInsert & { id: string };
export type DemoPerson = Demodaten["personen"][number];

/** Erfundene Personen, die für die Fonds Gremiensitze wahrnehmen (ohne Unternehmen). */
const VERTRETER = [
  ["Lena", "Berger", "Investment Managerin"],
  ["Jonas", "Albrecht", "Partner"],
  ["Mira", "Hoffmann", "Investment Manager"],
] as const;
const GREMIEN = ["beirat", "aufsichtsrat", "board", "beirat"] as const;
const ROLLEN = ["vorsitz", "mitglied", "stellvertretender_vorsitz", "beobachter"] as const;

/**
 * Gremienmandate der Demo (Issue #156): je Fonds bis zu vier Beteiligungen mit Eigenkapital, je ein Mandat einer der erfundenen Personen.
 * Ids und Werte sind abgeleitet und verbrauchen keine Zufallszahlen, damit alle übrigen Demo-Daten unverändert bleiben. Bei ausgeschiedenen
 * Beteiligungen endet das Mandat zwei Jahre nach dem Erstinvestment, ein Beobachtersitz nach einem Jahr.
 */
export function erzeugeMandate(d: Pick<Demodaten, "fonds" | "beteiligungen">): { personen: DemoPerson[]; mandate: DemoMandat[] } {
  const personen: DemoPerson[] = VERTRETER.map(([vorname, nachname, funktion]) => ({
    id: abgeleiteteId("demo-gremien", `${vorname}-${nachname}`),
    vorname,
    nachname,
    funktion,
    email: `${vorname.toLowerCase()}.${nachname.toLowerCase()}@fonds.example`,
  }));
  const mandate: DemoMandat[] = [];
  d.fonds.forEach((f, fi) => {
    const auswahl = d.beteiligungen
      .filter((b) => b.fondsId === f.id && b.instrument === "offene_beteiligung")
      .sort((a, b) => a.id.localeCompare(b.id))
      .slice(0, 4);
    auswahl.forEach((b, i) => {
      const beginn = b.erstinvestment;
      mandate.push({
        id: abgeleiteteId(b.id, "gremienmandat"),
        beteiligungId: b.id,
        gremium: GREMIEN[i % GREMIEN.length]!,
        gremiumName: i === 0 ? "Investorenbeirat" : null,
        personId: personen[(fi + i) % personen.length]!.id,
        rolle: ROLLEN[i % ROLLEN.length]!,
        beginn,
        // Ausgeschiedene Beteiligungen und der Beobachtersitz (vierte Beteiligung) enden; so zeigt die Liste auch beendete Mandate.
        ende: (b.status && b.status !== "aktiv") || i === 3 ? plusTage(beginn, i === 3 ? 365 : 730) : null,
      });
    });
  });
  return { personen, mandate };
}
