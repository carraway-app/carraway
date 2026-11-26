import { Decimal } from "./decimal.js";
import type { MitHerkunft, Rechenschritt } from "./herkunft.js";
import { aufCent } from "./zins.js";

/**
 * Übertragung von Anteilen zwischen Gesellschaftern (Secondary). Es entstehen keine neuen Anteile: Die Gesamtzahl bleibt, ein Bestand (Quelle) gibt
 * Anteile an einen neuen Bestand (Zugang) ab. Regeln:
 *
 * - Die übertragenen Anteile behalten Klasse und Runde der Quelle (das setzt der Aufrufer) und nehmen ihre **Präferenzbasis** anteilig mit:
 *   investiert des Zugangs = investiert der Quelle × übertragene ÷ gehaltene Anteile, auf Cent (kaufmännisch); bei der ganzen Quelle genau deren
 *   investiert. Die Quelle behält den Rest, die Summe bleibt auf den Cent gleich. Der Kaufpreis zwischen den Gesellschaftern ändert die
 *   Präferenz nicht (er fließt nicht an das Unternehmen).
 * - **Kaufpreis** = Anzahl × Preis je Anteil, auf Cent (kaufmännisch).
 * - Übertragungen werden in der gegebenen Reihenfolge angewandt (Datum, dann Erfassung); ein Zugang kann Quelle einer späteren Übertragung sein.
 *   Fehlt die Quelle oder hält sie weniger Anteile, als übertragen werden, wird die Übertragung nicht angewandt und als Fehler gemeldet.
 */

export interface Anteilsbestand {
  id: string;
  anteile: Decimal.Value;
  investiert: Decimal.Value;
}

export interface Anteilsuebertragung {
  id: string;
  /** Id des abgebenden Bestands. */
  quelleId: string;
  /** Id des neuen Bestands (Zugang). */
  zielId: string;
  anzahl: Decimal.Value;
}

export interface UebertragungErgebnis {
  /** Die Bestände nach allen Übertragungen (in der Reihenfolge der Eingabe), ohne die Zugänge. */
  bestaende: { id: string; anteile: Decimal; investiert: Decimal }[];
  /** Je angewandter Übertragung ein Zugang. */
  /** Je angewandter Übertragung ein Zugang mit den Rechenschritten der mitgenommenen Präferenzbasis (Herkunft). */
  zugaenge: { id: string; uebertragungId: string; quelleId: string; anteile: Decimal; investiert: Decimal; schritte: Rechenschritt[] }[];
  fehler: { uebertragungId: string; grund: "quelle_fehlt" | "zu_viele_anteile"; verfuegbar: Decimal }[];
}

/** Kaufpreis einer Übertragung: Anzahl × Preis je Anteil, auf Cent. */
export function uebertragungKaufpreis(anzahl: Decimal.Value, preisJeAnteil: Decimal.Value): MitHerkunft<Decimal> {
  const n = new Decimal(anzahl);
  const preis = new Decimal(preisJeAnteil);
  if (!n.isInteger() || !n.greaterThan(0)) throw new Error("Die Zahl der übertragenen Anteile muss eine ganze Zahl größer als null sein");
  if (preis.isNegative()) throw new Error("Der Preis je Anteil darf nicht negativ sein");
  const wert = aufCent(n.times(preis));
  return {
    wert,
    schritte: [
      { zeichen: "", bezeichnung: "Übertragene Anteile", wert: n.toString() },
      { zeichen: "×", bezeichnung: "Preis je Anteil", wert: preis.toString() },
      { zeichen: "=", bezeichnung: "Kaufpreis (auf Cent, kaufmännisch)", wert: wert.toString() },
    ],
  };
}

/** Wendet die Übertragungen nacheinander auf die Bestände an. */
export function wendeUebertragungenAn(bestaende: readonly Anteilsbestand[], uebertragungen: readonly Anteilsuebertragung[]): MitHerkunft<UebertragungErgebnis> {
  const stand = new Map<string, { anteile: Decimal; investiert: Decimal }>();
  for (const b of bestaende) stand.set(b.id, { anteile: new Decimal(b.anteile), investiert: new Decimal(b.investiert) });
  const zugaenge: UebertragungErgebnis["zugaenge"] = [];
  const fehler: UebertragungErgebnis["fehler"] = [];
  const schritte: Rechenschritt[] = [];
  for (const u of uebertragungen) {
    const n = new Decimal(u.anzahl);
    const q = stand.get(u.quelleId);
    if (!q) {
      fehler.push({ uebertragungId: u.id, grund: "quelle_fehlt", verfuegbar: new Decimal(0) });
      continue;
    }
    if (n.greaterThan(q.anteile) || !n.greaterThan(0)) {
      fehler.push({ uebertragungId: u.id, grund: "zu_viele_anteile", verfuegbar: q.anteile });
      continue;
    }
    const investiert = n.equals(q.anteile) ? q.investiert : aufCent(q.investiert.times(n).div(q.anteile));
    const eigene: Rechenschritt[] = [
      { zeichen: "", bezeichnung: "Anteile der Quelle vor der Übertragung", wert: q.anteile.toString(), quellen: [u.quelleId] },
      { zeichen: "", bezeichnung: "Präferenzbasis (investiert) der Quelle", wert: q.investiert.toString(), quellen: [u.quelleId] },
      { zeichen: "×", bezeichnung: "Übertragene Anteile ÷ Anteile der Quelle", wert: n.div(q.anteile).toString(), quellen: [u.id] },
      { zeichen: "=", bezeichnung: "Mitgenommene Präferenzbasis (auf Cent)", wert: investiert.toString(), quellen: [u.id] },
    ];
    schritte.push(...eigene);
    q.anteile = q.anteile.minus(n);
    q.investiert = q.investiert.minus(investiert);
    stand.set(u.zielId, { anteile: n, investiert });
    zugaenge.push({ id: u.zielId, uebertragungId: u.id, quelleId: u.quelleId, anteile: n, investiert, schritte: eigene });
  }
  const zugangIds = new Set(zugaenge.map((z) => z.id));
  for (const z of zugaenge) {
    const s = stand.get(z.id)!;
    z.anteile = s.anteile;
    z.investiert = s.investiert;
  }
  return {
    wert: { bestaende: bestaende.filter((b) => !zugangIds.has(b.id)).map((b) => ({ id: b.id, ...stand.get(b.id)! })), zugaenge, fehler },
    schritte,
  };
}
