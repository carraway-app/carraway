import ExcelJS from "exceljs";
import { Hono } from "hono";
import { z } from "zod";
import type { Db } from "@carraway/db";
import { Fachfehler } from "../fehler";
import {
  JOURNAL_TYPEN,
  dekodiereCursor,
  ladeJournalSeite,
  ladeJournalSummen,
  type JournalFilter,
  type JournalSumme,
  type JournalZeile,
} from "../journal/journal";
import { pruefe } from "../pruefung";
import { csvFeld } from "./dealflow";
import { idParam, ladeFonds, protokolliereLesen } from "../schreiben";
import { lese } from "../zeitlimit";

/**
 * `GET /fonds/:id/journal` (Etappe 4b): das Journal des Fonds, seitenweise mit Cursor, mit Summen auf der ersten Seite. Mit `format=csv|xlsx`
 * kommt der ganze Filter als Datei (höchstens `MAX_EXPORTZEILEN`); die Datei bekommt eine Zeile `gelesen` im Protokoll.
 */

export const MAX_EXPORTZEILEN = 100_000;

const typListe = z
  .string()
  .transform((t) => t.split(",").map((x) => x.trim()).filter((x) => x !== ""))
  .pipe(z.array(z.enum(JOURNAL_TYPEN)).min(1).max(JOURNAL_TYPEN.length));

export const journalAbfrage = z
  .object({
    von: z.iso.date().optional(),
    bis: z.iso.date().optional(),
    typ: typListe.optional(),
    beteiligungId: z.uuid().optional(),
    organisationId: z.uuid().optional(),
    bewertungen: z.enum(["0", "1"]).optional(),
    stand: z.iso.datetime({ offset: true }).optional(),
    richtung: z.enum(["auf", "ab"]).default("ab"),
    cursor: z
      .string()
      .max(500)
      .refine((c) => dekodiereCursor(c) !== null, { message: "Cursor ungültig" })
      .optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100),
    format: z.enum(["csv", "xlsx"]).optional(),
    sprache: z.enum(["de", "en"]).default("de"),
  })
  .refine((a) => !a.von || !a.bis || a.von <= a.bis, { message: "von darf nicht nach bis liegen", path: ["von"] });

const KOEPFE = {
  de: ["Valuta", "Erfasst am", "Typ", "Unternehmen", "Instrument", "Betrag", "Kassenwirkung", "Richtung", "Storno von", "Storniert durch", "Herkunft", "Erfasst von", "Bemerkung"],
  en: ["Value date", "Recorded at", "Type", "Company", "Instrument", "Amount", "Cash effect", "Direction", "Reversal of", "Reversed by", "Origin", "Recorded by", "Note"],
} as const;
const TYPEN = {
  de: { zusage: "Zusage", auszahlung: "Auszahlung", rueckfluss: "Rückfluss", zins: "Zins", zinszahlung: "Zinszahlung", dividende: "Dividende", tilgung: "Tilgung", wertberichtigung: "Wertberichtigung", abruf: "Abruf", ausschuettung: "Ausschüttung", bewertung: "Bewertung", wandlung: "Wandlung", verkauf: "Verkauf", insolvenz: "Insolvenz" },
  en: { zusage: "Commitment", auszahlung: "Disbursement", rueckfluss: "Proceeds", zins: "Interest", zinszahlung: "Interest payment", dividende: "Dividend", tilgung: "Repayment", wertberichtigung: "Write-down", abruf: "Capital call", ausschuettung: "Distribution", bewertung: "Valuation", wandlung: "Conversion", verkauf: "Sale", insolvenz: "Insolvency" },
} as const;
const RICHTUNG = { de: { zufluss: "Zufluss", abfluss: "Abfluss" }, en: { zufluss: "Inflow", abfluss: "Outflow" } } as const;
const HERKUNFT = {
  de: { manuell: "Manuell", import: "Import", zinslauf: "Zinslauf", wandlung: "Wandlung", verkauf: "Verkauf", runde: "Finanzierungsrunde" },
  en: { manuell: "Manual", import: "Import", zinslauf: "Interest run", wandlung: "Conversion", verkauf: "Sale", runde: "Financing round" },
} as const;
const SUMMEN_KOPF = { de: ["Typ", "Anzahl", "Summe", "Kassenwirkung"], en: ["Type", "Count", "Total", "Cash effect"] } as const;
const GESAMT = { de: "Gesamt (Kassenwirkung)", en: "Total (cash effect)" } as const;

function zeileAlsFelder(z: JournalZeile, sprache: "de" | "en") {
  return [
    z.valuta,
    z.erfasstAm,
    TYPEN[sprache][z.typ as keyof (typeof TYPEN)["de"]] ?? z.typ,
    z.beteiligung?.organisationName ?? "",
    z.beteiligung?.instrument ?? "",
    z.betrag,
    z.kassenwirkung,
    z.richtung ? RICHTUNG[sprache][z.richtung] : "",
    z.stornoVon ?? "",
    z.storniertDurch ?? "",
    HERKUNFT[sprache][z.herkunft.art],
    z.erfasstVon?.name ?? z.erfasstVon?.id ?? "",
    z.bemerkung ?? "",
  ];
}

/** Zahlen bleiben Zahlen (auch negative, die `csvFeld` sonst als mögliche Formel mit Apostroph versähe); Texte laufen durch `csvFeld`. */
const csvWert = (w: string | number | null) => (typeof w === "string" && /^-?\d+(\.\d+)?$/.test(w) ? w : csvFeld(w));

function alsCsv(zeilen: JournalZeile[], summen: { nachTyp: JournalSumme[]; gesamt: { anzahl: number; kassenwirkung: string } }, sprache: "de" | "en"): string {
  const t = TYPEN[sprache];
  const kopf = [...KOEPFE[sprache]];
  const aus: (string | number | null)[][] = [kopf, ...zeilen.map((z) => zeileAlsFelder(z, sprache))];
  aus.push([]);
  aus.push([...SUMMEN_KOPF[sprache]]);
  for (const s of summen.nachTyp) aus.push([t[s.typ as keyof typeof t] ?? s.typ, s.anzahl, s.summe, s.kassenwirkung]);
  aus.push([GESAMT[sprache], summen.gesamt.anzahl, null, summen.gesamt.kassenwirkung]);
  return `\uFEFF${aus.map((r) => r.map(csvWert).join(";")).join("\r\n")}\r\n`;
}

async function alsXlsx(zeilen: JournalZeile[], summen: { nachTyp: JournalSumme[]; gesamt: { anzahl: number; kassenwirkung: string } }, sprache: "de" | "en"): Promise<Buffer> {
  const mappe = new ExcelJS.Workbook();
  const blatt = mappe.addWorksheet(sprache === "de" ? "Journal" : "Journal");
  blatt.addRow([...KOEPFE[sprache]]).font = { bold: true };
  const betragFormat = "#,##0.00;-#,##0.00";
  for (const z of zeilen) {
    const f = zeileAlsFelder(z, sprache);
    // Datum als Datum, Beträge als Zahl (Gleitkomma, wie in den übrigen Exporten, Entscheidung 57).
    const zeile = blatt.addRow([new Date(`${z.valuta}T00:00:00Z`), new Date(z.erfasstAm), ...f.slice(2, 5), z.betrag === null ? null : Number(z.betrag), z.kassenwirkung === null ? null : Number(z.kassenwirkung), ...f.slice(7)]);
    zeile.getCell(1).numFmt = "yyyy-mm-dd";
    zeile.getCell(2).numFmt = "yyyy-mm-dd hh:mm";
    zeile.getCell(6).numFmt = betragFormat;
    zeile.getCell(7).numFmt = betragFormat;
  }
  blatt.columns.forEach((spalte) => (spalte.width = 18));
  const s = mappe.addWorksheet(sprache === "de" ? "Summen" : "Totals");
  s.addRow([...SUMMEN_KOPF[sprache]]).font = { bold: true };
  const t = TYPEN[sprache];
  for (const x of summen.nachTyp) {
    const r = s.addRow([t[x.typ as keyof typeof t] ?? x.typ, x.anzahl, x.summe === null ? null : Number(x.summe), x.kassenwirkung === null ? null : Number(x.kassenwirkung)]);
    r.getCell(3).numFmt = betragFormat;
    r.getCell(4).numFmt = betragFormat;
  }
  const g = s.addRow([GESAMT[sprache], summen.gesamt.anzahl, null, Number(summen.gesamt.kassenwirkung)]);
  g.getCell(4).numFmt = betragFormat;
  g.font = { bold: true };
  return Buffer.from(await mappe.xlsx.writeBuffer());
}

/** Mount unter `/fonds`. */
export function fondsJournalRouten(db: Db) {
  return new Hono().get("/:id/journal", pruefe("param", idParam, { query: journalAbfrage }), pruefe("query", journalAbfrage), async (c) => {
    const { id } = c.req.valid("param");
    const q = c.req.valid("query");
    const filter: JournalFilter = {
      fondsId: id,
      von: q.von,
      bis: q.bis,
      typen: q.typ,
      beteiligungId: q.beteiligungId,
      organisationId: q.organisationId,
      bewertungen: q.bewertungen === "1",
      stand: q.stand,
    };
    if (q.format) {
      const { zeilen, summen } = await lese(db, async (tx) => {
        await ladeFonds(tx, id);
        const alle: JournalZeile[] = [];
        let cursor = null as ReturnType<typeof dekodiereCursor>;
        for (;;) {
          const seite = await ladeJournalSeite(tx, filter, { nach: cursor, richtung: q.richtung, limit: 5000 });
          alle.push(...seite.daten);
          if (alle.length > MAX_EXPORTZEILEN) {
            throw new Fachfehler(400, "EINGABE_UNGUELTIG", "Die Eingabe ist ungültig.", {
              felder: [{ feld: "von", code: "export_zu_gross", meldung: `Der Export hat mehr als ${MAX_EXPORTZEILEN} Zeilen; bitte den Zeitraum einschränken` }],
            });
          }
          if (!seite.naechsterCursor) break;
          cursor = dekodiereCursor(seite.naechsterCursor);
        }
        return { zeilen: alle, summen: await ladeJournalSummen(tx, filter) };
      });
      // Eine Datei mit Buchungen verlässt das System: Lese-Protokoll wie bei den Berichten.
      await protokolliereLesen(db, c, "journal", id, { ...q, cursor: undefined, zeilen: zeilen.length });
      if (q.format === "csv") {
        // `as never`: Die Datei gehört nicht in den JSON-Typ der Antwort, den der typisierte Client der Oberfläche liest.
        return c.body(alsCsv(zeilen, summen, q.sprache), 200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="journal.csv"` }) as never;
      }
      return c.body(new Uint8Array(await alsXlsx(zeilen, summen, q.sprache)), 200, {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="journal.xlsx"`,
      }) as never;
    }
    const nach = q.cursor ? dekodiereCursor(q.cursor) : null;
    const antwort = await lese(db, async (tx) => {
      await ladeFonds(tx, id);
      const seite = await ladeJournalSeite(tx, filter, { nach, richtung: q.richtung, limit: q.limit });
      // Summen über den ganzen Filter nur auf der ersten Seite.
      const summen = nach ? null : await ladeJournalSummen(tx, filter);
      return { ...seite, summen };
    });
    return c.json(antwort, 200);
  });
}
