import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { benutzer, deal, liste, listeEintrag, organisation, person } from "@carraway/db";
import { Fachfehler } from "../fehler";
import type { Tx } from "../zeitlimit";
import { feldArray, ladeFelder, ohneNul, wertSchema, type FeldDef, type FeldTyp, type Objekt } from "./felder";
import { loeseFelder, OBJEKT_DEFS, type AufgeloestesFeld } from "./objekte";

/**
 * Der eine Abfragebauer für Tabellen, Kanban-Spalten, Exporte und Massenaktionen. Er nimmt eine beschreibende Konfiguration
 * (Filterbaum, Sortierung, Spalten, Seite) und erzeugt daraus SQL. Eingaben erreichen die Abfrage nur so:
 *  - Feldschlüssel werden gegen das Verzeichnis (Systemfelder + Definitionen) aufgelöst; unbekannte werden abgelehnt, nie in SQL eingesetzt.
 *  - Operatoren stammen aus einer festen Tabelle je Feldtyp.
 *  - Werte werden je Feldtyp geprüft und ausschließlich als gebundene Parameter übergeben.
 * Die Sichtbarkeit (`sichtbar`) wird außerhalb des Filterbaums mit UND verknüpft, ein ODER-Zweig kann sie nicht umgehen.
 */

export const OPERATOREN: Record<FeldTyp, readonly string[]> = {
  text: ["enthaelt", "enthaelt_nicht", "ist", "ist_nicht", "beginnt_mit", "leer", "nicht_leer"],
  langtext: ["enthaelt", "enthaelt_nicht", "leer", "nicht_leer"],
  url: ["enthaelt", "enthaelt_nicht", "ist", "ist_nicht", "leer", "nicht_leer"],
  email: ["enthaelt", "enthaelt_nicht", "ist", "ist_nicht", "beginnt_mit", "leer", "nicht_leer"],
  telefon: ["enthaelt", "enthaelt_nicht", "ist", "ist_nicht", "leer", "nicht_leer"],
  zahl: ["gleich", "ungleich", "groesser", "groesser_gleich", "kleiner", "kleiner_gleich", "zwischen", "leer", "nicht_leer"],
  betrag: ["gleich", "ungleich", "groesser", "groesser_gleich", "kleiner", "kleiner_gleich", "zwischen", "leer", "nicht_leer"],
  datum: ["gleich", "vor", "nach", "bis", "ab", "zwischen", "leer", "nicht_leer"],
  auswahl: ["ist", "ist_nicht", "ist_eines_von", "leer", "nicht_leer"],
  mehrfachauswahl: ["enthaelt_eines", "enthaelt_alle", "enthaelt_keines", "leer", "nicht_leer"],
  kontrollkaestchen: ["ist_wahr", "ist_falsch"],
  benutzer: ["ist", "ist_nicht", "ist_eines_von", "leer", "nicht_leer"],
  verknuepfung: ["ist", "ist_nicht", "ist_eines_von", "leer", "nicht_leer"],
};

const ALLE_OPERATOREN = [...new Set(Object.values(OPERATOREN).flat())] as [string, ...string[]];

const MAX_BEDINGUNGEN = 60;
const MAX_TIEFE = 4;

export const bedingungSchema = z.object({ feld: z.string().min(1).max(64), operator: z.enum(ALLE_OPERATOREN), wert: z.unknown().optional() });
export type Bedingung = z.infer<typeof bedingungSchema>;
/**
 * Gruppe von Bedingungen und weiteren Gruppen. Das Schema prüft nur die oberste Ebene (so lässt sich das Dokument als OpenAPI beschreiben);
 * Tiefe, Anzahl und jedes Element prüft der Abfragebauer beim Aufbau des SQL (`filterSql`).
 */
export const gruppeSchema = z.object({ verknuepfung: z.enum(["und", "oder"]), elemente: z.array(z.record(z.string(), z.unknown())).max(MAX_BEDINGUNGEN) });
export type Gruppe = z.infer<typeof gruppeSchema>;

export const sortierungSchema = z.object({ feld: z.string().min(1).max(64), richtung: z.enum(["auf", "ab"]).default("auf") });

/** Konfiguration einer Ansicht (so wird sie gespeichert) und einer Abfrage. */
export const ansichtKonfigSchema = z.object({
  filter: gruppeSchema.optional(),
  sortierung: z.array(sortierungSchema).max(3).default([]),
  spalten: z.array(z.object({ feld: z.string().min(1).max(64), breite: z.number().int().min(60).max(800).optional() })).max(40).default([]),
  gruppierung: z.string().min(1).max(64).nullable().optional(),
});
export type AnsichtKonfig = z.infer<typeof ansichtKonfigSchema>;

export const abfrageSchema = ansichtKonfigSchema.extend({
  suche: z.string().trim().min(1).max(200).refine(ohneNul).optional(),
  listeId: z.uuid().optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).max(1_000_000).default(0),
});
export type AbfrageEingabe = z.input<typeof abfrageSchema>;

function ungueltig(feld: string, meldung: string, code = "invalid_query"): Fachfehler {
  return new Fachfehler(400, "query_invalid", "The query is invalid.", { felder: [{ feld, code, meldung }] });
}

const maskiere = (text: string) => text.replace(/[\\%_]/g, (z) => `\\${z}`);

/** Prüft den Wert einer Bedingung und gibt die gebundenen Werte zurück. */
function wertFuer(feld: AufgeloestesFeld, operator: string, roh: unknown, pfad: string): unknown[] {
  if (["leer", "nicht_leer", "ist_wahr", "ist_falsch"].includes(operator)) return [];
  const typ = feld.typ;
  const textartig = ["text", "langtext", "url", "email", "telefon"].includes(typ);
  const einzel = (w: unknown): unknown => {
    if (textartig) {
      if (operator === "ist" || operator === "ist_nicht") {
        const e = z.string().min(1).max(500).refine(ohneNul).safeParse(w);
        if (!e.success) throw ungueltig(pfad, "Expected a text value");
        return e.data;
      }
      const e = z.string().min(1).max(200).refine(ohneNul).safeParse(w);
      if (!e.success) throw ungueltig(pfad, "Expected a text value");
      return e.data;
    }
    const schema = wertSchema({ typ, optionen: feld.optionen });
    const e = schema.safeParse(w);
    if (!e.success) throw ungueltig(pfad, e.error.issues[0]?.message ?? "Invalid value");
    return e.data;
  };
  if (operator === "zwischen") {
    if (!Array.isArray(roh) || roh.length !== 2) throw ungueltig(pfad, "Expected two values");
    return [einzel(roh[0]), einzel(roh[1])];
  }
  if (["ist_eines_von", "enthaelt_eines", "enthaelt_alle", "enthaelt_keines"].includes(operator)) {
    if (!Array.isArray(roh) || roh.length === 0 || roh.length > 100) throw ungueltig(pfad, "Expected a list of 1 to 100 values");
    const element = typ === "mehrfachauswahl" ? wertSchema({ typ: "auswahl", optionen: feld.optionen }) : wertSchema({ typ, optionen: feld.optionen });
    return [roh.map((w) => {
      const e = element.safeParse(w);
      if (!e.success) throw ungueltig(pfad, e.error.issues[0]?.message ?? "Invalid value");
      return e.data as string;
    })];
  }
  return [einzel(roh)];
}

function bedingungSql(feld: AufgeloestesFeld, b: Bedingung, pfad: string): SQL {
  if (!OPERATOREN[feld.typ].includes(b.operator)) throw ungueltig(pfad, `Operator ${b.operator} does not apply to fields of type ${feld.typ}`, "invalid_operator");
  const [w1, w2] = wertFuer(feld, b.operator, b.wert, `${pfad}.wert`);
  const a = feld.ausdruck;
  const textartig = ["text", "langtext", "url", "email", "telefon"].includes(feld.typ);
  switch (b.operator) {
    case "leer":
      return feld.typ === "mehrfachauswahl" ? sql`(${a} IS NULL OR ${a} = '[]'::jsonb)` : textartig ? sql`(${a} IS NULL OR ${a} = '')` : sql`${a} IS NULL`;
    case "nicht_leer":
      return feld.typ === "mehrfachauswahl" ? sql`(${a} IS NOT NULL AND ${a} <> '[]'::jsonb)` : textartig ? sql`(${a} IS NOT NULL AND ${a} <> '')` : sql`${a} IS NOT NULL`;
    case "enthaelt":
      return sql`lower(${a}) LIKE ${`%${maskiere(String(w1).toLowerCase())}%`}`;
    case "enthaelt_nicht":
      return sql`(${a} IS NULL OR lower(${a}) NOT LIKE ${`%${maskiere(String(w1).toLowerCase())}%`})`;
    case "beginnt_mit":
      return sql`lower(${a}) LIKE ${`${maskiere(String(w1).toLowerCase())}%`}`;
    case "ist":
      return textartig ? sql`lower(${a}) = ${String(w1).toLowerCase()}` : sql`${a} = ${w1}`;
    case "ist_nicht":
      return textartig ? sql`(${a} IS NULL OR lower(${a}) <> ${String(w1).toLowerCase()})` : sql`(${a} IS NULL OR ${a} <> ${w1})`;
    case "ist_eines_von":
      return sql`${a} = ANY(${feldArray(w1 as string[], "text")})`;
    case "gleich":
      return sql`${a} = ${w1}`;
    case "ungleich":
      return sql`(${a} IS NULL OR ${a} <> ${w1})`;
    case "groesser":
    case "nach":
      return sql`${a} > ${w1}`;
    case "groesser_gleich":
    case "ab":
      return sql`${a} >= ${w1}`;
    case "kleiner":
    case "vor":
      return sql`${a} < ${w1}`;
    case "kleiner_gleich":
    case "bis":
      return sql`${a} <= ${w1}`;
    case "zwischen":
      return sql`${a} BETWEEN ${w1} AND ${w2}`;
    case "enthaelt_eines":
      return sql`jsonb_exists_any(${a}, ${feldArray(w1 as string[], "text")})`;
    case "enthaelt_alle":
      return sql`jsonb_exists_all(${a}, ${feldArray(w1 as string[], "text")})`;
    case "enthaelt_keines":
      return sql`(${a} IS NULL OR NOT jsonb_exists_any(${a}, ${feldArray(w1 as string[], "text")}))`;
    case "ist_wahr":
      return sql`${a} IS TRUE`;
    case "ist_falsch":
      return sql`${a} IS NOT TRUE`;
  }
  throw ungueltig(pfad, "Unknown operator", "invalid_operator");
}

function filterSql(felder: Map<string, AufgeloestesFeld>, gruppe: Gruppe, tiefe: number, zaehler: { n: number }, pfad: string): SQL | undefined {
  if (tiefe > MAX_TIEFE) throw ungueltig(pfad, "Filter nested too deeply");
  const teile: SQL[] = [];
  gruppe.elemente.forEach((roh, i) => {
    const p = `${pfad}.elemente.${i}`;
    if ("elemente" in roh) {
      const g = gruppeSchema.safeParse(roh);
      if (!g.success) throw ungueltig(p, "Invalid group");
      const t = filterSql(felder, g.data, tiefe + 1, zaehler, p);
      if (t) teile.push(t);
      return;
    }
    const e = bedingungSchema.safeParse(roh);
    if (!e.success) throw ungueltig(p, "Invalid condition (field, operator and value expected)");
    if (++zaehler.n > MAX_BEDINGUNGEN) throw ungueltig(pfad, "Too many conditions");
    const feld = felder.get(e.data.feld);
    if (!feld) throw ungueltig(`${p}.feld`, "Unknown field", "unknown_field");
    teile.push(bedingungSql(feld, e.data, p));
  });
  if (teile.length === 0) return undefined;
  return sql`(${sql.join(teile, gruppe.verknuepfung === "und" ? sql` AND ` : sql` OR `)})`;
}

export interface Kontext {
  /** Sichtbarkeit des Aufrufers (Deals nach Fonds); wird mit UND angehängt. */
  sichtbar?: SQL | undefined;
  /** Sichtbarkeit von Deals unabhängig vom abgefragten Objekt (Namen in Verknüpfungszellen). */
  dealSichtbar?: SQL | undefined;
  /** Nur diese Datensätze (Detailansicht, Massenaktionen auf gewählte Zeilen). */
  ids?: string[];
}

export interface AbfrageErgebnis {
  daten: Record<string, unknown>[];
  gesamt: number;
  limit: number;
  offset: number;
  /** Anzeigenamen der Datensätze und Personen, auf die Zellen verweisen (`typ:id` → Name). */
  bezuege: Record<string, string | null>;
}

interface Plan {
  def: (typeof OBJEKT_DEFS)[Objekt];
  felder: Map<string, AufgeloestesFeld>;
  eigene: FeldDef[];
  von: SQL;
  wo: SQL;
}

async function plane(tx: Tx, objekt: Objekt, eingabe: Pick<z.infer<typeof abfrageSchema>, "filter" | "suche" | "listeId">, kontext: Kontext): Promise<Plan> {
  const def = OBJEKT_DEFS[objekt];
  let eigene = await ladeFelder(tx, objekt, null);
  let von = sql`${def.tabelle}`;
  if (eingabe.listeId) {
    const [l] = await tx.select({ objekt: liste.objekt, archiviertAm: liste.archiviertAm }).from(liste).where(sql`${liste.id} = ${eingabe.listeId}`);
    if (!l || l.archiviertAm) throw new Fachfehler(404, "list_not_found", "List not found.");
    if (l.objekt !== objekt) throw ungueltig("listeId", "The list belongs to a different object");
    eigene = [...eigene, ...(await ladeFelder(tx, objekt, eingabe.listeId))];
    von = sql`${def.tabelle} JOIN ${listeEintrag} ON ${listeEintrag.datensatzId} = ${def.tabelle.id} AND ${listeEintrag.listeId} = ${eingabe.listeId}::uuid`;
  }
  const felder = loeseFelder(objekt, eigene, Boolean(eingabe.listeId));
  const teile: SQL[] = [...def.basis];
  if (kontext.sichtbar) teile.push(sql`(${kontext.sichtbar})`);
  if (kontext.ids) teile.push(sql`${def.tabelle.id} = ANY(${feldArray(kontext.ids, "uuid")})`);
  if (eingabe.suche) {
    const muster = `%${maskiere(eingabe.suche.toLowerCase())}%`;
    const suchfelder = def.felder.filter((f) => f.suche).map((f) => sql`lower(coalesce(${f.ausdruck}, '')) LIKE ${muster}`);
    teile.push(sql`(${sql.join(suchfelder, sql` OR `)})`);
  }
  if (eingabe.filter) {
    const f = filterSql(felder, eingabe.filter, 1, { n: 0 }, "filter");
    if (f) teile.push(f);
  }
  return { def, felder, eigene, von, wo: teile.length ? sql`WHERE ${sql.join(teile, sql` AND `)}` : sql`` };
}

type Sortierung = { schluessel: string; richtung: "auf" | "ab" }[];

function sortierSql(plan: Plan, sortierung: Sortierung): SQL {
  const vorgabe = sortierung.length ? sortierung : plan.def.standardSortierung;
  const teile = vorgabe.map((s, i) => {
    const feld = plan.felder.get(s.schluessel);
    if (!feld) throw ungueltig(`sortierung.${i}.feld`, "Unknown field", "unknown_field");
    if (["mehrfachauswahl", "verknuepfung", "benutzer"].includes(feld.typ) && !feld.sortAusdruck) throw ungueltig(`sortierung.${i}.feld`, `Fields of type ${feld.typ} cannot be sorted`, "not_sortable");
    const a = feld.sortAusdruck ?? (["text", "langtext", "url", "email", "telefon"].includes(feld.typ) ? sql`lower(${feld.ausdruck})` : feld.ausdruck);
    return s.richtung === "ab" ? sql`${a} DESC NULLS LAST` : sql`${a} ASC NULLS LAST`;
  });
  return sql`ORDER BY ${sql.join([...teile, sql`${plan.def.tabelle.id} ASC`], sql`, `)}`;
}

const normSortierung = (s: AnsichtKonfig["sortierung"]): Sortierung => s.map((x) => ({ schluessel: x.feld, richtung: x.richtung }));

/** Liest Zeilen: `id` plus die Spalten der Konfiguration (ohne Angabe die Systemfelder). */
export async function fuehreAbfrageAus(tx: Tx, objekt: Objekt, roh: AbfrageEingabe, kontext: Kontext): Promise<AbfrageErgebnis> {
  const eingabe = abfrageSchema.parse(roh);
  const plan = await plane(tx, objekt, eingabe, kontext);
  const spaltenSchluessel = eingabe.spalten.length ? eingabe.spalten.map((s) => s.feld) : plan.def.felder.map((f) => f.schluessel);
  const spalten = [...new Set(spaltenSchluessel)].map((k, i) => {
    const f = plan.felder.get(k);
    if (!f) throw ungueltig(`spalten.${i}.feld`, "Unknown field", "unknown_field");
    return f;
  });
  const auswahl = spalten.map((f, i) => sql`${f.ausgabe} AS ${sql.identifier(`c${i}`)}`);
  const ordnung = sortierSql(plan, normSortierung(eingabe.sortierung));
  const [zeilen, zaehlung] = await Promise.all([
    tx.execute<Record<string, unknown>>(sql`SELECT ${plan.def.tabelle.id} AS id${auswahl.length ? sql`, ${sql.join(auswahl, sql`, `)}` : sql``} FROM ${plan.von} ${plan.wo} ${ordnung} LIMIT ${eingabe.limit} OFFSET ${eingabe.offset}`),
    tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM ${plan.von} ${plan.wo}`),
  ]);
  const daten = zeilen.rows.map((z) => {
    const aus: Record<string, unknown> = { id: z.id };
    spalten.forEach((f, i) => {
      aus[f.schluessel] = z[`c${i}`] ?? null;
    });
    return aus;
  });
  const bezuege = await ladeBezuege(tx, spalten, daten, kontext);
  return { daten, gesamt: zaehlung.rows[0]?.n ?? 0, limit: eingabe.limit, offset: eingabe.offset, bezuege };
}

/** Namen der Datensätze und Personen, auf die Zellen mit Verknüpfungs- oder Personenfeldern zeigen. */
async function ladeBezuege(tx: Tx, spalten: AufgeloestesFeld[], daten: Record<string, unknown>[], kontext: Kontext): Promise<Record<string, string | null>> {
  const ids: Record<"organisation" | "person" | "deal" | "benutzer", Set<string>> = { organisation: new Set(), person: new Set(), deal: new Set(), benutzer: new Set() };
  for (const f of spalten) {
    const ziel = f.typ === "benutzer" ? "benutzer" : f.typ === "verknuepfung" ? f.ziel : undefined;
    if (!ziel) continue;
    for (const z of daten) {
      const w = z[f.schluessel];
      if (typeof w === "string") ids[ziel].add(w);
    }
  }
  const aus: Record<string, string | null> = {};
  const lade = async (typ: keyof typeof ids, abfrage: (liste: string[]) => Promise<{ id: string; name: string }[]>) => {
    if (ids[typ].size === 0) return;
    const gefunden = await abfrage([...ids[typ]]);
    const da = new Map(gefunden.map((g) => [g.id, g.name]));
    for (const id of ids[typ]) aus[`${typ}:${id}`] = da.get(id) ?? null;
  };
  const felder = (l: string[]) => sql`ANY(${feldArray(l, "uuid")})`;
  await lade("organisation", async (l) => (await tx.execute<{ id: string; name: string }>(sql`SELECT id, name FROM ${organisation} WHERE id = ${felder(l)}`)).rows);
  await lade("person", async (l) => (await tx.execute<{ id: string; name: string }>(sql`SELECT id, vorname || ' ' || nachname AS name FROM ${person} WHERE id = ${felder(l)}`)).rows);
  await lade("deal", async (l) => (await tx.execute<{ id: string; name: string }>(sql`SELECT id, titel AS name FROM ${deal} WHERE id = ${felder(l)} ${kontext.dealSichtbar ? sql`AND (${kontext.dealSichtbar})` : sql``}`)).rows);
  await lade("benutzer", async (l) => (await tx.execute<{ id: string; name: string }>(sql`SELECT id, name FROM ${benutzer} WHERE id = ${felder(l)}`)).rows);
  return aus;
}

/** Spalten einer Abfrage ohne Seitenbegrenzung für den Export (höchstens `MAX_EXPORT` Zeilen). */
export const MAX_EXPORT = 50_000;

export async function ladeAlleZeilen(tx: Tx, objekt: Objekt, roh: AbfrageEingabe, kontext: Kontext): Promise<{ felder: AufgeloestesFeld[]; zeilen: Record<string, unknown>[]; bezuege: Record<string, string | null> }> {
  const eingabe = abfrageSchema.parse({ ...roh, limit: 200, offset: 0 });
  const plan = await plane(tx, objekt, eingabe, kontext);
  const schluessel = eingabe.spalten.length ? eingabe.spalten.map((s) => s.feld) : plan.def.felder.map((f) => f.schluessel);
  const spalten = [...new Set(schluessel)].map((k, i) => {
    const f = plan.felder.get(k);
    if (!f) throw ungueltig(`spalten.${i}.feld`, "Unknown field", "unknown_field");
    return f;
  });
  const auswahl = spalten.map((f, i) => sql`${f.ausgabe} AS ${sql.identifier(`c${i}`)}`);
  const ordnung = sortierSql(plan, normSortierung(eingabe.sortierung));
  const rows = await tx.execute<Record<string, unknown>>(sql`SELECT ${plan.def.tabelle.id} AS id, ${sql.join(auswahl, sql`, `)} FROM ${plan.von} ${plan.wo} ${ordnung} LIMIT ${MAX_EXPORT}`);
  const zeilen = rows.rows.map((z) => {
    const aus: Record<string, unknown> = { id: z.id };
    spalten.forEach((f, i) => (aus[f.schluessel] = z[`c${i}`] ?? null));
    return aus;
  });
  return { felder: spalten, zeilen, bezuege: await ladeBezuege(tx, spalten, zeilen, kontext) };
}

/** IDs aller Datensätze, die eine Konfiguration trifft (Massenaktionen auf „alle Treffer“), höchstens `MAX_EXPORT`. */
export async function ladeTrefferIds(tx: Tx, objekt: Objekt, roh: AbfrageEingabe, kontext: Kontext): Promise<string[]> {
  const eingabe = abfrageSchema.parse(roh);
  const plan = await plane(tx, objekt, eingabe, kontext);
  const rows = await tx.execute<{ id: string }>(sql`SELECT ${plan.def.tabelle.id} AS id FROM ${plan.von} ${plan.wo} LIMIT ${MAX_EXPORT}`);
  return rows.rows.map((r) => r.id);
}

/** Kanban: je Spalte (Option des Gruppierungsfeldes) Anzahl, Summe eines Betragsfeldes und die ersten Karten. */
export async function fuehreBoardAus(tx: Tx, objekt: Objekt, roh: AbfrageEingabe, gruppeFeld: string, summenFeld: string | null, kartenProSpalte: number, kontext: Kontext) {
  const eingabe = abfrageSchema.parse(roh);
  const plan = await plane(tx, objekt, eingabe, kontext);
  const gruppe = plan.felder.get(gruppeFeld);
  if (!gruppe || gruppe.typ !== "auswahl") throw ungueltig("gruppierung", "Grouping requires a field of type select", "not_groupable");
  const summe = summenFeld ? plan.felder.get(summenFeld) : undefined;
  if (summenFeld && (!summe || (summe.typ !== "betrag" && summe.typ !== "zahl"))) throw ungueltig("summe", "Sum requires an amount or number field", "not_summable");
  const optionen = ((gruppe.optionen.optionen as { schluessel: string }[] | undefined) ?? []).map((o) => o.schluessel);
  const summenSql = summe ? sql`coalesce(sum(${summe.ausdruck}), 0)::text` : sql`'0'`;
  const zaehlung = await tx.execute<{ g: string | null; n: number; s: string }>(
    sql`SELECT ${gruppe.ausdruck} AS g, count(*)::int AS n, ${summenSql} AS s FROM ${plan.von} ${plan.wo} GROUP BY 1`,
  );
  const spaltenSchluessel = eingabe.spalten.length ? eingabe.spalten.map((s) => s.feld) : plan.def.felder.slice(0, 6).map((f) => f.schluessel);
  const ergebnis = [];
  const alleBezuege: Record<string, string | null> = {};
  const gruppen: (string | null)[] = [...optionen, null];
  for (const g of gruppen) {
    const z = zaehlung.rows.find((r) => (r.g ?? null) === g);
    if (g === null && !z) continue;
    const bedingung = g === null ? sql`${gruppe.ausdruck} IS NULL` : sql`${gruppe.ausdruck} = ${g}`;
    const wo = plan.wo.queryChunks.length ? sql`${plan.wo} AND ${bedingung}` : sql`WHERE ${bedingung}`;
    const seite = z && z.n > 0 ? await fuehreSeite(tx, plan, spaltenSchluessel, wo, eingabe.sortierung, kartenProSpalte, kontext) : { daten: [], bezuege: {} };
    Object.assign(alleBezuege, seite.bezuege);
    ergebnis.push({ wert: g, anzahl: z?.n ?? 0, summe: z?.s ?? "0", karten: seite.daten });
  }
  return { spalten: ergebnis, bezuege: alleBezuege };
}

async function fuehreSeite(tx: Tx, plan: Plan, schluessel: string[], wo: SQL, sortierung: AnsichtKonfig["sortierung"], limit: number, kontext: Kontext) {
  const spalten = [...new Set(schluessel)].map((k, i) => {
    const f = plan.felder.get(k);
    if (!f) throw ungueltig(`spalten.${i}.feld`, "Unknown field", "unknown_field");
    return f;
  });
  const auswahl = spalten.map((f, i) => sql`${f.ausgabe} AS ${sql.identifier(`c${i}`)}`);
  const ordnung = sortierSql(plan, normSortierung(sortierung));
  const rows = await tx.execute<Record<string, unknown>>(sql`SELECT ${plan.def.tabelle.id} AS id, ${sql.join(auswahl, sql`, `)} FROM ${plan.von} ${wo} ${ordnung} LIMIT ${limit}`);
  const daten = rows.rows.map((z) => {
    const aus: Record<string, unknown> = { id: z.id };
    spalten.forEach((f, i) => (aus[f.schluessel] = z[`c${i}`] ?? null));
    return aus;
  });
  return { daten, bezuege: await ladeBezuege(tx, spalten, daten, kontext) };
}

/** Feldtypen, nach denen sich gruppieren lässt (Auswahl und Phase, Mehrfachauswahl, Person im Haus, Verknüpfung, Kontrollkästchen). */
export const GRUPPIERBAR = ["auswahl", "mehrfachauswahl", "benutzer", "verknuepfung", "kontrollkaestchen"] as const;
const MAX_SUMMEN = 6;
export const MAX_GRUPPEN = 500;

export const gruppenSchema = z.object({
  gruppe: z.string().min(1).max(64),
  /** Beträge und Zahlen, die je Gruppe summiert werden (höchstens 6). */
  summen: z.array(z.string().min(1).max(64)).max(MAX_SUMMEN).default([]),
});

export interface Gruppenzeile {
  /** Optionsschlüssel, Benutzer-ID bzw. Datensatz-ID (Verknüpfung), bei Kontrollkästchen `"true"` oder `"false"` (ohne Haken zählt als `"false"`); `null` = ohne Wert. */
  wert: string | null;
  anzahl: number;
  /** Summen je angefragtem Feld als Dezimalzeichenkette (nie Gleitkomma). */
  summen: Record<string, string>;
}

/**
 * Gruppiert die Treffer einer Abfrage nach einem Feld und zählt je Gruppe, mit Summen für Betrags- und Zahlenfelder. Die Treffermenge ist dieselbe wie bei der
 * Abfrage (Filter, Suche, Liste, Sichtbarkeit), das Gruppenfeld und die Summenfelder werden nur über das Feldverzeichnis aufgelöst. Bei einer Mehrfachauswahl zählt
 * eine Zeile in jeder ihrer Gruppen (Anzahl und Summen sind dann keine Teilmengen der Gesamtzahl). Die Zeilen einer Gruppe holt die Oberfläche mit der Abfrage und
 * einer zusätzlichen Bedingung auf das Gruppenfeld.
 */
export async function fuehreGruppierungAus(tx: Tx, objekt: Objekt, roh: AbfrageEingabe, gruppeFeld: string, summenFelder: string[], kontext: Kontext) {
  const eingabe = abfrageSchema.parse(roh);
  const plan = await plane(tx, objekt, eingabe, kontext);
  const gruppe = plan.felder.get(gruppeFeld);
  if (!gruppe || !(GRUPPIERBAR as readonly string[]).includes(gruppe.typ)) throw ungueltig("gruppe", "Grouping requires a field of type select, multi-select, internal person, link or checkbox", "not_groupable");
  const summen = [...new Set(summenFelder)].map((k, i) => {
    const f = plan.felder.get(k);
    if (!f) throw ungueltig(`summen.${i}`, "Unknown field", "unknown_field");
    if (f.typ !== "betrag" && f.typ !== "zahl") throw ungueltig(`summen.${i}`, "Sum requires an amount or number field", "not_summable");
    return f;
  });
  const summenSql = summen.map((f, i) => sql`coalesce(sum(${f.ausdruck}), 0)::text AS ${sql.identifier(`s${i}`)}`);
  const auswahl = sql`count(*)::int AS n${summenSql.length ? sql`, ${sql.join(summenSql, sql`, `)}` : sql``}`;
  type Reihe = { g: string | null; n: number } & Record<string, unknown>;
  let reihen: Reihe[];
  if (gruppe.typ === "mehrfachauswahl") {
    const liste = sql`(CASE WHEN jsonb_typeof(${gruppe.ausdruck}) = 'array' THEN ${gruppe.ausdruck} ELSE '[]'::jsonb END)`;
    const mitWert = await tx.execute<Reihe>(sql`SELECT e.v AS g, ${auswahl} FROM ${plan.von} CROSS JOIN LATERAL jsonb_array_elements_text(${liste}) AS e(v) ${plan.wo} GROUP BY 1 ORDER BY n DESC, g LIMIT ${MAX_GRUPPEN + 1}`);
    const leerBedingung = sql`(${gruppe.ausdruck} IS NULL OR jsonb_typeof(${gruppe.ausdruck}) <> 'array' OR ${gruppe.ausdruck} = '[]'::jsonb)`;
    const wo = plan.wo.queryChunks.length ? sql`${plan.wo} AND ${leerBedingung}` : sql`WHERE ${leerBedingung}`;
    const ohne = await tx.execute<Reihe>(sql`SELECT NULL::text AS g, ${auswahl} FROM ${plan.von} ${wo}`);
    reihen = [...mitWert.rows, ...ohne.rows.filter((r) => r.n > 0)];
  } else if (gruppe.typ === "kontrollkaestchen") {
    // Ohne Haken zählt als „falsch“, wie der Operator `ist_falsch` es auch trifft.
    const rows = await tx.execute<Reihe>(sql`SELECT (coalesce(${gruppe.ausdruck}, false))::text AS g, ${auswahl} FROM ${plan.von} ${plan.wo} GROUP BY 1`);
    reihen = rows.rows;
  } else {
    // Ohne Wert zuerst, dann die größten Gruppen, bei Gleichstand nach Wert: Wird gekürzt, fehlen nur die kleinsten Gruppen, und „ohne Wert“ bleibt.
    const rows = await tx.execute<Reihe>(sql`SELECT * FROM (SELECT ${gruppe.ausdruck} AS g, ${auswahl} FROM ${plan.von} ${plan.wo} GROUP BY 1) AS t ORDER BY (g IS NULL) DESC, n DESC, g LIMIT ${MAX_GRUPPEN + 1}`);
    reihen = rows.rows;
  }
  const abgeschnitten = reihen.length > MAX_GRUPPEN;
  if (abgeschnitten) reihen = reihen.slice(0, MAX_GRUPPEN);
  const zeilen: Gruppenzeile[] = reihen.map((r) => ({ wert: r.g ?? null, anzahl: r.n, summen: Object.fromEntries(summen.map((f, i) => [f.schluessel, String(r[`s${i}`] ?? "0")])) }));
  // Reihenfolge: Optionen in der Reihenfolge der Definition (bei Phasen die der Pipeline), dann unbekannte Werte, zuletzt „ohne Wert“; Personen nach Name.
  const bezuege: Record<string, string | null> = {};
  if (gruppe.typ === "benutzer") {
    const kennungen = zeilen.flatMap((z) => (z.wert ? [z.wert] : []));
    if (kennungen.length) {
      const namen = await tx.execute<{ id: string; name: string }>(sql`SELECT id, name FROM ${benutzer} WHERE id = ANY(${feldArray(kennungen, "uuid")})`);
      for (const n of namen.rows) bezuege[`benutzer:${n.id}`] = n.name;
    }
    zeilen.sort((a, b) => (a.wert === null ? 1 : b.wert === null ? -1 : (bezuege[`benutzer:${a.wert}`] ?? "").localeCompare(bezuege[`benutzer:${b.wert}`] ?? "", "de") || a.wert.localeCompare(b.wert)));
  } else if (gruppe.typ === "verknuepfung") {
    // Namen der Ziele; Deals fremder Fonds bleiben ohne Namen (die Oberfläche zeigt „kein Zugriff“).
    const ziel = gruppe.ziel;
    const kennungen = zeilen.flatMap((z) => (z.wert ? [{ [gruppe.schluessel]: z.wert }] : []));
    if (ziel && kennungen.length) Object.assign(bezuege, await ladeBezuege(tx, [gruppe], kennungen, kontext));
    const name = (w: string | null) => (w === null ? null : (bezuege[`${ziel}:${w}`] ?? null));
    zeilen.sort((a, b) => (a.wert === null ? 1 : b.wert === null ? -1 : (name(a.wert) === null ? 1 : 0) - (name(b.wert) === null ? 1 : 0) || (name(a.wert) ?? "").localeCompare(name(b.wert) ?? "", "de") || a.wert.localeCompare(b.wert)));
  } else if (gruppe.typ === "kontrollkaestchen") {
    zeilen.sort((a, b) => (a.wert === "true" ? -1 : 0) - (b.wert === "true" ? -1 : 0));
  } else {
    const reihenfolge = ((gruppe.optionen.optionen as { schluessel: string }[] | undefined) ?? []).map((o) => o.schluessel);
    const rang = (w: string | null) => (w === null ? Number.MAX_SAFE_INTEGER : reihenfolge.includes(w) ? reihenfolge.indexOf(w) : reihenfolge.length);
    zeilen.sort((a, b) => rang(a.wert) - rang(b.wert) || (a.wert ?? "").localeCompare(b.wert ?? ""));
  }
  const gesamt = (await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM ${plan.von} ${plan.wo}`)).rows[0]?.n ?? 0;
  return { gruppen: zeilen, gesamt, bezuege, abgeschnitten };
}

/** Felder eines Objekts für die Oberfläche: Systemfelder und Definitionen (optional einer Liste). */
export async function beschreibeFelder(tx: Tx, objekt: Objekt, listeId: string | null, mitArchiviert = false) {
  const eigene = [...(await ladeFelder(tx, objekt, null, mitArchiviert)), ...(listeId ? await ladeFelder(tx, objekt, listeId, mitArchiviert) : [])];
  const karte = loeseFelder(objekt, eigene, Boolean(listeId));
  return [...karte.values()].map((f) => ({
    schluessel: f.schluessel,
    name: f.name,
    typ: f.typ,
    system: f.system,
    schreibbar: f.schreibbar,
    optionen: f.optionen,
    operatoren: OPERATOREN[f.typ],
    sortierbar: !(["mehrfachauswahl", "verknuepfung", "benutzer"].includes(f.typ) && !f.sortAusdruck),
    ...(f.ziel ? { ziel: f.ziel } : {}),
    ...(f.definition ? { definitionId: f.definition.id, version: f.definition.version, listeId: f.definition.listeId, archiviertAm: f.definition.archiviertAm, position: f.definition.position } : {}),
  }));
}
