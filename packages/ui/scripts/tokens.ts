/**
 * Erzeugt src/styles/tokens.css aus design/tokens.json.
 * Aufruf: pnpm --filter @carraway/ui tokens
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

interface Token {
  name: string;
  value: string;
}
interface Schrift {
  name: string;
  fontSize: string;
  lineHeight: number;
  fontWeight: number;
  letterSpacing?: string;
}
interface Thema {
  id: string;
  colorScheme: "dark" | "light";
  standard?: boolean;
}
interface Semantik {
  name: string;
  [thema: string]: string;
}
export interface Tokens {
  color: { themes: Thema[]; primitives: Token[]; semantic: Semantik[] };
  type: { families: Record<string, string>; groups: { family: string; styles: Schrift[] }[] };
  spacing: { tokens: Token[] };
  radius: { tokens: Token[] };
  hoehe: { tokens: Token[] };
}

export const TOKENS_JSON = fileURLToPath(new URL("../../../design/tokens.json", import.meta.url));
export const TOKENS_CSS = fileURLToPath(new URL("../src/styles/tokens.css", import.meta.url));

export function erzeugeTokensCss(tokens: Tokens): string {
  const zeilen: string[] = [];
  const variable = (name: string, wert: string) => zeilen.push(`  --${name}: ${wert};`);

  // Primitive: die Palette. Nur die semantischen Tokens unten lesen sie, Komponenten nie.
  const primitive = new Set(tokens.color.primitives.map((p) => p.name));
  for (const p of tokens.color.primitives) variable(`p-${p.name}`, p.value);
  for (const [name, wert] of Object.entries(tokens.type.families)) variable(`font-${name}`, wert);
  for (const t of tokens.spacing.tokens) variable(t.name, t.value);
  for (const t of tokens.radius.tokens) variable(t.name, t.value);
  for (const t of tokens.hoehe.tokens) variable(t.name, t.value);
  // Schriftgröße und Zeilenhöhe jeder Schriftstufe als Variable, damit Komponenten nie eine eigene Größe schreiben.
  for (const gruppe of tokens.type.groups) {
    for (const s of gruppe.styles) {
      variable(`fs-${s.name}`, s.fontSize);
      variable(`lh-${s.name}`, String(s.lineHeight));
    }
  }

  const klassen: string[] = [];
  for (const gruppe of tokens.type.groups) {
    for (const s of gruppe.styles) {
      const regeln = [
        `font-family: var(--font-${gruppe.family});`,
        `font-size: ${s.fontSize};`,
        `line-height: ${s.lineHeight};`,
        `font-weight: ${s.fontWeight};`,
      ];
      if (s.letterSpacing) regeln.push(`letter-spacing: ${s.letterSpacing};`);
      klassen.push(`.cw-t-${s.name} { ${regeln.join(" ")} }`);
    }
  }

  // Semantische Farben je Thema. Ohne data-theme gilt das Standardthema; "system" folgt prefers-color-scheme.
  const semantik = (thema: Thema, einzug: string) => [
    `${einzug}color-scheme: ${thema.colorScheme};`,
    ...tokens.color.semantic.map((s) => {
      const wert = s[thema.id];
      if (wert === undefined) throw new Error(`Token ${s.name} hat keinen Wert für das Thema ${thema.id}`);
      return `${einzug}--cw-${s.name}: ${primitive.has(wert) ? `var(--p-${wert})` : wert};`;
    }),
  ];
  const standard = tokens.color.themes.find((t) => t.standard) ?? tokens.color.themes[0]!;
  const themen: string[] = [];
  for (const thema of tokens.color.themes) {
    const selektor = thema === standard ? `:root, :root[data-theme="${thema.id}"]` : `:root[data-theme="${thema.id}"]`;
    themen.push(`${selektor} {`, ...semantik(thema, "  "), "}", "");
  }
  const gegenstueck = tokens.color.themes.find((t) => t !== standard);
  if (gegenstueck) {
    themen.push(`@media (prefers-color-scheme: ${gegenstueck.colorScheme}) {`, '  :root[data-theme="system"] {', ...semantik(gegenstueck, "    "), "  }", "}", "");
  }

  return [
    "/* Erzeugt aus design/tokens.json durch scripts/tokens.ts. Nicht von Hand ändern. */",
    ":root {",
    ...zeilen,
    "}",
    "",
    ...themen,
    ...klassen,
    "",
  ].join("\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const tokens = JSON.parse(readFileSync(TOKENS_JSON, "utf8")) as Tokens;
  writeFileSync(TOKENS_CSS, erzeugeTokensCss(tokens));
  console.log(`geschrieben: ${TOKENS_CSS}`);
}
