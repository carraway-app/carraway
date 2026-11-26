import { and, asc, eq, inArray, or } from "drizzle-orm";
import {
  anzeigeAus,
  erzeugeMeldeCsv,
  erzeugeMeldePdf,
  erzeugeMeldeXlsx,
  ladeDefinition,
  pruefeRegeln,
  type Befund,
  type DefinitionInhalt,
  type MeldeAusgabe,
} from "@carraway/berichte";
import { aenderung, foerderprogramm, fonds, meldeFreigabe, meldeLauf, meldeWert, type MeldeLauf, type MeldeWert } from "@carraway/db";
import { Fachfehler } from "../fehler";
import type { Tx } from "../zeitlimit";

/** Schnappschuss der Definitionsversion im Lauf: Kopfdaten und Inhalt. */
export interface Schnappschuss {
  meta: { schluessel: string; version: number; bezeichnungDe: string; bezeichnungEn: string; herausgeber: string; rhythmus: string; format: string };
  inhalt: DefinitionInhalt;
}

export function schnappschussVon(lauf: Pick<MeldeLauf, "definition">): Schnappschuss {
  const roh = lauf.definition as { meta: Schnappschuss["meta"]; inhalt: unknown };
  return { meta: roh.meta, inhalt: ladeDefinition(roh.inhalt) };
}

export async function sperreLauf(tx: Tx, id: string): Promise<MeldeLauf> {
  const [l] = await tx.select().from(meldeLauf).where(eq(meldeLauf.id, id)).for("update");
  if (!l) throw new Fachfehler(404, "MELDELAUF_NICHT_GEFUNDEN","Meldelauf nicht gefunden.");
  return l;
}

export const ladeWerte = (tx: Tx, laufId: string): Promise<MeldeWert[]> => tx.select().from(meldeWert).where(eq(meldeWert.laufId, laufId)).orderBy(asc(meldeWert.reihenfolge), asc(meldeWert.schluessel));

export interface BefundMitKommentar extends Befund {
  kommentar: { text: string; von: string; am: string } | null;
}

export function befundeAus(inhalt: DefinitionInhalt, werte: readonly MeldeWert[], kommentare: unknown): BefundMitKommentar[] {
  const karte = new Map(werte.map((w) => [w.schluessel, w.wert]));
  const k = (kommentare ?? {}) as Record<string, { text: string; von: string; am: string }>;
  return pruefeRegeln(inhalt, karte).map((b) => ({ ...b, kommentar: k[b.regelId] ?? null }));
}

/** Alle Personen, die Eingaben von Hand gemacht oder Warnungen kommentiert haben: Sie dürfen den Lauf nicht freigeben (wie die Bearbeiter von Berichtsabschnitten). */
export async function bisherigeBearbeiter(tx: Tx, laufId: string): Promise<Set<string>> {
  // Auch die Läufe, aus denen dieser durch eine neue Fassung hervorging (Kette über `vorgaenger_id`): Eingaben werden übernommen.
  const kette: string[] = [];
  for (let id: string | null = laufId; id && !kette.includes(id); ) {
    kette.push(id);
    const [z] = await tx.select({ v: meldeLauf.vorgaengerId }).from(meldeLauf).where(eq(meldeLauf.id, id));
    id = z?.v ?? null;
  }
  const werte = tx.select({ id: meldeWert.id }).from(meldeWert).where(inArray(meldeWert.laufId, kette));
  const zeilen = await tx
    .selectDistinct({ akteur: aenderung.akteur })
    .from(aenderung)
    .where(
      or(
        and(eq(aenderung.tabelle, "melde_wert"), eq(aenderung.aktion, "eingabe"), inArray(aenderung.datensatzId, werte)),
        and(eq(aenderung.tabelle, "melde_lauf"), eq(aenderung.aktion, "befund_kommentieren"), inArray(aenderung.datensatzId, kette)),
      ),
    );
  const aus = new Set(zeilen.map((z) => z.akteur));
  for (const w of await tx.select({ von: meldeWert.geaendertVon }).from(meldeWert).where(and(inArray(meldeWert.laufId, kette), eq(meldeWert.manuell, true)))) if (w.von) aus.add(w.von);
  return aus;
}

/** Gültige Freigaben nach Wiedergabe des Protokolls: ein `ok` fügt hinzu, ein `zurueck` nimmt die zuletzt erteilte zurück. */
export function aktiveFreigaben(protokoll: { ergebnis: string; akteur: string }[]): string[] {
  const aktiv: string[] = [];
  for (const p of protokoll) {
    if (p.ergebnis === "ok") aktiv.push(p.akteur);
    else aktiv.pop();
  }
  return aktiv;
}

export const ladeProtokoll = (tx: Tx, laufId: string) => tx.select().from(meldeFreigabe).where(eq(meldeFreigabe.laufId, laufId)).orderBy(asc(meldeFreigabe.am), asc(meldeFreigabe.id));

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "fonds";

export const MELDE_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const TYPEN: Record<string, string> = { xlsx: MELDE_XLSX, csv: "text/csv; charset=utf-8", pdf: "application/pdf" };

/** Ausgabe-Eingabe aus den gespeicherten Werten des Laufs. */
export async function ausgabeFuer(tx: Tx, lauf: MeldeLauf, entwurf: boolean): Promise<MeldeAusgabe> {
  const s = schnappschussVon(lauf);
  const sprache = lauf.sprache as "de" | "en";
  const werte = await ladeWerte(tx, lauf.id);
  const [f] = await tx.select().from(fonds).where(eq(fonds.id, lauf.fondsId));
  const [p] = lauf.foerderprogrammId ? await tx.select().from(foerderprogramm).where(eq(foerderprogramm.id, lauf.foerderprogrammId)) : [];
  const befunde = befundeAus(s.inhalt, werte, lauf.befundKommentare);
  return {
    sprache,
    bezeichnung: sprache === "de" ? s.meta.bezeichnungDe : s.meta.bezeichnungEn,
    kennung: `${s.meta.schluessel} Version ${s.meta.version}, Fassung ${lauf.fassung}`,
    fonds: { name: f?.name ?? "", kurzname: f?.kurzname ?? "", waehrung: f?.waehrung ?? "EUR" },
    programm: p?.bezeichnung ?? null,
    periode: { beginn: lauf.periodeBeginn, ende: lauf.periodeEnde, kennung: lauf.periodeKennung },
    stand: lauf.stand.toISOString(),
    entwurf,
    definition: s.inhalt,
    anzeige: anzeigeAus(s.inhalt, werte),
    werte: werte.map((w) => ({ schluessel: w.schluessel, art: w.art, wert: w.wert, herkunft: w.herkunft as MeldeAusgabe["werte"][number]["herkunft"], manuell: w.manuell })),
    befunde,
    kommentare: Object.fromEntries(befunde.flatMap((b) => (b.kommentar ? [[b.regelId, { text: b.kommentar.text }]] : []))),
  };
}

export interface Datei {
  bytes: Uint8Array;
  format: "xlsx" | "csv" | "pdf";
  name: string;
  typ: string;
}

/** Erzeugt die Datei zu Art (`meldung` im Format der Definition, `pruefansicht` immer PDF) aus den gespeicherten Werten; `xml` gibt es nicht. */
export async function erzeugeDatei(tx: Tx, lauf: MeldeLauf, art: "meldung" | "pruefansicht", entwurf: boolean): Promise<Datei> {
  const format = art === "pruefansicht" ? "pdf" : lauf.format;
  if (format === "xml") throw new Fachfehler(409, "MELDEFORMAT_NICHT_UNTERSTUETZT", "Für das Format xml gibt es noch keine Erzeugung.", { format });
  const a = await ausgabeFuer(tx, lauf, entwurf);
  const [f] = await tx.select({ kurz: fonds.kurzname }).from(fonds).where(eq(fonds.id, lauf.fondsId));
  const bytes = format === "xlsx" ? await erzeugeMeldeXlsx(a) : format === "csv" ? erzeugeMeldeCsv(a) : erzeugeMeldePdf(a);
  const zusatz = art === "pruefansicht" ? (a.sprache === "de" ? "-pruefansicht" : "-review") : "";
  const name = `${lauf.definitionSchluessel}-${slug(f?.kurz ?? "fonds")}-${lauf.periodeKennung}-f${lauf.fassung}${zusatz}${entwurf ? (a.sprache === "de" ? "-entwurf" : "-draft") : ""}.${format}`;
  return { bytes, format, name, typ: TYPEN[format]! };
}

export const dateiSchluessel = (laufId: string, hash: string, endung: string) => `melde/${laufId}/${hash}.${endung}`;
