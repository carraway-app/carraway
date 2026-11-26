import "@carraway/ui/styles.css";
import { alle } from "./erweiterung";

/**
 * Einstieg mit getrennten Fällen, damit nur der passende Teil zum Browser kommt:
 * - `/extern/abfrage/:token`: öffentliche Abfrageseite, eigener kleiner Einstieg ohne Router, Anmeldung und Wörterbücher der Anwendung,
 * - weitere Einstiege der Erweiterungen (z. B. das LP-Portal unter `/portal` mit eigenem Router und eigenen Texten),
 * - alles andere: interne Anwendung.
 * Der Einstieg „Kern“ (`main.tsx`) ruft das ohne Erweiterungen auf, der Einstieg „Voll“ (`ee/web/src/main.tsx`) meldet sie vorher an.
 */
// Das Thema steht schon vor dem ersten Anstrich: kleines Skript in `index.html` (siehe `packages/ui/src/thema.ts`).
/** `vorAnwendung`: läuft vor dem Start der internen Anwendung (Einstieg „Voll“: die Erweiterungen anmelden, dynamisch geladen). */
export function starteEinstieg(optionen: { vorAnwendung?: () => Promise<void> } = {}): void {
  const wurzel = document.getElementById("root");
  if (!wurzel) throw new Error("Element #root fehlt in index.html");

  const pfad = window.location.pathname;
  const extern = /^\/extern\/abfrage\/([^/]+)\/?$/.exec(pfad);
  const weiterer = alle("einstiege").find((e) => e.passt(pfad));
  if (extern) {
    let token = extern[1]!;
    try {
      token = decodeURIComponent(token);
    } catch {
      // ungültige Kodierung: das Token bleibt roh und die API antwortet "nicht gefunden"
    }
    void import("./extern/start").then((m) => m.starteExtern(wurzel, token));
  } else if (weiterer) {
    void weiterer.starte(wurzel);
  } else {
    void Promise.all([import("./start"), optionen.vorAnwendung?.()]).then(([m]) => m.starteAnwendung(wurzel));
  }
}
