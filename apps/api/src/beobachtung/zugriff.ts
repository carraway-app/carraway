import { randomUUID } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { routePath } from "hono/route";
import type { Metriken } from "./metriken";
import type { Logger } from "./protokoll";

/**
 * Eine Zeile je Anfrage und die Dauer in den Metriken. Die Anfrage-ID kommt aus `X-Request-Id`, wenn sie unauffällig
 * aussieht (ein Reverse-Proxy vergibt sie gern), sonst wird eine neue erzeugt; sie steht auch in der Antwort.
 * Geloggt werden Methode, Routenmuster (nie der echte Pfad mit IDs, nie die Abfragezeichenfolge), Status, Dauer und die
 * Benutzer-ID. Kein Körper, keine Kopfzeilen, keine IP.
 */

declare module "hono" {
  interface ContextVariableMap {
    anfrageId?: string;
    /** Handler dürfen das Routenmuster für Log und Metriken selbst benennen (z. B. `statisch`). */
    routenEtikett?: string;
  }
}

const GUELTIGE_ID = /^[A-Za-z0-9._-]{8,64}$/;

/** Routenmuster für Log und Metriken: das Muster des zuletzt passenden Handlers (auch wenn eine Middleware vorher abgelehnt hat), sonst `unbekannt`. Die Oberfläche steht in `app.ts` vor den Routen, damit diese zuletzt passen. */
export function routenEtikett(c: Parameters<MiddlewareHandler>[0]): string {
  const eigenes = c.get("routenEtikett");
  if (eigenes) return eigenes;
  let muster: string;
  try {
    muster = routePath(c, -1);
  } catch {
    return "unbekannt";
  }
  // Nur Platzhalter-Middleware (`*`, `/api/v1/*`) hat angeschlagen: keine Route.
  return muster === "" || muster.endsWith("*") ? "unbekannt" : muster;
}

export function zugriffsbeobachtung(optionen: { logger?: Logger; metriken?: Metriken }): MiddlewareHandler {
  return async (c, next) => {
    const start = performance.now();
    const eingehend = c.req.header("X-Request-Id");
    const anfrageId = eingehend && GUELTIGE_ID.test(eingehend) ? eingehend : randomUUID();
    c.set("anfrageId", anfrageId);
    try {
      await next();
    } finally {
      const dauerMs = performance.now() - start;
      const route = routenEtikett(c);
      c.res.headers.set("X-Request-Id", anfrageId);
      optionen.metriken?.anfrage(c.req.method, route, c.res.status, dauerMs / 1000);
      // Der Health-Check des Containers fragt alle 30 Sekunden; erfolgreiche Abfragen davon kommen nur bei LOG_STUFE=debug.
      const stufe = c.res.status >= 500 ? "error" : route === "/api/v1/gesundheit" && c.res.status < 400 ? "debug" : "info";
      optionen.logger?.(stufe, "anfrage", {
        anfrageId,
        methode: c.req.method,
        route,
        status: c.res.status,
        dauerMs: Math.round(dauerMs * 10) / 10,
        benutzerId: c.get("akteur")?.id,
        // Nur die Kennung des Schlüssels, nie der Schlüssel selbst.
        schluesselId: c.get("akteur")?.schluesselId,
      });
    }
  };
}
