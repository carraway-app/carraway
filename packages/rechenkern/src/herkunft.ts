/**
 * Herkunft einer berechneten Zahl: die Rechenschritte in Lesereihenfolge.
 * Jeder Schritt nennt eine Bezeichnung, den Wert als Zeichenkette (exakt, ungerundet)
 * und das Rechenzeichen, mit dem er in das Ergebnis eingeht.
 */
export type Rechenzeichen = "" | "+" | "−" | "×" | "÷" | "=";

export interface Rechenschritt {
  zeichen: Rechenzeichen;
  bezeichnung: string;
  wert: string;
  /** Optional: Verweise auf Datensätze (z. B. Vorgangs-IDs), aus denen der Wert stammt. */
  quellen?: string[];
}

export interface MitHerkunft<T> {
  wert: T;
  schritte: Rechenschritt[];
}
