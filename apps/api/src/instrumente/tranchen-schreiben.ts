import { and, eq, sql } from "drizzle-orm";
import { tranche } from "@carraway/db";
import { Decimal } from "@carraway/rechenkern";
import { Fachfehler } from "../fehler";
import { heute, type Protokollant } from "../schreiben";
import type { Tx } from "../zeitlimit";
import { bucheVorgang } from "./buchen";
import { sperreInstrument } from "./instrumente";
import { alsMeilenstein, alsTranche, ausgezahltJeTranche, summeTranchen, trancheStand, type TrancheZeile } from "./tranchen";
import { berechneZustand, ladeVorgaenge, vorgaengeDesInstruments } from "./zustand";

/** Schreibwege der Tranchen: anlegen (optional mit der fehlenden Zusage), ändern, Bedingung als erfüllt melden. Alles bei gesperrter Beteiligung. */

export interface NeueTranche {
  bezeichnung: string;
  betrag: string;
  bedingung?: string | null | undefined;
  geplantAm?: string | null | undefined;
  /** Prüft Summe der Tranchen ≤ Zusage (`TRANCHEN_UEBER_ZUSAGE`); die alte Meilenstein-Route prüft sie nicht (Aufrufer legen die Zusage dort später an). */
  pruefeZusage?: boolean;
  /** Bucht die fehlende Zusage (Summe der Tranchen minus Zusage) im selben Schritt; Valuta der Zusage: `zusageValuta`, sonst heute. */
  zusageErhoehen?: boolean;
  zusageValuta?: string | undefined;
}

/** Eine Tranche für das Instrument anlegen. `nummer` zählt je Instrument hoch. */
export async function legeTrancheAn(tx: Tx, protokoll: Protokollant, instrumentId: string, e: NeueTranche, tabelle: "tranche" | "meilenstein" = "tranche") {
  const { i, b } = await sperreInstrument(tx, instrumentId);
  const vorgaenge = await ladeVorgaenge(tx, b.id);
  const zusage = berechneZustand(vorgaengeDesInstruments(vorgaenge, i.id)).zusage;
  const bestehend = await summeTranchen(tx, i.id);
  const summe = bestehend.plus(e.betrag);
  let zusageVorgang: Awaited<ReturnType<typeof bucheVorgang>>["vorgang"] | null = null;
  if (e.pruefeZusage !== false && summe.greaterThan(zusage)) {
    if (!e.zusageErhoehen) {
      throw new Fachfehler(409, "TRANCHEN_UEBER_ZUSAGE", "Die Tranchen würden die Zusage des Instruments übersteigen.", {
        zusage: zusage.toFixed(2),
        tranchen: bestehend.toFixed(2),
        betrag: new Decimal(e.betrag).toFixed(2),
      });
    }
    const fehlt = summe.minus(zusage);
    const gebucht = await bucheVorgang(tx, protokoll, b.id, { art: "zusage", valuta: e.zusageValuta ?? heute(), betrag: fehlt.toFixed(2), bemerkung: `Zusage für Tranche „${e.bezeichnung}“`, instrumentId: i.id });
    zusageVorgang = gebucht.vorgang;
  }
  const [maximum] = await tx.select({ n: sql<number>`coalesce(max(${tranche.nummer}), 0)::int` }).from(tranche).where(eq(tranche.instrumentId, i.id));
  const [neu] = await tx
    .insert(tranche)
    .values({ beteiligungId: b.id, instrumentId: i.id, nummer: (maximum?.n ?? 0) + 1, bezeichnung: e.bezeichnung, bedingung: e.bedingung ?? null, geplantAm: e.geplantAm ?? null, betrag: e.betrag })
    .returning();
  if (!neu) throw new Error("Tranche nicht angelegt");
  await protokoll("anlegen", tabelle, neu.id, null, alsMeilenstein(neu));
  return { tranche: { ...alsTranche(neu), stand: trancheStand(neu, 0) }, zusageVorgang };
}

async function sperreTranche(tx: Tx, id: string): Promise<{ t: TrancheZeile }> {
  const [vorab] = await tx.select().from(tranche).where(eq(tranche.id, id));
  if (!vorab) throw new Fachfehler(404, "MEILENSTEIN_NICHT_GEFUNDEN", "Meilenstein nicht gefunden.");
  return { t: vorab };
}

export interface TrancheAenderung {
  bezeichnung?: string | undefined;
  betrag?: string | undefined;
  bedingung?: string | null | undefined;
  geplantAm?: string | null | undefined;
}

/** Ändert Bezeichnung, Betrag, Bedingung und geplantes Datum; der Betrag nicht unter das bereits Ausgezahlte und nicht über die Zusage. */
export async function aendereTranche(tx: Tx, protokoll: Protokollant, id: string, e: TrancheAenderung) {
  const { t: vorab } = await sperreTranche(tx, id);
  const { i, b } = await sperreInstrument(tx, vorab.instrumentId);
  const [vorher] = await tx.select().from(tranche).where(eq(tranche.id, id)).for("update");
  if (!vorher) throw new Fachfehler(404, "MEILENSTEIN_NICHT_GEFUNDEN", "Meilenstein nicht gefunden.");
  const vorgaenge = await ladeVorgaenge(tx, b.id);
  const ausgezahlt = ausgezahltJeTranche(vorgaenge).get(id) ?? new Decimal(0);
  if (e.betrag !== undefined) {
    if (ausgezahlt.greaterThan(e.betrag)) {
      throw new Fachfehler(409, "MEILENSTEIN_BETRAG_UEBERSCHRITTEN", "Die Auszahlungen übersteigen den Betrag des Meilensteins.", { meilensteinBetrag: new Decimal(e.betrag).toFixed(2), bisherAusgezahlt: ausgezahlt.toFixed(2) });
    }
    const zusage = berechneZustand(vorgaengeDesInstruments(vorgaenge, i.id)).zusage;
    const summe = (await summeTranchen(tx, i.id, id)).plus(e.betrag);
    if (summe.greaterThan(zusage) && new Decimal(e.betrag).greaterThan(vorher.betrag)) {
      throw new Fachfehler(409, "TRANCHEN_UEBER_ZUSAGE", "Die Tranchen würden die Zusage des Instruments übersteigen.", { zusage: zusage.toFixed(2), tranchen: (await summeTranchen(tx, i.id, id)).toFixed(2), betrag: new Decimal(e.betrag).toFixed(2) });
    }
  }
  const aenderung: Partial<typeof tranche.$inferInsert> = {};
  if (e.bezeichnung !== undefined) aenderung.bezeichnung = e.bezeichnung;
  if (e.betrag !== undefined) aenderung.betrag = e.betrag;
  if (e.bedingung !== undefined) aenderung.bedingung = e.bedingung;
  if (e.geplantAm !== undefined) aenderung.geplantAm = e.geplantAm;
  if (Object.keys(aenderung).length === 0) return { ...alsTranche(vorher), stand: trancheStand(vorher, ausgezahlt) };
  const [nachher] = await tx.update(tranche).set(aenderung).where(and(eq(tranche.id, id))).returning();
  if (!nachher) throw new Fachfehler(404, "MEILENSTEIN_NICHT_GEFUNDEN", "Meilenstein nicht gefunden.");
  await protokoll("aendern", "tranche", id, alsMeilenstein(vorher), alsMeilenstein(nachher));
  return { ...alsTranche(nachher), stand: trancheStand(nachher, ausgezahlt) };
}

/** Meldet die Bedingung einer Tranche als erfüllt (einmal). Die alte Route protokolliert unter dem Namen `meilenstein`, die neue unter `tranche`. */
export async function erfuelleTranche(tx: Tx, protokoll: Protokollant, id: string, datum: string | undefined, nachweis: string | null | undefined, tabelle: "tranche" | "meilenstein" = "tranche") {
  const { t: vorab } = await sperreTranche(tx, id);
  const { b } = await sperreInstrument(tx, vorab.instrumentId);
  const [vorher] = await tx.select().from(tranche).where(eq(tranche.id, id)).for("update");
  if (vorher?.erfuelltAm) throw new Fachfehler(409, "MEILENSTEIN_ERFUELLT", "Der Meilenstein ist bereits erfüllt.");
  const [neu] = await tx
    .update(tranche)
    .set({ erfuelltAm: datum ?? heute(), nachweis: nachweis ?? vorher?.nachweis ?? null })
    .where(eq(tranche.id, id))
    .returning();
  await protokoll("erfuellen", tabelle, id, vorher && alsMeilenstein(vorher), neu && alsMeilenstein(neu));
  if (!neu) throw new Fachfehler(404, "MEILENSTEIN_NICHT_GEFUNDEN", "Meilenstein nicht gefunden.");
  const ausgezahlt = ausgezahltJeTranche(await ladeVorgaenge(tx, b.id)).get(id) ?? new Decimal(0);
  return { ...alsTranche(neu), stand: trancheStand(neu, ausgezahlt) };
}
