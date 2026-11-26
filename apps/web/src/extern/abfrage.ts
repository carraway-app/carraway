import type { ExterneSprache } from "./texte";

/**
 * Zugriff auf die öffentliche Abfrage-API. Bewusst ohne Hono-Client, Router und Anmeldelogik der Anwendung: einfaches `fetch` ohne Cookies
 * (`credentials: "omit"`), damit eine im selben Browser bestehende Sitzung weder mitgesendet noch benutzt wird.
 */

export type KennzahlTyp = "betrag" | "zahl" | "prozent" | "ja_nein" | "text";

export interface ExterneKennzahl {
  schluessel: string;
  bezeichnungDe: string;
  bezeichnungEn: string;
  einheit: string;
  typ: KennzahlTyp;
  pflicht: boolean;
  wert: string | null;
  kommentar: string | null;
  /** ESG-Datenpunkt: Erläuterung, Fundstelle, Schätzkennzeichen und Quelle werden angezeigt (ältere Antworten ohne diese Felder gelten als gewöhnliche Kennzahl). */
  esg?: boolean;
  regelwerk?: string | null;
  erlaeuterungDe?: string | null;
  erlaeuterungEn?: string | null;
  geschaetzt?: boolean;
  quellenangabe?: string | null;
}

export interface ExterneAbfrage {
  unternehmen: string;
  periodeBeginn: string;
  periodeEnde: string;
  faelligAm: string;
  sprache: ExterneSprache;
  hinweis: string | null;
  /** `esg` = ESG-Fragebogen; ohne Angabe gewöhnliche Kennzahlen. */
  art?: "kennzahlen" | "esg";
  ablauf: string;
  status: "offen" | "eingereicht";
  schreibgeschuetzt: boolean;
  kennzahlen: ExterneKennzahl[];
}

export type ExternerFehler = "link" | "widerrufen" | "abgelaufen" | "zuViele" | "eingereicht" | "pflicht" | "ungueltig" | "allgemein";

export class ExternerApiFehler extends Error {
  constructor(
    readonly art: ExternerFehler,
    readonly fehlend: string[] = [],
  ) {
    super(art);
  }
}

export type Abrufer = typeof fetch;

const anfrage = (...teile: Parameters<typeof import("../api/abbildung-externe-abfrage").externeAnfrage>) =>
  import("../api/abbildung-externe-abfrage").then((m) => m.externeAnfrage(...teile));

export const ladeAbfrage = (abrufer: Abrufer, token: string) => anfrage(abrufer, token, "GET", "");
export interface EntwurfsWert {
  schluessel: string;
  typ?: KennzahlTyp;
  wert: string | null;
  kommentar: string | null;
  /** Nur für ESG-Datenpunkte. */
  geschaetzt?: boolean;
  quellenangabe?: string | null;
}
export const speichereEntwurf = (abrufer: Abrufer, token: string, werte: EntwurfsWert[]) =>
  anfrage(abrufer, token, "PUT", "", {
    werte: werte.map(({ typ, wert, ...eintrag }) => ({ ...eintrag, wert: typ === "ja_nein" && wert !== null ? (wert === "ja" ? "yes" : "no") : wert })),
  });
export const reicheEin = (abrufer: Abrufer, token: string) => anfrage(abrufer, token, "POST", "/submit", {});

// Eingabe und Anzeige von Zahlen --------------------------------------------------------------------------------------

export type WertFehler = "betrag" | "zahl" | "jaNein" | "text" | "wert";

const BETRAG = /^-?\d{1,16}(\.\d{1,2})?$/;
const ZAHL = /^-?\d{1,16}(\.\d{1,4})?$/;

/**
 * Eingabe einer Person als kanonischer Text für die API. Deutsch: Dezimalkomma (Punkte nur als Tausendertrenner, wenn ein Komma folgt),
 * Englisch: Dezimalpunkt (Kommas nur als Tausendertrenner). Mehrdeutiges („1.234“ auf Deutsch) wird abgelehnt statt geraten.
 */
export function parseWert(typ: KennzahlTyp, roh: string, sprache: ExterneSprache): { wert: string } | { fehler: WertFehler } {
  const eingabe = roh.trim();
  if (typ === "ja_nein") return eingabe === "ja" || eingabe === "nein" ? { wert: eingabe } : { fehler: "jaNein" };
  if (typ === "text") return eingabe.length === 0 || eingabe.length > 2000 ? { fehler: "text" } : { wert: eingabe };
  const fehler: WertFehler = typ === "betrag" ? "betrag" : "zahl";
  let zahl = eingabe.replace(/[\s\u00a0\u202f]/g, "");
  if (sprache === "de") {
    if (zahl.includes(",")) {
      if (!/^-?\d{1,3}(\.\d{3})*,\d+$|^-?\d+,\d+$/.test(zahl)) return { fehler };
      zahl = zahl.replace(/\./g, "").replace(",", ".");
    } else if (/^-?\d{1,3}(\.\d{3})+$/.test(zahl)) return { fehler };
  } else if (zahl.includes(",")) {
    if (!/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(zahl)) return { fehler };
    zahl = zahl.replace(/,/g, "");
  }
  if (!(typ === "betrag" ? BETRAG : ZAHL).test(zahl)) return { fehler };
  return { wert: zahl };
}

/** Kanonischer Wert der API für das Eingabefeld (Deutsch mit Dezimalkomma). */
export const wertFuerFeld = (typ: KennzahlTyp, wert: string | null, sprache: ExterneSprache): string => (wert === null ? "" : typ === "betrag" || typ === "zahl" || typ === "prozent" ? (sprache === "de" ? wert.replace(".", ",") : wert) : wert);

const LOCALE: Record<ExterneSprache, string> = { de: "de-DE", en: "en-GB" };

/** Anzeige eines gespeicherten Wertes (nur lesen). */
export function anzeigeWert(typ: KennzahlTyp, wert: string, sprache: ExterneSprache, ja: string, nein: string): string {
  if (typ === "ja_nein") return wert === "ja" ? ja : nein;
  if (typ === "text") return wert;
  const zahl = new Intl.NumberFormat(LOCALE[sprache], { minimumFractionDigits: typ === "betrag" ? 2 : 0, maximumFractionDigits: typ === "betrag" ? 2 : 4 }).format(wert as unknown as number);
  return typ === "prozent" ? (sprache === "de" ? `${zahl} %` : `${zahl}%`) : zahl;
}

export function formatDatum(iso: string, sprache: ExterneSprache): string {
  const [j, m, t] = iso.slice(0, 10).split("-");
  return sprache === "de" ? `${t}.${m}.${j}` : `${t}/${m}/${j}`;
}

/** Zeitraum als Anzeige: Jahr, Quartal oder Monat sind beim Anlegen geprüft; hier genügt Beginn bis Ende. */
export const zeitraumAnzeige = (beginn: string, ende: string, sprache: ExterneSprache) => `${formatDatum(beginn, sprache)} – ${formatDatum(ende, sprache)}`;
