import ExcelJS from "exceljs";
import { extractText, getDocumentProxy } from "unpdf";
import { describe, expect, it } from "vitest";
import {
  erzeugeFondsbericht,
  erzeugeFondsberichtExcel,
  erzeugeGremienvorlage,
  erzeugePortfolioliste,
  erzeugeQuartalsbericht,
  MAX_VORGAENGE_QUARTALSBERICHT,
  quartalsberichtQuelle,
  schluessel,
  standardKonfiguration,
  TEXTE,
  uebersetzeSchritt,
  type FondsberichtDaten,
  type GremienDaten,
  type Kennzahl,
  type QuartalsberichtDaten,
  type Sprache,
} from "../index";
import { literal } from "../typst";

const kz = (wert: string | null, schritte: Kennzahl["schritte"] = [{ zeichen: "=", bezeichnung: "Bewertung zum Stichtag", wert: wert ?? "nicht definiert" }]): Kennzahl => ({ wert, schritte });

const fonds: FondsberichtDaten = {
  fonds: { name: "Beispielfonds Test", kurzname: "BF T", waehrung: "EUR", zeichnungskapital: "10000000.00" },
  stichtag: "2025-12-31",
  wissensstand: "2026-01-15T10:00:00Z",
  kennzahlen: {
    abgerufen: kz("4000000"),
    ausschuettungen: kz("500000"),
    nav: kz("5200000", [{ zeichen: "=", bezeichnung: "NAV (Summe der letzten Bewertungen)", wert: "5200000" }]),
    tvpi: kz("1.425"),
    dpi: kz("0.125"),
    rvpi: kz("1.3"),
    irr: kz("0.1834"),
  },
  beteiligungen: [
    { id: "b1", organisation: { name: "Alpha Beispiel", sektor: "Software" }, instrument: "offene_beteiligung", status: "aktiv", erstinvestment: "2023-01-01", zusage: "1000000.00", investiert: "800000.00", rueckfluesse: "0.00", letzteBewertung: { stichtag: "2025-12-31", wert: "1200000.00", methode: "letzte_runde" }, multiple: kz("1.5") },
    { id: "b2", organisation: { name: "Beta Beispiel", sektor: null }, instrument: "darlehen", status: "exit", erstinvestment: "2022-05-01", zusage: "500000.00", investiert: "500000.00", rueckfluesse: "900000.00", letzteBewertung: null, multiple: kz("1.8") },
    { id: "b3", organisation: { name: "Gamma \"Test\" & Co. #1 $x", sektor: "Medizin" }, instrument: "wandeldarlehen", status: "insolvent", erstinvestment: "2024-02-01", zusage: "300000.00", investiert: "300000.00", rueckfluesse: "0.00", letzteBewertung: { stichtag: "2025-12-31", wert: "0.00", methode: "sonstige" }, multiple: kz("0") },
  ],
};

const quartal: QuartalsberichtDaten = {
  stichtag: "2025-12-31",
  wissensstand: "2026-01-15T10:00:00Z",
  fonds: { name: "Beispielfonds Test", kurzname: "BF T" },
  organisation: { name: "Alpha Beispiel", sektor: "Software", ort: "Berlin" },
  beteiligung: { instrument: "offene_beteiligung", status: "aktiv", erstinvestment: "2023-01-01" },
  vorgaenge: Array.from({ length: 14 }, (_, i) => ({ art: i % 5 === 0 ? "zins" : "auszahlung", valuta: `2025-10-${String(i + 1).padStart(2, "0")}`, betrag: "1000.00", bemerkung: i === 3 ? "Storno wegen Erfassungsfehler" : null, istStorno: i === 3, storniert: i === 2 })),
  bewertungsverlauf: ["2024-03-31", "2024-06-30", "2024-09-30", "2024-12-31", "2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31"].map((s, i) => ({ stichtag: s, wert: String(500000 + i * 90000), methode: "letzte_runde" })),
  kennzahlen: { investiert: kz("800000"), rueckfluesse: kz("0"), bewertung: kz("1200000"), multiple: kz("1.5"), irr: kz("0.21") },
};

const gremien: GremienDaten = {
  stichtag: "2026-01-15",
  wissensstand: "2026-01-15T10:00:00Z",
  deals: [
    { titel: "Delta Beispiel, Seed-Runde", organisation: { name: "Delta Beispiel", sektor: "Energie" }, fonds: "Beispielfonds Test", ticket: "750000.00", quelle: "Empfehlung", betreuung: "Beispielperson", beschluesse: [{ gremium: "Investitionsausschuss", datum: "2026-01-10", ergebnis: "vertagt", betrag: null, auflagen: "Finanzplanung nachreichen" }] },
    { titel: "Epsilon Beispiel", organisation: { name: "Epsilon Beispiel", sektor: null }, fonds: null, ticket: null, quelle: null, betreuung: null, beschluesse: [] },
  ],
};

async function pdfText(pdf: Uint8Array): Promise<{ text: string; seiten: number }> {
  const dokument = await getDocumentProxy(new Uint8Array(pdf));
  const { text, totalPages } = await extractText(dokument, { mergePages: true });
  return { text: text.replace(/\s+/g, " "), seiten: totalPages };
}
const beginntMitPdf = (pdf: Uint8Array) => Buffer.from(pdf).subarray(0, 5).toString("latin1") === "%PDF-";

describe("Texte: Schlüsselparität", () => {
  it("Deutsch und Englisch haben dieselben Schlüssel", () => {
    expect(schluessel(TEXTE.en).sort()).toEqual(schluessel(TEXTE.de).sort());
  });
  it("kein Text ist leer", () => {
    for (const sprache of ["de", "en"] as const) for (const k of schluessel(TEXTE[sprache])) expect(k.length).toBeGreaterThan(0);
    const alle = (b: object): string[] => Object.values(b).flatMap((v) => (typeof v === "object" ? alle(v) : [String(v)]));
    for (const sprache of ["de", "en"] as const) for (const text of alle(TEXTE[sprache])) expect(text.trim()).not.toBe("");
  });
  it("übersetzt bekannte Rechenschritte, lässt Unbekanntes", () => {
    expect(uebersetzeSchritt("NAV als Endwert am 2025-12-31", "en")).toBe("NAV as terminal value on 2025-12-31");
    expect(uebersetzeSchritt("Etwas Neues", "en")).toBe("Etwas Neues");
    expect(uebersetzeSchritt("Etwas Neues", "de")).toBe("Etwas Neues");
  });
});

describe("Typst-Literal", () => {
  it("maskiert Anführungszeichen, Backslash und Zeilenumbruch", () => {
    expect(literal('a"b\\c\nd')).toBe('"a\\"b\\\\c\\nd"');
    expect(literal([1, "x"])).toBe('(1, "x",)');
    expect(literal([])).toBe("()");
    expect(literal({ a: null, b: true })).toBe("(a: none, b: true)");
    expect(() => literal({ "a b": 1 })).toThrow();
  });
});

describe.each(["de", "en"] as Sprache[])("PDF-Berichte (%s)", (sprache) => {
  const wasserzeichen = TEXTE[sprache].wasserzeichen;

  it("Fondsbericht: PDF mit Fondsname, Wasserzeichen, Stichtag und Herkunftsseite", async () => {
    const pdf = erzeugeFondsbericht(fonds, sprache);
    expect(beginntMitPdf(pdf)).toBe(true);
    const { text, seiten } = await pdfText(pdf);
    expect(text).toContain("BEISPIELFONDS TEST");
    expect(text).toContain(wasserzeichen);
    expect(text).toContain(sprache === "de" ? "31.12.2025" : "31/12/2025");
    expect(text).toContain(TEXTE[sprache].fondsbericht.herkunft);
    expect(text).toContain("Gamma \"Test\" & Co. #1 $x");
    expect(seiten).toBeGreaterThanOrEqual(3);
  });

  it("Quartalsbericht: eine Seite, mit Organisation, Wasserzeichen und Quartal", async () => {
    const pdf = erzeugeQuartalsbericht(quartal, sprache);
    expect(beginntMitPdf(pdf)).toBe(true);
    const { text, seiten } = await pdfText(pdf);
    expect(seiten).toBe(1);
    expect(text).toContain("ALPHA BEISPIEL");
    expect(text).toContain(wasserzeichen);
    expect(text).toContain("Q4 2025");
    expect(text).toContain(TEXTE[sprache].storno);
  });

  it("Quartalsbericht mit Kennzahlen des Unternehmens: bleibt auf einer Seite, Ist, Plan und Abweichung stehen im Text; ohne Auswahl ein Hinweis; Abschnitt abwählbar", async () => {
    const kennzahl = (schluessel: string, de: string, en: string, typ: "betrag" | "zahl" | "prozent" | "ja_nein" | "text", ist: string | null, plan: string | null, absolut: string | null, prozent: string | null) => ({
      schluessel,
      bezeichnungDe: de,
      bezeichnungEn: en,
      einheit: typ === "betrag" ? "EUR" : typ === "prozent" ? "Prozent" : "Anzahl",
      typ,
      periodeBeginn: ist === null ? null : "2025-10-01",
      periodeEnde: ist === null ? null : "2025-12-31",
      ist,
      plan,
      absolut,
      prozent,
    });
    const mit: QuartalsberichtDaten = {
      ...quartal,
      unternehmenskennzahlen: [
        kennzahl("umsatz", "Umsatz", "Revenue", "betrag", "1234567.89", "1300000", "-65432.11", "-5.033239230769"),
        kennzahl("ebitda", "EBITDA", "EBITDA", "betrag", "-80000", "-120000", "40000", "33.333333333333"),
        kennzahl("mitarbeitende_vzae", "Mitarbeitende (VZÄ)", "Employees (FTE)", "zahl", "42", "40", "2", "5"),
        kennzahl("esg_frauenanteil_leitung", "Frauenanteil im Leitungsorgan", "Share of women", "prozent", "37.5", "40", "-2.5", "-6.25"),
        kennzahl("esg_verstoesse_ungc", "Verstöße", "Violations", "ja_nein", "nein", "ja", null, null),
        kennzahl("liquiditaet", "Liquidität", "Cash position", "betrag", null, null, null, null),
      ],
    };
    const { text, seiten } = await pdfText(erzeugeQuartalsbericht(mit, sprache));
    expect(seiten).toBeLessThanOrEqual(2); // sechs Kennzahlen: die Fußzeile der Herkunft darf auf die zweite Seite laufen
    expect((await pdfText(erzeugeQuartalsbericht({ ...mit, unternehmenskennzahlen: mit.unternehmenskennzahlen!.slice(0, 3) }, sprache))).seiten).toBe(1); // bis zu drei Kennzahlen bleiben auf einer Seite
    expect(text).toContain(TEXTE[sprache].quartalsbericht.unternehmenskennzahlen);
    expect(text).toContain(sprache === "de" ? "Umsatz" : "Revenue");
    expect(text).toContain(sprache === "de" ? "1.234.567,89 €" : "€1,234,567.89");
    expect(text).toContain(sprache === "de" ? "-5,0 %" : "-5.0%");
    expect(text).toContain(sprache === "de" ? "+40.000,00 €" : "+€40,000.00");
    expect(text).toContain(sprache === "de" ? "-2,5 Pkt." : "-2.5 pp");
    expect(text).toContain("Q4 2025");
    expect(text).toContain(TEXTE[sprache].quartalsbericht.ja);
    // ohne Angabe fehlt der Abschnitt; leer = Hinweis; abgewählt fehlt er auch bei vorhandenen Daten
    expect((await pdfText(erzeugeQuartalsbericht(quartal, sprache))).text).not.toContain(TEXTE[sprache].quartalsbericht.unternehmenskennzahlen);
    expect((await pdfText(erzeugeQuartalsbericht({ ...quartal, unternehmenskennzahlen: [] }, sprache))).text).toContain(TEXTE[sprache].quartalsbericht.keineUnternehmenskennzahlen);
    const abgewaehlt = { ...standardKonfiguration("quartalsbericht"), abschnitte: ["bewertungsverlauf", "vorgaenge"] };
    expect((await pdfText(erzeugeQuartalsbericht(mit, sprache, { konfiguration: abgewaehlt }))).text).not.toContain(TEXTE[sprache].quartalsbericht.unternehmenskennzahlen);
    // Reihenfolge nach Vorlage: Kennzahlen vor den Vorgängen
    const vorn = { ...standardKonfiguration("quartalsbericht"), abschnitte: ["unternehmenskennzahlen", "vorgaenge"] };
    const t2 = (await pdfText(erzeugeQuartalsbericht(mit, sprache, { konfiguration: vorn }))).text;
    expect(t2.indexOf(TEXTE[sprache].quartalsbericht.unternehmenskennzahlen)).toBeLessThan(t2.indexOf(TEXTE[sprache].quartalsbericht.vorgaenge));
  });

  it("Gremienvorlage: Deals mit Beschlüssen, auch ohne Deals", async () => {
    const { text } = await pdfText(erzeugeGremienvorlage(gremien, sprache));
    expect(text).toContain("Delta Beispiel, Seed-Runde");
    expect(text).toContain(wasserzeichen);
    expect(text).toContain(TEXTE[sprache].gremien.ergebnisse.vertagt);
    expect(text).toContain(TEXTE[sprache].gremien.keinBeschluss);
    const leer = await pdfText(erzeugeGremienvorlage({ ...gremien, deals: [] }, sprache));
    expect(leer.text).toContain(TEXTE[sprache].gremien.keineDeals);
  });
});

describe("Quartalsbericht: Quelle", () => {
  it("zeigt höchstens so viele Vorgänge, wie auf die Seite passen, und nennt den Rest", () => {
    const quelle = quartalsberichtQuelle(quartal, "de");
    expect(quelle).toContain(`+ ${14 - MAX_VORGAENGE_QUARTALSBERICHT} weitere`);
  });
  it("Wasserzeichen und Wissensstand stehen in der Quelle", () => {
    const quelle = quartalsberichtQuelle(quartal, "en");
    expect(quelle).toContain('wasserzeichen: "DRAFT"');
    expect(quelle).toContain("15/01/2026");
  });
});

describe("Excel", () => {
  async function lade(daten: Uint8Array) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(daten as unknown as ArrayBuffer);
    return wb;
  }

  it("Portfolioliste: die Spalte Instrumente nennt alle Instrumente der Beteiligung, Instrument bleibt das Hauptinstrument", async () => {
    const mit = { ...fonds, beteiligungen: fonds.beteiligungen.map((b, i) => (i === 0 ? { ...b, instrumente: [{ art: "wandeldarlehen", bezeichnung: "Wandeldarlehen 2024", status: "aktiv" }, { art: "offene_beteiligung", bezeichnung: "Anteile Folgerunde", status: "aktiv" }] } : b)) };
    const blatt = (await lade(await erzeugePortfolioliste(mit, "de"))).worksheets[0]!;
    const kopf = (blatt.getRow(1).values as unknown[]).slice(1);
    const spalte = kopf.indexOf(TEXTE.de.instrumenteSpalte) + 1;
    expect(spalte).toBeGreaterThan(0);
    expect(blatt.getRow(2).getCell(spalte).value).toBe("Wandeldarlehen 2024, Anteile Folgerunde");
    // Ohne Angabe (Snapshots aus der Zeit vor den Instrumenten) bleibt die Zelle leer; die Spalte „Instrument“ steht vorne wie bisher.
    expect(blatt.getRow(3).getCell(spalte).value ?? "").toBe("");
    expect(kopf.indexOf(TEXTE.de.instrument)).toBe(2);
  });

  it.each(["de", "en"] as Sprache[])("Portfolioliste (%s): Kopfzeile, Zeilen, Zahlenformate, eingefrorene Kopfzeile", async (sprache) => {
    const wb = await lade(await erzeugePortfolioliste(fonds, sprache));
    expect(wb.worksheets).toHaveLength(1);
    const blatt = wb.worksheets[0]!;
    expect(blatt.rowCount).toBe(fonds.beteiligungen.length + 1);
    const kopf = (blatt.getRow(1).values as unknown[]).slice(1);
    expect(kopf[0]).toBe(TEXTE[sprache].unternehmen);
    expect(kopf).toContain(TEXTE[sprache].kennzahlen.investiert);
    expect(kopf).toContain(TEXTE[sprache].kennzahlen.multiple);
    expect(blatt.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    const erste = blatt.getRow(2);
    expect(typeof erste.getCell("G").value).toBe("number");
    expect(erste.getCell("G").value).toBe(800000);
    expect(erste.getCell("G").numFmt).toContain("#,##0.00");
    expect(erste.getCell("L").numFmt).toContain("0.00");
    expect(erste.getCell("E").value).toBeInstanceOf(Date);
  });

  it("Fondsbericht als Arbeitsmappe: Kennzahlen, Portfolio, Herkunft", async () => {
    const wb = await lade(await erzeugeFondsberichtExcel(fonds, "de"));
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Kennzahlen", "Portfolio", "Herkunft"]);
    expect(wb.getWorksheet("Portfolio")!.rowCount).toBe(4);
    const kennzahlen = wb.getWorksheet("Kennzahlen")!;
    expect(kennzahlen.getCell("A2").value).toBe("NAV");
    expect(kennzahlen.getCell("B2").value).toBe(5200000);
    expect(kennzahlen.getCell("B6").numFmt).toBe("0.0%");
    expect(wb.getWorksheet("Herkunft")!.rowCount).toBeGreaterThan(2);
  });

  it("englische Arbeitsmappe hat englische Blattnamen", async () => {
    const wb = await lade(await erzeugeFondsberichtExcel(fonds, "en"));
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Key figures", "Portfolio", "Origin"]);
  });
});
