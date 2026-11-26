import { sql } from "drizzle-orm";
import { Decimal, MAX_KURSALTER_TAGE, faktorAlsZahl, konvertiere, waehleKurs, type Kursauswahl, type Umrechnungsfaktor, type Wechselkurs } from "@carraway/rechenkern";
import { feldArray } from "../crm/felder";
import { Fachfehler } from "../fehler";
import type { Tx } from "../zeitlimit";

/**
 * Zugriff auf die Kurstabelle (Etappe 21). Die Tabelle ist nur anhängend; gültig ist je Tag und Paar der jüngste Eintrag bis zum Wissensstand. Die Wahl des Kurses
 * zu einem Tag und die Umrechnung stehen im Rechenkern (`waehrung.ts`); hier wird nur geladen. Es gibt keinen Abruf aus dem Netz: Kurse kommen von Hand oder aus einer Datei.
 */

export interface KursZeile extends Wechselkurs {
  id: string;
}

/** Wissensstand als Bedingung: Einträge, die bis einschließlich `stand` erfasst wurden. */
const bis = (stand: string | undefined) => (stand === undefined ? sql`` : sql` AND erfasst_am <= ${stand}::timestamptz`);

/**
 * Die gültigen Kurse im Fenster `von` bis `bis` (je Tag und Paar der jüngste Eintrag bis zum Wissensstand). `paare` schränkt auf Währungen ein: Ein Eintrag zählt,
 * wenn Basis oder Quote darin vorkommt.
 */
export async function ladeGueltigeKurse(tx: Tx, von: string, bisTag: string, opts: { stand?: string | undefined; waehrungen?: readonly string[] } = {}): Promise<KursZeile[]> {
  const w = opts.waehrungen?.length ? sql` AND (basis = ANY(${feldArray(opts.waehrungen, "text")}) OR quote = ANY(${feldArray(opts.waehrungen, "text")}))` : sql``;
  const { rows } = await tx.execute<{ id: string; datum: string; basis: string; quote: string; kurs: string }>(sql`
    SELECT DISTINCT ON (datum, basis, quote) id, datum::text AS datum, basis, quote, kurs::text AS kurs
    FROM wechselkurs
    WHERE datum >= ${von}::date AND datum <= ${bisTag}::date${bis(opts.stand)}${w}
    ORDER BY datum, basis, quote, erfasst_am DESC, id DESC`);
  return rows.map((r) => ({ id: r.id, datum: r.datum, basis: r.basis, quote: r.quote, kurs: normalisiere(r.kurs) }));
}

/** Kurse ohne nachgestellte Nullen (`1.08500000` → `1.085`). */
const normalisiere = (kurs: string) => new Decimal(kurs).toFixed();

const tagePlus = (datum: string, tage: number) => new Date(Date.parse(`${datum}T00:00:00Z`) + tage * 86_400_000).toISOString().slice(0, 10);

/** So weit zurück werden Kurse geladen: länger als das Höchstalter, damit eine Lücke „veraltet“ den letzten vorhandenen Kurs nennen kann. */
export const RUECKBLICK_TAGE = 90;

/** Fenster, das für Umrechnungen an den Tagen `daten` genügt. */
export function kursFenster(daten: readonly string[], maxAlter = RUECKBLICK_TAGE): { von: string; bis: string } | null {
  if (daten.length === 0) return null;
  const sortiert = [...daten].sort();
  return { von: tagePlus(sortiert[0]!, -maxAlter), bis: sortiert[sortiert.length - 1]! };
}

/** Der Weg und Faktor von `von` nach `nach` für einen Tag, geladen aus der Tabelle (für Einzelfälle; viele Tage laden das Fenster einmal und rufen `waehleKurs`). */
export async function kursFuer(tx: Tx, von: string, nach: string, datum: string, stand?: string): Promise<Kursauswahl> {
  if (von === nach) return waehleKurs([], von, nach, datum);
  const f = kursFenster([datum])!;
  const kurse = await ladeGueltigeKurse(tx, f.von, f.bis, { stand, waehrungen: [von, nach, "EUR"] });
  return waehleKurs(kurse, von, nach, datum);
}

/** Wie `kursFuer`, aber eine Lücke ist ein Fehler: 409 `rate_missing` mit Paar, Tag und Grund. Es wird nie ein Kurs geraten. */
export async function verlangeKurs(tx: Tx, von: string, nach: string, datum: string, stand?: string): Promise<Umrechnungsfaktor> {
  const w = await kursFuer(tx, von, nach, datum, stand);
  if (!w.ok) {
    throw new Fachfehler(409, "rate_missing", `No sufficiently recent exchange rate is available for ${w.luecke.von}/${w.luecke.nach} as of ${datum}.`, {
      von: w.luecke.von,
      nach: w.luecke.nach,
      stichtag: datum,
      grund: w.luecke.grund,
      letzterKursDatum: w.luecke.letzterKursDatum,
      hoechstalterTage: MAX_KURSALTER_TAGE,
    });
  }
  return w.faktor;
}

/** Ergebnis einer Umrechnung mit dem festzuhaltenden Kurs (Fondswährung je lokaler Einheit). */
export interface FestgehaltenerKurs {
  /** Betrag in der Fondswährung. */
  fonds: string;
  /** Kurs, Fondswährung je 1 Einheit lokal, höchstens zwölf Nachkommastellen. */
  kurs: string;
  /** Kurseintrag der Tabelle, wenn genau einer zugrunde liegt (direkt oder invers); sonst leer. */
  kursId: string | null;
}

/**
 * Hält den lokalen Betrag einer Zahlung oder Bewertung mit dem Kurs fest. Ohne Fondsbetrag rechnet sie zum Kurs des Tages aus der Tabelle (Lücke = 409 `rate_missing`);
 * mit Fondsbetrag gilt der gebuchte Betrag, der Kurs ist dann der daraus abgeleitete (Fondsbetrag ÷ lokaler Betrag). Der Fondsbetrag bleibt in beiden Fällen der gebuchte Betrag.
 */
export async function haltKursFest(tx: Tx, e: { lokal: string; fonds: string | undefined; lokaleWaehrung: string; fondsWaehrung: string; datum: string }): Promise<FestgehaltenerKurs> {
  if (e.fonds !== undefined) {
    const lokal = new Decimal(e.lokal);
    if (lokal.isZero()) throw new Fachfehler(400, "invalid_input", "The input is invalid.", { felder: [{ feld: "betragLokal", code: "zero_not_allowed", meldung: "The local amount must not be zero" }] });
    const kurs = new Decimal(e.fonds).div(lokal);
    if (kurs.isNegative() || kurs.isZero()) throw new Fachfehler(400, "invalid_input", "The input is invalid.", { felder: [{ feld: "betragLokal", code: "invalid_sign", meldung: "Local amount and fund amount must have the same sign" }] });
    return { fonds: new Decimal(e.fonds).toFixed(2), kurs: kurs.toDecimalPlaces(12, Decimal.ROUND_HALF_UP).toFixed(), kursId: null };
  }
  // Fondswährung je lokaler Einheit: von lokal nach Fonds.
  const faktor = await verlangeKurs(tx, e.lokaleWaehrung, e.fondsWaehrung, e.datum);
  return {
    fonds: konvertiere(e.lokal, faktor).toFixed(2),
    kurs: faktorAlsZahl(faktor, 12),
    kursId: faktor.stuetzstellen.length === 1 ? await kursIdZu(tx, faktor) : null,
  };
}

async function kursIdZu(tx: Tx, faktor: Umrechnungsfaktor): Promise<string | null> {
  const s = faktor.stuetzstellen[0]!;
  const { rows } = await tx.execute<{ id: string }>(sql`SELECT id FROM wechselkurs WHERE datum = ${s.datum}::date AND basis = ${s.basis} AND quote = ${s.quote} ORDER BY erfasst_am DESC, id DESC LIMIT 1`);
  return rows[0]?.id ?? null;
}
