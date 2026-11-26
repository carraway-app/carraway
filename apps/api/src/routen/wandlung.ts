import { portfolioAnApi } from "../portfolio-vertrag";
import { pruefePortfolio } from "../portfolio-pruefung";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { beteiligung, rundenRolle, type Db } from "@carraway/db";
import { Fachfehler } from "../fehler";
import { alsJson, fuehreWandlungAus, planeWandlung, pruefeCutoff, type WandlungsEingabe } from "../instrumente/wandlung";
import { pruefePeriodensperre, sperreBeteiligung } from "../instrumente/zustand";
import { betragEingabe, heute, idParam, schreibe, textEingabe } from "../schreiben";
import { lese } from "../zeitlimit";
import { satzEingabe } from "./vorgaenge";

const positiv = (stellen: number) => new RegExp(`^(?!0+(\\.0+)?$)\\d{1,14}(\\.\\d{1,${stellen}})?$`);
const ganzzahl = z.string().regex(/^[1-9]\d{0,17}$/, "Whole number greater than zero expected");

const wandlungSchema = z.object({
  cutoff: z.iso.date(),
  zinsenWandeln: z.boolean(),
  preisregel: z.object({
    rundenpreisJeAnteil: z.string().regex(positiv(4), "Price greater than zero with at most four decimal places expected").optional(),
    discount: satzEingabe.optional(),
    bewertungsobergrenze: z.object({ betrag: betragEingabe, anteileVorRunde: ganzzahl }).optional(),
  }),
  nennwertJeAnteil: betragEingabe,
  runde: z.union([
    z.object({ id: z.uuid() }),
    z.object({
      neu: z
        .object({
          bezeichnung: textEingabe(200),
          datum: z.iso.date().optional(),
          preMoney: betragEingabe,
          postMoney: betragEingabe,
          preisJeAnteil: z.string().regex(positiv(4), "Price greater than zero with at most four decimal places expected"),
          anteileGesamtNach: ganzzahl,
        })
        .refine((r) => Number(r.postMoney) >= Number(r.preMoney), { message: "Post-money must not be below pre-money", path: ["postMoney"] }),
    }),
  ]),
  rolle: z.enum(rundenRolle.enumValues).default("co"),
  /** Das Wandeldarlehen-Instrument; bei mehreren in der Beteiligung Pflicht. */
  instrumentId: z.uuid().optional(),
  /** Anteilsklasse der neuen Anteile; ohne Angabe die eindeutige Klasse der Runde. */
  anteilsklasseId: z.uuid().optional(),
  /** Vertraglich abweichend gewandelte Beträge (je höchstens der errechnete Stand); Null ist erlaubt. */
  gewandeltesDarlehen: z.string().regex(/^\d{1,14}(\.\d{1,2})?$/, "Amount with at most two decimal places expected").optional(),
  gewandelteZinsen: z.string().regex(/^\d{1,14}(\.\d{1,2})?$/, "Amount with at most two decimal places expected").optional(),
  darlehenRest: z.enum(["zurueckgezahlt", "erlassen"]).optional(),
  zinsenRest: z.enum(["zurueckgezahlt", "erlassen"]).optional(),
});

export function beteiligungWandlungRouten(db: Db) {
  return new Hono()
    /** Rechnet die Wandlung durch (Rechenkern mit Schritten) und nennt die Vorgänge, die gebucht würden. Schreibt nichts. */
    .post("/conversion/preview", pruefePortfolio("param", idParam), pruefePortfolio("json", wandlungSchema), async (c) => {
      const { id } = c.req.valid("param");
      const eingabe = c.req.valid("json") as WandlungsEingabe;
      const plan = await lese(db, async (tx) => {
        const [b] = await tx.select().from(beteiligung).where(eq(beteiligung.id, id));
        if (!b) throw new Fachfehler(404, "investment_not_found", "Investment not found.");
        await pruefeCutoff(tx, b.fondsId, eingabe.cutoff, { nichtNachHeute: false });
        return planeWandlung(tx, b, eingabe);
      });
      return c.json(
        portfolioAnApi({ vorschau: true as const, buchbar: eingabe.cutoff <= heute(), ergebnis: alsJson({ ...plan.ergebnis, restbehandlung: plan.restbehandlung }), gebucht: alsJson(plan.gebucht), vorgaenge: plan.vorgaenge, restbehandlung: plan.restbehandlung, zielBeteiligungId: plan.zielBeteiligungId, quellInstrumentId: plan.quellInstrumentId, zielInstrumentId: plan.zielInstrumentId, runde: plan.runde, anteilsklasseId: plan.anteilsklasseId }),
        200,
      );
    })
    /** Wandelt das Darlehen in einer Transaktion: Zinsen buchen, Darlehen tilgen, Anteile aufnehmen, Runde und Bewertung setzen. */
    .post("/conversion", pruefePortfolio("param", idParam), pruefePortfolio("json", wandlungSchema), async (c) => {
      const { id } = c.req.valid("param");
      const eingabe = c.req.valid("json") as WandlungsEingabe;
      const ergebnis = await schreibe(db, c, async (tx, protokoll) => {
        const b = await sperreBeteiligung(tx, id);
        await pruefePeriodensperre(tx, b.fondsId, eingabe.cutoff);
        await pruefeCutoff(tx, b.fondsId, eingabe.cutoff, { nichtNachHeute: true });
        return fuehreWandlungAus(tx, protokoll, b, eingabe);
      });
      return c.json(portfolioAnApi(ergebnis), 201);
    });
}
