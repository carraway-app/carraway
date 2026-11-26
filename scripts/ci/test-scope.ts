/**
 * CI-Schritt: entscheidet den Testumfang dieses Laufs (Regeln in `test-scope-rules.ts`).
 *
 * Aufruf (aus .github/workflows/ci.yml):
 *   tsx scripts/ci/test-scope.ts <basis>
 *
 * `<basis>` ist der Commit, gegen den der Pull Request verglichen wird. Bei `pull_request` ist der Checkout der Merge-Commit
 * von GitHub; `HEAD^1` ist die Spitze des Basis-Branches, `HEAD^1..HEAD` genau das, was der Merge ändern würde. Beim Push
 * auf main gilt dieselbe Logik für den gemergten Commit (`HEAD^1..HEAD`). Ohne GITHUB_EVENT_NAME (lokal) wird ebenso entschieden,
 * damit sich die Regeln an Beispieldiffs ausprobieren lassen: `tsx scripts/ci/test-scope.ts origin/main`.
 * Die ganze Suite läuft nur im Workflow `volle-suite.yml` (von Hand und vor einem Release).
 *
 * Schreibt `scope` und `reason` nach $GITHUB_OUTPUT und einen Abschnitt nach $GITHUB_STEP_SUMMARY.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { betroffenePakete, ladePakete } from "./pakete";
import { decideTestScope, istDokumentation, type TestScope } from "./test-scope-rules";

function git(...args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function anDatei(envVar: string, text: string): void {
  const ziel = process.env[envVar];
  if (ziel) fs.appendFileSync(ziel, text);
}

function main(): void {
  const basis = process.argv[2] ?? "HEAD^1";
  const ereignis = process.env.GITHUB_EVENT_NAME ?? "pull_request";
  const ohneVergleich = ereignis !== "pull_request" && ereignis !== "push";
  let scope: TestScope;
  let grund: string;
  let geaendert: string[] = [];

  if (ohneVergleich) {
    scope = "full";
    grund = `${ereignis}: immer die ganze Suite`;
  } else {
    geaendert = git("diff", "--name-only", basis, "HEAD").split("\n").map((z) => z.trim()).filter(Boolean);
    const entscheidung = decideTestScope(geaendert);
    scope = entscheidung.scope;
    if (scope === "full") {
      const gezeigt = entscheidung.triggers.slice(0, 5).join(", ");
      grund = `Änderungen, von denen jeder Test abhängen kann: ${gezeigt}${entscheidung.triggers.length > 5 ? ", …" : ""}`;
    } else if (scope === "docs") {
      grund = "nur Dokumentation: keine Tests";
    } else {
      const namen = betroffenePakete(ladePakete(), geaendert.filter((f) => !istDokumentation(f))).map((p) => p.dir);
      grund = `nur erreichte Tests in: ${namen.length > 0 ? namen.join(", ") : "keinem Paket"}`;
    }
  }

  anDatei("GITHUB_OUTPUT", `scope=${scope}\nreason=${grund}\n`);
  anDatei(
    "GITHUB_STEP_SUMMARY",
    ["### Testumfang", "", `**${scope}**: ${grund}.`, "", ...(!ohneVergleich ? [`${geaendert.length} geänderte Datei(en) gegen \`${basis}\`.`, ""] : [])].join("\n"),
  );
  console.log(`scope=${scope} (${grund})`);
}

main();
