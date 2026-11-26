import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DOCS_PALETTE, erzeugeDocsHtml, type OpenApiDokument } from "../openapi";

/** Hilfeseite (`/docs`): Farben aus dem Designsystem, beide Themen über `prefers-color-scheme`, Akzent nur als Linie. */

interface Tokens {
  color: { primitives: { name: string; value: string }[]; semantic: { name: string; dunkel: string; hell: string }[] };
}
const tokens = JSON.parse(readFileSync(new URL("../../../../design/tokens.json", import.meta.url), "utf8")) as Tokens;
const wert = (token: string, thema: "dunkel" | "hell") => {
  const s = tokens.color.semantic.find((t) => t.name === token)!;
  return tokens.color.primitives.find((p) => p.name === s[thema])!.value;
};

const leer: OpenApiDokument = {
  openapi: "3.1.0",
  info: { title: "Carraway API", version: "0", description: "Beschreibung" },
  servers: [{ url: "/api/v1" }],
  paths: { "/theme": { get: { operationId: "get_thema", tags: ["thema"], description: "Jede angemeldete Person." } } },
  components: {},
  tags: [{ name: "thema" }],
};

const helligkeit = (hex: string) => {
  const kanal = (i: number) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * kanal(0) + 0.7152 * kanal(1) + 0.0722 * kanal(2);
};
const kontrast = (a: string, b: string) => {
  const [hell, dunkel] = [helligkeit(a), helligkeit(b)].sort((x, y) => y - x);
  return (hell! + 0.05) / (dunkel! + 0.05);
};

describe("Hilfeseite: Palette", () => {
  it.each(["dunkel", "hell"] as const)("nutzt im Thema %s die Werte der semantischen Tokens", (thema) => {
    for (const [name, farbe] of Object.entries(DOCS_PALETTE[thema])) expect(farbe, `${thema} ${name}`).toBe(wert(name, thema));
  });

  it.each(["dunkel", "hell"] as const)("erreicht im Thema %s den Kontrast der Designregeln", (thema) => {
    const p = DOCS_PALETTE[thema];
    for (const grund of [p.bg, p.surface]) {
      expect(kontrast(p.text, grund)).toBeGreaterThanOrEqual(4.5);
      expect(kontrast(p["text-muted"], grund)).toBeGreaterThanOrEqual(4.5);
      // Der Akzent ist eine Linie (Strich, Fokusring): 3 : 1.
      expect(kontrast(p.accent, grund)).toBeGreaterThanOrEqual(3);
    }
  });

  it("folgt dem Betriebssystem über CSS (Dunkel ohne Angabe), ohne Skript, und trägt den Akzent nur als Linie", () => {
    const html = erzeugeDocsHtml(leer);
    expect(html).toContain("@media (prefers-color-scheme:light)");
    expect(html).toContain(`--accent:${DOCS_PALETTE.dunkel.accent}`);
    expect(html).toContain(`--accent:${DOCS_PALETTE.hell.accent}`);
    expect(html).toContain('<meta name="color-scheme" content="dark light">');
    expect(html).not.toMatch(/<script/i);
    // Der Akzent steht nur als Hintergrund eines Strichs (2 px) oder als Linie, nie als Schrift- oder Flächenfarbe.
    const css = /<style>([\s\S]*?)<\/style>/.exec(html)![1]!;
    const verwendungen = [...css.matchAll(/([^{}]+)\{[^{}]*var\(--accent\)[^{}]*\}/g)].map((m) => m[0]);
    expect(verwendungen.length).toBeGreaterThan(0);
    for (const v of verwendungen) {
      expect(v, v).not.toMatch(/(^|[;{\s])color:var\(--accent\)/);
      expect(v, v).toMatch(/height:2px|outline:2px|text-decoration-color|text-decoration-thickness/);
    }
    // Keine festen Farben außerhalb der Palette und kein Orange.
    const feste = [...css.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0].toUpperCase());
    const erlaubt = new Set([...Object.values(DOCS_PALETTE.dunkel), ...Object.values(DOCS_PALETTE.hell)].map((f) => f.toUpperCase()));
    for (const f of feste) expect(erlaubt.has(f), f).toBe(true);
  });
});
