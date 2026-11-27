import { stat, readFile } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";
import type { MiddlewareHandler } from "hono";

/**
 * Liefert die gebaute Oberfläche (`apps/web/dist`) vom selben Ursprung wie die API aus (Selbst-Hosting, ein Container).
 * Schaltbar über `WEB_AUSLIEFERN=1` (siehe `konfiguration.ts`); ohne Schalter bleibt die API reine API.
 *
 * - `/assets/*` trägt Hashes im Dateinamen: ein Jahr, `immutable`. `index.html` und alles Übrige: `no-cache` bzw. eine Stunde.
 * - Unbekannte Pfade ohne Dateiendung bekommen `index.html` (Router der Oberfläche, Deep-Links). Pfade mit Endung und alles
 *   unter `/assets/` antworten 404, damit ein fehlendes Skript nicht als HTML ankommt.
 * - `/api/*` und `/metriken` fasst dieser Teil nie an.
 * - Kompression übernimmt der Reverse-Proxy.
 */

const TYPEN: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
};

/** Herkunft der Rahmen von Excel im Browser und in der Desktop-Anwendung (WebView). */
const EXCEL_RAHMEN = "'self' https://*.officeapps.live.com https://*.office.com https://*.office365.com https://*.microsoft365.com https://*.sharepoint.com https://*.cloud.microsoft";

const NICHT_STATISCH = (pfad: string) => pfad === "/api" || pfad.startsWith("/api/") || pfad === "/metriken" || pfad.startsWith("/metriken/");

async function dateiOderNull(pfad: string) {
  try {
    const s = await stat(pfad);
    return s.isFile() ? s : null;
  } catch {
    return null;
  }
}

export function statischeDateien(verzeichnis: string, optionen: { hsts?: boolean } = {}): MiddlewareHandler {
  const wurzel = resolve(verzeichnis);
  return async (c, next) => {
    if (c.req.method !== "GET" && c.req.method !== "HEAD") return next();
    let pfad: string;
    try {
      pfad = decodeURIComponent(c.req.path);
    } catch {
      return next();
    }
    if (NICHT_STATISCH(pfad) || pfad.includes("\0")) return next();
    // Pfadtricks (`..`, kodierte Punkte, Schrägstriche oder Rückwärtsschrägstriche) werden abgelehnt, nie umgedeutet.
    if (/%(2e|2f|5c)/i.test(c.req.path) || pfad.includes("\\") || pfad.split("/").includes("..")) return new Response(null, { status: 404 });

    const relativ = pfad === "/" ? "index.html" : pfad.slice(1);
    const ziel = resolve(join(wurzel, relativ));
    let datei = ziel.startsWith(wurzel + sep) ? await dateiOderNull(ziel) : null;
    let name = relativ;
    if (!datei) {
      const hatEndung = extname(relativ) !== "";
      if (hatEndung || pfad.startsWith("/assets/")) return next();
      name = "index.html";
      datei = await dateiOderNull(join(wurzel, name));
      if (!datei) return next();
    }
    const vollerPfad = name === relativ && ziel.startsWith(wurzel + sep) ? ziel : join(wurzel, name);

    const etag = `W/"${datei.size.toString(16)}-${Math.floor(datei.mtimeMs).toString(16)}"`;
    // Die Entscheidungen über Kopfzeilen beruhen auf der aufgelösten Datei, nie auf dem angefragten Namen.
    const rel = relative(wurzel, vollerPfad).split(sep).join("/");
    if (rel.startsWith("../") || rel === "..") return new Response(null, { status: 404 });
    const istIndex = rel === "index.html";
    const kopf: Record<string, string> = {
      "Content-Type": TYPEN[extname(name).toLowerCase()] ?? "application/octet-stream",
      "Cache-Control": rel.startsWith("assets/") ? "public, max-age=31536000, immutable" : istIndex ? "no-cache" : "public, max-age=3600",
      ETag: etag,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
      "X-Frame-Options": "DENY",
    };
    if (istIndex && /^\/setup\/?$/i.test(pfad)) {
      kopf["Referrer-Policy"] = "no-referrer";
      kopf["Cache-Control"] = "no-store";
    }
    if (istIndex) kopf["Content-Security-Policy"] = "frame-ancestors 'none'";
    // Das Excel-Add-in (Etappe 22) lädt seine Seiten in einem Rahmen von Excel; nur dort erlaubt, nie von beliebigen Seiten.
    // Nur die HTML-Seiten des Add-ins (Skripte und Metadaten brauchen keinen Rahmen).
    if (rel.startsWith("excel-addin/") && rel.endsWith(".html")) {
      delete kopf["X-Frame-Options"];
      kopf["Content-Security-Policy"] = `frame-ancestors ${EXCEL_RAHMEN}`;
      kopf["Cache-Control"] = "no-cache";
    }
    if (optionen.hsts) kopf["Strict-Transport-Security"] = "max-age=31536000";
    c.set("routenEtikett", "statisch");

    if (c.req.header("If-None-Match") === etag) return new Response(null, { status: 304, headers: kopf });
    const koerper = c.req.method === "HEAD" ? null : new Uint8Array(await readFile(vollerPfad));
    return new Response(koerper, { status: 200, headers: { ...kopf, "Content-Length": String(datei.size) } });
  };
}
