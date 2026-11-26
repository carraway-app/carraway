import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { beteiligung, fondsBewegung, type Db } from "@carraway/db";
import { Fachfehler } from "../fehler";
import { bucheLpZahlung } from "../instrumente/lp-zahlung";
import { ladeKapitalstand } from "../instrumente/kapitalstand";
import { bucheVorgang } from "../instrumente/buchen";
import { bucheFondsbewegung, ladeBewegungsaufteilung, ladeGebuchteBewegungsaufteilung, pruefeFondsbewegung, storniereFondsbewegung } from "../instrumente/fondsbewegung";
import { pruefe } from "../pruefung";
import { betragEingabe, heute, idParam, ladeFonds, optionalerText, schreibe, textEingabe } from "../schreiben";
import { lese } from "../zeitlimit";
import { pruefeNeueWerte } from "../felder/werte";
import { betragLokalEingabe, betragLokalMitVorzeichen, betragMitVorzeichen, vorgangFelder } from "./vorgaenge";

/**
 * Einheitliche Erfassung (Etappe 4b): `POST /fonds/:id/buchungen` nimmt alle von Hand buchbaren Arten in einer typisierten Union.
 * Vorgänge einer Beteiligung laufen durch dieselbe Funktion wie `POST /beteiligungen/:id/vorgaenge` (`bucheVorgang`), Abrufe und
 * Ausschüttungen des Fonds durch `bucheFondsbewegung`. Zinslauf, Wandlung, Verkauf und Insolvenz bleiben eigene Wege; ihr Ergebnis steht
 * im Journal (`GET /fonds/:id/journal`).
 */

const valuta = z.iso.date();
const bemerkung = optionalerText(1000);
const fondsbewegungVorschau = z.object({ art: z.enum(["abruf", "ausschuettung"]), valuta, faelligAm: valuta.optional(), betrag: betragEingabe });

const instrumentId = z.uuid().optional();
/** Finanzierungsrunde des Unternehmens; ohne Angabe die Runde des Instruments, `null` = keiner Runde. */
const rundeId = z.uuid().nullable().optional();

export const neueBuchung = z.discriminatedUnion("typ", [
  z.object({ typ: z.literal("zusage"), beteiligungId: z.uuid(), valuta, betrag: betragEingabe.optional(), betragLokal: betragLokalEingabe, bemerkung, instrumentId, rundeId, felder: vorgangFelder }),
  z.object({ typ: z.literal("auszahlung"), beteiligungId: z.uuid(), valuta, betrag: betragEingabe.optional(), betragLokal: betragLokalEingabe, bemerkung, instrumentId, rundeId, trancheId: z.uuid().optional(), meilensteinId: z.uuid().optional(), felder: vorgangFelder }),
  z.object({ typ: z.literal("rueckfluss"), beteiligungId: z.uuid(), valuta, betrag: betragEingabe.optional(), betragLokal: betragLokalEingabe, bemerkung, instrumentId, rundeId, felder: vorgangFelder }),
  z.object({ typ: z.literal("tilgung"), beteiligungId: z.uuid(), valuta, betrag: betragEingabe.optional(), betragLokal: betragLokalEingabe, bemerkung, instrumentId, rundeId, felder: vorgangFelder }),
  z.object({ typ: z.literal("zinszahlung"), beteiligungId: z.uuid(), valuta, betrag: betragEingabe.optional(), betragLokal: betragLokalEingabe, bemerkung, instrumentId, rundeId, beglichenVorgangId: z.uuid().optional(), felder: vorgangFelder }),
  z.object({ typ: z.literal("dividende"), beteiligungId: z.uuid(), valuta, betrag: betragEingabe.optional(), betragLokal: betragLokalEingabe, bemerkung, instrumentId, rundeId, felder: vorgangFelder }),
  z.object({ typ: z.literal("wertberichtigung"), beteiligungId: z.uuid(), valuta, betrag: betragMitVorzeichen.optional(), betragLokal: betragLokalMitVorzeichen, bemerkung, instrumentId, rundeId, felder: vorgangFelder }),
  fondsbewegungVorschau.extend({ typ: z.literal("fondsbewegung"), bemerkung }),
]);

const zahlungsEingabe = z.object({ organisationId: z.uuid(), betrag: betragEingabe, valuta, belegreferenz: optionalerText(250) });
const zahlungsStorno = z.object({ zahlungId: z.uuid(), grund: textEingabe(500), valuta });
const stornoEingabe = z.object({ grund: textEingabe(500), valuta: z.iso.date().optional() });

/** Mount unter `/fonds`. */
export function fondsBuchungRouten(db: Db) {
  return new Hono().get("/:id/fondsbewegungen/vorschau", pruefe("param", idParam, { query: fondsbewegungVorschau }), pruefe("query", fondsbewegungVorschau), async (c) => {
    const { id } = c.req.valid("param");
    const eingabe = c.req.valid("query");
    const antwort = await lese(db, async (tx) => {
      const f = await ladeFonds(tx, id);
      const betrag = await pruefeFondsbewegung(tx, f, eingabe);
      return { ...eingabe, fondsId: f.id, betrag, waehrung: f.waehrung, ...await ladeBewegungsaufteilung(tx, f.id, betrag, eingabe.valuta) };
    });
    return c.json(antwort, 200);
  }).post("/:id/buchungen", pruefe("param", idParam), pruefe("json", neueBuchung), async (c) => {
    const { id } = c.req.valid("param");
    const eingabe = c.req.valid("json");
    if (eingabe.typ === "fondsbewegung") {
      const bewegung = await schreibe(db, c, async (tx, protokoll) => {
        await ladeFonds(tx, id);
        return bucheFondsbewegung(tx, protokoll, id, eingabe);
      });
      return c.json({ typ: "fondsbewegung" as const, bewegung }, 201);
    }
    const { typ, beteiligungId, ...rest } = eingabe;
    const ergebnis = await schreibe(db, c, async (tx, protokoll) => {
      await ladeFonds(tx, id);
      const [b] = await tx.select({ fondsId: beteiligung.fondsId }).from(beteiligung).where(eq(beteiligung.id, beteiligungId));
      if (!b) throw new Fachfehler(404, "BETEILIGUNG_NICHT_GEFUNDEN", "Beteiligung nicht gefunden.");
      if (b.fondsId !== id) throw new Fachfehler(409, "BETEILIGUNG_NICHT_IM_FONDS", "Die Beteiligung gehört zu einem anderen Fonds.");
      const { felder, ...vorgangRest } = rest;
      return bucheVorgang(tx, protokoll, beteiligungId, { art: typ, ...vorgangRest, felder: await pruefeNeueWerte(tx, c, "vorgang", felder) });
    });
    return c.json({ typ, vorgang: ergebnis.vorgang, buchwert: ergebnis.buchwert }, 201);
  });
}

/** Mount unter `/fondsbewegungen`: Detail und Storno einer Fondsbewegung. */
export function fondsbewegungRouten(db: Db) {
  return new Hono().get("/:id", pruefe("param", idParam), async (c) => {
    const { id } = c.req.valid("param");
    const antwort = await lese(db, async (tx) => {
      const [bewegung] = await tx.select().from(fondsBewegung).where(eq(fondsBewegung.id, id));
      if (!bewegung) throw new Fachfehler(404, "FONDSBEWEGUNG_NICHT_GEFUNDEN", "Fondsbewegung nicht gefunden.");
      const { fondsId, art, valuta, betrag, bemerkung, storniertBewegungId } = bewegung;
      const f = await ladeFonds(tx, fondsId);
      const [storno] = await tx.select({ id: fondsBewegung.id }).from(fondsBewegung).where(eq(fondsBewegung.storniertBewegungId, id));
      const aufteilung = await ladeGebuchteBewegungsaufteilung(tx, bewegung);
      return { id: bewegung.id, fondsId, art, valuta, faelligAm: art === "abruf" ? bewegung.faelligAm ?? valuta : null, betrag, bemerkung, storniertBewegungId, storniertDurchId: storno?.id ?? null, waehrung: f.waehrung, ...aufteilung };
    });
    return c.json(antwort, 200);
  }).get("/:id/zahlungen", pruefe("param", idParam), pruefe("query", z.object({ stichtag: valuta.optional(), stand: z.iso.datetime({ offset: true }).optional() })), async (c) => {
    const { id } = c.req.valid("param");
    const { stichtag = heute(), stand } = c.req.valid("query");
    const daten = await lese(db, async (tx) => {
      const [b] = await tx.select().from(fondsBewegung).where(eq(fondsBewegung.id, id));
      if (!b) throw new Fachfehler(404, "ABRUF_NICHT_GEFUNDEN", "Kapitalabruf nicht gefunden.");
      const kapital = await ladeKapitalstand(tx, b.fondsId, stichtag, stand, id);
      return { stichtag, faelligAm: b.faelligAm ?? b.valuta, positionen: kapital.positionen, zahlungen: kapital.zahlungen };
    });
    return c.json(daten, 200);
  }).post("/:id/zahlungen", pruefe("param", idParam), pruefe("json", zahlungsEingabe), async (c) => {
    const { id } = c.req.valid("param");
    const eingabe = c.req.valid("json");
    return c.json(await schreibe(db, c, (tx, protokoll) => bucheLpZahlung(tx, protokoll, id, eingabe)), 201);
  }).post("/:id/zahlungen/storno", pruefe("param", idParam), pruefe("json", zahlungsStorno), async (c) => {
    const { id } = c.req.valid("param");
    const eingabe = c.req.valid("json");
    return c.json(await schreibe(db, c, (tx, protokoll) => bucheLpZahlung(tx, protokoll, id, eingabe)), 201);
  }).post("/:id/storno", pruefe("param", idParam), pruefe("json", stornoEingabe), async (c) => {
    const { id } = c.req.valid("param");
    const { grund, valuta: gewuenschteValuta } = c.req.valid("json");
    const ergebnis = await schreibe(db, c, (tx, protokoll) => storniereFondsbewegung(tx, protokoll, id, grund, gewuenschteValuta));
    return c.json(ergebnis, 201);
  });
}
