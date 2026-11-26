import { sql, type SQL } from "drizzle-orm";
import { belegnummern, exportStaende } from "../buchhaltung/belegnummern";
import { wirksameBewertung } from "../kennzahlen/fonds";
import { liste } from "../import/sql";
import { geldlos } from "../instrumente/geldfluss";
import type { Tx } from "../zeitlimit";

/**
 * Journal eines Fonds (Etappe 4b): eine zeitlich geordnete Liste aller Buchungen. Quellen sind Vorgänge (alle Arten einschließlich Zins,
 * Kapitalisierung und Storno), Fondsbewegungen (Abruf, Ausschüttung), freigegebene Bewertungen (auf Wunsch) und Ereignisse als Verweise
 * (Wandlung, Verkauf, Insolvenz). Jede Zeile trägt Valuta, Erfassungszeitpunkt, Typ, Beteiligung, den Betrag wie gebucht (Storno negativ),
 * die Kassenwirkung aus Sicht des Fonds (Zufluss positiv, Abfluss negativ, nichts bei Zusage, Wertberichtigung, Kapitalisierung, Bewertung
 * und Ereignissen), die Verknüpfung von Storno und Original, die Herkunft und die erfassende Person.
 *
 * Gelesen wird in zwei Schritten: erst die Seite (je Quelle ein Zweig mit Index und Limit, dann zusammengeführt), dann nur für die Zeilen
 * der Seite die Anreicherung (Namen, Herkunft, Erfasser, Storno-Gegenstück). Die Summen laufen als eigene Abfrage über den ganzen Filter.
 */

export const VORGANG_TYPEN = ["zusage", "auszahlung", "rueckfluss", "zins", "zinszahlung", "dividende", "tilgung", "wertberichtigung"] as const;
export const BEWEGUNG_TYPEN = ["abruf", "ausschuettung"] as const;
export const EREIGNIS_TYPEN = ["wandlung", "verkauf", "insolvenz"] as const;
export const JOURNAL_TYPEN = [...VORGANG_TYPEN, ...BEWEGUNG_TYPEN, "bewertung", ...EREIGNIS_TYPEN] as const;
export type JournalTyp = (typeof JOURNAL_TYPEN)[number];

export interface JournalFilter {
  fondsId: string;
  von?: string | undefined;
  bis?: string | undefined;
  typen?: readonly string[] | undefined;
  beteiligungId?: string | undefined;
  organisationId?: string | undefined;
  /** Freigegebene Bewertungen als Zeilen; auch bei `typ=bewertung`. */
  bewertungen?: boolean | undefined;
  /** Wissensstand: nur was bis dahin erfasst war. */
  stand?: string | undefined;
}

export interface Position {
  valuta: string;
  erfasstAm: string;
  id: string;
}

const MIKROSEKUNDEN = (spalte: string) => sql.raw(`to_char(${spalte} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`);

/** Welche Quellen der Filter überhaupt braucht. */
function quellen(f: JournalFilter) {
  const typen = f.typen && f.typen.length ? new Set(f.typen) : null;
  const will = (liste: readonly string[]) => typen === null || liste.some((t) => typen.has(t));
  const ohneBeteiligung = f.beteiligungId === undefined && f.organisationId === undefined;
  return {
    vorgang: will(VORGANG_TYPEN),
    bewegung: ohneBeteiligung && will(BEWEGUNG_TYPEN),
    bewertung: (f.bewertungen === true || (typen?.has("bewertung") ?? false)) && will(["bewertung"]),
    wandlung: will(["wandlung"]),
    verkauf: will(["verkauf"]),
    insolvenz: will(["insolvenz"]),
  };
}

/** Gemeinsame Bedingungen für Valuta, Wissensstand, Typen und die Position der Seite. */
function bedingungen(f: JournalFilter, spalten: { valuta: string; erfasst: string; typ: string; id: string }, nach: Position | null, richtung: "auf" | "ab", mitStand = true): SQL {
  const teile: SQL[] = [];
  if (f.von) teile.push(sql` AND ${sql.raw(spalten.valuta)} >= ${f.von}::date`);
  if (f.bis) teile.push(sql` AND ${sql.raw(spalten.valuta)} <= ${f.bis}::date`);
  if (mitStand && f.stand) teile.push(sql` AND ${sql.raw(spalten.erfasst)} <= ${f.stand}::timestamptz`);
  if (f.typen && f.typen.length) teile.push(sql` AND ${sql.raw(spalten.typ)} = ANY(${liste([...f.typen], "text")})`);
  if (nach) {
    const operator = sql.raw(richtung === "ab" ? "<" : ">");
    teile.push(sql` AND (${sql.raw(spalten.valuta)}, ${sql.raw(spalten.erfasst)}, ${sql.raw(spalten.id)}) ${operator} (${nach.valuta}::date, ${nach.erfasstAm}::timestamptz, ${nach.id}::uuid)`);
  }
  return sql.join(teile, sql``);
}

interface Optionen {
  nach: Position | null;
  richtung: "auf" | "ab";
  /** `null` = alle Zeilen (Summen). */
  limit: number | null;
}

/** Ein Zweig je Quelle; alle liefern dieselben Spalten in derselben Reihenfolge. */
function zweige(f: JournalFilter, o: Optionen): SQL[] {
  const q = quellen(f);
  const richtung = sql.raw(o.richtung === "ab" ? "DESC" : "ASC");
  const ordnung = (valuta: string, erfasst: string, id: string) => sql`ORDER BY ${sql.raw(valuta)} ${richtung}, ${sql.raw(erfasst)} ${richtung}, ${sql.raw(id)} ${richtung}${o.limit === null ? sql`` : sql` LIMIT ${o.limit}`}`;
  const beteiligung = (alias: string) => sql`${f.beteiligungId ? sql` AND ${sql.raw(alias)}.id = ${f.beteiligungId}::uuid` : sql``}${f.organisationId ? sql` AND ${sql.raw(alias)}.organisation_id = ${f.organisationId}::uuid` : sql``}`;
  const aus: SQL[] = [];

  if (q.vorgang) {
    const w = bedingungen(f, { valuta: "v.valuta", erfasst: "v.erfasst_am", typ: "v.art::text", id: "v.id" }, o.nach, o.richtung);
    aus.push(sql`(SELECT 'vorgang'::text AS quelle, v.id, v.valuta, v.erfasst_am, v.art::text AS typ, v.beteiligung_id, b.organisation_id, v.betrag, v.storniert_vorgang_id AS storno_von,
        v.kapitalisiert, v.bemerkung, NULL::uuid AS ereignis_id, NULL::boolean AS ereignis_storniert, ${geldlos("v")} AS geldlos
      FROM vorgang v JOIN beteiligung b ON b.id = v.beteiligung_id
      WHERE b.fonds_id = ${f.fondsId}::uuid${beteiligung("b")}${w}
      ${ordnung("v.valuta", "v.erfasst_am", "v.id")})`);
  }
  if (q.bewegung) {
    const w = bedingungen(f, { valuta: "x.valuta", erfasst: "x.erfasst_am", typ: "x.art::text", id: "x.id" }, o.nach, o.richtung);
    aus.push(sql`(SELECT 'fondsbewegung'::text AS quelle, x.id, x.valuta, x.erfasst_am, x.art::text AS typ, NULL::uuid AS beteiligung_id, NULL::uuid AS organisation_id, x.betrag, x.storniert_bewegung_id AS storno_von,
        false AS kapitalisiert, x.bemerkung, NULL::uuid AS ereignis_id, NULL::boolean AS ereignis_storniert, false AS geldlos
      FROM fonds_bewegung x
      WHERE x.fonds_id = ${f.fondsId}::uuid${w}
      ${ordnung("x.valuta", "x.erfasst_am", "x.id")})`);
  }
  if (q.bewertung) {
    // Eine Bewertung zählt ab ihrer Freigabe (Wissensstand über `wirksameBewertung`); die Zeile nennt die Freigabe als Erfassung.
    const w = bedingungen(f, { valuta: "w.stichtag", erfasst: "w.freigegeben_am", typ: "'bewertung'", id: "w.id" }, o.nach, o.richtung, false);
    aus.push(sql`(SELECT 'bewertung'::text AS quelle, w.id, w.stichtag AS valuta, w.freigegeben_am AS erfasst_am, 'bewertung'::text AS typ, w.beteiligung_id, b.organisation_id, w.wert AS betrag, NULL::uuid AS storno_von,
        false AS kapitalisiert, w.begruendung AS bemerkung, NULL::uuid AS ereignis_id, NULL::boolean AS ereignis_storniert, false AS geldlos
      FROM bewertung w JOIN beteiligung b ON b.id = w.beteiligung_id
      WHERE b.fonds_id = ${f.fondsId}::uuid AND ${wirksameBewertung("w", f.stand)}${beteiligung("b")}${w}
      ${ordnung("w.stichtag", "w.freigegeben_am", "w.id")})`);
  }
  if (q.wandlung) {
    const w = bedingungen(f, { valuta: "x.cutoff", erfasst: "x.erfasst_am", typ: "'wandlung'", id: "x.id" }, o.nach, o.richtung);
    const bet = f.beteiligungId ? sql` AND (x.darlehen_beteiligung_id = ${f.beteiligungId}::uuid OR x.ziel_beteiligung_id = ${f.beteiligungId}::uuid)` : sql``;
    const org = f.organisationId ? sql` AND b.organisation_id = ${f.organisationId}::uuid` : sql``;
    aus.push(sql`(SELECT 'ereignis'::text AS quelle, x.id, x.cutoff AS valuta, x.erfasst_am, 'wandlung'::text AS typ, x.darlehen_beteiligung_id AS beteiligung_id, b.organisation_id, x.wandlungsbetrag AS betrag, NULL::uuid AS storno_von,
        false AS kapitalisiert, NULL::text AS bemerkung, x.id AS ereignis_id, false AS ereignis_storniert, false AS geldlos
      FROM wandlung x JOIN beteiligung b ON b.id = x.darlehen_beteiligung_id
      WHERE b.fonds_id = ${f.fondsId}::uuid${bet}${org}${w}
      ${ordnung("x.cutoff", "x.erfasst_am", "x.id")})`);
  }
  if (q.verkauf) {
    const w = bedingungen(f, { valuta: "x.datum", erfasst: "x.erfasst_am", typ: "'verkauf'", id: "x.id" }, o.nach, o.richtung);
    const storniert = f.stand ? sql`(x.storniert_am IS NOT NULL AND x.storniert_am <= ${f.stand}::timestamptz)` : sql`(x.storniert_am IS NOT NULL)`;
    aus.push(sql`(SELECT 'ereignis'::text AS quelle, x.id, x.datum AS valuta, x.erfasst_am, 'verkauf'::text AS typ, x.beteiligung_id, b.organisation_id, x.kaufpreis AS betrag, NULL::uuid AS storno_von,
        false AS kapitalisiert, NULL::text AS bemerkung, x.id AS ereignis_id, ${storniert} AS ereignis_storniert, false AS geldlos
      FROM verkauf x JOIN beteiligung b ON b.id = x.beteiligung_id
      WHERE b.fonds_id = ${f.fondsId}::uuid${beteiligung("b")}${w}
      ${ordnung("x.datum", "x.erfasst_am", "x.id")})`);
  }
  if (q.insolvenz) {
    // Insolvenzen haben keinen eigenen Datensatz: Das Änderungsprotokoll (Aktion `insolvenz`) trägt Datum und Zeitpunkt (`insolvenzDatum` im Stand
    // nach der Buchung; bei älteren Zeilen der Tag der Buchung in Berliner Ortszeit).
    const datum = "coalesce((x.nachher->>'insolvenzDatum')::date, (x.am AT TIME ZONE 'Europe/Berlin')::date)";
    const w = bedingungen(f, { valuta: datum, erfasst: "x.am", typ: "'insolvenz'", id: "x.id" }, o.nach, o.richtung);
    aus.push(sql`(SELECT 'ereignis'::text AS quelle, x.id, ${sql.raw(datum)} AS valuta, x.am AS erfasst_am, 'insolvenz'::text AS typ, x.datensatz_id AS beteiligung_id, b.organisation_id, NULL::numeric AS betrag, NULL::uuid AS storno_von,
        false AS kapitalisiert, NULL::text AS bemerkung, x.datensatz_id AS ereignis_id, false AS ereignis_storniert, false AS geldlos
      FROM aenderung x JOIN beteiligung b ON b.id = x.datensatz_id
      WHERE x.aktion = 'insolvenz' AND x.tabelle = 'beteiligung' AND x.fonds_id = ${f.fondsId}::uuid${beteiligung("b")}${w}
      ${ordnung(datum, "x.am", "x.id")})`);
  }
  return aus;
}

type Roh = {
  quelle: "vorgang" | "fondsbewegung" | "bewertung" | "ereignis";
  id: string;
  valuta: string;
  erfasst_am: string;
  erfasst_text: string;
  typ: string;
  beteiligung_id: string | null;
  organisation_id: string | null;
  betrag: string | null;
  storno_von: string | null;
  kapitalisiert: boolean;
  bemerkung: string | null;
  ereignis_id: string | null;
  ereignis_storniert: boolean | null;
  /** Buchung einer Wandlung ohne Geldfluss (siehe `geldlos`). */
  geldlos: boolean;
};

export type Richtung = "zufluss" | "abfluss";

/**
 * Richtung der Kasse aus Sicht des Fonds: nur Zahlungen haben eine. Zinszahlung und Dividende sind Geldeingänge; eine Zinsbuchung (`zins`) ist eine
 * Forderung und bewegt keine Kasse (Portfolio-Modell), ebenso Kapitalisierungen, Zusagen, Wertberichtigungen, Bewertungen und Ereignisse.
 */
export function kassenrichtung(typ: string, _kapitalisiert: boolean): Richtung | null {
  if (typ === "rueckfluss" || typ === "tilgung" || typ === "zinszahlung" || typ === "dividende" || typ === "abruf") return "zufluss";
  if (typ === "auszahlung" || typ === "ausschuettung") return "abfluss";
  return null;
}

export type Herkunft = {
  art: "manuell" | "import" | "zinslauf" | "wandlung" | "verkauf" | "runde";
  id: string | null;
}

export type JournalZeile = {
  id: string;
  quelle: Roh["quelle"];
  typ: string;
  valuta: string;
  erfasstAm: string;
  betrag: string | null;
  /** Aus Sicht des Fonds: Zufluss positiv, Abfluss negativ; leer ohne Kassenwirkung. */
  kassenwirkung: string | null;
  /** Buchung einer Wandlung ohne Geldfluss (Tilgung durch Wandlung, Zusage und Einlage des Ziels): keine Kassenwirkung. Der Spitzenbetrag ist eine echte Zahlung. */
  ohneGeldfluss: boolean;
  richtung: Richtung | null;
  beteiligung: { id: string; organisationId: string; organisationName: string; instrument: string } | null;
  /** Das Instrument des Vorgangs (nur bei Vorgängen). */
  instrumentId: string | null;
  instrumentBezeichnung: string | null;
  kapitalisiert: boolean;
  /** Diese Zeile ist ein Storno und hebt die Zeile mit dieser ID auf. */
  stornoVon: string | null;
  /** Diese Zeile ist durch die Zeile mit dieser ID storniert (nur, wenn das Storno im Wissensstand schon erfasst war). */
  storniertDurch: string | null;
  bemerkung: string | null;
  herkunft: Herkunft;
  erfasstVon: { id: string; name: string | null } | null;
  /**
   * Buchhaltung (Etappe 14), nur bei Vorgängen und Fondsbewegungen: Belegnummer des freigegebenen Belegs und Zeitpunkt des Exports in die
   * Buchhaltung (aktive Markierung). `null` bei Ereignissen und Bewertungen.
   */
  buchhaltung: { belegnummer: string | null; exportiertAm: string | null } | null;
  /** Bei Ereignissen und Bewertungen: worauf die Zeile verweist. */
  verweis: { art: "wandlung" | "verkauf" | "insolvenz" | "bewertung"; id: string; storniert?: boolean } | null;
}

export type JournalSumme = {
  typ: string;
  anzahl: number;
  /** Summe der Beträge (Storno negativ, damit netto); nur für Vorgänge und Fondsbewegungen. */
  summe: string | null;
  kassenwirkung: string | null;
}

export type JournalSeite = {
  daten: JournalZeile[];
  weitere: boolean;
  naechsterCursor: string | null;
}

const kodiere = (p: Position) => Buffer.from(JSON.stringify([p.valuta, p.erfasstAm, p.id])).toString("base64url");
export function dekodiereCursor(cursor: string): Position | null {
  try {
    const wert: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (Array.isArray(wert) && wert.length === 3 && wert.every((x) => typeof x === "string")) {
      const [valuta, erfasstAm, id] = wert as [string, string, string];
      if (/^\d{4}-\d{2}-\d{2}$/.test(valuta) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(erfasstAm) && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return { valuta, erfasstAm, id };
    }
  } catch {
    // ungültiger Cursor: als Eingabefehler gemeldet
  }
  return null;
}

/** Eine Seite des Journals. `limit` Zeilen, `weitere` sagt, ob es dahinter noch welche gibt. */
export async function ladeJournalSeite(tx: Tx, f: JournalFilter, optionen: { nach: Position | null; richtung: "auf" | "ab"; limit: number }): Promise<JournalSeite> {
  const aus = zweige(f, { nach: optionen.nach, richtung: optionen.richtung, limit: optionen.limit + 1 });
  if (aus.length === 0) return { daten: [], weitere: false, naechsterCursor: null };
  const richtung = sql.raw(optionen.richtung === "ab" ? "DESC" : "ASC");
  const { rows } = await tx.execute<Roh>(sql`
    SELECT u.*, ${MIKROSEKUNDEN("u.erfasst_am")} AS erfasst_text
    FROM (${sql.join(aus, sql` UNION ALL `)}) u
    ORDER BY u.valuta ${richtung}, u.erfasst_am ${richtung}, u.id ${richtung}
    LIMIT ${optionen.limit + 1}`);
  const seite = rows.slice(0, optionen.limit);
  const daten = await reichere(tx, f, seite);
  const letzte = seite.at(-1);
  return {
    daten,
    weitere: rows.length > optionen.limit,
    naechsterCursor: rows.length > optionen.limit && letzte ? kodiere({ valuta: letzte.valuta, erfasstAm: letzte.erfasst_text, id: letzte.id }) : null,
  };
}

/** Anreicherung nur der Zeilen einer Seite: Namen, Storno-Gegenstück, Herkunft und erfassende Person. */
async function reichere(tx: Tx, f: JournalFilter, zeilen: readonly Roh[]): Promise<JournalZeile[]> {
  if (zeilen.length === 0) return [];
  const ids = (quelle: string) => zeilen.filter((z) => z.quelle === quelle).map((z) => z.id);
  const vorgangIds = ids("vorgang");
  const bewegungIds = ids("fondsbewegung");
  const beteiligungIds = [...new Set(zeilen.flatMap((z) => (z.beteiligung_id ? [z.beteiligung_id] : [])))];

  const namen = new Map<string, { organisationId: string; organisationName: string; instrument: string }>();
  if (beteiligungIds.length) {
    const { rows } = await tx.execute<{ id: string; organisation_id: string; name: string; instrument: string }>(sql`
      SELECT b.id, b.organisation_id, o.name, b.instrument::text AS instrument FROM beteiligung b JOIN organisation o ON o.id = b.organisation_id WHERE b.id = ANY(${liste(beteiligungIds, "uuid")})`);
    for (const r of rows) namen.set(r.id, { organisationId: r.organisation_id, organisationName: r.name, instrument: r.instrument });
  }

  // Instrument der Vorgänge dieser Seite.
  const instrumente = new Map<string, { id: string; bezeichnung: string }>();
  if (vorgangIds.length) {
    const { rows } = await tx.execute<{ id: string; instrument_id: string; bezeichnung: string }>(sql`
      SELECT v.id, v.instrument_id, i.bezeichnung FROM vorgang v JOIN instrument i ON i.id = v.instrument_id WHERE v.id = ANY(${liste(vorgangIds, "uuid")})`);
    for (const r of rows) instrumente.set(r.id, { id: r.instrument_id, bezeichnung: r.bezeichnung });
  }

  // Gegenstück eines Storno: Das Storno markiert sein Original nur, wenn es im Wissensstand schon erfasst war.
  const storniertDurch = new Map<string, string>();
  const stand = f.stand ? sql` AND s.erfasst_am <= ${f.stand}::timestamptz` : sql``;
  if (vorgangIds.length) {
    const { rows } = await tx.execute<{ original: string; storno: string }>(sql`SELECT s.storniert_vorgang_id AS original, s.id AS storno FROM vorgang s WHERE s.storniert_vorgang_id = ANY(${liste(vorgangIds, "uuid")})${stand}`);
    for (const r of rows) storniertDurch.set(r.original, r.storno);
  }
  if (bewegungIds.length) {
    const { rows } = await tx.execute<{ original: string; storno: string }>(sql`SELECT s.storniert_bewegung_id AS original, s.id AS storno FROM fonds_bewegung s WHERE s.storniert_bewegung_id = ANY(${liste(bewegungIds, "uuid")})${stand}`);
    for (const r of rows) storniertDurch.set(r.original, r.storno);
  }

  // Herkunft (Vorgänge): Runde, Zinslauf, Wandlung, Verkauf, Import; sonst von Hand. Alle Abfragen sind auf die Zeilen der Seite begrenzt.
  const herkunft = new Map<string, Herkunft>();
  const setze = (id: string, h: Herkunft) => {
    if (!herkunft.has(id)) herkunft.set(id, h);
  };
  if (vorgangIds.length) {
    const vIds = liste(vorgangIds, "uuid");
    const bIds = liste(beteiligungIds, "uuid");
    for (const r of (await tx.execute<{ vorgang_id: string; runde_id: string }>(sql`SELECT vorgang_id, runde_id FROM runde_buchung WHERE vorgang_id = ANY(${vIds})`)).rows) setze(r.vorgang_id, { art: "runde", id: r.runde_id });
    for (const r of (await tx.execute<{ vorgang_id: string; zinslauf_id: string }>(sql`SELECT p.vorgang_id, p.zinslauf_id FROM zinslauf_position p WHERE p.beteiligung_id = ANY(${bIds}) AND p.vorgang_id = ANY(${vIds})`)).rows) setze(r.vorgang_id, { art: "zinslauf", id: r.zinslauf_id });
    for (const r of (await tx.execute<{ vorgang_id: string; wandlung_id: string }>(sql`
      SELECT v.value AS vorgang_id, w.id AS wandlung_id FROM wandlung w, jsonb_each_text(w.vorgaenge) v
      WHERE (w.darlehen_beteiligung_id = ANY(${bIds}) OR w.ziel_beteiligung_id = ANY(${bIds})) AND v.value = ANY(${liste(vorgangIds, "text")})`)).rows) setze(r.vorgang_id, { art: "wandlung", id: r.wandlung_id });
    for (const r of (await tx.execute<{ vorgang_id: string; verkauf_id: string }>(sql`
      SELECT x.rueckfluss_vorgang_id AS vorgang_id, x.id AS verkauf_id FROM verkauf x WHERE x.beteiligung_id = ANY(${bIds}) AND x.rueckfluss_vorgang_id = ANY(${vIds})
      UNION ALL SELECT fo.vorgang_id, fo.verkauf_id FROM forderung fo WHERE fo.beteiligung_id = ANY(${bIds}) AND fo.vorgang_id = ANY(${vIds})
      UNION ALL SELECT k.vorgang_id, k.verkauf_id FROM kaufpreisanpassung k WHERE k.vorgang_id = ANY(${vIds})`)).rows) setze(r.vorgang_id, { art: "verkauf", id: r.verkauf_id });
  }
  const importiert = [...vorgangIds.map((id) => ({ objekt: "vorgang", id })), ...bewegungIds.map((id) => ({ objekt: "bewegung", id }))];
  if (importiert.length) {
    const { rows } = await tx.execute<{ objekt: string; datensatz_id: string; lauf_id: string | null }>(sql`
      SELECT objekt, datensatz_id, lauf_id FROM import_zuordnung WHERE (objekt = 'vorgang' AND datensatz_id = ANY(${liste(vorgangIds, "uuid")})) OR (objekt = 'bewegung' AND datensatz_id = ANY(${liste(bewegungIds, "uuid")}))`);
    for (const r of rows) setze(r.datensatz_id, { art: "import", id: r.lauf_id });
  }

  // Erfassende Person: die erste Protokollzeile `anlegen` des Datensatzes.
  const erfasser = new Map<string, { id: string; name: string | null }>();
  const gebucht = [...vorgangIds.map((id) => ({ tabelle: "vorgang", id })), ...bewegungIds.map((id) => ({ tabelle: "fonds_bewegung", id }))];
  if (gebucht.length) {
    const { rows } = await tx.execute<{ datensatz_id: string; akteur: string; name: string | null }>(sql`
      SELECT DISTINCT ON (a.datensatz_id) a.datensatz_id, a.akteur, coalesce(a.akteur_name, bn.name) AS name
      FROM aenderung a LEFT JOIN benutzer bn ON bn.id::text = a.akteur
      WHERE a.aktion = 'anlegen' AND ((a.tabelle = 'vorgang' AND a.datensatz_id = ANY(${liste(vorgangIds, "uuid")})) OR (a.tabelle = 'fonds_bewegung' AND a.datensatz_id = ANY(${liste(bewegungIds, "uuid")})))
      ORDER BY a.datensatz_id, a.am`);
    for (const r of rows) erfasser.set(r.datensatz_id, { id: r.akteur, name: r.name });
  }

  // Belegnummer und Exportstand (Buchhaltung, Etappe 14).
  const nummern = await belegnummern(tx, f.fondsId, vorgangIds, bewegungIds);
  const exporte = await exportStaende(tx, vorgangIds, bewegungIds);

  return zeilen.map((z) => {
    const richtung = kassenrichtung(z.typ, z.kapitalisiert);
    const zahlung = z.quelle === "vorgang" || z.quelle === "fondsbewegung";
    const kasse = zahlung && !z.geldlos;
    const kassenwirkung = kasse && richtung && z.betrag !== null ? (richtung === "zufluss" ? z.betrag : negiere(z.betrag)) : null;
    const b = z.beteiligung_id ? namen.get(z.beteiligung_id) : undefined;
    return {
      id: z.id,
      quelle: z.quelle,
      typ: z.typ,
      valuta: z.valuta,
      erfasstAm: z.erfasst_text,
      betrag: z.betrag,
      kassenwirkung,
      ohneGeldfluss: z.geldlos === true,
      richtung: kasse ? richtung : null,
      beteiligung: z.beteiligung_id && b ? { id: z.beteiligung_id, ...b } : null,
      instrumentId: instrumente.get(z.id)?.id ?? null,
      instrumentBezeichnung: instrumente.get(z.id)?.bezeichnung ?? null,
      kapitalisiert: z.kapitalisiert,
      stornoVon: z.storno_von,
      storniertDurch: storniertDurch.get(z.id) ?? null,
      bemerkung: z.bemerkung,
      herkunft: zahlung ? (herkunft.get(z.id) ?? { art: "manuell", id: null }) : { art: "manuell", id: null },
      erfasstVon: erfasser.get(z.id) ?? null,
      buchhaltung: zahlung ? { belegnummer: nummern.get(z.id) ?? null, exportiertAm: exporte.get(z.id)?.am ?? null } : null,
      verweis:
        z.quelle === "ereignis" && z.ereignis_id
          ? { art: z.typ as "wandlung" | "verkauf" | "insolvenz", id: z.ereignis_id, ...(z.typ === "verkauf" ? { storniert: z.ereignis_storniert === true } : {}) }
          : z.quelle === "bewertung"
            ? { art: "bewertung", id: z.id }
            : null,
    };
  });
}

/** Negation einer Dezimalzahl als Text, ohne Gleitkomma (Beträge haben höchstens zwei Nachkommastellen). */
function negiere(betrag: string): string {
  if (/^0(\.0+)?$/.test(betrag)) return betrag;
  return betrag.startsWith("-") ? betrag.slice(1) : `-${betrag}`;
}

/** Summen je Typ über den ganzen Filter (nicht nur die Seite) und die Kassenwirkung insgesamt (nur Zahlungen). */
export async function ladeJournalSummen(tx: Tx, f: JournalFilter): Promise<{ nachTyp: JournalSumme[]; gesamt: { anzahl: number; kassenwirkung: string } }> {
  const aus = zweige(f, { nach: null, richtung: "ab", limit: null });
  if (aus.length === 0) return { nachTyp: [], gesamt: { anzahl: 0, kassenwirkung: "0.00" } };
  const { rows } = await tx.execute<{ typ: string; anzahl: number; summe: string | null; kasse: string | null }>(sql`
    SELECT u.typ, count(*)::int AS anzahl,
      CASE WHEN u.quelle IN ('vorgang', 'fondsbewegung') THEN sum(u.betrag)::text END AS summe,
      CASE WHEN u.quelle IN ('vorgang', 'fondsbewegung') THEN sum(u.betrag * CASE
        WHEN u.geldlos THEN 0
        WHEN u.typ IN ('rueckfluss', 'tilgung', 'zinszahlung', 'dividende', 'abruf') THEN 1
        WHEN u.typ IN ('auszahlung', 'ausschuettung') THEN -1 ELSE 0 END)::text END AS kasse
    FROM (${sql.join(aus, sql` UNION ALL `)}) u
    GROUP BY u.typ, u.quelle`);
  const reihenfolge = new Map<string, number>(JOURNAL_TYPEN.map((t, i) => [t, i]));
  // `zins` mit und ohne Kapitalisierung: die Gruppierung nach Typ fasst beides zusammen; die Kassenwirkung kommt aus der Summe je Zeile.
  const nachTyp = new Map<string, JournalSumme>();
  for (const r of rows) {
    const vorhanden = nachTyp.get(r.typ);
    if (vorhanden) {
      vorhanden.anzahl += r.anzahl;
      continue;
    }
    nachTyp.set(r.typ, { typ: r.typ, anzahl: r.anzahl, summe: r.summe, kassenwirkung: r.kasse });
  }
  const sortiert = [...nachTyp.values()].sort((a, b) => (reihenfolge.get(a.typ) ?? 99) - (reihenfolge.get(b.typ) ?? 99));
  const kasse = sortiert.reduce((s, t) => s + Math.round(Number(t.kassenwirkung ?? 0) * 100), 0);
  return { nachTyp: sortiert, gesamt: { anzahl: sortiert.reduce((s, t) => s + t.anzahl, 0), kassenwirkung: (kasse / 100).toFixed(2) } };
}
