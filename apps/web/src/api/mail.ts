import { auspackenPortfolio } from "./abbildung-portfolio";
import { ausKontakten, type Deutsch } from "./abbildung-kontakte";
import { queryOptions } from "@tanstack/react-query";
import type { InferRequestType } from "hono/client";
import { api, auspacken } from "./client";
import { schluessel as grundschluessel } from "./abfragen";
import { useApiMutation } from "./mutationen";

/**
 * Mail und Kalender (Etappe 17): persönliche Einstellungen, Postfach- und Kalenderanbindung, Kalenderabonnement, nächste Termine und die
 * Verwaltung des Mailversands. Die Abfragen liegen unter eigenen Präfixen; Schreibvorgänge entwerten genau diese.
 */
export const mailSchluessel = {
  postfach: ["postfach"] as const,
  einstellungen: ["einstellungen"] as const,
  kalenderLink: ["einstellungen", "kalender-link"] as const,
  termine: ["termine"] as const,
  versand: ["mailversand"] as const,
};

const ladePostfach = () => ausKontakten(api.api.v1.mailbox.$get);
const ladeEinstellungen = async () => {
  const e = await auspacken(api.api.v1.settings.$get());
  return { sprache: e.language, mailBerichtFreigegeben: e.mailOnReportApproved, mailRegisterEreignis: e.mailOnRegisterEvent, mailVerfuegbar: e.mailAvailable };
};
const ladeKalenderLink = async () => {
  const l = await auspacken(api.api.v1.settings["calendar-link"].$get());
  return { aktiv: l.active, erstelltAm: l.createdAt, letzterZugriffAm: l.lastAccessAt };
};
const ladeVersandStatus = () => ausKontakten(api.api.v1.mail.status.$get);
const ladeAuftraege = async (status?: "wartend" | "gesendet" | "fehlgeschlagen") => (await ausKontakten(api.api.v1.mail.jobs.$get, { query: { ...(status ? { status } : {}), limit: "100" } })).daten;

export interface TermineFilter {
  organisationId?: string | undefined;
  personId?: string | undefined;
  dealId?: string | undefined;
  eigene?: boolean | undefined;
  limit?: number | undefined;
}
const ladeTermine = async (f: TermineFilter) =>
  (
    await ausKontakten(api.api.v1.meetings.$get, {
        query: {
          ...(f.organisationId ? { organisationId: f.organisationId } : {}),
          ...(f.personId ? { personId: f.personId } : {}),
          ...(f.dealId ? { dealId: f.dealId } : {}),
          eigene: f.eigene ? "true" : "false",
          limit: String(f.limit ?? 5),
        },
      })
  ).daten;

const ladeAnhaenge = async (id: string) => (await ausKontakten(api.api.v1.activities[":id"].attachments.$get, { param: { id } })).daten;

export type PostfachUebersicht = Awaited<ReturnType<typeof ladePostfach>>;
export type PostfachVerbindung = PostfachUebersicht["verbindungen"][number];
export type MailEinstellungen = Awaited<ReturnType<typeof ladeEinstellungen>>;
export type KalenderLinkStatus = Awaited<ReturnType<typeof ladeKalenderLink>>;
export type VersandStatus = Awaited<ReturnType<typeof ladeVersandStatus>>;
export type MailAuftrag = Awaited<ReturnType<typeof ladeAuftraege>>[number];
export type Termin = Awaited<ReturnType<typeof ladeTermine>>[number];
export type Anhang = Awaited<ReturnType<typeof ladeAnhaenge>>[number];
export type ImapEingabe = Deutsch<InferRequestType<(typeof api.api.v1.mailbox)["imap"]["$post"]>["json"]>;

export const postfachUebersicht = () => queryOptions({ queryKey: mailSchluessel.postfach, queryFn: ladePostfach, staleTime: 0 });
export const mailEinstellungen = () => queryOptions({ queryKey: mailSchluessel.einstellungen, queryFn: ladeEinstellungen });
export const kalenderLinkStatus = () => queryOptions({ queryKey: mailSchluessel.kalenderLink, queryFn: ladeKalenderLink, staleTime: 0 });
export const versandStatus = () => queryOptions({ queryKey: [...mailSchluessel.versand, "status"], queryFn: ladeVersandStatus, staleTime: 0 });
export const mailAuftraege = (status?: "wartend" | "gesendet" | "fehlgeschlagen") => queryOptions({ queryKey: [...mailSchluessel.versand, "auftraege", status ?? null], queryFn: () => ladeAuftraege(status), staleTime: 0 });
/** Kommende synchronisierte Termine, aufsteigend; ein Fehler (z. B. fehlende Rechte) lässt die Kachel einfach leer. */
export const naechsteTermine = (f: TermineFilter) =>
  queryOptions({ queryKey: [...mailSchluessel.termine, { o: f.organisationId ?? null, p: f.personId ?? null, d: f.dealId ?? null, e: f.eigene ?? false, l: f.limit ?? 5 }], queryFn: () => ladeTermine(f), retry: false });

/** Anhänge einer synchronisierten Mail, live beim Anbieter; nur auf ausdrücklichen Klick geladen (`aktiv`). */
export const mailAnhaenge = (id: string) => queryOptions({ queryKey: [...mailSchluessel.postfach, "anhaenge", id], queryFn: () => ladeAnhaenge(id), staleTime: 0, retry: false });

export const useAnhangImportieren = () =>
  useApiMutation({
    aufruf: ({ id, anhangId }: { id: string; anhangId: string }) =>
      ausKontakten(api.api.v1.activities[":id"].attachments[":attachmentId"].import.$post, { param: { id, anhangId } }),
    invalidiert: () => [["dokumente"]],
  });

export const useOAuthStart = () =>
  useApiMutation({
    aufruf: (e: { anbieter: "microsoft" | "google"; bereich: "mail" | "kalender" }) => ausKontakten(api.api.v1.mailbox.oauth.start.$post, { json: { ...e, zustimmung: true } }),
    invalidiert: () => [],
  });

export const useImapVerbinden = () =>
  useApiMutation({
    aufruf: (json: ImapEingabe) => ausKontakten(api.api.v1.mailbox.imap.$post, { json }),
    invalidiert: () => [mailSchluessel.postfach],
  });

export const usePostfachInhalt = () =>
  useApiMutation({
    aufruf: ({ id, inhaltSpeichern }: { id: string; inhaltSpeichern: boolean }) => ausKontakten(api.api.v1.mailbox[":id"].$patch, { param: { id }, json: { inhaltSpeichern } }),
    invalidiert: () => [mailSchluessel.postfach],
  });

export const usePostfachAbgleichen = () =>
  useApiMutation({
    aufruf: (id: string) => ausKontakten(api.api.v1.mailbox[":id"].sync.$post, { param: { id } }),
    invalidiert: () => [mailSchluessel.postfach],
  });

export const usePostfachTrennen = () =>
  useApiMutation({
    aufruf: (id: string) => ausKontakten(api.api.v1.mailbox[":id"].$delete, { param: { id } }),
    invalidiert: () => [mailSchluessel.postfach],
  });

export const useEinstellungenAendern = () =>
  useApiMutation({
    aufruf: (json: { sprache?: "de" | "en"; mailBerichtFreigegeben?: boolean; mailRegisterEreignis?: boolean }) =>
      auspacken(api.api.v1.settings.$put({ json: { ...(json.sprache ? { language: json.sprache } : {}), ...(json.mailBerichtFreigegeben === undefined ? {} : { mailOnReportApproved: json.mailBerichtFreigegeben }), ...(json.mailRegisterEreignis === undefined ? {} : { mailOnRegisterEvent: json.mailRegisterEreignis }) } })),
    invalidiert: () => [mailSchluessel.einstellungen],
  });

export interface KalenderLinkErgebnis {
  token: string;
  pfad: string;
  url: string;
}
export const useKalenderLinkErzeugen = () =>
  useApiMutation({
    aufruf: async (): Promise<KalenderLinkErgebnis> => {
      const l = await auspacken(api.api.v1.settings["calendar-link"].$post());
      return { token: l.token, pfad: l.path, url: l.url };
    },
    invalidiert: () => [mailSchluessel.kalenderLink],
  });

export const useKalenderLinkWiderrufen = () =>
  useApiMutation({
    aufruf: () => auspacken(api.api.v1.settings["calendar-link"].$delete()),
    invalidiert: () => [mailSchluessel.kalenderLink],
  });

export const useMailTest = () =>
  useApiMutation({
    aufruf: () => ausKontakten(api.api.v1.mail.test.$post),
    invalidiert: () => [mailSchluessel.versand],
  });

/** Entfernt eine synchronisierte Mail oder einen Termin (nur die eigene); der Abgleich holt sie nicht wieder. */
export const useSyncEntfernen = () =>
  useApiMutation({
    aufruf: (id: string) => ausKontakten(api.api.v1.activities[":id"]["remove-sync"].$post, { param: { id } }),
    invalidiert: () => [grundschluessel.aktivitaeten, mailSchluessel.termine],
  });

/** Link der Kennzahlen-Abfrage per Mail senden: erzeugt wie „Neuer Link“ einen neuen Link (der alte ist sofort ungültig). */
export const useAbfragePerMail = () =>
  useApiMutation({
    aufruf: async ({ id, personId }: { id: string; personId: string }) =>
      (await auspackenPortfolio(api.api.v1.metrics["metric-requests"][":id"]["send-email"].$post, { param: { id }, json: { personId } })) as { abfrage: { id: string }; link: { token: string; pfad: string; ablauf: string } },
    invalidiert: () => [["kennzahlen"], mailSchluessel.versand],
  });
