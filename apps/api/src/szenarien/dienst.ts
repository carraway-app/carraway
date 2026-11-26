import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { szenario } from "@carraway/db";
import { Fachfehler } from "../fehler";
import type { Tx } from "../zeitlimit";
import { annahmenSchema, type Annahmen } from "./annahmen";
import { rechneSzenario, type SzenarioErgebnis } from "./rechnen";

export type SzenarioZeile = typeof szenario.$inferSelect;

/** Stabile JSON-Darstellung (Schlüssel sortiert) für die Prüfsumme. */
export function kanonisch(wert: unknown): string {
  if (Array.isArray(wert)) return `[${wert.map(kanonisch).join(",")}]`;
  if (wert && typeof wert === "object") {
    return `{${Object.entries(wert as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${kanonisch(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(wert);
}

/** SHA-256 über Annahmen, Basistag, Wissensstand und Ergebnis. */
export const ergebnisHash = (z: { annahmen: unknown; basisStichtag: string; wissensstand: string; ergebnis: unknown }) =>
  createHash("sha256").update(kanonisch({ annahmen: z.annahmen, basisStichtag: z.basisStichtag, wissensstand: z.wissensstand, ergebnis: z.ergebnis })).digest("hex");

export async function ladeSzenario(tx: Tx, id: string): Promise<SzenarioZeile> {
  const [z] = await tx.select().from(szenario).where(eq(szenario.id, id));
  if (!z) throw new Fachfehler(404, "scenario_not_found", "Scenario not found.");
  return z;
}

export const annahmenVon = (z: SzenarioZeile): Annahmen => annahmenSchema.parse(z.annahmen);

/** Ergebnis eines Szenarios: bei festgeschriebenen das gespeicherte (mit Prüfung der Prüfsumme), bei Entwürfen frisch gerechnet. */
export async function ergebnisVon(tx: Tx, z: SzenarioZeile): Promise<{ ergebnis: SzenarioErgebnis; pruefsumme: { gespeichert: string; neu: string; gueltig: boolean } | null }> {
  if (z.status === "festgeschrieben" && z.ergebnis && z.ergebnisHash && z.wissensstand) {
    const neu = ergebnisHash({ annahmen: z.annahmen, basisStichtag: z.basisStichtag, wissensstand: z.wissensstand.toISOString(), ergebnis: z.ergebnis });
    return { ergebnis: z.ergebnis as SzenarioErgebnis, pruefsumme: { gespeichert: z.ergebnisHash, neu, gueltig: neu === z.ergebnisHash } };
  }
  return { ergebnis: await rechneSzenario(tx, z.fondsId, z.basisStichtag, annahmenVon(z)), pruefsumme: null };
}

/** Sichtbare Felder eines Szenarios ohne das große Ergebnis. */
export const kopf = (z: SzenarioZeile) => ({
  id: z.id,
  fondsId: z.fondsId,
  name: z.name,
  basisStichtag: z.basisStichtag,
  status: z.status,
  erstelltVon: z.erstelltVon,
  erstelltAm: z.erstelltAm,
  geaendertAm: z.geaendertAm,
  festgeschriebenAm: z.festgeschriebenAm,
  festgeschriebenVon: z.festgeschriebenVon,
  ergebnisHash: z.ergebnisHash,
  wissensstand: z.wissensstand,
});

export async function ladeSzenarien(tx: Tx, fondsId: string, ids?: string[]): Promise<SzenarioZeile[]> {
  return tx
    .select()
    .from(szenario)
    .where(ids ? and(eq(szenario.fondsId, fondsId), inArray(szenario.id, ids)) : eq(szenario.fondsId, fondsId))
    .orderBy(asc(szenario.erstelltAm), desc(szenario.id));
}

// Vergleich -----------------------------------------------------------------------------------------------------------

export type KennzahlSchluessel =
  | "abgerufenEnde"
  | "ausschuettungenEnde"
  | "navNettoEnde"
  | "dpiEnde"
  | "tvpiEnde"
  | "irrNettoEnde"
  | "tvpiBruttoEnde"
  | "irrBruttoEnde"
  | "gebuehrenSumme"
  | "carrySumme"
  | "ausschuettungenBruttoSumme"
  | "tvpiTiefpunkt"
  | "tvpiTiefpunktJahr";

export interface Vergleich {
  jahre: number[];
  kennzahlen: { schluessel: KennzahlSchluessel; werte: (string | null)[] }[];
  /** J-Kurve: je Jahr und Szenario TVPI und IRR (netto), `null` ohne Wert. */
  jkurve: { jahr: number; werte: { tvpi: string | null; irrNetto: string | null }[] }[];
}

/** Kennzahlentabelle und J-Kurve für bis zu drei Ergebnisse; die Tabelle entsteht hier, die Oberfläche rechnet nichts. */
export function vergleiche(ergebnisse: SzenarioErgebnis[]): Vergleich {
  const jahre = [...new Set(ergebnisse.flatMap((e) => e.jahre.map((j) => j.jahr)))].sort((a, b) => a - b);
  const ende = (e: SzenarioErgebnis) => e.jahre[e.jahre.length - 1]!;
  const tiefpunkt = (e: SzenarioErgebnis) => {
    let min: { tvpi: string; jahr: number } | null = null;
    for (const j of e.jahre) if (j.tvpi !== null && (min === null || Number(j.tvpi) < Number(min.tvpi))) min = { tvpi: j.tvpi, jahr: j.jahr };
    return min;
  };
  const zeile = (schluessel: KennzahlSchluessel, f: (e: SzenarioErgebnis) => string | null) => ({ schluessel, werte: ergebnisse.map(f) });
  return {
    jahre,
    kennzahlen: [
      zeile("abgerufenEnde", (e) => ende(e).abgerufenKum),
      zeile("ausschuettungenEnde", (e) => ende(e).ausschuettungenKum),
      zeile("navNettoEnde", (e) => ende(e).navNetto),
      zeile("dpiEnde", (e) => ende(e).dpi),
      zeile("tvpiEnde", (e) => ende(e).tvpi),
      zeile("irrNettoEnde", (e) => ende(e).irrNetto),
      zeile("tvpiBruttoEnde", (e) => ende(e).tvpiBrutto),
      zeile("irrBruttoEnde", (e) => ende(e).irrBrutto),
      zeile("gebuehrenSumme", (e) => e.summen.gebuehren),
      zeile("carrySumme", (e) => e.summen.carry),
      zeile("ausschuettungenBruttoSumme", (e) => e.summen.ausschuettungenBrutto),
      zeile("tvpiTiefpunkt", (e) => tiefpunkt(e)?.tvpi ?? null),
      zeile("tvpiTiefpunktJahr", (e) => (tiefpunkt(e) ? String(tiefpunkt(e)!.jahr) : null)),
    ],
    jkurve: jahre.map((jahr) => ({
      jahr,
      // Je Jahr die Prognosezeile (nicht der Ausgangsstand, der im Basisjahr zusätzlich steht).
      werte: ergebnisse.map((e) => {
        const j = [...e.jahre].reverse().find((x) => x.jahr === jahr);
        return { tvpi: j?.tvpi ?? null, irrNetto: j?.irrNetto ?? null };
      }),
    })),
  };
}
