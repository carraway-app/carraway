import { Decimal } from "./decimal.js";
import { tageZwischen, vergleiche, zerlege, type Datum } from "./datum.js";
import type { Rechenschritt } from "./herkunft.js";
import { kapitalabschnitte, kapitalverlauf, type Kapitalabschnitt, type Kapitalbewegung, type Kapitalverlauf } from "./kapitalverlauf.js";
import { zinsbetrag } from "./zins.js";
import type { Zinsmethode } from "./zinsmethoden.js";

/**
 * Gewinnabhängige Verzinsung (Vereinfachung, später konfigurierbar zu machen).
 *
 * Je Kalenderjahr `J`, das den Zinszeitraum schneidet, gilt:
 *
 *   Anteil_J   = Tage des Zeitraums in J (tatsächlich) / Tage des Jahres J (365 oder 366)
 *   Ø Kapital  = Σ (Kapital × Tage) / Tage, über die Abschnitte des Zeitraums in J (tatsächliche Tage)
 *   Gewinnzins = Anteil_J × min( satz × max(0, Jahresüberschuss_J), kappungSatz × Ø Kapital )
 *
 * Bei einem vollen Kalenderjahr ist der Anteil 1, also min(satz × Jahresüberschuss, kappungSatz × Ø Kapital).
 * Der Gewinnzins kommt zum festen Zins hinzu. Ein fehlender Jahresüberschuss ist ein Fehler, ein negativer zählt als 0.
 * Die Zinsmethode wirkt nur auf den festen Zins, der Gewinnzins rechnet mit tatsächlichen Tagen.
 */
export interface Gewinnabhaengigkeit {
  /** Anteil am Jahresüberschuss als Dezimalzahl, z. B. 0.10. */
  satz: Decimal.Value;
  /** Bemessungsgrundlage: Jahresüberschuss je Kalenderjahr. */
  bemessung: Readonly<Record<number, Decimal.Value>>;
  /** Obergrenze als Jahreszins auf das durchschnittliche Kapital, z. B. 0.08. */
  kappungSatz: Decimal.Value;
}

export interface Zinsbedingungen {
  /** Fester Jahreszins als Dezimalzahl. */
  satzFix: Decimal.Value;
  methode: Zinsmethode;
  gewinnabhaengig?: Gewinnabhaengigkeit;
}

export interface Zinssegment extends Kapitalabschnitt {
  kalendertage: number;
  betrag: Decimal;
  schritte: Rechenschritt[];
}

export interface Gewinnzeile {
  jahr: number;
  von: Datum;
  bis: Datum;
  durchschnittskapital: Decimal;
  jahresueberschuss: Decimal;
  ungekappt: Decimal;
  kappung: Decimal;
  anteilJahr: Decimal;
  betrag: Decimal;
  schritte: Rechenschritt[];
}

export interface Zinsergebnis {
  segmente: Zinssegment[];
  gewinnzeilen: Gewinnzeile[];
  betragFix: Decimal;
  betragGewinn: Decimal;
  /** Fest plus Gewinn, ungerundet. */
  betragGesamt: Decimal;
  schritte: Rechenschritt[];
}

/** Zinsen zwischen zwei Daten (`von` einschließlich, `bis` ausschließlich) über ein wechselndes Kapital. */
export function zinsenImZeitraum(
  bewegungen: readonly Kapitalbewegung[],
  von: Datum,
  bis: Datum,
  bedingungen: Zinsbedingungen,
): Zinsergebnis {
  return zinsenAufVerlauf(kapitalverlauf(bewegungen).wert, von, bis, bedingungen);
}

export function zinsenAufVerlauf(verlauf: Kapitalverlauf, von: Datum, bis: Datum, bedingungen: Zinsbedingungen): Zinsergebnis {
  const abschnitte = kapitalabschnitte(verlauf, von, bis);
  const satzFix = new Decimal(bedingungen.satzFix);
  const schritte: Rechenschritt[] = [];

  const segmente: Zinssegment[] = abschnitte.map((a) => {
    const z = zinsbetrag({ kapital: a.kapital, satz: satzFix, von: a.von, bis: a.bis, methode: bedingungen.methode });
    schritte.push({ zeichen: "+", bezeichnung: `Fester Zins ${a.von} bis ${a.bis} auf ${a.kapital.toString()}`, wert: z.wert.toString() });
    return { ...a, kalendertage: tageZwischen(a.von, a.bis), betrag: z.wert, schritte: z.schritte };
  });
  const betragFix = segmente.reduce((s, x) => s.plus(x.betrag), new Decimal(0));
  schritte.push({ zeichen: "=", bezeichnung: "Fester Zins", wert: betragFix.toString() });

  const gewinnzeilen = bedingungen.gewinnabhaengig ? gewinnzeilenBerechnen(verlauf, von, bis, bedingungen.gewinnabhaengig) : [];
  for (const z of gewinnzeilen) {
    schritte.push({ zeichen: "+", bezeichnung: `Gewinnabhängiger Zins ${z.jahr} (${z.von} bis ${z.bis})`, wert: z.betrag.toString() });
  }
  const betragGewinn = gewinnzeilen.reduce((s, x) => s.plus(x.betrag), new Decimal(0));
  const betragGesamt = betragFix.plus(betragGewinn);
  schritte.push({ zeichen: "=", bezeichnung: "Zinsen gesamt", wert: betragGesamt.toString() });

  return { segmente, gewinnzeilen, betragFix, betragGewinn, betragGesamt, schritte };
}

function gewinnzeilenBerechnen(verlauf: Kapitalverlauf, von: Datum, bis: Datum, g: Gewinnabhaengigkeit): Gewinnzeile[] {
  const satz = new Decimal(g.satz);
  const kappungSatz = new Decimal(g.kappungSatz);
  const zeilen: Gewinnzeile[] = [];
  for (let jahr = zerlege(von).jahr; vergleiche(`${jahr}-01-01`, bis) < 0; jahr++) {
    const jahresanfang = `${jahr}-01-01`;
    const jahresende = `${jahr + 1}-01-01`;
    const a = vergleiche(von, jahresanfang) > 0 ? von : jahresanfang;
    const b = vergleiche(bis, jahresende) < 0 ? bis : jahresende;
    const tage = tageZwischen(a, b);
    if (tage === 0) continue;

    const roh = g.bemessung[jahr];
    if (roh === undefined) throw new Error(`Jahresüberschuss für ${jahr} fehlt (gewinnabhängiger Zins)`);
    const ueberschuss = new Decimal(roh);

    const kapitalTage = kapitalabschnitte(verlauf, a, b).reduce(
      (s, x) => s.plus(x.kapital.times(tageZwischen(x.von, x.bis))),
      new Decimal(0),
    );
    const durchschnitt = kapitalTage.div(tage);
    const anteilJahr = new Decimal(tage).div(tageZwischen(jahresanfang, jahresende));
    const ungekappt = satz.times(Decimal.max(0, ueberschuss));
    const kappung = kappungSatz.times(durchschnitt);
    const betrag = anteilJahr.times(Decimal.min(ungekappt, kappung));

    zeilen.push({
      jahr,
      von: a,
      bis: b,
      durchschnittskapital: durchschnitt,
      jahresueberschuss: ueberschuss,
      ungekappt,
      kappung,
      anteilJahr,
      betrag,
      schritte: [
        { zeichen: "", bezeichnung: `Jahresüberschuss ${jahr}`, wert: ueberschuss.toString() },
        { zeichen: "×", bezeichnung: "Gewinnsatz", wert: satz.toString() },
        { zeichen: "=", bezeichnung: "Gewinnanteil vor Kappung", wert: ungekappt.toString() },
        { zeichen: "", bezeichnung: `Durchschnittliches Kapital ${a} bis ${b}`, wert: durchschnitt.toString() },
        { zeichen: "×", bezeichnung: "Kappungssatz", wert: kappungSatz.toString() },
        { zeichen: "=", bezeichnung: "Kappungsgrenze", wert: kappung.toString() },
        { zeichen: "×", bezeichnung: `Anteil am Jahr (${tage} / ${tageZwischen(jahresanfang, jahresende)})`, wert: anteilJahr.toString() },
        { zeichen: "=", bezeichnung: "Gewinnabhängiger Zins (kleinerer Wert × Anteil)", wert: betrag.toString() },
      ],
    });
  }
  return zeilen;
}
