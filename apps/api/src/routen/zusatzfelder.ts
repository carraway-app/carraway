import { kontaktJson, pruefeKontakt } from "../kontakte/http";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { beteiligung, finanzierungsrunde, type Db } from "@carraway/db";
import { aktuellerAkteur } from "../anmeldung/akteur";
import { FELD_OBJEKTE } from "../crm/felder";
import { Fachfehler } from "../fehler";
import { beschreibeFelder, ladeDefinitionen, ladeInstrumentWerte, schemaFuer, setzeInstrumentWerte, setzeWerte, werteEingabe } from "../felder/werte";
import { hauptinstrumentId } from "../instrumente/hauptinstrument";
import { instrumenteVon } from "../instrumente/instrumente";
import { pruefePeriodensperre } from "../instrumente/zustand";
import { verlangeRolleAnAllenPositionen, verlangeRundenrecht } from "../kapital/runden";
import { idParam, schreibe } from "../schreiben";
import { lese } from "../zeitlimit";
import type { PortfolioObjekt } from "../felder/ziele";

/**
 * Eigene Felder an Fonds, Finanzierungsrunde, Instrument, Beteiligung und Vorgang (Etappe 21). Die Definitionen verwalten globale Verwalter über die
 * Routen der Felder (`POST /crm/felder`, `PATCH /crm/felder/:id`, Archivieren, Wiederherstellen); hier stehen das Lesen der Definitionen und des
 * Schemas und das Lesen und Setzen der Werte an den Objekten. Lesen geht auch zu einem früheren Wissensstand (`stand`), Setzen schreibt Vorher und
 * Nachher ins Änderungsprotokoll. Werte von Vorgängen entstehen nur beim Anlegen des Vorgangs.
 */

const standAbfrage = z.object({ stand: z.iso.datetime({ offset: true }).optional() });
const objektParam = z.object({ objekt: z.enum(FELD_OBJEKTE) });
const definitionAbfrage = z.object({ archiviert: z.enum(["0", "1"]).default("0") });

/** Definitionen und Schema (alle angemeldeten Personen mit einer Rolle). */
export function zusatzfelderRouten(db: Db) {
  return new Hono()
    .get("/:object/definitions", pruefeKontakt("param", objektParam), pruefeKontakt("query", definitionAbfrage), async (c) => {
      const { objekt } = c.req.valid("param");
      const { archiviert } = c.req.valid("query");
      const mitArchiviert = archiviert === "1" && aktuellerAkteur(c).globalVerwalter;
      const daten = await lese(db, (tx) => ladeDefinitionen(tx, objekt, mitArchiviert));
      return kontaktJson(c, { daten }, 200);
    })
    .get("/:object/schema", pruefeKontakt("param", objektParam), async (c) => {
      const { objekt } = c.req.valid("param");
      return c.json(await lese(db, (tx) => schemaFuer(tx, objekt)), 200);
    });
}

const antwort = (objekt: PortfolioObjekt, id: string, stand: string | undefined, daten: Awaited<ReturnType<typeof beschreibeFelder>>) => ({ objekt, id, stand: stand ?? null, ...daten });

/** Lesen und Setzen für ein Objekt, dessen Rechte die Tabelle über den Pfad `:id` auflöst (Fonds, Beteiligung, Instrument). */
function gewoehnlicheRouten(db: Db, objekt: PortfolioObjekt, pfad: string) {
  return new Hono()
    .get(pfad, pruefeKontakt("param", idParam), pruefeKontakt("query", standAbfrage), async (c) => {
      const { id } = c.req.valid("param");
      const { stand } = c.req.valid("query");
      return kontaktJson(c, antwort(objekt, id, stand, await lese(db, (tx) => beschreibeFelder(tx, c, objekt, id, stand))), 200);
    })
    .put(pfad, pruefeKontakt("param", idParam), pruefeKontakt("json", werteEingabe), async (c) => {
      const { id } = c.req.valid("param");
      const { werte } = c.req.valid("json");
      const daten = await schreibe(db, c, async (tx, protokoll) => {
        await setzeWerte(tx, protokoll, c, objekt, id, werte);
        return beschreibeFelder(tx, c, objekt, id);
      });
      return kontaktJson(c, antwort(objekt, id, undefined, daten), 200);
    });
}

/** Mount unter `/funds`. */
export const fondsFelderRouten = (db: Db) => gewoehnlicheRouten(db, "fonds", "/:id/fields");

const instrumentStandAbfrage = z.object({ stand: z.iso.datetime({ offset: true }).optional(), instrumentId: z.uuid().optional() });
const instrumentWerteEingabe = werteEingabe.extend({ instrumentId: z.uuid().optional() });

/**
 * Das Instrument, dessen Felder gelten: das angegebene (muss zur Beteiligung gehören) oder das Hauptinstrument. `istHaupt` sagt, ob es das Hauptinstrument
 * ist (dessen Werte spiegelt `beteiligung.instrument_felder`).
 */
async function loeseFelderInstrument(tx: Parameters<typeof beschreibeFelder>[0], beteiligungId: string, instrumentId: string | undefined) {
  const [vorhanden] = await tx.select({ id: beteiligung.id }).from(beteiligung).where(eq(beteiligung.id, beteiligungId));
  if (!vorhanden) throw new Fachfehler(404, "investment_not_found", "Investment not found.");
  const haupt = await hauptinstrumentId(tx, beteiligungId);
  if (instrumentId === undefined || instrumentId === haupt) return { id: haupt, istHaupt: true };
  const eigene = await instrumenteVon(tx, beteiligungId);
  if (!eigene.some((i) => i.id === instrumentId)) throw new Fachfehler(409, "instrument_wrong_investment", "The instrument belongs to a different investment.", { instrumentId });
  return { id: instrumentId, istHaupt: false };
}

/**
 * Felder des Instruments einer Beteiligung. Ohne `instrumentId` das Hauptinstrument; mit `instrumentId` ein anderes Instrument der Beteiligung. Die Werte
 * stehen in `instrument.felder`; `beteiligung.instrument_felder` spiegelt das Hauptinstrument für Excel, öffentliche API und Berichte.
 */
function instrumentFelderRouten(db: Db) {
  const pfad = "/:id/instrument-fields";
  return new Hono()
    .get(pfad, pruefeKontakt("param", idParam), pruefeKontakt("query", instrumentStandAbfrage), async (c) => {
      const { id } = c.req.valid("param");
      const { stand, instrumentId } = c.req.valid("query");
      const daten = await lese(db, async (tx) => {
        const ziel = await loeseFelderInstrument(tx, id, instrumentId);
        // Das Hauptinstrument liest wie bisher über den Spiegel der Beteiligung (Wissensstand aus deren Protokoll), jedes andere aus `instrument.felder`.
        return ziel.istHaupt ? beschreibeFelder(tx, c, "instrument", id, stand) : beschreibeFelder(tx, c, "instrument", id, stand, await ladeInstrumentWerte(tx, ziel.id, stand));
      });
      return kontaktJson(c, antwort("instrument", id, stand, daten), 200);
    })
    .put(pfad, pruefeKontakt("param", idParam), pruefeKontakt("json", instrumentWerteEingabe), async (c) => {
      const { id } = c.req.valid("param");
      const { werte, instrumentId } = c.req.valid("json");
      const daten = await schreibe(db, c, async (tx, protokoll) => {
        const ziel = await loeseFelderInstrument(tx, id, instrumentId);
        const { werte: nachher } = await setzeInstrumentWerte(tx, protokoll, c, ziel.id, ziel.istHaupt, werte);
        return beschreibeFelder(tx, c, "instrument", id, undefined, nachher);
      });
      return kontaktJson(c, antwort("instrument", id, undefined, daten), 200);
    });
}

/** Mount unter `/investments`: Felder der Beteiligung und die des Instruments. */
export function beteiligungFelderRouten(db: Db) {
  return new Hono().route("/", gewoehnlicheRouten(db, "beteiligung", "/:id/fields")).route("/", instrumentFelderRouten(db));
}

/** Mount unter `/transactions`: nur lesen (Werte setzt das Anlegen des Vorgangs). */
export function vorgangFelderRouten(db: Db) {
  return new Hono().get("/:id/fields", pruefeKontakt("param", idParam), pruefeKontakt("query", standAbfrage), async (c) => {
    const { id } = c.req.valid("param");
    const { stand } = c.req.valid("query");
    return kontaktJson(c, antwort("vorgang", id, stand, await lese(db, (tx) => beschreibeFelder(tx, c, "vorgang", id, stand))), 200);
  });
}

/**
 * Mount unter `/financing-rounds`. Eine Runde gehört zu einem Unternehmen und kann Positionen mehrerer Fonds haben: Das Recht prüft der Handler wie bei den
 * übrigen Wegen der Runde. Die Werte sind beschreibende Stammdaten und auch an einer abgeschlossenen Runde änderbar (die Zahlen der Runde bleiben gesperrt);
 * liegt das Rundendatum in einer gesperrten Periode eines beteiligten Fonds, ist es nicht erlaubt.
 */
export function rundenFelderRouten(db: Db) {
  const ladeRunde = async (tx: Parameters<typeof beschreibeFelder>[0], id: string) => {
    const [runde] = await tx.select().from(finanzierungsrunde).where(eq(finanzierungsrunde.id, id));
    if (!runde) throw new Fachfehler(404, "round_not_found", "Financing round not found.");
    return runde;
  };
  return new Hono()
    .get("/:id/fields", pruefeKontakt("param", idParam), pruefeKontakt("query", standAbfrage), async (c) => {
      const { id } = c.req.valid("param");
      const { stand } = c.req.valid("query");
      const akteur = aktuellerAkteur(c);
      const daten = await lese(db, async (tx) => {
        const runde = await ladeRunde(tx, id);
        await verlangeRundenrecht(tx, akteur, runde.organisationId, "betrachter", [], id);
        return beschreibeFelder(tx, c, "runde", id, stand);
      });
      return kontaktJson(c, antwort("runde", id, stand, daten), 200);
    })
    .put("/:id/fields", pruefeKontakt("param", idParam), pruefeKontakt("json", werteEingabe), async (c) => {
      const { id } = c.req.valid("param");
      const { werte } = c.req.valid("json");
      const akteur = aktuellerAkteur(c);
      const daten = await schreibe(db, c, async (tx, protokoll) => {
        const runde = await ladeRunde(tx, id);
        await verlangeRundenrecht(tx, akteur, runde.organisationId, "bearbeiter", [], id);
        await verlangeRolleAnAllenPositionen(tx, akteur, id, "bearbeiter");
        const { rows } = await tx.execute<{ fonds_id: string }>(sql`SELECT DISTINCT fonds_id FROM rundenposition WHERE runde_id = ${id} AND fonds_id IS NOT NULL`);
        for (const f of rows) await pruefePeriodensperre(tx, f.fonds_id, runde.datum);
        await setzeWerte(tx, protokoll, c, "runde", id, werte);
        return beschreibeFelder(tx, c, "runde", id);
      });
      return kontaktJson(c, antwort("runde", id, undefined, daten), 200);
    });
}
