import { pruefeFonds } from "../fonds-pruefung";
import { fondsAnApi } from "../fonds-vertrag";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { beteiligung, fondsBewegung, type Db } from "@carraway/db";
import { insDeutsche, insEnglische } from "../buchhaltung/abbildung";
import { buchhaltungsFehler } from "../buchhaltung/fehler";
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
 * Einheitliche Erfassung (Etappe 4b): `POST /funds/:id/postings` nimmt alle von Hand buchbaren Arten in einer typisierten Union.
 * Vorgänge einer Beteiligung laufen durch dieselbe Funktion wie `POST /investments/:id/transactions` (`bucheVorgang`), Abrufe und
 * Ausschüttungen des Fonds durch `bucheFondsbewegung`. Zinslauf, Wandlung, Verkauf und Insolvenz bleiben eigene Wege; ihr Ergebnis steht
 * im Journal (`GET /funds/:id/journal`).
 */

const valuta = z.iso.date();
const bemerkung = optionalerText(1000);
const fondsbewegungVorschau = z.object({ type: z.enum(["capital_call", "distribution"]), valueDate: valuta, dueDate: valuta.optional(), amount: betragEingabe });

const instrumentId = z.uuid().optional();
/** Finanzierungsrunde des Unternehmens; ohne Angabe die Runde des Instruments, `null` = keiner Runde. */
const rundeId = z.uuid().nullable().optional();

export const neueBuchung = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("commitment"), investmentId: z.uuid(), valueDate: valuta, amount: betragEingabe.optional(), localAmount: betragLokalEingabe, remark: bemerkung, instrumentId, roundId: rundeId, fields: vorgangFelder }),
  z.strictObject({ kind: z.literal("disbursement"), investmentId: z.uuid(), valueDate: valuta, amount: betragEingabe.optional(), localAmount: betragLokalEingabe, remark: bemerkung, instrumentId, roundId: rundeId, trancheId: z.uuid().optional(), fields: vorgangFelder }),
  z.object({ kind: z.literal("return_flow"), investmentId: z.uuid(), valueDate: valuta, amount: betragEingabe.optional(), localAmount: betragLokalEingabe, remark: bemerkung, instrumentId, roundId: rundeId, fields: vorgangFelder }),
  z.object({ kind: z.literal("repayment"), investmentId: z.uuid(), valueDate: valuta, amount: betragEingabe.optional(), localAmount: betragLokalEingabe, remark: bemerkung, instrumentId, roundId: rundeId, fields: vorgangFelder }),
  z.object({ kind: z.literal("interest_payment"), investmentId: z.uuid(), valueDate: valuta, amount: betragEingabe.optional(), localAmount: betragLokalEingabe, remark: bemerkung, instrumentId, roundId: rundeId, settledTransactionId: z.uuid().optional(), fields: vorgangFelder }),
  z.object({ kind: z.literal("dividend"), investmentId: z.uuid(), valueDate: valuta, amount: betragEingabe.optional(), localAmount: betragLokalEingabe, remark: bemerkung, instrumentId, roundId: rundeId, fields: vorgangFelder }),
  z.object({ kind: z.literal("impairment"), investmentId: z.uuid(), valueDate: valuta, amount: betragMitVorzeichen.optional(), localAmount: betragLokalMitVorzeichen, remark: bemerkung, instrumentId, roundId: rundeId, fields: vorgangFelder }),
  fondsbewegungVorschau.extend({ kind: z.literal("fund_posting"), remark: bemerkung }),
]);

const zahlungsEingabe = z.object({ organisationId: z.uuid(), betrag: betragEingabe, valuta, belegreferenz: optionalerText(250) });
const zahlungsStorno = z.object({ zahlungId: z.uuid(), grund: textEingabe(500), valuta });
const stornoEingabe = z.object({ grund: textEingabe(500), valuta: z.iso.date().optional() });

/** Mount unter `/funds`. */
export function fondsBuchungRouten(db: Db) {
  return new Hono().onError(buchhaltungsFehler).get("/:id/fund-movements/preview", pruefe("param", idParam, { query: fondsbewegungVorschau }), pruefe("query", fondsbewegungVorschau), async (c) => {
    const { id } = c.req.valid("param");
    const eingabe = insDeutsche(c.req.valid("query"));
    const antwort = await lese(db, async (tx) => {
      const f = await ladeFonds(tx, id);
      const betrag = await pruefeFondsbewegung(tx, f, eingabe);
      return { ...eingabe, fondsId: f.id, betrag, waehrung: f.waehrung, ...await ladeBewegungsaufteilung(tx, f.id, betrag, eingabe.valuta) };
    });
    return c.json(insEnglische(antwort), 200);
  }).post("/:id/postings", pruefe("param", idParam), pruefe("json", neueBuchung), async (c) => {
    const { id } = c.req.valid("param");
    const eingabe = insDeutsche(c.req.valid("json"));
    if (eingabe.typ === "fondsbewegung") {
      const bewegung = await schreibe(db, c, async (tx, protokoll) => {
        await ladeFonds(tx, id);
        return bucheFondsbewegung(tx, protokoll, id, eingabe);
      });
      return c.json(insEnglische({ typ: "fondsbewegung" as const, bewegung }), 201);
    }
    const { typ, beteiligungId, ...rest } = eingabe;
    const ergebnis = await schreibe(db, c, async (tx, protokoll) => {
      await ladeFonds(tx, id);
      const [b] = await tx.select({ fondsId: beteiligung.fondsId }).from(beteiligung).where(eq(beteiligung.id, beteiligungId));
      if (!b) throw new Fachfehler(404, "investment_not_found", "Investment not found.");
      if (b.fondsId !== id) throw new Fachfehler(409, "investment_not_in_fund", "The investment belongs to a different fund.");
      const { felder, ...vorgangRest } = rest;
      return bucheVorgang(tx, protokoll, beteiligungId, { art: typ, ...vorgangRest, felder: await pruefeNeueWerte(tx, c, "vorgang", felder) });
    });
    const { meilensteinId: _alterName, ...vorgang } = ergebnis.vorgang;
    return c.json(insEnglische({ typ, vorgang, buchwert: ergebnis.buchwert }), 201);
  });
}

/** Mount unter `/fund-movements`: Detail und Storno einer Fondsbewegung. */
export function fondsbewegungRouten(db: Db) {
  return new Hono().get("/:id", pruefeFonds("param", idParam), async (c) => {
    const { id } = c.req.valid("param");
    const antwort = await lese(db, async (tx) => {
      const [bewegung] = await tx.select().from(fondsBewegung).where(eq(fondsBewegung.id, id));
      if (!bewegung) throw new Fachfehler(404, "fund_movement_not_found", "Fund movement not found.");
      const { fondsId, art, valuta, betrag, bemerkung, storniertBewegungId } = bewegung;
      const f = await ladeFonds(tx, fondsId);
      const [storno] = await tx.select({ id: fondsBewegung.id }).from(fondsBewegung).where(eq(fondsBewegung.storniertBewegungId, id));
      const aufteilung = await ladeGebuchteBewegungsaufteilung(tx, bewegung);
      return { id: bewegung.id, fondsId, art, valuta, faelligAm: art === "abruf" ? bewegung.faelligAm ?? valuta : null, betrag, bemerkung, storniertBewegungId, storniertDurchId: storno?.id ?? null, waehrung: f.waehrung, ...aufteilung };
    });
    return c.json(fondsAnApi(antwort), 200);
  }).get("/:id/payments", pruefeFonds("param", idParam), pruefeFonds("query", z.object({ stichtag: valuta.optional(), stand: z.iso.datetime({ offset: true }).optional() })), async (c) => {
    const { id } = c.req.valid("param");
    const { stichtag = heute(), stand } = c.req.valid("query");
    const daten = await lese(db, async (tx) => {
      const [b] = await tx.select().from(fondsBewegung).where(eq(fondsBewegung.id, id));
      if (!b) throw new Fachfehler(404, "call_not_found", "Capital call not found.");
      const kapital = await ladeKapitalstand(tx, b.fondsId, stichtag, stand, id);
      return { stichtag, faelligAm: b.faelligAm ?? b.valuta, positionen: kapital.positionen, zahlungen: kapital.zahlungen };
    });
    return c.json(fondsAnApi(daten), 200);
  }).post("/:id/payments", pruefeFonds("param", idParam), pruefeFonds("json", zahlungsEingabe), async (c) => {
    const { id } = c.req.valid("param");
    const eingabe = c.req.valid("json");
    return c.json(fondsAnApi(await schreibe(db, c, (tx, protokoll) => bucheLpZahlung(tx, protokoll, id, eingabe))), 201);
  }).post("/:id/payments/reverse", pruefeFonds("param", idParam), pruefeFonds("json", zahlungsStorno), async (c) => {
    const { id } = c.req.valid("param");
    const eingabe = c.req.valid("json");
    return c.json(fondsAnApi(await schreibe(db, c, (tx, protokoll) => bucheLpZahlung(tx, protokoll, id, eingabe))), 201);
  }).post("/:id/reverse", pruefeFonds("param", idParam), pruefeFonds("json", stornoEingabe), async (c) => {
    const { id } = c.req.valid("param");
    const { grund, valuta: gewuenschteValuta } = c.req.valid("json");
    const ergebnis = await schreibe(db, c, (tx, protokoll) => storniereFondsbewegung(tx, protokoll, id, grund, gewuenschteValuta));
    return c.json(fondsAnApi(ergebnis), 201);
  });
}
