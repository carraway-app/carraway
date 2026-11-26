import { asc, eq } from "drizzle-orm";
import { Decimal } from "@carraway/rechenkern";
import { beteiligung, darlehenKondition, fonds, jahresueberschuss, tranche } from "@carraway/db";
import type { Rechenschritt } from "@carraway/rechenkern";
import type { Tx } from "../zeitlimit";
import { ladeVerkaufsdaten, type Verkaufsdaten } from "./verkaeufe";
import { alsMeilenstein } from "./tranchen";
import { berechneZustand, buchwertVon, ladeVorgaenge, offenesKapital } from "./zustand";
import { ladeInstrumentUebersicht } from "./instrumente";
import { ladeGeldloseIds } from "./geldfluss";

/**
 * Lesesicht auf alles Instrumentspezifische einer Beteiligung. Beträge als Zeichenketten (Entscheidung 24),
 * der Buchwert mit Herkunft.
 */
export interface Instrumentdaten extends Verkaufsdaten {
  beteiligung: { id: string; fondsId: string; organisationId: string; instrument: string; status: string; erstinvestment: string; /** Währung der Beteiligung (leer: Fondswährung), in der Beträge wie die Bewertungsobergrenze eines Instruments stehen. */ waehrung: string };
  konditionen: (typeof darlehenKondition.$inferSelect)[];
  jahresueberschuesse: { jahr: number; betrag: string }[];
  meilensteine: (ReturnType<typeof alsMeilenstein<typeof tranche.$inferSelect>>)[];
  /**
   * Je Instrument der Beteiligung (zu Stichtag und Wissensstand der Sicht): Zusage, ausgezahlt, offene Zusage, offenes Kapital, Teile des Buchwerts,
   * gezahlte Zinsen, Dividenden und Tranchen mit Stand. Die Felder darüber (`zustand`, `buchwert`, `meilensteine`) bleiben die Summen über die ganze Beteiligung.
   */
  instrumente: NonNullable<Awaited<ReturnType<typeof ladeInstrumentUebersicht>>>;
  zustand: {
    zusage: string;
    /** Eingezahlt wie in den Kennzahlen: Auszahlungen ohne die Einlage aus einer Wandlung (kein Geldfluss). Offene Zusage und Buchwert bleiben unberührt. */
    investiert: string;
    offeneZusage: string;
    tilgungen: string;
    rueckfluesse: string;
    /** Bar eingegangene Zinsen und Dividenden (zählen in den Kennzahlen zu den Rückflüssen). */
    zinszahlungen: string;
    dividenden: string;
    wertberichtigungen: string;
    kapitalisiert: string;
    zinsen: string;
    offenesKapital: string;
    buchwertabgang: string;
  };
  buchwert: { wert: string; schritte: Rechenschritt[] };
}

/**
 * Sicht auf einen früheren Stand: `stichtag` schneidet nach Valuta und Gültigkeitsdatum (Vorgänge, Konditionen ab `gueltigAb`,
 * Jahresüberschüsse bis zum Jahr des Stichtags, Verkäufe nach Datum), `stand` nach Erfassungszeitpunkt (`erfasst_am`).
 * Ohne beides gilt der aktuelle Stand. Meilensteine und Forderungen erscheinen mit ihrem Stand zum Schnitt.
 */
export interface Sicht {
  stichtag?: string | undefined;
  stand?: string | undefined;
}

export async function ladeInstrumentdaten(tx: Tx, id: string, sicht: Sicht = {}): Promise<Instrumentdaten | null> {
  const [b] = await tx.select().from(beteiligung).where(eq(beteiligung.id, id));
  if (!b) return null;
  const [f] = await tx.select({ waehrung: fonds.waehrung }).from(fonds).where(eq(fonds.id, b.fondsId));
  const fondsWaehrung = f?.waehrung ?? "EUR";
  const standMs = sicht.stand === undefined ? null : new Date(sicht.stand).getTime();
  const bisStand = (zeitpunkt: Date | null) => standMs === null || zeitpunkt === null || zeitpunkt.getTime() <= standMs;
  const bisTag = (tag: string) => sicht.stichtag === undefined || tag <= sicht.stichtag;
  const vorgaenge = (await ladeVorgaenge(tx, id)).filter((v) => bisTag(v.valuta) && bisStand(v.erfasstAm));
  const verkauf = await ladeVerkaufsdaten(tx, id, sicht);
  const abgang = verkauf.verkaeufe.filter((v) => v.zaehltBuchwertabgang).reduce((s, v) => s.plus(v.buchwertAbgang), new Decimal(0));
  const z = berechneZustand(vorgaenge, abgang);
  const buch = buchwertVon(z);
  const geldlos = await ladeGeldloseIds(tx, { beteiligungId: id });
  const einlageAusWandlung = vorgaenge.filter((v) => v.art === "auszahlung" && geldlos.has(v.id)).reduce((s, v) => s.plus(v.betrag), new Decimal(0));
  const konditionen = (await tx.select().from(darlehenKondition).where(eq(darlehenKondition.beteiligungId, id)).orderBy(asc(darlehenKondition.gueltigAb))).filter((k) => bisTag(k.gueltigAb) && bisStand(k.erfasstAm));
  const ueberschuesse = (await tx.select().from(jahresueberschuss).where(eq(jahresueberschuss.beteiligungId, id)).orderBy(asc(jahresueberschuss.jahr))).filter(
    (u) => (sicht.stichtag === undefined || u.jahr <= Number(sicht.stichtag.slice(0, 4))) && bisStand(u.erfasstAm),
  );
  const meilensteine = (await tx.select().from(tranche).where(eq(tranche.beteiligungId, id)).orderBy(asc(tranche.erstelltAm), asc(tranche.id)))
    .filter((m) => bisStand(m.erstelltAm))
    .map((m) => alsMeilenstein(m.erfuelltAm !== null && !bisTag(m.erfuelltAm) ? { ...m, erfuelltAm: null, nachweis: null } : m));
  return {
    beteiligung: { id: b.id, fondsId: b.fondsId, organisationId: b.organisationId, instrument: b.instrument, status: b.status, erstinvestment: b.erstinvestment, waehrung: b.waehrung ?? fondsWaehrung },
    konditionen,
    jahresueberschuesse: ueberschuesse.map((u) => ({ jahr: u.jahr, betrag: u.betrag })),
    meilensteine,
    instrumente: (await ladeInstrumentUebersicht(tx, id, sicht)) ?? [],
    zustand: {
      zusage: z.zusage.toFixed(2),
      investiert: z.investiert.minus(einlageAusWandlung).toFixed(2),
      offeneZusage: z.zusage.minus(z.investiert).toFixed(2),
      tilgungen: z.tilgungen.toFixed(2),
      rueckfluesse: z.rueckfluesse.toFixed(2),
      zinszahlungen: z.zinszahlungen.toFixed(2),
      dividenden: z.dividenden.toFixed(2),
      wertberichtigungen: z.wertberichtigungen.toFixed(2),
      kapitalisiert: z.kapitalisiert.toFixed(2),
      zinsen: z.zinsen.toFixed(2),
      offenesKapital: offenesKapital(z).toFixed(2),
      buchwertabgang: z.abgang.toFixed(2),
    },
    buchwert: { wert: buch.wert.toFixed(2), schritte: buch.schritte },
    ...verkauf,
  };
}
