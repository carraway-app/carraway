import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Context } from "hono";
import { anteilsklasse, beteiligung, finanzierungsrunde, INSTRUMENT_BEZEICHNUNG, instrument, optionsscheinAusuebung, type instrumentArt, type instrumentStatus } from "@carraway/db";
import { Decimal, optionsscheinStand } from "@carraway/rechenkern";
import { Fachfehler } from "../fehler";
import { pruefeFelder } from "../crm/felder";
import { ladeDefinitionen } from "../felder/werte";
import type { Protokollant } from "../schreiben";
import type { Tx } from "../zeitlimit";
import { hauptinstrumentId } from "./hauptinstrument";
import { gewandelteZinsen, ladeGewandelteZinsIds } from "./zinsansicht";
import { ladeTranchenMitStand } from "./tranchen";
import { ladeBuchwertabgangJeInstrument } from "./verkaeufe";
import { berechneZustand, buchwertVon, istDarlehensartig, ladeVorgaenge, offenesKapital, sperreBeteiligung, vorgaengeDesInstruments, type BeteiligungZeile } from "./zustand";

/**
 * Instrumente einer Beteiligung (`docs/portfolio-modell.md`): lesen, anlegen, ändern, dem Vorgang das richtige Instrument zuordnen und den
 * Spiegel `beteiligung.instrument` / `instrument_felder` (das Hauptinstrument) nachführen, solange Excel, öffentliche API und Import ihn noch lesen.
 */

export type InstrumentZeile = typeof instrument.$inferSelect;
export type InstrumentArt = (typeof instrumentArt.enumValues)[number];
export type InstrumentStatus = (typeof instrumentStatus.enumValues)[number];

export const instrument_not_found = () => new Fachfehler(404, "instrument_not_found", "Instrument not found.");

/** Das Instrument laden (404, wenn es fehlt). */
export async function ladeInstrument(tx: Tx, id: string): Promise<InstrumentZeile> {
  const [zeile] = await tx.select().from(instrument).where(eq(instrument.id, id));
  if (!zeile) throw instrument_not_found();
  return zeile;
}

/** Sperrt die Beteiligung des Instruments (serialisiert alle Schreibwege) und lädt das Instrument danach mit Sperre. */
export async function sperreInstrument(tx: Tx, id: string): Promise<{ i: InstrumentZeile; b: BeteiligungZeile }> {
  const vorab = await ladeInstrument(tx, id);
  const b = await sperreBeteiligung(tx, vorab.beteiligungId);
  const [i] = await tx.select().from(instrument).where(eq(instrument.id, id)).for("update");
  if (!i) throw instrument_not_found();
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
    if (!anderswo) throw instrument_not_found();
    throw new Fachfehler(409, "instrument_wrong_investment", "The instrument belongs to a different investment.", { instrumentId: gewuenscht });
  }
  if (alle.length > 1) {
    throw new Fachfehler(400, "invalid_input", "The input is invalid.", {
      felder: [{ feld: "instrumentId", code: "instrument_required", meldung: "The investment has several instruments; the instrument must be given" }],
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
    throw new Fachfehler(400, "invalid_input", "The input is invalid.", {
      felder: [{ feld: "instrumentId", code: "instrument_required", meldung: "The investment has several loan-type instruments; the instrument must be given" }],
    });
  }
  return darlehen[0] ?? loeseInstrument(tx, b);
}

export function verlangeInstrumentAktiv(i: InstrumentZeile) {
  if (i.status !== "aktiv") throw new Fachfehler(409, "instrument_not_active", "The instrument is not active.", { instrumentId: i.id, status: i.status });
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
  if (!nachher) throw instrument_not_found();
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
  /** Wandlungsparameter (Wandeldarlehen und SAFE): Abschlag als Bruch, Bewertungsobergrenze als Betrag; Zinsen wandeln mit (nur Wandeldarlehen). */
  wandlungsabschlag?: string | null | undefined;
  bewertungsobergrenze?: string | null | undefined;
  zinsenWandeln?: boolean | null | undefined;
  /** Optionsschein: Zahl der Anteile, Ausübungspreis je Anteil, Ausgabe und Ende der Laufzeit. */
  optionsscheinAnzahl?: string | null | undefined;
  ausuebungspreis?: string | null | undefined;
  ausgabeAm?: string | null | undefined;
  laufzeitBis?: string | null | undefined;
}

/** Arten mit Wandlung in Anteile (Abschlag, Bewertungsobergrenze, `POST …/wandlung`): Wandeldarlehen und SAFE. */
export const WANDELBARE_ARTEN: ReadonlySet<InstrumentArt> = new Set<InstrumentArt>(["wandeldarlehen", "safe"]);

type Parameter = {
  wandlungsabschlag?: string | null | undefined;
  bewertungsobergrenze?: string | null | undefined;
  zinsenWandeln?: boolean | null | undefined;
  optionsscheinAnzahl?: string | null | undefined;
  ausuebungspreis?: string | null | undefined;
  ausgabeAm?: string | null | undefined;
  laufzeitBis?: string | null | undefined;
};
const gesetzt = (w: unknown) => (w ?? null) !== null;

/**
 * Parameter gehören zur Art (409); `null` und nicht angegeben sind immer erlaubt. Abschlag und Bewertungsobergrenze: Wandeldarlehen und SAFE;
 * „Zinsen wandeln“: nur Wandeldarlehen (ein SAFE hat keine Zinsen); Anzahl, Ausübungspreis, Ausgabe und Laufzeit: nur Optionsscheine.
 */
function pruefeParameter(art: InstrumentArt, e: Parameter): void {
  if (!WANDELBARE_ARTEN.has(art) && (gesetzt(e.wandlungsabschlag) || gesetzt(e.bewertungsobergrenze))) {
    throw new Fachfehler(409, "instrument_not_convertible_loan", "Discount and valuation cap exist only for convertible loans and SAFEs.", { art });
  }
  if (art !== "wandeldarlehen" && gesetzt(e.zinsenWandeln)) {
    throw new Fachfehler(409, "instrument_not_convertible_loan", "“Interest converts” exists only for convertible loans.", { art });
  }
  if (art !== "optionsschein" && (gesetzt(e.optionsscheinAnzahl) || gesetzt(e.ausuebungspreis) || gesetzt(e.ausgabeAm) || gesetzt(e.laufzeitBis))) {
    throw new Fachfehler(409, "instrument_not_warrant", "Number, exercise price, issue date and term exist only for warrants.", { art });
  }
}

/** Ausgabe und Laufzeit eines Optionsscheins: das Ende nicht vor der Ausgabe (400). */
function pruefeLaufzeit(ausgabeAm: string | null, laufzeitBis: string | null): void {
  if (ausgabeAm && laufzeitBis && laufzeitBis < ausgabeAm) {
    throw new Fachfehler(400, "invalid_input", "The input is invalid.", { felder: [{ feld: "laufzeitBis", code: "before_issue", meldung: "The end of the term is before the issue date" }] });
  }
}

/**
 * Arten, die einer Brückenrunde zugeordnet werden dürfen: Darlehen aller Art, der SAFE (Finanzierung zwischen zwei Runden ohne Anteile) und
 * Optionsscheine (oft Teil einer Venture-Debt-Finanzierung; Anteile entstehen erst mit der Ausübung).
 */
export const BRUECKEN_ARTEN: ReadonlySet<InstrumentArt> = new Set<InstrumentArt>(["darlehen", "wandeldarlehen", "venture_debt", "gesellschafterdarlehen", "safe", "optionsschein"]);

/** Runde und Anteilsklasse gehören zum Unternehmen der Beteiligung (404 / 409), liefert die Bezeichnung der Runde. */
async function pruefeBezug(tx: Tx, b: { organisationId: string }, rundeId: string | null | undefined, anteilsklasseId: string | null | undefined, art: InstrumentArt): Promise<string | null> {
  let rundenname: string | null = null;
  if (rundeId) {
    const [r] = await tx.select().from(finanzierungsrunde).where(eq(finanzierungsrunde.id, rundeId));
    if (!r) throw new Fachfehler(404, "round_not_found", "Financing round not found.");
    if (r.organisationId !== b.organisationId) throw new Fachfehler(409, "round_mismatch", "The round belongs to a different company than the investment.");
    // Eine Brückenrunde (Darlehen zwischen zwei Runden) nimmt nur Darlehensinstrumente auf, kein Eigenkapital.
    if (r.art === "bruecke" && !BRUECKEN_ARTEN.has(art)) {
      throw new Fachfehler(409, "instrument_round_bridge", "Only loans, convertible loans, venture debt, shareholder loans, SAFEs and warrants can be assigned to a bridge round.", { rundeId, art });
    }
    rundenname = r.bezeichnung;
  }
  if (anteilsklasseId) {
    const [k] = await tx.select().from(anteilsklasse).where(eq(anteilsklasse.id, anteilsklasseId));
    if (!k) throw new Fachfehler(404, "share_class_not_found", "Share class not found.");
    if (k.organisationId !== b.organisationId) throw new Fachfehler(409, "share_class_mismatch", "The class belongs to a different company than the investment.");
  }
  return rundenname;
}

/** Legt ein Instrument an (Beteiligung gesperrt). Bezeichnung: angegeben oder aus Art und Runde; der Spiegel der Beteiligung wird nachgeführt. */
export async function legeInstrumentAn(tx: Tx, protokoll: Protokollant, beteiligungId: string, e: NeuesInstrument): Promise<InstrumentZeile> {
  const b = await sperreBeteiligung(tx, beteiligungId);
  const rundenname = await pruefeBezug(tx, b, e.rundeId, e.anteilsklasseId, e.art);
  pruefeParameter(e.art, e);
  pruefeLaufzeit(e.ausgabeAm ?? null, e.laufzeitBis ?? null);
  if (e.art === "optionsschein" && (!gesetzt(e.optionsscheinAnzahl) || !gesetzt(e.ausuebungspreis))) {
    throw new Fachfehler(400, "invalid_input", "The input is invalid.", {
      felder: [
        ...(gesetzt(e.optionsscheinAnzahl) ? [] : [{ feld: "optionsscheinAnzahl", code: "required", meldung: "Warrants need the number of shares" }]),
        ...(gesetzt(e.ausuebungspreis) ? [] : [{ feld: "ausuebungspreis", code: "required", meldung: "Warrants need the exercise price" }]),
      ],
    });
  }
  const bezeichnung = e.bezeichnung ?? (rundenname ? `${INSTRUMENT_BEZEICHNUNG[e.art]} ${rundenname}` : INSTRUMENT_BEZEICHNUNG[e.art]);
  const [neu] = await tx
    .insert(instrument)
    .values({ beteiligungId, art: e.art, bezeichnung, rundeId: e.rundeId ?? null, anteilsklasseId: e.anteilsklasseId ?? null, status: e.status ?? "aktiv",
      felder: e.felder ?? {},
      wandlungsabschlag: e.wandlungsabschlag ?? null,
      bewertungsobergrenze: e.bewertungsobergrenze ?? null,
      zinsenWandeln: e.zinsenWandeln ?? null,
      optionsscheinAnzahl: e.optionsscheinAnzahl ?? null,
      ausuebungspreis: e.ausuebungspreis ?? null,
      ausgabeAm: e.ausgabeAm ?? null,
      laufzeitBis: e.laufzeitBis ?? null,
    })
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
  /** Wandlungsparameter (Wandeldarlehen und SAFE, „Zinsen wandeln“ nur Wandeldarlehen); `null` leert den Wert. */
  wandlungsabschlag?: string | null | undefined;
  bewertungsobergrenze?: string | null | undefined;
  zinsenWandeln?: boolean | null | undefined;
  /** Optionsschein; `null` leert den Wert (Anzahl und Ausübungspreis bleiben Pflicht). Nach einer Ausübung sind Anzahl und Preis gesperrt. */
  optionsscheinAnzahl?: string | null | undefined;
  ausuebungspreis?: string | null | undefined;
  ausgabeAm?: string | null | undefined;
  laufzeitBis?: string | null | undefined;
}

/** Ändert Bezeichnung, Runde, Anteilsklasse, Felder; die Art nur, solange das Instrument keine Vorgänge, Tranchen oder Konditionen hat. */
export async function aendereInstrument(tx: Tx, protokoll: Protokollant, c: Context, id: string, e: InstrumentAenderung): Promise<InstrumentZeile> {
  const { i: vorher, b } = await sperreInstrument(tx, id);
  const aenderung: Partial<typeof instrument.$inferInsert> = {};
  if (e.bezeichnung !== undefined) aenderung.bezeichnung = e.bezeichnung;
  if (e.art !== undefined && e.art !== vorher.art) {
    const { rows } = await tx.execute<{ n: number }>(sql`
      SELECT (SELECT count(*) FROM vorgang WHERE instrument_id = ${id}) + (SELECT count(*) FROM tranche WHERE instrument_id = ${id}) + (SELECT count(*) FROM darlehen_kondition WHERE instrument_id = ${id}) AS n`);
    if (Number(rows[0]?.n) > 0) throw new Fachfehler(409, "instrument_type_locked", "The type can no longer be changed: the instrument has transactions, tranches or terms.", { instrumentId: id });
    aenderung.art = e.art;
  }
  if (e.rundeId !== undefined || e.anteilsklasseId !== undefined || aenderung.art !== undefined) {
    // Bei geänderter Art gilt die Regel für die Runde, die das Instrument danach hat (auch die unveränderte).
    await pruefeBezug(tx, b, e.rundeId !== undefined ? e.rundeId : vorher.rundeId, e.anteilsklasseId, aenderung.art ?? vorher.art);
    if (e.rundeId !== undefined) aenderung.rundeId = e.rundeId;
    if (e.anteilsklasseId !== undefined) aenderung.anteilsklasseId = e.anteilsklasseId;
  }
  const artNachher = aenderung.art ?? vorher.art;
  pruefeParameter(artNachher, e);
  if (e.wandlungsabschlag !== undefined) aenderung.wandlungsabschlag = e.wandlungsabschlag;
  if (e.bewertungsobergrenze !== undefined) aenderung.bewertungsobergrenze = e.bewertungsobergrenze;
  if (e.zinsenWandeln !== undefined) aenderung.zinsenWandeln = e.zinsenWandeln;
  for (const feld of ["optionsscheinAnzahl", "ausuebungspreis", "ausgabeAm", "laufzeitBis"] as const) if (e[feld] !== undefined) aenderung[feld] = e[feld];
  // Wechselt die Art, entfallen die Parameter, die zur neuen Art nicht gehören.
  if (!WANDELBARE_ARTEN.has(artNachher)) {
    if (vorher.wandlungsabschlag !== null) aenderung.wandlungsabschlag = null;
    if (vorher.bewertungsobergrenze !== null) aenderung.bewertungsobergrenze = null;
  }
  if (artNachher !== "wandeldarlehen" && vorher.zinsenWandeln !== null) aenderung.zinsenWandeln = null;
  if (artNachher !== "optionsschein") for (const feld of ["optionsscheinAnzahl", "ausuebungspreis", "ausgabeAm", "laufzeitBis"] as const) if (vorher[feld] !== null) aenderung[feld] = null;
  if (artNachher === "optionsschein") {
    const anzahl = aenderung.optionsscheinAnzahl !== undefined ? aenderung.optionsscheinAnzahl : vorher.optionsscheinAnzahl;
    const preis = aenderung.ausuebungspreis !== undefined ? aenderung.ausuebungspreis : vorher.ausuebungspreis;
    if (anzahl === null || preis === null) {
      throw new Fachfehler(400, "invalid_input", "The input is invalid.", { felder: [{ feld: anzahl === null ? "optionsscheinAnzahl" : "ausuebungspreis", code: "required", meldung: "Warrants need the number of shares and the exercise price" }] });
    }
    pruefeLaufzeit(aenderung.ausgabeAm !== undefined ? aenderung.ausgabeAm : vorher.ausgabeAm, aenderung.laufzeitBis !== undefined ? aenderung.laufzeitBis : vorher.laufzeitBis);
    await pruefeOptionsscheinAenderung(tx, vorher, aenderung);
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
  if (!nachher) throw instrument_not_found();
  await protokoll("aendern", "instrument", id, vorher, nachher);
  await synchronisiereHauptinstrument(tx, vorher.beteiligungId);
  return nachher;
}

/**
 * Optionsscheine mit Ausübungen: Die Anzahl darf nicht unter die ausgeübten Anteile fallen, die Laufzeit muss alle Ausübungen einschließen (409).
 * Der Ausübungspreis bleibt änderbar; jede Ausübung hält ihren Preis selbst fest.
 */
async function pruefeOptionsscheinAenderung(tx: Tx, vorher: InstrumentZeile, aenderung: Partial<typeof instrument.$inferInsert>): Promise<void> {
  const ausuebungen = await tx.select().from(optionsscheinAusuebung).where(and(eq(optionsscheinAusuebung.instrumentId, vorher.id), isNull(optionsscheinAusuebung.storniertAm)));
  if (ausuebungen.length === 0) return;
  const ausgeuebt = ausuebungen.reduce((s, a) => s.plus(a.anzahl), new Decimal(0));
  const anzahl = aenderung.optionsscheinAnzahl ?? vorher.optionsscheinAnzahl;
  const ausgabe = aenderung.ausgabeAm !== undefined ? aenderung.ausgabeAm : vorher.ausgabeAm;
  const ende = aenderung.laufzeitBis !== undefined ? aenderung.laufzeitBis : vorher.laufzeitBis;
  const daten = ausuebungen.map((a) => a.datum).sort();
  if ((anzahl !== null && anzahl !== undefined && ausgeuebt.greaterThan(anzahl)) || (ausgabe && daten[0]! < ausgabe) || (ende && daten.at(-1)! > ende)) {
    throw new Fachfehler(409, "warrant_exercised", "Number and term must include the recorded exercises.", { ausgeuebt: ausgeuebt.toFixed(0), ersteAusuebung: daten[0], letzteAusuebung: daten.at(-1) });
  }
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
  // Buchwertabgang je Instrument: eigene Verkäufe und der anteilige Teil an Verkäufen der ganzen Beteiligung (Summe = Abgang der Beteiligung).
  const abgaenge = await ladeBuchwertabgangJeInstrument(tx, beteiligungId, sicht);
  const gewandelteIds = await ladeGewandelteZinsIds(tx, rows.map((r) => r.i.id));
  const optionsIds = rows.filter((r) => r.i.art === "optionsschein").map((r) => r.i.id);
  const ausuebungen = optionsIds.length
    ? (await tx.select().from(optionsscheinAusuebung).where(and(inArray(optionsscheinAusuebung.instrumentId, optionsIds), isNull(optionsscheinAusuebung.storniertAm))).orderBy(asc(optionsscheinAusuebung.datum), asc(optionsscheinAusuebung.erfasstAm), asc(optionsscheinAusuebung.id))).filter(
        (a) => (sicht.stichtag === undefined || a.datum <= sicht.stichtag) && (standMs === null || a.erfasstAm.getTime() <= standMs),
      )
    : [];
  const stichtagOptionen = sicht.stichtag ?? new Date().toISOString().slice(0, 10);
  const haupt = (rows.find((r) => r.i.status === "aktiv") ?? rows[rows.length - 1])?.i.id ?? null;
  return rows.map(({ i, rundeBezeichnung, klasse }) => {
    const abgang = abgaenge.get(i.id) ?? new Decimal(0);
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
      /** Nur Optionsscheine (sonst `null`): Bedingungen, Stand zum Stichtag (ohne Angabe heute) und die Ausübungen. */
      optionsschein: i.art === "optionsschein" && i.optionsscheinAnzahl !== null && i.ausuebungspreis !== null ? optionsscheinAntwort(i, ausuebungen.filter((a) => a.instrumentId === i.id), stichtagOptionen) : null,
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

/** Optionsschein in der Übersicht: Bedingungen, Stand zum Stichtag (Rechenkern `optionsscheinStand`) und die Ausübungen. */
function optionsscheinAntwort(i: InstrumentZeile, ausuebungen: (typeof optionsscheinAusuebung.$inferSelect)[], stichtag: string) {
  const bedingungen = { anzahl: i.optionsscheinAnzahl!, ausuebungspreis: i.ausuebungspreis!, ausgabeAm: i.ausgabeAm, laufzeitBis: i.laufzeitBis };
  const stand = optionsscheinStand(bedingungen, ausuebungen, stichtag);
  return {
    anzahl: new Decimal(i.optionsscheinAnzahl!).toFixed(0),
    ausuebungspreis: new Decimal(i.ausuebungspreis!).toFixed(4),
    ausgabeAm: i.ausgabeAm,
    laufzeitBis: i.laufzeitBis,
    stichtag,
    ausgeuebt: stand.wert.ausgeuebt.toFixed(0),
    offen: stand.wert.offen.toFixed(0),
    verfallen: stand.wert.verfallen.toFixed(0),
    status: stand.wert.status,
    schritte: stand.schritte,
    ausuebungen: ausuebungen.map((a) => ({ id: a.id, datum: a.datum, anzahl: new Decimal(a.anzahl).toFixed(0), preisJeAnteil: new Decimal(a.preisJeAnteil).toFixed(4), betrag: a.betrag, zusageVorgangId: a.zusageVorgangId, auszahlungVorgangId: a.auszahlungVorgangId, bemerkung: a.bemerkung })),
  };
}
