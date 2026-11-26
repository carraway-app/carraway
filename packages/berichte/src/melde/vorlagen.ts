import type { DefinitionInhalt, Feld, Filter } from "./definition";

/**
 * Mitgelieferte Meldedefinitionen. Alle sind Vorlagen, fachlich zu prüfen: Sie zeigen den Aufbau, ersetzen aber keine amtliche Formularvorgabe.
 * Die Datenbank-Migration legt sie als Version 1 an (`0030_meldewesen`); ein Test hält Migration und diese Konstanten gleich.
 * Änderungen an einer ausgelieferten Definition sind eine neue Version (neue Migration), nie eine Änderung dieser Version.
 */

export interface MitgelieferteDefinition {
  schluessel: string;
  version: number;
  bezeichnungDe: string;
  bezeichnungEn: string;
  herausgeber: string;
  rhythmus: "quartal" | "halbjahr" | "jahr" | "stichtag";
  format: "xlsx" | "csv" | "pdf" | "xml";
  gueltigAb: string;
  definition: DefinitionInhalt;
}

const t = (de: string, en: string) => ({ de, en });
const HERAUSGEBER = "Carraway (Vorlage)";

const betrag = (id: string, de: string, en: string, quelle: Feld["quelle"], extra: Partial<Feld> = {}): Feld => ({ id, bezeichnung: t(de, en), einheit: "EUR", format: "betrag", quelle, ...extra });
const zahl = (id: string, de: string, en: string, quelle: Feld["quelle"], extra: Partial<Feld> = {}): Feld => ({ id, bezeichnung: t(de, en), format: "ganzzahl", quelle, ...extra });
const textFeld = (id: string, de: string, en: string, quelle: Feld["quelle"], extra: Partial<Feld> = {}): Feld => ({ id, bezeichnung: t(de, en), format: "text", quelle, ...extra });
const stamm = (feld: string): Feld["quelle"] => ({ art: "stammdaten", feld: feld as never });
const vorgang = (arten: string[], zeitraum: "periode" | "kumuliert"): Feld["quelle"] => ({ art: "vorgang", vorgangsarten: arten as never, zeitraum, aggregation: "summe", negieren: false });
const bestand = (groesse: string): Feld["quelle"] => ({ art: "bestand", groesse: groesse as never });
const anzahl = (umfang: "bestand" | "neu" = "bestand"): Feld["quelle"] => ({ art: "beteiligungsanzahl", umfang });

const VORLAGE_HINWEIS = t(
  "Vorlage, fachlich zu prüfen. Die Definition zeigt den Aufbau der Meldung und ersetzt keine Formularvorgabe des Empfängers.",
  "Template, subject to professional review. The definition shows the structure of the report and does not replace a form specification of the recipient.",
);

// (a) Förderbericht je Quartal ------------------------------------------------------------------------------------

const foerderbericht: DefinitionInhalt = {
  schema: 1,
  hinweis: VORLAGE_HINWEIS,
  abschnitte: [
    {
      id: "stammdaten",
      typ: "felder",
      titel: t("Stammdaten", "Master data"),
      felder: [
        textFeld("fonds_name", "Fonds", "Fund", stamm("fonds.name")),
        textFeld("fonds_waehrung", "Währung", "Currency", stamm("fonds.waehrung")),
        textFeld("programm", "Förderprogramm", "Funding programme", stamm("programm.bezeichnung")),
        { id: "zeitraum_beginn", bezeichnung: t("Beginn des Berichtszeitraums", "Start of the reporting period"), format: "datum", quelle: stamm("periode.beginn") },
        { id: "zeitraum_ende", bezeichnung: t("Ende des Berichtszeitraums", "End of the reporting period"), format: "datum", quelle: stamm("periode.ende") },
        textFeld("verantwortlich", "Verantwortliche Person für die Meldung", "Person responsible for the report", { art: "manuell" }, { pflicht: true }),
      ],
    },
    {
      id: "mittelabruf",
      typ: "felder",
      titel: t("Mittelabruf", "Drawdown of funds"),
      felder: [
        betrag("abrufe_periode", "Kapitalabrufe im Berichtszeitraum", "Capital calls in the reporting period", { art: "fondsbewegung", bewegung: "abruf", zeitraum: "periode" }),
        betrag("abrufe_kumuliert", "Kapitalabrufe kumuliert", "Capital calls to date", { art: "fondsbewegung", bewegung: "abruf", zeitraum: "kumuliert" }),
        betrag("zeichnungskapital", "Zeichnungskapital des Fonds", "Subscribed capital of the fund", stamm("fonds.zeichnungskapital")),
        betrag("noch_nicht_abgerufen", "Noch nicht abgerufen", "Not yet called", { art: "berechnet", operation: "differenz", felder: ["zeichnungskapital", "abrufe_kumuliert"] }),
      ],
    },
    {
      id: "mittelverwendung",
      typ: "felder",
      titel: t("Mittelverwendung", "Use of funds"),
      felder: [
        betrag("zusagen_periode", "Zusagen an Unternehmen im Berichtszeitraum", "Commitments to companies in the reporting period", vorgang(["zusage"], "periode")),
        betrag("auszahlungen_periode", "Auszahlungen an Unternehmen im Berichtszeitraum", "Disbursements to companies in the reporting period", vorgang(["auszahlung"], "periode")),
        betrag("zusagen_kumuliert", "Zusagen kumuliert", "Commitments to date", vorgang(["zusage"], "kumuliert")),
        betrag("auszahlungen_kumuliert", "Auszahlungen kumuliert", "Disbursements to date", vorgang(["auszahlung"], "kumuliert")),
        betrag("offene_zusage", "Offene Zusagen", "Open commitments", bestand("offene_zusage")),
        zahl("anzahl_beteiligungen", "Beteiligungen im Bestand", "Holdings in the portfolio", anzahl("bestand")),
        zahl("neue_beteiligungen", "Neue Beteiligungen im Berichtszeitraum", "New holdings in the reporting period", anzahl("neu")),
      ],
    },
    {
      id: "rueckfluesse",
      typ: "felder",
      titel: t("Rückflüsse", "Returns"),
      felder: [
        betrag("rueckfluesse_periode", "Rückflüsse und Tilgungen im Berichtszeitraum", "Proceeds and repayments in the reporting period", vorgang(["rueckfluss", "tilgung"], "periode")),
        betrag("zinsen_periode", "Gebuchte Zinsen im Berichtszeitraum", "Interest booked in the reporting period", vorgang(["zins"], "periode")),
        betrag("rueckfluesse_kumuliert", "Rückflüsse und Tilgungen kumuliert", "Proceeds and repayments to date", vorgang(["rueckfluss", "tilgung"], "kumuliert")),
        betrag("ausschuettungen_periode", "Ausschüttungen des Fonds im Berichtszeitraum", "Distributions of the fund in the reporting period", { art: "fondsbewegung", bewegung: "ausschuettung", zeitraum: "periode" }),
        betrag("ausschuettungen_kumuliert", "Ausschüttungen des Fonds kumuliert", "Distributions of the fund to date", { art: "fondsbewegung", bewegung: "ausschuettung", zeitraum: "kumuliert" }),
      ],
    },
    {
      id: "portfolio_programm",
      typ: "tabelle",
      titel: t("Portfolio je Förderprogramm", "Portfolio by funding programme"),
      je: "programm",
      spalten: [
        textFeld("programm", "Förderprogramm", "Funding programme", stamm("gruppe.bezeichnung")),
        zahl("anzahl", "Beteiligungen", "Holdings", anzahl("bestand"), { summe: true }),
        betrag("zusagen", "Zusagen", "Commitments", bestand("zusage"), { summe: true }),
        betrag("investiert", "Investiert", "Invested", bestand("investiert"), { summe: true }),
        betrag("rueckfluesse", "Rückflüsse", "Proceeds", bestand("rueckfluesse"), { summe: true }),
        betrag("buchwert", "Buchwert", "Carrying amount", bestand("buchwert"), { summe: true }),
      ],
    },
    {
      id: "erlaeuterung",
      typ: "felder",
      titel: t("Erläuterung", "Commentary"),
      felder: [textFeld("erlaeuterung_text", "Erläuterung zum Berichtszeitraum", "Commentary on the reporting period", { art: "manuell" })],
    },
  ],
  regeln: [
    {
      id: "tabelle_gleich_feld",
      art: "vergleich",
      schwere: "fehler",
      links: "portfolio_programm.investiert",
      operator: "=",
      rechts: "auszahlungen_kumuliert",
      toleranz: "0.01",
      meldung: t("Die Summe der Tabelle „Portfolio je Förderprogramm“ weicht von den kumulierten Auszahlungen ab.", "The total of the table “Portfolio by funding programme” differs from the disbursements to date."),
    },
    {
      id: "auszahlungen_ueber_abrufen",
      art: "vergleich",
      schwere: "warnung",
      links: "auszahlungen_kumuliert",
      operator: "<=",
      rechts: "abrufe_kumuliert",
      meldung: t("Die kumulierten Auszahlungen liegen über den kumulierten Kapitalabrufen.", "Disbursements to date exceed capital calls to date."),
    },
    {
      id: "abruf_ueber_zeichnung",
      art: "bereich",
      schwere: "warnung",
      feld: "noch_nicht_abgerufen",
      minimum: "0",
      meldung: t("Die Kapitalabrufe übersteigen das Zeichnungskapital.", "Capital calls exceed the subscribed capital."),
    },
    { id: "erlaeuterung_fehlt", art: "pflicht", schwere: "warnung", felder: ["erlaeuterung_text"], meldung: t("Es ist keine Erläuterung zum Berichtszeitraum erfasst.", "No commentary on the reporting period has been entered.") },
  ],
};

// (b) EFRE-Indikatorbericht ---------------------------------------------------------------------------------------

const PLATZHALTER = t(
  "Platzhalter: Der Indikatorcode (RCO oder RCR) ist nicht hinterlegt und vom Programm festzulegen.",
  "Placeholder: the indicator code (RCO or RCR) is not stored and is to be set by the programme.",
);
const FOERDERMITTEL: Filter = { mittelart: ["foerdermittel"] };
const KOFINANZIERUNG: Filter = { mittelart: ["kofinanzierung"] };

const efre: DefinitionInhalt = {
  schema: 1,
  hinweis: t(
    "Vorlage, fachlich zu prüfen. Aufbau angelehnt an die Berichtspflichten der Verordnung (EU) 2021/1060 (Finanzinstrumente Artikel 58 bis 60 und 68, Daten je Vorhaben Anhang XVII). Indikatorcodes (RCO, RCR) sind nicht hinterlegt; die Länder und Programme nutzen eigene Systeme und Vorgaben.",
    "Template, subject to professional review. Structure based on the reporting obligations of Regulation (EU) 2021/1060 (financial instruments Articles 58 to 60 and 68, data per operation Annex XVII). Indicator codes (RCO, RCR) are not stored; member states and programmes use their own systems and specifications.",
  ),
  abschnitte: [
    {
      id: "stammdaten",
      typ: "felder",
      titel: t("Stammdaten", "Master data"),
      felder: [
        textFeld("fonds_name", "Finanzinstrument (Fonds)", "Financial instrument (fund)", stamm("fonds.name")),
        textFeld("programm", "Programm", "Programme", stamm("programm.bezeichnung")),
        { id: "zeitraum_beginn", bezeichnung: t("Beginn des Berichtszeitraums", "Start of the reporting period"), format: "datum", quelle: stamm("periode.beginn") },
        { id: "zeitraum_ende", bezeichnung: t("Ende des Berichtszeitraums", "End of the reporting period"), format: "datum", quelle: stamm("periode.ende") },
      ],
    },
    {
      id: "finanzinstrument",
      typ: "felder",
      titel: t("Finanzinstrument", "Financial instrument"),
      felder: [
        betrag("an_endempfaenger_kumuliert", "An Endempfänger ausgezahlte Mittel kumuliert", "Funds paid out to final recipients to date", vorgang(["auszahlung"], "kumuliert")),
        betrag("zusagen_kumuliert", "Zusagen an Endempfänger kumuliert", "Commitments to final recipients to date", vorgang(["zusage"], "kumuliert")),
        betrag("rueckfluesse_kumuliert", "Rückflüsse und Tilgungen kumuliert", "Returns and repayments to date", vorgang(["rueckfluss", "tilgung"], "kumuliert")),
        betrag("zinsen_periode", "Gebuchte Zinsen im Berichtszeitraum", "Interest booked in the reporting period", vorgang(["zins"], "periode")),
        betrag("foerdermittel_periode", "Auszahlungen aus Fördermitteln im Berichtszeitraum", "Disbursements from grant funds in the reporting period", vorgang(["auszahlung"], "periode"), { filter: FOERDERMITTEL }),
        betrag("kofinanzierung_periode", "Auszahlungen aus Kofinanzierungsmitteln im Berichtszeitraum", "Disbursements from co-financing in the reporting period", vorgang(["auszahlung"], "periode"), { filter: KOFINANZIERUNG }),
      ],
    },
    {
      id: "indikatoren",
      typ: "felder",
      titel: t("Indikatoren (Platzhalter)", "Indicators (placeholders)"),
      felder: [
        zahl("ind_output_unternehmen", "Unterstützte Unternehmen (Outputindikator)", "Enterprises supported (output indicator)", anzahl("bestand"), { hinweis: PLATZHALTER }),
        zahl("ind_output_darlehen", "davon mit Darlehen unterstützt", "of which supported by loans", anzahl("bestand"), { filter: { instrument: ["darlehen", "wandeldarlehen"] }, hinweis: PLATZHALTER }),
        zahl("ind_output_eigenkapital", "davon mit Beteiligungskapital unterstützt", "of which supported by equity", anzahl("bestand"), { filter: { instrument: ["offene_beteiligung", "stille_beteiligung", "safe", "optionsschein"] }, hinweis: PLATZHALTER }),
        zahl("ind_output_neu", "Im Berichtszeitraum neu unterstützte Unternehmen", "Enterprises newly supported in the reporting period", anzahl("neu"), { hinweis: PLATZHALTER }),
        {
          id: "ind_ergebnis_beschaeftigte",
          bezeichnung: t("Beschäftigte der unterstützten Unternehmen (Vollzeitäquivalente, Ergebnisindikator)", "Employees of the supported enterprises (full-time equivalents, result indicator)"),
          format: "zahl",
          quelle: { art: "kennzahl", schluessel: "mitarbeitende_vzae", szenario: "ist", zeitraum: "letzter", aggregation: "summe" },
          hinweis: PLATZHALTER,
        },
        betrag("ind_ergebnis_umsatz", "Umsatz der unterstützten Unternehmen im Berichtszeitraum", "Revenue of the supported enterprises in the reporting period", { art: "kennzahl", schluessel: "umsatz", szenario: "ist", zeitraum: "periode", aggregation: "summe" }, { hinweis: PLATZHALTER }),
        betrag("ind_investition_privat", "Private Investitionen als Ergänzung der öffentlichen Unterstützung", "Private investments matching public support", { art: "manuell" }, { hinweis: PLATZHALTER }),
      ],
    },
    {
      id: "vorhaben",
      typ: "tabelle",
      titel: t("Daten je Vorhaben (Auswahl, Anhang XVII)", "Data per operation (selection, Annex XVII)"),
      je: "beteiligung",
      sortierung: { spalte: "unternehmen", richtung: "auf" },
      spalten: [
        textFeld("projektnummer", "Projektnummer", "Project number", { art: "schluessel", feld: "projektnummer" }),
        textFeld("vertragsnummer", "Vertragsnummer", "Contract number", { art: "schluessel", feld: "vertragsnummer" }),
        textFeld("partnernummer", "Partnernummer", "Partner number", { art: "schluessel", feld: "partnernummer" }),
        textFeld("unternehmen", "Endempfänger", "Final recipient", stamm("organisation.name")),
        textFeld("sitzland", "Sitzland", "Country of seat", stamm("organisation.sitzland")),
        textFeld("region", "Region", "Region", stamm("organisation.region")),
        textFeld("instrument", "Instrument", "Instrument", stamm("beteiligung.instrument")),
        textFeld("mittelart", "Mittelart", "Type of funds", stamm("foerderung.mittelart")),
        { id: "erstinvestment", bezeichnung: t("Erstinvestment", "First investment"), format: "datum", quelle: stamm("beteiligung.erstinvestment") },
        betrag("zusage", "Zusage", "Commitment", bestand("zusage"), { summe: true }),
        betrag("investiert", "Ausgezahlt", "Paid out", bestand("investiert"), { summe: true }),
        betrag("rueckfluesse", "Rückflüsse", "Returns", bestand("rueckfluesse"), { summe: true }),
      ],
    },
  ],
  regeln: [
    {
      id: "vorhaben_gleich_finanzinstrument",
      art: "vergleich",
      schwere: "fehler",
      links: "vorhaben.investiert",
      operator: "=",
      rechts: "an_endempfaenger_kumuliert",
      toleranz: "0.01",
      meldung: t("Die Summe der Vorhaben weicht von den kumulierten Auszahlungen an Endempfänger ab.", "The total of the operations differs from the funds paid out to final recipients to date."),
    },
    { id: "privat_fehlt", art: "pflicht", schwere: "warnung", felder: ["ind_investition_privat"], meldung: t("Die privaten Investitionen sind nicht erfasst.", "Private investments have not been entered.") },
  ],
};

// (c) Bundesbank-Struktur ------------------------------------------------------------------------------------------

const bundesbank: DefinitionInhalt = {
  schema: 1,
  hinweis: t(
    "Strukturelle Vorbereitung entlang der Bundesbank-Statistik über Investmentvermögen (Formulare 10390 bis 10392), keine Zusicherung der Meldefähigkeit und kein amtliches Meldeformat. Die Zuordnung der Beteiligungen zu den Positionen 61 bis 63 ist nicht hinterlegt und mit dem Empfänger zu klären; Vorlage, fachlich zu prüfen.",
    "Structural preparation along the Bundesbank statistics on investment funds (forms 10390 to 10392); no assurance of filing capability and not an official reporting format. The assignment of holdings to positions 61 to 63 is not stored and is to be agreed with the recipient; template, subject to professional review.",
  ),
  abschnitte: [
    {
      id: "stammdaten",
      typ: "felder",
      titel: t("Stammdaten je Investmentvermögen (Struktur zu Formular 10390)", "Master data per investment fund (structure for form 10390)"),
      felder: [
        textFeld("fonds_name", "Bezeichnung des Investmentvermögens", "Name of the investment fund", stamm("fonds.name")),
        textFeld("fonds_kurzname", "Kurzbezeichnung", "Short name", stamm("fonds.kurzname")),
        textFeld("waehrung", "Währung", "Currency", stamm("fonds.waehrung")),
        { id: "auflagejahr", bezeichnung: t("Auflagejahr", "Year of launch"), format: "ganzzahl", quelle: stamm("fonds.vintage") },
        { id: "stichtag", bezeichnung: t("Stichtag", "Reporting date"), format: "datum", quelle: stamm("periode.ende") },
        textFeld("kennung", "Kennung beim Empfänger", "Identifier at the recipient", { art: "manuell" }, { pflicht: true }),
      ],
    },
    {
      id: "positionen",
      typ: "tabelle",
      titel: t("Bestand je Instrument (Zuordnung zu den Positionen offen)", "Holdings by instrument (assignment to positions open)"),
      je: "instrument",
      spalten: [
        textFeld("instrument", "Instrument", "Instrument", stamm("gruppe.bezeichnung")),
        zahl("anzahl", "Beteiligungen", "Holdings", anzahl("bestand"), { summe: true }),
        betrag("buchwert", "Buchwert", "Carrying amount", bestand("buchwert"), { summe: true }),
        betrag("wertansatz", "Wertansatz", "Valuation", bestand("bewertung"), { summe: true }),
      ],
    },
    {
      id: "bestand",
      typ: "tabelle",
      titel: t("Beteiligungsbestand", "Holdings"),
      je: "beteiligung",
      sortierung: { spalte: "unternehmen", richtung: "auf" },
      spalten: [
        textFeld("unternehmen", "Unternehmen", "Company", stamm("organisation.name")),
        textFeld("sitzland", "Sitzland", "Country of seat", stamm("organisation.sitzland")),
        textFeld("branche", "Branche", "Sector", stamm("organisation.sektor")),
        textFeld("instrument", "Instrument", "Instrument", stamm("beteiligung.instrument")),
        { id: "erstinvestment", bezeichnung: t("Erstinvestment", "First investment"), format: "datum", quelle: stamm("beteiligung.erstinvestment") },
        betrag("buchwert", "Buchwert", "Carrying amount", bestand("buchwert"), { summe: true }),
        betrag("wertansatz", "Wertansatz", "Valuation", bestand("bewertung"), { summe: true }),
      ],
    },
  ],
  regeln: [
    {
      id: "bestand_gleich_positionen",
      art: "vergleich",
      schwere: "fehler",
      links: "bestand.buchwert",
      operator: "=",
      rechts: "positionen.buchwert",
      toleranz: "0.01",
      meldung: t("Die Summe des Beteiligungsbestands weicht von der Summe je Instrument ab.", "The total of the holdings differs from the total by instrument."),
    },
  ],
};

export const STANDARD_MELDEDEFINITIONEN: readonly MitgelieferteDefinition[] = [
  {
    schluessel: "foerderbericht_quartal",
    version: 1,
    bezeichnungDe: "Förderbericht je Quartal (Vorlage)",
    bezeichnungEn: "Funding report per quarter (template)",
    herausgeber: HERAUSGEBER,
    rhythmus: "quartal",
    format: "xlsx",
    gueltigAb: "2026-01-01",
    definition: foerderbericht,
  },
  {
    schluessel: "efre_indikatoren",
    version: 1,
    bezeichnungDe: "EFRE-Indikatorbericht (Vorlage)",
    bezeichnungEn: "ERDF indicator report (template)",
    herausgeber: HERAUSGEBER,
    rhythmus: "jahr",
    format: "xlsx",
    gueltigAb: "2026-01-01",
    definition: efre,
  },
  {
    schluessel: "bundesbank_beteiligungsbestand",
    version: 1,
    bezeichnungDe: "Beteiligungsbestand für die Bundesbank-Statistik (Strukturvorbereitung)",
    bezeichnungEn: "Holdings for the Bundesbank statistics (structural preparation)",
    herausgeber: HERAUSGEBER,
    rhythmus: "stichtag",
    format: "xlsx",
    gueltigAb: "2026-01-01",
    definition: bundesbank,
  },
];
