import { Decimal } from "@carraway/rechenkern";
import type { Zusammenfuehrung } from "./adapter";
import type { Periode, QuellVorgang } from "./modell";

/**
 * Wiederholte Ereignisse je Periode zusammenführen: Vorgänge der Arten der Regel werden je Beteiligung, Instrument, Art, Kapitalisierung
 * und Periode zu einem Vorgang (Summe der Beträge, Valuta des letzten Ereignisses). Die ID des Sammelvorgangs leitet sich aus diesen
 * Merkmalen ab, nicht aus den einzelnen Ereignissen; ein erneuter Lauf findet ihn deshalb wieder. Kommt in der Quelle später ein Ereignis
 * in einer schon übernommenen Periode hinzu, weicht die Summe ab und die Prüfung meldet es, statt ein zweites Mal zu buchen.
 * Auch eine Periode mit nur einem Ereignis bekommt den Schlüssel der Periode, damit ein später hinzukommendes Ereignis derselben Periode
 * nicht neben dem schon übernommenen Vorgang gebucht wird. Stornos und stornierte Ereignisse bleiben einzeln. Ändert sich die Regel (Arten
 * oder Periode) nach einer Übernahme, entstehen andere Schlüssel; die Regel ist deshalb vor der ersten Übernahme festzulegen.
 */

export interface Sammelvorgang extends QuellVorgang {
  /** Quell-IDs der zusammengeführten Ereignisse (Herkunft). */
  quellIds: string[];
}

export function periodeVon(datum: string, periode: Periode): string {
  const jahr = datum.slice(0, 4);
  if (periode === "jahr") return jahr;
  const monat = Number(datum.slice(5, 7));
  return periode === "monat" ? datum.slice(0, 7) : `${jahr}-Q${Math.ceil(monat / 3)}`;
}

export function fasseZusammen(vorgaenge: readonly QuellVorgang[], regel: Zusammenfuehrung): Sammelvorgang[] {
  const storniert = new Set(vorgaenge.flatMap((v) => (v.storniertId ? [v.storniertId] : [])));
  const gruppen = new Map<string, QuellVorgang[]>();
  const aus: Sammelvorgang[] = [];
  for (const v of vorgaenge) {
    if (!regel.arten.includes(v.art) || v.storniertId || storniert.has(v.quellId)) {
      aus.push({ ...v, quellIds: [v.quellId] });
      continue;
    }
    const k = [v.beteiligungId, v.instrument ?? "", v.art, v.kapitalisiert ? "k" : "", periodeVon(v.datum, regel.periode)].join("|");
    const liste = gruppen.get(k) ?? [];
    liste.push(v);
    gruppen.set(k, liste);
  }
  for (const [k, liste] of gruppen) {
    const sortiert = [...liste].sort((a, b) => a.datum.localeCompare(b.datum) || a.quellId.localeCompare(b.quellId));
    const letzte = sortiert.at(-1)!;
    const runden = new Set(sortiert.map((v) => v.rundeId ?? ""));
    const summe = sortiert.reduce((s, v) => s.plus(v.betrag), new Decimal(0));
    const [beteiligungId, instrument, art, , periode] = k.split("|");
    aus.push({
      quellId: `periode:${beteiligungId}:${instrument}:${art}:${periode}${letzte.kapitalisiert ? ":k" : ""}`,
      beteiligungId: letzte.beteiligungId,
      art: letzte.art,
      datum: letzte.datum,
      betrag: summe.toFixed(2),
      ...(letzte.instrument ? { instrument: letzte.instrument } : {}),
      ...(runden.size === 1 && letzte.rundeId ? { rundeId: letzte.rundeId } : {}),
      ...(sortiert.length === 1 && letzte.bemerkung ? { bemerkung: letzte.bemerkung } : {}),
      ...(letzte.kapitalisiert ? { kapitalisiert: true } : {}),
      quellIds: sortiert.map((v) => v.quellId),
    });
  }
  return aus;
}
