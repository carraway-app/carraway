import { and, asc, eq, isNull } from "drizzle-orm";
import { anteilsuebertragung, beteiligung, optionsscheinAusuebung, organisation } from "@carraway/db";
import { Decimal, optionsscheinAusuebung as rechneAusuebung, type Rechenschritt } from "@carraway/rechenkern";
import { Fachfehler } from "../fehler";
import type { Protokollant } from "../schreiben";
import { waehrungen } from "../waehrung/betrag";
import type { Tx } from "../zeitlimit";
import { bucheVorgang } from "./buchen";
import { pruefeFolgende } from "../kapital/uebertragung";
import { ladeInstrument, sperreInstrument, verlangeInstrumentAktiv } from "./instrumente";
import { storniereVorgang } from "./verkauf";
import { pruefeDatumsfenster } from "./stichtag";
import { ladeVorgaenge, pruefePeriodensperre, verlangeAktiv } from "./zustand";

/**
 * Ausübung von Optionsscheinen eines Fonds (Issue 150). Die Ausübung ist ein Ereignis (`optionsschein_ausuebung`); der Fonds zahlt Anzahl × Ausübungspreis
 * (Rechenkern `optionsscheinAusuebung`), gebucht als Zusage und Auszahlung auf dem Optionsschein-Instrument über `bucheVorgang` (Invarianten, Periodensperre,
 * Journal, Protokoll). Damit stehen die Anschaffungskosten der Anteile (Kaufpreis der Optionsscheine plus Ausübungsbetrag) im Buchwert und in IRR und
 * Multiple. Die Anteile erscheinen ab dem Datum als ausgegebene Anteile des Fonds in der Kapitaltabelle (`kapital/wasserfall.ts`).
 *
 * Währung: Der Ausübungspreis steht in der Währung der Beteiligung. Weicht sie von der Fondswährung ab, wird der lokale Betrag gebucht (Kurs der Tabelle
 * zum Tag) oder, mit `betrag`, der gezahlte Fondsbetrag mit abgeleitetem Kurs.
 */

export interface AusuebungsEingabe {
  datum: string;
  anzahl: string;
  /** Nur bei abweichender Währung der Beteiligung: der gezahlte Betrag in der Fondswährung. */
  betrag?: string | undefined;
  bemerkung?: string | null | undefined;
}

export async function uebeOptionsscheineAus(tx: Tx, protokoll: Protokollant, instrumentId: string, e: AusuebungsEingabe) {
  const { i, b } = await sperreInstrument(tx, instrumentId);
  if (i.art !== "optionsschein") throw new Fachfehler(409, "instrument_mismatch", "Only warrants can be exercised.", { instrument: i.art });
  verlangeAktiv(b);
  verlangeInstrumentAktiv(i);
  pruefeDatumsfenster("date", e.datum);
  await pruefePeriodensperre(tx, b.fondsId, e.datum);
  const frueher = await tx.select().from(optionsscheinAusuebung).where(and(eq(optionsscheinAusuebung.instrumentId, i.id), isNull(optionsscheinAusuebung.storniertAm))).orderBy(asc(optionsscheinAusuebung.datum));
  let rechnung: { wert: { betrag: Decimal; offenDanach: Decimal }; schritte: Rechenschritt[] };
  try {
    rechnung = rechneAusuebung({ anzahl: i.optionsscheinAnzahl!, ausuebungspreis: i.ausuebungspreis!, ausgabeAm: i.ausgabeAm, laufzeitBis: i.laufzeitBis }, frueher, { datum: e.datum, anzahl: e.anzahl });
  } catch {
    throw new Fachfehler(409, "warrant_exercise_invalid", "This exercise is not possible (outside the term or more than the outstanding warrants).");
  }
  const w = await waehrungen(tx, b);
  const lokal = w.lokal !== w.fonds;
  if (!lokal && e.betrag !== undefined) {
    throw new Fachfehler(400, "invalid_input", "The input is invalid.", { felder: [{ feld: "amount", code: "only_for_foreign_currency", meldung: "The fund currency amount is only given if the investment currency differs" }] });
  }
  const anzahlText = new Decimal(e.anzahl).toFixed(0);
  const preisText = new Decimal(i.ausuebungspreis!).toFixed(4);
  const bemerkung = e.bemerkung ?? `Ausübung von ${anzahlText} Optionsscheinen zu ${preisText} je Anteil`;
  let zusageId: string | null = null;
  let auszahlungId: string | null = null;
  let gebucht = new Decimal(0);
  if (rechnung.wert.betrag.greaterThan(0)) {
    const betrag = lokal ? { betragLokal: rechnung.wert.betrag.toFixed(2), ...(e.betrag !== undefined ? { betrag: e.betrag } : {}) } : { betrag: rechnung.wert.betrag.toFixed(2) };
    const zusage = await bucheVorgang(tx, protokoll, b.id, { art: "zusage", valuta: e.datum, instrumentId: i.id, bemerkung, ...betrag });
    const auszahlung = await bucheVorgang(tx, protokoll, b.id, { art: "auszahlung", valuta: e.datum, instrumentId: i.id, bemerkung, ...betrag });
    zusageId = zusage.vorgang.id;
    auszahlungId = auszahlung.vorgang.id;
    gebucht = new Decimal(auszahlung.vorgang.betrag);
  }
  const [zeile] = await tx
    .insert(optionsscheinAusuebung)
    .values({ instrumentId: i.id, datum: e.datum, anzahl: anzahlText, preisJeAnteil: preisText, betrag: gebucht.toFixed(2), zusageVorgangId: zusageId, auszahlungVorgangId: auszahlungId, bemerkung: e.bemerkung ?? null })
    .returning();
  if (!zeile) throw new Error("Ausübung nicht angelegt");
  await protokoll("anlegen", "optionsschein_ausuebung", zeile.id, null, zeile);
  return { ausuebung: zeile, offenDanach: rechnung.wert.offenDanach.toFixed(0), schritte: rechnung.schritte };
}

/**
 * Storno einer Ausübung als Ganzes: Zusage und Auszahlung werden per Storno-Vorgang aufgehoben, die Ausübung zählt nicht mehr (die Anteile verschwinden aus der
 * Kapitaltabelle, die Optionsscheine sind wieder offen). Nicht möglich, wenn eine Übertragung aus den ausgeübten Anteilen abgibt (409
 * `warrant_exercise_reversal_dependent`) oder die Periode des Ausübungstags gesperrt ist. Die Rechte prüft die Route wie beim Anlegen (bearbeiter am Fonds).
 */
export async function storniereAusuebung(tx: Tx, protokoll: Protokollant, instrumentId: string, ausuebungId: string, grund: string) {
  // Gleiche Sperrreihenfolge wie das Anlegen und Stornieren einer Übertragung: erst das Unternehmen, dann die Beteiligung. So kann keine Übertragung aus dieser
  // Ausübung entstehen, während sie storniert wird.
  const vorab = await ladeInstrument(tx, instrumentId);
  const [bVorab] = await tx.select({ organisationId: beteiligung.organisationId }).from(beteiligung).where(eq(beteiligung.id, vorab.beteiligungId));
  if (bVorab) await tx.select({ id: organisation.id }).from(organisation).where(eq(organisation.id, bVorab.organisationId)).for("update");
  const { b } = await sperreInstrument(tx, instrumentId);
  const [a] = await tx.select().from(optionsscheinAusuebung).where(and(eq(optionsscheinAusuebung.id, ausuebungId), eq(optionsscheinAusuebung.instrumentId, instrumentId))).for("update");
  if (!a) throw new Fachfehler(404, "warrant_exercise_not_found", "Warrant exercise not found.");
  if (a.storniertAm) throw new Fachfehler(409, "warrant_exercise_already_reversed", "The warrant exercise has already been reversed.");
  const [abhaengig] = await tx.select({ id: anteilsuebertragung.id }).from(anteilsuebertragung).where(and(eq(anteilsuebertragung.quelleAusuebungId, a.id), isNull(anteilsuebertragung.storniertAm)));
  if (abhaengig) throw new Fachfehler(409, "warrant_exercise_reversal_dependent", "A share transfer gives up shares from this exercise; please reverse it first.", { uebertragungId: abhaengig.id });
  await pruefePeriodensperre(tx, b.fondsId, a.datum);
  const ids = [a.auszahlungVorgangId, a.zusageVorgangId].filter((x): x is string => x !== null);
  const vorgaenge = await ladeVorgaenge(tx, b.id);
  const text = `Storno der Ausübung zum ${a.datum}: ${grund}`;
  const stornos: string[] = [];
  for (const id of ids) {
    const original = vorgaenge.find((v) => v.id === id);
    if (!original) continue;
    const s = await storniereVorgang(tx, protokoll, b, original, text);
    if (s) stornos.push(s.id);
  }
  const [nachher] = await tx.update(optionsscheinAusuebung).set({ storniertAm: new Date(), storniertVon: protokoll.akteur }).where(eq(optionsscheinAusuebung.id, a.id)).returning();
  // Die Kapitaltabelle ohne diese Ausübung muss für alle späteren Übertragungen des Unternehmens aufgehen (Ausübung vor einer Runde mindert die Stammanteile).
  await pruefeFolgende(tx, b.organisationId, a.datum);
  await protokoll("stornieren", "optionsschein_ausuebung", a.id, a, { ...nachher, grund });
  return { ausuebung: nachher!, stornoVorgangIds: stornos };
}
