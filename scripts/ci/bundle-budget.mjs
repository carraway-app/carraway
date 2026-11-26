// Prüft den Anfangsumfang der Oberfläche gegen das Budget (gzip). Aufruf nach `pnpm build`:
//   node scripts/ci/bundle-budget.mjs [Verzeichnis, Standard apps/web/dist] [--voll]
// Ohne `--voll` die Oberfläche „Kern“ (apps/web/dist, ohne LP-Portal), mit `--voll` die Oberfläche „Voll“ (ee/web/dist, mit LP-Portal; Open Core,
// docs/open-core.md). Beide bauen aus denselben Quellen; „Voll“ hat dieselben Budgets.
// Anfangsumfang = alles, was ein Einstieg beim ersten Laden zwingend braucht: der Einstiegsabschnitt, der Startabschnitt des Falls
// (intern, LP-Portal, öffentliche Abfrage) und alle statisch von ihnen eingebundenen Abschnitte; dazu die Stilvorlagen.
// Seitenabschnitte (lazy) und große Bibliotheken (PDF-Anzeige, QR-Code) zählen nicht, sie dürfen nur über dynamische Importe hängen.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const voll = process.argv.includes("--voll");
const dist = path.resolve(process.argv.slice(2).find((a) => !a.startsWith("--")) ?? (voll ? "ee/web/dist" : "apps/web/dist"));
const KB = 1000;
/**
 * Budgets in Bytes gzip (JS ohne CSS). `mit` nennt dynamische Importe, auf die der Start vor dem ersten Zeichnen wartet (der Rahmen des Wörterbuchs der Standardsprache;
 * die großen Bereiche kommen erst mit der Seite, siehe `apps/web/src/i18n/bereiche.ts`). Die Werte sind Obergrenzen gegen Rückschritte: Sie liegen knapp über dem
 * gemessenen Stand (Nacharbeiten 9: interne Anwendung 128,3 kB, Portal 114,4 kB, Abfrage 76,4 kB) und werden gesenkt, wenn der Umfang sinkt, nie angehoben, ohne dass die Entscheidung dazu im Entscheidungsprotokoll steht.
 */
// Bis zum Start vorübergehend angehoben auf 135 kB (interne Anwendung, Entscheidung 483); vor dem Start wieder auf den gemessenen Stand senken (vorher 131,4 kB).
// Das LP-Portal ist eine Erweiterung (`ee/web`): Sein Einstieg steht nur im Build „Voll“ (Schlüssel relativ zur Wurzel `apps/web` des Builds).
// Im Build „Voll“ wartet der Start zusätzlich auf die Anmeldung der Erweiterungen (`ee/web/src/erweiterungen.tsx`, eigener Abschnitt, gemessen rund
// 1,5 kB) samt einem kleinen gemeinsamen Laufzeitabschnitt, und der Einstieg trägt den Einstieg des Portals (gemessen: interne Anwendung 137,1 kB,
// öffentliche Abfrage 77,7 kB). Dafür gilt dort ein fester Aufschlag (`AUFSCHLAG_VOLL`, Entscheidung 518).
const AUFSCHLAG_VOLL = voll ? { intern: 2.5 * KB, extern: 0.5 * KB } : { intern: 0, extern: 0 };
const BUDGETS = {
  "src/start.tsx": { name: "interne Anwendung", js: 135 * KB + AUFSCHLAG_VOLL.intern, mit: ["src/i18n/kern.de.ts", ...(voll ? ["../../ee/web/src/erweiterungen.tsx"] : [])] },
  ...(voll ? { "../../ee/web/src/portal/start.tsx": { name: "LP-Portal", js: 117.4 * KB, mit: [] } } : {}),
  "src/extern/start.tsx": { name: "öffentliche Abfrage", js: 77.3 * KB + AUFSCHLAG_VOLL.extern, mit: [] },
};
/** Bibliotheken, die nie im Anfangsumfang stehen dürfen (Quellpfade oder Paketnamen im Abschnittsnamen). */
const SCHWER = [/pdf/i, /qrcode/i, /exceljs/i];

const manifestPfad = [".vite/manifest.json", "manifest.json"].map((p) => path.join(dist, p)).find((p) => fs.existsSync(p));
if (!manifestPfad) {
  console.error(`Kein Vite-Manifest unter ${dist}; erst bauen (pnpm build).`);
  process.exit(2);
}
const manifest = JSON.parse(fs.readFileSync(manifestPfad, "utf8"));
const gz = (datei) => zlib.gzipSync(fs.readFileSync(path.join(dist, datei))).length;

function statischeAbschnitte(schluessel, gesehen = new Set()) {
  if (gesehen.has(schluessel)) return gesehen;
  gesehen.add(schluessel);
  for (const k of manifest[schluessel]?.imports ?? []) statischeAbschnitte(k, gesehen);
  return gesehen;
}

let fehler = 0;
const fmt = (b) => `${(b / KB).toFixed(1)} kB`;
for (const [schluessel, budget] of Object.entries(BUDGETS)) {
  if (!manifest[schluessel]) {
    console.error(`FEHLER: Einstieg ${schluessel} fehlt im Manifest.`);
    fehler++;
    continue;
  }
  const schluessels = new Set([...statischeAbschnitte("index.html"), ...statischeAbschnitte("src/main.tsx"), ...statischeAbschnitte(schluessel), ...budget.mit.flatMap((k) => [...statischeAbschnitte(k)])]);
  const dateien = [...schluessels].map((k) => manifest[k]).filter(Boolean);
  const js = dateien.reduce((s, e) => s + gz(e.file), 0);
  const css = dateien.flatMap((e) => e.css ?? []).reduce((s, f, i, a) => (a.indexOf(f) === i ? s + gz(f) : s), 0);
  const zeilen = dateien.map((e) => ({ datei: e.file, gz: gz(e.file) })).sort((a, b) => b.gz - a.gz);
  const zuSchwer = zeilen.filter((z) => SCHWER.some((r) => r.test(z.datei)));
  const ok = js <= budget.js && zuSchwer.length === 0;
  console.log(`${ok ? "OK    " : "FEHLER"} ${budget.name}: JS ${fmt(js)} gzip (Budget ${fmt(budget.js)}), CSS ${fmt(css)} gzip, ${dateien.length} Abschnitte`);
  for (const z of zeilen.slice(0, 6)) console.log(`         ${fmt(z.gz).padStart(9)}  ${z.datei}`);
  if (js > budget.js) console.error(`         Budget um ${fmt(js - budget.js)} überschritten.`);
  for (const z of zuSchwer) console.error(`         Schwere Bibliothek im Anfangsumfang: ${z.datei}`);
  if (!ok) fehler++;
}
process.exit(fehler ? 1 : 0);
