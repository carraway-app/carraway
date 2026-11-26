import { sql } from "drizzle-orm";
import type { Tx } from "../zeitlimit";
import { geldlos } from "../instrumente/geldfluss";
import { bisStand, wirksameBewertung } from "./fonds";

/**
 * Wirksamer Beteiligungsstatus zum Stichtag und Wissensstand: die eine Entscheidung für Fondsübersicht, Beteiligungsakte, Portfolio- und
 * Exitliste. Die Spalte `beteiligung.status` ist der heutige Stand; für einen früheren Stichtag oder Wissensstand zählt das fachliche Ereignis.
 *
 * - Vollausstieg durch Verkauf: Ein wirksamer Verkauf (Datum bis zum Stichtag, erfasst bis zum Wissensstand, nicht oder erst nach dem
 *   Wissensstand storniert) mit Anteil 1 über die ganze Beteiligung, oder volle Verkäufe aller Instrumente. Teilverkäufe lassen die Restposition
 *   im Bestand; ein späterer Vollverkauf ändert den früheren Stichtag nicht.
 * - Ohne Verkauf (Insolvenz, Abschreibung, Rückzahlung eines Darlehens): Der Status der Beteiligung gilt ab dem Ausstiegsdatum, das sich aus den
 *   Buchungen ergibt (jüngster Verkauf, sonst jüngster Rückfluss oder Tilgung, sonst erste Bewertung mit Wert null). Liegt es nach dem Stichtag,
 *   war die Beteiligung zum Stichtag aktiv. Ohne Datum gilt der Status unverändert.
 */

export type BeteiligungStatus = "aktiv" | "exit" | "insolvent" | "abgeschrieben";

export interface WirksamerStatus {
  status: BeteiligungStatus;
  /** Gesetzt, wenn die Beteiligung zum Stichtag ausgeschieden ist: Datum des Ausstiegs (`null`, wenn es sich nicht bestimmen lässt) und ob ein Verkauf beteiligt ist (Vollausstieg oder zuvor ein Teilverkauf). */
  austritt: { datum: string | null; durchVerkauf: boolean } | null;
}

export interface AusstiegsVerkauf {
  /** Gesetzt bei einem Verkauf nur dieses Instruments; `null` beim Verkauf der ganzen Beteiligung. */
  instrumentId: string | null;
  datum: string;
  anteil: string;
  /** Erfassungszeitpunkt in Mikrosekunden seit 1970. */
  erfasstUs: bigint;
}

export interface AusstiegsInstrument {
  id: string;
  /** Anlagezeitpunkt in Mikrosekunden seit 1970. */
  erstelltUs: bigint;
}

/**
 * Reine Regel des Vollausstiegs durch Verkauf: das Ausstiegsdatum oder `null`, wenn Restbestand bleibt. Ein Verkauf der ganzen Beteiligung
 * erfasst die Instrumente, die vor ihm angelegt wurden (ein im selben Vorgang angelegtes Verkäuferdarlehen bleibt im Bestand).
 */
export function vollausstiegDurchVerkauf(instrumente: AusstiegsInstrument[], verkaeufe: AusstiegsVerkauf[]): string | null {
  const voll = verkaeufe.filter((v) => Number(v.anteil) >= 1);
  const ganze = voll.filter((v) => v.instrumentId === null);
  const einzelne = voll.filter((v) => v.instrumentId !== null);
  if (instrumente.length === 0 && ganze.length === 0) return null;
  const genutzt = new Set<AusstiegsVerkauf>();
  for (const i of instrumente) {
    const deckend = [...einzelne.filter((v) => v.instrumentId === i.id), ...ganze.filter((v) => i.erstelltUs < v.erfasstUs)];
    if (deckend.length === 0) return null;
    for (const v of deckend) genutzt.add(v);
  }
  if (instrumente.length === 0) for (const v of ganze) genutzt.add(v);
  return [...genutzt].map((v) => v.datum).sort().at(-1) ?? null;
}

type Abfrage = Pick<Tx, "execute">;

/**
 * Wirksamer Status je Beteiligung des Fonds (oder der einen Beteiligung) zum Stichtag und Wissensstand (`stand`, leer = heutiger Wissensstand).
 * Der Schlüssel der Antwort ist die Beteiligungs-ID; Beteiligungen mit Erstinvestment nach dem Stichtag filtert der Aufrufer.
 */
export async function ermittleBeteiligungsstatus(
  tx: Abfrage,
  auswahl: { fondsId: string } | { beteiligungId: string },
  stichtag: string,
  wissensstand?: string,
): Promise<Map<string, WirksamerStatus>> {
  const filter = "fondsId" in auswahl ? sql`b.fonds_id = ${auswahl.fondsId}` : sql`b.id = ${auswahl.beteiligungId}`;
  const { rows: stamm } = await tx.execute<{ id: string; status: BeteiligungStatus }>(sql`
    SELECT b.id, b.status::text AS status FROM beteiligung b WHERE ${filter}`);
  const { rows: instrumentRoh } = await tx.execute<{ beteiligung_id: string; id: string; us: string }>(sql`
    SELECT i.beteiligung_id, i.id, (extract(epoch FROM i.erstellt_am) * 1000000)::bigint::text AS us
    FROM instrument i JOIN beteiligung b ON b.id = i.beteiligung_id WHERE ${filter}`);
  // Alle nicht stornierten Verkäufe von heute (`aktuell`), davon die zu Stichtag und Wissensstand wirksamen (`wirksam`; ein später stornierter zählt mit dem damaligen Wissen).
  const { rows: verkaufRoh } = await tx.execute<{ beteiligung_id: string; instrument_id: string | null; datum: string; anteil: string; us: string; wirksam: boolean; aktuell: boolean }>(sql`
    SELECT vk.beteiligung_id, vk.instrument_id, vk.datum::text AS datum, vk.anteil_verkauft::text AS anteil,
           (extract(epoch FROM vk.erfasst_am) * 1000000)::bigint::text AS us,
           (vk.datum <= ${stichtag}::date${wissensstand === undefined ? sql`` : sql` AND vk.erfasst_am <= ${wissensstand}::timestamptz AND (vk.storniert_am IS NULL OR vk.storniert_am > ${wissensstand}::timestamptz)`}
             ${wissensstand === undefined ? sql` AND vk.storniert_am IS NULL` : sql``}) AS wirksam,
           (vk.storniert_am IS NULL) AS aktuell
    FROM verkauf vk JOIN beteiligung b ON b.id = vk.beteiligung_id
    WHERE ${filter}`);
  // Ausstiegsdatum ohne Vollverkauf (unabhängig vom Stichtag, damit ein späterer Ausstieg als solcher erkannt wird; wissensstandgerecht).
  const { rows: datumRoh } = await tx.execute<{ id: string; verkauf: string | null; rueckfluss: string | null; bewertung: string | null }>(sql`
    SELECT b.id,
      (SELECT max(vk.datum) FROM verkauf vk WHERE vk.beteiligung_id = b.id AND (vk.storniert_am IS NULL${wissensstand === undefined ? sql`` : sql` OR vk.storniert_am > ${wissensstand}::timestamptz`})${bisStand(sql.raw("vk.erfasst_am"), wissensstand)})::text AS verkauf,
      (SELECT max(valuta) FROM vorgang WHERE beteiligung_id = b.id AND art IN ('rueckfluss', 'tilgung') AND betrag > 0 AND NOT ${geldlos("vorgang")}${bisStand(sql.raw("vorgang.erfasst_am"), wissensstand)})::text AS rueckfluss,
      (SELECT min(w.stichtag) FROM bewertung w WHERE w.beteiligung_id = b.id AND ${wirksameBewertung("w", wissensstand)} AND w.wert = 0)::text AS bewertung
    FROM beteiligung b WHERE ${filter}`);

  const instrumenteJe = new Map<string, AusstiegsInstrument[]>();
  for (const i of instrumentRoh) (instrumenteJe.get(i.beteiligung_id) ?? instrumenteJe.set(i.beteiligung_id, []).get(i.beteiligung_id)!).push({ id: i.id, erstelltUs: BigInt(i.us) });
  const verkaeufeJe = new Map<string, { wirksam: AusstiegsVerkauf[]; aktuell: AusstiegsVerkauf[] }>();
  for (const v of verkaufRoh) {
    const je = verkaeufeJe.get(v.beteiligung_id) ?? verkaeufeJe.set(v.beteiligung_id, { wirksam: [], aktuell: [] }).get(v.beteiligung_id)!;
    const zeile = { instrumentId: v.instrument_id, datum: v.datum, anteil: v.anteil, erfasstUs: BigInt(v.us) };
    if (v.wirksam) je.wirksam.push(zeile);
    if (v.aktuell) je.aktuell.push(zeile);
  }
  // Exit: zuerst Verkauf und Rückfluss; Insolvenz und Abschreibung: zuerst die Bewertung null (frühere Tilgungen sind kein Ausstieg).
  const datumJe = new Map(datumRoh.map((d) => [d.id, d]));

  const ergebnis = new Map<string, WirksamerStatus>();
  for (const b of stamm) {
    const instrumente = instrumenteJe.get(b.id) ?? [];
    const verkaufDatum = vollausstiegDurchVerkauf(instrumente, verkaeufeJe.get(b.id)?.wirksam ?? []);
    if (verkaufDatum !== null) {
      ergebnis.set(b.id, { status: "exit", austritt: { datum: verkaufDatum, durchVerkauf: true } });
      continue;
    }
    // Der heutige Status stammt aus einem Verkauf, der zu Stichtag und Wissensstand noch nicht (oder nicht mehr) galt: damals aktiv.
    const heuteVerkauf = vollausstiegDurchVerkauf(instrumente, verkaeufeJe.get(b.id)?.aktuell ?? []) !== null;
    if (b.status === "aktiv" || heuteVerkauf) {
      ergebnis.set(b.id, { status: "aktiv", austritt: null });
      continue;
    }
    const d = datumJe.get(b.id);
    const datum = (b.status === "exit" ? [d?.verkauf, d?.rueckfluss, d?.bewertung] : [d?.bewertung, d?.rueckfluss, d?.verkauf]).find((x) => x != null) ?? null;
    ergebnis.set(b.id, datum !== null && datum > stichtag ? { status: "aktiv", austritt: null } : { status: b.status, austritt: { datum, durchVerkauf: d?.verkauf != null } });
  }
  return ergebnis;
}
