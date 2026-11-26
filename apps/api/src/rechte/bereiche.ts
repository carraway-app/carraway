import type { FondsRolle } from "@carraway/db";
import type { Methode } from "./tabelle";

/**
 * Bereiche der Anwendung (Rechtemodell, docs/rechte-modell.md). Eine Rolle bündelt Bereiche; jede Route mit Fondsrolle gehört zu genau
 * einem Bereich (oder zu `allgemein`). Personen ohne Gruppe haben alle Bereiche, Personen in Gruppen nur die Bereiche ihrer Rollen.
 */
export const BEREICHE = ["portfolio", "finanzen", "kennzahlen", "berichte", "meldewesen", "dealflow", "kontakte", "dokumente", "daten", "fondsverwaltung"] as const;
export type Bereich = (typeof BEREICHE)[number];

/**
 * Bereich einer Regel: ein Bereich; `allgemein` ohne Bereichsrecht (eigene Einstellungen, Namen, Suche, Fondsliste); `alle` nur mit allen
 * Bereichen (der Änderungsabruf liefert Datensätze aller Tabellen).
 */
export type RegelBereich = Bereich | "allgemein" | "alle";

export const istBereich = (wert: string): wert is Bereich => (BEREICHE as readonly string[]).includes(wert);

/**
 * Hat die Person den Bereich irgendwo? Globale Verwalter und Personen ohne Gruppe (`bereiche === null`) dürfen jeden. Bei Bereichen je Fonds
 * entscheidet danach die Stufe an Fonds und Bereich (`fuerBereich` in `anmeldung/akteur.ts`).
 */
export function hatBereich(akteur: { globalVerwalter: boolean; bereiche: ReadonlySet<Bereich> | null }, bereich: RegelBereich): boolean {
  if (bereich === "allgemein" || akteur.globalVerwalter || akteur.bereiche === null) return true;
  if (bereich === "alle") return BEREICHE.every((b) => akteur.bereiche!.has(b));
  return akteur.bereiche.has(bereich);
}

/** Rangfolge der Stufen, wie `ROLLEN_RANG` in `anmeldung/akteur.ts`. */
const RANG: Record<FondsRolle, number> = { betrachter: 1, bearbeiter: 2, freigeber: 3, verwalter: 4 };
export const hoehereStufe = (a: FondsRolle | null, b: FondsRolle | null): FondsRolle | null => (a === null ? b : b === null ? a : RANG[b] > RANG[a] ? b : a);
export const niedrigereStufe = (a: FondsRolle, b: FondsRolle): FondsRolle => (RANG[b] < RANG[a] ? b : a);

type Zuordnung = [methoden: Methode[] | null, muster: RegExp, bereich: RegelBereich];

/**
 * Bereich je Pfadmuster der Berechtigungstabelle, die erste passende Zeile gilt. Ein Test verlangt für jede Regel mit Fondsrolle einen
 * Treffer; eine neue Route ohne passende Zeile fällt dort auf.
 */
const ZUORDNUNG: Zuordnung[] = [
  [null, /^\/aenderungen$/, "alle"],
  // Fondsverwaltung: Stammdaten ändern, Rollen, Periodensperre, Freigabestufen, Zugänge der Investoren.
  [["PATCH"], /^\/fonds\/:id$/, "fondsverwaltung"],
  [null, /^\/fonds\/:id\/(rollen|periodensperre)(\/|$)/, "fondsverwaltung"],
  [["PUT"], /^\/fonds\/:id\/freigabestufen$/, "fondsverwaltung"],
  [null, /^\/fonds\/:fondsId\/investorenzugaenge/, "fondsverwaltung"],
  // Allgemein: Fondsliste und Stammdaten eines Fonds (Auswahllisten überall), eigene Einstellungen und Schlüssel, Namen, Suche, Stapel (prüft jede Teilanfrage selbst).
  [["GET"], /^\/fonds(\/:id)?$/, "allgemein"],
  // Postfach gehört zu Kontakte: der Abgleich legt Aktivitäten an und ordnet Mails Organisationen und Personen zu.
  [null, /^\/postfach(\/|$)/, "kontakte"],
  // Suche filtert je Gruppe von Treffern nach Bereich; der Stapel führt jede Operation durch dieselbe Rechtsprüfung.
  [null, /^\/(benutzer\/namen|einstellungen|suche|stapel|wechselkurse)(\/|$)/, "allgemein"],
  // Nachschlagewerte, die Seiten mehrerer Bereiche brauchen: Felddefinitionen (auch für Fonds, Beteiligungen, Runden), Förderprogramme.
  [["GET"], /^\/(zusatzfelder\/:objekt\/(definitionen|schema)|foerderprogramme|wiedervorlagen\/anzahl)$/, "allgemein"],
  // Fondsbezogene Unterseiten
  [null, /^\/fonds\/:id\/(journal|buchungen|fondsbewegungen|bewegungen|abgrenzung|zinsen|buchhaltung|buchungsexport|buchungsexporte|buchungsregeln|gliederung|konten|kontenregeln|mittelarten|perioden|saldenlaeufe|abstimmung|belegvorlagen|belegarten|auswertung)(\/|$)/, "finanzen"],
  [null, /^\/fonds\/:id\/(berichte|berichtsvorlagen|freigabestufen)(\/|$)/, "berichte"],
  [null, /^\/fonds\/:id\/kennzahlen(\/|$)/, "kennzahlen"],
  [null, /^\/fonds\/:id\/(meldedefinitionen|melde-zuordnungen)(\/|$)/, "meldewesen"],
  [null, /^\/fonds\/:id(\/|$)/, "portfolio"],
  [null, /^\/beteiligungen\/:id\/kennzahlen(\/|$)/, "kennzahlen"],
  [null, /^\/beteiligungen\/:id\/berichte(\/|$)/, "berichte"],
  [null, /^\/beteiligungen\/:id\/buchhaltungsschluessel$/, "finanzen"],
  [null, /^\/beteiligungen(\/|$)/, "portfolio"],
  // Organisationen: Kapitaltabelle und Runden sind Finanzdaten, Meldedaten gehören zum Meldewesen, der Rest ist Kontaktpflege.
  [null, /^\/organisationen\/:id\/(anteilsklassen|finanzierungsrunden|rundentransaktionen|mitarbeiterpools)(\/|$)/, "portfolio"],
  [null, /^\/organisationen\/:id\/meldedaten$/, "meldewesen"],
  [null, /^\/crm\/deals(\/|$)/, "dealflow"],
  [null, /^\/(organisationen|personen|kontaktrollen|organisationsbeziehungen|aktivitaeten|wiedervorlagen|termine|kontaktimport|crm|zusatzfelder|register|vehikel)(\/|$)/, "kontakte"],
  [null, /^\/(deals|dealflow|beschlussvorlagen)(\/|$)/, "dealflow"],
  [null, /^\/(instrumente|tranchen|meilensteine|vorgaenge|forderungen|bewertungen|bewertungsrunden|szenarien|verkaeufe|finanzierungsrunden|rundenpositionen)(\/|$)/, "portfolio"],
  [null, /^\/(fondsbewegungen|zinslaeufe|belege|saldenlaeufe|kontenregeln|buchungsexporte)(\/|$)/, "finanzen"],
  [null, /^\/kennzahlen(\/|$)/, "kennzahlen"],
  [null, /^\/berichte(\/|$)/, "berichte"],
  [null, /^\/(meldelaeufe|meldedefinitionen|foerderprogramme)(\/|$)/, "meldewesen"],
  [null, /^\/dokumente(\/|$)/, "dokumente"],
  [null, /^\/import(\/|$)/, "daten"],
];

/** Bereich einer Route nach `ZUORDNUNG`; `undefined`, wenn keine Zeile passt (der Test der Tabelle schlägt dann fehl). */
export function bereichVon(methode: Methode, muster: string): RegelBereich | undefined {
  return ZUORDNUNG.find(([m, re]) => (m === null || m.includes(methode)) && re.test(muster))?.[2];
}
