import { Decimal } from "./decimal.js";
import { rundeVollVerwaessert } from "./mitarbeiterbeteiligung.js";

/**
 * Option Pool Shuffle: Aufstockung des Pools der Mitarbeiterbeteiligung zu einer Runde, so dass der Pool nach der Runde eine Zielgröße
 * (Bruch der voll verwässerten Anteile nach der Runde) erreicht, und der Preis je Anteil dazu. Reine Funktionen, exakte Decimal-Rechnung.
 * Die Regeln stehen hier und gleichlautend in `referenz/referenz_pool_shuffle.py` (unabhängige Rechnung mit Brüchen).
 *
 * Bezeichnungen: A = ausgegebene Anteile vor der Runde, P = Pool vor der Runde (ausstehend + frei), V = Volumen, t = Zielgröße (0 < t < 1).
 *
 * - **Pre-Money:** Die Aufstockung X entsteht vor der Runde und geht in den Preis ein: Preis = Pre-Money ÷ (A + P + X), neue Anteile
 *   N = V ÷ Preis = (A + P + X) × V ÷ Pre-Money. Voll verwässert nach der Runde = (A + P + X) × Post-Money ÷ Pre-Money. Der Pool nach der
 *   Runde Q = P + X soll t davon sein: Q = k × (A + Q) mit k = t × Post-Money ÷ Pre-Money, geschlossen Q = k × A ÷ (1 − k), X = Q − P.
 *   Die Zirkularität (der Preis hängt von X ab, X vom Preis) löst diese Gleichung ohne Iteration. Nur für k < 1 lösbar.
 * - **Post-Money:** Der Preis bleibt Pre-Money ÷ (A + P), N = abgerundet(V ÷ Preis); die Aufstockung entsteht nach der Runde und verwässert
 *   alle: (P + X) = t × (A + P + N + X), also X = (t × (A + P + N) − P) ÷ (1 − t).
 * - **Ganze Anteile:** X ist die kleinste ganze Zahl, mit der der Pool nach der Runde mindestens die Zielgröße erreicht, N abgerundet wie
 *   in `rundeVollVerwaessert` (geschlossene Lösung aufgerundet, dann begrenzte binäre Suche darunter). Ab 1 − t < 0,01 (im Pre-Money 1 − k < 0,01) gilt das Ziel als unerreichbar. Hat der Pool die Zielgröße schon,
 *   ist X = 0. Der vorgeschlagene Preis ist der exakte Preis, auf vier Nachkommastellen gerundet (so wird er
 *   gespeichert).
 * - **Effektive Pre-Money:** Wert der Anteile, die vor der Runde bestehen (A + P), zum Preis der Runde: Preis × (A + P). Bei einer
 *   Aufstockung im Pre-Money ist das Pre-Money − Preis × X (die neuen Optionen gehen zulasten der Altgesellschafter), im Post-Money gleich
 *   dem Pre-Money.
 */

export type PoolBasis = "pre_money" | "post_money";

/** Mindestabstand von 1 − t (und im Pre-Money von 1 − k): darunter ist das Ziel unerreichbar (Pool über das 99-Fache der übrigen Anteile). */
const MINDESTABSTAND = new Decimal("0.01");

export interface PoolShuffleEingabe {
  preMoney: Decimal.Value;
  volumen: Decimal.Value;
  /** Ausgegebene Anteile vor der Runde (unverwässert). */
  anteileVorher: Decimal.Value;
  /** Pool vor der Runde (ausstehend + frei). */
  poolVorher: Decimal.Value;
  /** Zielgröße des Pools nach der Runde als Bruch der voll verwässerten Anteile (0 < t < 1). */
  zielAnteil: Decimal.Value;
  basis: PoolBasis;
}

export type PoolShuffleGrund = "ohne_anteile" | "ohne_pre_money" | "ziel_ungueltig" | "ziel_unerreichbar" | "preis_null";

export interface PoolShuffleVorschlag {
  /** Aufstockung in ganzen Anteilen (aufgerundet, 0 wenn der Pool die Zielgröße schon hat). */
  aufstockung: Decimal;
  /** Exakter Preis je Anteil (ungerundet). */
  preisExakt: Decimal;
  /** Vorschlag zum Speichern: auf vier Nachkommastellen gerundet. */
  preisJeAnteil: Decimal;
}

export type PoolShuffleErgebnis = { ok: true; vorschlag: PoolShuffleVorschlag } | { ok: false; grund: PoolShuffleGrund };

/** Erreicht der Pool mit Aufstockung x nach der Runde mindestens t der voll verwässerten Anteile (neue Anteile abgerundet)? */
function erreicht(pre: Decimal, volumen: Decimal, a: Decimal, p: Decimal, t: Decimal, x: Decimal, basis: PoolBasis): boolean {
  const r = rundeVollVerwaessert({ preMoney: pre, volumen, anteileVorher: a, poolVorher: p, ...(basis === "pre_money" ? { aufstockungPreMoney: x } : { aufstockungPostMoney: x }) });
  return !r.poolNachher.lessThan(t.times(r.vollVerwaessertNachher));
}

/** Aufstockung und Preis je Anteil für eine Zielgröße des Pools; ohne Lösung ein Grund statt eines Fehlers. */
export function poolShuffle(e: PoolShuffleEingabe): PoolShuffleErgebnis {
  const pre = new Decimal(e.preMoney);
  const volumen = new Decimal(e.volumen);
  const a = new Decimal(e.anteileVorher);
  const p = new Decimal(e.poolVorher);
  const t = new Decimal(e.zielAnteil);
  if (!pre.greaterThan(0)) return { ok: false, grund: "ohne_pre_money" };
  if (!a.greaterThan(0)) return { ok: false, grund: "ohne_anteile" };
  if (!t.greaterThan(0) || !t.lessThan(1) || volumen.isNegative() || p.isNegative()) return { ok: false, grund: "ziel_ungueltig" };
  // Nahe 100 % wächst die Aufstockung über alle Grenzen (Nenner 1 − t bzw. 1 − k): ab dieser Schwelle gilt das Ziel als unerreichbar.
  if (new Decimal(1).minus(t).lessThan(MINDESTABSTAND)) return { ok: false, grund: "ziel_unerreichbar" };
  let aufstockung: Decimal;
  if (e.basis === "pre_money") {
    const k = t.times(pre.plus(volumen)).div(pre);
    if (new Decimal(1).minus(k).lessThan(MINDESTABSTAND)) return { ok: false, grund: "ziel_unerreichbar" };
    const q = k.times(a).div(new Decimal(1).minus(k));
    aufstockung = Decimal.max(0, q.minus(p).ceil());
  } else {
    const n = rundeVollVerwaessert({ preMoney: pre, volumen, anteileVorher: a, poolVorher: p }).neueAnteile;
    aufstockung = Decimal.max(0, t.times(a.plus(p).plus(n)).minus(p).div(new Decimal(1).minus(t)).ceil());
  }
  // Die geschlossene Lösung rechnet mit ungerundeten neuen Anteilen; mit abgerundeten reicht manchmal ein Anteil weniger.
  // Begrenzte binäre Suche in [0, geschlossene Lösung]: die kleinste Aufstockung, die das Ziel erreicht (höchstens rund 60 Schritte bei 18 Stellen).
  if (aufstockung.greaterThan(0) && erreicht(pre, volumen, a, p, t, aufstockung.minus(1), e.basis)) {
    let unten = new Decimal(-1); // erreicht nicht (gedacht)
    let oben = aufstockung; // erreicht
    for (let schritt = 0; schritt < 128 && oben.minus(unten).greaterThan(1); schritt++) {
      const mitte = unten.plus(oben).div(2).floor();
      if (mitte.greaterThanOrEqualTo(0) && erreicht(pre, volumen, a, p, t, mitte, e.basis)) oben = mitte;
      else unten = mitte;
    }
    aufstockung = oben;
  }
  const preisExakt = pre.div(a.plus(p).plus(e.basis === "pre_money" ? aufstockung : 0));
  const preisJeAnteil = preisExakt.toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
  if (!preisJeAnteil.greaterThan(0)) return { ok: false, grund: "preis_null" };
  return { ok: true, vorschlag: { aufstockung, preisExakt, preisJeAnteil } };
}

export interface PoolShuffleKennwerteEingabe {
  preMoney: Decimal.Value;
  volumen: Decimal.Value;
  anteileVorher: Decimal.Value;
  poolVorher: Decimal.Value;
  /** Aufstockung (übernommen oder überschrieben), ganze Anteile ab null. */
  aufstockung: Decimal.Value;
  basis: PoolBasis;
  /** Preis je Anteil der Runde (übernommen oder überschrieben). */
  preisJeAnteil: Decimal.Value;
}

export interface PoolShuffleKennwerte {
  /** Neue Anteile der Investoren: Volumen ÷ Preis, abgerundet. */
  neueAnteile: Decimal;
  poolVorher: Decimal;
  /** Pool nach der Runde einschließlich der Aufstockung (Pre- oder Post-Money). */
  poolNachher: Decimal;
  /** Voll verwässerte Anteile nach der Runde (ausgegeben + Pool, mit Aufstockung). */
  vollVerwaessertNachher: Decimal;
  /** Pool nach der Runde als Bruch der voll verwässerten Anteile. */
  poolAnteilNachher: Decimal;
  preisJeAnteil: Decimal;
  /** Preis × (ausgegebene Anteile vor der Runde + Pool vor der Runde). */
  effektivePreMoney: Decimal;
}

/** Kennwerte einer Runde mit Aufstockung zu einem gegebenen Preis (für den Dialog, auch wenn der Vorschlag überschrieben ist). */
export function poolShuffleKennwerte(e: PoolShuffleKennwerteEingabe): PoolShuffleKennwerte {
  const preis = new Decimal(e.preisJeAnteil);
  if (!preis.greaterThan(0)) throw new Error("Pool Shuffle: Preis je Anteil muss größer als null sein");
  const a = new Decimal(e.anteileVorher);
  const p = new Decimal(e.poolVorher);
  const neueAnteile = new Decimal(e.volumen).div(preis).floor();
  const poolNachher = p.plus(e.aufstockung);
  const vollVerwaessertNachher = a.plus(neueAnteile).plus(poolNachher);
  return {
    neueAnteile,
    poolVorher: p,
    poolNachher,
    vollVerwaessertNachher,
    poolAnteilNachher: vollVerwaessertNachher.greaterThan(0) ? poolNachher.div(vollVerwaessertNachher) : new Decimal(0),
    preisJeAnteil: preis,
    effektivePreMoney: preis.times(a.plus(p)),
  };
}
