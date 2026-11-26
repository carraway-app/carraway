import { describe, expect, it } from "vitest";
import { pruefeKonfiguration, standardKonfiguration } from "../konfiguration";
import { mitWaehrungssicht, portfolioSpalten, SICHT_PORTFOLIO, tabellenZeilen, waehrungsHinweise, zusatzSpalten, zusatzWertText } from "../listen";
import { TEXTE } from "../texte";
import type { BerichtsWaehrungssicht, PortfolioListeZeile, ZusatzSpalte } from "../typen";

const ID1 = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";
const t = TEXTE.de;

describe("Vorlage: eigene Felder als Spalten", () => {
  it("nur Arten mit Tabellenspalten, höchstens acht, ohne Doppelte, nur Kennungen", () => {
    expect(standardKonfiguration("portfolioliste").zusatzfelder).toEqual([]);
    expect(pruefeKonfiguration("portfolioliste", { zusatzfelder: [ID1, ID2] }).zusatzfelder).toEqual([ID1, ID2]);
    expect(() => pruefeKonfiguration("gremienvorlage", { zusatzfelder: [ID1] })).toThrow();
    expect(() => pruefeKonfiguration("portfolioliste", { zusatzfelder: [ID1, ID1] })).toThrow();
    expect(() => pruefeKonfiguration("portfolioliste", { zusatzfelder: ["kein-uuid"] })).toThrow();
    expect(() => pruefeKonfiguration("exitliste", { zusatzfelder: Array.from({ length: 9 }, (_, i) => `00000000-0000-4000-8000-00000000000${i}`) })).toThrow();
    // ältere Vorlagen ohne den Schlüssel gelten als ohne Felder
    expect(pruefeKonfiguration("fondsbericht", { einheit: "TEUR" }).zusatzfelder).toEqual([]);
  });
});

describe("Anzeige eigener Felder", () => {
  const def = (typ: ZusatzSpalte["typ"], extra: Partial<ZusatzSpalte> = {}): ZusatzSpalte => ({ id: ID1, name: "Feld", typ, objekt: "beteiligung", ...extra });
  it("formatiert nach Typ und Sprache; kein Wert ist keine Zahl", () => {
    expect(zusatzWertText(def("zahl"), "1234.5", t, "de")).toBe("1.234,5");
    expect(zusatzWertText(def("zahl"), "1234.5", TEXTE.en, "en")).toBe("1,234.5");
    expect(zusatzWertText(def("betrag", { waehrung: "USD" }), "1234.50", t, "de")).toContain("1.234,50");
    expect(zusatzWertText(def("datum"), "2026-03-31", t, "de")).toBe("31.03.2026");
    expect(zusatzWertText(def("kontrollkaestchen"), true, t, "de")).toBe("ja");
    expect(zusatzWertText(def("kontrollkaestchen"), false, TEXTE.en, "en")).toBe("no");
    const optionen = [{ schluessel: "a", label: "Alpha" }, { schluessel: "b", label: "Beta" }];
    expect(zusatzWertText(def("auswahl", { optionen }), "b", t, "de")).toBe("Beta");
    expect(zusatzWertText(def("mehrfachauswahl", { optionen }), ["a", "b"], t, "de")).toBe("Alpha, Beta");
    expect(zusatzWertText(def("text"), null, t, "de")).toBeNull();
    expect(zusatzWertText(def("text"), "", t, "de")).toBeNull();
  });

  it("Spalten stehen nach den festen Spalten, ein fehlender Wert zeigt einen Strich", () => {
    const spalten = zusatzSpalten<PortfolioListeZeile>([def("text", { name: "Sicherheit" })], t, "de");
    expect(spalten[0]!.kopf).toBe("Sicherheit");
    const mit = { felder: { [ID1]: "Grundschuld" } } as unknown as PortfolioListeZeile;
    const ohne = {} as PortfolioListeZeile;
    expect(spalten[0]!.format!(mit)).toBe("Grundschuld");
    expect(spalten[0]!.format!(ohne)).toBe("–");
  });
});

describe("Währungssicht in Listen", () => {
  const zeile = (name: string, sicht?: PortfolioListeZeile["sicht"]): PortfolioListeZeile =>
    ({ organisation: name, sektor: null, phase: null, instrument: "offene_beteiligung", status: "aktiv", betreuung: null, zusage: "0", investiert: "100.00", buchwert: "0", wertberichtigung: "0", offeneZusage: "0", bewertung: null, multiple: null, ...(sicht ? { sicht } : {}) }) as PortfolioListeZeile;
  const vergleich: BerichtsWaehrungssicht = { sicht: "vergleich", vergleich: "GBP", kurse: [{ von: "EUR", nach: "GBP", kurs: "0.87", kursDatum: "2026-06-30", tag: "2026-06-30", verwendung: "zeitwert" }], luecken: [] };
  const spaltenFuer = (sicht: BerichtsWaehrungssicht) => mitWaehrungssicht(portfolioSpalten(t).filter((s) => ["unternehmen", "investiert", "bewertung"].includes(s.schluessel)), sicht, SICHT_PORTFOLIO, t, "de", "EUR");

  it("Beträge in der Vergleichswährung mit Kopf und Summe; eine Lücke ist selbst eine Lücke", () => {
    const zeilen = [zeile("A", { waehrung: "GBP", investiert: "10.00", rueckfluesse: "0.00", bewertung: "20.00" }), zeile("B", { waehrung: "GBP", investiert: "5.50", rueckfluesse: "0.00", bewertung: null, ohneBewertung: true })];
    const spalten = spaltenFuer(vergleich);
    expect(spalten.map((s) => s.kopf)).toEqual(["Unternehmen", "Investiert (GBP)", "Bewertung (GBP)"]);
    const ausgabe = tabellenZeilen(spalten, zeilen, "de", "EUR", "EUR", "Summe");
    expect(ausgabe[0]![1]).toContain("10,00");
    expect(ausgabe[1]![2]).toBe("–"); // noch keine Bewertung ist keine Lücke
    expect(ausgabe[2]![1]).toContain("15,50"); // Summe
    const mitLuecke = [...zeilen, zeile("C", { waehrung: "GBP", investiert: null, rueckfluesse: null, bewertung: null })];
    const ohneKurs = tabellenZeilen(spalten, mitLuecke, "de", "EUR", "EUR", "Summe");
    expect(ohneKurs[2]![1]).toBe("Kurs fehlt");
    expect(ohneKurs[3]![1]).toBe("Kurs fehlt"); // Summenzeile
  });

  it("lokal: je Zeile in ihrer Währung, ohne Summe", () => {
    const spalten = spaltenFuer({ sicht: "lokal", vergleich: null, kurse: [], luecken: [] });
    expect(spalten.map((s) => s.kopf)).toEqual(["Unternehmen", "Investiert (lokal)", "Bewertung (lokal)"]);
    expect(spalten[1]!.summiert).toBe(false);
    const ausgabe = tabellenZeilen(spalten, [zeile("A", { waehrung: "USD", investiert: "100000.00", rueckfluesse: "0", bewertung: "160000.00" })], "de", "EUR", "EUR", "Summe");
    expect(ausgabe[0]![1]).toContain("$");
    expect(ausgabe[1]![1]).toBe("");
  });

  it("Hinweise nennen Sicht, Regel, Kurse mit Datum und Lücken; mehr als die Höchstzahl Kurse verweisen auf die Datei", () => {
    const h = waehrungsHinweise({ ...vergleich, luecken: [{ von: "EUR", nach: "GBP", tag: "2026-03-31", grund: "veraltet", letzterKursDatum: "2026-03-10", verwendung: "kosten" }] }, t, "de");
    expect(h[0]).toBe("Währungssicht: Vergleich in GBP.");
    expect(h[1]).toContain("Kurs der Valuta");
    expect(h).toContain("1 EUR = 0,87 GBP (Kurs vom 30.06.2026, für 30.06.2026)");
    expect(h.at(-1)).toBe("Kurs fehlt: EUR/GBP zum 31.03.2026 (letzter Kurs vom 10.03.2026, älter als sieben Tage)");
    const viele: BerichtsWaehrungssicht = { ...vergleich, kurse: Array.from({ length: 12 }, (_, i) => ({ von: "EUR", nach: "GBP", kurs: "0.87", kursDatum: `2026-06-${String(i + 1).padStart(2, "0")}`, tag: `2026-06-${String(i + 1).padStart(2, "0")}`, verwendung: "kosten" as const })) };
    const hv = waehrungsHinweise(viele, t, "de", 8);
    expect(hv.filter((x) => x.startsWith("1 EUR"))).toHaveLength(8);
    expect(hv.at(-1)).toContain("4 weitere Kurse");
    expect(waehrungsHinweise(undefined, t, "de")).toEqual([]);
  });
});
