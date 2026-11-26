/** Offene Kaufpreisforderungen einer Beteiligungszeile. Ältere gespeicherte Stände (Snapshots) kennen das Feld nicht: dort gilt `"0.00"`. */
export function offeneForderungen(zeile: { offeneForderungen?: string | null | undefined }): string {
  return zeile.offeneForderungen ?? "0.00";
}
