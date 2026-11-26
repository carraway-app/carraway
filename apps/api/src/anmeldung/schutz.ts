import { getConnInfo } from "@hono/node-server/conninfo";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { Fachfehler } from "../fehler";
import type { Konfiguration } from "../konfiguration";
import type { Auth } from "./auth";
import { IP_KOPF } from "./begrenzung";

/**
 * Schutz der Anmeldung: Ursprungsprüfung gegen CSRF und das Einhängen von Better Auth unter `/api/v1/auth/*`.
 */

const SCHREIBEND = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Zustandsändernde Anfragen müssen vom konfigurierten Ursprung der Oberfläche kommen (`Origin`). Anfragen mit
 * Bearer-Schlüssel tragen weder Cookie noch Ursprung und sind kein CSRF-Ziel; ein Cookie ohne Ursprung wird abgelehnt.
 */
export function ursprungPruefung(konfig: Pick<Konfiguration, "appOrigins">): MiddlewareHandler {
  return async (c, next) => {
    if (!SCHREIBEND.has(c.req.method)) return next();
    const ursprung = c.req.header("Origin");
    if (ursprung !== undefined) {
      if (!konfig.appOrigins.includes(ursprung)) throw new Fachfehler(403, "origin_invalid", "The origin of the request is not allowed.");
      return next();
    }
    const mitSchluessel = /^Bearer /i.test(c.req.header("Authorization") ?? "");
    if (c.req.header("Cookie") && !mitSchluessel) throw new Fachfehler(403, "origin_invalid", "The origin of the request is missing.");
    return next();
  };
}

/** IP-Adresse des Clients: hinter einem vertrauenswürdigen Proxy der letzte Eintrag von `X-Forwarded-For`, sonst die Verbindung. */
export function clientIp(c: Context, konfig: Pick<Konfiguration, "proxyVertrauen">): string {
  if (konfig.proxyVertrauen) {
    const eintraege = c.req.header("X-Forwarded-For")?.split(",").map((e) => e.trim()).filter(Boolean);
    const letzter = eintraege?.at(-1);
    if (letzter) return letzter;
  }
  try {
    return getConnInfo(c).remote.address ?? "unbekannt";
  } catch {
    return "unbekannt";
  }
}

/** Nur diese Pfadform kommt zu Better Auth: Kleinbuchstaben, Ziffern, Bindestriche, einfache Schrägstriche, kein Prozent, kein Schrägstrich am Ende. */
const KANONISCH = /^\/api\/v1\/auth(\/[a-z0-9]+(-[a-z0-9]+)*)+$/;

/**
 * Wege des zweiten Faktors, die die Oberfläche braucht. Alle anderen `/two-factor/*`-Wege (Code per E-Mail `send-otp` und
 * `verify-otp`, `get-totp-uri`, `generate-backup-codes`, `disable`) sind aus: Sie sind nicht in der Fehlversuchsbegrenzung,
 * und ein Code per E-Mail gibt es hier nicht. Sie antworten 404 (Entscheidung 87 und Nr. 118).
 */
const ZWEI_FAKTOR_ERLAUBT = new Set(["/api/v1/auth/two-factor/enable", "/api/v1/auth/two-factor/verify-totp", "/api/v1/auth/two-factor/verify-backup-code"]);

/**
 * Das Zurücksetzen des Passworts läuft über `/password/forgot` (gleiche Antwort für jede Adresse, Begrenzung je IP und Adresse, Mail über den
 * Ausgangskorb). Die Anfrage-Wege von Better Auth selbst sind aus; nur das Einlösen (`POST /reset-password`) ist offen.
 */
const ZURUECKSETZEN_AUS = ["/api/v1/auth/request-password-reset", "/api/v1/auth/forget-password"];

/**
 * Better Auth unter `/auth/*`. Jeder Pfad, der nicht in kanonischer Schreibweise ankommt (Schrägstrich am Ende, `//`,
 * Prozent-Kodierung, Großbuchstaben), wird mit 404 abgewiesen, bevor die Bibliothek ihn sieht. Registrierung (`disableSignUp`)
 * und Fehlversuchsbegrenzung liegen in Better Auth selbst (`anmeldung/auth.ts`) und gelten damit unabhängig vom Pfadvergleich.
 */
export function authRouten(auth: Auth, konfig: Konfiguration) {
  return new Hono().on(["GET", "POST"], "/*", async (c) => {
    const roh = new URL(c.req.url).pathname;
    if (!KANONISCH.test(roh) || !KANONISCH.test(c.req.path)) throw new Fachfehler(404, "not_found", "The requested resource does not exist.");
    if (ZURUECKSETZEN_AUS.includes(c.req.path) || c.req.path.startsWith("/api/v1/auth/reset-password/")) {
      throw new Fachfehler(404, "not_found", "The requested resource does not exist.");
    }
    if (c.req.path.startsWith("/api/v1/auth/two-factor/") && !ZWEI_FAKTOR_ERLAUBT.has(c.req.path)) {
      throw new Fachfehler(404, "not_found", "The requested resource does not exist.");
    }
    // Die IP kommt nie vom Client: ein mitgesendeter interner Kopf wird überschrieben.
    const kopf = new Headers(c.req.raw.headers);
    kopf.set(IP_KOPF, clientIp(c, konfig));
    const antwort = await auth.handler(new Request(c.req.raw, { headers: kopf }));
    if (antwort.status === 429) {
      const koerper = (await antwort.clone().json().catch(() => null)) as { code?: string } | null;
      if (koerper?.code === "too_many_attempts") {
        c.header("Retry-After", String(Math.round(konfig.anmeldeLimit.fensterMs / 1000)));
        throw new Fachfehler(429, "too_many_attempts", "Too many failed attempts. Please try again later.");
      }
    }
    return antwort;
  });
}
