// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TOKENS_CSS, TOKENS_JSON, erzeugeTokensCss, type Tokens } from "../scripts/tokens";

describe("tokens.css", () => {
  const tokens = JSON.parse(readFileSync(TOKENS_JSON, "utf8")) as Tokens;
  const css = erzeugeTokensCss(tokens);

  it("ist mit design/tokens.json synchron (sonst: pnpm --filter @carraway/ui tokens)", () => {
    expect(readFileSync(TOKENS_CSS, "utf8")).toBe(css);
  });

  it("enthält die Kerntokens", () => {
    for (const name of ["--cw-bg", "--cw-surface", "--cw-text", "--cw-accent", "--cw-focus", "--cw-line", "--s-1", "--s-8", "--h-s", "--h-l", "--font-mono"]) {
      expect(css).toContain(`${name}:`);
    }
  });

  it("ordnet Markenfarben und gemeinsame Schrift den Rollen beider Themen zu", () => {
    const primitive = Object.fromEntries(tokens.color.primitives.map((p) => [p.name, p.value]));
    const farben = (name: string) => {
      const rolle = tokens.color.semantic.find((s) => s.name === name)!;
      return [primitive[rolle["hell"]!], primitive[rolle["dunkel"]!]];
    };
    expect(farben("bg")).toEqual(["#FAF9F6", "#0E2621"]);
    expect(farben("text")).toEqual(["#18211D", "#EEF3EE"]);
    expect(farben("accent")).toEqual(["#096D69", "#7CCFC2"]);
    expect(farben("focus")).toEqual(farben("accent"));
    // Keine Hervorhebung in Gold oder Ocker: Kennzahlen heben sich über Gewicht und Akzent ab.
    expect(tokens.color.semantic.some((s) => s.name === "highlight")).toBe(false);
    expect(css).not.toMatch(/gold|#806429|#C4A25A/i);
    expect(farben("chart-1")).toEqual(["#18211D", "#F2F5EC"]);
    expect(farben("chart-2")).toEqual(["#096D69", "#65CEC0"]);
    expect(farben("neutral")).toEqual(["#505E56", "#BCCAC2"]);
    expect(tokens.type.families.sans).toContain('"Instrument Sans"');
    expect(tokens.type.families.display).toBe(tokens.type.families.sans);
  });

  it("enthält kein Orange, keine Verläufe und den alten Akzent nicht mehr", () => {
    expect(css).not.toMatch(/orange|gradient/i);
    expect(css).not.toMatch(/c6f432/i);
  });

  it("setzt beide Themen: Dunkel ohne Angabe, Hell über data-theme, System folgt dem Betriebssystem", () => {
    expect(css).toContain(':root, :root[data-theme="dunkel"] {\n  color-scheme: dark;');
    expect(css).toContain(':root[data-theme="hell"] {\n  color-scheme: light;');
    expect(css).toMatch(/@media \(prefers-color-scheme: light\) \{\n {2}:root\[data-theme="system"\] \{/);
    // Jedes semantische Token hat in beiden Themen einen Wert.
    for (const s of tokens.color.semantic) {
      expect(s["dunkel"], s.name).toBeTruthy();
      expect(s["hell"], s.name).toBeTruthy();
    }
  });

  it("Flächen unter klebenden Zellen sind deckend (keine durchscheinenden Werte)", () => {
    const primitive = new Set(tokens.color.primitives.map((p) => p.name));
    for (const name of ["bg", "surface", "surface-2", "raised", "field", "hover", "selected", "well"]) {
      const s = tokens.color.semantic.find((t) => t.name === name)!;
      expect(primitive.has(s["dunkel"]!) && primitive.has(s["hell"]!), name).toBe(true);
    }
  });

  it("Komponenten lesen nur semantische Tokens: keine festen Farben, keine Primitive", () => {
    const komponenten = readFileSync(TOKENS_CSS.replace("tokens.css", "komponenten.css"), "utf8").replace(/mask-image:[^;]*;/g, "");
    expect(komponenten).not.toMatch(/#[0-9a-f]{3,8}\b|\brgba?\(|var\(--p-/i);
  });
});
