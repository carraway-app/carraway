import { Decimal } from "./decimal.js";
import { tageZwischen, type Datum } from "./datum.js";
import type { MitHerkunft, Rechenschritt } from "./herkunft.js";

/**
 * Exit-Wasserfall (Etappe 10): Verteilung eines Exit-Erlöses auf Inhaber von Stammanteilen und Anteilsklassen mit
 * Liquidationspräferenz. Reine Funktionen, exakte Decimal-Rechnung, Rechenweg als Schrittliste. Die Regeln stehen hier und
 * gleichlautend in `referenz/referenz_wasserfall.py` (unabhängige Rechnung mit Brüchen und anderem Aufbau):
 *
 * - **Erlös:** `exitwert` ist der Erlös nach Kosten (≥ 0). Der Treuhandanteil s (0 ≤ s < 1) ändert die Verteilung nicht: Es wird der volle
 *   Erlös verteilt, und der Rückfluss jeder Zeile zerfällt in Treuhand (Gesamt × s) und Sofort. Die Summe aller Rückflüsse ist der Erlös.
 * - **Anspruch** je Zeile einer Klasse: investiert × Faktor × (1 + Verzinsung × Tage / 365), Tage = max(0, Exitdatum − Rundendatum),
 *   einfache Verzinsung auf den Präferenzbetrag (act/365, wie der IRR). Liegt das Exitdatum vor dem Rundendatum, gibt es keinen Zins.
 * - **Rang:** Rang 1 ist die höchste. Eine Stufe wird erst bedient, wenn alle höheren voll bedient sind; gleicher Rang ist pari passu
 *   (anteilig nach Anspruch). Wer umwandelt, hat keinen Anspruch.
 * - **Rest:** Nach allen Präferenzen teilen Stammanteile, umgewandelte Klassen und partizipierende Klassen (je Anteil) den Rest.
 *   Der Cap einer partizipierenden Klasse (capFaktor × investiert, je Zeile) begrenzt den Gesamtrückfluss aus Präferenz und
 *   Beteiligung; der Spielraum der Beteiligung ist max(0, Cap − Präferenz), liegt die Präferenz schon über dem Cap, bleibt sie
 *   unverändert und es gibt keine Beteiligung. Was ein Cap übrig lässt, verteilen die anderen Zeilen weiter (Wasserstandsverfahren:
 *   höchstens so viele Durchgänge wie Zeilen, weil in jedem mindestens eine Zeile an ihren Cap geht und der Preis nur steigt).
 *   Ein Rest, den niemand beanspruchen kann (kein Anteil im Pool oder alle am Cap), ist „nicht verteilt“ und wird nicht zugeteilt.
 * - **Mitarbeiterbeteiligung (ESOP/VSOP):** Zeilen mit `mitarbeiter` haben keine Klasse und keine Präferenz; sie zählen nur mit den Einheiten,
 *   die zum Exit gevestet oder beschleunigt sind (das rechnet der Aufrufer, siehe `mitarbeiterbeteiligung.ts`). Je Einheit bekommen sie
 *   max(0, p − Basispreis), p = Betrag je Stammanteil. Regel `wie_anteile` (Standard; gilt für ESOP mit Ausübung oder Barausgleich und für
 *   VSOP, deren Auszahlung den Rest trägt): Die Einheiten teilen den Rest wie Stammanteile, der Basispreis bleibt den übrigen Poolzeilen.
 *   Gesucht ist das kleinste p mit Σ min(Spielraum, Anteile × max(0, p − Basispreis)) = Rest (Basispreis 0 bei allen übrigen Zeilen); die
 *   Summe ist stetig und steigt in p, gelöst wird exakt auf dem Abschnitt zwischen zwei Knickstellen (Basispreise und Basispreis +
 *   Spielraum ÷ Anteile). Einheiten mit Basispreis ≥ p sind „aus dem Geld“ und bekommen nichts. Regel `anteilig` (VSOP, deren Auszahlung
 *   alle Rückflüsse im gleichen Verhältnis mindert): Zuerst wird ohne diese Einheiten verteilt (Betrag je Stammanteil p₀, verteilt D);
 *   dann gilt für den Faktor f: D × (1 − f) = Σ Einheiten × max(0, p₀ × f − Basispreis), jeder andere Rückfluss wird mit f malgenommen
 *   und die Einheit bekommt p₀ × f − Basispreis. Die Umwandlungsentscheidung sieht die geminderten Rückflüsse.
 * - **Optionsscheine:** Nicht ausgeübte Optionsscheine eines Fonds laufen über denselben Weg wie die Mitarbeiterbeteiligung (Regel `wie_anteile`,
 *   Ausübungspreis als Basispreis, `art: "optionsschein"` nur für die Bezeichnung der Schritte): je Anteil max(0, p − Ausübungspreis).
 * - **Umwandlung** wird je Klasse entschieden (nicht je Zeile): Eine umwandelbare Klasse wandelt nur, wenn ihr Rückfluss dadurch
 *   STRENG größer wird (gleich = keine Umwandlung), gemessen mit den Entscheidungen der übrigen Klassen als gegeben. Wer wandelt, verliert
 *   Präferenz und Cap und teilt als Stammanteil. Gesucht wird die stabile Menge W: c in W ⇒ Rückfluss(c, W) > Rückfluss(c, W ohne c);
 *   c nicht in W ⇒ Rückfluss(c, W mit c) ≤ Rückfluss(c, W). Verfahren: Beginn ohne Umwandlung; in jedem Durchgang wandelt unter den Klassen,
 *   für die Wandeln streng besser ist, diejenige mit dem kleinsten Rückfluss je Anteil (die niedrigste Schwelle). Danach wird jede
 *   gewandelte Klasse geprüft; lohnt sie nicht mehr streng, wird sie für den Rest der Suche gesperrt und die Suche beginnt neu.
 *   Terminiert, weil in einem Lauf die Menge nur wächst (höchstens k Klassen) und jede Sperre die Zahl der wählbaren Klassen um eins
 *   senkt (höchstens k Neubeginne). Weil Wandeln den Preis je Anteil senkt, ist die Menge bei sauber geordneten Schwellen eindeutig.
 * - **Rundung:** Alles ist bis dahin exakt. Präferenz und Beteiligung je Zeile werden auf Cent nach der Methode des größten Rests
 *   gerundet (Reihenfolge: Zeilen in Eingabereihenfolge, je Zeile erst Präferenz, dann Beteiligung; Gleichstand: kleinerer Index), die
 *   Summe ist der auf Cent gerundete (halb auf) Gesamtbetrag der Teile. Gesamt = Präferenz + Beteiligung. Der Treuhandanteil je Zeile
 *   wird ebenso aus Gesamt × s gerundet, Sofort = Gesamt − Treuhand.
 */

export interface Anteilsklasse {
  id: string;
  name: string;
  /** 1 = höchste Rangstufe; gleicher Rang ist pari passu. */
  rang: number;
  /** Vielfaches des investierten Betrags, z. B. 1 oder 1.5. */
  praeferenzFaktor: Decimal.Value;
  partizipierend: boolean;
  /** Obergrenze des Gesamtrückflusses als Vielfaches des investierten Betrags (nur partizipierend); `null`: keine. */
  capFaktor?: Decimal.Value | null;
  /** Einfache Verzinsung der Präferenz je Jahr als Bruch (0.08 = 8 %), ab dem Rundendatum; `null`: keine. */
  verzinsung?: Decimal.Value | null;
  /** Darf die Klasse in Stammanteile umwandeln, wenn das besser ist? */
  umwandelbar: boolean;
}

/** Eine Zeile des Wasserfalls: eine Position (Inhaber × Klasse × Runde) oder Stammanteile (`klasseId` = `null`). */
export interface Inhaberzeile {
  id: string;
  name: string;
  klasseId: string | null;
  anteile: Decimal.Value;
  /** Investierter Betrag; bei Stammanteilen ohne Investition 0. */
  investiert: Decimal.Value;
  /** Datum der Runde, ab dem die Verzinsung läuft. */
  datum?: Datum | null;
  /**
   * Mitarbeiterbeteiligung: `anteile` sind die zum Exit gevesteten oder beschleunigten Einheiten, `basispreis` ist der Ausübungs- oder
   * Basispreis je Einheit, `regel` sagt, wer die Auszahlung trägt (Standard `wie_anteile`). Nur ohne Klasse.
   */
  mitarbeiter?: { basispreis: Decimal.Value; regel?: MitarbeiterRegel; art?: StrikeArt } | null;
}

/**
 * Herkunft einer Zeile mit Basispreis, nur für die Bezeichnung der Rechenschritte: `mitarbeiter` (Standard) oder `optionsschein` (nicht ausgeübte
 * Optionsscheine eines Fonds mit dem Ausübungspreis als Basispreis, Regel `wie_anteile`). Gerechnet wird beides gleich.
 */
export type StrikeArt = "mitarbeiter" | "optionsschein";

/** `wie_anteile`: die Einheiten teilen den Rest wie Stammanteile; `anteilig`: die Auszahlung mindert alle Rückflüsse im gleichen Verhältnis. */
export type MitarbeiterRegel = "wie_anteile" | "anteilig";

export interface WasserfallEingabe {
  /** Erlös nach Kosten, ≥ 0. */
  exitwert: Decimal.Value;
  exitdatum: Datum;
  /** Anteil des Erlöses, der zunächst einbehalten wird (0 ≤ s < 1). */
  treuhandAnteil?: Decimal.Value;
  klassen: readonly Anteilsklasse[];
  inhaber: readonly Inhaberzeile[];
}

export interface WasserfallZeile {
  id: string;
  name: string;
  klasseId: string | null;
  anteile: Decimal;
  investiert: Decimal;
  /** Anspruch auf Präferenz inklusive Zins, bevor Geld verteilt wird (0 bei Stammanteilen und bei Umwandlung). */
  anspruch: Decimal;
  praeferenz: Decimal;
  beteiligung: Decimal;
  gesamt: Decimal;
  treuhand: Decimal;
  sofort: Decimal;
  /** Gesamt ÷ investiert, `null` ohne Investition. */
  multiple: Decimal | null;
  gewandelt: boolean;
  /** Der Cap begrenzt diese Zeile. */
  gedeckelt: boolean;
  /** Basispreis einer Zeile der Mitarbeiterbeteiligung, sonst `null`. */
  basispreis: Decimal | null;
  /** Nur Mitarbeiterbeteiligung: Basispreis unter dem Betrag je Stammanteil (die Einheiten bekommen etwas); sonst `null`. */
  imGeld: boolean | null;
}

export interface WasserfallKlasse {
  /** `null` = Stammanteile. */
  id: string | null;
  name: string;
  rang: number | null;
  anteile: Decimal;
  investiert: Decimal;
  anspruch: Decimal;
  praeferenz: Decimal;
  beteiligung: Decimal;
  gesamt: Decimal;
  multiple: Decimal | null;
  gewandelt: boolean;
  gedeckelt: boolean;
}

export interface WasserfallErgebnis {
  exitwert: Decimal;
  treuhandAnteil: Decimal;
  zeilen: WasserfallZeile[];
  klassen: WasserfallKlasse[];
  /** IDs der Klassen, die in Stammanteile wandeln. */
  gewandelt: string[];
  /** Rest nach den Präferenzen, der an den Pool geht (vor Cap-Umverteilung). */
  restNachPraeferenzen: Decimal;
  /** Betrag je Anteil für die Zeilen ohne Cap-Begrenzung (nach einer anteiligen Minderung); `null`, wenn niemand im Pool ist. */
  preisJeAnteil: Decimal | null;
  /** Rest ohne Empfänger (Pool leer oder alle am Cap). */
  nichtVerteilt: Decimal;
  /** Faktor f der anteiligen Minderung durch Mitarbeiterbeteiligung mit Regel `anteilig`; `null` ohne solche Einheiten im Geld. */
  minderungsfaktor: Decimal | null;
}

// Vorbereitung -----------------------------------------------------------------------------------------------------------

interface KlasseIntern {
  def: Anteilsklasse;
  rang: number;
  faktor: Decimal;
  cap: Decimal | null;
  verzinsung: Decimal;
}

interface ZeileIntern {
  index: number;
  def: Inhaberzeile;
  anteile: Decimal;
  investiert: Decimal;
  klasse: KlasseIntern | null;
  /** Anspruch inklusive Zins; 0 ohne Klasse. */
  anspruch: Decimal;
  zins: Decimal;
  /** Basispreis der Mitarbeiterbeteiligung; 0 sonst. */
  strike: Decimal;
  /** Mitarbeiterbeteiligung? */
  mitarbeiter: boolean;
  /** Mitarbeiterbeteiligung mit Regel `anteilig` (nicht im Pool, sondern aus allen Rückflüssen). */
  anteilig: boolean;
}

interface Kontext {
  exitdatum: Datum;
  klassen: KlasseIntern[];
  zeilen: ZeileIntern[];
  /** Umwandelbare Klassen mit mindestens einer Zeile, in Eingabereihenfolge. */
  wandelbar: KlasseIntern[];
  /** Rangstufen aufsteigend. */
  raenge: number[];
}

const ZERO = new Decimal(0);

function dezimal(wert: Decimal.Value, feld: string): Decimal {
  const d = new Decimal(wert);
  if (!d.isFinite()) throw new Error(`Wasserfall: ${feld} ist keine Zahl`);
  return d;
}

function nichtNegativ(wert: Decimal.Value, feld: string): Decimal {
  const d = dezimal(wert, feld);
  if (d.isNegative()) throw new Error(`Wasserfall: ${feld} darf nicht negativ sein`);
  return d;
}

function bereite(eingabe: Pick<WasserfallEingabe, "exitdatum" | "klassen" | "inhaber">): Kontext {
  const ids = new Set<string>();
  const klassen: KlasseIntern[] = eingabe.klassen.map((k) => {
    if (ids.has(k.id)) throw new Error(`Wasserfall: Klasse ${k.id} doppelt`);
    ids.add(k.id);
    if (!Number.isInteger(k.rang) || k.rang < 1) throw new Error(`Wasserfall: Rang von ${k.name} muss eine ganze Zahl ab 1 sein`);
    const cap = k.capFaktor === null || k.capFaktor === undefined ? null : nichtNegativ(k.capFaktor, `Cap von ${k.name}`);
    return {
      def: k,
      rang: k.rang,
      faktor: nichtNegativ(k.praeferenzFaktor, `Präferenzfaktor von ${k.name}`),
      // Ein Cap gilt nur für partizipierende Klassen.
      cap: k.partizipierend ? cap : null,
      verzinsung: k.verzinsung === null || k.verzinsung === undefined ? ZERO : nichtNegativ(k.verzinsung, `Verzinsung von ${k.name}`),
    };
  });
  const nachId = new Map(klassen.map((k) => [k.def.id, k]));
  const zeilenIds = new Set<string>();
  const zeilen: ZeileIntern[] = eingabe.inhaber.map((h, index) => {
    if (zeilenIds.has(h.id)) throw new Error(`Wasserfall: Zeile ${h.id} doppelt`);
    zeilenIds.add(h.id);
    const klasse = h.klasseId === null ? null : (nachId.get(h.klasseId) ?? null);
    if (h.klasseId !== null && !klasse) throw new Error(`Wasserfall: Klasse ${h.klasseId} von ${h.name} ist unbekannt`);
    const investiert = nichtNegativ(h.investiert, `Investition von ${h.name}`);
    const m = h.mitarbeiter ?? null;
    if (m && klasse) throw new Error(`Wasserfall: Mitarbeiterbeteiligung ${h.name} darf keine Klasse haben`);
    if (m && m.regel !== undefined && m.regel !== "wie_anteile" && m.regel !== "anteilig") throw new Error(`Wasserfall: Regel von ${h.name} ist unbekannt`);
    const strike = m ? nichtNegativ(m.basispreis, `Basispreis von ${h.name}`) : ZERO;
    let anspruch = ZERO;
    let zins = ZERO;
    if (klasse) {
      const basis = investiert.times(klasse.faktor);
      const tage = h.datum ? Math.max(0, tageZwischen(h.datum, eingabe.exitdatum)) : 0;
      zins = basis.times(klasse.verzinsung).times(tage).div(365);
      anspruch = basis.plus(zins);
    }
    return { index, def: h, anteile: nichtNegativ(h.anteile, `Anteile von ${h.name}`), investiert, klasse, anspruch, zins, strike, mitarbeiter: m !== null, anteilig: m?.regel === "anteilig" };
  });
  const wandelbar = klassen.filter((k) => k.def.umwandelbar && zeilen.some((z) => z.klasse === k));
  const raenge = [...new Set(klassen.map((k) => k.rang))].sort((a, b) => a - b);
  return { exitdatum: eingabe.exitdatum, klassen, zeilen, wandelbar, raenge };
}

// Verteilung bei gegebener Umwandlungsentscheidung ----------------------------------------------------------------------------

interface Rangstufe {
  rang: number;
  anspruch: Decimal;
  gezahlt: Decimal;
}

interface Zustand {
  praeferenz: Decimal[];
  beteiligung: Decimal[];
  gedeckelt: boolean[];
  stufen: Rangstufe[];
  rest: Decimal;
  preis: Decimal | null;
  poolAnteile: Decimal;
  nichtVerteilt: Decimal;
  /** Faktor der anteiligen Minderung, `null` ohne Einheiten mit Regel `anteilig` im Geld. */
  faktor: Decimal | null;
  /** Mitarbeiterbeteiligung: Zeilen im Geld (Index). */
  imGeld: boolean[];
}

interface PoolZeile {
  z: ZeileIntern;
  /** Spielraum bis zum Cap; `null`: kein Cap. */
  raum: Decimal | null;
}

/**
 * Kleinstes p mit Σ min(raum, anteile × max(0, p − strike)) = rest. Knickstellen sind die Basispreise und Basispreis + raum ÷ anteile; auf dem
 * Abschnitt, in dem die Summe den Rest erreicht, ist sie linear. `preis` = `null`, wenn die Summe den Rest nie erreicht (alle am Cap).
 */
function loesePreis(pool: readonly PoolZeile[], rest: Decimal): { preis: Decimal | null; gedeckelt: Set<PoolZeile>; nichtVerteilt: Decimal } {
  const deckel = (p: PoolZeile) => (p.raum === null ? null : p.z.strike.plus(p.raum.div(p.z.anteile)));
  const stellen = [...new Map([ZERO, ...pool.map((p) => p.z.strike), ...pool.map(deckel).filter((x): x is Decimal => x !== null)].map((d) => [d.toString(), d])).values()].sort((a, b) => a.cmp(b));
  const summeBei = (preis: Decimal) => pool.reduce((s, p) => {
    const roh = p.z.anteile.times(Decimal.max(ZERO, preis.minus(p.z.strike)));
    return s.plus(p.raum === null ? roh : Decimal.min(p.raum, roh));
  }, ZERO);
  // Erster Abschnitt (vorige Stelle, Stelle], in dem die Summe den Rest erreicht; ab der letzten Stelle steigt sie nur mit den Zeilen ohne Cap.
  let unten = stellen[0] as Decimal;
  for (const stelle of stellen.slice(1)) {
    if (summeBei(stelle).greaterThanOrEqualTo(rest)) break;
    unten = stelle;
  }
  if (rest.isZero()) unten = ZERO;
  // Auf dem Abschnitt ab `unten`: am Cap sind die Zeilen, deren Deckelstelle ≤ unten liegt, aktiv die übrigen mit Basispreis ≤ unten.
  const gedeckelt = new Set(pool.filter((p) => { const d = deckel(p); return d !== null && d.lessThanOrEqualTo(unten) && !rest.isZero(); }));
  const aktiv = pool.filter((p) => !gedeckelt.has(p) && p.z.strike.lessThanOrEqualTo(unten));
  const anteile = aktiv.reduce((s, p) => s.plus(p.z.anteile), ZERO);
  const amCap = [...gedeckelt].reduce((s, p) => s.plus(p.raum as Decimal), ZERO);
  if (anteile.isZero()) {
    if (rest.isZero()) return { preis: ZERO, gedeckelt, nichtVerteilt: ZERO };
    return { preis: null, gedeckelt, nichtVerteilt: rest.minus(amCap) };
  }
  const preis = rest.minus(amCap).plus(aktiv.reduce((s, p) => s.plus(p.z.anteile.times(p.z.strike)), ZERO)).div(anteile);
  return { preis, gedeckelt, nichtVerteilt: ZERO };
}

function auswerten(ctx: Kontext, erloes: Decimal, gewandelt: ReadonlySet<string>): Zustand {
  const n = ctx.zeilen.length;
  const praeferenz = Array.from({ length: n }, () => ZERO);
  const beteiligung = Array.from({ length: n }, () => ZERO);
  const gedeckelt = Array.from({ length: n }, () => false);

  // Präferenzen nach Rangstufen
  let rest = erloes;
  const stufen: Rangstufe[] = [];
  for (const rang of ctx.raenge) {
    const gruppe = ctx.zeilen.filter((z) => z.klasse && z.klasse.rang === rang && !gewandelt.has(z.klasse.def.id));
    if (gruppe.length === 0) continue;
    const summe = gruppe.reduce((s, z) => s.plus(z.anspruch), ZERO);
    const gezahlt = Decimal.min(rest, summe);
    if (summe.greaterThan(0)) for (const z of gruppe) praeferenz[z.index] = gezahlt.times(z.anspruch).div(summe);
    rest = rest.minus(gezahlt);
    stufen.push({ rang, anspruch: summe, gezahlt });
  }
  const restNachPraeferenzen = rest;

  // Pool: Stammanteile, umgewandelte und partizipierende Klassen und Mitarbeiterbeteiligung (`wie_anteile`), jeweils mit Anteilen; Spielraum = Cap − Präferenz
  const pool: PoolZeile[] = [];
  for (const z of ctx.zeilen) {
    if (z.anteile.isZero() || z.anteilig) continue;
    if (!z.klasse || gewandelt.has(z.klasse.def.id)) pool.push({ z, raum: null });
    else if (z.klasse.def.partizipierend) {
      const raum = z.klasse.cap === null ? null : Decimal.max(ZERO, z.klasse.cap.times(z.investiert).minus(praeferenz[z.index] as Decimal));
      pool.push({ z, raum });
    }
  }
  const anteileImPool = pool.reduce((s, p) => s.plus(p.z.anteile), ZERO);
  const imGeld = Array.from({ length: n }, () => false);
  let preis: Decimal | null = null;
  let nichtVerteilt = restNachPraeferenzen;
  if (pool.length > 0) {
    const l = loesePreis(pool, restNachPraeferenzen);
    preis = l.preis;
    nichtVerteilt = l.nichtVerteilt;
    for (const p of pool) {
      if (l.gedeckelt.has(p)) {
        beteiligung[p.z.index] = p.raum as Decimal;
        gedeckelt[p.z.index] = true;
      } else if (preis !== null && preis.greaterThan(p.z.strike)) beteiligung[p.z.index] = p.z.anteile.times(preis.minus(p.z.strike));
      if (p.z.mitarbeiter) imGeld[p.z.index] = preis !== null && preis.greaterThan(p.z.strike);
    }
  }

  // Mitarbeiterbeteiligung mit Regel `anteilig`: Faktor f aus D × (1 − f) = Σ Einheiten × max(0, p₀ × f − Basispreis), im Geld nach Basispreis aufsteigend
  let faktor: Decimal | null = null;
  const anteilig = ctx.zeilen.filter((z) => z.anteilig && z.anteile.greaterThan(0)).sort((a, b) => a.strike.cmp(b.strike) || a.index - b.index);
  const verteilt = erloes.minus(nichtVerteilt);
  if (anteilig.length > 0 && preis !== null && verteilt.greaterThan(0)) {
    let f = new Decimal(1);
    let summeAnteile = ZERO;
    let summeStrike = ZERO;
    let k = 0;
    while (k < anteilig.length && (anteilig[k] as ZeileIntern).strike.lessThan(preis.times(f))) {
      const z = anteilig[k] as ZeileIntern;
      summeAnteile = summeAnteile.plus(z.anteile);
      summeStrike = summeStrike.plus(z.anteile.times(z.strike));
      f = verteilt.plus(summeStrike).div(verteilt.plus(preis.times(summeAnteile)));
      k++;
    }
    if (k > 0) {
      faktor = f;
      for (const z of ctx.zeilen) {
        if (z.anteilig) continue;
        praeferenz[z.index] = (praeferenz[z.index] as Decimal).times(f);
        beteiligung[z.index] = (beteiligung[z.index] as Decimal).times(f);
      }
      for (const z of anteilig.slice(0, k)) {
        beteiligung[z.index] = z.anteile.times(preis.times(f).minus(z.strike));
        imGeld[z.index] = true;
      }
      preis = preis.times(f);
    }
  }
  return { praeferenz, beteiligung, gedeckelt, stufen, rest: restNachPraeferenzen, preis, poolAnteile: anteileImPool, nichtVerteilt, faktor, imGeld };
}

function klassenRueckfluss(ctx: Kontext, z: Zustand, klasse: KlasseIntern): Decimal {
  return ctx.zeilen.reduce((s, zeile) => (zeile.klasse === klasse ? s.plus(z.praeferenz[zeile.index] as Decimal).plus(z.beteiligung[zeile.index] as Decimal) : s), ZERO);
}

// Umwandlungsentscheidung ---------------------------------------------------------------------------------------------------

const mit = (menge: ReadonlySet<string>, id: string) => new Set([...menge, id]);
const ohne = (menge: ReadonlySet<string>, id: string) => new Set([...menge].filter((x) => x !== id));

/** Gilt die strenge Stabilitätsbedingung für die Menge `w`? */
function istStabil(ctx: Kontext, erloes: Decimal, w: ReadonlySet<string>): boolean {
  const z = auswerten(ctx, erloes, w);
  for (const k of ctx.wandelbar) {
    const jetzt = klassenRueckfluss(ctx, z, k);
    if (w.has(k.def.id)) {
      if (!jetzt.greaterThan(klassenRueckfluss(ctx, auswerten(ctx, erloes, ohne(w, k.def.id)), k))) return false;
    } else if (klassenRueckfluss(ctx, auswerten(ctx, erloes, mit(w, k.def.id)), k).greaterThan(jetzt)) return false;
  }
  return true;
}

/** Stabile Menge gewandelter Klassen. `start` ist ein Vorschlag (z. B. die Lösung des benachbarten Exitwerts), der nur geprüft wird. */
function loeseUmwandlung(ctx: Kontext, erloes: Decimal, start?: ReadonlySet<string>): { gewandelt: Set<string>; durchgaenge: number } {
  if (ctx.wandelbar.length === 0) return { gewandelt: new Set(), durchgaenge: 0 };
  if (start && istStabil(ctx, erloes, start)) return { gewandelt: new Set(start), durchgaenge: 0 };
  const gesperrt = new Set<string>();
  let durchgaenge = 0;
  for (;;) {
    let w = new Set<string>();
    for (;;) {
      durchgaenge++;
      const z = auswerten(ctx, erloes, w);
      let wahl: { k: KlasseIntern; schwelle: Decimal } | null = null;
      for (const k of ctx.wandelbar) {
        if (w.has(k.def.id) || gesperrt.has(k.def.id)) continue;
        const alt = klassenRueckfluss(ctx, auswerten(ctx, erloes, mit(w, k.def.id)), k);
        const jetzt = klassenRueckfluss(ctx, z, k);
        if (!alt.greaterThan(jetzt)) continue;
        const anteile = ctx.zeilen.reduce((s, zeile) => (zeile.klasse === k ? s.plus(zeile.anteile) : s), ZERO);
        const schwelle = anteile.isZero() ? ZERO : jetzt.div(anteile);
        if (!wahl || schwelle.lessThan(wahl.schwelle)) wahl = { k, schwelle };
      }
      if (!wahl) break;
      w = mit(w, wahl.k.def.id);
    }
    // Prüfung: Jede gewandelte Klasse muss streng besser stehen als ohne Umwandlung.
    const z = auswerten(ctx, erloes, w);
    const zuViel = [...w].find((id) => {
      const k = ctx.wandelbar.find((x) => x.def.id === id) as KlasseIntern;
      return !klassenRueckfluss(ctx, z, k).greaterThan(klassenRueckfluss(ctx, auswerten(ctx, erloes, ohne(w, id)), k));
    });
    if (zuViel === undefined) return { gewandelt: w, durchgaenge };
    gesperrt.add(zuViel);
  }
}

// Rundung ------------------------------------------------------------------------------------------------------------------------

/**
 * Rundet exakte Teile auf Cent nach der Methode des größten Rests. Die Summe ist der auf Cent gerundete (halb auf) Gesamtbetrag der
 * Teile. Reste werden auf 15 Stellen verglichen, damit Rechenrauschen der 40. Stelle keinen Gleichstand verschiebt; bei Gleichstand
 * gewinnt der kleinere Index.
 */
export function rundeGroessterRest(werte: readonly Decimal[]): Decimal[] {
  const cents = werte.map((w) => w.times(100));
  const unten = cents.map((c) => c.floor());
  const ziel = cents.reduce((s, c) => s.plus(c), ZERO).plus(new Decimal(1).div(2)).floor();
  let fehlt = ziel.minus(unten.reduce((s, c) => s.plus(c), ZERO)).toNumber();
  const reihenfolge = cents
    .map((c, i) => ({ i, rest: c.minus(unten[i] as Decimal).toDecimalPlaces(15) }))
    .sort((a, b) => b.rest.cmp(a.rest) || a.i - b.i);
  for (const { i } of reihenfolge) {
    if (fehlt <= 0) break;
    unten[i] = (unten[i] as Decimal).plus(1);
    fehlt--;
  }
  return unten.map((u) => u.div(100));
}

// Ergebnis und Rechenweg ----------------------------------------------------------------------------------------------------

const text = (d: Decimal) => d.toString();

function pruefeEingabe(eingabe: WasserfallEingabe) {
  nichtNegativ(eingabe.exitwert, "Exitwert");
  const s = nichtNegativ(eingabe.treuhandAnteil ?? 0, "Treuhandanteil");
  if (s.greaterThanOrEqualTo(1)) throw new Error("Wasserfall: Treuhandanteil muss kleiner als 1 sein");
}

/**
 * Wasserfall zu einem Exitwert: Rückflüsse je Zeile und Klasse mit Umwandlungsentscheidung und Rechenweg. Wirft bei ungültiger
 * Eingabe (negative Beträge, unbekannte Klasse, Rang kleiner 1, Treuhandanteil ab 1).
 */
export function wasserfall(eingabe: WasserfallEingabe): MitHerkunft<WasserfallErgebnis> {
  pruefeEingabe(eingabe);
  const ctx = bereite(eingabe);
  const erloes = new Decimal(eingabe.exitwert);
  const treuhandAnteil = new Decimal(eingabe.treuhandAnteil ?? 0);
  const { gewandelt, durchgaenge } = loeseUmwandlung(ctx, erloes);
  const z = auswerten(ctx, erloes, gewandelt);

  // Auf Cent runden: Präferenz und Beteiligung je Zeile als Teile
  const teile: Decimal[] = [];
  for (const zeile of ctx.zeilen) teile.push(z.praeferenz[zeile.index] as Decimal, z.beteiligung[zeile.index] as Decimal);
  const gerundet = rundeGroessterRest(teile);
  const gesamt = ctx.zeilen.map((_, i) => (gerundet[2 * i] as Decimal).plus(gerundet[2 * i + 1] as Decimal));
  const treuhand = treuhandAnteil.isZero() ? gesamt.map(() => ZERO) : rundeGroessterRest(gesamt.map((g) => g.times(treuhandAnteil)));

  const zeilen: WasserfallZeile[] = ctx.zeilen.map((zeile, i) => {
    const klasseGewandelt = zeile.klasse !== null && gewandelt.has(zeile.klasse.def.id);
    return {
      id: zeile.def.id,
      name: zeile.def.name,
      klasseId: zeile.klasse?.def.id ?? null,
      anteile: zeile.anteile,
      investiert: zeile.investiert,
      anspruch: zeile.klasse && !klasseGewandelt ? zeile.anspruch : ZERO,
      praeferenz: gerundet[2 * i] as Decimal,
      beteiligung: gerundet[2 * i + 1] as Decimal,
      gesamt: gesamt[i] as Decimal,
      treuhand: treuhand[i] as Decimal,
      sofort: (gesamt[i] as Decimal).minus(treuhand[i] as Decimal),
      multiple: zeile.investiert.greaterThan(0) ? (gesamt[i] as Decimal).div(zeile.investiert) : null,
      gewandelt: klasseGewandelt,
      gedeckelt: z.gedeckelt[i] as boolean,
      basispreis: zeile.mitarbeiter ? zeile.strike : null,
      imGeld: zeile.mitarbeiter ? (z.imGeld[i] as boolean) : null,
    };
  });

  const gruppen: { id: string | null; name: string; rang: number | null; klasse: KlasseIntern | null }[] = [
    ...[...ctx.klassen].sort((a, b) => a.rang - b.rang).map((k) => ({ id: k.def.id as string | null, name: k.def.name, rang: k.rang as number | null, klasse: k as KlasseIntern | null })),
    { id: null, name: "", rang: null, klasse: null },
  ];
  const klassen: WasserfallKlasse[] = gruppen
    .map((g) => {
      const mitglieder = zeilen.filter((x) => x.klasseId === g.id);
      const summe = (feld: "anteile" | "investiert" | "anspruch" | "praeferenz" | "beteiligung" | "gesamt") => mitglieder.reduce((s, x) => s.plus(x[feld]), ZERO);
      const investiert = summe("investiert");
      const gesamtKlasse = summe("gesamt");
      return {
        id: g.id,
        name: g.name,
        rang: g.rang,
        anteile: summe("anteile"),
        investiert,
        anspruch: summe("anspruch"),
        praeferenz: summe("praeferenz"),
        beteiligung: summe("beteiligung"),
        gesamt: gesamtKlasse,
        multiple: investiert.greaterThan(0) ? gesamtKlasse.div(investiert) : null,
        gewandelt: g.id !== null && gewandelt.has(g.id),
        gedeckelt: mitglieder.some((x) => x.gedeckelt),
      };
    })
    .filter((k) => k.id !== null || zeilen.some((x) => x.klasseId === null));

  const schritte = baueSchritte(ctx, erloes, treuhandAnteil, gewandelt, durchgaenge, z, zeilen, treuhand);
  return {
    wert: { exitwert: erloes, treuhandAnteil, zeilen, klassen, gewandelt: [...gewandelt], restNachPraeferenzen: z.rest, preisJeAnteil: z.preis, nichtVerteilt: z.nichtVerteilt, minderungsfaktor: z.faktor },
    schritte,
  };
}

function baueSchritte(ctx: Kontext, erloes: Decimal, s: Decimal, gewandelt: ReadonlySet<string>, durchgaenge: number, z: Zustand, zeilen: WasserfallZeile[], treuhand: Decimal[]): Rechenschritt[] {
  const schritte: Rechenschritt[] = [{ zeichen: "", bezeichnung: "Verteilbarer Erlös (netto nach Kosten)", wert: text(erloes) }];

  // Umwandlungsprüfung je umwandelbarer Klasse
  for (const k of ctx.wandelbar) {
    const jetzt = gewandelt.has(k.def.id);
    const mitWandlung = klassenRueckfluss(ctx, auswerten(ctx, erloes, mit(gewandelt, k.def.id)), k);
    const ohneWandlung = klassenRueckfluss(ctx, auswerten(ctx, erloes, ohne(gewandelt, k.def.id)), k);
    schritte.push({ zeichen: "", bezeichnung: `Umwandlung ${k.def.name}: Rückfluss bei Umwandlung`, wert: text(mitWandlung) });
    schritte.push({ zeichen: "", bezeichnung: `Umwandlung ${k.def.name}: Rückfluss ohne Umwandlung`, wert: text(ohneWandlung) });
    schritte.push({ zeichen: "=", bezeichnung: jetzt ? `Entscheidung ${k.def.name}: wandelt um` : `Entscheidung ${k.def.name}: behält die Präferenz`, wert: text(jetzt ? mitWandlung : ohneWandlung) });
  }
  if (ctx.wandelbar.length > 0) schritte.push({ zeichen: "", bezeichnung: "Umwandlungsprüfung: Durchgänge", wert: String(durchgaenge) });

  // Ansprüche und Zahlungen je Rangstufe
  for (const stufe of z.stufen) {
    for (const k of ctx.klassen.filter((x) => x.rang === stufe.rang && !gewandelt.has(x.def.id))) {
      const mitglieder = ctx.zeilen.filter((x) => x.klasse === k);
      if (mitglieder.length === 0) continue;
      schritte.push({ zeichen: "", bezeichnung: `Anspruch ${k.def.name} (Rang ${k.rang})`, wert: text(mitglieder.reduce((a, x) => a.plus(x.anspruch), ZERO)) });
      const zins = mitglieder.reduce((a, x) => a.plus(x.zins), ZERO);
      if (zins.greaterThan(0)) schritte.push({ zeichen: "", bezeichnung: `davon Verzinsung ${k.def.name}`, wert: text(zins) });
    }
    schritte.push({ zeichen: "−", bezeichnung: `Rang ${stufe.rang}: gezahlte Präferenzen`, wert: text(stufe.gezahlt) });
  }
  schritte.push({ zeichen: "=", bezeichnung: "Rest nach Präferenzen", wert: text(z.rest) });

  // Beteiligung
  if (z.poolAnteile.greaterThan(0)) schritte.push({ zeichen: "", bezeichnung: "Anteile im Pool (Stammanteile, Umwandlung, Beteiligung)", wert: text(z.poolAnteile) });
  const strikeZeilen = ctx.zeilen.filter((x) => x.mitarbeiter && x.anteile.greaterThan(0));
  const gruppen = [
    { liste: strikeZeilen.filter((x) => x.def.mitarbeiter?.art !== "optionsschein"), einheiten: "Mitarbeiterbeteiligung: gevestete Einheiten", basis: "Basispreise der Einheiten im Geld (bleiben den übrigen Anteilen)" },
    { liste: strikeZeilen.filter((x) => x.def.mitarbeiter?.art === "optionsschein"), einheiten: "Optionsscheine: nicht ausgeübte Anteile", basis: "Ausübungspreise der Optionsscheine im Geld (bleiben den übrigen Anteilen)" },
  ];
  for (const g of gruppen) {
    if (g.liste.length === 0) continue;
    const imGeld = g.liste.filter((x) => z.imGeld[x.index]);
    schritte.push({ zeichen: "", bezeichnung: g.einheiten, wert: text(g.liste.reduce((a, x) => a.plus(x.anteile), ZERO)) });
    schritte.push({ zeichen: "", bezeichnung: "davon im Geld (Basispreis unter dem Betrag je Anteil)", wert: text(imGeld.reduce((a, x) => a.plus(x.anteile), ZERO)) });
    const basis = imGeld.filter((x) => !x.anteilig).reduce((a, x) => a.plus(x.anteile.times(x.strike)), ZERO);
    if (basis.greaterThan(0)) schritte.push({ zeichen: "+", bezeichnung: g.basis, wert: text(basis) });
  }
  if (z.faktor !== null) schritte.push({ zeichen: "×", bezeichnung: "Minderung aller Rückflüsse durch die Mitarbeiterbeteiligung (Faktor)", wert: text(z.faktor) });
  if (z.preis !== null) schritte.push({ zeichen: "÷", bezeichnung: "Betrag je Anteil", wert: text(z.preis) });
  for (const x of zeilen) {
    if (!x.gedeckelt) continue;
    const zeile = ctx.zeilen[ctx.zeilen.findIndex((y) => y.def.id === x.id)] as ZeileIntern;
    schritte.push({ zeichen: "", bezeichnung: `Deckelung ${x.name} (${zeile.klasse?.def.name ?? ""}): Gesamtrückfluss auf Cap begrenzt`, wert: text(x.gesamt) });
  }
  if (z.nichtVerteilt.greaterThan(0)) schritte.push({ zeichen: "", bezeichnung: "Nicht verteilt (niemand anspruchsberechtigt)", wert: text(z.nichtVerteilt) });
  const summe = zeilen.reduce((a, x) => a.plus(x.gesamt), ZERO);
  schritte.push({ zeichen: "=", bezeichnung: "Summe der Rückflüsse (auf Cent)", wert: text(summe) });
  if (s.greaterThan(0)) {
    const einbehalt = treuhand.reduce((a, x) => a.plus(x), ZERO);
    schritte.push({ zeichen: "", bezeichnung: "Treuhandanteil", wert: text(s) });
    schritte.push({ zeichen: "−", bezeichnung: "Einbehalt Treuhand (auf Cent)", wert: text(einbehalt) });
    schritte.push({ zeichen: "=", bezeichnung: "Sofort ausgezahlt", wert: text(summe.minus(einbehalt)) });
  }
  return schritte;
}

/**
 * Entscheidung von außen vorgeben (für Prüfungen): exakte, ungerundete Rückflüsse je Klasse bei genau dieser Menge gewandelter
 * Klassen. `null` im Schlüssel steht für die Stammanteile.
 */
export function wasserfallBeiEntscheidung(eingabe: WasserfallEingabe, gewandelt: readonly string[]): { klassen: Map<string | null, Decimal>; zeilen: Map<string, Decimal>; nichtVerteilt: Decimal } {
  pruefeEingabe(eingabe);
  const ctx = bereite(eingabe);
  const z = auswerten(ctx, new Decimal(eingabe.exitwert), new Set(gewandelt));
  const klassen = new Map<string | null, Decimal>();
  const zeilen = new Map<string, Decimal>();
  for (const zeile of ctx.zeilen) {
    const wert = (z.praeferenz[zeile.index] as Decimal).plus(z.beteiligung[zeile.index] as Decimal);
    zeilen.set(zeile.def.id, wert);
    const id = zeile.klasse?.def.id ?? null;
    klassen.set(id, (klassen.get(id) ?? ZERO).plus(wert));
  }
  return { klassen, zeilen, nichtVerteilt: z.nichtVerteilt };
}

// Kurve und Knickpunkte ---------------------------------------------------------------------------------------------------------

/**
 * Exakte (ungerundete) Rückflüsse der Zeilen `zeilenIds` für mehrere Exitwerte, ohne Rechenweg. Der Treuhandanteil spielt keine Rolle.
 * Die Umwandlungsentscheidung des vorigen Exitwerts dient als Vorschlag und wird nur geprüft; die Exitwerte sollten aufsteigend sein.
 */
export function wasserfallKurve(eingabe: Omit<WasserfallEingabe, "exitwert">, exitwerte: readonly Decimal.Value[], zeilenIds: readonly string[]): { exitwert: Decimal; rueckfluss: Decimal }[] {
  const ctx = bereite(eingabe);
  const gesucht = new Set(zeilenIds);
  let vorher: Set<string> | undefined;
  return exitwerte.map((roh) => {
    const erloes = nichtNegativ(roh, "Exitwert");
    const { gewandelt } = loeseUmwandlung(ctx, erloes, vorher);
    vorher = gewandelt;
    const z = auswerten(ctx, erloes, gewandelt);
    const rueckfluss = ctx.zeilen.reduce((sum, zeile) => (gesucht.has(zeile.def.id) ? sum.plus(z.praeferenz[zeile.index] as Decimal).plus(z.beteiligung[zeile.index] as Decimal) : sum), ZERO);
    return { exitwert: erloes, rueckfluss };
  });
}

export type KnickArt = "praeferenz_voll" | "beteiligung_beginn" | "umwandlung" | "deckel" | "im_geld" | "sonstige";

export interface Knick {
  /** Exitwert, ab dem die Verteilung anders verläuft, auf Cent. */
  exitwert: Decimal;
  ereignisse: { art: KnickArt; klasseId: string | null; rang: number | null }[];
}

interface Regime {
  gewandelt: string[];
  gedeckelt: string[];
  /** Zeilen der Mitarbeiterbeteiligung im Geld. */
  imGeld: string[];
  /** Je Rangstufe: voll bedient? */
  voll: Map<number, boolean>;
  beteiligung: boolean;
}

function regimeBei(ctx: Kontext, erloes: Decimal, vorher: Set<string> | undefined): { regime: Regime; gewandelt: Set<string> } {
  const { gewandelt } = loeseUmwandlung(ctx, erloes, vorher);
  const z = auswerten(ctx, erloes, gewandelt);
  const voll = new Map<number, boolean>();
  for (const stufe of z.stufen) voll.set(stufe.rang, stufe.gezahlt.greaterThanOrEqualTo(stufe.anspruch));
  return {
    gewandelt,
    regime: {
      gewandelt: [...gewandelt].sort(),
      gedeckelt: ctx.zeilen.filter((zeile) => z.gedeckelt[zeile.index]).map((zeile) => zeile.def.id).sort(),
      imGeld: ctx.zeilen.filter((zeile) => z.imGeld[zeile.index]).map((zeile) => zeile.def.id).sort(),
      voll,
      beteiligung: z.rest.greaterThan(0),
    },
  };
}

const schluesselVon = (r: Regime) => `${r.gewandelt.join(",")}|${r.gedeckelt.join(",")}|${r.imGeld.join(",")}|${[...r.voll].map(([rang, v]) => `${rang}${v ? "v" : "o"}`).join(",")}|${r.beteiligung ? "b" : "-"}`;

function ereignisse(ctx: Kontext, von: Regime, nach: Regime): Knick["ereignisse"] {
  const aus: Knick["ereignisse"] = [];
  for (const [rang, voll] of nach.voll) if (voll && !von.voll.get(rang)) aus.push({ art: "praeferenz_voll", klasseId: null, rang });
  if (nach.beteiligung && !von.beteiligung) aus.push({ art: "beteiligung_beginn", klasseId: null, rang: null });
  for (const id of nach.gewandelt) if (!von.gewandelt.includes(id)) aus.push({ art: "umwandlung", klasseId: id, rang: ctx.klassen.find((k) => k.def.id === id)?.rang ?? null });
  for (const id of nach.gedeckelt) {
    if (von.gedeckelt.includes(id)) continue;
    const klasse = ctx.zeilen.find((zeile) => zeile.def.id === id)?.klasse ?? null;
    aus.push({ art: "deckel", klasseId: klasse?.def.id ?? null, rang: klasse?.rang ?? null });
  }
  if (nach.imGeld.some((id) => !von.imGeld.includes(id))) aus.push({ art: "im_geld", klasseId: null, rang: null });
  if (aus.length === 0) aus.push({ art: "sonstige", klasseId: null, rang: null });
  return aus;
}

/**
 * Exitwerte im Bereich (0, bis], an denen sich die Verteilung ändert (für Diagramme): Präferenz einer Rangstufe voll bedient, Beginn der
 * Beteiligung, Umwandlung einer Klasse, Cap erreicht, Mitarbeiterbeteiligung kommt ins Geld. Die Rückflüsse sind dazwischen linear in Exitwert
 * (außer mit Mitarbeiterbeteiligung der Regel `anteilig`: deren Faktor ist ein Bruch im Exitwert, die Kurve dazwischen gekrümmt). Gesucht wird auf einem Raster
 * (gleichmäßig plus die Summen der Ansprüche je Rangstufe) und dann durch Halbieren auf eine halbe Cent-Breite eingegrenzt; der Wert
 * ist der erste Exitwert des neuen Verlaufs, auf Cent. Zwei Wechsel innerhalb eines Rasterschritts, die sich aufheben, bleiben unentdeckt.
 */
export function wasserfallKnicke(eingabe: Omit<WasserfallEingabe, "exitwert">, bis: Decimal.Value, raster = 200): Knick[] {
  const ctx = bereite(eingabe);
  const ende = new Decimal(bis);
  if (!ende.greaterThan(0)) return [];
  const punkte = new Map<string, Decimal>();
  const merke = (d: Decimal) => {
    if (d.greaterThan(0) && d.lessThanOrEqualTo(ende)) punkte.set(d.toFixed(8), d);
  };
  punkte.set("0", ZERO);
  for (let i = 1; i <= raster; i++) merke(ende.times(i).div(raster));
  // Summen der Ansprüche je Rangstufe (ohne Umwandlung) sind sichere Kandidaten für Wechsel
  let summe = ZERO;
  for (const rang of ctx.raenge) {
    summe = summe.plus(ctx.zeilen.filter((z) => z.klasse?.rang === rang).reduce((a, z) => a.plus(z.anspruch), ZERO));
    merke(summe);
  }
  const sortiert = [...punkte.values()].sort((a, b) => a.cmp(b));
  const knicke: Knick[] = [];
  let vorher: Set<string> | undefined;
  const halb = new Decimal("0.005");

  const suche = (lo: Decimal, regimeLo: Regime, hi: Decimal, regimeHi: Regime) => {
    if (schluesselVon(regimeLo) === schluesselVon(regimeHi)) return;
    if (hi.minus(lo).lessThanOrEqualTo(halb)) {
      knicke.push({ exitwert: hi.toDecimalPlaces(2, Decimal.ROUND_HALF_UP), ereignisse: ereignisse(ctx, regimeLo, regimeHi) });
      return;
    }
    const mitte = lo.plus(hi).div(2);
    const r = regimeBei(ctx, mitte, vorher);
    vorher = r.gewandelt;
    suche(lo, regimeLo, mitte, r.regime);
    suche(mitte, r.regime, hi, regimeHi);
  };

  let letzter = regimeBei(ctx, sortiert[0] as Decimal, vorher);
  vorher = letzter.gewandelt;
  for (let i = 1; i < sortiert.length; i++) {
    const punkt = sortiert[i] as Decimal;
    const aktuell = regimeBei(ctx, punkt, vorher);
    suche(sortiert[i - 1] as Decimal, letzter.regime, punkt, aktuell.regime);
    vorher = aktuell.gewandelt;
    letzter = aktuell;
  }
  // Knicke desselben Exitwerts zusammenfassen
  const zusammen: Knick[] = [];
  for (const k of knicke.sort((a, b) => a.exitwert.cmp(b.exitwert))) {
    const letzterKnick = zusammen.at(-1);
    if (letzterKnick && letzterKnick.exitwert.eq(k.exitwert)) letzterKnick.ereignisse.push(...k.ereignisse);
    else zusammen.push(k);
  }
  return zusammen;
}
