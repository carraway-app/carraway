import { importBefundText } from "@carraway/api/import/befund-texte";
import type { Sprache } from "@carraway/ui";

/**
 * Befunde der Datenübernahme. Die API liefert je Befund einen stabilen `code`, die Meldung mit eingesetzten
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

export const BEFUND_CODES: Record<string, Eintrag> = {
  // Datei, Blätter, Spalten
  BLATT_DOPPELT: { de: "Blatt doppelt", en: "Duplicate sheet", text: importBefundText.BLATT_DOPPELT! },
  BLATT_UNBEKANNT: { de: "Blatt unbekannt", en: "Unknown sheet", text: importBefundText.BLATT_UNBEKANNT! },
  SPALTE_UNBEKANNT: { de: "Spalte unbekannt", en: "Unknown column", text: importBefundText.SPALTE_UNBEKANNT! },
  SPALTE_DOPPELT: { de: "Spalte doppelt", en: "Duplicate column", text: importBefundText.SPALTE_DOPPELT! },
  SPALTE_FEHLT: { de: "Pflichtspalte fehlt", en: "Required column missing", text: importBefundText.SPALTE_FEHLT! },
  KOPF_SPRACHE_GEMISCHT: { de: "Gemischte Sprache im Kopf", en: "Mixed header languages", text: importBefundText.KOPF_SPRACHE_GEMISCHT! },
  // Werte
  PFLICHTFELD_FEHLT: { de: "Pflichtfeld leer", en: "Required field empty", text: importBefundText.PFLICHTFELD_FEHLT! },
  TEXT_ZU_LANG: { de: "Text zu lang", en: "Text too long", text: importBefundText.TEXT_ZU_LANG! },
  AUSWAHL_UNGUELTIG: { de: "Wert nicht erlaubt", en: "Value not allowed", text: importBefundText.AUSWAHL_UNGUELTIG! },
  DATUM_UNGUELTIG: { de: "Datum ungültig", en: "Invalid date", text: importBefundText.DATUM_UNGUELTIG! },
  JA_NEIN_UNGUELTIG: { de: "Ja/Nein ungültig", en: "Invalid yes/no", text: importBefundText.JA_NEIN_UNGUELTIG! },
  EMAIL_UNGUELTIG: { de: "E-Mail-Adresse ungültig", en: "Invalid email address", text: importBefundText.EMAIL_UNGUELTIG! },
  URL_UNGUELTIG: { de: "Adresse ungültig", en: "Invalid web address", text: importBefundText.URL_UNGUELTIG! },
  UUID_UNGUELTIG: { de: "ID ungültig", en: "Invalid ID", text: importBefundText.UUID_UNGUELTIG! },
  WAEHRUNG_UNGUELTIG: { de: "Währung ungültig", en: "Invalid currency", text: importBefundText.WAEHRUNG_UNGUELTIG! },
  ZAHL_UNGUELTIG: { de: "Zahl ungültig", en: "Invalid number", text: importBefundText.ZAHL_UNGUELTIG! },
  ZAHL_MEHRDEUTIG: { de: "Zahl mehrdeutig", en: "Ambiguous number", text: importBefundText.ZAHL_MEHRDEUTIG! },
  SATZ_UNGUELTIG: { de: "Satz ungültig", en: "Invalid rate", text: importBefundText.SATZ_UNGUELTIG! },
  BETRAG_NACHKOMMASTELLEN: { de: "Zu viele Nachkommastellen", en: "Too many decimal places", text: importBefundText.BETRAG_NACHKOMMASTELLEN! },
  BETRAG_UNGUELTIG: { de: "Betrag ungültig", en: "Invalid amount", text: importBefundText.BETRAG_UNGUELTIG! },
  BETRAG_VORZEICHEN: { de: "Vorzeichen nicht erlaubt", en: "Sign not allowed", text: importBefundText.BETRAG_VORZEICHEN! },
  BEGRUENDUNG_FEHLT: { de: "Begründung fehlt", en: "Justification missing", text: importBefundText.BEGRUENDUNG_FEHLT! },
  OPTIONSSCHEIN_FELD_FALSCH: { de: "Feld nur für Optionsscheine", en: "Field for warrants only", text: importBefundText.OPTIONSSCHEIN_FELD_FALSCH! },
  OPTIONSSCHEIN_FELD_FEHLT: { de: "Angabe zum Optionsschein fehlt", en: "Warrant detail missing", text: importBefundText.OPTIONSSCHEIN_FELD_FEHLT! },
  OPTIONSSCHEIN_LAUFZEIT: { de: "Laufzeit vor der Ausgabe", en: "Term ends before issue", text: importBefundText.OPTIONSSCHEIN_LAUFZEIT! },
  // Schlüssel und Verweise
  SCHLUESSEL_DOPPELT: { de: "Schlüssel doppelt", en: "Duplicate key", text: importBefundText.SCHLUESSEL_DOPPELT! },
  VERWEIS_UNBEKANNT: { de: "Verweis unbekannt", en: "Unknown reference", text: importBefundText.VERWEIS_UNBEKANNT! },
  POSITION_INVESTOR: { de: "Fonds oder Investor", en: "Fund or investor", text: importBefundText.POSITION_INVESTOR! },
  // Runden
  RUNDE_POST_KLEINER_PRE: { de: "Post-Money zu niedrig", en: "Post-money too low", text: importBefundText.RUNDE_POST_KLEINER_PRE! },
  RUNDE_SUMME_ABWEICHEND: { de: "Positionen passen nicht zum Volumen", en: "Positions do not match the volume", text: importBefundText.RUNDE_SUMME_ABWEICHEND! },
  // Vorgänge
  KAPITALISIERT_NUR_ZINS: { de: "Kapitalisiert nur bei Zinsen", en: "Capitalised only for interest", text: importBefundText.KAPITALISIERT_NUR_ZINS! },
  STORNO_DOPPELT: { de: "Storno doppelt", en: "Duplicate reversal", text: importBefundText.STORNO_DOPPELT! },
  STORNO_UNGUELTIG: { de: "Storno ungültig", en: "Invalid reversal", text: importBefundText.STORNO_UNGUELTIG! },
  BEREITS_STORNIERT: { de: "Bereits storniert", en: "Already reversed", text: importBefundText.BEREITS_STORNIERT! },
  VORGANG_ABWEICHEND: { de: "Vorgang weicht ab", en: "Entry differs", text: importBefundText.VORGANG_ABWEICHEND! },
  BETEILIGUNG_NICHT_AKTIV: { de: "Beteiligung nicht aktiv", en: "Holding not active", text: importBefundText.BETEILIGUNG_NICHT_AKTIV! },
  INSTRUMENT_PASST_NICHT: { de: "Instrument passt nicht", en: "Instrument does not fit", text: importBefundText.INSTRUMENT_PASST_NICHT! },
  PERIODE_GESPERRT: { de: "Periode gesperrt", en: "Period locked", text: importBefundText.PERIODE_GESPERRT! },
  // Bewertungen
  BEWERTUNG_ABWEICHEND: { de: "Bewertung weicht ab", en: "Valuation differs", text: importBefundText.BEWERTUNG_ABWEICHEND! },
  BEWERTUNG_STICHTAG_DOPPELT: { de: "Bewertung doppelt", en: "Duplicate valuation", text: importBefundText.BEWERTUNG_STICHTAG_DOPPELT! },
  BEWERTUNG_VORHANDEN: { de: "Bewertung vorhanden", en: "Valuation exists", text: importBefundText.BEWERTUNG_VORHANDEN! },
  // Konditionen und Fondsbewegungen
  KONDITION_GEWINN_PAAR: { de: "Satz und Kappung nur gemeinsam", en: "Rate and cap only together", text: importBefundText.KONDITION_GEWINN_PAAR! },
  KONDITION_ABWEICHEND: { de: "Konditionen weichen ab", en: "Terms differ", text: importBefundText.KONDITION_ABWEICHEND! },
  KONDITION_RASTER_UNGLEICH: { de: "Zinsraster geändert", en: "Interest schedule changed", text: importBefundText.KONDITION_RASTER_UNGLEICH! },
  DATUM_AUSSERHALB: { de: "Datum außerhalb", en: "Date out of range", text: importBefundText.DATUM_AUSSERHALB! },
  FONDSBEWEGUNG_ABWEICHEND: { de: "Fondsbewegung weicht ab", en: "Fund movement differs", text: importBefundText.FONDSBEWEGUNG_ABWEICHEND! },
  // Kontrollsummen
  KONTROLLSUMME_STICHTAG: { de: "Stichtag fehlt", en: "Reporting date missing", text: importBefundText.KONTROLLSUMME_STICHTAG! },
  KONTROLLSUMME_ABWEICHEND: { de: "Kontrollsumme weicht ab", en: "Control total differs", text: importBefundText.KONTROLLSUMME_ABWEICHEND! },
  ABRUFE_UEBER_ZEICHNUNGSKAPITAL: { de: "Abrufe über Zeichnungskapital", en: "Calls exceed subscribed capital", text: importBefundText.ABRUFE_UEBER_ZEICHNUNGSKAPITAL! },
  ZUSAGEN_UEBER_ZEICHNUNGSKAPITAL: { de: "Zusagen über Zeichnungskapital", en: "Commitments exceed subscribed capital", text: importBefundText.ZUSAGEN_UEBER_ZEICHNUNGSKAPITAL! },
  // Bestand und Dubletten
  FONDS_ABWEICHEND: { de: "Fonds weicht ab", en: "Fund differs", text: importBefundText.FONDS_ABWEICHEND! },
  ORGANISATION_ABWEICHEND: { de: "Organisation weicht ab", en: "Organisation differs", text: importBefundText.ORGANISATION_ABWEICHEND! },
  BESTEHENDE_ID_UNBEKANNT: { de: "Bestehende ID unbekannt", en: "Existing ID unknown", text: importBefundText.BESTEHENDE_ID_UNBEKANNT! },
  ORGANISATION_DUBLETTE_MOEGLICH: { de: "Mögliche Dublette", en: "Possible duplicate", text: importBefundText.ORGANISATION_DUBLETTE_MOEGLICH! },
  ORGANISATION_DOPPELT_IN_DATEI: { de: "Dublette in der Datei", en: "Duplicate in the file", text: importBefundText.ORGANISATION_DOPPELT_IN_DATEI! },
  BETEILIGUNG_ABWEICHEND: { de: "Beteiligung weicht ab", en: "Holding differs", text: importBefundText.BETEILIGUNG_ABWEICHEND! },
  BETEILIGUNG_STATUS_ABWEICHEND: { de: "Status weicht ab", en: "Status differs", text: importBefundText.BETEILIGUNG_STATUS_ABWEICHEND! },
  EXIT_MIT_BUCHWERT: { de: "Exit mit Buchwert", en: "Exit with carrying amount", text: importBefundText.EXIT_MIT_BUCHWERT! },
  BETEILIGUNG_VORHANDEN: { de: "Beteiligung vorhanden", en: "Holding exists", text: importBefundText.BETEILIGUNG_VORHANDEN! },
  INSTRUMENT_UNBEKANNT: { de: "Instrument unbekannt", en: "Instrument unknown", text: importBefundText.INSTRUMENT_UNBEKANNT! },
  INSTRUMENT_MEHRDEUTIG: { de: "Instrument mehrdeutig", en: "Instrument ambiguous", text: importBefundText.INSTRUMENT_MEHRDEUTIG! },
  RUNDE_ABWEICHEND: { de: "Runde weicht ab", en: "Round differs", text: importBefundText.RUNDE_ABWEICHEND! },
  POSITION_ABWEICHEND: { de: "Position weicht ab", en: "Position differs", text: importBefundText.POSITION_ABWEICHEND! },
  // Rechte
  KEINE_BERECHTIGUNG_FONDS: { de: "Keine Berechtigung am Fonds", en: "No permission for the fund", text: importBefundText.KEINE_BERECHTIGUNG_FONDS! },
  FONDS_NEU_NUR_VERWALTER: { de: "Neuer Fonds nur durch Verwalter", en: "New fund only by administrators", text: importBefundText.FONDS_NEU_NUR_VERWALTER! },
  POOL_UNBEKANNT: { de: "Pool unbekannt", en: "Unknown pool", text: importBefundText.POOL_UNBEKANNT! },
  KEINE_BERECHTIGUNG_EINZELZUTEILUNGEN: { de: "Keine Berechtigung für Einzelzuteilungen", en: "No permission for individual grants", text: importBefundText.KEINE_BERECHTIGUNG_EINZELZUTEILUNGEN! },
  ZUTEILUNG_ABWEICHEND: { de: "Zuteilung weicht ab", en: "Grant differs", text: importBefundText.ZUTEILUNG_ABWEICHEND! },
  ZUTEILUNG_UEBER_POOL: { de: "Zuteilungen über dem Pool", en: "Grants exceed the pool", text: importBefundText.ZUTEILUNG_UEBER_POOL! },
  ZUTEILUNG_MONATE: { de: "Zu viele Monate", en: "Too many months", text: importBefundText.ZUTEILUNG_MONATE! },
  ZUTEILUNG_STATUS_DATUM: { de: "Datum des Status fehlt", en: "Status date missing", text: importBefundText.ZUTEILUNG_STATUS_DATUM! },
  // Übernahme aus einem Vorsystem und Kennzahlen
  VORSYSTEM_ZUSAMMENGEFUEHRT: { de: "In der Quelle doppelt", en: "Duplicate in the source", text: importBefundText.VORSYSTEM_ZUSAMMENGEFUEHRT! },
  VORSYSTEM_WANDLUNG: { de: "Wandlung nachtragen", en: "Record conversion", text: importBefundText.VORSYSTEM_WANDLUNG! },
  VORSYSTEM_KENNZAHL_OHNE_ZUORDNUNG: { de: "Kennzahl ohne Zuordnung", en: "Metric not mapped", text: importBefundText.VORSYSTEM_KENNZAHL_OHNE_ZUORDNUNG! },
  KENNZAHL_UNBEKANNT: { de: "Kennzahl unbekannt", en: "Metric unknown", text: importBefundText.KENNZAHL_UNBEKANNT! },
  KENNZAHL_WERT_UNGUELTIG: { de: "Kennzahlenwert ungültig", en: "Metric value invalid", text: importBefundText.KENNZAHL_WERT_UNGUELTIG! },
  KENNZAHL_ZEITRAUM_UNGUELTIG: { de: "Zeitraum ungültig", en: "Period invalid", text: importBefundText.KENNZAHL_ZEITRAUM_UNGUELTIG! },
  KENNZAHL_VORHANDEN: { de: "Kennzahlenwert vorhanden", en: "Metric value exists", text: importBefundText.KENNZAHL_VORHANDEN! },
  KENNZAHL_ABWEICHEND: { de: "Kennzahlenwert weicht ab", en: "Metric value differs", text: importBefundText.KENNZAHL_ABWEICHEND! },
  VORGANG_RUNDE_FREMD: { de: "Runde eines anderen Unternehmens", en: "Round of another company", text: importBefundText.VORGANG_RUNDE_FREMD! },
  KONTROLLSUMME_GROESSE_BETEILIGUNG: { de: "Größe je Beteiligung nicht möglich", en: "Measure not available per holding", text: importBefundText.KONTROLLSUMME_GROESSE_BETEILIGUNG! },
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

/**
 * Befunde, die die Prüfung unter dem früheren deutschen Code einer Regel der Instrumente meldet; ihr Text steht unter dem englischen
 * Fehlercode der API in der Fehlertabelle (Entscheidung 520). Die Befund-Codes stellen die Bereichs-Issues um.
 */
export const BEFUND_FEHLERCODES: Record<string, string> = {
  RUNDE_BRUECKE_OHNE_ANTEILE: "round_bridge_without_shares",
};

/** Text der Fehlertabelle zu einem Befund-Code, falls es einen gibt. */
export function befundFehlertext(code: string, fehler: Record<string, string>): string | undefined {
  const schluessel = BEFUND_FEHLERCODES[code] ?? code;
  return Object.hasOwn(fehler, schluessel) ? fehler[schluessel] : undefined;
}

/** Kurzer Name des Befunds; unbekannte Codes erscheinen unverändert. */
export function befundTitel(code: string, sprache: Sprache, fehler: Record<string, string>): string {
  const e = Object.hasOwn(BEFUND_CODES, code) ? BEFUND_CODES[code] : undefined;
  if (e) return e[sprache];
  // Regeln der Instrumente (Invarianten) melden mit dem Code der API; deren Text steht in der Fehlertabelle.
  return befundFehlertext(code, fehler) ?? code;
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
  return befundFehlertext(befund.code, fehler) ?? befund.meldung;
}
