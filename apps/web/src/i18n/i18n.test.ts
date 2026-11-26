import { describe, expect, it } from "vitest";
import { de } from "./de";
import { en } from "./en";
import { ladeTexte, registriereTexte, tabelleFuer } from "./index";
import { formatSchrittWert, uebersetzeSchritt } from "./schritte";

/** Flacht verschachtelte Tabellen zu Pfaden ab; Funktionen und Zeichenketten sind Blätter. */
function pfade(wert: unknown, praefix = ""): string[] {
  if (typeof wert === "object" && wert !== null) {
    return Object.entries(wert).flatMap(([schluessel, inhalt]) => pfade(inhalt, praefix ? `${praefix}.${schluessel}` : schluessel));
  }
  return [`${praefix}:${typeof wert}`];
}

describe("Texttabellen", () => {
  it("haben in beiden Sprachen dieselben Schlüssel und Arten (Zeichenkette oder Funktion)", () => {
    const deutsch = new Set(pfade(de));
    const englisch = new Set(pfade(en));
    expect([...deutsch].filter((p) => !englisch.has(p))).toEqual([]);
    expect([...englisch].filter((p) => !deutsch.has(p))).toEqual([]);
  });

  it("enthalten keine leeren Texte", () => {
    for (const tabelle of [de, en]) {
      const leer = pfade(tabelle).filter((p) => p.endsWith(":string"));
      expect(leer.length).toBeGreaterThan(50);
    }
    const alleTexte = (wert: unknown): string[] => (typeof wert === "string" ? [wert] : typeof wert === "object" && wert ? Object.values(wert).flatMap(alleTexte) : []);
    expect(alleTexte(de).filter((s) => s.trim() === "")).toEqual([]);
    expect(alleTexte(en).filter((s) => s.trim() === "")).toEqual([]);
  });
});

describe("Rechenschritte", () => {
  it("übersetzt bekannte Bezeichnungen ins Englische und formatiert eingebettete Daten", () => {
    expect(uebersetzeSchritt("Summe Abrufe", "en")).toBe("Total capital calls");
    expect(uebersetzeSchritt("NAV als Endwert am 2026-09-30", "en")).toBe("NAV as terminal value on 30/09/2026");
    expect(uebersetzeSchritt("NAV als Endwert am 2026-09-30", "de")).toBe("NAV als Endwert am 30.09.2026");
  });

  it("übersetzt die Bezeichnungen der Etappe 4 mit Präfixen und eingebetteten Daten", () => {
    expect(uebersetzeSchritt("Periode 2026-01-01 bis 2026-03-31: Fester Zins 2026-01-01 bis 2026-03-31 auf 100000", "en")).toBe("Period 01/01/2026 to 31/03/2026: Fixed interest 01/01/2026 to 31/03/2026 on 100,000");
    expect(uebersetzeSchritt("Laufendes Stück: Zinsbetrag", "en")).toBe("Running part: Interest amount");
    expect(uebersetzeSchritt("Zinsen bis Cut-off: Gewinnabhängiger Zins 2025 (2025-01-01 bis 2025-12-31)", "de")).toBe("Zinsen bis Cut-off: Gewinnabhängiger Zins 2025 (01.01.2025 bis 31.12.2025)");
    expect(uebersetzeSchritt("Zeitanteil 30E/360 (2026-01-01 bis 2026-03-31: 90 / 360)", "en")).toBe("Time fraction 30E/360 (01/01/2026 to 31/03/2026: 90 / 360)");
    expect(uebersetzeSchritt("Auszahlung am 2026-02-01", "en")).toBe("Disbursement on 01/02/2026");
    expect(uebersetzeSchritt("Agio (Wandlungsbetrag − Nominal − Spitzenbetrag)", "en")).toBe("Share premium (conversion amount − nominal − fractional amount)");
    expect(uebersetzeSchritt("Erlös", "en")).toBe("Proceeds");
  });

  it("lässt unbekannte Bezeichnungen unverändert", () => {
    expect(uebersetzeSchritt("Etwas Neues", "en")).toBe("Etwas Neues");
  });

  it("formatiert Dezimalzeichenketten je Sprache", () => {
    expect(formatSchrittWert("41717200", "de")).toBe("41.717.200");
    expect(formatSchrittWert("41717200", "en")).toBe("41,717,200");
    expect(formatSchrittWert("0.0229230483", "de")).toBe("0,0229");
    expect(formatSchrittWert("nicht definiert", "en")).toBe("not defined");
  });
});

describe("Wörterbücher laden", () => {
  it("liefert je Sprache genau das Wörterbuch dieser Sprache", async () => {
    registriereTexte("de", de);
    registriereTexte("en", en);
    expect(await ladeTexte("de")).toBe(de);
    expect(await ladeTexte("en")).toBe(en);
    expect(tabelleFuer("en")).toBe(en);
  });
});

/**
 * WCAG 2.5.3: Der zugängliche Name einer Schaltfläche enthält ihren sichtbaren Text. Die Texte „…Fuer“ sind die Namen mit Gegenstand
 * (`aria-label`), das Geschwister ohne „Fuer“ ist der sichtbare Text; der Name beginnt oder endet nicht damit, enthält ihn aber ganz.
 */
function paare(wert: unknown, pfad = ""): { pfad: string; sichtbar: string; name: (...a: unknown[]) => string }[] {
  if (typeof wert !== "object" || wert === null) return [];
  const o = wert as Record<string, unknown>;
  return Object.entries(o).flatMap(([k, v]) => {
    const hier = pfad ? `${pfad}.${k}` : k;
    if (typeof v === "function" && k.endsWith("Fuer")) {
      const sichtbar = o[k.slice(0, -4)];
      return typeof sichtbar === "string" ? [{ pfad: hier, sichtbar, name: v as (...a: unknown[]) => string }] : [];
    }
    return paare(v, hier);
  });
}

describe("Namen mit Gegenstand enthalten den sichtbaren Text", () => {
  for (const [sprache, tabelle] of [["de", de], ["en", en]] as const) {
    it(`${sprache}`, () => {
      const zuKurz = paare(tabelle).filter((p) => {
        const name = p.name("Beispiel", "Beispiel", "Beispiel").toLowerCase().replace(/[:,]/g, "");
        return !name.includes(p.sichtbar.toLowerCase().replace(/[:,]/g, ""));
      });
      expect(zuKurz.map((p) => `${p.pfad}: „${p.sichtbar}“ → „${p.name("Beispiel", "Beispiel", "Beispiel")}“`)).toEqual([]);
    });
  }
});
