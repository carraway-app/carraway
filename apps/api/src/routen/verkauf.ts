import { pruefeFonds } from "../fonds-pruefung";
import { fondsAnApi } from "../fonds-vertrag";
import { portfolioAnApi } from "../portfolio-vertrag";
import { pruefePortfolio } from "../portfolio-pruefung";
import { and, desc, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { beteiligung, forderung, kaufpreisanpassung, verkauf, vorgang, zinsmethode, type Db } from "@carraway/db";
import { Decimal } from "@carraway/rechenkern";
import { Fachfehler } from "../fehler";
import { setzeBewertung } from "../instrumente/bewertung";
import { hauptinstrumentId } from "../instrumente/hauptinstrument";
import { instrumenteVon, setzeInstrumentStatus } from "../instrumente/instrumente";
import { bucheVerkauf, planeVerkauf, storniereVerkauf } from "../instrumente/verkauf";
import { ladeBuchwertabgang } from "../instrumente/verkaeufe";
import {
  berechneZustand,
  buchwertVon,
  ladeVorgaenge,
  pruefePeriodensperre,
  sperreBeteiligung,
  verlangeAktiv,
  vorgaengeDesInstruments,
} from "../instrumente/zustand";
import { betragEingabe, heute, idParam, schreibe, textEingabe } from "../schreiben";
import { lese } from "../zeitlimit";
import { betragMitVorzeichen, satzEingabe } from "./vorgaenge";
import { ordneRundeZu } from "../instrumente/vorgang-runde";

const nichtNegativ = z.string().regex(/^\d{1,16}(\.\d{1,2})?$/, "Amount of zero or more with at most two decimal places expected");
const anteil = z
  .union([z.number(), z.string()])
  .transform(String)
  .refine((w) => /^(0\.\d{1,6}|1(\.0{1,6})?)$/.test(w) && Number(w) > 0, { message: "Share greater than 0 and at most 1 with at most six decimal places expected" });

const verkaufSchema = z
  .object({
    datum: z.iso.date(),
    kaufpreis: nichtNegativ,
    kosten: nichtNegativ.optional(),
    treuhand: z.object({ betrag: betragEingabe, freigabeAm: z.iso.date() }).optional(),
    verkaeuferdarlehen: z
      .object({
        betrag: betragEingabe,
        satz: satzEingabe,
        methode: z.enum(zinsmethode.enumValues),
        faelligAm: z.iso.date(),
        /** Schuldner des Verkäuferdarlehens (meist der Käufer); ohne Angabe das verkaufte Unternehmen. */
        schuldnerOrganisationId: z.uuid().optional(),
      })
      .optional(),
    anteilVerkauft: anteil,
    /** Nur dieses Instrument verkaufen; ohne Angabe die ganze Beteiligung (alle aktiven Instrumente). */
    instrumentId: z.uuid().optional(),
  })
  .superRefine((w, ctx) => {
    if (w.treuhand && w.treuhand.freigabeAm < w.datum) ctx.addIssue({ code: "custom", path: ["treuhand", "freigabeAm"], message: "The release is before the sale date" });
    if (w.verkaeuferdarlehen && w.verkaeuferdarlehen.faelligAm <= w.datum) ctx.addIssue({ code: "custom", path: ["verkaeuferdarlehen", "faelligAm"], message: "The due date must be after the sale date" });
  });

const anpassungSchema = z.object({ datum: z.iso.date(), betrag: betragMitVorzeichen, grund: textEingabe(500), verkaufId: z.uuid().optional() });
const insolvenzSchema = z.object({ datum: z.iso.date(), wertberichtigungAufNull: z.boolean().default(false) });
const erfuelltSchema = z.object({ datum: z.iso.date().optional() });

export function beteiligungVerkaufRouten(db: Db) {
  return new Hono()
    /**
     * Vorschau des Verkaufs: dieselbe Prüfung und Auswertung wie beim Buchen (`ergebnis` ist identisch), schreibt nichts.
     */
    .post("/sale/preview", pruefePortfolio("param", idParam), pruefePortfolio("json", verkaufSchema), async (c) => {
      const { id } = c.req.valid("param");
      const e = c.req.valid("json");
      const antwort = await lese(db, async (tx) => {
        const [b] = await tx.select().from(beteiligung).where(eq(beteiligung.id, id));
        if (!b) throw new Fachfehler(404, "investment_not_found", "Investment not found.");
        const plan = await planeVerkauf(tx, b, e);
        const bleibtAktiv = plan.instrument ? (await instrumenteVon(tx, id)).some((i) => i.status === "aktiv" && i.id !== plan.instrument!.id) : false;
        return {
          vorschau: true as const,
          ergebnis: plan.auswertung,
          forderung: e.treuhand ? { art: "treuhand", betrag: plan.treuhand.toFixed(2), faelligAm: e.treuhand.freigabeAm } : null,
          verkaeuferdarlehen: e.verkaeuferdarlehen ? { betrag: plan.verkaeuferdarlehen.toFixed(2), schuldnerOrganisationId: plan.schuldner } : null,
          status: plan.voll && !bleibtAktiv ? ("exit" as const) : b.status,
        };
      });
      return c.json(portfolioAnApi(antwort), 200);
    })
    /**
     * Verkauf. Buchwert = Investiert + kapitalisierte Zinsen − Tilgungen − Wertberichtigungen − Abgang durch Verkäufe.
     * Ergebnis = Kaufpreis − Kosten − Buchwert × Anteil. Gebucht werden der Barzufluss als Rückfluss, eine Forderung für den
     * Treuhandbetrag und ein neues Darlehen für das Verkäuferdarlehen. Bewertung: ganz = 0, anteilig = Rest.
     */
    .post("/sale", pruefePortfolio("param", idParam), pruefePortfolio("json", verkaufSchema), async (c) => {
      const { id } = c.req.valid("param");
      const e = c.req.valid("json");
      const ergebnis = await schreibe(db, c, (tx, protokoll) => bucheVerkauf(tx, protokoll, id, e));
      return c.json(portfolioAnApi(ergebnis), 201);
    })
    /** Kaufpreisanpassung (plus oder minus) nach einem Verkauf: als Rückfluss gebucht. */
    .post("/purchase-price-adjustment", pruefePortfolio("param", idParam), pruefePortfolio("json", anpassungSchema), async (c) => {
      const { id } = c.req.valid("param");
      const e = c.req.valid("json");
      const ergebnis = await schreibe(db, c, async (tx, protokoll) => {
        const b = await sperreBeteiligung(tx, id);
        await pruefePeriodensperre(tx, b.fondsId, e.datum);
        const verkaeufe = await tx.select().from(verkauf).where(and(eq(verkauf.beteiligungId, id), isNull(verkauf.storniertAm))).orderBy(desc(verkauf.datum), desc(verkauf.erfasstAm));
        const ziel = e.verkaufId ? verkaeufe.find((v) => v.id === e.verkaufId) : verkaeufe[0];
        if (!ziel) throw new Fachfehler(409, "no_sale", "There is no sale for this investment that could be adjusted.");
        const betrag = new Decimal(e.betrag).toFixed(2);
        // Auf das Instrument des Verkaufs: das verkaufte, sonst das des Barzuflusses (Verkauf der ganzen Beteiligung), sonst das Hauptinstrument.
        const [barzufluss] = ziel.rueckflussVorgangId ? await tx.select({ instrumentId: vorgang.instrumentId }).from(vorgang).where(eq(vorgang.id, ziel.rueckflussVorgangId)) : [];
        const anpassungInstrument = ziel.instrumentId ?? barzufluss?.instrumentId ?? (await hauptinstrumentId(tx, id));
        const [v] = await tx.insert(vorgang).values({ beteiligungId: id, instrumentId: anpassungInstrument, art: "rueckfluss", valuta: e.datum, betrag, bemerkung: `Kaufpreisanpassung: ${e.grund}` }).returning();
        await protokoll("anlegen", "vorgang", v!.id, null, v);
        await ordneRundeZu(tx, protokoll, v!);
        const [zeile] = await tx.insert(kaufpreisanpassung).values({ verkaufId: ziel.id, datum: e.datum, betrag, grund: e.grund, vorgangId: v!.id }).returning();
        await protokoll("anlegen", "kaufpreisanpassung", zeile!.id, null, zeile);
        return { kaufpreisanpassung: zeile!, vorgang: v! };
      });
      return c.json(portfolioAnApi(ergebnis), 201);
    })
    /** Insolvenz: Status insolvent, Bewertung 0 ab dem Datum, optional Wertberichtigung auf null. */
    .post("/insolvency", pruefePortfolio("param", idParam), pruefePortfolio("json", insolvenzSchema), async (c) => {
      const { id } = c.req.valid("param");
      const e = c.req.valid("json");
      const ergebnis = await schreibe(db, c, async (tx, protokoll) => {
        const b = await sperreBeteiligung(tx, id);
        verlangeAktiv(b);
        await pruefePeriodensperre(tx, b.fondsId, e.datum);
        const vorgaenge = await ladeVorgaenge(tx, id);
        const z = berechneZustand(vorgaenge, await ladeBuchwertabgang(tx, id));
        let rest = buchwertVon(z).wert;
        const aktive = (await instrumenteVon(tx, id)).filter((i) => i.status === "aktiv");
        // Wertberichtigung auf null je aktivem Instrument in Höhe seines Buchwerts, zusammen höchstens der Buchwert der Beteiligung (Teilverkäufe mindern ihn).
        const berichtigungen: (typeof vorgang.$inferSelect)[] = [];
        if (e.wertberichtigungAufNull) {
          for (const i of aktive) {
            const eigener = buchwertVon(berechneZustand(vorgaengeDesInstruments(vorgaenge, i.id))).wert;
            const betrag = Decimal.min(eigener, rest);
            if (!betrag.greaterThan(0)) continue;
            const [wb] = await tx
              .insert(vorgang)
              .values({ beteiligungId: id, instrumentId: i.id, art: "wertberichtigung" as const, valuta: e.datum, betrag: betrag.toFixed(2), bemerkung: "Insolvenz: Wertberichtigung auf null" })
              .returning();
            await protokoll("anlegen", "vorgang", wb!.id, null, wb);
            await ordneRundeZu(tx, protokoll, wb!);
            berichtigungen.push(wb!);
            rest = rest.minus(betrag);
          }
        }
        await setzeBewertung(tx, protokoll, b, e.datum, "0.00", "sonstige", "Insolvenz: Bewertung null");
        for (const i of aktive) await setzeInstrumentStatus(tx, protokoll, i, "abgeschrieben");
        const [nachher] = await tx.update(beteiligung).set({ status: "insolvent" }).where(eq(beteiligung.id, id)).returning();
        await protokoll("insolvenz", "beteiligung", id, b, { ...nachher, insolvenzDatum: e.datum });
        return { beteiligung: nachher!, wertberichtigung: berichtigungen[0] ?? null, wertberichtigungen: berichtigungen };
      });
      return c.json(portfolioAnApi(ergebnis), 200);
    });
}

export function forderungRouten(db: Db) {
  return new Hono().post("/:id/settle", pruefeFonds("param", idParam), pruefeFonds("json", erfuelltSchema), async (c) => {
    const { id } = c.req.valid("param");
    const { datum } = c.req.valid("json");
    const ergebnis = await schreibe(db, c, async (tx, protokoll) => {
      const [f] = await tx.select().from(forderung).where(eq(forderung.id, id));
      if (!f) throw new Fachfehler(404, "receivable_not_found", "Receivable not found.");
      const b = await sperreBeteiligung(tx, f.beteiligungId);
      const [vorher] = await tx.select().from(forderung).where(eq(forderung.id, id)).for("update");
      if (vorher?.storniertAm) throw new Fachfehler(409, "receivable_reversed", "The sale of the receivable was reversed.");
      if (vorher?.erfuelltAm) throw new Fachfehler(409, "receivable_settled", "The receivable is already settled.");
      const valuta = datum ?? heute();
      await pruefePeriodensperre(tx, b.fondsId, valuta);
      const [v] = await tx
        .insert(vorgang)
        .values({ beteiligungId: f.beteiligungId, instrumentId: f.instrumentId ?? (await hauptinstrumentId(tx, f.beteiligungId)), art: "rueckfluss", valuta, betrag: f.betrag, bemerkung: `Forderung ${f.art} erfüllt` })
        .returning();
      await protokoll("anlegen", "vorgang", v!.id, null, v);
      await ordneRundeZu(tx, protokoll, v!);
      const [nachher] = await tx.update(forderung).set({ erfuelltAm: valuta, vorgangId: v!.id }).where(eq(forderung.id, id)).returning();
      await protokoll("erfuellen", "forderung", id, vorher, nachher);
      return { forderung: nachher!, vorgang: v! };
    });
    return c.json(fondsAnApi(ergebnis), 200);
  });
}

const stornoSchema = z.object({ grund: textEingabe(500) });

/** Storno eines ganzen Verkaufs unter `/verkaeufe`. */
export function verkaufRouten(db: Db) {
  return new Hono().post("/:id/reverse", pruefePortfolio("param", idParam), pruefePortfolio("json", stornoSchema), async (c) => {
    const { id } = c.req.valid("param");
    const { grund } = c.req.valid("json");
    const ergebnis = await schreibe(db, c, (tx, protokoll) => storniereVerkauf(tx, protokoll, id, grund));
    return c.json(portfolioAnApi(ergebnis), 201);
  });
}
