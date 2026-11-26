import { queryOptions } from "@tanstack/react-query";
import { api, auspacken } from "./client";

/**
 * Abfragen, die die Hülle der Anwendung schon beim Start braucht (Fondsliste, Übersicht, Zähler der Wiedervorlagen). Alles übrige steht in
 * `abfragen.ts` und lädt mit der Seite, die es braucht; `abfragen.ts` führt diese Namen wieder zusammen, damit Seiten von einer Stelle importieren.
 */

/** Frische der Daten im Cache: Seitenwechsel innerhalb dieser Zeit laufen ohne Anfrage. */
export const STALE_ZEIT = 60_000;

export const ladeFonds = async () => (await auspacken(api.api.v1.fonds.$get())).daten;
export const ladeUebersicht = (fondsId: string, stichtag?: string, stand?: string) =>
  auspacken(api.api.v1.fonds[":id"].uebersicht.$get({ param: { id: fondsId }, query: { ...(stichtag ? { stichtag } : {}), ...(stand ? { stand } : {}) } }));
export const ladeWiedervorlagenAnzahl = () => auspacken(api.api.v1.wiedervorlagen.anzahl.$get());

/**
 * Schlüssel der Abfragen. Die Hierarchie ist Absicht: Schreibvorgänge entwerten genau die Präfixe,
 * die sie betreffen (siehe `mutationen.ts`).
 */
export const schluessel = {
  fonds: ["fonds"] as const,
  beteiligungen: ["beteiligungen"] as const,
  deals: ["deals"] as const,
  dealListe: ["deals", "liste"] as const,
  dealArbeitsliste: ["dealflow", "arbeitsliste"] as const,
  dealDetail: (id: string) => ["deals", "detail", id] as const,
  organisationen: ["organisationen"] as const,
  organisationListe: ["organisationen", "liste"] as const,
  organisationDetail: (id: string) => ["organisationen", "detail", id] as const,
  aktivitaeten: ["aktivitaeten"] as const,
  wiedervorlagen: ["wiedervorlagen"] as const,
  personen: ["personen"] as const,
  beschlussvorlagen: ["beschlussvorlagen"] as const,
  trichter: ["dealflow", "trichter"] as const,
  zinslaeufe: ["zinslaeufe"] as const,
  zinslaufDetail: (id: string) => ["zinslaeufe", "detail", id] as const,
  bewertungen: ["bewertungen"] as const,
  runden: ["runden"] as const,
  berichte: ["berichte"] as const,
  bewegungen: ["bewegungen"] as const,
  vorlagen: ["vorlagen"] as const,
};

export const fondsListe = () => queryOptions({ queryKey: schluessel.fonds, queryFn: ladeFonds });
/** `stand` ist der Wissensstand (ISO-Zeitstempel); ohne ihn gilt der aktuelle Stand und die Übersicht kommt aus dem Snapshot. */
export const fondsUebersicht = (fondsId: string, stichtag?: string, stand?: string) =>
  queryOptions({ queryKey: [...schluessel.fonds, fondsId, "uebersicht", stichtag ?? null, stand ?? null], queryFn: () => ladeUebersicht(fondsId, stichtag, stand) });
/** Zähler der Kopfzeile: fällige und überfällige Wiedervorlagen der angemeldeten Person; alle Minute neu. */
export const wiedervorlagenAnzahl = () => queryOptions({ queryKey: [...schluessel.wiedervorlagen, "anzahl"], queryFn: ladeWiedervorlagenAnzahl, refetchInterval: 60_000 });
