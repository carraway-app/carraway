import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseCsv } from "@carraway/import";
import { erzeugeMappe, type Blattzeilen } from "@carraway/import";
import { beispielZeilen } from "@carraway/import/beispiel";
import type { Speicher } from "../berichte/speicher";
import { EXPORT_TABELLEN } from "../export/vollexport";
import { json, leeren, oeffneTestdb } from "./hilfen";
import { erstelleTestApp, person } from "./hilfen-auth";
import { leseZip } from "./hilfen-zip";

const { db, pool } = oeffneTestdb();
const berichtsdatei = Buffer.from("%PDF-1.7 Testbericht (erfunden)");
const speicher: Speicher = {
  schreibe: async () => undefined,
  lese: async (k) => {
    if (k.startsWith("berichte/")) return new Uint8Array(berichtsdatei);
    throw new Error("nicht gefunden");
  },
};
const t = erstelleTestApp(db, { speicher });
const ANNA = person("export-anna", { globalVerwalter: true });
const BERTA = person("export-berta", { globalVerwalter: true });

let zip: Map<string, Buffer>;
let rohgroesse = 0;
let bloecke = 0;

beforeAll(async () => {
  await leeren(db);
  const zeilen: Blattzeilen = beispielZeilen();
  const f = new FormData();
  f.append("datei", new File([new Uint8Array(await erzeugeMappe("de", zeilen))], "export.xlsx"));
  const lauf = await json(await t.request("/import/runs", { method: "POST", body: f, als: ANNA }));
  await t.request(`/import/runs/${lauf.id}/validate`, { method: "POST", als: ANNA });
  expect((await t.request(`/import/runs/${lauf.id}/apply`, { method: "POST", als: BERTA })).status).toBe(200);
  // ein freigegebener Bericht mit Datei, damit die Dateien im Export stehen
  const fonds = (await db.execute(sql`SELECT id FROM fonds ORDER BY kurzname LIMIT 1`)).rows[0] as { id: string };
  const hash = createHash("sha256").update(berichtsdatei).digest("hex");
  await db.execute(sql`
    INSERT INTO bericht (id, art, format, fonds_id, stichtag, sprache, status, freigabestufen, naechste_stufe, erstellt_von, datei_name, datei_schluessel, datei_sha256, datei_groesse)
    VALUES ('00000000-0000-4000-8000-0000000000e1', 'fondsbericht', 'pdf', ${fonds.id}, '2026-09-30', 'de', 'freigegeben', '["a","b"]'::jsonb, 2, 'test', 'b.pdf', ${`berichte/00000000-0000-4000-8000-0000000000e1/${hash}.pdf`}, ${hash}, ${berichtsdatei.length})`);

  const antwort = await t.request("/export?format=zip", { als: ANNA });
  expect(antwort.status).toBe(200);
  expect(antwort.headers.get("content-type")).toBe("application/zip");
  const leser = antwort.body!.getReader();
  const stuecke: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await leser.read();
    if (done) break;
    stuecke.push(value);
    bloecke++;
  }
  const gesamt = Buffer.concat(stuecke);
  rohgroesse = gesamt.length;
  zip = leseZip(gesamt);
  // Archiv für den echten Entpacker
  const ordner = mkdtempSync(join(tmpdir(), "carraway-export-"));
  const datei = join(ordner, "export.zip");
  writeFileSync(datei, gesamt);
  try {
    execFileSync("unzip", ["-tq", datei], { stdio: "pipe" });
  } catch (fehler) {
    if ((fehler as NodeJS.ErrnoException).code !== "ENOENT") throw fehler;
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

const manifest = () => JSON.parse(zip.get("manifest.json")!.toString("utf8")) as {
  schemaversion: number;
  exportiertAm: string;
  tabellen: Record<string, number>;
  dateien: { pfad: string; bytes: number; sha256: string; zeilen?: number }[];
};

describe("Vollexport", () => {
  it("Archiv enthält je Tabelle eine CSV, Berichtsdateien, Schema, Rechenregeln, README und Manifest; es kommt gestreamt an", () => {
    for (const tabelle of EXPORT_TABELLEN) expect(zip.has(`tabellen/${tabelle.name}.csv`), tabelle.name).toBe(true);
    for (const name of ["schema.json", "rechenregeln.md", "README.md", "manifest.json"]) expect(zip.has(name), name).toBe(true);
    expect([...zip.keys()].filter((k) => k.startsWith("berichte/"))).toHaveLength(1);
    expect(bloecke).toBeGreaterThan(1);
    expect(rohgroesse).toBeGreaterThan(1000);
  });

  it("Manifest: Schemaversion, Zeitpunkt, Zeilenzahlen gegen die Datenbank, SHA-256 gegen den Inhalt", async () => {
    const m = manifest();
    expect(m.schemaversion).toBe(1);
    expect(new Date(m.exportiertAm).getTime()).toBeGreaterThan(Date.now() - 60_000);
    for (const tabelle of EXPORT_TABELLEN) {
      const n = ((await db.execute(sql.raw(`SELECT count(*)::int AS n FROM "${tabelle.name}"`))).rows[0] as { n: number }).n;
      const csv = zip.get(`tabellen/${tabelle.name}.csv`)!.toString("utf8");
      const zeilen = parseCsv(csv, ",").filter((z) => z.length > 0 && !(z.length === 1 && z[0] === "")).length - 1;
      // Die `gelesen`-Zeile des Exports ist vor dem Lesen festgeschrieben und steht im Export.
      const erwartet = n;
      expect(m.tabellen[tabelle.name], tabelle.name).toBe(erwartet);
      expect(zeilen, tabelle.name).toBe(erwartet);
    }
    for (const d of m.dateien) {
      const inhalt = zip.get(d.pfad)!;
      expect(createHash("sha256").update(inhalt).digest("hex"), d.pfad).toBe(d.sha256);
      expect(inhalt.length, d.pfad).toBe(d.bytes);
    }
    expect(m.dateien.some((d) => d.pfad === "manifest.json")).toBe(false);
    expect(m.tabellen.vorgang).toBeGreaterThan(30);
  });

  it("Werte stehen exakt: Beträge als Dezimalzahl, Datum als Text, Kopfzeile mit Spaltennamen, Schema dokumentiert die Spalten", () => {
    const zeilen = parseCsv(zip.get("tabellen/vorgang.csv")!.toString("utf8"), ",");
    const kopf = zeilen[0]!;
    expect([...kopf].sort()).toEqual(["art", "beglichen_vorgang_id", "beteiligung_id", "betrag", "bemerkung", "betrag_lokal", "erfasst_am", "felder", "id", "instrument_id", "kapitalisiert", "kurs", "kurs_id", "storniert_vorgang_id", "tranche_id", "valuta", "darlehensverkauf_id", "verzicht_id", "zinsverzicht_bis"].sort());
    const erste = zeilen[1]!;
    expect(erste[kopf.indexOf("betrag")]).toMatch(/^-?\d+\.\d{2}$/);
    expect(erste[kopf.indexOf("valuta")]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const schema = JSON.parse(zip.get("schema.json")!.toString("utf8")) as { tabellen: Record<string, { ordnung: string[]; spalten: { name: string; typ: string; nullbar: boolean }[] }> };
    expect(schema.tabellen.vorgang!.spalten.find((s) => s.name === "betrag")).toMatchObject({ typ: "numeric", nullbar: false });
  });

  it("Rechenregeln: Zinsmethoden aus dem Rechenkern, Kennzahlen, Verweise auf Entscheidungen", () => {
    const text = zip.get("rechenregeln.md")!.toString("utf8");
    for (const m of ["30E/360", "act/360", "act/365", "act/act"]) expect(text).toContain(m);
    for (const k of ["TVPI", "DPI", "RVPI", "IRR", "Buchwert", "Entscheidung 66"]) expect(text).toContain(k);
  });

  it("keine Geheimnisse: keine Konten-, Sitzungs- oder Faktor-Tabellen, keine Hashes in Benutzern und Schlüsseln, keine Importdatei", () => {
    for (const verboten of ["konto", "sitzung", "zwei_faktor", "verifizierung", "anmeldeversuch", "idempotenz_schluessel", "kennzahl_snapshot"]) expect(zip.has(`tabellen/${verboten}.csv`), verboten).toBe(false);
    expect(zip.get("tabellen/benutzer.csv")!.toString("utf8").split("\n")[0]).not.toMatch(/password|secret|image/);
    expect(zip.get("tabellen/api_schluessel.csv")!.toString("utf8").split("\n")[0]).not.toContain("hash");
    expect(zip.get("tabellen/import_lauf.csv")!.toString("utf8").split("\n")[0]).not.toContain("datei,");
  });

  it("Berichtsdatei unverändert im Archiv", () => {
    const pfad = [...zip.keys()].find((k) => k.startsWith("berichte/"))!;
    expect(zip.get(pfad)!.equals(berichtsdatei)).toBe(true);
  });

  it("der Abruf steht als `gelesen` im Änderungsprotokoll; nur globale Verwalter und nur Anmeldung dürfen", async () => {
    const n = ((await db.execute(sql`SELECT count(*)::int AS n FROM aenderung WHERE aktion = 'gelesen' AND tabelle = 'export'`)).rows[0] as { n: number }).n;
    expect(n).toBe(1);
    const bearbeiter = person("export-bea", { rollen: { [((await db.execute(sql`SELECT id FROM fonds LIMIT 1`)).rows[0] as { id: string }).id]: "verwalter" } });
    expect((await t.request("/export", { als: bearbeiter })).status).toBe(403);
    expect((await t.request("/export", { als: null })).status).toBe(401);
    expect((await t.request("/export?format=tar", { als: ANNA })).status).toBe(400);
  });
});
