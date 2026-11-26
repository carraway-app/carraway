import { Decimal } from "./decimal.js";
import { tageZwischen, type Datum } from "./datum.js";

/**
 * Wechselkurse und Umrechnung (Etappe 21) als reine Rechnung. Die Datenbank liefert nur die Kurse; die Regeln stehen hier und gleichlautend in
 * `referenz/referenz_waehrung.py` (unabhängige Rechnung mit Brüchen):
 *
 * - **Kurs:** `kurs` = Einheiten `quote` je 1 Einheit `basis` (Stil der EZB-Referenzkurse: Basis EUR). Ein Eintrag gilt in beide Richtungen.
 * - **Wahl:** der jüngste Eintrag mit Datum ≤ Stichtag, bei Gleichstand direkt vor invers. Ist er älter als `maxAlterTage`, fehlt der Kurs: eine **Lücke**,
 *   nie ein geschätzter oder alter Wert.
 * - **Weg:** gleiche Währung = Faktor 1; sonst Eintrag direkt oder umgekehrt; sonst über EUR (zwei Einträge); sonst Lücke.
 * - **Umrechnung:** Betrag × Faktor, erst das Ergebnis wird auf Cent gerundet (kaufmännisch, halb weg von null), nie ein Zwischenschritt. Der Faktor bleibt
 *   als Bruch aus Zähler und Nenner (kein gerundeter Kehrwert).
 * - **Zerlegung:** Die Änderung des Fondswerts einer Beteiligung ist Wertänderung (lokale Änderung zum neuen Kurs) plus Währungseffekt (alter lokaler Wert ×
 *   Kursänderung); der Währungseffekt ist der Rest zur gerundeten Gesamtänderung, damit beide Teile genau die Gesamtänderung ergeben.
 * - **Lücken in Summen:** Fehlt ein Posten, hat die Summe keinen Wert (`null`), sie wird nie aus den vorhandenen Posten gebildet.
 */

export const WAEHRUNGSCODE = /^[A-Z]{3}$/;

/** Höchstalter eines Kurses in Tagen (Wochenenden und Feiertage überbrückt; älter gilt als fehlend). */
export const MAX_KURSALTER_TAGE = 7;

export interface Wechselkurs {
  datum: Datum;
  basis: string;
  quote: string;
  /** Dezimalzahl als Zeichenkette: Einheiten `quote` je 1 Einheit `basis`. */
  kurs: string;
}

export type Kursweg = "gleich" | "direkt" | "invers" | "ueber_eur";

/** Ein verwendeter Eintrag (Beleg für die Anzeige „Kurs und Datum“). */
export interface Stuetzstelle {
  datum: Datum;
  basis: string;
  quote: string;
  kurs: string;
  richtung: "direkt" | "invers";
}

export interface Umrechnungsfaktor {
  von: string;
  nach: string;
  /** Faktor = zaehler ÷ nenner. */
  zaehler: Decimal;
  nenner: Decimal;
  weg: Kursweg;
  /** Datum des ältesten verwendeten Eintrags (bei gleicher Währung der Stichtag). */
  kursDatum: Datum;
  stuetzstellen: Stuetzstelle[];
}

export type KursLueckenGrund = "kein_kurs" | "veraltet";

export interface Kursluecke {
  von: string;
  nach: string;
  stichtag: Datum;
  grund: KursLueckenGrund;
  /** Jüngster Eintrag bis zum Stichtag, falls es einen gibt (bei `veraltet`). */
  letzterKursDatum: Datum | null;
}

export type Kursauswahl = { ok: true; faktor: Umrechnungsfaktor } | { ok: false; luecke: Kursluecke };

interface Kante {
  datum: Datum;
  zaehler: Decimal;
  nenner: Decimal;
  stuetz: Stuetzstelle;
}

/** Die beste Kante `von` → `nach` (direkt oder umgekehrt) bis zum Stichtag, oder eine Lücke. */
function besteKante(kurse: readonly Wechselkurs[], von: string, nach: string, stichtag: Datum, maxAlter: number): { kante: Kante } | { luecke: Kursluecke } {
  let beste: (Kante & { rang: number }) | null = null;
  for (const k of kurse) {
    if (k.datum > stichtag) continue;
    let kandidat: (Kante & { rang: number }) | null = null;
    if (k.basis === von && k.quote === nach) {
      kandidat = { datum: k.datum, zaehler: new Decimal(k.kurs), nenner: new Decimal(1), stuetz: { ...k, richtung: "direkt" }, rang: 1 };
    } else if (k.basis === nach && k.quote === von) {
      kandidat = { datum: k.datum, zaehler: new Decimal(1), nenner: new Decimal(k.kurs), stuetz: { ...k, richtung: "invers" }, rang: 0 };
    }
    if (!kandidat) continue;
    if (!beste || kandidat.datum > beste.datum || (kandidat.datum === beste.datum && kandidat.rang > beste.rang)) beste = kandidat;
  }
  if (!beste) return { luecke: { von, nach, stichtag, grund: "kein_kurs", letzterKursDatum: null } };
  if (tageZwischen(beste.datum, stichtag) > maxAlter) return { luecke: { von, nach, stichtag, grund: "veraltet", letzterKursDatum: beste.datum } };
  return { kante: beste };
}

/** Wählt den Weg und den Faktor von `von` nach `nach` für einen Stichtag. */
export function waehleKurs(kurse: readonly Wechselkurs[], von: string, nach: string, stichtag: Datum, maxAlterTage: number = MAX_KURSALTER_TAGE): Kursauswahl {
  if (von === nach) return { ok: true, faktor: { von, nach, zaehler: new Decimal(1), nenner: new Decimal(1), weg: "gleich", kursDatum: stichtag, stuetzstellen: [] } };
  const direkt = besteKante(kurse, von, nach, stichtag, maxAlterTage);
  if ("kante" in direkt) {
    const k = direkt.kante;
    return { ok: true, faktor: { von, nach, zaehler: k.zaehler, nenner: k.nenner, weg: k.stuetz.richtung, kursDatum: k.datum, stuetzstellen: [k.stuetz] } };
  }
  if (von !== "EUR" && nach !== "EUR") {
    const a = besteKante(kurse, von, "EUR", stichtag, maxAlterTage);
    const b = besteKante(kurse, "EUR", nach, stichtag, maxAlterTage);
    if ("kante" in a && "kante" in b) {
      return {
        ok: true,
        faktor: {
          von,
          nach,
          zaehler: a.kante.zaehler.times(b.kante.zaehler),
          nenner: a.kante.nenner.times(b.kante.nenner),
          weg: "ueber_eur",
          kursDatum: a.kante.datum < b.kante.datum ? a.kante.datum : b.kante.datum,
          stuetzstellen: [a.kante.stuetz, b.kante.stuetz],
        },
      };
    }
  }
  return { ok: false, luecke: direkt.luecke };
}

/** Betrag in der Zielwährung, auf Cent gerundet (kaufmännisch). */
export function konvertiere(betrag: Decimal.Value, faktor: Pick<Umrechnungsfaktor, "zaehler" | "nenner">): Decimal {
  return new Decimal(betrag).times(faktor.zaehler).div(faktor.nenner).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** Der Faktor als Dezimalzahl mit höchstens `stellen` Nachkommastellen (nur für die Anzeige und für den festgehaltenen Kurs eines Postens). */
export function faktorAlsZahl(faktor: Pick<Umrechnungsfaktor, "zaehler" | "nenner">, stellen = 12): string {
  return faktor.zaehler.div(faktor.nenner).toDecimalPlaces(stellen, Decimal.ROUND_HALF_UP).toFixed();
}

/** Zerlegung der Änderung des Fondswerts (siehe Kopf). Kurse in Fondswährung je lokaler Einheit. */
export interface FxZerlegung {
  fondsAlt: string;
  fondsNeu: string;
  gesamt: string;
  wert: string;
  waehrung: string;
}

export function zerlegeFxEffekt(e: { wertAltLokal: Decimal.Value; wertNeuLokal: Decimal.Value; kursAlt: Decimal.Value; kursNeu: Decimal.Value }): FxZerlegung {
  const cent = (x: Decimal.Value) => new Decimal(x).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const fondsAlt = cent(new Decimal(e.wertAltLokal).times(e.kursAlt));
  const fondsNeu = cent(new Decimal(e.wertNeuLokal).times(e.kursNeu));
  const gesamt = fondsNeu.minus(fondsAlt);
  const wert = cent(new Decimal(e.wertNeuLokal).minus(e.wertAltLokal).times(e.kursNeu));
  return { fondsAlt: fondsAlt.toFixed(2), fondsNeu: fondsNeu.toFixed(2), gesamt: gesamt.toFixed(2), wert: wert.toFixed(2), waehrung: gesamt.minus(wert).toFixed(2) };
}

/** Summe mit Lücken: fehlt ein Posten (`null`), hat die Summe keinen Wert. */
export function summeMitLuecken(posten: readonly (Decimal.Value | null)[]): Decimal | null {
  let summe = new Decimal(0);
  for (const p of posten) {
    if (p === null) return null;
    summe = summe.plus(p);
  }
  return summe;
}

// Sichten auf einen Posten -----------------------------------------------------------------------------------------------

export interface SichtKontext {
  fondsWaehrung: string;
  lokalWaehrung: string;
  /** Vergleichswährung der Ansicht; `null` = keine gewählt. */
  vergleichsWaehrung: string | null;
  kurse: readonly Wechselkurs[];
  maxAlterTage?: number;
}

export interface SichtPosten {
  /** Tag, dessen Kurs gilt: bei Kosten die Valuta der Zahlung, bei einem Zeitwert der Bewertungsstichtag. */
  datum: Datum;
  /** Betrag in der Fondswährung, wie gebucht. */
  fonds: Decimal.Value;
  /** Gebuchter Betrag in der lokalen Währung, falls erfasst. */
  lokal: Decimal.Value | null;
}

export interface SichtErgebnis {
  fonds: Decimal;
  /** `null` = Lücke (kein Kurs und kein gebuchter lokaler Betrag). */
  lokal: Decimal | null;
  vergleich: Decimal | null;
  /** Verwendete Kurse (ohne gleiche Währung und ohne gebuchte Beträge). */
  faktoren: Umrechnungsfaktor[];
  luecken: Kursluecke[];
}

/**
 * Ein Posten in den drei Sichten. Fonds: der gebuchte Betrag. Lokal: der gebuchte lokale Betrag, sonst bei anderer lokaler Währung die Umrechnung aus der
 * Fondswährung zum Kurs des Tages (Lücke ohne Kurs), bei gleicher Währung der Fondsbetrag. Vergleich: gleiche Währung wie Fonds oder lokal = diese Sicht, sonst die
 * Umrechnung des Fondsbetrags zum Kurs des Tages (Lücke ohne Kurs).
 */
export function sichtenFuerPosten(posten: SichtPosten, k: SichtKontext): SichtErgebnis {
  const fonds = new Decimal(posten.fonds);
  const faktoren: Umrechnungsfaktor[] = [];
  const luecken: Kursluecke[] = [];
  const aus = (nach: string): Decimal | null => {
    const w = waehleKurs(k.kurse, k.fondsWaehrung, nach, posten.datum, k.maxAlterTage ?? MAX_KURSALTER_TAGE);
    if (!w.ok) {
      luecken.push(w.luecke);
      return null;
    }
    if (w.faktor.weg !== "gleich") faktoren.push(w.faktor);
    return konvertiere(fonds, w.faktor);
  };
  let lokal: Decimal | null;
  if (posten.lokal !== null) lokal = new Decimal(posten.lokal);
  else if (k.lokalWaehrung === k.fondsWaehrung) lokal = fonds;
  else lokal = aus(k.lokalWaehrung);
  let vergleich: Decimal | null = null;
  if (k.vergleichsWaehrung !== null) {
    if (k.vergleichsWaehrung === k.fondsWaehrung) vergleich = fonds;
    else if (k.vergleichsWaehrung === k.lokalWaehrung && lokal !== null) vergleich = lokal;
    else vergleich = aus(k.vergleichsWaehrung);
  }
  return { fonds, lokal, vergleich, faktoren, luecken };
}
