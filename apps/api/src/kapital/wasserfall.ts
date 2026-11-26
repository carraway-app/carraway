import { and, asc, desc, eq, inArray, lte } from "drizzle-orm";
import { anteilsklasse, beteiligung, finanzierungsrunde, fonds, mitarbeiterpool, mitarbeiterzuteilung, organisation, poolAenderung, rundenposition, vehikel } from "@carraway/db";
import { aufteilung, Decimal, einheitenBeimExit, poolStand, vergleiche, type Anteilsklasse as KernKlasse, type Inhaberzeile } from "@carraway/rechenkern";
import { Fachfehler } from "../fehler";
import { kernZuteilung, ladeAustritte, mitAustritten } from "./pool";
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
 */

export const STAMM_ID = "stamm";

export interface Halter {
  /**
   * `stamm`: Gründer und übrige Anteile ohne Rundenposition. `organisation`: der Investor (Organisation) hinter dem Vehikel.
   * Mitarbeiterbeteiligung (ID und Name des Pools): `ausgeuebt` (ausgeübte Optionen nach der letzten Runde, ausgegeben), `pool_zugeteilt`
   * und `pool_frei` (nur voll verwässert), `mitarbeiter` (eine Zuteilung im Wasserfall). `wandlung`: geschätzte Anteile aus einer offenen Wandlung
   * (ID des Wandeldarlehens, nur in der Kapitaltabelle mit `offeneWandlungen`).
   */
  art: "fonds" | "organisation" | "stamm" | "ausgeuebt" | "pool_zugeteilt" | "pool_frei" | "mitarbeiter" | "wandlung";
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
  /** Ausgegebene Anteile (zählen unverwässert); `false` nur beim Pool der Mitarbeiterbeteiligung. */
  ausgegeben: boolean;
}

/** Zuteilung der Mitarbeiterbeteiligung für den Wasserfall (je Zuteilung eine Zeile, ID `zuteilung:<id>`). */
export interface MitarbeiterZeile {
  id: string;
  zuteilungId: string;
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
}

/** Lädt Runden und Positionen des Unternehmens der Beteiligung bis `stichtag` (einschließlich). */
export async function ladeKapital(tx: Tx, b: { fondsId: string; organisationId: string }, stichtag: string): Promise<Kapital> {
  const [org] = await tx.select({ id: organisation.id, name: organisation.name }).from(organisation).where(eq(organisation.id, b.organisationId));
  if (!org) throw new Fachfehler(404, "ORGANISATION_NICHT_GEFUNDEN", "Organisation nicht gefunden.");
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
  const rest = Decimal.max(0, rundenGesamt.minus(inRunden));
  if (letzte && rest.greaterThan(0)) {
    zeilen.unshift({ id: STAMM_ID, halter: { art: "stamm", id: null, name: "", vehikel: null }, klasseId: null, runde: null, anteile: rest.toFixed(0), investiert: "0.00", diesesFonds: false, ausgegeben: true });
  }
  const benutzt = new Set(zeilen.map((z) => z.klasseId).filter((x): x is string => x !== null));
  const mp = await ladeMitarbeiterbeteiligung(tx, b.organisationId, stichtag, letzte?.datum ?? null);
  zeilen.push(...mp.ausgegeben);
  const gesamt = rundenGesamt.plus(mp.ausgegeben.reduce((s, z) => s.plus(z.anteile), new Decimal(0)));
  // Den Pool gibt es voll verwässert nur mit einer Runde (sonst fehlt die Bezugsgröße der ausgegebenen Anteile).
  const pool = letzte ? mp.pool : [];
  zeilen.push(...pool);
  return {
    organisation: org,
    stichtag,
    letzteRunde: letzte ? { id: letzte.id, bezeichnung: letzte.bezeichnung, datum: letzte.datum, postMoney: letzte.postMoney!, preisJeAnteil: letzte.preisJeAnteil! } : null,
    anteileGesamt: gesamt.toFixed(0),
    anteileVollVerwaessert: gesamt.plus(pool.reduce((s, z) => s.plus(z.anteile), new Decimal(0))).toFixed(0),
    zeilen,
    klassen: klassen.filter((k) => benutzt.has(k.id)),
    mitarbeiter: letzte ? mp.mitarbeiter : [],
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
    const stand = poolStand(
      aenderungen.filter((a) => a.poolId === p.id),
      eigene.map(kernZuteilung),
      stichtag,
    );
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
  if (!b) throw new Fachfehler(404, "BETEILIGUNG_NICHT_GEFUNDEN", "Beteiligung nicht gefunden.");
  return b;
}

/** Name eines Inhabers in Rechenschritten: „Vehikel · Investor“ bei Positionen Dritter, sonst Fonds oder „Stammanteile“. */
export function haltername(h: Halter): string {
  if (h.vehikel && h.vehikel.name !== h.name) return `${h.vehikel.name} · ${h.name}`;
  return h.name || "Stammanteile";
}

/** Eingabe für den Rechenkern aus der Kapitaltabelle: ausgegebene Anteile und je Zuteilung die Einheiten zum Stichtag (= Exitdatum). */
export function kernEingabe(k: Kapital): { klassen: KernKlasse[]; inhaber: Inhaberzeile[] } {
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
      ...k.zeilen.filter((z) => z.ausgegeben).map((z) => ({ id: z.id, name: haltername(z.halter), klasseId: z.klasseId, anteile: z.anteile, investiert: z.investiert, datum: z.runde?.datum ?? null })),
      ...k.mitarbeiter.map((m) => ({ id: m.id, name: m.bezeichnung ?? m.pool.bezeichnung, klasseId: null, anteile: m.einheiten, investiert: "0", datum: null, mitarbeiter: { basispreis: m.basispreis, regel: m.pool.regel } })),
    ],
  };
}

/** Ein Anteil als Bruch auf sechs Stellen (`0.123457`); `0.000000` bei null Anteilen insgesamt. */
export function anteilBruch(anteile: Decimal.Value, gesamt: Decimal.Value): string {
  const g = new Decimal(gesamt);
  return g.isZero() ? "0.000000" : new Decimal(anteile).div(g).toFixed(6);
}
