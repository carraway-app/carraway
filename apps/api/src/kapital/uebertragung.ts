import { and, asc, eq, gte, inArray, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { anteilsuebertragung, beteiligung, finanzierungsrunde, fonds, instrument, optionsscheinAusuebung, organisation, rundenposition, vehikel, verkauf } from "@carraway/db";
import { Decimal, uebertragungKaufpreis } from "@carraway/rechenkern";
import type { Akteur } from "../anmeldung/akteur";
import { Fachfehler } from "../fehler";
import { bucheVorgang } from "../instrumente/buchen";
import { instrumenteVon, legeInstrumentAn, setzeInstrumentStatus } from "../instrumente/instrumente";
import { pruefeDatumsfenster } from "../instrumente/stichtag";
import { bucheVerkauf, storniereVerkauf, storniereVorgang } from "../instrumente/verkauf";
import { ladeBuchwertabgang } from "../instrumente/verkaeufe";
import { berechneZustand, buchwertVon, ladeVorgaenge, pruefePeriodensperre, sperreBeteiligung, vorgaengeDesInstruments } from "../instrumente/zustand";
import { heute, ladeFonds, ladeOrganisation, type Protokollant } from "../schreiben";
import { waehrungen } from "../waehrung/betrag";
import type { Tx } from "../zeitlimit";
import { ladeOderLegeBeteiligungAn, verlangeBearbeiterAm, verlangeRundenLeserecht, verlangeRundenrecht } from "./runden";
import { sichtbarFuer } from "./sichtbarkeit";
import { vehikelDerPosition } from "./vehikel";
import { haltername, ladeKapital, quelleZeileId, STAMM_ID, type Halter, type KapitalZeile } from "./wasserfall";

/**
 * Anteilsübertragung zwischen Gesellschaftern (Issue 151): Kauf und Verkauf von Anteilen, ohne neue Anteile zu schaffen. Die Quelle ist eine ausgegebene
 * Zeile der Kapitaltabelle zum Datum (Rundenposition, frühere Übertragung oder Stammanteile, angegeben als Id der Zeile); der Käufer ist ein Fonds dieser
 * Plattform oder ein Vehikel (ohne Vehikel: das Standard-Vehikel des Investors). Die Kapitaltabelle rechnet die Übertragung selbst (`kapital/wasserfall.ts`).
 *
 * Eigene Fonds:
 * - **Abgang:** Gehört die Quelle einem Fonds dieser Plattform, ist das ein Verkauf ihres Instruments (`bucheVerkauf` mit Instrument): Anteil = übertragene ÷
 *   am Datum gehaltene Anteile, Kaufpreis = Barzufluss, Buchwertabgang anteilig. Ein Verkauf aller Anteile setzt das Instrument auf „verkauft“.
 * - **Zugang:** Kauft ein Fonds dieser Plattform, entsteht ein Eigenkapital-Instrument (Klasse und Runde der Quelle) in seiner Beteiligung am Unternehmen
 *   (fehlt sie, wird sie angelegt) mit Zusage und Auszahlung des Kaufpreises über `bucheVorgang`. Der Kaufpreis geht so in Buchwert, IRR und Multiple ein.
 *
 * Beträge: Preis und Kaufpreis stehen in der Währung des Unternehmens. Weicht die Währung einer betroffenen Beteiligung von der Fondswährung ab, ist
 * `kaufpreisFonds` (gezahlter Betrag in der Fondswährung) Pflicht. Nach dem Schreiben müssen alle Übertragungen des Unternehmens ab dem Datum aufgehen
 * (eine rückdatierte Übertragung darf eine spätere nicht ungültig machen). Rechte: bearbeiter am Unternehmen (wie Runden) und an jedem eigenen Fonds.
 */

export interface UebertragungsEingabe {
  datum: string;
  /** Id der abgebenden Zeile der Kapitaltabelle: `stamm`, die Id einer Rundenposition, `uebertragung:<id>` oder `ausuebung:<id>` (ausgeübte Optionsscheine eines Fonds). */
  quelle: string;
  kaeuferFondsId?: string | undefined;
  kaeuferVehikelId?: string | undefined;
  /** Investor ohne Vehikel: dessen Standard-Vehikel. */
  kaeuferOrganisationId?: string | undefined;
  anzahl: string;
  preisJeAnteil: string;
  /** Gezahlter Betrag in der Fondswährung; nur, wenn ein eigener Fonds beteiligt ist und die Währung abweicht. */
  kaufpreisFonds?: string | undefined;
  bemerkung?: string | null | undefined;
}

const ungueltig = (meldung: string, zusatz: Record<string, unknown> = {}) => new Fachfehler(409, "share_transfer_invalid", meldung, zusatz);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Löst die Quelle auf: gehört sie zum Unternehmen? Liefert die Spalten der Übertragung. */
type Quelle = { quellePositionId: string | null; quelleUebertragungId: string | null; quelleAusuebungId: string | null };

async function loeseQuelle(tx: Tx, organisationId: string, quelle: string): Promise<Quelle> {
  const nicht = () => new Fachfehler(404, "share_transfer_source_not_found", "The transferring holding is not in the cap table on this date.", { quelle });
  const leer: Quelle = { quellePositionId: null, quelleUebertragungId: null, quelleAusuebungId: null };
  if (quelle === STAMM_ID) return leer;
  if (quelle.startsWith("uebertragung:")) {
    const id = quelle.slice("uebertragung:".length);
    if (!UUID.test(id)) throw nicht();
    const [u] = await tx.select({ id: anteilsuebertragung.id }).from(anteilsuebertragung).where(and(eq(anteilsuebertragung.id, id), eq(anteilsuebertragung.organisationId, organisationId), isNull(anteilsuebertragung.storniertAm)));
    if (!u) throw nicht();
    return { ...leer, quelleUebertragungId: u.id };
  }
  if (quelle.startsWith("ausuebung:")) {
    const id = quelle.slice("ausuebung:".length);
    if (!UUID.test(id)) throw nicht();
    const [a] = await tx
      .select({ id: optionsscheinAusuebung.id })
      .from(optionsscheinAusuebung)
      .innerJoin(instrument, eq(instrument.id, optionsscheinAusuebung.instrumentId))
      .innerJoin(beteiligung, eq(beteiligung.id, instrument.beteiligungId))
      .where(and(eq(optionsscheinAusuebung.id, id), eq(beteiligung.organisationId, organisationId), isNull(optionsscheinAusuebung.storniertAm)))
      .for("share", { of: optionsscheinAusuebung });
    if (!a) throw nicht();
    return { ...leer, quelleAusuebungId: a.id };
  }
  if (!UUID.test(quelle)) throw nicht();
  const [p] = await tx
    .select({ id: rundenposition.id })
    .from(rundenposition)
    .innerJoin(finanzierungsrunde, eq(finanzierungsrunde.id, rundenposition.rundeId))
    .where(and(eq(rundenposition.id, quelle), eq(finanzierungsrunde.organisationId, organisationId)));
  if (!p) throw nicht();
  return { ...leer, quellePositionId: p.id };
}

/** Instrument eines eigenen Fonds hinter einer Zeile: das der Rundenposition, das Optionsschein-Instrument der Ausübung oder das Zugangs-Instrument der früheren Übertragung. */
async function instrumentDerQuelle(tx: Tx, q: Quelle): Promise<string | null> {
  if (q.quelleAusuebungId) {
    const [a] = await tx.select({ instrumentId: optionsscheinAusuebung.instrumentId }).from(optionsscheinAusuebung).where(eq(optionsscheinAusuebung.id, q.quelleAusuebungId));
    return a?.instrumentId ?? null;
  }
  if (q.quellePositionId) {
    const [p] = await tx.select({ instrumentId: rundenposition.instrumentId }).from(rundenposition).where(eq(rundenposition.id, q.quellePositionId));
    return p?.instrumentId ?? null;
  }
  if (q.quelleUebertragungId) {
    const [u] = await tx.select({ instrumentId: anteilsuebertragung.kaeuferInstrumentId }).from(anteilsuebertragung).where(eq(anteilsuebertragung.id, q.quelleUebertragungId));
    return u?.instrumentId ?? null;
  }
  return null;
}

/**
 * Anteil am Bestand für den Verkauf, auf sechs Nachkommastellen (kaufmännisch) wie jeder Verkauf von Hand: Damit stimmen gespeicherter Anteil,
 * Buchwertabgang und Bemerkung überein. Unter dem ganzen Bestand nie 1, über null nie 0.
 */
export function anteilAmBestand(anzahl: Decimal, gehalten: Decimal): string {
  if (anzahl.equals(gehalten)) return "1";
  const anteil = anzahl.div(gehalten).toDecimalPlaces(6, Decimal.ROUND_HALF_UP);
  if (anteil.greaterThanOrEqualTo(1)) return "0.999999";
  if (anteil.isZero()) return "0.000001";
  return anteil.toFixed(6);
}

/** Optionsscheine eines Instruments, die noch nicht übertragen sind: Paket (`optionsscheinAnzahl`) abzüglich der aus seinen Ausübungen übertragenen Anteile. */
async function paketBestand(tx: Tx, instrumentId: string): Promise<Decimal> {
  const [i] = await tx.select({ anzahl: instrument.optionsscheinAnzahl }).from(instrument).where(eq(instrument.id, instrumentId));
  const uebertragen = await tx
    .select({ anzahl: anteilsuebertragung.anzahl })
    .from(anteilsuebertragung)
    .innerJoin(optionsscheinAusuebung, eq(optionsscheinAusuebung.id, anteilsuebertragung.quelleAusuebungId))
    .where(and(eq(optionsscheinAusuebung.instrumentId, instrumentId), isNull(anteilsuebertragung.storniertAm)));
  return uebertragen.reduce((s, x) => s.minus(x.anzahl), new Decimal(i?.anzahl ?? 0));
}

/**
 * Anteil am Buchwert des Optionsschein-Instruments, der mit übertragenen ausgeübten Anteilen abgeht: Anzahl × (Ausübungspreis der Ausübung + Kaufpreis je Schein).
 * Der Kaufpreis je Schein ist, was vom Buchwert nach Abzug der Ausübungsbeträge der noch gehaltenen ausgeübten Anteile auf das nicht übertragene Paket
 * entfällt. Nie 1, solange noch Optionsscheine im Paket sind (das Instrument bleibt aktiv); höchstens der ganze Buchwert.
 */
async function anteilAusAusuebung(tx: Tx, beteiligungId: string, instrumentId: string, ausuebungId: string, anzahl: Decimal): Promise<string> {
  const paket = await paketBestand(tx, instrumentId);
  const buchwert = buchwertVon(berechneZustand(vorgaengeDesInstruments(await ladeVorgaenge(tx, beteiligungId), instrumentId), await ladeBuchwertabgang(tx, beteiligungId, instrumentId))).wert;
  const ausuebungen = await tx.select().from(optionsscheinAusuebung).where(and(eq(optionsscheinAusuebung.instrumentId, instrumentId), isNull(optionsscheinAusuebung.storniertAm)));
  const uebertragen = await tx
    .select({ ausuebungId: anteilsuebertragung.quelleAusuebungId, anzahl: anteilsuebertragung.anzahl })
    .from(anteilsuebertragung)
    .where(and(inArray(anteilsuebertragung.quelleAusuebungId, ausuebungen.map((a) => a.id)), isNull(anteilsuebertragung.storniertAm)));
  const gehalten = ausuebungen.reduce((s, a) => {
    const weg = uebertragen.filter((u) => u.ausuebungId === a.id).reduce((x, u) => x.plus(u.anzahl), new Decimal(0));
    return s.plus(new Decimal(a.anzahl).minus(weg).times(a.preisJeAnteil));
  }, new Decimal(0));
  const ausuebung = ausuebungen.find((a) => a.id === ausuebungId)!;
  const kaufpreisJeSchein = paket.greaterThan(0) ? Decimal.max(0, buchwert.minus(gehalten).div(paket)) : new Decimal(0);
  const kosten = anzahl.times(new Decimal(ausuebung.preisJeAnteil).plus(kaufpreisJeSchein));
  if (!buchwert.greaterThan(0)) return anteilAmBestand(anzahl, paket);
  let anteil = kosten.div(buchwert).toDecimalPlaces(6, Decimal.ROUND_HALF_UP);
  if (anteil.isZero()) anteil = new Decimal("0.000001");
  if (anteil.greaterThanOrEqualTo(1)) return anzahl.equals(paket) ? "1" : "0.999999";
  return anteil.toFixed(6);
}

/** Prüft alle Übertragungen des Unternehmens ab `datum`: Jede muss zu ihrem Datum aufgehen. */
export async function pruefeFolgende(tx: Tx, organisationId: string, datum: string): Promise<void> {
  const zeilen = await tx.select({ datum: anteilsuebertragung.datum }).from(anteilsuebertragung).where(and(eq(anteilsuebertragung.organisationId, organisationId), gte(anteilsuebertragung.datum, datum), isNull(anteilsuebertragung.storniertAm)));
  for (const d of [...new Set(zeilen.map((x) => x.datum))].sort()) {
    const [f] = (await ladeKapital(tx, { fondsId: "", organisationId }, d)).uebertragungFehler;
    if (!f) continue;
    if (f.grund === "quelle_fehlt") throw new Fachfehler(404, "share_transfer_source_not_found", "The transferring holding is not in the cap table on this date.", { uebertragungId: f.uebertragungId, datum: d });
    throw new Fachfehler(409, "share_transfer_exceeds_holding", "The transferring holding holds fewer shares on this date.", { uebertragungId: f.uebertragungId, datum: d, verfuegbar: f.verfuegbar });
  }
}

export async function legeUebertragungAn(tx: Tx, protokoll: Protokollant, akteur: Akteur, organisationId: string, e: UebertragungsEingabe) {
  const org = await ladeOrganisation(tx, organisationId);
  // Übertragungen eines Unternehmens nacheinander: Die Prüfung der Bestände sieht so jede frühere.
  await tx.select({ id: organisation.id }).from(organisation).where(eq(organisation.id, org.id)).for("update");
  // Recht am Unternehmen selbst (ohne den Käuferfonds als Grundlage); dazu bearbeiter am Käuferfonds und am Fonds der abgebenden Position (unten).
  await verlangeRundenrecht(tx, akteur, org.id, "bearbeiter");
  pruefeDatumsfenster("date", e.datum, { bis: heute() });
  const kaeufer = [e.kaeuferFondsId, e.kaeuferVehikelId, e.kaeuferOrganisationId].filter(Boolean);
  if (kaeufer.length !== 1) {
    throw new Fachfehler(400, "invalid_input", "The input is invalid.", { felder: [{ feld: "buyerFundId", code: "one_buyer", meldung: "Specify exactly one buyer: fund, vehicle or investor" }] });
  }
  let kaeuferVehikelId: string | null = null;
  if (e.kaeuferFondsId) {
    await ladeFonds(tx, e.kaeuferFondsId);
    verlangeBearbeiterAm(akteur, e.kaeuferFondsId);
  } else {
    const v = await vehikelDerPosition(tx, protokoll, { vehikelId: e.kaeuferVehikelId, organisationId: e.kaeuferOrganisationId });
    if (v.investorId === org.id) throw ungueltig("The company cannot buy its own shares as a shareholder.");
    kaeuferVehikelId = v.id;
  }
  const q = await loeseQuelle(tx, org.id, e.quelle);
  const anzahl = new Decimal(e.anzahl);
  const kaufpreis = uebertragungKaufpreis(anzahl, e.preisJeAnteil).wert;

  // Bestand der Quelle zum Datum (mit allen früheren Übertragungen).
  const vorher = await ladeKapital(tx, { fondsId: e.kaeuferFondsId ?? "", organisationId: org.id }, e.datum);
  const zeile: KapitalZeile | undefined = vorher.zeilen.find((z) => z.ausgegeben && z.id === quelleZeileId(q));
  if (!zeile) throw new Fachfehler(404, "share_transfer_source_not_found", "The transferring holding is not in the cap table on this date.", { quelle: e.quelle, datum: e.datum });
  const gehalten = new Decimal(zeile.anteile);
  if (anzahl.greaterThan(gehalten)) throw new Fachfehler(409, "share_transfer_exceeds_holding", "The transferring holding holds fewer shares on this date.", { verfuegbar: gehalten.toFixed(0), datum: e.datum });
  const verkaeuferFondsId = zeile.halter.art === "fonds" ? zeile.halter.id : null;
  if ((e.kaeuferFondsId && e.kaeuferFondsId === verkaeuferFondsId) || (kaeuferVehikelId && kaeuferVehikelId === zeile.halter.vehikel?.id)) throw ungueltig("Buyer and seller are the same shareholder.");

  // Betrag in der Fondswährung für die Buchungen eines eigenen Fonds.
  const fondsBetrag = async (bet: { fondsId: string; waehrung: string | null }) => {
    const w = await waehrungen(tx, bet);
    if (w.lokal === w.fonds) return kaufpreis.toFixed(2);
    if (e.kaufpreisFonds === undefined) {
      throw new Fachfehler(400, "invalid_input", "The input is invalid.", { felder: [{ feld: "purchasePriceFundCurrency", code: "required", meldung: "If the currency differs, specify the amount paid in the fund currency" }] });
    }
    return new Decimal(e.kaufpreisFonds).toFixed(2);
  };

  // Abgang eines eigenen Fonds: Verkauf des Instruments der Quelle.
  let verkaufId: string | null = null;
  if (verkaeuferFondsId) {
    verlangeBearbeiterAm(akteur, verkaeuferFondsId);
    const instrumentId = await instrumentDerQuelle(tx, q);
    if (!instrumentId) throw ungueltig("The fund holding has no instrument; the disposal cannot be booked.", { quelle: e.quelle });
    const [i] = await tx
      .select({ beteiligungId: instrument.beteiligungId, fondsId: beteiligung.fondsId, waehrung: beteiligung.waehrung })
      .from(instrument)
      .innerJoin(beteiligung, eq(beteiligung.id, instrument.beteiligungId))
      .where(eq(instrument.id, instrumentId));
    if (!i) throw ungueltig("The fund holding has no instrument; the disposal cannot be booked.", { quelle: e.quelle });
    // Ausgeübte Optionsscheine: abgegeben werden die Anschaffungskosten der übertragenen Anteile (siehe `anteilAusAusuebung`).
    const anteilVerkauft = q.quelleAusuebungId ? await anteilAusAusuebung(tx, i.beteiligungId, instrumentId, q.quelleAusuebungId, anzahl) : anteilAmBestand(anzahl, gehalten);
    const ergebnis = await bucheVerkauf(tx, protokoll, i.beteiligungId, { datum: e.datum, kaufpreis: await fondsBetrag(i), anteilVerkauft, instrumentId });
    verkaufId = ergebnis.verkauf.id;
  }

  // Zugang eines eigenen Fonds: Instrument mit Klasse und Runde der Quelle, Zusage und Auszahlung des Kaufpreises.
  let kaeuferInstrumentId: string | null = null;
  if (e.kaeuferFondsId) {
    const b = await ladeOderLegeBeteiligungAn(tx, protokoll, e.kaeuferFondsId, org.id, e.datum, "offene_beteiligung");
    const neu = await legeInstrumentAn(tx, protokoll, b.id, { art: "offene_beteiligung", bezeichnung: `Anteile aus Übertragung ${e.datum}`, rundeId: zeile.runde?.id ?? null, anteilsklasseId: zeile.klasseId });
    kaeuferInstrumentId = neu.id;
    const [bet] = await tx.select({ fondsId: beteiligung.fondsId, waehrung: beteiligung.waehrung }).from(beteiligung).where(eq(beteiligung.id, b.id));
    const betrag = await fondsBetrag(bet!);
    if (new Decimal(betrag).greaterThan(0)) {
      const bemerkung = `Kauf von ${anzahl.toFixed(0)} Anteilen von ${haltername(zeile.halter)}`;
      for (const art of ["zusage", "auszahlung"] as const) await bucheVorgang(tx, protokoll, b.id, { art, valuta: e.datum, betrag, bemerkung, instrumentId: neu.id });
    }
  }

  const [u] = await tx
    .insert(anteilsuebertragung)
    .values({
      organisationId: org.id,
      datum: e.datum,
      ...q,
      kaeuferFondsId: e.kaeuferFondsId ?? null,
      kaeuferVehikelId,
      anzahl: anzahl.toFixed(0),
      preisJeAnteil: new Decimal(e.preisJeAnteil).toFixed(6),
      kaufpreis: kaufpreis.toFixed(2),
      verkaufId,
      kaeuferInstrumentId,
      bemerkung: e.bemerkung ?? null,
    })
    .returning();
  if (!u) throw new Error("Übertragung nicht angelegt");
  await protokoll("anlegen", "anteilsuebertragung", u.id, null, u);
  await pruefeFolgende(tx, org.id, e.datum);
  return u;
}

export type UebertragungAntwort = Awaited<ReturnType<typeof ladeUebertragungen>>[number];

/** Übertragungen eines Unternehmens (älteste zuerst) mit Verkäufer, Käufer und den Buchungen eigener Fonds. Rechte wie die Runden. */
export async function ladeUebertragungen(tx: Tx, akteur: Akteur, organisationId: string) {
  await ladeOrganisation(tx, organisationId);
  await verlangeRundenLeserecht(tx, akteur, organisationId);
  const liste = await tx
    .select({ u: anteilsuebertragung, fondsName: fonds.name, vehikelName: vehikel.name, investorId: organisation.id, investorName: organisation.name })
    .from(anteilsuebertragung)
    .leftJoin(fonds, eq(fonds.id, anteilsuebertragung.kaeuferFondsId))
    .leftJoin(vehikel, eq(vehikel.id, anteilsuebertragung.kaeuferVehikelId))
    .leftJoin(organisation, eq(organisation.id, vehikel.investorId))
    .where(eq(anteilsuebertragung.organisationId, organisationId))
    .orderBy(asc(anteilsuebertragung.datum), asc(anteilsuebertragung.erfasstAm), asc(anteilsuebertragung.id));
  // Verkäufer: Halter der Quelle (Fonds oder Investor der Rundenposition, Käufer der früheren Übertragung, Stammanteile).
  const investor = alias(organisation, "investor");
  const positionIds = liste.flatMap(({ u }) => (u.quellePositionId ? [u.quellePositionId] : []));
  const positionen = positionIds.length
    ? await tx
        .select({ id: rundenposition.id, fondsId: rundenposition.fondsId, fondsName: fonds.name, vehikelId: vehikel.id, vehikelName: vehikel.name, investorId: investor.id, investorName: investor.name })
        .from(rundenposition)
        .leftJoin(fonds, eq(fonds.id, rundenposition.fondsId))
        .leftJoin(vehikel, eq(vehikel.id, rundenposition.vehikelId))
        .leftJoin(investor, eq(investor.id, vehikel.investorId))
        .where(inArray(rundenposition.id, positionIds))
    : [];
  // Ausgeübte Optionsscheine als Quelle: der Fonds des Optionsschein-Instruments.
  const ausuebungIds = liste.flatMap(({ u }) => (u.quelleAusuebungId ? [u.quelleAusuebungId] : []));
  const ausuebungen = ausuebungIds.length
    ? await tx
        .select({ id: optionsscheinAusuebung.id, fondsId: fonds.id, fondsName: fonds.name })
        .from(optionsscheinAusuebung)
        .innerJoin(instrument, eq(instrument.id, optionsscheinAusuebung.instrumentId))
        .innerJoin(beteiligung, eq(beteiligung.id, instrument.beteiligungId))
        .innerJoin(fonds, eq(fonds.id, beteiligung.fondsId))
        .where(inArray(optionsscheinAusuebung.id, ausuebungIds))
    : [];
  const kaeuferJe = new Map<string, Halter>();
  // Fonds, an denen die Person den Bereich Portfolio nicht sieht: weder Name noch Preis, Verkauf oder Instrument (wie `kapital/sichtbarkeit.ts`).
  const sichtbar = sichtbarFuer(akteur);
  const verdeckt = (h: Halter | null) => h?.art === "fonds" && !sichtbar(h.id);
  const anonym = (h: Halter | null): Halter | null => (verdeckt(h) ? { art: "fonds", id: null, name: "", vehikel: null } : h);
  return liste.map(({ u, fondsName, vehikelName, investorId, investorName }) => {
    const kaeufer: Halter = u.kaeuferFondsId
      ? { art: "fonds", id: u.kaeuferFondsId, name: fondsName ?? "", vehikel: null }
      : { art: "organisation", id: investorId, name: investorName ?? "", vehikel: u.kaeuferVehikelId ? { id: u.kaeuferVehikelId, name: vehikelName ?? "" } : null };
    kaeuferJe.set(u.id, kaeufer);
    const p = positionen.find((x) => x.id === u.quellePositionId);
    const ausuebung = ausuebungen.find((x) => x.id === u.quelleAusuebungId);
    const verkaeufer: Halter | null = u.quelleUebertragungId
      ? (kaeuferJe.get(u.quelleUebertragungId) ?? null)
      : ausuebung
        ? { art: "fonds", id: ausuebung.fondsId, name: ausuebung.fondsName, vehikel: null }
        : p
        ? p.fondsId
          ? { art: "fonds", id: p.fondsId, name: p.fondsName ?? "", vehikel: null }
          : { art: "organisation", id: p.investorId, name: p.investorName ?? "", vehikel: p.vehikelId ? { id: p.vehikelId, name: p.vehikelName ?? "" } : null }
        : { art: "stamm", id: null, name: "", vehikel: null };
    const ohneDetails = verdeckt(verkaeufer) || verdeckt(kaeufer);
    return {
      id: u.id,
      organisationId: u.organisationId,
      datum: u.datum,
      quelle: verdeckt(verkaeufer) ? null : quelleZeileId(u),
      verkaeufer: anonym(verkaeufer),
      kaeufer: anonym(kaeufer)!,
      anzahl: new Decimal(u.anzahl).toFixed(0),
      preisJeAnteil: ohneDetails ? null : new Decimal(u.preisJeAnteil).toFixed(6),
      kaufpreis: ohneDetails ? null : u.kaufpreis,
      verkaufId: verdeckt(verkaeufer) ? null : u.verkaufId,
      kaeuferInstrumentId: verdeckt(kaeufer) ? null : u.kaeuferInstrumentId,
      bemerkung: ohneDetails ? null : u.bemerkung,
      erfasstAm: u.erfasstAm.toISOString(),
      storniertAm: u.storniertAm?.toISOString() ?? null,
    };
  });
}

/**
 * Storno einer Übertragung als Ganzes: Der Verkauf des abgebenden Fonds wird zurückgenommen (`storniereVerkauf`), Zusage und Auszahlung des Zugangs-Instruments
 * des Käuferfonds per Storno-Vorgang aufgehoben (das Instrument gilt dann als abgeschrieben), die Übertragung zählt nicht mehr. Nicht möglich, wenn eine spätere
 * Übertragung aus dem übertragenen Bestand abgibt (409 `share_transfer_reversal_dependent`) oder auf dem Zugangs-Instrument inzwischen anderes gebucht wurde
 * (409 `share_transfer_reversal_instrument_used`). Rechte wie beim Anlegen: bearbeiter am Unternehmen und an jedem beteiligten eigenen Fonds; gesperrte Perioden
 * stoppen den Storno.
 */
export async function storniereUebertragung(tx: Tx, protokoll: Protokollant, akteur: Akteur, organisationId: string, uebertragungId: string, grund: string) {
  const org = await ladeOrganisation(tx, organisationId);
  await tx.select({ id: organisation.id }).from(organisation).where(eq(organisation.id, org.id)).for("update");
  await verlangeRundenrecht(tx, akteur, org.id, "bearbeiter");
  const [u] = await tx.select().from(anteilsuebertragung).where(and(eq(anteilsuebertragung.id, uebertragungId), eq(anteilsuebertragung.organisationId, org.id))).for("update");
  if (!u) throw new Fachfehler(404, "share_transfer_not_found", "Share transfer not found.");
  if (u.storniertAm) throw new Fachfehler(409, "share_transfer_already_reversed", "The share transfer has already been reversed.");
  // Rechte an den eigenen Fonds beider Seiten.
  if (u.verkaufId) {
    const [v] = await tx.select({ fondsId: beteiligung.fondsId }).from(verkauf).innerJoin(beteiligung, eq(beteiligung.id, verkauf.beteiligungId)).where(eq(verkauf.id, u.verkaufId));
    if (v) verlangeBearbeiterAm(akteur, v.fondsId);
  }
  if (u.kaeuferFondsId) {
    verlangeBearbeiterAm(akteur, u.kaeuferFondsId);
    await pruefePeriodensperre(tx, u.kaeuferFondsId, u.datum);
  }

  const [abhaengig] = await tx
    .select({ id: anteilsuebertragung.id })
    .from(anteilsuebertragung)
    .where(and(eq(anteilsuebertragung.quelleUebertragungId, u.id), isNull(anteilsuebertragung.storniertAm)));
  if (abhaengig) throw new Fachfehler(409, "share_transfer_reversal_dependent", "A later share transfer gives up shares from this one; please reverse it first.", { uebertragungId: abhaengig.id });

  // Zugangs-Instrument des Käuferfonds: nur zurücknehmen, wenn darauf nichts gebucht wurde außer Zusage und Auszahlung der Übertragung.
  let kaeufer: { b: Awaited<ReturnType<typeof sperreBeteiligung>>; vorgaenge: Awaited<ReturnType<typeof ladeVorgaenge>>; instrument: Awaited<ReturnType<typeof instrumenteVon>>[number] } | null = null;
  if (u.kaeuferInstrumentId) {
    const [i0] = await tx.select({ beteiligungId: instrument.beteiligungId }).from(instrument).where(eq(instrument.id, u.kaeuferInstrumentId));
    if (i0) {
      const b = await sperreBeteiligung(tx, i0.beteiligungId);
      const i = (await instrumenteVon(tx, b.id)).find((x) => x.id === u.kaeuferInstrumentId);
      const alle = i ? vorgaengeDesInstruments(await ladeVorgaenge(tx, b.id), i.id) : [];
      // Schon aufgehobene Paare (zum Beispiel ein stornierter Verkauf aus einer späteren Übertragung) zählen nicht als Benutzung.
      const vorgaenge = alle.filter((x) => !x.storniertVorgangId && !alle.some((y) => y.storniertVorgangId === x.id));
      const [verkauft] = i ? await tx.select({ id: verkauf.id }).from(verkauf).where(and(eq(verkauf.instrumentId, i.id), isNull(verkauf.storniertAm))) : [];
      const unbenutzt = i && i.status === "aktiv" && !verkauft && vorgaenge.every((x) => x.art === "zusage" || x.art === "auszahlung") && vorgaenge.length <= 2;
      if (!i || !unbenutzt) {
        throw new Fachfehler(409, "share_transfer_reversal_instrument_used", "Bookings have already been made on the instrument of the buyer fund; the share transfer cannot be reversed.", { instrumentId: u.kaeuferInstrumentId });
      }
      kaeufer = { b, vorgaenge, instrument: i };
    }
  }

  // Die Übertragung zählt ab hier nicht mehr (der Storno des Verkaufs prüft das).
  const jetzt = new Date();
  const [nachher] = await tx.update(anteilsuebertragung).set({ storniertAm: jetzt, storniertVon: protokoll.akteur }).where(eq(anteilsuebertragung.id, u.id)).returning();
  const text = `Storno der Übertragung zum ${u.datum}: ${grund}`;
  if (u.verkaufId) await storniereVerkauf(tx, protokoll, u.verkaufId, text);
  if (kaeufer) {
    for (const art of ["auszahlung", "zusage"] as const) {
      for (const o of kaeufer.vorgaenge.filter((x) => x.art === art)) await storniereVorgang(tx, protokoll, kaeufer.b, o, text);
    }
    await setzeInstrumentStatus(tx, protokoll, kaeufer.instrument, "abgeschrieben");
  }
  await pruefeFolgende(tx, org.id, u.datum);
  await protokoll("stornieren", "anteilsuebertragung", u.id, u, { ...nachher, grund });
  return u.id;
}
