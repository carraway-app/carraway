import { sql } from "drizzle-orm";
import { Fachfehler } from "../fehler";
import { heute } from "../schreiben";
import type { Tx } from "../zeitlimit";

/** Wie weit ein Stichtag für Berechnungen in der Zukunft liegen darf (Tage ab heute). */
export const MAX_TAGE_IN_DIE_ZUKUNFT = 366;

function plusTage(datum: string, tage: number): string {
  const [j, m, t] = datum.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(j, m - 1, t + tage)).toISOString().slice(0, 10);
}

/**
 * Gemeinsame Prüfung für Berechnungs-Routen (Zinslauf, Abgrenzung): der Stichtag liegt höchstens 366 Tage nach heute
 * und nicht vor dem ersten Vorgang oder der ersten Fondsbewegung des Fonds (gibt es keine, entfällt die Untergrenze).
 * Schützt davor, mit einem fernen Datum tausende Zinsperioden rechnen zu lassen.
 */
export async function pruefeStichtag(tx: Tx, fondsId: string, stichtag: string, feld = "stichtag", optionen: { nichtNachHeute?: boolean } = {}): Promise<void> {
  const obergrenze = optionen.nichtNachHeute ? heute() : plusTage(heute(), MAX_TAGE_IN_DIE_ZUKUNFT);
  const { rows } = await tx.execute<{ erster: string | null }>(sql`
    SELECT least(
      (SELECT min(v.valuta) FROM vorgang v JOIN beteiligung b ON b.id = v.beteiligung_id WHERE b.fonds_id = ${fondsId}),
      (SELECT min(valuta) FROM fonds_bewegung WHERE fonds_id = ${fondsId})
    )::text AS erster`);
  const untergrenze = rows[0]?.erster ?? null;
  const zuSpaet = stichtag > obergrenze;
  const zuFrueh = untergrenze !== null && stichtag < untergrenze;
  if (zuSpaet || zuFrueh) {
    throw new Fachfehler(400, "EINGABE_UNGUELTIG", "Die Eingabe ist ungültig.", {
      felder: [
        {
          feld,
          code: "stichtag_ausserhalb",
          meldung: zuSpaet
            ? optionen.nichtNachHeute
              ? `Das Datum darf nicht nach heute liegen (${obergrenze})`
              : `Der Stichtag darf höchstens ${MAX_TAGE_IN_DIE_ZUKUNFT} Tage nach heute liegen (bis ${obergrenze})`
            : `Der Stichtag liegt vor dem ersten Vorgang oder der ersten Fondsbewegung des Fonds (${untergrenze})`,
        },
      ],
    });
  }
}

/** Fenster für Daten, die Schleifen im Rechenkern antreiben (Anker, Fälligkeit, Stundung): ab 1900, höchstens 50 Jahre nach heute. */
export const FENSTER_JAHRE = 50;

/**
 * Prüft ein Datum gegen ein Fenster (`von` bis `bis`, einschließlich). Ohne Angabe gilt 1900-01-01 bis heute plus 50 Jahre.
 * Ein Verstoß ist 400 mit Feldcode `datum_ausserhalb`.
 */
export function pruefeDatumsfenster(feld: string, datum: string, fenster: { von?: string; bis?: string } = {}): void {
  const von = fenster.von ?? "1900-01-01";
  const bis = fenster.bis ?? plusTage(heute(), FENSTER_JAHRE * 366);
  if (datum < von || datum > bis) {
    throw new Fachfehler(400, "EINGABE_UNGUELTIG", "Die Eingabe ist ungültig.", {
      felder: [{ feld, code: "datum_ausserhalb", meldung: `Das Datum muss zwischen ${von} und ${bis} liegen` }],
    });
  }
}
