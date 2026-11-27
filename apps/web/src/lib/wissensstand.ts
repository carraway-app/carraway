import { formatDatum, type Sprache } from "@carraway/ui";
import { formatZeitpunkt, standAusUrl } from "./zeit";

/*
 * Wissensstand als Datum (Stichtag-Menü). Eigenes Modul, damit der Start (Router) nur `zeit.ts` lädt.
 */

const zwei = (n: number) => String(n).padStart(2, "0");

/** Zeitzone, in der ein Wissensstand als Datum gemeint ist („bis Ende dieses Tages“). */
export const WISSENSSTAND_ZONE = "Europe/Berlin";

const teileIn = (zeit: number, zone: string) => {
  const teile = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(zeit));
  const wert = (art: string) => Number(teile.find((t) => t.type === art)?.value);
  return { jahr: wert("year"), monat: wert("month"), tag: wert("day"), stunde: wert("hour"), minute: wert("minute"), sekunde: wert("second") };
};

/** Versatz der Zone zu UTC in Millisekunden zum Zeitpunkt `zeit` (unabhängig von der Zeitzone des Browsers). */
function versatz(zeit: number, zone: string): number {
  const t = teileIn(zeit, zone);
  return Date.UTC(t.jahr, t.monat - 1, t.tag, t.stunde, t.minute, t.sekunde) - Math.floor(zeit / 1000) * 1000;
}

/**
 * Wissensstand aus einem Datum: das Ende dieses Tages in `Europe/Berlin` als UTC-Zeitpunkt auf die Mikrosekunde
 * (`2026-09-30` → `2026-09-30T21:59:59.999999Z`). Umstellungstage der Sommerzeit haben 23 bzw. 25 Stunden. Ungültige Eingaben liefern `undefined`.
 */
export function endeDesTages(datum: string | undefined, zone = WISSENSSTAND_ZONE): string | undefined {
  const m = datum?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return undefined;
  // Mitternacht des Folgetags in der Zone; der Versatz wird am gefundenen Zeitpunkt noch einmal geprüft (Umstellung in der Nacht).
  const folgetag = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1);
  if (Number.isNaN(folgetag)) return undefined;
  const geschaetzt = folgetag - versatz(folgetag, zone);
  const zeit = folgetag - versatz(geschaetzt, zone);
  return new Date(zeit - 1).toISOString().replace(/\.(\d{3})Z$/, ".$1999Z");
}

/** Das Datum (Europe/Berlin) eines Wissensstands für das Datumsfeld; ältere Links mit genauer Uhrzeit zeigen ihren Tag. */
/**
 * Wissensstand aus einem Datumsfeld für eine Anlage (Bericht, Meldelauf): ein früherer Tag wird zu dessen Tagesende, heute bedeutet
 * „jetzt“ (kein Wert), ein späterer Tag ist ungültig (`"zukunft"`).
 */
export function standAusDatum(datum: string | undefined, jetzt = new Date()): string | undefined | "zukunft" {
  if (!datum) return undefined;
  const heute = datumDesStands(jetzt.toISOString());
  if (datum > heute) return "zukunft";
  return datum === heute ? undefined : endeDesTages(datum);
}

export function datumDesStands(stand: string | undefined, zone = WISSENSSTAND_ZONE): string {
  if (!stand) return "";
  const zeit = new Date(stand).getTime();
  if (Number.isNaN(zeit)) return "";
  const t = teileIn(zeit, zone);
  return `${t.jahr}-${zwei(t.monat)}-${zwei(t.tag)}`;
}

/** `true`, wenn der Wissensstand genau das Ende eines Tages ist (dann genügt das Datum in der Anzeige). */
export function istTagesende(stand: string | undefined, zone = WISSENSSTAND_ZONE): boolean {
  const ende = endeDesTages(datumDesStands(stand, zone), zone);
  return ende !== undefined && ende === standAusUrl(stand);
}

/** Wissensstand für Anzeigen: das Datum, wenn er das Ende eines Tages ist (so setzt ihn das Stichtag-Menü), sonst Datum und Uhrzeit. */
export function formatWissensstand(stand: string, sprache: Sprache): string {
  return istTagesende(stand) ? formatDatum(datumDesStands(stand), sprache) : formatZeitpunkt(stand, sprache);
}
