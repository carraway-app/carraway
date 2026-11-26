import { Decimal } from "./decimal.js";
import type { Rechenschritt } from "./herkunft.js";

/**
 * Nachhaltigkeitsindikatoren (PAI, Principal Adverse Impacts) eines Fonds nach Anhang I der Delegierten Verordnung (EU) 2022/1288:
 * Aggregation der Daten je Beteiligungsunternehmen zu den Fondswerten, mit Abdeckung (Anteil des Wertes mit Daten), Schätzanteil
 * (Anteil des Wertes, dessen Eingangsdaten geschätzt sind), Rechenweg und Befunden. Reine Funktionen ohne Datenbank; die Tests rechnen gegen
 * `referenz/referenz_pai.py`.
 *
 * Die Indikatorliste ist Konfiguration (`PAI_KATALOG`, mit Version), damit eine Überarbeitung der Verordnung keine Formeln neu verdrahtet: Ein Indikator
 * nennt seine Eingangsdaten (Schlüssel des Kennzahlenkatalogs) und eine von sechs Formelarten. Fachlich zu prüfen: Indikatorliste, Formeln, Wortlaut.
 *
 * Bezeichnungen: `Wert` ist der aktuelle Wert der Beteiligung (Fair Value) zum jeweiligen Quartalsende. Die Auswirkung des Berichtsjahres ist der
 * Durchschnitt der Auswirkungen zum 31.3., 30.6., 30.9. und 31.12. (Quartale ohne Bestand und ohne definierbare Auswirkung zählen nicht mit).
 */

export const PAI_KATALOG_VERSION = 1;

export type PaiFormel = "absolut_evic" | "fussabdruck_evic" | "intensitaet_umsatz" | "anteil_ja" | "mittel_prozent" | "energie_sektor";

/** Schlüssel der Hilfsgrößen im Kennzahlenkatalog: Unternehmenswert (EVIC) und Umsatz. */
export const PAI_EVIC = "esg_evic";
export const PAI_UMSATZ = "umsatz";

export interface PaiMetrik {
  /** Eindeutiger Code der Zeile (Indikator und Teilmetrik). */
  code: string;
  /** Indikator der Verordnung (Tabelle und Nummer), Gruppe der Zeilen. */
  indikator: string;
  tabelle: 1 | 2 | 3;
  nr: number;
  /** Reihenfolge innerhalb der Ausgabe. */
  reihenfolge: number;
  verpflichtend: boolean;
  bezeichnungDe: string;
  bezeichnungEn: string;
  metrikDe: string;
  metrikEn: string;
  /** Einheit des Fondswertes (Anteile in Prozent). */
  einheit: string;
  formel: PaiFormel;
  /** Datenpunkte je Unternehmen (Schlüssel im Kennzahlenkatalog); bei Emissionen werden alle summiert. */
  eingaben: string[];
}

/** Fundstelle eines Indikators (nur Nummer, kein Wortlaut). */
export const paiFundstelle = (m: Pick<PaiMetrik, "tabelle" | "nr">): string => `DelVO (EU) 2022/1288 Anhang I Tabelle ${m.tabelle} Nr. ${m.nr}`;

const S1 = "esg_thg_scope1";
const S2 = "esg_thg_scope2";
const S3 = "esg_thg_scope3";

const metrik = (m: Omit<PaiMetrik, "verpflichtend" | "reihenfolge"> & { verpflichtend?: boolean; reihenfolge: number }): PaiMetrik => ({ verpflichtend: true, ...m });

/** Die 14 verpflichtenden Indikatoren für Beteiligungsunternehmen (Tabelle 1) und die wählbaren zusätzlichen (Tabellen 2 und 3). */
export const PAI_KATALOG: readonly PaiMetrik[] = [
  metrik({ code: "t1_01_scope1", indikator: "t1_01", tabelle: 1, nr: 1, reihenfolge: 110, bezeichnungDe: "Treibhausgasemissionen", bezeichnungEn: "GHG emissions", metrikDe: "Scope-1-Treibhausgasemissionen", metrikEn: "Scope 1 greenhouse gas emissions", einheit: "t CO2e", formel: "absolut_evic", eingaben: [S1] }),
  metrik({ code: "t1_01_scope2", indikator: "t1_01", tabelle: 1, nr: 1, reihenfolge: 120, bezeichnungDe: "Treibhausgasemissionen", bezeichnungEn: "GHG emissions", metrikDe: "Scope-2-Treibhausgasemissionen", metrikEn: "Scope 2 greenhouse gas emissions", einheit: "t CO2e", formel: "absolut_evic", eingaben: [S2] }),
  metrik({ code: "t1_01_scope3", indikator: "t1_01", tabelle: 1, nr: 1, reihenfolge: 130, bezeichnungDe: "Treibhausgasemissionen", bezeichnungEn: "GHG emissions", metrikDe: "Scope-3-Treibhausgasemissionen", metrikEn: "Scope 3 greenhouse gas emissions", einheit: "t CO2e", formel: "absolut_evic", eingaben: [S3] }),
  metrik({ code: "t1_01_gesamt", indikator: "t1_01", tabelle: 1, nr: 1, reihenfolge: 140, bezeichnungDe: "Treibhausgasemissionen", bezeichnungEn: "GHG emissions", metrikDe: "Treibhausgasemissionen insgesamt (Scope 1, 2 und 3)", metrikEn: "Total greenhouse gas emissions (scope 1, 2 and 3)", einheit: "t CO2e", formel: "absolut_evic", eingaben: [S1, S2, S3] }),
  metrik({ code: "t1_02", indikator: "t1_02", tabelle: 1, nr: 2, reihenfolge: 200, bezeichnungDe: "CO2-Fußabdruck", bezeichnungEn: "Carbon footprint", metrikDe: "CO2-Fußabdruck (Scope 1, 2 und 3)", metrikEn: "Carbon footprint (scope 1, 2 and 3)", einheit: "t CO2e je Mio. EUR investiert", formel: "fussabdruck_evic", eingaben: [S1, S2, S3] }),
  metrik({ code: "t1_03", indikator: "t1_03", tabelle: 1, nr: 3, reihenfolge: 300, bezeichnungDe: "THG-Emissionsintensität der Beteiligungsunternehmen", bezeichnungEn: "GHG intensity of investee companies", metrikDe: "THG-Intensität (Scope 1, 2 und 3) je Mio. EUR Umsatz", metrikEn: "GHG intensity (scope 1, 2 and 3) per EUR million of revenue", einheit: "t CO2e je Mio. EUR Umsatz", formel: "intensitaet_umsatz", eingaben: [S1, S2, S3] }),
  metrik({ code: "t1_04", indikator: "t1_04", tabelle: 1, nr: 4, reihenfolge: 400, bezeichnungDe: "Engagement in Unternehmen im Sektor fossiler Brennstoffe", bezeichnungEn: "Exposure to companies active in the fossil fuel sector", metrikDe: "Anteil der Investitionen in Unternehmen, die im Sektor fossiler Brennstoffe tätig sind", metrikEn: "Share of investments in companies active in the fossil fuel sector", einheit: "% der Investitionen", formel: "anteil_ja", eingaben: ["esg_fossile_brennstoffe"] }),
  metrik({ code: "t1_05", indikator: "t1_05", tabelle: 1, nr: 5, reihenfolge: 500, bezeichnungDe: "Anteil nicht erneuerbarer Energie", bezeichnungEn: "Share of non-renewable energy", metrikDe: "Anteil nicht erneuerbarer Energie am Verbrauch und an der Erzeugung (gewichteter Durchschnitt)", metrikEn: "Share of non-renewable energy in consumption and production (weighted average)", einheit: "%", formel: "mittel_prozent", eingaben: ["esg_nicht_erneuerbare_energie_anteil"] }),
  metrik({ code: "t1_06", indikator: "t1_06", tabelle: 1, nr: 6, reihenfolge: 600, bezeichnungDe: "Energieverbrauchsintensität je klimaintensivem Sektor", bezeichnungEn: "Energy consumption intensity per high impact climate sector", metrikDe: "Energieverbrauch in GWh je Mio. EUR Umsatz, je Sektor", metrikEn: "Energy consumption in GWh per EUR million of revenue, per sector", einheit: "GWh je Mio. EUR Umsatz", formel: "energie_sektor", eingaben: ["esg_energieverbrauch_gwh"] }),
  metrik({ code: "t1_07", indikator: "t1_07", tabelle: 1, nr: 7, reihenfolge: 700, bezeichnungDe: "Tätigkeiten mit Auswirkungen auf biodiversitätssensible Gebiete", bezeichnungEn: "Activities negatively affecting biodiversity-sensitive areas", metrikDe: "Anteil der Investitionen in Unternehmen mit nachteiligen Auswirkungen auf biodiversitätssensible Gebiete", metrikEn: "Share of investments in companies negatively affecting biodiversity-sensitive areas", einheit: "% der Investitionen", formel: "anteil_ja", eingaben: ["esg_biodiversitaet"] }),
  metrik({ code: "t1_08", indikator: "t1_08", tabelle: 1, nr: 8, reihenfolge: 800, bezeichnungDe: "Emissionen in Wasser", bezeichnungEn: "Emissions to water", metrikDe: "Tonnen Emissionen in Wasser je Mio. EUR investiert", metrikEn: "Tonnes of emissions to water per EUR million invested", einheit: "t je Mio. EUR investiert", formel: "fussabdruck_evic", eingaben: ["esg_emissionen_wasser"] }),
  metrik({ code: "t1_09", indikator: "t1_09", tabelle: 1, nr: 9, reihenfolge: 900, bezeichnungDe: "Anteil gefährlicher und radioaktiver Abfälle", bezeichnungEn: "Hazardous waste and radioactive waste ratio", metrikDe: "Tonnen gefährlicher und radioaktiver Abfälle je Mio. EUR investiert", metrikEn: "Tonnes of hazardous and radioactive waste per EUR million invested", einheit: "t je Mio. EUR investiert", formel: "fussabdruck_evic", eingaben: ["esg_gefaehrliche_abfaelle"] }),
  metrik({ code: "t1_10", indikator: "t1_10", tabelle: 1, nr: 10, reihenfolge: 1000, bezeichnungDe: "Verstöße gegen UNGC und OECD-Leitsätze", bezeichnungEn: "Violations of UNGC principles and OECD guidelines", metrikDe: "Anteil der Investitionen in Unternehmen mit Verstößen gegen die UNGC-Grundsätze oder die OECD-Leitsätze", metrikEn: "Share of investments in companies involved in violations of the UNGC principles or OECD guidelines", einheit: "% der Investitionen", formel: "anteil_ja", eingaben: ["esg_verstoesse_ungc"] }),
  metrik({ code: "t1_11", indikator: "t1_11", tabelle: 1, nr: 11, reihenfolge: 1100, bezeichnungDe: "Fehlende Verfahren zur Überwachung der Einhaltung", bezeichnungEn: "Lack of processes and compliance mechanisms", metrikDe: "Anteil der Investitionen in Unternehmen ohne Richtlinien zur Überwachung der Einhaltung oder ohne Beschwerdeverfahren", metrikEn: "Share of investments in companies without policies to monitor compliance or grievance handling mechanisms", einheit: "% der Investitionen", formel: "anteil_ja", eingaben: ["esg_prozesse_ungc_fehlen"] }),
  metrik({ code: "t1_12", indikator: "t1_12", tabelle: 1, nr: 12, reihenfolge: 1200, bezeichnungDe: "Unbereinigtes geschlechtsspezifisches Lohngefälle", bezeichnungEn: "Unadjusted gender pay gap", metrikDe: "Durchschnittliches unbereinigtes Lohngefälle (gewichteter Durchschnitt)", metrikEn: "Average unadjusted gender pay gap (weighted average)", einheit: "%", formel: "mittel_prozent", eingaben: ["esg_lohngefaelle_unbereinigt"] }),
  metrik({ code: "t1_13", indikator: "t1_13", tabelle: 1, nr: 13, reihenfolge: 1300, bezeichnungDe: "Geschlechtervielfalt im Leitungsorgan", bezeichnungEn: "Board gender diversity", metrikDe: "Durchschnittlicher Frauenanteil im Leitungsorgan (gewichteter Durchschnitt)", metrikEn: "Average share of women in the management body (weighted average)", einheit: "%", formel: "mittel_prozent", eingaben: ["esg_frauenanteil_leitung"] }),
  metrik({ code: "t1_14", indikator: "t1_14", tabelle: 1, nr: 14, reihenfolge: 1400, bezeichnungDe: "Engagement in umstrittenen Waffen", bezeichnungEn: "Exposure to controversial weapons", metrikDe: "Anteil der Investitionen in Unternehmen, die an umstrittenen Waffen beteiligt sind", metrikEn: "Share of investments in companies involved in controversial weapons", einheit: "% der Investitionen", formel: "anteil_ja", eingaben: ["esg_umstrittene_waffen"] }),
  metrik({ code: "t2_04", indikator: "t2_04", tabelle: 2, nr: 4, reihenfolge: 2040, verpflichtend: false, bezeichnungDe: "Zusatz: Keine Initiativen zur Verringerung der CO2-Emissionen", bezeichnungEn: "Additional: No carbon emission reduction initiatives", metrikDe: "Anteil der Investitionen in Unternehmen ohne Initiativen zur Verringerung der CO2-Emissionen", metrikEn: "Share of investments in companies without carbon emission reduction initiatives", einheit: "% der Investitionen", formel: "anteil_ja", eingaben: ["esg_zus_ohne_reduktionsinitiativen"] }),
  metrik({ code: "t3_06", indikator: "t3_06", tabelle: 3, nr: 6, reihenfolge: 3060, verpflichtend: false, bezeichnungDe: "Zusatz: Unzureichender Schutz von Hinweisgebern", bezeichnungEn: "Additional: Insufficient whistleblower protection", metrikDe: "Anteil der Investitionen in Unternehmen ohne Richtlinien zum Schutz von Hinweisgebern", metrikEn: "Share of investments in companies without policies on the protection of whistleblowers", einheit: "% der Investitionen", formel: "anteil_ja", eingaben: ["esg_zus_hinweisgeberschutz"] }),
  metrik({ code: "t3_15", indikator: "t3_15", tabelle: 3, nr: 15, reihenfolge: 3150, verpflichtend: false, bezeichnungDe: "Zusatz: Fehlende Richtlinien gegen Korruption und Bestechung", bezeichnungEn: "Additional: Lack of anti-corruption and anti-bribery policies", metrikDe: "Anteil der Investitionen in Unternehmen ohne Richtlinien zur Bekämpfung von Korruption und Bestechung", metrikEn: "Share of investments in companies without anti-corruption and anti-bribery policies", einheit: "% der Investitionen", formel: "anteil_ja", eingaben: ["esg_zus_antikorruption"] }),
];

/** Klimaintensive Sektoren (Abschnitte A bis H und L der NACE) für die Energieverbrauchsintensität (Tabelle 1 Nr. 6). */
export const PAI_KLIMASEKTOREN: readonly { abschnitt: string; de: string; en: string }[] = [
  { abschnitt: "A", de: "Land- und Forstwirtschaft, Fischerei", en: "Agriculture, forestry and fishing" },
  { abschnitt: "B", de: "Bergbau und Gewinnung von Steinen und Erden", en: "Mining and quarrying" },
  { abschnitt: "C", de: "Verarbeitendes Gewerbe", en: "Manufacturing" },
  { abschnitt: "D", de: "Energieversorgung", en: "Electricity, gas, steam and air conditioning supply" },
  { abschnitt: "E", de: "Wasserversorgung, Abwasser- und Abfallentsorgung", en: "Water supply, sewerage, waste management and remediation" },
  { abschnitt: "F", de: "Baugewerbe", en: "Construction" },
  { abschnitt: "G", de: "Handel, Instandhaltung und Reparatur von Kraftfahrzeugen", en: "Wholesale and retail trade, repair of motor vehicles" },
  { abschnitt: "H", de: "Verkehr und Lagerei", en: "Transportation and storage" },
  { abschnitt: "L", de: "Grundstücks- und Wohnungswesen", en: "Real estate activities" },
];

/** Abschnitt der NACE: ein Buchstabe A bis U. */
export const istNaceAbschnitt = (text: string): boolean => /^[A-U]$/.test(text);

/**
 * Ein Indikatorkatalog mit Version. Die Rechnung nimmt ihn als Eingabe (`berechnePai(eingabe, katalog)`); das Ergebnis trägt seine Version und
 * wird so mit der Erklärung festgeschrieben. Die Konstante `PAI_KATALOG` ist Version 1; spätere Fassungen können aus der Datenbank kommen, ohne
 * dass die Rechnung sich ändert.
 */
export interface PaiKatalog {
  version: number;
  metriken: readonly PaiMetrik[];
}

/** Version 1 des Katalogs (der Stand im Code). */
export const PAI_KATALOG_V1: PaiKatalog = { version: PAI_KATALOG_VERSION, metriken: PAI_KATALOG };

/** Schlüssel der Datenpunkte, die für die Auswahl gebraucht werden: Eingänge der Indikatoren (ohne die Zusatzindikatoren außerhalb von `zusatz`) und die Hilfsgrößen. */
export function paiDatenpunkte(zusatz: readonly string[] = [], katalog: PaiKatalog = PAI_KATALOG_V1): string[] {
  const aus = new Set<string>([PAI_EVIC, PAI_UMSATZ]);
  for (const m of paiMetriken(zusatz, katalog)) for (const e of m.eingaben) aus.add(e);
  return [...aus];
}

/** Zusatzindikatoren (nicht verpflichtend) mit dem Schlüssel ihres Datenpunkts: die Auswahl je Fonds nennt diese Schlüssel. */
export const PAI_ZUSATZ: readonly { code: string; schluessel: string }[] = PAI_KATALOG.filter((m) => !m.verpflichtend).map((m) => ({ code: m.code, schluessel: m.eingaben[0]! }));

/** Katalogzeilen für die Ausgabe: alle verpflichtenden plus die Zusatzindikatoren, deren Datenpunkt in `zusatz` steht. */
export function paiMetriken(zusatz: readonly string[] = [], katalog: PaiKatalog = PAI_KATALOG_V1): PaiMetrik[] {
  return katalog.metriken.filter((m) => m.verpflichtend || zusatz.includes(m.eingaben[0]!)).sort((a, b) => a.reihenfolge - b.reihenfolge);
}

/** Quartalsenden des Berichtsjahres: 31.3., 30.6., 30.9., 31.12. */
export const paiStichtage = (jahr: number): [string, string, string, string] => [`${jahr}-03-31`, `${jahr}-06-30`, `${jahr}-09-30`, `${jahr}-12-31`];

// Eingabe und Ergebnis ----------------------------------------------------------------------------------------------

export interface PaiDatenpunkt {
  /** Kanonischer Wert: Dezimalzahl mit Punkt oder `ja`/`nein`. */
  wert: string;
  /** Wert ist geschätzt, nicht berichtet. */
  geschaetzt: boolean;
}

export interface PaiBeteiligung {
  id: string;
  name: string;
  /** Abschnitt der NACE (A bis U) oder leer. */
  nace: string | null;
  /** Aktueller Wert der Beteiligung in Euro je Stichtag (Schlüssel = Quartalsende); fehlt oder 0 heißt nicht gehalten. */
  wert: Record<string, string>;
  /** Daten des Berichtsjahres je Schlüssel (auch `esg_evic` und `umsatz`); fehlend = keine Angabe. */
  daten: Record<string, PaiDatenpunkt | undefined>;
}

export interface PaiEingabe {
  jahr: number;
  beteiligungen: PaiBeteiligung[];
  /** Schlüssel der gewählten Zusatzindikatoren. */
  zusatz?: string[];
}

/** Alle Codes der Befunde; Berichte (`packages/berichte`) und Oberfläche übersetzen jeden davon, ein Test prüft die Deckung. */
export const PAI_BEFUND_CODES = ["KEIN_BESTAND", "QUARTAL_OHNE_BESTAND", "EVIC_FEHLT", "EVIC_NICHT_POSITIV", "UMSATZ_FEHLT", "UMSATZ_NICHT_POSITIV", "ANTEIL_UEBER_100", "NACE_FEHLT"] as const;
export type PaiBefundCode = (typeof PAI_BEFUND_CODES)[number];

export interface PaiBefund {
  code: PaiBefundCode;
  beteiligungId?: string;
  name?: string;
  stichtag?: string;
  params: Record<string, string | number>;
}

export interface PaiQuartal {
  stichtag: string;
  /** Auswirkung zum Quartalsende; `null`, wenn nicht definierbar (kein Bestand oder keine Daten). */
  wert: string | null;
  abdeckung: string | null;
}

export interface PaiZeile {
  code: string;
  indikator: string;
  tabelle: 1 | 2 | 3;
  nr: number;
  verpflichtend: boolean;
  bezeichnungDe: string;
  bezeichnungEn: string;
  metrikDe: string;
  metrikEn: string;
  einheit: string;
  formel: PaiFormel;
  /** Sektor (NACE-Abschnitt) bei der Energieverbrauchsintensität. */
  sektor?: string;
  /** Durchschnitt der Auswirkungen der Quartale mit Wert; `null`, wenn kein Quartal einen Wert hat. */
  wert: string | null;
  /** Anteil des Wertes der Beteiligungen mit Daten am Gesamtwert (0 bis 1), Durchschnitt der Quartale mit Bestand; `null` ohne Bestand. */
  abdeckung: string | null;
  /** Anteil des Wertes mit Daten, dessen Eingangsdaten geschätzt sind (0 bis 1); `null` ohne Daten. */
  schaetzanteil: string | null;
  quartale: PaiQuartal[];
  schritte: Rechenschritt[];
}

export interface PaiErgebnis {
  katalogVersion: number;
  jahr: number;
  stichtage: string[];
  zeilen: PaiZeile[];
  befunde: PaiBefund[];
}

// Rechnung ----------------------------------------------------------------------------------------------------------

const MIO = new Decimal(1_000_000);
const HUNDERT = new Decimal(100);

function zahl(d: PaiDatenpunkt | undefined): Decimal | null {
  if (!d || d.wert === "ja" || d.wert === "nein") return null;
  try {
    const x = new Decimal(d.wert);
    return x.isFinite() ? x : null;
  } catch {
    return null;
  }
}

function ja(d: PaiDatenpunkt | undefined): boolean | null {
  if (!d) return null;
  if (d.wert === "ja") return true;
  if (d.wert === "nein") return false;
  return null;
}

interface Beitrag {
  b: PaiBeteiligung;
  v: Decimal;
  /** Summand der Formel. */
  term: Decimal;
  geschaetzt: boolean;
}

interface QuartalRechnung {
  stichtag: string;
  wert: Decimal | null;
  abdeckung: Decimal | null;
  schaetzanteil: Decimal | null;
  schritte: Rechenschritt[];
  /** Es gab Bestand (Gesamtwert über 0); sonst zählt das Quartal nicht in den Durchschnitten. */
  bestand: boolean;
}

function rechneQuartal(m: PaiMetrik, sektor: string | undefined, stichtag: string, positionen: { b: PaiBeteiligung; v: Decimal }[]): QuartalRechnung {
  const gesamt = positionen.reduce((s, p) => s.plus(p.v), new Decimal(0));
  const kopf = `${stichtag}`;
  if (gesamt.lte(0)) {
    return { stichtag, wert: null, abdeckung: null, schaetzanteil: null, schritte: [{ zeichen: "", bezeichnung: `${kopf}: kein Bestand`, wert: "" }], bestand: false };
  }
  const imSektor = m.formel === "energie_sektor" ? positionen.filter((p) => p.b.nace === sektor) : positionen;
  const nenner = imSektor.reduce((s, p) => s.plus(p.v), new Decimal(0));
  if (m.formel === "energie_sektor" && nenner.lte(0)) {
    return { stichtag, wert: null, abdeckung: null, schaetzanteil: null, schritte: [{ zeichen: "", bezeichnung: `${kopf}: kein Bestand im Sektor ${sektor}`, wert: "" }], bestand: false };
  }

  const beitraege: Beitrag[] = [];
  for (const p of imSektor) {
    const evic = zahl(p.b.daten[PAI_EVIC]);
    const umsatz = zahl(p.b.daten[PAI_UMSATZ]);
    const evicOk = evic !== null && evic.gt(0);
    const umsatzOk = umsatz !== null && umsatz.gt(0);
    const werte = m.eingaben.map((k) => p.b.daten[k]);
    const geschaetztEingabe = werte.some((w) => w?.geschaetzt === true);
    const geschaetztEvic = p.b.daten[PAI_EVIC]?.geschaetzt === true;
    const geschaetztUmsatz = p.b.daten[PAI_UMSATZ]?.geschaetzt === true;
    if (m.formel === "anteil_ja") {
      const f = ja(werte[0]);
      if (f === null) continue;
      beitraege.push({ b: p.b, v: p.v, term: f ? p.v : new Decimal(0), geschaetzt: geschaetztEingabe });
      continue;
    }
    const zahlen = werte.map(zahl).filter((x): x is Decimal => x !== null);
    if (zahlen.length !== werte.length) continue;
    const summe = zahlen.reduce((s: Decimal, x: Decimal) => s.plus(x), new Decimal(0));
    switch (m.formel) {
      case "mittel_prozent":
        beitraege.push({ b: p.b, v: p.v, term: p.v.times(summe), geschaetzt: geschaetztEingabe });
        break;
      case "absolut_evic":
      case "fussabdruck_evic":
        if (!evicOk) continue;
        beitraege.push({ b: p.b, v: p.v, term: p.v.div(evic!).times(summe), geschaetzt: geschaetztEingabe || geschaetztEvic });
        break;
      case "intensitaet_umsatz":
        if (!umsatzOk) continue;
        beitraege.push({ b: p.b, v: p.v, term: p.v.times(summe.div(umsatz!.div(MIO))), geschaetzt: geschaetztEingabe || geschaetztUmsatz });
        break;
      case "energie_sektor":
        if (!umsatzOk) continue;
        beitraege.push({ b: p.b, v: p.v, term: p.v.times(summe.div(umsatz!.div(MIO))), geschaetzt: geschaetztEingabe || geschaetztUmsatz });
        break;
    }
  }

  const gedeckt = beitraege.reduce((s, x) => s.plus(x.v), new Decimal(0));
  const abdeckung = gedeckt.div(nenner);
  const quellen = beitraege.map((x) => x.b.id);
  const geschaetzt = beitraege.filter((x) => x.geschaetzt).reduce((s, x) => s.plus(x.v), new Decimal(0));
  const schaetzanteil = gedeckt.gt(0) ? geschaetzt.div(gedeckt) : null;
  const schritte: Rechenschritt[] = [];
  const summeTerm = beitraege.reduce((s, x) => s.plus(x.term), new Decimal(0));
  let wert: Decimal | null = null;
  if (beitraege.length > 0) {
    switch (m.formel) {
      case "absolut_evic":
        wert = summeTerm;
        schritte.push({ zeichen: "=", bezeichnung: `${kopf}: Summe aus Wert ÷ Unternehmenswert × Emissionen`, wert: wert.toString(), quellen });
        break;
      case "fussabdruck_evic": {
        const mio = gesamt.div(MIO);
        wert = summeTerm.div(mio);
        schritte.push(
          { zeichen: "", bezeichnung: `${kopf}: Summe aus Wert ÷ Unternehmenswert × Menge (finanzierte Menge)`, wert: summeTerm.toString(), quellen },
          { zeichen: "÷", bezeichnung: `${kopf}: Gesamtwert aller Beteiligungen in Mio. EUR`, wert: mio.toString() },
          { zeichen: "=", bezeichnung: `${kopf}: Auswirkung`, wert: wert.toString() },
        );
        break;
      }
      case "intensitaet_umsatz":
        wert = summeTerm.div(gesamt);
        schritte.push(
          { zeichen: "", bezeichnung: `${kopf}: Summe aus Wert × (Emissionen ÷ Umsatz in Mio. EUR)`, wert: summeTerm.toString(), quellen },
          { zeichen: "÷", bezeichnung: `${kopf}: Gesamtwert aller Beteiligungen`, wert: gesamt.toString() },
          { zeichen: "=", bezeichnung: `${kopf}: Auswirkung`, wert: wert.toString() },
        );
        break;
      case "anteil_ja":
        wert = summeTerm.div(gesamt).times(HUNDERT);
        schritte.push(
          { zeichen: "", bezeichnung: `${kopf}: Wert der Beteiligungen mit der Eigenschaft`, wert: summeTerm.toString(), quellen },
          { zeichen: "÷", bezeichnung: `${kopf}: Gesamtwert aller Beteiligungen`, wert: gesamt.toString() },
          { zeichen: "×", bezeichnung: "Prozent", wert: "100" },
          { zeichen: "=", bezeichnung: `${kopf}: Anteil in Prozent`, wert: wert.toString() },
        );
        break;
      case "mittel_prozent":
      case "energie_sektor":
        wert = summeTerm.div(gedeckt);
        schritte.push(
          { zeichen: "", bezeichnung: `${kopf}: Summe aus Wert × Angabe`, wert: summeTerm.toString(), quellen },
          { zeichen: "÷", bezeichnung: `${kopf}: Wert der Beteiligungen mit Angabe`, wert: gedeckt.toString() },
          { zeichen: "=", bezeichnung: `${kopf}: gewichteter Durchschnitt`, wert: wert.toString() },
        );
        break;
    }
  } else {
    schritte.push({ zeichen: "", bezeichnung: `${kopf}: keine Daten`, wert: "" });
  }
  return { stichtag, wert, abdeckung, schaetzanteil, schritte, bestand: true };
}

const mittel = (liste: Decimal[]): Decimal | null => (liste.length === 0 ? null : liste.reduce((s, x) => s.plus(x), new Decimal(0)).div(liste.length));

/**
 * Berechnet die Nachhaltigkeitsindikatoren des Fonds für das Berichtsjahr aus den Daten der Beteiligungsunternehmen.
 * Fehlende Daten zählen nicht mit; sie stehen als Abdeckung neben dem Wert. Fehlende oder nicht positive Hilfsgrößen
 * (Unternehmenswert, Umsatz) schließen das Unternehmen aus der betroffenen Rechnung aus und erscheinen als Befund.
 */
export function berechnePai(eingabe: PaiEingabe, katalog: PaiKatalog = PAI_KATALOG_V1): PaiErgebnis {
  const stichtage = paiStichtage(eingabe.jahr);
  const metriken = paiMetriken(eingabe.zusatz ?? [], katalog);
  const befunde: PaiBefund[] = [];
  const bestand = (b: PaiBeteiligung, s: string) => new Decimal(b.wert[s] ?? "0");
  const gehalten = eingabe.beteiligungen.filter((b) => stichtage.some((s) => bestand(b, s).gt(0)));

  // Bestand je Quartal
  const quartale = stichtage.map((s) => ({ stichtag: s, positionen: eingabe.beteiligungen.map((b) => ({ b, v: bestand(b, s) })).filter((p) => p.v.gt(0)) }));
  if (gehalten.length === 0) befunde.push({ code: "KEIN_BESTAND", params: { jahr: eingabe.jahr } });
  for (const q of quartale) if (gehalten.length > 0 && q.positionen.length === 0) befunde.push({ code: "QUARTAL_OHNE_BESTAND", stichtag: q.stichtag, params: { stichtag: q.stichtag } });

  // Befunde zu Hilfsgrößen, einmal je Unternehmen: nur wo das Unternehmen Emissions- oder Energiedaten hat, sonst genügt die Abdeckung.
  const emissionsKeys = new Set(metriken.filter((m) => m.formel === "absolut_evic" || m.formel === "fussabdruck_evic").flatMap((m) => m.eingaben));
  const umsatzKeys = new Set(metriken.filter((m) => m.formel === "intensitaet_umsatz" || m.formel === "energie_sektor").flatMap((m) => m.eingaben));
  for (const b of gehalten) {
    const hatEmission = [...emissionsKeys].some((k) => b.daten[k] !== undefined);
    const hatUmsatzDaten = [...umsatzKeys].some((k) => b.daten[k] !== undefined);
    const evic = b.daten[PAI_EVIC];
    if (hatEmission) {
      if (!evic) befunde.push({ code: "EVIC_FEHLT", beteiligungId: b.id, name: b.name, params: {} });
      else if (!(zahl(evic)?.gt(0) ?? false)) befunde.push({ code: "EVIC_NICHT_POSITIV", beteiligungId: b.id, name: b.name, params: { wert: evic.wert } });
    }
    const umsatz = b.daten[PAI_UMSATZ];
    if (hatEmission || hatUmsatzDaten) {
      if (!umsatz) befunde.push({ code: "UMSATZ_FEHLT", beteiligungId: b.id, name: b.name, params: {} });
      else if (!(zahl(umsatz)?.gt(0) ?? false)) befunde.push({ code: "UMSATZ_NICHT_POSITIV", beteiligungId: b.id, name: b.name, params: { wert: umsatz.wert } });
    }
    if (hatUmsatzDaten && b.nace === null) befunde.push({ code: "NACE_FEHLT", beteiligungId: b.id, name: b.name, params: {} });
    const ev = zahl(evic);
    if (ev !== null && ev.gt(0)) {
      for (const s of stichtage) {
        const v = bestand(b, s);
        if (v.gt(ev)) {
          befunde.push({ code: "ANTEIL_UEBER_100", beteiligungId: b.id, name: b.name, stichtag: s, params: { stichtag: s, wert: v.toString(), evic: ev.toString() } });
          break;
        }
      }
    }
  }

  const zeilen: PaiZeile[] = [];
  const bauen = (m: PaiMetrik, sektor?: string) => {
    const rechnungen = quartale.map((q) => rechneQuartal(m, sektor, q.stichtag, q.positionen));
    const mitWert = rechnungen.filter((r) => r.wert !== null);
    const wert = mittel(mitWert.map((r) => r.wert!));
    const abdeckung = mittel(rechnungen.filter((r) => r.bestand && r.abdeckung !== null).map((r) => r.abdeckung!));
    const schaetz = mittel(rechnungen.filter((r) => r.schaetzanteil !== null).map((r) => r.schaetzanteil!));
    const schritte: Rechenschritt[] = rechnungen.flatMap((r) => r.schritte);
    schritte.push({ zeichen: "=", bezeichnung: `Durchschnitt der Quartale mit Wert (${mitWert.length} von 4)`, wert: wert === null ? "nicht definiert" : wert.toString() });
    zeilen.push({
      code: sektor ? `${m.code}_${sektor.toLowerCase()}` : m.code,
      indikator: m.indikator,
      tabelle: m.tabelle,
      nr: m.nr,
      verpflichtend: m.verpflichtend,
      bezeichnungDe: m.bezeichnungDe,
      bezeichnungEn: m.bezeichnungEn,
      metrikDe: m.metrikDe,
      metrikEn: m.metrikEn,
      einheit: m.einheit,
      formel: m.formel,
      ...(sektor ? { sektor } : {}),
      wert: wert === null ? null : wert.toString(),
      abdeckung: abdeckung === null ? null : abdeckung.toString(),
      schaetzanteil: schaetz === null ? null : schaetz.toString(),
      quartale: rechnungen.map((r) => ({ stichtag: r.stichtag, wert: r.wert === null ? null : r.wert.toString(), abdeckung: r.abdeckung === null ? null : r.abdeckung.toString() })),
      schritte,
    });
  };
  for (const m of metriken) {
    if (m.formel === "energie_sektor") {
      // Je Sektor eine Zeile, nur wo der Fonds im Berichtsjahr eine Beteiligung hält.
      for (const s of PAI_KLIMASEKTOREN) if (gehalten.some((b) => b.nace === s.abschnitt)) bauen(m, s.abschnitt);
    } else bauen(m);
  }
  return { katalogVersion: katalog.version, jahr: eingabe.jahr, stichtage, zeilen, befunde };
}
