import { deflateRawSync } from "node:zlib";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  BELEGFELD_ERLAUBT,
  DateiFehler,
  EXTF_FORMATKATEGORIE,
  EXTF_FORMATVERSION,
  EXTF_KOPFFELDER,
  EXTF_SPALTEN,
  EXTF_VERSIONSNUMMER,
  MIN_BERATERNUMMER,
  extfKopfzeile,
  kodiereWindows1252,
  leseSusa,
  parseSusaBetrag,
  schreibeExtf,
  type ExtfBuchung,
  type ExtfKopf,
} from "../index";

const cp1252 = (text: string) => Uint8Array.from(Buffer.from(text, "latin1"));

describe("parseSusaBetrag", () => {
  it("versteht Dezimalkomma, Tausenderpunkt, nachgestelltes Minus und S/H", () => {
    expect(parseSusaBetrag("1.234,56")).toBe("1234.56");
    expect(parseSusaBetrag("1234,5")).toBe("1234.50");
    expect(parseSusaBetrag("1.234")).toBe("1234.00");
    expect(parseSusaBetrag("12,50-")).toBe("-12.50");
    expect(parseSusaBetrag("-12,50")).toBe("-12.50");
    expect(parseSusaBetrag("100,00 S")).toBe("100.00");
    expect(parseSusaBetrag("100,00H")).toBe("-100.00");
    expect(parseSusaBetrag("1234.5", true)).toBe("1234.50");
    expect(parseSusaBetrag("1.234", true)).toBe("1.23"); // Excel-Zahl: Punkt ist Dezimalzeichen, auf Cent gerundet
    expect(parseSusaBetrag("abc")).toBeNull();
    expect(parseSusaBetrag("1,2,3")).toBeNull();
    expect(parseSusaBetrag("")).toBeNull();
  });
});

describe("SuSa-Leser: CSV", () => {
  it("liest das DATEV-Profil in Windows-1252 mit Dezimalkomma und S/H", async () => {
    const csv = ["Konto;Kontobeschriftung;EB-Wert;EB-Wert S/H;Soll;Haben;Saldo;Saldo S/H", "1200;Bank für Förderung;1.000,00;S;500,00;200,00;1.300,00;S", "4000;Zinserträge;0,00;S;0,00;300,00;300,00;H"].join("\r\n");
    const gelesen = await leseSusa(cp1252(csv));
    expect(gelesen.format).toBe("datev");
    expect(gelesen.befunde).toEqual([]);
    expect(gelesen.zeilen).toEqual([
      { zeile: 2, konto: "1200", bezeichnung: "Bank für Förderung", eb: "1000.00", soll: "500.00", haben: "200.00", saldo: "1300.00" },
      { zeile: 3, konto: "4000", bezeichnung: "Zinserträge", eb: "0.00", soll: "0.00", haben: "300.00", saldo: "-300.00" },
    ]);
  });

  it("liest das generische Format (Saldo mit Vorzeichen, auch ohne Saldo-Spalte aus Soll und Haben)", async () => {
    const a = await leseSusa(Buffer.from("konto,bezeichnung,saldo\n1200,Bank,\"100.50\"\n4000,Ertrag,-100.50\n"));
    expect(a.format).toBe("generisch");
    expect(a.zeilen.map((z) => z.saldo)).toEqual(["100.50", "-100.50"]);
    const b = await leseSusa(Buffer.from("Konto;Bezeichnung;Soll;Haben\n1200;Bank;1.000,00;250,00\n"));
    expect(b.zeilen[0]!.saldo).toBe("750.00");
  });

  it("meldet fehlende Spalten, ungültige Konten, doppelte Konten, Beträge und abweichende Salden", async () => {
    const ohneKonto = await leseSusa(Buffer.from("Bezeichnung;Saldo\nBank;1,00\n"));
    expect(ohneKonto.befunde.map((b) => b.code)).toEqual(["SUSA_SPALTE_FEHLT"]);
    const csv = ["Konto;Bezeichnung;Soll;Haben;Saldo", "12x0;Bank;1,00;0,00;1,00", "1200;Bank;1,00;0,00;1,00", "1200;Doppelt;1,00;0,00;1,00", "1300;Kasse;abc;0,00;1,00", "1400;Falsch;10,00;0,00;11,00"].join("\n");
    const g = await leseSusa(Buffer.from(csv));
    expect(g.zeilen.map((z) => z.konto)).toEqual(["1200"]);
    expect(g.befunde.map((b) => b.code)).toEqual(["SUSA_KONTO_UNGUELTIG", "SUSA_KONTO_DOPPELT", "SUSA_BETRAG_UNGUELTIG", "SUSA_SALDO_ABWEICHEND"]);
    expect(g.befunde.every((b) => b.schweregrad === "fehler")).toBe(true);
    expect(g.befunde[1]!.zeile).toBe(4);
  });

  it("lehnt andere Dateitypen ab und meldet eine Datei ohne Konten", async () => {
    await expect(leseSusa(Buffer.from("%PDF-1.7 xyz"))).rejects.toMatchObject({ code: "DATEITYP_UNBEKANNT" });
    await expect(leseSusa(Buffer.from("\n\n"))).rejects.toBeInstanceOf(DateiFehler);
    const leer = await leseSusa(Buffer.from("Konto;Saldo\n"));
    expect(leer.befunde.map((b) => b.code)).toEqual(["SUSA_KEINE_ZEILEN"]);
  });
});

describe("SuSa-Leser: Excel", () => {
  it("liest Zahlen mit Punkt und prüft die ZIP-Datei", async () => {
    const wb = new ExcelJS.Workbook();
    const blatt = wb.addWorksheet("SuSa");
    blatt.addRow(["Konto", "Bezeichnung", "Saldo"]);
    blatt.addRow([1200, "Bank", 1234.5]);
    blatt.addRow([4000, "Ertrag", -1234.5]);
    const bytes = new Uint8Array(await wb.xlsx.writeBuffer());
    const g = await leseSusa(bytes);
    expect(g.dateityp).toBe("xlsx");
    expect(g.zeilen.map((z) => [z.konto, z.saldo])).toEqual([["1200", "1234.50"], ["4000", "-1234.50"]]);
    // abgeschnittene ZIP-Datei: beschädigt, nie ein Absturz
    await expect(leseSusa(bytes.subarray(0, bytes.length - 30))).rejects.toMatchObject({ code: "DATEI_BESCHAEDIGT" });
  });

  it("lehnt eine Zip-Bombe ab", async () => {
    const roh = Buffer.alloc(150 * 1024 * 1024, 0);
    const gepackt = deflateRawSync(roh);
    // minimales ZIP mit einem Eintrag, dessen Größenangabe stimmt, aber über der Grenze liegt
    const name = Buffer.from("x.xml");
    const lokal = Buffer.alloc(30);
    lokal.writeUInt32LE(0x04034b50, 0);
    lokal.writeUInt16LE(8, 8);
    lokal.writeUInt32LE(gepackt.length, 18);
    lokal.writeUInt32LE(roh.length, 22);
    lokal.writeUInt16LE(name.length, 26);
    const zentral = Buffer.alloc(46);
    zentral.writeUInt32LE(0x02014b50, 0);
    zentral.writeUInt16LE(8, 10);
    zentral.writeUInt32LE(gepackt.length, 20);
    zentral.writeUInt32LE(roh.length, 24);
    zentral.writeUInt16LE(name.length, 28);
    zentral.writeUInt32LE(0, 42);
    const lokalGesamt = Buffer.concat([lokal, name, gepackt]);
    const zentralGesamt = Buffer.concat([zentral, name]);
    const ende = Buffer.alloc(22);
    ende.writeUInt32LE(0x06054b50, 0);
    ende.writeUInt16LE(1, 8);
    ende.writeUInt16LE(1, 10);
    ende.writeUInt32LE(zentralGesamt.length, 12);
    ende.writeUInt32LE(lokalGesamt.length, 16);
    await expect(leseSusa(Buffer.concat([lokalGesamt, zentralGesamt, ende]))).rejects.toMatchObject({ code: "DATEI_ZU_GROSS" });
  });
});

describe("DATEV EXTF: Feldliste und Schreiber", () => {
  const kopf: ExtfKopf = { berater: 1234567, mandant: 12345, wirtschaftsjahrBeginn: "2026-01-01", sachkontenlaenge: 4, datumVon: "2026-07-01", datumBis: "2026-09-30", bezeichnung: "Zinslauf Q3 2026", erzeugtAm: new Date("2026-11-20T10:11:12.345Z") };
  const buchung: ExtfBuchung = { betrag: "1234.56", richtung: "S", konto: "1200", gegenkonto: "8010", buSchluessel: null, belegdatum: "2026-09-30", belegfeld1: "BF-000001", buchungstext: "Zins Beispiel GmbH Q3" };

  it("Kopfzeile: 31 Felder, EXTF, 700, Kategorie 21, Formatversion 13, Berater, Mandant, WJ-Beginn, Sachkontenlänge, Zeitraum", () => {
    expect(EXTF_KOPFFELDER).toHaveLength(31);
    const felder = extfKopfzeile(kopf);
    expect(felder).toHaveLength(31);
    expect(felder[0]).toBe('"EXTF"');
    expect(felder[1]).toBe(String(EXTF_VERSIONSNUMMER));
    expect(felder[2]).toBe(String(EXTF_FORMATKATEGORIE));
    expect(felder[3]).toBe('"Buchungsstapel"');
    expect(felder[4]).toBe(String(EXTF_FORMATVERSION));
    expect(felder[5]).toBe("20261120101112345");
    expect(felder[10]).toBe("1234567");
    expect(felder[11]).toBe("12345");
    expect(felder[12]).toBe("20260101");
    expect(felder[13]).toBe("4");
    expect(felder[14]).toBe("20260701");
    expect(felder[15]).toBe("20260930");
    expect(felder[16]).toBe('"Zinslauf Q3 2026"');
    expect(felder[21]).toBe('"EUR"');
  });

  it("Spaltenliste: 125 Überschriften, die ersten vierzehn wie in der Beschreibung, keine Doppelten außer den nummerierten Gruppen", () => {
    expect(EXTF_SPALTEN).toHaveLength(125);
    expect(EXTF_SPALTEN.slice(0, 14)).toEqual([
      "Umsatz (ohne Soll/Haben-Kz)", "Soll/Haben-Kennzeichen", "WKZ Umsatz", "Kurs", "Basisumsatz", "WKZ Basisumsatz", "Konto", "Gegenkonto (ohne BU-Schlüssel)", "BU-Schlüssel", "Belegdatum", "Belegfeld 1", "Belegfeld 2", "Skonto", "Buchungstext",
    ]);
    expect(new Set(EXTF_SPALTEN).size).toBe(125);
  });

  it("Kopfzeile und Spaltenüberschriften stimmen mit der öffentlichen Beispieldatei einer Open-Source-Umsetzung überein (Aufbau, Anführungszeichen, leere Felder)", () => {
    // Zeile 1 der Beispieldatei: "EXTF";700;21;"Buchungsstapel";13;20180306102500000;;"XY";"Chief Accounting Officer";;1001;456;20180101;4;20180201;20180228;"Beispiel-Buchungen";;1;;0;"EUR";;;;;;;;;
    const felder = extfKopfzeile({ berater: 1001, mandant: 456, wirtschaftsjahrBeginn: "2018-01-01", sachkontenlaenge: 4, datumVon: "2018-02-01", datumBis: "2018-02-28", bezeichnung: "Beispiel-Buchungen", erzeugtAm: new Date("2018-03-06T10:25:00.000Z") });
    expect(felder.slice(0, 7).join(";")).toBe('"EXTF";700;21;"Buchungsstapel";13;20180306102500000;');
    expect(felder.slice(9, 17).join(";")).toBe(';1001;456;20180101;4;20180201;20180228;"Beispiel-Buchungen"');
    expect(felder[17]).toBe(""); // Diktatkürzel leer
    expect(felder[18]).toBe("1"); // Buchungstyp Finanzbuchhaltung
    expect(felder[20]).toBe("0"); // Festschreibung: keine
    expect(felder[26]).toBe(""); // SKR: nicht belegt
    expect(MIN_BERATERNUMMER).toBe(1001);
    // Zeile 2: Stellen der Felder, die der Import nach Position liest
    expect(EXTF_SPALTEN.indexOf("Konto")).toBe(6);
    expect(EXTF_SPALTEN.indexOf("Belegdatum")).toBe(9);
    expect(EXTF_SPALTEN.indexOf("Belegfeld 1")).toBe(10);
    expect(EXTF_SPALTEN.indexOf("Buchungstext")).toBe(13);
    expect(EXTF_SPALTEN.indexOf("Beleglink")).toBe(19);
    expect(EXTF_SPALTEN.indexOf("KOST1 – Kostenstelle")).toBe(36);
    expect(EXTF_SPALTEN.indexOf("Zusatzinformation – Art 1")).toBe(47);
    expect(EXTF_SPALTEN.indexOf("Stück")).toBe(87);
    expect(EXTF_SPALTEN.at(-1)).toBe("Abw. Skontokonto");
  });

  it("Datei: Windows-1252, CR LF, Semikolon, Dezimalkomma, Zeilen in voller Breite, Storno vertauscht das Kennzeichen", () => {
    const e = schreibeExtf(kopf, [{ ...buchung, buchungstext: "Zins Müller – Q3 €" }, { ...buchung, betrag: "-100.00", belegfeld1: "BF-000002" }]);
    expect(e.probleme).toEqual([]);
    expect(e.anzahl).toBe(2);
    const zeilen = e.text.split("\r\n");
    expect(zeilen).toHaveLength(5); // Kopf, Spalten, zwei Buchungen, Rest nach dem letzten Zeilenende
    expect(zeilen[4]).toBe("");
    expect(zeilen[1]!.split(";")).toEqual([...EXTF_SPALTEN]);
    const z1 = zeilen[2]!.split(";");
    expect(z1).toHaveLength(125);
    expect(z1.slice(0, 14)).toEqual(["1234,56", '"S"', '"EUR"', "", "", "", "1200", "8010", "", "3009", '"BF-000001"', "", "", '"Zins Müller – Q3 €"']);
    const z2 = zeilen[3]!.split(";");
    expect(z2[0]).toBe("100,00");
    expect(z2[1]).toBe('"H"');
    // Bytes: ü = 0xFC, Gedankenstrich = 0x96, Euro = 0x80
    const bytes = [...e.bytes];
    expect(bytes).toContain(0xfc);
    expect(bytes).toContain(0x96);
    expect(bytes).toContain(0x80);
    expect(bytes).not.toContain(0xc3); // kein UTF-8
    expect(Buffer.from(e.bytes).toString("latin1").split("\r\n")[0]!.startsWith('"EXTF";700;21;"Buchungsstapel";13;')).toBe(true);
  });

  it("meldet Kontolänge, Belegfeld, Zeichen außerhalb von Windows-1252, Zeitraum über zwölf Monate und Beträge von null", () => {
    const e = schreibeExtf({ ...kopf, datumVon: "2026-01-01", datumBis: "2027-01-31" }, [
      { ...buchung, konto: "12000" },
      { ...buchung, belegfeld1: "B 1" },
      { ...buchung, buchungstext: "Ünï 日本" },
      { ...buchung, betrag: "0.00" },
    ]);
    expect(e.probleme.map((p) => p.code).sort()).toEqual(["EXPORT_BELEGFELD_UNGUELTIG", "EXPORT_BETRAG_NULL", "EXPORT_KONTO_LAENGE", "EXPORT_ZEICHEN_NICHT_DARSTELLBAR", "EXPORT_ZEITRAUM_ZU_GROSS"]);
    expect(e.anzahl).toBe(3);
  });

  it("Windows-1252: Latin-1-Bereich und der Bereich 0x80 bis 0x9F unterscheiden sich", () => {
    expect([...kodiereWindows1252("€„“–").bytes]).toEqual([0x80, 0x84, 0x93, 0x96]);
    expect([...kodiereWindows1252("äöüß").bytes]).toEqual([0xe4, 0xf6, 0xfc, 0xdf]);
    expect(kodiereWindows1252("日").nichtDarstellbar).toEqual(["日"]);
    expect(BELEGFELD_ERLAUBT.test("A".repeat(36))).toBe(true);
    expect(BELEGFELD_ERLAUBT.test("A".repeat(37))).toBe(false);
  });
});
