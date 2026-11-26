import ExcelJS from "exceljs";
import { extractText, getDocumentProxy } from "unpdf";
import { describe, expect, it } from "vitest";
import { erzeugeSzenarioberichtExcel, erzeugeSzenarioberichtPdf, schluessel, szenarioberichtQuelle, TEXTE, type Sprache, type SzenarioberichtDaten } from "../index";

const jahre = (basis: number, tvpi: string[]) =>
  tvpi.map((t, i) => ({ jahr: basis + i, ist: i === 0, abrufe: String(100000 * i) + ".00", ausschuettungenNetto: "0.00", navNetto: "1000000.00", dpi: "0.1000", tvpi: t, irrNetto: i === 0 ? null : "0.0812" }));

const daten: SzenarioberichtDaten = {
  fonds: { name: "Beispielfonds Test", kurzname: "BF T", waehrung: "EUR" },
  erzeugt: "2026-11-20T10:00:00Z",
  szenarien: [
    {
      name: "Basis",
      status: "festgeschrieben",
      basisStichtag: "2026-11-20",
      ergebnisHash: "ab".repeat(32),
      jahre: jahre(2026, ["1.0500", "0.9800", "1.4000"]),
      beteiligungen: [{ name: "Nordlicht Robotik", ausstiegsJahr: 2028, erloesBeiAusstieg: "8000000.00", wahrscheinlichkeit: "0.5", erwarteterErloes: "4000000.00", erloesQuelle: "wasserfall" }],
      befunde: [{ code: "KEINE_ANNAHME", schwere: "hinweis", name: "Feldwerk Software" }, { code: "ZUSAGE_UEBERSCHRITTEN", schwere: "warnung", params: { jahr: 2028, betrag: "12000.00" } }],
    },
    { name: "Pessimistisch", status: "entwurf", basisStichtag: "2026-11-20", ergebnisHash: null, jahre: jahre(2026, ["1.0500", "0.9000", "1.1000"]), beteiligungen: [], befunde: [] },
  ],
  vergleich: {
    kennzahlen: [
      { schluessel: "tvpiEnde", werte: ["1.4000", "1.1000"] },
      { schluessel: "irrNettoEnde", werte: ["0.0812", "0.0310"] },
      { schluessel: "gebuehrenSumme", werte: ["300000.00", "300000.00"] },
      { schluessel: "tvpiTiefpunktJahr", werte: ["2027", "2027"] },
    ],
    jkurve: [
      { jahr: 2026, werte: [{ tvpi: "1.0500", irrNetto: null }, { tvpi: "1.0500", irrNetto: null }] },
      { jahr: 2027, werte: [{ tvpi: "0.9800", irrNetto: "0.01" }, { tvpi: "0.9000", irrNetto: "0.01" }] },
      { jahr: 2028, werte: [{ tvpi: "1.4000", irrNetto: "0.0812" }, { tvpi: "1.1000", irrNetto: "0.031" }] },
    ],
  },
};

const text = async (pdf: Uint8Array) => (await extractText(await getDocumentProxy(new Uint8Array(pdf)), { mergePages: true })).text;

describe("Szenariobericht", () => {
  it("PDF deutsch: Kennzahlen, J-Kurve mit Tabelle, Prüfsumme, Befunde mit Werten", async () => {
    const pdf = erzeugeSzenarioberichtPdf(daten, "de");
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe("%PDF-");
    const t = await text(pdf);
    expect(t).toContain("Kennzahlen im Vergleich");
    expect(t).toContain("1,40x");
    expect(t).toContain("8,1 %");
    expect(t).toContain("Tabelle zur J-Kurve");
    expect(t).toContain("ab".repeat(32));
    expect(t).toContain("Feldwerk Software: Keine Annahme");
    expect(t).toContain("übersteigen ab 2028 das Zeichnungskapital");
    expect(t).toContain("Exit-Wasserfall");
    expect(t).toContain("ENTWURF");
  });

  it("PDF englisch: übersetzt alle Überschriften und Befunde", async () => {
    const t = await text(erzeugeSzenarioberichtPdf(daten, "en"));
    expect(t).toContain("Key figures compared");
    expect(t).toContain("1.40x");
    expect(t).toContain("8.1%");
    expect(t).toContain("Feldwerk Software: No assumption");
    expect(t).toContain("exceed the fund size");
  });

  it("Quelle trägt Daten nur als Literale (kein Markup aus Namen)", () => {
    const boese = { ...daten, szenarien: [{ ...daten.szenarien[0]!, name: 'X"] #panic("y' }] };
    const q = szenarioberichtQuelle(boese, "de");
    expect(q).toContain('X\\"] #panic(\\"y');
    expect(() => erzeugeSzenarioberichtPdf(boese, "de")).not.toThrow();
  });

  it.each(["de", "en"] as Sprache[])("Excel %s: Zahlen als Zahlen, Blätter je Szenario", async (sprache) => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await erzeugeSzenarioberichtExcel(daten, sprache)) as unknown as ArrayBuffer);
    const namen = wb.worksheets.map((w) => w.name);
    expect(namen[0]).toBe(TEXTE[sprache].szenario.kennzahlenTitel);
    expect(namen).toHaveLength(4);
    const k = wb.worksheets[0]!;
    expect(k.getRow(2).getCell(2).value).toBe(1.4);
    expect(k.getRow(2).getCell(2).numFmt).toBe('0.00"x"');
    expect(k.getRow(4).getCell(2).value).toBe(300000);
    const s = wb.worksheets[2]!;
    expect(s.getRow(2).getCell(1).value).toBe("2026 *");
    expect(s.getRow(3).getCell(7).value).toBeCloseTo(0.0812);
  });

  it("Texte der Szenarien haben in beiden Sprachen dieselben Schlüssel", () => {
    expect(schluessel(TEXTE.en.szenario).sort()).toEqual(schluessel(TEXTE.de.szenario).sort());
  });

  describe("Bewertungsszenarien (Etappe 21)", () => {
    const bewertung = {
      beteiligungen: [
        {
          name: "Nordlicht Robotik",
          aktuell: "2500000.00",
          erwartet: "2587500.00",
          faelle: [
            { schluessel: "bear", name: "Bär", methode: "wert", gewicht: "0.25", wert: "1500000.00", abweichung: "-1000000.00" },
            { schluessel: "base", name: null, methode: "letzte_runde", gewicht: "0.5", wert: "1800000.00", abweichung: "-700000.00" },
            { schluessel: "bull", name: "Bulle", methode: "multiple", gewicht: "0.25", wert: null, abweichung: null },
          ],
        },
      ],
      aktuell: { nav: "3300000.00", tvpi: "1.3200", dpi: "0.0000", carry: "160000.00", navNetto: "3140000.00" },
      faelle: [{ schluessel: "bear", name: "Bär", nav: "1900000.00", tvpi: "0.7600", dpi: "0.0000", carry: "0.00", navNetto: "1900000.00" }, { schluessel: "bull", name: "Bulle", nav: null, tvpi: null, dpi: null, carry: null, navNetto: null }],
      erwartet: { nav: null, tvpi: null, dpi: null, carry: null, navNetto: null },
    };
    const mit: SzenarioberichtDaten = { ...daten, szenarien: [{ ...daten.szenarien[1]!, bewertung }] };

    it("PDF: Fälle, Erwartungswert und Fondswirkung stehen im Bericht, eine Lücke heißt Lücke, der Entwurf trägt das Wasserzeichen", async () => {
      const t = await text(erzeugeSzenarioberichtPdf(mit, "de"));
      expect(t).toContain("Bewertungsszenarien je Beteiligung");
      expect(t).toContain("Wirkung auf den Fonds");
      expect(t).toContain("Erwartungswert");
      expect(t).toContain("Lücke");
      expect(t).toContain("Letzte Runde");
      expect(t).toContain("1,32x");
      expect(t).toContain("ENTWURF");
      // ohne Bewertungsszenario fehlt der Abschnitt
      expect(await text(erzeugeSzenarioberichtPdf(daten, "de"))).not.toContain("Bewertungsszenarien je Beteiligung");
      expect(await text(erzeugeSzenarioberichtPdf(mit, "en"))).toContain("Valuation scenarios per investment");
    });

    it("Excel: Abschnitt mit Zahlen als Zahlen und Lücke als Text", async () => {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load((await erzeugeSzenarioberichtExcel(mit, "de")) as unknown as ArrayBuffer);
      const blatt = wb.worksheets[2]!;
      const zeilen = blatt.getSheetValues().flat().map(String);
      expect(zeilen).toContain("Bewertungsszenarien je Beteiligung");
      expect(zeilen).toContain("2587500");
      expect(zeilen).toContain("Lücke");
      expect(zeilen).toContain("Wirkung auf den Fonds");
    });
  });
});
