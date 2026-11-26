import { queryOptions } from "@tanstack/react-query";
import { ladeMitSitzung } from "./client";
import { ausKontaktAntwort } from "./abbildung-kontakte";
import { useApiMutation } from "./mutationen";
import type { Feld, FeldTyp } from "./crm";

/**
 * Eigene Felder an Fonds, Finanzierungsrunde, Instrument, Beteiligung und Vorgang (Etappe 21). Die Routen liegen unter den Pfaden der Objekte; die Form der
 * Antworten legt `apps/api/src/felder/werte.ts` fest. Die Antworttypen stehen hier ausdrücklich, weil die Felder dynamisch sind.
 */

export type PortfolioObjekt = "fonds" | "runde" | "instrument" | "beteiligung" | "vorgang";
export const PORTFOLIO_OBJEKTE: readonly PortfolioObjekt[] = ["fonds", "runde", "instrument", "beteiligung", "vorgang"];

export interface ZusatzFeld {
  id: string;
  schluessel: string;
  name: string;
  typ: FeldTyp;
  optionen: Feld["optionen"];
  position: number;
  version: number;
  archiviert: boolean;
  wert: unknown;
}

export interface ZusatzAntwort {
  objekt: PortfolioObjekt;
  id: string;
  stand: string | null;
  werte: Record<string, unknown>;
  felder: ZusatzFeld[];
  bezuege: Record<string, string | null>;
}

export interface ZusatzDefinition {
  id: string;
  objekt: PortfolioObjekt;
  schluessel: string;
  name: string;
  typ: FeldTyp;
  optionen: Feld["optionen"];
  position: number;
  version: number;
  archiviertAm: string | null;
}

const wurzel = ["zusatzfelder"] as const;

/** Pfad der Werte eines Objekts (die Instrumentwerte hängen an der Beteiligung). */
export const zusatzPfad = (objekt: PortfolioObjekt, id: string): string => {
  switch (objekt) {
    case "fonds":
      return `/api/v1/funds/${id}/fields`;
    case "runde":
      return `/api/v1/financing-rounds/${id}/fields`;
    case "beteiligung":
      return `/api/v1/investments/${id}/fields`;
    case "instrument":
      return `/api/v1/investments/${id}/instrument-fields`;
    case "vorgang":
      return `/api/v1/transactions/${id}/fields`;
  }
};

/** Absolute Adresse (wie beim Client der API), damit Tests und Browser gleich anfragen. */
const adresse = (pfad: string) => `${typeof window === "undefined" ? "http://localhost" : window.location.origin}${pfad}`;
const laden = <T>(pfad: string): Promise<T> => ausKontaktAntwort(ladeMitSitzung(adresse(pfad))) as Promise<T>;

export const zusatzWerte = (objekt: PortfolioObjekt, id: string, stand?: string) =>
  queryOptions({
    queryKey: [...wurzel, "werte", objekt, id, stand ?? ""],
    queryFn: () => laden<ZusatzAntwort>(`${zusatzPfad(objekt, id)}${stand ? `?knowledgeDate=${encodeURIComponent(stand)}` : ""}`),
  });

export const zusatzDefinitionen = (objekt: PortfolioObjekt, archiviert = false) =>
  queryOptions({
    queryKey: [...wurzel, "definitionen", objekt, archiviert],
    queryFn: async () => {
      const { aufEnglisch } = await import("@carraway/api/kontakte/api-namen");
      const { object } = aufEnglisch({ objekt });
      return (await laden<{ daten: ZusatzDefinition[] }>(`/api/v1/custom-fields/${object}/definitions${archiviert ? "?archived=1" : ""}`)).daten;
    },
    staleTime: 30_000,
  });

export const useZusatzWerteSetzen = (objekt: PortfolioObjekt, id: string) =>
  useApiMutation({
    aufruf: (werte: Record<string, unknown>) =>
      ausKontaktAntwort(
        ladeMitSitzung(adresse(zusatzPfad(objekt, id)), { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ values: werte }) }),
      ) as Promise<ZusatzAntwort>,
    invalidiert: () => [wurzel],
  });

/** Ein Feld der Anzeige als Feld der CRM-Bausteine (Anzeige, Editor): Schlüssel ist die ID der Definition. */
export const alsCrmFeld = (f: ZusatzFeld | ZusatzDefinition, schreibbar: boolean): Feld => {
  const id = "id" in f ? f.id : "";
  return {
    schluessel: id,
    name: f.name,
    typ: f.typ,
    system: false,
    schreibbar,
    optionen: f.optionen,
    operatoren: [],
    sortierbar: false,
    ...(f.optionen.ziel ? { ziel: f.optionen.ziel } : {}),
    definitionId: id,
  };
};

export const zusatzWurzel = wurzel;
