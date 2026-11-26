import { kontaktJson, pruefeKontakt } from "../kontakte/http";
import { Hono } from "hono";
import { z } from "zod";
import type { Db } from "@carraway/db";
import { leseDatei, vorlageCsv, vorlageExcel, MAX_BYTES } from "../kontakte/import-datei";
import { verarbeiteImport } from "../kontakte/import";
import { schreibe } from "../schreiben";
import { lese } from "../zeitlimit";

const datei = z.object({
  format: z.enum(["csv", "xlsx"]),
  /** Inhalt der Datei, Base64-kodiert (höchstens 2 MB). */
  inhalt: z.string().min(1).max(Math.ceil((MAX_BYTES * 4) / 3) + 8),
});

const entscheidung = z.object({
  zeile: z.number().int().min(2),
  aktion: z.enum(["anlegen", "zusammenfuehren", "ueberspringen"]),
  zielId: z.uuid().optional(),
});

/** Kontaktimport aus CSV oder Excel: Vorlage, Vorschau mit Dublettenkandidaten, Übernahme in einer Transaktion. */
export function kontaktimportRouten(db: Db) {
  return new Hono()
    .get("/template", pruefeKontakt("query", z.object({ sprache: z.enum(["de", "en"]).default("de"), format: z.enum(["csv", "xlsx"]).default("csv") })), async (c) => {
      const { sprache, format } = c.req.valid("query");
      if (format === "xlsx") {
        const daten = await vorlageExcel(sprache);
        return c.body(new Uint8Array(daten), 200, {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="kontaktimport-vorlage-${sprache}.xlsx"`,
        });
      }
      return c.body(vorlageCsv(sprache), 200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="kontaktimport-vorlage-${sprache}.csv"`,
      });
    })
    .post("/preview", pruefeKontakt("json", datei.extend({ entscheidungen: z.array(entscheidung).max(1000).default([]) })), async (c) => {
      const { format, inhalt, entscheidungen } = c.req.valid("json");
      const eingelesen = await leseDatei(format, inhalt);
      const ergebnis = await lese(db, (tx) => verarbeiteImport(tx, null, eingelesen.zeilen, entscheidungen));
      return kontaktJson(c, { unbekannteSpalten: eingelesen.unbekannteSpalten, zusammenfassung: ergebnis.zusammenfassung, zeilen: ergebnis.plaene }, 200);
    })
    .post("/", pruefeKontakt("json", datei.extend({ entscheidungen: z.array(entscheidung).max(1000).default([]) })), async (c) => {
      const { format, inhalt, entscheidungen } = c.req.valid("json");
      const eingelesen = await leseDatei(format, inhalt);
      const ergebnis = await schreibe(db, c, (tx, protokoll) => verarbeiteImport(tx, protokoll, eingelesen.zeilen, entscheidungen));
      const zaehle = (e: string) => ergebnis.plaene.filter((p) => p.ergebnis === e).length;
      return kontaktJson(
        c,
        {
          unbekannteSpalten: eingelesen.unbekannteSpalten,
          zusammenfassung: {
            ...ergebnis.zusammenfassung,
            angelegt: zaehle("angelegt"),
            ergaenzt: zaehle("ergaenzt"),
            unveraendert: zaehle("unveraendert"),
            uebersprungen: zaehle("uebersprungen"),
            fehler: zaehle("fehler"),
          },
          zeilen: ergebnis.plaene,
        },
        200,
      );
    });
}
