import { extractText, getDocumentProxy } from "unpdf";
import { describe, expect, it } from "vitest";
import { erzeugeMitteilung, mitteilungQuelle, type MitteilungsDaten } from "../index";

const basis: MitteilungsDaten = {
  fonds: { name: "Beispielfonds Test", kurzname: "BF T", waehrung: "EUR" },
  investor: "Muster Kapital",
  art: "abruf",
  valuta: "2026-03-31",
  betrag: "60000.01",
  fondsBetrag: "100000.01",
  anteil: "0.600000",
  referenz: "BF T / KA / 2026-03-31 / ABCD1234",
  erstelltAm: "2026-03-20T10:00:00Z",
  summen: { zusage: "600000.00", abgerufen: "60000.01", ausgeschuettet: "0.00", offeneZusage: "539999.99" },
};

async function text(bytes: Uint8Array) {
  const dokument = await getDocumentProxy(new Uint8Array(bytes));
  const ergebnis = await extractText(dokument, { mergePages: true });
  return { text: ergebnis.text.replace(/\s+/g, " "), seiten: ergebnis.totalPages };
}

describe("Mitteilung zu Kapitalabruf und Ausschüttung", () => {
  it("Deutsch: eine Seite mit Fonds, Investor, Anteil, Fälligkeit, Verwendungszweck-Platzhalter und Stand", async () => {
    const pdf = erzeugeMitteilung(basis, "de");
    expect(Buffer.from(pdf).subarray(0, 5).toString()).toBe("%PDF-");
    const { text: t, seiten } = await text(pdf);
    expect(seiten).toBe(1);
    for (const erwartet of ["Mitteilung zum Kapitalabruf", "Beispielfonds Test", "Muster Kapital", "60.000,01", "100.000,01", "60,0 %", "Fällig am", "31.03.2026", "BF T / KA / 2026-03-31 / ABCD1234", "Bankverbindung", "539.999,99", "Abrufe bis dahin"]) {
      expect(t, erwartet).toContain(erwartet);
    }
    expect(t).not.toContain("ENTWURF"); // eine freigegebene Mitteilung ist kein Entwurf
  });

  it("Englisch: Ausschüttung mit Valuta und englischen Formaten", async () => {
    const { text: t } = await text(erzeugeMitteilung({ ...basis, art: "ausschuettung", betrag: "12000.00", fondsBetrag: "20000.00", summen: { ...basis.summen, ausgeschuettet: "12000.00" } }, "en"));
    for (const erwartet of ["Distribution notice", "Value date", "31/03/2026", "12,000.00", "20,000.00", "60.0%", "Distributed to date", "Payment reference", "Bank details"]) expect(t, erwartet).toContain(erwartet);
  });

  it("Namen und Verwendungszweck gehen als Daten in den Quelltext, nie als Typst-Code", () => {
    const quelle = mitteilungQuelle({ ...basis, investor: 'Böse "Kapital" #panic("x") \\ $', referenz: "#let x = 1" }, "de");
    expect(quelle).toContain(String.raw`investor: "Böse \"Kapital\" #panic(\"x\") \\ $"`);
    expect(quelle).toContain('"#let x = 1"');
    // und das PDF entsteht trotzdem (der Text ist Inhalt, kein Code)
    expect(() => erzeugeMitteilung({ ...basis, investor: 'Böse "Kapital" #panic("x") \\ $' }, "de")).not.toThrow();
  });
});
