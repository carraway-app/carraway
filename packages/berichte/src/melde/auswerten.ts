import { Decimal, kpiVerdichte, type Rechenschritt } from "@carraway/rechenkern";
import type { Abschnitt, DefinitionInhalt, Feld, Feldformat, Filter, Gruppierung, Mittelart, Quelle } from "./definition";
import { MITTELARTEN, ZAHLEN } from "./definition";
import { S } from "./schritte";

/**
 * Auswertung einer Meldedefinition: Aus den geladenen Daten eines Fonds (Beteiligungen mit Vorgängen, Bewertungen, Kennzahlen und
 * Förder- und Buchhaltungsschlüsseln, Mittelherkunft) werden alle Werte der Definition berechnet, jeder mit seiner Herkunft. Reine Funktionen ohne Datenbank; das Laden
 * zu Stichtag und Wissensstand macht die API (`apps/api/src/melde/quellen.ts`). Ein fehlender Wert ist `null` („k. A.“), nie 0.
 */

export type Vorgangsart = "zusage" | "auszahlung" | "rueckfluss" | "zins" | "tilgung" | "wertberichtigung" | "zinszahlung" | "dividende" | "impairment_disposal" | "principal_disposal" | "interest_waiver";

export interface VorgangZeile {
  id: string;
  art: Vorgangsart;
  valuta: string;
  betrag: string;
  kapitalisiert: boolean;
  storniertVorgangId: string | null;
  /** Buchung einer Wandlung ohne Geldfluss (Tilgung durch Wandlung, Zusage und Einlage des Ziels): zählt nicht als Auszahlung oder Rückfluss und nicht zur Zusage; Buchwert und Position bleiben unberührt. */
  ohneGeldfluss?: boolean;
  /**
   * Anteile des Betrags je Meldeart: Der Betrag wird nach den Quoten der Mittelarten des Fonds am Valuta aufgeteilt (auf den Cent, größter Rest).
   * Mittelarten ohne Meldeart zählen in keiner Kategorie. Fehlt das Feld, hat der Fonds am Valuta keine Mittelarten.
   */
  anteile?: Partial<Record<Mittelart, string>>;
}

/** Ein geltender (bestätigter, zum Wissensstand gültiger) Kennzahlenwert. */
export interface KennzahlPunkt {
  id: string;
  schluessel: string;
  szenario: "ist" | "plan";
  periodeBeginn: string;
  periodeEnde: string;
  wert: string;
}

export interface BeteiligungDaten {
  id: string;
  organisationId: string;
  organisationName: string;
  sektor: string | null;
  /** NACE-Abschnitt der Organisation (Etappe 16); fehlt in älteren Quellen. */
  nace?: string | null;
  ort: string | null;
  sitzland: string | null;
  region: string | null;
  instrument: string;
  status: string;
  erstinvestment: string;
  programm: { schluessel: string; bezeichnung: string } | null;
  /** Nur in der anteiligen Sicht (siehe `anteilig`): die Meldearten, auf die sich die Beträge beschränken. */
  auswahl?: Mittelart[];
  projektnummer: string | null;
  vertragsnummer: string | null;
  partnernummer: string | null;
  buchungskreis: string | null;
  /** Vorgänge bis zum Ende des Berichtszeitraums (nach Wissensstand). */
  vorgaenge: VorgangZeile[];
  /** Letzte wirksame Bewertung bis zum Stichtag. */
  bewertung: { wert: string; stichtag: string } | null;
  /** Mit Rückfluss ausgeschieden (Status Exit): zählt mit 0 zum Wertansatz. */
  ausgeschieden: boolean;
  offeneForderungen: string;
  buchwertAbgang: string;
  kennzahlen: KennzahlPunkt[];
}

export interface FondsDaten {
  name: string;
  kurzname: string;
  vintage: number;
  zeichnungskapital: string;
  waehrung: string;
  bewegungen: { id: string; art: "abruf" | "ausschuettung"; valuta: string; betrag: string }[];
}

export type KennzahlVerdichtung = "summe" | "stand" | "durchschnitt";

export interface AuswertungsEingabe {
  definition: DefinitionInhalt;
  fonds: FondsDaten;
  /** Förderprogramm des Laufs (Filter über alle Abschnitte), sonst `null`. */
  programm: { schluessel: string; bezeichnung: string } | null;
  periode: { beginn: string; ende: string; kennung: string };
  beteiligungen: BeteiligungDaten[];
  /**
   * Summe der Quoten je Meldeart am Ende des Zeitraums. Stichtagswerte ohne Datum (Bewertung, offene Forderungen, Buchwertabgang) werden mit
   * dieser Quote auf die Meldeart verteilt (je Beteiligung auf den Cent gerundet); Vorgänge tragen ihre Anteile selbst (`VorgangZeile.anteile`).
   */
  mittelartQuoten?: Partial<Record<Mittelart, string>>;
  /** Programme für die Gruppierung (Bezeichnungen). */
  programme: { schluessel: string; bezeichnung: string }[];
  /** Verdichtung der Katalogkennzahlen je Schlüssel, wenn ein Zeitraum mehrere Werte enthält. */
  kennzahlVerdichtung: Record<string, KennzahlVerdichtung>;
  /** Eingaben von Hand je Wertschlüssel (`abschnitt.feld`). */
  manuell: Record<string, string | null>;
}

export interface Herkunft {
  schritte: Rechenschritt[];
  /** Angewendete Filter in der Reihenfolge Lauf, Definition, Abschnitt, Feld. */
  filter: Filter[];
  beteiligungen: string[];
  vorgaenge: string[];
  kennzahlWerte: string[];
  bewegungen: string[];
  /** Bei berechneten Werten: die Operanden mit ihrem Verweis. */
  operanden?: { ref: string; wert: string | null }[];
}

export interface Wert {
  /** `abschnitt.feld`, `abschnitt.zeile.spalte`, `abschnitt._summe.spalte` oder `abschnitt.zeile._zeile` (Beschriftung der Zeile). */
  schluessel: string;
  art: Quelle["art"] | "zeile";
  /** Stelle in der Berechnung; ordnet Zeilen und Spalten beim Wiederaufbau aus gespeicherten Werten. */
  reihenfolge: number;
  wert: string | null;
  herkunft: Herkunft | null;
  manuell: boolean;
}

export interface FeldAnzeige {
  id: string;
  schluessel: string;
  wert: string | null;
}

export interface ZeileAusgabe {
  schluessel: string;
  /** Beschriftung der Zeile (Organisation, Programm, …) für die Anzeige der Zeilenköpfe; `null` bei der Gruppe „ohne Zuordnung“. */
  bezeichnung: string | null;
  gruppeOhne: boolean;
  zellen: Record<string, FeldAnzeige>;
}

export type AbschnittErgebnis =
  | { id: string; typ: "felder"; felder: FeldAnzeige[] }
  | { id: string; typ: "tabelle"; je: Gruppierung; zeilen: ZeileAusgabe[]; summen: Record<string, FeldAnzeige> | null };

export interface Auswertung {
  abschnitte: AbschnittErgebnis[];
  werte: Wert[];
}

// Zahlenformate ---------------------------------------------------------------------------------------------------

const ISTZAHL = /^-?\d+(\.\d+)?$/;

/** Kanonische Zeichenkette zum Format: Betrag mit zwei Stellen, Ganzzahl ohne, sonst bis zu sechs Stellen ohne Nullen am Ende. */
export function kanonisch(d: Decimal, format: Feldformat): string {
  if (format === "betrag") return d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
  if (format === "ganzzahl") return d.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0);
  return d.toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed();
}

const dec = (s: string) => new Decimal(s);
const summe = (liste: string[]) => liste.reduce((s, x) => s.plus(x), new Decimal(0));
const leereHerkunft = (filter: Filter[]): Herkunft => ({ schritte: [], filter, beteiligungen: [], vorgaenge: [], kennzahlWerte: [], bewegungen: [] });

// Filter ----------------------------------------------------------------------------------------------------------

function passtZumFilter(b: BeteiligungDaten, f: Filter): boolean {
  if (f.foerderprogramm && !(b.programm && f.foerderprogramm.includes(b.programm.schluessel))) return false;
  if (f.instrument && !f.instrument.includes(b.instrument as never)) return false;
  if (f.sitzland && !(b.sitzland && f.sitzland.includes(b.sitzland))) return false;
  if (f.region && !(b.region && f.region.includes(b.region))) return false;
  if (f.branche && !(b.sektor && f.branche.includes(b.sektor))) return false;
  if (f.nace && !(b.nace && f.nace.includes(b.nace))) return false;
  if (f.status && !f.status.includes(b.status as never)) return false;
  return true;
}

// Mittelarten -----------------------------------------------------------------------------------------------------

/** Schnitt der Meldearten aller Filter, die welche nennen; `null`, wenn kein Filter die Mittelart einschränkt. */
function effektiveArten(filter: Filter[]): Mittelart[] | null {
  let arten: Mittelart[] | null = null;
  for (const f of filter) {
    if (!f.mittelart) continue;
    const liste = f.mittelart as Mittelart[];
    arten = arten ? arten.filter((a) => liste.includes(a)) : [...liste];
  }
  return arten;
}

const ursprung = new WeakMap<BeteiligungDaten, BeteiligungDaten>();
const anteilSumme = (anteile: VorgangZeile["anteile"], arten: Mittelart[]): Decimal => arten.reduce((s, a) => s.plus(anteile?.[a] ?? 0), new Decimal(0));

/**
 * Anteilige Sicht einer Beteiligung auf die gewählten Meldearten: Vorgänge mit ihrem Anteil am Betrag (Vorgänge ohne Anteil entfallen, auch
 * ein Storno fällt mit seinem Original heraus), Bewertung, offene Forderungen und Buchwertabgang mit der Stichtagsquote. Eine weitere
 * Einschränkung schneidet mit der bisherigen Auswahl, nie mit dem Ganzen.
 */
function anteilig(b: BeteiligungDaten, arten: Mittelart[], quoten: Partial<Record<Mittelart, string>> | undefined): BeteiligungDaten {
  const o = ursprung.get(b) ?? b;
  const auswahl = b.auswahl ? b.auswahl.filter((a) => arten.includes(a)) : arten;
  const quote = anteilSumme(quoten, auswahl);
  const stichtag = (w: string) => new Decimal(w).times(quote).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
  const sicht: BeteiligungDaten = {
    ...o,
    auswahl,
    vorgaenge: o.vorgaenge.map((v) => ({ ...v, betrag: anteilSumme(v.anteile, auswahl).toFixed(2) })).filter((v) => !new Decimal(v.betrag).isZero()),
    bewertung: o.bewertung ? { ...o.bewertung, wert: stichtag(o.bewertung.wert) } : null,
    offeneForderungen: stichtag(o.offeneForderungen),
    buchwertAbgang: stichtag(o.buchwertAbgang),
  };
  ursprung.set(sicht, o);
  return sicht;
}

/** Hat die Sicht überhaupt Beträge in den gewählten Meldearten? Sonst gehört die Beteiligung nicht zur Mittelart. */
const hatAnteil = (b: BeteiligungDaten): boolean => b.vorgaenge.length > 0 || (b.bewertung !== null && !new Decimal(b.bewertung.wert).isZero()) || !new Decimal(b.offeneForderungen).isZero() || !new Decimal(b.buchwertAbgang).isZero();

/** Meldearten, in denen die Beteiligung Beträge hat (Vorgänge bis zum Ende des Zeitraums). */
const artenMitAnteil = (b: BeteiligungDaten): Mittelart[] => MITTELARTEN.filter((a) => (ursprung.get(b) ?? b).vorgaenge.some((v) => !new Decimal(v.anteile?.[a] ?? 0).isZero()));

/** Beschränkt die Beteiligungen auf die Meldearten der Filter (anteilige Sicht); ohne Mittelart in den Filtern bleibt alles unverändert. */
function mitMittelart(bs: BeteiligungDaten[], filter: Filter[], e: AuswertungsEingabe): BeteiligungDaten[] {
  const arten = effektiveArten(filter);
  return arten ? bs.map((b) => anteilig(b, arten, e.mittelartQuoten)).filter(hatAnteil) : bs;
}

export function filterBeschreibung(f: Filter): string {
  return Object.entries(f)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${(v as string[]).join(",")}`)
    .join("; ");
}

const nichtLeer = (f: Filter | undefined): f is Filter => f !== undefined && Object.values(f).some((v) => v !== undefined);

// Quellen ---------------------------------------------------------------------------------------------------------

interface Kontext {
  eingabe: AuswertungsEingabe;
  /** Beteiligungen, auf die sich der Wert bezieht (nach Filtern und Gruppe). */
  beteiligungen: BeteiligungDaten[];
  filter: Filter[];
  /** In Tabellen: die Gruppe der Zeile (für `gruppe.*`). */
  gruppe?: { schluessel: string; bezeichnung: string | null; ohne: boolean };
}

interface Ergebnis {
  wert: string | null;
  herkunft: Herkunft;
}

function kopf(k: Kontext): Herkunft {
  const h = leereHerkunft(k.filter);
  h.beteiligungen = k.beteiligungen.map((b) => b.id);
  if (k.filter.length) h.schritte.push({ zeichen: "", bezeichnung: S.filter, wert: k.filter.map(filterBeschreibung).join(" UND ") });
  h.schritte.push({ zeichen: "", bezeichnung: S.beteiligungenImFilter, wert: String(k.beteiligungen.length), quellen: h.beteiligungen });
  return h;
}

/** Nicht überlappende Werte im Zeitraum: die gröbsten zuerst (Quartal vor Monaten), damit nichts doppelt zählt. */
function nichtUeberlappend(punkte: KennzahlPunkt[]): KennzahlPunkt[] {
  const sortiert = [...punkte].sort((a, b) => {
    const spanA = Date.parse(a.periodeEnde) - Date.parse(a.periodeBeginn);
    const spanB = Date.parse(b.periodeEnde) - Date.parse(b.periodeBeginn);
    return spanB - spanA || a.periodeBeginn.localeCompare(b.periodeBeginn) || a.id.localeCompare(b.id);
  });
  const gewaehlt: KennzahlPunkt[] = [];
  for (const p of sortiert) if (!gewaehlt.some((g) => p.periodeBeginn <= g.periodeEnde && g.periodeBeginn <= p.periodeEnde)) gewaehlt.push(p);
  return gewaehlt.sort((a, b) => a.periodeBeginn.localeCompare(b.periodeBeginn));
}

function kennzahlJeBeteiligung(b: BeteiligungDaten, q: Extract<Quelle, { art: "kennzahl" }>, k: Kontext): { wert: string; ids: string[] } | null {
  const { beginn, ende } = k.eingabe.periode;
  const kandidaten = b.kennzahlen.filter((p) => p.schluessel === q.schluessel && p.szenario === q.szenario);
  if (q.zeitraum === "letzter") {
    const bis = kandidaten.filter((p) => p.periodeEnde <= ende);
    const letzter = [...bis].sort((a, c) => c.periodeEnde.localeCompare(a.periodeEnde) || Date.parse(c.periodeEnde) - Date.parse(c.periodeBeginn) - (Date.parse(a.periodeEnde) - Date.parse(a.periodeBeginn)) || a.id.localeCompare(c.id))[0];
    return letzter ? { wert: letzter.wert, ids: [letzter.id] } : null;
  }
  const imZeitraum = nichtUeberlappend(kandidaten.filter((p) => p.periodeBeginn >= beginn && p.periodeEnde <= ende));
  if (imZeitraum.length === 0) return null;
  if (imZeitraum.length === 1) return { wert: imZeitraum[0]!.wert, ids: [imZeitraum[0]!.id] };
  const ids = imZeitraum.map((p) => p.id);
  if (!imZeitraum.every((p) => ISTZAHL.test(p.wert))) return { wert: imZeitraum[imZeitraum.length - 1]!.wert, ids };
  const verdichtet = kpiVerdichte(k.eingabe.kennzahlVerdichtung[q.schluessel] ?? "summe", imZeitraum);
  return verdichtet.wert ? { wert: verdichtet.wert.toString(), ids } : null;
}

function auswerteKennzahl(q: Extract<Quelle, { art: "kennzahl" }>, format: Feldformat, k: Kontext): Ergebnis {
  const h = kopf(k);
  h.schritte.push({ zeichen: "", bezeichnung: S.kennzahl, wert: q.schluessel }, { zeichen: "", bezeichnung: S.szenario, wert: q.szenario });
  h.schritte.push({ zeichen: "", bezeichnung: S.zeitraumKennzahl, wert: q.zeitraum === "letzter" ? `bis ${k.eingabe.periode.ende}` : `${k.eingabe.periode.beginn} bis ${k.eingabe.periode.ende}` });
  const treffer: { b: BeteiligungDaten; wert: string; ids: string[] }[] = [];
  for (const b of k.beteiligungen) {
    const t = kennzahlJeBeteiligung(b, q, k);
    if (t) treffer.push({ b, ...t });
  }
  // Rechnende Aggregationen brauchen Zahlen; Ja/Nein-Werte zählen nur `anzahl` und `anzahl_ja`.
  const zaehlend = q.aggregation === "anzahl" || q.aggregation === "anzahl_ja";
  const verwendbar = zaehlend ? treffer : treffer.filter((t) => ISTZAHL.test(t.wert));
  h.kennzahlWerte = verwendbar.flatMap((t) => t.ids);
  h.schritte.push({ zeichen: "", bezeichnung: S.mitWert, wert: String(verwendbar.length), quellen: verwendbar.map((t) => t.b.id) });
  h.schritte.push({ zeichen: "", bezeichnung: S.ohneWert, wert: String(k.beteiligungen.length - verwendbar.length) });
  const werte = verwendbar.map((t) => t.wert);
  let ergebnis: Decimal | null;
  switch (q.aggregation) {
    case "summe":
      ergebnis = werte.length ? summe(werte) : null;
      if (ergebnis) h.schritte.push({ zeichen: "=", bezeichnung: S.summeBeteiligungen, wert: ergebnis.toString() });
      break;
    case "durchschnitt":
      ergebnis = werte.length ? summe(werte).div(werte.length) : null;
      if (ergebnis) h.schritte.push({ zeichen: "=", bezeichnung: S.durchschnittBeteiligungen, wert: ergebnis.toString() });
      break;
    case "minimum":
      ergebnis = werte.length ? Decimal.min(...werte) : null;
      if (ergebnis) h.schritte.push({ zeichen: "=", bezeichnung: S.minimumBeteiligungen, wert: ergebnis.toString() });
      break;
    case "maximum":
      ergebnis = werte.length ? Decimal.max(...werte) : null;
      if (ergebnis) h.schritte.push({ zeichen: "=", bezeichnung: S.maximumBeteiligungen, wert: ergebnis.toString() });
      break;
    case "anzahl":
      ergebnis = new Decimal(werte.length);
      h.schritte.push({ zeichen: "=", bezeichnung: S.anzahlMitWert, wert: ergebnis.toString() });
      break;
    case "anzahl_ja":
      ergebnis = new Decimal(werte.filter((w) => w === "ja").length);
      h.schritte.push({ zeichen: "=", bezeichnung: S.anzahlJa, wert: ergebnis.toString() });
      break;
  }
  if (!ergebnis) h.schritte.push({ zeichen: "=", bezeichnung: S.keinWert, wert: "" });
  return { wert: ergebnis ? kanonisch(ergebnis, format) : null, herkunft: h };
}

/** Gültige Vorgänge: weder ein Storno noch ein stornierter Vorgang. */
function gueltigeVorgaenge(b: BeteiligungDaten): VorgangZeile[] {
  const aufgehoben = new Set<string>();
  for (const v of b.vorgaenge) {
    if (!v.storniertVorgangId) continue;
    aufgehoben.add(v.id);
    aufgehoben.add(v.storniertVorgangId);
  }
  return b.vorgaenge.filter((v) => !aufgehoben.has(v.id));
}

const imZeitraum = (valuta: string, zeitraum: "periode" | "kumuliert", p: { beginn: string; ende: string }) => valuta <= p.ende && (zeitraum === "kumuliert" || valuta >= p.beginn);

function auswerteVorgang(q: Extract<Quelle, { art: "vorgang" }>, format: Feldformat, k: Kontext): Ergebnis {
  const h = kopf(k);
  const p = k.eingabe.periode;
  h.schritte.push({ zeichen: "", bezeichnung: S.vorgangsarten, wert: q.vorgangsarten.join(", ") });
  h.schritte.push({ zeichen: "", bezeichnung: S.zeitraumVorgaenge, wert: q.zeitraum === "kumuliert" ? `bis ${p.ende}` : `${p.beginn} bis ${p.ende}` });
  const zeilen = k.beteiligungen.flatMap((b) => b.vorgaenge.filter((v) => !v.ohneGeldfluss && q.vorgangsarten.some((art) => art === v.art) && imZeitraum(v.valuta, q.zeitraum, p)));
  h.vorgaenge = zeilen.map((v) => v.id);
  h.schritte.push({ zeichen: "", bezeichnung: S.anzahlVorgaenge, wert: String(zeilen.length), quellen: h.vorgaenge });
  let wert: Decimal;
  if (q.aggregation === "anzahl") {
    const gueltig = k.beteiligungen.flatMap((b) => {
      const ok = new Set(gueltigeVorgaenge(b).map((v) => v.id));
      return b.vorgaenge.filter((v) => ok.has(v.id) && !v.ohneGeldfluss && q.vorgangsarten.some((art) => art === v.art) && imZeitraum(v.valuta, q.zeitraum, p));
    });
    wert = new Decimal(gueltig.length);
    h.schritte.push({ zeichen: "=", bezeichnung: S.anzahlGueltig, wert: wert.toString() });
  } else {
    wert = summe(zeilen.map((v) => v.betrag));
    h.schritte.push({ zeichen: "=", bezeichnung: S.summeVorgaenge, wert: wert.toString() });
  }
  if (q.negieren) {
    wert = wert.neg();
    h.schritte.push({ zeichen: "×", bezeichnung: S.vorzeichenUmgekehrt, wert: "-1" });
  }
  return { wert: kanonisch(wert, format), herkunft: h };
}

function auswerteFondsbewegung(q: Extract<Quelle, { art: "fondsbewegung" }>, format: Feldformat, k: Kontext): Ergebnis {
  const p = k.eingabe.periode;
  const h = leereHerkunft([]);
  const zeilen = k.eingabe.fonds.bewegungen.filter((b) => b.art === q.bewegung && imZeitraum(b.valuta, q.zeitraum, p));
  h.bewegungen = zeilen.map((b) => b.id);
  h.schritte.push({ zeichen: "", bezeichnung: S.zeitraumVorgaenge, wert: q.zeitraum === "kumuliert" ? `bis ${p.ende}` : `${p.beginn} bis ${p.ende}` });
  h.schritte.push({ zeichen: "", bezeichnung: S.bewegungen, wert: String(zeilen.length), quellen: h.bewegungen });
  const wert = summe(zeilen.map((b) => b.betrag));
  h.schritte.push({ zeichen: "=", bezeichnung: S.summeBewegungen, wert: wert.toString() });
  return { wert: kanonisch(wert, format), herkunft: h };
}

interface BestandsRechnung {
  /** Zusage und Investiert ohne die Buchungen einer Wandlung ohne Geldfluss. */
  zusage: Decimal;
  investiert: Decimal;
  /** Für den Buchwert: Investiert und Tilgungen einschließlich der Wandlungsbuchungen. */
  investiertBuch: Decimal;
  kapitalisiert: Decimal;
  tilgungen: Decimal;
  /** Rückflüsse ohne Tilgung durch Wandlung. */
  rueckfluesse: Decimal;
  wertberichtigungen: Decimal;
}

function bestandVon(b: BeteiligungDaten, ende: string): BestandsRechnung {
  const bis = b.vorgaenge.filter((v) => v.valuta <= ende);
  const s = (art: Vorgangsart, filter: (v: VorgangZeile) => boolean = () => true) => summe(bis.filter((v) => v.art === art && filter(v)).map((v) => v.betrag));
  const bar = (v: VorgangZeile) => !v.ohneGeldfluss;
  return {
    zusage: s("zusage", bar),
    investiert: s("auszahlung", bar),
    investiertBuch: s("auszahlung"),
    kapitalisiert: s("zins", (v) => v.kapitalisiert),
    tilgungen: s("tilgung"),
    // Wie die Kennzahlen der Plattform: Erlös, Tilgung, gezahlte Zinsen und Dividenden (eine Zinsbuchung ist nur eine Forderung);
    // die Tilgung durch Wandlung ist kein Geld, der bar ausgezahlte Spitzenbetrag zählt.
    rueckfluesse: s("rueckfluss").plus(s("tilgung", bar)).plus(s("zinszahlung")).plus(s("dividende")),
    wertberichtigungen: s("wertberichtigung"),
  };
}

function auswerteBestand(q: Extract<Quelle, { art: "bestand" }>, format: Feldformat, k: Kontext): Ergebnis {
  const h = kopf(k);
  const ende = k.eingabe.periode.ende;
  h.schritte.push({ zeichen: "", bezeichnung: S.stichtag, wert: ende });
  const je = k.beteiligungen.map((b) => ({ b, r: bestandVon(b, ende) }));
  const schritt = (zeichen: Rechenschritt["zeichen"], bezeichnung: string, wert: Decimal) => h.schritte.push({ zeichen, bezeichnung, wert: wert.toString() });
  let wert: Decimal | null;
  switch (q.groesse) {
    case "zusage":
      wert = summe(je.map((x) => x.r.zusage.toString()));
      schritt("=", S.zusagen, wert);
      break;
    case "investiert":
      wert = summe(je.map((x) => x.r.investiert.toString()));
      schritt("=", S.auszahlungen, wert);
      break;
    case "rueckfluesse":
      wert = summe(je.map((x) => x.r.rueckfluesse.toString()));
      schritt("=", S.rueckfluesse, wert);
      break;
    case "offene_zusage": {
      const z = summe(je.map((x) => x.r.zusage.toString()));
      const i = summe(je.map((x) => x.r.investiert.toString()));
      wert = z.minus(i);
      schritt("", S.zusagen, z);
      schritt("−", S.auszahlungen, i);
      schritt("=", S.offeneZusage, wert);
      break;
    }
    case "buchwert": {
      const t = (f: (r: BestandsRechnung) => Decimal) => summe(je.map((x) => f(x.r).toString()));
      const investiert = t((r) => r.investiertBuch);
      const kapitalisiert = t((r) => r.kapitalisiert);
      const tilgungen = t((r) => r.tilgungen);
      const wb = t((r) => r.wertberichtigungen);
      const abgang = summe(k.beteiligungen.map((b) => b.buchwertAbgang));
      wert = investiert.plus(kapitalisiert).minus(tilgungen).minus(wb).minus(abgang);
      schritt("", S.bwInvestiert, investiert);
      schritt("+", S.bwKapitalisiert, kapitalisiert);
      schritt("−", S.bwTilgungen, tilgungen);
      schritt("−", S.bwWertberichtigungen, wb);
      schritt("−", S.bwAbgang, abgang);
      schritt("=", S.bwBuchwert, wert);
      break;
    }
    case "bewertung": {
      const mitWert = k.beteiligungen.filter((b) => b.bewertung !== null || dec(b.offeneForderungen).greaterThan(0));
      const bewertet = k.beteiligungen.filter((b) => b.bewertung !== null && !b.ausgeschieden);
      const ford = summe(k.beteiligungen.map((b) => b.offeneForderungen));
      if (mitWert.length === 0) {
        wert = null;
        h.schritte.push({ zeichen: "=", bezeichnung: S.keinWert, wert: "" });
        break;
      }
      const bw = summe(bewertet.map((b) => b.bewertung!.wert));
      wert = bw.plus(ford);
      h.schritte.push({ zeichen: "", bezeichnung: S.bewertungMit, wert: String(bewertet.length), quellen: bewertet.map((b) => b.id) });
      schritt("+", S.offeneForderungen, ford);
      schritt("=", S.wertansatz, wert);
      break;
    }
  }
  return { wert: wert ? kanonisch(wert, format) : null, herkunft: h };
}

function auswerteAnzahl(q: Extract<Quelle, { art: "beteiligungsanzahl" }>, format: Feldformat, k: Kontext): Ergebnis {
  const h = kopf(k);
  const p = k.eingabe.periode;
  const treffer = q.umfang === "neu" ? k.beteiligungen.filter((b) => b.erstinvestment >= p.beginn && b.erstinvestment <= p.ende) : k.beteiligungen.filter((b) => b.erstinvestment <= p.ende);
  h.schritte.push({ zeichen: "=", bezeichnung: q.umfang === "neu" ? S.beteiligungenNeu : S.beteiligungenBestand, wert: String(treffer.length), quellen: treffer.map((b) => b.id) });
  h.beteiligungen = treffer.map((b) => b.id);
  return { wert: kanonisch(new Decimal(treffer.length), format), herkunft: h };
}

function stammdatenWert(feld: string, k: Kontext): string | null {
  const e = k.eingabe;
  const b = k.beteiligungen.length === 1 ? k.beteiligungen[0]! : null;
  switch (feld) {
    case "fonds.name": return e.fonds.name;
    case "fonds.kurzname": return e.fonds.kurzname;
    case "fonds.vintage": return String(e.fonds.vintage);
    case "fonds.zeichnungskapital": return e.fonds.zeichnungskapital;
    case "fonds.waehrung": return e.fonds.waehrung;
    case "periode.beginn": return e.periode.beginn;
    case "periode.ende": return e.periode.ende;
    case "periode.kennung": return e.periode.kennung;
    case "programm.schluessel": return e.programm?.schluessel ?? null;
    case "programm.bezeichnung": return e.programm?.bezeichnung ?? null;
    case "gruppe.schluessel": return k.gruppe && !k.gruppe.ohne ? k.gruppe.schluessel : null;
    case "gruppe.bezeichnung": return k.gruppe && !k.gruppe.ohne ? k.gruppe.bezeichnung : null;
    case "organisation.name": return b?.organisationName ?? null;
    case "organisation.sektor": return b?.sektor ?? null;
    case "organisation.nace": return b?.nace ?? null;
    case "organisation.ort": return b?.ort ?? null;
    case "organisation.sitzland": return b?.sitzland ?? null;
    case "organisation.region": return b?.region ?? null;
    case "beteiligung.instrument": return b?.instrument ?? null;
    case "beteiligung.status": return b?.status ?? null;
    case "beteiligung.erstinvestment": return b?.erstinvestment ?? null;
    case "foerderung.programm": return b?.programm?.schluessel ?? null;
    case "foerderung.mittelart": return b ? ((b.auswahl ?? artenMitAnteil(b)).join(", ") || null) : null;
  }
  return null;
}

function auswerteStammdaten(q: Extract<Quelle, { art: "stammdaten" }>, k: Kontext): Ergebnis {
  const h = leereHerkunft(k.filter);
  h.beteiligungen = k.beteiligungen.length === 1 ? [k.beteiligungen[0]!.id] : [];
  const wert = stammdatenWert(q.feld, k);
  h.schritte.push({ zeichen: "", bezeichnung: S.stammdaten, wert: q.feld });
  h.schritte.push({ zeichen: "=", bezeichnung: wert === null ? S.keinWert : S.stammdaten, wert: wert ?? "" });
  return { wert, herkunft: h };
}

function auswerteSchluessel(q: Extract<Quelle, { art: "schluessel" }>, k: Kontext): Ergebnis {
  const b = k.beteiligungen[0];
  const wert = b ? (b[q.feld] ?? null) : null;
  const h = leereHerkunft(k.filter);
  h.beteiligungen = b ? [b.id] : [];
  h.schritte.push({ zeichen: "", bezeichnung: S.schluesselfeld, wert: q.feld });
  h.schritte.push({ zeichen: "=", bezeichnung: wert === null ? S.keinWert : S.schluesselfeld, wert: wert ?? "" });
  return { wert, herkunft: h };
}

function rechne(q: Extract<Quelle, { art: "berechnet" }>, format: Feldformat, operanden: { ref: string; wert: string | null }[]): Ergebnis {
  const h = leereHerkunft([]);
  h.operanden = operanden;
  for (const o of operanden) h.schritte.push({ zeichen: "", bezeichnung: S.operand, wert: o.wert ?? "" });
  if (operanden.some((o) => o.wert === null)) {
    h.schritte.push({ zeichen: "=", bezeichnung: S.operandFehlt, wert: "" });
    return { wert: null, herkunft: h };
  }
  const w = operanden.map((o) => dec(o.wert!));
  let ergebnis: Decimal;
  switch (q.operation) {
    case "summe":
      ergebnis = w.reduce((s, x) => s.plus(x), new Decimal(0));
      h.schritte.push({ zeichen: "=", bezeichnung: S.operationSumme, wert: ergebnis.toString() });
      break;
    case "differenz":
      ergebnis = w.slice(1).reduce((s, x) => s.minus(x), w[0]!);
      h.schritte.push({ zeichen: "=", bezeichnung: S.operationDifferenz, wert: ergebnis.toString() });
      break;
    case "produkt":
      ergebnis = w.reduce((s, x) => s.times(x), new Decimal(1));
      h.schritte.push({ zeichen: "=", bezeichnung: S.operationProdukt, wert: ergebnis.toString() });
      break;
    case "quotient":
    case "anteil_prozent":
      if (w[1]!.isZero()) {
        h.schritte.push({ zeichen: "=", bezeichnung: S.durchNull, wert: "" });
        return { wert: null, herkunft: h };
      }
      ergebnis = w[0]!.div(w[1]!);
      if (q.operation === "anteil_prozent") ergebnis = ergebnis.times(100);
      h.schritte.push({ zeichen: "=", bezeichnung: q.operation === "quotient" ? S.operationQuotient : S.operationAnteil, wert: ergebnis.toString() });
      break;
  }
  return { wert: kanonisch(ergebnis, format), herkunft: h };
}

// Abschnitte ------------------------------------------------------------------------------------------------------

const OHNE = "_ohne";

function gruppen(je: Gruppierung, bs: BeteiligungDaten[], programme: { schluessel: string; bezeichnung: string }[], e: AuswertungsEingabe) {
  if (je === "mittelart") {
    // Eine Beteiligung kann in mehreren Meldearten Beträge haben: Sie gehört zu jeder Gruppe, in der sie welche hat, mit dem Anteil dieser Meldeart.
    const aus = MITTELARTEN.map((a) => ({ schluessel: a as string, bezeichnung: a as string | null, ohne: false, mitglieder: bs.map((b) => anteilig(b, [a], e.mittelartQuoten)).filter(hatAnteil) })).filter((g) => g.mitglieder.length > 0);
    const ohne = bs.filter((b) => artenMitAnteil(b).length === 0);
    return ohne.length ? [...aus, { schluessel: OHNE, bezeichnung: null, ohne: true, mitglieder: ohne }] : aus;
  }
  const karte = new Map<string, { schluessel: string; bezeichnung: string | null; ohne: boolean; mitglieder: BeteiligungDaten[] }>();
  const schluesselVon = (b: BeteiligungDaten): string | null => {
    switch (je) {
      case "beteiligung": return b.id;
      case "programm": return b.programm?.schluessel ?? null;
      case "instrument": return b.instrument;
      case "sitzland": return b.sitzland;
      case "branche": return b.sektor;
    }
  };
  for (const b of bs) {
    const s = schluesselVon(b);
    const key = s ?? OHNE;
    let g = karte.get(key);
    if (!g) {
      const bezeichnung = s === null ? null : je === "beteiligung" ? b.organisationName : je === "programm" ? (programme.find((p) => p.schluessel === s)?.bezeichnung ?? s) : s;
      g = { schluessel: key, bezeichnung, ohne: s === null, mitglieder: [] };
      karte.set(key, g);
    }
    g.mitglieder.push(b);
  }
  return [...karte.values()].sort((a, c) => (a.ohne ? 1 : 0) - (c.ohne ? 1 : 0) || (a.bezeichnung ?? "").localeCompare(c.bezeichnung ?? "", "de") || a.schluessel.localeCompare(c.schluessel));
}

type Auswerter = (f: Feld, k: Kontext, operanden: (ref: string) => string | null) => Ergebnis;

/** Berechnet einen Wert nach der Quelle des Feldes (ohne `manuell`, das der Aufrufer behandelt). */
const auswerteQuelle: Auswerter = (f, k, operanden) => {
  const q = f.quelle;
  switch (q.art) {
    case "kennzahl": return auswerteKennzahl(q, f.format, k);
    case "vorgang": return auswerteVorgang(q, f.format, k);
    case "fondsbewegung": return auswerteFondsbewegung(q, f.format, k);
    case "bestand": return auswerteBestand(q, f.format, k);
    case "beteiligungsanzahl": return auswerteAnzahl(q, f.format, k);
    case "stammdaten": return auswerteStammdaten(q, k);
    case "schluessel": return auswerteSchluessel(q, k);
    case "berechnet": return rechne(q, f.format, q.felder.map((ref) => ({ ref, wert: operanden(ref) })));
    case "manuell": return { wert: null, herkunft: leereHerkunft([]) };
  }
};

/** Reihenfolge der Berechnung: Felder ohne Verweise zuerst, dann berechnete Felder nach ihren Operanden (Zyklen schließt die Prüfung der Definition aus). */
function reihenfolge<T extends { id: string; quelle: Quelle }>(felder: T[]): T[] {
  const fertig = new Set<string>();
  const aus: T[] = [];
  const ids = new Set(felder.map((f) => f.id));
  const rest = [...felder];
  while (rest.length) {
    const i = rest.findIndex((f) => f.quelle.art !== "berechnet" || f.quelle.felder.every((r) => !ids.has(r) || fertig.has(r)));
    const naechstes = rest.splice(i === -1 ? 0 : i, 1)[0]!;
    fertig.add(naechstes.id);
    aus.push(naechstes);
  }
  return aus;
}

function werteAbschnittFelder(a: Extract<Abschnitt, { typ: "felder" }>, e: AuswertungsEingabe, basis: Filter[], bekannte: Map<string, string | null>, werte: Wert[]): AbschnittErgebnis {
  const ergebnis = new Map<string, FeldAnzeige>();
  for (const f of reihenfolge(a.felder)) {
    const filter = [...basis, ...(nichtLeer(f.filter) ? [f.filter] : [])];
    const bs = mitMittelart(e.beteiligungen.filter((b) => filter.every((x) => passtZumFilter(b, x))), filter, e);
    const schluessel = `${a.id}.${f.id}`;
    let r: Ergebnis;
    let manuell = false;
    if (f.quelle.art === "manuell") {
      const wert = e.manuell[schluessel] ?? null;
      manuell = true;
      const h = leereHerkunft([]);
      h.schritte.push(wert === null ? { zeichen: "=", bezeichnung: S.keinWert, wert: "" } : { zeichen: "=", bezeichnung: S.eingabe, wert });
      r = { wert, herkunft: h };
    } else {
      r = auswerteQuelle(f, { eingabe: e, beteiligungen: bs, filter }, (ref) => bekannte.get(ref) ?? null);
    }
    bekannte.set(f.id, r.wert);
    werte.push({ schluessel, art: f.quelle.art, reihenfolge: 0, wert: r.wert, herkunft: r.herkunft, manuell });
    ergebnis.set(f.id, { id: f.id, schluessel, wert: r.wert });
  }
  return { id: a.id, typ: "felder", felder: a.felder.map((f) => ergebnis.get(f.id)!) };
}

function werteAbschnittTabelle(a: Extract<Abschnitt, { typ: "tabelle" }>, e: AuswertungsEingabe, basis: Filter[], bekannte: Map<string, string | null>, werte: Wert[]): AbschnittErgebnis {
  const filter = [...basis, ...(nichtLeer(a.filter) ? [a.filter] : [])];
  const menge = mitMittelart(e.beteiligungen.filter((b) => filter.every((x) => passtZumFilter(b, x))), filter, e);
  const gruppenListe = gruppen(a.je, menge, e.programme, e);
  const spalten = reihenfolge(a.spalten);
  const zeilen: ZeileAusgabe[] = gruppenListe.map((g) => {
    const zeile: ZeileAusgabe = { schluessel: g.schluessel, bezeichnung: g.bezeichnung, gruppeOhne: g.ohne, zellen: {} };
    const zellenWerte = new Map<string, string | null>();
    werte.push({ schluessel: `${a.id}.${g.schluessel}._zeile`, art: "zeile", reihenfolge: 0, wert: g.bezeichnung, herkunft: null, manuell: false });
    for (const s of spalten) {
      const sf = [...filter, ...(nichtLeer(s.filter) ? [s.filter] : [])];
      const bs = mitMittelart(g.mitglieder.filter((b) => sf.every((x) => passtZumFilter(b, x))), nichtLeer(s.filter) ? [s.filter] : [], e);
      const r = auswerteQuelle(s, { eingabe: e, beteiligungen: bs, filter: sf, gruppe: { schluessel: g.schluessel, bezeichnung: g.bezeichnung, ohne: g.ohne } }, (ref) => zellenWerte.get(ref) ?? null);
      zellenWerte.set(s.id, r.wert);
      const schluessel = `${a.id}.${g.schluessel}.${s.id}`;
      werte.push({ schluessel, art: s.quelle.art, reihenfolge: 0, wert: r.wert, herkunft: r.herkunft, manuell: false });
      zeile.zellen[s.id] = { id: s.id, schluessel, wert: r.wert };
    }
    return zeile;
  });
  if (a.sortierung) {
    const { spalte, richtung } = a.sortierung;
    const format = a.spalten.find((s) => s.id === spalte)?.format ?? "text";
    const faktor = richtung === "ab" ? -1 : 1;
    zeilen.sort((x, y) => {
      const wx = x.zellen[spalte]?.wert ?? null;
      const wy = y.zellen[spalte]?.wert ?? null;
      if (wx === null || wy === null) return (wx === null ? 1 : 0) - (wy === null ? 1 : 0);
      return faktor * (ZAHLEN.has(format) ? dec(wx).comparedTo(wy) : wx.localeCompare(wy, "de"));
    });
  }
  const summierte = a.spalten.filter((s) => s.summe);
  let summen: Record<string, FeldAnzeige> | null = null;
  if (summierte.length) {
    summen = {};
    for (const s of summierte) {
      const gefuellt = zeilen.map((z) => z.zellen[s.id]!.wert).filter((w): w is string => w !== null);
      const wert = gefuellt.length ? kanonisch(summe(gefuellt), s.format) : null;
      const h = leereHerkunft(filter);
      h.beteiligungen = menge.map((b) => b.id);
      h.schritte.push({ zeichen: "", bezeichnung: S.zeilenMitWert, wert: String(gefuellt.length) });
      h.schritte.push(wert === null ? { zeichen: "=", bezeichnung: S.keinWert, wert: "" } : { zeichen: "=", bezeichnung: S.summeZeilen, wert });
      const schluessel = `${a.id}._summe.${s.id}`;
      werte.push({ schluessel, art: "berechnet", reihenfolge: 0, wert, herkunft: h, manuell: false });
      summen[s.id] = { id: s.id, schluessel, wert };
      bekannte.set(`${a.id}.${s.id}`, wert);
    }
  }
  return { id: a.id, typ: "tabelle", je: a.je, zeilen, summen };
}

/** Berechnet alle Werte der Definition. Die Abschnitte vom Typ `felder` laufen in der Reihenfolge der Definition; Rechenfelder dürfen Felder früherer Abschnitte verwenden. */
export function werteAus(e: AuswertungsEingabe): Auswertung {
  const basis: Filter[] = [...(e.programm ? [{ foerderprogramm: [e.programm.schluessel] } as Filter] : []), ...(nichtLeer(e.definition.filter) ? [e.definition.filter] : [])];
  const bekannte = new Map<string, string | null>();
  const werte: Wert[] = [];
  // Felder aller Abschnitte vom Typ `felder` gelten als ein Raum für Verweise: erst alle nicht berechneten, dann die berechneten, damit Verweise auf spätere Abschnitte gehen.
  const abschnitte: AbschnittErgebnis[] = [];
  const felderAbschnitte = e.definition.abschnitte.filter((a): a is Extract<Abschnitt, { typ: "felder" }> => a.typ === "felder");
  const alleFelder = felderAbschnitte.flatMap((a) => a.felder.map((f) => ({ abschnitt: a.id, feld: f })));
  const reihe = reihenfolge(alleFelder.map((x) => ({ id: x.feld.id, quelle: x.feld.quelle, abschnitt: x.abschnitt, feld: x.feld })));
  const ergebnisse = new Map<string, FeldAnzeige>();
  for (const x of reihe) {
    const a = felderAbschnitte.find((s) => s.id === x.abschnitt)!;
    const teil = werteAbschnittFelder({ ...a, felder: [x.feld] }, e, basis, bekannte, werte);
    if (teil.typ === "felder") ergebnisse.set(x.feld.id, teil.felder[0]!);
  }
  for (const a of e.definition.abschnitte) {
    if (a.typ === "felder") abschnitte.push({ id: a.id, typ: "felder", felder: a.felder.map((f) => ergebnisse.get(f.id)!) });
    else abschnitte.push(werteAbschnittTabelle(a, e, basis, bekannte, werte));
  }
  werte.forEach((w, i) => (w.reihenfolge = i));
  return { abschnitte, werte };
}

/**
 * Baut die Anzeige (Abschnitte mit Zeilen und Zellen) aus gespeicherten Werten wieder auf, in der Reihenfolge der Berechnung. Die Sortierung
 * der Zeilen und die Gruppen stehen in den Werten (`_zeile`), die Definition liefert nur Abschnitte und Spalten.
 */
export function anzeigeAus(d: DefinitionInhalt, gespeichert: readonly { schluessel: string; wert: string | null; reihenfolge: number }[]): AbschnittErgebnis[] {
  const nachSchluessel = new Map(gespeichert.map((w) => [w.schluessel, w]));
  return d.abschnitte.map((a): AbschnittErgebnis => {
    if (a.typ === "felder") return { id: a.id, typ: "felder", felder: a.felder.map((f) => ({ id: f.id, schluessel: `${a.id}.${f.id}`, wert: nachSchluessel.get(`${a.id}.${f.id}`)?.wert ?? null })) };
    const zeilenKopf = gespeichert.filter((w) => w.schluessel.startsWith(`${a.id}.`) && w.schluessel.endsWith("._zeile")).sort((x, y) => x.reihenfolge - y.reihenfolge);
    const zeilen: ZeileAusgabe[] = zeilenKopf.map((k) => {
      const key = k.schluessel.slice(a.id.length + 1, -"._zeile".length);
      const zellen: Record<string, FeldAnzeige> = {};
      for (const s of a.spalten) zellen[s.id] = { id: s.id, schluessel: `${a.id}.${key}.${s.id}`, wert: nachSchluessel.get(`${a.id}.${key}.${s.id}`)?.wert ?? null };
      return { schluessel: key, bezeichnung: k.wert, gruppeOhne: key === OHNE, zellen };
    });
    const summierte = a.spalten.filter((s) => s.summe);
    const summen = summierte.length ? Object.fromEntries(summierte.map((s) => [s.id, { id: s.id, schluessel: `${a.id}._summe.${s.id}`, wert: nachSchluessel.get(`${a.id}._summe.${s.id}`)?.wert ?? null }])) : null;
    return { id: a.id, typ: "tabelle", je: a.je, zeilen, summen };
  });
}
