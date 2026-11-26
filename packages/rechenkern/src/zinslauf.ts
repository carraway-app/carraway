import { Decimal } from "./decimal.js";
import { vergleiche, zerlege, type Datum } from "./datum.js";
import type { Rechenschritt } from "./herkunft.js";
import { ersteAuszahlung, kapitalverlauf, type Kapitalabschnitt, type Kapitalbewegung } from "./kapitalverlauf.js";
import { aufCent } from "./zins.js";
import { zinsenAufVerlauf, type Zinsbedingungen } from "./zinsrechnung.js";

export type Zinsperiodenart = "jaehrlich" | "quartalsweise" | "endfaellig";

export interface Zinsdarlehen {
  id: string;
  bewegungen: Kapitalbewegung[];
  bedingungen: Zinsbedingungen;
  zinsperiode: Zinsperiodenart;
  /**
   * Ankerdatum der Periodenenden. Jährlich: jedes Jahr am selben Tag und Monat, quartalsweise: alle drei Monate.
   * Liegt der Anker am Monatsende, bleiben alle Periodenenden am Monatsende. Endfällig: der Fälligkeitstag.
   */
  anker: Datum;
  /** Zinsen am Periodenende dem Kapital zuschlagen (Zinseszins, als Kapitalisierung in Höhe des gebuchten Betrags). */
  kapitalisieren?: boolean;
  /** Verschiebt nur die Fälligkeit der Zahlung, die Zinsen laufen unverändert weiter. */
  stundungBis?: Datum;
  /**
   * Enddaten bereits gebuchter Perioden. Sie werden übersprungen. Bei `kapitalisieren` muss die zugehörige
   * Kapitalisierung bereits in `bewegungen` stehen, sie wird nicht noch einmal erzeugt.
   */
  gebuchtePerioden?: Datum[];
}

export interface Zinsposition {
  darlehenId: string;
  von: Datum;
  bis: Datum;
  /** Zahlungsfälligkeit: Periodenende, bei Stundung der spätere Tag. */
  faelligAm: Datum;
  gestundet: boolean;
  kapitalien: Kapitalabschnitt[];
  betragFix: Decimal;
  betragGewinn: Decimal;
  /** Ungerundet. */
  betragGesamt: Decimal;
  /** Auf Cent, kaufmännisch. Nur dieser Betrag wird gerundet. */
  betragGebucht: Decimal;
  kapitalisiert: boolean;
  schritte: Rechenschritt[];
}

export interface Abgrenzung {
  darlehenId: string;
  /** Ende der letzten Periode (oder erste Auszahlung), ab dem Zinsen aufgelaufen sind. */
  von: Datum;
  bis: Datum;
  kapitalien: Kapitalabschnitt[];
  betragFix: Decimal;
  betragGewinn: Decimal;
  betragGesamt: Decimal;
  betragGebucht: Decimal;
  schritte: Rechenschritt[];
}

const MONATE = { jaehrlich: 12, quartalsweise: 3 } as const;

function tageImMonat(jahr: number, monat: number): number {
  return new Date(Date.UTC(jahr, monat, 0)).getUTCDate();
}

function zweistellig(n: number): string {
  return String(n).padStart(2, "0");
}

/** Periodenende `n` Schritte vom Anker entfernt. */
function endeNr(anker: Datum, monate: number, n: number): Datum {
  const a = zerlege(anker);
  const index = a.jahr * 12 + (a.monat - 1) + n * monate;
  const jahr = Math.floor(index / 12);
  const monat = (index % 12) + 1;
  const letzter = tageImMonat(jahr, monat);
  const tag = a.tag === tageImMonat(a.jahr, a.monat) ? letzter : Math.min(a.tag, letzter);
  return `${String(jahr).padStart(4, "0")}-${zweistellig(monat)}-${zweistellig(tag)}`;
}

/** Periodenenden nach `nach` (ausschließlich) bis `bis` (einschließlich). */
function periodenenden(art: Zinsperiodenart, anker: Datum, nach: Datum, bis: Datum): Datum[] {
  if (art === "endfaellig") {
    if (vergleiche(anker, nach) <= 0) throw new Error(`Fälligkeit ${anker} liegt nicht nach der ersten Auszahlung ${nach}`);
    return vergleiche(anker, bis) <= 0 ? [anker] : [];
  }
  const monate = MONATE[art];
  let n = 0;
  while (vergleiche(endeNr(anker, monate, n), nach) > 0) n--;
  while (vergleiche(endeNr(anker, monate, n), nach) <= 0) n++;
  const enden: Datum[] = [];
  for (; vergleiche(endeNr(anker, monate, n), bis) <= 0; n++) enden.push(endeNr(anker, monate, n));
  return enden;
}

interface Lauf {
  positionen: Zinsposition[];
  /** Ende der letzten Periode bis zum Stichtag, sonst erste Auszahlung. */
  grenze: Datum | undefined;
  bewegungen: Kapitalbewegung[];
}

function laufe(darlehen: Zinsdarlehen, stichtag: Datum): Lauf {
  zerlege(stichtag);
  const erste = ersteAuszahlung(kapitalverlauf(darlehen.bewegungen).wert);
  if (erste === undefined) return { positionen: [], grenze: undefined, bewegungen: [...darlehen.bewegungen] };

  const gebucht = new Set(darlehen.gebuchtePerioden ?? []);
  const bewegungen = [...darlehen.bewegungen];
  const positionen: Zinsposition[] = [];
  let start = erste;
  for (const ende of periodenenden(darlehen.zinsperiode, darlehen.anker, erste, stichtag)) {
    if (!gebucht.has(ende)) {
      const ergebnis = zinsenAufVerlauf(kapitalverlauf(bewegungen).wert, start, ende, darlehen.bedingungen);
      const betragGebucht = aufCent(ergebnis.betragGesamt);
      const kapitalisiert = darlehen.kapitalisieren === true && betragGebucht.greaterThan(0);
      if (kapitalisiert) bewegungen.push({ datum: ende, art: "kapitalisierung", betrag: betragGebucht });
      const gestundet = darlehen.stundungBis !== undefined && vergleiche(darlehen.stundungBis, ende) > 0;
      positionen.push({
        darlehenId: darlehen.id,
        von: start,
        bis: ende,
        faelligAm: gestundet ? darlehen.stundungBis! : ende,
        gestundet,
        kapitalien: ergebnis.segmente.map(({ von, bis, kapital }) => ({ von, bis, kapital })),
        betragFix: ergebnis.betragFix,
        betragGewinn: ergebnis.betragGewinn,
        betragGesamt: ergebnis.betragGesamt,
        betragGebucht,
        kapitalisiert,
        schritte: [
          ...ergebnis.schritte,
          { zeichen: "=", bezeichnung: "Gebucht (auf Cent, kaufmännisch)", wert: betragGebucht.toString() },
          ...(kapitalisiert ? [{ zeichen: "" as const, bezeichnung: `Als Kapital zugeschlagen zum ${ende}`, wert: betragGebucht.toString() }] : []),
        ],
      });
    }
    start = ende;
  }
  return { positionen, grenze: start, bewegungen };
}

/** Zinspositionen aller Darlehen: eine je Darlehen und noch nicht gebuchter Periode, deren Ende bis zum Stichtag liegt. */
export function zinslauf(darlehen: readonly Zinsdarlehen[], stichtag: Datum): Zinsposition[] {
  return darlehen.flatMap((d) => laufe(d, stichtag).positionen);
}

/** Abgrenzung für den Abschluss: Zinsen seit dem letzten Periodenende bis zum Stichtag (einschließlich laufender Periode). */
export function abgrenzung(darlehen: Zinsdarlehen, stichtag: Datum): Abgrenzung {
  const lauf = laufe(darlehen, stichtag);
  const von = lauf.grenze !== undefined && vergleiche(lauf.grenze, stichtag) < 0 ? lauf.grenze : stichtag;
  const ergebnis = zinsenAufVerlauf(kapitalverlauf(lauf.bewegungen).wert, von, stichtag, darlehen.bedingungen);
  const betragGebucht = aufCent(ergebnis.betragGesamt);
  return {
    darlehenId: darlehen.id,
    von,
    bis: stichtag,
    kapitalien: ergebnis.segmente.map(({ von: v, bis: b, kapital }) => ({ von: v, bis: b, kapital })),
    betragFix: ergebnis.betragFix,
    betragGewinn: ergebnis.betragGewinn,
    betragGesamt: ergebnis.betragGesamt,
    betragGebucht,
    schritte: [...ergebnis.schritte, { zeichen: "=", bezeichnung: "Abgrenzung (auf Cent, kaufmännisch)", wert: betragGebucht.toString() }],
  };
}
