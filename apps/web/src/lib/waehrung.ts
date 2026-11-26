/**
 * Währungssicht in der Adresse (Etappe 21): `?sicht=lokal|vergleich` und `?vergleich=USD`. Ohne Angabe gilt die Fondswährung (die Sicht „Fonds“), die Seite zeigt dann
 * genau die Zahlen der Kennzahlen. Die gewählte Sicht steht in der Adresse, damit ein Link dieselbe Sicht zeigt.
 */

export type Sicht = "lokal" | "fonds" | "vergleich";
export interface WaehrungSuche {
  sicht?: "lokal" | "vergleich";
  vergleich?: string;
}

/** Prüft `sicht` und `vergleich` aus der Adresse (für `validateSearch`); Unbekanntes entfällt. */
export function waehrungSuche(suche: Record<string, unknown>): WaehrungSuche {
  const sicht = suche.sicht === "lokal" || suche.sicht === "vergleich" ? suche.sicht : undefined;
  const vergleich = typeof suche.vergleich === "string" && /^[A-Z]{3}$/.test(suche.vergleich) ? suche.vergleich : undefined;
  return { ...(sicht ? { sicht } : {}), ...(vergleich ? { vergleich } : {}) };
}

export interface Waehrungen {
  fonds: string;
  lokal: string;
  vergleich: string | null;
}

/** Betrag der gewählten Sicht und seine Währung; `wert: null` ist eine Lücke (Kurs fehlt). */
export function betragDerSicht(b: { fonds: string; lokal: string | null; vergleich: string | null }, sicht: Sicht, w: Waehrungen): { wert: string | null; waehrung: string } {
  if (sicht === "lokal") return { wert: b.lokal, waehrung: w.lokal };
  if (sicht === "vergleich") return { wert: b.vergleich, waehrung: w.vergleich ?? w.fonds };
  return { wert: b.fonds, waehrung: w.fonds };
}

/** Die Sicht, die die Adresse meint: „Vergleich“ nur mit gewählter Vergleichswährung. */
export const sichtAusSuche = (s: WaehrungSuche): Sicht => (s.sicht === "vergleich" && s.vergleich ? "vergleich" : s.sicht === "lokal" ? "lokal" : "fonds");
