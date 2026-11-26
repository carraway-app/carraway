import { sql } from "drizzle-orm";
import ExcelJS from "exceljs";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { beispielZeilen, erzeugeBeispiel, alsCsv } from "@carraway/import/beispiel";
import { erzeugeMappe, type Blattzeilen } from "@carraway/import";
import { importHaken } from "../import/uebernehmen";
import { json, leeren, oeffneTestdb } from "./hilfen";
import { erstelleTestApp, person, type Testperson } from "./hilfen-auth";

const { db, pool } = oeffneTestdb();
const t = erstelleTestApp(db);

const ANNA = person("import-anna", { globalVerwalter: true });
const BERTA = person("import-berta", { globalVerwalter: true });

beforeEach(async () => {
  await leeren(db);
});
afterEach(() => {
  importHaken.vorAbschluss = undefined;
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

const hochladen = (daten: Buffer, als: Testperson = ANNA, name = "import.xlsx") => {
  const f = new FormData();
  f.append("datei", new File([new Uint8Array(daten)], name));
  return t.request("/import/laeufe", { method: "POST", body: f, als });
};
const lauf = async (daten: Buffer, als: Testperson = ANNA, name?: string) => {
  const antwort = await hochladen(daten, als, name);
  expect(antwort.status).toBe(201);
  return (await json(antwort)).id as string;
};
const pruefen = (id: string, als: Testperson = ANNA) => t.request(`/import/laeufe/${id}/pruefen`, { method: "POST", als });
const uebernehmen = (id: string, als: Testperson = BERTA) => t.request(`/import/laeufe/${id}/uebernehmen`, { method: "POST", als });
const befunde = async (id: string, als: Testperson = ANNA, abfrage = "") => (await json(await t.request(`/import/laeufe/${id}/befunde?limit=1000${abfrage}`, { als }))).daten as { blatt: string; blattName: string | null; zeile: number; spalte: string | null; code: string; schweregrad: string; meldung: string; params: Record<string, string | number> }[];
const codes = async (id: string, als?: Testperson) => (await befunde(id, als)).map((b) => b.code);

/** Prüft und übernimmt eine Datei mit zwei Personen (Hochladen und Prüfen: Anna, Übernehmen: Berta). */
async function importiere(daten: Buffer) {
  const id = await lauf(daten);
  const gepruefte = await json(await pruefen(id));
  expect(gepruefte.fehlerAnzahl, JSON.stringify(await befunde(id))).toBe(0);
  const antwort = await uebernehmen(id);
  expect(antwort.status, await antwort.clone().text()).toBe(200);
  return { id, ergebnis: await json(antwort) };
}

const zaehle = async (tabelle: string) => ((await db.execute(sql.raw(`SELECT count(*)::int AS n FROM ${tabelle}`))).rows[0] as { n: number }).n;

/** Kleine, stimmige Datei: ein Fonds, eine Firma, ein Darlehen mit Zusage und Auszahlung. */
function klein(): Blattzeilen {
  return {
    fonds: [{ fonds_kurzname: "FA", name: "Fonds Alpha", vintage: "2021", zeichnungskapital: "10000000.00" }],
    organisationen: [{ organisation_schluessel: "O1", name: "Nordlicht Technik", art: "unternehmen" }],
    beteiligungen: [{ beteiligung_schluessel: "B1", fonds_kurzname: "FA", organisation_schluessel: "O1", instrument: "darlehen", erstinvestment: "2022-01-15" }],
    vorgaenge: [
      { vorgang_schluessel: "V1", beteiligung_schluessel: "B1", art: "zusage", valuta: "2022-01-15", betrag: "500000.00" },
      { vorgang_schluessel: "V2", beteiligung_schluessel: "B1", art: "auszahlung", valuta: "2022-02-01", betrag: "300000.00" },
    ],
  };
}
const mappe = (z: Blattzeilen) => erzeugeMappe("de", z);

async function pruefeFixture(aendere: (z: Blattzeilen) => void, vorher?: () => Promise<void>) {
  await vorher?.();
  const z = klein();
  aendere(z);
  const id = await lauf(await mappe(z));
  const antwort = await json(await pruefen(id));
  return { id, lauf: antwort, befunde: await befunde(id) };
}

describe("Vorlage und Upload", () => {
  it("GET /import/vorlage liefert Excel in beiden Sprachen", async () => {
    for (const sprache of ["de", "en"]) {
      const antwort = await t.request(`/import/vorlage?sprache=${sprache}`);
      expect(antwort.status).toBe(200);
      expect(antwort.headers.get("content-type")).toContain("spreadsheetml");
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(Buffer.from(await antwort.arrayBuffer()) as unknown as ExcelJS.Buffer);
      expect(wb.worksheets.map((w) => w.name)).toContain(sprache === "de" ? "Vorgänge" : "Transactions");
    }
    expect((await t.request("/import/vorlage?sprache=fr")).status).toBe(400);
  });

  it("nur xlsx und CSV nach den ersten Bytes; Größe begrenzt; Feld Pflicht", async () => {
    const pdf = await hochladen(Buffer.from("%PDF-1.7 hallo"), ANNA, "bericht.xlsx");
    expect(pdf.status).toBe(415);
    expect((await json(pdf)).fehler.code).toBe("DATEITYP_UNBEKANNT");
    const gross = await hochladen(Buffer.alloc(21 * 1024 * 1024, 0x61), ANNA, "gross.csv");
    expect(gross.status).toBe(413);
    expect((await json(gross)).fehler.code).toBe("DATEI_ZU_GROSS");
    const ohne = await t.request("/import/laeufe", { method: "POST", als: ANNA, headers: { "content-type": "application/json" }, body: "{}" });
    expect(ohne.status).toBe(400);
    expect((await json(ohne)).fehler.code).toBe("DATEI_FEHLT");
    const ok = await hochladen(alsCsv("fonds", klein()), ANNA, "../../fonds.csv");
    expect(ok.status).toBe(201);
    const neu = await json(ok);
    expect(neu).toMatchObject({ status: "hochgeladen", dateityp: "csv", dateiname: "fonds.csv" });
    expect(neu.datei).toBeUndefined();
    expect(neu.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("beschädigte Excel-Datei und unpassendes CSV: sprechende Fehler beim Prüfen", async () => {
    const kaputt = await lauf(Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("das ist kein zip")]), ANNA, "k.xlsx");
    const a = await pruefen(kaputt);
    expect(a.status).toBe(422);
    expect((await json(a)).fehler.code).toBe("IMPORT_DATEI_UNLESBAR");
    const csv = await lauf(Buffer.from("a;b\n1;2\n"), ANNA, "x.csv");
    expect((await json(await pruefen(csv))).fehler.code).toBe("BLATT_NICHT_ERKANNT");
  });
});

describe("Beispieldatei: hochladen, prüfen, übernehmen", () => {
  it("übernimmt alles, schreibt Protokoll, Abnahmeprotokoll stimmt mit unabhängigem SQL überein; Wiederholung legt nichts an", async () => {
    const datei = await erzeugeBeispiel("de");
    const quelle = beispielZeilen();
    const start = performance.now();
    const { id, ergebnis } = await importiere(datei);
    const dauerMs = Math.round(performance.now() - start);
    console.log(`Importzeit Beispieldatei (${quelle.vorgaenge!.length} Vorgänge, ${quelle.organisationen!.length} Organisationen): ${dauerMs} ms (hochladen, prüfen, übernehmen)`);

    expect(ergebnis.status).toBe("uebernommen");
    expect(ergebnis.uebernommenVon).not.toBe(ergebnis.hochgeladenVon);
    expect(await zaehle("vorgang")).toBe(quelle.vorgaenge!.length);
    expect(await zaehle("organisation")).toBe(quelle.organisationen!.length);
    // Das Blatt führt eine Zeile je Instrument; die Beteiligung gibt es einmal je Fonds und Unternehmen.
    expect(await zaehle("instrument")).toBe(quelle.beteiligungen!.length);
    expect(await zaehle("beteiligung")).toBe(new Set(quelle.beteiligungen!.map((z) => `${z.fonds_kurzname}|${z.organisation_schluessel}`)).size);
    expect(await zaehle("fonds")).toBe(quelle.fonds!.length);
    expect(await zaehle("fonds_bewegung")).toBe(quelle.fondsbewegungen!.length);
    expect(await zaehle("finanzierungsrunde")).toBe(quelle.finanzierungsrunden!.length);
    expect(await zaehle("rundenposition")).toBe(quelle.rundenpositionen!.length);
    expect(await zaehle("bewertung")).toBe(quelle.bewertungen!.length);
    expect(await zaehle("darlehen_kondition")).toBe(quelle.konditionen!.length);
    // Protokollzeilen je angelegtem Datensatz und eine Zeile je Schritt des Laufs.
    expect(await zaehle("aenderung WHERE tabelle = 'vorgang' AND aktion = 'anlegen'")).toBe(quelle.vorgaenge!.length);
    expect(await zaehle(`aenderung WHERE tabelle = 'import_lauf' AND datensatz_id = '${id}'`)).toBeGreaterThanOrEqual(3);
    // Bewertungen sind freigegeben: erstellt von der hochladenden, freigegeben von der übernehmenden Person.
    const bew = (await db.execute(sql`SELECT DISTINCT status::text, erstellt_von, freigegeben_von FROM bewertung`)).rows as { status: string; erstellt_von: string; freigegeben_von: string }[];
    expect(bew).toHaveLength(1);
    expect(bew[0]).toMatchObject({ status: "freigegeben", erstellt_von: ergebnis.hochgeladenVon, freigegeben_von: ergebnis.uebernommenVon });

    // Abnahmeprotokoll: Summen je Fonds gegen unabhängiges SQL, Kontrollsummen aus der Datei bestätigt.
    for (const f of ergebnis.ergebnis.fonds as { kurzname: string; zusagen: string; auszahlungen: string; rueckfluesse: string; abrufe: string; kontrollsummen: { status: string }[] }[]) {
      const sql1 = async (art: string) =>
        ((await db.execute(sql`SELECT coalesce(sum(v.betrag), 0)::text AS s FROM vorgang v JOIN beteiligung b ON b.id = v.beteiligung_id JOIN fonds f ON f.id = b.fonds_id WHERE f.kurzname = ${f.kurzname} AND v.art = ${art}::vorgang_art`)).rows[0] as { s: string }).s;
      expect(Number(f.zusagen)).toBe(Number(await sql1("zusage")));
      expect(Number(f.auszahlungen)).toBe(Number(await sql1("auszahlung")));
      expect(Number(f.rueckfluesse)).toBe(Number(await sql1("rueckfluss")));
      const abruf = ((await db.execute(sql`SELECT coalesce(sum(m.betrag), 0)::text AS s FROM fonds_bewegung m JOIN fonds f ON f.id = m.fonds_id WHERE f.kurzname = ${f.kurzname} AND m.art = 'abruf'`)).rows[0] as { s: string }).s;
      expect(Number(f.abrufe)).toBe(Number(abruf));
      expect(f.kontrollsummen.length).toBe(4);
      expect(f.kontrollsummen.every((k) => k.status === "ok")).toBe(true);
    }

    // Protokolldateien
    const pdf = await t.request(`/import/laeufe/${id}/protokoll?format=pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString()).toBe("%PDF-");
    const xlsx = await t.request(`/import/laeufe/${id}/protokoll?format=xlsx&sprache=en`);
    expect(xlsx.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await xlsx.arrayBuffer()) as unknown as ExcelJS.Buffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Overview", "Counts per object", "Totals per fund", "Findings and open items"]);
    const summen = wb.getWorksheet("Totals per fund")!;
    const zeilen: unknown[][] = [];
    summen.eachRow((r) => zeilen.push(r.values as unknown[]));
    expect(zeilen.some((z) => z.includes("matches"))).toBe(true);
    expect(await zaehle("aenderung WHERE aktion = 'gelesen' AND tabelle = 'import_lauf'")).toBe(2);

    // Wiederholung mit derselben Datei: nichts Neues.
    const vorher = { vorgang: await zaehle("vorgang"), org: await zaehle("organisation"), aenderung: await zaehle("aenderung WHERE aktion = 'anlegen'") };
    const zweiter = await importiere(datei);
    for (const [blatt, z] of Object.entries(zweiter.ergebnis.ergebnis.zaehler as Record<string, { neu: number; unveraendert: number; abweichend: number; zeilen: number }>)) {
      expect(z.neu, blatt).toBe(0);
      expect(z.abweichend, blatt).toBe(0);
      if (z.zeilen > 0 && blatt !== "kontrollsummen") expect(z.unveraendert, blatt).toBe(z.zeilen);
    }
    expect(await zaehle("vorgang")).toBe(vorher.vorgang);
    expect(await zaehle("organisation")).toBe(vorher.org);
    expect(await zaehle("aenderung WHERE aktion = 'anlegen'")).toBe(vorher.aenderung);
  });

  it("größere Datei (200 Beteiligungen) in vertretbarer Zeit", async () => {
    const zeilen = beispielZeilen({ umfang: { beteiligungen: 200, deals: 200, fonds: 3 } });
    // Die erfundenen Namen sind sich teils ähnlich: die Dublettenprüfung meldet sie, die Datei bestätigt sie.
    for (const o of zeilen.organisationen!) o.dublette_bestaetigt = "ja";
    const start = performance.now();
    await importiere(await erzeugeMappe("de", zeilen));
    const ms = Math.round(performance.now() - start);
    console.log(`Importzeit groß (${zeilen.vorgaenge!.length} Vorgänge, ${zeilen.beteiligungen!.length} Beteiligungen): ${ms} ms`);
    expect(await zaehle("vorgang")).toBe(zeilen.vorgaenge!.length);
    expect(ms).toBeLessThan(15_000);
  });

  it("Snapshots entstehen über die vorhandenen Trigger (Auftrag je Fonds)", async () => {
    await importiere(await mappe(klein()));
    expect(await zaehle("snapshot_auftrag")).toBeGreaterThan(0);
  });

  it("CSV je Blatt: Fonds, Organisationen und Beteiligungen aus Einzeldateien, Vorgänge verweisen über Schlüssel auf den Bestand", async () => {
    const z = klein();
    for (const blatt of ["fonds", "organisationen", "beteiligungen"] as const) {
      await importiere(alsCsv(blatt, z, { kodierung: blatt === "organisationen" ? "windows-1252" : "utf-8" }));
    }
    await importiere(alsCsv("vorgaenge", z, { trenner: ";", dezimalkomma: true, deutschesDatum: true }));
    expect(await zaehle("vorgang")).toBe(2);
    expect(await zaehle("beteiligung")).toBe(1);
  });
});

describe("Prüfregeln mit Bestand (jede mit einer fehlschlagenden Datei)", () => {
  it("Auszahlungen über der Zusage", async () => {
    const r = await pruefeFixture((z) => z.vorgaenge!.push({ vorgang_schluessel: "V3", beteiligung_schluessel: "B1", art: "auszahlung", valuta: "2022-03-01", betrag: "250000.00" }));
    expect(r.lauf.status).toBe("hochgeladen");
    expect(r.befunde.map((b) => b.code)).toContain("AUSZAHLUNG_UEBER_ZUSAGE");
  });

  it("Summe der Rundenpositionen weicht vom Rundenvolumen ab", async () => {
    const r = await pruefeFixture((z) => {
      z.finanzierungsrunden = [{ runde_schluessel: "R1", organisation_schluessel: "O1", bezeichnung: "A", datum: "2022-05-01", pre_money: "1000000.00", post_money: "1500000.00", preis_je_anteil: "10.0000", anteile_gesamt_nach: "150000" }];
      z.rundenpositionen = [{ runde_schluessel: "R1", fonds_kurzname: "FA", betrag: "100000.00", anteile: "1", rolle: "lead" }];
    });
    expect(r.befunde.map((b) => b.code)).toContain("RUNDE_SUMME_ABWEICHEND");
  });

  it("Abrufe über dem Zeichnungskapital", async () => {
    const r = await pruefeFixture((z) => (z.fondsbewegungen = [{ bewegung_schluessel: "M1", fonds_kurzname: "FA", art: "abruf", valuta: "2022-04-01", betrag: "10000001.00" }]));
    expect(r.befunde.map((b) => b.code)).toContain("ABRUFE_UEBER_ZEICHNUNGSKAPITAL");
  });

  it("Dubletten gegen den Bestand und in der Datei; Bestätigung und bestehende_id lösen sie auf", async () => {
    await importiere(await mappe(klein()));
    const z = klein();
    z.organisationen = [
      { organisation_schluessel: "O2", name: "Nordlicht Technik GmbH", art: "unternehmen" },
      { organisation_schluessel: "O3", name: "Sternwind Energie", art: "unternehmen" },
      { organisation_schluessel: "O4", name: "Sternwind Energie AG", art: "unternehmen" },
    ];
    delete z.beteiligungen;
    delete z.vorgaenge;
    delete z.fonds;
    const id = await lauf(await mappe(z));
    await pruefen(id);
    const c = await codes(id);
    expect(c).toContain("ORGANISATION_DUBLETTE_MOEGLICH");
    expect(c).toContain("ORGANISATION_DOPPELT_IN_DATEI");
    // aufgelöst: bestätigt bzw. an die vorhandene Organisation gebunden
    const bestand = ((await db.execute(sql`SELECT id FROM organisation WHERE name = 'Nordlicht Technik'`)).rows[0] as { id: string }).id;
    z.organisationen![0] = { ...z.organisationen![0]!, bestehende_id: bestand };
    z.organisationen![2] = { ...z.organisationen![2]!, dublette_bestaetigt: "ja" };
    const id2 = await lauf(await mappe(z));
    expect((await json(await pruefen(id2))).fehlerAnzahl).toBe(0);
    expect((await uebernehmen(id2)).status).toBe(200);
    expect(await zaehle("organisation")).toBe(3);
    expect(await zaehle(`import_zuordnung WHERE objekt = 'organisation' AND schluessel = 'O2' AND datensatz_id = '${bestand}'`)).toBe(1);
  });

  it("Periodensperre: Vorgang und Bewertung in gesperrter Periode", async () => {
    await importiere(await mappe({ fonds: klein().fonds, organisationen: klein().organisationen, beteiligungen: klein().beteiligungen }));
    await db.execute(sql`INSERT INTO periodensperre (fonds_id, gesperrt_bis, gesetzt_von) SELECT id, '2022-12-31', 'test' FROM fonds WHERE kurzname = 'FA'`);
    const z = klein();
    z.bewertungen = [{ bewertung_schluessel: "W1", beteiligung_schluessel: "B1", stichtag: "2022-06-30", wert: "1.00", methode: "anschaffungskosten" }];
    z.fondsbewegungen = [{ bewegung_schluessel: "M1", fonds_kurzname: "FA", art: "abruf", valuta: "2022-06-30", betrag: "1.00" }];
    const id = await lauf(await mappe(z));
    await pruefen(id);
    const b = await befunde(id);
    expect(b.filter((x) => x.code === "PERIODE_GESPERRT").map((x) => x.blatt).sort()).toEqual(["bewertungen", "fondsbewegungen", "vorgaenge", "vorgaenge"]);
  });

  it("Kontrollsummen der Quelle weichen ab: Fehler (Zusagen) und Warnung (NAV im Protokoll)", async () => {
    const r = await pruefeFixture((z) => (z.kontrollsummen = [{ fonds_kurzname: "FA", groesse: "zusagen", betrag: "499999.00" }]));
    expect(r.befunde.map((b) => b.code)).toContain("KONTROLLSUMME_ABWEICHEND");
    const ok = await pruefeFixture((z) => (z.kontrollsummen = [{ fonds_kurzname: "FA", groesse: "zusagen", betrag: "500000.00" }, { fonds_kurzname: "FA", groesse: "auszahlungen", betrag: "300000.00" }]));
    expect(ok.lauf.fehlerAnzahl).toBe(0);
  });

  it("unbekannte Verweise, doppelte Schlüssel, Beträge mit drei Nachkommastellen", async () => {
    const r = await pruefeFixture((z) => {
      z.vorgaenge![0]!.beteiligung_schluessel = "GIBT-ES-NICHT";
      z.vorgaenge![1]!.vorgang_schluessel = "V1";
      z.vorgaenge![1]!.betrag = "1.234,567";
    });
    expect(r.befunde.map((b) => b.code)).toEqual(expect.arrayContaining(["VERWEIS_UNBEKANNT", "SCHLUESSEL_DOPPELT"]));
    expect(r.befunde.find((b) => b.code === "VERWEIS_UNBEKANNT")).toMatchObject({ blatt: "vorgaenge", blattName: "Vorgänge", zeile: 2, spalte: "beteiligung_schluessel", schweregrad: "fehler" });
    expect(r.lauf.fehlerAnzahl).toBeGreaterThanOrEqual(3);
    // Strukturierte Werte (`params`) neben der deutschen Meldung: die Oberfläche übersetzt ohne die Meldung zu zerlegen.
    expect(r.befunde.find((b) => b.code === "VERWEIS_UNBEKANNT")!.params).toMatchObject({ wert: "GIBT-ES-NICHT", zielBlatt: "beteiligungen" });
    expect(r.befunde.find((b) => b.code === "SCHLUESSEL_DOPPELT")!.params).toMatchObject({ schluessel: "V1", zeile: 2 });
  });

  it("params aus der Datei sind begrenzt gespeichert: riesiger Zellwert wird auf 500 Zeichen gekürzt", async () => {
    const r = await pruefeFixture((z) => {
      z.organisationen![0]!.art = "x".repeat(100_000);
    });
    const b = r.befunde.find((x) => x.code === "AUSWAHL_UNGUELTIG")!;
    expect(String(b.params.wert).length).toBe(500);
    expect(Object.keys(b.params).length).toBeLessThanOrEqual(20);
    expect(b.meldung.length).toBeLessThanOrEqual(2000);
  });

  it("Storno gegen den Bestand: Betrag muss passen, nur einmal", async () => {
    await importiere(await mappe(klein()));
    const z = klein();
    z.vorgaenge = [
      { vorgang_schluessel: "S1", beteiligung_schluessel: "B1", art: "auszahlung", valuta: "2022-03-01", betrag: "-299999.00", storniert_vorgang_schluessel: "V2" },
    ];
    delete z.fonds;
    delete z.organisationen;
    delete z.beteiligungen;
    const id = await lauf(await mappe(z));
    await pruefen(id);
    expect(await codes(id)).toContain("STORNO_UNGUELTIG");
    z.vorgaenge[0]!.betrag = "-300000.00";
    const id2 = await lauf(await mappe(z));
    expect((await json(await pruefen(id2))).fehlerAnzahl).toBe(0);
    expect((await uebernehmen(id2)).status).toBe(200);
    expect(await zaehle("vorgang WHERE storniert_vorgang_id IS NOT NULL")).toBe(1);
    const nochmal = await lauf(await mappe({ ...z, vorgaenge: [{ ...z.vorgaenge[0]!, vorgang_schluessel: "S2" }] }));
    await pruefen(nochmal);
    expect(await codes(nochmal)).toContain("BEREITS_STORNIERT");
  });

  it("abweichender Vorgang im Bestand: Befund VORGANG_ABWEICHEND (Warnung), Bestand bleibt unverändert", async () => {
    await importiere(await mappe(klein()));
    const z = klein();
    z.vorgaenge![1]!.betrag = "310000.00";
    const id = await lauf(await mappe(z));
    const gepruefte = await json(await pruefen(id));
    expect(gepruefte.fehlerAnzahl).toBe(0);
    const b = (await befunde(id)).find((x) => x.code === "VORGANG_ABWEICHEND")!;
    expect(b).toMatchObject({ blatt: "vorgaenge", blattName: "Vorgänge", zeile: 3, schweregrad: "warnung" });
    expect(b.meldung).toContain("Storno");
    expect(b.params).toMatchObject({ art: expect.any(String), valuta: expect.any(String) });
    expect((await uebernehmen(id)).status).toBe(200);
    expect(await zaehle("vorgang")).toBe(2);
    expect(await zaehle("vorgang WHERE betrag = 300000")).toBe(1);
    const lauf2 = await json(await t.request(`/import/laeufe/${id}`));
    expect(lauf2.ergebnis.zaehler.vorgaenge).toMatchObject({ neu: 0, unveraendert: 1, abweichend: 1 });
    // offener Punkt steht im Abnahmeprotokoll
    const xlsx = await t.request(`/import/laeufe/${id}/protokoll?format=xlsx`);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await xlsx.arrayBuffer()) as unknown as ExcelJS.Buffer);
    const texte: string[] = [];
    wb.getWorksheet("Befunde und offene Punkte")!.eachRow((r) => texte.push(String(r.getCell(4).value)));
    expect(texte).toContain("VORGANG_ABWEICHEND");
  });

  it("Beteiligung gleicher Art ohne Schlüssel im Bestand blockiert die Übernahme; neue Fonds nur durch globale Verwalter", async () => {
    await db.execute(sql`INSERT INTO fonds (id, name, kurzname, vintage, zeichnungskapital) VALUES ('00000000-0000-4000-8000-0000000000a1', 'Fonds Alpha', 'FA', 2021, 1000000)`);
    await db.execute(sql`INSERT INTO organisation (id, name, art) VALUES ('00000000-0000-4000-8000-0000000000a2', 'Nordlicht Technik', 'unternehmen')`);
    await db.execute(sql`INSERT INTO beteiligung (fonds_id, organisation_id, instrument, erstinvestment) VALUES ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a2', 'darlehen', '2022-01-15')`);
    const z = klein();
    z.organisationen![0] = { ...z.organisationen![0]!, bestehende_id: "00000000-0000-4000-8000-0000000000a2" };
    const id = await lauf(await mappe(z));
    await pruefen(id);
    expect(await codes(id)).toContain("BETEILIGUNG_VORHANDEN");

    // Bearbeiter am Fonds legt keinen neuen Fonds an.
    const carl = person("import-carl", { rollen: { "00000000-0000-4000-8000-0000000000a1": "bearbeiter" } });
    const z2 = klein();
    z2.fonds = [{ fonds_kurzname: "FNEU", name: "Neuer Fonds", vintage: "2024", zeichnungskapital: "1000000.00" }];
    const id2 = await lauf(await mappe(z2), carl);
    await pruefen(id2, carl);
    expect(await codes(id2, carl)).toContain("FONDS_NEU_NUR_VERWALTER");
  });
});

describe("Vier-Augen, Rechte und alles oder nichts", () => {
  it("dieselbe Person darf weder nach dem Hochladen noch nach dem Prüfen übernehmen; Bearbeiter dürfen es nie", async () => {
    const id = await lauf(await mappe(klein()));
    expect((await json(await pruefen(id))).fehlerAnzahl).toBe(0);
    const selbst = await uebernehmen(id, ANNA);
    expect(selbst.status).toBe(409);
    expect((await json(selbst)).fehler.code).toBe("VIER_AUGEN_VERLETZT");
    // Berta prüft erneut → Berta ist jetzt die Prüfende, Anna die Hochladende: beide dürfen nicht übernehmen.
    expect((await json(await pruefen(id, BERTA))).geprueftVon).not.toBeUndefined();
    expect((await uebernehmen(id, BERTA)).status).toBe(409);
    const dritte = person("import-dora", { globalVerwalter: true });
    const ok = await uebernehmen(id, dritte);
    expect(ok.status).toBe(200);
    expect((await json(ok)).uebernommenVon).toBeDefined();
    expect((await uebernehmen(id, dritte)).status).toBe(409);
    expect(await zaehle("vorgang")).toBe(2);
  });

  it("Rollen: Betrachter dürfen nicht hochladen, Bearbeiter nicht übernehmen, ohne Rolle gibt es 403", async () => {
    await importiere(await mappe(klein()));
    const fa = ((await db.execute(sql`SELECT id FROM fonds WHERE kurzname = 'FA'`)).rows[0] as { id: string }).id;
    const betrachter = person("import-bea", { rollen: { [fa]: "betrachter" } });
    const bearbeiter = person("import-bob", { rollen: { [fa]: "bearbeiter" } });
    const freigeber = person("import-fia", { rollen: { [fa]: "freigeber" } });
    expect((await hochladen(await mappe(klein()), betrachter)).status).toBe(403);
    const id = await lauf(await mappe(klein()), bearbeiter);
    expect((await pruefen(id, bearbeiter)).status).toBe(200);
    expect((await uebernehmen(id, bearbeiter)).status).toBe(403);
    expect((await t.request("/import/vorlage", { als: betrachter })).status).toBe(403);
    expect((await uebernehmen(id, freigeber)).status).toBe(200);
  });

  it("ein später Fehler rollt die ganze Übernahme zurück (alles oder nichts)", async () => {
    const id = await lauf(await mappe(klein()));
    await pruefen(id);
    importHaken.vorAbschluss = () => {
      throw new Error("später Fehler");
    };
    const antwort = await uebernehmen(id);
    expect(antwort.status).toBe(500);
    for (const tabelle of ["fonds", "organisation", "beteiligung", "vorgang", "import_zuordnung", "snapshot_auftrag"]) expect(await zaehle(tabelle), tabelle).toBe(0);
    expect(await zaehle("aenderung WHERE aktion = 'anlegen'")).toBe(0);
    const danach = await json(await t.request(`/import/laeufe/${id}`));
    expect(danach.status).toBe("geprueft");
    importHaken.vorAbschluss = undefined;
    expect((await uebernehmen(id)).status).toBe(200);
    expect(await zaehle("vorgang")).toBe(2);
  });

  it("Datei mit Fehler lässt sich nicht übernehmen (IMPORT_NICHT_GEPRUEFT), Änderung am Bestand zwischen Prüfen und Übernehmen wird erkannt", async () => {
    const z = klein();
    z.vorgaenge![1]!.betrag = "900000.00";
    const id = await lauf(await mappe(z));
    await pruefen(id);
    const a = await uebernehmen(id);
    expect(a.status).toBe(409);
    expect((await json(a)).fehler.code).toBe("IMPORT_NICHT_GEPRUEFT");

    await importiere(await mappe({ fonds: klein().fonds, organisationen: klein().organisationen, beteiligungen: klein().beteiligungen }));
    const id2 = await lauf(await mappe(klein()));
    expect((await json(await pruefen(id2))).fehlerAnzahl).toBe(0);
    await db.execute(sql`INSERT INTO periodensperre (fonds_id, gesperrt_bis, gesetzt_von) SELECT id, '2022-12-31', 'test' FROM fonds WHERE kurzname = 'FA'`);
    const b = await uebernehmen(id2);
    expect(b.status).toBe(409);
    expect((await json(b)).fehler.code).toBe("IMPORT_FEHLER");
    expect(await zaehle("vorgang")).toBe(0);
  });

  it("fremde Fonds über Geschäftsschlüssel: gesperrt ohne Daten preiszugeben", async () => {
    // Fonds A und B mit je einer Beteiligung; Carl ist Bearbeiter nur an A.
    const z = klein();
    z.fonds!.push({ fonds_kurzname: "FB", name: "Fonds Bravo", vintage: "2022", zeichnungskapital: "20000000.00" });
    z.organisationen!.push({ organisation_schluessel: "O2", name: "Sternwind Energie", art: "unternehmen" });
    z.beteiligungen!.push({ beteiligung_schluessel: "BB", fonds_kurzname: "FB", organisation_schluessel: "O2", instrument: "darlehen", erstinvestment: "2022-03-01" });
    z.vorgaenge!.push({ vorgang_schluessel: "VB", beteiligung_schluessel: "BB", art: "zusage", valuta: "2022-03-01", betrag: "777777.77" });
    z.bewertungen = [{ bewertung_schluessel: "WB", beteiligung_schluessel: "BB", stichtag: "2022-12-31", wert: "888888.88", methode: "anschaffungskosten" }];
    z.fondsbewegungen = [{ bewegung_schluessel: "MB", fonds_kurzname: "FB", art: "abruf", valuta: "2022-04-01", betrag: "666666.66" }];
    await importiere(await mappe(z));
    const ids = Object.fromEntries(((await db.execute(sql`SELECT kurzname, id FROM fonds`)).rows as { kurzname: string; id: string }[]).map((r) => [r.kurzname, r.id]));
    const carl = person("import-carl2", { rollen: { [ids.FA!]: "bearbeiter" } });

    const angriff = klein();
    angriff.fonds = [{ fonds_kurzname: "FB", name: "Fonds Bravo", vintage: "2022", zeichnungskapital: "1.00" }];
    angriff.vorgaenge = [
      { vorgang_schluessel: "VB", beteiligung_schluessel: "BB", art: "zusage", valuta: "2022-03-01", betrag: "1.00" },
      { vorgang_schluessel: "NEU", beteiligung_schluessel: "BB", art: "zusage", valuta: "2022-05-01", betrag: "5.00" },
    ];
    angriff.bewertungen = [{ bewertung_schluessel: "WB", beteiligung_schluessel: "BB", stichtag: "2022-12-31", wert: "1.00", methode: "anschaffungskosten" }];
    angriff.fondsbewegungen = [{ bewegung_schluessel: "MB", fonds_kurzname: "FB", art: "abruf", valuta: "2022-04-01", betrag: "1.00" }];
    angriff.kontrollsummen = [{ fonds_kurzname: "FB", groesse: "zusagen", betrag: "1.00" }];
    const id = await lauf(await mappe(angriff), carl);
    const gepruefte = await json(await pruefen(id, carl));
    expect(gepruefte.status).toBe("hochgeladen");
    const b = await befunde(id, carl);
    expect(b.filter((x) => x.code === "KEINE_BERECHTIGUNG_FONDS").length).toBeGreaterThanOrEqual(6);
    const gesamt = JSON.stringify([gepruefte, b]);
    for (const geheim of ["777777", "888888", "666666", "Sternwind", "Bravo-geheim"]) expect(gesamt).not.toContain(geheim);
    expect(b.some((x) => x.code === "VORGANG_ABWEICHEND" || x.code === "BEWERTUNG_ABWEICHEND" || x.code === "FONDSBEWEGUNG_ABWEICHEND" || x.code === "FONDS_ABWEICHEND")).toBe(false);
    expect((await uebernehmen(id, BERTA)).status).toBe(409); // nicht fehlerfrei geprüft
    expect((await uebernehmen(id, person("import-fiona", { rollen: { [ids.FA!]: "freigeber" } }))).status).toBe(404); // Fonds B unsichtbar
    expect(await zaehle("vorgang")).toBe(3);
    // Der Fonds-Bestand des Laufs enthält auch die Fonds, deren Datensätze über Schlüssel aufgelöst wurden (nicht nur benannte).
    const alsVerwalterin = await json(await t.request(`/import/laeufe/${id}`, { als: ANNA }));
    expect(alsVerwalterin.fonds.ids.sort()).toEqual([ids.FA!, ids.FB!].sort());
    expect(alsVerwalterin.eingeschraenkt).toBe(false);
    // Carl hat den Lauf hochgeladen, aber kein Recht an Fonds B: nur Metadaten, Ergebnisse geschwärzt, Protokoll gesperrt.
    const alsCarl = await json(await t.request(`/import/laeufe/${id}`, { als: carl }));
    expect(alsCarl).toMatchObject({ id, status: "hochgeladen", dateiname: "import.xlsx", eingeschraenkt: true, fonds: null, fehlerAnzahl: null, vorschau: null, ergebnis: null });
    expect(gepruefte).toMatchObject({ eingeschraenkt: true, fonds: null, vorschau: null });
    const befundeCarl = await json(await t.request(`/import/laeufe/${id}/befunde?limit=1000`, { als: carl }));
    expect(befundeCarl.eingeschraenkt).toBe(true);
    expect(befundeCarl.daten.every((x: { code: string }) => x.code === "KEINE_BERECHTIGUNG_FONDS")).toBe(true);
    const gesamtBefunde = await json(await t.request(`/import/laeufe/${id}/befunde?limit=1000`, { als: ANNA }));
    expect(gesamtBefunde.eingeschraenkt).toBe(false);
    expect(gesamtBefunde.daten.length).toBeGreaterThan(befundeCarl.daten.length - 1);
    expect((await t.request(`/import/laeufe/${id}/protokoll?format=xlsx`, { als: carl })).status).toBe(403);
    expect((await t.request(`/import/laeufe/${id}/protokoll?format=xlsx`, { als: ANNA })).status).toBe(200);
    // Carl sieht fremde Läufe nicht; die Verwalterin sieht beide.
    const fremd = await lauf(await mappe(klein()), ANNA);
    expect((await t.request(`/import/laeufe/${fremd}`, { als: carl })).status).toBe(404);
    expect((await t.request(`/import/laeufe/${id}/protokoll`, { als: person("import-erwin", { rollen: { [ids.FA!]: "betrachter" } }) })).status).toBe(404);
    const liste = (await json(await t.request("/import/laeufe", { als: carl }))).daten as { id: string }[];
    expect(liste.map((l) => l.id)).toEqual([id]);
  });

  it("Rechte werden bei jedem Lesen neu geprüft: wer nach dem Hochladen sein Recht verliert, sieht nur noch die Metadaten", async () => {
    await importiere(await mappe(klein()));
    const fa = ((await db.execute(sql`SELECT id FROM fonds WHERE kurzname = 'FA'`)).rows[0] as { id: string }).id;
    const fz = "00000000-0000-4000-8000-0000000000f9";
    await db.execute(sql`INSERT INTO fonds (id, name, kurzname, vintage, zeichnungskapital) VALUES (${fz}, 'Fonds Zulu', 'FZ', 2020, 1000)`);
    const dora = person("import-dora2", { rollen: { [fa]: "bearbeiter", [fz]: "betrachter" } });
    const z = klein();
    z.vorgaenge![1]!.betrag = "310000.00"; // ergibt einen Befund mit Werten aus dem Bestand
    const id = await lauf(await mappe(z), dora);
    await pruefen(id, dora);
    const vorher = await json(await t.request(`/import/laeufe/${id}`, { als: dora }));
    expect(vorher, JSON.stringify(vorher)).toMatchObject({ eingeschraenkt: false, warnungAnzahl: 1 });
    expect((await befunde(id, dora)).map((b) => b.code)).toContain("VORGANG_ABWEICHEND");
    await db.execute(sql`DELETE FROM fondsrolle WHERE fonds_id = ${fa} AND benutzer_id = (SELECT id FROM benutzer WHERE email = ${dora.email})`);
    const nachher = await json(await t.request(`/import/laeufe/${id}`, { als: dora }));
    expect(nachher).toMatchObject({ id, eingeschraenkt: true, warnungAnzahl: null, vorschau: null });
    const b = await json(await t.request(`/import/laeufe/${id}/befunde`, { als: dora }));
    expect(JSON.stringify(b)).not.toContain("300000");
    expect(b.daten).toEqual([]);
    expect((await t.request(`/import/laeufe/${id}/protokoll`, { als: dora })).status).toBe(403);
  });

  it("Befunde: seitenweise, nach Schweregrad filterbar, Fehler zuerst", async () => {
    const z = klein();
    z.vorgaenge![0]!.betrag = "abc";
    z.vorgaenge![1]!.valuta = "kein Datum";
    const id = await lauf(await mappe(z));
    await pruefen(id);
    const erste = await json(await t.request(`/import/laeufe/${id}/befunde?limit=1`));
    expect(erste.daten).toHaveLength(1);
    expect(erste.naechstesAb).toBe(1);
    const zweite = await json(await t.request(`/import/laeufe/${id}/befunde?limit=1&ab=${erste.naechstesAb}`));
    expect(zweite.daten[0].nr).toBe(2);
    expect((await befunde(id, ANNA, "&schweregrad=warnung")).length).toBe(0);
  });
});

describe("Import je Instrument (Portfolio-Modell, Phase 3)", () => {
  /** Ein Unternehmen, zwei Instrumente: Wandeldarlehen und Eigenkapital (zwei Zeilen im Blatt Beteiligungen, eine Beteiligung). */
  function zweiInstrumente(): Blattzeilen {
    const z = klein();
    z.beteiligungen = [
      { beteiligung_schluessel: "B1", fonds_kurzname: "FA", organisation_schluessel: "O1", instrument: "wandeldarlehen", bezeichnung: "Wandeldarlehen 2022", erstinvestment: "2022-01-15" },
      { beteiligung_schluessel: "B2", fonds_kurzname: "FA", organisation_schluessel: "O1", instrument: "offene_beteiligung", bezeichnung: "Anteile", erstinvestment: "2022-01-15" },
    ];
    z.vorgaenge = [
      { vorgang_schluessel: "V1", beteiligung_schluessel: "B1", art: "zusage", valuta: "2022-01-15", betrag: "500000.00" },
      { vorgang_schluessel: "V2", beteiligung_schluessel: "B1", art: "auszahlung", valuta: "2022-02-01", betrag: "300000.00" },
      { vorgang_schluessel: "V3", beteiligung_schluessel: "B2", instrument: "offene_beteiligung", art: "zusage", valuta: "2022-03-01", betrag: "100000.00" },
      { vorgang_schluessel: "V4", beteiligung_schluessel: "B2", art: "auszahlung", valuta: "2022-03-01", betrag: "100000.00" },
      { vorgang_schluessel: "V5", beteiligung_schluessel: "B2", art: "dividende", valuta: "2023-06-30", betrag: "5000.00" },
      { vorgang_schluessel: "V6", beteiligung_schluessel: "B1", instrument: "Wandeldarlehen 2022", art: "zinszahlung", valuta: "2023-01-15", betrag: "1000.00" },
    ];
    z.konditionen = [{ beteiligung_schluessel: "B1", instrument: "wandeldarlehen", gueltig_ab: "2022-02-01", satz_fix: "0.06", methode: "30E/360", zinsperiode: "jaehrlich", anker: "2022-12-31" }];
    return z;
  }

  it("eine Beteiligung mit zwei Instrumenten; Vorgänge und Konditionen buchen auf das genannte oder das Hauptinstrument", async () => {
    await importiere(await mappe(zweiInstrumente()));
    expect(await zaehle("beteiligung")).toBe(1);
    const instrumente = (await db.execute(sql`SELECT id, art::text AS art, bezeichnung FROM instrument ORDER BY art`)).rows as { id: string; art: string; bezeichnung: string }[];
    expect(instrumente.map((i) => [i.art, i.bezeichnung])).toEqual([["offene_beteiligung", "Anteile"], ["wandeldarlehen", "Wandeldarlehen 2022"]]);
    const art = async (schluessel: string) => ((await db.execute(sql`SELECT i.art::text AS art FROM vorgang v JOIN instrument i ON i.id = v.instrument_id WHERE v.bemerkung IS NULL AND v.valuta = ${schluessel}::date`)).rows[0] as { art: string }).art;
    expect(await art("2022-01-15")).toBe("wandeldarlehen"); // ohne Angabe: das Hauptinstrument (erste Zeile)
    expect(await art("2022-03-01")).toBe("offene_beteiligung"); // der Schlüssel B2 steht für das zweite Instrument
  });

  it("das Hauptinstrument ist die erste Zeile; spätere Dateien mit dem Schlüssel der Zeile buchen auf deren Instrument, sonst gilt das Hauptinstrument mit Warnung", async () => {
    await importiere(await mappe(zweiInstrumente()));
    const [b] = (await db.execute(sql`SELECT id, instrument::text AS instrument FROM beteiligung`)).rows as { id: string; instrument: string }[];
    expect(b!.instrument).toBe("wandeldarlehen");
    const liste = (await json(await t.request(`/beteiligungen/${b!.id}/instrumente`, { als: ANNA }))).daten as { art: string; istHauptinstrument: boolean }[];
    expect(liste.map((i) => [i.art, i.istHauptinstrument])).toEqual([["wandeldarlehen", true], ["offene_beteiligung", false]]);

    // Zweite Datei nur mit Vorgängen: Der Schlüssel B2 steht (aus dem ersten Import) für das Eigenkapital.
    const spaeter: Blattzeilen = { vorgaenge: [{ vorgang_schluessel: "V10", beteiligung_schluessel: "B2", art: "dividende", valuta: "2024-06-30", betrag: "3000.00" }] };
    await importiere(await mappe(spaeter));
    const art = (await db.execute(sql`SELECT i.art::text AS art FROM vorgang v JOIN instrument i ON i.id = v.instrument_id WHERE v.betrag = 3000`)).rows[0] as { art: string };
    expect(art.art).toBe("offene_beteiligung");

    // Ohne Zuordnung des Schlüssels (hier: nur die Beteiligung ist bekannt) gilt das Hauptinstrument; die Prüfung warnt, weil es mehrere gibt.
    await db.execute(sql`DELETE FROM import_zuordnung WHERE objekt = 'instrument'`);
    const ohne: Blattzeilen = { vorgaenge: [{ vorgang_schluessel: "V11", beteiligung_schluessel: "B1", art: "auszahlung", valuta: "2024-07-01", betrag: "1000.00" }] };
    const id = await lauf(await mappe(ohne));
    await pruefen(id);
    const warnung = (await befunde(id)).find((x) => x.code === "INSTRUMENT_MEHRDEUTIG");
    expect(warnung).toMatchObject({ schweregrad: "warnung", blatt: "vorgaenge", spalte: "instrument" });
  });

  it("alte Dateien ohne Instrumentspalten laufen wie bisher, Zinszahlung und Dividende sind Vorgangsarten", async () => {
    await importiere(await mappe(klein()));
    expect(await zaehle("instrument")).toBe(1);
    expect(await zaehle("vorgang WHERE instrument_id IS NOT NULL")).toBe(2);
  });

  it("unbekannte Instrumente, falsche Art für das Instrument und die Dublette im Bestand werden gemeldet", async () => {
    const z = zweiInstrumente();
    z.vorgaenge![2] = { ...z.vorgaenge![2]!, instrument: "gesellschafterdarlehen" };
    z.vorgaenge![4] = { vorgang_schluessel: "V5", beteiligung_schluessel: "B1", art: "dividende", valuta: "2023-06-30", betrag: "5000.00" };
    const id = await lauf(await mappe(z));
    await pruefen(id);
    const c = await codes(id);
    expect(c).toContain("INSTRUMENT_UNBEKANNT");
    expect(c).toContain("INSTRUMENT_PASST_NICHT"); // Dividende auf ein Wandeldarlehen
    // Dieselbe Beteiligung (Fonds, Organisation) mit demselben Instrument im Bestand, aber ohne Schlüssel
    await importiere(await mappe(klein()));
    const noch = klein();
    noch.beteiligungen = [{ beteiligung_schluessel: "B9", fonds_kurzname: "FA", organisation_schluessel: "O1", instrument: "darlehen", erstinvestment: "2022-01-15" }];
    noch.vorgaenge = [];
    const id2 = await lauf(await mappe(noch));
    await pruefen(id2);
    expect(await codes(id2)).toContain("BETEILIGUNG_VORHANDEN");
  });

  it("ein weiteres Instrument kommt an die vorhandene Beteiligung (zweiter Import mit neuem Schlüssel)", async () => {
    await importiere(await mappe(klein()));
    const z = klein();
    z.beteiligungen = [{ beteiligung_schluessel: "B2", fonds_kurzname: "FA", organisation_schluessel: "O1", instrument: "venture_debt", erstinvestment: "2023-01-01" }];
    z.vorgaenge = [{ vorgang_schluessel: "V9", beteiligung_schluessel: "B2", art: "zusage", valuta: "2023-01-01", betrag: "50000.00" }];
    await importiere(await mappe(z));
    expect(await zaehle("beteiligung")).toBe(1);
    expect(await zaehle("instrument")).toBe(2);
    expect(await zaehle("vorgang WHERE art = 'zusage' AND betrag = 50000")).toBe(1);
  });
});
