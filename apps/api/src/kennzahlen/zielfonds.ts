import { sql, type SQL } from "drizzle-orm";
import { Decimal, zielfondsKennzahlen, type Rechenschritt, type ZielfondsBewegung, type ZielfondsKennzahlen, type ZielfondsMeldung } from "@carraway/rechenkern";
import type { Tx } from "../zeitlimit";
import { bisStand } from "./zeitstand";

/**
 * Zielfondsbeteiligungen eines Dachfonds zum Stichtag und Wissensstand (Rechnung im Rechenkern, `dachfonds.ts`). Die Durchrechnung braucht die NAV des
 * Zielfonds; die liefert der Aufrufer (`navVon`), damit dieses Modul die Fondskennzahlen nicht importiert. `besucht` verhindert Kreise (A hält B, B hält A):
 * Ein Fonds, der schon in der Kette steht, wird nicht noch einmal durchgerechnet, dort gilt die fortgeschriebene Meldung.
 */

type Abfrage = Pick<Tx, "execute">;

export interface ZielfondsPosition {
  id: string;
  name: string;
  zielfondsId: string | null;
  zielfondsName: string | null;
  organisationId: string | null;
  investorOrganisationId: string | null;
  bewegungen: ZielfondsBewegung[];
  meldungen: ZielfondsMeldung[];
  kennzahlen: ZielfondsKennzahlen;
}

export type NavVon = (fondsId: string, besucht: ReadonlySet<string>) => Promise<Decimal | null>;

/** Höchstens so viele Ebenen werden durchgerechnet (Dachfonds → Zielfonds → … ); tiefer gilt die fortgeschriebene Meldung. */
export const MAX_DURCHRECHNUNG = 3;

/** NAV je Zielfonds, Stichtag, Wissensstand und Tiefe innerhalb einer Anfrage. */
export type NavCache = Map<string, Promise<Decimal | null>>;

type PositionRoh = { id: string; name: string; zielfonds_id: string | null; zielfonds_name: string | null; organisation_id: string | null; investor_organisation_id: string | null };
type BewegungRoh = { id: string; beteiligung_id: string; art: ZielfondsBewegung["art"]; valuta: string; betrag: string };
type MeldungRoh = { id: string; beteiligung_id: string; stichtag: string; nav: string | null; anteil: string | null; folge: number };

const liste = (ids: string[]): SQL => sql`ANY(ARRAY[${sql.join(ids.map((i) => sql`${i}`), sql`, `)}]::uuid[])`;

/** Gibt es Zielfondsbeteiligungen des Fonds (bis zum Wissensstand)? Ohne sie bleibt die NAV-Herkunft unverändert. */
export async function hatZielfonds(tx: Abfrage, fondsId: string, stand?: string): Promise<boolean> {
  const { rows } = await tx.execute<{ da: boolean }>(sql`SELECT EXISTS (SELECT 1 FROM zielfonds_beteiligung WHERE fonds_id = ${fondsId}${bisStand(sql.raw("erstellt_am"), stand)}) AS da`);
  return rows[0]?.da === true;
}

export async function ladeZielfonds(tx: Abfrage, fondsId: string, stichtag: string, stand: string | undefined, navVon: NavVon | null, besucht: ReadonlySet<string> = new Set()): Promise<ZielfondsPosition[]> {
  const { rows: roh } = await tx.execute<PositionRoh>(sql`
    SELECT z.id, z.name, z.zielfonds_id, f.name AS zielfonds_name, z.organisation_id, z.investor_organisation_id
    FROM zielfonds_beteiligung z LEFT JOIN fonds f ON f.id = z.zielfonds_id
    WHERE z.fonds_id = ${fondsId}${bisStand(sql.raw("z.erstellt_am"), stand)}
    ORDER BY z.name, z.id`);
  if (roh.length === 0) return [];
  const ids = roh.map((r) => r.id);
  const { rows: bewegungen } = await tx.execute<BewegungRoh>(sql`
    SELECT id, beteiligung_id, art::text AS art, valuta::text AS valuta, betrag::text AS betrag
    FROM zielfonds_bewegung WHERE beteiligung_id = ${liste(ids)} AND valuta <= ${stichtag}::date${bisStand(sql.raw("erfasst_am"), stand)}
    ORDER BY valuta, erfasst_am, id`);
  const { rows: meldungen } = await tx.execute<MeldungRoh>(sql`
    SELECT id, beteiligung_id, stichtag::text AS stichtag, nav::text AS nav, anteil::text AS anteil,
           (row_number() OVER (PARTITION BY beteiligung_id ORDER BY erfasst_am, id))::int AS folge
    FROM zielfonds_meldung WHERE beteiligung_id = ${liste(ids)} AND stichtag <= ${stichtag}::date${bisStand(sql.raw("erfasst_am"), stand)}
    ORDER BY stichtag, erfasst_am, id`);
  const kette = new Set([...besucht, fondsId]);
  const aus: ZielfondsPosition[] = [];
  for (const r of roh) {
    const b = bewegungen.filter((x) => x.beteiligung_id === r.id).map((x) => ({ id: x.id, art: x.art, valuta: x.valuta, betrag: x.betrag }));
    const m = meldungen.filter((x) => x.beteiligung_id === r.id).map((x) => ({ id: x.id, stichtag: x.stichtag, nav: x.nav, anteil: x.anteil, folge: x.folge }));
    const durchrechenbar =
      r.zielfonds_id !== null &&
      navVon !== null &&
      !kette.has(r.zielfonds_id) &&
      kette.size <= MAX_DURCHRECHNUNG &&
      m.some((x) => x.anteil !== null);
    const zielNav = durchrechenbar ? await navVon(r.zielfonds_id!, kette) : null;
    aus.push({
      id: r.id,
      name: r.name,
      zielfondsId: r.zielfonds_id,
      zielfondsName: r.zielfonds_name,
      organisationId: r.organisation_id,
      investorOrganisationId: r.investor_organisation_id,
      bewegungen: b,
      meldungen: m,
      kennzahlen: zielfondsKennzahlen({ bezeichnung: r.name, stichtag, bewegungen: b, meldungen: m, zielNav }),
    });
  }
  return aus;
}

/** Nur der Anteilswert verdeckter Positionen gehört in die Ansicht des Dachfonds. */
export function gruppiereZielfonds<T extends { zielfondsId: string | null }>(positionen: readonly T[], sieht: (id: string) => boolean, wert: (p: T) => Decimal.Value) {
  const sichtbar: T[] = [];
  let sammelwert: Decimal | null = null;
  for (const p of positionen) {
    if (p.zielfondsId === null || sieht(p.zielfondsId)) sichtbar.push(p);
    else sammelwert = new Decimal(sammelwert ?? 0).plus(wert(p));
  }
  return { sichtbar, sammelwert };
}

export const ZIELFONDS_SCHRITT = "Anteile an Zielfonds (durchgerechnet oder fortgeschriebene NAV-Meldung)";

export function zielfondsSchritt(positionen: readonly ZielfondsPosition[]): { wert: Decimal; schritt: Rechenschritt } {
  const wert = positionen.reduce((s, p) => s.plus(p.kennzahlen.wert.wert), new Decimal(0));
  return { wert, schritt: { zeichen: "+", bezeichnung: ZIELFONDS_SCHRITT, wert: wert.toString() } };
}

/**
 * Prüft eine neue Verknüpfung Dachfonds → Zielfonds: kein Kreis (der Zielfonds erreicht den Dachfonds) und keine Kette, die tiefer als `MAX_DURCHRECHNUNG`
 * Ebenen reicht. Liefert den Grund oder `null`.
 */
export async function pruefeVerknuepfung(tx: Abfrage, fondsId: string, zielfondsId: string): Promise<"cycle" | "too_deep" | null> {
  const vomZiel = await tx.execute<{ id: string; tiefe: number }>(sql`
    WITH RECURSIVE kette(id, tiefe) AS (
      SELECT zielfonds_id, 1 FROM zielfonds_beteiligung WHERE fonds_id = ${zielfondsId} AND zielfonds_id IS NOT NULL
      UNION
      SELECT z.zielfonds_id, k.tiefe + 1 FROM zielfonds_beteiligung z JOIN kette k ON z.fonds_id = k.id
      WHERE z.zielfonds_id IS NOT NULL AND k.tiefe < ${MAX_DURCHRECHNUNG + 2}
    )
    SELECT id, tiefe FROM kette`);
  if (vomZiel.rows.some((x) => x.id === fondsId)) return "cycle";
  const unten = Math.max(0, ...vomZiel.rows.map((x) => Number(x.tiefe)));
  // Wer hält den Dachfonds (nach oben)? Die längste Kette über die neue Verknüpfung darf höchstens MAX_DURCHRECHNUNG Ebenen haben.
  const zumDach = await tx.execute<{ tiefe: number }>(sql`
    WITH RECURSIVE kette(id, tiefe) AS (
      SELECT fonds_id, 1 FROM zielfonds_beteiligung WHERE zielfonds_id = ${fondsId}
      UNION
      SELECT z.fonds_id, k.tiefe + 1 FROM zielfonds_beteiligung z JOIN kette k ON z.zielfonds_id = k.id WHERE k.tiefe < ${MAX_DURCHRECHNUNG + 2}
    )
    SELECT tiefe FROM kette`);
  const oben = Math.max(0, ...zumDach.rows.map((x) => Number(x.tiefe)));
  return oben + 1 + unten > MAX_DURCHRECHNUNG ? "too_deep" : null;
}

/**
 * SQL-Ausdruck: jüngster Erfassungszeitpunkt der Zielfondsdaten eines Fonds und, bei Zielfonds derselben Installation, der Eingangsdaten dieser Zielfonds
 * (deren NAV geht über die Durchrechnung ein). `fonds` ist der SQL-Ausdruck der Fonds-ID.
 */
export const zielfondsEingang = (fonds: SQL) => sql`(
  WITH RECURSIVE kette(id, tiefe) AS (
    SELECT ${fonds}, 0
    UNION
    SELECT z.zielfonds_id, k.tiefe + 1 FROM kette k JOIN zielfonds_beteiligung z ON z.fonds_id = k.id
    WHERE z.zielfonds_id IS NOT NULL AND k.tiefe < ${MAX_DURCHRECHNUNG}
  ), positionen AS (
    SELECT z.id, z.erstellt_am FROM zielfonds_beteiligung z WHERE z.fonds_id IN (SELECT id FROM kette)
  ), ziele AS (SELECT DISTINCT id FROM kette WHERE tiefe > 0)
  SELECT greatest(
    (SELECT max(erstellt_am) FROM positionen),
    (SELECT max(erfasst_am) FROM zielfonds_bewegung WHERE beteiligung_id IN (SELECT id FROM positionen)),
    (SELECT max(erfasst_am) FROM zielfonds_meldung WHERE beteiligung_id IN (SELECT id FROM positionen)),
    (SELECT max(erfasst_am) FROM fonds_bewegung WHERE fonds_id IN (SELECT id FROM ziele)),
    (SELECT max(v.erfasst_am) FROM vorgang v JOIN beteiligung b ON b.id = v.beteiligung_id WHERE b.fonds_id IN (SELECT id FROM ziele)),
    (SELECT greatest(max(v.erfasst_am), max(v.storniert_am)) FROM verkauf v JOIN beteiligung b ON b.id = v.beteiligung_id WHERE b.fonds_id IN (SELECT id FROM ziele)),
    (SELECT greatest(max(w.erfasst_am), max(w.freigegeben_am), max(w.ersetzt_am)) FROM bewertung w JOIN beteiligung b ON b.id = w.beteiligung_id WHERE b.fonds_id IN (SELECT id FROM ziele)),
    (SELECT greatest(max(uebernommen_am), max(ersetzt_am)) FROM saldenlauf WHERE fonds_id IN (SELECT id FROM ziele))
  ))`;
