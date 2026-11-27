import { and, asc, desc, eq, inArray, isNull, lte } from "drizzle-orm";
import { anteilsklasse, anteilsuebertragung, beteiligung, finanzierungsrunde, fonds, instrument, mitarbeiterpool, mitarbeiterzuteilung, optionsscheinAusuebung, organisation, poolAenderung, rundenposition, vehikel } from "@carraway/db";
import { aufCent, aufteilung, Decimal, einheitenBeimExit, optionsscheinStand, vergleiche, wendeUebertragungenAn, type Anteilsklasse as KernKlasse, type Inhaberzeile, type Rechenschritt } from "@carraway/rechenkern";
import { Fachfehler } from "../fehler";
import { kernZuteilung, ladeAustritte, mitAustritten, standDesPools } from "./pool";
import type { Tx } from "../zeitlimit";

/**
 * Kapitaltabelle und Eingabe des Exit-Wasserfalls (Etappe 10): Die Runden eines Unternehmens bis zu einem Datum, deren Positionen
 * (Fonds dieser Plattform oder Vehikel von Co-Investoren) mit Anteilsklasse, dazu die Stammanteile von Gründung und Übrigen als Rest
 * zur Gesamtzahl der Anteile nach der letzten Runde. Das sind die ausgegebenen Anteile (unverwässert).
 *
 * Mitarbeiterbeteiligung: Ausgeübte ESOP-Optionen mit Datum nach der letzten Runde sind zusätzliche ausgegebene Anteile (vorher stecken sie
 * in der Gesamtzahl der Runde). Voll verwässert kommen je Pool die ausstehenden Zuteilungen und der freie Pool hinzu (ESOP und VSOP).
 * Der Wasserfall bekommt je Zuteilung die zum Exit gevesteten oder beschleunigten Einheiten mit ihrem Basispreis; der freie Pool und
 * ungevestete Einheiten nehmen am Erlös nicht teil. Alles wird gelesen, nichts geschrieben.
 *
 * Optionsscheine eines Fonds (Issue 150): Ausgeübte Anteile sind ab dem Tag der Ausübung ausgegebene Anteile des Fonds (Zeile `ausuebung:<id>`, Klasse des
 * Instruments); liegt die Ausübung am oder vor der letzten Runde, sind sie in deren Gesamtzahl enthalten (sie mindern die Stammanteile), danach kommen sie
 * hinzu (wie ausgeübte ESOP-Optionen). Nicht ausgeübte Optionsscheine in der Laufzeit stehen voll verwässert (`optionsschein:<instrumentId>`, nicht
 * ausgegeben) und gehen mit dem Ausübungspreis als Basispreis in den Wasserfall (wie eine Option, ohne Klasse).
 *
 * Anteilsübertragungen (Issue 151): nach allen anderen Zeilen in der Reihenfolge Datum, Erfassung angewandt (Rechenkern `wendeUebertragungenAn`). Die Quelle
 * gibt Anteile und anteilige Präferenzbasis ab, der Käufer bekommt eine Zeile `uebertragung:<id>` mit Klasse und Runde der Quelle. Die Gesamtzahl bleibt.
 * Zeilen, die danach keine Anteile mehr haben, entfallen. Übertragungen, die nicht aufgehen (Quelle fehlt oder hält zu wenig), bleiben außen vor und stehen
 * in `uebertragungFehler` (das Schreiben prüft das vorher).
 */

export const STAMM_ID = "stamm";

export interface Halter {
  /**
   * `stamm`: Gründer und übrige Anteile ohne Rundenposition. `organisation`: der Investor (Organisation) hinter dem Vehikel.
   * Mitarbeiterbeteiligung (ID und Name des Pools): `ausgeuebt` (ausgeübte Optionen nach der letzten Runde, ausgegeben), `pool_zugeteilt`
   * und `pool_frei` (nur voll verwässert), `mitarbeiter` (eine Zuteilung im Wasserfall). `wandlung`: geschätzte Anteile aus einer offenen Wandlung
   * (ID des Wandeldarlehens, nur in der Kapitaltabelle mit `offeneWandlungen`).
   */
  art: "fonds" | "organisation" | "stamm" | "ausgeuebt" | "pool_zugeteilt" | "pool_frei" | "mitarbeiter" | "wandlung" | "optionsschein";
  id: string | null;
  name: string;
  /** Vehikel einer Position Dritter, sonst `null`. */
  vehikel: { id: string; name: string } | null;
}

/** `unverwaessert`: nur ausgegebene Anteile; `voll_verwaessert`: dazu der Pool der Mitarbeiterbeteiligung (zugeteilt und frei). */
export type Sicht = "unverwaessert" | "voll_verwaessert";

export interface KapitalZeile {
  /** ID der Rundenposition, bei den Stammanteilen `stamm`. */
  id: string;
  halter: Halter;
  klasseId: string | null;
  runde: { id: string; bezeichnung: string; datum: string } | null;
  anteile: string;
  investiert: string;
  diesesFonds: boolean;
  /** Ausgegebene Anteile (zählen unverwässert); `false` beim Pool der Mitarbeiterbeteiligung und bei nicht ausgeübten Optionsscheinen. */
  ausgegeben: boolean;
  /** Beginn der Verzinsung einer Präferenz, wenn die Zeile keine Runde hat (ausgeübte Optionsscheine: Tag der Ausübung). */
  datum?: string | null;
  /** Nur Zeilen aus einer Übertragung: die Übertragung, ihr Kaufpreis und die abgebende Zeile. */
  uebertragung?: { id: string; datum: string; preisJeAnteil: string; kaufpreis: string; quelleId: string; schritte: Rechenschritt[]; /** Fonds der abgebenden Zeile (nur für die Sichtbarkeit, nicht in der Antwort). */ verkaeuferFondsId: string | null } | null;
}

/** Nicht ausgeübte Optionsscheine zum Stichtag für den Wasserfall (ID `optionsschein:<instrumentId>`, wie die Zeile der Kapitaltabelle). */
export interface OptionsscheinZeile {
  id: string;
  instrumentId: string;
  fondsId: string;
  name: string;
  anteile: string;
  ausuebungspreis: string;
  laufzeitBis: string | null;
}

/**
 * Zuteilung der Mitarbeiterbeteiligung für den Wasserfall (je Zuteilung eine Zeile, ID `zuteilung:<id>`; bei grober Erfassung eine Zeile je Pool,
 * ID `pool:<id>:grob`, ohne Zuteilung). Kennung und Name der Begünstigten stehen hier nie.
 */
export interface MitarbeiterZeile {
  id: string;
  zuteilungId: string | null;
  pool: { id: string; bezeichnung: string; art: "esop" | "vsop"; regel: "wie_anteile" | "anteilig" };
  kategorie: string;
  bezeichnung: string | null;
  anzahl: string;
  basispreis: string;
  /** Einheiten, die zum Stichtag (Exit) am Erlös teilnehmen: gevestet plus beschleunigt. */
  einheiten: string;
}

export type KlasseZeile = typeof anteilsklasse.$inferSelect;

export interface Kapital {
  organisation: { id: string; name: string };
  stichtag: string;
  letzteRunde: { id: string; bezeichnung: string; datum: string; postMoney: string; preisJeAnteil: string } | null;
  /** Ausgegebene Anteile (unverwässert): nach der letzten Runde plus danach ausgeübte Optionen; 0 ohne Runde. */
  anteileGesamt: string;
  /** Ausgegebene Anteile plus Pool der Mitarbeiterbeteiligung (zugeteilt und frei). */
  anteileVollVerwaessert: string;
  zeilen: KapitalZeile[];
  /** Klassen, die in den Positionen vorkommen. */
  klassen: KlasseZeile[];
  /** Zuteilungen der Mitarbeiterbeteiligung bis zum Stichtag (für den Wasserfall). */
  mitarbeiter: MitarbeiterZeile[];
  /** Nicht ausgeübte Optionsscheine der Fonds dieser Plattform in der Laufzeit (für den Wasserfall; nur mit einer Runde). */
  optionsscheine: OptionsscheinZeile[];
  /** Übertragungen bis zum Stichtag, die nicht aufgehen (sie sind nicht angewandt). */
  uebertragungFehler: { uebertragungId: string; grund: "quelle_fehlt" | "zu_viele_anteile"; verfuegbar: string }[];
}

/** Lädt Runden und Positionen des Unternehmens der Beteiligung bis `stichtag` (einschließlich). */
export async function ladeKapital(tx: Tx, b: { fondsId: string; organisationId: string }, stichtag: string): Promise<Kapital> {
  const [org] = await tx.select({ id: organisation.id, name: organisation.name }).from(organisation).where(eq(organisation.id, b.organisationId));
  if (!org) throw new Fachfehler(404, "organization_not_found", "Organization not found.");
  const runden = await tx
    .select()
    .from(finanzierungsrunde)
    .where(and(eq(finanzierungsrunde.organisationId, b.organisationId), lte(finanzierungsrunde.datum, stichtag), eq(finanzierungsrunde.status, "abgeschlossen"), eq(finanzierungsrunde.art, "eigenkapital")))
    .orderBy(desc(finanzierungsrunde.datum), desc(finanzierungsrunde.erstelltAm), desc(finanzierungsrunde.id));
  const letzte = runden[0] ?? null;
  const klassen = await tx.select().from(anteilsklasse).where(eq(anteilsklasse.organisationId, b.organisationId)).orderBy(asc(anteilsklasse.rang), asc(anteilsklasse.name));
  const positionen = await tx
    .select({
      p: rundenposition,
      runde: finanzierungsrunde,
      fondsName: fonds.name,
      organisationId: organisation.id,
      organisationName: organisation.name,
      vehikelName: vehikel.name,
    })
    .from(rundenposition)
    .innerJoin(finanzierungsrunde, eq(finanzierungsrunde.id, rundenposition.rundeId))
    .leftJoin(fonds, eq(fonds.id, rundenposition.fondsId))
    .leftJoin(vehikel, eq(vehikel.id, rundenposition.vehikelId))
    .leftJoin(organisation, eq(organisation.id, vehikel.investorId))
    .where(and(eq(finanzierungsrunde.organisationId, b.organisationId), lte(finanzierungsrunde.datum, stichtag), eq(finanzierungsrunde.status, "abgeschlossen"), eq(finanzierungsrunde.art, "eigenkapital")))
    .orderBy(asc(finanzierungsrunde.datum), asc(finanzierungsrunde.erstelltAm), asc(finanzierungsrunde.id), asc(rundenposition.id));

  const zeilen: KapitalZeile[] = positionen.map(({ p, runde, fondsName, organisationId, organisationName, vehikelName }) => ({
    id: p.id,
    halter: p.fondsId
      ? { art: "fonds", id: p.fondsId, name: fondsName ?? "", vehikel: null }
      : { art: "organisation", id: organisationId, name: organisationName ?? "", vehikel: p.vehikelId ? { id: p.vehikelId, name: vehikelName ?? "" } : null },
    klasseId: p.anteilsklasseId,
    runde: { id: runde.id, bezeichnung: runde.bezeichnung, datum: runde.datum },
    anteile: p.anteile,
    investiert: p.betrag,
    diesesFonds: p.fondsId === b.fondsId,
    ausgegeben: true,
  }));
  const rundenGesamt = new Decimal(letzte?.anteileGesamtNach ?? 0);
  const inRunden = zeilen.reduce((s, z) => s.plus(z.anteile), new Decimal(0));
  const os = await ladeOptionsscheine(tx, b, stichtag, letzte?.datum ?? null);
  // Ausübungen am oder vor der letzten Runde stecken in deren Gesamtzahl: Sie gehören nicht zu den Stammanteilen.
  const rest = Decimal.max(0, rundenGesamt.minus(inRunden).minus(os.inRundenGesamt));
  if (letzte && rest.greaterThan(0)) {
    zeilen.unshift({ id: STAMM_ID, halter: { art: "stamm", id: null, name: "", vehikel: null }, klasseId: null, runde: null, anteile: rest.toFixed(0), investiert: "0.00", diesesFonds: false, ausgegeben: true });
  }
  const mp = await ladeMitarbeiterbeteiligung(tx, b.organisationId, stichtag, letzte?.datum ?? null);
  zeilen.push(...mp.ausgegeben, ...os.ausgeuebt);
  const gesamt = rundenGesamt.plus(mp.ausgegeben.reduce((s, z) => s.plus(z.anteile), new Decimal(0))).plus(os.nachRunde);
  const uebertragen = await wendeUebertragungenAnKapital(tx, b, stichtag, zeilen);
  const benutzt = new Set(uebertragen.zeilen.map((z) => z.klasseId).filter((x): x is string => x !== null));
  // Den Pool und offene Optionsscheine gibt es voll verwässert nur mit einer Runde (sonst fehlt die Bezugsgröße der ausgegebenen Anteile).
  const pool = letzte ? mp.pool : [];
  const offene = letzte ? os.offen : [];
  const offenZeilen: KapitalZeile[] = offene.map((o) => ({ id: o.id, halter: { art: "optionsschein", id: o.instrumentId, name: o.name, vehikel: null }, klasseId: null, runde: null, anteile: o.anteile, investiert: "0.00", diesesFonds: o.fondsId === b.fondsId, ausgegeben: false }));
  const alle = [...uebertragen.zeilen, ...pool, ...offenZeilen];
  return {
    organisation: org,
    stichtag,
    letzteRunde: letzte ? { id: letzte.id, bezeichnung: letzte.bezeichnung, datum: letzte.datum, postMoney: letzte.postMoney!, preisJeAnteil: letzte.preisJeAnteil! } : null,
    anteileGesamt: gesamt.toFixed(0),
    anteileVollVerwaessert: gesamt.plus([...pool, ...offenZeilen].reduce((s, z) => s.plus(z.anteile), new Decimal(0))).toFixed(0),
    zeilen: alle,
    klassen: klassen.filter((k) => benutzt.has(k.id)),
    mitarbeiter: letzte ? mp.mitarbeiter : [],
    optionsscheine: offene,
    uebertragungFehler: uebertragen.fehler,
  };
}

/**
 * Optionsscheine der Fonds dieser Plattform am Unternehmen zum Stichtag: ausgeübte Anteile als ausgegebene Zeilen (vor oder nach der letzten Runde) und
 * je Instrument die offenen (Rechenkern `optionsscheinStand`). Investiert einer Ausübung ist Anzahl × Ausübungspreis in der Währung des Unternehmens.
 */
async function ladeOptionsscheine(tx: Tx, b: { fondsId: string; organisationId: string }, stichtag: string, letzteRunde: string | null) {
  const instrumente = await tx
    .select({ i: instrument, fondsId: fonds.id, fondsName: fonds.name })
    .from(instrument)
    .innerJoin(beteiligung, eq(beteiligung.id, instrument.beteiligungId))
    .innerJoin(fonds, eq(fonds.id, beteiligung.fondsId))
    .where(and(eq(beteiligung.organisationId, b.organisationId), eq(instrument.art, "optionsschein")))
    .orderBy(asc(instrument.erstelltAm), asc(instrument.id));
  const leer = { ausgeuebt: [] as KapitalZeile[], offen: [] as OptionsscheinZeile[], inRundenGesamt: new Decimal(0), nachRunde: new Decimal(0) };
  if (instrumente.length === 0) return leer;
  const ausuebungen = await tx
    .select()
    .from(optionsscheinAusuebung)
    .where(and(inArray(optionsscheinAusuebung.instrumentId, instrumente.map((x) => x.i.id)), isNull(optionsscheinAusuebung.storniertAm)))
    .orderBy(asc(optionsscheinAusuebung.datum), asc(optionsscheinAusuebung.erfasstAm), asc(optionsscheinAusuebung.id));
  for (const { i, fondsId, fondsName } of instrumente) {
    const eigene = ausuebungen.filter((a) => a.instrumentId === i.id);
    for (const a of eigene.filter((x) => vergleiche(x.datum, stichtag) <= 0)) {
      const anteile = new Decimal(a.anzahl);
      if (letzteRunde !== null && vergleiche(a.datum, letzteRunde) <= 0) leer.inRundenGesamt = leer.inRundenGesamt.plus(anteile);
      else leer.nachRunde = leer.nachRunde.plus(anteile);
      leer.ausgeuebt.push({
        id: `ausuebung:${a.id}`,
        halter: { art: "fonds", id: fondsId, name: fondsName, vehikel: null },
        klasseId: i.anteilsklasseId,
        runde: null,
        datum: a.datum,
        anteile: anteile.toFixed(0),
        investiert: aufCent(anteile.times(a.preisJeAnteil)).toFixed(2),
        diesesFonds: fondsId === b.fondsId,
        ausgegeben: true,
      });
    }
    if (i.optionsscheinAnzahl === null || i.ausuebungspreis === null || i.status !== "aktiv") continue;
    const stand = optionsscheinStand({ anzahl: i.optionsscheinAnzahl, ausuebungspreis: i.ausuebungspreis, ausgabeAm: i.ausgabeAm, laufzeitBis: i.laufzeitBis }, eigene, stichtag).wert;
    if (stand.offen.greaterThan(0)) {
      leer.offen.push({ id: `optionsschein:${i.id}`, instrumentId: i.id, fondsId, name: `${fondsName} · ${i.bezeichnung}`, anteile: stand.offen.toFixed(0), ausuebungspreis: new Decimal(i.ausuebungspreis).toFixed(4), laufzeitBis: i.laufzeitBis });
    }
  }
  return leer;
}

/** Id der Zeile, aus der eine Übertragung Anteile abgibt: Rundenposition, frühere Übertragung, ausgeübte Optionsscheine oder Stammanteile. */
export const quelleZeileId = (u: { quellePositionId: string | null; quelleUebertragungId: string | null; quelleAusuebungId?: string | null }) =>
  u.quellePositionId ?? (u.quelleUebertragungId ? `uebertragung:${u.quelleUebertragungId}` : u.quelleAusuebungId ? `ausuebung:${u.quelleAusuebungId}` : STAMM_ID);

/** Übertragungen bis zum Stichtag auf die ausgegebenen Zeilen anwenden; der Käufer bekommt eine eigene Zeile mit Klasse und Runde der Quelle. */
async function wendeUebertragungenAnKapital(tx: Tx, b: { fondsId: string; organisationId: string }, stichtag: string, zeilen: KapitalZeile[]): Promise<{ zeilen: KapitalZeile[]; fehler: Kapital["uebertragungFehler"] }> {
  const liste = await tx
    .select({ u: anteilsuebertragung, fondsName: fonds.name, vehikelName: vehikel.name, investorId: organisation.id, investorName: organisation.name })
    .from(anteilsuebertragung)
    .leftJoin(fonds, eq(fonds.id, anteilsuebertragung.kaeuferFondsId))
    .leftJoin(vehikel, eq(vehikel.id, anteilsuebertragung.kaeuferVehikelId))
    .leftJoin(organisation, eq(organisation.id, vehikel.investorId))
    .where(and(eq(anteilsuebertragung.organisationId, b.organisationId), lte(anteilsuebertragung.datum, stichtag), isNull(anteilsuebertragung.storniertAm)))
    .orderBy(asc(anteilsuebertragung.datum), asc(anteilsuebertragung.erfasstAm), asc(anteilsuebertragung.id));
  if (liste.length === 0) return { zeilen, fehler: [] };
  const ausgegeben = zeilen.filter((z) => z.ausgegeben);
  const ergebnis = wendeUebertragungenAn(
    ausgegeben.map((z) => ({ id: z.id, anteile: z.anteile, investiert: z.investiert })),
    liste.map(({ u }) => ({ id: u.id, quelleId: quelleZeileId(u), zielId: `uebertragung:${u.id}`, anzahl: u.anzahl })),
  ).wert;
  const nachId = new Map(zeilen.map((z) => [z.id, z] as const));
  const stand = new Map(ergebnis.bestaende.map((x) => [x.id, x] as const));
  const neu: KapitalZeile[] = [];
  for (const { u, fondsName, vehikelName, investorId, investorName } of liste) {
    const zugang = ergebnis.zugaenge.find((x) => x.uebertragungId === u.id);
    const quelle = zugang ? nachId.get(zugang.quelleId) : undefined;
    if (!zugang || !quelle) continue;
    const zeile: KapitalZeile = {
      id: zugang.id,
      halter: u.kaeuferFondsId
        ? { art: "fonds", id: u.kaeuferFondsId, name: fondsName ?? "", vehikel: null }
        : { art: "organisation", id: investorId, name: investorName ?? "", vehikel: u.kaeuferVehikelId ? { id: u.kaeuferVehikelId, name: vehikelName ?? "" } : null },
      klasseId: quelle.klasseId,
      runde: quelle.runde,
      datum: quelle.runde ? null : (quelle.datum ?? null),
      anteile: zugang.anteile.toFixed(0),
      investiert: zugang.investiert.toFixed(2),
      diesesFonds: u.kaeuferFondsId === b.fondsId,
      ausgegeben: true,
      uebertragung: { id: u.id, datum: u.datum, preisJeAnteil: new Decimal(u.preisJeAnteil).toFixed(6), kaufpreis: u.kaufpreis, quelleId: zugang.quelleId, schritte: zugang.schritte, verkaeuferFondsId: quelle.halter.art === "fonds" ? quelle.halter.id : null },
    };
    nachId.set(zeile.id, zeile);
    neu.push(zeile);
  }
  const angepasst = zeilen.map((z) => {
    const s = stand.get(z.id);
    return s ? { ...z, anteile: s.anteile.toFixed(0), investiert: s.investiert.toFixed(2) } : z;
  });
  return {
    zeilen: [...angepasst, ...neu].filter((z) => !z.ausgegeben || new Decimal(z.anteile).greaterThan(0)),
    fehler: ergebnis.fehler.map((f) => ({ uebertragungId: f.uebertragungId, grund: f.grund, verfuegbar: f.verfuegbar.toFixed(0) })),
  };
}

/**
 * Pools, Änderungen und Zuteilungen der Mitarbeiterbeteiligung eines Unternehmens zum Stichtag: ausgeübte ESOP-Optionen nach der letzten
 * Runde als ausgegebene Zeile je Pool, Pool zugeteilt und frei je Pool (voll verwässert), Zuteilungen mit den Einheiten zum Stichtag.
 */
async function ladeMitarbeiterbeteiligung(tx: Tx, organisationId: string, stichtag: string, letzteRunde: string | null): Promise<{ ausgegeben: KapitalZeile[]; pool: KapitalZeile[]; mitarbeiter: MitarbeiterZeile[] }> {
  const pools = await tx.select().from(mitarbeiterpool).where(eq(mitarbeiterpool.organisationId, organisationId)).orderBy(asc(mitarbeiterpool.erstelltAm), asc(mitarbeiterpool.id));
  if (pools.length === 0) return { ausgegeben: [], pool: [], mitarbeiter: [] };
  const ids = pools.map((p) => p.id);
  const aenderungen = await tx.select().from(poolAenderung).where(inArray(poolAenderung.poolId, ids));
  const zeilen = await tx.select().from(mitarbeiterzuteilung).where(inArray(mitarbeiterzuteilung.poolId, ids)).orderBy(asc(mitarbeiterzuteilung.zugeteiltAm), asc(mitarbeiterzuteilung.erstelltAm), asc(mitarbeiterzuteilung.id));
  const zuteilungen = mitAustritten(zeilen, await ladeAustritte(tx, zeilen.map((z) => z.id)));
  const ausgegeben: KapitalZeile[] = [];
  const pool: KapitalZeile[] = [];
  const mitarbeiter: MitarbeiterZeile[] = [];
  const nullZeile = { klasseId: null, runde: null, investiert: "0.00", diesesFonds: false };
  for (const p of pools) {
    const eigene = zuteilungen.filter((z) => z.poolId === p.id);
    const stand = standDesPools(p, aenderungen.filter((a) => a.poolId === p.id), eigene, stichtag);
    // Ausgeübte ESOP-Optionen nach der letzten Runde: ausgegebene Stammanteile, bis eine spätere Runde sie in ihrer Gesamtzahl enthält.
    if (p.art === "esop" && letzteRunde) {
      const nach = eigene.filter((z) => z.status === "ausgeuebt" && z.statusAm && vergleiche(z.statusAm, stichtag) <= 0 && vergleiche(z.statusAm, letzteRunde) > 0);
      const anteile = nach.reduce((s, z) => s.plus(z.anzahl), new Decimal(0));
      if (anteile.greaterThan(0)) {
        const investiert = nach.reduce((s, z) => s.plus(new Decimal(z.anzahl).times(z.basispreis)), new Decimal(0));
        ausgegeben.push({ id: `ausgeuebt:${p.id}`, halter: { art: "ausgeuebt", id: p.id, name: p.bezeichnung, vehikel: null }, ...nullZeile, investiert: investiert.toFixed(2), anteile: anteile.toFixed(0), ausgegeben: true });
      }
    }
    if (stand.ausstehend.greaterThan(0)) pool.push({ id: `pool:${p.id}:zugeteilt`, halter: { art: "pool_zugeteilt", id: p.id, name: p.bezeichnung, vehikel: null }, ...nullZeile, anteile: stand.ausstehend.toFixed(0), ausgegeben: false });
    if (stand.frei.greaterThan(0)) pool.push({ id: `pool:${p.id}:frei`, halter: { art: "pool_frei", id: p.id, name: p.bezeichnung, vehikel: null }, ...nullZeile, anteile: stand.frei.toFixed(0), ausgegeben: false });
    // Grobe Erfassung (Näherung): die vergebenen Einheiten nehmen voll am Exit teil, mit dem mittleren Basispreis.
    if (p.erfassung === "grob") {
      if (stand.ausstehend.greaterThan(0)) {
        mitarbeiter.push({ id: `pool:${p.id}:grob`, zuteilungId: null, pool: { id: p.id, bezeichnung: p.bezeichnung, art: p.art, regel: p.regel }, kategorie: "sonstige", bezeichnung: null, anzahl: stand.ausstehend.toFixed(0), basispreis: new Decimal(p.basispreisMittel ?? 0).toFixed(4), einheiten: stand.ausstehend.toFixed(0) });
      }
      continue;
    }
    for (const z of eigene) {
      if (vergleiche(z.zugeteiltAm, stichtag) > 0) continue;
      const kern = kernZuteilung(z);
      const einheiten = einheitenBeimExit(kern, stichtag);
      if ((z.status === "verfallen" || z.status === "ausgeuebt") && z.statusAm && vergleiche(z.statusAm, stichtag) <= 0) continue;
      // Nach einem Austritt ganz verfallen oder zurückgekauft: wie eine verfallene Zuteilung ohne Zeile.
      if (aufteilung(kern, stichtag).verbleibend.isZero()) continue;
      mitarbeiter.push({
        id: `zuteilung:${z.id}`,
        zuteilungId: z.id,
        pool: { id: p.id, bezeichnung: p.bezeichnung, art: p.art, regel: p.regel },
        kategorie: z.kategorie,
        bezeichnung: z.bezeichnung,
        anzahl: new Decimal(z.anzahl).toFixed(0),
        basispreis: new Decimal(z.basispreis).toFixed(4),
        einheiten: einheiten.toFixed(0),
      });
    }
  }
  return { ausgegeben, pool, mitarbeiter };
}

/** Beteiligung laden (ohne Sperre), 404 wenn es sie nicht gibt. */
export async function ladeBeteiligungKurz(tx: Tx, id: string) {
  const [b] = await tx.select().from(beteiligung).where(eq(beteiligung.id, id));
  if (!b) throw new Fachfehler(404, "investment_not_found", "Investment not found.");
  return b;
}

/** Name eines Inhabers in Rechenschritten: „Vehikel · Investor“ bei Positionen Dritter, sonst Fonds oder „Stammanteile“. */
export function haltername(h: Halter): string {
  if (h.vehikel && h.vehikel.name !== h.name) return `${h.vehikel.name} · ${h.name}`;
  return h.name || "Stammanteile";
}

/** Eingabe für den Rechenkern aus der Kapitaltabelle: ausgegebene Anteile und je Zuteilung die Einheiten zum Stichtag (= Exitdatum). */
/** `anonym`: Zeilen, deren Namen in den Rechenschritten nicht erscheinen dürfen (verdeckte Zeilen, `kapital/sichtbarkeit.ts`). */
export function kernEingabe(k: Kapital, anonym: ReadonlySet<string> = new Set()): { klassen: KernKlasse[]; inhaber: Inhaberzeile[] } {
  const name = (id: string, klar: string) => (anonym.has(id) ? "Verdeckter Bestand" : klar);
  return {
    klassen: k.klassen.map((x) => ({
      id: x.id,
      name: x.name,
      rang: x.rang,
      praeferenzFaktor: x.praeferenzFaktor,
      partizipierend: x.partizipierend,
      capFaktor: x.capFaktor,
      verzinsung: x.kumulierteVerzinsung,
      umwandelbar: x.umwandelbar,
    })),
    inhaber: [
      ...k.zeilen.filter((z) => z.ausgegeben).map((z) => ({ id: z.id, name: name(z.id, haltername(z.halter)), klasseId: z.klasseId, anteile: z.anteile, investiert: z.investiert, datum: z.runde?.datum ?? z.datum ?? null })),
      ...k.mitarbeiter.map((m) => ({ id: m.id, name: anonym.has(m.id) ? m.pool.bezeichnung : (m.bezeichnung ?? m.pool.bezeichnung), klasseId: null, anteile: m.einheiten, investiert: "0", datum: null, mitarbeiter: { basispreis: m.basispreis, regel: m.pool.regel } })),
      // Nicht ausgeübte Optionsscheine: wie eine Option mit dem Ausübungspreis als Basispreis (ohne Klasse, Regel `wie_anteile`).
      ...k.optionsscheine.map((o) => ({ id: o.id, name: name(o.id, o.name), klasseId: null, anteile: o.anteile, investiert: "0", datum: null, mitarbeiter: { basispreis: o.ausuebungspreis, regel: "wie_anteile" as const, art: "optionsschein" as const } })),
    ],
  };
}

/** Ein Anteil als Bruch auf sechs Stellen (`0.123457`); `0.000000` bei null Anteilen insgesamt. */
export function anteilBruch(anteile: Decimal.Value, gesamt: Decimal.Value): string {
  const g = new Decimal(gesamt);
  return g.isZero() ? "0.000000" : new Decimal(anteile).div(g).toFixed(6);
}
