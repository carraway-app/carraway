import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { de } from "./de";
import { en } from "./en";
import { uebersetzeSchritt } from "./schritte";

/** Quelltexte der Pakete; die Tests laufen im Verzeichnis `apps/web`. */
const lies = (pfad: string) => readFileSync(resolve(process.cwd(), pfad), "utf8");

describe("Meldungen: Übersetzungen", () => {
  it("jede Bezeichnung eines Herkunftsschritts der Meldungen ist ins Englische übersetzt", () => {
    const quelle = lies("../../packages/berichte/src/melde/schritte.ts");
    const bezeichnungen = [...quelle.matchAll(/^\s+\w+: "([^"]+)",$/gm)].map((m) => m[1]!);
    expect(bezeichnungen.length).toBeGreaterThan(40);
    const fehlend = bezeichnungen.filter((b) => uebersetzeSchritt(b, "en") === b && !["Operand"].includes(b));
    expect(fehlend).toEqual([]);
    // Deutsch bleibt unverändert
    for (const b of bezeichnungen) expect(uebersetzeSchritt(b, "de")).toBe(b);
  });

  it("jeder Code der Prüfregeln hat in beiden Sprachen einen Text", () => {
    const quelle = lies("../../packages/berichte/src/melde/regeln.ts");
    const codes = /BEFUND_CODES = \[([^\]]+)\]/.exec(quelle)![1]!.match(/"([A-Z_]+)"/g)!.map((c) => c.replaceAll('"', ""));
    expect(codes.length).toBe(5);
    for (const tabelle of [de, en]) for (const code of codes) expect(Object.hasOwn(tabelle.melde.lauf.befunde.codes, code), code).toBe(true);
  });

  it("jeder Fehlercode der Definitionsprüfung aus dem Paket hat einen Text in beiden Sprachen (oder fällt auf die Meldung zurück)", () => {
    const quelle = lies("../../packages/berichte/src/melde/definition.ts");
    const codes = [...new Set([...quelle.matchAll(/code: "([a-z_]+)"/g)].map((m) => m[1]!))];
    // Diese Codes erscheinen nur mit der deutschen Meldung der API; die übrigen sind übersetzt.
    const ohneUebersetzung = new Set(["zu_klein", "zu_gross", "format_ungueltig", "ungueltig", "bereich_leer", "zahl_operanden", "filter_nicht_erlaubt", "pflicht_nur_felder", "summe_nur_zahlen"]);
    for (const code of codes.filter((c) => !ohneUebersetzung.has(c))) {
      expect(Object.hasOwn(de.melde.verwaltung.editor.codes, code), `de ${code}`).toBe(true);
      expect(Object.hasOwn(en.melde.verwaltung.editor.codes, code), `en ${code}`).toBe(true);
    }
  });

  it("die Oberfläche kennt dieselben Schlüssel in beiden Sprachen", () => {
    const schluessel = (o: unknown, pfad = ""): string[] =>
      o && typeof o === "object" ? Object.entries(o).flatMap(([k, v]) => (typeof v === "function" ? [`${pfad}${k}`] : schluessel(v, `${pfad}${k}.`))) : [pfad.slice(0, -1)];
    expect(schluessel(en.melde).sort()).toEqual(schluessel(de.melde).sort());
  });
});
