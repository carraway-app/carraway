import { and, asc, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import {
  beteiligung,
  bewertung,
  forderung,
  instrument,
  kaufpreisanpassung,
  verkauf,
  vorgang,
  wandlung,
  zinsperiodeGebucht,
  type Db,
} from "@carraway/db";
import { Decimal, verkaufsergebnis } from "@carraway/rechenkern";
import type { Rechenschritt } from "@carraway/rechenkern";
import { Fachfehler } from "../fehler";
import { heute, ladeOrganisation, type Protokollant } from "../schreiben";
import type { Tx } from "../zeitlimit";
import { nimmBewertungZurueck, setzeBewertung } from "./bewertung";
import { hauptinstrumentId } from "./hauptinstrument";
import { pruefeNachBuchung } from "./buchen";
import { instrumenteVon, loeseInstrument, setzeInstrumentStatus, type InstrumentZeile } from "./instrumente";
import { pruefeDatumsfenster, pruefeStichtag } from "./stichtag";
import { ladeBuchwertabgang } from "./verkaeufe";
import { berechneZustand, buchwertVon, ladeVorgaenge, pruefePeriodensperre, sperreBeteiligung, verlangeAktiv, vorgaengeDesInstruments, alsFachfehler, type BeteiligungZeile, type VorgangDaten } from "./zustand";
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
  buchwertVorher: string;
  buchwertAbgang: string;
  erloes: string;
  ergebnis: string;
  barzufluss: string;
  schritte: Rechenschritt[];
}

export interface Verkaufsplan {
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
    if (verkauftes.status !== "aktiv") throw new Fachfehler(409, "INSTRUMENT_NICHT_AKTIV", "Das Instrument ist nicht aktiv.", { instrumentId: verkauftes.id, status: verkauftes.status });
  }
  const z = verkauftes
    ? berechneZustand(vorgaengeDesInstruments(vorgaenge, verkauftes.id), await ladeBuchwertabgang(tx, b.id, verkauftes.id))
    : berechneZustand(vorgaenge, await ladeBuchwertabgang(tx, b.id));
  const buch = buchwertVon(z);
  const rechnung = alsFachfehler(b.id, () => verkaufsergebnis({ buchwert: buch.wert, anteilVerkauft: e.anteilVerkauft, kaufpreis: e.kaufpreis, kosten: e.kosten ?? 0 }));
  const treuhand = new Decimal(e.treuhand?.betrag ?? 0);
  const vkd = new Decimal(e.verkaeuferdarlehen?.betrag ?? 0);
  const bar = rechnung.wert.erloes.minus(treuhand).minus(vkd);
  if (bar.isNegative()) {
    throw new Fachfehler(409, "VERKAUF_UNGUELTIG", "Treuhandbetrag und Verkäuferdarlehen übersteigen den Erlös.", {
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
        throw new Fachfehler(409, "BETEILIGUNG_VORHANDEN", "Der Fonds hält gegenüber diesem Schuldner bereits ein Darlehen; bitte einen anderen Schuldner angeben.", { beteiligungId: vorhanden.id });
      }
    }
  }
  return {
    auswertung: {
      buchwertVorher: buch.wert.toFixed(2),
      buchwertAbgang: rechnung.wert.buchwertAbgang.toFixed(2),
      erloes: rechnung.wert.erloes.toFixed(2),
      ergebnis: rechnung.wert.ergebnis.toFixed(2),
      barzufluss: bar.toFixed(2),
      schritte: [...buch.schritte, ...rechnung.schritte],
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
async function storniereVorgang(tx: Tx, protokoll: Protokollant, b: BeteiligungZeile, original: VorgangDaten, grund: string) {
  const vorhandene = await ladeVorgaenge(tx, b.id);
  if (original.storniertVorgangId || vorhandene.some((v) => v.storniertVorgangId === original.id)) return null;
  const heutigerTag = heute();
  const valuta = heutigerTag > original.valuta ? heutigerTag : original.valuta;
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
  if (!vorab) throw new Fachfehler(404, "VERKAUF_NICHT_GEFUNDEN", "Verkauf nicht gefunden.");
  const b = await sperreBeteiligung(tx, vorab.beteiligungId);
  const [v] = await tx.select().from(verkauf).where(eq(verkauf.id, verkaufId)).for("update");
  if (!v) throw new Fachfehler(404, "VERKAUF_NICHT_GEFUNDEN", "Verkauf nicht gefunden.");
  if (v.storniertAm) throw new Fachfehler(409, "VERKAUF_BEREITS_STORNIERT", "Der Verkauf ist bereits storniert.");
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
      throw new Fachfehler(409, "VERKAUF_STORNO_SPAETERER_VERKAUF", "Es gibt einen späteren Verkauf dieser Beteiligung; bitte zuerst diesen stornieren.", { verkaufId: andere.id });
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
      throw new Fachfehler(409, "VERKAUF_STORNO_DARLEHEN_GENUTZT", "Auf das Verkäuferdarlehen wurde bereits gebucht; der Verkauf lässt sich nicht stornieren.", { beteiligungId: darlehen.id });
    }
  }

  // Rückflüsse: Barzufluss, Kaufpreisanpassungen, erfüllte Forderungen
  const anpassungen = await tx.select().from(kaufpreisanpassung).where(eq(kaufpreisanpassung.verkaufId, v.id)).orderBy(asc(kaufpreisanpassung.datum));
  const forderungen = await tx.select().from(forderung).where(eq(forderung.verkaufId, v.id)).orderBy(asc(forderung.faelligAm));
  const vorgangIds = [v.rueckflussVorgangId, ...anpassungen.map((a) => a.vorgangId), ...forderungen.map((f) => f.vorgangId)].filter((x): x is string => x !== null);
  const originale = vorgangIds.length ? await tx.select().from(vorgang).where(inArray(vorgang.id, vorgangIds)) : [];
  const stornos: string[] = [];
  for (const o of originale) {
    const s = await storniereVorgang(tx, protokoll, b, o, `Storno des Verkaufs zum ${v.datum}: ${grund}`);
    if (s) stornos.push(s.id);
  }
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

export type { Db };
