import { and, asc, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import {
  anteilsuebertragung,
  beteiligung,
  bewertung,
  darlehenKondition,
  forderung,
  instrument,
  kaufpreisanpassung,
  verkauf,
  vorgang,
  wandlung,
  zinsperiodeGebucht,
  type Db,
} from "@carraway/db";
import { Decimal, berichtigungBeiVerkauf, kapitalAnErwerber, verteileBuchwertabgang, verkaufsergebnis } from "@carraway/rechenkern";
import type { Rechenschritt } from "@carraway/rechenkern";
import { Fachfehler } from "../fehler";
import { heute, ladeOrganisation, type Protokollant } from "../schreiben";
import type { Tx } from "../zeitlimit";
import { letzteBewertung, nimmBewertungZurueck, setzeBewertung } from "./bewertung";
import { hauptinstrumentId, legeHauptinstrumentAn } from "./hauptinstrument";
import { pruefeNachBuchung } from "./buchen";
import { instrumenteVon, legeInstrumentAn, loeseInstrument, setzeInstrumentStatus, type InstrumentZeile } from "./instrumente";
import { korrigiereNullperioden } from "./zinsperioden";
import { berechneAbgrenzung, ladeZinskontexte } from "./zinsen";
import { alsJson } from "./wandlung";
import { pruefeDatumsfenster, pruefeStichtag } from "./stichtag";
import { ladeBuchwertabgang, ladeBuchwertabgangJeInstrument } from "./verkaeufe";
import { berechneZustand, buchwertVon, istDarlehensartig, offenesKapital, ladeVorgaenge, pruefePeriodensperre, sperreBeteiligung, verlangeAktiv, vorgaengeDesInstruments, alsFachfehler, type BeteiligungZeile, type VorgangDaten } from "./zustand";
import { ordneRundeZu } from "./vorgang-runde";

/**
 * Verkauf einer Beteiligung: Planung (gemeinsam für Vorschau und Buchung) und Storno des ganzen Verkaufs.
 * Die Vorschau schreibt nichts und liefert dieselbe Auswertung wie die Buchung (Entwurf der Antwort `ergebnis`).
 */

/** Begründung der Bewertung eines Verkäuferdarlehens (erkennt sie beim Storno des Verkaufs wieder). */
export const VERKAEUFERDARLEHEN_BEGRUENDUNG = "Verkäuferdarlehen zu Anschaffungskosten";

export interface VerkaufsEingabe {
  datum: string;
  kaufpreis: string;
  kosten?: string | undefined;
  treuhand?: { betrag: string; freigabeAm: string } | undefined;
  verkaeuferdarlehen?: { betrag: string; satz: string; methode: "30E/360" | "act/360" | "act/365" | "act/act"; faelligAm: string; schuldnerOrganisationId?: string | undefined } | undefined;
  anteilVerkauft: string;
  /** Nur dieses Instrument verkaufen; ohne Angabe wird die ganze Beteiligung (alle aktiven Instrumente) verkauft. */
  instrumentId?: string | undefined;
}

export interface Verkaufsauswertung {
  principalDisposed: string;
  buchwertVorher: string;
  buchwertAbgang: string;
  erloes: string;
  ergebnis: string;
  barzufluss: string;
  schritte: Rechenschritt[];
}

export interface Verkaufsplan {
  berichtigungen: { instrumentId: string; betrag: string }[];
  schlusszinsen: { instrumentId: string; betrag: string }[];
  kapitalabgaenge: { instrumentId: string; betrag: string }[];
  auswertung: Verkaufsauswertung;
  buchwert: Decimal;
  buchwertAbgang: Decimal;
  erloes: Decimal;
  ergebnis: Decimal;
  treuhand: Decimal;
  verkaeuferdarlehen: Decimal;
  bar: Decimal;
  voll: boolean;
  kennung: string;
  /** Schuldner des Verkäuferdarlehens, falls eines gebucht wird. */
  schuldner: string | null;
  /** Das verkaufte Instrument; `null` beim Verkauf der ganzen Beteiligung. */
  instrument: InstrumentZeile | null;
  /** Die bestehende Beteiligung des Fonds am Schuldner, falls es eine gibt (das Verkäuferdarlehen kommt als weiteres Instrument dazu). */
  schuldnerBeteiligungId: string | null;
}

/**
 * Prüft den Verkauf und rechnet ihn durch, ohne zu schreiben. `b` muss in der Buchung gesperrt sein (in der Vorschau nicht nötig).
 * Fehler sind dieselben wie bei der Buchung.
 */
export async function planeVerkauf(tx: Tx, b: BeteiligungZeile, e: VerkaufsEingabe): Promise<Verkaufsplan> {
  verlangeAktiv(b);
  await pruefePeriodensperre(tx, b.fondsId, e.datum);
  await pruefeStichtag(tx, b.fondsId, e.datum, "datum");
  if (e.verkaeuferdarlehen) pruefeDatumsfenster("verkaeuferdarlehen.faelligAm", e.verkaeuferdarlehen.faelligAm, { von: e.datum });
  const vorgaenge = await ladeVorgaenge(tx, b.id);
  let verkauftes: InstrumentZeile | null = null;
  if (e.instrumentId) {
    verkauftes = await loeseInstrument(tx, b, e.instrumentId);
    if (verkauftes.status !== "aktiv") throw new Fachfehler(409, "instrument_not_active", "The instrument is not active.", { instrumentId: verkauftes.id, status: verkauftes.status });
  }
  const darlehen = (verkauftes ? [verkauftes] : await instrumenteVon(tx, b.id)).filter((i) => i.status === "aktiv" && istDarlehensartig(i.art));
  const abgaenge = darlehen.map((i) => {
    const eigene = vorgaengeDesInstruments(vorgaenge, i.id);
    const aufgehoben = new Set(eigene.map((v) => v.storniertVorgangId));
    if (eigene.some((v) => !v.storniertVorgangId && !aufgehoben.has(v.id) && v.valuta > e.datum && ["tilgung", "auszahlung", "zins", "principal_disposal", "wertberichtigung", "interest_waiver"].includes(v.art))) {
      throw new Fachfehler(409, "loan_event_dependent", "Later loan transactions must be resolved before the sale.");
    }
    return { id: i.id, abgang: kapitalAnErwerber(offenesKapital(berechneZustand(eigene)), e.anteilVerkauft, i.id) };
  });
  const schlusszinsen: { instrumentId: string; betrag: string }[] = [];
  if (new Decimal(e.anteilVerkauft).eq(1) && darlehen.length) {
    for (const k of await ladeZinskontexte(tx, { instrumentIds: darlehen.map((i) => i.id) })) {
      const a = berechneAbgrenzung(k, e.datum);
      if (a && new Decimal(a.gesamt).gt(0)) schlusszinsen.push({ instrumentId: k.instrument.id, betrag: a.gesamt });
    }
  }
  const z = verkauftes
    ? berechneZustand(vorgaengeDesInstruments(vorgaenge, verkauftes.id), await ladeBuchwertabgang(tx, b.id, verkauftes.id))
    : berechneZustand(vorgaenge, await ladeBuchwertabgang(tx, b.id));
  const buch = buchwertVon(z);
  const rechnung = alsFachfehler(b.id, () => verkaufsergebnis({ buchwert: buch.wert, anteilVerkauft: e.anteilVerkauft, kaufpreis: e.kaufpreis, kosten: e.kosten ?? 0 }));
  const berichtigungen: { instrumentId: string; betrag: string }[] = [];
  if (abgaenge.length) {
    const bisher = await ladeBuchwertabgangJeInstrument(tx, b.id, {}, vorgaenge);
    const ids = [...new Set(vorgaenge.map((v) => v.instrumentId).filter((id): id is string => !!id))].sort();
    const staende = new Map(ids.map((id) => [id, berechneZustand(vorgaengeDesInstruments(vorgaenge, id), bisher.get(id))]));
    const buchwerte = [...staende].map(([id, stand]) => ({ id, buchwert: buchwertVon(stand).wert }));
    const anteile = verkauftes ? [{ id: verkauftes.id, abgang: rechnung.wert.buchwertAbgang }] : verteileBuchwertabgang(rechnung.wert.buchwertAbgang, buchwerte).wert;
    for (const a of abgaenge) {
      const betrag = berichtigungBeiVerkauf(a.abgang.wert, anteile.find((i) => i.id === a.id)?.abgang ?? new Decimal(0), staende.get(a.id)?.wertberichtigungen ?? new Decimal(0));
      if (betrag.gt(0)) berichtigungen.push({ instrumentId: a.id, betrag: betrag.toFixed(2) });
    }
  }
  const treuhand = new Decimal(e.treuhand?.betrag ?? 0);
  const vkd = new Decimal(e.verkaeuferdarlehen?.betrag ?? 0);
  const bar = rechnung.wert.erloes.minus(treuhand).minus(vkd);
  if (bar.isNegative()) {
    throw new Fachfehler(409, "sale_invalid", "The escrow amount and vendor loan exceed the proceeds.", {
      erloes: rechnung.wert.erloes.toFixed(2),
      treuhand: treuhand.toFixed(2),
      verkaeuferdarlehen: vkd.toFixed(2),
    });
  }
  let schuldner: string | null = null;
  let schuldnerBeteiligungId: string | null = null;
  if (e.verkaeuferdarlehen) {
    schuldner = e.verkaeuferdarlehen.schuldnerOrganisationId ?? b.organisationId;
    await ladeOrganisation(tx, schuldner);
    const [vorhanden] = await tx.select({ id: beteiligung.id }).from(beteiligung).where(and(eq(beteiligung.fondsId, b.fondsId), eq(beteiligung.organisationId, schuldner)));
    if (vorhanden) {
      schuldnerBeteiligungId = vorhanden.id;
      // Das Verkäuferdarlehen kommt als weiteres Darlehen-Instrument in die Beteiligung; ein schon gehaltenes Darlehen des Verkaufs bleibt ein Fehler (wie bisher).
      const [doppelt] = await tx.select({ id: instrument.id }).from(instrument).where(and(eq(instrument.beteiligungId, vorhanden.id), eq(instrument.art, "darlehen")));
      if (doppelt) {
        throw new Fachfehler(409, "investment_exists", "The fund already holds a loan to this debtor; please specify a different debtor.", { beteiligungId: vorhanden.id });
      }
    }
  }
  return {
    berichtigungen,
    schlusszinsen,
    kapitalabgaenge: abgaenge.filter((a) => a.abgang.wert.gt(0)).map((a) => ({ instrumentId: a.id, betrag: a.abgang.wert.toFixed(2) })),
    auswertung: {
      principalDisposed: abgaenge.reduce((s, x) => s.plus(x.abgang.wert), new Decimal(0)).toFixed(2),
      buchwertVorher: buch.wert.toFixed(2),
      buchwertAbgang: rechnung.wert.buchwertAbgang.toFixed(2),
      erloes: rechnung.wert.erloes.toFixed(2),
      ergebnis: rechnung.wert.ergebnis.toFixed(2),
      barzufluss: bar.toFixed(2),
      schritte: [...buch.schritte, ...rechnung.schritte, ...abgaenge.flatMap((a) => a.abgang.schritte), ...berichtigungen.map((s) => ({ zeichen: "=" as const, bezeichnung: "Abgegangene Wertberichtigung", wert: s.betrag, quellen: [s.instrumentId] })), ...schlusszinsen.map((s) => ({ zeichen: "=" as const, bezeichnung: "Offene Zinsen bis zum Verkaufstag", wert: s.betrag, quellen: [s.instrumentId] }))],
    },
    buchwert: buch.wert,
    buchwertAbgang: rechnung.wert.buchwertAbgang,
    erloes: rechnung.wert.erloes,
    ergebnis: rechnung.wert.ergebnis,
    treuhand,
    verkaeuferdarlehen: vkd,
    bar,
    voll: new Decimal(e.anteilVerkauft).equals(1),
    kennung: `Verkauf zum ${e.datum} (Anteil ${e.anteilVerkauft})`,
    schuldner,
    instrument: verkauftes,
    schuldnerBeteiligungId,
  };
}

/** Storno-Vorgang zu einem vorhandenen Vorgang (Valuta: heute, mindestens die des Originals). Prüft die Invarianten außer bei Rückflüssen. */
export async function storniereVorgang(tx: Tx, protokoll: Protokollant, b: BeteiligungZeile, original: VorgangDaten, grund: string) {
  const vorhandene = await ladeVorgaenge(tx, b.id);
  if (original.storniertVorgangId || vorhandene.some((v) => v.storniertVorgangId === original.id)) return null;
  const heutigerTag = heute();
  const valuta = original.verzichtId || original.darlehensverkaufId ? original.valuta : (heutigerTag > original.valuta ? heutigerTag : original.valuta);
  await pruefePeriodensperre(tx, b.fondsId, valuta);
  const neu = {
    beteiligungId: b.id,
    art: original.art,
    valuta,
    betrag: new Decimal(original.betrag).neg().toFixed(2),
    bemerkung: `Storno: ${grund}`,
    kapitalisiert: original.kapitalisiert,
    storniertVorgangId: original.id,
    instrumentId: original.instrumentId ?? (await hauptinstrumentId(tx, b.id)),
    trancheId: original.trancheId,
    verzichtId: original.verzichtId,
    darlehensverkaufId: original.darlehensverkaufId,
    zinsverzichtBis: original.zinsverzichtBis,
    felder: original.felder ?? {},
    betragLokal: original.betragLokal == null ? null : new Decimal(original.betragLokal).neg().toFixed(2),
    kurs: original.kurs ?? null,
    kursId: original.kursId ?? null,
  };
  if (original.art !== "rueckfluss") {
    const abgang = await ladeBuchwertabgang(tx, b.id);
    const [instr] = await tx.select().from(instrument).where(eq(instrument.id, neu.instrumentId));
    if (instr) pruefeNachBuchung(b.id, instr, vorhandene, neu, abgang);
  }
  const [storno] = await tx.insert(vorgang).values(neu).returning();
  if (!storno) throw new Error("Storno nicht angelegt");
  await protokoll("storno", "vorgang", original.id, original, { grund, stornoVorgangId: storno.id });
  await protokoll("anlegen", "vorgang", storno.id, null, storno);
  await ordneRundeZu(tx, protokoll, storno);
  return storno;
}

/**
 * Storniert einen ganzen Verkauf: Rückfluss (und Kaufpreisanpassungen, erfüllte Forderungen) per Storno-Vorgang, Buchwertabgang
 * fällt weg, Status zurück auf aktiv (bei vollem Verkauf), Bewertung des Verkaufs wird zurückgenommen (bzw. die ersetzte wiederhergestellt),
 * offene Forderungen (Treuhand) entfallen, ein nicht benutztes Verkäuferdarlehen wird mit zurückgenommen.
 */
export async function storniereVerkauf(tx: Tx, protokoll: Protokollant, verkaufId: string, grund: string) {
  const [vorab] = await tx.select().from(verkauf).where(eq(verkauf.id, verkaufId));
  if (!vorab) throw new Fachfehler(404, "sale_not_found", "Sale not found.");
  const b = await sperreBeteiligung(tx, vorab.beteiligungId);
  const [v] = await tx.select().from(verkauf).where(eq(verkauf.id, verkaufId)).for("update");
  if (!v) throw new Fachfehler(404, "sale_not_found", "Sale not found.");
  const [ausUebertragung] = await tx.select({ id: anteilsuebertragung.id }).from(anteilsuebertragung).where(and(eq(anteilsuebertragung.verkaufId, v.id), isNull(anteilsuebertragung.storniertAm)));
  if (ausUebertragung) throw new Fachfehler(409, "reversal_not_allowed", "The sale belongs to a share transfer; it cannot be reversed on its own.", { uebertragungId: ausUebertragung.id });
  if (v.storniertAm) throw new Fachfehler(409, "sale_already_reversed", "The sale has already been reversed.");
  // Der Storno nimmt die Bewertung des Verkaufstags zurück und hebt den Buchwertabgang auf: in gesperrter Periode nicht erlaubt.
  await pruefePeriodensperre(tx, b.fondsId, v.datum);

  const [spaeterer] = await tx
    .select({ id: verkauf.id })
    .from(verkauf)
    .where(and(eq(verkauf.beteiligungId, b.id), isNull(verkauf.storniertAm), ne(verkauf.id, v.id)))
    .orderBy(desc(verkauf.datum), desc(verkauf.erfasstAm));
  if (spaeterer) {
    const [andere] = await tx.select().from(verkauf).where(eq(verkauf.id, spaeterer.id));
    if (andere && (andere.datum > v.datum || (andere.datum === v.datum && andere.erfasstAm > v.erfasstAm))) {
      throw new Fachfehler(409, "sale_reversal_later_sale", "There is a later sale of this investment; please reverse it first.", { verkaufId: andere.id });
    }
  }

  // Verkäuferdarlehen: nur zurücknehmen, wenn auf dem Darlehen-Instrument nichts gebucht wurde außer Zusage und Auszahlung des Verkaufs
  let darlehen: BeteiligungZeile | null = null;
  let darlehenInstrument: InstrumentZeile | null = null;
  if (v.verkaeuferdarlehenBeteiligungId) {
    darlehen = await sperreBeteiligung(tx, v.verkaeuferdarlehenBeteiligungId);
    const instrumentId = v.verkaeuferdarlehenInstrumentId ?? (await hauptinstrumentId(tx, darlehen.id));
    darlehenInstrument = (await instrumenteVon(tx, darlehen.id)).find((i) => i.id === instrumentId) ?? null;
    const vorgaenge = vorgaengeDesInstruments(await ladeVorgaenge(tx, darlehen.id), instrumentId);
    const [gewandelt] = await tx.select({ id: wandlung.id }).from(wandlung).where(eq(wandlung.quellInstrumentId, instrumentId));
    const [gebucht] = await tx.select({ id: zinsperiodeGebucht.id }).from(zinsperiodeGebucht).where(eq(zinsperiodeGebucht.instrumentId, instrumentId));
    const unbenutzt =
      vorgaenge.length === 2 &&
      vorgaenge.every((x) => (x.art === "zusage" || x.art === "auszahlung") && !x.storniertVorgangId) &&
      !gewandelt &&
      !gebucht &&
      darlehenInstrument?.status === "aktiv" &&
      darlehen.status === "aktiv";
    if (!unbenutzt) {
      throw new Fachfehler(409, "sale_reversal_loan_used", "Bookings have already been made on the vendor loan; the sale cannot be reversed.", { beteiligungId: darlehen.id });
    }
  }

  // Rückflüsse: Barzufluss, Kaufpreisanpassungen, erfüllte Forderungen
  const anpassungen = await tx.select().from(kaufpreisanpassung).where(eq(kaufpreisanpassung.verkaufId, v.id)).orderBy(asc(kaufpreisanpassung.datum));
  const forderungen = await tx.select().from(forderung).where(eq(forderung.verkaufId, v.id)).orderBy(asc(forderung.faelligAm));
  const eigeneBuchungen = await ladeVorgaenge(tx, b.id);
  const aufgehoben = new Set(eigeneBuchungen.map((g) => g.storniertVorgangId));
  const abgehendeInstrumente = new Set(eigeneBuchungen.filter((g) => g.darlehensverkaufId === v.id).map((g) => g.instrumentId));
  if (eigeneBuchungen.some((g) => abgehendeInstrumente.has(g.instrumentId) && g.darlehensverkaufId !== v.id && g.erfasstAm > v.erfasstAm && !g.storniertVorgangId && !aufgehoben.has(g.id) && (g.verzichtId || g.art === "zins" || g.art === "zinszahlung"))) {
    throw new Fachfehler(409, "reversal_not_allowed", "Reverse dependent loan interest or waivers before reversing the sale.");
  }
  const abgaenge = await tx.select({ id: vorgang.id }).from(vorgang).where(eq(vorgang.darlehensverkaufId, v.id));
  const vorgangIds = [...abgaenge.map((a) => a.id), v.rueckflussVorgangId, ...anpassungen.map((a) => a.vorgangId), ...forderungen.map((f) => f.vorgangId)].filter((x): x is string => x !== null);
  const originale = vorgangIds.length ? await tx.select().from(vorgang).where(inArray(vorgang.id, vorgangIds)) : [];
  const stornos: string[] = [];
  for (const o of originale) {
    const s = await storniereVorgang(tx, protokoll, b, o, `Storno des Verkaufs zum ${v.datum}: ${grund}`);
    if (s) stornos.push(s.id);
  }
  for (const id of abgehendeInstrumente) if (id) await korrigiereNullperioden(tx, id, v.erfasstAm);
  const jetzt = new Date();
  for (const f of forderungen) {
    const [nachher] = await tx.update(forderung).set({ storniertAm: jetzt }).where(eq(forderung.id, f.id)).returning();
    await protokoll("stornieren", "forderung", f.id, f, nachher);
  }

  // Bewertung: die des Verkaufs zurücknehmen, eine dadurch ersetzte wiederherstellen
  if (v.bewertungId) {
    const [s] = await tx.select().from(bewertung).where(eq(bewertung.id, v.bewertungId));
    if (s && s.status === "freigegeben") {
      await nimmBewertungZurueck(tx, protokoll, s.id, b.fondsId);
      if (s.ersetztBewertungId) {
        const [alt] = await tx.select().from(bewertung).where(eq(bewertung.id, s.ersetztBewertungId));
        if (alt) {
          await setzeBewertung(tx, protokoll, b, alt.stichtag, alt.wert, alt.methode, `Wiederhergestellt nach Storno des Verkaufs: ${alt.begruendung ?? ""}`.trim());
        }
      }
    }
  }

  // Verkäuferdarlehen zurücknehmen
  if (darlehen && darlehenInstrument) {
    const vorgaenge = vorgaengeDesInstruments(await ladeVorgaenge(tx, darlehen.id), darlehenInstrument.id);
    for (const art of ["auszahlung", "zusage"] as const) {
      for (const o of vorgaenge.filter((x) => x.art === art)) await storniereVorgang(tx, protokoll, darlehen, o, `Storno des Verkaufs zum ${v.datum}: ${grund}`);
    }
    // Die Bewertung des Verkäuferdarlehens (am Verkaufstag, zu Anschaffungskosten) zurücknehmen, eine dadurch ersetzte wiederherstellen.
    const bewertungen = await tx.select().from(bewertung).where(and(eq(bewertung.beteiligungId, darlehen.id), eq(bewertung.status, "freigegeben")));
    for (const w of bewertungen.filter((x) => x.stichtag === v.datum && x.begruendung === VERKAEUFERDARLEHEN_BEGRUENDUNG)) {
      await nimmBewertungZurueck(tx, protokoll, w.id, darlehen.fondsId);
      if (w.ersetztBewertungId) {
        const [alt] = await tx.select().from(bewertung).where(eq(bewertung.id, w.ersetztBewertungId));
        if (alt) await setzeBewertung(tx, protokoll, darlehen, alt.stichtag, alt.wert, alt.methode, `Wiederhergestellt nach Storno des Verkaufs: ${alt.begruendung ?? ""}`.trim());
      }
    }
    const beteiligungInstrumente = await instrumenteVon(tx, darlehen.id);
    if (beteiligungInstrumente.length === 1) {
      // Die Beteiligung entstand nur für das Verkäuferdarlehen: sie bleibt als beendet stehen (wie bisher).
      await setzeInstrumentStatus(tx, protokoll, darlehenInstrument, "verkauft");
      const [nachher] = await tx.update(beteiligung).set({ status: "exit" }).where(eq(beteiligung.id, darlehen.id)).returning();
      await protokoll("verkauf_storno", "beteiligung", darlehen.id, darlehen, nachher);
    } else {
      await setzeInstrumentStatus(tx, protokoll, darlehenInstrument, "abgeschrieben");
      await protokoll("verkauf_storno", "beteiligung", darlehen.id, darlehen, darlehen);
    }
  }

  // Status: Beteiligung und die Instrumente, die dieser Verkauf auf `verkauft` gesetzt hat (nie die eines anderen, nicht stornierten Verkaufs)
  let status = b.status;
  const voll = new Decimal(v.anteilVerkauft).equals(1);
  if (voll) {
    const andere = (await tx.select().from(verkauf).where(and(eq(verkauf.beteiligungId, b.id), isNull(verkauf.storniertAm), ne(verkauf.id, v.id)))).filter((x) => new Decimal(x.anteilVerkauft).equals(1));
    for (const i of await instrumenteVon(tx, b.id)) {
      if (i.status !== "verkauft") continue;
      const betrifft = v.instrumentId === null || v.instrumentId === i.id;
      const anderweitig = andere.some((x) => x.instrumentId === null || x.instrumentId === i.id);
      if (betrifft && !anderweitig) await setzeInstrumentStatus(tx, protokoll, i, "aktiv");
    }
  }
  if (voll && b.status === "exit") {
    const [nachher] = await tx.update(beteiligung).set({ status: "aktiv" }).where(eq(beteiligung.id, b.id)).returning();
    await protokoll("verkauf_storno", "beteiligung", b.id, b, nachher);
    status = "aktiv";
  } else {
    await protokoll("verkauf_storno", "beteiligung", b.id, b, b);
  }

  const [nachher] = await tx.update(verkauf).set({ storniertAm: jetzt, storniertVon: protokoll.akteur }).where(eq(verkauf.id, v.id)).returning();
  await protokoll("stornieren", "verkauf", v.id, v, { ...nachher, grund });
  return { verkauf: nachher!, stornoVorgangIds: stornos, status, verkaeuferdarlehenBeteiligungId: darlehen?.id ?? null };
}

/**
 * Bucht einen Verkauf (ganz oder anteilig, die ganze Beteiligung oder ein Instrument): Barzufluss als Rückfluss, Forderung für den Treuhandbetrag,
 * Verkäuferdarlehen als Darlehen-Instrument, Bewertung (ganz = 0, anteilig = Rest), Status der Instrumente und der Beteiligung. Die Route
 * `POST /beteiligungen/:id/verkauf` und der Abgang eines eigenen Fonds bei einer Anteilsübertragung gehen hierher.
 */
export async function bucheVerkauf(tx: Tx, protokoll: Protokollant, id: string, e: VerkaufsEingabe) {
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

  const darlehensbuchungen = [
    ...plan.kapitalabgaenge.map((a) => ({ ...a, art: "principal_disposal" as const, bemerkung: "Abgang des Darlehenskapitals an den Erwerber" })),
    ...plan.berichtigungen.map((a) => ({ ...a, art: "impairment_disposal" as const, bemerkung: "Abgang der Wertberichtigung beim Darlehensverkauf" })),
    ...plan.schlusszinsen.map((a) => ({ ...a, art: "zins" as const, bemerkung: "Offene Zinsen bis zum Verkaufstag" })),
  ];
  for (const a of darlehensbuchungen) {
    const [abgang] = await tx.insert(vorgang).values({ beteiligungId: id, ...a, valuta: e.datum, darlehensverkaufId: zeile!.id }).returning();
    await protokoll("anlegen", "vorgang", abgang!.id, null, abgang);
    await ordneRundeZu(tx, protokoll, abgang!);
  }
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
}

export type { Db };
