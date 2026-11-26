import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { DateiFehler } from "../lesen";
import { absaetzeAusDocx, extrahiereDocx, extrahiereXlsx, leseZipEintrag, pruefeEintragsgroessen, seitenAusAbsaetzen } from "../office";

let await_xlsx: Uint8Array;
async function xlsx(): Promise<Uint8Array> {
  const mappe = new ExcelJS.Workbook();
  mappe.addWorksheet("A").addRow(["x", 1]);
  await_xlsx = new Uint8Array(await mappe.xlsx.writeBuffer());
  return await_xlsx;
}

describe("Textauszug aus Office-Dokumenten", () => {
  it("leseZipEintrag liest einen Eintrag, liefert null für fehlende und bricht bei Überschreitung der Grenze ab", async () => {
    const daten = await xlsx();
    expect(leseZipEintrag(daten, "xl/workbook.xml")).not.toBeNull();
    expect(leseZipEintrag(daten, "gibt/es/nicht.xml")).toBeNull();
    expect(() => leseZipEintrag(daten, "xl/workbook.xml", 10)).toThrow(DateiFehler);
  });

  it("DOCX-XML: Dokumenttypdeklaration und Entitäten werden abgelehnt, vordefinierte Zeichenverweise aufgelöst", () => {
    expect(() => absaetzeAusDocx('<!DOCTYPE d [<!ENTITY a "x">]><w:p><w:r><w:t>&a;</w:t></w:r></w:p>')).toThrow(DateiFehler);
    const a = absaetzeAusDocx("<w:p><w:r><w:t>A &amp; B &lt;c&gt; &#65;&#x42; &undefined;</w:t></w:r></w:p>");
    expect(a.map((x) => x.text)).toEqual(["A & B <c> AB &undefined;"]);
  });

  it("Tabellenzellen stehen mit Tabulator in einer Zeile, Abschnittsenden beginnen eine neue Seite, lange Absätze werden zerteilt", () => {
    const xml = "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>a</w:t></w:r></w:p><w:p><w:r><w:t>b</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>c</w:t></w:r></w:p></w:tc></w:tr></w:tbl>";
    expect(absaetzeAusDocx(xml).map((x) => x.text)).toEqual(["a b\tc"]);
    const seiten = seitenAusAbsaetzen([{ text: "eins", abschnittsende: true }, { text: "zwei", abschnittsende: false }, { text: "wort ".repeat(1500), abschnittsende: false }]);
    expect(seiten.map((s) => s.seite)).toEqual([1, 2, 3, 4, 5]);
    expect(seiten[0]!.text).toBe("eins");
    expect(seiten.every((s) => s.text.length <= 3000)).toBe(true);
  });

  it("kein Archiv oder fehlendes document.xml ergibt fehler, ein leeres Blatt kein_text", async () => {
    expect(extrahiereDocx(new Uint8Array([1, 2, 3]))).toMatchObject({ status: "fehler", grund: "nicht_lesbar" });
    expect(await extrahiereXlsx(new Uint8Array([1, 2, 3]))).toMatchObject({ status: "fehler" });
    const leer = new ExcelJS.Workbook();
    leer.addWorksheet("Leer");
    expect(await extrahiereXlsx(new Uint8Array(await leer.xlsx.writeBuffer()))).toEqual({ status: "kein_text", seiten: [] });
    // Eine XLSX ist kein DOCX
    expect(extrahiereDocx(await xlsx())).toMatchObject({ status: "fehler" });
  });

  it("gebaute Angriffs-XML: nicht beendete Tags, Anführungszeichen und Leerraum laufen linear oder brechen sofort ab", () => {
    const faelle = [
      "<w:p " + "a".repeat(1_000_000),
      "<w:p " + "'\"".repeat(500_000),
      "<w:p a=\"" + "x".repeat(1_000_000),
      "<".repeat(1_000_000),
      "<w:p " + "<a ".repeat(300_000),
      "<w:r><w:t>" + " ".repeat(1_000_000) + "x</w:t></w:r></w:p>",
      "<!--" + "-".repeat(1_000_000),
      "<w:t>" + "&amp;".repeat(200_000) + "</w:t>",
    ];
    for (const xml of faelle) {
      const start = performance.now();
      try {
        absaetzeAusDocx(xml);
      } catch (fehler) {
        expect(fehler).toBeInstanceOf(DateiFehler);
      }
      expect(performance.now() - start).toBeLessThan(200);
    }
  });

  it("ein XML-Eintrag über der Grenze wird abgelehnt", async () => {
    await xlsx();
    expect(() => pruefeEintragsgroessen(await_xlsx, 10, 1_000_000)).toThrow(DateiFehler);
    // jeder Eintrag zählt, auch einer ohne XML-Endung
    expect(() => pruefeEintragsgroessen(await_xlsx, 1_000_000, 10)).toThrow(DateiFehler);
    expect(() => pruefeEintragsgroessen(await_xlsx)).not.toThrow();
  });
});
