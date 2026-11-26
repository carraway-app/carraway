import { asc, eq } from "drizzle-orm";
import { fonds, fondsClosing, fondsClosingBasis, fondsClosingStand, fondsClosingStorno, fondsZeichnung, organisation } from "@carraway/db";
import { verteileAnteilig } from "@carraway/rechenkern";
import type { Tx } from "../zeitlimit";

/**
 * Verteilungsgrundlage der Kapitalbewegungen auf die Investoren eines Fonds, stichtagsbezogen.
 *
 * `fonds_zeichnung` führt den aktuellen Stand. Jedes weitere Closing (Issue #113) legt vor der Änderung eine Momentaufnahme in
 * `fonds_closing_basis` ab; für einen Tag vor dem Wirksamkeitsdatum eines Closings gilt die Momentaufnahme des frühesten Closings, das an
 * diesem Tag noch nicht wirksam war (bei angegebenem Wissensstand zusätzlich: noch nicht erfasst war). Eine Bewegung wird mit der Grundlage
 * ihrer eigenen Valuta verteilt (`zum(valuta)`); an einem Tag gleich dem Wirksamkeitsdatum gilt schon die neue Grundlage.
 */

export interface Zeichnungsstand {
  zeichnungId: string;
  organisationId: string;
  investor: string;
  zusage: string;
  anteil: string;
  /** Ausgetretener Investor (Issue #132): Zusage bleibt auf dem Abgerufenen, sein Gewicht in der Verteilung ist null. */
  ausgetreten: boolean;
}

export interface Verteilungsgrundlage {
  zeichnungen: Zeichnungsstand[];
  /** `gewichte[i]` gehört zu `zeichnungen[i]`. */
  gewichte: string[];
  verteilungsbasis: "zusage" | "anteil" | null;
}

/** Die Grundlage zu jedem Datum eines Fonds; `aktuell` ist der heutige Stand. */
export interface Verteilungsgrundlagen {
  aktuell: Verteilungsgrundlage;
  zum: (datum: string) => Verteilungsgrundlage;
}

function alsGrundlage(zeichnungen: Zeichnungsstand[], nachZusage: boolean | undefined): Verteilungsgrundlage {
  const verteilungsbasis: "zusage" | "anteil" | null = nachZusage === undefined ? null : nachZusage ? "zusage" : "anteil";
  const gewichte = verteilungsbasis === null ? [] : zeichnungen.map((z) => (z.ausgetreten ? "0" : z[verteilungsbasis]));
  return { zeichnungen, gewichte, verteilungsbasis };
}

/** Der aktuelle Stand. Diese Reihenfolge entscheidet auch über den letzten Cent bei gleich großen Resten. */
export async function ladeVerteilungsgrundlage(tx: Pick<Tx, "select">, fondsId: string): Promise<Verteilungsgrundlage> {
  const zeilen = await tx
    .select({
      zeichnungId: fondsZeichnung.id,
      organisationId: fondsZeichnung.organisationId,
      investor: organisation.name,
      zusage: fondsZeichnung.zusage,
      anteil: fondsZeichnung.anteil,
      ausgetreten: fondsZeichnung.ausgetreten,
      nachZusage: fonds.lpVerteilungNachZusage,
    })
    .from(fondsZeichnung)
    .innerJoin(fonds, eq(fonds.id, fondsZeichnung.fondsId))
    .innerJoin(organisation, eq(organisation.id, fondsZeichnung.organisationId))
    .where(eq(fondsZeichnung.fondsId, fondsId))
    .orderBy(asc(organisation.name), asc(fondsZeichnung.organisationId));

  const erste = zeilen[0];
  return alsGrundlage(zeilen.map(({ nachZusage: _nachZusage, ...zeichnung }) => zeichnung), erste?.nachZusage);
}

/**
 * Alle Grundlagen des Fonds auf einmal (wenige Abfragen für alle Closings, nicht je Bewegung). `stand` (ISO-Zeitstempel) ist der
 * Wissensstand: Closings, die danach erfasst wurden, gelten dann als nicht bekannt; Closings, die bis dahin storniert waren, ebenfalls
 * nicht (Issue #126). Eine spätere Stornierung ändert den Wissensstand davor nicht.
 *
 * Für einen Tag gilt die Momentaufnahme vor dem frühesten bekannten Closing, das an diesem Tag noch nicht wirksam war, sonst der Stand
 * nach dem letzten bekannten Closing.
 */
export async function ladeVerteilungsgrundlagen(tx: Pick<Tx, "select">, fondsId: string, stand?: string): Promise<Verteilungsgrundlagen> {
  const aktuell = await ladeVerteilungsgrundlage(tx, fondsId);
  const alle = await tx
    .select({ id: fondsClosing.id, wirksamAm: fondsClosing.wirksamAm, erfasstAm: fondsClosing.erfasstAm, storniertAm: fondsClosingStorno.storniertAm })
    .from(fondsClosing)
    .leftJoin(fondsClosingStorno, eq(fondsClosingStorno.closingId, fondsClosing.id))
    .where(eq(fondsClosing.fondsId, fondsId))
    .orderBy(asc(fondsClosing.wirksamAm), asc(fondsClosing.erfasstAm), asc(fondsClosing.id));
  if (alle.length === 0) return { aktuell, zum: () => aktuell };

  const standMs = stand === undefined ? null : new Date(stand).getTime();
  const bekannt = alle.filter((c) => (standMs === null || c.erfasstAm.getTime() <= standMs) && (c.storniertAm === null || (standMs !== null && c.storniertAm.getTime() > standMs)));
  // Ohne Wissensstand zählt der heutige Stand; mit Wissensstand nur dann, wenn seither nichts erfasst oder storniert wurde.
  const unveraendert = standMs === null || alle.every((c) => c.erfasstAm.getTime() <= standMs && (c.storniertAm === null || c.storniertAm.getTime() <= standMs));

  const zeilenJe = async (tabelle: typeof fondsClosingBasis | typeof fondsClosingStand) => {
    const zeilen = await tx
      .select({ closingId: tabelle.closingId, organisationId: tabelle.organisationId, investor: organisation.name, zusage: tabelle.zusage, anteil: tabelle.anteil, ausgetreten: tabelle.ausgetreten })
      .from(tabelle)
      .innerJoin(fondsClosing, eq(fondsClosing.id, tabelle.closingId))
      .innerJoin(organisation, eq(organisation.id, tabelle.organisationId))
      .where(eq(fondsClosing.fondsId, fondsId))
      .orderBy(asc(organisation.name), asc(tabelle.organisationId));
    return zeilen;
  };
  const basis = await zeilenJe(fondsClosingBasis);
  const nachher = unveraendert ? [] : await zeilenJe(fondsClosingStand);
  const zeichnungId = new Map(aktuell.zeichnungen.map((z) => [z.organisationId, z.zeichnungId]));
  const nachZusage = aktuell.verteilungsbasis === "zusage";
  const stufe = (zeilen: typeof basis, closingId: string) =>
    alsGrundlage(zeilen.filter((b) => b.closingId === closingId).map(({ closingId: _closingId, ...z }) => ({ ...z, zeichnungId: zeichnungId.get(z.organisationId) ?? "" })), nachZusage);

  const stufen = new Map(bekannt.map((c) => [c.id, stufe(basis, c.id)] as const));
  let danach = aktuell;
  if (!unveraendert) {
    const letztes = bekannt.at(-1);
    if (letztes) danach = stufe(nachher, letztes.id);
    else {
      // Kein Closing bekannt: der Stand vor dem zuerst erfassten Closing, also die Ersterfassung.
      const erstes = alle.reduce((a, b) => (b.erfasstAm.getTime() < a.erfasstAm.getTime() ? b : a));
      danach = stufe(basis, erstes.id);
    }
  }
  return {
    aktuell,
    zum(datum) {
      const naechstes = bekannt.find((c) => c.wirksamAm > datum);
      return naechstes ? stufen.get(naechstes.id)! : danach;
    },
  };
}

/** Die Grundlage zu einem Datum (und Wissensstand); für mehrere Daten desselben Fonds besser `ladeVerteilungsgrundlagen` einmal laden. */
export async function ladeVerteilungsgrundlageZum(tx: Pick<Tx, "select">, fondsId: string, datum: string, stand?: string): Promise<Verteilungsgrundlage> {
  return (await ladeVerteilungsgrundlagen(tx, fondsId, stand)).zum(datum);
}

export function verteileBewegungsbetrag(betrag: string, gewichte: readonly string[]): string[] {
  return gewichte.length ? verteileAnteilig(betrag, gewichte).map((t) => t.toFixed(2)) : [];
}

/**
 * Verteilt einen Betrag nach einer Grundlage und gibt die Teile in der Reihenfolge von `ziel` zurück (Organisation-IDs); wer in der
 * Grundlage noch nicht vorkommt, bekommt `0.00`. Die Summe der Teile ist genau der Betrag.
 */
export function verteileAufGrundlage(betrag: string, grundlage: Pick<Verteilungsgrundlage, "zeichnungen" | "gewichte">, ziel: readonly { organisationId: string }[]): string[] {
  const teile = verteileBewegungsbetrag(betrag, grundlage.gewichte);
  const je = new Map(grundlage.zeichnungen.map((z, i) => [z.organisationId, teile[i]!]));
  return ziel.map((z) => je.get(z.organisationId) ?? "0.00");
}
