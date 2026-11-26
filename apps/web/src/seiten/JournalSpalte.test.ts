import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/app.css"), "utf8");
const regeln = (waehler: string) => [...css.matchAll(/(^|\n)([^{}\n]+)\{([^}]*)\}/g)].filter((m) => m[2]!.split(",").some((w) => w.trim() === waehler)).map((m) => m[3]!);

describe("Journal: Aktionsspalte bleibt bei waagerechtem Scrollen stehen", () => {
  it("die Tabelle selbst ist das eine Scroll-Fenster, dazwischen setzt kein Element Overflow (sonst klebt die Spalte am falschen Rahmen)", () => {
    const aussen = regeln(".app-journal").join(" ");
    expect(aussen).toMatch(/overflow:\s*auto/);
    // Zwischen Zelle und Scroll-Fenster liegen die Zeile und das Zeilenfenster: beide ohne Overflow-Angabe.
    for (const w of [".app-journal__zeile", ".app-journal__fenster"]) expect(regeln(w).join(" "), w).not.toMatch(/overflow(-x|-y)?:\s*(auto|scroll|hidden)/);
  });

  it("die letzte Zelle jeder Zeile (und der Kopfzeile) klebt rechts mit deckendem Grund, der Kopf klebt oben", () => {
    expect(regeln(".app-journal__zeile > :last-child").join(" ")).toMatch(/position:\s*sticky;[^}]*right:\s*0[^}]*background:\s*var\(--cw-bg\)/);
    expect(regeln(".app-journal__kopf > :last-child").join(" ")).toMatch(/background:\s*var\(--cw-surface\)/);
    expect(regeln(".app-journal__kopf").join(" ")).toMatch(/position:\s*sticky;\s*top:\s*0/);
  });
});
