import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { forderung, kaufpreisanpassung, verkauf, wandlung } from "@carraway/db";
import { Decimal } from "@carraway/rechenkern";
import type { Tx } from "../zeitlimit";

/**
 * Buchwertabgang früherer Teilverkäufe einer Beteiligung (Summe über die Verkäufe). Mit `instrumentId` nur der Verkäufe, die genau dieses Instrument
 * betrafen (ein Verkauf der ganzen Beteiligung hat kein Instrument und zählt hier nicht).
 */
export async function ladeBuchwertabgang(tx: Tx, beteiligungId: string, instrumentId?: string): Promise<Decimal> {
  const zeilen = await tx
    .select({ abgang: verkauf.buchwertAbgang })
    .from(verkauf)
    .where(and(eq(verkauf.beteiligungId, beteiligungId), isNull(verkauf.storniertAm), instrumentId ? eq(verkauf.instrumentId, instrumentId) : undefined));
  return zeilen.reduce((s, z) => s.plus(z.abgang), new Decimal(0));
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
