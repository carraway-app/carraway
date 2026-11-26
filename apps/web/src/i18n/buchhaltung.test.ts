import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buchhaltungDe, buchhaltungFehlerDe } from "./buchhaltung";
import { buchhaltungEn, buchhaltungFehlerEn } from "./buchhaltung.en";

/** Quelltext der API und der Pakete; die Tests laufen im Verzeichnis `apps/web`. */
const lies = (pfad: string) => readFileSync(resolve(process.cwd(), pfad), "utf8");
const codes = (quelle: string, muster: RegExp) => [...new Set([...quelle.matchAll(muster)].map((m) => m[1]!))];

describe("Buchhaltung: Übersetzungen", () => {
  it("jeder Befundcode der Saldenliste ist in beiden Sprachen übersetzt", () => {
    const quellen = lies("../api/src/buchhaltung/saldenpruefung.ts") + lies("../../packages/import/src/susa.ts");
    const gefunden = codes(quellen, /"(SUSA_[A-Z_]+)"/g);
    expect(gefunden.length).toBeGreaterThan(10);
    for (const tabelle of [buchhaltungDe.befundCodes, buchhaltungEn.befundCodes]) {
      expect(gefunden.filter((c) => !Object.hasOwn(tabelle, c))).toEqual([]);
      for (const text of Object.values(tabelle)) expect(text.trim()).not.toBe("");
    }
  });

  it("jedes Problem des Buchungsexports ist in beiden Sprachen übersetzt", () => {
    const gefunden = codes(lies("../../packages/import/src/datev-extf.ts"), /"(EXPORT_[A-Z_]+)"/g);
    expect(gefunden.length).toBe(5);
    for (const tabelle of [buchhaltungDe.export.problemCodes, buchhaltungEn.export.problemCodes]) expect(gefunden.filter((c) => !Object.hasOwn(tabelle, c))).toEqual([]);
  });

  it("jedes Feld der Belegkataloge hat eine Bezeichnung in beiden Sprachen", () => {
    const gefunden = codes(lies("../api/src/buchhaltung/belegfelder.ts"), /\bf\("([a-z_]+)", "/g);
    expect(gefunden.length).toBeGreaterThan(30);
    for (const tabelle of [buchhaltungDe.felder, buchhaltungEn.felder]) expect(gefunden.filter((c) => !Object.hasOwn(tabelle, c))).toEqual([]);
  });

  it("die neuen Fehlercodes der API sind übersetzt und haben dieselben Schlüssel in beiden Sprachen", () => {
    const quelle = /export type Fehlercode =([\s\S]*?);/.exec(lies("../api/src/fehler.ts"))?.[1] ?? "";
    const neue = codes(quelle, /"((?:BELEG|MITTELARTEN|KONTO|GLIEDERUNG|KONTENREGEL|SALDENLAUF|SALDENLISTE|BUCHHALTUNG|BUCHUNGSREGEL|BUCHUNGSEXPORT)_[A-Z_]+)"/g);
    expect(neue.length).toBeGreaterThan(25);
    for (const tabelle of [buchhaltungFehlerDe, buchhaltungFehlerEn]) expect(neue.filter((c) => !Object.hasOwn(tabelle, c))).toEqual([]);
    expect(Object.keys(buchhaltungFehlerDe).sort()).toEqual(Object.keys(buchhaltungFehlerEn).sort());
  });
});
