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
  [null, /^\/changes$/, "alle"],
  // Fondsverwaltung: Stammdaten ändern, Rollen, Periodensperre, Freigabestufen, Zugänge der Investoren.
  [["PATCH"], /^\/funds\/:id$/, "fondsverwaltung"],
  [null, /^\/funds\/:id\/(roles|period-lock)(\/|$)/, "fondsverwaltung"],
  [["PUT"], /^\/funds\/:id\/approval-stages$/, "fondsverwaltung"],
  [null, /^\/funds\/:fundId\/investor-access/, "fondsverwaltung"],
  // Allgemein: Fondsliste und Stammdaten eines Fonds (Auswahllisten überall), eigene Einstellungen und Schlüssel, Namen, Suche, Stapel (prüft jede Teilanfrage selbst).
  [["GET"], /^\/funds(\/:id)?$/, "allgemein"],
  // Postfach gehört zu Kontakte: der Abgleich legt Aktivitäten an und ordnet Mails Organisationen und Personen zu.
  [null, /^\/mailbox(\/|$)/, "kontakte"],
  // Kontakte aus Postfach und Kalender: Vorschläge werden zu Personen und Unternehmen.
  [null, /^\/contact-suggestions(\/|$)/, "kontakte"],
  // Suche filtert je Gruppe von Treffern nach Bereich; der Stapel führt jede Operation durch dieselbe Rechtsprüfung.
  [null, /^\/(users\/names|settings|search|batch|exchange-rates)(\/|$)/, "allgemein"],
  // Nachschlagewerte, die Seiten mehrerer Bereiche brauchen: Felddefinitionen (auch für Fonds, Beteiligungen, Runden), Förderprogramme.
  [["GET"], /^\/(custom-fields\/:object\/(definitions|schema)|funding-programs|follow-ups\/count)$/, "allgemein"],
  // Fondsbezogene Unterseiten
  [null, /^\/funds\/:id\/approval-stages$/, "berichte"],
  [null, /^\/funds\/:id\/(postings|fund-movements|accounting|posting-exports|posting-rules|layout|accounts|account-rules|funding-sources|periods|balance-runs|reconciliation|voucher-templates|voucher-types|evaluation)(\/|$)/, "finanzen"],
  [null, /^\/investments\/:id\/accounting-keys$/, "finanzen"],
  [null, /^\/investments\/:id\/transactions$/, "portfolio"],
  [null, /^\/funds\/:id\/(journal|movements|fees-and-expenses|capital-accounts|accruals|interest)(\/|$)/, "finanzen"],
  [null, /^\/funds\/:id\/(reports|report-templates)(\/|$)/, "berichte"],
  [null, /^\/funds\/:id\/metrics(\/|$)/, "kennzahlen"],
  [null, /^\/funds\/:id\/(reporting-definitions|reporting-assignments)(\/|$)/, "meldewesen"],
  [null, /^\/funds\/:id(\/|$)/, "portfolio"],
  [null, /^\/investments\/:id\/metrics(\/|$)/, "kennzahlen"],
  [null, /^\/investments\/:id\/reports(\/|$)/, "berichte"],
  [null, /^\/investments(\/|$)/, "portfolio"],
  // Organisationen: Kapitaltabelle und Runden sind Finanzdaten, Meldedaten gehören zum Meldewesen, der Rest ist Kontaktpflege.
  [null, /^\/organizations\/:id\/(share-classes|financing-rounds|round-transactions|share-transfers|employee-pools)(\/|$)/, "portfolio"],
  [null, /^\/organizations\/:id\/reporting-data$/, "meldewesen"],
  [null, /^\/crm\/deals(\/|$)/, "dealflow"],
  [null, /^\/(organizations|people|contact-roles|organization-relationships|activities|follow-ups|meetings|contact-import|crm|custom-fields|register|vehicles)(\/|$)/, "kontakte"],
  [null, /^\/(deals|dealflow|resolution-templates)(\/|$)/, "dealflow"],
  [null, /^\/(instruments|tranches|milestones|funds|transactions|receivables|valuations|valuation-rounds|scenarios|sales|financing-rounds|round-positions)(\/|$)/, "portfolio"],
  [null, /^\/(fund-movements|interest-runs|vouchers|balance-runs|account-rules|posting-exports)(\/|$)/, "finanzen"],
  [null, /^\/metrics(\/|$)/, "kennzahlen"],
  [null, /^\/reports(\/|$)/, "berichte"],
  [null, /^\/(reporting-runs|reporting-definitions|funding-programs)(\/|$)/, "meldewesen"],
  [null, /^\/documents(\/|$)/, "dokumente"],
  [null, /^\/import(\/|$)/, "daten"],
];

/** Bereich einer Route nach `ZUORDNUNG`; `undefined`, wenn keine Zeile passt (der Test der Tabelle schlägt dann fehl). */
export function bereichVon(methode: Methode, muster: string): RegelBereich | undefined {
  return ZUORDNUNG.find(([m, re]) => (m === null || m.includes(methode)) && re.test(muster))?.[2];
}
