import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { anteilsuebertragung, forderung, kaufpreisanpassung, optionsscheinAusuebung, verkauf, vorgang, wandlung } from "@carraway/db";
import { Decimal, verteileBuchwertabgang } from "@carraway/rechenkern";
import type { Tx } from "../zeitlimit";
import { berechneZustand, buchwertVon, ladeVorgaenge, vorgaengeDesInstruments, type VorgangDaten } from "./zustand";

/**
 * Buchwertabgang früherer Teilverkäufe einer Beteiligung (Summe über die Verkäufe). Mit `instrumentId` der Abgang dieses Instruments: Verkäufe genau
 * dieses Instruments plus sein Teil an Verkäufen der ganzen Beteiligung (`ladeBuchwertabgangJeInstrument`).
 */
export async function ladeBuchwertabgang(tx: Tx, beteiligungId: string, instrumentId?: string): Promise<Decimal> {
  if (instrumentId) return (await ladeBuchwertabgangJeInstrument(tx, beteiligungId)).get(instrumentId) ?? new Decimal(0);
  const zeilen = await tx
    .select({ abgang: verkauf.buchwertAbgang })
    .from(verkauf)
    .where(and(eq(verkauf.beteiligungId, beteiligungId), isNull(verkauf.storniertAm)));
  return zeilen.reduce((s, z) => s.plus(z.abgang), new Decimal(0));
}

type VerkaufZeile = typeof verkauf.$inferSelect;

/**
 * Buchwertabgang je Instrument (Issue 208). Ein Verkauf eines Instruments mindert genau dieses. Ein Verkauf der ganzen Beteiligung (ohne Instrument)
 * verteilt seinen Abgang anteilig nach dem Buchwert je Instrument unmittelbar vor dem Verkauf (Rechenkern `verteileBuchwertabgang`, Cent nach größtem
 * Rest); so ist die Summe der Instrumente gleich dem Abgang der Beteiligung. „Unmittelbar vor dem Verkauf“ heißt: Vorgänge, die bis zur Erfassung des
 * Verkaufs erfasst waren, und die Abgänge der Verkäufe, die damals galten (früher erfasst, damals nicht storniert). Später erfasste Buchungen
 * verschieben die Verteilung nicht. Das Verkäuferdarlehen, das der Verkauf selbst anlegt, bekommt nichts.
 *
 * Mit `sicht` zählen nur Verkäufe bis zum Stichtag (Verkaufsdatum) und Wissensstand (Erfassung, Storno), wie in `ladeVerkaufsdaten`.
 */
export async function ladeBuchwertabgangJeInstrument(
  tx: Tx,
  beteiligungId: string,
  sicht: { stichtag?: string | undefined; stand?: string | undefined } = {},
  vorgaengeVorab?: readonly VorgangDaten[],
): Promise<Map<string, Decimal>> {
  const alle = await tx.select().from(verkauf).where(eq(verkauf.beteiligungId, beteiligungId)).orderBy(asc(verkauf.erfasstAm), asc(verkauf.datum), asc(verkauf.id));
  const aus = new Map<string, Decimal>();
  if (alle.length === 0) return aus;
  const standMs = sicht.stand === undefined ? null : new Date(sicht.stand).getTime();
  const bisStand = (zeitpunkt: Date) => standMs === null || zeitpunkt.getTime() <= standMs;
  const imBlick = (v: VerkaufZeile) => (sicht.stichtag === undefined || v.datum <= sicht.stichtag) && bisStand(v.erfasstAm) && (v.storniertAm === null || !bisStand(v.storniertAm));
  const zaehlt = alle.filter(imBlick);
  if (zaehlt.length === 0) return aus;
  const plus = (ziel: Map<string, Decimal>, id: string, betrag: Decimal.Value) => ziel.set(id, (ziel.get(id) ?? new Decimal(0)).plus(betrag));

  let vorgaenge: readonly VorgangDaten[] | null = vorgaengeVorab ?? null;
  const verteilt = new Map<string, Map<string, Decimal>>();
  const anteileVon = async (v: VerkaufZeile): Promise<Map<string, Decimal>> => {
    const fertig = verteilt.get(v.id);
    if (fertig) return fertig;
    const t = v.erfasstAm.getTime();
    // Der Stand unmittelbar vor dem Verkauf: früher erfasste Verkäufe, die damals galten, und die bis dahin erfassten Vorgänge.
    const index = alle.indexOf(v);
    const abgang = new Map<string, Decimal>();
    for (const x of alle.slice(0, index)) {
      if (x.storniertAm !== null && x.storniertAm.getTime() <= t) continue;
      if (x.instrumentId) plus(abgang, x.instrumentId, x.buchwertAbgang);
      else for (const [id, betrag] of await anteileVon(x)) plus(abgang, id, betrag);
    }
    vorgaenge ??= await ladeVorgaenge(tx, beteiligungId);
    const bis = vorgaenge.filter((g) => g.erfasstAm.getTime() <= t);
    const ids = [...new Set(bis.map((g) => g.instrumentId).filter((id): id is string => !!id && id !== v.verkaeuferdarlehenInstrumentId))].sort();
    const buchwerte = ids.map((id) => ({ id, buchwert: buchwertVon(berechneZustand(vorgaengeDesInstruments(bis, id), abgang.get(id) ?? 0)).wert }));
    const teile = new Map(verteileBuchwertabgang(v.buchwertAbgang, buchwerte).wert.map((x) => [x.id, x.abgang] as const));
    verteilt.set(v.id, teile);
    return teile;
  };
  for (const v of zaehlt) {
    if (v.instrumentId) plus(aus, v.instrumentId, v.buchwertAbgang);
    else for (const [id, betrag] of await anteileVon(v)) plus(aus, id, betrag);
  }
  return aus;
}

/** Verkäufe (mit Anpassungen), Forderungen und Wandlung einer Beteiligung für die Lesesicht. */
export interface Verkaufsdaten {
  verkaeufe: (typeof verkauf.$inferSelect & {
    /** Der Verkauf mindert den Buchwert späterer Verkäufe (nicht storniert zum Stand der Sicht). */
    zaehltBuchwertabgang: boolean;
    anpassungen: (typeof kaufpreisanpassung.$inferSelect)[];
    /** Ergebnis inklusive aller Kaufpreisanpassungen. */
    ergebnisMitAnpassungen: string;
  })[];
  forderungen: (typeof forderung.$inferSelect)[];
  wandlung: (typeof wandlung.$inferSelect) | null;
}

export async function ladeVerkaufsdaten(tx: Tx, beteiligungId: string, sicht: { stichtag?: string | undefined; stand?: string | undefined } = {}): Promise<Verkaufsdaten> {
  const standMs = sicht.stand === undefined ? null : new Date(sicht.stand).getTime();
  const bisStand = (zeitpunkt: Date | null) => standMs === null || zeitpunkt === null || zeitpunkt.getTime() <= standMs;
  const bisTag = (tag: string) => sicht.stichtag === undefined || tag <= sicht.stichtag;
  const verkaeufe = (await tx.select().from(verkauf).where(eq(verkauf.beteiligungId, beteiligungId)).orderBy(asc(verkauf.datum), asc(verkauf.erfasstAm), asc(verkauf.id))).filter(
    (v) => bisTag(v.datum) && bisStand(v.erfasstAm),
  );
  const anpassungen = (
    verkaeufe.length
      ? await tx.select().from(kaufpreisanpassung).where(inArray(kaufpreisanpassung.verkaufId, verkaeufe.map((v) => v.id))).orderBy(asc(kaufpreisanpassung.datum), asc(kaufpreisanpassung.erfasstAm))
      : []
  ).filter((a) => bisTag(a.datum) && bisStand(a.erfasstAm));
  const forderungen = (await tx.select().from(forderung).where(eq(forderung.beteiligungId, beteiligungId)).orderBy(asc(forderung.faelligAm), asc(forderung.id)))
    .filter((f) => verkaeufe.some((v) => v.id === f.verkaufId) && bisStand(f.erstelltAm))
    .map((f) => (f.erfuelltAm !== null && !bisTag(f.erfuelltAm) ? { ...f, erfuelltAm: null, vorgangId: null } : f));
  const [gewandelt] = await tx.select().from(wandlung).where(eq(wandlung.darlehenBeteiligungId, beteiligungId)).orderBy(asc(wandlung.cutoff), asc(wandlung.erfasstAm));
  return {
    verkaeufe: verkaeufe.map((v) => {
      const eigene = anpassungen.filter((a) => a.verkaufId === v.id);
      return { ...v, zaehltBuchwertabgang: v.storniertAm === null || !bisStand(v.storniertAm), anpassungen: eigene, ergebnisMitAnpassungen: eigene.reduce((s, a) => s.plus(a.betrag), new Decimal(v.ergebnis)).toFixed(2) };
    }),
    forderungen,
    wandlung: gewandelt ?? null,
  };
}

/**
 * Gehört der Vorgang zu einer Ausübung von Optionsscheinen oder zum Zugang aus einer Anteilsübertragung (Zusage und Auszahlung auf dem Instrument des
 * Käufers)? Dann bliebe nach einem Storno die Ausübung bzw. Übertragung in der Kapitaltabelle stehen; der Storno geht nur als Ganzes (`storniereAusuebung`, `storniereUebertragung`), einzeln gibt es 409.
 */
export async function ereignisZuVorgang(tx: Tx, vorgangId: string): Promise<{ ausuebungId: string } | { uebertragungId: string } | null> {
  const [a] = await tx.select({ id: optionsscheinAusuebung.id }).from(optionsscheinAusuebung).where(and(or(eq(optionsscheinAusuebung.zusageVorgangId, vorgangId), eq(optionsscheinAusuebung.auszahlungVorgangId, vorgangId)), isNull(optionsscheinAusuebung.storniertAm)));
  if (a) return { ausuebungId: a.id };
  const [u] = await tx
    .select({ id: anteilsuebertragung.id })
    .from(anteilsuebertragung)
    .innerJoin(vorgang, eq(vorgang.instrumentId, anteilsuebertragung.kaeuferInstrumentId))
    .where(and(eq(vorgang.id, vorgangId), inArray(vorgang.art, ["zusage", "auszahlung"]), eq(vorgang.valuta, anteilsuebertragung.datum), isNull(anteilsuebertragung.storniertAm)));
  return u ? { uebertragungId: u.id } : null;
}

/**
 * Gehört der Vorgang zu einem nicht stornierten Verkauf (Barzufluss, Kaufpreisanpassung oder erfüllte Forderung)?
 * Dann lässt er sich nur über den Storno des ganzen Verkaufs aufheben (`POST /verkaeufe/:id/storno`).
 */
export async function verkaufZuVorgang(tx: Tx, vorgangId: string): Promise<string | null> {
  const [direkt] = await tx.select({ id: verkauf.id }).from(verkauf).where(and(eq(verkauf.rueckflussVorgangId, vorgangId), isNull(verkauf.storniertAm)));
  if (direkt) return direkt.id;
  const [anpassung] = await tx
    .select({ id: verkauf.id })
    .from(kaufpreisanpassung)
    .innerJoin(verkauf, eq(verkauf.id, kaufpreisanpassung.verkaufId))
    .where(and(eq(kaufpreisanpassung.vorgangId, vorgangId), isNull(verkauf.storniertAm)));
  if (anpassung) return anpassung.id;
  const [erfuellt] = await tx
    .select({ id: verkauf.id })
    .from(forderung)
    .innerJoin(verkauf, eq(verkauf.id, forderung.verkaufId))
    .where(and(eq(forderung.vorgangId, vorgangId), isNull(verkauf.storniertAm)));
  return erfuellt?.id ?? null;
}
