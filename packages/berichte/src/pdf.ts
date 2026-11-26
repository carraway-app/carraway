import { formatBetrag, formatDatum, formatMultiple, formatProzent, formatZahl, formatZeitpunkt, quartal, quartalsbeginn } from "./format";
import { standardKonfiguration, type Berichtsart, type Einheit, type Vorlagenkonfiguration } from "./konfiguration";
import { ausgewaehlt, ausrichtungen, breiten, exitSpalten, mitWaehrungssicht, portfolioSpalten, SICHT_EXIT, SICHT_PORTFOLIO, tabellenZeilen, waehrungsHinweise, zusatzSpalten, anzeige, type Spalte } from "./listen";
import { TEXTE, uebersetzeSchritt, type Texte } from "./texte";
import type {
  BerichtsOptionen,
  ExitListeDaten,
  FondsberichtDaten,
  GremienDaten,
  GremienDeal,
  Kennzahl,
  LpBerichtDaten,
  PaiBefundBericht,
  PaiErklaerungDaten,
  PaiZeileBericht,
  PortfolioListeDaten,
  QuartalsberichtDaten,
  Sprache,
  UnternehmensKennzahl,
} from "./typen";
import { literal, setzePdf, type TypstWert } from "./typst";
import { FONDSBERICHT, GREMIENVORLAGE, LISTE, LP_BERICHT, MIT_GRUNDLAGE, PAI_ERKLAERUNG, QUARTALSBERICHT } from "./vorlagen";

/** Höchstzahl Vorgänge, die der einseitige Quartalsbericht zeigt; der Rest steht als Hinweis darunter. */
export const MAX_VORGAENGE_QUARTALSBERICHT = 10;
/** Anzahl der Balken im Bewertungsverlauf. */
const MAX_BALKEN = 12;
/** Höchstzahl Aktivitäten je Deal in der Gremienvorlage. */
export const MAX_AKTIVITAETEN_GREMIEN = 5;

const nachSprache = (sprache: Sprache): Texte => TEXTE[sprache];

/** Gemeinsame Felder aller Vorlagen: Sprache, Texte und der Entwurfsschalter (Wasserzeichen und Entwurfshinweise). */
function grundDaten(sprache: Sprache, optionen: BerichtsOptionen): Record<string, TypstWert> {
  return { sprache, t: nachSprache(sprache) as unknown as TypstWert, entwurf: optionen.entwurf !== false };
}

function quelle(daten: Record<string, TypstWert>, vorlage: string): string {
  return `#let data = ${literal(daten)}\n${MIT_GRUNDLAGE(vorlage)}`;
}

function konfig(art: Berichtsart, optionen: BerichtsOptionen): Vorlagenkonfiguration {
  return optionen.konfiguration ?? standardKonfiguration(art);
}

function herkunftsEintrag(name: string, k: Kennzahl, formatiert: string, sprache: Sprache): TypstWert {
  return {
    name,
    wert: formatiert,
    schritte: k.schritte.map((s) => ({
      zeichen: s.zeichen,
      bezeichnung: uebersetzeSchritt(s.bezeichnung, sprache),
      wert: /^-?\d+(\.\d+)?$/.test(s.wert) ? formatZahl(s.wert, sprache) : s.wert,
    })),
  };
}

/** Zeitraum als Kurzform: Jahr (`2026`), Quartal (`Q3 2026`) oder Monat (`07/2026`). */
function zeitraumKurz(beginn: string, ende: string): string {
  const monate = Number(ende.slice(5, 7)) - Number(beginn.slice(5, 7)) + 1;
  if (monate === 12) return beginn.slice(0, 4);
  if (monate === 3) return quartal(beginn);
  return `${beginn.slice(5, 7)}/${beginn.slice(0, 4)}`;
}

/** Währungscode der Einheit eines Betrags (dreibuchstabig), sonst Euro. */
const waehrung = (einheit: string) => (/^[A-Z]{3}$/.test(einheit) ? einheit : "EUR");

/** Wert einer Unternehmenskennzahl nach ihrem Typ (Betrag in Euro, Zahl mit Einheit, Prozent, Ja/Nein, Text). */
function kennzahlWert(k: UnternehmensKennzahl, w: string | null, sprache: Sprache, einheitBetraege: Einheit): string {
  if (w === null) return "–";
  const t = nachSprache(sprache);
  switch (k.typ) {
    case "betrag":
      return formatBetrag(w, sprache, waehrung(k.einheit), einheitBetraege);
    case "zahl":
      return `${formatZahl(w, sprache)}${k.einheit && k.einheit !== "Anzahl" ? ` ${k.einheit}` : ""}`;
    case "prozent":
      return sprache === "de" ? `${formatZahl(w, sprache)} %` : `${formatZahl(w, sprache)}%`;
    case "ja_nein":
      return w === "ja" ? t.quartalsbericht.ja : t.quartalsbericht.nein;
    case "text":
      return w;
  }
}

/** Abweichung Ist gegen Plan als Text: absolut (mit Vorzeichen) und relativ in Prozent; Prozent-Kennzahlen in Prozentpunkten. */
function abweichungText(k: UnternehmensKennzahl, sprache: Sprache, einheitBetraege: Einheit): string {
  if (k.absolut === null) return "–";
  const vorzeichen = (w: string) => (Number(w) > 0 ? "+" : "");
  const absolut = `${vorzeichen(k.absolut)}${k.typ === "betrag" ? formatBetrag(k.absolut, sprache, waehrung(k.einheit), einheitBetraege) : k.typ === "prozent" ? `${formatZahl(k.absolut, sprache)} ${sprache === "de" ? "Pkt." : "pp"}` : formatZahl(k.absolut, sprache)}`;
  if (k.prozent === null) return absolut;
  const relativ = `${vorzeichen(k.prozent)}${new Intl.NumberFormat(sprache === "de" ? "de-DE" : "en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Number(k.prozent))}${sprache === "de" ? " %" : "%"}`;
  return `${absolut} (${relativ})`;
}

export function quartalsberichtQuelle(d: QuartalsberichtDaten, sprache: Sprache, optionen: BerichtsOptionen = {}): string {
  const t = nachSprache(sprache);
  const k = d.kennzahlen;
  const konfiguration = konfig("quartalsbericht", optionen);
  const einheit = konfiguration.einheit;
  const betrag = (w: string | null) => formatBetrag(w, sprache, "EUR", einheit);
  const von = quartalsbeginn(d.stichtag);
  const imQuartal = d.vorgaenge.filter((v) => v.valuta >= von && v.valuta <= d.stichtag);
  // Die Kennzahlen des Unternehmens nehmen Platz auf der einen Seite: Je Zeile ein Vorgang weniger (mindestens zwei).
  const kennzahlZeilen = konfiguration.abschnitte.includes("unternehmenskennzahlen") && d.unternehmenskennzahlen !== undefined ? d.unternehmenskennzahlen.length + 6 : 0; // Zeilen plus Titel, Kopf und Hinweis
  const sichtbar = imQuartal.slice(0, Math.max(2, MAX_VORGAENGE_QUARTALSBERICHT - kennzahlZeilen));
  const verlauf = d.bewertungsverlauf.filter((w) => w.stichtag <= d.stichtag).slice(-MAX_BALKEN);
  const art = (a: string) => t.arten[a as keyof Texte["arten"]] ?? a;
  const instrument = t.instrumente[d.beteiligung.instrument as keyof Texte["instrumente"]] ?? d.beteiligung.instrument;
  const status = t.stati[d.beteiligung.status as keyof Texte["stati"]] ?? d.beteiligung.status;

  const daten: Record<string, TypstWert> = {
    ...grundDaten(sprache, optionen),
    titel: `${t.quartalsbericht.titel} ${d.organisation.name} ${quartal(d.stichtag)}`,
    kopf: `${t.quartalsbericht.kopf} · ${d.fonds.kurzname}`,
    stichtag: formatDatum(d.stichtag, sprache),
    wissensstand: formatZeitpunkt(d.wissensstand, sprache),
    organisation: d.organisation.name,
    untertitel: `${d.fonds.name} · ${instrument} · ${status} · ${t.stichtag} ${formatDatum(d.stichtag, sprache)} (${quartal(d.stichtag)})`,
    kacheln: [
      { label: t.kennzahlen.investiert, wert: betrag(k.investiert.wert), hinweis: `${t.erstinvestment} ${formatDatum(d.beteiligung.erstinvestment, sprache)}`, dunkel: false },
      { label: t.kennzahlen.rueckfluesse, wert: betrag(k.rueckfluesse.wert), hinweis: null, dunkel: false },
      { label: t.kennzahlen.bewertung, wert: betrag(k.bewertung.wert), hinweis: null, dunkel: false },
      { label: t.kennzahlen.multiple, wert: formatMultiple(k.multiple.wert, sprache), hinweis: null, dunkel: true },
      { label: t.kennzahlen.irr, wert: k.irr.wert === null ? t.nichtDefiniert : formatProzent(k.irr.wert, sprache), hinweis: null, dunkel: false },
    ],
    balken: verlauf.map((w, i) => ({
      v: Number(w.wert),
      beschriftung: new Intl.NumberFormat(sprache === "de" ? "de-DE" : "en-GB", { notation: "compact", maximumFractionDigits: 1 }).format(Number(w.wert)),
      etikett: `${w.stichtag.slice(5, 7)}/${w.stichtag.slice(2, 4)}`,
      letzte: i === verlauf.length - 1,
    })),
    vorgaengeTitel: `${t.quartalsbericht.vorgaenge} (${formatDatum(von, sprache)} – ${formatDatum(d.stichtag, sprache)})`,
    vorgaengeKopf: [t.datum, t.art, t.betrag, t.bemerkung],
    vorgaenge: sichtbar.map((v) => [
      formatDatum(v.valuta, sprache),
      v.istStorno ? `${art(v.art)} (${t.storno})` : v.storniert ? `${art(v.art)} (${t.storniert})` : art(v.art),
      betrag(v.betrag),
      v.bemerkung ?? "",
    ]),
    // Ohne Angabe zu den Unternehmenskennzahlen (Daten ohne diese Auskunft) entfällt der Abschnitt.
    abschnitte: konfiguration.abschnitte.filter((a) => a !== "unternehmenskennzahlen" || d.unternehmenskennzahlen !== undefined),
    unternehmenskennzahlenKopf: [t.quartalsbericht.kennzahl, t.quartalsbericht.zeitraum2, t.quartalsbericht.ist, t.quartalsbericht.plan, t.quartalsbericht.abweichung],
    unternehmenskennzahlen: (d.unternehmenskennzahlen ?? []).map((u) => [
      sprache === "de" ? u.bezeichnungDe : u.bezeichnungEn,
      u.periodeBeginn && u.periodeEnde ? zeitraumKurz(u.periodeBeginn, u.periodeEnde) : "–",
      kennzahlWert(u, u.ist, sprache, einheit),
      kennzahlWert(u, u.plan, sprache, einheit),
      abweichungText(u, sprache, einheit),
    ]),
    weitere: imQuartal.length > sichtbar.length ? `+ ${imQuartal.length - sichtbar.length} ${t.weitere}` : "",
    multipleRechnung: `(${betrag(k.bewertung.wert)} + ${betrag(k.rueckfluesse.wert)}) ÷ ${betrag(k.investiert.wert)} = ${formatMultiple(k.multiple.wert, sprache)}`,
  };
  return quelle(daten, QUARTALSBERICHT);
}

/** Wert und Kachelart der Fondskennzahlen; gemeinsam für Fonds- und LP-Bericht. */
function fondsKennzahlen(d: FondsberichtDaten, sprache: Sprache, einheit: Einheit) {
  const t = nachSprache(sprache);
  const k = d.kennzahlen;
  const betrag = (w: string | null) => formatBetrag(w, sprache, d.fonds.waehrung, einheit);
  const nd = (w: string | null, f: (x: string | null) => string) => (w === null ? t.nichtDefiniert : f(w));
  const mult = (x: string | null) => formatMultiple(x, sprache);
  const proz = (x: string | null) => formatProzent(x, sprache);
  const eintraege: Record<string, { label: string; wert: string; dunkel: boolean; herkunft: Kennzahl | null }> = {
    nav: { label: t.kennzahlen.nav, wert: k.nav.wert === null ? t.navSaldenFehlen : betrag(k.nav.wert), dunkel: true, herkunft: k.nav },
    tvpi: { label: t.kennzahlen.tvpi, wert: nd(k.tvpi.wert, mult), dunkel: false, herkunft: k.tvpi },
    dpi: { label: t.kennzahlen.dpi, wert: nd(k.dpi.wert, mult), dunkel: false, herkunft: k.dpi },
    rvpi: { label: t.kennzahlen.rvpi, wert: nd(k.rvpi.wert, mult), dunkel: false, herkunft: k.rvpi },
    irr: { label: t.kennzahlen.irr, wert: nd(k.irr.wert, proz), dunkel: false, herkunft: k.irr },
    abgerufen: { label: t.kennzahlen.abgerufen, wert: betrag(k.abgerufen.wert), dunkel: false, herkunft: k.abgerufen },
    ausschuettungen: { label: t.kennzahlen.ausschuettungen, wert: betrag(k.ausschuettungen.wert), dunkel: false, herkunft: k.ausschuettungen },
    zeichnungskapital: { label: t.kennzahlen.zeichnungskapital, wert: betrag(d.fonds.zeichnungskapital), dunkel: false, herkunft: null },
  };
  for (const feld of ["eingezahlt", "offen", "ueberfaellig", "ungeklaert"] as const) {
    const kennzahl = k[feld];
    if (kennzahl) eintraege[feld] = { label: t.kennzahlen[feld], wert: betrag(kennzahl.wert), dunkel: false, herkunft: kennzahl };
  }
  return eintraege;
}

/** Portfolio-Tabelle (Spalten nach Konfiguration) für Fonds- und LP-Bericht, danach die gewählten eigenen Felder; mit Währungssicht tragen Investiert, Rückflüsse und Bewertung die Beträge der Sicht. */
function portfolioTabelle(d: FondsberichtDaten, sprache: Sprache, konfiguration: Vorlagenkonfiguration) {
  const t = nachSprache(sprache);
  type Zeile = FondsberichtDaten["beteiligungen"][number];
  const betrag = (w: string | null) => formatBetrag(w, sprache, d.fonds.waehrung, konfiguration.einheit);
  const instrument = (i: string) => t.instrumente[i as keyof Texte["instrumente"]] ?? i;
  const status = (s: string) => t.stati[s as keyof Texte["stati"]] ?? s;
  const def: Record<string, Spalte<Zeile>> = {};
  const text = (k: string, kopf: string, wert: (b: Zeile) => string, breite: number | null = null): void => {
    def[k] = { schluessel: k, kopf, art: "text", wert, breite, summiert: false, format: wert };
  };
  const zahl = (k: string, kopf: string, wert: (b: Zeile) => string): void => {
    def[k] = { schluessel: k, kopf, art: "zahl", wert: () => null, breite: null, summiert: k !== "multiple", format: wert };
  };
  text("unternehmen", t.unternehmen, (b) => b.organisation.name, 1);
  text("instrument", t.instrument, (b) => instrument(b.instrument));
  text("status", t.status, (b) => status(b.status));
  zahl("investiert", t.kennzahlen.investiert, (b) => betrag(b.investiert));
  zahl("rueckfluesse", t.kennzahlen.rueckfluesse, (b) => betrag(b.rueckfluesse));
  zahl("bewertung", t.kennzahlen.bewertung, (b) => (b.letzteBewertung ? betrag(b.letzteBewertung.wert) : "–"));
  zahl("multiple", t.kennzahlen.multiple, (b) => formatMultiple(b.multiple.wert, sprache));
  const gewaehlt = konfiguration.spalten.filter((k) => def[k]).map((k) => def[k]!);
  // Mit Sicht ersetzt `mitWaehrungssicht` die Beträge; ohne bleibt die Anzeige in der Fondswährung (die Tabelle hat keine Summenzeile).
  const spalten: Spalte<Zeile>[] = [...mitWaehrungssicht(gewaehlt, d.waehrungssicht, SICHT_PORTFOLIO, t, sprache, konfiguration.einheit), ...zusatzSpalten<Zeile>(d.zusatzspalten, t, sprache)];
  return {
    portfolioKopf: spalten.map((s) => s.kopf),
    portfolio: d.beteiligungen.map((b) => spalten.map((s) => anzeige(s, b, sprache, d.fonds.waehrung, konfiguration.einheit))),
    portfolioAusrichtung: ausrichtungen(spalten),
    portfolioBreiten: spalten.map((s) => (s.schluessel === "unternehmen" ? 1 : s.breite)),
    portfolioHinweise: waehrungsHinweise(d.waehrungssicht, t, sprache),
  };
}

function realisierungen(d: FondsberichtDaten, sprache: Sprache, einheit: Einheit) {
  const t = nachSprache(sprache);
  const betrag = (w: string | null) => formatBetrag(w, sprache, d.fonds.waehrung, einheit);
  const instrument = (i: string) => t.instrumente[i as keyof Texte["instrumente"]] ?? i;
  return {
    realisierungenKopf: [t.unternehmen, t.instrument, t.kennzahlen.investiert, t.kennzahlen.rueckfluesse, t.kennzahlen.multiple],
    realisierungen: d.beteiligungen
      .filter((b) => b.status === "exit")
      .map((b) => [b.organisation.name, instrument(b.instrument), betrag(b.investiert), betrag(b.rueckfluesse), formatMultiple(b.multiple.wert, sprache)]),
  };
}

export function fondsberichtQuelle(d: FondsberichtDaten, sprache: Sprache, optionen: BerichtsOptionen = {}): string {
  const t = nachSprache(sprache);
  const konfiguration = konfig("fondsbericht", optionen);
  const kennzahlen = fondsKennzahlen(d, sprache, konfiguration.einheit);
  const gewaehlt = konfiguration.kennzahlen.filter((k) => kennzahlen[k]);
  const daten: Record<string, TypstWert> = {
    ...grundDaten(sprache, optionen),
    titel: `${t.fondsbericht.titel} ${d.fonds.name} ${formatDatum(d.stichtag, sprache)}`,
    kopf: `${t.fondsbericht.kopf} · ${d.fonds.kurzname}`,
    untertitel: optionen.entwurf === false ? t.fondsbericht.untertitelFinal : t.fondsbericht.untertitel,
    stichtag: formatDatum(d.stichtag, sprache),
    wissensstand: formatZeitpunkt(d.wissensstand, sprache),
    fonds: d.fonds.name,
    zeichnungskapital: formatBetrag(d.fonds.zeichnungskapital, sprache, d.fonds.waehrung, konfiguration.einheit),
    anzahlBeteiligungen: String(d.beteiligungen.length),
    abschnitte: konfiguration.abschnitte,
    kacheln: gewaehlt.map((k) => ({ label: kennzahlen[k]!.label, wert: kennzahlen[k]!.wert, dunkel: kennzahlen[k]!.dunkel })),
    ...portfolioTabelle(d, sprache, konfiguration),
    ...realisierungen(d, sprache, konfiguration.einheit),
    herkunft: gewaehlt.filter((k) => kennzahlen[k]!.herkunft).map((k) => herkunftsEintrag(kennzahlen[k]!.label, kennzahlen[k]!.herkunft!, kennzahlen[k]!.wert, sprache)),
  };
  return quelle(daten, FONDSBERICHT);
}

/** Summe in Cent über Zeichenketten. */
const summeCent = (werte: (string | null)[]) => werte.reduce((s, w) => s + Math.round(Number(w ?? 0) * 100), 0);
const alsBetrag = (cent: number) => (cent / 100).toFixed(2);

/** Bewertungsmethoden: je Methode Anzahl und Summe der letzten freigegebenen Bewertung, dazu offene Forderungen; Summe = Wertansatz. */
function bewertungsMethoden(d: FondsberichtDaten, sprache: Sprache, einheit: Einheit) {
  const t = nachSprache(sprache);
  const betrag = (w: string | null) => formatBetrag(w, sprache, d.fonds.waehrung, einheit);
  const zaehlt = (b: FondsberichtDaten["beteiligungen"][number]) => b.letzteBewertung !== null && !(b.status === "exit" && Number(b.rueckfluesse) > 0);
  const zeilen = d.beteiligungen.filter(zaehlt);
  const forderungen = summeCent(d.beteiligungen.map((b) => b.offeneForderungen ?? "0"));
  const gesamtCent = summeCent(zeilen.map((b) => b.letzteBewertung!.wert)) + forderungen;
  const anteil = (cent: number) => (gesamtCent === 0 ? "–" : formatProzent(String(cent / gesamtCent), sprache));
  const methoden = ["anschaffungskosten", "letzte_runde", "multiplikator", "dcf", "sonstige"] as const;
  const rows: string[][] = [];
  for (const m of methoden) {
    const treffer = zeilen.filter((b) => b.letzteBewertung!.methode === m);
    if (treffer.length === 0) continue;
    const cent = summeCent(treffer.map((b) => b.letzteBewertung!.wert));
    rows.push([t.methoden[m], String(treffer.length), betrag(alsBetrag(cent)), anteil(cent)]);
  }
  if (forderungen !== 0) rows.push([t.lp.forderungen, "", betrag(alsBetrag(forderungen)), anteil(forderungen)]);
  rows.push([t.summe, String(zeilen.length), betrag(alsBetrag(gesamtCent)), gesamtCent === 0 ? "–" : formatProzent("1", sprache)]);
  return {
    bewertungKopf: [t.lp.methode, t.lp.anzahl, t.kennzahlen.bewertung, t.lp.wertanteil],
    bewertung: rows,
    bewertungAusrichtung: ["left", "right", "right", "right"],
    bewertungBreiten: [1, null, null, null],
  };
}

export function lpBerichtQuelle(d: LpBerichtDaten, sprache: Sprache, optionen: BerichtsOptionen = {}): string {
  const t = nachSprache(sprache);
  const konfiguration = konfig("lp_bericht", optionen);
  const kennzahlen = fondsKennzahlen(d, sprache, konfiguration.einheit);
  const gewaehlt = konfiguration.kennzahlen.filter((k) => kennzahlen[k]);
  const betrag = (w: string | null) => formatBetrag(w, sprache, d.fonds.waehrung, konfiguration.einheit);
  const texte = optionen.freitexte ?? {};
  const freitext = (schluessel: "vorwort" | "marktumfeld" | "ausblick") => ({
    titel: t.lp[schluessel],
    absaetze: (texte[schluessel] ?? "").split(/\n{2,}|\r\n(?:\r\n)+/).map((a) => a.replace(/\s*\n\s*/g, " ").trim()).filter((a) => a !== ""),
  });

  const konten = d.kapitalkonten;
  // Die Spalte für Vergütung und Kosten erscheint nur, wenn der Fonds Kostenbuchungen hat; sonst bleibt die Tabelle wie bisher.
  const mitKosten = konten.some((k) => k.verwaltungsverguetung !== undefined || k.fondskosten !== undefined);
  const kostenVon = (k: (typeof konten)[number]) => alsBetrag(summeCent([k.verwaltungsverguetung ?? "0", k.fondskosten ?? "0"]));
  const kostenZelle = (w: string) => (mitKosten ? [betrag(w)] : []);
  const kontoZeilen = konten.map((k) => [k.investor, formatProzent(k.anteil, sprache), betrag(k.zusage), betrag(k.abgerufen), betrag(k.ausgeschuettet), betrag(k.offeneZusage), ...kostenZelle(kostenVon(k)), betrag(k.navAnteil)]);
  const einzeln = optionen.kapitalkontoEinzeln === true && konten.length === 1;
  if (konten.length > 0 && !einzeln) {
    kontoZeilen.push([
      t.summe,
      formatProzent(String(konten.reduce((s, k) => s + Math.round(Number(k.anteil) * 1_000_000), 0) / 1_000_000), sprache),
      betrag(alsBetrag(summeCent(konten.map((k) => k.zusage)))),
      betrag(alsBetrag(summeCent(konten.map((k) => k.abgerufen)))),
      betrag(alsBetrag(summeCent(konten.map((k) => k.ausgeschuettet)))),
      betrag(alsBetrag(summeCent(konten.map((k) => k.offeneZusage)))),
      ...kostenZelle(alsBetrag(summeCent(konten.map(kostenVon)))),
      betrag(d.kennzahlen.nav.wert === null ? null : alsBetrag(summeCent(konten.map((k) => k.navAnteil)))),
    ]);
  }

  const daten: Record<string, TypstWert> = {
    ...grundDaten(sprache, optionen),
    titel: `${t.lp.titel} ${d.fonds.name} ${formatDatum(d.stichtag, sprache)}`,
    kopf: `${t.lp.kopf} · ${d.fonds.kurzname}`,
    untertitel: optionen.entwurf === false ? t.lp.untertitelFinal : t.lp.untertitel,
    stichtag: formatDatum(d.stichtag, sprache),
    wissensstand: formatZeitpunkt(d.wissensstand, sprache),
    fonds: d.fonds.name,
    zeichnungskapital: formatBetrag(d.fonds.zeichnungskapital, sprache, d.fonds.waehrung, konfiguration.einheit),
    anzahlBeteiligungen: String(d.beteiligungen.length),
    abschnitte: konfiguration.abschnitte,
    freitexte: { vorwort: freitext("vorwort"), marktumfeld: freitext("marktumfeld"), ausblick: freitext("ausblick") },
    kacheln: gewaehlt.map((k) => ({ label: kennzahlen[k]!.label, wert: kennzahlen[k]!.wert, dunkel: kennzahlen[k]!.dunkel })),
    kapitalkontenKopf: [t.lp.investor, t.kennzahlen.anteil, t.kennzahlen.zusage, t.kennzahlen.abgerufen, t.kennzahlen.ausschuettungen, t.kennzahlen.offeneZusage, ...(mitKosten ? [t.lp.kostenSpalte] : []), `${t.kennzahlen.nav} ${t.kennzahlen.anteil.toLowerCase()}`],
    zahlungenKopf: [t.lp.investor, t.kennzahlen.abgerufen, t.kennzahlen.eingezahlt, t.kennzahlen.offen, t.kennzahlen.ueberfaellig],
    zahlungen: konten.filter((k) => k.eingezahlt !== undefined).map((k) => [k.investor, betrag(k.abgerufen), betrag(k.eingezahlt ?? null), betrag(k.offen ?? null), betrag(k.ueberfaellig ?? null)]),
    kapitalkonten: kontoZeilen,
    kapitalkontenSumme: !einzeln,
    kapitalkontenHinweis: (einzeln ? t.lp.kapitalkontoEinzelHinweis.replace("{investor}", konten[0]!.investor) : t.lp.kapitalkontenHinweis) + (mitKosten ? ` ${t.lp.kostenHinweis}` : ""),
    kapitalkontenAusrichtung: ["left", "right", "right", "right", "right", "right", ...(mitKosten ? ["right"] : []), "right"],
    kapitalkontenBreiten: [1, null, null, null, null, null, ...(mitKosten ? [null] : []), null],
    ...portfolioTabelle(d, sprache, konfiguration),
    ...realisierungen(d, sprache, konfiguration.einheit),
    ...bewertungsMethoden(d, sprache, konfiguration.einheit),
    herkunft: gewaehlt.filter((k) => kennzahlen[k]!.herkunft).map((k) => herkunftsEintrag(kennzahlen[k]!.label, kennzahlen[k]!.herkunft!, kennzahlen[k]!.wert, sprache)),
  };
  return quelle(daten, LP_BERICHT);
}

function gremienDeal(deal: GremienDeal, sprache: Sprache, einheit: Einheit): TypstWert {
  const t = nachSprache(sprache);
  const betrag = (w: string | null) => formatBetrag(w, sprache, "EUR", einheit);
  const aktivitaeten = deal.aktivitaeten ?? [];
  const gesamt = deal.aktivitaetenGesamt ?? aktivitaeten.length;
  const sichtbar = aktivitaeten.slice(0, MAX_AKTIVITAETEN_GREMIEN);
  const art = (a: string) => t.gremien.aktivitaetArten[a as keyof Texte["gremien"]["aktivitaetArten"]] ?? a;
  return {
    titel: deal.titel,
    ticket: deal.ticket === null ? "–" : betrag(deal.ticket),
    eckdaten: [
      [t.unternehmen, deal.organisation.name],
      [t.sektor, deal.organisation.sektor ?? "–"],
      [t.gremien.ort, deal.organisation.ort ?? "–"],
      [t.fonds, deal.fonds ?? "–"],
      [t.gremien.quelle, deal.quelle ?? "–"],
      [t.gremien.betreuung, deal.betreuung ?? "–"],
    ],
    vorschlag: deal.beschlussvorschlag ? { text: deal.beschlussvorschlag.text, hinweis: deal.beschlussvorschlag.quelle === "vertagt" ? t.gremien.vorschlagVertagt : "" } : null,
    beschluesse: deal.beschluesse.map((b, i) => ({
      text:
        `${formatDatum(b.datum, sprache)} · ${b.gremium} · ${t.gremien.ergebnisse[b.ergebnis]}` +
        (b.ergebnis === "vertagt" && i === deal.beschluesse.length - 1 ? ` (${t.gremien.offen})` : "") +
        (b.betrag ? ` · ${betrag(b.betrag)}` : "") +
        (b.auflagen ? ` · ${t.gremien.auflagen}: ${b.auflagen}` : ""),
    })),
    aktivitaeten: sichtbar.map((a) => `${formatDatum(a.datum, sprache)} · ${art(a.art)} · ${a.titel}`),
    weitere: gesamt > sichtbar.length ? `+ ${gesamt - sichtbar.length} ${t.gremien.weitereAktivitaeten}` : "",
  };
}

export function gremienvorlageQuelle(d: GremienDaten, sprache: Sprache, optionen: BerichtsOptionen = {}): string {
  const t = nachSprache(sprache);
  const konfiguration = konfig("gremienvorlage", optionen);
  const betrag = (w: string | null) => formatBetrag(w, sprache, "EUR", konfiguration.einheit);
  // Ohne Zeitraum gibt es keinen Abschnitt „Beschlüsse des Zeitraums“.
  const abschnitte = konfiguration.abschnitte.filter((a) => a !== "beschluesse" || d.zeitraum !== undefined);
  const daten: Record<string, TypstWert> = {
    ...grundDaten(sprache, optionen),
    titel: `${t.gremien.titel} ${formatDatum(d.stichtag, sprache)}`,
    kopf: t.gremien.kopf,
    untertitel: optionen.entwurf === false ? t.gremien.untertitelFinal : t.gremien.untertitel,
    stichtag: formatDatum(d.stichtag, sprache),
    wissensstand: formatZeitpunkt(d.wissensstand, sprache),
    anzahl: String(d.deals.length),
    abschnitte,
    deals: d.deals.map((deal) => gremienDeal(deal, sprache, konfiguration.einheit)),
    zeitraumTitel: d.zeitraum ? `${t.gremien.zeitraum} (${formatDatum(d.zeitraum.von, sprache)} – ${formatDatum(d.zeitraum.bis, sprache)})` : t.gremien.zeitraum,
    beschluesseKopf: [t.datum, t.gremien.deal, t.gremien.gremium, t.gremien.ergebnis, t.betrag, t.gremien.auflagen],
    beschluesse: (d.beschluesseImZeitraum ?? []).map((b) => [formatDatum(b.datum, sprache), `${b.organisation} · ${b.deal}`, b.gremium, t.gremien.ergebnisse[b.ergebnis], b.betrag ? betrag(b.betrag) : "–", b.auflagen ?? ""]),
    beschluesseAusrichtung: ["left", "left", "left", "left", "right", "left"],
    beschluesseBreiten: [null, 1, null, null, null, 1],
  };
  return quelle(daten, GREMIENVORLAGE);
}

/** Portfolio- oder Exitliste als PDF (quer): Spalten und Einheit aus der Vorlage, Summenzeile, übersetzte Überschriften. */
function listenQuelle(art: "portfolioliste" | "exitliste", d: PortfolioListeDaten | ExitListeDaten, sprache: Sprache, optionen: BerichtsOptionen): string {
  const t = nachSprache(sprache);
  const konfiguration = konfig(art, optionen);
  const texte = t.listen[art];
  const waehrung = d.fonds.waehrung;
  let kopf: string[];
  let zeilen: string[][];
  let ausrichtung: string[];
  let breite: (number | null)[];
  if (art === "portfolioliste") {
    const pd = d as PortfolioListeDaten;
    const spalten = [
      ...mitWaehrungssicht(ausgewaehlt(portfolioSpalten(t), konfiguration.spalten), pd.waehrungssicht, SICHT_PORTFOLIO, t, sprache, konfiguration.einheit),
      ...zusatzSpalten<PortfolioListeDaten["zeilen"][number]>(pd.zusatzspalten, t, sprache),
    ];
    kopf = spalten.map((s) => s.kopf);
    zeilen = tabellenZeilen(spalten, (d as PortfolioListeDaten).zeilen, sprache, waehrung, konfiguration.einheit, t.summe);
    ausrichtung = ausrichtungen(spalten);
    breite = breiten(spalten);
  } else {
    const ed = d as ExitListeDaten;
    const spalten = [
      ...mitWaehrungssicht(ausgewaehlt(exitSpalten(t), konfiguration.spalten), ed.waehrungssicht, SICHT_EXIT, t, sprache, konfiguration.einheit),
      ...zusatzSpalten<ExitListeDaten["zeilen"][number]>(ed.zusatzspalten, t, sprache),
    ];
    kopf = spalten.map((s) => s.kopf);
    zeilen = tabellenZeilen(spalten, (d as ExitListeDaten).zeilen, sprache, waehrung, konfiguration.einheit, t.summe);
    ausrichtung = ausrichtungen(spalten);
    breite = breiten(spalten);
  }
  const daten: Record<string, TypstWert> = {
    ...grundDaten(sprache, optionen),
    titel: `${texte.titel} ${d.fonds.name} ${formatDatum(d.stichtag, sprache)}`,
    kopf: `${texte.kopf} · ${d.fonds.kurzname}`,
    titelText: texte.titel,
    untertitel: texte.untertitel,
    keine: texte.keine,
    stichtag: formatDatum(d.stichtag, sprache),
    wissensstand: formatZeitpunkt(d.wissensstand, sprache),
    fonds: d.fonds.name,
    einheit: konfiguration.einheit === "TEUR" ? `T${waehrung}` : waehrung,
    spaltenKopf: kopf,
    zeilen,
    ausrichtung,
    breiten: breite,
    hinweise: waehrungsHinweise(d.waehrungssicht, t, sprache),
  };
  return quelle(daten, LISTE);
}

export const portfoliolisteQuelle = (d: PortfolioListeDaten, sprache: Sprache, optionen: BerichtsOptionen = {}): string => listenQuelle("portfolioliste", d, sprache, optionen);
export const exitlisteQuelle = (d: ExitListeDaten, sprache: Sprache, optionen: BerichtsOptionen = {}): string => listenQuelle("exitliste", d, sprache, optionen);

const LOCALE = { de: "de-DE", en: "en-GB" } as const;

/** Wert einer PAI-Zeile mit höchstens fünf signifikanten Stellen; Anteile in Prozent mit dem Zeichen. `null` heißt keine Daten. */
export function paiWert(wert: string | null, einheit: string, sprache: Sprache): string {
  if (wert === null) return TEXTE[sprache].pai.keineDaten;
  const zahl = new Intl.NumberFormat(LOCALE[sprache], { maximumSignificantDigits: 5 }).format(wert as unknown as number);
  return einheit.startsWith("%") ? (sprache === "de" ? `${zahl} %` : `${zahl}%`) : zahl;
}

/** Text eines Befunds der PAI-Rechnung: Vorlage mit `{name}`, `{wert}`, `{stichtag}`, `{evic}`; Daten und Beträge unverändert. */
export function paiBefundText(b: PaiBefundBericht, sprache: Sprache): string {
  const vorlagen = nachSprache(sprache).pai.befundTexte as Record<string, string>;
  const vorlage = vorlagen[b.code] ?? b.code;
  const werte: Record<string, string> = { name: b.name ?? "", ...Object.fromEntries(Object.entries(b.params).map(([k, v]) => [k, k === "stichtag" ? formatDatum(String(v), sprache) : String(v)])) };
  return vorlage.replace(/\{(\w+)\}/g, (_, k: string) => werte[k] ?? "");
}

/** Gruppen der Tabelle 1 (Umwelt Nr. 1 bis 9, Soziales Nr. 10 bis 14) und die Zusatzindikatoren (Tabellen 2 und 3). */
export function paiGruppen(zeilen: readonly PaiZeileBericht[], sprache: Sprache): { titel: string; zeilen: PaiZeileBericht[] }[] {
  const p = nachSprache(sprache).pai;
  return [
    { titel: p.gruppeUmwelt, zeilen: zeilen.filter((z) => z.tabelle === 1 && z.nr <= 9) },
    { titel: p.gruppeSozial, zeilen: zeilen.filter((z) => z.tabelle === 1 && z.nr >= 10) },
    { titel: p.gruppeZusatz, zeilen: zeilen.filter((z) => z.tabelle !== 1) },
  ].filter((g) => g.zeilen.length > 0);
}

/** Metrik der Zeile mit Einheit (und Sektor bei der Energieintensität). */
export function paiMetrikText(z: PaiZeileBericht, sprache: Sprache): string {
  const metrik = sprache === "de" ? z.metrikDe : z.metrikEn;
  const sektor = z.sektor ? ` – ${z.sektor} ${sprache === "de" ? z.sektorBezeichnungDe ?? "" : z.sektorBezeichnungEn ?? ""}`.trimEnd() : "";
  return `${metrik}${sektor} [${z.einheit}]`;
}

export function paiErklaerungQuelle(d: PaiErklaerungDaten, sprache: Sprache, optionen: BerichtsOptionen = {}): string {
  const t = nachSprache(sprache);
  const p = t.pai;
  const konfiguration = konfig("pai_erklaerung", optionen);
  const frei = optionen.freitexte ?? {};
  const absaetze = (text: string | undefined) => (text ?? "").split(/\n{2,}/).map((a) => a.trim()).filter((a) => a !== "");
  const prozentAnteil = (anteil: string | null) => (anteil === null ? p.keineDaten : formatProzent(anteil, sprache));
  const einordnung = d.offenlegung ? `${p[d.offenlegung.art]} (${p.einordnungSeit} ${formatDatum(d.offenlegung.gueltigAb, sprache)})` : p.einordnungKeine;
  const gruppen = paiGruppen(d.zeilen, sprache).map((g) => ({
    titel: g.titel,
    zeilen: g.zeilen.map((z) => {
      const erster = g.zeilen.find((x) => x.indikator === z.indikator) === z;
      return [
        erster ? `${z.tabelle === 1 ? "" : `T${z.tabelle} `}${z.nr}` : "",
        erster ? (sprache === "de" ? z.bezeichnungDe : z.bezeichnungEn) : "",
        paiMetrikText(z, sprache),
        paiWert(z.wert, z.einheit, sprache),
        z.vorjahr ? paiWert(z.vorjahr.wert, z.einheit, sprache) : p.keineDaten,
        prozentAnteil(z.abdeckung),
        prozentAnteil(z.schaetzanteil),
        erster ? (frei[`erlaeuterung_${z.indikator}`] ?? "").trim() : "",
        erster ? (frei[`massnahmen_${z.indikator}`] ?? "").trim() : "",
      ];
    }),
  }));
  const daten: Record<string, TypstWert> = {
    ...grundDaten(sprache, optionen),
    titel: `${p.titel} ${d.fonds.name} ${d.jahr}`,
    kopf: `${p.kopf} · ${d.fonds.kurzname}`,
    titelText: p.kopf,
    untertitel: p.untertitel,
    stichtag: formatDatum(d.stichtag, sprache),
    wissensstand: formatZeitpunkt(d.wissensstand, sprache),
    fonds: d.fonds.name,
    jahr: String(d.jahr),
    katalog: String(d.katalogVersion),
    einordnung,
    abschnitte: konfiguration.abschnitte,
    vorbemerkung: absaetze(frei.vorbemerkung),
    tabellenKopf: [p.nr, p.indikator, p.metrik, `${p.auswirkung} ${d.jahr}`, `${p.auswirkung} ${d.jahr - 1}`, p.abdeckung, p.schaetzanteil, p.erlaeuterung, p.massnahmen],
    ausrichtung: ["left", "left", "left", "right", "right", "right", "right", "left", "left"],
    breiten: [null, 1.3, 1.8, null, null, null, null, 1.4, 1.4],
    gruppen,
    befunde: d.befunde.map((b) => paiBefundText(b, sprache)),
    herkunft: d.zeilen.map((z) =>
      herkunftsEintrag(
        `${z.tabelle === 1 ? "" : `T${z.tabelle} `}${z.nr} ${paiMetrikText(z, sprache)}`,
        {
          wert: z.wert,
          schritte: [
            ...z.quartale.map((q) => ({ zeichen: "", bezeichnung: `${p.quartal} ${formatDatum(q.stichtag, sprache)} · ${p.abdeckung} ${prozentAnteil(q.abdeckung)}`, wert: q.wert ?? p.keineDaten })),
            { zeichen: "=", bezeichnung: p.durchschnitt, wert: z.wert ?? p.keineDaten },
          ],
        },
        paiWert(z.wert, z.einheit, sprache),
        sprache,
      ),
    ),
  };
  return quelle(daten, PAI_ERKLAERUNG);
}

export const erzeugePaiErklaerung = (d: PaiErklaerungDaten, sprache: Sprache, optionen: BerichtsOptionen = {}): Uint8Array => setzePdf(paiErklaerungQuelle(d, sprache, optionen));

export const erzeugeQuartalsbericht = (d: QuartalsberichtDaten, sprache: Sprache, optionen: BerichtsOptionen = {}): Uint8Array => setzePdf(quartalsberichtQuelle(d, sprache, optionen));
export const erzeugeFondsbericht = (d: FondsberichtDaten, sprache: Sprache, optionen: BerichtsOptionen = {}): Uint8Array => setzePdf(fondsberichtQuelle(d, sprache, optionen));
export const erzeugeLpBericht = (d: LpBerichtDaten, sprache: Sprache, optionen: BerichtsOptionen = {}): Uint8Array => setzePdf(lpBerichtQuelle(d, sprache, optionen));
export const erzeugeGremienvorlage = (d: GremienDaten, sprache: Sprache, optionen: BerichtsOptionen = {}): Uint8Array => setzePdf(gremienvorlageQuelle(d, sprache, optionen));
export const erzeugePortfolioListePdf = (d: PortfolioListeDaten, sprache: Sprache, optionen: BerichtsOptionen = {}): Uint8Array => setzePdf(portfoliolisteQuelle(d, sprache, optionen));
export const erzeugeExitListePdf = (d: ExitListeDaten, sprache: Sprache, optionen: BerichtsOptionen = {}): Uint8Array => setzePdf(exitlisteQuelle(d, sprache, optionen));
