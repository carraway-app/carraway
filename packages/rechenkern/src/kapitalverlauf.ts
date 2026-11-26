import { Decimal } from "./decimal.js";
import { vergleiche, zerlege, type Datum } from "./datum.js";
import type { MitHerkunft, Rechenschritt } from "./herkunft.js";

export type Kapitalbewegungsart = "auszahlung" | "tilgung" | "kapitalisierung";

/** Eine Bewegung des Darlehenskapitals. Der Betrag ist immer positiv; die Art bestimmt die Richtung. */
export interface Kapitalbewegung {
  datum: Datum;
  art: Kapitalbewegungsart;
  betrag: Decimal.Value;
}

/** Offenes Kapital ab einem Datum (einschließlich), bis zur nächsten Änderung. */
export interface Kapitalstand {
  ab: Datum;
  kapital: Decimal;
}

export interface Kapitalabschnitt {
  von: Datum;
  /** Ausschließlich, wie bei den Zinsmethoden. */
  bis: Datum;
  kapital: Decimal;
}

/** Treppenfunktion des offenen Kapitals, sortiert, ein Eintrag je Datum mit Änderung. */
export interface Kapitalverlauf {
  staende: Kapitalstand[];
}

const RICHTUNG: Record<Kapitalbewegungsart, 1 | -1> = { auszahlung: 1, kapitalisierung: 1, tilgung: -1 };

/**
 * Leitet aus den Bewegungen das offene Kapital je Zeitraum ab.
 * Bewegungen am selben Tag gelten zusammen: das Kapital ab diesem Tag ist der Stand nach allen Bewegungen des Tages.
 * Fehler: ungültiges Datum, Betrag nicht positiv, erste Bewegung keine Auszahlung, Kapital am Tagesende negativ.
 */
export function kapitalverlauf(bewegungen: readonly Kapitalbewegung[]): MitHerkunft<Kapitalverlauf> {
  for (const b of bewegungen) {
    zerlege(b.datum);
    if (!new Decimal(b.betrag).greaterThan(0)) {
      throw new Error(`Betrag der Bewegung am ${b.datum} muss größer als null sein`);
    }
  }
  const sortiert = [...bewegungen].sort((a, b) => vergleiche(a.datum, b.datum));
  const erste = sortiert[0];
  if (erste && erste.art !== "auszahlung") {
    throw new Error(`Die erste Bewegung muss eine Auszahlung sein (${erste.datum}: ${erste.art})`);
  }

  const staende: Kapitalstand[] = [];
  const schritte: Rechenschritt[] = [];
  let kapital = new Decimal(0);
  for (let i = 0; i < sortiert.length; ) {
    const datum = sortiert[i]!.datum;
    const teile: Rechenschritt[] = [];
    while (i < sortiert.length && sortiert[i]!.datum === datum) {
      const b = sortiert[i]!;
      const betrag = new Decimal(b.betrag);
      kapital = kapital.plus(betrag.times(RICHTUNG[b.art]));
      teile.push({ zeichen: RICHTUNG[b.art] === 1 ? "+" : "−", bezeichnung: `${grossanfang(b.art)} am ${datum}`, wert: betrag.toString() });
      i++;
    }
    if (kapital.isNegative()) {
      throw new Error(`Offenes Kapital wird am ${datum} negativ (${kapital.toString()})`);
    }
    schritte.push(...teile, { zeichen: "=", bezeichnung: `Offenes Kapital ab ${datum}`, wert: kapital.toString() });
    staende.push({ ab: datum, kapital });
  }
  return { wert: { staende }, schritte };
}

function grossanfang(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Datum der ersten Auszahlung, `undefined` ohne Bewegungen. */
export function ersteAuszahlung(verlauf: Kapitalverlauf): Datum | undefined {
  return verlauf.staende[0]?.ab;
}

/** Offenes Kapital an einem Tag (vor der ersten Auszahlung null). */
export function kapitalAm(verlauf: Kapitalverlauf, datum: Datum): Decimal {
  let kapital = new Decimal(0);
  for (const stand of verlauf.staende) {
    if (vergleiche(stand.ab, datum) > 0) break;
    kapital = stand.kapital;
  }
  return kapital;
}

/** Zerlegt `von` (einschließlich) bis `bis` (ausschließlich) an jeder Kapitaländerung. */
export function kapitalabschnitte(verlauf: Kapitalverlauf, von: Datum, bis: Datum): Kapitalabschnitt[] {
  if (vergleiche(bis, von) < 0) throw new Error(`Enddatum ${bis} liegt vor dem Beginn ${von}`);
  const grenzen = [von];
  for (const stand of verlauf.staende) {
    if (vergleiche(stand.ab, von) > 0 && vergleiche(stand.ab, bis) < 0) grenzen.push(stand.ab);
  }
  grenzen.push(bis);
  const abschnitte: Kapitalabschnitt[] = [];
  for (let i = 0; i < grenzen.length - 1; i++) {
    const a = grenzen[i]!;
    const b = grenzen[i + 1]!;
    if (vergleiche(a, b) < 0) abschnitte.push({ von: a, bis: b, kapital: kapitalAm(verlauf, a) });
  }
  return abschnitte;
}
