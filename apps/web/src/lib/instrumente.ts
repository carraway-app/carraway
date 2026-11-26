import type { Instrumentdaten } from "../api/abfragen";

/** Ein Instrument der Beteiligung mit Zusage, Ausgezahltem und Tranchen (`instrumente` der Instrumentdaten bzw. des Beteiligungsdetails). */
export type InstrumentZeile = Instrumentdaten["instrumente"][number];
export type Tranche = InstrumentZeile["tranchen"][number];
export type Kondition = Instrumentdaten["konditionen"][number];

/** Die Arten, die „Vorgang erfassen“ anbietet (die Wertberichtigung steht unter Bewertungen), gruppiert wie die Auswahl. */
export const VORGANG_GRUPPEN = [
  { id: "investieren", arten: ["auszahlung"] },
  { id: "ertraege", arten: ["zinszahlung", "dividende"] },
  { id: "rueckfluesse", arten: ["tilgung", "rueckfluss"] },
] as const;
export type VorgangArtWahl = (typeof VORGANG_GRUPPEN)[number]["arten"][number];

/** Darf dieses Instrument den Vorgang dieser Art tragen? Zinszahlung und Tilgung nur darlehensartig, Dividende nur Eigenkapital. */
export function erlaubtFuer(art: string, i: Pick<InstrumentZeile, "darlehensartig">): boolean {
  if (art === "zinszahlung" || art === "tilgung") return i.darlehensartig;
  if (art === "dividende") return !i.darlehensartig;
  return true;
}

/** Tranche, auf die noch gezahlt werden kann (nicht ganz ausgezahlt). */
export const trancheOffen = (t: Tranche) => t.stand.zahlung !== "gezahlt";

/** Summe der Beträge aller Tranchen eines Instruments. */
export const trancheSumme = (i: Pick<InstrumentZeile, "tranchen">) => i.tranchen.reduce((s, t) => s + Math.round(Number(t.betrag) * 100), 0) / 100;

/** Die Konditionen, die an diesem Tag gelten: die jüngste Version, die schon begonnen hat, sonst die erste. */
export function geltendeKondition(konditionen: Kondition[], instrumentId: string, tag: string): Kondition | undefined {
  const meine = konditionen.filter((k) => k.instrumentId === instrumentId);
  return [...meine].reverse().find((k) => k.gueltigAb <= tag) ?? meine[0];
}

/** Logische Reihenfolge der Vorgangsarten am selben Tag: erst die Zusage, dann Auszahlung, Zins, Zinszahlung, Dividende, Tilgung, Rückfluss, Wertberichtigung (wie die API). */
const ART_REIHENFOLGE = ["zusage", "auszahlung", "zins", "zinszahlung", "dividende", "tilgung", "rueckfluss", "wertberichtigung"];
export const artRang = (art: string) => {
  const i = ART_REIHENFOLGE.indexOf(art);
  return i === -1 ? ART_REIHENFOLGE.length : i;
};
