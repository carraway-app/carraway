import { and, asc, eq, inArray } from "drizzle-orm";
import { beteiligung, darlehenKondition, instrument, jahresueberschuss, organisation, vorgang, zinsperiodeGebucht } from "@carraway/db";
import {
  abgrenzung as rechneAbgrenzung,
  Decimal,
  type Abgrenzung,
  type Kapitalbewegung,
  type Rechenschritt,
  type Zinsdarlehen,
  type Zinsposition,
  zinslauf as rechneZinslauf,
} from "@carraway/rechenkern";
import { Fachfehler } from "../fehler";
import type { Tx } from "../zeitlimit";
import { alsFachfehler, berechneZustand, DARLEHENSARTIG, type BeteiligungZeile, type VorgangDaten } from "./zustand";

/**
 * Zinsberechnung auf den Daten der Datenbank. Die Periodenlogik liegt im Rechenkern; hier werden nur Vorgänge und
 * Konditionen in `Zinsdarlehen` übersetzt. Konditionen sind versioniert (`gueltigAb`): eine Periode rechnet mit der
 * Version, die an ihrem letzten Tag (Periodenende minus ein Tag) gilt, vor der ersten Version gilt die erste.
 * Dafür läuft der Rechenkern je Version über die Perioden dieser Version (Obergrenze: Beginn der nächsten Version),
 * bereits übernommene Perioden und ihre Kapitalisierungen reichen an die nächste Version weiter.
 */

export type Kondition = typeof darlehenKondition.$inferSelect;

export interface Zinskontext {
  beteiligung: BeteiligungZeile;
  /** Das darlehensartige Instrument: Konditionen, Vorgänge und gebuchte Perioden gehören zu ihm, nicht zur Beteiligung. */
  instrument: typeof instrument.$inferSelect;
  organisationName: string;
  vorgaenge: VorgangDaten[];
  /** Aufsteigend nach `gueltigAb`. */
  konditionen: Kondition[];
  ueberschuesse: Record<number, string>;
  /** Perioden aus `zinsperiode_gebucht`. */
  markierte: string[];
}

export interface PositionMitKondition {
  position: Zinsposition;
  kondition: Kondition;
}

/**
 * Lädt Vorgänge, Konditionen, Jahresüberschüsse und gebuchte Perioden der darlehensartigen Instrumente eines Fonds (oder der genannten Beteiligungen
 * oder Instrumente). Ein Kontext je Instrument: Zwei Darlehen in einer Beteiligung rechnen und buchen unabhängig voneinander.
 */
export async function ladeZinskontexte(tx: Tx, auswahl: { fondsId: string } | { beteiligungIds: string[] } | { instrumentIds: string[] }): Promise<Zinskontext[]> {
  const bedingung = "fondsId" in auswahl ? eq(beteiligung.fondsId, auswahl.fondsId) : "instrumentIds" in auswahl ? inArray(instrument.id, auswahl.instrumentIds) : inArray(beteiligung.id, auswahl.beteiligungIds);
  const zeilen = await tx
    .select({ b: beteiligung, i: instrument, organisationName: organisation.name })
    .from(instrument)
    .innerJoin(beteiligung, eq(beteiligung.id, instrument.beteiligungId))
    .innerJoin(organisation, eq(organisation.id, beteiligung.organisationId))
    .where(and(bedingung, inArray(instrument.art, [...DARLEHENSARTIG])))
    .orderBy(asc(organisation.name), asc(beteiligung.id), asc(instrument.erstelltAm), asc(instrument.id));
  if (zeilen.length === 0) return [];
  const ids = [...new Set(zeilen.map((z) => z.b.id))];
  const instrumentIds = zeilen.map((z) => z.i.id);
  const vorgaenge = await tx.select().from(vorgang).where(inArray(vorgang.instrumentId, instrumentIds)).orderBy(asc(vorgang.valuta), asc(vorgang.erfasstAm), asc(vorgang.id));
  const konditionen = await tx.select().from(darlehenKondition).where(inArray(darlehenKondition.instrumentId, instrumentIds)).orderBy(asc(darlehenKondition.gueltigAb));
  const ueberschuesse = await tx.select().from(jahresueberschuss).where(inArray(jahresueberschuss.beteiligungId, ids));
  const markierte = await tx.select().from(zinsperiodeGebucht).where(inArray(zinsperiodeGebucht.instrumentId, instrumentIds));
  return zeilen.map((z) => ({
    beteiligung: z.b,
    instrument: z.i,
    organisationName: z.organisationName,
    vorgaenge: vorgaenge.filter((v) => v.instrumentId === z.i.id),
    konditionen: konditionen.filter((k) => k.instrumentId === z.i.id),
    ueberschuesse: Object.fromEntries(ueberschuesse.filter((u) => u.beteiligungId === z.b.id).map((u) => [u.jahr, u.betrag])),
    markierte: markierte.filter((m) => m.instrumentId === z.i.id).map((m) => m.periodeBis),
  }));
}

export function tagVor(datum: string): string {
  const [j, m, t] = datum.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(j, m - 1, t - 1)).toISOString().slice(0, 10);
}

/** Version, die an einem Tag gilt; vor der ersten Version die erste. */
export function versionAm(konditionen: readonly Kondition[], tag: string): Kondition | undefined {
  let gefunden: Kondition | undefined;
  for (const k of konditionen) if (k.gueltigAb <= tag) gefunden = k;
  return gefunden ?? konditionen[0];
}

function alsZinsdarlehen(k: Zinskontext, bewegungen: Kapitalbewegung[], v: Kondition, gebucht: string[]): Zinsdarlehen {
  const d: Zinsdarlehen = {
    id: k.instrument.id,
    bewegungen,
    bedingungen: { satzFix: v.satzFix, methode: v.methode },
    zinsperiode: v.zinsperiode,
    anker: v.anker,
    kapitalisieren: v.kapitalisieren,
    gebuchtePerioden: gebucht,
  };
  if (v.gewinnabhaengigSatz !== null && v.kappungSatz !== null) {
    d.bedingungen.gewinnabhaengig = { satz: v.gewinnabhaengigSatz, kappungSatz: v.kappungSatz, bemessung: k.ueberschuesse };
  }
  if (v.stundungBis !== null) d.stundungBis = v.stundungBis;
  return d;
}

/** Höchstzahl Zinsperioden je Darlehen und Lauf; mehr meldet die API als 409 `too_many_periods`, der Rechenkern bleibt unverändert. */
export const MAX_PERIODEN_JE_DARLEHEN = 400;

/** Obere Schätzung der Periodenzahl zwischen erster Bewegung und Obergrenze für ein Raster. */
function geschaetztePerioden(art: string, von: string, bis: string): number {
  if (art === "endfaellig") return 1;
  const [j1, m1] = von.split("-").map(Number) as [number, number];
  const [j2, m2] = bis.split("-").map(Number) as [number, number];
  const monate = Math.max(0, (j2 - j1) * 12 + (m2 - m1));
  return Math.floor(monate / (art === "quartalsweise" ? 3 : 12)) + 1;
}

function zuVieleFehler(beteiligungId: string, perioden: number) {
  return new Fachfehler(409, "too_many_periods", "The period covers too many interest periods for one run.", { beteiligungId, perioden, maximum: MAX_PERIODEN_JE_DARLEHEN });
}

export interface Zinsstand {
  positionen: PositionMitKondition[];
  /** Bewegungen inklusive der Kapitalisierungen der berechneten Positionen. */
  bewegungen: Kapitalbewegung[];
  /** Gebuchte und berechnete Periodenenden. */
  uebersprungen: string[];
}

/** Gebuchte Perioden: gültige Zinsbuchungen und Marker. */
export function gebuchtePerioden(k: Zinskontext): string[] {
  return [...new Set([...berechneZustand(k.vorgaenge).gebuchtePerioden, ...k.markierte])].sort();
}

/** Noch nicht gebuchte Zinsperioden bis zum Stichtag, versionsgenau. */
export function berechneZinsstand(k: Zinskontext, stichtag: string): Zinsstand {
  const basis = berechneZustand(k.vorgaenge).bewegungen;
  const positionen: PositionMitKondition[] = [];
  const extra: Kapitalbewegung[] = [];
  const uebersprungen = new Set(gebuchtePerioden(k));
  k.konditionen.forEach((v, i) => {
    const naechste = k.konditionen[i + 1];
    const obergrenze = naechste && naechste.gueltigAb < stichtag ? naechste.gueltigAb : stichtag;
    if (i > 0 && v.zinsperiode === "endfaellig" && uebersprungen.size > 0) {
      alsFachfehler(k.beteiligung.id, () => {
        throw new Error("Eine Änderung der Konditionen nach einer bereits abgerechneten endfälligen Periode wird nicht unterstützt");
      });
    }
    const erste = basis[0]?.datum;
    if (erste !== undefined) {
      const schaetzung = geschaetztePerioden(v.zinsperiode, erste, obergrenze);
      if (schaetzung > MAX_PERIODEN_JE_DARLEHEN) throw zuVieleFehler(k.beteiligung.id, schaetzung);
    }
    const d = alsZinsdarlehen(k, [...basis, ...extra], v, [...uebersprungen]);
    const gerechnet = alsFachfehler(k.beteiligung.id, () => rechneZinslauf([d], obergrenze));
    for (const p of gerechnet) {
      if (versionAm(k.konditionen, tagVor(p.bis)) !== v) continue;
      positionen.push({ position: p, kondition: v });
      uebersprungen.add(p.bis);
      if (p.kapitalisiert) extra.push({ datum: p.bis, art: "kapitalisierung", betrag: p.betragGebucht });
    }
  });
  if (positionen.length > MAX_PERIODEN_JE_DARLEHEN) throw zuVieleFehler(k.beteiligung.id, positionen.length);
  positionen.sort((a, b) => a.position.bis.localeCompare(b.position.bis));
  return { positionen, bewegungen: [...basis, ...extra], uebersprungen: [...uebersprungen].sort() };
}

export interface AbgrenzungErgebnis {
  fehlendeKonditionen: boolean;
  /** Fällige, noch nicht gebuchte Perioden bis zum Stichtag. */
  offenePerioden: { von: string; bis: string; betragGebucht: string; kapitalisiert: boolean }[];
  offen: string;
  /** Aufgelaufen seit dem letzten Periodenende bis zum Stichtag. */
  laufend: { von: string; bis: string; betragGebucht: string };
  gesamt: string;
  schritte: Rechenschritt[];
}

/** Abgrenzung eines Darlehens: fällige ungebuchte Perioden plus das laufende Stück bis zum Stichtag. */
export function berechneAbgrenzung(k: Zinskontext, stichtag: string): AbgrenzungErgebnis | null {
  if (k.konditionen.length === 0) return null;
  const stand = berechneZinsstand(k, stichtag);
  const v = versionAm(k.konditionen, tagVor(stichtag)) as Kondition;
  const d = alsZinsdarlehen(k, stand.bewegungen, v, stand.uebersprungen);
  const a: Abgrenzung = alsFachfehler(k.beteiligung.id, () => rechneAbgrenzung(d, stichtag));
  const offen = stand.positionen.reduce((s, p) => s.plus(p.position.betragGebucht), new Decimal(0));
  const gesamt = offen.plus(a.betragGebucht);
  return {
    fehlendeKonditionen: false,
    offenePerioden: stand.positionen.map((p) => ({ von: p.position.von, bis: p.position.bis, betragGebucht: p.position.betragGebucht.toFixed(2), kapitalisiert: p.position.kapitalisiert })),
    offen: offen.toFixed(2),
    laufend: { von: a.von, bis: a.bis, betragGebucht: a.betragGebucht.toFixed(2) },
    gesamt: gesamt.toFixed(2),
    schritte: [
      ...stand.positionen.flatMap((p) => p.position.schritte.map((s) => ({ ...s, bezeichnung: `Periode ${p.position.von} bis ${p.position.bis}: ${s.bezeichnung}` }))),
      ...a.schritte.map((s) => ({ ...s, bezeichnung: `Laufendes Stück: ${s.bezeichnung}` })),
    ],
  };
}
