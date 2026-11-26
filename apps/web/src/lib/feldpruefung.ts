import type { Sprache } from "@carraway/ui";

/**
 * Prüfung von Eingaben direkt am Feld. Die Regeln spiegeln die Grenzen der Schemas der API (Beträge bis 16 Stellen und zwei Nachkommastellen,
 * Währungen als drei Großbuchstaben, Sätze als Anteil mit höchstens sechs Nachkommastellen, also vier in Prozent); die API prüft weiter, das Feld
 * zeigt den Fehler aber schon beim Tippen bzw. beim Verlassen. Eine Regel liefert `undefined` (in Ordnung) oder eine `Pruefung`.
 */

export type PruefCode =
  | "pflicht"
  | "zahlFormat"
  | "negativ"
  | "positivNoetig"
  | "nichtNull"
  | "nachkomma"
  | "zuGross"
  | "ganzzahl"
  | "bereich"
  | "datumFormat"
  | "datumFrueh"
  | "datumSpaet"
  | "waehrung"
  | "waehrungGleich";

export interface Pruefung {
  code: PruefCode;
  /** Zahlen und Texte für den Meldungstext (Grenzen, Stellen). */
  werte?: (string | number)[];
  /** Ein Fehler, den weiteres Tippen nicht behebt (falsches Zeichen, zu viele Stellen): er erscheint sofort, nicht erst beim Verlassen des Feldes. */
  sofort?: boolean;
}

export interface Pruefkontext {
  sprache: Sprache;
}

export type Regel<T extends Record<string, string> = Record<string, string>> = (wert: string, werte: T, kontext: Pruefkontext) => Pruefung | undefined;

const LEERZEICHEN = /\s/g;

/**
 * Zahl aus der Eingabe in die Schreibweise der API (`1234.5`). Deutsch: Komma ist das Dezimalzeichen, Punkte nur als Tausendertrennung in Dreiergruppen
 * (`1.234.567` oder `1.234,56`; eine einzelne Gruppe wie `1.234` bleibt Dezimalzahl); englisch umgekehrt. Ein einzelnes „falsches“ Trennzeichen gilt als Dezimalzeichen (`12.5` bzw. `12,5`). `null` bei allem anderen.
 */
export function zahlNormalisiert(eingabe: string, sprache: Sprache): string | null {
  const roh = eingabe.replace(LEERZEICHEN, "");
  if (roh === "") return null;
  const tausender = sprache === "de" ? "." : ",";
  const dezimal = sprache === "de" ? "," : ".";
  const mitTausendern = new RegExp(`^([-+]?)(\\d{1,3}(?:\\${tausender}\\d{3})+)(?:\\${dezimal}(\\d+))?$`).exec(roh);
  // Eine einzelne Dreiergruppe ohne Dezimalteil (`1.234`) bleibt mehrdeutig; sie gilt als Dezimalzahl (wie in der API) und scheitert dann an den Nachkommastellen,
  // statt still als Tausender gelesen zu werden.
  const eindeutig = mitTausendern && (mitTausendern[3] !== undefined || mitTausendern[2]!.split(tausender).length > 2);
  if (mitTausendern && eindeutig) return `${mitTausendern[1] === "-" ? "-" : ""}${mitTausendern[2]!.split(tausender).join("")}${mitTausendern[3] !== undefined ? `.${mitTausendern[3]}` : ""}`;
  const einfach = /^([-+]?)(\d*)(?:[.,](\d+))?$/.exec(roh);
  if (!einfach || (einfach[2] === "" && einfach[3] === undefined)) return null;
  return `${einfach[1] === "-" ? "-" : ""}${einfach[2] || "0"}${einfach[3] !== undefined ? `.${einfach[3]}` : ""}`;
}

const unzulaessigeZeichen = /[^\d\s.,+-]/;
const istNull = (zahl: string) => /^-?0*(\.0*)?$/.test(zahl);

export interface BetragOptionen {
  /** `nichtNegativ` (Standard), `positiv` (größer als null), `ungleichNull` (mit Vorzeichen, nicht null) oder `beliebig`. */
  vorzeichen?: "nichtNegativ" | "positiv" | "ungleichNull" | "beliebig";
  /** Muss der Betrag angegeben sein? Standard: nein. */
  pflicht?: boolean;
  /** Höchstzahl der Nachkommastellen (Standard 2, wie die API). */
  nachkomma?: number;
  /** Höchstzahl der Stellen vor dem Komma (Standard 16, wie die API). */
  ganzstellen?: number;
}

/** Regel für Beträge (Dezimalzahl mit Komma oder Punkt nach Sprache, höchstens zwei Nachkommastellen). */
export function betragRegel<T extends Record<string, string>>(optionen: BetragOptionen = {}): Regel<T> {
  const { vorzeichen = "nichtNegativ", pflicht = false, nachkomma = 2, ganzstellen = 16 } = optionen;
  return (wert, _werte, { sprache }) => {
    if (wert.trim() === "") return pflicht ? { code: "pflicht" } : undefined;
    if (unzulaessigeZeichen.test(wert)) return { code: "zahlFormat", sofort: true };
    const zahl = zahlNormalisiert(wert, sprache);
    if (zahl === null) return { code: "zahlFormat" };
    if (zahl.startsWith("-") && vorzeichen !== "beliebig" && vorzeichen !== "ungleichNull") return { code: "negativ", sofort: true };
    const [ganz = "", rest = ""] = zahl.replace("-", "").split(".");
    if (rest.length > nachkomma) return { code: "nachkomma", werte: [nachkomma], sofort: true };
    if (ganz.replace(/^0+/, "").length > ganzstellen) return { code: "zuGross", sofort: true };
    if (istNull(zahl) && (vorzeichen === "positiv" || vorzeichen === "ungleichNull")) return { code: vorzeichen === "positiv" ? "positivNoetig" : "nichtNull" };
    return undefined;
  };
}

export interface ProzentOptionen {
  min?: number;
  max?: number;
  pflicht?: boolean;
  /** Höchstzahl der Nachkommastellen (Standard 4: die API nimmt den Anteil mit sechs). */
  nachkomma?: number;
  /** Muss größer als `min` sein (zum Beispiel ein verkaufter Anteil größer als 0 Prozent). */
  ueberMin?: boolean;
}

/** Regel für Prozentsätze im Bereich `min` bis `max` (Standard 0 bis 100). */
export function prozentRegel<T extends Record<string, string>>(optionen: ProzentOptionen = {}): Regel<T> {
  const { min = 0, max = 100, pflicht = false, nachkomma = 4, ueberMin = false } = optionen;
  return (wert, _werte, { sprache }) => {
    if (wert.trim() === "") return pflicht ? { code: "pflicht" } : undefined;
    if (unzulaessigeZeichen.test(wert)) return { code: "zahlFormat", sofort: true };
    const zahl = zahlNormalisiert(wert.replace(LEERZEICHEN, ""), sprache);
    if (zahl === null) return { code: "zahlFormat" };
    const [, rest = ""] = zahl.split(".");
    if (rest.length > nachkomma) return { code: "nachkomma", werte: [nachkomma], sofort: true };
    const n = Number(zahl);
    if (n > max) return { code: "bereich", werte: [min, max], sofort: true };
    if (n < min) return { code: "bereich", werte: [min, max], sofort: min >= 0 && zahl.startsWith("-") };
    if (ueberMin && n === min) return { code: "bereich", werte: [min, max] };
    return undefined;
  };
}

export interface GanzzahlOptionen {
  min?: number;
  /** Obergrenze; mit ihr meldet die Regel zu kleine und zu große Werte als Bereich (zum Beispiel Jahreszahlen). */
  max?: number;
  pflicht?: boolean;
  /** Höchstzahl der Stellen (Standard 18, wie die API bei Anteilen). */
  stellen?: number;
}

/** Regel für ganze Zahlen (Anteile, Stückzahlen), größer oder gleich `min` (Standard 0). */
export function ganzzahlRegel<T extends Record<string, string>>(optionen: GanzzahlOptionen = {}): Regel<T> {
  const { min = 0, max, pflicht = false, stellen = 18 } = optionen;
  return (wert) => {
    const roh = wert.replace(LEERZEICHEN, "");
    if (roh === "") return pflicht ? { code: "pflicht" } : undefined;
    if (!/^-?\d+$/.test(roh)) return { code: "ganzzahl", sofort: /[^\d-]/.test(roh) };
    if (roh.startsWith("-") && min >= 0) return { code: "negativ", sofort: true };
    if (roh.replace("-", "").replace(/^0+/, "").length > stellen) return { code: "zuGross", sofort: true };
    if (max !== undefined && (Number(roh) < min || Number(roh) > max)) return { code: "bereich", werte: [min, max] };
    if (Number(roh) < min) return { code: min > 0 ? "positivNoetig" : "negativ" };
    return undefined;
  };
}

export interface DatumOptionen {
  pflicht?: boolean;
  /** Frühestes und spätestes Datum (ISO `JJJJ-MM-TT`). */
  min?: string | undefined;
  max?: string | undefined;
}

const istKalenderdatum = (iso: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
};

/** Regel für Datumsfelder (`type="date"` liefert ISO oder leer; die Regel prüft auch Eingaben aus Tests, Einfügen und Grenzen). */
export function datumRegel<T extends Record<string, string>>(optionen: DatumOptionen = {}): Regel<T> {
  const { pflicht = false, min, max } = optionen;
  return (wert) => {
    if (wert.trim() === "") return pflicht ? { code: "pflicht" } : undefined;
    if (!istKalenderdatum(wert)) return { code: "datumFormat" };
    if (min && wert < min) return { code: "datumFrueh", werte: [min] };
    if (max && wert > max) return { code: "datumSpaet", werte: [max] };
    return undefined;
  };
}

/** Regel für Währungscodes (drei Buchstaben, groß geschrieben wie bei der API). */
export function waehrungRegel<T extends Record<string, string>>(optionen: { pflicht?: boolean } = {}): Regel<T> {
  return (wert) => {
    const roh = wert.trim();
    if (roh === "") return optionen.pflicht ? { code: "pflicht" } : undefined;
    return /^[A-Z]{3}$/.test(roh) ? undefined : { code: "waehrung" };
  };
}

/** Regel für Pflichtangaben ohne weitere Form (Auswahl, Text). */
export function pflichtRegel<T extends Record<string, string>>(): Regel<T> {
  return (wert) => (wert.trim() === "" ? { code: "pflicht" } : undefined);
}

/** Der Tag nach einem ISO-Datum (für Grenzen wie „Fälligkeit nach dem Datum“); ein ungültiges Datum bleibt `undefined`. */
export function tagNach(iso: string): string | undefined {
  if (!istKalenderdatum(iso)) return undefined;
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
