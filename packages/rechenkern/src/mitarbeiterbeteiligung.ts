import { Decimal } from "./decimal.js";
import { vergleiche, zerlege, type Datum } from "./datum.js";

/**
 * Mitarbeiterbeteiligung (ESOP mit Optionen auf echte Anteile, VSOP mit virtuellen Anteilen): Vesting, Stand eines Pools und Preis je
 * Anteil auf voll verwässerter Basis. Reine Funktionen, exakte Decimal-Rechnung. Die Regeln stehen hier und gleichlautend in
 * `referenz/referenz_mitarbeiterbeteiligung.py` (unabhängige Rechnung mit Brüchen):
 *
 * - **Volle Monate** von `von` bis `bis`: Monatsdifferenz, um eins weniger, wenn der Tag in `bis` vor dem Tag in `von` liegt (ein Tag nach
 *   dem Monatsende von `bis` zählt als Monatsende, 31.01. → 28.02. ist ein voller Monat). Vor `von` null.
 * - **Vesting:** linear in Stufen von `taktMonate` (1, 3, 6 oder 12; Standard 1) ab Vesting-Beginn über `vestingMonate`; vor dem Ende des
 *   Cliffs (`cliffMonate`) nichts, am Cliff der bis dahin aufgelaufene Teil. Gezählt werden die vollen Monate, abgerundet auf ein Vielfaches
 *   des Takts (M = abgerundet(Monate ÷ Takt) × Takt). Gevestet = abgerundet auf ganze Einheiten (Anzahl × min(1, M ÷ Dauer)). Dauer 0:
 *   sofort alles. Ein individueller Stufenplan ersetzt Takt und Dauer. Ab dem Cliff gilt die Summe der erreichten Anteile,
 *   einmal auf ganze Einheiten abgerundet. Bei Erreichen aller Stufen bleibt kein Rundungsrest übrig.
 * - **Beschleunigung beim Exit:** ein Bruch b (0 bis 1) der zum Exit noch nicht gevesteten Einheiten vestet zusätzlich, abgerundet.
 *   Bei Double Trigger gilt der Bruch nur mit zweitem Auslöser. Ungevestete Einheiten ohne Beschleunigung verfallen beim Exit.
 * - **Status:** `verfallen` und `ausgeuebt` gelten ab ihrem Datum (vorher wie zugeteilt); verfallene Einheiten gehen in den freien Pool
 *   zurück, ausgeübte verlassen den Pool (ESOP: sie sind dann ausgegebene Anteile; VSOP: ausgezahlt). `gevestet` heißt voll gevestet.
 * - **Austritte (Leaver):** eine Zuteilung kann mehrere Austritte haben (aggregierte Zuteilung, Personen scheiden zu verschiedenen Daten
 *   aus). Jeder Austritt i hat Art (Good oder Bad Leaver), Datum A_i, betroffene Einheiten B_i und die Regel für die gevesteten Einheiten;
 *   Σ B_i ≤ Anzahl. Vor A_i gilt für B_i der Plan. Ab A_i friert das Vesting der B_i Einheiten ein: gevestet bei Austritt
 *   gB_i = abgerundet(B_i × Anteil nach Plan zu A_i) (vor dem Cliff 0), der ungevestete Rest B_i − gB_i verfällt. gB_i bleibt
 *   (`bleiben`, nimmt am Exit ohne Beschleunigung teil), verfällt (`verfallen`) oder wird zurückgekauft (`rueckkauf`, zum Rückkaufpreis,
 *   ohne Angabe zum Basispreis; Betrag = gB_i × Preis). Die übrigen Anzahl − Σ B_i (Summe über die Austritte bis zum Stichtag) vesten
 *   weiter nach Plan (eine eigene Abrundung). Verfallene und zurückgekaufte Einheiten gehen in den freien Pool zurück. Die Art ist eine
 *   Bezeichnung, sofern keine passende Leaver-Stufe vorliegt. Eine Stufe gibt vor, welcher Bruch der gevesteten Einheiten bleibt.
 * - **Teilausübungen:** am Datum aus den gevesteten Einheiten entnommen, jeweils nach etwaigen Austritten desselben Tages. Bereits
 *   ausgeübte Einheiten bleiben ausgeübt. Bei aggregierten Zuteilungen werden zuerst am Austritt eingefrorene Einheiten verwendet.
 *   Der Status `ausgeuebt` steht nur ohne einzelne Ausübungen für die gesamte Zuteilung.
 * - **Pool zum Stichtag:** Größe = Summe der Änderungen bis zum Stichtag; zugeteilt (ausstehend) = Einheiten der Zuteilungen bis zum
 *   Stichtag, die weder verfallen, zurückgekauft noch ausgeübt sind; frei = Größe − ausstehend − ausgeübt (nicht unter null).
 * - **Grobe Erfassung (nur Pool):** statt einzelner Zuteilungen eine Zahl vergebener Einheiten V. Ausstehend = min(V, max(0, Größe)),
 *   frei = max(0, Größe − ausstehend); nichts ist ausgeübt, verfallen oder zurückgekauft. Im Wasserfall gelten die V Einheiten als voll
 *   beteiligt (Näherung, ein mittlerer Basispreis).
 * - **Preis je Anteil voll verwässert:** Pre-Money ÷ (ausgegebene Anteile vor der Runde + Pool vor der Runde + Aufstockung im Pre-Money).
 *   Neue Anteile = Volumen ÷ Preis. Eine Aufstockung im Post-Money wird nach der Runde geschaffen und verwässert alle, auch die neuen
 *   Investoren; sie geht nicht in den Preis ein.
 */

const ZERO = new Decimal(0);

/** Erlaubte Takte des Vestings in Monaten. */
export const VESTING_TAKTE: readonly number[] = [1, 3, 6, 12];

function letzterTag(jahr: number, monat: number): number {
  return new Date(Date.UTC(jahr, monat, 0)).getUTCDate();
}

/** Volle Monate von `von` bis `bis` (vor `von`: 0). */
export function volleMonate(von: Datum, bis: Datum): number {
  if (vergleiche(bis, von) <= 0) return 0;
  const a = zerlege(von);
  const b = zerlege(bis);
  let monate = (b.jahr - a.jahr) * 12 + (b.monat - a.monat);
  const stichtag = Math.min(a.tag, letzterTag(b.jahr, b.monat));
  if (b.tag < stichtag) monate--;
  return Math.max(0, monate);
}

export type ZuteilungStatus = "zugeteilt" | "gevestet" | "verfallen" | "ausgeuebt";
export type LeaverArt = "good_leaver" | "bad_leaver";
/** Was mit den bei Austritt gevesteten Einheiten geschieht. */
export type LeaverGevestet = "bleiben" | "verfallen" | "rueckkauf";

export type VestingStufe = (
  | { monate: number; datum?: never }
  | { datum: Datum; monate?: never }
) & { anteil: Decimal.Value };

export interface LeaverStufe {
  art: LeaverArt;
  mindestMonate: number;
  /** Anteil der beim Austritt bereits gevesteten Einheiten, der bleibt (0 bis 1). */
  anteil: Decimal.Value;
}

export interface Ausuebung {
  datum: Datum;
  anzahl: Decimal.Value;
  /** Ausübungspreis je Einheit. */
  preis: Decimal.Value;
}

export type BeschleunigungAusloeser = "einfach" | "doppelt";

interface Zuteilungsdetails {
  vestingStufen?: readonly VestingStufe[] | null;
  leaverStufen?: readonly LeaverStufe[] | null;
  ausuebungen?: readonly Ausuebung[] | null;
  beschleunigungAusloeser?: BeschleunigungAusloeser | null;
}

export interface Leaver {
  art: LeaverArt;
  austrittAm: Datum;
  /** Betroffene Einheiten (ganze Zahl ab 1; die Summe über alle Austritte einer Zuteilung höchstens ihre Anzahl). */
  anzahl: Decimal.Value;
  gevestet: LeaverGevestet;
  /** Rückkaufpreis je Einheit bei `rueckkauf`; ohne Angabe der Basispreis. */
  rueckkaufpreis?: Decimal.Value | null;
}

export interface Vesting extends Zuteilungsdetails {
  anzahl: Decimal.Value;
  /** Beginn des Vestings (meist das Zuteilungsdatum). */
  beginn: Datum;
  /** Zuteilungsdatum für Leaver-Stufen und frühestes Ausübungsdatum. */
  zugeteiltAm?: Datum;
  cliffMonate: number;
  vestingMonate: number;
  /** Takt des Vestings in Monaten (1, 3, 6 oder 12; Standard 1). */
  taktMonate?: number;
  /** Bruch der beim Exit noch nicht gevesteten Einheiten, der zusätzlich vestet (0 bis 1). */
  beschleunigung?: Decimal.Value | null;
  /** Standard `zugeteilt`; `gevestet` = voll gevestet. */
  status?: ZuteilungStatus;
  /** Ab wann `verfallen` oder `ausgeuebt` gilt; ohne Datum ab sofort. */
  statusAm?: Datum | null;
  /** Basispreis je Einheit (für den Rückkauf zum Basispreis). */
  basispreis?: Decimal.Value | null;
  /** Austritte aus der Zuteilung (Reihenfolge egal). */
  austritte?: readonly Leaver[] | null;
}

/** Eingabebereich, der bei einem ungültigen Plan oder Zeitverlauf korrigiert werden muss. */
export class ZuteilungsFehler extends Error {
  constructor(readonly feld: "vestingStufen" | "leaverStufen" | "ausuebungen", meldung: string) {
    super(meldung);
  }
}

function pruefeVesting(v: Vesting): { anzahl: Decimal; b: Decimal } {
  const anzahl = new Decimal(v.anzahl);
  if (!anzahl.isFinite() || anzahl.isNegative() || !anzahl.isInteger()) throw new Error("Vesting: Anzahl muss eine ganze Zahl ab null sein");
  if (!Number.isInteger(v.cliffMonate) || v.cliffMonate < 0) throw new Error("Vesting: Cliff muss eine ganze Zahl von Monaten ab null sein");
  if (!Number.isInteger(v.vestingMonate) || v.vestingMonate < 0) throw new Error("Vesting: Dauer muss eine ganze Zahl von Monaten ab null sein");
  if (v.taktMonate !== undefined && !VESTING_TAKTE.includes(v.taktMonate)) throw new Error("Vesting: Takt muss 1, 3, 6 oder 12 Monate sein");
  const b = new Decimal(v.beschleunigung ?? 0);
  if (!b.isFinite() || b.isNegative() || b.greaterThan(1)) throw new Error("Vesting: Beschleunigung muss zwischen 0 und 1 liegen");
  zerlege(v.beginn);
  if (v.zugeteiltAm !== undefined) zerlege(v.zugeteiltAm);
  if (v.statusAm != null) zerlege(v.statusAm);
  let anteile = ZERO;
  for (const stufe of v.vestingStufen ?? []) {
    if (stufe.datum !== undefined && stufe.monate === undefined) {
      if (vergleiche(stufe.datum, v.beginn) < 0) throw new ZuteilungsFehler("vestingStufen", "Vesting: Meilenstein liegt vor dem Vesting-Beginn");
    } else if (stufe.datum !== undefined || stufe.monate === undefined || !Number.isSafeInteger(stufe.monate) || stufe.monate < 0) {
      throw new ZuteilungsFehler("vestingStufen", "Vesting: Stufe braucht ein Datum oder eine ganze Anzahl Monate ab null");
    }
    const anteil = new Decimal(stufe.anteil);
    if (!anteil.isFinite() || !anteil.greaterThan(0) || anteil.greaterThan(1)) throw new ZuteilungsFehler("vestingStufen", "Vesting: Stufenanteil muss größer null und höchstens 1 sein");
    anteile = anteile.plus(anteil);
  }
  if (v.vestingStufen?.length && !anteile.equals(1)) throw new ZuteilungsFehler("vestingStufen", "Vesting: Stufenanteile müssen zusammen 1 ergeben");
  const leaverSchwellen = new Set<string>();
  for (const stufe of v.leaverStufen ?? []) {
    if (stufe.art !== "good_leaver" && stufe.art !== "bad_leaver") throw new ZuteilungsFehler("leaverStufen", "Leaver: ungültige Austrittsart");
    if (!Number.isSafeInteger(stufe.mindestMonate) || stufe.mindestMonate < 0) throw new ZuteilungsFehler("leaverStufen", "Leaver: Mindestdauer muss eine ganze Zahl von Monaten ab null sein");
    const anteil = new Decimal(stufe.anteil);
    if (!anteil.isFinite() || anteil.lessThan(0) || anteil.greaterThan(1)) throw new ZuteilungsFehler("leaverStufen", "Leaver: Stufenanteil muss zwischen 0 und 1 liegen");
    const schwelle = `${stufe.art}:${stufe.mindestMonate}`;
    if (leaverSchwellen.has(schwelle)) throw new ZuteilungsFehler("leaverStufen", "Leaver: Mindestdauer je Austrittsart darf nur einmal vorkommen");
    leaverSchwellen.add(schwelle);
  }
  let summe = ZERO;
  for (const l of v.austritte ?? []) {
    zerlege(l.austrittAm);
    const betroffen = new Decimal(l.anzahl);
    if (!betroffen.isFinite() || !betroffen.isInteger() || betroffen.lessThan(1)) throw new Error("Leaver: betroffene Einheiten müssen eine ganze Zahl ab 1 sein");
    summe = summe.plus(betroffen);
    const preis = new Decimal(l.rueckkaufpreis ?? 0);
    if (!preis.isFinite() || preis.isNegative()) throw new Error("Leaver: Rückkaufpreis darf nicht negativ sein");
  }
  if (summe.greaterThan(anzahl)) throw new Error("Leaver: die Austritte betreffen mehr Einheiten als zugeteilt");
  for (const ausuebung of v.ausuebungen ?? []) {
    if (vergleiche(ausuebung.datum, v.zugeteiltAm ?? v.beginn) < 0) throw new ZuteilungsFehler("ausuebungen", "Ausübung: Datum liegt vor der Zuteilung");
    const einheiten = new Decimal(ausuebung.anzahl);
    if (!einheiten.isFinite() || !einheiten.isInteger() || einheiten.lessThan(1)) throw new ZuteilungsFehler("ausuebungen", "Ausübung: Einheiten müssen eine ganze Zahl ab 1 sein");
    const preis = new Decimal(ausuebung.preis);
    if (!preis.isFinite() || preis.lessThan(0)) throw new ZuteilungsFehler("ausuebungen", "Ausübung: Preis darf nicht negativ sein");
  }
  return { anzahl, b };
}

/** Gilt der Status (verfallen, ausgeübt) zum Stichtag schon? */
function statusGilt(v: { statusAm?: Datum | null | undefined }, stichtag: Datum): boolean {
  return !v.statusAm || vergleiche(v.statusAm, stichtag) <= 0;
}

/** Gevestet nach Plan zum Stichtag für `anzahl` Einheiten (ohne Status und Leaver). */
function nachPlan(anzahl: Decimal, v: Vesting, stichtag: Datum): Decimal {
  if (vergleiche(stichtag, v.beginn) < 0) return ZERO;
  if (v.status === "gevestet" || (!v.vestingStufen?.length && v.vestingMonate === 0)) return anzahl;
  const monate = volleMonate(v.beginn, stichtag);
  if (monate < v.cliffMonate) return ZERO;
  if (v.vestingStufen?.length) {
    let anteil = ZERO;
    for (const stufe of v.vestingStufen) {
      if (stufe.datum === undefined ? monate >= stufe.monate : vergleiche(stufe.datum, stichtag) <= 0) {
        anteil = anteil.plus(stufe.anteil);
      }
    }
    return anzahl.times(anteil).floor();
  }
  const takt = v.taktMonate ?? 1;
  const stufen = Math.floor(monate / takt) * takt;
  return anzahl.times(Decimal.min(1, new Decimal(stufen).div(v.vestingMonate))).floor();
}

/**
 * Aufteilung einer Zuteilung zum Stichtag. Es gilt immer: gevestet + ungevestet + verfallen + zurückgekauft + ausgeübt = Anzahl;
 * verbleibend (ausstehend) = gevestet + ungevestet.
 */
export interface Aufteilung {
  gevestet: Decimal;
  ungevestet: Decimal;
  /** Verfallen über Austritte oder den Status `verfallen`. */
  verfallen: Decimal;
  rueckgekauft: Decimal;
  ausgeuebt: Decimal;
  /** Einheiten × Ausübungspreis für erfasste Ausübungen bis zum Stichtag. */
  ausuebungBetrag: Decimal;
  verbleibend: Decimal;
  /** Rückgekaufte Einheiten × Rückkaufpreis (ohne Angabe: Basispreis). */
  rueckkaufBetrag: Decimal;
  /** Gilt zum Stichtag mindestens ein Austritt (Datum bis zum Stichtag)? */
  austritt: boolean;
  /** Von den Austritten bis zum Stichtag betroffene Einheiten (Σ B_i); gleich der Anzahl, wenn alle ausgeschieden sind. */
  betroffen: Decimal;
}

function einbehalten(v: Vesting, l: Leaver, gevestet: Decimal): Decimal {
  const monate = volleMonate(v.zugeteiltAm ?? v.beginn, l.austrittAm);
  let stufe: LeaverStufe | undefined;
  for (const kandidat of v.leaverStufen ?? []) {
    if (kandidat.art === l.art && kandidat.mindestMonate <= monate && (!stufe || kandidat.mindestMonate > stufe.mindestMonate)) {
      stufe = kandidat;
    }
  }
  if (stufe) return gevestet.times(stufe.anteil).floor();
  return l.gevestet === "bleiben" ? gevestet : ZERO;
}

type Zuteilungsereignis =
  | { datum: Datum; austritt: Leaver }
  | { datum: Datum; ausuebung: Ausuebung };

function zuteilungsereignisse(v: Vesting): Zuteilungsereignis[] {
  const austritte = (v.austritte ?? []).map((austritt) => ({ datum: austritt.austrittAm, austritt }));
  austritte.sort((a, b) => vergleiche(a.datum, b.datum)
    || a.austritt.art.localeCompare(b.austritt.art)
    || a.austritt.gevestet.localeCompare(b.austritt.gevestet)
    || new Decimal(a.austritt.anzahl).cmp(b.austritt.anzahl)
    || new Decimal(a.austritt.rueckkaufpreis ?? v.basispreis ?? 0).cmp(b.austritt.rueckkaufpreis ?? v.basispreis ?? 0));
  const ausuebungen = (v.ausuebungen ?? []).map((ausuebung) => ({ datum: ausuebung.datum, ausuebung }));
  return [...austritte, ...ausuebungen].sort((a, b) => vergleiche(a.datum, b.datum));
}

/** Prüft Plan, Regeln und die verfügbare gevestete Anzahl für alle erfassten Ausübungen. */
export function pruefeMitarbeiterzuteilung(v: Vesting): void {
  const { anzahl } = pruefeVesting(v);
  if (v.ausuebungen?.length) rechneAufteilung(v, anzahl, "9999-12-31");
}

/** Aufteilung zum Stichtag nach Plan, Status, Austritten und Ausübungen. */
export function aufteilung(v: Vesting, stichtag: Datum): Aufteilung {
  const { anzahl } = pruefeVesting(v);
  return rechneAufteilung(v, anzahl, stichtag);
}

function rechneAufteilung(v: Vesting, anzahl: Decimal, stichtag: Datum): Aufteilung {
  const leer: Aufteilung = {
    gevestet: ZERO, ungevestet: ZERO, verfallen: ZERO, rueckgekauft: ZERO, ausgeuebt: ZERO,
    ausuebungBetrag: ZERO, verbleibend: ZERO, rueckkaufBetrag: ZERO, austritt: false, betroffen: ZERO,
  };
  if (!v.ausuebungen?.length && (v.status === "ausgeuebt" || v.status === "verfallen") && statusGilt(v, stichtag)) {
    for (const l of v.austritte ?? []) {
      if (vergleiche(l.austrittAm, stichtag) <= 0) {
        leer.austritt = true;
        leer.betroffen = leer.betroffen.plus(l.anzahl);
      }
    }
    return v.status === "ausgeuebt" ? { ...leer, ausgeuebt: anzahl } : { ...leer, verfallen: anzahl };
  }
  const ergebnis = { ...leer };
  let aktiveEinheiten = anzahl;
  let aktivAusgeuebt = ZERO;
  let beiAustrittBehalten = ZERO;
  for (const ereignis of zuteilungsereignisse(v)) {
    if (vergleiche(ereignis.datum, stichtag) > 0) break;
    const verfallen = v.status === "verfallen" && statusGilt(v, ereignis.datum);
    if ("austritt" in ereignis) {
      const l = ereignis.austritt;
      ergebnis.austritt = true;
      ergebnis.betroffen = ergebnis.betroffen.plus(l.anzahl);
      if (verfallen) continue;
      const betroffen = new Decimal(l.anzahl);
      aktiveEinheiten = aktiveEinheiten.minus(betroffen);
      // Bei aggregierten Zuteilungen zuerst Ausübungen den weiter aktiven Einheiten zuordnen.
      const verbleibendGevestet = nachPlan(aktiveEinheiten, v, ereignis.datum);
      const ausgetretenAusgeuebt = Decimal.max(0, aktivAusgeuebt.minus(verbleibendGevestet));
      aktivAusgeuebt = aktivAusgeuebt.minus(ausgetretenAusgeuebt);
      const gevestet = Decimal.max(0, nachPlan(betroffen, v, ereignis.datum).minus(ausgetretenAusgeuebt));
      const behalten = einbehalten(v, l, gevestet);
      beiAustrittBehalten = beiAustrittBehalten.plus(behalten);
      const rueckkauf = l.gevestet === "rueckkauf" ? gevestet.minus(behalten) : ZERO;
      ergebnis.rueckgekauft = ergebnis.rueckgekauft.plus(rueckkauf);
      ergebnis.rueckkaufBetrag = ergebnis.rueckkaufBetrag.plus(rueckkauf.times(l.rueckkaufpreis ?? v.basispreis ?? 0));
      ergebnis.verfallen = ergebnis.verfallen.plus(betroffen.minus(ausgetretenAusgeuebt).minus(behalten).minus(rueckkauf));
    } else {
      const { ausuebung } = ereignis;
      const einheiten = new Decimal(ausuebung.anzahl);
      const ausuebbar = nachPlan(aktiveEinheiten, v, ereignis.datum).minus(aktivAusgeuebt).plus(beiAustrittBehalten);
      if (verfallen || einheiten.greaterThan(ausuebbar)) throw new ZuteilungsFehler("ausuebungen", `Ausübung: Am ${ereignis.datum} sind zu wenige gevestete Einheiten verfügbar`);
      const eingefroren = Decimal.min(beiAustrittBehalten, einheiten);
      beiAustrittBehalten = beiAustrittBehalten.minus(eingefroren);
      aktivAusgeuebt = aktivAusgeuebt.plus(einheiten.minus(eingefroren));
      ergebnis.ausgeuebt = ergebnis.ausgeuebt.plus(einheiten);
      ergebnis.ausuebungBetrag = ergebnis.ausuebungBetrag.plus(einheiten.times(ausuebung.preis));
    }
  }
  if (v.status === "verfallen" && statusGilt(v, stichtag)) {
    ergebnis.verfallen = anzahl.minus(ergebnis.ausgeuebt).minus(ergebnis.rueckgekauft);
    return ergebnis;
  }
  const aktivGevestet = nachPlan(aktiveEinheiten, v, stichtag);
  ergebnis.gevestet = aktivGevestet.minus(aktivAusgeuebt).plus(beiAustrittBehalten);
  ergebnis.ungevestet = aktiveEinheiten.minus(aktivGevestet);
  ergebnis.verbleibend = ergebnis.gevestet.plus(ergebnis.ungevestet);
  return ergebnis;
}

/** Gevestete Einheiten zum Stichtag (ohne Beschleunigung); verfallene, zurückgekaufte und ausgeübte zählen ab ihrem Datum nicht mehr. */
export function gevesteteEinheiten(v: Vesting, stichtag: Datum): Decimal {
  return aufteilung(v, stichtag).gevestet;
}

/**
 * Einheiten, die beim Exit am Erlös teilnehmen: gevestet plus beschleunigter Teil der übrigen ungevesteten (abgerundet). Nach einem
 * Austritt beschleunigen nur die nicht betroffenen Einheiten; die verbliebenen gevesteten des Leavers zählen ohne Beschleunigung.
 * Bei Double Trigger kann der zweite Auslöser im Szenario entfallen; ohne Szenarioangabe gilt er wie bisher als eingetreten.
 */
export function einheitenBeimExit(v: Vesting, exitdatum: Datum, zweiterAusloeser = true): Decimal {
  const { anzahl, b } = pruefeVesting(v);
  const a = rechneAufteilung(v, anzahl, exitdatum);
  const beschleunigung = v.beschleunigungAusloeser === "doppelt" && !zweiterAusloeser ? ZERO : b;
  return a.gevestet.plus(a.ungevestet.times(beschleunigung).floor());
}

export interface PoolAenderung {
  datum: Datum;
  /** Änderung der Größe (Schaffung, Aufstockung; eine Verkleinerung ist negativ). */
  anzahl: Decimal.Value;
}

export interface PoolZuteilung extends Zuteilungsdetails {
  anzahl: Decimal.Value;
  zugeteiltAm: Datum;
  status: ZuteilungStatus;
  statusAm?: Datum | null;
  /** Vesting-Plan (nur nötig mit Austritten; Beginn ohne Angabe das Zuteilungsdatum). */
  beginn?: Datum | null;
  cliffMonate?: number;
  vestingMonate?: number;
  taktMonate?: number;
  basispreis?: Decimal.Value | null;
  austritte?: readonly Leaver[] | null;
}

export interface PoolStand {
  groesse: Decimal;
  /** Zugeteilt und weder verfallen, zurückgekauft noch ausgeübt. */
  ausstehend: Decimal;
  ausgeuebt: Decimal;
  /** Verfallen (Status oder Austritt) bis zum Stichtag, zurück im freien Pool. */
  verfallen: Decimal;
  /** Zurückgekauft bis zum Stichtag, zurück im freien Pool. */
  rueckgekauft: Decimal;
  frei: Decimal;
  /** Ausstehend + frei: zählt in die voll verwässerte Anteilszahl. */
  vollVerwaessert: Decimal;
}

/** Aufteilung einer Zuteilung des Pools zum Stichtag (Vesting-Plan nur mit Austritten nötig). */
export function poolAufteilung(z: PoolZuteilung, stichtag: Datum): Aufteilung {
  if (z.austritte?.length && !z.vestingStufen?.length && (z.cliffMonate === undefined || z.vestingMonate === undefined)) throw new Error("Pool: eine Zuteilung mit Austritten braucht den Vesting-Plan");
  return aufteilung(
    { ...z, beginn: z.beginn ?? z.zugeteiltAm, cliffMonate: z.cliffMonate ?? 0, vestingMonate: z.vestingMonate ?? 0 },
    stichtag,
  );
}

/** Stand eines Pools zum Stichtag. */
export function poolStand(aenderungen: readonly PoolAenderung[], zuteilungen: readonly PoolZuteilung[], stichtag: Datum): PoolStand {
  const groesse = aenderungen.filter((a) => vergleiche(a.datum, stichtag) <= 0).reduce((s, a) => s.plus(a.anzahl), ZERO);
  let ausstehend = ZERO;
  let ausgeuebt = ZERO;
  let verfallen = ZERO;
  let rueckgekauft = ZERO;
  for (const z of zuteilungen) {
    if (vergleiche(z.zugeteiltAm, stichtag) > 0) continue;
    const a = poolAufteilung(z, stichtag);
    ausstehend = ausstehend.plus(a.verbleibend);
    ausgeuebt = ausgeuebt.plus(a.ausgeuebt);
    verfallen = verfallen.plus(a.verfallen);
    rueckgekauft = rueckgekauft.plus(a.rueckgekauft);
  }
  const frei = Decimal.max(ZERO, groesse.minus(ausstehend).minus(ausgeuebt));
  return { groesse, ausstehend, ausgeuebt, verfallen, rueckgekauft, frei, vollVerwaessert: ausstehend.plus(frei) };
}

/** Stand eines grob erfassten Pools zum Stichtag: `vergeben` Einheiten gelten als ausstehend (höchstens die Größe). */
export function poolStandGrob(aenderungen: readonly PoolAenderung[], vergeben: Decimal.Value | null | undefined, stichtag: Datum): PoolStand {
  const groesse = aenderungen.filter((a) => vergleiche(a.datum, stichtag) <= 0).reduce((s, a) => s.plus(a.anzahl), ZERO);
  const v = new Decimal(vergeben ?? 0);
  if (!v.isFinite() || v.isNegative() || !v.isInteger()) throw new Error("Pool: vergebene Einheiten müssen eine ganze Zahl ab null sein");
  const ausstehend = Decimal.min(v, Decimal.max(ZERO, groesse));
  const frei = Decimal.max(ZERO, groesse.minus(ausstehend));
  return { groesse, ausstehend, ausgeuebt: ZERO, verfallen: ZERO, rueckgekauft: ZERO, frei, vollVerwaessert: ausstehend.plus(frei) };
}

export interface RundeVollVerwaessertEingabe {
  preMoney: Decimal.Value;
  volumen: Decimal.Value;
  /** Ausgegebene Anteile vor der Runde (unverwässert). */
  anteileVorher: Decimal.Value;
  /** Pool vor der Runde (ausstehend + frei). */
  poolVorher: Decimal.Value;
  /** Aufstockung des Pools im Pre-Money (Option Pool Shuffle). */
  aufstockungPreMoney?: Decimal.Value;
  /** Aufstockung des Pools im Post-Money. */
  aufstockungPostMoney?: Decimal.Value;
}

export interface RundeVollVerwaessert {
  /** Preis je Anteil auf voll verwässerter Basis, ungerundet. */
  preisJeAnteil: Decimal;
  /** Neue Anteile der Investoren, abgerundet auf ganze Anteile. */
  neueAnteile: Decimal;
  /** Ausgegebene Anteile nach der Runde (unverwässert). */
  anteileNachher: Decimal;
  /** Pool nach der Runde (einschließlich beider Aufstockungen). */
  poolNachher: Decimal;
  vollVerwaessertNachher: Decimal;
  /** Anteil der neuen Investoren nach der Runde, voll verwässert (Bruch). */
  anteilInvestoren: Decimal;
}

/** Runde auf voll verwässerter Basis: Preis je Anteil aus Pre-Money und voll verwässerten Anteilen vor der Runde (mit Aufstockung im Pre-Money). */
export function rundeVollVerwaessert(e: RundeVollVerwaessertEingabe): RundeVollVerwaessert {
  const pre = new Decimal(e.preMoney);
  const vorher = new Decimal(e.anteileVorher).plus(e.poolVorher).plus(e.aufstockungPreMoney ?? 0);
  if (!pre.greaterThan(0) || !vorher.greaterThan(0)) throw new Error("Runde: Pre-Money und Anteile vor der Runde müssen größer als null sein");
  const preis = pre.div(vorher);
  const neueAnteile = new Decimal(e.volumen).div(preis).floor();
  const poolNachher = new Decimal(e.poolVorher).plus(e.aufstockungPreMoney ?? 0).plus(e.aufstockungPostMoney ?? 0);
  const anteileNachher = new Decimal(e.anteileVorher).plus(neueAnteile);
  const vollVerwaessertNachher = anteileNachher.plus(poolNachher);
  return { preisJeAnteil: preis, neueAnteile, anteileNachher, poolNachher, vollVerwaessertNachher, anteilInvestoren: neueAnteile.div(vollVerwaessertNachher) };
}
