/**
 * Eingabedaten der Berichte. Bewusst eigenständige Strukturtypen: Die API reicht ihre Antworten
 * unverändert durch, das Paket kennt weder Datenbank noch HTTP. Beträge sind Zeichenketten (Entscheidung 7).
 */

export type Sprache = "de" | "en";
export const SPRACHEN: readonly Sprache[] = ["de", "en"];

export interface Rechenschritt {
  zeichen: string;
  bezeichnung: string;
  wert: string;
  quellen?: string[];
}

export interface Kennzahl {
  /** Dezimalzahl als Zeichenkette; `null`, wenn nicht definiert. */
  wert: string | null;
  schritte: Rechenschritt[];
}

/** Typ eines eigenen Feldes (Zusatzfeld), wie die Feld-Engine ihn führt. */
export type ZusatzfeldTyp = "text" | "langtext" | "zahl" | "betrag" | "datum" | "auswahl" | "mehrfachauswahl" | "kontrollkaestchen" | "url" | "email" | "telefon" | "benutzer" | "verknuepfung";

/**
 * Ein eigenes Feld als Spalte eines Berichts: Definition (Name, Typ, Optionen) und Objekt, an dem der Wert steht. Die Werte stehen je Zeile unter `felder`
 * (Schlüssel = `id`); Verknüpfungs- und Personenfelder tragen den aufgelösten Namen, nicht die Kennung.
 */
export interface ZusatzSpalte {
  id: string;
  name: string;
  typ: ZusatzfeldTyp;
  objekt: "fonds" | "runde" | "instrument" | "beteiligung";
  /** Währung bei Betragsfeldern. */
  waehrung?: string;
  /** Optionen bei Auswahlfeldern (Schlüssel und Bezeichnung). */
  optionen?: { schluessel: string; label: string }[];
}
export type ZusatzWerte = Record<string, unknown>;

/** Währungssicht eines Berichts: Standard ist die Fondswährung (`fonds`, nichts zu tun), `lokal` die Währung der Beteiligung je Zeile, `vergleich` eine gewählte dritte Währung. */
export type Waehrungssicht = "fonds" | "lokal" | "vergleich";

/** Beträge einer Zeile in der Währung der Sicht (`null` = Lücke: kein ausreichend aktueller Kurs, es steht keine Zahl). */
export interface SichtBetraege {
  waehrung: string;
  investiert: string | null;
  rueckfluesse: string | null;
  bewertung: string | null;
  /** Es gibt noch keine Bewertung: Die Spalte zeigt „–“, das ist keine Lücke. */
  ohneBewertung?: boolean;
}
export interface SichtKurs {
  von: string;
  nach: string;
  /** Einheiten `nach` je 1 Einheit `von`. */
  kurs: string;
  kursDatum: string;
  /** Tag des Postens, für den der Kurs gilt. */
  tag: string;
  verwendung: "kosten" | "zeitwert";
}
export interface SichtLueckeBericht {
  von: string;
  nach: string;
  tag: string;
  grund: "kein_kurs" | "veraltet";
  letzterKursDatum: string | null;
  verwendung: "kosten" | "zeitwert";
}
/** Währungssicht der Daten eines Berichts: die verwendeten Kurse (mit Datum) und die Lücken, ausgewiesen im Bericht. */
export interface BerichtsWaehrungssicht {
  sicht: "lokal" | "vergleich";
  vergleich: string | null;
  kurse: SichtKurs[];
  luecken: SichtLueckeBericht[];
}

export interface FondsInfo {
  name: string;
  kurzname: string;
  waehrung: string;
  zeichnungskapital: string;
}

export interface BeteiligungZeile {
  id: string;
  organisation: { name: string; sektor: string | null };
  /** Art des Hauptinstruments. */
  instrument: string;
  /** Alle Instrumente der Beteiligung; fehlt bei Snapshots aus der Zeit vor den Instrumenten. */
  instrumente?: { art: string; bezeichnung: string; status: string }[];
  status: string;
  erstinvestment: string;
  zusage: string;
  investiert: string;
  rueckfluesse: string;
  letzteBewertung: { stichtag: string; wert: string; methode: string } | null;
  /** Offene Kaufpreisforderungen zum Stichtag (zählen zum Wertansatz); fehlt bei älteren Snapshots. */
  offeneForderungen?: string;
  multiple: Kennzahl;
  /** Werte eigener Felder (Schlüssel = ID der Felddefinition), wenn die Vorlage welche wählt. */
  felder?: ZusatzWerte;
  /** Beträge in lokaler oder Vergleichswährung (Währungssicht des Berichts). */
  sicht?: SichtBetraege;
}

export interface FondsberichtDaten {
  fonds: FondsInfo;
  stichtag: string;
  /** Wissensstand als ISO-Zeitstempel. */
  wissensstand: string;
  kennzahlen: { abgerufen: Kennzahl; eingezahlt?: Kennzahl; offen?: Kennzahl; ueberfaellig?: Kennzahl; ungeklaert?: Kennzahl; ausschuettungen: Kennzahl; nav: Kennzahl; tvpi: Kennzahl; dpi: Kennzahl; rvpi: Kennzahl; irr: Kennzahl };
  beteiligungen: BeteiligungZeile[];
  /** Eigene Felder als Spalten (in der Reihenfolge der Vorlage). */
  zusatzspalten?: ZusatzSpalte[];
  waehrungssicht?: BerichtsWaehrungssicht;
}

export interface QuartalsVorgang {
  art: string;
  valuta: string;
  betrag: string;
  bemerkung: string | null;
  istStorno: boolean;
  storniert: boolean;
}

/** Eine Kennzahl des Unternehmens im Quartalsbericht: zuletzt bestätigter Ist-Wert bis zum Stichtag und der Plan desselben Zeitraums. */
export interface UnternehmensKennzahl {
  schluessel: string;
  bezeichnungDe: string;
  bezeichnungEn: string;
  einheit: string;
  typ: "betrag" | "zahl" | "prozent" | "ja_nein" | "text";
  /** Zeitraum des Ist-Werts; leer, wenn es noch keinen bestätigten Wert gibt. */
  periodeBeginn: string | null;
  periodeEnde: string | null;
  ist: string | null;
  plan: string | null;
  /** Ist minus Plan; `prozent` ist die relative Abweichung in Prozent (leer bei Plan 0). Leer ohne Plan und bei Ja/Nein und Text. */
  absolut: string | null;
  prozent: string | null;
}

export interface QuartalsberichtDaten {
  stichtag: string;
  wissensstand: string;
  fonds: { name: string; kurzname: string };
  organisation: { name: string; sektor: string | null; ort: string | null };
  beteiligung: { instrument: string; status: string; erstinvestment: string };
  /** Alle Vorgänge bis zum Stichtag; der Bericht zeigt die des Quartals. */
  vorgaenge: QuartalsVorgang[];
  bewertungsverlauf: { stichtag: string; wert: string; methode: string }[];
  kennzahlen: { investiert: Kennzahl; rueckfluesse: Kennzahl; bewertung: Kennzahl; multiple: Kennzahl; irr: Kennzahl };
  /** Kennzahlen des Unternehmens (Etappe 11) für den Abschnitt `unternehmenskennzahlen`; ohne Angabe bleibt der Abschnitt leer. */
  unternehmenskennzahlen?: UnternehmensKennzahl[];
}

export interface GremienAktivitaet {
  datum: string;
  art: string;
  titel: string;
  notiz?: string | null;
}

export interface GremienBeschluss {
  gremium: string;
  datum: string;
  ergebnis: "zugestimmt" | "abgelehnt" | "vertagt";
  betrag: string | null;
  auflagen: string | null;
}

export interface GremienDeal {
  titel: string;
  organisation: { name: string; sektor: string | null; ort?: string | null };
  fonds: string | null;
  ticket: string | null;
  quelle: string | null;
  betreuung: string | null;
  beschluesse: GremienBeschluss[];
  /** Beschlussvorschlag: Text am Deal oder, ohne diesen, die Auflagen des jüngsten vertagten Beschlusses. */
  beschlussvorschlag?: { text: string; quelle: "deal" | "vertagt" } | null;
  /** Zusammenfassung der Aktivitäten (jüngste zuerst, begrenzt). */
  aktivitaeten?: GremienAktivitaet[];
  /** Gesamtzahl der Aktivitäten des Deals (die Liste kann kürzer sein). */
  aktivitaetenGesamt?: number;
}

export interface GremienDaten {
  /** Tag der Erstellung, Stichtag der Vorlage. */
  stichtag: string;
  wissensstand: string;
  deals: GremienDeal[];
  /** Zeitraum der Beschlüsse im Abschnitt „Beschlüsse des Zeitraums“; fehlt = kein Abschnitt. */
  zeitraum?: { von: string; bis: string };
  beschluesseImZeitraum?: (GremienBeschluss & { deal: string; organisation: string })[];
}

export interface Kapitalkonto {
  investor: string;
  zusage: string;
  /** Anteil am Fonds (0,35 = 35 %). */
  anteil: string;
  abgerufen: string;
  eingezahlt?: string;
  offen?: string;
  ueberfaellig?: string;
  ausgeschuettet: string;
  /** Zusage − Abrufe. */
  offeneZusage: string;
  /** Anteil am NAV des Stichtags (auf den Cent verteilt). */
  navAnteil: string | null;
}

/** LP-Bericht: Fondsbericht plus Kapitalkonten je Investor. Die Summen der Kapitalkonten sind die Summen des Fonds. */
export interface LpBerichtDaten extends FondsberichtDaten {
  kapitalkonten: Kapitalkonto[];
}

export interface PortfolioListeZeile {
  organisation: string;
  sektor: string | null;
  /** Phase des Unternehmens: Bezeichnung der letzten Finanzierungsrunde bis zum Stichtag. */
  phase: string | null;
  instrument: string;
  status: string;
  betreuung: string | null;
  zusage: string;
  investiert: string;
  buchwert: string;
  wertberichtigung: string;
  offeneZusage: string;
  bewertung: string | null;
  multiple: string | null;
  felder?: ZusatzWerte;
  sicht?: SichtBetraege;
}

export interface PortfolioListeDaten {
  fonds: FondsInfo;
  stichtag: string;
  wissensstand: string;
  zeilen: PortfolioListeZeile[];
  zusatzspalten?: ZusatzSpalte[];
  waehrungssicht?: BerichtsWaehrungssicht;
}

export type ExitArt = "verkauf" | "insolvenz" | "rueckzahlung" | "liquidation";

export interface ExitListeZeile {
  organisation: string;
  art: ExitArt;
  datum: string | null;
  investiert: string;
  erloes: string;
  multiple: string | null;
  irr: string | null;
  offeneForderungen: string;
  felder?: ZusatzWerte;
  sicht?: SichtBetraege;
}

export interface ExitListeDaten {
  fonds: FondsInfo;
  stichtag: string;
  wissensstand: string;
  zeilen: ExitListeZeile[];
  zusatzspalten?: ZusatzSpalte[];
  waehrungssicht?: BerichtsWaehrungssicht;
}

/** Gemeinsame Optionen aller Berichte. */
export interface BerichtsOptionen {
  /** Entwurf mit Wasserzeichen (Standard) oder freigegebene Fassung ohne Wasserzeichen und Entwurfshinweise. */
  entwurf?: boolean;
  /** Vorlage des Fonds; ohne Angabe die Standardkonfiguration der Art. */
  konfiguration?: import("./konfiguration").Vorlagenkonfiguration;
  /** Freitexte des LP-Berichts je Schlüssel (`vorwort`, `marktumfeld`, `ausblick`) in der Berichtssprache. */
  freitexte?: Record<string, string>;
  /**
   * LP-Bericht für genau einen Investor: Die Daten enthalten nur dessen Kapitalkonto (die übrigen sind vorher herausgefiltert, nachdem alle
   * Konten gemeinsam auf den Cent verteilt wurden). Der Abschnitt „Kapitalkonten“ zeigt dann einen eigenen Hinweis und keine Summenzeile,
   * weil die Summe nicht mehr die des Fonds ist.
   */
  kapitalkontoEinzeln?: boolean;
}

/** Eine Zeile der PAI-Erklärung (Tabelle 1 der Anlage I zur Delegierten Verordnung (EU) 2022/1288): Indikator, Metrik, Auswirkung des Jahres und des Vorjahres. */
export interface PaiZeileBericht {
  code: string;
  /** Indikator (Gruppe der Zeilen), z. B. `t1_01`; Schlüssel der Freitexte `erlaeuterung_<indikator>` und `massnahmen_<indikator>`. */
  indikator: string;
  tabelle: 1 | 2 | 3;
  nr: number;
  bezeichnungDe: string;
  bezeichnungEn: string;
  metrikDe: string;
  metrikEn: string;
  einheit: string;
  /** Sektor (NACE-Abschnitt) bei der Energieintensität je Sektor, mit Bezeichnung. */
  sektor?: string;
  sektorBezeichnungDe?: string;
  sektorBezeichnungEn?: string;
  /** Auswirkung, Abdeckung (0 bis 1) und Schätzanteil (0 bis 1) als Dezimalzahl-Zeichenkette; `null`, wenn nicht definiert. */
  wert: string | null;
  abdeckung: string | null;
  schaetzanteil: string | null;
  vorjahr: { wert: string | null; abdeckung: string | null; schaetzanteil: string | null } | null;
  /** Werte der Quartalsenden des Berichtsjahres für den Abschnitt Herkunft. */
  quartale: { stichtag: string; wert: string | null; abdeckung: string | null }[];
}

export interface PaiBefundBericht {
  code: string;
  name?: string;
  params: Record<string, string | number>;
}

export interface PaiErklaerungDaten {
  fonds: FondsInfo;
  /** Berichtsjahr; Stichtag ist der 31.12. */
  jahr: number;
  stichtag: string;
  wissensstand: string;
  katalogVersion: number;
  /** Einordnung des Fonds zum Stichtag (Artikel 6, 8 oder 9) mit Gültigkeitsbeginn; leer, wenn nicht erfasst. */
  offenlegung: { art: "art6" | "art8" | "art9"; gueltigAb: string } | null;
  zeilen: PaiZeileBericht[];
  befunde: PaiBefundBericht[];
  /** Anzahl der Beteiligungsunternehmen mit Bestand im Berichtsjahr. */
  unternehmen: number;
}
