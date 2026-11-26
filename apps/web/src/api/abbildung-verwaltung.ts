/** Abbildung der Verwaltung (Benutzer, Rechte, Schlüssel); getrennt von `abbildung.ts`, damit der Startumfang klein bleibt (siehe dort). */
import type { BereichName, Stufe } from "./abbildung";
import { VON_API, bereichVonApi, stufeVonApi, stufenJeBereichVonApi } from "./abbildung-ich";

const STUFE_AN_API: Record<Stufe, string> = { betrachter: "viewer", bearbeiter: "editor", freigeber: "approver", verwalter: "admin" };
const BEREICH_AN_API = Object.fromEntries(Object.entries(VON_API).filter(([en]) => !["viewer", "editor", "approver", "admin"].includes(en)).map(([en, de]) => [de, en])) as Record<BereichName, string>;
export const stufeAnApi = (s: Stufe) => STUFE_AN_API[s] as "viewer" | "editor" | "approver" | "admin";
export const bereichAnApi = (b: BereichName) => (BEREICH_AN_API[b] ?? b) as "portfolio" | "finance" | "metrics" | "reports" | "regulatory_reporting" | "dealflow" | "contacts" | "documents" | "data" | "fund_administration";

interface BenutzerApi {
  id: string;
  name: string;
  email: string;
  active: boolean;
  technicalUser: boolean;
  globalAdmin: boolean;
  twoFactorEnabled: boolean;
  passwordChangeRequired: boolean;
  invitationPending: boolean;
  roles: { fundId: string; role: string }[];
  groupIds: string[];
}

export const benutzerZeile = (b: BenutzerApi) => ({
  id: b.id,
  name: b.name,
  email: b.email,
  aktiv: b.active,
  technisch: b.technicalUser,
  globalVerwalter: b.globalAdmin,
  zweiFaktorAktiv: b.twoFactorEnabled,
  passwortAendern: b.passwordChangeRequired,
  einladungOffen: b.invitationPending,
  rollen: b.roles.map((r) => ({ fondsId: r.fundId, rolle: stufeVonApi(r.role) })),
  gruppen: b.groupIds,
});

export const rollenZeile = (r: { userId: string; name: string; email: string; active: boolean; role: string }) => ({
  benutzerId: r.userId,
  name: r.name,
  email: r.email,
  aktiv: r.active,
  rolle: stufeVonApi(r.role),
});

interface ApiSchluesselApi {
  id: string;
  name: string;
  userId: string;
  preview: string;
  scopes: { fundId: string; permission: "read" | "write" }[];
  expiresAt: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  status: "active" | "expired" | "revoked";
}

export const schluesselZeile = (z: ApiSchluesselApi) => ({
  id: z.id,
  name: z.name,
  benutzerId: z.userId,
  vorschau: z.preview,
  scopes: z.scopes.map((s) => ({ fondsId: s.fundId, recht: s.permission === "read" ? ("lesen" as const) : ("schreiben" as const) })),
  ablauf: z.expiresAt,
  erstelltAm: z.createdAt,
  zuletztGenutzt: z.lastUsedAt,
  widerrufenAm: z.revokedAt,
  status: ({ active: "aktiv", expired: "abgelaufen", revoked: "widerrufen" } as const)[z.status],
});

interface RolleApi {
  id: string;
  name: string;
  description: string | null;
  areas: string[];
  areaLevels: Record<string, string>;
  createdAt: string;
}
interface GruppeApi {
  id: string;
  name: string;
  description: string | null;
  level: string;
  fundsRestricted: boolean;
  areasPerFund: boolean;
  fundIds: string[];
  fundAreas: Record<string, string[]>;
  roleIds: string[];
  memberIds: string[];
  createdAt: string;
}

export const rechteStand = (r: { fundsOpen: boolean; areas: string[]; roles: RolleApi[]; groups: GruppeApi[] }) => ({
  fondsOffen: r.fundsOpen,
  bereiche: r.areas.map(bereichVonApi),
  rollen: r.roles.map((x) => ({
    id: x.id,
    name: x.name,
    beschreibung: x.description,
    bereiche: x.areas.map(bereichVonApi),
    bereichStufen: stufenJeBereichVonApi(x.areaLevels) ?? {},
    erstelltAm: x.createdAt,
  })),
  gruppen: r.groups.map((g) => ({
    id: g.id,
    name: g.name,
    beschreibung: g.description,
    stufe: stufeVonApi(g.level),
    fondsBeschraenkt: g.fundsRestricted,
    bereicheJeFonds: g.areasPerFund,
    fondsIds: g.fundIds,
    fondsBereiche: Object.fromEntries(Object.entries(g.fundAreas).map(([f, b]) => [f, b.map(bereichVonApi)])) as Record<string, BereichName[]>,
    rollenIds: g.roleIds,
    mitglieder: g.memberIds,
    erstelltAm: g.createdAt,
  })),
});

export interface RolleWerte {
  name?: string;
  beschreibung?: string | null;
  bereiche?: BereichName[];
  bereichStufen?: Partial<Record<BereichName, Stufe>>;
}
export interface GruppeWerte {
  name?: string;
  beschreibung?: string | null;
  stufe?: Stufe;
  fondsBeschraenkt?: boolean;
  bereicheJeFonds?: boolean;
  fondsIds?: string[];
  fondsBereiche?: Record<string, BereichName[]>;
  rollenIds?: string[];
  mitglieder?: string[];
}

const ohneUndefined = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

export const rolleAnApi = (w: RolleWerte) =>
  ohneUndefined({
    name: w.name,
    description: w.beschreibung,
    areas: w.bereiche?.map(bereichAnApi),
    areaLevels:
      w.bereichStufen === undefined
        ? undefined
        : (Object.fromEntries(Object.entries(w.bereichStufen).map(([b, s]) => [bereichAnApi(b as BereichName), stufeAnApi(s)])) as Partial<Record<ReturnType<typeof bereichAnApi>, ReturnType<typeof stufeAnApi>>>),
  });

export const gruppeAnApi = (w: GruppeWerte) =>
  ohneUndefined({
    name: w.name,
    description: w.beschreibung,
    level: w.stufe === undefined ? undefined : stufeAnApi(w.stufe),
    fundsRestricted: w.fondsBeschraenkt,
    areasPerFund: w.bereicheJeFonds,
    fundIds: w.fondsIds,
    fundAreas: w.fondsBereiche === undefined ? undefined : Object.fromEntries(Object.entries(w.fondsBereiche).map(([f, b]) => [f, b.map(bereichAnApi)])),
    roleIds: w.rollenIds,
    memberIds: w.mitglieder,
  });
