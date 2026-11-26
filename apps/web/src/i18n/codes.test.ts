import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { de } from "./de";
import { en } from "./en";
import { BEFUND_CODES, befundMeldung, befundTitel } from "./befunde";
import { uebersetzeSchritt } from "./schritte";

/** Quelltext der API; die Tests laufen im Verzeichnis `apps/web`. */
const lies = (pfad: string) => readFileSync(resolve(process.cwd(), "../api", pfad), "utf8");

/** Alle Fehlercodes der API stehen als Typ `Fehlercode` in `apps/api/src/fehler.ts`; jeder muss in beiden Sprachen übersetzt sein. */
function apiCodes(): string[] {
  const quelle = lies("src/fehler.ts");
  const block = /export type Fehlercode =([\s\S]*?);/.exec(quelle)?.[1] ?? "";
  return [...block.matchAll(/"([A-Z][A-Z0-9_]+)"/g)].map((m) => m[1]!);
}

describe("Fehlercodes der API", () => {
  it("sind in beiden Sprachen übersetzt", () => {
    const codes = apiCodes();
    expect(codes.length).toBeGreaterThan(80);
    expect(codes.filter((c) => !Object.hasOwn(de.fehler, c))).toEqual([]);
    expect(codes.filter((c) => !Object.hasOwn(en.fehler, c))).toEqual([]);
  });

  it("haben keine leeren Texte", () => {
    for (const tabelle of [de.fehler, en.fehler] as Record<string, unknown>[]) {
      for (const [code, text] of Object.entries(tabelle)) if (typeof text === "string") expect(text.trim(), code).not.toBe("");
    }
  });
});

describe("Kontrollbericht der Berichte", () => {
  const codes = ["PORTFOLIO_SUMME_ABWEICHUNG", "NAV_ABWEICHUNG", "NAV_SALDEN_FEHLEN", "BEWERTUNG_FEHLT", "ABRUFE_UEBER_ZEICHNUNG", "ENTWURF_BEWERTUNG_OFFEN", "KAPITALKONTEN_ABWEICHUNG", "PAI_BEWERTUNGSBASIS_ABWEICHUNG"];

  it("übersetzt jeden Code der API mit Parametern in beiden Sprachen", () => {
    for (const tabelle of [de, en]) {
      for (const code of codes) {
        const eintrag = tabelle.bericht.kontrolle.codes[code];
        expect(eintrag, code).toBeTruthy();
        expect(eintrag!.ok.length).toBeGreaterThan(10);
        expect(eintrag!.abweichung(3)).toContain(eintrag!.abweichung(3).trim());
      }
    }
    expect(de.bericht.kontrolle.codes.BEWERTUNG_FEHLT!.abweichung(3)).toBe("3 aktive Beteiligungen haben keine freigegebene Bewertung zum Stichtag.");
    expect(en.bericht.kontrolle.codes.BEWERTUNG_FEHLT!.abweichung(1)).toBe("One active holding has no released valuation at the reporting date.");
  });

  it("deckt die Codes der API-Quelle ab", () => {
    const quelle = lies("src/berichte/kontrolle.ts");
    const imQuelltext = new Set([...quelle.matchAll(/pruefung\(\s*"[a-z_]+",\s*"([A-Z_]+)"/g)].map((m) => m[1]!));
    // Prüfungen der Berichtsarten aus Erweiterungen (PAI-Erklärung, ee/api/src/esg) stehen nicht in kontrolle.ts, ihre Texte schon.
    const ausErweiterungen = ["PAI_BEWERTUNGSBASIS_ABWEICHUNG"];
    expect([...imQuelltext, ...ausErweiterungen].sort()).toEqual([...codes].sort());
  });
});

describe("Kontrollbericht der Zinsläufe", () => {
  it("übersetzt jeden Code und den Hinweiscode der API", () => {
    const quelle = lies("src/routen/zinslaeufe.ts");
    const codes = [...new Set([...quelle.matchAll(/ergebnis\(\s*"[a-z_]+",\s*"([A-Z_]+)"/g)].map((m) => m[1]!))];
    expect(codes.length).toBe(5);
    const hinweisCodes = [...quelle.matchAll(/hinweisCode: "([A-Z_]+)"/g)].map((m) => m[1]!);
    for (const tabelle of [de, en]) {
      for (const code of codes) expect(Object.hasOwn(tabelle.zinslauf.kontrolle.codes, code), code).toBe(true);
      for (const code of hinweisCodes) expect(Object.hasOwn(tabelle.zinslauf.kontrolle.hinweise, code), code).toBe(true);
    }
  });
});

describe("Rechenschritte der Forderungen", () => {
  it("übersetzt die neuen Bezeichnungen des NAV und der Bewertung mit Forderungen", () => {
    expect(uebersetzeSchritt("Offene Kaufpreisforderungen", "en")).toBe("Open purchase price receivables");
    expect(uebersetzeSchritt("Bewertung zum Stichtag (mit Forderungen)", "en")).toBe("Valuation at the reporting date (including receivables)");
    expect(uebersetzeSchritt("Offene Kaufpreisforderungen", "de")).toBe("Offene Kaufpreisforderungen");
  });
});

describe("Befunde der Datenübernahme", () => {
  /** Die Prüfung meldet mit `melde(…, "CODE", …)` und `code: "CODE"`; alle Zeichenketten in Großbuchstaben der Quellen, abzüglich der Lesefehler der Datei. */
  const quellen = ["src/import/pruefen.ts", "../../packages/import/src/regeln.ts", "../../packages/import/src/typisieren.ts", "../../packages/import/src/lesen.ts"];
  const KEINE_BEFUNDE = new Set(["ERR_BUFFER_TOO_LARGE", "DATEI_BESCHAEDIGT", "DATEI_LEER", "DATEI_ZU_GROSS", "DATEITYP_UNBEKANNT", "BLATT_NICHT_ERKANNT"]);

  it("übersetzt jeden Code der Prüfung in beiden Sprachen", () => {
    const codes = [...new Set(quellen.flatMap((q) => [...lies(q).matchAll(/"([A-Z][A-Z0-9_]{4,})"/g)].map((m) => m[1]!)))].filter((c) => !KEINE_BEFUNDE.has(c));
    expect(codes.length).toBeGreaterThan(50);
    const ohne = codes.filter((c) => !Object.hasOwn(BEFUND_CODES, c));
    // Codes, die die Prüfung von den Regeln der Instrumente übernimmt, stehen in der Fehlertabelle.
    expect(ohne.filter((c) => !Object.hasOwn(de.fehler, c))).toEqual([]);
    for (const e of Object.values(BEFUND_CODES)) {
      expect(e.de.trim()).not.toBe("");
      expect(e.en.trim()).not.toBe("");
      expect(e.text({ wert: "x", schluessel: "x", spalte: "x", blatt: "x", grund: "betrag" }).trim()).not.toBe("");
      expect(e.text({}).trim()).not.toBe("");
    }
  });

  it("zeigt für Befunde alter Läufe ohne params den gespeicherten Text, solange der englische Satz Werte bräuchte", () => {
    const alt = { code: "BETEILIGUNG_STATUS_ABWEICHEND", meldung: "Der Stand der Beteiligung ist im Bestand „aktiv“, die Datei sagt „exit“; er wird nicht geändert." };
    expect(befundMeldung(alt, "en", en.fehler)).toBe(alt.meldung);
    expect(befundMeldung({ ...alt, params: {} }, "en", en.fehler)).toBe(alt.meldung);
    expect(befundMeldung({ ...alt, params: null }, "en", en.fehler)).toBe(alt.meldung);
    // Ein Satz ohne Werte bleibt auch ohne params englisch.
    expect(befundMeldung({ code: "KOPF_SPRACHE_GEMISCHT", meldung: "Der Kopf mischt Sprachen.", params: {} }, "en", en.fehler)).toBe("The column headers mix German and English names.");
  });

  it("baut den englischen Satz aus den params des Befunds, ohne die deutsche Meldung zu zerlegen", () => {
    const b = { code: "BETEILIGUNG_STATUS_ABWEICHEND", meldung: "Der Stand der Beteiligung ist im Bestand „aktiv“, die Datei sagt „exit“; er wird nicht geändert.", params: { bestand: "aktiv", datei: "exit" } };
    expect(befundMeldung(b, "en", en.fehler)).toBe("The status of the holding in the existing data is “aktiv”, the file says “exit”; it is not changed.");
    expect(befundMeldung(b, "de", de.fehler)).toBe(b.meldung);
    expect(befundTitel(b.code, "en", en.fehler)).toBe("Status differs");
    expect(befundTitel("UNBEKANNT_XY", "en", en.fehler)).toBe("UNBEKANNT_XY");
    expect(befundMeldung({ code: "UNBEKANNT_XY", meldung: "Etwas." }, "en", en.fehler)).toBe("Etwas.");
    // Werte stehen nur in params: eine deutsche Meldung ohne Anführungszeichen ändert den englischen Satz nicht.
    expect(befundMeldung({ code: "DATUM_UNGUELTIG", meldung: "x", params: { wert: "31.02.2026" } }, "en", en.fehler)).toBe("“31.02.2026” is not a valid date (YYYY-MM-DD or DD.MM.YYYY).");
    expect(befundMeldung({ code: "STORNO_UNGUELTIG", meldung: "x", params: { grund: "betrag", erwartet: "-10.00" } }, "en", en.fehler)).toBe("The amount of a reversal must be -10.00.");
  });
});

describe("Rechenschritte des Exit-Wasserfalls", () => {
  it("übersetzt jede Bezeichnung des Rechenkerns ins Englische (Klassennamen bleiben)", () => {
    const quelle = readFileSync(resolve(process.cwd(), "../../packages/rechenkern/src/wasserfall.ts"), "utf8");
    const bezeichnungen = [...quelle.matchAll(/bezeichnung: ([`"])((?:(?!\1).)*)\1/g)].map((m) => m[2]!.replace(/\$\{([^}]*)\}/g, (_x, ausdruck: string) => (/rang/.test(ausdruck) ? "1" : "Klasse A")));
    expect(bezeichnungen.length).toBeGreaterThan(15);
    for (const text of new Set(bezeichnungen)) {
      const englisch = uebersetzeSchritt(text, "en");
      expect(englisch, text).not.toBe(text);
      expect(uebersetzeSchritt(text, "de"), text).toBe(text);
      if (text.includes("Klasse A")) expect(englisch, text).toContain("Klasse A");
    }
  });
});

describe("Befundcodes der Etappe 18", () => {
  /** Alle Zeichenketten `code: "X"` und `"X"` im Typ `BefundCode` der Quellen. */
  const codesIn = (pfad: string) => [...new Set([...lies(pfad).matchAll(/code: "([A-Z][A-Z0-9_]+)"/g)].map((m) => m[1]!))];

  it("übersetzt jeden Abgleichscode des Registers in beiden Sprachen", () => {
    const block = /export type BefundCode =([\s\S]*?);/.exec(lies("src/register/abgleich.ts"))?.[1] ?? "";
    const codes = [...block.matchAll(/"([A-Z][A-Z0-9_]+)"/g)].map((m) => m[1]!);
    expect(codes.length).toBe(6);
    for (const tabelle of [de, en]) for (const code of codes) expect(tabelle.register.abweichungen.codes[code]?.trim().length, code).toBeGreaterThan(10);
  });

  it("übersetzt jeden Befundcode der Szenarien in der Oberfläche und im Bericht", async () => {
    const codes = codesIn("src/szenarien/rechnen.ts");
    expect(codes.length).toBeGreaterThanOrEqual(9);
    const { TEXTE } = await import("../../../../packages/berichte/src/texte");
    for (const code of codes) {
      for (const tabelle of [de, en]) expect(tabelle.szenarien.vergleich.befunde.codes[code]?.("Name", { jahr: 2030, betrag: "1" }).trim().length, code).toBeGreaterThan(10);
      for (const sprache of ["de", "en"] as const) expect(TEXTE[sprache].szenario.befunde[code]?.trim().length, `${sprache} ${code}`).toBeGreaterThan(10);
    }
  });

  it("übersetzt jeden Befundcode der Reserven in beiden Sprachen", () => {
    const codes = codesIn("src/szenarien/reserven.ts");
    expect(codes.sort()).toEqual(["KEINE_GEBUEHRENANNAHME", "VERFUEGBAR_NEGATIV"]);
    for (const tabelle of [de, en]) for (const code of codes) expect(tabelle.szenarien.reservenSeite.befunde[code]?.trim().length, code).toBeGreaterThan(10);
  });

  it("übersetzt Statuswerte, Quellen und Kennzahlen des Vergleichs vollständig", () => {
    const kennzahlen = [...(lies("src/szenarien/dienst.ts").matchAll(/zeile\("([A-Za-z]+)"/g))].map((m) => m[1]!);
    expect(kennzahlen.length).toBe(13);
    for (const tabelle of [de, en]) for (const k of kennzahlen) expect(tabelle.szenarien.vergleich.kennzahlen[k]?.trim().length, k).toBeGreaterThan(5);
    for (const tabelle of [de, en]) {
      for (const q of ["wasserfall", "quote", "multiple", "abschreibung", "keine"]) expect(tabelle.szenarien.vergleich.quellen[q], q).toBeTruthy();
      for (const a of ["neueintragung", "aenderung_geschaeftsfuehrung", "kapitalerhoehung", "sitzverlegung", "insolvenz", "loeschung", "sonstiges"]) expect(tabelle.register.ereignisse.art[a], a).toBeTruthy();
    }
  });
});
