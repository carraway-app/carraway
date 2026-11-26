import { sql } from "drizzle-orm";
import type { Akteur } from "../anmeldung/akteur";
import type { Tx } from "../zeitlimit";
import { dokumentSichtbar } from "./ziele";

/**
 * Fundstellen der Werte einer Beteiligung für die Herkunftsansicht: Bewertungen, Konditionen, Runden, Positionen und Klassen des Unternehmens und die Vertragswerte
 * der Beteiligung, zu denen es ein Quelldokument gibt (`wert_quelle`). Es erscheinen nur Dokumente, die die Person sehen darf und die nicht gelöscht
 * sind (ersetzte Versionen bleiben erreichbar, weil die Fundstelle auf sie zeigt).
 */

export interface Fundstelle {
  objektTyp: string;
  objektId: string;
  feld: string;
  wert: string;
  dokumentId: string;
  dateiname: string;
  seite: number;
  zitat: string;
  /** `ocr`: Das Zitat stammt aus der Texterkennung. */
  zitatQuelle: "text" | "ocr";
}

export async function ladeFundstellen(tx: Tx, akteur: Akteur, beteiligungId: string, organisationId: string): Promise<Fundstelle[]> {
  const { rows } = await tx.execute<{ objekt_typ: string; objekt_id: string; feld: string; wert: string; dokument_id: string; dateiname: string; seite: number; zitat: string; zitat_quelle: string }>(sql`
    SELECT w.objekt_typ, w.objekt_id, w.feld, w.wert, w.dokument_id, d.dateiname, w.seite, w.zitat, w.zitat_quelle
    FROM wert_quelle w JOIN dokument d ON d.id = w.dokument_id
    WHERE d.status IN ('aktiv', 'ersetzt') AND ${dokumentSichtbar(akteur, sql`d.id`)} AND (
      (w.objekt_typ = 'beteiligung' AND w.objekt_id = ${beteiligungId})
      OR (w.objekt_typ = 'bewertung' AND w.objekt_id IN (SELECT id FROM bewertung WHERE beteiligung_id = ${beteiligungId}))
      OR (w.objekt_typ = 'darlehen_kondition' AND w.objekt_id IN (SELECT id FROM darlehen_kondition WHERE beteiligung_id = ${beteiligungId}))
      OR (w.objekt_typ = 'finanzierungsrunde' AND w.objekt_id IN (SELECT id FROM finanzierungsrunde WHERE organisation_id = ${organisationId}))
      OR (w.objekt_typ = 'rundenposition' AND w.objekt_id IN (SELECT p.id FROM rundenposition p JOIN finanzierungsrunde r ON r.id = p.runde_id WHERE r.organisation_id = ${organisationId}))
      OR (w.objekt_typ = 'registereintrag' AND w.objekt_id IN (SELECT id FROM registereintrag WHERE organisation_id = ${organisationId}))
      OR (w.objekt_typ = 'anteilsklasse' AND w.objekt_id IN (SELECT id FROM anteilsklasse WHERE organisation_id = ${organisationId}))
    )
    ORDER BY w.erstellt_am, w.feld LIMIT 500`);
  return rows.map((r) => ({ objektTyp: r.objekt_typ, objektId: r.objekt_id, feld: r.feld, wert: r.wert, dokumentId: r.dokument_id, dateiname: r.dateiname, seite: r.seite, zitat: r.zitat, zitatQuelle: r.zitat_quelle === "ocr" ? "ocr" : "text" }));
}
