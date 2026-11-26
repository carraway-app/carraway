import { formatBetrag, type Sprache } from "@carraway/ui";

/**
 * Filter, Gruppierung und Summen der Transaktionen einer Beteiligung. Die Geldsicht ist die der Kennzahlen: eine Buchung einer Wandlung
 * (`ohneGeldfluss`) zählt weder zu Auszahlungen noch zu Rückflüssen, sie steht unter Wandlung. Alles hier ist reine Logik ohne Oberfläche.
 */

export const TX_FILTER = ["alle", "auszahlungen", "rueckfluesse", "zinsen", "zusagen", "wandlung", "sonstige"] as const;
export type TxFilter = (typeof TX_FILTER)[number];
export const TX_GRUPPEN = ["keine", "runde", "jahr", "instrument", "art"] as const;
export type TxGruppe = (typeof TX_GRUPPEN)[number];

export interface TxZeile {
  art: string;
  valuta: string;
  betrag: string;
  ohneGeldfluss: boolean;
  instrumentId: string | null;
  instrumentBezeichnung: string | null;
  runde?: { id: string; bezeichnung: string; datum: string } | null;
}

const RUECKFLUESSE = ["rueckfluss", "tilgung", "zinszahlung", "dividende"];
/** Reihenfolge der Arten, wie die API sie bei gleichem Valuta sortiert. */
const ART_REIHE = ["zusage", "auszahlung", "zins", "zinszahlung", "dividende", "tilgung", "rueckfluss", "wertberichtigung"];

export const filterWert = (wert: string | undefined): TxFilter => (TX_FILTER as readonly string[]).includes(wert ?? "") ? (wert as TxFilter) : "alle";
export const gruppeWert = (wert: string | undefined): TxGruppe => (TX_GRUPPEN as readonly string[]).includes(wert ?? "") ? (wert as TxGruppe) : "keine";

/** Die Filter (außer Alle), unter denen eine Zeile steht; eine Zinszahlung steht unter Rückflüsse und unter Zinsen. */
export function filterVon(z: TxZeile): Exclude<TxFilter, "alle">[] {
  if (z.ohneGeldfluss) return ["wandlung"];
  const r: Exclude<TxFilter, "alle">[] = [];
  if (z.art === "auszahlung") r.push("auszahlungen");
  if (RUECKFLUESSE.includes(z.art)) r.push("rueckfluesse");
  if (z.art === "zins" || z.art === "zinszahlung") r.push("zinsen");
  if (z.art === "zusage") r.push("zusagen");
  return r.length > 0 ? r : ["sonstige"];
}

export const imFilter = (z: TxZeile, filter: TxFilter) => filter === "alle" || filterVon(z).includes(filter);

export function zaehle(zeilen: readonly TxZeile[]): Record<TxFilter, number> {
  const n: Record<TxFilter, number> = { alle: zeilen.length, auszahlungen: 0, rueckfluesse: 0, zinsen: 0, zusagen: 0, wandlung: 0, sonstige: 0 };
  for (const z of zeilen) for (const f of filterVon(z)) n[f] += 1;
  return n;
}

/** Summe von Beträgen als Text ohne Gleitkomma (bis zu vier Nachkommastellen). */
export function summiere(betraege: readonly string[]): string {
  let summe = 0n;
  for (const b of betraege) {
    const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(b);
    if (!m) continue;
    const wert = BigInt(m[2]! + (m[3] ?? "").padEnd(4, "0").slice(0, 4));
    summe += m[1] ? -wert : wert;
  }
  const neg = summe < 0n;
  const text = (neg ? -summe : summe).toString().padStart(5, "0");
  return `${neg ? "-" : ""}${text.slice(0, -4)}.${text.slice(-4)}`;
}

/** Summen, die ein Filter oder eine Gruppe ausweist: nur dort, wo die Zeilen dieselbe Geldart haben (Auszahlungen, Rückflüsse, Zusagen). */
export type TxSummen = Partial<Record<"auszahlungen" | "rueckfluesse" | "zusagen", string>>;

export function summen(zeilen: readonly TxZeile[], filter: TxFilter): TxSummen {
  const teil = (f: "auszahlungen" | "rueckfluesse" | "zusagen") => {
    const treffer = zeilen.filter((z) => filterVon(z).includes(f));
    return treffer.length > 0 ? summiere(treffer.map((z) => z.betrag)) : undefined;
  };
  const arten = (filter === "alle" ? ["auszahlungen", "rueckfluesse", "zusagen"] : [filter]).filter((f): f is "auszahlungen" | "rueckfluesse" | "zusagen" => f === "auszahlungen" || f === "rueckfluesse" || f === "zusagen");
  const r: TxSummen = {};
  for (const f of arten) {
    const w = teil(f);
    if (w !== undefined) r[f] = w;
  }
  return r;
}

export interface TxGruppeZeilen<T> {
  /** Stabiler Schlüssel der Gruppe; die Beschriftung bestimmt die Oberfläche (je Art der Gruppierung). */
  schluessel: string;
  /** Name der Gruppe: Jahr, Rundenname, Instrument, Art; `null` für „keine Runde“ und „kein Instrument“. */
  name: string | null;
  zeilen: T[];
}

/**
 * Teilt die Zeilen (in ihrer Reihenfolge) in Gruppen. Runden stehen nach ihrem Datum, Jahre aufsteigend wie die Tabelle,
 * Instrumente nach ihrer ersten Buchung, Arten in der Reihenfolge der Buchungsarten; Zeilen ohne Runde oder Instrument stehen zuletzt.
 */
export function gruppiere<T extends TxZeile>(zeilen: readonly T[], gruppe: TxGruppe, artName: (art: string) => string): TxGruppeZeilen<T>[] {
  if (gruppe === "keine") return [{ schluessel: "alle", name: null, zeilen: [...zeilen] }];
  const karte = new Map<string, TxGruppeZeilen<T> & { sortierung: string }>();
  for (const z of zeilen) {
    let schluessel: string;
    let name: string | null;
    let sortierung: string;
    if (gruppe === "runde") {
      schluessel = z.runde?.id ?? "-";
      name = z.runde?.bezeichnung ?? null;
      sortierung = z.runde ? `0${z.runde.datum}${z.runde.id}` : "1";
    } else if (gruppe === "jahr") {
      schluessel = z.valuta.slice(0, 4);
      name = schluessel;
      sortierung = schluessel;
    } else if (gruppe === "instrument") {
      schluessel = z.instrumentId ?? "-";
      name = z.instrumentBezeichnung;
      sortierung = z.instrumentId ? `0${String(karte.size).padStart(4, "0")}` : "1";
    } else {
      schluessel = z.art;
      name = artName(z.art);
      const i = ART_REIHE.indexOf(z.art);
      sortierung = String(i < 0 ? 99 : i).padStart(2, "0");
    }
    const g = karte.get(schluessel);
    if (g) g.zeilen.push(z);
    else karte.set(schluessel, { schluessel, name, zeilen: [z], sortierung });
  }
  return [...karte.values()].sort((a, b) => (a.sortierung < b.sortierung ? -1 : a.sortierung > b.sortierung ? 1 : 0)).map(({ sortierung: _s, ...g }) => g);
}

/** Betrag wie `formatBetrag`, aber mit Cent, sobald der Betrag Cent hat (4,55 € statt 5 €); ganze Beträge bleiben ohne Nachkommastellen. */
export function formatBetragMitCent(wert: number | string, sprache: Sprache, waehrung = "EUR"): string {
  const n = Number(wert);
  if (Math.round(Math.abs(n) * 100) % 100 === 0) return formatBetrag(wert, sprache, { waehrung });
  return new Intl.NumberFormat(sprache === "de" ? "de-DE" : "en-GB", { style: "currency", currency: waehrung, currencyDisplay: "narrowSymbol", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}
