import { Decimal } from "./decimal.js";
import type { Rechenschritt } from "./herkunft.js";

/**
 * Reserven für Folgeinvestitionen (Etappe 18) als reine Rechnung. Die Datenbank liefert nur die Eingaben (Zeichnungskapital, Abrufe,
 * investiertes Kapital, geplante und verbrauchte Reserve je Beteiligung, Gebührenprognose); die Formel steht hier und wird von einer
 * zweiten, unabhängigen Rechnung mit Brüchen (`referenz/referenz_reserven.py`) geprüft.
 *
 *   offen je Beteiligung  = max(0, geplant − verbraucht); nur aktive Beteiligungen binden ihre offene Reserve
 *   belegt                = max(abgerufen, investiert)
 *   verfügbar             = Zeichnungskapital − belegt − Summe der gebundenen offenen Reserven − Gebührenprognose
 *
 * Beträge sind Zeichenketten mit Dezimalpunkt; die Ausgabe ist auf Cent gerundet (kaufmännisch), die Rechenschritte tragen die ungerundeten Werte.
 */

export interface ReserveEingabe {
  beteiligungId: string;
  /** Status der Beteiligung; nur `aktiv` bindet die offene Reserve. */
  status: string;
  geplant: string;
  /** Auszahlungen seit Beginn der Planung bis zum Stichtag. */
  verbraucht: string;
}

export interface ReservenEingabe {
  zeichnungskapital: string;
  abgerufen: string;
  /** Investiertes Kapital des Fonds (Summe der Beteiligungen). */
  investiert: string;
  reserven: ReserveEingabe[];
  gebuehrenPrognose: string;
}

export interface ReserveErgebnis {
  beteiligungId: string;
  geplant: string;
  verbraucht: string;
  /** Gebundene offene Reserve (0 bei einer Beteiligung, die nicht mehr aktiv ist). */
  offen: string;
}

export interface ReservenErgebnis {
  zeilen: ReserveErgebnis[];
  summeGeplant: string;
  summeOffen: string;
  belegt: string;
  gebuehrenPrognose: string;
  verfuegbar: string;
  schritte: Rechenschritt[];
}

export function berechneReserven(e: ReservenEingabe): ReservenErgebnis {
  const zeichnung = new Decimal(e.zeichnungskapital);
  const gebuehren = new Decimal(e.gebuehrenPrognose);
  let geplantSumme = new Decimal(0);
  let offenSumme = new Decimal(0);
  const zeilen: ReserveErgebnis[] = e.reserven.map((r) => {
    const verbraucht = new Decimal(r.verbraucht);
    const offen = Decimal.max(0, new Decimal(r.geplant).minus(verbraucht));
    const bindet = r.status === "aktiv" ? offen : new Decimal(0);
    geplantSumme = geplantSumme.plus(r.geplant);
    offenSumme = offenSumme.plus(bindet);
    return { beteiligungId: r.beteiligungId, geplant: new Decimal(r.geplant).toFixed(2), verbraucht: verbraucht.toFixed(2), offen: bindet.toFixed(2) };
  });
  const belegt = Decimal.max(new Decimal(e.abgerufen), new Decimal(e.investiert));
  const verfuegbar = zeichnung.minus(belegt).minus(offenSumme).minus(gebuehren);
  return {
    zeilen,
    summeGeplant: geplantSumme.toFixed(2),
    summeOffen: offenSumme.toFixed(2),
    belegt: belegt.toFixed(2),
    gebuehrenPrognose: gebuehren.toFixed(2),
    verfuegbar: verfuegbar.toFixed(2),
    schritte: [
      { zeichen: "", bezeichnung: "Zeichnungskapital", wert: zeichnung.toString() },
      { zeichen: "−", bezeichnung: "Belegt (das Größere aus abgerufen und investiert)", wert: belegt.toString() },
      { zeichen: "−", bezeichnung: "Offene Reserven der aktiven Beteiligungen", wert: offenSumme.toString() },
      { zeichen: "−", bezeichnung: "Gebührenprognose des Szenarios", wert: gebuehren.toString() },
      { zeichen: "=", bezeichnung: "Verfügbar für Neuinvestments", wert: verfuegbar.toString() },
    ],
  };
}
