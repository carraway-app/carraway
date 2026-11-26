import { eq } from "drizzle-orm";
import { tranche, vorgang } from "@carraway/db";
import { Decimal } from "@carraway/rechenkern";
import { Fachfehler } from "../fehler";
import type { Protokollant } from "../schreiben";
import type { Tx } from "../zeitlimit";
import { ladeBuchwertabgang } from "./verkaeufe";
import { loeseBetrag } from "../waehrung/betrag";
import { loeseInstrument, verlangeInstrumentAktiv, type InstrumentZeile } from "./instrumente";
import { alsVorgangJson } from "./tranchen";
import { ordneRundeZu, pruefeRundeDerBeteiligung } from "./vorgang-runde";
import {
  berechneZustand,
  buchwertVon,
  ladeVorgaenge,
  pruefeInstrumentInvarianten,
  pruefePeriodensperre,
  sperreBeteiligung,
  verlangeAktiv,
  verlangeDarlehensartig,
  vorgaengeDesInstruments,
  type VorgangDaten,
  type Zustand,
} from "./zustand";

/**
 * Der eine Schreibweg für Vorgänge einer Beteiligung: Zusage, Auszahlung (optional zu einer Tranche), Rückfluss, Tilgung, Wertberichtigung,
 * Zinszahlung, Dividende. `POST /investments/:id/transactions`, `POST /funds/:id/postings` und das Abschließen einer Finanzierungsrunde rufen
 * ihn auf, damit überall dieselben Invarianten, dieselbe Periodensperre und dasselbe Protokoll gelten. Jeder Vorgang bucht auf ein Instrument;
 * die Invarianten (Zusage, Kapitalverlauf, Berichtigung) gelten je Instrument.
 */

export interface VorgangEingabe {
  art: "zusage" | "auszahlung" | "rueckfluss" | "tilgung" | "wertberichtigung" | "zinszahlung" | "dividende";
  valuta: string;
  /** Betrag in der Fondswährung; darf fehlen, wenn `betragLokal` angegeben ist (dann gilt der Kurs der Tabelle zur Valuta). */
  betrag?: string | undefined;
  /** Betrag in der lokalen Währung der Beteiligung (nur, wenn sie von der Fondswährung abweicht). */
  betragLokal?: string | undefined;
  bemerkung?: string | null | undefined;
  /** Instrument, auf das gebucht wird; Pflicht, wenn die Beteiligung mehrere hat (sonst deren einziges). */
  instrumentId?: string | undefined;
  /** Nur bei der Auszahlung: die Tranche (muss zum Instrument gehören). `meilensteinId` ist der alte Name. */
  trancheId?: string | undefined;
  meilensteinId?: string | undefined;
  /** Nur bei der Zinszahlung: die Zinsbuchung (`zins`) desselben Instruments, die sie begleicht. */
  beglichenVorgangId?: string | undefined;
  /**
   * Finanzierungsrunde des Unternehmens, der der Vorgang zugeordnet wird. Ohne Angabe gilt die Runde des Instruments (sonst keine), `null` heißt
   * bewusst keiner Runde. Eine Runde eines anderen Unternehmens wird abgelehnt (`transaction_round_foreign`).
   */
  rundeId?: string | null | undefined;
  /** Bereits geprüfte Werte eigener Felder (`felder/werte.ts`, Objekt `vorgang`); ohne Angabe keine. */
  felder?: Record<string, unknown> | undefined;
}

/** Stand nach dem neuen Vorgang, ohne ihn zu schreiben. */
export function mitNeuem(
  vorhandene: readonly VorgangDaten[],
  neu: Pick<VorgangDaten, "art" | "valuta" | "betrag" | "kapitalisiert" | "storniertVorgangId" | "beteiligungId" | "trancheId" | "bemerkung"> & { instrumentId?: string | undefined },
  abgang: Decimal.Value,
): Zustand {
  const zeile: VorgangDaten = { id: "00000000-0000-4000-8000-000000000000", erfasstAm: new Date(), ...neu };
  return berechneZustand([...vorhandene, zeile], abgang);
}

/**
 * Stand nach einem neuen Vorgang (Buchung oder Storno) je Instrument und je Beteiligung (Buchwert), und die Invarianten dazu.
 * `abgang` ist der Buchwertabgang der Verkäufe der Beteiligung.
 */
export function pruefeNachBuchung(
  beteiligungId: string,
  i: Pick<InstrumentZeile, "id" | "art">,
  vorhandene: readonly VorgangDaten[],
  neu: Parameters<typeof mitNeuem>[1],
  abgang: Decimal.Value,
  mitPruefung = true,
) {
  const gesamt = mitNeuem(vorhandene, neu, abgang);
  const danach = mitNeuem(vorgaengeDesInstruments(vorhandene, i.id), neu, 0);
  if (mitPruefung) pruefeInstrumentInvarianten(beteiligungId, i.art, danach, gesamt);
  return { gesamt, danach };
}

/** Arten, die Kapital, Zusage oder Buchwert berühren (nur sie prüfen die Invarianten). Rückfluss, Zinszahlung und Dividende nicht. */
export const BERUEHRT_KAPITAL = new Set<string>(["zusage", "auszahlung", "tilgung", "wertberichtigung", "zins"]);

/** Tranche gehört zur Beteiligung und zum Instrument, ihre Bedingung (falls vorhanden) ist erfüllt, und die Auszahlungen übersteigen ihren Betrag nicht. */
async function pruefeTranche(tx: Tx, beteiligungId: string, instrumentId: string, trancheId: string, betrag: Decimal, vorhandene: readonly VorgangDaten[]) {
  const [m] = await tx.select().from(tranche).where(eq(tranche.id, trancheId));
  if (!m) throw new Fachfehler(404, "milestone_not_found", "Milestone not found.");
  if (m.beteiligungId !== beteiligungId) {
    throw new Fachfehler(409, "milestone_wrong_investment", "The milestone belongs to a different investment.");
  }
  if (m.instrumentId !== instrumentId) {
    throw new Fachfehler(409, "tranche_wrong_instrument", "The tranche belongs to a different instrument.", { trancheId: m.id, instrumentId: m.instrumentId });
  }
  if (m.bedingung && !m.erfuelltAm) throw new Fachfehler(409, "milestone_open", "The milestone has not been met yet.", { meilensteinId: m.id, frist: m.geplantAm });
  const bisher = vorhandene.filter((v) => v.art === "auszahlung" && v.trancheId === m.id).reduce((s, v) => s.plus(v.betrag), new Decimal(0));
  if (bisher.plus(betrag).greaterThan(m.betrag)) {
    throw new Fachfehler(409, "milestone_amount_exceeded", "The disbursements exceed the amount of the milestone.", {
      meilensteinBetrag: m.betrag,
      bisherAusgezahlt: bisher.toFixed(2),
    });
  }
}

/** Die Zinsbuchung, die eine Zinszahlung begleicht: gleiches Instrument, Art `zins`, nicht storniert. */
async function pruefeBeglichen(vorhandene: readonly VorgangDaten[], instrumentId: string, beglichenId: string) {
  const z = vorhandene.find((v) => v.id === beglichenId);
  const ungueltig = (grund: string) => new Fachfehler(409, "interest_payment_reference_invalid", "The interest payment does not refer to a valid interest booking of this instrument.", { beglichenVorgangId: beglichenId, grund });
  if (!z) throw ungueltig("nicht_gefunden");
  if (z.art !== "zins") throw ungueltig("keine_zinsbuchung");
  if (z.instrumentId !== instrumentId) throw ungueltig("anderes_instrument");
  if (z.storniertVorgangId || vorhandene.some((v) => v.storniertVorgangId === z.id)) throw ungueltig("storniert");
}

/** Sperrt die Beteiligung, prüft Periodensperre und Invarianten und schreibt Vorgang und Protokollzeile. */
export async function bucheVorgang(tx: Tx, protokoll: Protokollant, beteiligungId: string, eingabe: VorgangEingabe) {
  const b = await sperreBeteiligung(tx, beteiligungId);
  if (eingabe.rundeId) await pruefeRundeDerBeteiligung(tx, beteiligungId, eingabe.rundeId);
  const vorhandene = await ladeVorgaenge(tx, beteiligungId);
  const abgang = await ladeBuchwertabgang(tx, beteiligungId);
  const trancheId = eingabe.art === "auszahlung" ? (eingabe.trancheId ?? eingabe.meilensteinId) : undefined;
  if (eingabe.art === "auszahlung" && eingabe.trancheId && eingabe.meilensteinId && eingabe.trancheId !== eingabe.meilensteinId) {
    throw new Fachfehler(400, "invalid_input", "The input is invalid.", { felder: [{ feld: "trancheId", code: "inconsistent", meldung: "trancheId and meilensteinId refer to different tranches" }] });
  }
  const trancheZeile = trancheId ? (await tx.select({ instrumentId: tranche.instrumentId, beteiligungId: tranche.beteiligungId }).from(tranche).where(eq(tranche.id, trancheId)))[0] : undefined;
  // Ohne Instrument gilt das der Tranche, sofern sie zur Beteiligung gehört (sonst meldet `pruefeTranche` die falsche Beteiligung).
  const i = await loeseInstrument(tx, b, eingabe.instrumentId, trancheZeile?.beteiligungId === beteiligungId ? trancheZeile.instrumentId : undefined);
  const lokal = await loeseBetrag(tx, b, { betrag: eingabe.betrag, betragLokal: eingabe.betragLokal, datum: eingabe.valuta, feld: "betrag", mitVorzeichen: eingabe.art === "wertberichtigung" });
  const neu = {
    beteiligungId,
    instrumentId: i.id,
    art: eingabe.art,
    valuta: eingabe.valuta,
    betrag: lokal.fonds,
    betragLokal: lokal.betragLokal,
    kurs: lokal.kurs,
    kursId: lokal.kursId,
    bemerkung: eingabe.bemerkung ?? null,
    kapitalisiert: false,
    storniertVorgangId: null,
    trancheId: trancheId ?? null,
    beglichenVorgangId: eingabe.art === "zinszahlung" ? (eingabe.beglichenVorgangId ?? null) : null,
    felder: eingabe.felder ?? {},
  };

  await pruefePeriodensperre(tx, b.fondsId, eingabe.valuta);
  if (eingabe.art === "zusage" || eingabe.art === "auszahlung") {
    verlangeAktiv(b);
    verlangeInstrumentAktiv(i);
  }
  if (eingabe.art === "tilgung" || eingabe.art === "zinszahlung") verlangeDarlehensartig(i.art);
  if (eingabe.art === "dividende" && i.art !== "offene_beteiligung") {
    throw new Fachfehler(409, "instrument_mismatch", "A dividend is only possible on equity (direct equity investment).", { instrument: i.art });
  }
  if (eingabe.art === "zinszahlung" && eingabe.beglichenVorgangId) await pruefeBeglichen(vorhandene, i.id, eingabe.beglichenVorgangId);
  const { gesamt } = pruefeNachBuchung(beteiligungId, i, vorhandene, neu, abgang, BERUEHRT_KAPITAL.has(eingabe.art));
  // Nach den Invarianten: Eine Auszahlung über die Zusage meldet `disbursement_exceeds_commitment`, erst danach den Rest der Tranche.
  if (trancheId) await pruefeTranche(tx, beteiligungId, i.id, trancheId, new Decimal(lokal.fonds), vorhandene);

  const [zeile] = await tx.insert(vorgang).values(neu).returning();
  if (!zeile) throw new Error("Vorgang nicht angelegt");
  await protokoll("anlegen", "vorgang", zeile.id, null, zeile);
  const rundeId = await ordneRundeZu(tx, protokoll, zeile, { rundeId: eingabe.rundeId });
  return { vorgang: { ...alsVorgangJson(zeile), rundeId }, buchwert: buchwertVon(gesamt).wert.toFixed(2) };
}
