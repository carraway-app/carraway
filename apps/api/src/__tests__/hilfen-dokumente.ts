import { deflateRawSync } from "node:zlib";
import { sql } from "drizzle-orm";
import ExcelJS from "exceljs";
import { literal, setzePdf } from "@carraway/berichte";
import * as s from "@carraway/db";
import { baueZip } from "./hilfen-zip";
import type { Testperson } from "./hilfen-auth";

/** Erfundene Dokumente und Fonds für die Tests der Dokumente und der Vertragsauslesung. */

export type Db = ReturnType<typeof s.erstelleDb>["db"];

/** PDF mit einer Textseite je Eintrag; ohne Eintrag eine Seite ohne Text (wie ein Scan). Festes Datum, damit gleiche Eingabe gleiche Bytes ergibt. */
export function erzeugePdf(seiten: string[]): Uint8Array {
  const kopf = '#set document(title: "Testdokument", author: "Muster", date: datetime(year: 2025, month: 3, day: 14))\n#set page(paper: "a4")\n#set text(font: "Instrument Sans", lang: "de")\n';
  if (seiten.length === 0) return setzePdf(`${kopf}#rect(width: 4cm, height: 2cm, fill: gray)\n`);
  return setzePdf(kopf + seiten.map((t) => `#(${literal(t)})`).join("\n#pagebreak()\n"));
}

/** Kleinstes PDF mit Verschlüsselungseintrag im Trailer (nur die Kennzeichen, kein lesbarer Inhalt). */
export const verschluesseltesPdf = (): Buffer =>
  Buffer.from(
    "%PDF-1.6\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n5 0 obj\n<< /Filter /Standard /V 4 /R 4 /O (x) /U (y) /P -1 >>\nendobj\ntrailer\n<< /Root 1 0 R /Size 6 /Encrypt 5 0 R /ID [<00><00>] >>\n%%EOF\n",
    "latin1",
  );

export const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
export const JPEG = Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64");

const OFFICE_KENNUNG = '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>';

/** DOCX-Archiv mit den Kennzeichen von Word; `extra` ergänzt weitere Einträge (Makros, Bomben). */
export function erzeugeDocx(extra: { name: string; inhalt: Buffer; erklaert?: number }[] = [], titel = "Beispiel"): Buffer {
  const eintraege = [
    { name: "[Content_Types].xml", inhalt: Buffer.from(OFFICE_KENNUNG) },
    { name: "word/document.xml", inhalt: Buffer.from(`<w:document xmlns:w="x"><w:body><w:p><w:r><w:t>${titel}</w:t></w:r></w:p></w:body></w:document>`) },
    ...extra,
  ];
  return baueZip(eintraege.map((e) => ({ ...e, gepackt: deflateRawSync(e.inhalt) })));
}

/** DOCX mit Absätzen; ein Eintrag mit `abschnitt: true` endet einen Abschnitt, `tabelle` hängt eine Tabelle an (Zeilen aus Zellen). */
export function erzeugeDocxMitText(absaetze: (string | { text: string; abschnitt: true })[], tabelle: string[][] = [], kopf = ""): Buffer {
  const maskiere = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const p = (a: string | { text: string; abschnitt: true }) =>
    typeof a === "string" ? `<w:p><w:r><w:t xml:space="preserve">${maskiere(a)}</w:t></w:r></w:p>` : `<w:p><w:pPr><w:sectPr><w:pgSz w:w="11906"/></w:sectPr></w:pPr><w:r><w:t>${maskiere(a.text)}</w:t></w:r></w:p>`;
  const tab = tabelle.length === 0 ? "" : `<w:tbl>${tabelle.map((z) => `<w:tr>${z.map((c) => `<w:tc><w:p><w:r><w:t>${maskiere(c)}</w:t></w:r></w:p></w:tc>`).join("")}</w:tr>`).join("")}</w:tbl>`;
  const xml = `${kopf}<w:document xmlns:w="x"><w:body>${absaetze.map(p).join("")}${tab}<w:sectPr/></w:body></w:document>`;
  const eintraege = [
    { name: "[Content_Types].xml", inhalt: Buffer.from(OFFICE_KENNUNG) },
    { name: "word/document.xml", inhalt: Buffer.from(xml) },
  ];
  return baueZip(eintraege.map((e) => ({ ...e, gepackt: deflateRawSync(e.inhalt) })));
}

export async function erzeugeXlsx(): Promise<Buffer> {
  const mappe = new ExcelJS.Workbook();
  mappe.addWorksheet("Blatt1").addRow(["Beispiel", 1]);
  return Buffer.from(await mappe.xlsx.writeBuffer());
}

export interface Welt {
  fonds1: string;
  fonds2: string;
  org1: string;
  org2: string;
  org3: string;
  beteiligung1: string;
  beteiligung2: string;
  deal1: string;
  deal2: string;
}

/** Zwei Fonds mit je einer Beteiligung an eigener Organisation, eine Organisation ohne Beteiligung, zwei Deals (einer ohne Fonds). */
export async function legeWeltAn(db: Db): Promise<Welt> {
  const [f1, f2] = await db
    .insert(s.fonds)
    .values([
      { name: "Beispielfonds Eins", kurzname: "BF1", vintage: 2020, zeichnungskapital: "10000000.00" },
      { name: "Beispielfonds Zwei", kurzname: "BF2", vintage: 2021, zeichnungskapital: "20000000.00" },
    ])
    .returning();
  const [o1, o2, o3] = await db
    .insert(s.organisation)
    .values([
      { name: "Nordlicht Technik GmbH", art: "unternehmen" },
      { name: "Südwind Medizin GmbH", art: "unternehmen" },
      { name: "Ostblick Handel GmbH", art: "unternehmen" },
    ])
    .returning();
  const [b1, b2] = await db
    .insert(s.beteiligung)
    .values([
      { fondsId: f1!.id, organisationId: o1!.id, instrument: "offene_beteiligung", erstinvestment: "2022-01-15" },
      { fondsId: f2!.id, organisationId: o2!.id, instrument: "wandeldarlehen", erstinvestment: "2022-02-15" },
    ])
    .returning();
  const [d1, d2] = await db
    .insert(s.deal)
    .values([
      { organisationId: o1!.id, fondsId: f1!.id, titel: "Nordlicht, Serie A" },
      { organisationId: o3!.id, titel: "Ostblick, Seed" },
    ])
    .returning();
  return { fonds1: f1!.id, fonds2: f2!.id, org1: o1!.id, org2: o2!.id, org3: o3!.id, beteiligung1: b1!.id, beteiligung2: b2!.id, deal1: d1!.id, deal2: d2!.id };
}

export const zaehleZeilen = async (db: Db, tabelle: string): Promise<number> => ((await db.execute(sql.raw(`SELECT count(*)::int AS n FROM ${tabelle}`))).rows[0] as { n: number }).n;

export type { Testperson };
