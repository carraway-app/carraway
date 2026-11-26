import { deflateRawSync } from "node:zlib";
import { eq } from "drizzle-orm";
import ExcelJS from "exceljs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { DateiFehler, pruefeZip } from "@carraway/import";
import { baueZip } from "./hilfen-zip";
import { erstelleTestApp, legePersonAn, person } from "./hilfen-auth";
import { json, oeffneTestdb } from "./hilfen";
import { anzahl, aufrufe, grundbestand, ID, protokollZeilen } from "./hilfen-instrumente";

/** Etappe 7: Kontaktimport aus CSV und Excel. Alle Daten sind erfunden. */

const { db, pool } = oeffneTestdb();
const t = erstelleTestApp(db);
const { get } = aufrufe(t);

const betrachter = person("betrachter-imp", { rollen: { [ID.fonds]: "betrachter" } });
const bearbeiter = person("bearbeiter-imp", { rollen: { [ID.fonds]: "bearbeiter" } });

beforeEach(async () => {
  await grundbestand(db);
  for (const p of [betrachter, bearbeiter]) await legePersonAn(db, p);
});
afterAll(async () => {
  await pool.end();
});

const KOPF = "typ;name;art;sektor;ort;website;vorname;nachname;email;funktion;organisation;rolle;von;bis";
const csv = (...zeilen: string[]) => Buffer.from([KOPF, ...zeilen].join("\r\n"), "utf8").toString("base64");
/** Zeile je Typ in der Reihenfolge der Spalten. */
const org = (name: string, art = "unternehmen", sektor = "", ort = "", website = "") => `organisation;${name};${art};${sektor};${ort};${website};;;;;;;;`;
const pers = (vorname: string, nachname: string, email = "", funktion = "", organisation = "", rolle = "", von = "", bis = "") =>
  `person;;;;;;${vorname};${nachname};${email};${funktion};${organisation};${rolle};${von};${bis}`;

const vorschau = async (inhalt: string, format: "csv" | "xlsx" = "csv", als = bearbeiter) =>
  t.request("/kontaktimport/vorschau", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ format, inhalt }), als });
const uebernehmen = async (inhalt: string, entscheidungen: unknown[] = [], format: "csv" | "xlsx" = "csv", als = bearbeiter) =>
  t.request("/kontaktimport", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ format, inhalt, entscheidungen }), als });

describe("Vorlage", () => {
  it("liefert die Vorlage als CSV in beiden Sprachen und als Excel; Betrachter dürfen sie laden", async () => {
    const de = await get("/kontaktimport/vorlage?sprache=de");
    expect(de.status).toBe(200);
    expect(de.headers.get("content-type")).toContain("text/csv");
    const text = await de.text();
    expect(text.replace(/^\uFEFF/, "").split("\r\n")[0]).toBe(KOPF);
    expect(text).toContain("Beispiel Energie GmbH");
    const en = (await (await get("/kontaktimport/vorlage?sprache=en")).text()).replace(/^\uFEFF/, "").split("\r\n")[0];
    expect(en).toBe("type;name;kind;sector;city;website;first_name;last_name;email;function;organisation;role;from;to");

    const xlsx = await t.request("/kontaktimport/vorlage?format=xlsx&sprache=en", { als: betrachter });
    expect(xlsx.status).toBe(200);
    const bytes = Buffer.from(await xlsx.arrayBuffer());
    const mappe = new ExcelJS.Workbook();
    await mappe.xlsx.load(bytes as unknown as ArrayBuffer);
    expect(mappe.worksheets.map((b) => b.name)).toEqual(["Contacts", "Notes"]);
    expect(mappe.worksheets[0]!.getRow(1).getCell(3).value).toBe("kind");
    // Die Vorlage selbst lässt sich wieder einlesen: englische Köpfe, Beispielzeilen gültig
    const zurueck = await json(await vorschau(bytes.toString("base64"), "xlsx"));
    expect(zurueck.zusammenfassung).toMatchObject({ zeilen: 2, fehler: 0 });
  });
});

describe("Vorschau", () => {
  it("erkennt neue und vorhandene Zeilen, Kandidaten, Fehler und löst Organisationen aus der Datei auf; schreibt nichts", async () => {
    await db.insert(s.person).values({ vorname: "Eva", nachname: "Vorhanden", email: "eva@beispiel.example" });
    await db.insert(s.organisation).values({ name: "Delta Energie GmbH", art: "unternehmen" });
    const datei = csv(
      org("Neu Sensorik GmbH", "unternehmen", "Technik", "Kiel"),
      org("Alpha Beispiel GmbH"), // gleicher Schlüssel wie "Alpha Beispiel" (ohne Rechtsform)
      org("Delta Energie Systeme GmbH"), // ähnlich, nicht gleich
      org("Ohne Art", ""),
      org("Mit Seite", "investor", "", "", "javascript:alert(1)"),
      pers("Eva", "Vorhanden", "EVA@beispiel.example"), // gleiche E-Mail, andere Schreibweise
      pers("Neu", "Person", "neu@beispiel.example", "Leitung", "Neu Sensorik GmbH", "gruender", "01.02.2020"),
      pers("Lost", "Organisation", "", "", "Gibt es nicht", ""),
      pers("Ohne", "Rolle", "", "", "", "gruender"),
      pers("Falsch", "Mail", "keine-mail"),
      "firma;Falscher Typ;unternehmen;;;;;;;;;;;",
    );
    const antwort = await vorschau(datei);
    expect(antwort.status).toBe(200);
    const v = await json(antwort);
    const nach = (zeile: number) => v.zeilen.find((z: { zeile: number }) => z.zeile === zeile);
    expect(nach(2)).toMatchObject({ typ: "organisation", status: "neu", vorschlag: "anlegen", kandidaten: [] });
    expect(nach(3)).toMatchObject({ status: "vorhanden", vorschlag: "zusammenfuehren", vorhanden: { id: ID.orgA, name: "Alpha Beispiel" } });
    expect(nach(4)).toMatchObject({ status: "neu", vorschlag: "ueberspringen" });
    expect(nach(4).kandidaten.map((k: { name: string }) => k.name)).toEqual(["Delta Energie GmbH"]);
    expect(nach(5).fehler).toEqual(["art_fehlt"]);
    expect(nach(6).fehler).toEqual(["website_ungueltig"]);
    expect(nach(7)).toMatchObject({ status: "vorhanden", vorschlag: "zusammenfuehren" });
    expect(nach(8)).toMatchObject({ status: "neu", vorschlag: "anlegen", organisation: { name: "Neu Sensorik GmbH", zuordnung: "datei" } });
    expect(nach(9).fehler).toEqual(["organisation_unbekannt"]);
    expect(nach(10).fehler).toEqual(["rolle_ohne_organisation"]);
    expect(nach(11).fehler).toEqual(["email_ungueltig"]);
    expect(nach(12)).toMatchObject({ typ: null, status: "fehler", fehler: ["typ_unbekannt"] });
    expect(v.zusammenfassung).toEqual({ zeilen: 11, neu: 2, vorhanden: 2, mitKandidaten: 1, fehler: 6 });
    expect(await anzahl(db, "organisation")).toBe(4);
    expect(await anzahl(db, "person")).toBe(1);
    expect(await anzahl(db, "aenderung", "tabelle = 'kontaktimport'")).toBe(0);
  });

  it("meldet unlesbare Dateien mit 400 import_invalid und ignoriert unbekannte Spalten", async () => {
    expect((await vorschau("")).status).toBe(400);
    for (const roh of ["name;art\r\nA;unternehmen", `${KOPF}\r\n`, `${KOPF}\r\n"offen`]) {
      const a = await vorschau(Buffer.from(roh).toString("base64"));
      expect(a.status, roh).toBe(400);
      expect((await json(a)).error.code).toBe("import_invalid");
    }
    const zuGross = await vorschau(Buffer.alloc(2_100_000, "a").toString("base64"));
    expect(zuGross.status).toBe(400);
    expect((await vorschau("x", "xlsx")).status).toBe(400);
    const mitExtra = await json(await vorschau(Buffer.from(`${KOPF};bemerkung\r\n${org("Extra Spalte")};intern`).toString("base64")));
    expect(mitExtra.unbekannteSpalten).toEqual(["bemerkung"]);
    expect(mitExtra.zusammenfassung.zeilen).toBe(1);
  });

  it("liest auch Excel und kommagetrennte CSV mit Anführungszeichen", async () => {
    const mappe = new ExcelJS.Workbook();
    const blatt = mappe.addWorksheet("Kontakte");
    blatt.addRow(["typ", "name", "art", "ort"]);
    blatt.addRow(["organisation", "Excel Beispiel GmbH", "investor", "Köln"]);
    const bytes = Buffer.from(await mappe.xlsx.writeBuffer());
    const e = await json(await vorschau(bytes.toString("base64"), "xlsx"));
    expect(e.zeilen[0]).toMatchObject({ anzeige: "Excel Beispiel GmbH", werte: { art: "investor", ort: "Köln" } });
    const komma = await json(await vorschau(Buffer.from('typ,name,art\r\norganisation,"Komma, Beispiel ""Eins"" GmbH",berater').toString("base64")));
    expect(komma.zeilen[0].anzeige).toBe('Komma, Beispiel "Eins" GmbH');
    expect(komma.zeilen[0].werte.art).toBe("berater");
  });
});

describe("Übernahme", () => {
  const datei = csv(
    org("Neu Sensorik GmbH", "unternehmen", "Technik", "Kiel"),
    pers("Neu", "Person", "neu@beispiel.example", "Leitung", "Neu Sensorik GmbH", "gruender", "2020-02-01"),
    pers("Ben", "Berater", "ben@beispiel.example", "", "Alpha Beispiel", "berater"),
  );

  it("übernimmt in einer Transaktion mit Rollen und Protokoll und ist beim zweiten Mal ohne Wirkung (idempotent)", async () => {
    const antwort = await uebernehmen(datei);
    expect(antwort.status).toBe(200);
    const erg = await json(antwort);
    expect(erg.zusammenfassung).toMatchObject({ angelegt: 3, ergaenzt: 0, unveraendert: 0, uebersprungen: 0, fehler: 0 });
    expect(await anzahl(db, "organisation")).toBe(4);
    expect(await anzahl(db, "person")).toBe(2);
    expect(await anzahl(db, "kontaktrolle")).toBe(2);
    const [neu] = await db.select().from(s.organisation).where(eq(s.organisation.name, "Neu Sensorik GmbH"));
    const [p] = await db.select().from(s.person).where(eq(s.person.email, "neu@beispiel.example"));
    expect(p).toMatchObject({ organisationId: neu!.id, funktion: "Leitung" });
    const rolle = await db.select().from(s.kontaktrolle).where(eq(s.kontaktrolle.personId, p!.id));
    expect(rolle).toEqual([expect.objectContaining({ organisationId: neu!.id, rolle: "gruender", von: "2020-02-01" })]);
    // Protokoll: eine Zeile je angelegtem Datensatz und eine Zusammenfassung
    expect(await protokollZeilen(db, "organisation", "anlegen")).toHaveLength(1);
    expect(await protokollZeilen(db, "person", "anlegen")).toHaveLength(2);
    expect(await protokollZeilen(db, "kontaktrolle", "anlegen")).toHaveLength(2);
    const zeile = (await protokollZeilen(db, "kontaktimport", "import"))[0]!;
    expect(zeile.nachher).toMatchObject({ zeilen: 3, angelegt: 3 });

    // Zweiter Lauf mit derselben Datei: nichts wird doppelt angelegt
    const zweiter = await json(await uebernehmen(datei));
    expect(zweiter.zusammenfassung).toMatchObject({ angelegt: 0, ergaenzt: 0, unveraendert: 3, uebersprungen: 0, fehler: 0 });
    expect(await anzahl(db, "organisation")).toBe(4);
    expect(await anzahl(db, "person")).toBe(2);
    expect(await anzahl(db, "kontaktrolle")).toBe(2);
    expect(await protokollZeilen(db, "kontaktimport", "import")).toHaveLength(2);
  });

  it("ergänzt vorhandene Datensätze nur in leeren Feldern und überschreibt nichts", async () => {
    await db.insert(s.person).values({ vorname: "Eva", nachname: "Vorhanden", email: "eva@beispiel.example", funktion: "Alt" });
    const erg = await json(
      await uebernehmen(csv(org("Alpha Beispiel GmbH", "investor", "Anderer Sektor", "Berlin"), pers("Eva", "Anders", "EVA@beispiel.example", "Neu", "Alpha Beispiel"))),
    );
    expect(erg.zusammenfassung).toMatchObject({ angelegt: 0, ergaenzt: 2 });
    const [a] = await db.select().from(s.organisation).where(eq(s.organisation.id, ID.orgA));
    expect(a).toMatchObject({ name: "Alpha Beispiel", art: "unternehmen", sektor: "Software", ort: "Berlin" });
    const [eva] = await db.select().from(s.person);
    expect(eva).toMatchObject({ nachname: "Vorhanden", funktion: "Alt", organisationId: ID.orgA });
  });

  it("folgt den Entscheidungen je Zeile: Kandidaten überspringen (Standard), neu anlegen, in einen Datensatz zusammenführen; Fehlerzeilen bleiben draußen", async () => {
    const ziel = (await db.insert(s.organisation).values({ name: "Delta Energie GmbH", art: "unternehmen" }).returning())[0]!;
    const zeilen = [
      org("Delta Energie Systeme GmbH", "unternehmen", "", "Kiel"),
      org("Delta Energie Service GmbH"),
      org("Delta Energie Technik GmbH", "unternehmen", "", "Rostock"),
      org("Ohne Art", ""),
    ];
    const standard = await json(await uebernehmen(csv(...zeilen)));
    // Kandidaten werden ohne Entscheidung übersprungen, Fehler bleiben Fehler
    expect(standard.zusammenfassung).toMatchObject({ angelegt: 0, uebersprungen: 3, fehler: 1 });
    expect(await anzahl(db, "organisation")).toBe(4);

    const erg = await json(
      await uebernehmen(csv(...zeilen), [
        { zeile: 2, aktion: "anlegen" },
        { zeile: 3, aktion: "zusammenfuehren", zielId: ziel.id },
        { zeile: 4, aktion: "ueberspringen" },
        { zeile: 5, aktion: "anlegen" }, // Fehlerzeile: bleibt draußen
      ]),
    );
    expect(erg.zusammenfassung).toMatchObject({ angelegt: 1, uebersprungen: 1, fehler: 1 });
    expect(erg.zeilen.find((z: { zeile: number }) => z.zeile === 3)).toMatchObject({ ergebnis: "unveraendert", id: ziel.id });
    expect(await anzahl(db, "organisation")).toBe(5);
    // Ein unbekanntes Ziel macht die Zeile zum Fehler, ohne den Rest zu stoppen
    const falsch = await json(await uebernehmen(csv(zeilen[2]!), [{ zeile: 2, aktion: "zusammenfuehren", zielId: "00000000-0000-4000-8000-0000000000aa" }]));
    expect(falsch.zeilen[0]).toMatchObject({ ergebnis: "fehler", fehler: ["ziel_unbekannt"] });
  });

  it("legt bei gleichem Schlüssel auch auf Entscheidung `anlegen` nichts doppelt an", async () => {
    const erg = await json(await uebernehmen(csv(org("Alpha Beispiel GmbH")), [{ zeile: 2, aktion: "anlegen" }]));
    expect(erg.zeilen[0]).toMatchObject({ aktion: "zusammenfuehren", ergebnis: "unveraendert" });
    expect(await anzahl(db, "organisation")).toBe(3);
  });

  it("gleiche Schlüssel innerhalb der Datei ergeben einen Datensatz", async () => {
    const erg = await json(await uebernehmen(csv(org("Quarz Sensorik GmbH"), org("Quarz Sensorik"), pers("Pat", "Eins", "pat@beispiel.example"), pers("Pat", "Zwei", "PAT@beispiel.example"))));
    expect(erg.zusammenfassung).toMatchObject({ angelegt: 2 });
    expect(await anzahl(db, "organisation", "name LIKE 'Quarz%'")).toBe(1);
    expect(await anzahl(db, "person")).toBe(1);
  });

  it("eine Person, deren Organisation übersprungen wird, scheitert bei der Übernahme; mit Entscheidung `anlegen` klappt sie", async () => {
    await db.insert(s.organisation).values({ name: "Delta Energie GmbH", art: "unternehmen" });
    const mitPerson = csv(org("Delta Energie Systeme GmbH"), pers("Pia", "Pruefer", "pia@beispiel.example", "", "Delta Energie Systeme GmbH", "berater"));
    // Vorschau ohne Entscheidung: Die Person ist noch offen, nicht fehlerhaft
    const offen = await json(await vorschau(mitPerson));
    expect(offen.zeilen[1]).toMatchObject({ status: "neu", organisation: { zuordnung: "datei" }, fehler: [] });
    const ohne = await json(await uebernehmen(mitPerson));
    expect(ohne.zeilen[1]).toMatchObject({ ergebnis: "fehler", fehler: ["organisation_unbekannt"] });
    expect(await anzahl(db, "person")).toBe(0);
    // Vorschau mit Entscheidung zeigt die Wirkung, die Übernahme setzt sie um
    const gewaehlt = [{ zeile: 2, aktion: "anlegen" }];
    const vorab = await t.request("/kontaktimport/vorschau", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ format: "csv", inhalt: mitPerson, entscheidungen: gewaehlt }), als: bearbeiter });
    expect((await json(vorab)).zeilen[0]).toMatchObject({ aktion: "anlegen" });
    const mit = await json(await uebernehmen(mitPerson, gewaehlt));
    expect(mit.zusammenfassung).toMatchObject({ angelegt: 2, fehler: 0 });
    expect(await anzahl(db, "kontaktrolle")).toBe(1);
  });

  it("Betrachter dürfen weder die Vorschau noch die Übernahme aufrufen", async () => {
    expect((await vorschau(datei, "csv", betrachter)).status).toBe(403);
    expect((await uebernehmen(datei, [], "csv", betrachter)).status).toBe(403);
    expect(await anzahl(db, "organisation")).toBe(3);
  });

  it("übernimmt Excel und merkt sich zugehörige Rollen mit Zeitraum", async () => {
    const mappe = new ExcelJS.Workbook();
    const blatt = mappe.addWorksheet("Kontakte");
    blatt.addRow(["typ", "name", "art", "vorname", "nachname", "email", "organisation", "rolle", "von", "bis"]);
    blatt.addRow(["organisation", "Excel Neu GmbH", "berater"]);
    blatt.addRow(["person", "", "", "Xaver", "Tabelle", "xaver@beispiel.example", "Excel Neu GmbH", "managing_director", new Date("2021-03-01T00:00:00Z"), "2023-12-31"]);
    const bytes = Buffer.from(await mappe.xlsx.writeBuffer()).toString("base64");
    const erg = await json(await uebernehmen(bytes, [], "xlsx"));
    expect(erg.zusammenfassung).toMatchObject({ angelegt: 2, fehler: 0 });
    expect(await db.select().from(s.kontaktrolle)).toEqual([expect.objectContaining({ rolle: "geschaeftsfuehrung", von: "2021-03-01", bis: "2023-12-31" })]);
  });
});

describe("Schutz vor Dekompressionsbomben (xlsx)", () => {
  const nullen = (n: number) => Buffer.alloc(n, 0);
  const archiv = (inhalt: Buffer, erklaert?: number) => baueZip([{ name: "xl/worksheets/sheet1.xml", inhalt, gepackt: deflateRawSync(inhalt), ...(erklaert === undefined ? {} : { erklaert }) }]);

  it("lehnt ein kleines Archiv ab, das auf weit über 50 MB entpackt (extremes Verhältnis, ehrliche Angaben)", async () => {
    const bombe = archiv(nullen(60_000_000));
    expect(bombe.length).toBeLessThan(200_000); // wenige KB hochgeladen
    expect(() => pruefeZip(bombe)).toThrowError(DateiFehler);
    const antwort = await uebernehmen(bombe.toString("base64"), [], "xlsx");
    expect(antwort.status).toBe(400);
    expect((await json(antwort)).error).toMatchObject({ code: "import_invalid", grund: "zu_gross_entpackt" });
    expect((await vorschau(bombe.toString("base64"), "xlsx")).status).toBe(400);
  });

  it("lehnt extreme Verhältnisse unterhalb der Gesamtgrenze ab", () => {
    const bombe = archiv(nullen(20_000_000));
    expect(() => pruefeZip(bombe)).toThrowError(expect.objectContaining({ code: "DATEI_ZU_GROSS" }));
  });

  it("lehnt ein Archiv ab, dessen Kopf eine kleine Größe vortäuscht (das Limit gilt beim Entpacken)", () => {
    const gelogen = archiv(nullen(60_000_000), 10);
    expect(() => pruefeZip(gelogen)).toThrowError(expect.objectContaining({ code: "DATEI_ZU_GROSS" }));
  });

  it("lehnt kaputte und fremde Dateien ab, lässt gewöhnliche Tabellen durch", async () => {
    expect(() => pruefeZip(Buffer.from("kein zip"))).toThrowError(expect.objectContaining({ code: "DATEI_BESCHAEDIGT" }));
    const text = Buffer.from("<row>".repeat(2000));
    expect(() => pruefeZip(archiv(text))).not.toThrow();
    const mappe = new ExcelJS.Workbook();
    mappe.addWorksheet("Kontakte").addRow(["typ", "name", "art"]);
    const echt = Buffer.from(await mappe.xlsx.writeBuffer());
    expect(() => pruefeZip(echt)).not.toThrow();
  });
});
