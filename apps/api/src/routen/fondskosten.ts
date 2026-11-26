import { pruefeFonds } from "../fonds-pruefung";
import { fondsAnApi } from "../fonds-vertrag";
import { Hono } from "hono";
import { z } from "zod";
import { type Db } from "@carraway/db";
import { Decimal } from "@carraway/rechenkern";
import { kontenAusVerteilung } from "../berichte/daten";
import { ladeKapitalstand } from "../instrumente/kapitalstand";
import { bucheKosten, ladeKostenbuchungen, rechneKosten, storniereKosten } from "../kapital/fondskosten";
import { berechneFondsUebersicht, standardStichtag } from "../kennzahlen/fonds";
import { betragEingabe, idParam, ladeFonds, optionalerText, schreibe, textEingabe } from "../schreiben";
import { lese } from "../zeitlimit";

/**
 * Verwaltungsvergütung und Fondskosten (Issue #157) und die Kapitalkonten der Investoren mit Rechenweg. Mount unter `/funds`.
 * Lesen = betrachter, Buchen und Stornieren = bearbeiter (Periodensperre gilt). Die Pfade folgen noch den deutschen Namen des Bereichs
 * „Fonds, Kapital, Investoren“ (Ausnahme der Englisch-Prüfung bis zur Umstellung des Bereichs).
 */

const datum = z.iso.date();
const satz = z.string().regex(/^0?\.\d{1,6}$/, "Rate as a fraction with at most six decimal places, e.g. 0.02").refine((w) => Number(w) > 0, "Rate must be greater than zero");
const kostenEingabe = z.object({
  art: z.enum(["verwaltungsverguetung", "fondskosten"]),
  valuta: datum,
  betrag: betragEingabe.optional(),
  berechnung: z.object({ satz, von: datum, bis: datum }).optional(),
  verteilung: z.enum(["grundlage", "manuell"]).default("grundlage"),
  anteile: z.array(z.object({ organisationId: z.uuid(), betrag: z.string().regex(/^\d+(\.\d{1,2})?$/, "Non-negative amount with at most two decimal places") })).max(1000).optional(),
  bemerkung: optionalerText(1000),
});
const schnitt = z.object({ stichtag: datum.optional(), stand: z.iso.datetime({ offset: true }).optional() });
const stornoEingabe = z.object({ grund: textEingabe(500), valuta: datum.optional() });

export function fondsKostenRouten(db: Db) {
  return new Hono()
    .get("/:id/fees-and-expenses", pruefeFonds("param", idParam), pruefeFonds("query", schnitt), async (c) => {
      const { id } = c.req.valid("param");
      const { stichtag, stand } = c.req.valid("query");
      const daten = await lese(db, async (tx) => {
        const f = await ladeFonds(tx, id);
        const buchungen = await ladeKostenbuchungen(tx, id, stichtag, stand);
        const summe = (art: string) => buchungen.filter((b) => b.art === art).reduce((s, b) => s.plus(b.betrag), new Decimal(0)).toFixed(2);
        return { waehrung: f.waehrung, stichtag: stichtag ?? null, summen: { verwaltungsverguetung: summe("verwaltungsverguetung"), fondskosten: summe("fondskosten") }, buchungen };
      });
      return c.json(fondsAnApi(daten), 200);
    })
    .post("/:id/fees-and-expenses/preview", pruefeFonds("param", idParam), pruefeFonds("json", kostenEingabe), async (c) => {
      const { id } = c.req.valid("param");
      const eingabe = c.req.valid("json");
      const daten = await lese(db, async (tx) => {
        const f = await ladeFonds(tx, id);
        return { ...(await rechneKosten(tx, f, eingabe)), waehrung: f.waehrung };
      });
      return c.json(fondsAnApi(daten), 200);
    })
    .post("/:id/fees-and-expenses", pruefeFonds("param", idParam), pruefeFonds("json", kostenEingabe), async (c) => {
      const { id } = c.req.valid("param");
      const eingabe = c.req.valid("json");
      const buchung = await schreibe(db, c, async (tx, protokoll) => {
        await ladeFonds(tx, id);
        return bucheKosten(tx, protokoll, id, eingabe);
      });
      return c.json(fondsAnApi(buchung), 201);
    })
    .post("/:id/fees-and-expenses/:costEntryId/reverse", pruefeFonds("param", idParam.extend({ kostenId: z.uuid() })), pruefeFonds("json", stornoEingabe), async (c) => {
      const { id, kostenId } = c.req.valid("param");
      const { grund, valuta } = c.req.valid("json");
      const ergebnis = await schreibe(db, c, async (tx, protokoll) => {
        await ladeFonds(tx, id);
        return storniereKosten(tx, protokoll, id, kostenId, grund, valuta);
      });
      return c.json(fondsAnApi(ergebnis), 201);
    })
    /**
     * Kapitalkonten aller Investoren zum Stichtag (wie im LP-Bericht, dieselbe Verteilung): Zusage, Abrufe, Einzahlungen, Ausschüttungen,
     * Verwaltungsvergütung, Fondskosten, NAV-Anteil, Netto-IRR und die Fortschreibung des Kontos als Rechenweg.
     */
    .get("/:id/capital-accounts", pruefeFonds("param", idParam), pruefeFonds("query", schnitt), async (c) => {
      const { id } = c.req.valid("param");
      const { stichtag: gewuenscht, stand } = c.req.valid("query");
      const daten = await lese(db, async (tx) => {
        const f = await ladeFonds(tx, id);
        const stichtag = gewuenscht ?? (await standardStichtag(tx, id, stand));
        const uebersicht = await berechneFondsUebersicht(tx, id, stichtag, stand);
        const verteilung = await ladeKapitalstand(tx, id, uebersicht.stichtag, stand);
        const konten = kontenAusVerteilung(verteilung, uebersicht.kennzahlen.nav.wert);
        return {
          stichtag: uebersicht.stichtag,
          waehrung: f.waehrung,
          nav: uebersicht.kennzahlen.nav.wert,
          konten: konten.map((k) => ({
            organisationId: k.organisationId,
            investor: k.investor,
            zusage: k.zusage,
            anteil: k.anteil,
            ausgetreten: k.ausgetreten,
            abgerufen: k.abgerufen,
            eingezahlt: k.eingezahlt,
            offen: k.offen,
            ausgeschuettet: k.ausgeschuettet,
            offeneZusage: k.offeneZusage,
            verwaltungsverguetung: k.verwaltungsverguetung,
            fondskosten: k.fondskosten,
            kostenausgleich: k.kostenausgleich,
            ergebnisanteil: k.ergebnisanteil,
            navAnteil: k.navAnteil,
            nettoIrr: k.nettoIrr,
            schritte: k.fortschreibung,
          })),
        };
      });
      return c.json(fondsAnApi(daten), 200);
    });
}
