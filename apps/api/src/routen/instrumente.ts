import { pruefeFonds } from "../fonds-pruefung";
import { fondsAnApi } from "../fonds-vertrag";
import { portfolioAnApi } from "../portfolio-vertrag";
import { pruefePortfolio } from "../portfolio-pruefung";
import { Hono } from "hono";
import { z } from "zod";
import { instrumentArt, type Db } from "@carraway/db";
import { fehlerAntwort } from "../fehler";
import { aendereInstrument, ladeInstrument, ladeInstrumentUebersicht, legeInstrumentAn } from "../instrumente/instrumente";
import { storniereAusuebung, uebeOptionsscheineAus } from "../instrumente/optionsschein";
import { aendereTranche, erfuelleTranche, legeTrancheAn } from "../instrumente/tranchen-schreiben";
import { ladeTranchenMitStand } from "../instrumente/tranchen";
import { ladeVorgaenge } from "../instrumente/zustand";
import { pruefeNeueWerte } from "../felder/werte";
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
const abschlagEingabe = z.string().regex(/^0(\.\d{1,6})?$/, "Discount as a fraction from 0 to below 1 with at most six decimal places expected");
/** Ganze Zahl von Anteilen größer als null. */
const anzahlEingabe = z.string().regex(/^[1-9]\d{0,17}$/, "Whole number greater than zero expected");
/** Ausübungspreis je Anteil von null an mit höchstens vier Nachkommastellen. */
const preisEingabe = z.string().regex(/^\d{1,14}(\.\d{1,4})?$/, "Price of zero or more with at most four decimal places expected");
const optionsscheinFelder = {
  optionsscheinAnzahl: anzahlEingabe.nullable().optional(),
  ausuebungspreis: preisEingabe.nullable().optional(),
  ausgabeAm: z.iso.date().nullable().optional(),
  laufzeitBis: z.iso.date().nullable().optional(),
};

const neuesInstrument = z.object({
  art,
  bezeichnung: bezeichnung.optional(),
  rundeId: z.uuid().nullable().optional(),
  anteilsklasseId: z.uuid().nullable().optional(),
  felder: felderEingabe,
  wandlungsabschlag: abschlagEingabe.nullable().optional(),
  bewertungsobergrenze: betragEingabe.nullable().optional(),
  zinsenWandeln: z.boolean().nullable().optional(),
  ...optionsscheinFelder,
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
    ...optionsscheinFelder,
  })
  .refine(mindestensEins, MINDESTENS_EIN_FELD);

/** Neue Route nach den Konventionen der englischen API (`docs/api-glossar.md`); `amount` nur bei abweichender Währung der Beteiligung (in der Fondswährung). */
const neueAusuebung = z.object({ date: z.iso.date(), shares: anzahlEingabe, amount: betragEingabe.optional(), note: optionalerText(2000) });

/** Storno einer Ausübung als Ganzes. */
const ausuebungStorno = z.object({ reason: textEingabe(500) });
const ausuebungParam = z.object({ id: z.uuid(), exerciseId: z.uuid() });

const neueTranche = z.object({
  bezeichnung: textEingabe(300),
  betrag: betragEingabe,
  bedingung: optionalerText(2000),
  geplantAm: z.iso.date().nullable().optional(),
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
    .get("/instruments", pruefePortfolio("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const daten = await lese(db, (tx) => ladeInstrumentUebersicht(tx, id));
      if (!daten) return fehlerAntwort(c, 404, "investment_not_found", "Investment not found.");
      return c.json(portfolioAnApi({ daten }), 200);
    })
    .post("/instruments", pruefePortfolio("param", idParam), pruefePortfolio("json", neuesInstrument), async (c) => {
      const { id } = c.req.valid("param");
      const e = c.req.valid("json");
      const neu = await schreibe(db, c, async (tx, protokoll) => {
        const felder = await pruefeNeueWerte(tx, c, "instrument", e.felder);
        const zeile = await legeInstrumentAn(tx, protokoll, id, { ...e, felder });
        return (await ladeInstrumentUebersicht(tx, id))?.find((i) => i.id === zeile.id);
      });
      return c.json(portfolioAnApi(neu), 201);
    });
}

/** Mount unter `/instrumente`. */
export function instrumentRouten(db: Db) {
  return new Hono()
    .get("/:id", pruefePortfolio("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const eintrag = await lese(db, async (tx) => {
        const i = await ladeInstrument(tx, id);
        return (await ladeInstrumentUebersicht(tx, i.beteiligungId))?.find((x) => x.id === id) ?? null;
      });
      return c.json(portfolioAnApi(eintrag), 200);
    })
    .patch("/:id", pruefePortfolio("param", idParam), pruefePortfolio("json", instrumentAenderung), async (c) => {
      const { id } = c.req.valid("param");
      const e = c.req.valid("json");
      const nachher = await schreibe(db, c, async (tx, protokoll) => {
        const zeile = await aendereInstrument(tx, protokoll, c, id, e);
        return (await ladeInstrumentUebersicht(tx, zeile.beteiligungId))?.find((x) => x.id === id);
      });
      return c.json(portfolioAnApi(nachher), 200);
    })
    /** Ausübung von Optionsscheinen: Zusage und Auszahlung des Ausübungsbetrags auf dem Instrument, die Anteile stehen ab dem Datum in der Kapitaltabelle. */
    .post("/:id/exercises", pruefePortfolio("param", idParam), pruefePortfolio("json", neueAusuebung), async (c) => {
      const { id } = c.req.valid("param");
      const e = c.req.valid("json");
      const ergebnis = await schreibe(db, c, async (tx, protokoll) => {
        const aus = await uebeOptionsscheineAus(tx, protokoll, id, { datum: e.date, anzahl: e.shares, betrag: e.amount, bemerkung: e.note });
        const i = await ladeInstrument(tx, id);
        const a = aus.ausuebung;
        return {
          exercise: { id: a.id, instrumentId: a.instrumentId, date: a.datum, shares: a.anzahl, pricePerShare: a.preisJeAnteil, amount: a.betrag, commitmentTransactionId: a.zusageVorgangId, disbursementTransactionId: a.auszahlungVorgangId, note: a.bemerkung },
          remainingWarrants: aus.offenDanach,
          steps: portfolioAnApi(aus.schritte),
          instrument: portfolioAnApi((await ladeInstrumentUebersicht(tx, i.beteiligungId))?.find((x) => x.id === id) ?? null),
        };
      });
      return c.json(ergebnis, 201);
    })
    /** Storno einer Ausübung als Ganzes: Zusage und Auszahlung per Storno-Vorgang, die Anteile verschwinden aus der Kapitaltabelle. */
    .post("/:id/exercises/:exerciseId/reverse", pruefePortfolio("param", ausuebungParam), pruefePortfolio("json", ausuebungStorno), async (c) => {
      const { id, exerciseId } = c.req.valid("param");
      const { reason } = c.req.valid("json");
      const ergebnis = await schreibe(db, c, async (tx, protokoll) => {
        const r = await storniereAusuebung(tx, protokoll, id, exerciseId, reason);
        const i = await ladeInstrument(tx, id);
        return {
          exerciseId: r.ausuebung.id,
          reversedAt: r.ausuebung.storniertAm?.toISOString() ?? null,
          reversalTransactionIds: r.stornoVorgangIds,
          instrument: portfolioAnApi((await ladeInstrumentUebersicht(tx, i.beteiligungId))?.find((x) => x.id === id) ?? null),
        };
      });
      return c.json(ergebnis, 201);
    })
    .get("/:id/tranches", pruefePortfolio("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const daten = await lese(db, async (tx) => {
        const i = await ladeInstrument(tx, id);
        return ladeTranchenMitStand(tx, [id], await ladeVorgaenge(tx, i.beteiligungId));
      });
      return c.json(portfolioAnApi({ daten }), 200);
    })
    .post("/:id/tranches", pruefePortfolio("param", idParam), pruefePortfolio("json", neueTranche), async (c) => {
      const { id } = c.req.valid("param");
      const e = c.req.valid("json");
      const ergebnis = await schreibe(db, c, (tx, protokoll) =>
        legeTrancheAn(tx, protokoll, id, { bezeichnung: e.bezeichnung, betrag: e.betrag, bedingung: e.bedingung, geplantAm: e.geplantAm ?? null, zusageErhoehen: e.zusageErhoehen, zusageValuta: e.zusageValuta }),
      );
      return c.json(portfolioAnApi({ ...ergebnis.tranche, zusageVorgang: ergebnis.zusageVorgang }), 201);
    });
}

/** Mount unter `/tranches`. */
export function trancheRouten(db: Db) {
  return new Hono()
    .patch("/:id", pruefeFonds("param", idParam), pruefeFonds("json", trancheAenderung), async (c) => {
      const { id } = c.req.valid("param");
      const { frist, geplantAm, ...rest } = c.req.valid("json");
      const nachher = await schreibe(db, c, (tx, protokoll) => aendereTranche(tx, protokoll, id, { ...rest, geplantAm: geplantAm !== undefined ? geplantAm : frist }));
      return c.json(fondsAnApi(nachher), 200);
    })
    .post("/:id/fulfill", pruefeFonds("param", idParam), pruefeFonds("json", erfuelltEingabe), async (c) => {
      const { id } = c.req.valid("param");
      const { datum, nachweis } = c.req.valid("json");
      const nachher = await schreibe(db, c, (tx, protokoll) => erfuelleTranche(tx, protokoll, id, datum, nachweis));
      return c.json(fondsAnApi(nachher), 200);
    });
}
