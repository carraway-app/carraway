import { portfolioAnApi } from "../portfolio-vertrag";
import { pruefePortfolio } from "../portfolio-pruefung";
import { Hono } from "hono";
import { z } from "zod";
import type { Db } from "@carraway/db";
import { aktuellerAkteur } from "../anmeldung/akteur";
import { ladeFundstellen } from "../dokumente/fundstellen";
import { fehlerAntwort } from "../fehler";
import { ladeBeteiligungDetail } from "../kennzahlen/beteiligung";
import { lese } from "../zeitlimit";
import { berichteFuerBeteiligung } from "./berichte";
import { beteiligungBewertungRouten } from "./bewertungen";
import { beteiligungKapitalRouten } from "./kapital";
import { beteiligungKennzahlRouten } from "./kennzahlen";
import { beteiligungInstrumentRouten } from "./vorgaenge";
import { beteiligungInstrumenteRouten } from "./instrumente";
import { beteiligungVerkaufRouten } from "./verkauf";
import { beteiligungWandlungRouten } from "./wandlung";

const idSchema = z.object({ id: z.uuid() });
/** Wissensstand als Zeitstempel mit Zeitzone, z. B. `2026-11-20T10:00:00Z`. */
const detailAbfrage = z.object({ stichtag: z.iso.date().optional(), stand: z.iso.datetime({ offset: true }).optional() });

export function beteiligungRouten(db: Db) {
  return new Hono()
    /**
     * Detail einer Beteiligung zum Stichtag: Stammdaten, Organisation, Fonds, Deal, Vorgänge (Storno-Paare markiert),
     * Bewertungsverlauf, Finanzierungsrunden mit Positionen und Kennzahlen mit Herkunft.
     */
    .get("/:id", pruefePortfolio("param", idSchema, { query: detailAbfrage }), pruefePortfolio("query", detailAbfrage), async (c) => {
      const { id } = c.req.valid("param");
      const { stichtag, stand } = c.req.valid("query");
      const akteur = aktuellerAkteur(c);
      const ergebnis = await lese(db, async (tx) => {
        const detail = await ladeBeteiligungDetail(tx, id, stichtag, stand);
        if (!detail) return null;
        // Fundstellen (Dokument, Seite, Zitat) der Werte, nur zu Dokumenten, die die Person sehen darf.
        return { ...detail, fundstellen: await ladeFundstellen(tx, akteur, id, detail.organisation.id) };
      });
      if (!ergebnis) return fehlerAntwort(c, 404, "investment_not_found", "Investment not found.");
      return c.json(portfolioAnApi(portfolioAnApi(ergebnis)), 200);
    })
    .route("/:id/reports", berichteFuerBeteiligung(db))
    .route("/:id", beteiligungBewertungRouten(db))
    .route("/:id", beteiligungKapitalRouten(db))
    .route("/:id", beteiligungKennzahlRouten(db))
    .route("/:id", beteiligungInstrumentRouten(db))
    .route("/:id", beteiligungInstrumenteRouten(db))
    .route("/:id", beteiligungWandlungRouten(db))
    .route("/:id", beteiligungVerkaufRouten(db));
}
