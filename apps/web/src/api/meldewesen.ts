import { queryOptions } from "@tanstack/react-query";
import { api } from "./client";
import { useApiMutation } from "./mutationen";
import { ausBerichteBereich, type BerichteEingabe } from "./abbildung-berichte";

const ausMeldewesen = ausBerichteBereich("reporting");

/** Förder- und Meldeberichte: Definitionen, Förderprogramme, Aktivierung je Fonds und Meldeläufe. Alles unter einem Schlüsselpräfix. */
const wurzel = ["melde"] as const;

const ladeDefinitionen = async () => (await ausMeldewesen(api.api.v1["reporting-definitions"].$get)).daten;
const ladeVersionen = async (schluessel: string) => (await ausMeldewesen(api.api.v1["reporting-definitions"][":key"].$get, { param: { schluessel } })).daten;
const ladeVersion = (schluessel: string, version: number) => ausMeldewesen(api.api.v1["reporting-definitions"][":key"].versions[":version"].$get, { param: { schluessel, version: String(version) } });
const ladeProgramme = async () => (await ausMeldewesen(api.api.v1["funding-programs"].$get)).daten;
const ladeFondsDefinitionen = async (fondsId: string) => (await ausMeldewesen(api.api.v1.funds[":id"]["reporting-definitions"].$get, { param: { id: fondsId } })).daten;
const ladeLaeufe = async (fondsId: string) => (await ausMeldewesen(api.api.v1["reporting-runs"].$get, { query: { fondsId } })).daten;
const ladeLauf = (id: string) => ausMeldewesen(api.api.v1["reporting-runs"][":id"].$get, { param: { id } });
const ladeHerkunft = (id: string, schluessel: string) => ausMeldewesen(api.api.v1["reporting-runs"][":id"].provenance.$get, { param: { id }, query: { schluessel } });

export type MeldeDefinition = Awaited<ReturnType<typeof ladeDefinitionen>>[number];
export type MeldeVersionKopf = Awaited<ReturnType<typeof ladeVersionen>>[number];
export type MeldeVersion = Awaited<ReturnType<typeof ladeVersion>>;
export type Foerderprogramm = Awaited<ReturnType<typeof ladeProgramme>>[number];
export type FondsDefinition = Awaited<ReturnType<typeof ladeFondsDefinitionen>>[number];
export type MeldeLaufZeile = Awaited<ReturnType<typeof ladeLaeufe>>[number];
export type MeldeLauf = Awaited<ReturnType<typeof ladeLauf>>;
export type MeldeHerkunft = Awaited<ReturnType<typeof ladeHerkunft>>;
export type NeuerMeldeLauf = BerichteEingabe<"reporting", (typeof api.api.v1["reporting-runs"])["$post"]>["json"];

/** Fehler der Prüfung einer Definition (Pfad im JSON, stabiler Code, Meldung auf Deutsch, Parameter für die Übersetzung). */
export interface DefinitionsFehler {
  pfad: string;
  code: string;
  meldung: string;
  params?: Record<string, string | number>;
}
export interface DefinitionsKopf {
  bezeichnungDe: string;
  bezeichnungEn: string;
  herausgeber: string;
  rhythmus: "quartal" | "halbjahr" | "jahr" | "stichtag";
  format: "xlsx" | "csv" | "pdf" | "xml";
  gueltigAb?: string;
  definition: unknown;
}

export const meldeDefinitionen = () => queryOptions({ queryKey: [...wurzel, "definitionen"], queryFn: ladeDefinitionen });
export const meldeVersionen = (schluessel: string) => queryOptions({ queryKey: [...wurzel, "versionen", schluessel], queryFn: () => ladeVersionen(schluessel) });
export const meldeVersion = (schluessel: string, version: number) => queryOptions({ queryKey: [...wurzel, "version", schluessel, version], queryFn: () => ladeVersion(schluessel, version) });
export const foerderprogramme = () => queryOptions({ queryKey: [...wurzel, "programme"], queryFn: ladeProgramme });
export const fondsDefinitionen = (fondsId: string) => queryOptions({ queryKey: [...wurzel, "fonds", fondsId], queryFn: () => ladeFondsDefinitionen(fondsId) });
export const meldeLaeufe = (fondsId: string) => queryOptions({ queryKey: [...wurzel, "laeufe", fondsId], queryFn: () => ladeLaeufe(fondsId) });
export const meldeLauf = (id: string) => queryOptions({ queryKey: [...wurzel, "lauf", id], queryFn: () => ladeLauf(id) });
export const meldeHerkunft = (id: string, schluessel: string) => queryOptions({ queryKey: [...wurzel, "herkunft", id, schluessel], queryFn: () => ladeHerkunft(id, schluessel) });

const alles = () => [wurzel] as const;

/** Prüft eine Definition ohne zu speichern (Pfad und Meldung je Fehler). */
export async function pruefeDefinitionRemote(definition: unknown): Promise<{ ok: boolean; fehler: DefinitionsFehler[] }> {
  const a = await ausMeldewesen(api.api.v1["reporting-definitions"].validate.$post, { json: { definition } });
  return { ok: a.ok, fehler: a.probleme as DefinitionsFehler[] };
}

export const useDefinitionAnlegen = () =>
  useApiMutation({ aufruf: (json: DefinitionsKopf & { schluessel: string }) => ausMeldewesen(api.api.v1["reporting-definitions"].$post, { json }), invalidiert: alles });
export const useDefinitionVersion = () =>
  useApiMutation({ aufruf: ({ schluessel, json }: { schluessel: string; json: DefinitionsKopf }) => ausMeldewesen(api.api.v1["reporting-definitions"][":key"].versions.$post, { param: { schluessel }, json }), invalidiert: alles });
export const useProgrammAnlegen = () =>
  useApiMutation({ aufruf: (json: { schluessel: string; bezeichnung: string }) => ausMeldewesen(api.api.v1["funding-programs"].$post, { json }), invalidiert: alles });
export const useAktivierung = (fondsId: string) =>
  useApiMutation({
    aufruf: ({ schluessel, aktiv, foerderprogramm }: { schluessel: string; aktiv: boolean; foerderprogramm?: string | null }) =>
      ausMeldewesen(api.api.v1.funds[":id"]["reporting-definitions"][":key"].$put, { param: { id: fondsId, schluessel }, json: { aktiv, ...(foerderprogramm !== undefined ? { foerderprogramm } : {}) } }),
    invalidiert: alles,
  });
export const useLaufAnlegen = () => useApiMutation({ aufruf: (json: NeuerMeldeLauf) => ausMeldewesen(api.api.v1["reporting-runs"].$post, { json }), invalidiert: alles });
export const useMeldeEingabe = (id: string) =>
  useApiMutation({ aufruf: (json: { schluessel: string; wert: string | null }) => ausMeldewesen(api.api.v1["reporting-runs"][":id"].inputs.$put, { param: { id }, json }), invalidiert: alles });
export const useBefundKommentar = (id: string) =>
  useApiMutation({ aufruf: ({ regelId, text }: { regelId: string; text: string }) => ausMeldewesen(api.api.v1["reporting-runs"][":id"].findings[":ruleId"].comment.$put, { param: { id, regelId }, json: { text } }), invalidiert: alles });
export const useMeldeStufe = (id: string) =>
  useApiMutation({
    aufruf: (json: { stufe: string; ergebnis: "ok" | "zurueck"; kommentar?: string | null }) => ausMeldewesen(api.api.v1["reporting-runs"][":id"].stage.$post, { param: { id }, json }),
    invalidiert: alles,
  });

/** Datei eines Meldelaufs als normaler Link (Entwurf mit Kennzeichnung, freigegeben die gespeicherten Bytes). */
export const meldeDateiUrl = (id: string, art: "meldung" | "pruefansicht") => {
  const u = api.api.v1["reporting-runs"][":id"].file.$url({ param: { id }, query: { type: art === "meldung" ? "submission" : "review_view" } });
  return `${u.pathname}${u.search}`;
};
