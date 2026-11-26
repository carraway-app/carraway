import { z } from "zod";
import type { BerichtsWaehrungssicht, SichtBetraege, SichtKurs, SichtLueckeBericht } from "@carraway/berichte";
import { ladeFondsSicht, type KursInfo } from "../waehrung/sicht";
import type { Tx } from "../zeitlimit";

/**
 * Währungssicht der Berichte (Nacharbeiten 9). Ein Bericht hat die Fondswährung (Standard), die lokale Währung je Beteiligung oder eine gewählte Vergleichswährung
 * (`docs/waehrung.md`). Die Sicht gilt für die Spalten Investiert, Rückflüsse (Erlös) und Bewertung; die übrigen Beträge und alle Kennzahlen bleiben in der Fondswährung.
 * Sie wird beim Anlegen des Berichts in `bericht.parameter.waehrung` festgehalten, wie die Vorlage. Die Rechnung ist die der Währungssicht der Oberfläche
 * (`waehrung/sicht.ts`): gleiche Kurse, gleiche Regeln, Lücke statt geschätztem Kurs, Kurs höchstens sieben Tage alt.
 */

export interface SichtWahl {
  sicht: "fonds" | "lokal" | "vergleich";
  /** ISO-Code der Vergleichswährung, nur bei `vergleich`. */
  vergleich: string | null;
}

/** Berichtsarten mit Währungssicht: die Berichte mit Zeilen je Beteiligung und Beträgen in Investiert, Rückflüssen und Bewertung. */
export const SICHT_ARTEN: readonly string[] = ["fondsbericht", "lp_bericht", "portfolioliste", "exitliste"];

export const FONDS_SICHT: SichtWahl = { sicht: "fonds", vergleich: null };

/** Eingabe der Währungssicht (Anlegen eines Berichts, Download): `vergleich` verlangt einen Währungscode, die anderen Sichten keinen. */
export const sichtEingabe = {
  waehrungssicht: z.enum(["fonds", "lokal", "vergleich"]).optional(),
  vergleichswaehrung: z.string().regex(/^[A-Z]{3}$/, "Currency code of three uppercase letters").optional(),
};

/** Fehler der Eingabe als Text (leer = gültig). */
export function pruefeSichtEingabe(e: { waehrungssicht?: SichtWahl["sicht"] | undefined; vergleichswaehrung?: string | undefined }): { feld: string; code: string; meldung: string } | null {
  if (e.waehrungssicht === "vergleich" && !e.vergleichswaehrung) return { feld: "vergleichswaehrung", code: "required", meldung: "The comparison view requires a comparison currency" };
  if (e.waehrungssicht !== "vergleich" && e.vergleichswaehrung) return { feld: "vergleichswaehrung", code: "comparison_only", meldung: "A comparison currency is only available in the comparison view" };
  return null;
}

export function sichtWahl(e: { waehrungssicht?: SichtWahl["sicht"] | undefined; vergleichswaehrung?: string | undefined }): SichtWahl {
  return e.waehrungssicht === undefined || e.waehrungssicht === "fonds" ? FONDS_SICHT : { sicht: e.waehrungssicht, vergleich: e.waehrungssicht === "vergleich" ? (e.vergleichswaehrung ?? null) : null };
}

/** Die im Bericht festgehaltene Sicht aus `bericht.parameter` (fehlt sie, gilt die Fondswährung). */
export function sichtAusParameter(parameter: unknown): SichtWahl {
  const w = (parameter as { waehrung?: { sicht?: unknown; vergleich?: unknown } } | null)?.waehrung;
  if (w?.sicht === "lokal") return { sicht: "lokal", vergleich: null };
  if (w?.sicht === "vergleich" && typeof w.vergleich === "string") return { sicht: "vergleich", vergleich: w.vergleich };
  return FONDS_SICHT;
}

/** Teil von `bericht.parameter` für die Sicht; bei der Fondswährung bleibt der Parameter unverändert. */
export const sichtParameter = (wahl: SichtWahl): Record<string, unknown> => (wahl.sicht === "fonds" ? {} : { waehrung: { sicht: wahl.sicht, ...(wahl.vergleich ? { vergleich: wahl.vergleich } : {}) } });

/** Ergebnis für einen Bericht: Beträge je Beteiligung und die Angaben zur Sicht (Kurse mit Datum, Lücken). */
export interface BerichtsSicht {
  je: Map<string, SichtBetraege>;
  sicht: BerichtsWaehrungssicht;
}

const alsKurs = (k: KursInfo, verwendung: SichtKurs["verwendung"]): SichtKurs => ({ von: k.von, nach: k.nach, kurs: k.kurs, kursDatum: k.kursDatum, tag: k.tag, verwendung });

/** Berechnet die Sicht für alle Beteiligungen des Fonds bis zum Stichtag (nur für `lokal` und `vergleich`; sonst `null`). */
export async function ladeBerichtsSicht(tx: Tx, fondsId: string, stichtag: string, stand: string | undefined, wahl: SichtWahl): Promise<BerichtsSicht | null> {
  if (wahl.sicht === "fonds") return null;
  const f = await ladeFondsSicht(tx, fondsId, { stichtag, stand, vergleich: wahl.sicht === "vergleich" ? wahl.vergleich : null });
  const je = new Map<string, SichtBetraege>();
  const kurse: SichtKurs[] = [];
  const luecken: SichtLueckeBericht[] = [];
  for (const z of f.zeilen) {
    const waehlen = (b: { lokal: string | null; vergleich: string | null } | null | undefined): string | null => (b === null || b === undefined ? null : wahl.sicht === "lokal" ? b.lokal : b.vergleich);
    je.set(z.beteiligungId, {
      waehrung: wahl.sicht === "lokal" ? z.lokalWaehrung : (wahl.vergleich ?? f.waehrungen.fonds),
      investiert: waehlen(z.investiert),
      rueckfluesse: waehlen(z.rueckfluesse),
      bewertung: waehlen(z.letzteBewertung?.wert),
      ...(z.letzteBewertung === null ? { ohneBewertung: true } : {}),
    });
    kurse.push(...z.kostenKurse.map((k) => alsKurs(k, "kosten")), ...(z.letzteBewertung?.kurse ?? []).map((k) => alsKurs(k, "zeitwert")));
    luecken.push(...z.luecken.map((l) => ({ von: l.von, nach: l.nach, tag: l.tag, grund: l.grund, letzterKursDatum: l.letzterKursDatum, verwendung: l.verwendung })));
  }
  const gleich = (a: SichtKurs, b: SichtKurs) => a.von === b.von && a.nach === b.nach && a.kursDatum === b.kursDatum && a.tag === b.tag && a.verwendung === b.verwendung;
  const gleicheLuecke = (a: SichtLueckeBericht, b: SichtLueckeBericht) => a.von === b.von && a.nach === b.nach && a.tag === b.tag && a.verwendung === b.verwendung;
  return {
    je,
    sicht: {
      sicht: wahl.sicht,
      vergleich: wahl.vergleich,
      kurse: kurse.filter((k, i) => kurse.findIndex((x) => gleich(x, k)) === i).sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : a.von.localeCompare(b.von))),
      luecken: luecken.filter((l, i) => luecken.findIndex((x) => gleicheLuecke(x, l)) === i).sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0)),
    },
  };
}
