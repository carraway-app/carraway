import { kappeParams, type Befund, type BefundParams } from "../lesen";
import { BLATT_NAMEN, type Blatt } from "../spec";
import type { Blattzeilen } from "../vorlage";
import { Decimal } from "@carraway/rechenkern";
import { STANDARD_ZUSAMMENFUEHRUNG, type Gelesen, type Zusammenfuehrung } from "./adapter";
import type { KontrollGroesse, QuellFonds, Quellbestand } from "./modell";
import { fasseZusammen } from "./perioden";
import { fuehreZusammen, type Umleitung } from "./zusammenfuehren";

/**
 * Bildet den zusammengeführten Bestand auf die Blätter der Importvorlage ab. Jeder Fachschlüssel ist `<quelle>:<quell-id>`; über ihn
 * findet ein erneuter Lauf, was er schon angelegt hat (`import_zuordnung`), und legt nichts doppelt an. Was das Importformat nicht
 * aufnehmen kann oder was die Abnahme sehen soll (zusammengeführte Unternehmen), steht als Befund neben den Zeilen.
 */

export interface Abbildung {
  /** ID des Adapters; Präfix aller Fachschlüssel. */
  quelle: string;
  /** Kurzname je Quell-ID eines Fonds (z. B. für einen Fonds, den es schon gibt); ohne Angabe der Kurzname der Quelle oder ihr Name. */
  fondsKurzname?: Record<string, string>;
  /** Je Quell-ID eines Unternehmens: ID einer vorhandenen Organisation oder `neu` (trotz ähnlichem Namen neu anlegen). */
  organisationen?: Record<string, string>;
  /** Quell-IDs von Unternehmen, die nicht mit anderen zusammengeführt werden (und trotz ähnlichem Namen neu entstehen). */
  getrennt?: string[];
  /** Regel für wiederholte Ereignisse; Standard `STANDARD_ZUSAMMENFUEHRUNG`. */
  zusammenfuehrung?: Zusammenfuehrung;
  /** Zuordnung der Kennzahlen der Quelle (Name oder Schlüssel) zum Schlüssel im Katalog; nicht zugeordnete werden gemeldet, nicht übernommen. */
  kennzahlen?: Record<string, string>;
}

export interface Abgebildet {
  bestand: Quellbestand;
  zeilen: Blattzeilen;
  befunde: Befund[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_KURZNAME = 60;

/** Fachschlüssel eines Objekts der Quelle. */
export const quellSchluessel = (quelle: string, id: string) => `${quelle}:${id}`;

const mitWerten = (z: Record<string, string | undefined>): Record<string, string> => Object.fromEntries(Object.entries(z).filter(([, v]) => v !== undefined && v !== "")) as Record<string, string>;

export class Abbilder {
  readonly zeilen: Blattzeilen = {};
  readonly befunde: Befund[] = [];
  constructor(readonly a: Abbildung) {}

  key(id: string) {
    return quellSchluessel(this.a.quelle, id);
  }

  zeile(blatt: Blatt, werte: Record<string, string | undefined>): number {
    const liste = (this.zeilen[blatt] ??= []);
    liste.push(mitWerten(werte));
    return liste.length + 1; // Zeile 1 ist der Kopf
  }

  melde(blatt: Blatt, zeile: number | null, code: string, meldung: string, params: BefundParams = {}) {
    this.befunde.push({ blatt, blattName: BLATT_NAMEN[blatt].de, zeile, spalte: null, code, schweregrad: "warnung", meldung, params: kappeParams(params) });
  }
}

function kurzname(a: Abbildung, f: QuellFonds): string {
  return (a.fondsKurzname?.[f.quellId] ?? f.kurzname ?? f.name).trim().slice(0, MAX_KURZNAME);
}

/** Fonds, Unternehmen, Personen und Beteiligungen (Stammdaten). */
function stammdaten(x: Abbilder, b: Quellbestand, umleitungen: Umleitung[], alleFonds: readonly QuellFonds[]): { fondsKurz: Map<string, string>; instrumentVon: Map<string, string> } {
  // Auch nicht gewählte Fonds bekommen ihren Kurznamen (Positionen in Runden verweisen auf sie; sie müssen dann im Bestand stehen).
  const fondsKurz = new Map([...alleFonds, ...b.fonds].map((f) => [f.quellId, kurzname(x.a, f)]));
  for (const f of b.fonds) x.zeile("fonds", { fonds_kurzname: fondsKurz.get(f.quellId), name: f.name, vintage: String(f.vintage), zeichnungskapital: f.zeichnungskapital, waehrung: f.waehrung });

  const zeileVonOrg = new Map<string, number>();
  for (const o of b.organisationen) {
    const vorgabe = x.a.organisationen?.[o.quellId];
    const zeile = x.zeile("organisationen", {
      organisation_schluessel: x.key(o.quellId),
      name: o.name,
      art: o.art ?? "unternehmen",
      sektor: o.sektor,
      ort: o.ort,
      website: o.website && /^https?:\/\//i.test(o.website) ? o.website : o.website ? `https://${o.website}` : undefined,
      bestehende_id: vorgabe && UUID.test(vorgabe) ? vorgabe.toLowerCase() : undefined,
      dublette_bestaetigt: vorgabe === "neu" || x.a.getrennt?.includes(o.quellId) ? "ja" : undefined,
    });
    zeileVonOrg.set(o.quellId, zeile);
  }
  for (const u of umleitungen.filter((u) => u.art === "organisation")) {
    x.melde("organisationen", zeileVonOrg.get(u.nach) ?? null, "VORSYSTEM_ZUSAMMENGEFUEHRT", `Das Unternehmen „${u.von}“ der Quelle ist dasselbe wie „${u.nach}“ (${u.grund}) und wird nur einmal übernommen.`, { von: u.von, nach: u.nach, grund: u.grund });
  }

  for (const p of b.personen) {
    x.zeile("personen", { person_schluessel: x.key(p.quellId), vorname: p.vorname, nachname: p.nachname, email: p.email, funktion: p.funktion, organisation_schluessel: p.organisationId ? x.key(p.organisationId) : undefined });
  }

  // Eine Zeile je Instrument. Gleiche Art am selben Unternehmen im selben Fonds braucht eine eindeutige Bezeichnung.
  const gezaehlt = new Map<string, number>();
  const jeBeteiligung = new Map<string, number>();
  for (const bt of b.beteiligungen) {
    const k = `${bt.fondsId}|${bt.organisationId}|${bt.instrument}`;
    gezaehlt.set(k, (gezaehlt.get(k) ?? 0) + 1);
    jeBeteiligung.set(`${bt.fondsId}|${bt.organisationId}`, (jeBeteiligung.get(`${bt.fondsId}|${bt.organisationId}`) ?? 0) + 1);
  }
  // Hat die Beteiligung (Fonds, Unternehmen) mehrere Instrumente, nennen Vorgänge ihr Instrument (Bezeichnung oder Art).
  const instrumentVon = new Map<string, string>();
  for (const bt of b.beteiligungen) {
    const mehrfach = (gezaehlt.get(`${bt.fondsId}|${bt.organisationId}|${bt.instrument}`) ?? 0) > 1;
    const bezeichnung = mehrfach ? `${bt.bezeichnung ?? bt.instrument} (${bt.quellId})` : bt.bezeichnung;
    if ((jeBeteiligung.get(`${bt.fondsId}|${bt.organisationId}`) ?? 0) > 1) instrumentVon.set(bt.quellId, bezeichnung ?? bt.instrument);
    x.zeile("beteiligungen", {
      beteiligung_schluessel: x.key(bt.quellId),
      fonds_kurzname: fondsKurz.get(bt.fondsId),
      organisation_schluessel: x.key(bt.organisationId),
      instrument: bt.instrument,
      bezeichnung,
      erstinvestment: bt.erstinvestment,
      status: bt.status,
    });
  }
  return { fondsKurz, instrumentVon };
}

/** Runden mit Positionen (Fonds oder dritter Investor). */
function runden(x: Abbilder, b: Quellbestand, fondsKurz: Map<string, string>) {
  for (const r of b.runden) {
    x.zeile("finanzierungsrunden", { runde_schluessel: x.key(r.quellId), organisation_schluessel: x.key(r.organisationId), bezeichnung: r.bezeichnung, datum: r.datum, pre_money: r.preMoney, post_money: r.postMoney, preis_je_anteil: r.preisJeAnteil, anteile_gesamt_nach: String(r.anteileGesamtNach) });
    for (const p of r.positionen) {
      x.zeile("rundenpositionen", { runde_schluessel: x.key(r.quellId), fonds_kurzname: p.fondsId ? (fondsKurz.get(p.fondsId) ?? x.key(p.fondsId)) : undefined, investor_schluessel: p.investorId ? x.key(p.investorId) : undefined, betrag: p.betrag, anteile: String(p.anteile), rolle: p.rolle });
    }
  }
}

const GROESSE_DER_ART: Partial<Record<string, KontrollGroesse>> = { zusage: "zusagen", auszahlung: "auszahlungen", rueckfluss: "rueckfluesse" };

/**
 * Vorgänge (wiederholte Ereignisse je Periode zusammengeführt) und Kontrollsummen. Wandlungen werden nicht gebucht, sondern gemeldet.
 * Fehlen Summen der Quelle, entstehen sie aus den einzelnen Ereignissen der Quelle vor dem Zusammenführen, je Beteiligung und je Fonds;
 * so prüft das Abnahmeprotokoll, dass beim Zusammenführen und Abbilden kein Betrag verloren ging.
 */
function vorgaenge(x: Abbilder, b: Quellbestand, fondsKurz: Map<string, string>, instrumentVon: Map<string, string>) {
  const beteiligung = new Map(b.beteiligungen.map((bt) => [bt.quellId, bt]));
  const runden = new Set(b.runden.map((r) => r.quellId));
  const wandlungen = new Set(b.vorgaenge.filter((v) => v.art === "wandlung").map((v) => v.quellId));
  for (const v of b.vorgaenge.filter((v) => v.art === "wandlung")) {
    x.melde("vorgaenge", null, "VORSYSTEM_WANDLUNG", `Die Wandlung „${v.quellId}“ über ${v.betrag} am ${v.datum} wird nicht automatisch übernommen; bitte über die Wandlung der Beteiligung nachtragen.`, { quellId: v.quellId, betrag: v.betrag, datum: v.datum });
  }
  const buchbar = b.vorgaenge.filter((v) => !wandlungen.has(v.quellId) && !(v.storniertId && wandlungen.has(v.storniertId)) && beteiligung.has(v.beteiligungId));
  const regel = x.a.zusammenfuehrung ?? STANDARD_ZUSAMMENFUEHRUNG;
  const sammel = fasseZusammen(buchbar, regel).sort((p, q) => p.datum.localeCompare(q.datum) || p.quellId.localeCompare(q.quellId));
  for (const v of sammel) {
    const herkunft = v.quellId.startsWith("periode:") ? `${x.a.quelle}: ${v.quellIds.length} × (${v.quellIds.join(", ")})` : undefined;
    x.zeile("vorgaenge", {
      vorgang_schluessel: x.key(v.quellId),
      beteiligung_schluessel: x.key(v.beteiligungId),
      art: v.art,
      valuta: v.datum,
      betrag: new Decimal(v.betrag).toFixed(2),
      bemerkung: [v.bemerkung, herkunft].filter(Boolean).join(" · ").slice(0, 1000) || undefined,
      kapitalisiert: v.kapitalisiert ? "ja" : undefined,
      instrument: v.instrument ?? instrumentVon.get(v.beteiligungId),
      storniert_vorgang_schluessel: v.storniertId ? x.key(v.storniertId) : undefined,
      runde_schluessel: v.rundeId && runden.has(v.rundeId) ? x.key(v.rundeId) : undefined,
    });
  }

  // Kontrollsummen: Summen der Quelle; je Beteiligung (Fonds, Unternehmen) über alle Instrumente zusammengefasst.
  const ersteDerBeteiligung = new Map<string, string>();
  for (const bt of b.beteiligungen) if (!ersteDerBeteiligung.has(`${bt.fondsId}|${bt.organisationId}`)) ersteDerBeteiligung.set(`${bt.fondsId}|${bt.organisationId}`, bt.quellId);
  const zielBeteiligung = (id: string) => {
    const bt = beteiligung.get(id);
    return bt ? ersteDerBeteiligung.get(`${bt.fondsId}|${bt.organisationId}`)! : undefined;
  };
  const summen = new Map<string, { fondsId: string; beteiligungId?: string; groesse: KontrollGroesse; betrag: Decimal; stichtag?: string }>();
  const addiere = (fondsId: string, beteiligungId: string | undefined, groesse: KontrollGroesse, betrag: string, stichtag?: string) => {
    const k = [fondsId, beteiligungId ?? "", groesse, stichtag ?? ""].join("|");
    const bisher = summen.get(k);
    if (bisher) bisher.betrag = bisher.betrag.plus(betrag);
    else summen.set(k, { fondsId, ...(beteiligungId ? { beteiligungId } : {}), groesse, betrag: new Decimal(betrag), ...(stichtag ? { stichtag } : {}) });
  };
  const geliefert = new Set<string>();
  for (const s of b.kontrollsummen) {
    const ziel = s.beteiligungId ? zielBeteiligung(s.beteiligungId) : undefined;
    if (s.beteiligungId && !ziel) continue;
    addiere(s.fondsId, ziel, s.groesse, s.betrag, s.stichtag);
    geliefert.add([s.fondsId, ziel ?? "", s.groesse].join("|"));
  }
  const berechnet = new Map<string, Decimal>();
  for (const v of b.vorgaenge) {
    const groesse = GROESSE_DER_ART[v.art];
    const bt = beteiligung.get(v.beteiligungId);
    if (!groesse || !bt) continue;
    for (const k of [[bt.fondsId, zielBeteiligung(bt.quellId)!, groesse], [bt.fondsId, "", groesse]].map((t) => t.join("|"))) berechnet.set(k, (berechnet.get(k) ?? new Decimal(0)).plus(v.betrag));
  }
  for (const [k, betrag] of berechnet) {
    if (geliefert.has(k)) continue;
    const [fondsId, beteiligungId, groesse] = k.split("|") as [string, string, KontrollGroesse];
    addiere(fondsId, beteiligungId || undefined, groesse, betrag.toFixed(2));
  }
  for (const s of summen.values()) {
    if (!fondsKurz.has(s.fondsId) || !b.fonds.some((f) => f.quellId === s.fondsId)) continue;
    x.zeile("kontrollsummen", { fonds_kurzname: fondsKurz.get(s.fondsId), groesse: s.groesse, betrag: s.betrag.toFixed(2), stichtag: s.stichtag, beteiligung_schluessel: s.beteiligungId ? x.key(s.beteiligungId) : undefined });
  }
}

/** Erste Beteiligung (Instrument) je Fonds und Unternehmen: Kennzahlen und Bewertungen gelten der Beteiligung, nicht dem Instrument. */
function ersteJeBeteiligung(b: Quellbestand) {
  const erste = new Map<string, string>();
  for (const bt of b.beteiligungen) if (!erste.has(`${bt.fondsId}|${bt.organisationId}`)) erste.set(`${bt.fondsId}|${bt.organisationId}`, bt.quellId);
  return erste;
}

/** Bewertungen mit Stichtag und Methode; mehrere Instrumente derselben Beteiligung zum selben Stichtag ergeben eine Bewertung (Summe). */
function bewertungen(x: Abbilder, b: Quellbestand) {
  const erste = ersteJeBeteiligung(b);
  const beteiligung = new Map(b.beteiligungen.map((bt) => [bt.quellId, bt]));
  const je = new Map<string, { quellId: string; beteiligungId: string; stichtag: string; wert: Decimal; methode: string; begruendung?: string; grundlage?: string }>();
  for (const v of b.bewertungen) {
    const bt = beteiligung.get(v.beteiligungId);
    if (!bt) continue;
    const ziel = erste.get(`${bt.fondsId}|${bt.organisationId}`)!;
    const k = `${ziel}|${v.stichtag}`;
    const bisher = je.get(k);
    if (bisher) bisher.wert = bisher.wert.plus(v.wert);
    else je.set(k, { quellId: v.quellId, beteiligungId: ziel, stichtag: v.stichtag, wert: new Decimal(v.wert), methode: v.methode, ...(v.begruendung ? { begruendung: v.begruendung } : {}), ...(v.grundlage ? { grundlage: v.grundlage } : {}) });
  }
  for (const v of je.values()) {
    x.zeile("bewertungen", {
      bewertung_schluessel: x.key(v.quellId),
      beteiligung_schluessel: x.key(v.beteiligungId),
      stichtag: v.stichtag,
      wert: v.wert.toFixed(2),
      methode: v.methode,
      begruendung: v.begruendung ?? (v.methode === "anschaffungskosten" ? undefined : `Übernommen aus ${x.a.quelle}`),
      grundlage: v.grundlage,
    });
  }
}

/** Kennzahlen mit Periode und Szenario, zugeordnet zum Katalog; je Beteiligung des Unternehmens ein Wert. */
function kennzahlen(x: Abbilder, b: Quellbestand) {
  const erste = ersteJeBeteiligung(b);
  const ohne = new Map<string, number>();
  for (const k of b.kennzahlen) {
    const ziel = x.a.kennzahlen?.[k.kennzahl];
    if (!ziel) {
      ohne.set(k.kennzahl, (ohne.get(k.kennzahl) ?? 0) + 1);
      continue;
    }
    for (const [schluessel, beteiligungId] of erste) {
      if (!schluessel.endsWith(`|${k.organisationId}`)) continue;
      x.zeile("kennzahlen", { kennzahl_wert_schluessel: x.key(`${k.quellId}:${beteiligungId}`), beteiligung_schluessel: x.key(beteiligungId), kennzahl: ziel, periode_beginn: k.periodeBeginn, periode_ende: k.periodeEnde, szenario: k.szenario, wert: k.wert });
    }
  }
  for (const [kennzahl, anzahl] of ohne) {
    x.melde("kennzahlen", null, "VORSYSTEM_KENNZAHL_OHNE_ZUORDNUNG", `Die Kennzahl „${kennzahl}“ der Quelle ist keiner Kennzahl des Katalogs zugeordnet; ihre ${anzahl} Werte werden nicht übernommen.`, { kennzahl, anzahl });
  }
}

/** Führt die Auszüge zusammen und bildet sie auf die Blätter der Importvorlage ab. */
export function bildeAb(gelesen: Gelesen, a: Abbildung): Abgebildet {
  const { bestand, umleitungen } = fuehreZusammen(gelesen.auszuege, { getrennt: a.getrennt });
  const x = new Abbilder(a);
  const { fondsKurz, instrumentVon } = stammdaten(x, bestand, umleitungen, gelesen.alleFonds);
  runden(x, bestand, fondsKurz);
  vorgaenge(x, bestand, fondsKurz, instrumentVon);
  bewertungen(x, bestand);
  kennzahlen(x, bestand);
  return { bestand, zeilen: x.zeilen, befunde: x.befunde };
}
