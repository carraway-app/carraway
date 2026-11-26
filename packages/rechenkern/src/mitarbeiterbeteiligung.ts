import { Decimal } from "./decimal.js";
import { vergleiche, zerlege, type Datum } from "./datum.js";

/**
 * Mitarbeiterbeteiligung (ESOP mit Optionen auf echte Anteile, VSOP mit virtuellen Anteilen): Vesting, Stand eines Pools und Preis je
 * Anteil auf voll verwässerter Basis. Reine Funktionen, exakte Decimal-Rechnung. Die Regeln stehen hier und gleichlautend in
 * `referenz/referenz_mitarbeiterbeteiligung.py` (unabhängige Rechnung mit Brüchen):
 *
 * - **Volle Monate** von `von` bis `bis`: Monatsdifferenz, um eins weniger, wenn der Tag in `bis` vor dem Tag in `von` liegt (ein Tag nach
 *   dem Monatsende von `bis` zählt als Monatsende, 31.01. → 28.02. ist ein voller Monat). Vor `von` null.
 * - **Vesting:** linear je vollem Monat ab Vesting-Beginn über `vestingMonate`; vor dem Ende des Cliffs (`cliffMonate`) nichts, am Cliff
 *   der bis dahin aufgelaufene Teil. Gevestet = abgerundet auf ganze Einheiten (Anzahl × min(1, Monate ÷ Dauer)). Dauer 0: sofort alles.
 * - **Beschleunigung beim Exit:** ein Bruch b (0 bis 1) der zum Exit noch nicht gevesteten Einheiten vestet zusätzlich, abgerundet.
 *   Einheiten beim Exit = gevestet + abgerundet((Anzahl − gevestet) × b). Ungevestete Einheiten ohne Beschleunigung verfallen beim Exit.
 * - **Status:** `verfallen` und `ausgeuebt` gelten ab ihrem Datum (vorher wie zugeteilt); verfallene Einheiten gehen in den freien Pool
 *   zurück, ausgeübte verlassen den Pool (ESOP: sie sind dann ausgegebene Anteile; VSOP: ausgezahlt). `gevestet` heißt voll gevestet.
 * - **Austritte (Leaver):** eine Zuteilung kann mehrere Austritte haben (aggregierte Zuteilung, Personen scheiden zu verschiedenen Daten
 *   aus). Jeder Austritt i hat Art (Good oder Bad Leaver), Datum A_i, betroffene Einheiten B_i und die Regel für die gevesteten Einheiten;
 *   Σ B_i ≤ Anzahl. Vor A_i gilt für B_i der Plan. Ab A_i friert das Vesting der B_i Einheiten ein: gevestet bei Austritt
 *   gB_i = abgerundet(B_i × Anteil nach Plan zu A_i) (vor dem Cliff 0), der ungevestete Rest B_i − gB_i verfällt. gB_i bleibt
 *   (`bleiben`, nimmt am Exit ohne Beschleunigung teil), verfällt (`verfallen`) oder wird zurückgekauft (`rueckkauf`, zum Rückkaufpreis,
 *   ohne Angabe zum Basispreis; Betrag = gB_i × Preis). Die übrigen Anzahl − Σ B_i (Summe über die Austritte bis zum Stichtag) vesten
 *   weiter nach Plan (eine eigene Abrundung). Verfallene und zurückgekaufte Einheiten gehen in den freien Pool zurück. Die Art ist eine
 *   Bezeichnung, gerechnet wird mit der Regel.
 * - **Pool zum Stichtag:** Größe = Summe der Änderungen bis zum Stichtag; zugeteilt (ausstehend) = Einheiten der Zuteilungen bis zum
 *   Stichtag, die weder verfallen, zurückgekauft noch ausgeübt sind; frei = Größe − ausstehend − ausgeübt (nicht unter null).
 * - **Preis je Anteil voll verwässert:** Pre-Money ÷ (ausgegebene Anteile vor der Runde + Pool vor der Runde + Aufstockung im Pre-Money).
 *   Neue Anteile = Volumen ÷ Preis. Eine Aufstockung im Post-Money wird nach der Runde geschaffen und verwässert alle, auch die neuen
 *   Investoren; sie geht nicht in den Preis ein.
 */

const ZERO = new Decimal(0);

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

export interface Leaver {
  art: LeaverArt;
  austrittAm: Datum;
  /** Betroffene Einheiten (ganze Zahl ab 1; die Summe über alle Austritte einer Zuteilung höchstens ihre Anzahl). */
  anzahl: Decimal.Value;
  gevestet: LeaverGevestet;
  /** Rückkaufpreis je Einheit bei `rueckkauf`; ohne Angabe der Basispreis. */
  rueckkaufpreis?: Decimal.Value | null;
}

export interface Vesting {
  anzahl: Decimal.Value;
  /** Beginn des Vestings (meist das Zuteilungsdatum). */
  beginn: Datum;
  cliffMonate: number;
  vestingMonate: number;
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

function pruefeVesting(v: Vesting): { anzahl: Decimal; b: Decimal } {
  const anzahl = new Decimal(v.anzahl);
  if (!anzahl.isFinite() || anzahl.isNegative() || !anzahl.isInteger()) throw new Error("Vesting: Anzahl muss eine ganze Zahl ab null sein");
  if (!Number.isInteger(v.cliffMonate) || v.cliffMonate < 0) throw new Error("Vesting: Cliff muss eine ganze Zahl von Monaten ab null sein");
  if (!Number.isInteger(v.vestingMonate) || v.vestingMonate < 0) throw new Error("Vesting: Dauer muss eine ganze Zahl von Monaten ab null sein");
  const b = new Decimal(v.beschleunigung ?? 0);
  if (!b.isFinite() || b.isNegative() || b.greaterThan(1)) throw new Error("Vesting: Beschleunigung muss zwischen 0 und 1 liegen");
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
  return { anzahl, b };
}

/** Gilt der Status (verfallen, ausgeübt) zum Stichtag schon? */
function statusGilt(v: { statusAm?: Datum | null | undefined }, stichtag: Datum): boolean {
  return !v.statusAm || vergleiche(v.statusAm, stichtag) <= 0;
}

/** Gevestet nach Plan zum Stichtag für `anzahl` Einheiten (ohne Status und Leaver). */
function nachPlan(anzahl: Decimal, v: Vesting, stichtag: Datum): Decimal {
  if (vergleiche(stichtag, v.beginn) < 0) return ZERO;
  if (v.status === "gevestet" || v.vestingMonate === 0) return anzahl;
  const monate = volleMonate(v.beginn, stichtag);
  if (monate < v.cliffMonate) return ZERO;
  return anzahl.times(Decimal.min(1, new Decimal(monate).div(v.vestingMonate))).floor();
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
  verbleibend: Decimal;
  /** Rückgekaufte Einheiten × Rückkaufpreis (ohne Angabe: Basispreis). */
  rueckkaufBetrag: Decimal;
  /** Gilt zum Stichtag mindestens ein Austritt (Datum bis zum Stichtag)? */
  austritt: boolean;
  /** Von den Austritten bis zum Stichtag betroffene Einheiten (Σ B_i); gleich der Anzahl, wenn alle ausgeschieden sind. */
  betroffen: Decimal;
}

/** Aufteilung zum Stichtag nach Plan, Status und Austritten (Regeln oben). */
export function aufteilung(v: Vesting, stichtag: Datum): Aufteilung {
  const { anzahl } = pruefeVesting(v);
  const gelten = (v.austritte ?? []).filter((l) => vergleiche(l.austrittAm, stichtag) <= 0);
  const betroffen = gelten.reduce((s, l) => s.plus(l.anzahl), ZERO);
  const leer = { gevestet: ZERO, ungevestet: ZERO, verfallen: ZERO, rueckgekauft: ZERO, ausgeuebt: ZERO, verbleibend: ZERO, rueckkaufBetrag: ZERO, austritt: gelten.length > 0, betroffen };
  if (v.status === "ausgeuebt" && statusGilt(v, stichtag)) return { ...leer, ausgeuebt: anzahl };
  if (v.status === "verfallen" && statusGilt(v, stichtag)) return { ...leer, verfallen: anzahl };
  const uebrige = anzahl.minus(betroffen);
  const gU = nachPlan(uebrige, v, stichtag);
  let gevestet = gU;
  let verfallen = ZERO;
  let rueckgekauft = ZERO;
  let rueckkaufBetrag = ZERO;
  for (const l of gelten) {
    const b = new Decimal(l.anzahl);
    const gB = nachPlan(b, v, l.austrittAm);
    if (l.gevestet === "bleiben") {
      gevestet = gevestet.plus(gB);
      verfallen = verfallen.plus(b.minus(gB));
    } else if (l.gevestet === "verfallen") verfallen = verfallen.plus(b);
    else {
      verfallen = verfallen.plus(b.minus(gB));
      rueckgekauft = rueckgekauft.plus(gB);
      rueckkaufBetrag = rueckkaufBetrag.plus(gB.times(l.rueckkaufpreis ?? v.basispreis ?? 0));
    }
  }
  const ungevestet = uebrige.minus(gU);
  return { ...leer, gevestet, ungevestet, verfallen, rueckgekauft, verbleibend: gevestet.plus(ungevestet), rueckkaufBetrag };
}

/** Gevestete Einheiten zum Stichtag (ohne Beschleunigung); verfallene, zurückgekaufte und ausgeübte zählen ab ihrem Datum nicht mehr. */
export function gevesteteEinheiten(v: Vesting, stichtag: Datum): Decimal {
  return aufteilung(v, stichtag).gevestet;
}

/**
 * Einheiten, die beim Exit am Erlös teilnehmen: gevestet plus beschleunigter Teil der übrigen ungevesteten (abgerundet). Nach einem
 * Austritt beschleunigen nur die nicht betroffenen Einheiten; die verbliebenen gevesteten des Leavers zählen ohne Beschleunigung.
 */
export function einheitenBeimExit(v: Vesting, exitdatum: Datum): Decimal {
  const { b } = pruefeVesting(v);
  const a = aufteilung(v, exitdatum);
  return a.gevestet.plus(a.ungevestet.times(b).floor());
}

export interface PoolAenderung {
  datum: Datum;
  /** Änderung der Größe (Schaffung, Aufstockung; eine Verkleinerung ist negativ). */
  anzahl: Decimal.Value;
}

export interface PoolZuteilung {
  anzahl: Decimal.Value;
  zugeteiltAm: Datum;
  status: ZuteilungStatus;
  statusAm?: Datum | null;
  /** Vesting-Plan (nur nötig mit Austritten; Beginn ohne Angabe das Zuteilungsdatum). */
  beginn?: Datum | null;
  cliffMonate?: number;
  vestingMonate?: number;
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
  if (z.austritte?.length && (z.cliffMonate === undefined || z.vestingMonate === undefined)) throw new Error("Pool: eine Zuteilung mit Austritten braucht den Vesting-Plan");
  return aufteilung(
    { anzahl: z.anzahl, beginn: z.beginn ?? z.zugeteiltAm, cliffMonate: z.cliffMonate ?? 0, vestingMonate: z.vestingMonate ?? 0, status: z.status, statusAm: z.statusAm ?? null, basispreis: z.basispreis ?? null, austritte: z.austritte ?? null },
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
