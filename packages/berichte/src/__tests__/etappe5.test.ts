import ExcelJS from "exceljs";
import { extractText, getDocumentProxy } from "unpdf";
import { describe, expect, it } from "vitest";
import {
  erzeugeExitListeExcel,
  erzeugeExitListePdf,
  erzeugeFondsbericht,
  erzeugeFondsberichtExcel,
  erzeugeGremienvorlage,
  erzeugeLpBericht,
  erzeugePortfolioListeExcel,
  erzeugePortfolioListePdf,
  erzeugeQuartalsbericht,
  formatBetrag,
  formatProzent,
  pruefeKonfiguration,
  standardKonfiguration,
  TEXTE,
  type ExitListeDaten,
  type FondsberichtDaten,
  type GremienDaten,
  type Kennzahl,
  type LpBerichtDaten,
  type PortfolioListeDaten,
  type QuartalsberichtDaten,
  type Sprache,
} from "../index";

const kz = (wert: string | null): Kennzahl => ({ wert, schritte: [{ zeichen: "=", bezeichnung: "Bewertung zum Stichtag", wert: wert ?? "nicht definiert" }] });

const fonds: FondsberichtDaten = {
  fonds: { name: "Beispielfonds Test", kurzname: "BF T", waehrung: "EUR", zeichnungskapital: "10000000.00" },
  stichtag: "2025-12-31",
  wissensstand: "2026-01-15T10:00:00Z",
  kennzahlen: { abgerufen: kz("4000000"), ausschuettungen: kz("500000"), nav: kz("5200000"), tvpi: kz("1.425"), dpi: kz("0.125"), rvpi: kz("1.3"), irr: kz("0.0481") },
  beteiligungen: [
    { id: "b1", organisation: { name: "Alpha Beispiel", sektor: "Software" }, instrument: "offene_beteiligung", status: "aktiv", erstinvestment: "2023-01-01", zusage: "1000000.00", investiert: "800000.00", rueckfluesse: "0.00", letzteBewertung: { stichtag: "2025-12-31", wert: "1200000.00", methode: "letzte_runde" }, multiple: kz("1.5") },
    { id: "b2", organisation: { name: "Beta Beispiel", sektor: null }, instrument: "darlehen", status: "exit", erstinvestment: "2022-05-01", zusage: "500000.00", investiert: "500000.00", rueckfluesse: "900000.00", letzteBewertung: null, multiple: kz("1.8"), offeneForderungen: "0.00" },
    { id: "b3", organisation: { name: "Gamma Beispiel", sektor: "Medizin" }, instrument: "wandeldarlehen", status: "aktiv", erstinvestment: "2024-02-01", zusage: "300000.00", investiert: "300000.00", rueckfluesse: "0.00", letzteBewertung: { stichtag: "2025-12-31", wert: "300000.00", methode: "anschaffungskosten" }, multiple: kz("1.0") },
  ],
};

const lp: LpBerichtDaten = {
  ...fonds,
  kapitalkonten: [
    { investor: "Investor Eins", anteil: "0.600000", zusage: "6000000.00", abgerufen: "2400000.01", ausgeschuettet: "300000.00", offeneZusage: "3599999.99", navAnteil: "3120000.00" },
    { investor: "Investor Zwei", anteil: "0.400000", zusage: "4000000.00", abgerufen: "1599999.99", ausgeschuettet: "200000.00", offeneZusage: "2400000.01", navAnteil: "2080000.00" },
  ],
};

async function pdfText(pdf: Uint8Array) {
  const dokument = await getDocumentProxy(new Uint8Array(pdf));
  const { text, totalPages } = await extractText(dokument, { mergePages: true });
  return { text: text.replace(/\s+/g, " "), seiten: totalPages };
}
const position = (text: string, suche: string) => text.indexOf(suche);
/** Beschriftungen stehen gesperrt und in Großbuchstaben im PDF: ohne Leerraum und ohne Groß-/Kleinschreibung vergleichen. */
const normal = (x: string) => x.replace(/\s+/g, "").toUpperCase();
const enthaelt = (text: string, suche: string) => normal(text).includes(normal(suche));

describe("Formatierung", () => {
  it("Prozent: englisch ohne Leerzeichen, deutsch mit Leerzeichen", () => {
    expect(formatProzent("0.048", "en")).toBe("4.8%");
    expect(formatProzent("0.048", "de")).toBe("4,8 %");
    expect(formatProzent("-0.021", "en")).toBe("-2.1%");
    expect(formatProzent(null, "en")).toBe("–");
  });

  it("Beträge in TEUR: durch tausend, ohne Nachkommastellen, mit Zusatz", () => {
    expect(formatBetrag("1234567.89", "de", "EUR", "TEUR")).toBe("1.235 TEUR");
    expect(formatBetrag("1234567.89", "en", "EUR", "TEUR")).toBe("1,235 TEUR");
    expect(formatBetrag("1234567.89", "de").replace(/\u00a0/g, " ")).toBe("1.234.567,89 €");
    expect(formatBetrag(null, "de", "EUR", "TEUR")).toBe("–");
  });
});

describe("Vorlagenkonfiguration", () => {
  it("füllt fehlende Felder mit den Standardwerten der Art", () => {
    const k = pruefeKonfiguration("lp_bericht", {});
    expect(k).toEqual(standardKonfiguration("lp_bericht"));
    expect(k.einheit).toBe("EUR");
    expect(k.abschnitte).toContain("kapitalkonten");
    expect(pruefeKonfiguration("portfolioliste", { einheit: "TEUR" })).toMatchObject({ einheit: "TEUR", spalten: standardKonfiguration("portfolioliste").spalten });
    expect(pruefeKonfiguration("fondsbericht", null)).toEqual(standardKonfiguration("fondsbericht"));
  });

  it("lehnt unbekannte Abschnitte, Spalten, Kennzahlen, Dubletten, leere Listen und fremde Felder ab", () => {
    expect(() => pruefeKonfiguration("lp_bericht", { abschnitte: ["kennzahlen", "unbekannt"] })).toThrow();
    expect(() => pruefeKonfiguration("lp_bericht", { abschnitte: ["kennzahlen", "kennzahlen"] })).toThrow();
    expect(() => pruefeKonfiguration("lp_bericht", { abschnitte: [] })).toThrow();
    expect(() => pruefeKonfiguration("portfolioliste", { spalten: ["nope"] })).toThrow();
    expect(() => pruefeKonfiguration("portfolioliste", { spalten: [] })).toThrow();
    expect(() => pruefeKonfiguration("fondsbericht", { kennzahlen: ["nav", "gewinn"] })).toThrow();
    expect(() => pruefeKonfiguration("fondsbericht", { einheit: "MEUR" })).toThrow();
    expect(() => pruefeKonfiguration("fondsbericht", { sonstiges: 1 })).toThrow();
    expect(() => pruefeKonfiguration("gremienvorlage", { spalten: ["x"] })).toThrow();
    // Kennzahlen dürfen leer sein (keine Kacheln)
    expect(pruefeKonfiguration("fondsbericht", { kennzahlen: [] }).kennzahlen).toEqual([]);
  });
});

describe.each(["de", "en"] as Sprache[])("LP-Bericht (%s)", (sprache) => {
  const t = TEXTE[sprache];

  it("Entwurf: Deckblatt, Kennzahlen, Kapitalkonten mit Summe, Portfolio, Bewertungsmethoden, Herkunft; mit Wasserzeichen", async () => {
    const { text, seiten } = await pdfText(erzeugeLpBericht(lp, sprache));
    expect(text).toContain("BEISPIELFONDS TEST");
    expect(text).toContain(t.wasserzeichen);
    expect(text).toContain(t.entwurfHinweis);
    for (const titel of [t.fondsbericht.kennzahlen, t.lp.kapitalkonten, t.fondsbericht.portfolio, t.fondsbericht.realisierungen, t.lp.bewertung, t.fondsbericht.herkunft]) expect(text).toContain(titel);
    expect(text).toContain("Investor Eins");
    expect(text).toContain("Investor Zwei");
    // Summenzeile: Zusagen 10 Mio., Abrufe 4 Mio.
    expect(text).toContain(t.summe);
    expect(text).toMatch(sprache === "de" ? /10\.000\.000,00 €/ : /€10,000,000\.00/);
    expect(text).toMatch(sprache === "de" ? /4\.000\.000,00 €/ : /€4,000,000\.00/);
    // Bewertungsmethoden: Letzte Runde 1,2 Mio. plus Anschaffungskosten 0,3 Mio. = 1,5 Mio.
    expect(text).toContain(t.methoden.letzte_runde);
    expect(text).toContain(t.methoden.anschaffungskosten);
    expect(text).toMatch(sprache === "de" ? /1\.500\.000,00 €/ : /€1,500,000\.00/);
    expect(seiten).toBeGreaterThanOrEqual(3);
  });

  it("Fassung für einen Investor: nur dessen Konto, eigener Hinweis, keine Summenzeile", async () => {
    const einzeln = { ...lp, kapitalkonten: [lp.kapitalkonten[1]!] };
    const { text } = await pdfText(erzeugeLpBericht(einzeln, sprache, { entwurf: false, kapitalkontoEinzeln: true }));
    expect(text).toContain("Investor Zwei");
    expect(text).not.toContain("Investor Eins");
    expect(text).toContain(t.lp.kapitalkontoEinzelHinweis.replace("{investor}", "Investor Zwei"));
    expect(text).not.toContain(t.lp.kapitalkontenHinweis); // der Hinweis „Summen entsprechen dem Fonds“ gilt hier nicht
    const anzahl = (s: string, teil: string) => s.match(new RegExp(`\\b${teil}\\b`, "g"))?.length ?? 0;
    const alle = await pdfText(erzeugeLpBericht(lp, sprache, { entwurf: false }));
    expect(anzahl(text, t.summe)).toBe(anzahl(alle.text, t.summe) - 1); // die Summenzeile der Kapitalkonten fehlt, die der Bewertungsmethoden bleibt
    expect(text).toMatch(sprache === "de" ? /1\.599\.999,99 €/ : /€1,599,999\.99/); // Abrufe dieses Investors
    expect(text).not.toMatch(sprache === "de" ? /2\.400\.000,01 € 300\.000/ : /€2,400,000\.01 €300,000/); // nichts vom anderen Konto
    expect(text).not.toMatch(sprache === "de" ? /6\.000\.000,00 €/ : /€6,000,000\.00/); // Zusage des anderen Investors
    // Ohne die Option bleibt alles beim Alten (Summenzeile, Hinweis des Fonds)
    expect(alle.text).toContain(t.lp.kapitalkontenHinweis);
  });

  it("Prozentzeichen: Anteil und IRR nach Sprache", async () => {
    const { text } = await pdfText(erzeugeLpBericht(lp, sprache));
    expect(text).toContain(sprache === "de" ? "4,8 %" : "4.8%");
    expect(text).toContain(sprache === "de" ? "60,0 %" : "60.0%");
    expect(text).not.toContain(sprache === "de" ? "4.8%" : "4,8 %");
  });

  it("freigegebene Fassung: kein Wasserzeichen, kein Entwurfshinweis, Texte aus dem Text sind aber da", async () => {
    const { text } = await pdfText(erzeugeLpBericht(lp, sprache, { entwurf: false, freitexte: { vorwort: "Das Berichtsjahr war ruhig.\n\nZweiter Absatz." } }));
    expect(text.toUpperCase()).not.toContain("ENTWURF");
    expect(text.toUpperCase()).not.toContain("DRAFT");
    expect(text).not.toContain(t.entwurfHinweis);
    expect(text).toContain(t.freigegeben);
    expect(text).toContain("Das Berichtsjahr war ruhig.");
    expect(text).toContain("Zweiter Absatz.");
    expect(text).toContain(t.lp.vorwort);
    // Abschnitte ohne Text erscheinen in der freigegebenen Fassung nicht
    expect(text).not.toContain(t.lp.marktumfeld);
    expect(text).not.toContain(t.lp.keinText);
  });

  it("im Entwurf zeigen leere Freitextabschnitte einen Hinweis", async () => {
    const { text } = await pdfText(erzeugeLpBericht(lp, sprache));
    expect(text).toContain(t.lp.keinText);
    expect(text).toContain(t.lp.ausblick);
  });

  it("die Vorlage bestimmt Abschnitte, Reihenfolge, Kennzahlen, Spalten und Einheit", async () => {
    const konfiguration = pruefeKonfiguration("lp_bericht", { einheit: "TEUR", abschnitte: ["portfolio", "kapitalkonten", "kennzahlen"], kennzahlen: ["nav", "irr"], spalten: ["unternehmen", "investiert"] });
    const { text } = await pdfText(erzeugeLpBericht(lp, sprache, { konfiguration }));
    expect(position(text, t.fondsbericht.portfolio)).toBeGreaterThan(-1);
    expect(position(text, t.fondsbericht.portfolio)).toBeLessThan(position(text, t.lp.kapitalkonten));
    expect(position(text, t.lp.kapitalkonten)).toBeLessThan(position(text, t.fondsbericht.kennzahlen));
    for (const ausgelassen of [t.lp.bewertung, t.fondsbericht.herkunft, t.fondsbericht.realisierungen]) expect(text).not.toContain(ausgelassen);
    // Kennzahlen NAV und IRR, nicht TVPI
    expect(text).toContain(t.kennzahlen.nav);
    expect(text).not.toContain(t.kennzahlen.tvpi);
    // Einheit TEUR
    expect(text).toContain("TEUR");
    expect(text).toMatch(sprache === "de" ? /5\.200 TEUR/ : /5,200 TEUR/);
    // Spalten: Unternehmen und Investiert, nicht Instrument
    expect(text).not.toContain(t.instrument.toUpperCase());
  });
});

describe.each(["de", "en"] as Sprache[])("Fondsbericht und Excel mit Entwurfsschalter (%s)", (sprache) => {
  const t = TEXTE[sprache];

  it("freigegebener Fondsbericht ohne Wasserzeichen und ohne Vorschau-Hinweis", async () => {
    const entwurf = await pdfText(erzeugeFondsbericht(fonds, sprache));
    expect(entwurf.text).toContain(t.wasserzeichen);
    const final = await pdfText(erzeugeFondsbericht(fonds, sprache, { entwurf: false }));
    expect(final.text.toUpperCase()).not.toContain("ENTWURF");
    expect(final.text.toUpperCase()).not.toContain("DRAFT");
    expect(final.text).not.toContain("(Vorschau)");
    expect(final.text).not.toContain("(preview)");
    expect(final.text).toContain(t.freigegeben);
  });

  it("Quartalsbericht als freigegebene Fassung", async () => {
    const quartal: QuartalsberichtDaten = {
      stichtag: "2025-12-31",
      wissensstand: "2026-01-15T10:00:00Z",
      fonds: { name: "Beispielfonds Test", kurzname: "BF T" },
      organisation: { name: "Alpha Beispiel", sektor: "Software", ort: "Berlin" },
      beteiligung: { instrument: "offene_beteiligung", status: "aktiv", erstinvestment: "2023-01-01" },
      vorgaenge: [],
      bewertungsverlauf: [{ stichtag: "2025-12-31", wert: "1200000", methode: "letzte_runde" }],
      kennzahlen: { investiert: kz("800000"), rueckfluesse: kz("0"), bewertung: kz("1200000"), multiple: kz("1.5"), irr: kz("0.21") },
    };
    const { text } = await pdfText(erzeugeQuartalsbericht(quartal, sprache, { entwurf: false }));
    expect(text.toUpperCase()).not.toContain("ENTWURF");
    expect(text.toUpperCase()).not.toContain("DRAFT");
  });

  it("Excel des Fondsberichts: Entwurfszeile nur im Entwurf", async () => {
    const lesen = async (daten: Uint8Array) => {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(daten as unknown as ArrayBuffer);
      return wb.getWorksheet(t.excel.kennzahlen)!;
    };
    const werte = (blatt: ExcelJS.Worksheet) => blatt.getSheetValues().flat().map(String);
    expect(werte(await lesen(await erzeugeFondsberichtExcel(fonds, sprache)))).toContain(t.entwurfHinweis);
    const final = werte(await lesen(await erzeugeFondsberichtExcel(fonds, sprache, { entwurf: false })));
    expect(final).not.toContain(t.entwurfHinweis);
    expect(final).not.toContain(t.wasserzeichen);
  });
});

const gremien: GremienDaten = {
  stichtag: "2026-01-15",
  wissensstand: "2026-01-15T10:00:00Z",
  zeitraum: { von: "2025-10-01", bis: "2025-12-31" },
  deals: [
    {
      titel: "Delta Beispiel, Seed-Runde",
      organisation: { name: "Delta Beispiel", sektor: "Energie", ort: "Hamburg" },
      fonds: "Beispielfonds Test",
      ticket: "750000.00",
      quelle: "Empfehlung",
      betreuung: "Beispielperson",
      beschluesse: [{ gremium: "Investitionsausschuss", datum: "2026-01-10", ergebnis: "vertagt", betrag: null, auflagen: "Finanzplanung nachreichen" }],
      beschlussvorschlag: { text: "Zustimmung bis 750.000 Euro, vorbehaltlich der Finanzplanung.", quelle: "deal" },
      aktivitaeten: Array.from({ length: 7 }, (_, i) => ({ datum: `2025-12-${String(20 - i).padStart(2, "0")}`, art: i % 2 ? "termin" : "gespraech", titel: `Aktivität Nummer ${i + 1}` })),
      aktivitaetenGesamt: 9,
    },
    {
      titel: "Epsilon Beispiel",
      organisation: { name: "Epsilon Beispiel", sektor: null },
      fonds: null,
      ticket: null,
      quelle: null,
      betreuung: null,
      beschluesse: [],
      beschlussvorschlag: { text: "Finanzplanung nachreichen", quelle: "vertagt" },
      aktivitaeten: [],
    },
    { titel: "Zeta Beispiel", organisation: { name: "Zeta Beispiel", sektor: null }, fonds: null, ticket: null, quelle: null, betreuung: null, beschluesse: [], beschlussvorschlag: null },
  ],
  beschluesseImZeitraum: [
    { deal: "Eta Beispiel, Brücke", organisation: "Eta Beispiel", gremium: "Investitionsausschuss", datum: "2025-11-12", ergebnis: "zugestimmt", betrag: "500000.00", auflagen: "Berichtspflicht" },
    { deal: "Theta Beispiel, Serie A", organisation: "Theta Beispiel", gremium: "Investitionsausschuss", datum: "2025-12-03", ergebnis: "abgelehnt", betrag: null, auflagen: null },
  ],
};

describe.each(["de", "en"] as Sprache[])("Gremienvorlage vollständig (%s)", (sprache) => {
  const t = TEXTE[sprache];

  it("Eckdaten, Beschlussvorschlag, Aktivitäten (begrenzt) und Beschlüsse des Zeitraums", async () => {
    const { text } = await pdfText(erzeugeGremienvorlage(gremien, sprache));
    expect(text).toContain("Delta Beispiel, Seed-Runde");
    expect(enthaelt(text, t.gremien.eckdaten)).toBe(true);
    expect(text).toContain("Hamburg");
    expect(enthaelt(text, t.gremien.beschlussvorschlag)).toBe(true);
    expect(text).toContain("Zustimmung bis 750.000 Euro");
    expect(text).toContain(t.gremien.vorschlagVertagt);
    expect(text).toContain("Finanzplanung nachreichen");
    expect(text).toContain(t.gremien.keinVorschlag);
    // Aktivitäten: höchstens fünf, dazu der Hinweis auf weitere
    expect(text).toContain("Aktivität Nummer 5");
    expect(text).not.toContain("Aktivität Nummer 6");
    expect(text).toContain(`+ 4 ${t.gremien.weitereAktivitaeten}`);
    expect(text).toContain(t.gremien.keineAktivitaeten);
    // Beschlüsse des Zeitraums
    expect(text).toContain(t.gremien.zeitraum);
    expect(text).toContain("Eta Beispiel");
    expect(text).toContain("Theta Beispiel");
    expect(text).toContain(t.gremien.ergebnisse.abgelehnt);
    expect(text).toContain(t.wasserzeichen);
  });

  it("ohne Zeitraum entfällt der Abschnitt, mit Vorlage lässt er sich abwählen; Final ohne Wasserzeichen", async () => {
    const ohne = await pdfText(erzeugeGremienvorlage({ ...gremien, zeitraum: undefined, beschluesseImZeitraum: undefined }, sprache));
    expect(ohne.text).not.toContain(t.gremien.zeitraum);
    const abgewaehlt = await pdfText(erzeugeGremienvorlage(gremien, sprache, { konfiguration: pruefeKonfiguration("gremienvorlage", { abschnitte: ["deals"] }) }));
    expect(abgewaehlt.text).not.toContain(t.gremien.zeitraum);
    const final = await pdfText(erzeugeGremienvorlage(gremien, sprache, { entwurf: false }));
    expect(final.text.toUpperCase()).not.toContain("ENTWURF");
    expect(final.text.toUpperCase()).not.toContain("DRAFT");
    expect(final.text).not.toContain(t.gremien.untertitel);
  });
});

const portfolioListe: PortfolioListeDaten = {
  fonds: { name: "Beispielfonds Test", kurzname: "BF T", waehrung: "EUR", zeichnungskapital: "10000000.00" },
  stichtag: "2025-12-31",
  wissensstand: "2026-01-15T10:00:00Z",
  zeilen: [
    { organisation: "Alpha Beispiel", sektor: "Software", phase: "Serie-A-Runde", instrument: "offene_beteiligung", status: "aktiv", betreuung: "Beispielperson", zusage: "1000000.00", investiert: "800000.00", buchwert: "800000.00", wertberichtigung: "0.00", offeneZusage: "200000.00", bewertung: "1200000.00", multiple: "1.5" },
    { organisation: "Gamma Beispiel", sektor: null, phase: null, instrument: "wandeldarlehen", status: "aktiv", betreuung: null, zusage: "300000.00", investiert: "300000.00", buchwert: "250000.00", wertberichtigung: "50000.00", offeneZusage: "0.00", bewertung: "300000.00", multiple: "1.0" },
  ],
};

const exitListe: ExitListeDaten = {
  fonds: portfolioListe.fonds,
  stichtag: "2025-12-31",
  wissensstand: "2026-01-15T10:00:00Z",
  zeilen: [
    { organisation: "Beta Beispiel", art: "verkauf", datum: "2025-06-30", investiert: "500000.00", erloes: "900000.00", multiple: "1.8", irr: "0.2012", offeneForderungen: "50000.00" },
    { organisation: "Delta Beispiel", art: "insolvenz", datum: "2025-03-15", investiert: "200000.00", erloes: "0.00", multiple: "0", irr: null, offeneForderungen: "0.00" },
  ],
};

describe.each(["de", "en"] as Sprache[])("Portfolio- und Exitliste (%s)", (sprache) => {
  const t = TEXTE[sprache];

  it("Portfolioliste als Excel: Spalten der Vorlage, Zahlen als Zahlen, Summenzeile", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await erzeugePortfolioListeExcel(portfolioListe, sprache)) as unknown as ArrayBuffer);
    const blatt = wb.getWorksheet(t.excel.portfolioliste)!;
    const kopf = (blatt.getRow(1).values as unknown[]).slice(1);
    expect(kopf).toEqual([t.unternehmen, t.sektor, t.phase, t.instrument, t.betreuung, t.kennzahlen.zusage, t.kennzahlen.investiert, t.kennzahlen.buchwert, t.kennzahlen.wertberichtigung, t.kennzahlen.offeneZusage, t.kennzahlen.bewertung, t.kennzahlen.multiple]);
    expect(blatt.rowCount).toBe(1 + 2 + 1);
    const zeile = blatt.getRow(2);
    expect(zeile.getCell(1).value).toBe("Alpha Beispiel");
    expect(zeile.getCell(3).value).toBe("Serie-A-Runde");
    expect(zeile.getCell(6).value).toBe(1_000_000);
    expect(zeile.getCell(6).numFmt).toContain("€");
    expect(blatt.getRow(3).getCell(2).value).toBeNull();
    const summe = blatt.getRow(4);
    expect(summe.getCell(1).value).toBe(t.summe);
    expect(summe.getCell(6).value).toBe(1_300_000);
    expect(summe.getCell(9).value).toBe(50_000);
    expect(summe.getCell(10).value).toBe(200_000);
    expect(blatt.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    const info = wb.getWorksheet("Info")!;
    expect((info.getSheetValues().flat().map(String))).toContain(t.entwurfHinweis);
  });

  it("Einheit TEUR und Auswahl der Spalten", async () => {
    const konfiguration = pruefeKonfiguration("portfolioliste", { einheit: "TEUR", spalten: ["unternehmen", "zusage", "buchwert"] });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await erzeugePortfolioListeExcel(portfolioListe, sprache, { konfiguration, entwurf: false })) as unknown as ArrayBuffer);
    const blatt = wb.getWorksheet(t.excel.portfolioliste)!;
    expect((blatt.getRow(1).values as unknown[]).slice(1)).toEqual([t.unternehmen, `${t.kennzahlen.zusage} (TEUR)`, `${t.kennzahlen.buchwert} (TEUR)`]);
    expect(blatt.getRow(2).getCell(2).value).toBe(1000);
    expect(blatt.getRow(4).getCell(3).value).toBe(1050);
    expect((wb.getWorksheet("Info")!.getSheetValues().flat().map(String))).not.toContain(t.entwurfHinweis);
  });

  it("Portfolioliste als PDF: Zeilen, Summe, TEUR, Wasserzeichen und Final", async () => {
    const entwurf = await pdfText(erzeugePortfolioListePdf(portfolioListe, sprache));
    expect(entwurf.text).toContain(t.wasserzeichen);
    expect(entwurf.text).toContain("Alpha Beispiel");
    expect(entwurf.text).toContain("Serie-A-");
    expect(entwurf.text).toContain(t.summe);
    expect(enthaelt(entwurf.text, t.kennzahlen.offeneZusage)).toBe(true);
    const teur = await pdfText(erzeugePortfolioListePdf(portfolioListe, sprache, { entwurf: false, konfiguration: pruefeKonfiguration("portfolioliste", { einheit: "TEUR" }) }));
    expect(teur.text).toMatch(sprache === "de" ? /1\.300 TEUR/ : /1,300 TEUR/);
    expect(teur.text.toUpperCase()).not.toContain("ENTWURF");
    expect(teur.text.toUpperCase()).not.toContain("DRAFT");
    const leer = await pdfText(erzeugePortfolioListePdf({ ...portfolioListe, zeilen: [] }, sprache));
    expect(leer.text).toContain(t.listen.portfolioliste.keine);
  });

  it("Exitliste: Excel mit Art, Erlös, Multiple, IRR und offenen Forderungen; PDF mit Summe", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await erzeugeExitListeExcel(exitListe, sprache)) as unknown as ArrayBuffer);
    const blatt = wb.getWorksheet(t.excel.exitliste)!;
    expect((blatt.getRow(1).values as unknown[]).slice(1)).toEqual([t.unternehmen, t.art, t.datum, t.kennzahlen.investiert, t.kennzahlen.erloes, t.kennzahlen.multiple, t.kennzahlen.irr, t.kennzahlen.offeneForderungen]);
    expect(blatt.getRow(2).getCell(2).value).toBe(t.exitArten.verkauf);
    expect(blatt.getRow(2).getCell(5).value).toBe(900_000);
    expect(blatt.getRow(2).getCell(7).value).toBeCloseTo(0.2012);
    expect(blatt.getRow(2).getCell(7).numFmt).toBe("0.0%");
    expect(blatt.getRow(3).getCell(2).value).toBe(t.exitArten.insolvenz);
    expect(blatt.getRow(3).getCell(7).value).toBeNull();
    expect(blatt.getRow(4).getCell(8).value).toBe(50_000);

    const { text } = await pdfText(erzeugeExitListePdf(exitListe, sprache));
    expect(text).toContain("Beta Beispiel");
    expect(text).toContain(t.exitArten.insolvenz);
    expect(text).toContain(sprache === "de" ? "20,1 %" : "20.1%");
    expect(text).toContain(t.summe);
  });
});
