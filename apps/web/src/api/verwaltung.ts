import { ausFonds, type FondsEingabe } from "./abbildung-fonds";
import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { schluessel } from "./abfragen";
import { type Stufe } from "./abbildung";
import { benutzerZeile, stufeAnApi, gruppeAnApi, rechteStand as rechteStandAbbilden, rolleAnApi, rollenZeile, schluesselZeile, type GruppeWerte, type RolleWerte } from "./abbildung-verwaltung";
import { api, auspacken } from "./client";
import { useApiMutation } from "./mutationen";
import { ausBerichteBereich } from "./abbildung-berichte";

const ausDokumenten = ausBerichteBereich("document");
const ausBerichten = ausBerichteBereich("report");

/** Verwaltung (nur Verwalter): Benutzer, Rollen je Fonds, API-Schlüssel, Periodensperre. Alles unter einem Schlüsselpräfix, damit Schreibvorgänge genau diesen Teil entwerten. */
export const verwaltung = ["verwaltung"] as const;

const ladeBenutzer = async () => (await auspacken(api.api.v1.users.$get())).data.map(benutzerZeile);
const ladeRollen = async (fondsId: string) => (await auspacken(api.api.v1.funds[":id"].roles.$get({ param: { id: fondsId } }))).data.map(rollenZeile);
const ladeSchluessel = async () => (await auspacken(api.api.v1["api-keys"].$get())).data.map(schluesselZeile);
const ladeSperre = (fondsId: string) => ausFonds(api.api.v1.funds[":id"]["period-lock"].$get, { param: { id: fondsId } });


export type BenutzerZeile = Awaited<ReturnType<typeof ladeBenutzer>>[number];
export type RollenZeile = Awaited<ReturnType<typeof ladeRollen>>[number];
export type SchluesselZeile = Awaited<ReturnType<typeof ladeSchluessel>>[number];
export type Periodensperre = Awaited<ReturnType<typeof ladeSperre>>;
export interface NeuerBenutzer {
  name: string;
  email: string;
  passwort?: string | undefined;
  globalVerwalter?: boolean | undefined;
  sprache?: "de" | "en" | undefined;
}
export interface NeuerSchluessel {
  name: string;
  scopes: { fondsId: string; recht: "lesen" | "schreiben" }[];
  ablauf?: string | undefined;
}

const ladeAufbewahrung = () => ausDokumenten(api.api.v1.documents.retention.$get);
export type Aufbewahrung = Awaited<ReturnType<typeof ladeAufbewahrung>>;
export const aufbewahrungAnsicht = () => queryOptions({ queryKey: [...verwaltung, "aufbewahrung"], queryFn: ladeAufbewahrung });

const ladeBetrieb = async () => {
  const b = await auspacken(api.api.v1.operations.status.$get());
  const rueckstand = (r: { count: number; oldestSeconds: number } | null) => (r === null ? null : { anzahl: r.count, aeltesterSekunden: r.oldestSeconds });
  return {
    ampel: ({ ok: "ok", warning: "warnung", error: "fehler" } as const)[b.status],
    erzeugtAm: b.generatedAt,
    datenbank: { erreichbar: b.database.reachable },
    migrationen: { ok: b.migrations.ok, bekannt: b.migrations.known, angewendet: b.migrations.applied, meldung: b.migrations.message },
    worker: { status: ({ ok: "ok", down: "ausgefallen", unknown: "unbekannt" } as const)[b.worker.status], herzschlagAlterSekunden: b.worker.heartbeatAgeSeconds, grenzeSekunden: b.worker.thresholdSeconds },
    rueckstaende: {
      snapshots: rueckstand(b.backlogs.snapshots),
      mail: rueckstand(b.backlogs.mail),
      auslesung: rueckstand(b.backlogs.extraction),
      register: rueckstand(b.backlogs.register),
      warnungSekunden: b.backlogs.warningSeconds,
    },
    speicher: { beschreibbar: b.storage.writable },
    smtp: { konfiguriert: b.smtp.configured },
    erweiterungen: Object.fromEntries(Object.entries(b.extensions).map(([name, werte]) => [name, werte.provider === undefined ? werte : { ...werte, anbieter: werte.provider }])) as Record<string, Record<string, unknown>>,
  };
};
export type Betriebsstatus = Awaited<ReturnType<typeof ladeBetrieb>>;
/** Betriebsstatus (nur globale Verwalter); die Seite lädt ihn alle 30 Sekunden neu. */
export const betriebsstatus = () => queryOptions({ queryKey: [...verwaltung, "betrieb"], queryFn: ladeBetrieb, refetchInterval: 30_000 });

export const benutzerListe = () => queryOptions({ queryKey: [...verwaltung, "benutzer"], queryFn: ladeBenutzer });
/** Schlüssel der Zeichnungen und Closings eines Fonds; die Erweiterung LP-Portal hängt ihre Zugänge darunter. */
export const fondsInvestorSchluessel = [...schluessel.fonds, "investorenzugaenge"] as const;
const ladeFondsInvestorenzugaenge = (fondsId: string) =>
  ausFonds(api.api.v1.funds[":fundId"]["investor-access"].$get, { param: { fondsId } });

export const fondsInvestorenzugaenge = (fondsId: string) =>
  queryOptions({ queryKey: [...fondsInvestorSchluessel, fondsId], queryFn: () => ladeFondsInvestorenzugaenge(fondsId) });

const zeichnungenApi = api.api.v1.funds[":fundId"]["investor-access"].subscriptions;
type ZeichnungenEingabe = FondsEingabe<typeof zeichnungenApi.$post>["json"];

export const useFondsZeichnungenAnlegen = (fondsId: string) =>
  useApiMutation({
    aufruf: (json: ZeichnungenEingabe) => ausFonds(zeichnungenApi.$post, { param: { fondsId }, json }),
    invalidiert: () => [schluessel.fonds], // Liste (Abdeckung) und Zeichnungen des Fonds
  });

/** Ändert eine Zusage der Ersterfassung (Issue #275). */
export const useFondsZusageBearbeiten = (fondsId: string) =>
  useApiMutation({
    aufruf: ({ organisationId, zusage }: { organisationId: string; zusage: string }) =>
      ausFonds(zeichnungenApi[":organizationId"].$patch, { param: { fondsId, organisationId }, json: { zusage } }),
    invalidiert: () => [schluessel.fonds], // Liste (Abdeckung) und Zeichnungen des Fonds
  });

/** Entfernt eine Zusage der Ersterfassung (Issue #275). */
export const useFondsZusageEntfernen = (fondsId: string) =>
  useApiMutation({
    aufruf: (organisationId: string) => ausFonds(zeichnungenApi[":organizationId"].$delete, { param: { fondsId, organisationId } }),
    invalidiert: () => [schluessel.fonds], // Liste (Abdeckung) und Zeichnungen des Fonds
  });

const closingApi = api.api.v1.funds[":fundId"]["investor-access"].closings;
type ClosingEingabe = FondsEingabe<typeof closingApi.$post>["json"];

export const useFondsClosingAnlegen = (fondsId: string) =>
  useApiMutation({
    aufruf: (json: ClosingEingabe) => ausFonds(closingApi.$post, { param: { fondsId }, json }),
    invalidiert: () => [[...fondsInvestorSchluessel, fondsId]],
  });

const zusageAenderungApi = api.api.v1.funds[":fundId"]["investor-access"]["commitment-changes"];
type ZusageAenderungEingabe = FondsEingabe<typeof zusageAenderungApi.$post>["json"];

/** Verringerung der Zusage oder Austritt eines Investors (Issue #132). */
export const useFondsZusageAendern = (fondsId: string) =>
  useApiMutation({
    aufruf: (json: ZusageAenderungEingabe) => ausFonds(zusageAenderungApi.$post, { param: { fondsId }, json }),
    invalidiert: () => [[...fondsInvestorSchluessel, fondsId]],
  });

const closingKorrekturApi = closingApi[":closingId"].correct;
type ClosingKorrekturEingabe = FondsEingabe<typeof closingKorrekturApi.$post>["json"];

/** Stornierung eines weiteren Closings (Issue #126): stellt den Stand vor dem Closing wieder her. */
export const useFondsClosingStornieren = (fondsId: string) =>
  useApiMutation({
    aufruf: ({ closingId, grund }: { closingId: string; grund: string }) => ausFonds(closingApi[":closingId"].reverse.$post, { param: { fondsId, closingId }, json: { grund } }),
    invalidiert: () => [[...fondsInvestorSchluessel, fondsId]],
  });

/** Korrektur: Storno des Closings und neues Closing in einem Schritt. */
export const useFondsClosingKorrigieren = (fondsId: string) =>
  useApiMutation({
    aufruf: ({ closingId, ...json }: { closingId: string } & ClosingKorrekturEingabe) => ausFonds(closingKorrekturApi.$post, { param: { fondsId, closingId }, json }),
    invalidiert: () => [[...fondsInvestorSchluessel, fondsId]],
  });

export const fondsRollen = (fondsId: string) => queryOptions({ queryKey: [...verwaltung, "rollen", fondsId], queryFn: () => ladeRollen(fondsId) });
export const schluesselListe = () => queryOptions({ queryKey: [...verwaltung, "schluessel"], queryFn: ladeSchluessel });
export const periodensperre = (fondsId: string) => queryOptions({ queryKey: [...verwaltung, "sperre", fondsId], queryFn: () => ladeSperre(fondsId) });

export const useBenutzerAnlegen = () =>
  useApiMutation({
    aufruf: (json: NeuerBenutzer) =>
      auspacken(
        api.api.v1.users.$post({
          json: { name: json.name, email: json.email, ...(json.passwort === undefined ? {} : { password: json.passwort }), ...(json.globalVerwalter === undefined ? {} : { globalAdmin: json.globalVerwalter }), ...(json.sprache === undefined ? {} : { language: json.sprache }) },
        }),
      ),
    invalidiert: () => [[...verwaltung, "benutzer"]],
  });

export const useEinladungSenden = () =>
  useApiMutation({
    aufruf: ({ id, sprache }: { id: string; sprache: "de" | "en" }) => auspacken(api.api.v1.users[":id"].invitation.$post({ param: { id }, json: { language: sprache } })),
    invalidiert: () => [[...verwaltung, "benutzer"]],
  });

export const useBenutzerAendern = () =>
  useApiMutation({
    aufruf: ({ id, json }: { id: string; json: { aktiv?: boolean; globalVerwalter?: boolean } }) =>
      auspacken(api.api.v1.users[":id"].$patch({ param: { id }, json: { ...(json.aktiv === undefined ? {} : { active: json.aktiv }), ...(json.globalVerwalter === undefined ? {} : { globalAdmin: json.globalVerwalter }) } })),
    invalidiert: () => [[...verwaltung, "benutzer"], [...verwaltung, "rollen"], schluessel.fonds],
  });

export const useRolleSetzen = (fondsId: string) =>
  useApiMutation({
    aufruf: ({ benutzerId, rolle }: { benutzerId: string; rolle: Stufe }) =>
      auspacken(api.api.v1.funds[":id"].roles[":userId"].$put({ param: { id: fondsId, userId: benutzerId }, json: { role: stufeAnApi(rolle) } })),
    invalidiert: () => [[...verwaltung, "rollen", fondsId], [...verwaltung, "benutzer"]],
  });

export const useRolleEntziehen = (fondsId: string) =>
  useApiMutation({
    aufruf: (benutzerId: string) => auspacken(api.api.v1.funds[":id"].roles[":userId"].$delete({ param: { id: fondsId, userId: benutzerId } })),
    invalidiert: () => [[...verwaltung, "rollen", fondsId], [...verwaltung, "benutzer"]],
  });

/**
 * Legt einen Schlüssel an. Bewusst keine Mutation: Deren Ergebnis bliebe im Cache von TanStack Query. Der Klartext
 * steht nur in der Antwort dieses einen Aufrufs; der Aufrufer hält ihn im eigenen Zustand und entwertet danach die Liste.
 */
export const legeSchluesselAn = async (json: NeuerSchluessel) => {
  const a = await auspacken(
    api.api.v1["api-keys"].$post({
      json: { name: json.name, scopes: json.scopes.map((s) => ({ fundId: s.fondsId, permission: s.recht === "lesen" ? ("read" as const) : ("write" as const) })), ...(json.ablauf === undefined ? {} : { expiresAt: json.ablauf }) },
    }),
  );
  return { ...schluesselZeile(a), schluessel: a.key };
};
export const schluesselListeEntwerten = (qc: QueryClient) => qc.invalidateQueries({ queryKey: [...verwaltung, "schluessel"] });

export const useSchluesselWiderrufen = () =>
  useApiMutation({
    aufruf: (id: string) => auspacken(api.api.v1["api-keys"][":id"].$delete({ param: { id } })),
    invalidiert: () => [[...verwaltung, "schluessel"]],
  });

export const useVariantenNachholen = () =>
  useApiMutation({
    aufruf: () => ausBerichten(api.api.v1.reports["backfill-variants"].$post, { json: {} }),
    invalidiert: () => [["berichte"], ["portal"]],
  });

export const useSperreSetzen = (fondsId: string) =>
  useApiMutation({
    aufruf: (json: { gesperrtBis: string; grund?: string }) => ausFonds(api.api.v1.funds[":id"]["period-lock"].$put, { param: { id: fondsId }, json }),
    invalidiert: () => [[...verwaltung, "sperre", fondsId]],
  });

// Rollen, Nutzergruppen und Fondszugriff (Rechtemodell, docs/permissions-model.md) ------------------------------------------

const ladeRechteStand = async () => rechteStandAbbilden(await auspacken(api.api.v1.permissions.$get()));
export type RechteStand = Awaited<ReturnType<typeof ladeRechteStand>>;
export type RechteRolle = RechteStand["rollen"][number];
export type RechteGruppe = RechteStand["gruppen"][number];
export type RolleEingabe = RolleWerte;
export type GruppeEingabe = GruppeWerte;

const rechteSchluessel = [...verwaltung, "rechte"] as const;
export const rechteStand = () => queryOptions({ queryKey: rechteSchluessel, queryFn: ladeRechteStand });
// Gruppen ändern die wirksamen Rechte: auch die Benutzerliste und `/ich` (eigene Gruppe) neu laden.
const nachRechten = () => [rechteSchluessel, [...verwaltung, "benutzer"], ["ich"]];

export const useFondsOffenSetzen = () =>
  useApiMutation({ aufruf: (fondsOffen: boolean) => auspacken(api.api.v1.permissions.settings.$put({ json: { fundsOpen: fondsOffen } })), invalidiert: nachRechten });

export const useRolleSpeichern = () =>
  useApiMutation({
    aufruf: ({ id, werte }: { id?: string; werte: RolleEingabe }) =>
      id ? auspacken(api.api.v1.permissions.roles[":id"].$patch({ param: { id }, json: rolleAnApi(werte) })) : auspacken(api.api.v1.permissions.roles.$post({ json: { ...rolleAnApi(werte), areas: rolleAnApi(werte).areas ?? [], name: werte.name ?? "" } })),
    invalidiert: nachRechten,
  });

export const useRechteRolleLoeschen = () =>
  useApiMutation({ aufruf: (id: string) => auspacken(api.api.v1.permissions.roles[":id"].$delete({ param: { id } })), invalidiert: nachRechten });

export const useGruppeSpeichern = () =>
  useApiMutation({
    aufruf: ({ id, werte }: { id?: string; werte: GruppeEingabe }) =>
      id ? auspacken(api.api.v1.permissions.groups[":id"].$patch({ param: { id }, json: gruppeAnApi(werte) })) : auspacken(api.api.v1.permissions.groups.$post({ json: { ...gruppeAnApi(werte), name: werte.name ?? "" } })),
    invalidiert: nachRechten,
  });

export const useGruppeLoeschen = () =>
  useApiMutation({ aufruf: (id: string) => auspacken(api.api.v1.permissions.groups[":id"].$delete({ param: { id } })), invalidiert: nachRechten });
