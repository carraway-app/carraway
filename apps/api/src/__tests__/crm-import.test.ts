import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as s from "@carraway/db";
import { erstelleTestApp, person } from "./hilfen-auth";
import { json, leeren, oeffneTestdb } from "./hilfen";

const { db, pool } = oeffneTestdb();
const t = erstelleTestApp(db);
const ADMIN = person("crm-imp-admin", { globalVerwalter: true });
const BET = person("crm-imp-bet", { rollen: {} });

const post = (pfad: string, body: unknown, als = ADMIN) => t.request(`/crm${pfad}`, { method: "POST", als, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
let umsatz = "";
let stufe = "";

beforeAll(async () => {
  await leeren(db);
  umsatz = (await json(await post("/felder", { objekt: "organisation", name: "Umsatz", typ: "betrag" }))).id;
  stufe = (await json(await post("/felder", { objekt: "organisation", name: "Stufe", typ: "auswahl", optionen: { optionen: [{ schluessel: "heiss", label: "Heiß", farbe: "rose" }, { schluessel: "kalt", label: "Kalt", farbe: "blau" }] } }))).id;
  await db.insert(s.organisation).values({ name: "Vorhanden Beispiel GmbH", art: "unternehmen" });
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

const csvOrg = `Firma;Ort;Umsatz;Temperatur;Mail
Neu Beispiel AG;Berlin;"1.234,50";Heiß;info@neu.example
Vorhanden Beispiel GmbH;Hamburg;100;kalt;
;Köln;5;heiß;
Fehler SE;Bonn;abc;lauwarm;
Neu Beispiel AG;Berlin;1;heiß;
`;
const zuordnung = (stufeFeld: string) => [
  { spalte: 0, feld: "name" },
  { spalte: 1, feld: "ort" },
  { spalte: 2, feld: umsatz },
  { spalte: 3, feld: stufeFeld },
  { spalte: 4, feld: "email" },
];

describe("CRM-Import mit Spaltenzuordnung", () => {
  it("liest die Kopfzeile", async () => {
    const antwort = await json(await post("/import/kopfzeile", { csv: csvOrg }));
    expect(antwort.spalten).toEqual(["Firma", "Ort", "Umsatz", "Temperatur", "Mail"]);
  });

  it("Vorschau: neu, Dublette, Pflichtfehler, Typfehler, doppelt in der Datei; schreibt nichts", async () => {
    const antwort = await json(await post("/import/vorschau", { objekt: "organisation", csv: csvOrg, zuordnung: zuordnung(stufe) }));
    expect(antwort.zeilen.map((z: { status: string }) => z.status)).toEqual(["neu", "uebersprungen", "fehler", "fehler", "fehler"]);
    expect(antwort.zeilen[1].dublette).toMatchObject({ name: "Vorhanden Beispiel GmbH", score: 1 });
    expect(antwort.zeilen[2].fehler[0].feld).toBe("name");
    expect(antwort.zeilen[3].fehler.map((f: { feld: string }) => f.feld).sort()).toEqual([stufe, umsatz].sort());
    expect(antwort.zeilen[4].fehler[0].meldung).toContain("Doppelt in der Datei");
    expect((await db.select().from(s.organisation)).length).toBe(1);
    const aktualisieren = await json(await post("/import/vorschau", { objekt: "organisation", csv: csvOrg, zuordnung: zuordnung(stufe), dubletten: "aktualisieren" }));
    expect(aktualisieren.zeilen[1].status).toBe("dublette");
  });

  it("Übernahme: gültige Zeilen kommen mit Feldwerten (Dezimalkomma, Optionsbezeichnung) und Protokoll", async () => {
    const antwort = await json(await post("/import", { objekt: "organisation", csv: csvOrg, zuordnung: zuordnung(stufe), dubletten: "aktualisieren" }));
    expect(antwort.zusammenfassung).toMatchObject({ angelegt: 1, aktualisiert: 1, fehler: 3 });
    const neu = (await db.select().from(s.organisation).where(eq(s.organisation.name, "Neu Beispiel AG")))[0]!;
    expect(neu).toMatchObject({ ort: "Berlin", email: "info@neu.example", art: "unternehmen" });
    expect(neu.felder).toEqual({ [umsatz]: "1234.50", [stufe]: "heiss" });
    const alt = (await db.select().from(s.organisation).where(eq(s.organisation.name, "Vorhanden Beispiel GmbH")))[0]!;
    expect(alt).toMatchObject({ ort: "Hamburg" });
    expect(alt.felder[stufe]).toBe("kalt");
    expect((await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM aenderung WHERE tabelle = 'organisation' AND datensatz_id = ${neu.id}`)).rows[0]!.n).toBe(1);
    // Zweiter Lauf mit „überspringen“ legt nichts doppelt an
    const nochmal = await json(await post("/import", { objekt: "organisation", csv: csvOrg, zuordnung: zuordnung(stufe) }));
    expect(nochmal.zusammenfassung.angelegt).toBe(0);
    expect((await db.select().from(s.organisation)).length).toBe(2);
  });

  it("Kontakte: Unternehmen per Name zuordnen oder anlegen, Dublette über E-Mail, Hauptbeschäftigung", async () => {
    const csv = `Vorname,Nachname,Mail,Firma\nAnna,Import,anna@import.example,Neu Beispiel AG\nBen,Import,ben@import.example,Unbekannt GmbH\n`;
    const z = [{ spalte: 0, feld: "vorname" }, { spalte: 1, feld: "nachname" }, { spalte: 2, feld: "email" }, { spalte: 3, feld: "unternehmen" }];
    const ohne = await json(await post("/import", { objekt: "person", csv, zuordnung: z }));
    expect(ohne.zeilen.map((x: { status: string }) => x.status)).toEqual(["angelegt", "fehler"]);
    const mit = await json(await post("/import", { objekt: "person", csv, zuordnung: z, unternehmenAnlegen: true }));
    // Anna ist jetzt Dublette (gleiche E-Mail) und wird übersprungen, Ben mit neuem Unternehmen angelegt
    expect(mit.zeilen.map((x: { status: string }) => x.status)).toEqual(["uebersprungen", "angelegt"]);
    const ben = (await db.select().from(s.person).where(eq(s.person.vorname, "Ben")))[0]!;
    expect(ben.organisationId).not.toBeNull();
    expect((await db.select().from(s.beschaeftigung).where(eq(s.beschaeftigung.personId, ben.id)))[0]).toMatchObject({ haupt: true });
  });

  it("lehnt unbekannte Felder, doppelte Zuordnung, falsche Spalten und zu große Dateien ab; Betrachter dürfen nicht", async () => {
    for (const z of [[{ spalte: 0, feld: "gibtsnicht" }], [{ spalte: 0, feld: "name" }, { spalte: 1, feld: "name" }], [{ spalte: 9, feld: "name" }], [{ spalte: 0, feld: "zusammengefuehrtIn" }]]) {
      const antwort = await post("/import/vorschau", { objekt: "organisation", csv: csvOrg, zuordnung: z });
      expect(antwort.status, JSON.stringify(z)).toBe(400);
      expect((await json(antwort)).fehler.code).toBe("CRM_IMPORT_UNGUELTIG");
    }
    expect((await post("/import/vorschau", { objekt: "organisation", csv: "nur kopf\n", zuordnung: [{ spalte: 0, feld: "name" }] })).status).toBe(400);
    expect((await post("/import/vorschau", { objekt: "organisation", csv: csvOrg, zuordnung: zuordnung(stufe) }, BET)).status).toBe(403);
  });
});
