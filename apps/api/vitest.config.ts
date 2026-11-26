import { configDefaults, defineConfig } from "vitest/config";
import { testDbWorkerAnzahl } from "./src/__tests__/worker-db";

// `TEST_DB_WORKERS=<n>` gibt jedem Worker eine eigene, aus der migrierten Test-Datenbank geklonte Datenbank
// (src/__tests__/worker-db.ts). Dann laufen die Dateien parallel über die Worker, je Worker weiter nacheinander.
// Ohne die Variable bleibt alles wie bisher: eine Datenbank, Dateien strikt nacheinander.
const dbWorker = testDbWorkerAnzahl();
// Leistungstests messen Zeiten und taugen nicht für parallele Worker (sie scheitern an der Last der anderen). Mit Workern laufen
// sie nicht mit; `pnpm --filter @carraway/api test:leistung` führt sie seriell aus (Workflow volle-suite.yml).
const LEISTUNG = ["src/__tests__/crm-leistung.test.ts", "src/__tests__/import-leistung.test.ts", "src/__tests__/referenzdatensatz.test.ts"];

export default defineConfig({
  test: {
    globalSetup: ["./src/__tests__/global-setup.ts"],
    setupFiles: ["./src/__tests__/setup.ts"],
    exclude: dbWorker === null ? configDefaults.exclude : [...configDefaults.exclude, ...LEISTUNG],
    fileParallelism: dbWorker !== null,
    ...(dbWorker === null ? {} : { maxWorkers: dbWorker }),
    // Der Timeout fängt ein Hängen ab, er misst keine Geschwindigkeit; mit mehreren Workern teilen sich schwere Tests die Maschine.
    testTimeout: dbWorker === null ? 30_000 : 60_000,
    hookTimeout: dbWorker === null ? 30_000 : 60_000,
  },
});
