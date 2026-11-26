import { kapitalQuelleAnApi, kapitalQuelleVonApi } from "../portfolio-vertrag";
import { pruefePortfolio } from "../portfolio-pruefung";
import { Hono } from "hono";
import { z } from "zod";
import type { Db } from "@carraway/db";
import { aktuellerAkteur } from "../anmeldung/akteur";
import { ladeUebertragungen, legeUebertragungAn, storniereUebertragung, type UebertragungAntwort } from "../kapital/uebertragung";
import type { Halter } from "../kapital/wasserfall";
import { betragEingabe, idParam, optionalerText, schreibe, textEingabe } from "../schreiben";
import { lese } from "../zeitlimit";

/**
 * Anteilsübertragungen zwischen Gesellschaftern eines Unternehmens (Issue 151, `kapital/uebertragung.ts`). Neue Route, darum schon nach den Konventionen der
 * englischen API (`docs/api-glossar.md`): Pfad `share-transfers`, Felder englisch; der Mount-Punkt `/organisationen` wird mit seinem Bereich umbenannt.
 * Die Berechtigungstabelle verlangt die Mindestrolle irgendwo; die Handler prüfen wie bei den Runden (Rechtsgrundlage am Unternehmen ohne den Käuferfonds,
 * bearbeiter an jedem beteiligten eigenen Fonds).
 */

const neueUebertragung = z.object({
  date: z.iso.date(),
  /** Transferring cap table row: common shares, a round position, an earlier transfer or a warrant exercise. */
  source: z.union([
    z.literal("common"),
    z.uuid(),
    z.string()
      .regex(/^(share-transfer|warrant-exercise):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
      .refine((quelle) => z.uuid().safeParse(quelle.split(":")[1]).success, "Expected a valid share-transfer or warrant-exercise ID"),
  ]),
  buyerFundId: z.uuid().optional(),
  buyerVehicleId: z.uuid().optional(),
  /** Investor without a vehicle: its default vehicle. */
  buyerOrganizationId: z.uuid().optional(),
  shares: z.string().regex(/^[1-9]\d{0,17}$/, "Whole number greater than zero expected"),
  pricePerShare: z.string().regex(/^\d{1,12}(\.\d{1,6})?$/, "Price of zero or more with at most six decimal places expected"),
  /** Amount paid in the fund currency; only if an own fund takes part and the investment currency differs. */
  purchasePriceFundCurrency: betragEingabe.optional(),
  note: optionalerText(2000),
});

const uebertragungStorno = z.object({ reason: textEingabe(500) });
const uebertragungParam = z.object({ id: z.uuid(), transferId: z.uuid() });

const inhaber = (h: Halter | null) => (h ? { type: h.art === "stamm" ? "common" : h.art === "fonds" ? "fund" : "investor", id: h.id, name: h.name, vehicle: h.vehikel } : null);

/** Antwort an der API-Grenze englisch. */
const alsAntwort = (u: UebertragungAntwort) => ({
  id: u.id,
  organizationId: u.organisationId,
  date: u.datum,
  source: u.quelle === null ? null : kapitalQuelleAnApi(u.quelle),
  seller: inhaber(u.verkaeufer),
  buyer: inhaber(u.kaeufer),
  shares: u.anzahl,
  pricePerShare: u.preisJeAnteil,
  purchasePrice: u.kaufpreis,
  saleId: u.verkaufId,
  buyerInstrumentId: u.kaeuferInstrumentId,
  note: u.bemerkung,
  recordedAt: u.erfasstAm,
  reversedAt: u.storniertAm,
});

/** Mount unter `/organisationen/:id`. */
export function organisationUebertragungRouten(db: Db) {
  return new Hono()
    .get("/share-transfers", pruefePortfolio("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const daten = await lese(db, (tx) => ladeUebertragungen(tx, aktuellerAkteur(c), id));
      return c.json({ data: daten.map(alsAntwort) }, 200);
    })
    .post("/share-transfers", pruefePortfolio("param", idParam), pruefePortfolio("json", neueUebertragung), async (c) => {
      const { id } = c.req.valid("param");
      const e = c.req.valid("json");
      const akteur = aktuellerAkteur(c);
      const neu = await schreibe(db, c, async (tx, protokoll) => {
        const zeile = await legeUebertragungAn(tx, protokoll, akteur, id, {
          datum: e.date,
          quelle: kapitalQuelleVonApi(e.source),
          kaeuferFondsId: e.buyerFundId,
          kaeuferVehikelId: e.buyerVehicleId,
          kaeuferOrganisationId: e.buyerOrganizationId,
          anzahl: e.shares,
          preisJeAnteil: e.pricePerShare,
          kaufpreisFonds: e.purchasePriceFundCurrency,
          bemerkung: e.note,
        });
        return (await ladeUebertragungen(tx, akteur, id)).find((u) => u.id === zeile.id)!;
      });
      return c.json(alsAntwort(neu), 201);
    })
    /** Storno als Ganzes: Verkauf des Verkäuferfonds und Zugang des Käuferfonds werden zurückgenommen. */
    .post("/share-transfers/:transferId/reverse", pruefePortfolio("param", uebertragungParam), pruefePortfolio("json", uebertragungStorno), async (c) => {
      const { id, transferId } = c.req.valid("param");
      const { reason } = c.req.valid("json");
      const akteur = aktuellerAkteur(c);
      const neu = await schreibe(db, c, async (tx, protokoll) => {
        await storniereUebertragung(tx, protokoll, akteur, id, transferId, reason);
        return (await ladeUebertragungen(tx, akteur, id)).find((u) => u.id === transferId)!;
      });
      return c.json(alsAntwort(neu), 201);
    });
}
