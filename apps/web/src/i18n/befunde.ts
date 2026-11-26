import type { Sprache } from "@carraway/ui";

/**
 * Befunde der Datenübernahme. Die API liefert je Befund einen stabilen `code`, die deutsche Meldung mit eingesetzten
 * Werten und `params` (die Werte strukturiert, benannt je Code). Deutsch zeigt die Meldung der API, Englisch einen
 * übersetzten Satz je Code, gebaut aus `params`; die deutsche Meldung wird nie zerlegt.
 */

export type BefundParams = Record<string, string | number>;

interface Eintrag {
  de: string;
  en: string;
  /** Englischer Satz aus den `params` des Befunds. */
  text: (p: BefundParams) => string;
}

const w = (p: BefundParams, schluessel: string) => (p[schluessel] !== undefined && p[schluessel] !== "" ? `“${p[schluessel]}”` : "the value");

export const BEFUND_CODES: Record<string, Eintrag> = {
  // Datei, Blätter, Spalten
  BLATT_DOPPELT: { de: "Blatt doppelt", en: "Duplicate sheet", text: (p) => `The sheet ${w(p, "blatt")} appears more than once.` },
  BLATT_UNBEKANNT: { de: "Blatt unbekannt", en: "Unknown sheet", text: (p) => `The sheet ${w(p, "blatt")} is not part of the template and is ignored.` },
  SPALTE_UNBEKANNT: { de: "Spalte unbekannt", en: "Unknown column", text: (p) => `The column ${w(p, "spalte")} is not part of the template and is ignored.` },
  SPALTE_DOPPELT: { de: "Spalte doppelt", en: "Duplicate column", text: (p) => `The column ${w(p, "spalte")} appears more than once in the header.` },
  SPALTE_FEHLT: { de: "Pflichtspalte fehlt", en: "Required column missing", text: (p) => `The required column ${w(p, "spalte")} is missing from the header.` },
  KOPF_SPRACHE_GEMISCHT: { de: "Gemischte Sprache im Kopf", en: "Mixed header languages", text: () => "The column headers mix German and English names." },
  // Werte
  PFLICHTFELD_FEHLT: { de: "Pflichtfeld leer", en: "Required field empty", text: (p) => `The required field ${w(p, "spalte")} is empty.` },
  TEXT_ZU_LANG: { de: "Text zu lang", en: "Text too long", text: (p) => (p.max ? `The text is longer than the allowed ${p.max} characters.` : "The text is longer than allowed.") },
  AUSWAHL_UNGUELTIG: { de: "Wert nicht erlaubt", en: "Value not allowed", text: (p) => `${w(p, "wert")} is not an allowed value; allowed: ${p.erlaubtEn ?? "see the template"}.` },
  DATUM_UNGUELTIG: { de: "Datum ungültig", en: "Invalid date", text: (p) => `${w(p, "wert")} is not a valid date (YYYY-MM-DD or DD.MM.YYYY).` },
  JA_NEIN_UNGUELTIG: { de: "Ja/Nein ungültig", en: "Invalid yes/no", text: (p) => `${w(p, "wert")} is neither yes nor no.` },
  EMAIL_UNGUELTIG: { de: "E-Mail-Adresse ungültig", en: "Invalid email address", text: (p) => `${w(p, "wert")} is not a valid email address.` },
  URL_UNGUELTIG: { de: "Adresse ungültig", en: "Invalid web address", text: (p) => `${w(p, "wert")} is not an address starting with http:// or https://.` },
  UUID_UNGUELTIG: { de: "ID ungültig", en: "Invalid ID", text: (p) => `${w(p, "wert")} is not a valid ID.` },
  WAEHRUNG_UNGUELTIG: { de: "Währung ungültig", en: "Invalid currency", text: (p) => `${w(p, "wert")} is not a three-letter currency code.` },
  ZAHL_UNGUELTIG: { de: "Zahl ungültig", en: "Invalid number", text: (p) => (p.art === "ganzzahl" ? `${w(p, "wert")} is not a whole number from zero up.` : `${w(p, "wert")} is not a valid number.`) },
  ZAHL_MEHRDEUTIG: { de: "Zahl mehrdeutig", en: "Ambiguous number", text: (p) => `${w(p, "wert")} is ambiguous (thousands separator or three decimal places); please write amounts with a decimal comma, for example 1234,00.` },
  SATZ_UNGUELTIG: { de: "Satz ungültig", en: "Invalid rate", text: (p) => `${w(p, "wert")} is not a share from 0 to 1 with at most six decimal places (6 % = 0.06).` },
  BETRAG_NACHKOMMASTELLEN: { de: "Zu viele Nachkommastellen", en: "Too many decimal places", text: (p) => `${w(p, "wert")} has more than ${p.max ?? "the allowed number of"} decimal places.` },
  BETRAG_UNGUELTIG: { de: "Betrag ungültig", en: "Invalid amount", text: (p) => ({ zu_gross: "The amount is too large.", nicht_positiv: "The amount must be greater than zero.", negativ: "The amount must not be negative.", null: "The amount must not be zero." })[String(p.grund)] ?? "The amount is not allowed here." },
  BETRAG_VORZEICHEN: { de: "Vorzeichen nicht erlaubt", en: "Sign not allowed", text: () => "Only write-downs (reversals) and reversals of entries may be negative." },
  BEGRUENDUNG_FEHLT: { de: "Begründung fehlt", en: "Justification missing", text: () => "This valuation method requires a justification." },
  // Schlüssel und Verweise
  SCHLUESSEL_DOPPELT: { de: "Schlüssel doppelt", en: "Duplicate key", text: (p) => `${p.schluessel ? `The key ${w(p, "schluessel")}` : "This record"} already appears in row ${p.zeile ?? "?"} of the file.` },
  VERWEIS_UNBEKANNT: { de: "Verweis unbekannt", en: "Unknown reference", text: (p) => `${w(p, "wert")} exists neither in the file nor in the existing data.` },
  POSITION_INVESTOR: { de: "Fonds oder Investor", en: "Fund or investor", text: () => "Exactly one of fund and investor must be filled in." },
  // Runden
  RUNDE_POST_KLEINER_PRE: { de: "Post-Money zu niedrig", en: "Post-money too low", text: () => "Post-money must be above pre-money (post-money = pre-money + round volume)." },
  RUNDE_SUMME_ABWEICHEND: { de: "Positionen passen nicht zum Volumen", en: "Positions do not match the volume", text: (p) => `The positions of the round (${p.positionen ?? ""}) add up to ${p.summe ?? ""}, the round volume (post-money minus pre-money) is ${p.volumen ?? ""}.` },
  // Vorgänge
  KAPITALISIERT_NUR_ZINS: { de: "Kapitalisiert nur bei Zinsen", en: "Capitalised only for interest", text: () => "“Capitalised” applies to interest only." },
  STORNO_DOPPELT: { de: "Storno doppelt", en: "Duplicate reversal", text: (p) => `The entry ${w(p, "schluessel")} is already reversed in row ${p.zeile ?? "?"}.` },
  STORNO_UNGUELTIG: { de: "Storno ungültig", en: "Invalid reversal", text: (p) => ({ selbst: "An entry cannot reverse itself.", storno_von_storno: "A reversal cannot be reversed.", betrag: `The amount of a reversal must be ${p.erwartet ?? "the negative of the original"}.`, art: "A reversal has the same type as the original.", beteiligung: "A reversal belongs to the same holding as the original.", valuta: `The value date of the reversal must not be earlier than that of the original (${p.erwartet ?? ""}).` })[String(p.grund)] ?? "The reversal does not match its original." },
  BEREITS_STORNIERT: { de: "Bereits storniert", en: "Already reversed", text: (p) => `The entry ${w(p, "schluessel")} is already reversed in the existing data.` },
  VORGANG_ABWEICHEND: { de: "Vorgang weicht ab", en: "Entry differs", text: (p) => `The entry ${w(p, "schluessel")} is already imported but booked differently. Imported entries are never changed; correct it with a reversal of the existing entry under a new key.` },
  BETEILIGUNG_NICHT_AKTIV: { de: "Beteiligung nicht aktiv", en: "Holding not active", text: (p) => `The holding is not active${p.status ? ` (${p.status})` : ""}.` },
  INSTRUMENT_PASST_NICHT: { de: "Instrument passt nicht", en: "Instrument does not fit", text: (p) => (p.instrument ? `The instrument of the holding (${p.instrument}) does not allow this.` : "The instrument of the holding does not allow this.") },
  PERIODE_GESPERRT: { de: "Periode gesperrt", en: "Period locked", text: (p) => (p.bis ? `The period is locked until ${p.bis}; ${p.datum ?? "this date"} cannot be booked.` : "The period is locked; this date cannot be booked.") },
  // Bewertungen
  BEWERTUNG_ABWEICHEND: { de: "Bewertung weicht ab", en: "Valuation differs", text: (p) => `The valuation ${w(p, "schluessel")} is already imported but differs; released valuations are not changed, a correction is a new valuation.` },
  BEWERTUNG_STICHTAG_DOPPELT: { de: "Bewertung doppelt", en: "Duplicate valuation", text: (p) => `The file already contains a valuation for this holding and reporting date${p.zeile ? ` (row ${p.zeile})` : ""}.` },
  BEWERTUNG_VORHANDEN: { de: "Bewertung vorhanden", en: "Valuation exists", text: () => "A released valuation for this holding and reporting date already exists without this key." },
  // Konditionen und Fondsbewegungen
  KONDITION_GEWINN_PAAR: { de: "Satz und Kappung nur gemeinsam", en: "Rate and cap only together", text: () => "Give the profit-linked rate and the cap together or not at all." },
  KONDITION_ABWEICHEND: { de: "Konditionen weichen ab", en: "Terms differ", text: () => "Different terms already exist for this date; a change is a new version with a new date." },
  KONDITION_RASTER_UNGLEICH: { de: "Zinsraster geändert", en: "Interest schedule changed", text: (p) => (p.grund === "anker" ? "The anchor may only change for bullet interest." : "The interest period must not change in later versions.") },
  DATUM_AUSSERHALB: { de: "Datum außerhalb", en: "Date out of range", text: (p) => `${p.datum ? `The date ${w(p, "datum")}` : "The date"} lies outside the permitted range.` },
  FONDSBEWEGUNG_ABWEICHEND: { de: "Fondsbewegung weicht ab", en: "Fund movement differs", text: (p) => `The movement ${w(p, "schluessel")} is already imported but differs; it is not changed.` },
  // Kontrollsummen
  KONTROLLSUMME_STICHTAG: { de: "Stichtag fehlt", en: "Reporting date missing", text: () => "The NAV needs a reporting date; without one the fund's default reporting date applies." },
  KONTROLLSUMME_ABWEICHEND: { de: "Kontrollsumme weicht ab", en: "Control total differs", text: (p) => `The total according to the source (${p.quelle ?? ""}) differs from the total after the import (${p.uebernahme ?? ""}).` },
  ABRUFE_UEBER_ZEICHNUNGSKAPITAL: { de: "Abrufe über Zeichnungskapital", en: "Calls exceed subscribed capital", text: (p) => `The capital calls of the fund ${w(p, "fonds")} (${p.summe ?? ""}) exceed the subscribed capital (${p.kapital ?? ""}).` },
  ZUSAGEN_UEBER_ZEICHNUNGSKAPITAL: { de: "Zusagen über Zeichnungskapital", en: "Commitments exceed subscribed capital", text: (p) => `The commitments of the fund ${w(p, "fonds")} (${p.summe ?? ""}) exceed the subscribed capital (${p.kapital ?? ""}).` },
  // Bestand und Dubletten
  FONDS_ABWEICHEND: { de: "Fonds weicht ab", en: "Fund differs", text: (p) => `The fund ${w(p, "schluessel")} already exists with different master data; it is not overwritten.` },
  ORGANISATION_ABWEICHEND: { de: "Organisation weicht ab", en: "Organisation differs", text: (p) => `The organisation ${w(p, "schluessel")} already exists with different master data; it is not overwritten.` },
  BESTEHENDE_ID_UNBEKANNT: { de: "Bestehende ID unbekannt", en: "Existing ID unknown", text: () => "No organisation with this ID exists." },
  ORGANISATION_DUBLETTE_MOEGLICH: { de: "Mögliche Dublette", en: "Possible duplicate", text: (p) => `Similar to ${p.kandidaten ?? "an existing organisation"}. Use “bestehende_id” to reuse it or confirm with “dublette_bestaetigt = ja”.` },
  ORGANISATION_DOPPELT_IN_DATEI: { de: "Dublette in der Datei", en: "Duplicate in the file", text: (p) => `Similar to ${w(p, "name")} in row ${p.zeile ?? "?"} of the same file. Confirm with “dublette_bestaetigt = ja”.` },
  BETEILIGUNG_ABWEICHEND: { de: "Beteiligung weicht ab", en: "Holding differs", text: (p) => `The holding ${w(p, "schluessel")} already exists with a different fund, organisation or instrument; holdings are not moved.` },
  BETEILIGUNG_STATUS_ABWEICHEND: { de: "Status weicht ab", en: "Status differs", text: (p) => `The status of the holding in the existing data is ${w(p, "bestand")}, the file says ${w(p, "datei")}; it is not changed.` },
  BETEILIGUNG_VORHANDEN: { de: "Beteiligung vorhanden", en: "Holding exists", text: (p) => `This holding (fund, organisation) already exists${p.id ? ` (${p.id})` : ""}, but without this key.` },
  INSTRUMENT_UNBEKANNT: { de: "Instrument unbekannt", en: "Instrument unknown", text: (p) => `The holding has no instrument ${w(p, "wert")}.` },
  INSTRUMENT_MEHRDEUTIG: { de: "Instrument mehrdeutig", en: "Instrument ambiguous", text: (p) => `${w(p, "wert")} matches several instruments of the holding; please give the label.` },
  RUNDE_ABWEICHEND: { de: "Runde weicht ab", en: "Round differs", text: (p) => `The round ${w(p, "schluessel")} already exists with different values; it is not changed.` },
  POSITION_ABWEICHEND: { de: "Position weicht ab", en: "Position differs", text: () => "This position already exists with different values; it is not changed." },
  // Rechte
  KEINE_BERECHTIGUNG_FONDS: { de: "Keine Berechtigung am Fonds", en: "No permission for the fund", text: (p) => `You lack the required permission for the fund that ${w(p, "wert")} belongs to. The record is not checked.` },
  FONDS_NEU_NUR_VERWALTER: { de: "Neuer Fonds nur durch Verwalter", en: "New fund only by administrators", text: () => "Only global administrators create new funds." },
};

/** `params` der API als flache Werteliste; fehlt es (alte Läufe), bleibt die Liste leer und der Satz nennt „the value“. */
function alsParams(wert: unknown): BefundParams {
  if (!wert || typeof wert !== "object") return {};
  return Object.fromEntries(Object.entries(wert).filter(([, v]) => typeof v === "string" || typeof v === "number")) as BefundParams;
}

/** Liest der englische Satz des Codes überhaupt Werte aus `params`? (Probe mit einem Objekt, das Zugriffe zählt.) */
function nutztParams(e: Eintrag): boolean {
  let gelesen = false;
  e.text(new Proxy({}, { get: () => ((gelesen = true), undefined) }) as BefundParams);
  return gelesen;
}

/** Kurzer Name des Befunds; unbekannte Codes erscheinen unverändert. */
export function befundTitel(code: string, sprache: Sprache, fehler: Record<string, string>): string {
  const e = Object.hasOwn(BEFUND_CODES, code) ? BEFUND_CODES[code] : undefined;
  if (e) return e[sprache];
  // Regeln der Instrumente (Invarianten) melden mit dem Code der API; deren Text steht in der Fehlertabelle.
  return Object.hasOwn(fehler, code) ? (fehler[code] as string) : code;
}

/**
 * Meldung zum Befund. Deutsch: die Meldung der API. Englisch: der übersetzte Satz des Codes; für Codes ohne Eintrag
 * der Text der Fehlertabelle (Regeln der Instrumente) und sonst die deutsche Meldung.
 */
export function befundMeldung(befund: { code: string; meldung: string; params?: unknown }, sprache: Sprache, fehler: Record<string, string>): string {
  if (sprache === "de") return befund.meldung;
  const e = Object.hasOwn(BEFUND_CODES, befund.code) ? BEFUND_CODES[befund.code] : undefined;
  if (e) {
    const params = alsParams(befund.params);
    // Läufe vor Einführung von `params` haben keine Werte gespeichert: Ein Satz, der Werte einsetzt, bliebe leer („the value“); dann gilt der gespeicherte Text.
    if (Object.keys(params).length === 0 && nutztParams(e)) return befund.meldung;
    return e.text(params);
  }
  return Object.hasOwn(fehler, befund.code) ? (fehler[befund.code] as string) : befund.meldung;
}
