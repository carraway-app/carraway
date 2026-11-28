import { formatDatum, type Sprache } from "@carraway/ui";
import { aufzaehlung, tabelleFuer } from "./index";

/**
 * Der Rechenkern liefert die Bezeichnungen der Rechenschritte auf Deutsch (die API ist sonst sprachneutral).
 * Für Englisch übersetzt die Oberfläche die bekannten Bezeichnungen, unbekannte bleiben unverändert.
 */
const englisch: Record<string, string> = {
  "Abgerufen bis zum Basistag": "Called up to the base date",
  "Prognose: Investitionen": "Projection: investments",
  "Prognose: Gebühren und Kosten": "Projection: fees and costs",
  "Abgerufen zum Prognoseende": "Called at the end of the projection",
  "Ausschüttungen bis zum Basistag": "Distributions up to the base date",
  "Prognose: Ausschüttungen brutto": "Projection: gross distributions",
  "Prognose: Carry": "Projection: carry",
  "Ausschüttungen zum Prognoseende (netto)": "Distributions at the end of the projection (net)",
  "NAV netto zum Prognoseende": "Net NAV at the end of the projection",
  "DPI (netto)": "DPI (net)",
  "TVPI (netto)": "TVPI (net)",
  "IRR (netto, XIRR)": "IRR (net, XIRR)",
  "Zeichnungskapital": "Fund size",
  "Belegt (das Größere aus abgerufen und investiert)": "Used (the larger of called and invested)",
  "Offene Reserven der aktiven Beteiligungen": "Open reserves of the active holdings",
  "Gebührenprognose des Szenarios": "Fee projection of the scenario",
  "Verfügbar für Neuinvestments": "Available for new investments",
  "Abgerufenes Kapital": "Called capital",
  "Anzahl Abrufe (Zahlungen von Investoren)": "Number of capital calls (payments from investors)",
  "Anzahl Abrufe bis zum Stichtag": "Number of capital calls up to the reporting date",
  "Anzahl Ausschüttungen": "Number of distributions",
  "Anzahl Ausschüttungen bis zum Stichtag": "Number of distributions up to the reporting date",
  "Ausschüttungen kumuliert": "Distributions to date",
  "Beteiligungen mit Wertansatz zum Stichtag (Anzahl)": "Holdings with a valuation at the reporting date (count)",
  "Bewertung zum Stichtag": "Valuation at the reporting date",
  "Investiertes Kapital": "Invested capital",
  "IRR (XIRR, act/365)": "IRR (XIRR, act/365)",
  "Multiple": "Multiple",
  "NAV": "NAV",
  "Portfoliowert": "Portfolio value",
  "Bankguthaben laut Saldenliste": "Bank balance per trial balance",
  "Weitere Vermögenswerte einschließlich Forderungen": "Other assets including receivables",
  "Verbindlichkeiten und Rückstellungen": "Liabilities and provisions",
  "Fonds-NAV": "Fund NAV",
  "Saldenliste fehlt oder ist unvollständig": "Trial balance missing or incomplete",
  "NAV (Summe der letzten Bewertungen)": "NAV (sum of the latest valuations)",
  "Rückflüsse kumuliert": "Proceeds to date",
  "Eingezahltes Kapital": "Paid-in capital",
  "Offene Abrufe": "Outstanding calls",
  "Überfällige Abrufe": "Overdue calls",
  "Ungeklärte Altzahlungen": "Unconfirmed legacy payments",
  "Anzahl Zahlungseingänge": "Number of receipts",
  "Summe Einzahlungen": "Total paid-in capital",
  "Summe Abrufe": "Total capital calls",
  "Summe Ausschüttungen": "Total distributions",
  "nicht definiert": "not defined",
  // Beteiligung
  "Auszahlungen bis zum Stichtag (Anzahl, inklusive Stornos)": "Disbursements up to the reporting date (count, including reversals)",
  "davon Stornobuchungen": "of which reversals",
  "Investiertes Kapital (Summe der Auszahlungen nach Storno)": "Invested capital (total disbursements after reversals)",
  "Rückflüsse und Tilgungen bis zum Stichtag (Anzahl)": "Proceeds and repayments up to the reporting date (count)",
  "Rückflüsse kumuliert (ohne Zinsen)": "Proceeds to date (excluding interest)",
  "Rückflüsse, Tilgungen, gezahlte Zinsen und Dividenden bis zum Stichtag (Anzahl)": "Proceeds, repayments, interest paid and dividends up to the reporting date (count)",
  "Rückflüsse kumuliert (inkl. gezahlter Zinsen und Dividenden)": "Proceeds to date (including interest paid and dividends)",
  "Beteiligung mit Rückfluss ausgeschieden (Status Exit)": "Holding exited with proceeds (status exit)",
  "Keine Bewertung bis zum Stichtag": "No valuation up to the reporting date",
  "Aufgehobene Storno-Paare (nicht im Zahlungsstrom)": "Cancelled reversal pairs (not in the cash flow)",
  "IRR der Beteiligung (XIRR, act/365)": "IRR of the holding (XIRR, act/365)",
  // Buchwert, Zinsen, Wandlung, Verkauf (Etappe 4)
  "Investiert (Auszahlungen nach Storno)": "Invested (disbursements after reversals)",
  "Kapitalisierte Zinsen": "Capitalised interest",
  "Tilgungen": "Repayments",
  "Wertberichtigungen (netto)": "Write-downs (net)",
  "Buchwertabgang durch Verkäufe": "Carrying amount disposed in sales",
  // Frühere Bezeichnung, steht noch in gespeicherten Rechenwegen (Verkäufe, Snapshots).
  "Buchwertabgang früherer Teilverkäufe": "Carrying amount disposed in earlier partial sales",
  "Buchwert": "Carrying amount",
  "Kapital": "Capital",
  "Zinssatz p. a.": "Interest rate p. a.",
  "Zinsbetrag": "Interest amount",
  "Fester Zins": "Fixed interest",
  "Gewinnsatz": "Profit rate",
  "Kappungssatz": "Cap rate",
  "Gewinnanteil vor Kappung": "Profit share before cap",
  "Kappungsgrenze": "Cap limit",
  "Gewinnabhängiger Zins (kleinerer Wert × Anteil)": "Profit-linked interest (smaller value × share)",
  "Zinsen gesamt": "Total interest",
  "Gebucht (auf Cent, kaufmännisch)": "Booked (rounded to the cent)",
  "Abgrenzung (auf Cent, kaufmännisch)": "Accrual (rounded to the cent)",
  "Offenes Kapital am Cut-off": "Outstanding capital at the cut-off",
  "Aufgelaufene Zinsen, gebucht (auf Cent)": "Accrued interest, booked (rounded to the cent)",
  "Wandlungsbetrag (Kapital plus Zinsen)": "Conversion amount (capital plus interest)",
  "Wandlungsbetrag (nur Kapital, Zinsen werden ausgezahlt)": "Conversion amount (capital only, interest is paid out)",
  "Rundenpreis je Anteil": "Round price per share",
  "Preis aus Bewertungsobergrenze (Betrag ÷ Anteile vor der Runde)": "Price from the valuation cap (amount ÷ shares before the round)",
  "Wandlungspreis je Anteil (kleinerer Wert)": "Conversion price per share (smaller value)",
  "Wandlungsbetrag ÷ Preis, abgerundet auf ganze Anteile": "Conversion amount ÷ price, rounded down to whole shares",
  "Spitzenbetrag (Wandlungsbetrag − Anteile × Preis)": "Fractional amount (conversion amount − shares × price)",
  "Nominal (Anteile × Nennwert)": "Nominal (shares × nominal value)",
  "Agio (Wandlungsbetrag − Nominal − Spitzenbetrag)": "Share premium (conversion amount − nominal − fractional amount)",
  "Buchwert vor dem Verkauf": "Carrying amount before the sale",
  "Buchwertabgang": "Carrying amount disposed",
  "Verkaufter Anteil": "Share sold",
  "Buchwertabgang (auf Cent, kaufmännisch)": "Carrying amount disposed (rounded to the cent)",
  "Kaufpreis": "Purchase price",
  "Kosten": "Costs",
  "Erlös": "Proceeds",
  "Ergebnis (Gewinn positiv, Verlust negativ)": "Result (gain positive, loss negative)",
  "Zinsen": "Interest",
  // Offene Kaufpreisforderungen (Treuhand) im NAV und im Wertansatz (Etappe 5)
  "Offene Kaufpreisforderungen": "Open purchase price receivables",
  "Bewertung zum Stichtag (mit Forderungen)": "Valuation at the reporting date (including receivables)",
  // Exit-Wasserfall (Etappe 10)
  "Verteilbarer Erlös (netto nach Kosten)": "Distributable proceeds (net of costs)",
  "Umwandlungsprüfung: Durchgänge": "Conversion check: passes",
  "Rest nach Präferenzen": "Remainder after preferences",
  "Anteile im Pool (Stammanteile, Umwandlung, Beteiligung)": "Shares in the pool (common, conversion, participation)",
  "Betrag je Anteil": "Amount per share",
  "Betrag je Einheit vor der Verteilung": "Amount per unit before distribution",
  "Mitarbeiterbeteiligung vor der Verteilung": "Employee equity payout before distribution",
  "davon im Geld": "of which in the money",
  "Minderung der nachrangigen Rückflüsse durch die Mitarbeiterbeteiligung (Faktor)": "Reduction of junior proceeds by employee equity (factor)",
  "Mitarbeiterbeteiligung: gevestete Einheiten": "Employee participation: vested units",
  "davon im Geld (Basispreis unter dem Betrag je Anteil)": "of which in the money (strike below the amount per share)",
  "Basispreise der Einheiten im Geld (bleiben den übrigen Anteilen)": "Strike prices of the units in the money (stay with the other shares)",
  "Minderung aller Rückflüsse durch die Mitarbeiterbeteiligung (Faktor)": "Reduction of all proceeds by the employee participation (factor)",
  "Nicht verteilt (niemand anspruchsberechtigt)": "Not distributed (nobody entitled)",
  "Summe der Rückflüsse (auf Cent)": "Total proceeds (to the cent)",
  "Treuhandanteil": "Escrow share",
  "Einbehalt Treuhand (auf Cent)": "Escrow holdback (to the cent)",
  "Sofort ausgezahlt": "Paid out immediately",
  // Verwaltungsvergütung, Fondskosten und Kapitalkonten (Issue #157)
  "Ausschüttungen": "Distributions",
  "Verwaltungsvergütung": "Management fees",
  "Fondskosten": "Fund expenses",
  "Wertentwicklung und übriges Ergebnis": "Performance and other result",
  "NAV-Anteil": "Share of NAV",
  "davon NAV des Fonds nach Anteil": "of which fund NAV by share",
  "davon Ausgleich abweichender Kostenverteilung": "of which offset for costs allocated differently",
  "Jahressatz": "Annual rate",
  "Vergütung (auf den Cent gerundet)": "Fee (rounded to the cent)",
  "Verwaltungsvergütung und Fondskosten (gebucht)": "Management fees and fund expenses (booked)",
  "Differenz (u. a. nicht gebuchte Kosten des Fonds)": "Difference (including fund costs not booked)",
};

/** Präfixe, die der Rechenkern vor eine Bezeichnung setzt; der Rest wird für sich übersetzt. */
const praefixe: { re: RegExp; text: (treffer: string[], sprache: Sprache) => string }[] = [
  { re: /^Periode (\d{4}-\d{2}-\d{2}) bis (\d{4}-\d{2}-\d{2}): /, text: ([von, bis], sprache) => `${sprache === "en" ? "Period" : "Periode"} ${formatDatum(von!, sprache)} ${sprache === "en" ? "to" : "bis"} ${formatDatum(bis!, sprache)}: ` },
  { re: /^(\d{4}-\d{2}-\d{2}): (?=(?:kein Bestand|Summe aus|Gesamtwert aller|Auswirkung|Wert der Beteiligungen|Anteil in Prozent|gewichteter Durchschnitt|keine Daten)(?:$|[ (]))/, text: ([datum], sprache) => `${formatDatum(datum!, sprache)}: ` },
  { re: /^Laufendes Stück: /, text: (_t, sprache) => (sprache === "en" ? "Running part: " : "Laufendes Stück: ") },
  { re: /^Zinsen bis Cut-off: /, text: (_t, sprache) => (sprache === "en" ? "Interest up to the cut-off: " : "Zinsen bis Cut-off: ") },
];

const datumsMuster = /\d{4}-\d{2}-\d{2}/g;

/** Bezeichnungen mit eingebetteten Werten (Datum, Anzahl, Methode): der Rechenkern setzt sie als Text zusammen. */
const muster: { re: RegExp; text: (treffer: string[], sprache: Sprache) => string }[] = [
  {
    re: /^Summe der Zusagen am (\d{4}-\d{2}-\d{2})$/,
    text: ([datum], sprache) => (sprache === "en" ? `Total commitments on ${formatDatum(datum!, sprache)}` : `Summe der Zusagen am ${formatDatum(datum!, sprache)}`),
  },
  {
    re: /^Tage (\d{4}-\d{2}-\d{2}) bis (\d{4}-\d{2}-\d{2}) \(einschließlich\) \/ 365$/,
    text: ([von, bis], sprache) => (sprache === "en" ? `Days ${formatDatum(von!, sprache)} to ${formatDatum(bis!, sprache)} (inclusive) / 365` : `Tage ${formatDatum(von!, sprache)} bis ${formatDatum(bis!, sprache)} (einschließlich) / 365`),
  },
  // Exit-Wasserfall: Klassennamen sind Daten und bleiben unübersetzt
  { re: /^Umwandlung (.+): Rückfluss bei Umwandlung$/, text: ([k], sprache) => (sprache === "en" ? `Conversion ${k}: proceeds if converted` : `Umwandlung ${k}: Rückfluss bei Umwandlung`) },
  { re: /^Umwandlung (.+): Rückfluss ohne Umwandlung$/, text: ([k], sprache) => (sprache === "en" ? `Conversion ${k}: proceeds if not converted` : `Umwandlung ${k}: Rückfluss ohne Umwandlung`) },
  { re: /^Entscheidung (.+): wandelt um$/, text: ([k], sprache) => (sprache === "en" ? `Decision ${k}: converts` : `Entscheidung ${k}: wandelt um`) },
  { re: /^Entscheidung (.+): behält die Präferenz$/, text: ([k], sprache) => (sprache === "en" ? `Decision ${k}: keeps the preference` : `Entscheidung ${k}: behält die Präferenz`) },
  { re: /^Anspruch (.+) \(Rang (\d+)\)$/, text: ([k, rang], sprache) => (sprache === "en" ? `Claim ${k} (rank ${rang})` : `Anspruch ${k} (Rang ${rang})`) },
  { re: /^davon Verzinsung (.+)$/, text: ([k], sprache) => (sprache === "en" ? `of which interest ${k}` : `davon Verzinsung ${k}`) },
  { re: /^Rang (\d+): gezahlte Präferenzen$/, text: ([rang], sprache) => (sprache === "en" ? `Rank ${rang}: preferences paid` : `Rang ${rang}: gezahlte Präferenzen`) },
  { re: /^Obergrenze der Auszahlung für (.+)$/, text: ([name], sprache) => sprache === "en" ? `Payout cap for ${name}` : `Obergrenze der Auszahlung für ${name}` },
  {
    re: /^Deckelung (.+) \((.*)\): Gesamtrückfluss auf Cap begrenzt$/,
    text: ([name, klasse], sprache) => (sprache === "en" ? `Cap applied to ${name} (${klasse}): total proceeds limited to the cap` : `Deckelung ${name} (${klasse}): Gesamtrückfluss auf Cap begrenzt`),
  },
  {
    re: /^NAV als Endwert am (\d{4}-\d{2}-\d{2})$/,
    text: ([datum], sprache) => (sprache === "en" ? `NAV as terminal value on ${formatDatum(datum!, sprache)}` : `NAV als Endwert am ${formatDatum(datum!, sprache)}`),
  },
  {
    re: /^Bewertung als Endwert am (\d{4}-\d{2}-\d{2})$/,
    text: ([datum], sprache) => (sprache === "en" ? `Valuation as terminal value on ${formatDatum(datum!, sprache)}` : `Bewertung als Endwert am ${formatDatum(datum!, sprache)}`),
  },
  {
    re: /^Letzte Bewertung am (\d{4}-\d{2}-\d{2}) \((\w+)\)$/,
    text: ([datum, methode], sprache) =>
      `${sprache === "en" ? "Latest valuation on" : "Letzte Bewertung am"} ${formatDatum(datum!, sprache)} (${aufzaehlung(tabelleFuer(sprache).bewertungMethode, methode!)})`,
  },
  {
    re: /^Auszahlungen \((\d+) Zahlungen, ohne aufgehobene Paare\)$/,
    text: ([anzahl], sprache) => (sprache === "en" ? `Disbursements (${anzahl} payments, excluding cancelled pairs)` : `Auszahlungen (${anzahl} Zahlungen, ohne aufgehobene Paare)`),
  },
  {
    re: /^Rückflüsse und Tilgungen \((\d+) Zahlungen\)$/,
    text: ([anzahl], sprache) => (sprache === "en" ? `Proceeds and repayments (${anzahl} payments)` : `Rückflüsse und Tilgungen (${anzahl} Zahlungen)`),
  },
  {
    re: /^Rückflüsse inkl\. gezahlter Zinsen und Dividenden \((\d+) Zahlungen\)$/,
    text: ([anzahl], sprache) => (sprache === "en" ? `Proceeds including interest paid and dividends (${anzahl} payments)` : `Rückflüsse inkl. gezahlter Zinsen und Dividenden (${anzahl} Zahlungen)`),
  },
  {
    re: /^Als Kapital zugeschlagen zum (\d{4}-\d{2}-\d{2})$/,
    text: ([datum], sprache) => (sprache === "en" ? `Added to capital on ${formatDatum(datum!, sprache)}` : `Als Kapital zugeschlagen zum ${formatDatum(datum!, sprache)}`),
  },
  {
    re: /^Zeitanteil (\S+) \((\d{4}-\d{2}-\d{2}) bis (\d{4}-\d{2}-\d{2}): ([^)]*)\)$/,
    text: ([methode, von, bis, formel], sprache) => `${sprache === "en" ? "Time fraction" : "Zeitanteil"} ${methode} (${formatDatum(von!, sprache)} ${sprache === "en" ? "to" : "bis"} ${formatDatum(bis!, sprache)}: ${formel})`,
  },
  {
    re: /^Anteil am Jahr \((\d+) \/ (\d+)\)$/,
    text: ([tage, jahr], sprache) => `${sprache === "en" ? "Share of the year" : "Anteil am Jahr"} (${tage} / ${jahr})`,
  },
  {
    re: /^Durchschnittliches Kapital (\d{4}-\d{2}-\d{2}) bis (\d{4}-\d{2}-\d{2})$/,
    text: ([von, bis], sprache) => `${sprache === "en" ? "Average capital" : "Durchschnittliches Kapital"} ${formatDatum(von!, sprache)} ${sprache === "en" ? "to" : "bis"} ${formatDatum(bis!, sprache)}`,
  },
  {
    re: /^Jahresüberschuss (\d{4})$/,
    text: ([jahr], sprache) => `${sprache === "en" ? "Annual result" : "Jahresüberschuss"} ${jahr}`,
  },
  {
    re: /^Fester Zins (\d{4}-\d{2}-\d{2}) bis (\d{4}-\d{2}-\d{2}) auf (.+)$/,
    text: ([von, bis, kapital], sprache) => `${sprache === "en" ? "Fixed interest" : "Fester Zins"} ${formatDatum(von!, sprache)} ${sprache === "en" ? "to" : "bis"} ${formatDatum(bis!, sprache)} ${sprache === "en" ? "on" : "auf"} ${formatSchrittWert(kapital!, sprache)}`,
  },
  {
    re: /^Gewinnabhängiger Zins (\d{4}) \((\d{4}-\d{2}-\d{2}) bis (\d{4}-\d{2}-\d{2})\)$/,
    text: ([jahr, von, bis], sprache) => `${sprache === "en" ? "Profit-linked interest" : "Gewinnabhängiger Zins"} ${jahr} (${formatDatum(von!, sprache)} ${sprache === "en" ? "to" : "bis"} ${formatDatum(bis!, sprache)})`,
  },
  {
    re: /^Preis mit Abschlag (.+)$/,
    text: ([abschlag], sprache) => `${sprache === "en" ? "Price with discount" : "Preis mit Abschlag"} ${formatSchrittWert(abschlag!, sprache)}`,
  },
  {
    re: /^(Zusage|Auszahlung|Rückfluss|Zins|Tilgung|Wertberichtigung|Kapitalisierung) am (\d{4}-\d{2}-\d{2})$/,
    text: ([art, datum], sprache) => `${sprache === "en" ? (({ Zusage: "Commitment", Auszahlung: "Disbursement", Rückfluss: "Proceeds", Zins: "Interest", Tilgung: "Repayment", Wertberichtigung: "Write-down", Kapitalisierung: "Capitalisation" }) as Record<string, string>)[art!] : art} ${sprache === "en" ? "on" : "am"} ${formatDatum(datum!, sprache)}`,
  },
  { re: /^kein Bestand im Sektor ([A-U])$/, text: ([sektor], sprache) => (sprache === "en" ? `no holdings in sector ${sektor}` : `kein Bestand im Sektor ${sektor}`) },
  { re: /^Durchschnitt der Quartale mit Wert \((\d+) von (\d+)\)$/, text: ([n, von], sprache) => (sprache === "en" ? `Average of the quarters with a value (${n} of ${von})` : `Durchschnitt der Quartale mit Wert (${n} von ${von})`) },
  { re: /^Gemeldete NAV zum (\d{4}-\d{2}-\d{2})$/, text: ([d], sprache) => `${sprache === "en" ? "Reported NAV as of" : "Gemeldete NAV zum"} ${formatDatum(d!, sprache)}` },
  {
    re: /^(Kapitalabrufe|Ausschüttungen) nach dem (\d{4}-\d{2}-\d{2}) bis zum (\d{4}-\d{2}-\d{2})$/,
    text: ([art, von, bis], sprache) => (sprache === "en" ? `${art === "Kapitalabrufe" ? "Capital calls" : "Distributions"} after ${formatDatum(von!, sprache)} up to ${formatDatum(bis!, sprache)}` : `${art} nach dem ${formatDatum(von!, sprache)} bis zum ${formatDatum(bis!, sprache)}`),
  },
  { re: /^NAV des Zielfonds (.+) am (\d{4}-\d{2}-\d{2}) \(durchgerechnet\)$/, text: ([name, d], sprache) => (sprache === "en" ? `NAV of the target fund ${name} on ${formatDatum(d!, sprache)} (look-through)` : `NAV des Zielfonds ${name} am ${formatDatum(d!, sprache)} (durchgerechnet)`) },
  { re: /^Anteil am Zielfonds laut Meldung zum (\d{4}-\d{2}-\d{2})$/, text: ([d], sprache) => `${sprache === "en" ? "Share of the target fund per report as of" : "Anteil am Zielfonds laut Meldung zum"} ${formatDatum(d!, sprache)}` },
  { re: /^Wert des Anteils als Endwert am (\d{4}-\d{2}-\d{2})$/, text: ([d], sprache) => `${sprache === "en" ? "Value of the interest as terminal value on" : "Wert des Anteils als Endwert am"} ${formatDatum(d!, sprache)}` },
  {
    re: /^(Zusage an einen eigenen Zielfonds|Abrufe eines eigenen Zielfonds|Ausschüttungen eines eigenen Zielfonds|Wert des Anteils an einem eigenen Zielfonds): (.+)$/,
    text: ([art, name], sprache) =>
      `${sprache === "en" ? (({ "Zusage an einen eigenen Zielfonds": "Commitment to an own target fund", "Abrufe eines eigenen Zielfonds": "Capital calls of an own target fund", "Ausschüttungen eines eigenen Zielfonds": "Distributions of an own target fund", "Wert des Anteils an einem eigenen Zielfonds": "Value of the interest in an own target fund" }) as Record<string, string>)[art!] : art}: ${name}`,
  },
  {
    re: /^Offenes Kapital ab (\d{4}-\d{2}-\d{2})$/,
    text: ([datum], sprache) => `${sprache === "en" ? "Outstanding capital from" : "Offenes Kapital ab"} ${formatDatum(datum!, sprache)}`,
  },
];

/** Rechenschritte der Nachhaltigkeitsindikatoren (Etappe 16); jeder Schritt steht hinter dem Quartalsende (`2026-03-31: …`). */
const englischPai: Record<string, string> = {
  "kein Bestand": "no holdings",
  "Summe aus Wert ÷ Unternehmenswert × Emissionen": "Sum of value ÷ enterprise value × emissions",
  "Summe aus Wert ÷ Unternehmenswert × Menge (finanzierte Menge)": "Sum of value ÷ enterprise value × quantity (financed quantity)",
  "Gesamtwert aller Beteiligungen in Mio. EUR": "Total value of all holdings in EUR million",
  "Auswirkung": "Impact",
  "Summe aus Wert × (Emissionen ÷ Umsatz in Mio. EUR)": "Sum of value × (emissions ÷ revenue in EUR million)",
  "Gesamtwert aller Beteiligungen": "Total value of all holdings",
  "Wert der Beteiligungen mit der Eigenschaft": "Value of the holdings with the property",
  "Prozent": "Percent",
  "Anteil in Prozent": "Share in percent",
  "Summe aus Wert × Angabe": "Sum of value × reported figure",
  "Wert der Beteiligungen mit Angabe": "Value of the holdings with a figure",
  "gewichteter Durchschnitt": "weighted average",
  "keine Daten": "no data",
};

/** Rechenschritte der Dachfonds und der fondsübergreifenden Summen (Rechenkern `dachfonds.ts`). */
const englischDachfonds: Record<string, string> = {
  "Zielfonds": "Target funds",
  "Anteile an Zielfonds (durchgerechnet oder fortgeschriebene NAV-Meldung)": "Interests in target funds (look-through or reported NAV rolled forward)",
  "Wert des Anteils (auf Cent gerundet)": "Value of the interest (rounded to cents)",
  "Fortgeschriebene NAV des Anteils": "NAV of the interest rolled forward",
  "Kapitalabrufe kumuliert (keine NAV-Meldung bis zum Stichtag)": "Capital calls to date (no NAV report up to the reporting date)",
  "Fortgeführte Anschaffungskosten (nicht unter null)": "Cost rolled forward (not below zero)",
  "Zusagen an den Zielfonds kumuliert": "Commitments to the target fund to date",
  "Kapitalabrufe des Zielfonds kumuliert": "Capital calls of the target fund to date",
  "Ausschüttungen des Zielfonds kumuliert": "Distributions of the target fund to date",
  "Zusagen kumuliert": "Commitments to date",
  "Kapitalabrufe kumuliert": "Capital calls to date",
  "Offene Zusage (nicht unter null)": "Unfunded commitment (not below zero)",
  "Wert des Anteils": "Value of the interest",
  "Kapitalabrufe (Valuta)": "Capital calls (value date)",
  "Ausschüttungen (Valuta)": "Distributions (value date)",
  "Zusagen der Investoren, ohne Doppelzählung": "Investor commitments, without double counting",
  "Eingezahltes Kapital, ohne Doppelzählung": "Paid-in capital, without double counting",
  "Ausschüttungen, ohne Doppelzählung": "Distributions, without double counting",
  "NAV, ohne Doppelzählung": "NAV, without double counting",
  "TVPI über alle Fonds": "TVPI across all funds",
  "DPI über alle Fonds": "DPI across all funds",
  "RVPI über alle Fonds": "RVPI across all funds",
  "Lücke": "Gap",
};

const englischMelde: Record<string, string> = {
  "Filter der Beteiligungen": "Filter of the holdings",
  "Beteiligungen im Filter (Anzahl)": "Holdings in the filter (count)",
  "Kennzahl": "KPI",
  "Szenario": "Scenario",
  "Zeitraum der Kennzahl": "Period of the KPI",
  "Beteiligungen mit Wert (Anzahl)": "Holdings with a value (count)",
  "Beteiligungen ohne Wert, nicht gezählt (Anzahl)": "Holdings without a value, not counted (count)",
  "Summe über die Beteiligungen": "Total across the holdings",
  "Durchschnitt über die Beteiligungen": "Average across the holdings",
  "Minimum über die Beteiligungen": "Minimum across the holdings",
  "Maximum über die Beteiligungen": "Maximum across the holdings",
  "Anzahl der Beteiligungen mit Wert": "Number of holdings with a value",
  "Anzahl der Beteiligungen mit Ja": "Number of holdings with yes",
  "Kein Wert vorhanden (k. A.)": "No value available (n/a)",
  "Vorgangsarten": "Transaction types",
  "Zeitraum der Vorgänge": "Period of the transactions",
  "Anzahl der Vorgänge (inklusive Stornos)": "Number of transactions (including reversals)",
  "Anzahl der gültigen Vorgänge (ohne Stornos und stornierte)": "Number of valid transactions (excluding reversals and reversed ones)",
  "Summe der Vorgänge nach Storno": "Total of the transactions after reversals",
  "Vorzeichen umgekehrt": "Sign reversed",
  "Kapitalbewegungen des Fonds (Anzahl)": "Capital movements of the fund (count)",
  "Summe der Kapitalbewegungen des Fonds": "Total of the capital movements of the fund",
  "Stichtag des Bestands": "Reporting date of the position",
  "Zusagen bis zum Stichtag": "Commitments up to the reporting date",
  "Auszahlungen nach Storno bis zum Stichtag": "Disbursements after reversals up to the reporting date",
  "Rückflüsse und Tilgungen bis zum Stichtag": "Proceeds and repayments up to the reporting date",
  "Rückflüsse, Tilgungen, gezahlte Zinsen und Dividenden bis zum Stichtag": "Proceeds, repayments, interest paid and dividends up to the reporting date",
  "Offene Zusage (Zusagen minus Auszahlungen)": "Unfunded commitment (commitments minus disbursements)",
  "Beteiligungen mit Wertansatz zum Stichtag (Anzahl)": "Holdings with a valuation at the reporting date (count)",
  "Offene Kaufpreisforderungen": "Open purchase price receivables",
  "Wertansatz (Summe der letzten Bewertungen)": "Valuation (sum of the latest valuations)",
  "Beteiligungen mit Erstinvestment bis zum Stichtag": "Holdings with first investment up to the reporting date",
  "Beteiligungen mit Erstinvestment im Berichtszeitraum": "Holdings with first investment in the reporting period",
  "Stammdatenfeld": "Master data field",
  "Schlüsselfeld der Beteiligung": "Key field of the holding",
  "Operand": "Operand",
  "Summe der Operanden": "Sum of the operands",
  "Erster Operand minus die übrigen": "First operand minus the others",
  "Produkt der Operanden": "Product of the operands",
  "Erster Operand geteilt durch den zweiten": "First operand divided by the second",
  "Erster Operand geteilt durch den zweiten, in Prozent": "First operand divided by the second, in percent",
  "Division durch null, kein Wert (k. A.)": "Division by zero, no value (n/a)",
  "Ein Operand hat keinen Wert, kein Wert (k. A.)": "An operand has no value, no value (n/a)",
  "Eingabe von Hand": "Manual entry",
  "Summe über die Zeilen der Tabelle": "Total across the rows of the table",
  "Zeilen mit Wert (Anzahl)": "Rows with a value (count)",
};

export function uebersetzeSchritt(text: string, sprache: Sprache): string {
  for (const { re, text: setze } of praefixe) {
    const treffer = re.exec(text);
    if (treffer) return setze(treffer.slice(1), sprache) + uebersetzeSchritt(text.slice(treffer[0].length), sprache);
  }
  for (const { re, text: setze } of muster) {
    const treffer = re.exec(text);
    if (treffer) return setze(treffer.slice(1), sprache);
  }
  const treffer = sprache === "en" ? (englisch[text] ?? englischMelde[text] ?? englischPai[text] ?? englischDachfonds[text] ?? text) : text;
  return treffer.replace(datumsMuster, (d) => formatDatum(d, sprache));
}

const LOCALE: Record<Sprache, string> = { de: "de-DE", en: "en-GB" };
const dezimal = /^-?\d+(\.\d+)?$/;

/** Dezimalzeichenketten des Rechenkerns für die Anzeige: Tausendertrennung, höchstens vier Nachkommastellen. */
export function formatSchrittWert(wert: string, sprache: Sprache): string {
  if (!dezimal.test(wert)) return uebersetzeSchritt(wert, sprache);
  return new Intl.NumberFormat(LOCALE[sprache], { maximumFractionDigits: 4 }).format(Number(wert));
}
