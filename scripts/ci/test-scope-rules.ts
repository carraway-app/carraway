/**
 * Welchen Teil der Tests ein Pull Request braucht, allein aus den geänderten Dateien entschieden (rein, damit sich die
 * Regeln leicht prüfen lassen).
 *
 * - `docs`: jede geänderte Datei ist Dokumentation. Kein Test.
 * - `full`: eine Datei hat sich geändert, von der jeder Test abhängen kann, ohne sie zu importieren (Schema und
 *   Migrationen, Testaufbau, Vitest-Konfiguration, Abhängigkeiten, CI). Im PR-CI läuft dann die ganze Suite (Job `suite`).
 * - `changed`: alles andere. Es laufen die Tests, die von den geänderten Dateien erreicht werden (`test-related.ts`).
 *
 * Der Push auf main nutzt dieselbe Logik für den gemergten Commit. Die ganze Suite läuft sonst nur im Workflow `volle-suite.yml`.
 */

export type TestScope = "docs" | "full" | "changed";

export interface ScopeDecision {
  scope: TestScope;
  /** Die geänderten Dateien, die `full` ausgelöst haben, sonst leer. */
  triggers: string[];
}

/** Dokumentation: `docs/**` und jede Markdown-Datei. Kein Test liest sie. */
const DOCS = [/^docs\//, /\.md$/];

/** Dateien, von denen jeder Test abhängen kann, ohne sie statisch zu importieren; `vitest related` sieht sie nicht. */
export const FULL_SUITE_TRIGGERS: readonly RegExp[] = [
  /(^|\/)package\.json$/,
  /^pnpm-lock\.yaml$/,
  /^pnpm-workspace\.yaml$/,
  /^\.npmrc$/,
  /^\.nvmrc$/,
  /(^|\/)vitest\.config\.[cm]?[jt]s$/,
  /(^|\/)vite\.config\.[cm]?[jt]s$/,
  /(^|\/)tsconfig[^/]*\.json$/,
  // Schema, Migrationen, Migrationsläufer und Schutz der Testdatenbank.
  /^packages\/db\/drizzle\//,
  /^packages\/db\/src\/schema[^/]*\.ts$/,
  /^packages\/db\/src\/migrationen\.ts$/,
  /^packages\/db\/src\/schutz\.ts$/,
  /^packages\/db\/scripts\//,
  // Testaufbau: Setup-Dateien und je Worker geklonte Datenbank.
  /^(apps|packages|ee)\/[^/]+\/src\/(__tests__\/)?(global-)?setup\.ts$/,
  /^(apps|packages|ee)\/[^/]+\/src\/test\/setup\.ts$/,
  /^ee\/api\/src\/__tests__\/hilfen-voll\.ts$/,
  /^apps\/api\/src\/__tests__\/(global-setup|setup|worker-db)\.ts$/,
  /^packages\/db\/src\/__tests__\/global-setup\.ts$/,
  /^\.github\//,
  /^scripts\/ci\//,
  /^scripts\/git\//,
];

export function decideTestScope(changedFiles: readonly string[]): ScopeDecision {
  const files = changedFiles.filter((file) => file.trim() !== "");
  const triggers = files.filter((file) => FULL_SUITE_TRIGGERS.some((pattern) => pattern.test(file)));
  if (triggers.length > 0) return { scope: "full", triggers };
  if (files.length > 0 && files.every((file) => DOCS.some((pattern) => pattern.test(file)))) return { scope: "docs", triggers: [] };
  return { scope: "changed", triggers: [] };
}

export function istDokumentation(file: string): boolean {
  return DOCS.some((pattern) => pattern.test(file));
}
