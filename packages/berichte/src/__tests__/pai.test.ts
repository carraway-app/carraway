import ExcelJS from "exceljs";
import { extractText, getDocumentProxy } from "unpdf";
import { describe, expect, it } from "vitest";
import { BERICHTSARTEN, erlaubteAuswahl, erzeugePaiErklaerung, erzeugePaiErklaerungExcel, paiBefundText, paiGruppen, paiWert, pruefeKonfiguration, schluessel, standardKonfiguration, TEXTE, type PaiErklaerungDaten, type PaiZeileBericht } from "../index";

const zeile = (z: Partial<PaiZeileBericht> & Pick<PaiZeileBericht, "code" | "indikator" | "nr" | "bezeichnungDe" | "bezeichnungEn" | "metrikDe" | "metrikEn" | "einheit">): PaiZeileBericht => ({
  tabelle: 1,
  wert: null,
  abdeckung: null,
  schaetzanteil: null,
  vorjahr: null,
  quartale: [],
  ...z,
});
const quartale = (wert: string | null) => ["2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31"].map((stichtag) => ({ stichtag, wert, abdeckung: wert === null ? null : "0.75" }));

const daten: PaiErklaerungDaten = {
  fonds: { name: "Beispielfonds Test", kurzname: "BF T", waehrung: "EUR", zeichnungskapital: "10000000.00" },
  jahr: 2025,
  stichtag: "2025-12-31",
  wissensstand: "2026-01-15T10:00:00Z",
  katalogVersion: 1,
  offenlegung: { art: "art8", gueltigAb: "2024-01-01" },
  unternehmen: 3,
  befunde: [
    { code: "EVIC_NICHT_POSITIV", name: "Delta SE", params: { wert: "0" } },
    { code: "NACE_FEHLT", name: "Epsilon GmbH", params: {} },
  ],
  zeilen: [
    zeile({ code: "t1_01_scope1", indikator: "t1_01", nr: 1, bezeichnungDe: "Treibhausgasemissionen", bezeichnungEn: "GHG emissions", metrikDe: "Scope-1-Treibhausgasemissionen", metrikEn: "Scope 1 greenhouse gas emissions", einheit: "t CO2e", wert: "7.475", abdeckung: "0.788906", schaetzanteil: "0.225694", vorjahr: { wert: "6.1", abdeckung: "0.5", schaetzanteil: null }, quartale: quartale("7.475") }),
    zeile({ code: "t1_01_scope2", indikator: "t1_01", nr: 1, bezeichnungDe: "Treibhausgasemissionen", bezeichnungEn: "GHG emissions", metrikDe: "Scope-2-Treibhausgasemissionen", metrikEn: "Scope 2 greenhouse gas emissions", einheit: "t CO2e", wert: "3.31875", abdeckung: "0.788906", schaetzanteil: "0.225694", quartale: quartale("3.31875") }),
    zeile({ code: "t1_04", indikator: "t1_04", nr: 4, bezeichnungDe: "Engagement in Unternehmen im Sektor fossiler Brennstoffe", bezeichnungEn: "Exposure to companies active in the fossil fuel sector", metrikDe: "Anteil der Investitionen", metrikEn: "Share of investments", einheit: "% der Investitionen", wert: "18.331608", abdeckung: "1", schaetzanteil: "0", quartale: quartale("18.331608") }),
    zeile({ code: "t1_06_d", indikator: "t1_06", nr: 6, bezeichnungDe: "Energieverbrauchsintensität je klimaintensivem Sektor", bezeichnungEn: "Energy consumption intensity per sector", metrikDe: "Energieverbrauch in GWh je Mio. EUR Umsatz", metrikEn: "Energy consumption in GWh per EUR million of revenue", einheit: "GWh je Mio. EUR Umsatz", sektor: "D", sektorBezeichnungDe: "Energieversorgung", sektorBezeichnungEn: "Electricity, gas, steam and air conditioning supply", wert: "15", abdeckung: "1", schaetzanteil: "1", quartale: quartale("15") }),
    zeile({ code: "t1_13", indikator: "t1_13", nr: 13, bezeichnungDe: "Geschlechtervielfalt im Leitungsorgan", bezeichnungEn: "Board gender diversity", metrikDe: "Durchschnittlicher Frauenanteil", metrikEn: "Average share of women", einheit: "%", wert: null, abdeckung: "0", quartale: quartale(null) }),
    zeile({ code: "t3_06", indikator: "t3_06", tabelle: 3, nr: 6, bezeichnungDe: "Zusatz: Unzureichender Schutz von Hinweisgebern", bezeichnungEn: "Additional: Insufficient whistleblower protection", metrikDe: "Anteil der Investitionen", metrikEn: "Share of investments", einheit: "% der Investitionen", wert: "40", abdeckung: "0.5", schaetzanteil: null, quartale: quartale("40") }),
  ],
};
const freitexte = {
  vorbemerkung: "Die Daten stammen von den Unternehmen.\n\nEinzelne Werte sind geschätzt.",
  erlaeuterung_t1_01: "Erlaeuterungstext Emissionen",
  massnahmen_t1_01: "Massnahmentext Emissionen",
  erlaeuterung_t1_04: "Erlaeuterungstext Fossil",
};

async function pdfText(pdf: Uint8Array) {
  const dokument = await getDocumentProxy(new Uint8Array(pdf));
  const { text, totalPages } = await extractText(dokument, { mergePages: true });
  return { text: text.replace(/\s+/g, " "), seiten: totalPages };
}
const normal = (x: string) => x.replace(/\s+/g, "").toUpperCase();
const enthaelt = (text: string, suche: string) => normal(text).includes(normal(suche));

describe("PAI-Erklärung als PDF", () => {
  it("deutsch: Tabelle mit Indikator, Metrik, Auswirkung des Jahres und des Vorjahres, Abdeckung, Schätzanteil und den Freitexten", async () => {
    const { text, seiten } = await pdfText(erzeugePaiErklaerung(daten, "de", { entwurf: false, freitexte }));
    expect(seiten).toBeGreaterThanOrEqual(1);
    for (const erwartet of ["PAI-Erklärung", "Berichtsjahr", "2025", "Beispielfonds Test", "Treibhausgasemissionen", "Scope-1-Treibhausgasemissionen [t CO2e]"]) {
      expect(enthaelt(text, erwartet), erwartet).toBe(true);
    }
    // Auswirkung 2025 und 2024, Abdeckung und Schätzanteil
    expect(text).toContain("7,475");
    expect(text).toContain("6,1");
    expect(text).toContain("78,9 %");
    expect(text).toContain("22,6 %");
    expect(text).toContain("18,332 %");
    // nicht definierter Wert ist ein Strich, nicht 0
    expect(text).toMatch(/Geschlechtervielfalt/i);
    // Freitexte stehen in der Tabelle (Erläuterung und Maßnahmen), die Vorbemerkung als eigener Abschnitt
    expect(text).toContain("Erlaeuterungstext Emissionen");
    expect(text).toContain("Massnahmentext Emissionen");
    expect(text).toContain("Erlaeuterungstext Fossil");
    expect(text).toContain("Die Daten stammen von den Unternehmen.");
    expect(text).toContain("Einzelne Werte sind geschätzt.");
    // Einordnung des Fonds mit Datum, Sektorzeile, Zusatzindikator
    expect(text).toContain("Artikel 8 (seit 01.01.2024)");
    expect(enthaelt(text, "Energieversorgung")).toBe(true);
    expect(enthaelt(text, "Zusatz: Unzureichender Schutz von Hinweisgebern")).toBe(true);
    // Hinweise zu den Daten (Befunde) und Herkunft
    expect(text).toContain("Delta SE: Der Unternehmenswert ist nicht positiv (0)");
    expect(text).toContain("Epsilon GmbH: Es ist kein NACE-Abschnitt hinterlegt");
    expect(enthaelt(text, "Herkunft der Werte")).toBe(true);
    // freigegebene Fassung: ohne Entwurfshinweis
    expect(text).not.toContain("Indikatorliste, Formeln und Wortlaut sind fachlich zu prüfen");
    expect(text).toContain("Freigegeben");
  });

  it("englisch: Texte, Zahlenformat und Datum der Sprache; als Entwurf mit Wasserzeichen und Hinweis", async () => {
    const { text } = await pdfText(erzeugePaiErklaerung(daten, "en", { entwurf: true, freitexte: {} }));
    expect(enthaelt(text, "PAI statement")).toBe(true);
    expect(enthaelt(text, "Reference year")).toBe(true);
    expect(enthaelt(text, "Scope 1 greenhouse gas emissions [t CO2e]")).toBe(true);
    expect(text).toContain("7.475");
    expect(text).toContain("78.9%");
    expect(text).toContain("Article 8 (since 01/01/2024)");
    expect(text).toContain("Delta SE: The enterprise value is not positive (0)");
    expect(text).toContain("Draft: the indicator list, formulas and wording are subject to expert review.");
    expect(enthaelt(text, "ENTWURF") || enthaelt(text, "DRAFT")).toBe(true);
  });

  it("ohne erfasste Einordnung steht „nicht erfasst“; die Vorlage steuert die Abschnitte", async () => {
    const ohne = { ...daten, offenlegung: null };
    const voll = (await pdfText(erzeugePaiErklaerung(ohne, "de", { entwurf: false }))).text;
    expect(voll).toContain("nicht erfasst");
    const kurz = standardKonfiguration("pai_erklaerung");
    expect(kurz.abschnitte).toEqual(["vorbemerkung", "tabelle", "befunde", "herkunft"]);
    const nurTabelle = pruefeKonfiguration("pai_erklaerung", { abschnitte: ["tabelle"] });
    const text = (await pdfText(erzeugePaiErklaerung(daten, "de", { entwurf: false, konfiguration: nurTabelle }))).text;
    expect(enthaelt(text, "Hinweise zu den Daten")).toBe(false);
    expect(enthaelt(text, "Herkunft der Werte")).toBe(false);
    expect(enthaelt(text, "Scope-1-Treibhausgasemissionen")).toBe(true);
  });
});

describe("PAI-Erklärung als Excel", () => {
  it("liest sich zurück: Zahlen als Zahlen, nicht definierte Werte leer, Prozente als Anteil, Texte und Info", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await erzeugePaiErklaerungExcel(daten, "de", { entwurf: false, freitexte })) as never);
    expect(wb.worksheets.map((b) => b.name)).toEqual(["PAI", "Quartale", "Hinweise zu den Daten", "Info"]);
    const blatt = wb.getWorksheet("PAI")!;
    const kopf = (blatt.getRow(1).values as (string | undefined)[]).slice(1);
    expect(kopf).toEqual(["Nr.", "Indikator", "Metrik", "Einheit", "Auswirkung 2025", "Auswirkung 2024", "Abdeckung", "Davon geschätzt", "Erläuterung", "Maßnahmen und Ziele"]);
    const z1 = blatt.getRow(2);
    expect(z1.getCell(1).value).toBe("1");
    expect(z1.getCell(5).value).toBe(7.475);
    expect(z1.getCell(6).value).toBe(6.1);
    expect(z1.getCell(7).value).toBeCloseTo(0.788906, 6);
    expect(z1.getCell(7).numFmt).toBe("0.0%");
    expect(z1.getCell(9).value).toBe("Erlaeuterungstext Emissionen");
    expect(z1.getCell(10).value).toBe("Massnahmentext Emissionen");
    // zweite Zeile desselben Indikators: Freitext nur in der ersten
    expect(blatt.getRow(3).getCell(2).value).toBe("Treibhausgasemissionen");
    expect(blatt.getRow(3).getCell(9).value).toBeFalsy();
    // Sektorzeile und nicht definierter Wert
    const sektor = [2, 3, 4, 5, 6, 7].map((i) => blatt.getRow(i)).find((r) => String(r.getCell(3).value).includes("Sektor") || String(r.getCell(3).value).includes("– D"));
    expect(sektor).toBeDefined();
    const frauen = [2, 3, 4, 5, 6, 7].map((i) => blatt.getRow(i)).find((r) => r.getCell(2).value === "Geschlechtervielfalt im Leitungsorgan")!;
    expect(frauen.getCell(5).value).toBeNull();
    expect(frauen.getCell(7).value).toBe(0);
    // Zusatzindikator mit Tabellenkennung
    expect([2, 3, 4, 5, 6, 7].map((i) => String(blatt.getRow(i).getCell(1).value))).toContain("T3 6");
    // Quartale: je Zeile vier
    expect(wb.getWorksheet("Quartale")!.rowCount).toBe(1 + 6 * 4);
    expect(wb.getWorksheet("Hinweise zu den Daten")!.getRow(2).getCell(1).value).toBe("Delta SE: Der Unternehmenswert ist nicht positiv (0); das Unternehmen fehlt in den Rechnungen mit Unternehmenswert.");
    const info = wb.getWorksheet("Info")!;
    const infoWerte = info.getSheetValues().flat().map(String);
    expect(infoWerte).toContain("Artikel 8 (seit 2024-01-01)");
    expect(infoWerte).toContain("Beispielfonds Test");
  });
});

describe("Hilfen der PAI-Erklärung", () => {
  it("Gruppen nach Tabelle, Werte, Befundtexte und Parität der Texte", () => {
    expect(paiGruppen(daten.zeilen, "de").map((g) => g.zeilen.length)).toEqual([4, 1, 1]);
    expect(paiWert("0.5", "%", "de")).toBe("0,5 %");
    expect(paiWert("1234.5678", "t CO2e", "en")).toBe("1,234.6");
    expect(paiWert(null, "%", "de")).toBe("–");
    expect(paiBefundText({ code: "ANTEIL_UEBER_100", name: "X", params: { stichtag: "2025-03-31", wert: "2", evic: "1" } }, "de")).toContain("zum 31.03.2025");
    expect(schluessel(TEXTE.en.pai).sort()).toEqual(schluessel(TEXTE.de.pai).sort());
    expect(BERICHTSARTEN).toContain("pai_erklaerung");
    expect(erlaubteAuswahl("pai_erklaerung").abschnitte).toEqual(["vorbemerkung", "tabelle", "befunde", "herkunft"]);
  });
});
