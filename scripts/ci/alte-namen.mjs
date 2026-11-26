// Prüft, dass der frühere Produktname im Repo nicht mehr vorkommt (Issue 199): `git grep -i` über Inhalt und Dateinamen, außer in den
// Dateien und Ordnern der begründeten Ausnahmeliste `scripts/ci/alte-namen-ausnahmen.json`. Ein Eintrag der Liste ohne Treffer
// ist ebenfalls ein Fehler, damit die Liste nur enthält, was nötig ist.
//   node scripts/ci/alte-namen.mjs
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const MUSTER = "fundament";
const ausnahmen = JSON.parse(readFileSync("scripts/ci/alte-namen-ausnahmen.json", "utf8"));
for (const a of ausnahmen) {
  if (typeof a.pfad !== "string" || typeof a.grund !== "string" || a.grund.trim() === "") throw new Error(`Ausnahme ohne Pfad oder Begründung: ${JSON.stringify(a)}`);
}

// Ein Pfad mit `/` am Ende gilt für den ganzen Ordner, sonst für genau eine Datei.
const ausnahmeFuer = (datei) => ausnahmen.find((a) => (a.pfad.endsWith("/") ? datei.startsWith(a.pfad) : datei === a.pfad));

const git = (...args) => {
  try {
    return execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  } catch (e) {
    if (e.status === 1) return ""; // git grep ohne Treffer
    throw e;
  }
};

/** Datei -> Fundstellen (Zeilen oder Dateiname). */
const treffer = new Map();
const merke = (datei, text) => treffer.set(datei, [...(treffer.get(datei) ?? []), text]);
for (const zeile of git("grep", "-I", "-i", "-n", MUSTER, "--", ".").split("\n").filter(Boolean)) merke(zeile.slice(0, zeile.indexOf(":")), zeile);
for (const datei of git("ls-files").split("\n").filter((d) => d.toLowerCase().includes(MUSTER))) merke(datei, `${datei}: (Dateiname)`);

const verwendet = new Set();
const verstoesse = [];
for (const [datei, zeilen] of treffer) {
  const a = ausnahmeFuer(datei);
  if (a) verwendet.add(a);
  else verstoesse.push(...zeilen);
}
// Ein Eintrag für einen fehlenden Pfad (etwa `ee/` in der Kopie des Kerns) gilt nicht als ungenutzt.
const ungenutzt = ausnahmen.filter((a) => !verwendet.has(a) && existsSync(a.pfad));

if (verstoesse.length > 0) {
  console.error(`alte-namen: ${verstoesse.length} Treffer außerhalb der Ausnahmeliste (der Produktname ist Carraway):`);
  for (const z of verstoesse.slice(0, 50)) console.error(`  ${z.length > 200 ? `${z.slice(0, 200)}…` : z}`);
  if (verstoesse.length > 50) console.error(`  … und ${verstoesse.length - 50} weitere`);
}
if (ungenutzt.length > 0) {
  console.error("alte-namen: Einträge der Ausnahmeliste ohne Treffer (bitte entfernen):");
  for (const a of ungenutzt) console.error(`  ${a.pfad}`);
}
if (verstoesse.length > 0 || ungenutzt.length > 0) process.exit(1);
console.log(`alte-namen: keine Treffer außerhalb der Ausnahmeliste (${ausnahmen.length} Ausnahmen).`);
