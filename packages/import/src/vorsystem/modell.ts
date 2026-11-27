import type { AUSWAHL } from "../spec";

/**
 * Neutrales Zwischenmodell für die Übernahme aus einem Vorsystem. Ein Adapter liest die API eines Quellsystems und liefert je Fonds
 * einen `FondsAuszug` in diesem Modell; die Pipeline führt die Auszüge zusammen (Dubletten über Fonds hinweg), bildet sie auf die
 * Blätter der Importvorlage ab und lässt sie durch Prüfung, Abnahmeprotokoll und Übernahme des Imports laufen.
 *
 * Alle IDs sind die IDs des Quellsystems (`quellId`), stabil über Läufe hinweg; daraus entstehen die Fachschlüssel des Imports, die
 * einen erneuten Lauf wiederholbar machen. Beträge sind Dezimalzeichenketten mit Punkt (`"1250000.00"`), Daten `JJJJ-MM-TT`.
 */

type Wert<T extends readonly { wert: string }[]> = T[number]["wert"];

export type Instrument = Wert<typeof AUSWAHL.instrument>;
export type BeteiligungStatus = Wert<typeof AUSWAHL.beteiligungStatus>;
export type BewertungMethode = Wert<typeof AUSWAHL.bewertungMethode>;
export type RundenRolle = Wert<typeof AUSWAHL.rundenRolle>;
export type OrganisationArt = Wert<typeof AUSWAHL.organisationArt>;
/** Kontrollgrößen; je Beteiligung zählen Zusagen, Auszahlungen und Rückflüsse. */
export type KontrollGroesse = Wert<typeof AUSWAHL.kontrollGroesse>;

/**
 * Arten von Vorgängen im Zwischenmodell: die Arten des Imports und zusätzlich `wandlung` (Wandlung eines Instruments). Wandlungen bucht
 * die Übernahme nicht selbst; sie erscheinen als Befund im Abnahmeprotokoll und werden über die Wandlung im Portfolio nachgetragen.
 */
export type VorgangArt = Wert<typeof AUSWAHL.vorgangArt> | "wandlung";

export type Periode = "monat" | "quartal" | "jahr";
export type Szenario = "ist" | "plan" | "forecast";

export interface QuellFonds {
  quellId: string;
  name: string;
  /** Kurzname, über den der Fonds im Bestand gefunden wird; ohne Angabe aus dem Namen abgeleitet. */
  kurzname?: string;
  vintage: number;
  zeichnungskapital: string;
  waehrung?: string;
}

export interface QuellOrganisation {
  quellId: string;
  name: string;
  /** Standard `unternehmen`; Mitinvestoren in Runden sind `investor`. */
  art?: OrganisationArt;
  website?: string;
  sektor?: string;
  ort?: string;
}

export interface QuellPerson {
  quellId: string;
  vorname: string;
  nachname: string;
  email?: string;
  funktion?: string;
  organisationId?: string;
}

/** Eine Beteiligung je Fonds, Unternehmen und Instrument (mehrere Instrumente am selben Unternehmen sind mehrere Einträge). */
export interface QuellBeteiligung {
  quellId: string;
  fondsId: string;
  organisationId: string;
  instrument: Instrument;
  bezeichnung?: string;
  erstinvestment: string;
  status?: BeteiligungStatus;
}

export interface QuellPosition {
  /** Genau eines: ein Fonds des Quellsystems oder ein dritter Investor (Organisation). */
  fondsId?: string;
  investorId?: string;
  betrag: string;
  anteile: number;
  rolle: RundenRolle;
}

export interface QuellRunde {
  quellId: string;
  organisationId: string;
  bezeichnung: string;
  datum: string;
  preMoney: string;
  postMoney: string;
  preisJeAnteil: string;
  anteileGesamtNach: number;
  positionen: QuellPosition[];
}

export interface QuellVorgang {
  quellId: string;
  beteiligungId: string;
  art: VorgangArt;
  datum: string;
  /** Mit Vorzeichen; nur Wertberichtigungen (Auflösung) und Stornos sind negativ. */
  betrag: string;
  /** Art oder Bezeichnung des Instruments, wenn die Beteiligung mehrere hat. */
  instrument?: string;
  rundeId?: string;
  bemerkung?: string;
  /** Storno: Quell-ID des stornierten Vorgangs. */
  storniertId?: string;
  /** Kapitalisierter Zins. */
  kapitalisiert?: boolean;
}

export interface QuellKennzahl {
  quellId: string;
  organisationId: string;
  /** Name oder Schlüssel der Kennzahl im Quellsystem; die Zuordnung zum Katalog steht in der Verbindung. */
  kennzahl: string;
  periodeBeginn: string;
  periodeEnde: string;
  szenario: Szenario;
  wert: string;
}

export interface QuellBewertung {
  quellId: string;
  beteiligungId: string;
  stichtag: string;
  wert: string;
  methode: BewertungMethode;
  begruendung?: string;
  grundlage?: string;
}

/** Summe laut Quellsystem, je Fonds oder (mit `beteiligungId`) je Beteiligung. */
export interface QuellKontrollsumme {
  fondsId: string;
  beteiligungId?: string;
  groesse: KontrollGroesse;
  betrag: string;
  stichtag?: string;
}

/** Was ein Adapter für einen Fonds liefert. Unternehmen, Personen und Runden dürfen in mehreren Auszügen vorkommen. */
export interface FondsAuszug {
  fonds: QuellFonds;
  organisationen: QuellOrganisation[];
  personen: QuellPerson[];
  beteiligungen: QuellBeteiligung[];
  runden: QuellRunde[];
  vorgaenge: QuellVorgang[];
  kennzahlen: QuellKennzahl[];
  bewertungen: QuellBewertung[];
  kontrollsummen: QuellKontrollsumme[];
}

/** Zusammengeführter Bestand aller gelesenen Fonds: jedes Objekt genau einmal. */
export interface Quellbestand {
  fonds: QuellFonds[];
  organisationen: QuellOrganisation[];
  personen: QuellPerson[];
  beteiligungen: QuellBeteiligung[];
  runden: QuellRunde[];
  vorgaenge: QuellVorgang[];
  kennzahlen: QuellKennzahl[];
  bewertungen: QuellBewertung[];
  kontrollsummen: QuellKontrollsumme[];
  /** Quell-IDs, die beim Zusammenführen auf eine andere ID zeigen (gleiches Unternehmen unter zwei IDs). */
  umgeleitet: Record<string, string>;
}

export const leererAuszug = (fonds: QuellFonds): FondsAuszug => ({ fonds, organisationen: [], personen: [], beteiligungen: [], runden: [], vorgaenge: [], kennzahlen: [], bewertungen: [], kontrollsummen: [] });
