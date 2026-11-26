import { englischerEnumWert } from "../kontakte/api-namen";
import { and, asc, eq, isNull, sql, type SQL } from "drizzle-orm";
import type { Context } from "hono";
import { z } from "zod";
import { benutzer, deal, feldDefinition, instrument, organisation, person } from "@carraway/db";
import { dealSichtbar } from "../rechte/sichtbarkeit";
import { Fachfehler, type Fehlercode } from "../fehler";
import type { Protokollant } from "../schreiben";
import type { Tx } from "../zeitlimit";
import { feldArray, pruefeFelder, wertSchema, type FeldDef, type FeldObjekt } from "../crm/felder";
import { FELD_ZIELE, type PortfolioObjekt } from "./ziele";

/**
 * Werte eigener Felder an den Objekten des Portfolios (Etappe 21): lesen (auch zu einem früheren Wissensstand), prüfen gegen die versionierten
 * Definitionen und schreiben mit vollständigem Vorher und Nachher im Änderungsprotokoll. Die Prüfung der einzelnen Werte ist die Engine der
 * CRM-Felder (`crm/felder.ts`): dieselben Typen, dieselben Regeln, dieselben Fehlercodes.
 */

export type Werte = Record<string, unknown>;

export interface FeldMitWert {
  id: string;
  schluessel: string;
  name: string;
  typ: FeldDef["typ"];
  optionen: Record<string, unknown>;
  position: number;
  version: number;
  archiviert: boolean;
  wert: unknown;
}

const NICHT_GEFUNDEN: Record<PortfolioObjekt, [Fehlercode, string]> = {
  fonds: ["fund_not_found", "Fund not found."],
  runde: ["round_not_found", "Financing round not found."],
  instrument: ["investment_not_found", "Investment not found."],
  beteiligung: ["investment_not_found", "Investment not found."],
  vorgang: ["transaction_not_found", "Transaction not found."],
};

/** Namen von Tabelle und Spalte sind Konstanten aus dem Verzeichnis der Feldziele, nie Eingaben. */
const bezeichner = (objekt: FeldObjekt) => {
  const z = FELD_ZIELE[objekt];
  return { tabelle: sql.raw(`"${z.tabelle}"`), spalte: sql.raw(`"${z.spalte}"`) };
};

/** Aktuelle Werte der Zeile, optional mit Sperre; wirft 404, wenn es die Zeile nicht gibt. */
async function leseAktuell(tx: Tx, objekt: PortfolioObjekt, id: string, sperren = false): Promise<{ werte: Werte; erfasstAm: Date | null }> {
  const { tabelle, spalte } = bezeichner(objekt);
  const erfasst = objekt === "vorgang" ? sql`erfasst_am` : sql`NULL::timestamptz`;
  const { rows } = await tx.execute<{ w: Werte; e: Date | null }>(sql`SELECT ${spalte} AS w, ${erfasst} AS e FROM ${tabelle} WHERE id = ${id}${sperren ? sql` FOR UPDATE` : sql``}`);
  const zeile = rows[0];
  if (!zeile) throw new Fachfehler(404, ...NICHT_GEFUNDEN[objekt]);
  return { werte: zeile.w ?? {}, erfasstAm: zeile.e ? new Date(zeile.e) : null };
}

/**
 * Werte zu einem Wissensstand. Veränderbare Objekte: der Nachher-Stand der letzten Änderung bis `stand` aus dem Änderungsprotokoll; gab es bis dahin
 * keine, der Vorher-Stand der ersten späteren Änderung (also der ursprüngliche Zustand); gab es nie eine Änderung über die API, gelten die aktuellen
 * Werte (Altbestand und Beispieldaten ohne Protokoll). Vorgänge sind unveränderlich: Sie gelten ab ihrer Erfassung.
 */
export async function ladeWerte(tx: Tx, objekt: PortfolioObjekt, id: string, stand?: string): Promise<Werte> {
  const aktuell = await leseAktuell(tx, objekt, id);
  if (stand === undefined) return aktuell.werte;
  if (objekt === "vorgang") {
    if (aktuell.erfasstAm && aktuell.erfasstAm.getTime() > new Date(stand).getTime()) throw new Fachfehler(404, ...NICHT_GEFUNDEN.vorgang);
    return aktuell.werte;
  }
  const ziel = FELD_ZIELE[objekt];
  const { rows } = await tx.execute<{ vorher: { felder?: Werte } | null; nachher: { felder?: Werte } | null; am: Date }>(sql`
    SELECT vorher, nachher, am FROM aenderung
    WHERE tabelle = ${ziel.protokollTabelle} AND datensatz_id = ${id} AND aktion = 'felder_setzen' AND nachher ->> 'objekt' = ${objekt}
    ORDER BY am, id`);
  if (rows.length === 0) return aktuell.werte;
  const grenze = new Date(stand).getTime();
  const bis = rows.filter((r) => new Date(r.am).getTime() <= grenze);
  if (bis.length > 0) return bis[bis.length - 1]!.nachher?.felder ?? {};
  return rows[0]!.vorher?.felder ?? {};
}

/**
 * Werte eines einzelnen Instruments (`instrument.felder`), auch zu einem früheren Wissensstand (aus dem Änderungsprotokoll der Tabelle `instrument`;
 * ohne Eintrag gelten die aktuellen Werte). Das Hauptinstrument liest die Route weiter über den Spiegel der Beteiligung (`ladeWerte`).
 */
export async function ladeInstrumentWerte(tx: Tx, instrumentId: string, stand?: string): Promise<Werte> {
  const { rows } = await tx.execute<{ w: Werte | null }>(sql`SELECT felder AS w FROM instrument WHERE id = ${instrumentId}`);
  if (!rows[0]) throw new Fachfehler(404, "instrument_not_found", "Instrument not found.");
  const aktuell = rows[0].w ?? {};
  if (stand === undefined) return aktuell;
  const { rows: aenderungen } = await tx.execute<{ vorher: { felder?: Werte } | null; nachher: { felder?: Werte } | null; am: Date }>(sql`
    SELECT vorher, nachher, am FROM aenderung
    WHERE tabelle = 'instrument' AND datensatz_id = ${instrumentId} AND aktion = 'felder_setzen'
    ORDER BY am, id`);
  if (aenderungen.length === 0) return aktuell;
  const grenze = new Date(stand).getTime();
  const bis = aenderungen.filter((r) => new Date(r.am).getTime() <= grenze);
  if (bis.length > 0) return bis[bis.length - 1]!.nachher?.felder ?? {};
  return aenderungen[0]!.vorher?.felder ?? {};
}

/** Definitionen eines Objekts (global, ohne Listen), optional mit archivierten. */
export async function ladeDefinitionen(tx: Tx, objekt: FeldObjekt, mitArchiviert = false): Promise<FeldDef[]> {
  const rows = await tx
    .select()
    .from(feldDefinition)
    .where(and(eq(feldDefinition.objekt, objekt), isNull(feldDefinition.listeId), mitArchiviert ? undefined : isNull(feldDefinition.archiviertAm)))
    .orderBy(asc(feldDefinition.position), asc(feldDefinition.name), asc(feldDefinition.id));
  return rows as FeldDef[];
}

/**
 * Namen zu Verknüpfungs- und Personenfeldern (Schlüssel `organisation:<id>`, `person:<id>`, `deal:<id>`, `benutzer:<id>`; `null` = nicht gefunden oder nicht
 * sichtbar), wie die Antworten der CRM-Abfragen sie tragen. Deals folgen der Sichtbarkeit der Person.
 */
async function ladeBezuege(tx: Tx, c: Context, felder: FeldMitWert[]): Promise<Record<string, string | null>> {
  return bezugsnamen(tx, felder, dealSichtbar(c));
}

/**
 * Wie `ladeBezuege`, aber mit der Bedingung für Deals als Parameter: Berichte haben keine Anfrage, deren Sichtbarkeit gilt; sie übergeben `sql\`false\``, damit
 * Verknüpfungen auf Deals nie aufgelöst werden. `undefined` heißt: keine Einschränkung (verwaltende Person).
 */
export async function bezugsnamen(tx: Tx, felder: readonly { typ: FeldDef["typ"]; optionen: Record<string, unknown>; wert: unknown }[], dealBedingung: SQL | undefined): Promise<Record<string, string | null>> {
  const ids: Record<"organisation" | "person" | "deal" | "benutzer", Set<string>> = { organisation: new Set(), person: new Set(), deal: new Set(), benutzer: new Set() };
  for (const f of felder) {
    if (typeof f.wert !== "string") continue;
    if (f.typ === "benutzer") ids.benutzer.add(f.wert);
    else if (f.typ === "verknuepfung") ids[(f.optionen.ziel as "organisation" | "person" | "deal") ?? "organisation"].add(f.wert);
  }
  const aus: Record<string, string | null> = {};
  const liste = (l: Set<string>) => sql`ANY(${feldArray([...l], "uuid")})`;
  const lade = async (typ: keyof typeof ids, abfrage: (l: Set<string>) => Promise<{ id: string; name: string }[]>) => {
    if (ids[typ].size === 0) return;
    const da = new Map((await abfrage(ids[typ])).map((g) => [g.id, g.name]));
    for (const id of ids[typ]) aus[`${typ}:${id}`] = da.get(id) ?? null;
  };
  await lade("organisation", async (l) => (await tx.execute<{ id: string; name: string }>(sql`SELECT id, name FROM ${organisation} WHERE id = ${liste(l)}`)).rows);
  await lade("person", async (l) => (await tx.execute<{ id: string; name: string }>(sql`SELECT id, vorname || ' ' || nachname AS name FROM ${person} WHERE id = ${liste(l)}`)).rows);
  await lade("deal", async (l) => (await tx.execute<{ id: string; name: string }>(sql`SELECT id, titel AS name FROM ${deal} WHERE id = ${liste(l)} ${dealBedingung ? sql`AND (${dealBedingung})` : sql``}`)).rows);
  await lade("benutzer", async (l) => (await tx.execute<{ id: string; name: string }>(sql`SELECT id, name FROM ${benutzer} WHERE id = ${liste(l)}`)).rows);
  return aus;
}

/**
 * Werte mehrerer Zeilen eines Objekts zu einem Wissensstand in zwei Abfragen (für Berichte; Regeln wie `ladeWerte`, nur nicht für Vorgänge): der Nachher-Stand der
 * letzten Änderung bis `stand`, sonst der Vorher-Stand der ersten späteren Änderung, sonst die aktuellen Werte. Zeilen, die es nicht gibt, fehlen im Ergebnis.
 */
export async function ladeWerteMehrere(tx: Tx, objekt: Exclude<PortfolioObjekt, "vorgang">, ids: readonly string[], stand?: string): Promise<Map<string, Werte>> {
  const aus = new Map<string, Werte>();
  if (ids.length === 0) return aus;
  const { tabelle, spalte } = bezeichner(objekt);
  const { rows } = await tx.execute<{ id: string; w: Werte | null }>(sql`SELECT id::text AS id, ${spalte} AS w FROM ${tabelle} WHERE id = ANY(${feldArray(ids, "uuid")})`);
  for (const r of rows) aus.set(r.id, r.w ?? {});
  if (stand === undefined) return aus;
  const ziel = FELD_ZIELE[objekt];
  const { rows: aenderungen } = await tx.execute<{ id: string; vorher: { felder?: Werte } | null; nachher: { felder?: Werte } | null; am: Date }>(sql`
    SELECT datensatz_id::text AS id, vorher, nachher, am FROM aenderung
    WHERE tabelle = ${ziel.protokollTabelle} AND datensatz_id = ANY(${feldArray(ids, "uuid")}) AND aktion = 'felder_setzen' AND nachher ->> 'objekt' = ${objekt}
    ORDER BY am, id`);
  const grenze = new Date(stand).getTime();
  const je = new Map<string, typeof aenderungen>();
  for (const a of aenderungen) je.set(a.id, [...(je.get(a.id) ?? []), a]);
  for (const [id, liste] of je) {
    const bis = liste.filter((r) => new Date(r.am).getTime() <= grenze);
    aus.set(id, bis.length > 0 ? (bis[bis.length - 1]!.nachher?.felder ?? {}) : (liste[0]!.vorher?.felder ?? {}));
  }
  return aus;
}

/** Felder mit Werten: aktive Definitionen immer, archivierte nur, wo ein Wert steht (die Historie geht nicht verloren). */
export async function beschreibeFelder(tx: Tx, c: Context, objekt: PortfolioObjekt, id: string, stand?: string, werteVorgabe?: Werte): Promise<{ werte: Werte; felder: FeldMitWert[]; bezuege: Record<string, string | null> }> {
  const werte = werteVorgabe ?? (await ladeWerte(tx, objekt, id, stand));
  const defs = await ladeDefinitionen(tx, objekt, true);
  const felder = defs
    .filter((d) => !d.archiviertAm || (werte[d.id] !== undefined && werte[d.id] !== null))
    .map((d) => ({
      id: d.id,
      schluessel: d.schluessel,
      name: d.name,
      typ: d.typ,
      optionen: d.optionen,
      position: d.position,
      version: d.version,
      archiviert: d.archiviertAm !== null,
      wert: werte[d.id] ?? null,
    }));
  return { werte, felder, bezuege: await ladeBezuege(tx, c, felder) };
}

/** Bestehende Zeile sperren und die Werte prüfen: gemeinsamer Anfang von Setzen und Anlegen. */
export async function pruefeNeueWerte(tx: Tx, c: Context, objekt: PortfolioObjekt, eingabe: Werte | undefined): Promise<Werte> {
  if (!eingabe || Object.keys(eingabe).length === 0) return {};
  const geprueft = await pruefeFelder(tx, c, await ladeDefinitionen(tx, objekt), eingabe);
  // Beim Anlegen gibt es nichts zu entfernen: `null` heißt dort kein Wert.
  return Object.fromEntries(Object.entries(geprueft).filter(([, w]) => w !== null));
}

export const werteEingabe = z.object({ werte: z.record(z.string(), z.unknown()).refine((w) => Object.keys(w).length > 0, { message: "At least one value must be provided" }) });

/**
 * Setzt Werte (Teilmenge; `null` entfernt einen Wert) und schreibt Vorher und Nachher der kompletten Werteliste ins Protokoll. Die Zeile wird gesperrt,
 * `vorgang` ist unveränderlich und nicht zulässig. Keine Änderung (alle Werte gleich) schreibt nichts.
 */
export async function setzeWerte(tx: Tx, protokoll: Protokollant, c: Context, objekt: PortfolioObjekt, id: string, eingabe: Werte): Promise<{ werte: Werte; geaendert: boolean }> {
  if (!FELD_ZIELE[objekt].veraenderbar) throw new Fachfehler(409, "fields_immutable", "The values of a transaction cannot be changed. A reversal and a new transaction carry the correct values.");
  const vorher = (await leseAktuell(tx, objekt, id, true)).werte;
  const geprueft = await pruefeFelder(tx, c, await ladeDefinitionen(tx, objekt), eingabe);
  const nachher: Werte = { ...vorher };
  for (const [feld, wert] of Object.entries(geprueft)) {
    if (wert === null) delete nachher[feld];
    else nachher[feld] = wert;
  }
  if (JSON.stringify(sortiert(vorher)) === JSON.stringify(sortiert(nachher))) return { werte: vorher, geaendert: false };
  const { tabelle, spalte } = bezeichner(objekt);
  await tx.execute(sql`UPDATE ${tabelle} SET ${spalte} = ${JSON.stringify(nachher)}::jsonb WHERE id = ${id}`);
  await protokoll("felder_setzen", FELD_ZIELE[objekt].protokollTabelle, id, { objekt, felder: vorher }, { objekt, felder: nachher });
  return { werte: nachher, geaendert: true };
}

/**
 * Setzt Werte am Instrument (`instrument.felder`, Teilmenge, `null` entfernt) und schreibt Vorher und Nachher ins Protokoll der Tabelle `instrument`.
 * Der Spiegel der Beteiligung (`instrument_felder`, Hauptinstrument) wird nachgeführt; ist das Instrument das Hauptinstrument, steht die Änderung zusätzlich
 * im Protokoll der Beteiligung (Objekt `instrument`), damit die Berichte zu einem früheren Wissensstand wie bisher lesen.
 */
export async function setzeInstrumentWerte(tx: Tx, protokoll: Protokollant, c: Context, instrumentId: string, istHaupt: boolean, eingabe: Werte): Promise<{ werte: Werte; geaendert: boolean }> {
  const { rows } = await tx.execute<{ w: Werte | null; beteiligung_id: string }>(sql`SELECT felder AS w, beteiligung_id FROM instrument WHERE id = ${instrumentId} FOR UPDATE`);
  const zeile = rows[0];
  if (!zeile) throw new Fachfehler(404, "instrument_not_found", "Instrument not found.");
  const vorher = zeile.w ?? {};
  const geprueft = await pruefeFelder(tx, c, await ladeDefinitionen(tx, "instrument"), eingabe);
  const nachher: Werte = { ...vorher };
  for (const [feld, wert] of Object.entries(geprueft)) {
    if (wert === null) delete nachher[feld];
    else nachher[feld] = wert;
  }
  if (JSON.stringify(sortiert(vorher)) === JSON.stringify(sortiert(nachher))) return { werte: vorher, geaendert: false };
  await tx.update(instrument).set({ felder: nachher }).where(eq(instrument.id, instrumentId));
  await protokoll("felder_setzen", "instrument", instrumentId, { objekt: "instrument", felder: vorher }, { objekt: "instrument", felder: nachher });
  if (istHaupt) {
    await tx.execute(sql`UPDATE beteiligung SET instrument_felder = ${JSON.stringify(nachher)}::jsonb WHERE id = ${zeile.beteiligung_id}`);
    await protokoll("felder_setzen", "beteiligung", zeile.beteiligung_id, { objekt: "instrument", felder: vorher }, { objekt: "instrument", felder: nachher });
  }
  return { werte: nachher, geaendert: true };
}

function sortiert(w: Werte): [string, unknown][] {
  return Object.entries(w).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

// Schema ------------------------------------------------------------------------------------------------------------------------

type JsonSchema = Record<string, unknown>;

/** JSON-Schema (2020-12) des Wertes eines Feldes; Auswahlfelder nennen ihre Optionsschlüssel, Beträge und Zahlen sind Zeichenketten. */
function schemaVon(d: FeldDef): JsonSchema {
  const titel = { title: d.name, "x-field-key": d.schluessel, "x-field-type": englischerEnumWert("typ", d.typ), "x-field-version": d.version };
  const optionen = ((d.optionen.optionen as { schluessel: string }[] | undefined) ?? []).map((o) => o.schluessel);
  switch (d.typ) {
    case "text":
      return { ...titel, type: "string", minLength: 1, maxLength: 500 };
    case "langtext":
      return { ...titel, type: "string", minLength: 1, maxLength: 20000 };
    case "zahl":
      return { ...titel, type: "string", pattern: "^-?\\d{1,18}(\\.\\d{1,6})?$", description: "Decimal number as a string" };
    case "betrag":
      return { ...titel, type: "string", pattern: "^-?\\d{1,16}(\\.\\d{1,2})?$", description: `Amount with at most two decimal places in ${String(d.optionen.waehrung ?? "EUR")}` };
    case "datum":
      return { ...titel, type: "string", format: "date" };
    case "auswahl":
      return { ...titel, type: "string", enum: optionen };
    case "mehrfachauswahl":
      return { ...titel, type: "array", uniqueItems: true, items: { type: "string", enum: optionen } };
    case "kontrollkaestchen":
      return { ...titel, type: "boolean" };
    case "url":
      return { ...titel, type: "string", format: "uri", maxLength: 500 };
    case "email":
      return { ...titel, type: "string", format: "email", maxLength: 320 };
    case "telefon":
      return { ...titel, type: "string", maxLength: 30 };
    case "benutzer":
    case "verknuepfung":
      return { ...titel, type: "string", format: "uuid" };
  }
}

/** Das Schema der Werte eines Objekts aus den aktiven Definitionen: Schlüssel der Eigenschaften sind die Definitions-IDs, `null` entfernt einen Wert. */
export async function schemaFuer(tx: Tx, objekt: FeldObjekt): Promise<JsonSchema> {
  const defs = await ladeDefinitionen(tx, objekt);
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: `Custom fields: ${englischerEnumWert("objekt", objekt)}`,
    type: "object",
    additionalProperties: false,
    properties: Object.fromEntries(defs.map((d) => [d.id, schemaVon(d)])),
    "x-note": "Keys are field definition IDs. Write null to remove a value. The types are the same as for contact and deal fields.",
  };
}

/** Prüft einen Wert gegen die Definition (ohne Datenbankbezug); für Tests und Berichtsspalten. */
export const pruefeWertOhneBezug = (def: Pick<FeldDef, "typ" | "optionen">, wert: unknown) => wertSchema(def).safeParse(wert).success;
