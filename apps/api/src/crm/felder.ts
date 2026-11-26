import { and, asc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import type { Context } from "hono";
import { z } from "zod";
import { benutzer, crmObjekt, deal, feldDefinition, feldObjekt, feldTyp, investorBenutzer, wirksameFondsrolle, organisation, person } from "@carraway/db";
import { Fachfehler } from "../fehler";
import { dealSichtbar } from "../rechte/sichtbarkeit";
import type { Tx } from "../zeitlimit";

/** Eine Liste als Postgres-Array-Parameter (`ARRAY[$1, $2]::uuid[]`); drizzle würde ein JS-Array sonst als Tupel auffächern. */
export const feldArray = (werte: readonly string[], typ: "uuid" | "text"): SQL => sql`ARRAY[${sql.join(werte.map((w) => sql`${w}`), sql`, `)}]::${sql.raw(typ)}[]`;

/** Zeichenketten dürfen kein NUL-Zeichen enthalten (Postgres lehnt es in Text ab). */
export const ohneNul = (w: string) => !w.includes("\u0000");

export type Objekt = (typeof crmObjekt.enumValues)[number];
/** Objekte mit eigenen Feldern (Etappe 21): die CRM-Objekte und Fonds, Runde, Instrument, Beteiligung und Vorgang. */
export type FeldObjekt = (typeof feldObjekt.enumValues)[number];
export type FeldTyp = (typeof feldTyp.enumValues)[number];
export const OBJEKTE = crmObjekt.enumValues;
export const FELD_OBJEKTE = feldObjekt.enumValues;
export const FELD_TYPEN = feldTyp.enumValues;

/** Farben der Auswahloptionen: Schlüssel der Palette der Oberfläche (kein Orange). */
export const OPTIONSFARBEN = ["grau", "signal", "blau", "violett", "tuerkis", "rose", "sand"] as const;

export interface Option {
  schluessel: string;
  label: string;
  farbe: (typeof OPTIONSFARBEN)[number];
}

const optionSchema = z.object({
  schluessel: z.string().regex(/^[a-z0-9][a-z0-9_]{0,39}$/, "Lowercase letters, digits and underscores"),
  label: z.string().trim().min(1).max(80),
  farbe: z.enum(OPTIONSFARBEN).default("grau"),
});

/** Optionen je Feldtyp: Auswahl braucht Optionen, Verknüpfung ein Zielobjekt, Betrag eine Währung. */
export const optionenSchema = (typ: FeldTyp): z.ZodType<Record<string, unknown>> => {
  if (typ === "auswahl" || typ === "mehrfachauswahl") {
    return z
      .object({ optionen: z.array(optionSchema).min(1).max(100) })
      .refine((o) => new Set(o.optionen.map((x) => x.schluessel)).size === o.optionen.length, { message: "Option keys must be unique", path: ["optionen"] });
  }
  if (typ === "verknuepfung") return z.object({ ziel: z.enum(OBJEKTE) });
  if (typ === "betrag") return z.object({ waehrung: z.string().regex(/^[A-Z]{3}$/).default("EUR") });
  return z.object({}).strict();
};

export interface FeldDef {
  id: string;
  objekt: FeldObjekt;
  listeId: string | null;
  schluessel: string;
  name: string;
  typ: FeldTyp;
  optionen: Record<string, unknown>;
  position: number;
  version: number;
  archiviertAm: Date | null;
}

export async function ladeFelder(tx: Tx, objekt: FeldObjekt, listeId: string | null = null, mitArchiviert = false): Promise<FeldDef[]> {
  const rows = await tx
    .select()
    .from(feldDefinition)
    .where(and(eq(feldDefinition.objekt, objekt), listeId ? eq(feldDefinition.listeId, listeId) : isNull(feldDefinition.listeId), mitArchiviert ? undefined : isNull(feldDefinition.archiviertAm)))
    .orderBy(asc(feldDefinition.position), asc(feldDefinition.name), asc(feldDefinition.id));
  return rows as FeldDef[];
}

const DEZIMAL = /^-?\d{1,18}(\.\d{1,6})?$/;
const BETRAG = /^-?\d{1,16}(\.\d{1,2})?$/;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
const TELEFON = /^\+?[0-9 ()/.-]{4,30}$/;

export function istHttpUrl(wert: string): boolean {
  try {
    const url = new URL(wert);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** Wertschema je Feldtyp (ohne Bezug auf andere Datensätze; Benutzer und Verknüpfungen prüft `pruefeBezuege`). */
export function wertSchema(def: Pick<FeldDef, "typ" | "optionen">): z.ZodType<unknown> {
  const schluessel = ((def.optionen.optionen as Option[] | undefined) ?? []).map((o) => o.schluessel);
  switch (def.typ) {
    case "text":
      return z.string().trim().min(1).max(500).refine(ohneNul, { message: "Invalid character" });
    case "langtext":
      return z.string().trim().min(1).max(20000).refine(ohneNul, { message: "Invalid character" });
    case "zahl":
      return z.string().regex(DEZIMAL, "Decimal number as string expected");
    case "betrag":
      return z.string().regex(BETRAG, "Amount with at most two decimal places as string expected");
    case "datum":
      return z.iso.date();
    case "auswahl":
      return z.string().refine((w) => schluessel.includes(w), { message: "Unknown option" });
    case "mehrfachauswahl":
      return z
        .array(z.string().refine((w) => schluessel.includes(w), { message: "Unknown option" }))
        .max(100)
        .refine((a) => new Set(a).size === a.length, { message: "Duplicate option" });
    case "kontrollkaestchen":
      return z.boolean();
    case "url":
      return z.string().trim().max(500).refine(ohneNul).refine(istHttpUrl, { message: "Expected an absolute URL with http: or https:" });
    case "email":
      return z.string().trim().max(320).regex(EMAIL, "Invalid email address");
    case "telefon":
      return z.string().trim().regex(TELEFON, "Invalid phone number");
    case "benutzer":
    case "verknuepfung":
      return z.uuid();
  }
}

interface Fehlerzeile {
  feld: string;
  code: string;
  meldung: string;
}

/**
 * Prüft die Werte eigener Felder gegen die Definitionen. `null` entfernt den Wert. Unbekannte oder archivierte Felder werden
 * abgelehnt (sonst würden Tippfehler stillschweigend gespeichert). Gibt die geprüfte Teilmenge zurück.
 */
export async function pruefeFelder(tx: Tx, c: Context, defs: FeldDef[], werte: Record<string, unknown>): Promise<Record<string, unknown>> {
  const nachId = new Map(defs.map((d) => [d.id, d]));
  const fehler: Fehlerzeile[] = [];
  const geprueft: Record<string, unknown> = {};
  for (const [id, roh] of Object.entries(werte)) {
    const def = nachId.get(id);
    if (!def) {
      fehler.push({ feld: id, code: "unknown_field", meldung: "Unknown or archived field" });
      continue;
    }
    if (roh === null) {
      geprueft[id] = null;
      continue;
    }
    const ergebnis = wertSchema(def).safeParse(roh);
    if (!ergebnis.success) {
      fehler.push({ feld: id, code: "invalid_value", meldung: ergebnis.error.issues[0]?.message ?? "Invalid value" });
      continue;
    }
    geprueft[id] = ergebnis.data;
  }
  if (fehler.length === 0) fehler.push(...(await pruefeBezuege(tx, c, nachId, geprueft)));
  if (fehler.length > 0) throw new Fachfehler(400, "field_value_invalid", "At least one field value is invalid.", { felder: fehler });
  return geprueft;
}

async function pruefeBezuege(tx: Tx, c: Context, defs: Map<string, FeldDef>, werte: Record<string, unknown>): Promise<Fehlerzeile[]> {
  const fehler: Fehlerzeile[] = [];
  const nutzer = Object.entries(werte).filter(([id, w]) => w !== null && defs.get(id)?.typ === "benutzer") as [string, string][];
  if (nutzer.length) {
    // Aktive angemeldete Personen mit Zugriff (globale Verwaltung oder Rolle an einem Fonds), keine Investoren des LP-Portals.
    const rows = await tx
      .select({ id: benutzer.id })
      .from(benutzer)
      .where(
        and(
          inArray(benutzer.id, nutzer.map(([, w]) => w)),
          eq(benutzer.aktiv, true),
          eq(benutzer.technisch, false),
          sql`(${benutzer.globalVerwalter} OR EXISTS (SELECT 1 FROM ${wirksameFondsrolle} r WHERE r.benutzer_id = ${benutzer.id}))`,
          sql`NOT EXISTS (SELECT 1 FROM ${investorBenutzer} i WHERE i.benutzer_id = ${benutzer.id})`,
        ),
      );
    const da = new Set(rows.map((r) => r.id));
    for (const [id, w] of nutzer) if (!da.has(w)) fehler.push({ feld: id, code: "unknown_user", meldung: "Active person not found" });
  }
  for (const [id, w] of Object.entries(werte)) {
    const def = defs.get(id);
    if (!def || def.typ !== "verknuepfung" || w === null) continue;
    const ziel = def.optionen.ziel as Objekt;
    const tabelle = ziel === "organisation" ? organisation : ziel === "person" ? person : deal;
    // Ein Ziel, das die schreibende Person nicht sehen darf (Deal eines fremden Fonds), gilt wie ein fehlendes: gleiche Antwort, kein Hinweis auf die Kennung.
    // Archivierte und zusammengeführte Unternehmen und Kontakte sind für das CRM nicht mehr vorhanden (wie bei `ladeZeile`).
    const sichtbar = ziel === "deal" ? dealSichtbar(c) : ziel === "organisation" ? and(isNull(organisation.archiviertAm), isNull(organisation.zusammengefuehrtIn)) : and(isNull(person.archiviertAm), isNull(person.zusammengefuehrtIn));
    const [zeile] = await tx.select({ id: tabelle.id }).from(tabelle).where(and(eq(tabelle.id, w as string), ...(sichtbar ? [sichtbar] : [])));
    if (!zeile) fehler.push({ feld: id, code: "unknown_record", meldung: "Record not found" });
  }
  return fehler;
}

/** Feldschlüssel aus dem Namen: Kleinbuchstaben ohne Umlaute, Unterstrich statt Leerzeichen. */
export function schluesselAusName(name: string): string {
  const roh = name
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const mitBuchstabe = /^[a-z]/.test(roh) ? roh : `f_${roh}`;
  return mitBuchstabe.slice(0, 40).replace(/_+$/, "") || "feld";
}
