import type { FeldObjekt } from "../crm/felder";

/**
 * Wo die Werte eigener Felder je Objekt stehen (Etappe 21): Tabelle und JSON-Spalte. Die Felddefinitionen sind für alle Objekte dieselbe Einrichtung
 * (`feld_definition`); dieses Verzeichnis ist die eine Stelle, die Objekt und Speicherort verbindet (Verwendungsprüfung, Schema, Lesen, Schreiben).
 *
 * - `fonds`, `beteiligung`, `runde` (Finanzierungsrunde) und `instrument` sind veränderbare Stammdaten: Jede Änderung der Werte steht mit
 *   vollständigem Vorher und Nachher im Änderungsprotokoll (Aktion `felder_setzen`), daraus entsteht der Stand zu einem früheren Wissensstand.
 * - `instrument` hat keine eigene Tabelle (das Instrument ist eine Eigenschaft der Beteiligung, eindeutig je Fonds, Unternehmen und Instrument);
 *   seine Werte stehen in `beteiligung.instrument_felder`.
 * - `vorgang` ist unveränderlich: Werte werden nur beim Anlegen gesetzt, ein Storno übernimmt sie.
 */
export interface FeldZiel {
  tabelle: string;
  spalte: string;
  /** Tabelle im Änderungsprotokoll (bei `instrument` die der Beteiligung, getrennt über das Objekt im Inhalt). */
  protokollTabelle: string;
  /** Veränderbar über die API (alles außer Vorgängen). */
  veraenderbar: boolean;
  /** Eingebaute Datensätze des CRM, deren Werte über die Datensatz-Routen laufen. */
  crm: boolean;
}

export const FELD_ZIELE: Record<FeldObjekt, FeldZiel> = {
  organisation: { tabelle: "organisation", spalte: "felder", protokollTabelle: "organisation", veraenderbar: true, crm: true },
  person: { tabelle: "person", spalte: "felder", protokollTabelle: "person", veraenderbar: true, crm: true },
  deal: { tabelle: "deal", spalte: "felder", protokollTabelle: "deal", veraenderbar: true, crm: true },
  fonds: { tabelle: "fonds", spalte: "felder", protokollTabelle: "fonds", veraenderbar: true, crm: false },
  runde: { tabelle: "finanzierungsrunde", spalte: "felder", protokollTabelle: "finanzierungsrunde", veraenderbar: true, crm: false },
  instrument: { tabelle: "beteiligung", spalte: "instrument_felder", protokollTabelle: "beteiligung", veraenderbar: true, crm: false },
  beteiligung: { tabelle: "beteiligung", spalte: "felder", protokollTabelle: "beteiligung", veraenderbar: true, crm: false },
  vorgang: { tabelle: "vorgang", spalte: "felder", protokollTabelle: "vorgang", veraenderbar: false, crm: false },
};

/** Objekte des Portfolios (ohne CRM), deren Werte `/zusatzfelder` liest und setzt. */
export const PORTFOLIO_OBJEKTE = ["fonds", "runde", "instrument", "beteiligung", "vorgang"] as const satisfies readonly FeldObjekt[];
export type PortfolioObjekt = (typeof PORTFOLIO_OBJEKTE)[number];
