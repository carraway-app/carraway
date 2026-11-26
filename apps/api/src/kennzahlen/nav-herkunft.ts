import { sql } from "drizzle-orm";
import { fuerBereich, hatRolle, type Akteur } from "../anmeldung/akteur";
import { dokumentSichtbar } from "../dokumente/ziele";
import { hatBereich } from "../rechte/bereiche";
import { portfolioSicht } from "../rechte/sichtbarkeit";
import type { Tx } from "../zeitlimit";
import { ladeNavBestandteile } from "./fonds";

type Nachweis = { bewertungId: string; dokumentId: string; dateiname: string; seite: number | null };

/** Verweise sind personenbezogen und werden deshalb erst beim Öffnen der Herkunft gelesen. */
export async function ladeNavEinzelwerte(tx: Tx, akteur: Akteur, fondsId: string, stichtag: string, stand: string) {
  // Durchrechnung nur für Zielfonds, die die Person sieht (gleiche Zahl wie ihre Fondsübersicht).
  const { portfolio, salden, nav } = await ladeNavBestandteile(tx, fondsId, stichtag, stand, new Set(), { sieht: portfolioSicht(akteur) });
  const ids = portfolio.map((p) => p.bewertungId);
  const nachweise = new Map<string, Nachweis[]>();
  if (ids.length && hatBereich(akteur, "dokumente") && hatRolle(akteur, fondsId, "betrachter", "dokumente")) {
    const { rows } = await tx.execute<Nachweis>(sql`
      WITH quellen AS (
        SELECT objekt_id, dokument_id, seite FROM wert_quelle
        WHERE objekt_typ = 'bewertung' AND objekt_id = ANY(${sql.param(ids)}::uuid[]) AND erstellt_am <= ${stand}::timestamptz
        UNION
        SELECT ziel_id, dokument_id, NULL FROM dokument_verknuepfung
        WHERE ziel_typ = 'bewertung' AND ziel_id = ANY(${sql.param(ids)}::uuid[]) AND erstellt_am <= ${stand}::timestamptz
      )
      SELECT q.objekt_id AS "bewertungId", d.id AS "dokumentId", d.dateiname, q.seite
      FROM quellen q JOIN dokument d ON d.id = q.dokument_id
      WHERE d.status IN ('aktiv', 'ersetzt') AND d.hochgeladen_am <= ${stand}::timestamptz
        AND ${dokumentSichtbar(fuerBereich(akteur, "dokumente"), sql`d.id`)}
      ORDER BY d.dateiname, d.id, q.seite`);
    for (const r of rows) {
      const liste = nachweise.get(r.bewertungId) ?? [];
      if (r.seite !== null || !liste.some((n) => n.dokumentId === r.dokumentId)) liste.push(r);
      nachweise.set(r.bewertungId, liste);
    }
  }
  return {
    portfolio: portfolio.map((p) => ({ ...p, nachweise: nachweise.get(p.bewertungId) ?? [] })),
    salden: nav !== null && hatBereich(akteur, "finanzen") && hatRolle(akteur, fondsId, "betrachter", "finanzen")
      ? salden.filter((p) => p.gruppe === "bank" || p.gruppe === "sonstiges" || p.gruppe === "schulden")
      : [],
  };
}
