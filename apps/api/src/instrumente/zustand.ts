import { asc, eq } from "drizzle-orm";
import { beteiligung, periodensperre, vorgang } from "@carraway/db";
import { buchwert as rechneBuchwert, Decimal, kapitalverlauf, type Kapitalbewegung } from "@carraway/rechenkern";
import { Fachfehler } from "../fehler";
import type { Tx } from "../zeitlimit";

/**
 * Gemeinsame Grundlage der Instrument-Routen: Beteiligung sperren, Vorgänge laden, daraus den Zustand
 * (Zusage, Investiert, Kapitalbewegungen, gebuchte Zinsperioden) ableiten und prüfen. Ein Storno und sein
 * Original heben sich auf und gehen nicht in die Kapitalbewegungen ein (wie in Entscheidung 54).
 */

/** Die Zeilen ohne die Werte eigener Felder (Etappe 21): Die Rechenwege brauchen sie nicht, `felder` ist deshalb optional. */
export type BeteiligungZeile = Omit<typeof beteiligung.$inferSelect, "felder" | "instrumentFelder" | "waehrung"> & { felder?: Record<string, unknown>; instrumentFelder?: Record<string, unknown>; waehrung?: string | null };
export type VorgangDaten = Omit<typeof vorgang.$inferSelect, "felder" | "betragLokal" | "kurs" | "kursId" | "instrumentId" | "beglichenVorgangId"> & {
  felder?: Record<string, unknown>;
  betragLokal?: string | null;
  kurs?: string | null;
  kursId?: string | null;
  instrumentId?: string;
  beglichenVorgangId?: string | null;
};

/** Darlehensartig (Konditionen, Zinsen, Tilgung): Darlehen, Wandeldarlehen, stille Beteiligung, Venture Debt, Gesellschafterdarlehen. */
export const DARLEHENSARTIG = ["darlehen", "wandeldarlehen", "stille_beteiligung", "venture_debt", "gesellschafterdarlehen"] as const;
export const istDarlehensartig = (instrument: string) => (DARLEHENSARTIG as readonly string[]).includes(instrument);

/** Lädt die Beteiligung und sperrt die Zeile bis zum Ende der Transaktion (serialisiert alle Schreibwege je Beteiligung). */
export async function sperreBeteiligung(tx: Tx, id: string): Promise<BeteiligungZeile> {
  const [zeile] = await tx.select().from(beteiligung).where(eq(beteiligung.id, id)).for("update");
  if (!zeile) throw new Fachfehler(404, "investment_not_found", "Investment not found.");
  return zeile;
}

export function verlangeAktiv(b: BeteiligungZeile) {
  if (b.status !== "aktiv") throw new Fachfehler(409, "investment_not_active", "The investment is not active.", { status: b.status });
}

/** `art` ist die Art des Instruments (bei der Beteiligung ohne weitere Angabe: ihr Hauptinstrument). */
export function verlangeDarlehensartig(b: { instrument: string } | string) {
  const art = typeof b === "string" ? b : b.instrument;
  if (!istDarlehensartig(art)) {
    throw new Fachfehler(409, "instrument_mismatch", "The instrument does not allow this transaction.", { instrument: art });
  }
}

export function ladeVorgaenge(tx: Tx, beteiligungId: string): Promise<VorgangDaten[]> {
  return tx.select().from(vorgang).where(eq(vorgang.beteiligungId, beteiligungId)).orderBy(asc(vorgang.valuta), asc(vorgang.erfasstAm), asc(vorgang.id));
}

/** Die Vorgänge eines Instruments aus allen Vorgängen der Beteiligung. */
export const vorgaengeDesInstruments = (vorgaenge: readonly VorgangDaten[], instrumentId: string): VorgangDaten[] => vorgaenge.filter((v) => v.instrumentId === instrumentId);

export interface Zustand {
  zusage: Decimal;
  investiert: Decimal;
  tilgungen: Decimal;
  rueckfluesse: Decimal;
  /** Netto: Zuführungen positiv, Auflösungen negativ. */
  wertberichtigungen: Decimal;
  kapitalisiert: Decimal;
  /** Gebuchte Zinsen netto (auch die nicht kapitalisierten). */
  zinsen: Decimal;
  /** Eingegangene Zinsen in bar (`zinszahlung`), netto. */
  zinszahlungen: Decimal;
  /** Dividenden (`dividende`), netto. */
  dividenden: Decimal;
  /** Buchwertabgang früherer Teilverkäufe. */
  abgang: Decimal;
  bewegungen: Kapitalbewegung[];
  /** Enddaten der Zinsperioden mit einer gültigen (nicht stornierten) Zinsbuchung. */
  gebuchtePerioden: string[];
}

/** Ableitung aus den Vorgängen (alle Valuta, es gibt keine Zukunftsgrenze). */
export function berechneZustand(vorgaenge: readonly VorgangDaten[], abgang: Decimal.Value = 0): Zustand {
  const aufgehoben = new Set<string>();
  for (const v of vorgaenge) {
    if (!v.storniertVorgangId) continue;
    aufgehoben.add(v.id);
    aufgehoben.add(v.storniertVorgangId);
  }
  const summe = (art: string, filter: (v: VorgangDaten) => boolean = () => true) =>
    vorgaenge.filter((v) => v.art === art && filter(v)).reduce((s, v) => s.plus(v.betrag), new Decimal(0));

  const bewegungen: Kapitalbewegung[] = [];
  const gebuchtePerioden = new Set<string>();
  for (const v of vorgaenge) {
    if (aufgehoben.has(v.id) || !new Decimal(v.betrag).greaterThan(0)) continue;
    if (v.art === "auszahlung") bewegungen.push({ datum: v.valuta, art: "auszahlung", betrag: v.betrag });
    else if (v.art === "tilgung") bewegungen.push({ datum: v.valuta, art: "tilgung", betrag: v.betrag });
    else if (v.art === "zins") {
      gebuchtePerioden.add(v.valuta);
      if (v.kapitalisiert) bewegungen.push({ datum: v.valuta, art: "kapitalisierung", betrag: v.betrag });
    }
  }
  return {
    zusage: summe("zusage"),
    investiert: summe("auszahlung"),
    tilgungen: summe("tilgung"),
    rueckfluesse: summe("rueckfluss"),
    wertberichtigungen: summe("wertberichtigung"),
    kapitalisiert: summe("zins", (v) => v.kapitalisiert),
    zinsen: summe("zins"),
    zinszahlungen: summe("zinszahlung"),
    dividenden: summe("dividende"),
    abgang: new Decimal(abgang),
    bewegungen,
    gebuchtePerioden: [...gebuchtePerioden].sort(),
  };
}

export function buchwertVon(z: Zustand) {
  return rechneBuchwert({
    investiert: z.investiert,
    kapitalisiert: z.kapitalisiert,
    tilgungen: z.tilgungen,
    wertberichtigungen: z.wertberichtigungen,
    abgang: z.abgang,
  });
}

/** Offenes Darlehenskapital: Auszahlungen plus Kapitalisierungen minus Tilgungen. */
export const offenesKapital = (z: Zustand) => z.investiert.plus(z.kapitalisiert).minus(z.tilgungen);

/** Übersetzt einen Rechenkern-Fehler (reiner `Error`) in einen Fachfehler, der die Beteiligung nennt. */
export function alsFachfehler<T>(beteiligungId: string, fn: () => T, code: "capital_history_invalid" | "calculation_failed" = "calculation_failed"): T {
  try {
    return fn();
  } catch (fehler) {
    if (fehler instanceof Fachfehler) throw fehler;
    const grund = fehler instanceof Error ? fehler.message : String(fehler);
    throw new Fachfehler(409, code, `Calculation not possible: ${grund}`, { beteiligungId, grund });
  }
}

export function pruefeKapitalverlauf(beteiligungId: string, z: Zustand) {
  alsFachfehler(beteiligungId, () => kapitalverlauf(z.bewegungen), "capital_history_invalid");
}

export function pruefeAuszahlungGegenZusage(z: Zustand) {
  if (z.investiert.greaterThan(z.zusage)) {
    throw new Fachfehler(409, "disbursement_exceeds_commitment", "The disbursements would exceed the commitment.", {
      zusage: z.zusage.toFixed(2),
      investiert: z.investiert.toFixed(2),
    });
  }
}

export function pruefeWertberichtigung(z: Zustand) {
  const buch = buchwertVon(z).wert;
  if (buch.isNegative()) {
    throw new Fachfehler(409, "book_value_negative", "The book value would fall below zero.", { buchwert: buch.toFixed(2) });
  }
  if (z.wertberichtigungen.isNegative()) {
    throw new Fachfehler(409, "release_exceeds_adjustment", "The release exceeds the previous impairments.", {
      wertberichtigungen: z.wertberichtigungen.plus(0).toFixed(2),
    });
  }
}

export const cent = (wert: Decimal) => wert.toFixed(2);

/**
 * Gemeinsame Invarianten nach jedem Vorgang, der Zusage, Kapital oder Buchwert berührt (Schreiben und Storno):
 * Auszahlungen höchstens in Höhe der Zusage, Kapitalverlauf der Darlehen gültig, Buchwert nicht negativ,
 * Wertberichtigungen netto nicht negativ. Nur ein Rückfluss berührt nichts davon und braucht die Prüfung nicht.
 */
export function pruefeInvarianten(b: BeteiligungZeile, danach: Zustand) {
  pruefeAuszahlungGegenZusage(danach);
  if (istDarlehensartig(b.instrument)) pruefeKapitalverlauf(b.id, danach);
  pruefeWertberichtigung(danach);
}

/**
 * Invarianten je Instrument (Portfolio-Modell): Auszahlungen höchstens in Höhe der Zusage des Instruments, Kapitalverlauf bei darlehensartigen
 * Instrumenten, Auflösungen höchstens bis zur Berichtigung des Instruments. Der Buchwert darf auf Ebene der Beteiligung (`gesamt`, alle Instrumente
 * mit den Buchwertabgängen der Verkäufe) nicht negativ werden.
 */
export function pruefeInstrumentInvarianten(beteiligungId: string, art: string, danach: Zustand, gesamt: Zustand = danach) {
  pruefeAuszahlungGegenZusage(danach);
  if (istDarlehensartig(art)) pruefeKapitalverlauf(beteiligungId, danach);
  const buch = buchwertVon(gesamt).wert;
  if (buch.isNegative()) throw new Fachfehler(409, "book_value_negative", "The book value would fall below zero.", { buchwert: buch.toFixed(2) });
  if (danach.wertberichtigungen.isNegative()) {
    throw new Fachfehler(409, "release_exceeds_adjustment", "The release exceeds the previous impairments.", { wertberichtigungen: danach.wertberichtigungen.plus(0).toFixed(2) });
  }
}

/**
 * Periodensperre (Etappe 8): die Valuta liegt am oder vor dem Sperrdatum des Fonds → 409 `period_locked`.
 * Jeder Buchungsweg ruft das vor dem Schreiben auf; zusätzlich greift der Trigger in der Datenbank (Migration 0012),
 * falls ein Weg die Prüfung vergisst oder direkt in die Datenbank geschrieben wird.
 */
export async function pruefePeriodensperre(tx: Tx, fondsId: string, valuta: string): Promise<void> {
  const [sperre] = await tx.select({ bis: periodensperre.gesperrtBis }).from(periodensperre).where(eq(periodensperre.fondsId, fondsId));
  if (sperre && valuta <= sperre.bis) {
    throw new Fachfehler(409, "period_locked", `The period is locked until ${sperre.bis}; the value date ${valuta} cannot be booked.`, { gesperrtBis: sperre.bis, valuta });
  }
}
