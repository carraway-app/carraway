/**
 * Gemeinsame Konstanten von API und Seed-Skript für die Anmeldung.
 *
 * Das lokale Entwicklungsgeheimnis gilt nur, solange `CARRAWAY_UMGEBUNG` nicht `echt` ist und `BETTER_AUTH_SECRET`
 * fehlt. Es ist öffentlich und schützt nichts: Es sorgt dafür, dass die TOTP-Geheimnisse der Demo-Zugänge
 * (`demo-zugaenge.md`) mit dem lokalen Server zusammenpassen, weil Better Auth sie mit diesem Geheimnis verschlüsselt.
 */
export const LOKALES_ENTWICKLUNGSGEHEIMNIS = "carraway-nur-lokale-entwicklung-nicht-geheim-0123456789";

/** Das Seed-Skript überschreibt Daten und legt Zugänge mit bekannten Passwörtern an; im Echtbestand ist das verboten. */
export function pruefeSeedErlaubt(umgebung: string | undefined): void {
  if (umgebung === "echt") {
    throw new Error("Seed abgelehnt: CARRAWAY_UMGEBUNG=echt. Demo-Daten und Demo-Zugänge gehören nie in den Echtbestand.");
  }
}
