import { asc, eq, sql } from "drizzle-orm";
import type { Context } from "hono";
import { anteilsklasse, beteiligung, finanzierungsrunde, INSTRUMENT_BEZEICHNUNG, instrument, type instrumentArt, type instrumentStatus } from "@carraway/db";
import { Decimal } from "@carraway/rechenkern";
import { Fachfehler } from "../fehler";
import { pruefeFelder } from "../crm/felder";
import { ladeDefinitionen } from "../felder/werte";
import type { Protokollant } from "../schreiben";
import type { Tx } from "../zeitlimit";
import { hauptinstrumentId } from "./hauptinstrument";
import { gewandelteZinsen, ladeGewandelteZinsIds } from "./zinsansicht";
import { ladeTranchenMitStand } from "./tranchen";
import { ladeVerkaufsdaten } from "./verkaeufe";
import { berechneZustand, buchwertVon, istDarlehensartig, ladeVorgaenge, offenesKapital, sperreBeteiligung, vorgaengeDesInstruments, type BeteiligungZeile } from "./zustand";

/**
 * Instrumente einer Beteiligung (`docs/portfolio-modell.md`): lesen, anlegen, ändern, dem Vorgang das richtige Instrument zuordnen und den
 * Spiegel `beteiligung.instrument` / `instrument_felder` (das Hauptinstrument) nachführen, solange Excel, öffentliche API und Import ihn noch lesen.
 */

export type InstrumentZeile = typeof instrument.$inferSelect;
export type InstrumentArt = (typeof instrumentArt.enumValues)[number];
export type InstrumentStatus = (typeof instrumentStatus.enumValues)[number];

export const INSTRUMENT_NICHT_GEFUNDEN = () => new Fachfehler(404, "INSTRUMENT_NICHT_GEFUNDEN", "Instrument nicht gefunden.");

/** Das Instrument laden (404, wenn es fehlt). */
export async function ladeInstrument(tx: Tx, id: string): Promise<InstrumentZeile> {
  const [zeile] = await tx.select().from(instrument).where(eq(instrument.id, id));
  if (!zeile) throw INSTRUMENT_NICHT_GEFUNDEN();
  return zeile;
}

/** Sperrt die Beteiligung des Instruments (serialisiert alle Schreibwege) und lädt das Instrument danach mit Sperre. */
export async function sperreInstrument(tx: Tx, id: string): Promise<{ i: InstrumentZeile; b: BeteiligungZeile }> {
  const vorab = await ladeInstrument(tx, id);
  const b = await sperreBeteiligung(tx, vorab.beteiligungId);
  const [i] = await tx.select().from(instrument).where(eq(instrument.id, id)).for("update");
  if (!i) throw INSTRUMENT_NICHT_GEFUNDEN();
  return { i, b };
}

export const instrumenteVon = (tx: Tx, beteiligungId: string): Promise<InstrumentZeile[]> =>
  tx.select().from(instrument).where(eq(instrument.beteiligungId, beteiligungId)).orderBy(asc(instrument.erstelltAm), asc(instrument.id));

/**
 * Das Instrument, auf das ein Vorgang bucht. Mit `instrumentId` muss es zur Beteiligung gehören. Ohne Angabe gilt das Instrument der Tranche
 * (falls eine genannt ist) oder das einzige Instrument der Beteiligung; hat sie mehrere, ist die Angabe Pflicht (400). Eine Beteiligung ganz ohne
 * Instrument (direkt geschrieben) bekommt beim ersten Zugriff das Hauptinstrument aus ihren Stammdaten.
 */
export async function loeseInstrument(tx: Tx, b: { id: string }, instrumentId?: string | undefined, trancheInstrumentId?: string | undefined): Promise<InstrumentZeile> {
  const alle = await instrumenteVon(tx, b.id);
  const gewuenscht = instrumentId ?? trancheInstrumentId;
  if (gewuenscht) {
    const treffer = alle.find((i) => i.id === gewuenscht);
    if (treffer) return treffer;
    const [anderswo] = await tx.select({ id: instrument.id }).from(instrument).where(eq(instrument.id, gewuenscht));
    if (!anderswo) throw INSTRUMENT_NICHT_GEFUNDEN();
    throw new Fachfehler(409, "INSTRUMENT_FALSCHE_BETEILIGUNG", "Das Instrument gehört zu einer anderen Beteiligung.", { instrumentId: gewuenscht });
  }
  if (alle.length > 1) {
    throw new Fachfehler(400, "EINGABE_UNGUELTIG", "Die Eingabe ist ungültig.", {
      felder: [{ feld: "instrumentId", code: "instrument_erforderlich", meldung: "Die Beteiligung hat mehrere Instrumente; das Instrument ist anzugeben" }],
    });
  }
  if (alle[0]) return alle[0];
  return ladeInstrument(tx, await hauptinstrumentId(tx, b.id));
}

/** Nur darlehensartige Instrumente (Konditionen, Zinsen): eines angegeben oder das einzige darlehensartige der Beteiligung. */
export async function loeseDarlehensinstrument(tx: Tx, b: { id: string }, instrumentId?: string | undefined): Promise<InstrumentZeile> {
  if (instrumentId) return loeseInstrument(tx, b, instrumentId);
  const alle = await instrumenteVon(tx, b.id);
  const darlehen = alle.filter((i) => istDarlehensartig(i.art));
  if (darlehen.length > 1) {
    throw new Fachfehler(400, "EINGABE_UNGUELTIG", "Die Eingabe ist ungültig.", {
      felder: [{ feld: "instrumentId", code: "instrument_erforderlich", meldung: "Die Beteiligung hat mehrere darlehensartige Instrumente; das Instrument ist anzugeben" }],
    });
  }
  return darlehen[0] ?? loeseInstrument(tx, b);
}

export function verlangeInstrumentAktiv(i: InstrumentZeile) {
  if (i.status !== "aktiv") throw new Fachfehler(409, "INSTRUMENT_NICHT_AKTIV", "Das Instrument ist nicht aktiv.", { instrumentId: i.id, status: i.status });
}

/** Das Hauptinstrument (erstes aktives, sonst zuletzt angelegtes) in der Beteiligung spiegeln (`instrument`, `instrument_felder`). */
export async function synchronisiereHauptinstrument(tx: Tx, beteiligungId: string): Promise<void> {
  const alle = await instrumenteVon(tx, beteiligungId);
  if (alle.length === 0) return;
  const aktive = alle.filter((i) => i.status === "aktiv");
  const haupt = aktive[0] ?? alle[alle.length - 1]!;
  await tx.update(beteiligung).set({ instrument: haupt.art, instrumentFelder: haupt.felder }).where(eq(beteiligung.id, beteiligungId));
}

/** Setzt den Status eines Instruments, protokolliert ihn und führt den Spiegel nach. */
export async function setzeInstrumentStatus(tx: Tx, protokoll: Protokollant, i: InstrumentZeile, status: InstrumentStatus): Promise<InstrumentZeile> {
  if (i.status === status) return i;
  const [nachher] = await tx.update(instrument).set({ status }).where(eq(instrument.id, i.id)).returning();
  if (!nachher) throw INSTRUMENT_NICHT_GEFUNDEN();
  await protokoll("status", "instrument", i.id, i, nachher);
  await synchronisiereHauptinstrument(tx, i.beteiligungId);
  return nachher;
}

/** Alle aktiven Instrumente einer Beteiligung auf den Status setzen (Verkauf, Insolvenz, Abschreibung). */
export async function setzeAktiveInstrumenteStatus(tx: Tx, protokoll: Protokollant, beteiligungId: string, status: InstrumentStatus): Promise<InstrumentZeile[]> {
  const geaendert: InstrumentZeile[] = [];
  for (const i of await instrumenteVon(tx, beteiligungId)) if (i.status === "aktiv") geaendert.push(await setzeInstrumentStatus(tx, protokoll, i, status));
  return geaendert;
}

// Anlegen und Ändern -----------------------------------------------------------------------------------------------------------------

export interface NeuesInstrument {
  art: InstrumentArt;
  bezeichnung?: string | undefined;
  rundeId?: string | null | undefined;
  anteilsklasseId?: string | null | undefined;
  /** Bereits geprüfte Werte eigener Felder (Objekt `instrument`). */
  felder?: Record<string, unknown> | undefined;
  status?: InstrumentStatus | undefined;
  /** Wandlungsparameter (nur Wandeldarlehen): Abschlag als Bruch, Bewertungsobergrenze als Betrag, Zinsen wandeln mit. */
  wandlungsabschlag?: string | null | undefined;
  bewertungsobergrenze?: string | null | undefined;
  zinsenWandeln?: boolean | null | undefined;
}

/** Wandlungsparameter gehören nur an ein Wandeldarlehen (409); `null` und nicht angegeben sind immer erlaubt. */
function pruefeWandlungsparameter(art: InstrumentArt, e: { wandlungsabschlag?: string | null | undefined; bewertungsobergrenze?: string | null | undefined; zinsenWandeln?: boolean | null | undefined }): void {
  if (art === "wandeldarlehen") return;
  if ((e.wandlungsabschlag ?? null) !== null || (e.bewertungsobergrenze ?? null) !== null || (e.zinsenWandeln ?? null) !== null) {
    throw new Fachfehler(409, "INSTRUMENT_KEIN_WANDELDARLEHEN", "Abschlag, Bewertungsobergrenze und „Zinsen wandeln“ gibt es nur beim Wandeldarlehen.", { art });
  }
}

/** Arten, die einer Brückenrunde zugeordnet werden dürfen. */
export const BRUECKEN_ARTEN: ReadonlySet<InstrumentArt> = new Set<InstrumentArt>(["darlehen", "wandeldarlehen", "venture_debt", "gesellschafterdarlehen"]);

/** Runde und Anteilsklasse gehören zum Unternehmen der Beteiligung (404 / 409), liefert die Bezeichnung der Runde. */
async function pruefeBezug(tx: Tx, b: { organisationId: string }, rundeId: string | null | undefined, anteilsklasseId: string | null | undefined, art: InstrumentArt): Promise<string | null> {
  let rundenname: string | null = null;
  if (rundeId) {
    const [r] = await tx.select().from(finanzierungsrunde).where(eq(finanzierungsrunde.id, rundeId));
    if (!r) throw new Fachfehler(404, "RUNDE_NICHT_GEFUNDEN", "Finanzierungsrunde nicht gefunden.");
    if (r.organisationId !== b.organisationId) throw new Fachfehler(409, "RUNDE_PASST_NICHT", "Die Runde gehört zu einem anderen Unternehmen als die Beteiligung.");
    // Eine Brückenrunde (Darlehen zwischen zwei Runden) nimmt nur Darlehensinstrumente auf, kein Eigenkapital.
    if (r.art === "bruecke" && !BRUECKEN_ARTEN.has(art)) {
      throw new Fachfehler(409, "INSTRUMENT_RUNDE_BRUECKE", "Einer Brückenrunde lassen sich nur Darlehen, Wandeldarlehen, Venture Debt und Gesellschafterdarlehen zuordnen.", { rundeId, art });
    }
    rundenname = r.bezeichnung;
  }
  if (anteilsklasseId) {
    const [k] = await tx.select().from(anteilsklasse).where(eq(anteilsklasse.id, anteilsklasseId));
    if (!k) throw new Fachfehler(404, "ANTEILSKLASSE_NICHT_GEFUNDEN", "Anteilsklasse nicht gefunden.");
    if (k.organisationId !== b.organisationId) throw new Fachfehler(409, "ANTEILSKLASSE_PASST_NICHT", "Die Klasse gehört zu einem anderen Unternehmen als die Beteiligung.");
  }
  return rundenname;
}

/** Legt ein Instrument an (Beteiligung gesperrt). Bezeichnung: angegeben oder aus Art und Runde; der Spiegel der Beteiligung wird nachgeführt. */
export async function legeInstrumentAn(tx: Tx, protokoll: Protokollant, beteiligungId: string, e: NeuesInstrument): Promise<InstrumentZeile> {
  const b = await sperreBeteiligung(tx, beteiligungId);
  const rundenname = await pruefeBezug(tx, b, e.rundeId, e.anteilsklasseId, e.art);
  pruefeWandlungsparameter(e.art, e);
  const bezeichnung = e.bezeichnung ?? (rundenname ? `${INSTRUMENT_BEZEICHNUNG[e.art]} ${rundenname}` : INSTRUMENT_BEZEICHNUNG[e.art]);
  const [neu] = await tx
    .insert(instrument)
    .values({ beteiligungId, art: e.art, bezeichnung, rundeId: e.rundeId ?? null, anteilsklasseId: e.anteilsklasseId ?? null, status: e.status ?? "aktiv", felder: e.felder ?? {}, wandlungsabschlag: e.wandlungsabschlag ?? null, bewertungsobergrenze: e.bewertungsobergrenze ?? null, zinsenWandeln: e.zinsenWandeln ?? null })
    .returning();
  if (!neu) throw new Error("Instrument nicht angelegt");
  await protokoll("anlegen", "instrument", neu.id, null, neu);
  await synchronisiereHauptinstrument(tx, beteiligungId);
  return neu;
}

export interface InstrumentAenderung {
  bezeichnung?: string | undefined;
  art?: InstrumentArt | undefined;
  rundeId?: string | null | undefined;
  anteilsklasseId?: string | null | undefined;
  /** Teilmenge der Werte eigener Felder; `null` entfernt einen Wert. */
  felder?: Record<string, unknown> | undefined;
  /** Wandlungsparameter (nur Wandeldarlehen); `null` leert den Wert. */
  wandlungsabschlag?: string | null | undefined;
  bewertungsobergrenze?: string | null | undefined;
  zinsenWandeln?: boolean | null | undefined;
}

/** Ändert Bezeichnung, Runde, Anteilsklasse, Felder; die Art nur, solange das Instrument keine Vorgänge, Tranchen oder Konditionen hat. */
export async function aendereInstrument(tx: Tx, protokoll: Protokollant, c: Context, id: string, e: InstrumentAenderung): Promise<InstrumentZeile> {
  const { i: vorher, b } = await sperreInstrument(tx, id);
  const aenderung: Partial<typeof instrument.$inferInsert> = {};
  if (e.bezeichnung !== undefined) aenderung.bezeichnung = e.bezeichnung;
  if (e.art !== undefined && e.art !== vorher.art) {
    const { rows } = await tx.execute<{ n: number }>(sql`
      SELECT (SELECT count(*) FROM vorgang WHERE instrument_id = ${id}) + (SELECT count(*) FROM tranche WHERE instrument_id = ${id}) + (SELECT count(*) FROM darlehen_kondition WHERE instrument_id = ${id}) AS n`);
    if (Number(rows[0]?.n) > 0) throw new Fachfehler(409, "INSTRUMENT_ART_GESPERRT", "Die Art lässt sich nicht mehr ändern: Auf dem Instrument gibt es Vorgänge, Tranchen oder Konditionen.", { instrumentId: id });
    aenderung.art = e.art;
  }
  if (e.rundeId !== undefined || e.anteilsklasseId !== undefined || aenderung.art !== undefined) {
    // Bei geänderter Art gilt die Regel für die Runde, die das Instrument danach hat (auch die unveränderte).
    await pruefeBezug(tx, b, e.rundeId !== undefined ? e.rundeId : vorher.rundeId, e.anteilsklasseId, aenderung.art ?? vorher.art);
    if (e.rundeId !== undefined) aenderung.rundeId = e.rundeId;
    if (e.anteilsklasseId !== undefined) aenderung.anteilsklasseId = e.anteilsklasseId;
  }
  const artNachher = aenderung.art ?? vorher.art;
  pruefeWandlungsparameter(artNachher, e);
  if (e.wandlungsabschlag !== undefined) aenderung.wandlungsabschlag = e.wandlungsabschlag;
  if (e.bewertungsobergrenze !== undefined) aenderung.bewertungsobergrenze = e.bewertungsobergrenze;
  if (e.zinsenWandeln !== undefined) aenderung.zinsenWandeln = e.zinsenWandeln;
  // Wechselt die Art weg vom Wandeldarlehen, entfallen die Parameter.
  if (artNachher !== "wandeldarlehen") {
    if (vorher.wandlungsabschlag !== null) aenderung.wandlungsabschlag = null;
    if (vorher.bewertungsobergrenze !== null) aenderung.bewertungsobergrenze = null;
    if (vorher.zinsenWandeln !== null) aenderung.zinsenWandeln = null;
  }
  if (e.felder !== undefined && Object.keys(e.felder).length > 0) {
    const geprueft = await pruefeFelder(tx, c, await ladeDefinitionen(tx, "instrument"), e.felder);
    const nachher: Record<string, unknown> = { ...vorher.felder };
    for (const [feld, wert] of Object.entries(geprueft)) {
      if (wert === null) delete nachher[feld];
      else nachher[feld] = wert;
    }
    aenderung.felder = nachher;
  }
  if (Object.keys(aenderung).length === 0) return vorher;
  const [nachher] = await tx.update(instrument).set(aenderung).where(eq(instrument.id, id)).returning();
  if (!nachher) throw INSTRUMENT_NICHT_GEFUNDEN();
  await protokoll("aendern", "instrument", id, vorher, nachher);
  await synchronisiereHauptinstrument(tx, vorher.beteiligungId);
  return nachher;
}

// Lesen -------------------------------------------------------------------------------------------------------------------------------

/**
 * Instrumente einer Beteiligung mit Zusage, Ausgezahltem, offener Zusage, offenem Kapital (nur darlehensartig), den Teilen des Buchwerts, gezahlten
 * Zinsen, Dividenden und Tranchen mit Stand. Mit `sicht` zu einem Stichtag (Valuta, Erfüllung) und Wissensstand (Erfassung).
 */
export async function ladeInstrumentUebersicht(tx: Tx, beteiligungId: string, sicht: { stichtag?: string | undefined; stand?: string | undefined } = {}) {
  const [b] = await tx.select().from(beteiligung).where(eq(beteiligung.id, beteiligungId));
  if (!b) return null;
  const rows = await tx
    .select({ i: instrument, rundeBezeichnung: finanzierungsrunde.bezeichnung, klasse: anteilsklasse.name })
    .from(instrument)
    .leftJoin(finanzierungsrunde, eq(finanzierungsrunde.id, instrument.rundeId))
    .leftJoin(anteilsklasse, eq(anteilsklasse.id, instrument.anteilsklasseId))
    .where(eq(instrument.beteiligungId, beteiligungId))
    .orderBy(asc(instrument.erstelltAm), asc(instrument.id));
  const standMs = sicht.stand === undefined ? null : new Date(sicht.stand).getTime();
  const vorgaenge = (await ladeVorgaenge(tx, beteiligungId)).filter((v) => (sicht.stichtag === undefined || v.valuta <= sicht.stichtag) && (standMs === null || v.erfasstAm.getTime() <= standMs));
  const tranchen = await ladeTranchenMitStand(tx, rows.map((r) => r.i.id), vorgaenge, sicht);
  const abgaenge = (await ladeVerkaufsdaten(tx, beteiligungId, sicht)).verkaeufe.filter((v) => v.zaehltBuchwertabgang && v.instrumentId !== null);
  const gewandelteIds = await ladeGewandelteZinsIds(tx, rows.map((r) => r.i.id));
  const haupt = (rows.find((r) => r.i.status === "aktiv") ?? rows[rows.length - 1])?.i.id ?? null;
  return rows.map(({ i, rundeBezeichnung, klasse }) => {
    const abgang = abgaenge.filter((v) => v.instrumentId === i.id).reduce((s, v) => s.plus(v.buchwertAbgang), new Decimal(0));
    const vorgaengeInstrument = vorgaengeDesInstruments(vorgaenge, i.id);
    const z = berechneZustand(vorgaengeInstrument, abgang);
    const gewandelt = gewandelteZinsen(vorgaengeInstrument, gewandelteIds);
    const darlehensartig = istDarlehensartig(i.art);
    return {
      id: i.id,
      beteiligungId: i.beteiligungId,
      art: i.art,
      bezeichnung: i.bezeichnung,
      status: i.status,
      istHauptinstrument: i.id === haupt,
      darlehensartig,
      runde: i.rundeId ? { id: i.rundeId, bezeichnung: rundeBezeichnung ?? "" } : null,
      anteilsklasse: i.anteilsklasseId ? { id: i.anteilsklasseId, name: klasse ?? "" } : null,
      felder: i.felder,
      /** Wandlungsparameter (leer = nicht erfasst); der Abschlag als Bruch (`0.200000` = 20 %), die Bewertungsobergrenze in der Währung der Beteiligung. */
      wandlungsabschlag: i.wandlungsabschlag,
      bewertungsobergrenze: i.bewertungsobergrenze,
      zinsenWandeln: i.zinsenWandeln,
      erstelltAm: i.erstelltAm,
      zusage: z.zusage.toFixed(2),
      ausgezahlt: z.investiert.toFixed(2),
      offeneZusage: z.zusage.minus(z.investiert).toFixed(2),
      offenesKapital: darlehensartig ? offenesKapital(z).toFixed(2) : null,
      tilgungen: z.tilgungen.toFixed(2),
      rueckfluesse: z.rueckfluesse.toFixed(2),
      kapitalisiert: z.kapitalisiert.toFixed(2),
      zinsen: z.zinsen.toFixed(2),
      wertberichtigungen: z.wertberichtigungen.toFixed(2),
      /** Bar eingegangene Zinsen (`zinszahlung`) und Dividenden; zählen zu den Rückflüssen der Kennzahlen. */
      gezahlteZinsen: z.zinszahlungen.toFixed(2),
      dividenden: z.dividenden.toFixed(2),
      /** Durch Wandlung beglichene Zinsen (in Anteile gewandelt). */
      gewandelteZinsen: gewandelt.toFixed(2),
      /** Offene Zinsen: gebucht ohne kapitalisierte und gewandelte, minus gezahlt. */
      offeneZinsen: z.zinsen.minus(z.kapitalisiert).minus(gewandelt).minus(z.zinszahlungen).toFixed(2),
      buchwertabgang: z.abgang.toFixed(2),
      buchwert: buchwertVon(z).wert.toFixed(2),
      tranchen: tranchen.filter((t) => t.instrumentId === i.id),
    };
  });
}
