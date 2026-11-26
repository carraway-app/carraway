/**
 * Prüft eine vom Nutzer eingegebene Adresse, bevor sie als Link ausgegeben wird.
 * Nur absolute http- und https-Adressen gelten als sicher; alles andere (`javascript:`, `data:`, relative
 * Angaben, Text) liefert `null`. Zurückgegeben wird die geparste Adresse, nicht die rohe Eingabe.
 */
export function sichereUrl(roh: string | null | undefined): string | null {
  if (typeof roh !== "string") return null;
  try {
    const url = new URL(roh.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}
