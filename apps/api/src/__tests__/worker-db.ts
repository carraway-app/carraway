/**
 * Eine Datenbank je Vitest-Worker (nur mit `TEST_DB_WORKERS=<n>`).
 *
 * Ohne die Variable teilen sich alle Testdateien eine Datenbank und laufen deshalb nacheinander (`fileParallelism: false`,
 * die Tests leeren Tabellen). Mit ihr legt `global-setup.ts` je Worker einen Klon der migrierten Test-Datenbank an
 * (`CREATE DATABASE … TEMPLATE`), und `setup.ts` richtet jeden Worker über `VITEST_POOL_ID` auf seinen Klon. Innerhalb eines
 * Workers laufen die Dateien weiter nacheinander; die Gründe für den seriellen Standard gelten also je Worker, nie dateiübergreifend.
 */

/** Anzahl der Worker aus `TEST_DB_WORKERS`, oder `null` ohne die Variable (seriell, eine gemeinsame Datenbank). */
export function testDbWorkerAnzahl(env: Record<string, string | undefined> = process.env): number | null {
  const roh = env.TEST_DB_WORKERS;
  if (roh === undefined || roh === "") return null;
  const anzahl = Number(roh);
  if (!Number.isInteger(anzahl) || anzahl < 1 || anzahl > 32) {
    throw new Error(`TEST_DB_WORKERS muss eine ganze Zahl von 1 bis 32 sein, gefunden: "${roh}".`);
  }
  return anzahl;
}

/** Name des Klons von `basis` für Worker `poolId`. */
export function workerDbName(basis: string, poolId: number): string {
  return `${basis}_w${poolId}`;
}

/** Verbindungsadresse mit anderem Datenbanknamen. */
export function mitDatenbank(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${encodeURIComponent(name)}`;
  return u.toString();
}
