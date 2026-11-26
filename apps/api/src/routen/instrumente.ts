import { Hono } from "hono";
import { z } from "zod";
import { instrumentArt, type Db } from "@carraway/db";
import { fehlerAntwort } from "../fehler";
import { aendereInstrument, ladeInstrument, ladeInstrumentUebersicht, legeInstrumentAn } from "../instrumente/instrumente";
import { aendereTranche, erfuelleTranche, legeTrancheAn } from "../instrumente/tranchen-schreiben";
import { ladeTranchenMitStand } from "../instrumente/tranchen";
import { ladeVorgaenge } from "../instrumente/zustand";
import { pruefeNeueWerte } from "../felder/werte";
import { pruefe } from "../pruefung";
import { betragEingabe, idParam, mindestensEins, MINDESTENS_EIN_FELD, optionalerText, schreibe, textEingabe } from "../schreiben";
import { lese } from "../zeitlimit";

/**
 * Instrumente und Tranchen (`docs/portfolio-modell.md`). Lesen: Instrumente einer Beteiligung mit Zusage, Ausgezahltem, offener Zusage, offenem Kapital und
 * Tranchen mit Stand. Schreiben: Instrument anlegen und ändern, Tranchen anlegen (optional mit der fehlenden Zusage in einem Schritt), ändern, erfüllen.
 * Der Status eines Instruments folgt den Abläufen (Wandlung, Verkauf, Insolvenz); es gibt keine eigene Statusroute.
 */

const art = z.enum(instrumentArt.enumValues);
const bezeichnung = textEingabe(200);
const felderEingabe = z.record(z.string(), z.unknown()).optional();
/** Abschlag als Bruch von 0 bis unter 1 mit höchstens sechs Nachkommastellen (0.2 = 20 %). */
const abschlagEingabe = z.string().regex(/^0(\.\d{1,6})?$/, "Abschlag als Bruch von 0 bis unter 1 mit höchstens sechs Nachkommastellen erwartet");

const neuesInstrument = z.object({
  art,
  bezeichnung: bezeichnung.optional(),
  rundeId: z.uuid().nullable().optional(),
  anteilsklasseId: z.uuid().nullable().optional(),
  felder: felderEingabe,
  wandlungsabschlag: abschlagEingabe.nullable().optional(),
  bewertungsobergrenze: betragEingabe.nullable().optional(),
  zinsenWandeln: z.boolean().nullable().optional(),
});

const instrumentAenderung = z
  .object({
    bezeichnung: bezeichnung.optional(),
    art: art.optional(),
    rundeId: z.uuid().nullable().optional(),
    anteilsklasseId: z.uuid().nullable().optional(),
    felder: felderEingabe,
    wandlungsabschlag: abschlagEingabe.nullable().optional(),
    bewertungsobergrenze: betragEingabe.nullable().optional(),
    zinsenWandeln: z.boolean().nullable().optional(),
  })
  .refine(mindestensEins, MINDESTENS_EIN_FELD);

const neueTranche = z.object({
  bezeichnung: textEingabe(300),
  betrag: betragEingabe,
  bedingung: optionalerText(2000),
  geplantAm: z.iso.date().nullable().optional(),
  /** Alter Name von `geplantAm`. */
  frist: z.iso.date().nullable().optional(),
  zusageErhoehen: z.boolean().default(false),
  zusageValuta: z.iso.date().optional(),
});

const trancheAenderung = z
  .object({ bezeichnung: textEingabe(300).optional(), betrag: betragEingabe.optional(), bedingung: optionalerText(2000), geplantAm: z.iso.date().nullable().optional(), frist: z.iso.date().nullable().optional() })
  .refine(mindestensEins, MINDESTENS_EIN_FELD);

const erfuelltEingabe = z.object({ datum: z.iso.date().optional(), nachweis: optionalerText(2000) });

/** Mount unter `/beteiligungen/:id`. */
export function beteiligungInstrumenteRouten(db: Db) {
  return new Hono()
    .get("/instrumente", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const daten = await lese(db, (tx) => ladeInstrumentUebersicht(tx, id));
      if (!daten) return fehlerAntwort(c, 404, "BETEILIGUNG_NICHT_GEFUNDEN", "Beteiligung nicht gefunden.");
      return c.json({ daten }, 200);
    })
    .post("/instrumente", pruefe("param", idParam), pruefe("json", neuesInstrument), async (c) => {
      const { id } = c.req.valid("param");
      const e = c.req.valid("json");
      const neu = await schreibe(db, c, async (tx, protokoll) => {
        const felder = await pruefeNeueWerte(tx, c, "instrument", e.felder);
        const zeile = await legeInstrumentAn(tx, protokoll, id, { ...e, felder });
        return (await ladeInstrumentUebersicht(tx, id))?.find((i) => i.id === zeile.id);
      });
      return c.json(neu, 201);
    });
}

/** Mount unter `/instrumente`. */
export function instrumentRouten(db: Db) {
  return new Hono()
    .get("/:id", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const eintrag = await lese(db, async (tx) => {
        const i = await ladeInstrument(tx, id);
        return (await ladeInstrumentUebersicht(tx, i.beteiligungId))?.find((x) => x.id === id) ?? null;
      });
      return c.json(eintrag, 200);
    })
    .patch("/:id", pruefe("param", idParam), pruefe("json", instrumentAenderung), async (c) => {
      const { id } = c.req.valid("param");
      const e = c.req.valid("json");
      const nachher = await schreibe(db, c, async (tx, protokoll) => {
        const zeile = await aendereInstrument(tx, protokoll, c, id, e);
        return (await ladeInstrumentUebersicht(tx, zeile.beteiligungId))?.find((x) => x.id === id);
      });
      return c.json(nachher, 200);
    })
    .get("/:id/tranchen", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const daten = await lese(db, async (tx) => {
        const i = await ladeInstrument(tx, id);
        return ladeTranchenMitStand(tx, [id], await ladeVorgaenge(tx, i.beteiligungId));
      });
      return c.json({ daten }, 200);
    })
    .post("/:id/tranchen", pruefe("param", idParam), pruefe("json", neueTranche), async (c) => {
      const { id } = c.req.valid("param");
      const e = c.req.valid("json");
      const ergebnis = await schreibe(db, c, (tx, protokoll) =>
        legeTrancheAn(tx, protokoll, id, { bezeichnung: e.bezeichnung, betrag: e.betrag, bedingung: e.bedingung, geplantAm: e.geplantAm ?? e.frist ?? null, zusageErhoehen: e.zusageErhoehen, zusageValuta: e.zusageValuta }),
      );
      return c.json({ ...ergebnis.tranche, zusageVorgang: ergebnis.zusageVorgang }, 201);
    });
}

/** Mount unter `/tranchen`. */
export function trancheRouten(db: Db) {
  return new Hono()
    .patch("/:id", pruefe("param", idParam), pruefe("json", trancheAenderung), async (c) => {
      const { id } = c.req.valid("param");
      const { frist, geplantAm, ...rest } = c.req.valid("json");
      const nachher = await schreibe(db, c, (tx, protokoll) => aendereTranche(tx, protokoll, id, { ...rest, geplantAm: geplantAm !== undefined ? geplantAm : frist }));
      return c.json(nachher, 200);
    })
    .post("/:id/erfuellt", pruefe("param", idParam), pruefe("json", erfuelltEingabe), async (c) => {
      const { id } = c.req.valid("param");
      const { datum, nachweis } = c.req.valid("json");
      const nachher = await schreibe(db, c, (tx, protokoll) => erfuelleTranche(tx, protokoll, id, datum, nachweis));
      return c.json(nachher, 200);
    });
}
