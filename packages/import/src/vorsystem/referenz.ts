import { leseAlleSeiten, QuellFehler, type Abrufkontext, type Seite, type VorsystemAdapter } from "./adapter";
import { leererAuszug, type FondsAuszug, type KontrollGroesse, type QuellFonds, type QuellVorgang, type VorgangArt } from "./modell";

/**
 * Referenz-Adapter gegen die erfundene Beispiel-API (`referenz-api.ts`). Er zeigt das Muster für einen echten Adapter: Abfragen je
 * Fonds, Seiten mit Cursor (auch in verschachtelten Listen), Übersetzung der Quellwerte in das Zwischenmodell und klare Fehler bei
 * unbekannten Werten. Er wird in keinem Build als Quelle angemeldet; ein echter Adapter liegt als Erweiterung vor.
 */

interface Verbindung<T> {
  nodes: T[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

const ALS_SEITE = <T>(v: Verbindung<T>): Seite<T> => ({ eintraege: v.nodes, weiter: v.pageInfo.hasNextPage ? v.pageInfo.endCursor : null });

async function graphql<T>(k: Abrufkontext, query: string, variables: Record<string, unknown>): Promise<T> {
  const antwort = (await k.rufe("/graphql", { query, variables })) as { data?: T; errors?: unknown[] };
  if (!antwort || typeof antwort !== "object" || antwort.errors?.length || !antwort.data) throw new QuellFehler("source_query_failed");
  return antwort.data;
}

const INSTRUMENT: Record<string, FondsAuszug["beteiligungen"][number]["instrument"]> = {
  EQUITY: "offene_beteiligung", SILENT_PARTNERSHIP: "stille_beteiligung", LOAN: "darlehen", CONVERTIBLE_LOAN: "wandeldarlehen", VENTURE_DEBT: "venture_debt", SHAREHOLDER_LOAN: "gesellschafterdarlehen", SAFE: "safe", WARRANT: "optionsschein",
};
const STATUS: Record<string, "aktiv" | "exit" | "insolvent" | "abgeschrieben"> = { ACTIVE: "aktiv", EXITED: "exit", INSOLVENT: "insolvent", WRITTEN_OFF: "abgeschrieben" };
const ART: Record<string, VorgangArt> = {
  COMMITMENT: "zusage", DRAWDOWN: "auszahlung", PROCEEDS: "rueckfluss", INTEREST_ACCRUAL: "zins", INTEREST_PAYMENT: "zinszahlung", DIVIDEND: "dividende", REPAYMENT: "tilgung", WRITE_DOWN: "wertberichtigung", CONVERSION: "wandlung",
};
const METHODE: Record<string, "anschaffungskosten" | "letzte_runde" | "multiplikator" | "dcf" | "sonstige"> = { COST: "anschaffungskosten", LAST_ROUND: "letzte_runde", MULTIPLE: "multiplikator", DCF: "dcf", OTHER: "sonstige" };
const ROLLE: Record<string, "lead" | "co_lead" | "co"> = { LEAD: "lead", CO_LEAD: "co_lead", PARTICIPANT: "co" };
const SZENARIO: Record<string, "ist" | "plan" | "forecast"> = { ACTUAL: "ist", BUDGET: "plan", FORECAST: "forecast" };
const GROESSE: Record<string, KontrollGroesse> = { COMMITMENTS: "zusagen", DRAWDOWNS: "auszahlungen", PROCEEDS: "rueckfluesse", NAV: "nav", COMMITTED_CAPITAL: "zeichnungskapital" };

/** Übersetzt einen Quellwert; ein unbekannter Wert ist ein Fehler des Laufs (nie still verworfen). */
function wert<T>(tabelle: Record<string, T>, roh: string): T {
  const w = Object.hasOwn(tabelle, roh) ? tabelle[roh] : undefined;
  if (w === undefined) throw new QuellFehler("source_value_unknown");
  return w;
}

const ohneNull = <T>(x: T | null | undefined): T | undefined => (x === null ? undefined : x);

interface Transaktion { id: string; type: string; date: string; amount: string; round: { id: string } | null; note: string | null; reverses: { id: string } | null; capitalized: boolean }

const FUNDS = `query Funds($after: String) { funds(first: 50, after: $after) { nodes { id name shortName vintage committedCapital currency } pageInfo { hasNextPage endCursor } } }`;
const INVESTMENTS = `query FundInvestments($fundId: ID!, $after: String) { fund(id: $fundId) { investments(first: 50, after: $after) { nodes {
  id instrument label firstInvestedOn status
  company { id name website sector city contacts { id firstName lastName email title } }
  transactions(first: 100) { nodes { id type date amount round { id } note reverses { id } capitalized } pageInfo { hasNextPage endCursor } }
  valuations { id date value method note basis }
} pageInfo { hasNextPage endCursor } } } }`;
const TRANSACTIONS = `query InvestmentTransactions($investmentId: ID!, $after: String) { investment(id: $investmentId) { transactions(first: 100, after: $after) { nodes { id type date amount round { id } note reverses { id } capitalized } pageInfo { hasNextPage endCursor } } } }`;
const ROUNDS = `query FundRounds($fundId: ID!, $after: String) { fund(id: $fundId) { rounds(first: 50, after: $after) { nodes { id company { id } name closedOn preMoney postMoney pricePerShare sharesAfter participants { amount shares role fund { id } investor { id name } } } pageInfo { hasNextPage endCursor } } } }`;
const METRICS = `query FundMetrics($fundId: ID!, $after: String) { fund(id: $fundId) { metrics(first: 200, after: $after) { nodes { id company { id } name periodStart periodEnd scenario value } pageInfo { hasNextPage endCursor } } } }`;
const TOTALS = `query FundTotals($fundId: ID!) { fund(id: $fundId) { totals { investment { id } measure amount asOf } } }`;

export const referenzAdapter: VorsystemAdapter = {
  id: "example",
  bezeichnung: "Example API",
  standardUrsprung: "https://api.example.com",
  erlaubterPfad: (pfad) => pfad === "/graphql",
  rate: { anfragen: 10, sekunden: 1 },
  async leseFonds(k) {
    const fonds = await leseAlleSeiten(async (after) => ALS_SEITE((await graphql<{ funds: Verbindung<{ id: string; name: string; shortName: string | null; vintage: number; committedCapital: string; currency: string }> }>(k, FUNDS, { after })).funds));
    return fonds.map((f): QuellFonds => ({ quellId: f.id, name: f.name, kurzname: ohneNull(f.shortName), vintage: f.vintage, zeichnungskapital: f.committedCapital, waehrung: f.currency }));
  },
  async leseAuszug(k, fonds) {
    const a = leererAuszug(fonds);
    const fundId = fonds.quellId;
    type Investment = { id: string; instrument: string; label: string | null; firstInvestedOn: string; status: string; company: { id: string; name: string; website: string | null; sector: string | null; city: string | null; contacts: { id: string; firstName: string; lastName: string; email: string | null; title: string | null }[] }; transactions: Verbindung<Transaktion>; valuations: { id: string; date: string; value: string; method: string; note: string | null; basis: string | null }[] };
    const investments = await leseAlleSeiten(async (after) => ALS_SEITE((await graphql<{ fund: { investments: Verbindung<Investment> } }>(k, INVESTMENTS, { fundId, after })).fund.investments));
    for (const i of investments) {
      const c = i.company;
      a.organisationen.push({ quellId: c.id, name: c.name, website: ohneNull(c.website), sektor: ohneNull(c.sector), ort: ohneNull(c.city) });
      for (const p of c.contacts) a.personen.push({ quellId: p.id, vorname: p.firstName, nachname: p.lastName, email: ohneNull(p.email), funktion: ohneNull(p.title), organisationId: c.id });
      a.beteiligungen.push({ quellId: i.id, fondsId: fundId, organisationId: c.id, instrument: wert(INSTRUMENT, i.instrument), bezeichnung: ohneNull(i.label), erstinvestment: i.firstInvestedOn, status: wert(STATUS, i.status) });
      // Verschachtelte Liste: die erste Seite kommt mit der Beteiligung, weitere Seiten über eine eigene Abfrage.
      const weitere = i.transactions.pageInfo.hasNextPage
        ? await leseAlleSeiten(async (after) => ALS_SEITE((await graphql<{ investment: { transactions: Verbindung<Transaktion> } }>(k, TRANSACTIONS, { investmentId: i.id, after: after ?? i.transactions.pageInfo.endCursor })).investment.transactions))
        : [];
      for (const t of [...i.transactions.nodes, ...weitere]) {
        const v: QuellVorgang = { quellId: t.id, beteiligungId: i.id, art: wert(ART, t.type), datum: t.date, betrag: t.amount, rundeId: t.round?.id, bemerkung: ohneNull(t.note), storniertId: t.reverses?.id, kapitalisiert: t.capitalized };
        a.vorgaenge.push(v);
      }
      for (const b of i.valuations) a.bewertungen.push({ quellId: b.id, beteiligungId: i.id, stichtag: b.date, wert: b.value, methode: wert(METHODE, b.method), begruendung: ohneNull(b.note), grundlage: ohneNull(b.basis) });
    }
    type Round = { id: string; company: { id: string }; name: string; closedOn: string; preMoney: string; postMoney: string; pricePerShare: string; sharesAfter: number; participants: { amount: string; shares: number; role: string; fund: { id: string } | null; investor: { id: string; name: string } | null }[] };
    const runden = await leseAlleSeiten(async (after) => ALS_SEITE((await graphql<{ fund: { rounds: Verbindung<Round> } }>(k, ROUNDS, { fundId, after })).fund.rounds));
    for (const r of runden) {
      for (const p of r.participants) if (p.investor) a.organisationen.push({ quellId: p.investor.id, name: p.investor.name, art: "investor" });
      a.runden.push({
        quellId: r.id, organisationId: r.company.id, bezeichnung: r.name, datum: r.closedOn, preMoney: r.preMoney, postMoney: r.postMoney, preisJeAnteil: r.pricePerShare, anteileGesamtNach: r.sharesAfter,
        positionen: r.participants.map((p) => ({ ...(p.fund ? { fondsId: p.fund.id } : { investorId: p.investor?.id }), betrag: p.amount, anteile: p.shares, rolle: wert(ROLLE, p.role) })),
      });
    }
    type Metric = { id: string; company: { id: string }; name: string; periodStart: string; periodEnd: string; scenario: string; value: string };
    const kennzahlen = await leseAlleSeiten(async (after) => ALS_SEITE((await graphql<{ fund: { metrics: Verbindung<Metric> } }>(k, METRICS, { fundId, after })).fund.metrics));
    for (const m of kennzahlen) a.kennzahlen.push({ quellId: m.id, organisationId: m.company.id, kennzahl: m.name, periodeBeginn: m.periodStart, periodeEnde: m.periodEnd, szenario: wert(SZENARIO, m.scenario), wert: m.value });
    const summen = (await graphql<{ fund: { totals: { investment: { id: string } | null; measure: string; amount: string; asOf: string | null }[] } }>(k, TOTALS, { fundId })).fund.totals;
    for (const s of summen) a.kontrollsummen.push({ fondsId: fundId, ...(s.investment ? { beteiligungId: s.investment.id } : {}), groesse: wert(GROESSE, s.measure), betrag: s.amount, ...(s.asOf ? { stichtag: s.asOf } : {}) });
    return a;
  },
};
