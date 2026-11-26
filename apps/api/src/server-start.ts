import { serve } from "@hono/node-server";
import { erstelleDb } from "@carraway/db";
import { erstelleApp } from "./app";
import type { ApiErweiterung } from "./erweiterung";
import { loggerAusUmgebung } from "./beobachtung/protokoll";
import { datenbankUrl, ladeKonfiguration } from "./konfiguration";
import { verlangeMigrationsstandBeimStart } from "./migrationsstand";

/** Startet die API; Einstieg „Kern“ in `server.ts` (ohne Erweiterungen), „Voll“ in `ee/api/src/server.ts`. */
export async function starteServer(erweiterungen: readonly ApiErweiterung[] = []): Promise<void> {
  const logger = loggerAusUmgebung("api");
  const port = Number(process.env.PORT ?? 8787);

  const { db, pool } = erstelleDb(datenbankUrl());
  await verlangeMigrationsstandBeimStart(db, "api", logger);
  const konfig = ladeKonfiguration();
  const server = serve({ fetch: erstelleApp(db, { ...konfig, logger, pool, erweiterungen }).fetch, port }, (info) => {
    logger("info", "API gestartet", { port: info.port, umgebung: konfig.umgebung, weboberflaeche: konfig.webVerzeichnis !== undefined, metriken: konfig.metrikenToken !== undefined });
  });

  const beenden = () => {
    logger("info", "API beendet sich");
    server.close(() => void pool.end());
    // Offene Verbindungen (Keep-Alive) halten `close` auf; nach der Frist wird hart beendet.
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.on("SIGINT", beenden);
  process.on("SIGTERM", beenden);
}
