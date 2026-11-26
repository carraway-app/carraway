/**
 * Der Arbeitsbereich als Graph: welches Paket eine Datei besitzt und welche Pakete von einem geänderten Paket abhängen
 * (über `@carraway/*` in dependencies und devDependencies). Gemeinsam genutzt von `test-scope.ts`, `test-related.ts`
 * und dem Pre-Push-Skript.
 */
import fs from "node:fs";
import path from "node:path";

export interface Paket {
  /** Ordner relativ zur Wurzel, z. B. `packages/db` oder `ee/api`. */
  dir: string;
  name: string;
  hatTests: boolean;
  hatTypecheck: boolean;
  /** Namen der Arbeitsbereichspakete, die dieses Paket nutzt. */
  nutzt: string[];
}

export function ladePakete(wurzel = process.cwd()): Paket[] {
  const pakete: Paket[] = [];
  // `ee/`: Erweiterungen (Open Core, docs/open-core.md); im öffentlichen Repo fehlt der Ordner, dann zählen nur apps/ und packages/.
  for (const gruppe of ["apps", "packages", "ee"]) {
    const ordner = path.join(wurzel, gruppe);
    if (!fs.existsSync(ordner)) continue;
    for (const eintrag of fs.readdirSync(ordner, { withFileTypes: true })) {
      const datei = path.join(ordner, eintrag.name, "package.json");
      if (!eintrag.isDirectory() || !fs.existsSync(datei)) continue;
      const json = JSON.parse(fs.readFileSync(datei, "utf8")) as {
        name: string;
        scripts?: Record<string, string>;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const nutzt = Object.keys({ ...json.dependencies, ...json.devDependencies }).filter((n) => n.startsWith("@carraway/"));
      pakete.push({ dir: `${gruppe}/${eintrag.name}`, name: json.name, hatTests: Boolean(json.scripts?.test), hatTypecheck: Boolean(json.scripts?.typecheck), nutzt });
    }
  }
  return pakete.sort((a, b) => a.dir.localeCompare(b.dir));
}

/** Das Paket, dem die Datei gehört, oder `undefined` für Dateien außerhalb der Pakete (Wurzel, scripts, docs). */
export function besitzer(pakete: readonly Paket[], datei: string): Paket | undefined {
  return pakete.find((p) => datei.startsWith(`${p.dir}/`));
}

/** Pakete mit geänderten Dateien plus alle, die davon (auch mittelbar) abhängen. */
export function betroffenePakete(pakete: readonly Paket[], geaendert: readonly string[]): Paket[] {
  const betroffen = new Set<string>();
  for (const datei of geaendert) {
    const p = besitzer(pakete, datei);
    if (p) betroffen.add(p.name);
  }
  let wuchs = true;
  while (wuchs) {
    wuchs = false;
    for (const p of pakete) {
      if (!betroffen.has(p.name) && p.nutzt.some((n) => betroffen.has(n))) {
        betroffen.add(p.name);
        wuchs = true;
      }
    }
  }
  return pakete.filter((p) => betroffen.has(p.name));
}
