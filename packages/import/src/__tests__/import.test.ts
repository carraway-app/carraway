import { randomBytes } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  ANLEITUNG_NAMEN,
  BLAETTER,
  BLATT_NAMEN,
  DateiFehler,
  MAX_PARAMS,
  MAX_PARAM_LAENGE,
  SPALTEN,
  kappeParams,
  erkenneDateityp,
  erzeugeMappe,
  erzeugeVorlage,
  leseDatei,
  MAX_CSV_BYTES,
  MAX_ZEILEN,
  parseCsv,
  parseDatum,
  parseZahl,
  pruefeInhalt,
  pruefeZip,
  sammleExterneVerweise,
  spaltenkopf,
  typisiere,
  type Befund,
  type Blatt,
  type Blattzeilen,
  type Extern,
  type Sprache,
} from "../index";
import { alsCsv, beispielZeilen, erzeugeBeispiel } from "../beispiel";

const leer: Extern = { fonds: new Set(), organisationen: new Set(), beteiligungen: new Set(), finanzierungsrunden: new Set(), vorgaenge: new Set() };

async function pruefeDatei(daten: Uint8Array, extern: Extern = leer, dateiname?: string) {
  const gelesen = await leseDatei(daten, { dateiname });
  const befunde: Befund[] = [...gelesen.befunde];
  const typisiert = typisiere(gelesen, befunde);
  const namen = Object.fromEntries(BLAETTER.map((b) => [b, gelesen.blaetter[b]?.name ?? BLATT_NAMEN[b].de])) as Record<Blatt, string>;
  befunde.push(...pruefeInhalt(typisiert, namen, extern));
  return { gelesen, typisiert, befunde };
}

const codes = (befunde: Befund[]) => befunde.map((b) => b.code);

/** Kleine, in sich stimmige Datei als Zeilen. */
function klein(): Blattzeilen {
  return {
    fonds: [{ fonds_kurzname: "BF-T", name: "Testfonds", vintage: "2021", zeichnungskapital: "10000000.00" }],
    organisationen: [{ organisation_schluessel: "O1", name: "Nordlicht Technik", art: "unternehmen" }],
    beteiligungen: [{ beteiligung_schluessel: "B1", fonds_kurzname: "BF-T", organisation_schluessel: "O1", instrument: "darlehen", erstinvestment: "2022-01-15" }],
    vorgaenge: [
      { vorgang_schluessel: "V1", beteiligung_schluessel: "B1", art: "zusage", valuta: "2022-01-15", betrag: "500000.00" },
      { vorgang_schluessel: "V2", beteiligung_schluessel: "B1", art: "auszahlung", valuta: "2022-02-01", betrag: "300000.00" },
    ],
  };
}

describe("Importvorlage", () => {
  for (const sprache of ["de", "en"] as Sprache[]) {
    it(`${sprache}: ein Blatt je Objekt, Köpfe in der Sprache, Auswahllisten, Anleitung`, async () => {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load((await erzeugeVorlage(sprache)) as unknown as ExcelJS.Buffer);
      const namen = wb.worksheets.map((w) => w.name);
      expect(namen[0]).toBe(ANLEITUNG_NAMEN[sprache]);
      expect(namen.slice(1)).toEqual(BLAETTER.map((b) => BLATT_NAMEN[b][sprache]));
      for (const blatt of BLAETTER) {
        const ws = wb.getWorksheet(BLATT_NAMEN[blatt][sprache])!;
        const kopf = SPALTEN[blatt].map((_, i) => String(ws.getCell(1, i + 1).value));
        expect(kopf).toEqual(SPALTEN[blatt].map((s) => spaltenkopf(s, sprache)));
        const regeln = (ws as unknown as { dataValidations: { model: Record<string, { type: string; formulae: unknown[] }> } }).dataValidations.model;
        SPALTEN[blatt].forEach((s, i) => {
          if (!s.auswahl) return;
          const col = String.fromCharCode(65 + i);
          const regel = regeln[`${col}2:${col}5000`] ?? Object.entries(regeln).find(([k]) => k.startsWith(`${col}2`))?.[1];
          expect(regel?.type, `${blatt}.${s.schluessel}`).toBe("list");
          expect(regel!.formulae[0]).toBe(`"${s.auswahl.map((x) => x[sprache]).join(",")}"`);
        });
      }
      const anleitung = wb.getWorksheet(ANLEITUNG_NAMEN[sprache])!;
      const zellen: string[] = [];
      anleitung.eachRow((r) => zellen.push(String(r.getCell(1).value ?? "")));
      expect(zellen.some((z) => z.includes(sprache === "de" ? "Schlüssel" : "Keys"))).toBe(true);
    });
  }

  it("beide Köpfe sind verschieden und die englische Vorlage liest sich zurück wie die deutsche", async () => {
    const zeilen = klein();
    const de = await pruefeDatei(await erzeugeMappe("de", zeilen));
    const en = await pruefeDatei(await erzeugeMappe("en", zeilen));
    expect(de.befunde).toEqual([]);
    expect(en.befunde).toEqual([]);
    expect(de.gelesen.sprache).toBe("de");
    expect(en.gelesen.sprache).toBe("en");
    expect(en.typisiert.vorgaenge.map((z) => z.w)).toEqual(de.typisiert.vorgaenge.map((z) => z.w));
  });

  it("die leere Vorlage ist lesbar und ergibt keine Zeilen", async () => {
    const r = await pruefeDatei(await erzeugeVorlage("de"));
    expect(r.befunde).toEqual([]);
    expect(Object.keys(r.gelesen.blaetter)).toEqual([]);
  });
});

describe("Zahlen und Datum", () => {
  it.each([
    ["1234,56", "1234.56"],
    ["1.234,56", "1234.56"],
    ["1,234.56", "1234.56"],
    ["1234.5", "1234.5"],
    ["1.234", "1234"],
    ["0.123", "0.123"],
    ["-12,5", "-12.5"],
    ["(12,50)", "-12.5"],
    ["1.234.567,89", "1234567.89"],
    ["€ 1 000,00", "1000"],
    ["abc", null],
    ["1,2,3", null],
    ["", null],
  ])("parseZahl(%s)", (roh, erwartet) => expect(parseZahl(roh)).toBe(erwartet));

  it("Datum: ISO und deutsch, echte Kalenderdaten", () => {
    expect(parseDatum("2024-02-29")).toBe("2024-02-29");
    expect(parseDatum("5.3.2021")).toBe("2021-03-05");
    expect(parseDatum("2021-03-05T00:00:00.000Z")).toBe("2021-03-05");
    expect(parseDatum("2023-02-29")).toBeNull();
    expect(parseDatum("31.04.2023")).toBeNull();
    expect(parseDatum("1850-01-01")).toBeNull();
    expect(parseDatum("morgen")).toBeNull();
  });
});

describe("CSV", () => {
  const zeilen = klein();
  zeilen.organisationen![0]!.name = "Müller & Söhne Technik";
  zeilen.vorgaenge![0]!.betrag = "500000.50";

  it("UTF-8 mit Semikolon und Dezimalkomma, deutsches Datum", async () => {
    const csv = alsCsv("vorgaenge", zeilen, { dezimalkomma: true, deutschesDatum: true });
    expect(csv.toString("utf8")).toContain("500000,50");
    const r = await pruefeDatei(csv, { ...leer, beteiligungen: new Set(["B1"]) }, "vorgaenge.csv");
    expect(r.befunde).toEqual([]);
    expect(r.gelesen.dateityp).toBe("csv");
    expect(r.typisiert.vorgaenge[0]!.w).toMatchObject({ betrag: "500000.50", valuta: "2022-01-15" });
  });

  it("Windows-1252 mit Umlauten", async () => {
    const csv = alsCsv("organisationen", zeilen, { kodierung: "windows-1252" });
    expect(csv.includes(Buffer.from("Müller", "latin1"))).toBe(true);
    const r = await pruefeDatei(csv);
    expect(r.befunde).toEqual([]);
    expect(r.typisiert.organisationen[0]!.w.name).toBe("Müller & Söhne Technik");
  });

  it("UTF-8 mit Kennung (BOM) und Umlauten", async () => {
    const csv = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), alsCsv("organisationen", zeilen)]);
    const r = await pruefeDatei(csv);
    expect(r.typisiert.organisationen[0]!.w.name).toBe("Müller & Söhne Technik");
  });

  it.each([",", "\t"] as const)("Trenner %j wird erkannt, Felder mit Trenner stehen in Anführungszeichen", async (trenner) => {
    const z = klein();
    z.organisationen![0]!.name = `Nord${trenner}licht "Technik"`;
    const r = await pruefeDatei(alsCsv("organisationen", z, { trenner, dezimalkomma: false }));
    expect(r.befunde).toEqual([]);
    expect(r.typisiert.organisationen[0]!.w.name).toBe(`Nord${trenner}licht "Technik"`);
  });

  it("englische Köpfe werden erkannt; das Blatt ergibt sich aus den Köpfen, nicht aus dem Dateinamen", async () => {
    const r = await pruefeDatei(alsCsv("fondsbewegungen", { fondsbewegungen: [{ bewegung_schluessel: "M1", fonds_kurzname: "X", art: "abruf", valuta: "2022-01-01", betrag: "10.00" }] }, { sprache: "en" }), { ...leer, fonds: new Set(["X"]) }, "irgendwas.csv");
    expect(r.gelesen.blaetter.fondsbewegungen?.zeilen).toHaveLength(1);
    expect(r.befunde).toEqual([]);
  });

  it("Köpfe, die zu keinem Blatt passen: BLATT_NICHT_ERKANNT", async () => {
    await expect(leseDatei(Buffer.from("a;b;c\n1;2;3\n"))).rejects.toMatchObject({ code: "BLATT_NICHT_ERKANNT" });
  });
});

describe("Dateityp nach den ersten Bytes", () => {
  it("erkennt xlsx und csv, lehnt anderes ab", async () => {
    expect(erkenneDateityp(await erzeugeVorlage("de"))).toBe("xlsx");
    expect(erkenneDateityp(Buffer.from("a;b\n1;2\n"))).toBe("csv");
    expect(erkenneDateityp(Buffer.from("%PDF-1.7\n..."))).toBeNull();
    expect(erkenneDateityp(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))).toBeNull();
    expect(erkenneDateityp(Buffer.from([0x4d, 0x5a, 0x90, 0x00]))).toBeNull();
    expect(erkenneDateityp(Buffer.from([0x61, 0x00, 0x62]))).toBeNull();
    expect(erkenneDateityp(Buffer.alloc(0))).toBeNull();
  });

  it("ein Text mit der Endung xlsx ist trotzdem csv; eine kaputte ZIP-Datei ist beschädigt", async () => {
    await expect(leseDatei(Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("kaputt kaputt kaputt kaputt")]))).rejects.toMatchObject({ code: "DATEI_BESCHAEDIGT" });
    await expect(leseDatei(Buffer.from("%PDF-1.4"))).rejects.toBeInstanceOf(DateiFehler);
  });
});

/** Baut eine ZIP-Datei mit einem Eintrag; `angegeben` fälscht die Größe im Zentralverzeichnis. */
function zip(inhalt: Buffer, angegeben?: number): Buffer {
  const gepackt = deflateRawSync(inhalt);
  const name = Buffer.from("xl/worksheets/sheet1.xml");
  const lokal = Buffer.alloc(30);
  lokal.writeUInt32LE(0x04034b50, 0);
  lokal.writeUInt16LE(20, 4);
  lokal.writeUInt16LE(8, 8);
  lokal.writeUInt32LE(gepackt.length, 18);
  lokal.writeUInt32LE(inhalt.length, 22);
  lokal.writeUInt16LE(name.length, 26);
  const zentral = Buffer.alloc(46);
  zentral.writeUInt32LE(0x02014b50, 0);
  zentral.writeUInt16LE(20, 4);
  zentral.writeUInt16LE(20, 6);
  zentral.writeUInt16LE(8, 10);
  zentral.writeUInt32LE(gepackt.length, 20);
  zentral.writeUInt32LE(angegeben ?? inhalt.length, 24);
  zentral.writeUInt16LE(name.length, 28);
  zentral.writeUInt32LE(0, 42);
  const verzeichnis = Buffer.concat([zentral, name]);
  const start = lokal.length + name.length + gepackt.length;
  const ende = Buffer.alloc(22);
  ende.writeUInt32LE(0x06054b50, 0);
  ende.writeUInt16LE(1, 8);
  ende.writeUInt16LE(1, 10);
  ende.writeUInt32LE(verzeichnis.length, 12);
  ende.writeUInt32LE(start, 16);
  return Buffer.concat([lokal, name, gepackt, verzeichnis, ende]);
}

describe("Zip-Bomben", () => {
  it("hohes Verhältnis laut Zentralverzeichnis (150 MB aus wenigen KB): DATEI_ZU_GROSS, ohne dass geparst wird", async () => {
    const bombe = zip(Buffer.alloc(150 * 1024 * 1024));
    expect(bombe.length).toBeLessThan(1024 * 1024);
    await expect(leseDatei(bombe)).rejects.toMatchObject({ code: "DATEI_ZU_GROSS" });
  });

  it("gefälschte kleine Größenangabe: das tatsächliche Entpacken wird begrenzt", async () => {
    const bombe = zip(Buffer.alloc(150 * 1024 * 1024), 1000);
    await expect(leseDatei(bombe)).rejects.toMatchObject({ code: "DATEI_ZU_GROSS" });
  });

  it("engere Grenzen für kleine Importe (Kontakte): Summe und Zahl der Einträge verschärfbar, eine zu kleine Größenangabe im Kopf täuscht nicht", () => {
    const acht = zip(randomBytes(2 * 1024 * 1024));
    expect(() => pruefeZip(acht)).not.toThrow();
    expect(() => pruefeZip(acht, { maxEntpackt: 1024 * 1024 })).toThrowError(expect.objectContaining({ code: "DATEI_ZU_GROSS" }));
    expect(() => pruefeZip(zip(Buffer.from("x".repeat(100))), { maxEintraege: 0 })).toThrowError(expect.objectContaining({ code: "DATEI_ZU_GROSS" }));
    expect(() => pruefeZip(zip(Buffer.from("x".repeat(5000)), 10))).toThrowError(expect.objectContaining({ code: "DATEI_ZU_GROSS" }));
  });

  it("viele kleine Einträge über der Summengrenze werden ebenfalls abgelehnt (Summe laut Angabe)", async () => {
    const bombe = zip(Buffer.alloc(120 * 1024 * 1024, 7), 120 * 1024 * 1024);
    await expect(leseDatei(bombe)).rejects.toMatchObject({ code: "DATEI_ZU_GROSS" });
  });
});

describe("Prüfregeln ohne Bestand", () => {
  const pruefe = async (aendere: (z: Blattzeilen) => void, extern: Extern = leer) => {
    const z = klein();
    aendere(z);
    return (await pruefeDatei(await erzeugeMappe("de", z), extern)).befunde;
  };

  it("die kleine Datei ist fehlerfrei", async () => expect(await pruefe(() => undefined)).toEqual([]));

  it("Pflichtfeld, Auswahl, Datum, Betrag, Nachkommastellen, Text", async () => {
    const b = await pruefe((z) => {
      delete z.fonds![0]!.name;
      z.organisationen![0]!.art = "kaputt";
      z.beteiligungen![0]!.erstinvestment = "2022-13-45";
      z.vorgaenge![0]!.betrag = "100.123";
      z.vorgaenge![1]!.betrag = "abc";
    });
    expect(codes(b)).toEqual(expect.arrayContaining(["PFLICHTFELD_FEHLT", "AUSWAHL_UNGUELTIG", "ZAHL_MEHRDEUTIG", "ZAHL_UNGUELTIG"]));
    // Datumswerte stehen in Excel als Datum: ein Text mit falschem Datum bleibt Text und wird abgelehnt.
    expect(b.find((x) => x.code === "PFLICHTFELD_FEHLT")).toMatchObject({ blatt: "fonds", blattName: "Fonds", zeile: 2, spalte: "name", schweregrad: "fehler", params: { spalte: "name" } });
  });

  it("params begrenzt: riesiger Zellwert wird auf 500 Zeichen gekürzt", async () => {
    const riesig = "x".repeat(100_000);
    const b = await pruefe((z) => {
      z.organisationen![0]!.art = riesig;
    });
    const befund = b.find((x) => x.code === "AUSWAHL_UNGUELTIG")!;
    expect(String(befund.params.wert).length).toBe(MAX_PARAM_LAENGE);
    expect(Object.keys(befund.params).length).toBeLessThanOrEqual(MAX_PARAMS);
  });

  it("kappeParams: höchstens 20 Schlüssel, Texte gekürzt, Verschachteltes als Text, Unendliches als Text", () => {
    const viele = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`k${i}`, "a".repeat(900)]));
    const k = kappeParams({ ...viele, obj: { a: 1 } });
    expect(Object.keys(k)).toHaveLength(MAX_PARAMS);
    expect(Object.values(k).every((v) => typeof v === "string" && v.length <= MAX_PARAM_LAENGE)).toBe(true);
    const k2 = kappeParams({ liste: [1, 2, 3], n: 5, unendlich: Infinity, leer: null, tief: { a: { b: "y".repeat(2000) } } });
    expect(k2).toMatchObject({ liste: "[1,2,3]", n: 5, unendlich: "null", leer: "null" });
    expect(String(k2.tief).length).toBe(MAX_PARAM_LAENGE);
    expect(kappeParams("kein objekt")).toEqual({});
    expect(kappeParams([1, 2])).toEqual({});
  });

  it("Datum als Text ungültig", async () => {
    const csv = Buffer.from("beteiligung_schluessel;fonds_kurzname;organisation_schluessel;instrument;erstinvestment\nB1;F;O;darlehen;31.02.2022\n");
    const r = await pruefeDatei(csv, { ...leer, fonds: new Set(["F"]), organisationen: new Set(["O"]) });
    expect(codes(r.befunde)).toContain("DATUM_UNGUELTIG");
  });

  it("Betrag null und negativ; Vorzeichen bei Vorgängen", async () => {
    const b = await pruefe((z) => {
      z.fondsbewegungen = [{ bewegung_schluessel: "M1", fonds_kurzname: "BF-T", art: "abruf", valuta: "2022-01-01", betrag: "0.00" }];
      z.vorgaenge![1]!.betrag = "-5.00";
    });
    expect(codes(b)).toEqual(expect.arrayContaining(["BETRAG_UNGUELTIG", "BETRAG_VORZEICHEN"]));
  });

  it("doppelte Schlüssel in Blättern und natürliche Schlüssel", async () => {
    const b = await pruefe((z) => {
      z.vorgaenge![1]!.vorgang_schluessel = "V1";
      z.beteiligungen!.push({ ...z.beteiligungen![0]!, beteiligung_schluessel: "B2" });
      z.konditionen = [
        { beteiligung_schluessel: "B1", gueltig_ab: "2022-01-15", satz_fix: "0.05", methode: "act/365", zinsperiode: "jaehrlich", anker: "2022-12-31" },
        { beteiligung_schluessel: "B1", gueltig_ab: "2022-01-15", satz_fix: "0.06", methode: "act/365", zinsperiode: "jaehrlich", anker: "2022-12-31" },
      ];
    });
    expect(b.filter((x) => x.code === "SCHLUESSEL_DOPPELT").map((x) => x.blatt).sort()).toEqual(["beteiligungen", "konditionen", "vorgaenge"]);
  });

  it("Verweise: unbekannt in Datei und Bestand, aber im Bestand bekannt ist gültig", async () => {
    const z = klein();
    z.vorgaenge![0]!.beteiligung_schluessel = "B-GIBT-ES-NICHT";
    z.beteiligungen![0]!.fonds_kurzname = "IM-BESTAND";
    const gelesen = await pruefeDatei(await erzeugeMappe("de", z));
    expect(codes(gelesen.befunde)).toContain("VERWEIS_UNBEKANNT");
    expect(sammleExterneVerweise(gelesen.typisiert).fonds).toEqual(["IM-BESTAND"]);
    const mitBestand = await pruefeDatei(await erzeugeMappe("de", z), { ...leer, fonds: new Set(["IM-BESTAND"]) });
    expect(mitBestand.befunde.filter((x) => x.spalte === "fonds_kurzname")).toEqual([]);
    expect(mitBestand.befunde.filter((x) => x.spalte === "beteiligung_schluessel")).toHaveLength(1);
  });

  it("Runden: Positionen ergeben das Rundenvolumen, Post über Pre, genau ein Investor", async () => {
    const runde = { runde_schluessel: "R1", organisation_schluessel: "O1", bezeichnung: "Series A", datum: "2022-05-01", pre_money: "1000000.00", post_money: "1500000.00", preis_je_anteil: "10.0000", anteile_gesamt_nach: "150000" };
    const gut = await pruefe((z) => {
      z.finanzierungsrunden = [runde];
      z.rundenpositionen = [
        { runde_schluessel: "R1", fonds_kurzname: "BF-T", betrag: "300000.00", anteile: "30000", rolle: "lead" },
        { runde_schluessel: "R1", investor_schluessel: "O1", betrag: "200000.00", anteile: "20000", rolle: "co" },
      ];
    });
    expect(gut).toEqual([]);
    const schlecht = await pruefe((z) => {
      z.finanzierungsrunden = [{ ...runde, post_money: "900000.00" }, { ...runde, runde_schluessel: "R2" }];
      z.rundenpositionen = [
        { runde_schluessel: "R1", fonds_kurzname: "BF-T", investor_schluessel: "O1", betrag: "300000.00", anteile: "30000", rolle: "lead" },
        { runde_schluessel: "R2", fonds_kurzname: "BF-T", betrag: "100.00", anteile: "1", rolle: "lead" },
      ];
    });
    expect(codes(schlecht)).toEqual(expect.arrayContaining(["RUNDE_POST_KLEINER_PRE", "POSITION_INVESTOR", "RUNDE_SUMME_ABWEICHEND"]));
  });

  it("Storno: Betrag, Art, Beteiligung, Valuta, doppelt, Selbstbezug", async () => {
    const b = await pruefe((z) => {
      z.vorgaenge!.push(
        { vorgang_schluessel: "S1", beteiligung_schluessel: "B1", art: "auszahlung", valuta: "2022-03-01", betrag: "-299999.00", storniert_vorgang_schluessel: "V2" },
        { vorgang_schluessel: "S2", beteiligung_schluessel: "B1", art: "auszahlung", valuta: "2022-03-01", betrag: "-300000.00", storniert_vorgang_schluessel: "V2" },
        { vorgang_schluessel: "S3", beteiligung_schluessel: "B1", art: "zusage", valuta: "2022-03-01", betrag: "-300000.00", storniert_vorgang_schluessel: "V2" },
        { vorgang_schluessel: "S4", beteiligung_schluessel: "B1", art: "auszahlung", valuta: "2022-01-01", betrag: "-300000.00", storniert_vorgang_schluessel: "V2" },
        { vorgang_schluessel: "S5", beteiligung_schluessel: "B1", art: "auszahlung", valuta: "2022-03-01", betrag: "-1.00", storniert_vorgang_schluessel: "S5" },
      );
    });
    const stornoFehler = b.filter((x) => x.code === "STORNO_UNGUELTIG");
    expect(stornoFehler.length).toBeGreaterThanOrEqual(4);
    expect(codes(b)).toContain("STORNO_DOPPELT");
  });

  it("Kreuzfelder: kapitalisiert nur bei Zins, Begründung der Bewertung, Gewinnsatz nur mit Kappung", async () => {
    const b = await pruefe((z) => {
      z.vorgaenge![0]!.kapitalisiert = "ja";
      z.bewertungen = [{ bewertung_schluessel: "W1", beteiligung_schluessel: "B1", stichtag: "2022-12-31", wert: "1.00", methode: "dcf" }];
      z.konditionen = [{ beteiligung_schluessel: "B1", gueltig_ab: "2022-01-15", satz_fix: "0.05", methode: "act/365", zinsperiode: "jaehrlich", anker: "2022-12-31", gewinnabhaengig_satz: "0.1" }];
    });
    expect(codes(b)).toEqual(expect.arrayContaining(["KAPITALISIERT_NUR_ZINS", "BEGRUENDUNG_FEHLT", "KONDITION_GEWINN_PAAR"]));
  });

  it("Köpfe: fehlende Pflichtspalte, doppelte Spalte, unbekannte Spalte, unbekanntes Blatt", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Fonds");
    ws.addRow(["fonds_kurzname", "name", "vintage", "vintage", "unsinn"]);
    ws.addRow(["X", "Y", 2020, 2021, "z"]);
    wb.addWorksheet("Sonstiges").addRow(["a"]);
    const r = await pruefeDatei(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(codes(r.befunde)).toEqual(expect.arrayContaining(["SPALTE_FEHLT", "SPALTE_DOPPELT", "SPALTE_UNBEKANNT", "BLATT_UNBEKANNT"]));
  });
});

describe("Beispieldatei", () => {
  it("ist in sich stimmig: alle Prüfungen ohne Bestand bestanden, Kontrollsummen je Fonds vorhanden", async () => {
    const r = await pruefeDatei(await erzeugeBeispiel("de"));
    expect(r.befunde.filter((b) => b.schweregrad === "fehler")).toEqual([]);
    expect(r.typisiert.fonds.length).toBeGreaterThanOrEqual(3);
    expect(r.typisiert.vorgaenge.length).toBeGreaterThan(30);
    expect(r.typisiert.kontrollsummen.length).toBe(r.typisiert.fonds.length * 4);
  });

  it("Rundreise Excel und CSV liefert dieselben Zeilen wie die Quelle", async () => {
    const quelle = beispielZeilen();
    const excel = await pruefeDatei(await erzeugeBeispiel("en"));
    const csv = await pruefeDatei(alsCsv("vorgaenge", quelle));
    expect(excel.typisiert.vorgaenge.map((z) => z.w)).toEqual(csv.typisiert.vorgaenge.map((z) => z.w));
    expect(excel.typisiert.vorgaenge).toHaveLength(quelle.vorgaenge!.length);
  });

  it("erfundene Daten: alle Adressen enden auf .example", () => {
    const quelle = beispielZeilen();
    for (const p of quelle.personen!) if (p.email) expect(p.email).toMatch(/\.example$/);
    for (const o of quelle.organisationen!) if (o.website) expect(o.website).toMatch(/\.example$/);
  });
});

describe("Zip-Aufbau und Größengrenzen", () => {
  const eocdVon = (z: Buffer) => z.length - 22;

  it("Anzahl im Abschlusssatz kleiner als die Einträge im Verzeichnis: abgelehnt", () => {
    const z = zip(Buffer.from("x".repeat(100)));
    z.writeUInt16LE(0, eocdVon(z) + 8);
    z.writeUInt16LE(0, eocdVon(z) + 10);
    return expect(leseDatei(z)).rejects.toMatchObject({ code: "DATEI_BESCHAEDIGT" });
  });

  it("Anzahl größer als die tatsächlichen Einträge, übrige Bytes im Verzeichnis und ZIP64-Marken: abgelehnt", async () => {
    const mehr = zip(Buffer.from("x".repeat(100)));
    mehr.writeUInt16LE(2, eocdVon(mehr) + 8);
    mehr.writeUInt16LE(2, eocdVon(mehr) + 10);
    await expect(leseDatei(mehr)).rejects.toMatchObject({ code: "DATEI_BESCHAEDIGT" });
    const rest = zip(Buffer.from("x".repeat(100)));
    rest.writeUInt32LE(rest.readUInt32LE(eocdVon(rest) + 12) + 10, eocdVon(rest) + 12);
    await expect(leseDatei(rest)).rejects.toMatchObject({ code: "DATEI_BESCHAEDIGT" });
    const z64 = zip(Buffer.from("x".repeat(100)));
    z64.writeUInt16LE(0xffff, eocdVon(z64) + 10);
    z64.writeUInt16LE(0xffff, eocdVon(z64) + 8);
    await expect(leseDatei(z64)).rejects.toMatchObject({ code: "DATEI_BESCHAEDIGT" });
    const groesse64 = zip(Buffer.from("x".repeat(100)));
    groesse64.writeUInt32LE(0xffffffff, eocdVon(groesse64) + 16);
    await expect(leseDatei(groesse64)).rejects.toMatchObject({ code: "DATEI_BESCHAEDIGT" });
  });

  it("Excel mit mehr Zeilen als erlaubt (dünn besetzt) wird vor dem Lesen abgelehnt", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Fonds");
    ws.addRow(["fonds_kurzname", "name", "vintage", "zeichnungskapital"]);
    ws.getCell(MAX_ZEILEN + 50, 1).value = "x";
    await expect(leseDatei(Buffer.from(await wb.xlsx.writeBuffer()))).rejects.toMatchObject({ code: "DATEI_ZU_GROSS" });
  });

  it("Excel: Breite wird auf die erwartete Kopfbreite begrenzt (Zellen weit rechts bleiben unbeachtet)", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Fonds");
    ws.addRow(["fonds_kurzname", "name", "vintage", "zeichnungskapital"]);
    ws.addRow(["A", "B", 2020, 100]);
    ws.getCell(2, 16000).value = "weit weg";
    const r = await leseDatei(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(Object.keys(r.blaetter.fonds!.zeilen[0]!.werte).sort()).toEqual(["fonds_kurzname", "name", "vintage", "zeichnungskapital"]);
  });

  it("CSV über der Byte-Grenze, mit zu vielen Zeilen oder zu vielen Feldern: DATEI_ZU_GROSS", async () => {
    await expect(leseDatei(Buffer.alloc(MAX_CSV_BYTES + 1, 0x61))).rejects.toMatchObject({ code: "DATEI_ZU_GROSS" });
    expect(() => parseCsv("a\nb\nc\nd\n", ";", { zeilen: 2 })).toThrowError(/zu viele/);
    expect(() => parseCsv(Array.from({ length: 300 }, () => "x").join(";"), ";")).toThrowError(/zu viele/);
    const breit = Buffer.from(`fonds_kurzname;${Array.from({ length: 300 }, (_, i) => `c${i}`).join(";")}\nA\n`);
    await expect(leseDatei(breit)).rejects.toMatchObject({ code: "DATEI_ZU_GROSS" });
  });
});
