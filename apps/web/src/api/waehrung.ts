import { queryOptions } from "@tanstack/react-query";
import type { InferRequestType } from "hono/client";
import { api, auspacken } from "./client";
import { useApiMutation } from "./mutationen";

/** Währungen (Etappe 21): Währungssicht auf Beteiligung und Fonds, Kurstabelle, Kursimport und lokale Währung. Gerechnet wird nur auf dem Server. */

const wurzel = ["waehrung"] as const;

export type SichtAbfrage = { stichtag?: string | undefined; stand?: string | undefined; vergleich?: string | undefined };

const bereinigt = (q: SichtAbfrage) => ({ ...(q.stichtag ? { stichtag: q.stichtag } : {}), ...(q.stand ? { stand: q.stand } : {}), ...(q.vergleich ? { vergleich: q.vergleich } : {}) });

const ladeBeteiligungSicht = (id: string, q: SichtAbfrage) => auspacken(api.api.v1.beteiligungen[":id"].waehrungssicht.$get({ param: { id }, query: bereinigt(q) }));
const ladeFondsSicht = (id: string, q: SichtAbfrage) => auspacken(api.api.v1.fonds[":id"].waehrungssicht.$get({ param: { id }, query: bereinigt(q) }));
const ladeWaehrungen = async () => (await auspacken(api.api.v1.wechselkurse.waehrungen.$get())).daten;
const ladeKurse = async (q: KursFilter): Promise<Kurs[]> => (await auspacken(api.api.v1.wechselkurse.$get({ query: { ...(q.basis ? { basis: q.basis } : {}), ...(q.quote ? { quote: q.quote } : {}), alle: q.alle ? "1" : "0", limit: String(q.limit ?? 200) } }))).daten as unknown as Kurs[];

export type Beteiligungssicht = Awaited<ReturnType<typeof ladeBeteiligungSicht>>;
export type Fondssicht = Awaited<ReturnType<typeof ladeFondsSicht>>;
export type Betraege = Beteiligungssicht["kennzahlen"]["investiert"] & object;
export type SichtLuecke = Beteiligungssicht["luecken"][number];
export type KursInfo = Beteiligungssicht["bewertungKurse"][number];
/** Ein Eintrag der Kurstabelle; `gilt` heißt: der gültige Eintrag des Tages und Paares zum Wissensstand. */
export interface Kurs {
  id: string;
  datum: string;
  basis: string;
  quote: string;
  kurs: string;
  quelle: "manuell" | "import";
  quelleDatei: string | null;
  korrigiertKursId: string | null;
  grund: string | null;
  erfasstVon: string;
  erfasstAm: string;
  gilt: boolean;
}
export interface KursFilter {
  basis?: string | undefined;
  quote?: string | undefined;
  alle?: boolean | undefined;
  limit?: number | undefined;
}
/** Antwort des Kursimports (die API antwortet je nach Vorschau mit 200 oder 201; die Form legt `routen/waehrung.ts` fest). */
export interface KursImportErgebnis {
  dateiname: string;
  format: "ezb" | "lang";
  zeilen: number;
  gelesen: number;
  ausgewaehlt: number;
  neu: number;
  unveraendert: number;
  abweichend: { datum: string; basis: string; quote: string; kurs: string; vorhanden: string }[];
  abweichendAnzahl: number;
  fehler: { zeile: number; meldung: string }[];
  fehlerAnzahl: number;
  beispiele: { datum: string; basis: string; quote: string; kurs: string }[];
  uebernommen: boolean;
}
type ImportEingabe = InferRequestType<typeof api.api.v1.wechselkurse.import.$post>["json"];
const importiere = (json: ImportEingabe) => auspacken(api.api.v1.wechselkurse.import.$post({ json })) as unknown as Promise<KursImportErgebnis>;

export const beteiligungWaehrungssicht = (id: string, q: SichtAbfrage) => queryOptions({ queryKey: [...wurzel, "beteiligung", id, bereinigt(q)], queryFn: () => ladeBeteiligungSicht(id, q) });
export const fondsWaehrungssicht = (id: string, q: SichtAbfrage) => queryOptions({ queryKey: [...wurzel, "fonds", id, bereinigt(q)], queryFn: () => ladeFondsSicht(id, q) });
export const kursWaehrungen = () => queryOptions({ queryKey: [...wurzel, "waehrungen"], queryFn: ladeWaehrungen, staleTime: 30_000 });
export const kursListe = (q: KursFilter) => queryOptions({ queryKey: [...wurzel, "kurse", q], queryFn: () => ladeKurse(q) });

/** Nach Kursänderungen sind Sichten, Kurslisten und die Bewertungs- und Vorgangsabfragen veraltet. */
const alles = [wurzel, ["beteiligung"], ["fonds"], ["bewertungen"]] as const;

export const useKursAnlegen = () =>
  useApiMutation({
    aufruf: (json: InferRequestType<typeof api.api.v1.wechselkurse.$post>["json"]) => auspacken(api.api.v1.wechselkurse.$post({ json })),
    invalidiert: () => alles,
  });

export const useKursImport = () =>
  useApiMutation({
    aufruf: (json: ImportEingabe) => importiere(json),
    invalidiert: (ergebnis) => (ergebnis.uebernommen ? alles : []),
  });

export const useLokaleWaehrung = (beteiligungId: string) =>
  useApiMutation({
    aufruf: (waehrung: string | null) => auspacken(api.api.v1.beteiligungen[":id"].waehrung.$put({ param: { id: beteiligungId }, json: { waehrung } })),
    invalidiert: () => alles,
  });
