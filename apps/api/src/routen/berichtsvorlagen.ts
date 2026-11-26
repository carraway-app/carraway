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

/**
 * Vorlagen und Freigabestufen je Fonds. Mount unter `/fonds/:id`:
 * `GET /berichtsvorlagen`, `PUT /berichtsvorlagen/:art`, `GET /freigabestufen`, `PUT /freigabestufen`.
 */

const artParam = z.object({ id: z.uuid(), art: z.enum(BERICHTSARTEN) });
const stufenEingabe = z.object({
  stufen: z
    .array(textEingabe(100))
    .min(2)
    .max(6)
    .refine((l) => new Set(l.map((s) => s.toLowerCase())).size === l.length, { message: "Stufennamen dürfen sich nicht wiederholen" }),
});

export function berichtsvorlagenRouten(db: Db) {
  return new Hono()
    .get("/berichtsvorlagen", pruefe("param", idParam), async (c) => {
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
      return c.json({ daten }, 200);
    })
    /** Setzt die Vorlage einer Art: Abschnitte (Reihenfolge), Kennzahlen, Spalten, Einheit. Fehlende Felder gelten als Standard. */
    .put("/berichtsvorlagen/:art", pruefe("param", artParam), pruefe("json", z.record(z.string(), z.unknown())), async (c) => {
      const { id, art } = c.req.valid("param");
      const roh = c.req.valid("json");
      let konfiguration;
      try {
        konfiguration = pruefeKonfiguration(art, roh);
      } catch (fehler) {
        if (fehler instanceof ZodError) {
          throw new Fachfehler(400, "EINGABE_UNGUELTIG", "Die Eingabe ist ungültig.", {
            felder: fehler.issues.map((i) => ({ feld: i.path.map(String).join(".") || "konfiguration", code: i.code, meldung: i.message })),
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
          if (unbekannt.length) throw new Fachfehler(404, "KENNZAHL_NICHT_GEFUNDEN", `Die Kennzahl „${unbekannt[0]}“ gibt es im Katalog nicht.`, { schluessel: unbekannt });
        }
        // Eigene Felder als Spalten: Die Definition muss bestehen, aktiv sein und zu Fonds, Runde, Instrument oder Beteiligung gehören.
        if (konfiguration.zusatzfelder.length) {
          const unbekannt = await ungueltigeZusatzfelder(tx, konfiguration.zusatzfelder);
          if (unbekannt.length) {
            throw new Fachfehler(400, "EINGABE_UNGUELTIG", "Die Eingabe ist ungültig.", {
              felder: [{ feld: "zusatzfelder", code: "feld_unbekannt", meldung: `Das Feld ${unbekannt[0]} gibt es nicht, ist archiviert oder gehört nicht zu Fonds, Runde, Instrument oder Beteiligung` }],
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
      return c.json(ergebnis, 200);
    })
    .get("/freigabestufen", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const stufen = await lese(db, async (tx) => {
        await ladeFonds(tx, id);
        return ladeFreigabestufen(tx, id);
      });
      return c.json({ stufen }, 200);
    })
    /** Namen der Stufen für neue Berichte (bestehende Berichte behalten ihre); mindestens zwei, nur die Verwalter des Fonds dürfen ändern (Berechtigungstabelle). */
    .put("/freigabestufen", pruefe("param", idParam), pruefe("json", stufenEingabe), async (c) => {
      const { id } = c.req.valid("param");
      const { stufen } = c.req.valid("json");
      const ergebnis = await schreibe(db, c, async (tx, protokoll) => {
        await ladeFonds(tx, id);
        const [vorher] = await tx.select().from(berichtFreigabestufen).where(eq(berichtFreigabestufen.fondsId, id));
        const werte = { stufen, geaendertVon: protokoll.akteur, geaendertAm: new Date() };
        const [neu] = vorher
          ? await tx.update(berichtFreigabestufen).set(werte).where(eq(berichtFreigabestufen.fondsId, id)).returning()
          : await tx.insert(berichtFreigabestufen).values({ fondsId: id, ...werte }).returning();
        await protokoll(vorher ? "aendern" : "anlegen", "bericht_freigabestufen", id, vorher ?? null, neu);
        return { stufen };
      });
      return c.json(ergebnis, 200);
    });
}
