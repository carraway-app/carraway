/**
 * Aufbau der Importvorlage: Blätter, Spalten, Typen und die Beschriftungen in beiden Sprachen. Die Vorlage, der Leser und die
 * Prüfregeln lesen alle aus dieser einen Beschreibung. Intern heißen Blätter und Spalten deutsch (`schluessel`); die englische
 * Vorlage nennt dieselben Spalten anders, der Leser versteht beide.
 */

export type Sprache = "de" | "en";
export const SPRACHEN: readonly Sprache[] = ["de", "en"];

export const BLAETTER = [
  "fonds",
  "organisationen",
  "personen",
  "beteiligungen",
  "finanzierungsrunden",
  "rundenpositionen",
  "vorgaenge",
  "bewertungen",
  "konditionen",
  "fondsbewegungen",
  "kontrollsummen",
] as const;
export type Blatt = (typeof BLAETTER)[number];

/** Namen der Blätter je Sprache (Excel: höchstens 31 Zeichen, ohne `: \ / ? * [ ]`). */
export const BLATT_NAMEN: Record<Blatt, Record<Sprache, string>> = {
  fonds: { de: "Fonds", en: "Funds" },
  organisationen: { de: "Organisationen", en: "Organisations" },
  personen: { de: "Personen", en: "Persons" },
  beteiligungen: { de: "Beteiligungen", en: "Holdings" },
  finanzierungsrunden: { de: "Finanzierungsrunden", en: "Financing rounds" },
  rundenpositionen: { de: "Rundenpositionen", en: "Round positions" },
  vorgaenge: { de: "Vorgänge", en: "Transactions" },
  bewertungen: { de: "Bewertungen", en: "Valuations" },
  konditionen: { de: "Konditionen", en: "Terms" },
  fondsbewegungen: { de: "Fondsbewegungen", en: "Fund movements" },
  kontrollsummen: { de: "Kontrollsummen", en: "Control totals" },
};

export const ANLEITUNG_NAMEN: Record<Sprache, string> = { de: "Anleitung", en: "Instructions" };

export type Typ =
  | "text"
  | "betrag" // größer als null, höchstens zwei Nachkommastellen
  | "betragOhneNull" // null oder größer, höchstens zwei Nachkommastellen
  | "betragVorzeichen" // ungleich null, mit Vorzeichen
  | "preis" // höchstens vier Nachkommastellen, größer als null
  | "ganzzahl" // nicht negativ
  | "satz" // Anteil von 0 bis 1 (0,06 = 6 %), höchstens sechs Nachkommastellen
  | "datum"
  | "jaNein"
  | "email"
  | "url"
  | "uuid"
  | "waehrung"
  | "enum";

/** Ein Wert einer Auswahlliste: der interne Wert und die Beschriftung je Sprache. */
export interface Auswahl {
  wert: string;
  de: string;
  en: string;
}

export interface Spalte {
  schluessel: string;
  /** Spaltenkopf in der englischen Vorlage. */
  en: string;
  typ: Typ;
  pflicht: boolean;
  auswahl?: readonly Auswahl[];
  /** Erklärung (Notiz an der Kopfzelle und Anleitung). */
  hinweis: Record<Sprache, string>;
}

const a = (wert: string, de: string, en: string): Auswahl => ({ wert, de, en });

export const AUSWAHL = {
  organisationArt: [a("unternehmen", "Unternehmen", "company"), a("investor", "Investor", "investor"), a("berater", "Berater", "advisor"), a("sonstige", "Sonstige", "other")],
  instrument: [
    a("offene_beteiligung", "offene Beteiligung", "equity"),
    a("stille_beteiligung", "stille Beteiligung", "silent partnership"),
    a("darlehen", "Darlehen", "loan"),
    a("wandeldarlehen", "Wandeldarlehen", "convertible loan"),
    a("venture_debt", "Venture Debt", "venture debt"),
    a("gesellschafterdarlehen", "Gesellschafterdarlehen", "shareholder loan"),
  ],
  beteiligungStatus: [a("aktiv", "aktiv", "active"), a("exit", "Exit", "exit"), a("insolvent", "insolvent", "insolvent"), a("abgeschrieben", "abgeschrieben", "written off")],
  vorgangArt: [
    a("zusage", "Zusage", "commitment"),
    a("auszahlung", "Auszahlung", "disbursement"),
    a("rueckfluss", "Rückfluss", "distribution"),
    a("zins", "Zins", "interest"),
    a("zinszahlung", "Zinszahlung", "interest payment"),
    a("dividende", "Dividende", "dividend"),
    a("tilgung", "Tilgung", "repayment"),
    a("wertberichtigung", "Wertberichtigung", "write-down"),
  ],
  bewertungMethode: [
    a("anschaffungskosten", "Anschaffungskosten", "cost"),
    a("letzte_runde", "letzte Runde", "last round"),
    a("multiplikator", "Multiplikator", "multiple"),
    a("dcf", "DCF", "DCF"),
    a("sonstige", "Sonstige", "other"),
  ],
  rundenRolle: [a("lead", "Lead", "lead"), a("co_lead", "Co-Lead", "co-lead"), a("co", "Co", "co")],
  fondsBewegungArt: [a("abruf", "Abruf", "capital call"), a("ausschuettung", "Ausschüttung", "distribution")],
  zinsmethode: [a("30E/360", "30E/360", "30E/360"), a("act/360", "act/360", "act/360"), a("act/365", "act/365", "act/365"), a("act/act", "act/act", "act/act")],
  zinsperiode: [a("jaehrlich", "jährlich", "annual"), a("quartalsweise", "quartalsweise", "quarterly"), a("endfaellig", "endfällig", "at maturity")],
  kontrollGroesse: [
    a("zusagen", "Zusagen", "commitments"),
    a("auszahlungen", "Auszahlungen", "disbursements"),
    a("rueckfluesse", "Rückflüsse", "distributions"),
    a("nav", "NAV", "NAV"),
    a("zeichnungskapital", "Zeichnungskapital", "subscribed capital"),
  ],
  jaNein: [a("ja", "ja", "yes"), a("nein", "nein", "no")],
} as const satisfies Record<string, readonly Auswahl[]>;

const s = (
  schluessel: string,
  en: string,
  typ: Typ,
  pflicht: boolean,
  de: string,
  enHinweis: string,
  auswahl?: readonly Auswahl[],
): Spalte => ({ schluessel, en, typ, pflicht, hinweis: { de, en: enHinweis }, ...(auswahl ? { auswahl } : {}) });

export const SPALTEN: Record<Blatt, readonly Spalte[]> = {
  fonds: [
    s("fonds_kurzname", "fund_short_name", "text", true, "Eindeutiger Kurzname des Fonds; so verweisen die anderen Blätter auf den Fonds.", "Unique short name of the fund; other sheets refer to the fund by it."),
    s("name", "name", "text", true, "Vollständiger Name des Fonds.", "Full name of the fund."),
    s("vintage", "vintage", "ganzzahl", true, "Auflagejahr, z. B. 2021.", "Vintage year, e.g. 2021."),
    s("zeichnungskapital", "subscribed_capital", "betrag", true, "Zeichnungskapital in der Fondswährung, höchstens zwei Nachkommastellen.", "Subscribed capital in the fund currency, at most two decimals."),
    s("waehrung", "currency", "waehrung", false, "Währung als dreibuchstabiger Code, Standard EUR.", "Currency as a three-letter code, default EUR."),
  ],
  organisationen: [
    s("organisation_schluessel", "organisation_key", "text", true, "Eigener, dauerhafter Schlüssel der Organisation (z. B. Nummer aus dem Altsystem). Er macht den Import wiederholbar.", "Your own stable key for the organisation (e.g. an ID from the legacy system). It makes the import repeatable."),
    s("name", "name", "text", true, "Name der Organisation.", "Name of the organisation."),
    s("art", "type", "enum", true, "Art der Organisation.", "Type of organisation.", AUSWAHL.organisationArt),
    s("sektor", "sector", "text", false, "Branche oder Sektor.", "Industry or sector."),
    s("ort", "city", "text", false, "Ort.", "City."),
    s("website", "website", "url", false, "Adresse mit http:// oder https://.", "Address starting with http:// or https://."),
    s("bestehende_id", "existing_id", "uuid", false, "Nur bei einer Dublettenmeldung: ID der bereits vorhandenen Organisation, auf die dieser Schlüssel zeigen soll.", "Only after a duplicate finding: ID of the existing organisation this key should point to."),
    s("dublette_bestaetigt", "duplicate_confirmed", "jaNein", false, "„ja“, wenn trotz ähnlichem Namen eine neue Organisation entstehen soll.", "“yes” if a new organisation should be created despite a similar name.", AUSWAHL.jaNein),
  ],
  personen: [
    s("person_schluessel", "person_key", "text", true, "Eigener, dauerhafter Schlüssel der Person.", "Your own stable key for the person."),
    s("vorname", "first_name", "text", true, "Vorname.", "First name."),
    s("nachname", "last_name", "text", true, "Nachname.", "Last name."),
    s("email", "email", "email", false, "E-Mail-Adresse.", "Email address."),
    s("funktion", "role", "text", false, "Funktion im Unternehmen.", "Role in the company."),
    s("organisation_schluessel", "organisation_key", "text", false, "Schlüssel der Organisation der Person.", "Key of the person's organisation."),
  ],
  beteiligungen: [
    s("beteiligung_schluessel", "holding_key", "text", true, "Eigener, dauerhafter Schlüssel der Beteiligung; Vorgänge, Bewertungen und Konditionen verweisen darauf.", "Your own stable key for the holding; transactions, valuations and terms refer to it."),
    s("fonds_kurzname", "fund_short_name", "text", true, "Kurzname des Fonds (Blatt Fonds oder bereits vorhanden).", "Short name of the fund (sheet Funds or already present)."),
    s("organisation_schluessel", "organisation_key", "text", true, "Schlüssel der Organisation, an der der Fonds beteiligt ist.", "Key of the organisation the fund holds."),
    s("instrument", "instrument", "enum", true, "Art des Instruments dieser Zeile. Hat der Fonds am Unternehmen mehrere Instrumente, steht für jedes eine Zeile (eigener Schlüssel, gleicher Fonds und gleiche Organisation); die Beteiligung selbst gibt es nur einmal je Fonds und Unternehmen.", "Type of the instrument in this row. If the fund holds several instruments in the company, enter one row per instrument (own key, same fund and organisation); the holding itself exists once per fund and company.", AUSWAHL.instrument),
    s("bezeichnung", "label", "text", false, "Bezeichnung des Instruments, z. B. „Wandeldarlehen 2024“; Vorgabe ist die Art. Nötig, wenn dieselbe Art mehrfach vorkommt.", "Label of the instrument, e.g. “Convertible loan 2024”; defaults to the type. Needed if the same type occurs more than once."),
    s("erstinvestment", "first_investment", "datum", true, "Datum des Erstinvestments (JJJJ-MM-TT oder TT.MM.JJJJ).", "Date of the first investment (YYYY-MM-DD or DD.MM.YYYY)."),
    s("status", "status", "enum", false, "Stand der Beteiligung, Standard aktiv.", "State of the holding, default active.", AUSWAHL.beteiligungStatus),
  ],
  finanzierungsrunden: [
    s("runde_schluessel", "round_key", "text", true, "Eigener, dauerhafter Schlüssel der Runde.", "Your own stable key for the round."),
    s("organisation_schluessel", "organisation_key", "text", true, "Schlüssel des finanzierten Unternehmens.", "Key of the financed company."),
    s("bezeichnung", "label", "text", true, "Bezeichnung, z. B. Series A.", "Label, e.g. Series A."),
    s("datum", "date", "datum", true, "Datum der Runde.", "Date of the round."),
    s("pre_money", "pre_money", "betragOhneNull", true, "Pre-Money-Bewertung.", "Pre-money valuation."),
    s("post_money", "post_money", "betrag", true, "Post-Money-Bewertung = Pre-Money + Rundenvolumen.", "Post-money valuation = pre-money + round volume."),
    s("preis_je_anteil", "price_per_share", "preis", true, "Ausgabepreis je Anteil, höchstens vier Nachkommastellen.", "Issue price per share, at most four decimals."),
    s("anteile_gesamt_nach", "shares_total_after", "ganzzahl", true, "Zahl aller Anteile nach der Runde.", "Number of all shares after the round."),
  ],
  rundenpositionen: [
    s("runde_schluessel", "round_key", "text", true, "Schlüssel der Runde.", "Key of the round."),
    s("fonds_kurzname", "fund_short_name", "text", false, "Kurzname des Fonds, wenn ein Fonds dieser Plattform beteiligt ist. Genau eines von Fonds und Investor ausfüllen.", "Short name of the fund if a fund on this platform took part. Fill in exactly one of fund and investor."),
    s("investor_schluessel", "investor_key", "text", false, "Schlüssel der Investor-Organisation, wenn ein anderer Investor beteiligt ist.", "Key of the investor organisation if another investor took part."),
    s("betrag", "amount", "betrag", true, "Betrag der Position.", "Amount of the position."),
    s("anteile", "shares", "ganzzahl", true, "Anzahl der erworbenen Anteile.", "Number of shares acquired."),
    s("rolle", "role", "enum", true, "Rolle in der Runde.", "Role in the round.", AUSWAHL.rundenRolle),
  ],
  vorgaenge: [
    s("vorgang_schluessel", "transaction_key", "text", true, "Eigener, dauerhafter Schlüssel des Vorgangs (z. B. Buchungsnummer). Ein bereits übernommener Vorgang wird nie geändert; eine Korrektur ist ein Storno.", "Your own stable key for the transaction (e.g. booking number). A transaction already imported is never changed; a correction is a reversal."),
    s("beteiligung_schluessel", "holding_key", "text", true, "Schlüssel der Beteiligung.", "Key of the holding."),
    s("art", "type", "enum", true, "Art des Vorgangs.", "Type of transaction.", AUSWAHL.vorgangArt),
    s("valuta", "value_date", "datum", true, "Valuta.", "Value date."),
    s("betrag", "amount", "betragVorzeichen", true, "Betrag, größer als null; nur Wertberichtigungen (Auflösung) und Stornos sind negativ.", "Amount, greater than zero; only write-downs (reversals) and reversal rows are negative."),
    s("bemerkung", "remark", "text", false, "Bemerkung.", "Remark."),
    s("kapitalisiert", "capitalised", "jaNein", false, "Nur bei Zins: „ja“, wenn der Zins dem Darlehen zugeschlagen wurde.", "Interest only: “yes” if the interest was added to the loan.", AUSWAHL.jaNein),
    s("instrument", "instrument", "text", false, "Instrument, auf dem der Vorgang bucht: Art (z. B. darlehen) oder Bezeichnung des Instruments der Beteiligung. Ohne Angabe gilt das Hauptinstrument.", "Instrument the transaction is booked on: type (e.g. loan) or label of the holding's instrument. Defaults to the main instrument."),
    s("storniert_vorgang_schluessel", "reverses_transaction_key", "text", false, "Nur bei einem Storno: Schlüssel des stornierten Vorgangs (Betrag = negativer Betrag des Originals).", "Reversal rows only: key of the reversed transaction (amount = negative of the original)."),
  ],
  bewertungen: [
    s("bewertung_schluessel", "valuation_key", "text", true, "Eigener, dauerhafter Schlüssel der Bewertung.", "Your own stable key for the valuation."),
    s("beteiligung_schluessel", "holding_key", "text", true, "Schlüssel der Beteiligung.", "Key of the holding."),
    s("stichtag", "as_of_date", "datum", true, "Bewertungsstichtag.", "Valuation date."),
    s("wert", "value", "betragOhneNull", true, "Bewerteter Wert der Beteiligung.", "Valued amount of the holding."),
    s("methode", "method", "enum", true, "Bewertungsmethode.", "Valuation method.", AUSWAHL.bewertungMethode),
    s("begruendung", "rationale", "text", false, "Begründung; Pflicht, außer bei Anschaffungskosten.", "Rationale; required except for cost."),
    s("grundlage", "basis", "text", false, "Grundlage (Quelle, Vergleichsrunde, Multiplikator).", "Basis (source, comparable round, multiple)."),
  ],
  konditionen: [
    s("beteiligung_schluessel", "holding_key", "text", true, "Schlüssel der Beteiligung (Darlehen, Wandeldarlehen oder stille Beteiligung).", "Key of the holding (loan, convertible loan or silent partnership)."),
    s("instrument", "instrument", "text", false, "Instrument, zu dem die Konditionen gehören: Art oder Bezeichnung. Ohne Angabe gilt das Hauptinstrument.", "Instrument the terms belong to: type or label. Defaults to the main instrument."),
    s("gueltig_ab", "valid_from", "datum", true, "Die Version der Konditionen gilt ab diesem Datum; je Beteiligung und Datum eine Zeile.", "This version of the terms applies from this date; one row per holding and date."),
    s("satz_fix", "fixed_rate", "satz", true, "Fester Zinssatz als Anteil, 6 % = 0,06.", "Fixed interest rate as a fraction, 6 % = 0.06."),
    s("methode", "method", "enum", true, "Zinsmethode.", "Interest method.", AUSWAHL.zinsmethode),
    s("zinsperiode", "period", "enum", true, "Zinsperiode.", "Interest period.", AUSWAHL.zinsperiode),
    s("anker", "anchor", "datum", true, "Anker des Periodenrasters (bei endfällig das Laufzeitende).", "Anchor of the period grid (maturity if at maturity)."),
    s("gewinnabhaengig_satz", "profit_rate", "satz", false, "Anteil am Jahresüberschuss; nur zusammen mit der Kappung.", "Share of net income; only together with the cap."),
    s("kappung_satz", "cap_rate", "satz", false, "Kappung als Jahreszins auf das durchschnittliche Kapital.", "Cap as annual rate on the average capital."),
    s("stundung_bis", "deferred_until", "datum", false, "Zinsen bis zu diesem Datum gestundet.", "Interest deferred until this date."),
    s("kapitalisieren", "capitalise", "jaNein", false, "„ja“, wenn Zinsen dem Kapital zugeschlagen werden.", "“yes” if interest is added to the capital.", AUSWAHL.jaNein),
    s("faellig_am", "maturity", "datum", false, "Laufzeitende.", "Maturity date."),
  ],
  fondsbewegungen: [
    s("bewegung_schluessel", "movement_key", "text", true, "Eigener, dauerhafter Schlüssel der Bewegung.", "Your own stable key for the movement."),
    s("fonds_kurzname", "fund_short_name", "text", true, "Kurzname des Fonds.", "Short name of the fund."),
    s("art", "type", "enum", true, "Abruf oder Ausschüttung.", "Capital call or distribution.", AUSWAHL.fondsBewegungArt),
    s("valuta", "value_date", "datum", true, "Valuta.", "Value date."),
    s("betrag", "amount", "betrag", true, "Betrag, größer als null.", "Amount, greater than zero."),
    s("bemerkung", "remark", "text", false, "Bemerkung.", "Remark."),
  ],
  kontrollsummen: [
    s("fonds_kurzname", "fund_short_name", "text", true, "Kurzname des Fonds.", "Short name of the fund."),
    s("groesse", "measure", "enum", true, "Welche Summe der Quelle gemeint ist.", "Which total of the source is meant.", AUSWAHL.kontrollGroesse),
    s("betrag", "amount", "betragOhneNull", true, "Summe laut Quelle.", "Total according to the source."),
    s("stichtag", "as_of_date", "datum", false, "Stichtag der Summe (vor allem für den NAV).", "As-of date of the total (mainly for NAV)."),
  ],
};

/** Beschriftung einer Spalte in der Sprache der Vorlage. */
export const spaltenkopf = (spalte: Spalte, sprache: Sprache): string => (sprache === "de" ? spalte.schluessel : spalte.en);

/** Pflichtspalten eines Blattes. */
export const pflichtSpalten = (blatt: Blatt): string[] => SPALTEN[blatt].filter((x) => x.pflicht).map((x) => x.schluessel);

/** Kleinbuchstaben, Leerraum und Bindestriche zu Unterstrichen, Umlaute zu ihren Umschreibungen: macht Köpfe und Blattnamen vergleichbar. */
export function normalisiere(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[\s-]+/g, "_");
}

const BLATT_INDEX = new Map<string, Blatt>();
for (const blatt of BLAETTER) {
  BLATT_INDEX.set(blatt, blatt);
  for (const sprache of SPRACHEN) BLATT_INDEX.set(normalisiere(BLATT_NAMEN[blatt][sprache]), blatt);
}

/** Das Blatt zu einem Blattnamen (deutsch oder englisch), sonst `undefined`. */
export const blattVonName = (name: string): Blatt | undefined => BLATT_INDEX.get(normalisiere(name));

/** Ist es das Anleitungsblatt? */
export const istAnleitung = (name: string): boolean => SPRACHEN.some((sp) => normalisiere(ANLEITUNG_NAMEN[sp]) === normalisiere(name));

/** Spalte eines Blattes zu einem Kopf (deutsch oder englisch), sonst `undefined`. */
export function spalteVonKopf(blatt: Blatt, kopf: string): Spalte | undefined {
  const n = normalisiere(kopf);
  return SPALTEN[blatt].find((x) => x.schluessel === n || normalisiere(x.en) === n);
}

/** Die Sprache der Köpfe: `de` oder `en`, bei beiden `gemischt`, ohne erkannte Köpfe `null`. */
export function spracheDerKoepfe(koepfe: readonly string[], blatt: Blatt): Sprache | "gemischt" | null {
  let de = 0;
  let en = 0;
  for (const kopf of koepfe) {
    const n = normalisiere(kopf);
    const x = SPALTEN[blatt].find((c) => c.schluessel === n || normalisiere(c.en) === n);
    if (!x) continue;
    const istDe = x.schluessel === n;
    const istEn = normalisiere(x.en) === n;
    if (istDe && !istEn) de++;
    else if (istEn && !istDe) en++;
  }
  if (de > 0 && en > 0) return "gemischt";
  if (de > 0) return "de";
  if (en > 0) return "en";
  return null;
}

/** Interner Wert einer Auswahl zu einem Eintrag (intern, deutsch oder englisch), sonst `undefined`. */
export function auswahlWert(auswahl: readonly Auswahl[], eingabe: string): string | undefined {
  const n = normalisiere(eingabe);
  return auswahl.find((x) => normalisiere(x.wert) === n || normalisiere(x.de) === n || normalisiere(x.en) === n)?.wert;
}
