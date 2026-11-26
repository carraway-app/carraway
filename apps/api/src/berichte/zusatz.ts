import { and, inArray, isNull, sql } from "drizzle-orm";
import type { ZusatzSpalte, ZusatzWerte } from "@carraway/berichte";
import { feldDefinition } from "@carraway/db";
import { feldArray } from "../crm/felder";
import { bezugsnamen, ladeWerteMehrere } from "../felder/werte";
import type { Tx } from "../zeitlimit";

/**
 * Eigene Felder (Zusatzfelder) als Spalten der Berichte (Nacharbeiten 9). Gewählt wird je Vorlage eine Liste von Felddefinitionen; hier werden die Definitionen
 * zu Spalten und die Werte je Beteiligung zu einem Wissensstand geladen. Welcher Wert in der Zeile einer Beteiligung steht, hängt vom Objekt des Feldes ab:
 *
 * - `beteiligung` und `instrument`: der Wert der Beteiligung (Instrumentwerte stehen in `beteiligung.instrument_felder`),
 * - `runde`: der Wert der letzten abgeschlossenen Finanzierungsrunde des Unternehmens bis zum Stichtag (dieselbe Runde wie die Phase der Portfolioliste),
 * - `fonds`: der Wert des Fonds (steht in jeder Zeile gleich).
 *
 * Vorgänge gibt es nicht als Spalte (eine Zeile ist eine Beteiligung). Verknüpfungs- und Personenfelder erscheinen mit dem Namen des Ziels; Verknüpfungen auf
 * Deals werden im Bericht nie aufgelöst (ein Bericht hat keine Sicht einer anfragenden Person), sie bleiben leer.
 */

export const ZUSATZ_OBJEKTE = ["fonds", "runde", "instrument", "beteiligung"] as const;
type ZusatzObjekt = (typeof ZUSATZ_OBJEKTE)[number];
const istZusatzObjekt = (o: string): o is ZusatzObjekt => (ZUSATZ_OBJEKTE as readonly string[]).includes(o);

type DefZeile = typeof feldDefinition.$inferSelect;

/** Definitionen zu IDs, in der Reihenfolge der IDs; Definitionen, die es nicht gibt oder die nicht zu Fonds, Runde, Instrument oder Beteiligung gehören, fehlen. */
async function ladeDefinitionenZuIds(tx: Pick<Tx, "select">, ids: readonly string[]): Promise<DefZeile[]> {
  if (ids.length === 0) return [];
  const zeilen = await tx.select().from(feldDefinition).where(and(inArray(feldDefinition.id, [...ids]), isNull(feldDefinition.listeId)));
  const je = new Map(zeilen.filter((z) => istZusatzObjekt(z.objekt)).map((z) => [z.id, z]));
  return ids.flatMap((id) => (je.has(id) ? [je.get(id)!] : []));
}

/** Spalten für die gewählten Felder (Reihenfolge der Vorlage). Archivierte Definitionen bleiben, damit eine festgehaltene Vorlage ihre Werte weiter zeigt. */
export async function ladeZusatzspalten(tx: Pick<Tx, "select">, ids: readonly string[]): Promise<ZusatzSpalte[]> {
  const defs = await ladeDefinitionenZuIds(tx, ids);
  return defs.map((d) => {
    const optionen = (d.optionen.optionen as { schluessel: string; label: string }[] | undefined) ?? [];
    return {
      id: d.id,
      name: d.name,
      typ: d.typ,
      objekt: d.objekt as ZusatzObjekt,
      ...(d.typ === "betrag" ? { waehrung: String(d.optionen.waehrung ?? "EUR") } : {}),
      ...(d.typ === "auswahl" || d.typ === "mehrfachauswahl" ? { optionen: optionen.map((o) => ({ schluessel: o.schluessel, label: o.label })) } : {}),
    };
  });
}

/** Prüft die gewählten Felder einer Vorlage: Die Definition muss bestehen, aktiv sein und zu Fonds, Runde, Instrument oder Beteiligung gehören. Liefert die abgelehnten IDs. */
export async function ungueltigeZusatzfelder(tx: Pick<Tx, "select">, ids: readonly string[]): Promise<string[]> {
  const defs = await ladeDefinitionenZuIds(tx, ids);
  const gut = new Set(defs.filter((d) => d.archiviertAm === null).map((d) => d.id));
  return ids.filter((id) => !gut.has(id));
}

/**
 * Werte der gewählten Felder je Beteiligung zu Stichtag und Wissensstand. Rückgabe: Beteiligungs-ID → Werte (Schlüssel = ID der Definition); ein Feld ohne Wert fehlt.
 */
export async function ladeZusatzwerte(tx: Tx, spalten: readonly ZusatzSpalte[], beteiligungIds: readonly string[], stichtag: string, stand: string | undefined): Promise<Map<string, ZusatzWerte>> {
  const aus = new Map<string, ZusatzWerte>(beteiligungIds.map((id) => [id, {}]));
  if (spalten.length === 0 || beteiligungIds.length === 0) return aus;
  const { rows: bezug } = await tx.execute<{ id: string; fonds_id: string; organisation_id: string }>(sql`SELECT id::text AS id, fonds_id::text AS fonds_id, organisation_id::text AS organisation_id FROM beteiligung WHERE id = ANY(${feldArray(beteiligungIds, "uuid")})`);
  const von = new Map(bezug.map((b) => [b.id, b]));

  // Die Zeile, an der der Wert je Objekt steht.
  const letzteRunde = new Map<string, string>();
  if (spalten.some((s) => s.objekt === "runde")) {
    const orgs = [...new Set(bezug.map((b) => b.organisation_id))];
    const { rows } = await tx.execute<{ organisation_id: string; id: string }>(sql`
      SELECT DISTINCT ON (organisation_id) organisation_id::text AS organisation_id, id::text AS id FROM finanzierungsrunde
      WHERE organisation_id = ANY(${feldArray(orgs, "uuid")}) AND status = 'abgeschlossen' AND art = 'eigenkapital' AND datum <= ${stichtag}::date
      ORDER BY organisation_id, datum DESC, id DESC`);
    for (const r of rows) letzteRunde.set(r.organisation_id, r.id);
  }
  const werteJeObjekt: Record<ZusatzObjekt, Map<string, Record<string, unknown>>> = { fonds: new Map(), runde: new Map(), instrument: new Map(), beteiligung: new Map() };
  const braucht = (o: ZusatzObjekt) => spalten.some((s) => s.objekt === o);
  if (braucht("beteiligung")) werteJeObjekt.beteiligung = await ladeWerteMehrere(tx, "beteiligung", beteiligungIds, stand);
  if (braucht("instrument")) werteJeObjekt.instrument = await ladeWerteMehrere(tx, "instrument", beteiligungIds, stand);
  if (braucht("fonds")) werteJeObjekt.fonds = await ladeWerteMehrere(tx, "fonds", [...new Set(bezug.map((b) => b.fonds_id))], stand);
  if (braucht("runde")) werteJeObjekt.runde = await ladeWerteMehrere(tx, "runde", [...new Set(letzteRunde.values())], stand);

  const rohWert = (s: ZusatzSpalte, beteiligungId: string): unknown => {
    const b = von.get(beteiligungId);
    if (!b) return undefined;
    switch (s.objekt) {
      case "beteiligung":
      case "instrument":
        return werteJeObjekt[s.objekt].get(beteiligungId)?.[s.id];
      case "fonds":
        return werteJeObjekt.fonds.get(b.fonds_id)?.[s.id];
      case "runde": {
        const runde = letzteRunde.get(b.organisation_id);
        return runde ? werteJeObjekt.runde.get(runde)?.[s.id] : undefined;
      }
    }
  };

  // Namen zu Verknüpfungs- und Personenfeldern; Deals bleiben unaufgelöst.
  const defs = await ladeDefinitionenZuIds(tx, spalten.map((s) => s.id));
  const verweisFelder = defs.flatMap((d) =>
    d.typ === "verknuepfung" || d.typ === "benutzer" ? beteiligungIds.map((id) => ({ typ: d.typ, optionen: d.optionen, wert: rohWert({ id: d.id, objekt: d.objekt as ZusatzObjekt } as ZusatzSpalte, id) })) : [],
  );
  const namen = await bezugsnamen(tx, verweisFelder, sql`false`);

  for (const id of beteiligungIds) {
    const werte: ZusatzWerte = {};
    for (const s of spalten) {
      const w = rohWert(s, id);
      if (w === undefined || w === null) continue;
      if (s.typ === "benutzer" || s.typ === "verknuepfung") {
        const d = defs.find((x) => x.id === s.id);
        const ziel = s.typ === "benutzer" ? "benutzer" : String(d?.optionen.ziel ?? "organisation");
        const name = typeof w === "string" ? namen[`${ziel}:${w}`] : null;
        if (name) werte[s.id] = name;
      } else werte[s.id] = w;
    }
    aus.set(id, werte);
  }
  return aus;
}
