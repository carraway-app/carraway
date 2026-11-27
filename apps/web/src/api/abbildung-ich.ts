/** Abbildung von `/me` und der Namen der Stufen und Bereiche; wird nachgeladen, damit der Startumfang klein bleibt (siehe `abbildung.ts`). */
import type { BereichName, Stufe } from "./abbildung";

/** Namen der Schnittstelle (Stufen und Bereiche) als Namen der Oberfläche; `portfolio` und `dealflow` heißen gleich. */
export const VON_API: Record<string, string> = {
  viewer: "betrachter",
  editor: "bearbeiter",
  approver: "freigeber",
  admin: "verwalter",
  finance: "finanzen",
  metrics: "kennzahlen",
  reports: "berichte",
  regulatory_reporting: "meldewesen",
  contacts: "kontakte",
  documents: "dokumente",
  data: "daten",
  fund_administration: "fondsverwaltung",
  individual_grants: "einzelzuteilungen",
};
const von = (s: string) => VON_API[s] ?? s;
export const stufeVonApi = von as (s: string) => Stufe;
export const bereichVonApi = von as (s: string) => BereichName;

export const stufenJeBereichVonApi = (w: Record<string, string> | null) =>
  w && (Object.fromEntries(Object.entries(w).map(([b, s]) => [von(b), von(s)])) as Partial<Record<BereichName, Stufe>>);

interface MeApi {
  id: string;
  name: string;
  email: string;
  technicalUser: boolean;
  globalAdmin: boolean;
  twoFactorEnabled: boolean;
  passwordChangeRequired: boolean;
  twoFactorSetupRequired: boolean;
  roles: { fundId: string; role: string }[];
  areas: string[] | null;
  levelWithoutFund: string | null;
  areaLevelsPerFund: Record<string, Record<string, string>> | null;
  levelWithoutFundPerArea: Record<string, string> | null;
  investor: boolean;
}

/** `/me` als Person der Oberfläche. */
export function ich(m: MeApi) {
  return {
    id: m.id,
    name: m.name,
    email: m.email,
    technisch: m.technicalUser,
    globalVerwalter: m.globalAdmin,
    zweiFaktorAktiv: m.twoFactorEnabled,
    passwortAendern: m.passwordChangeRequired,
    zweiFaktorErforderlich: m.twoFactorSetupRequired,
    rollen: m.roles.map((r) => ({ fondsId: r.fundId, rolle: stufeVonApi(r.role) })),
    bereiche: m.areas && m.areas.map(bereichVonApi),
    stufeOhneFonds: m.levelWithoutFund && stufeVonApi(m.levelWithoutFund),
    bereicheJeFonds: m.areaLevelsPerFund && (Object.fromEntries(Object.entries(m.areaLevelsPerFund).map(([f, w]) => [f, stufenJeBereichVonApi(w)!])) as Record<string, Partial<Record<BereichName, Stufe>>>),
    stufeOhneFondsJeBereich: stufenJeBereichVonApi(m.levelWithoutFundPerArea),
    investor: m.investor,
  };
}
