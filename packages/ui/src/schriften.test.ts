// @vitest-environment node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** Schriften werden selbst ausgeliefert: keine Anfrage der Besucher an Google Fonts oder einen anderen Drittanbieter. */

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const ORDNER = [join(WURZEL, "apps/web"), join(WURZEL, "packages/ui")];
const AUSGESCHLOSSEN = new Set(["node_modules", "dist", "coverage", ".turbo"]);

function dateien(ordner: string, endungen: string[]): string[] {
  return readdirSync(ordner).flatMap((name) => {
    if (AUSGESCHLOSSEN.has(name)) return [];
    const pfad = join(ordner, name);
    if (statSync(pfad).isDirectory()) return dateien(pfad, endungen);
    return endungen.some((e) => name.endsWith(e)) ? [pfad] : [];
  });
}

describe("Schriften ohne Drittanbieter", () => {
  it("kein HTML und kein CSS in apps/web und packages/ui nennt fonts.googleapis.com oder fonts.gstatic.com", () => {
    const gefunden = ORDNER.flatMap((o) => dateien(o, [".html", ".css"])).filter((d) => /fonts\.(googleapis|gstatic)\.com/i.test(readFileSync(d, "utf8")));
    expect(gefunden.map((d) => d.slice(WURZEL.length + 1))).toEqual([]);
  });

  it("die Oberfläche hat HTML und CSS, die der Test prüft", () => {
    expect(dateien(ORDNER[0]!, [".html"]).length).toBeGreaterThan(0);
    expect(dateien(ORDNER[1]!, [".css"]).length).toBeGreaterThan(0);
  });

  it("jede @font-face-Regel zeigt auf eine vorhandene woff2-Datei im Paket und tauscht mit font-display: swap", () => {
    const css = readFileSync(join(WURZEL, "packages/ui/src/styles/schriften.css"), "utf8");
    const regeln = css.match(/@font-face\s*\{[^}]*\}/g) ?? [];
    expect(regeln.length).toBe(3);
    for (const regel of regeln) {
      const url = /url\("([^"]+)"\)/.exec(regel)?.[1];
      expect(url, regel).toMatch(/^\.\.\/schriften\/[\w-]+\.woff2$/);
      expect(existsSync(join(WURZEL, "packages/ui/src/styles", url!)), url).toBe(true);
      expect(regel).toContain("font-display: swap");
    }
    const instrument = regeln.find((regel) => regel.includes('"Instrument Sans"'));
    expect(instrument).toContain("font-weight: 400 700");
    expect(instrument).toContain("font-stretch: 75% 100%");
    for (const familie of ["Instrument Sans", "IBM Plex Mono"]) expect(css).toContain(`font-family: "${familie}"`);
  });

  it("die Lizenztexte liegen bei den Schriften", () => {
    for (const datei of ["OFL-IBM-Plex.txt", "OFL-InstrumentSans.txt"]) expect(existsSync(join(WURZEL, "packages/ui/src/schriften", datei))).toBe(true);
  });
});
