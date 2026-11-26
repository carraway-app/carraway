/**
 * Freitexte der Demo-Daten (alle erfunden) in Deutsch und britischem Englisch. Freitexte sind Eingaben der Menschen und werden nicht übersetzt;
 * die Oberfläche zeigt sie, wie sie gespeichert sind. Damit eine englischsprachige Vorführung nicht mit deutschen Notizen durchsetzt ist, wählt der
 * Seed die Sprache der Notizen (`DEMO_SPRACHE=en`, Standard Deutsch). Die Stammdaten (Namen, Orte, Registerangaben nach deutschem Recht) bleiben gleich.
 */

export type DemoSprache = "de" | "en";

export interface DemoTexte {
  bewertung: { insolvenz: string; anschaffungskosten: string; keineNeubewertung: string; letzteRunde: string; multiplikator: string; ertragswert: string; verkauft: string };
  abruf: string;
  /** Bemerkung der Beispiel-Übertragung von Stammanteilen an einen Co-Investor. */
  uebertragung: string;
  ausschuettung: string;
  abstimmung: string;
  absagegruende: readonly string[];
  aktivitaeten: { gespraech: readonly string[]; termin: readonly string[]; notiz: readonly string[]; mail: readonly string[] };
  offenlegung: string;
  reserve: string;
  szenarien: { basis: string; vorsichtig: string };
  /** Registerereignisse und Gegenstand der Demo-Einträge (die Registerangaben selbst wie Gericht, Funktion und Nummer bleiben nach deutschem Recht). */
  register: { gegenstand: string; geschaeftsfuehrung: string; insolvenz: string; kapitalerhoehung: string };
  /** Kommentar zu einer Warnung im Demo-Meldelauf. */
  meldelauf: { kommentar: string };
}

const DE: DemoTexte = {
  bewertung: {
    insolvenz: "Insolvenzverfahren eröffnet, Wert vollständig berichtigt",
    anschaffungskosten: "Ansatz zu Anschaffungskosten",
    keineNeubewertung: "Keine Neubewertung, Ansatz zu Anschaffungskosten",
    letzteRunde: "Orientierung an der letzten Finanzierungsrunde",
    multiplikator: "Umsatzmultiplikator vergleichbarer Unternehmen",
    ertragswert: "Ertragswert aus der Unternehmensplanung",
    verkauft: "Beteiligung verkauft",
  },
  abruf: "Abruf für Investitionen und Verwaltung",
  uebertragung: "Kauf von Gründeranteilen durch einen Co-Investor",
  ausschuettung: "Ausschüttung aus Exit",
  abstimmung: "Abstimmung mit Co-Investor zu Konditionen",
  absagegruende: [
    "Markt zu klein für die Fondsstrategie",
    "Bewertung nicht darstellbar",
    "Gründerbesetzung unvollständig",
    "Zu früh, Wiedervorlage in zwölf Monaten",
    "Wettbewerber mit besserer Ausgangslage",
    "Konditionen nicht einig geworden",
    "Technologierisiko nach Prüfung zu hoch",
  ],
  aktivitaeten: {
    gespraech: ["Telefonat zum Geschäftsmodell", "Erstes Gespräch mit der Geschäftsführung", "Rückfragen zur Finanzplanung"],
    termin: ["Vorstellungstermin vor Ort", "Termin zu Kennzahlen und Planung", "Gesprächsrunde zur Beteiligungsstruktur"],
    notiz: ["Notiz zur Marktlage", "Eindruck aus dem Gespräch festgehalten", "Offene Punkte der Prüfung"],
    mail: ["Unterlagen angefordert", "Unterlagen erhalten", "Terminabstimmung per Mail"],
  },
  offenlegung: "Neuausrichtung der Anlagestrategie",
  reserve: "Reserve für eine Folgerunde (Beispiel)",
  szenarien: { basis: "Basis", vorsichtig: "Vorsichtig" },
  register: {
    gegenstand: "Entwicklung und Vertrieb von Produkten und Dienstleistungen (erfundener Beispieltext).",
    geschaeftsfuehrung: "Neue Geschäftsführung eingetragen (erfundener Beispieltext).",
    insolvenz: "Eröffnung des Insolvenzverfahrens über das Vermögen der Gesellschaft (erfundener Beispieltext).",
    kapitalerhoehung: "Erhöhung des Stammkapitals auf 28.000 Euro (erfundener Beispieltext).",
  },
  meldelauf: { kommentar: "Angabe wird nach Rückfrage bei der Beteiligung nachgetragen (Beispieltext)." },
};

const EN: DemoTexte = {
  bewertung: {
    insolvenz: "Insolvency proceedings opened, value written off in full",
    anschaffungskosten: "Carried at cost",
    keineNeubewertung: "No revaluation, carried at cost",
    letzteRunde: "Based on the latest financing round",
    multiplikator: "Revenue multiple of comparable companies",
    ertragswert: "Income value from the company's business plan",
    verkauft: "Holding sold",
  },
  abruf: "Capital call for investments and administration",
  uebertragung: "Purchase of founder shares by a co-investor",
  ausschuettung: "Distribution from exit",
  abstimmung: "Alignment with co-investor on terms",
  absagegruende: [
    "Market too small for the fund strategy",
    "Valuation cannot be justified",
    "Founder line-up incomplete",
    "Too early, follow up in twelve months",
    "Competitor with a better starting position",
    "No agreement on terms",
    "Technology risk too high after review",
  ],
  aktivitaeten: {
    gespraech: ["Call on the business model", "First meeting with the management", "Follow-up questions on the financial plan"],
    termin: ["Introduction meeting on site", "Meeting on key figures and planning", "Discussion of the investment structure"],
    notiz: ["Note on the market situation", "Impression from the conversation", "Open points of the review"],
    mail: ["Documents requested", "Documents received", "Scheduling by email"],
  },
  offenlegung: "Realignment of the investment strategy",
  reserve: "Reserve for a follow-on round (example)",
  szenarien: { basis: "Base", vorsichtig: "Cautious" },
  register: {
    gegenstand: "Development and sale of products and services (invented sample text).",
    geschaeftsfuehrung: "New management entered in the register (invented sample text).",
    insolvenz: "Insolvency proceedings opened over the assets of the company (invented sample text).",
    kapitalerhoehung: "Share capital increased to EUR 28,000 (invented sample text).",
  },
  meldelauf: { kommentar: "Item to be supplied after checking with the portfolio company (sample text)." },
};

export const demoTexte = (sprache: DemoSprache = "de"): DemoTexte => (sprache === "en" ? EN : DE);

/** Liest `DEMO_SPRACHE` (`de` oder `en`); alles andere ist ein Fehler, damit sich kein Tippfehler als Deutsch tarnt. */
export function demoSpracheAus(wert: string | undefined): DemoSprache {
  if (wert === undefined || wert === "") return "de";
  if (wert === "de" || wert === "en") return wert;
  throw new Error(`DEMO_SPRACHE "${wert}" ungültig (de oder en).`);
}
