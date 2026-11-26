import { starteWorker } from "./worker-start";

// Einstieg „Kern“ des Workers (ohne Erweiterungen); der Einstieg „Voll“ liegt in `ee/api/src/worker.ts`.
await starteWorker();
