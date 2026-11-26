import type { Position, Seite } from "./buchhaltung.js";

/**
 * Standardgliederungen für ein Beteiligungsvehikel (vereinfacht, an das Handelsrecht angelehnt, keine Rechtsberatung) und ein
 * kleiner, erfundener Kontenrahmen mit passenden Regeln. Die Standardgliederung ist Seed-Datenbestand: Sie lässt sich je Fonds anlegen
 * und von Verwaltern ändern. Kontenrahmen und Regeln sind Beispiele für Demo und Tests.
 */

export type Sicht = "bilanz" | "guv" | "liquiditaet" | "mittelverwendung" | "portfolio";
export const SICHTEN: readonly Sicht[] = ["bilanz", "guv", "liquiditaet", "mittelverwendung", "portfolio"];

type P = [schluessel: string, eltern: string | null, seite: Seite, de: string, en: string];

const aus = (liste: P[]): Position[] =>
  liste.map(([schluessel, elternSchluessel, seite, bezeichnungDe, bezeichnungEn], i) => ({ schluessel, elternSchluessel, seite, bezeichnungDe, bezeichnungEn, reihenfolge: (i + 1) * 10 }));

export const STANDARD_GLIEDERUNG: Record<Sicht, Position[]> = {
  bilanz: aus([
    ["aktiva", null, "soll", "Aktiva", "Assets"],
    ["aktiva.finanzanlagen", "aktiva", "soll", "Finanzanlagen", "Financial assets"],
    ["aktiva.beteiligungen", "aktiva.finanzanlagen", "soll", "Beteiligungen", "Equity investments"],
    ["aktiva.ausleihungen", "aktiva.finanzanlagen", "soll", "Ausleihungen an Beteiligungsunternehmen", "Loans to investee companies"],
    ["aktiva.forderungen", "aktiva", "soll", "Forderungen und sonstige Vermögensgegenstände", "Receivables and other assets"],
    ["aktiva.liquide", "aktiva", "soll", "Guthaben bei Kreditinstituten", "Cash at bank"],
    ["passiva", null, "haben", "Passiva", "Equity and liabilities"],
    ["passiva.eigenkapital", "passiva", "haben", "Eigenkapital", "Equity"],
    ["passiva.kapital", "passiva.eigenkapital", "haben", "Kapitalanteile der Gesellschafter", "Partners' capital"],
    ["passiva.ergebnis", "passiva.eigenkapital", "haben", "Ergebnis des Geschäftsjahres", "Result for the financial year"],
    ["passiva.rueckstellungen", "passiva", "haben", "Rückstellungen", "Provisions"],
    ["passiva.verbindlichkeiten", "passiva", "haben", "Verbindlichkeiten", "Liabilities"],
  ]),
  guv: aus([
    ["guv.ergebnis", null, "haben", "Ergebnis des Geschäftsjahres", "Result for the financial year"],
    ["guv.ertraege", "guv.ergebnis", "haben", "Erträge", "Income"],
    ["guv.beteiligungsertraege", "guv.ertraege", "haben", "Erträge aus Beteiligungen", "Income from investments"],
    ["guv.zinsertraege", "guv.ertraege", "haben", "Zinserträge", "Interest income"],
    ["guv.sonstige_ertraege", "guv.ertraege", "haben", "Sonstige Erträge", "Other income"],
    ["guv.aufwendungen", "guv.ergebnis", "soll", "Aufwendungen", "Expenses"],
    ["guv.verwaltungskosten", "guv.aufwendungen", "soll", "Verwaltungskosten", "Administrative costs"],
    ["guv.abschreibungen", "guv.aufwendungen", "soll", "Abschreibungen auf Finanzanlagen", "Write-downs of financial assets"],
    ["guv.sonstige_aufwendungen", "guv.aufwendungen", "soll", "Sonstige Aufwendungen", "Other expenses"],
  ]),
  liquiditaet: aus([
    ["liq.verfuegbar", null, "soll", "Verfügbare Liquidität", "Available liquidity"],
    ["liq.bank", "liq.verfuegbar", "soll", "Guthaben bei Kreditinstituten", "Cash at bank"],
    ["liq.forderungen", "liq.verfuegbar", "soll", "Kurzfristige Forderungen", "Short-term receivables"],
    ["liq.verbindlichkeiten", "liq.verfuegbar", "haben", "Kurzfristige Verbindlichkeiten", "Short-term liabilities"],
  ]),
  mittelverwendung: aus([
    ["mv.herkunft", null, "haben", "Mittelherkunft", "Source of funds"],
    ["mv.kapital", "mv.herkunft", "haben", "Kapitalanteile der Gesellschafter", "Partners' capital"],
    ["mv.ertraege", "mv.herkunft", "haben", "Erträge", "Income"],
    ["mv.verwendung", null, "soll", "Mittelverwendung", "Use of funds"],
    ["mv.beteiligungen", "mv.verwendung", "soll", "Investitionen in Beteiligungen", "Investments in equity"],
    ["mv.ausleihungen", "mv.verwendung", "soll", "Ausleihungen an Beteiligungsunternehmen", "Loans to investee companies"],
    ["mv.kosten", "mv.verwendung", "soll", "Laufende Kosten und Gebühren", "Running costs and fees"],
  ]),
  portfolio: aus([
    ["pf.portfolio", null, "soll", "Portfolio zu Buchwerten", "Portfolio at book value"],
    ["pf.beteiligungen", "pf.portfolio", "soll", "Beteiligungen", "Equity investments"],
    ["pf.ausleihungen", "pf.portfolio", "soll", "Ausleihungen", "Loans"],
  ]),
};

export interface StandardKonto {
  nummer: string;
  bezeichnung: string;
  art: "aktiv" | "passiv" | "aufwand" | "ertrag";
}

/** Kleiner, erfundener Kontenrahmen (vierstellig). */
export const STANDARD_KONTEN: StandardKonto[] = [
  { nummer: "0100", bezeichnung: "Beteiligungen", art: "aktiv" },
  { nummer: "0110", bezeichnung: "Wertberichtigungen auf Beteiligungen", art: "aktiv" },
  { nummer: "0150", bezeichnung: "Ausleihungen an Beteiligungsunternehmen", art: "aktiv" },
  { nummer: "1200", bezeichnung: "Bank", art: "aktiv" },
  { nummer: "1400", bezeichnung: "Sonstige Forderungen", art: "aktiv" },
  { nummer: "2000", bezeichnung: "Kapitalanteile der Gesellschafter", art: "passiv" },
  { nummer: "3000", bezeichnung: "Rückstellungen", art: "passiv" },
  { nummer: "3300", bezeichnung: "Verbindlichkeiten", art: "passiv" },
  { nummer: "4100", bezeichnung: "Erträge aus Beteiligungen", art: "ertrag" },
  { nummer: "4200", bezeichnung: "Zinserträge", art: "ertrag" },
  { nummer: "4900", bezeichnung: "Sonstige Erträge", art: "ertrag" },
  { nummer: "6300", bezeichnung: "Verwaltungskosten", art: "aufwand" },
  { nummer: "6800", bezeichnung: "Abschreibungen auf Finanzanlagen", art: "aufwand" },
  { nummer: "6900", bezeichnung: "Sonstige Aufwendungen", art: "aufwand" },
];

/** Regeln zum Standardkontenrahmen: Bereich → Position je Sicht. */
export const STANDARD_REGELN: { sicht: Sicht; von: string; bis: string; position: string }[] = [
  { sicht: "bilanz", von: "0100", bis: "0119", position: "aktiva.beteiligungen" },
  { sicht: "bilanz", von: "0150", bis: "0199", position: "aktiva.ausleihungen" },
  { sicht: "bilanz", von: "1400", bis: "1499", position: "aktiva.forderungen" },
  { sicht: "bilanz", von: "1200", bis: "1299", position: "aktiva.liquide" },
  { sicht: "bilanz", von: "2000", bis: "2999", position: "passiva.kapital" },
  { sicht: "bilanz", von: "3000", bis: "3299", position: "passiva.rueckstellungen" },
  { sicht: "bilanz", von: "3300", bis: "3999", position: "passiva.verbindlichkeiten" },
  { sicht: "bilanz", von: "4000", bis: "6999", position: "passiva.ergebnis" },
  { sicht: "guv", von: "4100", bis: "4199", position: "guv.beteiligungsertraege" },
  { sicht: "guv", von: "4200", bis: "4299", position: "guv.zinsertraege" },
  { sicht: "guv", von: "4900", bis: "4999", position: "guv.sonstige_ertraege" },
  { sicht: "guv", von: "6300", bis: "6799", position: "guv.verwaltungskosten" },
  { sicht: "guv", von: "6800", bis: "6899", position: "guv.abschreibungen" },
  { sicht: "guv", von: "6900", bis: "6999", position: "guv.sonstige_aufwendungen" },
  { sicht: "liquiditaet", von: "1200", bis: "1299", position: "liq.bank" },
  { sicht: "liquiditaet", von: "1400", bis: "1499", position: "liq.forderungen" },
  { sicht: "liquiditaet", von: "3300", bis: "3999", position: "liq.verbindlichkeiten" },
  { sicht: "mittelverwendung", von: "2000", bis: "2999", position: "mv.kapital" },
  { sicht: "mittelverwendung", von: "4100", bis: "4999", position: "mv.ertraege" },
  { sicht: "mittelverwendung", von: "0100", bis: "0119", position: "mv.beteiligungen" },
  { sicht: "mittelverwendung", von: "0150", bis: "0199", position: "mv.ausleihungen" },
  { sicht: "mittelverwendung", von: "6300", bis: "6999", position: "mv.kosten" },
  { sicht: "portfolio", von: "0100", bis: "0119", position: "pf.beteiligungen" },
  { sicht: "portfolio", von: "0150", bis: "0199", position: "pf.ausleihungen" },
];
