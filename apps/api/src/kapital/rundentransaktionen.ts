import { desc, eq, sql } from "drizzle-orm";
import { finanzierungsrunde } from "@carraway/db";
import { Decimal } from "@carraway/rechenkern";
import { hatRolle, sichtbareFonds, type Akteur } from "../anmeldung/akteur";
import { Fachfehler } from "../fehler";
import { liste } from "../import/sql";
import { verwandteFonds } from "./runden";
import type { Tx } from "../zeitlimit";

/**
 * Alle Fondsvorgänge eines Unternehmens, nach Finanzierungsrunde gruppiert (Historie je Runde, `docs/portfolio-model.md`, Abschnitt „Round transactions and bridge rounds“).
 * Runden sieht, wer sie auch in der Rundenliste sähe; Vorgänge nur aus Fonds, an denen die Person mindestens Betrachter ist (ein Unternehmen kann in
 * mehreren Fonds liegen).
 */

export type RundenTransaktion = {
  id: string;
  valuta: string;
  art: "zusage" | "auszahlung" | "rueckfluss" | "zins" | "tilgung" | "wertberichtigung" | "zinszahlung" | "dividende";
  betrag: string;
  bemerkung: string | null;
  kapitalisiert: boolean;
  /** Zeitpunkt der Erfassung (ISO), zweites Ordnungsmerkmal nach Valuta und Art. */
  erfasstAm: string;
  fonds: { id: string; name: string };
  beteiligungId: string;
  instrument: { id: string; bezeichnung: string; art: string };
  tranche: { id: string; nummer: number; bezeichnung: string } | null;
  /** Anteile der Rundenposition des Fonds, wenn sie sich ableiten lassen: an der ersten nicht stornierten Zusage des Instruments (aus Rundenabschluss oder Wandlung), sonst `null`. */
  anteile: string | null;
  /** Der Vorgang wurde storniert (ein Storno-Vorgang verweist auf ihn). */
  storniert: boolean;
  /** Bei einem Storno-Vorgang: der stornierte Vorgang, sonst `null`. */
  storniertVorgangId: string | null;
  /** Ob die Zuordnung zur Runde automatisch (Instrument, Wandlung, Storno) oder von Hand entstand; `null` ohne Runde. */
  quelle: "automatisch" | "manuell" | null;
};

export type RundentransaktionenAntwort = {
  organisationId: string;
  runden: { id: string; bezeichnung: string; datum: string; art: "eigenkapital" | "bruecke"; status: "entwurf" | "abgeschlossen"; transaktionen: RundenTransaktion[] }[];
  ohneRunde: RundenTransaktion[];
};

type Zeile = {
  id: string; valuta: string; art: RundenTransaktion["art"]; betrag: string; bemerkung: string | null; kapitalisiert: boolean; erfasst_am: string;
  fonds_id: string; fonds_name: string; beteiligung_id: string; instrument_id: string; instrument_bezeichnung: string; instrument_art: string;
  tranche_id: string | null; tranche_nummer: number | null; tranche_bezeichnung: string | null;
  runde_id: string | null; quelle: "automatisch" | "manuell" | null; storniert: boolean; storniert_vorgang_id: string | null; position_anteile: string | null;
};

export async function ladeRundentransaktionen(tx: Tx, akteur: Akteur, organisationId: string): Promise<RundentransaktionenAntwort> {
  const alleRunden = await tx
    .select()
    .from(finanzierungsrunde)
    .where(eq(finanzierungsrunde.organisationId, organisationId))
    .orderBy(desc(finanzierungsrunde.datum), desc(finanzierungsrunde.erstelltAm), desc(finanzierungsrunde.id));
  // Sichtbare Runden wie in der Rundenliste: Rechtsgrundlage am Unternehmen sieht alle, sonst nur Runden mit einer Position eines eigenen Fonds.
  let runden = alleRunden;
  if (!akteur.globalVerwalter) {
    const grundlage = await verwandteFonds(tx, organisationId);
    if (![...grundlage].some((f) => hatRolle(akteur, f, "betrachter"))) {
      const { rows } = await tx.execute<{ runde_id: string; fonds_id: string }>(sql`SELECT p.runde_id, p.fonds_id FROM rundenposition p JOIN finanzierungsrunde r ON r.id = p.runde_id WHERE r.organisation_id = ${organisationId} AND p.fonds_id IS NOT NULL`);
      const erlaubt = new Set(rows.filter((r) => hatRolle(akteur, r.fonds_id, "betrachter")).map((r) => r.runde_id));
      if (erlaubt.size === 0) throw new Fachfehler(403, "forbidden", "Permission for this is missing.");
      runden = alleRunden.filter((r) => erlaubt.has(r.id));
    }
  }
  const fonds = sichtbareFonds(akteur);
  const { rows } = await tx.execute<Zeile>(sql`
    SELECT v.id::text AS id, v.valuta::text AS valuta, v.art::text AS art, v.betrag::text AS betrag, v.bemerkung, v.kapitalisiert, v.erfasst_am::text AS erfasst_am,
           f.id::text AS fonds_id, f.name AS fonds_name, b.id::text AS beteiligung_id,
           i.id::text AS instrument_id, i.bezeichnung AS instrument_bezeichnung, i.art::text AS instrument_art,
           t.id::text AS tranche_id, t.nummer AS tranche_nummer, t.bezeichnung AS tranche_bezeichnung,
           vr.runde_id::text AS runde_id, vr.quelle::text AS quelle,
           EXISTS (SELECT 1 FROM vorgang s WHERE s.storniert_vorgang_id = v.id) AS storniert,
           v.storniert_vorgang_id::text AS storniert_vorgang_id,
           (SELECT p.anteile::text FROM rundenposition p WHERE p.instrument_id = v.instrument_id AND p.runde_id = vr.runde_id) AS position_anteile
    FROM vorgang v
    JOIN beteiligung b ON b.id = v.beteiligung_id
    JOIN fonds f ON f.id = b.fonds_id
    JOIN instrument i ON i.id = v.instrument_id
    LEFT JOIN tranche t ON t.id = v.tranche_id
    LEFT JOIN vorgang_runde vr ON vr.vorgang_id = v.id
    WHERE b.organisation_id = ${organisationId}
      ${fonds === "alle" ? sql`` : sql`AND b.fonds_id = ANY(${liste(fonds, "uuid")})`}
    ORDER BY v.valuta,
      CASE v.art WHEN 'zusage' THEN 0 WHEN 'auszahlung' THEN 1 WHEN 'zins' THEN 2 WHEN 'zinszahlung' THEN 3 WHEN 'dividende' THEN 4
                 WHEN 'tilgung' THEN 5 WHEN 'rueckfluss' THEN 6 WHEN 'wertberichtigung' THEN 7 ELSE 8 END,
      v.erfasst_am, v.id`);

  // Am selben Tag in logischer Reihenfolge (Zusage vor Auszahlung, Zins vor Zinszahlung, Tilgung vor Rückfluss), erst danach nach Erfassung.
  // Die Anteile einer Position stehen an der ersten nicht stornierten Zusage des Instruments in dieser Runde.
  const anteileVergeben = new Set<string>();
  const sichtbar = new Set(runden.map((r) => r.id));
  const alsZeile = (z: Zeile): RundenTransaktion => {
    let anteile: string | null = null;
    if (z.art === "zusage" && z.storniert_vorgang_id === null && !z.storniert && z.position_anteile !== null && z.runde_id !== null) {
      const schluessel = `${z.instrument_id}:${z.runde_id}`;
      if (!anteileVergeben.has(schluessel)) {
        anteileVergeben.add(schluessel);
        anteile = new Decimal(z.position_anteile).toFixed(0);
      }
    }
    return {
      id: z.id,
      valuta: z.valuta,
      art: z.art,
      betrag: z.betrag,
      bemerkung: z.bemerkung,
      kapitalisiert: z.kapitalisiert,
      erfasstAm: z.erfasst_am,
      fonds: { id: z.fonds_id, name: z.fonds_name },
      beteiligungId: z.beteiligung_id,
      instrument: { id: z.instrument_id, bezeichnung: z.instrument_bezeichnung, art: z.instrument_art },
      tranche: z.tranche_id ? { id: z.tranche_id, nummer: z.tranche_nummer ?? 0, bezeichnung: z.tranche_bezeichnung ?? "" } : null,
      anteile,
      storniert: z.storniert,
      storniertVorgangId: z.storniert_vorgang_id,
      quelle: z.runde_id ? z.quelle : null,
    };
  };
  const je = new Map<string, RundenTransaktion[]>(runden.map((r) => [r.id, []]));
  const ohneRunde: RundenTransaktion[] = [];
  for (const z of rows) {
    const t = alsZeile(z);
    if (z.runde_id === null) ohneRunde.push(t);
    else if (sichtbar.has(z.runde_id)) je.get(z.runde_id)!.push(t);
    // Eine Runde, die die Person nicht sieht (nur über eine Position erreichbar), bleibt samt Vorgang verborgen.
  }
  return {
    organisationId,
    runden: runden.map((r) => ({ id: r.id, bezeichnung: r.bezeichnung, datum: r.datum, art: r.art, status: r.status, transaktionen: je.get(r.id)! })),
    ohneRunde,
  };
}
