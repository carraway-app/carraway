import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { schluessel } from "./abfragen";
import { api } from "./client";
import { useApiMutation } from "./mutationen";
import { ausBerichteBereich, bereichAbruf } from "./abbildung-berichte";

const ausImport = ausBerichteBereich("import");

/** Datenübernahme (Etappe 6): Läufe, Befunde, Prüfen und Übernehmen. Alles unter dem Präfix `import`. */
const wurzel = ["import"] as const;

/** Größte Datei, die die API annimmt (Bytes); die Oberfläche weist größere Dateien vorher ab. */
export const MAX_UPLOAD = 20 * 1024 * 1024;
/** Befunde je Seite der Befundtabelle. */
export const BEFUNDE_JE_SEITE = 100;

export type Blatt = "fonds" | "organisationen" | "personen" | "beteiligungen" | "finanzierungsrunden" | "rundenpositionen" | "vorgaenge" | "bewertungen" | "konditionen" | "fondsbewegungen" | "kontrollsummen";
export const BLAETTER: readonly Blatt[] = ["fonds", "organisationen", "personen", "beteiligungen", "finanzierungsrunden", "rundenpositionen", "vorgaenge", "bewertungen", "konditionen", "fondsbewegungen", "kontrollsummen"];

export interface Zaehler {
  zeilen: number;
  neu: number;
  unveraendert: number;
  abweichend: number;
}
export interface Kontrollsumme {
  groesse: string;
  quelle: string;
  ist: string | null;
  differenz: string | null;
  status: "ok" | "abweichung" | "nicht_berechnet";
  stichtag: string | null;
}
export interface FondsSummen {
  kurzname: string;
  name: string;
  beteiligungen: number;
  zusagen: string;
  auszahlungen: string;
  rueckfluesse: string;
  tilgungen: string;
  abrufe: string;
  ausschuettungen: string;
  zeichnungskapital: string;
  nav: string | null;
  navStichtag: string | null;
  kontrollsummen: Kontrollsumme[];
}
export interface Uebernahmeergebnis {
  zaehler: Partial<Record<Blatt, Zaehler>>;
  fonds: FondsSummen[];
}

const ladeLaeufe = async () => (await ausImport(api.api.v1.import.runs.$get)).daten;
const ladeLauf = (id: string) => ausImport(api.api.v1.import.runs[":id"].$get, { param: { id } });
const ladeBefunde = (id: string, filter: BefundFilter, ab: number) =>
  ausImport(api.api.v1.import.runs[":id"].findings.$get, {
      param: { id },
      query: { ab: String(ab), limit: String(BEFUNDE_JE_SEITE), ...(filter.schweregrad ? { schweregrad: filter.schweregrad } : {}), ...(filter.blatt ? { blatt: filter.blatt } : {}) },
    });

export type Importlauf = Awaited<ReturnType<typeof ladeLauf>>;
export type LaufStatus = "hochgeladen" | "geprueft" | "uebernommen";
export type BefundSeite = Awaited<ReturnType<typeof ladeBefunde>>;
export type Befund = BefundSeite["daten"][number];
export interface BefundFilter {
  schweregrad?: "fehler" | "warnung" | undefined;
  blatt?: string | undefined;
}

/** Vorschau der Prüfung (`zaehler` je Blatt); fehlt vor der ersten Prüfung. */
export const vorschauZaehler = (lauf: Importlauf): Partial<Record<Blatt, Zaehler>> => ((lauf.vorschau as { zaehler?: Partial<Record<Blatt, Zaehler>> } | null)?.zaehler ?? {});
export const laufErgebnis = (lauf: Importlauf): Uebernahmeergebnis | null => (lauf.ergebnis as Uebernahmeergebnis | null) ?? null;
export const laufFonds = (lauf: Importlauf): { ids: string[]; neu: string[] } | null => (lauf.fonds as { ids: string[]; neu: string[] } | null) ?? null;

export const importLaeufe = () => queryOptions({ queryKey: [...wurzel, "laeufe"], queryFn: ladeLaeufe });
export const importLauf = (id: string) => queryOptions({ queryKey: [...wurzel, "lauf", id], queryFn: () => ladeLauf(id) });
/** Befunde seitenweise; `naechstesAb` der Antwort ist der Anfang der nächsten Seite. */
export const importBefunde = (id: string, filter: BefundFilter) =>
  infiniteQueryOptions({
    queryKey: [...wurzel, "befunde", id, filter.schweregrad ?? null, filter.blatt ?? null],
    queryFn: ({ pageParam }) => ladeBefunde(id, filter, pageParam),
    initialPageParam: 0,
    getNextPageParam: (seite) => seite.naechstesAb ?? undefined,
  });

/** Pfade der Downloads (normale Links; Cookie und Rechte prüft die API). */
export const vorlageUrl = (sprache: "de" | "en") => `/api/v1/import/template?language=${sprache}`;
export const protokollUrl = (id: string, format: "pdf" | "xlsx", sprache: "de" | "en") => `/api/v1/import/runs/${id}/log?format=${format}&language=${sprache}`;
export const EXPORT_URL = "/api/v1/export?format=zip";
export const DOKU_URL = "/api/v1/docs";

/** Lädt die Datei als multipart-Feld `file` hoch (kein JSON, deshalb ohne den Hono-Client). */
export const ladeHoch = (datei: File) => {
  const formular = new FormData();
  formular.append("file", datei);
  return bereichAbruf("import", "/import/runs", "POST", formular) as Promise<Importlauf>;
};

export const useLaufHochladen = () =>
  useApiMutation({
    aufruf: ladeHoch,
    invalidiert: () => [[...wurzel, "laeufe"]],
  });

export const useLaufPruefen = (id: string) =>
  useApiMutation({
    aufruf: () => ausImport(api.api.v1.import.runs[":id"].validate.$post, { param: { id } }),
    invalidiert: () => [wurzel],
  });

export const useLaufUebernehmen = (id: string) =>
  useApiMutation({
    aufruf: () => ausImport(api.api.v1.import.runs[":id"].apply.$post, { param: { id } }),
    // Die Übernahme legt Datensätze in allen Bereichen an.
    invalidiert: () => [wurzel, schluessel.fonds, schluessel.beteiligungen, schluessel.organisationen, schluessel.bewertungen, schluessel.zinslaeufe, schluessel.berichte],
  });
