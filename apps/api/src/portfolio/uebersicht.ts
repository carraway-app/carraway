import { sql, type SQL } from "drizzle-orm";
import {
  Decimal,
  allokation,
  konvertiere,
  portfolioSummen,
  waehleKurs,
  type AllokationGruppe,
  type FondsSummand,
  type InterneBeteiligung,
  type Kursluecke,
  type MitHerkunft,
  type Rechenschritt,
  type Wechselkurs,
} from "@carraway/rechenkern";
import { berechneFondsUebersicht, ladeNavBestandteile, ladeZielfondsZum } from "../kennzahlen/fonds";
import { gruppiereZielfonds, type NavCache } from "../kennzahlen/zielfonds";
import { ladeSnapshot } from "../kennzahlen/snapshot";
import { ladeKapitalstand } from "../instrumente/kapitalstand";
import { ladeVerteilungsgrundlagen } from "../instrumente/lp-verteilung";
import { kursFenster, ladeGueltigeKurse } from "../waehrung/kurse";
import { ladeFondsSicht } from "../waehrung/sicht";
import type { Tx } from "../zeitlimit";

/**
 * Fondsübergreifende Sicht (Manager-Profil und Portfolio-Dashboard): Summen über alle sichtbaren Fonds in der Hauswährung, Allokation nach Sektor, Land,
 * Phase und Fonds sowie der Verlauf von NAV und Portfoliowert. Gerechnet wird mit denselben Bausteinen wie in den Fondskennzahlen und der Währungssicht;
 * die Summen ohne Doppelzählung (Anteile eines Fonds an einem anderen sichtbaren Fonds) und die Allokation rechnet der Rechenkern (`dachfonds.ts`,
 * `allokation.ts`).
 *
 * Umrechnung in die Hauswährung (Regeln wie `docs/currency.md`): Zahlungen (Einzahlungen, Ausschüttungen, Abrufe der Zielfonds) zum Kurs ihrer Valuta,
 * Bestände (Zusagen, NAV, Werte) zum Kurs des Stichtags. Fehlt ein Kurs, ist der Betrag eine Lücke, und jede Summe mit ihm auch.
 */

export interface Luecke {
  von: string;
  nach: string;
  tag: string;
  grund: Kursluecke["grund"];
}

export interface Schritt {
  operator: Rechenschritt["zeichen"];
  label: string;
  value: string;
  sources?: string[];
}

export interface Kennzahl {
  value: string | null;
  steps: Schritt[];
}

const schritte = (s: readonly Rechenschritt[]): Schritt[] => s.map((x) => ({ operator: x.zeichen, label: x.bezeichnung, value: x.wert, ...(x.quellen ? { sources: x.quellen } : {}) }));
const kennzahl = (m: MitHerkunft<Decimal | null>, stellen?: number): Kennzahl => ({ value: m.wert === null ? null : stellen === undefined ? m.wert.toString() : m.wert.toFixed(stellen), steps: schritte(m.schritte) });
const text = (d: Decimal | null) => (d === null ? null : d.toFixed(2));

type Abfrage = Pick<Tx, "execute" | "select">;

/** Rechnet Beträge in die Hauswährung um und sammelt Lücken. */
class Umrechner {
  readonly luecken: Luecke[] = [];
  constructor(
    private readonly kurse: readonly Wechselkurs[],
    readonly haus: string,
  ) {}

  um(betrag: Decimal.Value | null, von: string, tag: string): Decimal | null {
    if (betrag === null) return null;
    if (von === this.haus) return new Decimal(betrag);
    const w = waehleKurs(this.kurse, von, this.haus, tag);
    if (!w.ok) {
      if (!this.luecken.some((l) => l.von === w.luecke.von && l.nach === w.luecke.nach && l.tag === tag)) this.luecken.push({ von: w.luecke.von, nach: w.luecke.nach, tag, grund: w.luecke.grund });
      return null;
    }
    return konvertiere(betrag, w.faktor);
  }

  /** Summe von Zahlungen, jede zum Kurs ihrer Valuta; eine Lücke macht die Summe zur Lücke. */
  summe(posten: readonly { betrag: Decimal.Value; datum: string }[], von: string): Decimal | null {
    let s: Decimal | null = new Decimal(0);
    for (const p of posten) {
      const w = this.um(p.betrag, von, p.datum);
      s = s === null || w === null ? null : s.plus(w);
    }
    return s;
  }
}

async function umrechner(tx: Abfrage, waehrungen: readonly string[], haus: string, von: string, bis: string, stand: string | undefined): Promise<Umrechner> {
  const fremd = waehrungen.some((w) => w !== haus);
  if (!fremd) return new Umrechner([], haus);
  const fenster = kursFenster([von, bis])!;
  const kurse = await ladeGueltigeKurse(tx as Tx, fenster.von, fenster.bis, { stand, waehrungen: [...new Set([...waehrungen, haus, "EUR"])] });
  return new Umrechner(kurse, haus);
}

type FondsStamm = { id: string; name: string; kurzname: string; waehrung: string };

const liste = (ids: readonly string[]): SQL => sql`ANY(ARRAY[${sql.join(ids.map((i) => sql`${i}`), sql`, `)}]::uuid[])`;

async function ladeStamm(tx: Abfrage, fondsIds: readonly string[]): Promise<FondsStamm[]> {
  if (fondsIds.length === 0) return [];
  const { rows } = await tx.execute<FondsStamm>(sql`SELECT id, name, kurzname, waehrung FROM fonds WHERE id = ${liste(fondsIds)} ORDER BY vintage, name`);
  return rows;
}

export interface FondsZeile {
  fundId: string;
  name: string;
  shortName: string;
  currency: string;
  commitment: string;
  paidIn: string;
  distributions: string;
  nav: string | null;
  tvpi: string | null;
  dpi: string | null;
  irr: string | null;
  home: { commitment: string | null; paidIn: string | null; distributions: string | null; nav: string | null };
}

export interface InterneZeile {
  id: string;
  fundId: string;
  targetFundId: string;
  name: string;
  /** Beide Fonds stehen in der Summe: Der Anteil wurde herausgerechnet. */
  eliminated: boolean;
  /** Der Dachfonds ist im Zielfonds als Investor erfasst: Auch Zusage, Abrufe und Ausschüttungen wurden herausgerechnet. */
  investorRecord: boolean;
}

export interface PortfolioSummenAntwort {
  asOf: string;
  homeCurrency: string;
  funds: FondsZeile[];
  internalHoldings: (InterneZeile | { id: null; fundId: string; name: string; value: string; eliminated: false })[];
  totals: { commitment: Kennzahl; paidIn: Kennzahl; distributions: Kennzahl; nav: Kennzahl; tvpi: Kennzahl; dpi: Kennzahl; rvpi: Kennzahl };
  gaps: Luecke[];
}

/** Summen über die Fonds (Kennzahlen je Fonds in Fonds- und Hauswährung, Summen ohne Doppelzählung). */
export async function ladePortfolioSummen(tx: Abfrage, fondsIds: readonly string[], stichtag: string, stand: string | undefined, haus: string): Promise<PortfolioSummenAntwort> {
  const cache: NavCache = new Map();
  const stamm = await ladeStamm(tx, fondsIds);
  const u = await umrechner(tx, stamm.map((f) => f.waehrung), haus, "1990-01-01", stichtag, stand);
  const fonds: FondsZeile[] = [];
  const summanden: FondsSummand[] = [];
  const intern: InterneBeteiligung[] = [];
  const zeilenIntern: PortfolioSummenAntwort["internalHoldings"] = [];
  for (const f of stamm) {
    const ue = await berechneFondsUebersicht(tx, f.id, stichtag, stand, cache);
    const { zeichnungen } = (await ladeVerteilungsgrundlagen(tx, f.id, stand)).zum(stichtag);
    const zusage = zeichnungen.reduce((s, z) => s.plus(z.zusage), new Decimal(0));
    const eingezahlt = new Decimal(ue.kennzahlen.eingezahlt.wert ?? 0);
    const ausschuettungen = new Decimal(ue.kennzahlen.ausschuettungen.wert ?? 0);
    const nav = ue.kennzahlen.nav.wert === null ? null : new Decimal(ue.kennzahlen.nav.wert);
    let hausEingezahlt: Decimal | null = eingezahlt;
    let hausAusschuettungen: Decimal | null = ausschuettungen;
    if (f.waehrung !== haus) {
      // Zahlungen zum Kurs ihrer Valuta: dieselben Posten wie in den Kennzahlen (Eingänge der Investoren, Ausschüttungen).
      const kapital = await ladeKapitalstand(tx, f.id, stichtag, stand);
      hausEingezahlt = u.summe(kapital.eingaenge.map((e) => ({ betrag: e.betrag, datum: e.valuta })), f.waehrung);
      hausAusschuettungen = u.summe(kapital.bewegungen.filter((b) => b.art === "ausschuettung").map((b) => ({ betrag: b.betrag, datum: b.valuta })), f.waehrung);
    }
    const hausZusage = u.um(zusage, f.waehrung, stichtag);
    const hausNav = u.um(nav, f.waehrung, stichtag);
    fonds.push({
      fundId: f.id,
      name: f.name,
      shortName: f.kurzname,
      currency: f.waehrung,
      commitment: zusage.toFixed(2),
      paidIn: eingezahlt.toFixed(2),
      distributions: ausschuettungen.toFixed(2),
      nav: text(nav),
      tvpi: ue.kennzahlen.tvpi.wert,
      dpi: ue.kennzahlen.dpi.wert,
      irr: ue.kennzahlen.irr.wert,
      home: { commitment: text(hausZusage), paidIn: text(hausEingezahlt), distributions: text(hausAusschuettungen), nav: text(hausNav) },
    });
    summanden.push({ fondsId: f.id, bezeichnung: f.name, zusage: hausZusage, eingezahlt: hausEingezahlt, ausschuettungen: hausAusschuettungen, nav: hausNav });
    // Anteile an Zielfonds derselben Installation: Kandidaten für die Bereinigung der Doppelzählung.
    const positionen = (await ladeZielfondsZum(tx, f.id, stichtag, stand, new Set(), cache)) ?? [];
    const { sichtbar, sammelwert } = gruppiereZielfonds(positionen, (id) => fondsIds.includes(id), (p) => p.kennzahlen.wert.wert);
    if (sammelwert !== null) zeilenIntern.push({ id: null, fundId: f.id, name: "Zielfonds", value: sammelwert.toFixed(2), eliminated: false });
    for (const p of sichtbar.filter((x) => x.zielfondsId !== null)) {
      const k = p.kennzahlen;
      const flows = (art: string) => p.bewegungen.filter((b) => b.art === art).map((b) => ({ betrag: b.betrag, datum: b.valuta }));
      // Als Investor erfasst: Die verknüpfte Organisation hat im Zielfonds gezeichnet; nur dann stecken die Zahlungen auch in dessen Investorenzahlen.
      const erfasst =
        p.investorOrganisationId !== null &&
        (await tx.execute<{ da: boolean }>(sql`SELECT EXISTS (SELECT 1 FROM fonds_zeichnung WHERE fonds_id = ${p.zielfondsId} AND organisation_id = ${p.investorOrganisationId}${stand === undefined ? sql`` : sql` AND erstellt_am <= ${stand}::timestamptz`}) AS da`)).rows[0]?.da === true;
      intern.push({
        id: p.id,
        vonFondsId: f.id,
        zielFondsId: p.zielfondsId!,
        bezeichnung: p.name,
        alsInvestorErfasst: erfasst,
        zusage: u.um(k.zusage.wert, f.waehrung, stichtag),
        abgerufen: u.summe(flows("abruf"), f.waehrung),
        ausgeschuettet: u.summe(flows("ausschuettung"), f.waehrung),
        wert: u.um(k.wert.wert, f.waehrung, stichtag),
      });
      zeilenIntern.push({ id: p.id, fundId: f.id, targetFundId: p.zielfondsId!, name: p.name, eliminated: true, investorRecord: erfasst });
    }
  }
  const s = portfolioSummen(summanden, intern);
  return {
    asOf: stichtag,
    homeCurrency: haus,
    funds: fonds,
    internalHoldings: zeilenIntern,
    totals: { commitment: kennzahl(s.zusage, 2), paidIn: kennzahl(s.eingezahlt, 2), distributions: kennzahl(s.ausschuettungen, 2), nav: kennzahl(s.nav, 2), tvpi: kennzahl(s.tvpi), dpi: kennzahl(s.dpi), rvpi: kennzahl(s.rvpi) },
    gaps: u.luecken,
  };
}

// Allokation ------------------------------------------------------------------------------------------------------------------------------------

export type GruppenArt = "value" | "unknown" | "target_funds";

export interface AllokationsGruppe {
  key: string | null;
  label: string | null;
  type: GruppenArt;
  count: number;
  invested: string | null;
  fairValue: string | null;
  investedShare: string | null;
  fairValueShare: string | null;
}

export interface AllokationsAntwort {
  invested: string | null;
  fairValue: string | null;
  sector: AllokationsGruppe[];
  country: AllokationsGruppe[];
  stage: AllokationsGruppe[];
  fund: AllokationsGruppe[];
}

type Position = { fondsId: string; fondsName: string; sektor: string | null; land: string | null; phase: string | null; zielfonds: boolean; investiert: Decimal | null; zeitwert: Decimal | null };

const kodiere = (art: GruppenArt, wert: string | null) => `${art}:${wert ?? ""}`;

function gruppen(positionen: readonly Position[], wahl: (p: Position) => { art: GruppenArt; key: string | null }, labels: Map<string, string> = new Map()): AllokationsGruppe[] {
  const a = allokation(positionen.map((p) => { const g = wahl(p); return { gruppe: kodiere(g.art, g.key), investiert: p.investiert, zeitwert: p.zeitwert }; }));
  return a.gruppen.map((g: AllokationGruppe) => {
    const trenner = g.gruppe.indexOf(":");
    const art = g.gruppe.slice(0, trenner) as GruppenArt;
    const key = g.gruppe.slice(trenner + 1) || null;
    return {
      key,
      label: key === null ? null : (labels.get(key) ?? key),
      type: art,
      count: g.anzahl,
      invested: text(g.investiert),
      fairValue: text(g.zeitwert),
      investedShare: g.anteilInvestiert === null ? null : g.anteilInvestiert.toDecimalPlaces(6).toString(),
      fairValueShare: g.anteilZeitwert === null ? null : g.anteilZeitwert.toDecimalPlaces(6).toString(),
    };
  });
}

/**
 * Allokation der Beteiligungen aller Fonds zum Stichtag: investiert = ausgezahltes Kapital (auch ausgeschiedener Beteiligungen), Zeitwert = Wertansatz wie in
 * der Währungssicht (Bewertung plus offene Forderungen, nach einem Exit 0). Anteile an Zielfonds zählen als eigene Gruppe „Zielfonds“; Anteile an einem
 * Fonds, der selbst in der Auswahl steht, zählen nicht (dessen Beteiligungen stehen schon darin). Phase = Bezeichnung der letzten abgeschlossenen
 * Finanzierungsrunde bis zum Stichtag, Land = Sitzland aus den Meldedaten.
 */
export async function ladeAllokation(tx: Abfrage, fondsIds: readonly string[], stichtag: string, stand: string | undefined, haus: string): Promise<AllokationsAntwort> {
  const stamm = await ladeStamm(tx, fondsIds);
  const positionen: Position[] = [];
  const u = await umrechner(tx, stamm.map((f) => f.waehrung), haus, "1990-01-01", stichtag, stand);
  for (const f of stamm) {
    const sicht = await ladeFondsSicht(tx as Tx, f.id, { stichtag, stand });
    const orgs = [...new Set(sicht.zeilen.map((z) => z.organisation.id))];
    const merkmale = new Map<string, { sektor: string | null; land: string | null; phase: string | null }>();
    if (orgs.length) {
      const { rows } = await tx.execute<{ id: string; sektor: string | null; land: string | null; phase: string | null }>(sql`
        SELECT o.id, o.sektor, m.sitzland AS land,
               (SELECT r.bezeichnung FROM finanzierungsrunde r WHERE r.organisation_id = o.id AND r.status = 'abgeschlossen' AND r.datum <= ${stichtag}::date
                ORDER BY r.datum DESC, r.erstellt_am DESC LIMIT 1) AS phase
        FROM organisation o LEFT JOIN organisation_meldedaten m ON m.organisation_id = o.id
        WHERE o.id = ${liste(orgs)}`);
      for (const r of rows) merkmale.set(r.id, { sektor: r.sektor, land: r.land, phase: r.phase });
    }
    for (const z of sicht.zeilen) {
      const m = merkmale.get(z.organisation.id);
      const leer = (x: string | null | undefined) => (x === null || x === undefined || x.trim() === "" ? null : x.trim());
      positionen.push({ fondsId: f.id, fondsName: f.name, sektor: leer(m?.sektor), land: leer(m?.land), phase: leer(m?.phase), zielfonds: false, investiert: z.investiert.haus === null ? null : new Decimal(z.investiert.haus), zeitwert: z.bewertung.haus === null ? null : new Decimal(z.bewertung.haus) });
    }
    const ziele = (await ladeZielfondsZum(tx, f.id, stichtag, stand)) ?? [];
    for (const p of ziele) {
      if (p.zielfondsId !== null && fondsIds.includes(p.zielfondsId)) continue;
      const abrufe = p.bewegungen.filter((b) => b.art === "abruf").map((b) => ({ betrag: b.betrag, datum: b.valuta }));
      positionen.push({ fondsId: f.id, fondsName: f.name, sektor: null, land: null, phase: null, zielfonds: true, investiert: u.summe(abrufe, f.waehrung), zeitwert: u.um(p.kennzahlen.wert.wert, f.waehrung, stichtag) });
    }
  }
  const merkmal = (feld: "sektor" | "land" | "phase") => (p: Position) => (p.zielfonds ? { art: "target_funds" as const, key: null } : p[feld] === null ? { art: "unknown" as const, key: null } : { art: "value" as const, key: p[feld] });
  const gesamt = allokation(positionen.map((p) => ({ gruppe: p.fondsId, investiert: p.investiert, zeitwert: p.zeitwert })));
  return {
    invested: text(gesamt.investiert),
    fairValue: text(gesamt.zeitwert),
    sector: gruppen(positionen, merkmal("sektor")),
    country: gruppen(positionen, merkmal("land")),
    stage: gruppen(positionen, merkmal("phase")),
    fund: gruppen(positionen, (p) => ({ art: "value", key: p.fondsId }), new Map(stamm.map((f) => [f.id, f.name]))),
  };
}

// Verlauf -----------------------------------------------------------------------------------------------------------------------------------------

export interface VerlaufPunkt {
  asOf: string;
  /** NAV in Fondswährung (nur an Stichtagen mit übernommener Saldenliste), sonst `null`. */
  nav: string | null;
  /** Portfoliowert in Fondswährung: Beteiligungen plus Anteile an Zielfonds. */
  portfolioValue: string;
  home: { nav: string | null; portfolioValue: string | null };
}

export interface VerlaufAntwort {
  dates: string[];
  funds: { fundId: string; name: string; currency: string; points: VerlaufPunkt[] }[];
  /** Summe in der Hauswährung ohne Doppelzählung; eine Lücke in einem Fonds macht den Punkt zur Lücke. */
  total: { asOf: string; nav: string | null; portfolioValue: string | null }[];
}

/** Die letzten `anzahl` Quartalsenden vor dem Stichtag und der Stichtag selbst (aufsteigend). */
export function verlaufsStichtage(stichtag: string, anzahl: number): string[] {
  const enden: string[] = [];
  let jahr = Number(stichtag.slice(0, 4));
  const ende = (j: number, q: number) => `${j}-${["03-31", "06-30", "09-30", "12-31"][q]}`;
  let q = 3;
  while (ende(jahr, q) >= stichtag) {
    q -= 1;
    if (q < 0) {
      q = 3;
      jahr -= 1;
    }
  }
  while (enden.length < anzahl) {
    enden.unshift(ende(jahr, q));
    q -= 1;
    if (q < 0) {
      q = 3;
      jahr -= 1;
    }
  }
  return [...enden, stichtag];
}

/**
 * NAV und Portfoliowert je Fonds an den Stichtagen des Verlaufs. Ohne Wissensstand liest es gespeicherte, aktuelle Snapshots (Quartalsenden) und rechnet nur
 * den Rest; mit Wissensstand rechnet es alles nach.
 */
export async function ladeVerlauf(tx: Abfrage, fondsIds: readonly string[], stichtag: string, stand: string | undefined, haus: string, quartale: number): Promise<VerlaufAntwort> {
  const stamm = await ladeStamm(tx, fondsIds);
  const tage = verlaufsStichtage(stichtag, quartale);
  const u = await umrechner(tx, stamm.map((f) => f.waehrung), haus, tage[0]!, stichtag, stand);
  const funds: VerlaufAntwort["funds"] = [];
  const internJeTag = new Map<string, Decimal | null>(tage.map((t) => [t, new Decimal(0)]));
  const cache: NavCache = new Map();
  for (const f of stamm) {
    const points: VerlaufPunkt[] = [];
    for (const tag of tage) {
      const snap = stand === undefined ? await ladeSnapshot(tx, f.id, tag) : null;
      let nav: string | null;
      let portfolio: Decimal;
      let ziele;
      if (snap?.snapshot && !snap.snapshot.veraltet) {
        nav = snap.uebersicht.kennzahlen.nav.wert;
        portfolio = new Decimal(snap.uebersicht.portfoliowert);
        ziele = snap.uebersicht.zielfonds ?? [];
      } else {
        const b = await ladeNavBestandteile(tx, f.id, tag, stand, new Set(), cache);
        nav = b.nav === null ? null : b.nav.toString();
        portfolio = b.portfoliowert;
        ziele = b.zielfonds;
      }
      for (const p of ziele) {
        portfolio = portfolio.plus(p.wert);
        // Bei sichtbarem Zielfonds steckt der Anteilswert bereits in dessen NAV.
        if (p.zielfondsId === null || !fondsIds.includes(p.zielfondsId)) continue;
        const w = u.um(p.wert, f.waehrung, tag);
        const bisher = internJeTag.get(tag) ?? null;
        internJeTag.set(tag, bisher === null || w === null ? null : bisher.plus(w));
      }
      points.push({
        asOf: tag,
        nav: nav === null ? null : new Decimal(nav).toFixed(2),
        portfolioValue: portfolio.toFixed(2),
        home: { nav: text(u.um(nav, f.waehrung, tag)), portfolioValue: text(u.um(portfolio, f.waehrung, tag)) },
      });
    }
    funds.push({ fundId: f.id, name: f.name, currency: f.waehrung, points });
  }
  const total = tage.map((tag, i) => {
    const abzug = internJeTag.get(tag) ?? null;
    const summe = (wahl: (p: VerlaufPunkt) => string | null) => {
      let s: Decimal | null = new Decimal(0);
      for (const f of funds) {
        const w = wahl(f.points[i]!);
        s = s === null || w === null ? null : s.plus(w);
      }
      return s === null || abzug === null ? null : s.minus(abzug);
    };
    return { asOf: tag, nav: text(summe((p) => p.home.nav)), portfolioValue: text(summe((p) => p.home.portfolioValue)) };
  });
  return { dates: tage, funds, total };
}
