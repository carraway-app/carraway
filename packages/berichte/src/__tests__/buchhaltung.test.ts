import ExcelJS from "exceljs";
import { extractText, getDocumentProxy } from "unpdf";
import { describe, expect, it } from "vitest";
import { erzeugeAuswertungExcel, erzeugeAuswertungPdf, erzeugeBelegPdf, type AuswertungExportDaten, type BelegPdfDaten, type Sprache } from "../index";

const text = async (pdf: Uint8Array) => {
  const dok = await getDocumentProxy(new Uint8Array(pdf));
  return (await extractText(dok, { mergePages: true })).text.toLowerCase();
};

const beleg = (sprache: Sprache): BelegPdfDaten => ({
  fonds: { name: "Beispielfonds Test", kurzname: "BF T" },
  art: "zinsbuchung",
  sprache,
  belegnummer: "ZB-000007",
  datum: "2026-09-30",
  betrag: "12345.67",
  waehrung: "EUR",
  kopftext: sprache === "de" ? "Kopftext des Belegs" : "Voucher header text",
  fusstext: sprache === "de" ? "Fußtext des Belegs" : "Voucher footer text",
  felder: [
    { bezeichnung: sprache === "de" ? "Unternehmen" : "Company", wert: "Alpha Beispiel GmbH", abschnitt: "kopf" },
    { bezeichnung: sprache === "de" ? "Projektnummer" : "Project number", wert: null, abschnitt: "details" },
  ],
  mittelherkunft: [
    { bezeichnung: "Landesmittel", quote: "0.6", betrag: "7407.40" },
    { bezeichnung: "Eigenmittel", quote: "0.4", betrag: "4938.27" },
  ],
  stufen: [{ stufe: "Prüfung", person: "Testperson A", am: "2026-11-20T10:00:00Z" }],
  erzeugtAm: "2026-11-20T10:00:00Z",
});

describe("Beleg als PDF", () => {
  it("eigene Belegart: ihr Name ersetzt die feste Bezeichnung im Titel (sonst fällt der Titel auf die feste Art zurück)", async () => {
    const eigen = await text(erzeugeBelegPdf({ ...beleg("en"), artName: "Special interest notice" }, { entwurf: false }));
    expect(eigen).toContain("special interest notice");
    expect(eigen).not.toContain("interest posting");
    const standard = await text(erzeugeBelegPdf(beleg("de"), { entwurf: false }));
    expect(standard).toContain("zinsbuchung");
  });

  it("deutsch: Nummer, Betrag, Felder, fehlendes Pflichtfeld sichtbar, Mittelherkunft mit Summe, Stufen", async () => {
    const t = await text(erzeugeBelegPdf(beleg("de"), { entwurf: false }));
    expect(t).toContain("carraway");
    expect(t).toContain("zb-000007");
    expect(t).toContain("zinsbuchung");
    expect(t).toContain("12.345,67");
    expect(t).toContain("alpha beispiel gmbh");
    expect(t).toContain("(fehlt)");
    expect(t).toContain("landesmittel");
    expect(t).toContain("60,0 %");
    expect(t).toContain("12.345,67 €");
    expect(t).toContain("kopftext des belegs");
    expect(t).toContain("testperson a");
    expect(t).not.toContain("entwurf");
  });

  it("englisch und als Entwurf mit Wasserzeichen und ohne Nummer", async () => {
    const t = await text(erzeugeBelegPdf({ ...beleg("en"), belegnummer: null }, { entwurf: true }));
    expect(t).toContain("interest posting");
    expect(t).toContain("no number (draft)");
    expect(t).toContain("(missing)");
    expect(t).toContain("draft");
    expect(t).toContain("30/09/2026");
  });

  it("Kopf- und Fußtext als Markdown erscheinen im PDF als einfacher Text mit Listenpunkten", async () => {
    const t = await text(erzeugeBelegPdf({ ...beleg("de"), kopftext: "**Wichtig** Hinweis\n\n* erster Punkt\n* zweiter Punkt", fusstext: "[Seite](https://beispiel.test)" }, { entwurf: false }));
    expect(t).not.toContain("**");
    expect(t).toContain("wichtig hinweis");
    expect(t).toContain("- erster punkt");
    expect(t).toContain("seite (https://beispiel.test)");
  });

  it("Daten gelangen nie als Typst-Markup in die Quelle", () => {
    const pdf = erzeugeBelegPdf({ ...beleg("de"), kopftext: '#panic("x") "]) #let' }, { entwurf: false });
    expect(pdf.length).toBeGreaterThan(1000);
  });
});

const auswertung = (sprache: Sprache): AuswertungExportDaten => ({
  fonds: { name: "Beispielfonds Test", kurzname: "BF T" },
  sicht: "bilanz",
  sprache,
  zeitraumVon: "2026-07-01",
  zeitraumBis: "2026-09-30",
  waehrung: "EUR",
  erzeugtAm: "2026-11-20T10:00:00Z",
  zeilen: [
    { ebene: 0, bezeichnungDe: "Aktiva", bezeichnungEn: "Assets", wert: "1050.00", blatt: false, konten: [] },
    { ebene: 1, bezeichnungDe: "Bank", bezeichnungEn: "Bank", wert: "300.00", blatt: true, konten: [{ konto: "1200", bezeichnung: "Bank", saldo: "300.00", beitrag: "300.00", regelId: "r1" }] },
  ],
  nichtZugeordnet: [{ konto: "9999", bezeichnung: "Offen", saldo: "1.00" }],
  abstimmung: [{ bezeichnung: "Portfolio", carraway: "100.00", buchhaltung: "90.00", differenz: "10.00" }],
});

describe("Auswertung als PDF und Excel", () => {
  it("PDF in beiden Sprachen mit Herkunft und nicht zugeordneten Konten", async () => {
    const de = await text(erzeugeAuswertungPdf(auswertung("de")));
    expect(de).toContain("bilanz");
    expect(de).toContain("aktiva");
    expect(de).toContain("1.050,00");
    expect(de).toContain("nicht zugeordnete konten");
    expect(de).toContain("9999");
    expect(de).toContain("abstimmung");
    const en = await text(erzeugeAuswertungPdf(auswertung("en")));
    expect(en).toContain("balance sheet");
    expect(en).toContain("assets");
    expect(en).toContain("1,050.00");
    expect(en).toContain("unassigned accounts");
  });

  it("Excel: Beträge als Zahlen, Herkunftsblatt, Blatt für nicht zugeordnete Konten und Abstimmung", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await erzeugeAuswertungExcel(auswertung("de"))) as unknown as ExcelJS.Buffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Bilanz", "Herkunft der Zeilen", "Nicht zugeordnete Konten", "Abstimmung"]);
    const a = wb.getWorksheet("Bilanz")!;
    expect(a.getRow(2).getCell(2).value).toBe(1050);
    expect(typeof a.getRow(3).getCell(2).value).toBe("number");
    expect(wb.getWorksheet("Herkunft der Zeilen")!.getRow(2).getCell(2).value).toBe("1200");
    const en = new ExcelJS.Workbook();
    await en.xlsx.load(Buffer.from(await erzeugeAuswertungExcel(auswertung("en"))) as unknown as ExcelJS.Buffer);
    expect(en.worksheets[0]!.name).toBe("Balance sheet");
    expect(en.worksheets[0]!.getRow(1).getCell(1).value).toBe("Item");
  });
});
