import { ApiFehler } from "../api/client";
import { aufzaehlung, type Texte } from "./index";

/** Übersetzte Meldung zu einem Fehler der API oder der Verbindung; Unbekanntes fällt auf die allgemeine Meldung zurück. */
export function fehlerText(t: Texte, fehler: unknown): string {
  const code = fehler instanceof ApiFehler ? fehler.code : "UNBEKANNT";
  const text = aufzaehlung(t.fehler, code);
  return text === code ? t.fehler.unbekannt : text;
}

/** Meldung zu einem Eingabefeld, falls die API (400) dazu einen Fehler gemeldet hat. `feld` ist der Name aus der API (`organisation.name`). */
export function feldText(t: Texte, fehler: unknown, feld: string): string | undefined {
  if (!(fehler instanceof ApiFehler)) return undefined;
  const treffer = fehler.felder.find((f) => f.feld === feld);
  return treffer ? feldCodeText(t, treffer.code) : undefined;
}

/** Text zum Prüfschritt eines Feldfehlers (`too_small` …); unbekannte Schritte bekommen die allgemeine Meldung. */
export function feldCodeText(t: Texte, code: string): string {
  const text = aufzaehlung(t.feldfehler, code);
  return text === code ? t.feldfehler.unbekannt : text;
}
