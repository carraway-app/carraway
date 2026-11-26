import type { Server } from "node:http";
import { serve } from "@hono/node-server";
import { erstelleDb } from "@carraway/db";
import { erstelleApp } from "./app";
import { LiveDienst } from "./live/dienst";
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
  const app = erstelleApp(db, { ...konfig, logger, pool, erweiterungen });
  const server = serve({ fetch: app.fetch, port }, (info) => {
    logger("info", "API gestartet", { port: info.port, umgebung: konfig.umgebung, weboberflaeche: konfig.webVerzeichnis !== undefined, metriken: konfig.metrikenToken !== undefined });
  });
  // Live-Aktualisierung über WebSocket (#161) unter `/api/v1/live`; Anmeldung und Rechte über die Route `GET /live` der App.
  const live = new LiveDienst({ db, pool, app, logger });
  live.haengeAn(server as Server);

  const beenden = () => {
    logger("info", "API beendet sich");
    void live.beende();
    server.close(() => void pool.end());
    // Offene Verbindungen (Keep-Alive) halten `close` auf; nach der Frist wird hart beendet.
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.on("SIGINT", beenden);
  process.on("SIGTERM", beenden);
}
