import { and, asc, desc, eq, lte } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { beteiligung, bewertung, bewertungMethode, bewertungsrunde, organisation, rundenVorschlag, type Db } from "@carraway/db";
import { Fachfehler, fehlerAntwort } from "../fehler";
import { aendereEntwurf, gibBewertungFrei, legeEntwurfAn, verwirfEntwurf } from "../instrumente/bewertung";
import { gibRundeFrei, legeRundeAn, pruefeRundeFuerEntwurf, verwirfRunde, type Uebersprungen } from "../instrumente/bewertungsrunde";
import { wirksameBewertung } from "../kennzahlen/fonds";
import { pruefeStichtag } from "../instrumente/stichtag";
import { pruefe } from "../pruefung";
import { idParam, ladeFonds, MINDESTENS_EIN_FELD, mindestensEins, optionalerText, schreibe } from "../schreiben";
import { lese, type Tx } from "../zeitlimit";
import { loeseBetrag } from "../waehrung/betrag";

/**
 * Bewertungen mit Freigabe und Bewertungsrunden. Die Routen sind in eigenen Exporten gebündelt; die zentrale
 * Berechtigungstabelle (`rechte/tabelle.ts`) ordnet sie ein:
 * - `beteiligungBewertungRouten` unter `/beteiligungen/:id` (anlegen, Verlauf)
 * - `bewertungRouten` unter `/bewertungen` (freigeben, verwerfen, lesen)
 * - `fondsBewertungRouten` unter `/fonds/:id` (Bewertungsrunde anlegen, Liste, Bewertungen eines Stichtags)
 * - `bewertungsrundeRouten` unter `/bewertungsrunden` (lesen, freigeben, verwerfen)
 */

const wertEingabe = z.string().regex(/^\d{1,16}(\.\d{1,2})?$/, "Betrag von null an mit höchstens zwei Nachkommastellen erwartet");
/** Lokaler Wert (Etappe 21) in der lokalen Währung der Beteiligung; dann darf `wert` (Fondswährung) fehlen und kommt vom Kurs der Tabelle zum Stichtag. */
const wertLokalEingabe = wertEingabe.optional();
const neueBewertungSchema = z.object({
  stichtag: z.iso.date(),
  wert: wertEingabe.optional(),
  wertLokal: wertLokalEingabe,
  methode: z.enum(bewertungMethode.enumValues),
  begruendung: optionalerText(2000),
  grundlage: optionalerText(2000),
  /** Ein neu angelegter Entwurf bleibt in seiner (offenen) Runde, z. B. nach dem Verwerfen und Neuerfassen. */
  bewertungsrundeId: z.uuid().optional(),
});
const aenderungSchema = z
  .object({
    wert: wertEingabe.optional(),
    wertLokal: wertLokalEingabe,
    methode: z.enum(bewertungMethode.enumValues).optional(),
    begruendung: optionalerText(2000),
  })
  .refine(mindestensEins, MINDESTENS_EIN_FELD);
const rundeSchema = z.object({ stichtag: z.iso.date(), vorschlag: z.enum(rundenVorschlag.enumValues) });
const rundenListe = z.object({ stichtag: z.iso.date().optional() });

/** Alle Bewertungen einer Beteiligung samt Historie (auch Entwürfe und ersetzte), neueste Stichtage zuerst. */
const bewertungsAuswahl = z.object({ bewertungId: z.uuid().optional(), stichtag: z.iso.date().optional(), stand: z.iso.datetime({ offset: true }).optional() });
async function ladeBewertungen(tx: Tx, beteiligungId: string, auswahl: z.infer<typeof bewertungsAuswahl>) {
  const { bewertungId, stichtag, stand } = auswahl;
  const zeilen = await tx.select().from(bewertung).where(and(eq(bewertung.beteiligungId, beteiligungId),
    bewertungId ? eq(bewertung.id, bewertungId) : undefined, stichtag ? lte(bewertung.stichtag, stichtag) : undefined,
    stand ? wirksameBewertung("bewertung", stand) : undefined)).orderBy(desc(bewertung.stichtag), desc(bewertung.erfasstAm), asc(bewertung.id));
  return stand ? zeilen.map((z) => ({ ...z, status: "freigegeben" as const, ersetztAm: null })) : zeilen;
}

export function beteiligungBewertungRouten(db: Db) {
  return new Hono()
    /** Legt eine Bewertung als Entwurf an. Gibt es zum Stichtag schon eine freigegebene, ersetzt der Entwurf sie bei der Freigabe. */
    .post("/bewertungen", pruefe("param", idParam), pruefe("json", neueBewertungSchema), async (c) => {
      const { id } = c.req.valid("param");
      const e = c.req.valid("json");
      const ergebnis = await schreibe(db, c, async (tx, protokoll) => {
        const [b] = await tx.select().from(beteiligung).where(eq(beteiligung.id, id));
        if (!b) throw new Fachfehler(404, "BETEILIGUNG_NICHT_GEFUNDEN", "Beteiligung nicht gefunden.");
        await pruefeStichtag(tx, b.fondsId, e.stichtag);
        if (e.bewertungsrundeId) await pruefeRundeFuerEntwurf(tx, e.bewertungsrundeId, b.fondsId, e.stichtag);
        const { wertLokal, wert: _w, ...rest } = e;
        const betrag = await loeseBetrag(tx, b, { betrag: e.wert, betragLokal: wertLokal, datum: e.stichtag, feld: "wert" });
        const r = await legeEntwurfAn(tx, protokoll, id, { ...rest, wert: betrag.fonds, lokal: betrag.betragLokal === null ? null : { wertLokal: betrag.betragLokal, kurs: betrag.kurs!, kursId: betrag.kursId } });
        return { bewertung: r.bewertung, ersetzt: r.ersetzt };
      });
      return c.json(ergebnis, 201);
    })
    .get("/bewertungen", pruefe("param", idParam), pruefe("query", bewertungsAuswahl), async (c) => {
      const { id } = c.req.valid("param");
      const daten = await lese(db, async (tx) => {
        const [b] = await tx.select({ id: beteiligung.id }).from(beteiligung).where(eq(beteiligung.id, id));
        return b ? ladeBewertungen(tx, id, c.req.valid("query")) : null;
      });
      if (!daten) return fehlerAntwort(c, 404, "BETEILIGUNG_NICHT_GEFUNDEN", "Beteiligung nicht gefunden.");
      return c.json({ daten }, 200);
    });
}

export function bewertungRouten(db: Db) {
  return new Hono()
    .get("/:id", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const zeile = await lese(db, async (tx) => (await tx.select().from(bewertung).where(eq(bewertung.id, id)))[0] ?? null);
      if (!zeile) return fehlerAntwort(c, 404, "BEWERTUNG_NICHT_GEFUNDEN", "Bewertung nicht gefunden.");
      return c.json(zeile, 200);
    })
    /** Ändert einen offenen Entwurf (Wert, Methode, Begründung); der ändernden Person gehört er danach für die Vier-Augen-Prüfung. */
    .patch("/:id", pruefe("param", idParam), pruefe("json", aenderungSchema), async (c) => {
      const { id } = c.req.valid("param");
      const e = c.req.valid("json");
      const nachher = await schreibe(db, c, async (tx, protokoll) => {
        const { wertLokal, ...rest } = e;
        if (wertLokal === undefined) return aendereEntwurf(tx, protokoll, id, rest);
        const [vorher] = await tx.select({ beteiligungId: bewertung.beteiligungId, stichtag: bewertung.stichtag }).from(bewertung).where(eq(bewertung.id, id));
        if (!vorher) throw new Fachfehler(404, "BEWERTUNG_NICHT_GEFUNDEN", "Bewertung nicht gefunden.");
        const [b] = await tx.select().from(beteiligung).where(eq(beteiligung.id, vorher.beteiligungId));
        const betrag = await loeseBetrag(tx, b!, { betrag: e.wert, betragLokal: wertLokal, datum: vorher.stichtag, feld: "wert" });
        return aendereEntwurf(tx, protokoll, id, { ...rest, wert: betrag.fonds, lokal: { wertLokal: betrag.betragLokal!, kurs: betrag.kurs!, kursId: betrag.kursId } });
      });
      return c.json(nachher, 200);
    })
    /** Gibt einen Entwurf frei. Vier-Augen: eine andere angemeldete Person als der Ersteller. */
    .post("/:id/freigeben", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const nachher = await schreibe(db, c, (tx, protokoll) => gibBewertungFrei(tx, protokoll, id));
      return c.json(nachher, 200);
    })
    .post("/:id/verwerfen", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const nachher = await schreibe(db, c, (tx, protokoll) => verwirfEntwurf(tx, protokoll, id));
      return c.json(nachher, 200);
    });
}

export function fondsBewertungRouten(db: Db) {
  return new Hono()
    /** Entwürfe für alle aktiven Beteiligungen ohne Bewertung zum Stichtag, gebündelt in einer Runde. */
    .post("/bewertungsrunde", pruefe("param", idParam), pruefe("json", rundeSchema), async (c) => {
      const { id } = c.req.valid("param");
      const { stichtag, vorschlag } = c.req.valid("json");
      const ergebnis = await schreibe(db, c, async (tx, protokoll) => {
        await ladeFonds(tx, id);
        await pruefeStichtag(tx, id, stichtag);
        return legeRundeAn(tx, protokoll, id, stichtag, vorschlag);
      });
      return c.json(ergebnis, 201);
    })
    .get("/bewertungsrunden", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const daten = await lese(db, (tx) =>
        tx.select().from(bewertungsrunde).where(eq(bewertungsrunde.fondsId, id)).orderBy(desc(bewertungsrunde.stichtag), desc(bewertungsrunde.erstelltAm)),
      );
      return c.json({ daten }, 200);
    })
    /** Bewertungen eines Fonds zu einem Stichtag mit Organisation und Status (Grundlage der Freigabeansicht). */
    .get("/bewertungen", pruefe("param", idParam, { query: rundenListe }), pruefe("query", rundenListe), async (c) => {
      const { id } = c.req.valid("param");
      const { stichtag } = c.req.valid("query");
      const daten = await lese(db, (tx) =>
        tx
          .select({ b: bewertung, organisation: organisation.name })
          .from(bewertung)
          .innerJoin(beteiligung, eq(beteiligung.id, bewertung.beteiligungId))
          .innerJoin(organisation, eq(organisation.id, beteiligung.organisationId))
          .where(and(eq(beteiligung.fondsId, id), stichtag ? eq(bewertung.stichtag, stichtag) : undefined))
          .orderBy(desc(bewertung.stichtag), asc(organisation.name), asc(bewertung.erfasstAm), asc(bewertung.id)),
      );
      return c.json({ daten: daten.map((z) => ({ ...z.b, organisation: z.organisation })) }, 200);
    });
}

export function bewertungsrundeRouten(db: Db) {
  return new Hono()
    .get("/:id", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const ergebnis = await lese(db, async (tx) => {
        const [runde] = await tx.select().from(bewertungsrunde).where(eq(bewertungsrunde.id, id));
        if (!runde) return null;
        const zeilen = await tx
          .select({ b: bewertung, organisation: organisation.name })
          .from(bewertung)
          .innerJoin(beteiligung, eq(beteiligung.id, bewertung.beteiligungId))
          .innerJoin(organisation, eq(organisation.id, beteiligung.organisationId))
          .where(eq(bewertung.bewertungsrundeId, id))
          .orderBy(asc(organisation.name), asc(bewertung.id));
        return { runde, bewertungen: zeilen.map((z) => ({ ...z.b, organisation: z.organisation })), uebersprungen: runde.uebersprungen as Uebersprungen[] };
      });
      if (!ergebnis) return fehlerAntwort(c, 404, "BEWERTUNGSRUNDE_NICHT_GEFUNDEN", "Bewertungsrunde nicht gefunden.");
      return c.json(ergebnis, 200);
    })
    /** Gibt alle offenen Entwürfe der Runde gemeinsam frei (anderer Akteur als der Ersteller der Runde). */
    .post("/:id/freigeben", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const ergebnis = await schreibe(db, c, (tx, protokoll) => gibRundeFrei(tx, protokoll, id));
      return c.json(ergebnis, 200);
    })
    .post("/:id/verwerfen", pruefe("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const nachher = await schreibe(db, c, (tx, protokoll) => verwirfRunde(tx, protokoll, id));
      return c.json(nachher, 200);
    });
}
