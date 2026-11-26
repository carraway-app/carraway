import { and, desc, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { beteiligung, darlehenKondition, forderung, kaufpreisanpassung, verkauf, vorgang, zinsmethode, type Db } from "@carraway/db";
import { Decimal } from "@carraway/rechenkern";
import { Fachfehler } from "../fehler";
import { letzteBewertung, setzeBewertung } from "../instrumente/bewertung";
import { hauptinstrumentId, legeHauptinstrumentAn } from "../instrumente/hauptinstrument";
import { instrumenteVon, legeInstrumentAn, setzeInstrumentStatus } from "../instrumente/instrumente";
import { planeVerkauf, storniereVerkauf, VERKAEUFERDARLEHEN_BEGRUENDUNG } from "../instrumente/verkauf";
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
import { pruefe } from "../pruefung";
import { betragEingabe, heute, idParam, schreibe, textEingabe } from "../schreiben";
import { alsJson } from "../instrumente/wandlung";
import { lese } from "../zeitlimit";
import { betragMitVorzeichen, satzEingabe } from "./vorgaenge";
import { ordneRundeZu } from "../instrumente/vorgang-runde";

const nichtNegativ = z.string().regex(/^\d{1,16}(\.\d{1,2})?$/, "Betrag von null an mit höchstens zwei Nachkommastellen erwartet");
const anteil = z
  .union([z.number(), z.string()])
  .transform(String)
  .refine((w) => /^(0\.\d{1,6}|1(\.0{1,6})?)$/.test(w) && Number(w) > 0, { message: "Anteil größer 0 und höchstens 1 mit höchstens sechs Nachkommastellen erwartet" });

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
    if (w.treuhand && w.treuhand.freigabeAm < w.datum) ctx.addIssue({ code: "custom", path: ["treuhand", "freigabeAm"], message: "Die Freigabe liegt vor dem Verkaufsdatum" });
    if (w.verkaeuferdarlehen && w.verkaeuferdarlehen.faelligAm <= w.datum) ctx.addIssue({ code: "custom", path: ["verkaeuferdarlehen", "faelligAm"], message: "Die Fälligkeit muss nach dem Verkaufsdatum liegen" });
  });

const anpassungSchema = z.object({ datum: z.iso.date(), betrag: betragMitVorzeichen, grund: textEingabe(500), verkaufId: z.uuid().optional() });
const insolvenzSchema = z.object({ datum: z.iso.date(), wertberichtigungAufNull: z.boolean().default(false) });
const erfuelltSchema = z.object({ datum: z.iso.date().optional() });

export function beteiligungVerkaufRouten(db: Db) {
  return new Hono()
    /**
     * Vorschau des Verkaufs: dieselbe Prüfung und Auswertung wie beim Buchen (`ergebnis` ist identisch), schreibt nichts.
     */
    .post("/verkauf/vorschau", pruefe("param", idParam), pruefe("json", verkaufSchema), async (c) => {
      const { id } = c.req.valid("param");
      const e = c.req.valid("json");
      const antwort = await lese(db, async (tx) => {
        const [b] = await tx.select().from(beteiligung).where(eq(beteiligung.id, id));
        if (!b) throw new Fachfehler(404, "BETEILIGUNG_NICHT_GEFUNDEN", "Beteiligung nicht gefunden.");
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
      return c.json(antwort, 200);
    })
    /**
     * Verkauf. Buchwert = Investiert + kapitalisierte Zinsen − Tilgungen − Wertberichtigungen − Abgang früherer Teilverkäufe.
     * Ergebnis = Kaufpreis − Kosten − Buchwert × Anteil. Gebucht werden der Barzufluss als Rückfluss, eine Forderung für den
     * Treuhandbetrag und ein neues Darlehen für das Verkäuferdarlehen. Bewertung: ganz = 0, anteilig = Rest.
     */
    .post("/verkauf", pruefe("param", idParam), pruefe("json", verkaufSchema), async (c) => {
      const { id } = c.req.valid("param");
      const e = c.req.valid("json");
      const ergebnis = await schreibe(db, c, async (tx, protokoll) => {
        const b = await sperreBeteiligung(tx, id);
        const plan = await planeVerkauf(tx, b, e);
        const { treuhand, verkaeuferdarlehen: vkd, bar, voll, kennung } = plan;
        // Vor allem anderen festhalten, was verkauft wird: die gewählten oder alle aktiven Instrumente (ein neues Verkäuferdarlehen in derselben Beteiligung nicht).
        const verkaufte = plan.instrument ? [plan.instrument] : (await instrumenteVon(tx, id)).filter((i) => i.status === "aktiv");
        const erloesInstrumentId = plan.instrument?.id ?? (await hauptinstrumentId(tx, id));

        // Verkäuferdarlehen: ein Darlehen-Instrument mit Konditionen in der Beteiligung des Schuldners (bestehende oder neue, bei demselben Unternehmen die verkaufte selbst)
        let darlehenId: string | null = null;
        let darlehenInstrumentId: string | null = null;
        let darlehenBewertung: { b: { id: string; fondsId: string }; zusatz: Decimal } | null = null;
        if (e.verkaeuferdarlehen && plan.schuldner) {
          if (plan.schuldnerBeteiligungId) {
            darlehenId = plan.schuldnerBeteiligungId;
            await sperreBeteiligung(tx, darlehenId);
            darlehenInstrumentId = (await legeInstrumentAn(tx, protokoll, darlehenId, { art: "darlehen" })).id;
          } else {
            const [neu] = await tx
              .insert(beteiligung)
              .values({ fondsId: b.fondsId, organisationId: plan.schuldner, instrument: "darlehen", erstinvestment: e.datum })
              .returning();
            darlehenId = neu!.id;
            await protokoll("anlegen", "beteiligung", darlehenId, null, neu);
            darlehenInstrumentId = await legeHauptinstrumentAn(tx, neu!);
          }
          const betrag = vkd.toFixed(2);
          for (const art of ["zusage", "auszahlung"] as const) {
            const [v] = await tx.insert(vorgang).values({ beteiligungId: darlehenId, instrumentId: darlehenInstrumentId, art, valuta: e.datum, betrag, bemerkung: `Verkäuferdarlehen aus ${kennung}` }).returning();
            await protokoll("anlegen", "vorgang", v!.id, null, v);
            await ordneRundeZu(tx, protokoll, v!);
          }
          const [k] = await tx
            .insert(darlehenKondition)
            .values({
              beteiligungId: darlehenId,
              instrumentId: darlehenInstrumentId,
              gueltigAb: e.datum,
              satzFix: e.verkaeuferdarlehen.satz,
              methode: e.verkaeuferdarlehen.methode,
              zinsperiode: "endfaellig",
              anker: e.verkaeuferdarlehen.faelligAm,
              faelligAm: e.verkaeuferdarlehen.faelligAm,
            })
            .returning();
          await protokoll("anlegen", "darlehen_kondition", k!.id, null, k);
          darlehenBewertung = { b: { id: darlehenId, fondsId: b.fondsId }, zusatz: vkd };
        }

        // Rückfluss (Barzufluss)
        let rueckflussId: string | null = null;
        if (bar.greaterThan(0)) {
          const [v] = await tx.insert(vorgang).values({ beteiligungId: id, instrumentId: erloesInstrumentId, art: "rueckfluss", valuta: e.datum, betrag: bar.toFixed(2), bemerkung: `${kennung}: Barzufluss` }).returning();
          rueckflussId = v!.id;
          await protokoll("anlegen", "vorgang", v!.id, null, v);
          await ordneRundeZu(tx, protokoll, v!);
        }

        const [zeile] = await tx
          .insert(verkauf)
          .values({
            beteiligungId: id,
            instrumentId: plan.instrument?.id ?? null,
            datum: e.datum,
            anteilVerkauft: e.anteilVerkauft,
            kaufpreis: e.kaufpreis,
            kosten: new Decimal(e.kosten ?? 0).toFixed(2),
            treuhandBetrag: e.treuhand ? treuhand.toFixed(2) : null,
            verkaeuferdarlehenBetrag: e.verkaeuferdarlehen ? vkd.toFixed(2) : null,
            verkaeuferdarlehenBeteiligungId: darlehenId,
            verkaeuferdarlehenInstrumentId: darlehenInstrumentId,
            buchwertVorher: plan.auswertung.buchwertVorher,
            buchwertAbgang: plan.auswertung.buchwertAbgang,
            erloes: plan.auswertung.erloes,
            ergebnis: plan.auswertung.ergebnis,
            barzufluss: plan.auswertung.barzufluss,
            schritte: alsJson(plan.auswertung.schritte),
            rueckflussVorgangId: rueckflussId,
          })
          .returning();
        await protokoll("anlegen", "verkauf", zeile!.id, null, zeile);

        let forderungZeile = null;
        if (e.treuhand) {
          [forderungZeile] = await tx.insert(forderung).values({ beteiligungId: id, instrumentId: erloesInstrumentId, verkaufId: zeile!.id, art: "treuhand", betrag: treuhand.toFixed(2), faelligAm: e.treuhand.freigabeAm }).returning();
          await protokoll("anlegen", "forderung", forderungZeile!.id, null, forderungZeile);
        }

        // Instrumente: bei vollem Verkauf `verkauft`; die Beteiligung ist beendet, wenn kein Instrument mehr aktiv ist
        if (voll) for (const i of verkaufte) await setzeInstrumentStatus(tx, protokoll, i, "verkauft");
        const gleicheBeteiligung = darlehenBewertung?.b.id === id;

        // Bewertung der verkauften Beteiligung und (bei einer anderen Beteiligung des Schuldners) des Verkäuferdarlehens
        const letzte = await letzteBewertung(tx, id, e.datum);
        const vorherWert = new Decimal(letzte?.wert ?? 0);
        const rest = voll && !plan.instrument ? new Decimal(0) : plan.instrument ? Decimal.max(vorherWert.minus(plan.buchwertAbgang), 0) : vorherWert.times(new Decimal(1).minus(e.anteilVerkauft)).toDecimalPlaces(2);
        const wert = gleicheBeteiligung ? rest.plus(vkd) : rest;
        const begruendung = gleicheBeteiligung ? `${voll ? "Beteiligung verkauft" : `Teilverkauf (Anteil ${e.anteilVerkauft})`}; ${VERKAEUFERDARLEHEN_BEGRUENDUNG}` : voll ? "Beteiligung verkauft" : `Teilverkauf (Anteil ${e.anteilVerkauft})`;
        const bewertet = await setzeBewertung(tx, protokoll, b, e.datum, wert.toFixed(2), "sonstige", begruendung);
        await tx.update(verkauf).set({ bewertungId: bewertet.id }).where(eq(verkauf.id, zeile!.id));
        if (darlehenBewertung && !gleicheBeteiligung) {
          const vorhanden = await letzteBewertung(tx, darlehenBewertung.b.id, e.datum);
          await setzeBewertung(tx, protokoll, darlehenBewertung.b, e.datum, new Decimal(vorhanden?.wert ?? 0).plus(darlehenBewertung.zusatz).toFixed(2), "anschaffungskosten", VERKAEUFERDARLEHEN_BEGRUENDUNG);
        }
        let nachher = b;
        const keinAktives = !(await instrumenteVon(tx, id)).some((i) => i.status === "aktiv");
        if (voll && keinAktives) {
          [nachher] = await tx.update(beteiligung).set({ status: "exit" }).where(eq(beteiligung.id, id)).returning() as [typeof b];
          await protokoll("verkauf", "beteiligung", id, b, nachher);
        } else {
          await protokoll("verkauf", "beteiligung", id, b, b);
        }

        return {
          verkauf: { ...zeile!, bewertungId: bewertet.id },
          ergebnis: plan.auswertung,
          forderung: forderungZeile,
          verkaeuferdarlehenBeteiligungId: darlehenId,
          verkaeuferdarlehenInstrumentId: darlehenInstrumentId,
          status: nachher.status,
        };
      });
      return c.json(ergebnis, 201);
    })
    /** Kaufpreisanpassung (plus oder minus) nach einem Verkauf: als Rückfluss gebucht. */
    .post("/kaufpreisanpassung", pruefe("param", idParam), pruefe("json", anpassungSchema), async (c) => {
      const { id } = c.req.valid("param");
      const e = c.req.valid("json");
      const ergebnis = await schreibe(db, c, async (tx, protokoll) => {
        const b = await sperreBeteiligung(tx, id);
        await pruefePeriodensperre(tx, b.fondsId, e.datum);
        const verkaeufe = await tx.select().from(verkauf).where(and(eq(verkauf.beteiligungId, id), isNull(verkauf.storniertAm))).orderBy(desc(verkauf.datum), desc(verkauf.erfasstAm));
        const ziel = e.verkaufId ? verkaeufe.find((v) => v.id === e.verkaufId) : verkaeufe[0];
        if (!ziel) throw new Fachfehler(409, "KEIN_VERKAUF", "Zu dieser Beteiligung gibt es keinen Verkauf, den man anpassen könnte.");
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
      return c.json(ergebnis, 201);
    })
    /** Insolvenz: Status insolvent, Bewertung 0 ab dem Datum, optional Wertberichtigung auf null. */
    .post("/insolvenz", pruefe("param", idParam), pruefe("json", insolvenzSchema), async (c) => {
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
      return c.json(ergebnis, 200);
    });
}

export function forderungRouten(db: Db) {
  return new Hono().post("/:id/erfuellt", pruefe("param", idParam), pruefe("json", erfuelltSchema), async (c) => {
    const { id } = c.req.valid("param");
    const { datum } = c.req.valid("json");
    const ergebnis = await schreibe(db, c, async (tx, protokoll) => {
      const [f] = await tx.select().from(forderung).where(eq(forderung.id, id));
      if (!f) throw new Fachfehler(404, "FORDERUNG_NICHT_GEFUNDEN", "Forderung nicht gefunden.");
      const b = await sperreBeteiligung(tx, f.beteiligungId);
      const [vorher] = await tx.select().from(forderung).where(eq(forderung.id, id)).for("update");
      if (vorher?.storniertAm) throw new Fachfehler(409, "FORDERUNG_STORNIERT", "Der Verkauf der Forderung wurde storniert.");
      if (vorher?.erfuelltAm) throw new Fachfehler(409, "FORDERUNG_ERFUELLT", "Die Forderung ist bereits erfüllt.");
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
    return c.json(ergebnis, 200);
  });
}

const stornoSchema = z.object({ grund: textEingabe(500) });

/** Storno eines ganzen Verkaufs unter `/verkaeufe`. */
export function verkaufRouten(db: Db) {
  return new Hono().post("/:id/storno", pruefe("param", idParam), pruefe("json", stornoSchema), async (c) => {
    const { id } = c.req.valid("param");
    const { grund } = c.req.valid("json");
    const ergebnis = await schreibe(db, c, (tx, protokoll) => storniereVerkauf(tx, protokoll, id, grund));
    return c.json(ergebnis, 201);
  });
}
