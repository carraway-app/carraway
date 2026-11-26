/**
 * Führt die Tests aus, die von den geänderten Dateien erreicht werden (`vitest related`), in jedem betroffenen Paket:
 * dem Paket der Datei und allen, die davon abhängen. Das Vitest-Modulgraph reicht über Paketgrenzen, eine Änderung in
 * `packages/db` trifft also die Tests in `apps/api`, die sie importieren.
 *
 * Aufruf (aus dem Repo-Wurzelordner):
 *   tsx scripts/ci/test-related.ts --arbeitsbaum              Pre-Push: Merge-Basis mit origin/main bis Arbeitsbaum
 *   tsx scripts/ci/test-related.ts --basis HEAD^1             CI: `<basis>..HEAD`
 *   tsx scripts/ci/test-related.ts --pakete ...               nur die betroffenen Pakete ausgeben (Typecheck im Pre-Push)
 * Mit `--von-platte` laufen zusätzlich alle Tests, die Quelldateien von der Platte lesen (Ratsche, Auswertung von
 * Quelltext): Eine Änderung an der gelesenen Datei ist kein Import, `related` sieht sie nicht. In der CI immer, im Pre-Push nie.
 */
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { betroffenePakete, besitzer, ladePakete, type Paket } from "./pakete";
import { istDokumentation } from "./test-scope-rules";

const LIES_MUSTER = "readFileSync|readFile\\(|readdirSync|globSync|ls-files|existsSync|import\\.meta\\.glob";
const TESTDATEI = /\.test\.tsx?$/;

function git(...args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

const zeilen = (text: string) => text.split("\n").map((z) => z.trim()).filter(Boolean);

function geaenderteDateien(argv: string[]): string[] {
  const basisIdx = argv.indexOf("--basis");
  if (basisIdx >= 0) return zeilen(git("diff", "--name-only", "--diff-filter=ACMR", argv[basisIdx + 1]!, "HEAD"));
  let basis = process.env.PRE_PUSH_BASIS ?? "";
  if (!basis) {
    try {
      basis = git("merge-base", "HEAD", "origin/main").trim();
    } catch {
      basis = "HEAD~1";
    }
  }
  const nachweis = zeilen(git("diff", "--name-only", "--diff-filter=ACMR", basis, "--", "."));
  return nachweis;
}

/** Tests, die Dateien von der Platte lesen. Die Datenbank-Migrationstests gehören nicht dazu: sie ändern sich nur mit Schema und Migrationen (immer `full`). */
function lesendeTests(): string[] {
  let treffer: string[];
  try {
    treffer = zeilen(git("grep", "-l", "-E", LIES_MUSTER, "--", "apps/**/*.ts", "apps/**/*.tsx", "packages/**/*.ts", "packages/**/*.tsx", "ee/**/*.ts", "ee/**/*.tsx"));
  } catch {
    treffer = []; // git grep endet mit 1, wenn nichts passt
  }
  return treffer.filter((f) => TESTDATEI.test(f) && !f.startsWith("packages/db/"));
}

/**
 * Im Pre-Push (`--arbeitsbaum`) laufen die Dateien in apps/api über vier Datenbank-Klone parallel (`TEST_DB_WORKERS`, siehe
 * apps/api/src/__tests__/worker-db.ts), sofern die Variable nicht gesetzt ist; ein Router-Change erreicht dort schnell viele Tests.
 * Die Leistungstests laufen dann nicht mit (nur im Workflow volle-suite.yml). In der CI gilt, was der Workflow setzt.
 */
function umgebung(): NodeJS.ProcessEnv {
  if (process.argv.includes("--arbeitsbaum") && process.env.TEST_DB_WORKERS === undefined) return { ...process.env, TEST_DB_WORKERS: "4" };
  return process.env;
}

function laufe(p: Paket, dateien: string[]): number {
  if (dateien.length === 0) return 0;
  console.log(`\ntest-related: ${p.name} (${dateien.length} Datei${dateien.length === 1 ? "" : "en"})`);
  const erg = spawnSync("pnpm", ["exec", "vitest", "related", "--run", "--passWithNoTests", "--reporter=dot", ...dateien.map((d) => path.resolve(d))], {
    cwd: path.resolve(p.dir),
    stdio: "inherit",
    env: umgebung(),
  });
  return erg.status ?? 1;
}

function main(): void {
  const argv = process.argv.slice(2);
  const pakete = ladePakete();
  const geaendert = geaenderteDateien(argv);
  const code = geaendert.filter((f) => !istDokumentation(f));
  const betroffen = betroffenePakete(pakete, code);

  if (argv.includes("--pakete")) {
    for (const p of betroffen) if (p.hatTypecheck) console.log(p.dir);
    return;
  }

  let fehler = 0;
  for (const p of betroffen.filter((x) => x.hatTests)) {
    // Dateien innerhalb des Pakets plus alles, was es von außen nutzt: Das Graph findet die Tests selbst, wir geben nur die geänderten Quellen.
    fehler += laufe(p, code) === 0 ? 0 : 1;
  }

  if (argv.includes("--von-platte")) {
    const lesend = lesendeTests();
    for (const p of pakete.filter((x) => x.hatTests)) {
      const eigene = lesend.filter((f) => besitzer(pakete, f)?.dir === p.dir).map((f) => path.relative(p.dir, f));
      if (eigene.length === 0) continue;
      console.log(`\ntest-related: ${p.name}, ${eigene.length} Tests, die Quelltext von der Platte lesen`);
      const erg = spawnSync("pnpm", ["exec", "vitest", "run", "--reporter=dot", ...eigene], { cwd: path.resolve(p.dir), stdio: "inherit" });
      if (erg.status !== 0) fehler += 1;
    }
  }
  process.exit(fehler === 0 ? 0 : 1);
}

main();
