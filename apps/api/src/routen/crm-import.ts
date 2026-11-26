import { Hono } from "hono";
import { z } from "zod";
import type { Db } from "@carraway/db";
import { kopfzeile, MAX_BYTES, verarbeiteCrmImport } from "../crm/import";
import { pruefe } from "../pruefung";
import { schreibe } from "../schreiben";
import { lese } from "../zeitlimit";

const eingabe = z.object({
  objekt: z.enum(["organisation", "person"]),
  /** Inhalt der CSV-Datei als Text (höchstens 2 MB); Trennzeichen wird aus der Kopfzeile erkannt. */
  csv: z.string().min(1).max(MAX_BYTES + 1024),
  zuordnung: z.array(z.object({ spalte: z.number().int().min(0).max(200), feld: z.string().min(1).max(64) })).min(1).max(100),
  dubletten: z.enum(["ueberspringen", "aktualisieren", "anlegen"]).default("ueberspringen"),
  /** Nur bei Kontakten: unbekannte Unternehmen aus der Spalte „Unternehmen“ anlegen. */
  unternehmenAnlegen: z.boolean().default(false),
});

/** CSV-Import mit Spaltenzuordnung (Etappe 20): Kopfzeile lesen, Vorschau mit Dublettenprüfung, Übernahme. */
export function crmImportRouten(db: Db) {
  return new Hono()
    .post("/kopfzeile", pruefe("json", z.object({ csv: z.string().min(1).max(MAX_BYTES + 1024) })), async (c) => {
      const { csv } = c.req.valid("json");
      return c.json({ spalten: kopfzeile(csv) }, 200);
    })
    .post("/vorschau", pruefe("json", eingabe), async (c) => {
      const e = c.req.valid("json");
      const ergebnis = await lese(db, (tx) => verarbeiteCrmImport(tx, null, e.objekt, e.csv, e.zuordnung, e.dubletten, e.unternehmenAnlegen));
      return c.json(ergebnis, 200);
    })
    .post("/", pruefe("json", eingabe), async (c) => {
      const e = c.req.valid("json");
      const ergebnis = await schreibe(db, c, (tx, protokoll) => verarbeiteCrmImport(tx, protokoll, e.objekt, e.csv, e.zuordnung, e.dubletten, e.unternehmenAnlegen));
      return c.json(ergebnis, 200);
    });
}
