import { sql } from "drizzle-orm";
import { Decimal } from "@carraway/rechenkern";
import type { Tx } from "../zeitlimit";
import { ladeKapitalstand } from "./kapitalstand";

type Stornopaar = { id: string; valuta: string; betrag: string; stornoId: string; stornoValuta: string; stornoBetrag: string; anteile: Record<string, string> | null; grund: string | null };

interface KapitalEinzelwert {
  id: string;
  bewegungId: string;
  organisationId: string | null;
  investor: string | null;
  art: "abruf" | "zahlung" | "teilzahlung" | "storno";
  datum: string;
  betrag: string;
  storniert?: boolean;
  gegenbuchungId?: string;
  faelligAm?: string;
  offen?: string;
  referenz?: string | null;
  grund?: string | null;
}

/** Die LP-Beträge liefert der Kapitalstand. Aufgehobene Abrufe erscheinen zusätzlich als betragsneutrales Buchungspaar. */
export async function ladeKapitalHerkunft(tx: Tx, fondsId: string, stichtag: string, stand: string, bewegungId?: string) {
  const kapital = await ladeKapitalstand(tx, fondsId, stichtag, stand, bewegungId);
  const investor = new Map(kapital.zeichnungen.map((z) => [z.organisationId, z.investor]));
  const abgerufen: KapitalEinzelwert[] = kapital.positionen.map((p) => ({
    id: p.organisationId ?? "fonds", bewegungId: p.bewegungId, organisationId: p.organisationId,
    investor: investor.get(p.organisationId ?? "") ?? null, art: "abruf", datum: p.valuta,
    betrag: p.abgerufen, faelligAm: p.faelligAm, offen: p.offen,
  }));
  const anteile = new Map(kapital.positionen.map((p) => [p.bewegungId + p.organisationId, p.abgerufen]));
  const { rows: stornos } = await tx.execute<Stornopaar>(sql`
    SELECT b.id, b.valuta::text, b.betrag::text, s.id AS "stornoId", s.valuta::text AS "stornoValuta", s.betrag::text AS "stornoBetrag", s.bemerkung AS grund,
      (SELECT jsonb_object_agg(a.organisation_id, a.betrag::text) FROM abruf_anteil a
       WHERE a.bewegung_id = b.id AND a.erfasst_am <= ${stand}::timestamptz) AS anteile
    FROM fonds_bewegung b JOIN fonds_bewegung s ON s.storniert_bewegung_id = b.id AND s.fonds_id = b.fonds_id
    WHERE b.fonds_id = ${fondsId} AND b.art = 'abruf'
      AND b.valuta <= ${stichtag}::date AND s.valuta <= ${stichtag}::date
      AND b.erfasst_am <= ${stand}::timestamptz AND s.erfasst_am <= ${stand}::timestamptz
      ${bewegungId ? sql`AND b.id = ${bewegungId}` : sql``}
    ORDER BY b.valuta, b.id`);
  for (const p of stornos) {
    // Auch nach Aufhebung des Abrufs bleibt eine frühere Teilzahlung als solche erkennbar.
    for (const [organisationId, betrag] of Object.entries(p.anteile ?? {})) anteile.set(p.id + organisationId, betrag);
    const basis = { bewegungId: p.id, organisationId: null, investor: null };
    abgerufen.push(
      { ...basis, id: p.id, art: "abruf", datum: p.valuta, betrag: p.betrag, storniert: true, gegenbuchungId: p.stornoId },
      { ...basis, id: p.stornoId, art: "storno", datum: p.stornoValuta, betrag: p.stornoBetrag, grund: p.grund, gegenbuchungId: p.id },
    );
  }
  const gegenbuchung = new Map(kapital.zahlungen.filter((z) => z.storniertZahlungId).map((z) => [z.storniertZahlungId, z.id]));
  const eingezahlt: KapitalEinzelwert[] = kapital.zahlungen.map((z) => {
    const anteil = anteile.get(z.bewegungId + z.organisationId);
    const teilzahlung = anteil !== undefined && new Decimal(z.betrag).lt(anteil);
    return {
      id: z.id, bewegungId: z.bewegungId, organisationId: z.organisationId, investor: investor.get(z.organisationId) ?? null,
      art: z.storniertZahlungId ? "storno" : teilzahlung ? "teilzahlung" : "zahlung", datum: z.valuta, betrag: z.betrag,
      storniert: gegenbuchung.has(z.id), gegenbuchungId: z.storniertZahlungId ?? gegenbuchung.get(z.id), referenz: z.belegreferenz, grund: z.grund,
    };
  });
  return { abgerufen, eingezahlt };
}

/** Unveränderliche Nachweise, die bei diesem Wissensstand bereits freigegeben waren. */
export async function ladeAbrufNachweise(tx: Tx, fondsId: string, bewegungId: string, stichtag: string, stand: string) {
  const { rows: abrufe } = await tx.execute<{ id: string; valuta: string; betrag: string; bemerkung: string | null }>(sql`
    SELECT id, valuta::text, betrag::text, bemerkung FROM fonds_bewegung
    WHERE id = ${bewegungId} AND fonds_id = ${fondsId} AND art = 'abruf' AND storniert_bewegung_id IS NULL
      AND valuta <= ${stichtag}::date AND erfasst_am <= ${stand}::timestamptz`);
  const abruf = abrufe[0];
  if (!abruf) return null;
  const { rows: mitteilungen } = await tx.execute<{ id: string; organisationId: string; datei: string; am: string; von: string }>(sql`
    SELECT id, organisation_id AS "organisationId", datei_name AS datei, to_json(freigegeben_am) #>> '{}' AS am, freigegeben_von AS von
    FROM fonds_mitteilung WHERE fonds_id = ${fondsId} AND bewegung_id = ${bewegungId}
      AND valuta <= ${stichtag}::date AND freigegeben_am <= ${stand}::timestamptz ORDER BY datei_name, id`);
  const { rows: belege } = await tx.execute<{ id: string; datei: string; am: string }>(sql`
    SELECT id, datei_name AS datei, to_json(freigegeben_am) #>> '{}' AS am FROM beleg
    WHERE fonds_id = ${fondsId} AND bezug_art = 'fonds_bewegung' AND bezug_id = ${bewegungId}
      AND freigegeben_am <= ${stand}::timestamptz AND datei_name IS NOT NULL ORDER BY freigegeben_am, id`);
  return { abruf, mitteilungen, belege };
}
