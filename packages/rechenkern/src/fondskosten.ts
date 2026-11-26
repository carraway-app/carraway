import { Decimal } from "./decimal.js";
import { tageZwischen, type Datum } from "./datum.js";
import type { MitHerkunft, Rechenschritt } from "./herkunft.js";
import { verteileAnteilig } from "./verteilung.js";

/**
 * Verwaltungsvergütung und Fondskosten auf den Kapitalkonten der Investoren (Issue #157).
 *
 * Kosten sind keine Zahlungen zwischen Fonds und Investoren: Sie mindern das Fondsvermögen (in der Saldenliste über Bank oder
 * Verbindlichkeiten, also schon im Fonds-NAV) und werden je Investor festgeschrieben. Der NAV des Fonds wird wie bisher nach den
 * Gewichten der Verteilungsgrundlage auf die Investoren verteilt; trägt ein Investor von einer Kostenbuchung mehr oder weniger als
 * seinen Anteil nach diesen Gewichten (abweichende Regel, späteres Closing), gleicht ein Ausgleich das in seinem NAV-Anteil aus.
 * Bei rein anteiligen Kosten ist der Ausgleich null; die Summe der NAV-Anteile ist immer genau der NAV des Fonds.
 */

const cent = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

export interface VerguetungEingabe {
  /** Bemessungsgrundlage, z. B. die Summe der Zusagen. */
  basis: Decimal.Value;
  /** Jahressatz als Bruch (0.02 = 2 % p. a.). */
  satzProJahr: Decimal.Value;
  /** Abrechnungszeitraum, beide Tage einschließlich. */
  von: Datum;
  bis: Datum;
}

/** Vergütung = Basis × Jahressatz × Tage / 365 (act/365, beide Tage einschließlich), auf den Cent gerundet (halb auf). */
export function verwaltungsverguetung(e: VerguetungEingabe): MitHerkunft<Decimal> {
  const tage = tageZwischen(e.von, e.bis) + 1;
  if (tage <= 0) throw new Error("Vergütung: Ende vor Beginn");
  const basis = new Decimal(e.basis);
  const satz = new Decimal(e.satzProJahr);
  if (basis.isNegative()) throw new Error("Vergütung: negative Basis");
  if (!satz.greaterThan(0) || !satz.lessThan(1)) throw new Error("Vergütung: Satz außerhalb von 0 bis 1");
  const exakt = basis.times(satz).times(tage).div(365);
  const wert = cent(exakt);
  return {
    wert,
    schritte: [
      { zeichen: "", bezeichnung: "Bemessungsgrundlage", wert: basis.toString() },
      { zeichen: "×", bezeichnung: "Jahressatz", wert: satz.toString() },
      { zeichen: "×", bezeichnung: `Tage ${e.von} bis ${e.bis} (einschließlich) / 365`, wert: `${tage}/365` },
      { zeichen: "=", bezeichnung: "Vergütung (auf den Cent gerundet)", wert: wert.toFixed(2) },
    ],
  };
}

/**
 * Prüft eine ausdrücklich angegebene Aufteilung: Centbeträge, keiner negativ, Summe genau der Betrag. Gibt den Grund zurück oder `null`.
 */
export function pruefeKostenaufteilung(betrag: Decimal.Value, teile: readonly Decimal.Value[]): "nachkommastellen" | "negativ" | "summe" | null {
  const zahlen = teile.map((t) => new Decimal(t));
  if (zahlen.some((t) => !t.times(100).isInteger())) return "nachkommastellen";
  if (zahlen.some((t) => t.isNegative())) return "negativ";
  const summe = zahlen.reduce((s, t) => s.plus(t), new Decimal(0));
  return summe.equals(betrag) ? null : "summe";
}

export interface KostenbuchungAnteile {
  id: string;
  art: "verwaltungsverguetung" | "fondskosten";
  /** Festgeschriebene Anteile in der Reihenfolge der Investoren (`0.00` für Investoren ohne Anteil). */
  teile: readonly Decimal.Value[];
}

export interface KontoEingabe {
  eingezahlt: Decimal.Value;
  ausgeschuettet: Decimal.Value;
}

export interface KontoMitKosten {
  verwaltungsverguetung: string;
  fondskosten: string;
  /** Ausgleich abweichender Kostenverteilung im NAV-Anteil (positiv: der Investor trug weniger als seinen Anteil). */
  kostenausgleich: string;
  navAnteil: string | null;
  /** Wertentwicklung und übriges Ergebnis: NAV-Anteil − (Eingezahlt − Ausschüttungen − Vergütung − Kosten). */
  ergebnisanteil: string | null;
  /** Fortschreibung des Kapitalkontos bis zum NAV-Anteil. */
  schritte: Rechenschritt[];
}

/**
 * Kapitalkonten mit Kosten. `gewichte[i]` und `konten[i]` gehören zum selben Investor wie die `teile[i]` jeder Buchung; die Gewichte sind
 * die der NAV-Verteilung (Investoren mit Gewicht null, z. B. ausgetretene, bekommen keinen NAV-Anteil und keinen Ausgleich).
 */
export function kapitalkontenMitKosten(nav: Decimal.Value | null, gewichte: readonly Decimal.Value[], konten: readonly KontoEingabe[], kosten: readonly KostenbuchungAnteile[]): KontoMitKosten[] {
  const n = gewichte.length;
  if (konten.length !== n) throw new Error("Kapitalkonten: Konten und Gewichte passen nicht zusammen");
  const null0 = () => Array.from({ length: n }, () => new Decimal(0));
  const verguetung = null0();
  const fondskosten = null0();
  const ausgleich = null0();
  const aktiv = gewichte.map((g, i) => (new Decimal(g).greaterThan(0) ? i : -1)).filter((i) => i >= 0);

  for (const k of kosten) {
    if (k.teile.length !== n) throw new Error(`Kapitalkonten: Anteile der Kostenbuchung ${k.id} passen nicht zu den Investoren`);
    const teile = k.teile.map((t) => new Decimal(t));
    const ziel = k.art === "verwaltungsverguetung" ? verguetung : fondskosten;
    teile.forEach((t, i) => (ziel[i] = ziel[i]!.plus(t)));
    if (aktiv.length === 0) continue;
    // Was die aktiven Investoren gemeinsam trugen, verteilt nach den Gewichten des NAV; die Differenz zum Getragenen gleicht der NAV-Anteil aus.
    const getragen = aktiv.reduce((s, i) => s.plus(teile[i]!), new Decimal(0));
    if (getragen.isZero()) continue;
    const soll = verteileAnteilig(getragen, aktiv.map((i) => gewichte[i]!));
    aktiv.forEach((i, j) => (ausgleich[i] = ausgleich[i]!.plus(soll[j]!).minus(teile[i]!)));
  }

  const navTeile = nav === null || n === 0 ? null : verteileAnteilig(new Decimal(nav).toFixed(2), gewichte);
  return konten.map((konto, i) => {
    const eingezahlt = new Decimal(konto.eingezahlt);
    const ausgeschuettet = new Decimal(konto.ausgeschuettet);
    const v = verguetung[i]!;
    const f = fondskosten[i]!;
    const a = ausgleich[i]!;
    const navAnteil = navTeile ? navTeile[i]!.plus(a) : null;
    const ergebnis = navAnteil === null ? null : navAnteil.minus(eingezahlt.minus(ausgeschuettet).minus(v).minus(f));
    const schritte: Rechenschritt[] = [
      { zeichen: "", bezeichnung: "Eingezahltes Kapital", wert: eingezahlt.toFixed(2) },
      { zeichen: "−", bezeichnung: "Ausschüttungen", wert: ausgeschuettet.toFixed(2) },
      { zeichen: "−", bezeichnung: "Verwaltungsvergütung", wert: v.toFixed(2), quellen: kosten.filter((k) => k.art === "verwaltungsverguetung").map((k) => k.id) },
      { zeichen: "−", bezeichnung: "Fondskosten", wert: f.toFixed(2), quellen: kosten.filter((k) => k.art === "fondskosten").map((k) => k.id) },
    ];
    if (navAnteil !== null && ergebnis !== null && navTeile) {
      schritte.push(
        { zeichen: "+", bezeichnung: "Wertentwicklung und übriges Ergebnis", wert: ergebnis.toFixed(2) },
        { zeichen: "=", bezeichnung: "NAV-Anteil", wert: navAnteil.toFixed(2) },
        { zeichen: "", bezeichnung: "davon NAV des Fonds nach Anteil", wert: navTeile[i]!.toFixed(2) },
        { zeichen: "", bezeichnung: "davon Ausgleich abweichender Kostenverteilung", wert: a.toFixed(2) },
      );
    } else {
      schritte.push({ zeichen: "=", bezeichnung: "NAV-Anteil", wert: "—" });
    }
    return {
      verwaltungsverguetung: v.toFixed(2),
      fondskosten: f.toFixed(2),
      kostenausgleich: a.toFixed(2),
      navAnteil: navAnteil?.toFixed(2) ?? null,
      ergebnisanteil: ergebnis?.toFixed(2) ?? null,
      schritte,
    };
  });
}
