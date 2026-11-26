import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vitest/config";

// Die API läuft getrennt; im Entwicklungsbetrieb leitet Vite `/api` weiter, damit der Browser kein CORS braucht.
// `API_ZIEL` ersetzt den Standard (zum Beispiel für eine zweite Umgebung auf anderem Port).
const apiZiel = process.env.API_ZIEL ?? "http://localhost:8787";

/**
 * `vite build --mode analyse`: schreibt je Abschnitt die Module mit ihrer gezeichneten Größe nach `BUNDLE_BERICHT` (JSON, Standard
 * `bundle-bericht.json` im Arbeitsverzeichnis; nicht ins Repository legen). Grundlage, um Anfangsumfang und Budget zu senken.
 */
function bundleBericht(): Plugin {
  return {
    name: "carraway-bundle-bericht",
    apply: "build",
    generateBundle(_optionen, buendel) {
      const bericht = Object.values(buendel)
        .filter((e) => e.type === "chunk")
        .map((e) => ({
          datei: e.fileName,
          einstieg: e.isEntry,
          importe: e.imports,
          dynamisch: e.dynamicImports,
          groesse: e.code.length,
          module: Object.entries(e.modules)
            .map(([name, m]) => ({ name, groesse: m.renderedLength }))
            .sort((a, b) => b.groesse - a.groesse),
        }));
      writeFileSync(process.env.BUNDLE_BERICHT ?? "bundle-bericht.json", JSON.stringify(bericht, null, 1));
    },
  };
}

export default defineConfig(({ mode }) => ({
  // Der Shim für ältere React-Versionen entfällt: React 19 hat `useSyncExternalStore` selbst (spart rund 0,8 kB gzip).
  resolve: { alias: [{ find: /^use-sync-external-store\/shim$/, replacement: fileURLToPath(new URL("./src/lib/sync-store-shim.ts", import.meta.url)) }] },
  plugins: [react(), ...(mode === "analyse" ? [bundleBericht()] : [])],
  server: { proxy: { "/api": apiZiel } },
  preview: { proxy: { "/api": apiZiel } },
  // Das Manifest nutzt `scripts/ci/bundle-budget.mjs`, um den Anfangsumfang je Einstieg zu messen.
  build: { manifest: true, modulePreload: { polyfill: false } },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test/setup.ts"],
    // Obergrenze je Test (siehe `asyncUtilTimeout` in setup.ts); ein gesunder Test braucht weit weniger.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
}));
