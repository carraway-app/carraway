import { eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { z, ZodError } from "zod";
import { BERICHTSARTEN, erlaubteAuswahl, pruefeKonfiguration, standardKonfiguration } from "@carraway/berichte";
import { berichtFreigabestufen, berichtVorlage, kennzahlDefinition, type Db } from "@carraway/db";
import { Fachfehler } from "../fehler";
import { ladeFreigabestufen } from "../berichte/vorlagen";
import { ungueltigeZusatzfelder } from "../berichte/zusatz";
import { pruefe } from "../pruefung";
import { idParam, ladeFonds, schreibe, textEingabe } from "../schreiben";
import { lese } from "../zeitlimit";
import { berichtPruefung, berichtSchema } from "../berichte-pruefung";
import { berichtAnApi } from "../berichte-vertrag";

const pruefeApi = berichtPruefung("report");
const anApi = <T>(wert: T) => berichtAnApi("report", wert);

/**
 * Vorlagen und Freigabestufen je Fonds. Mount unter `/funds/:id`:
 * `GET /report-templates`, `PUT /report-templates/:reportType`. Freigabestufen stehen unter `/funds/:id/approval-stages`.
 */

const vorlagenEingabe = z.object({
  einheit: z.enum(["EUR", "TEUR"]).optional(),
  abschnitte: z.array(z.string()).optional(),
  kennzahlen: z.array(z.string()).optional(),
  spalten: z.array(z.string()).optional(),
  unternehmenskennzahlen: z.array(z.string()).optional(),
  zusatzfelder: z.array(z.string()).optional(),
});
const artParam = z.object({ id: z.uuid(), art: z.enum(BERICHTSARTEN) });
const stufenEingabe = z.object({
  stages: z
    .array(textEingabe(100))
    .min(2)
    .max(6)
    .refine((l) => new Set(l.map((s) => s.toLowerCase())).size === l.length, { message: "Stage names must not repeat" }),
});

export function berichtsvorlagenRouten(db: Db) {
  return new Hono()
    .get("/report-templates", pruefeApi("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const daten = await lese(db, async (tx) => {
        await ladeFonds(tx, id);
        const gespeichert = await tx.select().from(berichtVorlage).where(eq(berichtVorlage.fondsId, id));
        // Der Szenariobericht hat keine Vorlage (Abschnitte und Spalten sind fest).
        return BERICHTSARTEN.filter((a) => a !== "szenariobericht").map((art) => {
          const z = gespeichert.find((x) => x.art === art);
          return {
            art,
            angepasst: z !== undefined,
            konfiguration: z ? pruefeKonfiguration(art, z.konfiguration) : standardKonfiguration(art),
            /** Die wählbaren Abschnitte, Kennzahlen, Spalten und Einheiten der Art (Reihenfolge der Standardkonfiguration). */
            erlaubt: erlaubteAuswahl(art),
          };
        });
      });
      return c.json(anApi({ daten }), 200);
    })
    /** Setzt die Vorlage einer Art: Abschnitte (Reihenfolge), Kennzahlen, Spalten, Einheit. Fehlende Felder gelten als Standard. */
    .put("/report-templates/:reportType", pruefeApi("param", artParam), pruefeApi("json", z.record(z.string(), z.unknown()), {}, berichtSchema("report", vorlagenEingabe)), async (c) => {
      const { id, art } = c.req.valid("param");
      const roh = c.req.valid("json");
      let konfiguration;
      try {
        konfiguration = pruefeKonfiguration(art, roh);
      } catch (fehler) {
        if (fehler instanceof ZodError) {
          throw new Fachfehler(400, "invalid_input", "The input is invalid.", {
            felder: fehler.issues.map((i) => ({ feld: i.path.map(String).join(".") || "konfiguration", code: i.code, meldung: "This value is invalid for the report type." })),
          });
        }
        throw fehler;
      }
      const ergebnis = await schreibe(db, c, async (tx, protokoll) => {
        await ladeFonds(tx, id);
        // Die Schlüssel der Unternehmenskennzahlen müssen im Katalog stehen (das Paket prüft nur die Form).
        if (konfiguration.unternehmenskennzahlen.length) {
          const bekannt = new Set((await tx.select({ s: kennzahlDefinition.schluessel }).from(kennzahlDefinition).where(inArray(kennzahlDefinition.schluessel, konfiguration.unternehmenskennzahlen))).map((x) => x.s));
          const unbekannt = konfiguration.unternehmenskennzahlen.filter((s) => !bekannt.has(s));
          if (unbekannt.length) throw new Fachfehler(404, "metric_not_found", `The metric "${unbekannt[0]}" does not exist in the catalog.`, { schluessel: unbekannt });
        }
        // Eigene Felder als Spalten: Die Definition muss bestehen, aktiv sein und zu Fonds, Runde, Instrument oder Beteiligung gehören.
        if (konfiguration.zusatzfelder.length) {
          const unbekannt = await ungueltigeZusatzfelder(tx, konfiguration.zusatzfelder);
          if (unbekannt.length) {
            throw new Fachfehler(400, "invalid_input", "The input is invalid.", {
              felder: [{ feld: "zusatzfelder", code: "field_unknown", meldung: `The field ${unbekannt[0]} does not exist, is archived or does not belong to fund, round, instrument or investment` }],
            });
          }
        }
        const [vorher] = (await tx.select().from(berichtVorlage).where(eq(berichtVorlage.fondsId, id))).filter((z) => z.art === art);
        const werte = { konfiguration, geaendertVon: protokoll.akteur, geaendertAm: new Date() };
        const [neu] = vorher
          ? await tx.update(berichtVorlage).set(werte).where(eq(berichtVorlage.id, vorher.id)).returning()
          : await tx.insert(berichtVorlage).values({ fondsId: id, art, ...werte }).returning();
        await protokoll(vorher ? "aendern" : "anlegen", "bericht_vorlage", neu!.id, vorher ?? null, neu);
        return { art, angepasst: true, konfiguration, erlaubt: erlaubteAuswahl(art) };
      });
      return c.json(anApi(ergebnis), 200);
    });
}

export function freigabestufenRouten(db: Db) {
  return new Hono()
    .get("/approval-stages", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const stufen = await lese(db, async (tx) => {
        await ladeFonds(tx, id);
        return ladeFreigabestufen(tx, id);
      });
      return c.json({ stages: stufen }, 200);
    })
    /** Namen der Stufen für neue Berichte (bestehende Berichte behalten ihre); mindestens zwei, nur die Verwalter des Fonds dürfen ändern (Berechtigungstabelle). */
    .put("/approval-stages", pruefe("param", idParam), pruefe("json", stufenEingabe), async (c) => {
      const { id } = c.req.valid("param");
      const { stages: stufen } = c.req.valid("json");
      const ergebnis = await schreibe(db, c, async (tx, protokoll) => {
        await ladeFonds(tx, id);
        const [vorher] = await tx.select().from(berichtFreigabestufen).where(eq(berichtFreigabestufen.fondsId, id));
        const werte = { stufen, geaendertVon: protokoll.akteur, geaendertAm: new Date() };
        const [neu] = vorher
          ? await tx.update(berichtFreigabestufen).set(werte).where(eq(berichtFreigabestufen.fondsId, id)).returning()
          : await tx.insert(berichtFreigabestufen).values({ fondsId: id, ...werte }).returning();
        await protokoll(vorher ? "aendern" : "anlegen", "bericht_freigabestufen", id, vorher ?? null, neu);
        return { stages: stufen };
      });
      return c.json(ergebnis, 200);
    });
}
