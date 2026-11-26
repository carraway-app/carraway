/**
 * Setup-Datei jedes Workers (vitest.config.ts, `setupFiles`). Läuft vor dem Laden der Testdateien. Mit `TEST_DB_WORKERS` richtet sie
 * `DATABASE_URL_TEST` auf den Klon dieses Workers, bevor `hilfen.ts` die Adresse einliest.
 */
import { datenbankNameAusUrl, testDatenbankUrl } from "@carraway/db/schutz";
import { mitDatenbank, testDbWorkerAnzahl, workerDbName } from "./worker-db";

const anzahl = testDbWorkerAnzahl();
if (anzahl !== null) {
  const poolId = Number(process.env.VITEST_POOL_ID);
  if (!Number.isInteger(poolId) || poolId < 1 || poolId > anzahl) {
    throw new Error(`VITEST_POOL_ID "${process.env.VITEST_POOL_ID}" liegt außerhalb von 1..${anzahl} (TEST_DB_WORKERS).`);
  }
  const url = testDatenbankUrl();
  process.env.DATABASE_URL_TEST = mitDatenbank(url, workerDbName(datenbankNameAusUrl(url), poolId));
}
