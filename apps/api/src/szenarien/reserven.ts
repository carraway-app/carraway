import { and, desc, eq, sql } from "drizzle-orm";
import { reserve, szenario } from "@carraway/db";
import { berechneReserven, Decimal, type Rechenschritt, type ReserveEingabe } from "@carraway/rechenkern";
import { berechneFondsUebersicht, bisStand } from "../kennzahlen/fonds";
import { ladeFonds, heute } from "../schreiben";
import { Fachfehler } from "../fehler";
import type { Tx } from "../zeitlimit";
import { ergebnisVon, ladeSzenario, type SzenarioZeile } from "./dienst";
import { geldlos } from "../instrumente/geldfluss";

/**
 * Reserven für Folgeinvestitionen (Etappe 18): geplante Reserve je Beteiligung gegen die Auszahlungen seit Beginn der Planung, und was
 * auf Fondsebene für Neuinvestitionen bleibt: Zeichnungskapital − belegt (das Größere aus abgerufen und investiert) − offene Reserven −
 * Gebührenprognose eines Szenarios.
 */

export interface ReserveZeile {
  beteiligungId: string;
  organisation: string;
  status: string;
  geplant: string;
  gueltigAb: string | null;
  bemerkung: string | null;
  verbraucht: string;
  offen: string;
}

export interface Befund {
  code: string;
  schwere: "hinweis" | "warnung";
}

export interface Reserven {
  fondsId: string;
  stichtag: string;
  waehrung: string;
  zeichnungskapital: string;
  abgerufen: string;
  investiert: string;
  belegt: string;
  reserven: ReserveZeile[];
  summeGeplant: string;
  summeOffen: string;
  gebuehrenPrognose: string;
  szenario: { id: string; name: string; status: string; basisStichtag: string } | null;
  verfuegbar: string;
  befunde: Befund[];
  schritte: Rechenschritt[];
}

/** Jüngste Planung je Beteiligung (nach Gültigkeit, dann Erfassung). */
export async function geltendeReserven(tx: Tx, fondsId: string, stichtag: string, stand?: string) {
  const { rows } = await tx.execute<{ beteiligung_id: string; betrag: string; gueltig_ab: string; bemerkung: string | null }>(sql`
    SELECT DISTINCT ON (r.beteiligung_id) r.beteiligung_id, r.betrag::text AS betrag, r.gueltig_ab::text AS gueltig_ab, r.bemerkung
    FROM reserve r JOIN beteiligung b ON b.id = r.beteiligung_id
    WHERE b.fonds_id = ${fondsId} AND r.gueltig_ab <= ${stichtag}::date${bisStand(sql.raw("r.erfasst_am"), stand)}
    ORDER BY r.beteiligung_id, r.gueltig_ab DESC, r.erfasst_am DESC, r.id DESC`);
  return rows;
}

/** Das Szenario für die Gebührenprognose: das gewählte, sonst das jüngste festgeschriebene, sonst der jüngste Entwurf. */
async function waehleSzenario(tx: Tx, fondsId: string, szenarioId?: string): Promise<SzenarioZeile | undefined> {
  if (szenarioId) {
    const z = await ladeSzenario(tx, szenarioId);
    if (z.fondsId !== fondsId) throw new Fachfehler(404, "SZENARIO_NICHT_GEFUNDEN", "Szenario nicht gefunden.");
    return z;
  }
  const [fest] = await tx.select().from(szenario).where(and(eq(szenario.fondsId, fondsId), eq(szenario.status, "festgeschrieben"))).orderBy(desc(szenario.festgeschriebenAm)).limit(1);
  if (fest) return fest;
  const [entwurf] = await tx.select().from(szenario).where(and(eq(szenario.fondsId, fondsId), eq(szenario.status, "entwurf"))).orderBy(desc(szenario.geaendertAm)).limit(1);
  return entwurf;
}

export async function ladeReserven(tx: Tx, fondsId: string, optionen: { stichtag?: string; stand?: string; szenarioId?: string } = {}): Promise<Reserven> {
  const f = await ladeFonds(tx, fondsId);
  const stichtag = optionen.stichtag ?? heute();
  const ue = await berechneFondsUebersicht(tx, fondsId, stichtag, optionen.stand);
  const plan = new Map((await geltendeReserven(tx, fondsId, stichtag, optionen.stand)).map((r) => [r.beteiligung_id, r]));

  // Aus der Datenbank kommen nur die Eingaben; gerechnet wird im Rechenkern (`berechneReserven`, geprüft gegen `referenz_reserven.py`).
  const eingaben: ReserveEingabe[] = [];
  const bezug = new Map<string, { organisation: string; status: string; gueltigAb: string; bemerkung: string | null }>();
  for (const b of ue.beteiligungen) {
    const p = plan.get(b.id);
    if (!p) continue;
    const { rows } = await tx.execute<{ summe: string }>(sql`
      SELECT coalesce(sum(v.betrag), 0)::text AS summe FROM vorgang v
      WHERE v.beteiligung_id = ${b.id} AND v.art = 'auszahlung' AND NOT ${geldlos("v")} AND v.valuta >= ${p.gueltig_ab}::date AND v.valuta <= ${stichtag}::date${bisStand(sql.raw("v.erfasst_am"), optionen.stand)}`);
    eingaben.push({ beteiligungId: b.id, status: b.status, geplant: p.betrag, verbraucht: rows[0]?.summe ?? "0" });
    bezug.set(b.id, { organisation: b.organisation.name, status: b.status, gueltigAb: p.gueltig_ab, bemerkung: p.bemerkung });
  }

  const befunde: Befund[] = [];
  const sz = await waehleSzenario(tx, fondsId, optionen.szenarioId);
  let gebuehren = new Decimal(0);
  if (sz) gebuehren = new Decimal((await ergebnisVon(tx, sz)).ergebnis.summen.gebuehren);
  else befunde.push({ code: "KEINE_GEBUEHRENANNAHME", schwere: "hinweis" });

  const abgerufen = new Decimal(ue.kennzahlen.abgerufen.wert ?? 0);
  const investiert = ue.beteiligungen.reduce((s, b) => s.plus(b.investiert), new Decimal(0));
  const r = berechneReserven({ zeichnungskapital: String(f.zeichnungskapital), abgerufen: abgerufen.toString(), investiert: investiert.toString(), reserven: eingaben, gebuehrenPrognose: gebuehren.toString() });
  const zeilen: ReserveZeile[] = r.zeilen.map((z) => {
    const x = bezug.get(z.beteiligungId)!;
    return { beteiligungId: z.beteiligungId, organisation: x.organisation, status: x.status, geplant: z.geplant, gueltigAb: x.gueltigAb, bemerkung: x.bemerkung, verbraucht: z.verbraucht, offen: z.offen };
  });
  if (new Decimal(r.verfuegbar).isNegative()) befunde.push({ code: "VERFUEGBAR_NEGATIV", schwere: "warnung" });

  return {
    fondsId,
    stichtag,
    waehrung: f.waehrung,
    zeichnungskapital: new Decimal(f.zeichnungskapital).toFixed(2),
    abgerufen: abgerufen.toFixed(2),
    investiert: investiert.toFixed(2),
    belegt: r.belegt,
    reserven: zeilen,
    summeGeplant: r.summeGeplant,
    summeOffen: r.summeOffen,
    gebuehrenPrognose: r.gebuehrenPrognose,
    szenario: sz ? { id: sz.id, name: sz.name, status: sz.status, basisStichtag: sz.basisStichtag } : null,
    verfuegbar: r.verfuegbar,
    befunde,
    schritte: r.schritte,
  };
}

export async function ladeReserveVerlauf(tx: Tx, beteiligungId: string) {
  return tx.select().from(reserve).where(eq(reserve.beteiligungId, beteiligungId)).orderBy(desc(reserve.gueltigAb), desc(reserve.erfasstAm));
}
