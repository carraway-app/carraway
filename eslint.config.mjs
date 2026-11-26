import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/drizzle/**", "**/coverage/**", "**/.claude/**", "ee/web/oeffentlich/excel-addin/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    // Die Abnahmeskripte laufen in Node und führen Funktionen im Browser aus (`page.evaluate`).
    files: ["scripts/abnahme/**/*.mjs"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}", "packages/ui/**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    // Zeichen kommen aus dem Zeichenmodul von @carraway/ui (Phosphor Light), nie direkt aus dem Paket.
    // Open Core (docs/open-core.md): Der Kern (apps/, packages/, scripts/) importiert nie aus ee/, weder über Paketnamen noch über relative Pfade.
    // Erweiterungen melden sich über die Erweiterungspunkte an; die Einstiege „Voll“ liegen selbst in ee/. Geprüft auch von scripts/ci/importregel.mjs.
    files: ["apps/**/*.{ts,tsx,mjs,js}", "packages/**/*.{ts,tsx,mjs,js}", "scripts/**/*.{ts,tsx,mjs,js}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["@phosphor-icons/*"], message: "Zeichen kommen aus @carraway/ui (packages/ui/src/icons.tsx, Phosphor Light). Fehlt eines, dort ergänzen (siehe scripts/icons.ts)." },
            { group: ["@carraway/ee-*", "@carraway/excel-addin", "@carraway/excel-addin/*"], message: "Der Kern importiert nie aus ee/ (docs/open-core.md). Erweiterungen melden sich über die Erweiterungspunkte an." },
            { regex: "(^|/)ee(/|$)", message: "Der Kern importiert nie aus ee/ (docs/open-core.md). Erweiterungen melden sich über die Erweiterungspunkte an." },
          ],
        },
      ],
      // Dynamische Importe prüft `no-restricted-imports` nicht; dieselbe Grenze für `import(...)`.
      "no-restricted-syntax": [
        "error",
        {
          selector: "ImportExpression[source.value=/(^|\\/)ee(\\/|$)|^@carraway\\/(ee-|excel-addin)/]",
          message: "Der Kern importiert nie aus ee/ (docs/open-core.md). Erweiterungen melden sich über die Erweiterungspunkte an.",
        },
      ],
    },
  },
  {
    // Der Erzeuger der Zeichen liest das Paket.
    files: ["packages/ui/scripts/icons.ts"],
    rules: { "no-restricted-imports": "off" },
  },
);
