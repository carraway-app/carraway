// @vitest-environment node
import { ESLint } from "eslint";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HANDGEPFLEGT, ICONS_ORDNER, ZEICHEN, erzeugeIcons } from "../scripts/icons";
import * as Zeichen from "./icons";

const WURZEL = fileURLToPath(new URL("../../..", import.meta.url));

describe("Zeichenmodul (Erzeugnis)", () => {
  const src = fileURLToPath(new URL("./", import.meta.url));

  it("ist mit dem Erzeuger synchron (sonst: pnpm --filter @carraway/ui icons)", () => {
    for (const [pfad, inhalt] of Object.entries(erzeugeIcons())) expect(readFileSync(`${src}${pfad}`, "utf8"), pfad).toBe(inhalt);
  });

  it("hat im Ordner nur die erzeugten Dateien und die von Hand gepflegte", () => {
    const erwartet = [...Object.keys(erzeugeIcons()).filter((p) => p.startsWith("icons/")).map((p) => p.slice(6)), HANDGEPFLEGT].sort();
    expect(readdirSync(ICONS_ORDNER).sort()).toEqual(erwartet);
  });

  it("exportiert zu jedem Eintrag in ZEICHEN ein `<Name>Icon`", () => {
    const exportiert = Object.keys(Zeichen)
      .filter((k) => k.endsWith("Icon"))
      .map((k) => k.slice(0, -4))
      .sort();
    expect(exportiert).toEqual([...ZEICHEN].sort());
  });
});

describe("ESLint-Regel für Zeichen", () => {
  const eslint = new ESLint({ cwd: WURZEL });
  const pruefe = async (pfad: string, code: string) => (await eslint.lintText(code, { filePath: `${WURZEL}/${pfad}` }))[0]?.messages ?? [];

  it("verbietet den direkten Import aus dem Paket in der Anwendung", async () => {
    const meldungen = await pruefe("apps/web/src/seiten/x.tsx", 'import { House } from "@phosphor-icons/react";\nexport const a = House;\n');
    expect(meldungen.some((m) => m.ruleId === "no-restricted-imports")).toBe(true);
  });

  it("verbietet auch den Eintrittspunkt für Serverseiten", async () => {
    const meldungen = await pruefe("packages/ui/src/komponenten/x.tsx", 'import { House } from "@phosphor-icons/react/ssr";\nexport const a = House;\n');
    expect(meldungen.some((m) => m.ruleId === "no-restricted-imports")).toBe(true);
  });

  it("erlaubt den Import im Erzeuger der Zeichen", async () => {
    const meldungen = await pruefe("packages/ui/scripts/icons.ts", 'import * as P from "@phosphor-icons/react/ssr";\nexport const a = P;\n');
    expect(meldungen.some((m) => m.ruleId === "no-restricted-imports")).toBe(false);
  });
});
