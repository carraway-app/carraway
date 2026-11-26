/**
 * Erzeugt aus Phosphor (Paket @phosphor-icons/react) die Zeichen der Oberfläche: je Zeichen eine Datei src/icons/<Name>.tsx mit dem Inhalt der
 * Gewichtung „Light“, dazu die Sammelstelle src/icons.tsx. Das Paket liefert je Zeichen alle sechs Gewichtungen mit; die Oberfläche braucht nur eine,
 * und der Anfangsumfang hat ein Budget. Je Zeichen eine eigene Datei, damit der Bundler jedes Zeichen dorthin legt, wo es gebraucht wird (die Seitenleiste
 * trägt ihre Zeichen im Start, das Portal bekommt keine fremden).
 * Aufruf: pnpm --filter @carraway/ui icons
 *
 * Neues Zeichen: Namen in ZEICHEN ergänzen (Schreibweise von phosphoricons.com), Skript ausführen.
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as Phosphor from "@phosphor-icons/react/ssr";

export const ZEICHEN = [
  "AddressBook",
  "ArrowLeft",
  "ArrowRight",
  "ArrowSquareOut",
  "ArrowsClockwise",
  "Bank",
  "Bell",
  "BookOpen",
  "Briefcase",
  "Buildings",
  "Calculator",
  "CalendarCheck",
  "CaretDown",
  "CaretLeft",
  "CaretRight",
  "CaretUp",
  "ChartLineUp",
  "ChartPieSlice",
  "Check",
  "Clock",
  "Code",
  "Copy",
  "DotsSixVertical",
  "DotsThree",
  "DownloadSimple",
  "EnvelopeSimple",
  "FileText",
  "FolderOpen",
  "Funnel",
  "Gear",
  "GlobeSimple",
  "Handshake",
  "House",
  "Info",
  "Kanban",
  "Leaf",
  "LinkedinLogo",
  "List",
  "ListChecks",
  "ListMagnifyingGlass",
  "Lock",
  "MagnifyingGlass",
  "Monitor",
  "Moon",
  "PaperPlaneTilt",
  "PencilSimple",
  "Percent",
  "Phone",
  "Plus",
  "Question",
  "Receipt",
  "Scales",
  "SidebarSimple",
  "SignOut",
  "Stack",
  "Sun",
  "Trash",
  "Tray",
  "TreeStructure",
  "UploadSimple",
  "UserCircle",
  "Users",
  "Warning",
  "X",
] as const;

export const ICONS_ORDNER = fileURLToPath(new URL("../src/icons/", import.meta.url));
export const ICONS_SAMMELSTELLE = fileURLToPath(new URL("../src/icons.tsx", import.meta.url));
/** Von Hand gepflegte Datei im Ordner; sie wird nie überschrieben oder gelöscht. */
export const HANDGEPFLEGT = "zeichen.tsx";

/** Inhalt des Light-Zeichens (ohne das umgebende svg-Element). */
export function lightInhalt(name: string): string {
  const Komponente = (Phosphor as unknown as Record<string, React.ComponentType<{ weight: string }>>)[name];
  if (!Komponente) throw new Error(`Phosphor kennt kein Zeichen „${name}“.`);
  const svg = renderToStaticMarkup(createElement(Komponente, { weight: "light" }));
  const m = /^<svg[^>]*>([\s\S]*)<\/svg>$/.exec(svg);
  if (!m?.[1]) throw new Error(`Zeichen „${name}“ ohne Inhalt.`);
  return m[1];
}

/** Alle erzeugten Dateien: Pfad relativ zu src/ und Inhalt. */
export function erzeugeIcons(): Record<string, string> {
  const namen = [...ZEICHEN].sort((a, b) => a.localeCompare(b));
  const dateien: Record<string, string> = {};
  for (const name of namen) {
    dateien[`icons/${name}.tsx`] = [
      "/* Erzeugt durch scripts/icons.ts aus Phosphor (Light). Nicht von Hand ändern. */",
      'import { zeichen } from "./zeichen";',
      `export const ${name}Icon = /* @__PURE__ */ zeichen(${JSON.stringify(name)}, ${JSON.stringify(lightInhalt(name))});`,
      "",
    ].join("\n");
  }
  dateien["icons.tsx"] = [
    "/**",
    " * Die einzige Quelle der Zeichen: Phosphor, Gewichtung Light. Zeichen kommen von hier, nie direkt aus @phosphor-icons/react (ESLint verbietet den Import),",
    " * damit Gewichtung und Standardgröße überall gleich sind. Jedes Zeichen heißt `<Name>Icon` (Schreibweise von phosphoricons.com) und trägt",
    ' * `data-glyph="<Name>"` für Tests. Erzeugt durch scripts/icons.ts; neues Zeichen: dort ergänzen und `pnpm --filter @carraway/ui icons` ausführen.',
    " */",
    'export type { IconProps, IconKomponente } from "./icons/zeichen";',
    ...namen.map((n) => `export { ${n}Icon } from "./icons/${n}";`),
    "",
  ].join("\n");
  return dateien;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dateien = erzeugeIcons();
  mkdirSync(ICONS_ORDNER, { recursive: true });
  for (const f of readdirSync(ICONS_ORDNER)) if (f !== HANDGEPFLEGT && !(`icons/${f}` in dateien)) rmSync(`${ICONS_ORDNER}${f}`);
  const wurzel = fileURLToPath(new URL("../src/", import.meta.url));
  for (const [pfad, inhalt] of Object.entries(dateien)) writeFileSync(`${wurzel}${pfad}`, inhalt);
  console.log(`geschrieben: ${Object.keys(dateien).length} Dateien in ${wurzel}`);
}
