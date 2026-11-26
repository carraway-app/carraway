import { starteServer } from "./server-start";

// Einstieg „Kern“ der API (ohne Erweiterungen); der Einstieg „Voll“ liegt in `ee/api/src/server.ts`.
await starteServer();
