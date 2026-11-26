import { eq } from "drizzle-orm";
import { Decimal } from "@carraway/rechenkern";
import { fonds } from "@carraway/db";
import { Fachfehler } from "../fehler";
import type { Tx } from "../zeitlimit";
import { haltKursFest } from "./kurse";

/**
 * Betrag einer Zahlung oder Bewertung in Fondswährung und, bei einer Beteiligung in anderer lokaler Währung, mit dem lokalen Betrag und dem festgehaltenen Kurs
 * (Etappe 21). Der Fondsbetrag bleibt der gebuchte Betrag, auf dem alle Kennzahlen beruhen. Regeln:
 *
 * - Hat die Beteiligung keine abweichende lokale Währung, ist ein lokaler Betrag nicht zulässig (409 `WAEHRUNG_GLEICH`): Es gäbe zwei Wahrheiten für denselben Betrag.
 * - Nur lokaler Betrag: Kurs der Tabelle zum Tag (Valuta der Zahlung für Kosten, Stichtag für einen Zeitwert); fehlt er, 409 `KURS_FEHLT`.
 * - Beide Beträge: der gebuchte Fondsbetrag gilt (z. B. aus dem Kontoauszug), der Kurs wird daraus abgeleitet und festgehalten.
 * - Nur Fondsbetrag: wie bisher, ohne lokalen Betrag; die Lokalsicht rechnet ihn zum Kurs des Tages, solange es einen gibt.
 */

export interface GeloesterBetrag {
  fonds: string;
  betragLokal: string | null;
  kurs: string | null;
  kursId: string | null;
}

export async function waehrungen(tx: Tx, b: { fondsId: string; waehrung?: string | null | undefined }): Promise<{ fonds: string; lokal: string }> {
  const [f] = await tx.select({ waehrung: fonds.waehrung }).from(fonds).where(eq(fonds.id, b.fondsId));
  if (!f) throw new Fachfehler(404, "FONDS_NICHT_GEFUNDEN", "Fonds nicht gefunden.");
  return { fonds: f.waehrung, lokal: b.waehrung ?? f.waehrung };
}

const fehlt = (feld: string, meldung: string) => new Fachfehler(400, "EINGABE_UNGUELTIG", "Die Eingabe ist ungültig.", { felder: [{ feld, code: "pflicht", meldung }] });

export async function loeseBetrag(
  tx: Tx,
  b: { fondsId: string; waehrung?: string | null | undefined },
  e: { betrag: string | undefined; betragLokal: string | undefined; datum: string; feld: "betrag" | "wert"; /** Nur die Wertberichtigung darf negativ sein. */ mitVorzeichen?: boolean },
): Promise<GeloesterBetrag> {
  const lokalFeld = e.feld === "betrag" ? "betragLokal" : "wertLokal";
  if (e.betragLokal === undefined) {
    if (e.betrag === undefined) throw fehlt(e.feld, e.feld === "betrag" ? "Betrag angeben (in Fondswährung oder lokal)" : "Wert angeben (in Fondswährung oder lokal)");
    return { fonds: new Decimal(e.betrag).toFixed(2), betragLokal: null, kurs: null, kursId: null };
  }
  const w = await waehrungen(tx, b);
  if (w.lokal === w.fonds) {
    throw new Fachfehler(409, "WAEHRUNG_GLEICH", "Die Beteiligung hat keine abweichende lokale Währung; lokale Beträge sind nicht zulässig.", { fondsWaehrung: w.fonds, feld: lokalFeld });
  }
  const fest = await haltKursFest(tx, { lokal: e.betragLokal, fonds: e.betrag, lokaleWaehrung: w.lokal, fondsWaehrung: w.fonds, datum: e.datum });
  if (!e.mitVorzeichen && !new Decimal(fest.fonds).isPositive()) {
    throw new Fachfehler(400, "EINGABE_UNGUELTIG", "Die Eingabe ist ungültig.", { felder: [{ feld: e.feld, code: "vorzeichen", meldung: "Der Betrag muss größer als null sein" }] });
  }
  if (new Decimal(fest.fonds).isZero()) throw new Fachfehler(400, "EINGABE_UNGUELTIG", "Die Eingabe ist ungültig.", { felder: [{ feld: e.feld, code: "null_nach_umrechnung", meldung: "Der Betrag ergibt umgerechnet null" }] });
  return { fonds: fest.fonds, betragLokal: new Decimal(e.betragLokal).toFixed(2), kurs: fest.kurs, kursId: fest.kursId };
}
