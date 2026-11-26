/**
 * Harte Weiterleitung (neuer Seitenaufruf). Anwendung und Portal sind getrennte Einstiege mit eigenem Router: Zwischen ihnen
 * und zu den Anmeldeseiten führt nur ein neuer Aufruf, damit der richtige Einstieg lädt. Tests ersetzen die Funktion.
 */
let ziel: (url: string) => void = (url) => window.location.assign(url);

export const weiterleiten = (url: string): void => ziel(url);

/** Nur für Tests: ersetzt die Weiterleitung; `null` stellt die echte wieder her. */
export function setzeWeiterleitung(neu: ((url: string) => void) | null): void {
  ziel = neu ?? ((url) => window.location.assign(url));
}
