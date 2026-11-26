import { ausKontakten } from "./abbildung-kontakte";
import { queryOptions } from "@tanstack/react-query";
import { api } from "./client";
import { schluessel } from "./abfragen";
import { useApiMutation } from "./mutationen";

/**
 * Kontakte aus Postfach und Kalender: eigene Teilnahme und Sperrliste, Einstellung der Installation (Verwaltung) und die Liste „Neue Kontakte aus Postfach und
 * Kalender“ mit Übernehmen, Zusammenführen und Verwerfen.
 */
export const kontaktvorschlagSchluessel = {
  liste: ["kontaktvorschlaege"] as const,
  einstellung: ["kontaktvorschlaege", "einstellung"] as const,
  teilnahme: ["postfach", "kontakte"] as const,
};

const ladeListe = () => ausKontakten(api.api.v1["contact-suggestions"].$get);
const ladeEinstellung = () => ausKontakten(api.api.v1["contact-suggestions"].settings.$get);
const ladeTeilnahme = () => ausKontakten(api.api.v1.mailbox.contacts.$get);

export type KontaktvorschlagListe = Awaited<ReturnType<typeof ladeListe>>;
export type Kontaktvorschlag = KontaktvorschlagListe["daten"][number];
export type KontaktabgleichEinstellung = Awaited<ReturnType<typeof ladeEinstellung>>;
export type KontaktabgleichTeilnahme = Awaited<ReturnType<typeof ladeTeilnahme>>;

/** Vorschläge aus dem eigenen Postfach und Kalender; ein Fehler (z. B. fehlende Rechte) lässt den Hinweis einfach weg. */
export const kontaktvorschlaege = () => queryOptions({ queryKey: kontaktvorschlagSchluessel.liste, queryFn: ladeListe, staleTime: 0, retry: false });
export const kontaktabgleichEinstellung = () => queryOptions({ queryKey: kontaktvorschlagSchluessel.einstellung, queryFn: ladeEinstellung, staleTime: 0 });
export const kontaktabgleichTeilnahme = () => queryOptions({ queryKey: kontaktvorschlagSchluessel.teilnahme, queryFn: ladeTeilnahme, staleTime: 0 });

export const useKontaktabgleichEinstellen = () =>
  useApiMutation({
    aufruf: (json: { modus: "aus" | "vorschlag" | "direkt"; eigeneDomains: string[]; sperrliste: string[] }) => ausKontakten(api.api.v1["contact-suggestions"].settings.$put, { json }),
    invalidiert: () => [kontaktvorschlagSchluessel.liste, kontaktvorschlagSchluessel.teilnahme],
  });

export const useKontaktabgleichTeilnehmen = () =>
  useApiMutation({
    aufruf: (json: { teilnehmen: boolean; sperrliste: string[] }) => ausKontakten(api.api.v1.mailbox.contacts.$put, { json }),
    invalidiert: () => [kontaktvorschlagSchluessel.teilnahme, kontaktvorschlagSchluessel.liste],
  });

const nachEntscheidung = () => [kontaktvorschlagSchluessel.liste, schluessel.personen, schluessel.organisationen, ["crm"]] as const;

export const useVorschlagUebernehmen = () =>
  useApiMutation({
    aufruf: (id: string) => ausKontakten(api.api.v1["contact-suggestions"][":id"].accept.$post, { param: { id } }),
    invalidiert: nachEntscheidung,
  });

export const useVorschlagZusammenfuehren = () =>
  useApiMutation({
    aufruf: ({ id, personId }: { id: string; personId: string }) => ausKontakten(api.api.v1["contact-suggestions"][":id"].merge.$post, { param: { id }, json: { personId } }),
    invalidiert: nachEntscheidung,
  });

export const useVorschlagVerwerfen = () =>
  useApiMutation({
    aufruf: (id: string) => ausKontakten(api.api.v1["contact-suggestions"][":id"].dismiss.$post, { param: { id } }),
    invalidiert: () => [kontaktvorschlagSchluessel.liste],
  });

/** Zeilen einer Textliste (eine Adresse oder Domain je Zeile, auch durch Komma oder Semikolon getrennt). */
export const zeilen = (text: string) => text.split(/[\n,;]+/).map((z) => z.trim()).filter(Boolean);
