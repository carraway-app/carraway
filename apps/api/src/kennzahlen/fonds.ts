import { sql } from "drizzle-orm";
import { Decimal, beteiligungsMultiple, multiples, xirr, type MitHerkunft, type Rechenschritt, type Zahlungsstrom } from "@carraway/rechenkern";
import type { Tx } from "../zeitlimit";
export { bisStand, ohneStornoPaare } from "./zeitstand";
import { bisStand } from "./zeitstand";
import { ladeKapitalstand } from "../instrumente/kapitalstand";
import { geldlos } from "../instrumente/geldfluss";
import { ermittleNavBestandteile, NAV_LUECKE, type PortfolioPosition } from "./nav";
import { ermittleBeteiligungsstatus } from "./beteiligungsstatus";

/**
 * Kennzahlen eines Fonds zu einem Stichtag. Beteiligungswerte, Abrufe, tatsächliche Zahlungsströme und übernommene Bilanzsalden
 * werden zum selben Wissensstand gelesen.
 * Das Modul kennt kein HTTP: Der Worker ruft es auf und speichert das Ergebnis als Snapshot (`snapshot.ts`).
 * Mit `stand` rechnet es den Wissensstand zu einem früheren Zeitpunkt nach (bitemporales Lesen).
 */

export interface Kennzahl {
  /** Dezimalzahl als Zeichenkette, nie als Gleitkommazahl; `null`, wenn nicht definiert. */
  wert: string | null;
  schritte: Rechenschritt[];
}

/** Ein Instrument der Beteiligung (Stammdaten, ohne Zahlen). */
export interface InstrumentKurz {
  id: string;
  art: string;
  bezeichnung: string;
  status: string;
}

export interface BeteiligungZeile {
  id: string;
  organisation: { id: string; name: string; sektor: string | null };
  /** Art des Hauptinstruments (alter Name, bleibt für Excel, öffentliche API und Berichte). */
  instrument: string;
  /** Alle Instrumente der Beteiligung (älteste zuerst); bei Snapshots aus der Zeit vor den Instrumenten fehlt das Feld. */
  instrumente?: InstrumentKurz[];
  status: string;
  erstinvestment: string;
  zusage: string;
  investiert: string;
  rueckfluesse: string;
  letzteBewertung: { stichtag: string; wert: string; methode: string } | null;
  /** Offene Kaufpreisforderungen (Treuhand) zum Stichtag, zählen zum Wertansatz der Beteiligung. */
  offeneForderungen: string;
  multiple: Kennzahl;
}

export interface FondsUebersicht {
  stichtag: string;
  portfoliowert: string;
  kennzahlen: { abgerufen: Kennzahl; eingezahlt: Kennzahl; offen: Kennzahl; ueberfaellig: Kennzahl; ungeklaert: Kennzahl; ausschuettungen: Kennzahl; nav: Kennzahl; tvpi: Kennzahl; dpi: Kennzahl; rvpi: Kennzahl; irr: Kennzahl };
  beteiligungen: BeteiligungZeile[];
}

type Abfrage = Pick<Tx, "execute">;

const NICHT_DEFINIERT = "nicht definiert";

const alsKennzahl = (m: MitHerkunft<Decimal | null>): Kennzahl => ({ wert: m.wert === null ? null : m.wert.toString(), schritte: m.schritte });
const kapitalKennzahl = (bezeichnung: string, betrag: string): Kennzahl => {
  const wert = new Decimal(betrag).toString();
  return { wert, schritte: [{ zeichen: "=", bezeichnung, wert }] };
};
const heute = () => new Date().toISOString().slice(0, 10);

/**
 * Wirksame Bewertungen: nur freigegebene zählen (Entwürfe nirgends). Mit Wissensstand zählt eine Bewertung ab ihrer
 * Freigabe und bis zu ihrer Ersetzung (`freigegeben_am <= stand < ersetzt_am`), nicht ab `erfasst_am`.
 * `alias` ist der Tabellenalias der Bewertung in der Abfrage.
 */
export const wirksameBewertung = (alias: string, stand: string | undefined) =>
  stand === undefined
    ? sql.raw(`${alias}.status = 'freigegeben'`)
    : sql`${sql.raw(alias)}.status IN ('freigegeben', 'ersetzt') AND ${sql.raw(alias)}.freigegeben_am <= ${stand}::timestamptz AND (${sql.raw(alias)}.ersetzt_am IS NULL OR ${sql.raw(alias)}.ersetzt_am > ${stand}::timestamptz)`;

/** SQL-Ausdruck: jüngster Zeitpunkt, an dem sich Bewertungen einer Beteiligung geändert haben (Erfassung, Freigabe, Ersetzung). */
export const bewertungsAenderung = (beteiligungSpalte: string) =>
  `(SELECT greatest(max(erfasst_am), max(freigegeben_am), max(ersetzt_am)) FROM bewertung WHERE beteiligung_id = ${beteiligungSpalte})`;

/** Letzter Bewertungsstichtag des Fonds, Vorgabe für den Stichtag. `null`, wenn es keine Bewertung gibt. */
export async function letzterBewertungsstichtag(tx: Abfrage, fondsId: string, stand?: string): Promise<string | null> {
  const { rows } = await tx.execute<{ stichtag: string | null }>(sql`
    SELECT max(w.stichtag)::text AS stichtag
    FROM bewertung w JOIN beteiligung b ON b.id = w.beteiligung_id
    WHERE b.fonds_id = ${fondsId} AND ${wirksameBewertung("w", stand)}`);
  return rows[0]?.stichtag ?? null;
}

/**
 * Der letzte Bewertungs-, Vorgangs- oder Saldenstichtag bildet die Basis. Ohne diese Daten gilt heute.
 * Spätere Fondsbewegungen und LP-Zahlungen schieben die Basis bis höchstens heute vor.
 */
export async function standardStichtag(tx: Abfrage, fondsId: string, stand?: string): Promise<string> {
  const heuteTag = heute();
  const bewertung = await letzterBewertungsstichtag(tx, fondsId, stand);
  const { rows } = await tx.execute<{ datum: string }>(sql`
    SELECT greatest(
      coalesce(greatest(
        ${bewertung}::date,
        (SELECT max(v.valuta) FROM vorgang v JOIN beteiligung b ON b.id = v.beteiligung_id
         WHERE b.fonds_id = ${fondsId} AND v.valuta <= ${heuteTag}::date${bisStand(sql.raw("v.erfasst_am"), stand)}),
        (SELECT max(zeitraum_bis) FROM saldenlauf WHERE fonds_id = ${fondsId} AND status = 'uebernommen'
         AND zeitraum_bis <= ${heuteTag}::date${bisStand(sql.raw("uebernommen_am"), stand)})
      ), ${heuteTag}::date),
      (SELECT max(fb.valuta) FROM fonds_bewegung fb WHERE fb.fonds_id = ${fondsId} AND fb.valuta <= ${heuteTag}::date${bisStand(sql.raw("fb.erfasst_am"), stand)}),
      (SELECT max(z.valuta) FROM lp_zahlung z JOIN fonds_bewegung fb ON fb.id = z.bewegung_id WHERE fb.fonds_id = ${fondsId} AND z.valuta <= ${heuteTag}::date${bisStand(sql.raw("z.erfasst_am"), stand)})
    )::text AS datum`);
  const spaeter = rows[0]!.datum;
  return spaeter < heuteTag ? spaeter : heuteTag;
}

/**
 * Jüngster Erfassungszeitpunkt aller Eingangsdaten des Fonds (Vorgänge, Bewertungen, Fondsbewegungen) als
 * Postgres-Text mit voller Mikrosekunden-Genauigkeit; `null`, wenn es keine Eingangsdaten gibt. Neue Instrumente zählen mit: Sie ändern die Zeilen der
 * Übersicht (Instrumente der Beteiligung), auch ohne neuen Vorgang.
 */
export async function juengsterEingang(tx: Abfrage, fondsId: string): Promise<string | null> {
  const { rows } = await tx.execute<{ t: string | null }>(sql`
    SELECT greatest(
      (SELECT greatest(max(uebernommen_am), max(ersetzt_am)) FROM saldenlauf WHERE fonds_id = ${fondsId}),
      (SELECT max(erfasst_am) FROM fonds_bewegung WHERE fonds_id = ${fondsId}),
      (SELECT max(z.erfasst_am) FROM lp_zahlung z JOIN fonds_bewegung fb ON fb.id = z.bewegung_id WHERE fb.fonds_id = ${fondsId}),
      (SELECT max(m) FROM (SELECT (SELECT max(erfasst_am) FROM vorgang WHERE beteiligung_id = b.id) AS m FROM beteiligung b WHERE b.fonds_id = ${fondsId}) x),
      (SELECT max(m) FROM (SELECT ${sql.raw(bewertungsAenderung("b.id"))} AS m FROM beteiligung b WHERE b.fonds_id = ${fondsId}) y),
      (SELECT max(i.erstellt_am) FROM instrument i JOIN beteiligung b ON b.id = i.beteiligung_id WHERE b.fonds_id = ${fondsId}),
      (SELECT greatest(max(vk.erfasst_am), max(vk.storniert_am)) FROM verkauf vk JOIN beteiligung b ON b.id = vk.beteiligung_id WHERE b.fonds_id = ${fondsId})
    )::text AS t`);
  return rows[0]?.t ?? null;
}

type BeteiligungRoh = {
  id: string;
  organisation_id: string;
  organisation_name: string;
  sektor: string | null;
  instrument: string;
  status: string;
  erstinvestment: string;
  zusage: string;
  investiert: string;
  rueckfluesse: string;
  exit_valuta: string | null;
  bewertung_id: string | null;
  bewertung_stichtag: string | null;
  bewertung_wert: string | null;
  bewertung_methode: string | null;
}

type ForderungRoh = { beteiligung_id: string; summe: string; anzahl: number };

/**
 * Offene Kaufpreisforderungen (Treuhandbeträge aus Verkäufen) je Beteiligung zum Stichtag und Wissensstand: Die Forderung
 * zählt mit ihrem Nennbetrag, bis sie erfüllt ist (ab der Valuta der Erfüllung steht der Betrag als Rückfluss in den Vorgängen)
 * oder der Verkauf storniert wird.
 */
export async function offeneForderungen(tx: Abfrage, auswahl: { fondsId: string } | { beteiligungId: string }, stichtag: string, stand?: string): Promise<ForderungRoh[]> {
  const { rows } = await tx.execute<ForderungRoh>(sql`
    SELECT f.beteiligung_id, sum(f.betrag)::text AS summe, count(*)::int AS anzahl
    FROM forderung f
    JOIN beteiligung b ON b.id = f.beteiligung_id
    JOIN verkauf v ON v.id = f.verkauf_id
    LEFT JOIN vorgang erfuellung ON erfuellung.id = f.vorgang_id
    WHERE ${"fondsId" in auswahl ? sql`b.fonds_id = ${auswahl.fondsId}` : sql`b.id = ${auswahl.beteiligungId}`} AND v.datum <= ${stichtag}::date${bisStand(sql.raw("f.erstellt_am"), stand)}
      AND (f.storniert_am IS NULL${stand === undefined ? sql`` : sql` OR f.storniert_am > ${stand}::timestamptz`})
      AND NOT (f.erfuellt_am IS NOT NULL AND f.erfuellt_am <= ${stichtag}::date${stand === undefined ? sql`` : sql` AND erfuellung.erfasst_am <= ${stand}::timestamptz`})
    GROUP BY f.beteiligung_id`);
  return rows;
}

async function ladeBeteiligungswerte(tx: Abfrage, fondsId: string, stichtag: string, stand?: string) {
  // Abfrage 1: eine Zeile je Beteiligung, Vorgangssummen bis zum Stichtag, letzte Bewertung bis zum Stichtag.
  // Stornos heben sich durch die Summe auf (Entscheidung 8). Rückflüsse sind Rückflüsse, Tilgungen, gezahlte Zinsen und Dividenden;
  // eine Zinsbuchung (`zins`) ist nur eine Forderung und zählt nicht mit. Buchungen einer Wandlung ohne Geldfluss (Tilgung durch Wandlung,
  // Zusage und Einlage des Ziels) zählen nicht; der Spitzenbetrag schon.
  const { rows: roh } = await tx.execute<BeteiligungRoh>(sql`
    SELECT b.id, o.id AS organisation_id, o.name AS organisation_name, o.sektor,
           b.instrument::text AS instrument, b.status::text AS status, b.erstinvestment::text AS erstinvestment,
           coalesce(sum(v.betrag) FILTER (WHERE v.art = 'zusage' AND NOT ${geldlos("v")}), 0.00)::text AS zusage,
           coalesce(sum(v.betrag) FILTER (WHERE v.art = 'auszahlung' AND NOT ${geldlos("v")}), 0.00)::text AS investiert,
           coalesce(sum(v.betrag) FILTER (WHERE v.art IN ('rueckfluss', 'tilgung', 'zinszahlung', 'dividende') AND NOT ${geldlos("v")}), 0.00)::text AS rueckfluesse,
           max(v.valuta) FILTER (WHERE v.art = 'rueckfluss' AND v.betrag > 0)::text AS exit_valuta,
           bw.id AS bewertung_id, bw.stichtag::text AS bewertung_stichtag, bw.wert::text AS bewertung_wert, bw.methode::text AS bewertung_methode
    FROM beteiligung b
    JOIN organisation o ON o.id = b.organisation_id
    LEFT JOIN vorgang v ON v.beteiligung_id = b.id AND v.valuta <= ${stichtag}::date${bisStand(sql.raw("v.erfasst_am"), stand)}
    LEFT JOIN LATERAL (
      SELECT w.id, w.stichtag, w.wert, w.methode FROM bewertung w
      WHERE w.beteiligung_id = b.id AND w.stichtag <= ${stichtag}::date AND ${wirksameBewertung("w", stand)}
      ORDER BY w.stichtag DESC LIMIT 1
    ) bw ON true
    WHERE b.fonds_id = ${fondsId} AND b.erstinvestment <= ${stichtag}::date
    GROUP BY b.id, o.id, bw.id, bw.stichtag, bw.wert, bw.methode
    ORDER BY o.name, b.id`);

  const wirksam = await ermittleBeteiligungsstatus(tx, { fondsId }, stichtag, stand);
  const portfolio: PortfolioPosition[] = [];
  const zeilen = roh.map((z) => {
    const w = wirksam.get(z.id);
    const status = w?.status ?? z.status;
    const ausgeschieden = status === "exit" && (z.exit_valuta !== null || w?.austritt?.durchVerkauf === true);
    const bewertet = ausgeschieden || z.bewertung_wert === null ? new Decimal(0) : new Decimal(z.bewertung_wert);
    if (z.bewertung_id && z.bewertung_stichtag && !ausgeschieden) portfolio.push({ beteiligungId: z.id, bewertungId: z.bewertung_id, bezeichnung: z.organisation_name, datum: z.bewertung_stichtag, wert: bewertet.toFixed(2) });
    return { z, status, bewertet };
  });
  return { zeilen, portfolio };
}

/** Interne Herkunft mit Bewertungs-IDs, Saldo-IDs und Konten am selben Schnitt wie die Fondsübersicht. */
export async function ladeNavBestandteile(tx: Abfrage, fondsId: string, stichtag: string, stand?: string) {
  const { portfolio } = await ladeBeteiligungswerte(tx, fondsId, stichtag, stand);
  return ermittleNavBestandteile(tx, fondsId, stichtag, stand, portfolio);
}

export async function berechneFondsUebersicht(tx: Pick<Tx, "execute" | "select">, fondsId: string, stichtagVorgabe?: string, stand?: string): Promise<FondsUebersicht> {
  const stichtag = stichtagVorgabe ?? (await standardStichtag(tx, fondsId, stand));

  const { zeilen, portfolio } = await ladeBeteiligungswerte(tx, fondsId, stichtag, stand);
  // Instrumente je Beteiligung (Stammdaten): `instrument` bleibt die Art des Hauptinstruments, `instrumente` nennt alle.
  const { rows: instrumentZeilen } = await tx.execute<{ beteiligung_id: string; id: string; art: string; bezeichnung: string; status: string }>(sql`
    SELECT i.beteiligung_id, i.id, i.art::text AS art, i.bezeichnung, i.status::text AS status
    FROM instrument i JOIN beteiligung b ON b.id = i.beteiligung_id
    WHERE b.fonds_id = ${fondsId}
    ORDER BY i.erstellt_am, i.id`);
  const instrumenteJe = new Map<string, InstrumentKurz[]>();
  for (const i of instrumentZeilen) (instrumenteJe.get(i.beteiligung_id) ?? instrumenteJe.set(i.beteiligung_id, []).get(i.beteiligung_id)!).push({ id: i.id, art: i.art, bezeichnung: i.bezeichnung, status: i.status });

  const kapital = await ladeKapitalstand(tx, fondsId, stichtag, stand);

  const forderungen = await offeneForderungen(tx, { fondsId }, stichtag, stand);
  const beteiligungen: BeteiligungZeile[] = zeilen.map(({ z, status, bewertet }) => {
    const forderung = forderungen.find((f) => f.beteiligung_id === z.id);
    const offen = new Decimal(forderung?.summe ?? 0);
    const wert = bewertet.plus(offen);
    return {
      id: z.id,
      organisation: { id: z.organisation_id, name: z.organisation_name, sektor: z.sektor },
      instrument: z.instrument,
      instrumente: instrumenteJe.get(z.id) ?? [],
      status,
      erstinvestment: z.erstinvestment,
      zusage: z.zusage,
      investiert: z.investiert,
      rueckfluesse: z.rueckfluesse,
      letzteBewertung:
        z.bewertung_stichtag === null || z.bewertung_wert === null || z.bewertung_methode === null
          ? null
          : { stichtag: z.bewertung_stichtag, wert: z.bewertung_wert, methode: z.bewertung_methode },
      offeneForderungen: offen.toFixed(2),
      multiple: alsKennzahl(beteiligungsMultiple(z.investiert, z.rueckfluesse, wert)),
    };
  });

  const abgerufen = new Decimal(kapital.fonds.abgerufen);
  const eingezahlt = new Decimal(kapital.fonds.eingezahlt);
  const abrufe = kapital.bewegungen.filter((b) => b.art === "abruf");
  const verteilungen = kapital.bewegungen.filter((b) => b.art === "ausschuettung");
  const ausschuettungen = verteilungen.reduce((s, b) => s.plus(b.betrag), new Decimal(0));

  const { nav, schritte, portfoliowert } = await ermittleNavBestandteile(tx, fondsId, stichtag, stand, portfolio);
  const m = multiples({ eingezahlt, ausschuettungen, nav });

  const strom: Zahlungsstrom[] = [...kapital.zahlungsstrom];
  if (nav !== null) strom.push({ datum: stichtag, betrag: nav });
  const irr = nav === null ? null : xirr(strom);

  return {
    stichtag,
    portfoliowert: portfoliowert.toFixed(2),
    kennzahlen: {
      abgerufen: {
        wert: abgerufen.toString(),
        schritte: [
          { zeichen: "", bezeichnung: "Anzahl Abrufe bis zum Stichtag", wert: String(abrufe.length) },
          { zeichen: "=", bezeichnung: "Abgerufenes Kapital", wert: abgerufen.toString() },
        ],
      },
      eingezahlt: kapitalKennzahl("Eingezahltes Kapital", kapital.fonds.eingezahlt),
      offen: kapitalKennzahl("Offene Abrufe", kapital.fonds.offen),
      ueberfaellig: kapitalKennzahl("Überfällige Abrufe", kapital.fonds.ueberfaellig),
      ungeklaert: kapitalKennzahl("Ungeklärte Altzahlungen", kapital.fonds.ungeklaert),
      ausschuettungen: {
        wert: ausschuettungen.toString(),
        schritte: [
          { zeichen: "", bezeichnung: "Anzahl Ausschüttungen bis zum Stichtag", wert: String(verteilungen.length) },
          { zeichen: "=", bezeichnung: "Ausschüttungen kumuliert", wert: ausschuettungen.toString() },
        ],
      },
      nav: { wert: nav?.toString() ?? null, schritte },
      tvpi: alsKennzahl(m.tvpi),
      dpi: alsKennzahl(m.dpi),
      rvpi: alsKennzahl(m.rvpi),
      irr: {
        wert: irr === null ? null : irr.toString(),
        schritte: [
          { zeichen: "", bezeichnung: "Anzahl Zahlungseingänge", wert: String(kapital.eingaenge.length) },
          { zeichen: "−", bezeichnung: "Summe Einzahlungen", wert: eingezahlt.toString() },
          { zeichen: "", bezeichnung: "Anzahl Ausschüttungen", wert: String(verteilungen.length) },
          { zeichen: "+", bezeichnung: "Summe Ausschüttungen", wert: ausschuettungen.toString() },
          { zeichen: "+", bezeichnung: `NAV als Endwert am ${stichtag}`, wert: nav?.toString() ?? NAV_LUECKE },
          { zeichen: "=", bezeichnung: "IRR (XIRR, act/365)", wert: irr === null ? NICHT_DEFINIERT : irr.toString() },
        ],
      },
    },
    beteiligungen,
  };
}
