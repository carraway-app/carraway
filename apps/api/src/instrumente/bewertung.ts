import { and, desc, eq, lte } from "drizzle-orm";
import { bewertung, snapshotAuftrag } from "@carraway/db";
import { Fachfehler } from "../fehler";
import type { Protokollant } from "../schreiben";
import type { Tx } from "../zeitlimit";
import { pruefePeriodensperre, sperreBeteiligung } from "./zustand";

/**
 * Bewertungen je Stichtag mit Freigabe (Etappe 5). Nur `freigegeben` zählt für NAV, Snapshots und Berichte. Eine freigegebene
 * Bewertung wird nie geändert (Trigger); eine Korrektur ist eine neue Bewertung zum selben Stichtag, die die alte ersetzt
 * (Status `ersetzt`, `ersetzt_am`), die Historie bleibt über `ersetzt_bewertung_id` erhalten.
 */

export type BewertungZeile = typeof bewertung.$inferSelect;
export type Methode = BewertungZeile["methode"];

/** Methoden, für die keine Begründung nötig ist (Ansatz zu Anschaffungskosten). */
export const METHODEN_OHNE_BEGRUENDUNG: readonly Methode[] = ["anschaffungskosten"];

/** Letzte freigegebene Bewertung am oder vor dem Stichtag, `null` ohne Bewertung. */
export async function letzteBewertung(tx: Tx, beteiligungId: string, stichtag: string) {
  const [zeile] = await tx
    .select()
    .from(bewertung)
    .where(and(eq(bewertung.beteiligungId, beteiligungId), eq(bewertung.status, "freigegeben"), lte(bewertung.stichtag, stichtag)))
    .orderBy(desc(bewertung.stichtag))
    .limit(1);
  return zeile ?? null;
}

/** Vier-Augen-Prinzip auf angemeldeten Personen: Die Freigabe verlangt eine andere Benutzer-ID als die Erstellung. */
export function verlangeAnderenAkteur(erstelltVon: string, akteur: string) {
  if (erstelltVon === akteur) {
    throw new Fachfehler(409, "four_eyes_violated", "The approval must come from a different actor than the creation.");
  }
}

/** Fordert die Neuberechnung der Snapshots an (Änderungen per UPDATE löst der Trigger auch aus; dies ist die Absicherung im selben Korb). */
async function fordereNeuberechnungAn(tx: Tx, fondsId: string) {
  await tx.insert(snapshotAuftrag).values({ fondsId, stichtag: null }).onConflictDoNothing();
}

async function aktuelleFreigegeben(tx: Tx, beteiligungId: string, stichtag: string) {
  const [zeile] = await tx
    .select()
    .from(bewertung)
    .where(and(eq(bewertung.beteiligungId, beteiligungId), eq(bewertung.stichtag, stichtag), eq(bewertung.status, "freigegeben")))
    .for("update");
  return zeile ?? null;
}

/** Markiert die geltende Bewertung als ersetzt (gilt ab jetzt nicht mehr). */
async function ersetzeAlte(tx: Tx, protokoll: Protokollant, alt: BewertungZeile) {
  const [nachher] = await tx.update(bewertung).set({ status: "ersetzt", ersetztAm: new Date() }).where(eq(bewertung.id, alt.id)).returning();
  await protokoll("ersetzen", "bewertung", alt.id, alt, nachher);
}

/**
 * Systembuchung: Eine Bewertung, die aus einem gebuchten Ereignis folgt (Verkauf, Wandlung, Insolvenz, Verkäuferdarlehen),
 * wird sofort freigegeben (`erstellt_von` = Akteur der Anfrage, `freigegeben_von` = `system:ereignis`), ohne Vier-Augen-Schritt:
 * Das Ereignis selbst ist die Grundlage. Gibt es zum Stichtag schon eine geltende Bewertung, ersetzt die neue sie.
 */
export async function setzeBewertung(
  tx: Tx,
  protokoll: Protokollant,
  b: { id: string; fondsId: string },
  stichtag: string,
  wert: string,
  methode: Methode,
  begruendung: string,
) {
  await pruefePeriodensperre(tx, b.fondsId, stichtag);
  const alt = await aktuelleFreigegeben(tx, b.id, stichtag);
  if (alt) await ersetzeAlte(tx, protokoll, alt);
  const jetzt = new Date();
  const [neu] = await tx
    .insert(bewertung)
    .values({
      beteiligungId: b.id,
      stichtag,
      wert,
      methode,
      begruendung,
      status: "freigegeben",
      erstelltVon: protokoll.akteur,
      freigegebenVon: "system:ereignis",
      freigegebenAm: jetzt,
      erfasstAm: jetzt,
      ersetztBewertungId: alt?.id ?? null,
    })
    .returning();
  if (!neu) throw new Error("Bewertung nicht angelegt");
  await protokoll("anlegen", "bewertung", neu.id, null, neu);
  await fordereNeuberechnungAn(tx, b.fondsId);
  return neu;
}

/** Nimmt eine Systembewertung zurück (Status `ersetzt`), z. B. beim Storno eines Verkaufs; ohne Nachfolger. */
export async function nimmBewertungZurueck(tx: Tx, protokoll: Protokollant, bewertungId: string, fondsId: string) {
  const [zeile] = await tx.select().from(bewertung).where(eq(bewertung.id, bewertungId)).for("update");
  if (!zeile || zeile.status !== "freigegeben") return;
  await pruefePeriodensperre(tx, fondsId, zeile.stichtag);
  await ersetzeAlte(tx, protokoll, zeile);
  await fordereNeuberechnungAn(tx, fondsId);
}

export interface NeueBewertungEingabe {
  stichtag: string;
  wert: string;
  /** Lokaler Wert mit festgehaltenem Kurs (Etappe 21), bereits aufgelöst (`waehrung/betrag.ts`). */
  lokal?: { wertLokal: string; kurs: string; kursId: string | null } | null | undefined;
  methode: Methode;
  begruendung?: string | null;
  grundlage?: string | null;
  bewertungsrundeId?: string | null;
}

/** Prüft die Regel „Begründung bei allen Methoden außer Anschaffungskosten“. */
export function pruefeBegruendung(methode: Methode, begruendung: string | null | undefined) {
  if (!METHODEN_OHNE_BEGRUENDUNG.includes(methode) && !begruendung?.trim()) {
    throw new Fachfehler(400, "invalid_input", "The input is invalid.", {
      felder: [{ feld: "begruendung", code: "justification_required", meldung: "A justification is required for this method" }],
    });
  }
}

/** Legt einen Entwurf an. Die Beteiligung ist gesperrt; je Beteiligung und Stichtag gibt es höchstens einen offenen Entwurf. */
export async function legeEntwurfAn(tx: Tx, protokoll: Protokollant, beteiligungId: string, e: NeueBewertungEingabe) {
  const b = await sperreBeteiligung(tx, beteiligungId);
  await pruefePeriodensperre(tx, b.fondsId, e.stichtag);
  pruefeBegruendung(e.methode, e.begruendung);
  const [offen] = await tx
    .select({ id: bewertung.id })
    .from(bewertung)
    .where(and(eq(bewertung.beteiligungId, beteiligungId), eq(bewertung.stichtag, e.stichtag), eq(bewertung.status, "entwurf")));
  if (offen) throw new Fachfehler(409, "valuation_draft_exists", "A draft already exists for this as-of date.", { bewertungId: offen.id });
  const geltend = await aktuelleFreigegeben(tx, beteiligungId, e.stichtag);
  const [neu] = await tx
    .insert(bewertung)
    .values({
      beteiligungId,
      stichtag: e.stichtag,
      wert: e.wert,
      wertLokal: e.lokal?.wertLokal ?? null,
      kurs: e.lokal?.kurs ?? null,
      kursId: e.lokal?.kursId ?? null,
      methode: e.methode,
      begruendung: e.begruendung?.trim() || null,
      grundlage: e.grundlage?.trim() || null,
      status: "entwurf",
      erstelltVon: protokoll.akteur,
      ersetztBewertungId: geltend?.id ?? null,
      bewertungsrundeId: e.bewertungsrundeId ?? null,
    })
    .returning();
  if (!neu) throw new Error("Bewertung nicht angelegt");
  await protokoll("anlegen", "bewertung", neu.id, null, neu);
  return { bewertung: neu, ersetzt: geltend, fondsId: b.fondsId };
}

/**
 * Gibt einen Entwurf frei (Vier-Augen: andere Person als der Ersteller). Eine geltende Bewertung desselben
 * Stichtags wird dabei ersetzt. Die Beteiligung ist gesperrt, das schließt Gleichzeitigkeit mit Verkäufen und anderen Freigaben aus.
 */
export async function gibBewertungFrei(tx: Tx, protokoll: Protokollant, bewertungId: string) {
  const [vorab] = await tx.select().from(bewertung).where(eq(bewertung.id, bewertungId));
  if (!vorab) throw new Fachfehler(404, "valuation_not_found", "Valuation not found.");
  const b = await sperreBeteiligung(tx, vorab.beteiligungId);
  const [vorher] = await tx.select().from(bewertung).where(eq(bewertung.id, bewertungId)).for("update");
  if (!vorher) throw new Fachfehler(404, "valuation_not_found", "Valuation not found.");
  if (vorher.status !== "entwurf") {
    throw new Fachfehler(409, "valuation_status_invalid", `The valuation has the status "${vorher.status}".`, { status: vorher.status });
  }
  verlangeAnderenAkteur(vorher.erstelltVon, protokoll.akteur);
  // Freigabe und Ersetzung buchen einen Wert zum Stichtag: in gesperrter Periode nicht erlaubt (zusätzlich der Trigger).
  await pruefePeriodensperre(tx, b.fondsId, vorher.stichtag);
  const alt = await aktuelleFreigegeben(tx, vorher.beteiligungId, vorher.stichtag);
  if (alt) await ersetzeAlte(tx, protokoll, alt);
  const [nachher] = await tx
    .update(bewertung)
    .set({ status: "freigegeben", freigegebenVon: protokoll.akteur, freigegebenAm: new Date(), ersetztBewertungId: alt?.id ?? null })
    .where(eq(bewertung.id, bewertungId))
    .returning();
  if (!nachher) throw new Error("Bewertung nicht freigegeben");
  await protokoll("freigeben", "bewertung", bewertungId, vorher, nachher);
  await fordereNeuberechnungAn(tx, b.fondsId);
  return nachher;
}

export interface EntwurfAenderung {
  wert?: string | undefined;
  /** Neuer lokaler Wert (aufgelöst); bei einer Änderung nur des Fondswerts entfällt der lokale Wert, damit nichts Veraltetes stehen bleibt. */
  lokal?: { wertLokal: string; kurs: string; kursId: string | null } | null | undefined;
  methode?: Methode | undefined;
  begruendung?: string | null | undefined;
}

/**
 * Ändert einen offenen Entwurf (Wert, Methode, Begründung). Die Beteiligung ist gesperrt, die Periodensperre gilt wie beim Anlegen,
 * die Begründungsregel wird auf dem Stand nach der Änderung geprüft. Wer ändert, ist danach der Urheber des Entwurfs
 * (`erstellt_von`): Die Freigabe verlangt eine andere Person, damit niemand einen selbst geänderten Wert allein freigeben kann.
 * Der frühere Urheber bleibt im Änderungsprotokoll.
 */
export async function aendereEntwurf(tx: Tx, protokoll: Protokollant, bewertungId: string, e: EntwurfAenderung) {
  const [vorab] = await tx.select().from(bewertung).where(eq(bewertung.id, bewertungId));
  if (!vorab) throw new Fachfehler(404, "valuation_not_found", "Valuation not found.");
  const b = await sperreBeteiligung(tx, vorab.beteiligungId);
  const [vorher] = await tx.select().from(bewertung).where(eq(bewertung.id, bewertungId)).for("update");
  if (!vorher || vorher.status !== "entwurf") {
    throw new Fachfehler(409, "valuation_status_invalid", `The valuation has the status "${vorher?.status ?? "?"}".`, { status: vorher?.status ?? null });
  }
  await pruefePeriodensperre(tx, b.fondsId, vorher.stichtag);
  const methode = e.methode ?? vorher.methode;
  const begruendung = e.begruendung === undefined ? vorher.begruendung : (e.begruendung?.trim() || null);
  pruefeBegruendung(methode, begruendung);
  const [nachher] = await tx
    .update(bewertung)
    .set({
      wert: e.wert ?? vorher.wert,
      ...(e.lokal ? { wertLokal: e.lokal.wertLokal, kurs: e.lokal.kurs, kursId: e.lokal.kursId } : e.wert !== undefined ? { wertLokal: null, kurs: null, kursId: null } : {}),
      methode,
      begruendung,
      erstelltVon: protokoll.akteur,
    })
    .where(eq(bewertung.id, bewertungId))
    .returning();
  if (!nachher) throw new Error("Bewertung nicht geändert");
  await protokoll("aendern", "bewertung", bewertungId, vorher, nachher);
  return nachher;
}

export async function verwirfEntwurf(tx: Tx, protokoll: Protokollant, bewertungId: string) {
  const [vorab] = await tx.select().from(bewertung).where(eq(bewertung.id, bewertungId));
  if (!vorab) throw new Fachfehler(404, "valuation_not_found", "Valuation not found.");
  await sperreBeteiligung(tx, vorab.beteiligungId);
  const [vorher] = await tx.select().from(bewertung).where(eq(bewertung.id, bewertungId)).for("update");
  if (!vorher || vorher.status !== "entwurf") {
    throw new Fachfehler(409, "valuation_status_invalid", `The valuation has the status "${vorher?.status ?? "?"}".`, { status: vorher?.status ?? null });
  }
  const [nachher] = await tx.update(bewertung).set({ status: "verworfen" }).where(eq(bewertung.id, bewertungId)).returning();
  await protokoll("verwerfen", "bewertung", bewertungId, vorher, nachher);
  return nachher!;
}
