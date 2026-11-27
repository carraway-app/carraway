import { eq, sql } from "drizzle-orm";
import { fonds, fondsZeichnung } from "@carraway/db";
import { Decimal, verteileAnteilig } from "@carraway/rechenkern";
import { Fachfehler } from "../fehler";
import type { Tx } from "../zeitlimit";

/**
 * Abdeckung des Zeichnungskapitals durch die erfassten LP-Zusagen (Issue #275).
 *
 * Zusagen lassen sich schrittweise erfassen; ihre Summe darf das Zeichnungskapital nicht überschreiten, aber darunter liegen. Solange sie
 * darunter liegt, sind Vorgänge gesperrt, die nach Zusagen auf die Investoren verteilen (Kapitalabrufe, Ausschüttungen, Fondskosten,
 * LP-Berichte, weitere Closings). Das betrifft nur Fonds, deren Verteilung den Zusagen folgt (`lp_verteilung_nach_zusage`, gesetzt bei der
 * Erfassung in der Anwendung). Fonds ohne Zusagen und Bestandsfonds mit fest gespeicherten Anteilen verhalten sich wie bisher.
 */

export interface Zusagenstand {
  zeichnungskapital: string;
  /** Summe der erfassten Zusagen. */
  abgedeckt: string;
  anzahl: number;
  /** `false`, solange verteilende Vorgänge gesperrt sind. */
  vollstaendig: boolean;
}

export function bewerteZusagen(zeichnungskapital: Decimal.Value, abgedeckt: Decimal.Value, anzahl: number, nachZusage: boolean): Zusagenstand {
  const kapital = new Decimal(zeichnungskapital);
  const summe = new Decimal(abgedeckt);
  return {
    zeichnungskapital: kapital.toFixed(2),
    abgedeckt: summe.toFixed(2),
    anzahl,
    vollstaendig: !(nachZusage && anzahl > 0 && summe.lt(kapital)),
  };
}

export async function ladeZusagenstand(tx: Pick<Tx, "select">, fondsId: string): Promise<Zusagenstand> {
  const [zeile] = await tx
    .select({
      zeichnungskapital: fonds.zeichnungskapital,
      nachZusage: fonds.lpVerteilungNachZusage,
      abgedeckt: sql<string>`coalesce(sum(${fondsZeichnung.zusage}), 0)::text`,
      anzahl: sql<number>`count(${fondsZeichnung.id})::int`,
    })
    .from(fonds)
    .leftJoin(fondsZeichnung, eq(fondsZeichnung.fondsId, fonds.id))
    .where(eq(fonds.id, fondsId))
    .groupBy(fonds.id);
  if (!zeile) throw new Fachfehler(404, "fund_not_found", "Fund not found.");
  return bewerteZusagen(zeile.zeichnungskapital, zeile.abgedeckt, zeile.anzahl, zeile.nachZusage);
}

/** Lehnt einen verteilenden Vorgang ab, solange die Zusagen das Zeichnungskapital nicht vollständig abdecken. */
export async function pruefeZusagenVollstaendig(tx: Pick<Tx, "select">, fondsId: string): Promise<void> {
  const stand = await ladeZusagenstand(tx, fondsId);
  if (stand.vollstaendig) return;
  throw new Fachfehler(409, "lp_commitments_incomplete", "The commitments do not yet cover the subscribed capital. Please complete the LP subscriptions first.", {
    zeichnungskapital: stand.zeichnungskapital,
    summe: stand.abgedeckt,
  });
}

/**
 * Anteile der Zusagen am Zeichnungskapital mit sechs Nachkommastellen, in der Reihenfolge von `zusagen`.
 *
 * Unvollständig: je Zusage `Zusage / Zeichnungskapital`, abgerundet. Ein weiterer Investor ändert damit die Anteile der übrigen nicht.
 * Vollständig (Summe gleich Zeichnungskapital): Verteilung nach dem größten Rest wie bei weiteren Closings, die Anteile ergeben genau 1.
 * Beim Vervollständigen steigt ein abgerundeter Anteil dadurch höchstens um 0,000001.
 */
export function berechneAnteile(zeichnungskapital: Decimal.Value, zusagen: readonly Decimal[]): Decimal[] {
  const kapital = new Decimal(zeichnungskapital);
  if (zusagen.length === 0) return [];
  if (Decimal.sum(...zusagen).eq(kapital)) {
    // Das Verteilungsverfahren arbeitet in Cent. 10.000 Einheiten ergeben eine Million Anteile der kleinsten Einheit.
    return verteileAnteilig("10000", zusagen).map((a) => a.div(10000));
  }
  return zusagen.map((z) => z.div(kapital).toDecimalPlaces(6, Decimal.ROUND_DOWN));
}
