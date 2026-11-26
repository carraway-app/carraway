import { and, eq, isNull, sql } from "drizzle-orm";
import { organisation, organisationArt, person } from "@carraway/db";
import { findeDubletten, findePersonenDubletten } from "../dubletten";
import { Fachfehler } from "../fehler";
import { leseCsv } from "../kontakte/import-datei";
import type { Protokollant } from "../schreiben";
import type { Tx } from "../zeitlimit";
import { setzeHauptunternehmen, synchronisiereVerknuepfungsfelder } from "./datensatz";
import { ladeFelder, wertSchema, type FeldDef, type Objekt, type Option } from "./felder";
import { OBJEKT_DEFS } from "./objekte";

/**
 * CSV-Import für Unternehmen und Kontakte mit freier Zuordnung der Spalten zu Feldern (auch eigenen). Jede Zeile wird je Feldtyp
 * umgewandelt und geprüft; Fehler gelten je Zeile, die übrigen Zeilen werden übernommen. Dubletten erkennt die Logik des Kontaktimports
 * (ähnlicher Name bzw. gleiche E-Mail-Adresse); je Lauf wählt die Person, ob Dubletten übersprungen, ergänzt oder trotzdem angelegt werden.
 */

export const MAX_ZEILEN = 2000;
export const MAX_BYTES = 2_000_000;

export type DublettenPolitik = "ueberspringen" | "aktualisieren" | "anlegen";

export interface Zuordnung {
  spalte: number;
  feld: string;
}

export interface Zeilenbefund {
  zeile: number;
  status: "neu" | "dublette" | "aktualisiert" | "angelegt" | "uebersprungen" | "fehler" | "leer";
  name: string | null;
  dublette?: { id: string; name: string; score: number };
  fehler: { feld: string; meldung: string }[];
}

const DATUM_DE = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;

/** Wandelt eine CSV-Zelle in den Wert des Feldtyps um (oder `undefined` bei leerer Zelle); Fehler als Text. */
function wandle(def: { typ: string; optionen: Record<string, unknown> }, roh: string): { wert?: unknown; fehler?: string } {
  const text = roh.trim();
  if (text === "") return {};
  switch (def.typ) {
    case "zahl":
    case "betrag": {
      const n = text.replace(/\s/g, "");
      const norm = n.includes(",") ? n.replace(/\./g, "").replace(",", ".") : n;
      return { wert: norm };
    }
    case "datum": {
      const m = DATUM_DE.exec(text);
      return { wert: m ? `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}` : text };
    }
    case "kontrollkaestchen": {
      const t = text.toLowerCase();
      if (["ja", "true", "1", "x", "yes"].includes(t)) return { wert: true };
      if (["nein", "false", "0", "no"].includes(t)) return { wert: false };
      return { fehler: "Ja oder Nein erwartet" };
    }
    case "auswahl":
    case "mehrfachauswahl": {
      const optionen = (def.optionen.optionen as Option[] | undefined) ?? [];
      const finde = (t: string) => optionen.find((o) => o.schluessel === t.toLowerCase() || o.label.toLowerCase() === t.toLowerCase())?.schluessel;
      if (def.typ === "auswahl") {
        const k = finde(text);
        return k ? { wert: k } : { fehler: `Unbekannte Option „${text}“` };
      }
      const teile = text.split(/[,;|]/).map((t) => t.trim()).filter(Boolean);
      const keys = teile.map(finde);
      const unbekannt = teile.filter((_, i) => !keys[i]);
      return unbekannt.length ? { fehler: `Unbekannte Option „${unbekannt[0]}“` } : { wert: [...new Set(keys as string[])] };
    }
    default:
      return { wert: text };
  }
}

interface Plan {
  zeile: number;
  system: Record<string, unknown>;
  eigene: Record<string, unknown>;
  unternehmenName: string | null;
  befund: Zeilenbefund;
}

function parseZeilen(csv: string): string[][] {
  if (Buffer.byteLength(csv, "utf8") > MAX_BYTES) throw new Fachfehler(400, "CRM_IMPORT_UNGUELTIG", "Die Datei ist zu groß (höchstens 2 MB).", { grund: "zu_gross" });
  const zeilen = leseCsv(csv);
  if (zeilen.length < 2) throw new Fachfehler(400, "CRM_IMPORT_UNGUELTIG", "Die Datei braucht eine Kopfzeile und mindestens eine Datenzeile.", { grund: "leer" });
  if (zeilen.length - 1 > MAX_ZEILEN) throw new Fachfehler(400, "CRM_IMPORT_UNGUELTIG", `Höchstens ${MAX_ZEILEN} Zeilen je Import.`, { grund: "zu_viele_zeilen" });
  return zeilen;
}

export function kopfzeile(csv: string): string[] {
  return parseZeilen(csv)[0]!.map((k) => k.trim());
}

async function baueFuer(tx: Tx, objekt: Exclude<Objekt, "deal">, csv: string, zuordnung: Zuordnung[]): Promise<Plan[]> {
  const zeilen = parseZeilen(csv);
  const spalten = zeilen[0]!.length;
  const def = OBJEKT_DEFS[objekt];
  const eigene = await ladeFelder(tx, objekt, null);
  const felder = new Map<string, { typ: string; optionen: Record<string, unknown>; system: boolean; schreibbar?: string; definition?: FeldDef }>();
  for (const f of def.felder) {
    if (f.schreibbar) felder.set(f.schluessel, { typ: f.typ, optionen: f.optionen ? { optionen: f.optionen.map((o) => ({ schluessel: o, label: o, farbe: "grau" })) } : {}, system: true, schreibbar: f.schreibbar.spalte });
  }
  for (const d of eigene) felder.set(d.id, { typ: d.typ, optionen: d.optionen, system: false, definition: d });
  const schluessel = new Set<string>();
  for (const z of zuordnung) {
    if (z.spalte >= spalten) throw new Fachfehler(400, "CRM_IMPORT_UNGUELTIG", "Die Zuordnung nennt eine Spalte, die es nicht gibt.", { grund: "spalte", spalte: z.spalte });
    const bekannt = felder.has(z.feld) || (objekt === "person" && z.feld === "unternehmen");
    if (!bekannt) throw new Fachfehler(400, "CRM_IMPORT_UNGUELTIG", "Die Zuordnung nennt ein Feld, das es nicht gibt oder nicht beschreibbar ist.", { grund: "feld", feld: z.feld });
    if (schluessel.has(z.feld)) throw new Fachfehler(400, "CRM_IMPORT_UNGUELTIG", "Ein Feld ist mehreren Spalten zugeordnet.", { grund: "doppelt", feld: z.feld });
    schluessel.add(z.feld);
  }
  const plaene: Plan[] = [];
  for (let i = 1; i < zeilen.length; i++) {
    const zelle = zeilen[i]!;
    const nr = i + 1;
    const befund: Zeilenbefund = { zeile: nr, status: "neu", name: null, fehler: [] };
    const plan: Plan = { zeile: nr, system: {}, eigene: {}, unternehmenName: null, befund };
    if (zelle.every((z) => z.trim() === "")) {
      befund.status = "leer";
      plaene.push(plan);
      continue;
    }
    for (const z of zuordnung) {
      const roh = zelle[z.spalte] ?? "";
      if (objekt === "person" && z.feld === "unternehmen") {
        if (roh.trim()) plan.unternehmenName = roh.trim();
        continue;
      }
      const f = felder.get(z.feld)!;
      const w = wandle(f, roh);
      if (w.fehler) {
        befund.fehler.push({ feld: z.feld, meldung: w.fehler });
        continue;
      }
      if (w.wert === undefined) continue;
      const geprueft = wertSchema({ typ: f.typ as never, optionen: f.optionen }).safeParse(w.wert);
      if (!geprueft.success) {
        befund.fehler.push({ feld: z.feld, meldung: geprueft.error.issues[0]?.message ?? "Ungültiger Wert" });
        continue;
      }
      if (f.system) plan.system[f.schreibbar!] = geprueft.data;
      else if (f.typ === "verknuepfung" || f.typ === "benutzer") befund.fehler.push({ feld: z.feld, meldung: "Verknüpfungs- und Personenfelder lassen sich nicht importieren" });
      else plan.eigene[z.feld] = geprueft.data;
    }
    const name = objekt === "organisation" ? ((plan.system.name as string | undefined) ?? null) : [plan.system.vorname, plan.system.nachname].filter(Boolean).join(" ") || null;
    befund.name = name;
    if (objekt === "organisation" && !plan.system.name) befund.fehler.push({ feld: "name", meldung: "Name fehlt" });
    if (objekt === "person" && (!plan.system.vorname || !plan.system.nachname)) befund.fehler.push({ feld: "nachname", meldung: "Vor- und Nachname werden gebraucht" });
    if (objekt === "organisation" && !plan.system.art) plan.system.art = "unternehmen";
    if (befund.fehler.length) befund.status = "fehler";
    plaene.push(plan);
  }
  return plaene;
}

/** Ab dieser Ähnlichkeit gilt ein Name im Import als Dublette (strenger als der Hinweis beim Anlegen). */
const IMPORT_SCHWELLE = 0.85;

async function pruefeDubletten(tx: Tx, objekt: "organisation" | "person", plaene: Plan[]) {
  const inDatei = new Map<string, number>();
  const ids = new Map<number, { id: string; name: string; score: number }>();
  for (const p of plaene) {
    if (p.befund.status !== "neu") continue;
    if (objekt === "organisation") {
      const [k] = await findeDubletten(tx, p.system.name as string, 1);
      if (k && k.score >= IMPORT_SCHWELLE) ids.set(p.zeile, { id: k.id, name: k.name, score: k.score });
      const schluessel = (p.system.name as string).toLowerCase().trim();
      if (inDatei.has(schluessel)) p.befund.fehler.push({ feld: "name", meldung: `Doppelt in der Datei (Zeile ${inDatei.get(schluessel)})` });
      else inDatei.set(schluessel, p.zeile);
    } else {
      const [k] = await findePersonenDubletten(tx, { vorname: p.system.vorname as string, nachname: p.system.nachname as string, email: (p.system.email as string | undefined) ?? null }, { limit: 1 });
      if (k && (k.grund === "email" || k.score >= IMPORT_SCHWELLE)) ids.set(p.zeile, { id: k.id, name: `${k.vorname} ${k.nachname}`, score: k.score });
      const schluessel = `${(p.system.email as string | undefined) ?? `${p.system.vorname} ${p.system.nachname}`}`.toLowerCase().trim();
      if (inDatei.has(schluessel)) p.befund.fehler.push({ feld: "nachname", meldung: `Doppelt in der Datei (Zeile ${inDatei.get(schluessel)})` });
      else inDatei.set(schluessel, p.zeile);
    }
    if (p.befund.fehler.length) p.befund.status = "fehler";
    else if (ids.has(p.zeile)) {
      p.befund.status = "dublette";
      p.befund.dublette = ids.get(p.zeile)!;
    }
  }
}

export interface ImportErgebnis {
  zusammenfassung: Record<string, number>;
  zeilen: Zeilenbefund[];
}

/**
 * Vorschau (`protokoll = null`) und Übernahme. Zeilenfehler und Dubletten je nach Politik gelten je Zeile; die übrigen Zeilen werden
 * in derselben Transaktion übernommen.
 */
export async function verarbeiteCrmImport(
  tx: Tx,
  protokoll: Protokollant | null,
  objekt: "organisation" | "person",
  csv: string,
  zuordnung: Zuordnung[],
  politik: DublettenPolitik,
  unternehmenAnlegen: boolean,
): Promise<ImportErgebnis> {
  const plaene = await baueFuer(tx, objekt, csv, zuordnung);
  await pruefeDubletten(tx, objekt, plaene);
  const t = objekt === "organisation" ? organisation : person;
  const eigeneDefs = await ladeFelder(tx, objekt, null);
  for (const p of plaene) {
    const b = p.befund;
    if (b.status === "fehler" || b.status === "leer") continue;
    if (b.status === "dublette" && politik === "ueberspringen") {
      b.status = "uebersprungen";
      continue;
    }
    if (!protokoll) continue;
    let orgId: string | null = null;
    if (objekt === "person" && p.unternehmenName) {
      const [vorhanden] = await tx.select({ id: organisation.id }).from(organisation).where(and(sql`lower(${organisation.name}) = lower(${p.unternehmenName})`, isNull(organisation.zusammengefuehrtIn), isNull(organisation.archiviertAm)));
      if (vorhanden) orgId = vorhanden.id;
      else if (unternehmenAnlegen) {
        const [neu] = await tx.insert(organisation).values({ name: p.unternehmenName, art: organisationArt.enumValues[0] }).returning();
        await protokoll("anlegen", "organisation", neu!.id, null, neu);
        orgId = neu!.id;
      } else {
        b.fehler.push({ feld: "unternehmen", meldung: `Unternehmen „${p.unternehmenName}“ gibt es nicht` });
        b.status = "fehler";
        continue;
      }
    }
    if (b.status === "dublette" && politik === "aktualisieren") {
      const [vorher] = await tx.select().from(t as typeof organisation).where(eq(t.id, b.dublette!.id)).for("update");
      const set: Record<string, unknown> = { ...p.system };
      if (Object.keys(p.eigene).length) set.felder = { ...(vorher!.felder as Record<string, unknown>), ...p.eigene };
      delete set.art;
      if (Object.keys(set).length) {
        const [nachher] = await tx.update(t as typeof organisation).set(set as never).where(eq(t.id, b.dublette!.id)).returning();
        await protokoll("aendern", objekt, b.dublette!.id, vorher, nachher);
      }
      if (orgId) {
        await tx.update(person).set({ organisationId: orgId }).where(eq(person.id, b.dublette!.id));
        await setzeHauptunternehmen(tx, b.dublette!.id, orgId);
      }
      b.status = "aktualisiert";
      continue;
    }
    const werte = { ...p.system, felder: p.eigene, ...(objekt === "person" && orgId ? { organisationId: orgId } : {}) };
    const [neu] = await tx.insert(t as typeof organisation).values(werte as never).returning();
    await protokoll("anlegen", objekt, neu!.id, null, neu);
    if (objekt === "person" && orgId) await setzeHauptunternehmen(tx, neu!.id, orgId, (neu as unknown as typeof person.$inferSelect).funktion);
    await synchronisiereVerknuepfungsfelder(tx, objekt, neu!.id, eigeneDefs, p.eigene);
    b.status = "angelegt";
  }
  const zaehle = (s: Zeilenbefund["status"]) => plaene.filter((p) => p.befund.status === s).length;
  return {
    zusammenfassung: { zeilen: plaene.length, neu: zaehle("neu"), dubletten: zaehle("dublette"), angelegt: zaehle("angelegt"), aktualisiert: zaehle("aktualisiert"), uebersprungen: zaehle("uebersprungen"), fehler: zaehle("fehler"), leer: zaehle("leer") },
    zeilen: plaene.map((p) => p.befund),
  };
}
