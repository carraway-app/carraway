/** Obergrenze einer geplanten Reserve (Schutz vor Eingabefehlern, Beträge sind numeric(18,2)). */
export const MAX_RESERVE = 1_000_000_000_000;

/** Sucht in der Ursachenkette (Drizzle verpackt den Treiberfehler) nach einem Postgres-Fehlercode. */
export function hatPostgresCode(fehler: unknown, code: string): boolean {
  for (let e: unknown = fehler, tiefe = 0; e && tiefe < 5; tiefe++, e = (e as { cause?: unknown }).cause) {
    if ((e as { code?: unknown }).code === code) return true;
  }
  return false;
}
