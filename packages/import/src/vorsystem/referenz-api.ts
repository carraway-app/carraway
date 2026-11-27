import type { QuellAbfrage } from "./adapter";

/**
 * Erfundene Beispiel-API für den Referenz-Adapter und die Tests: eine kleine GraphQL-Schnittstelle (`POST /graphql`) mit Fonds,
 * Beteiligungen, verschachtelten Unternehmen, Kontakten und Vorgängen, Runden mit Teilnehmern, Kennzahlen und Summen. Sie erkennt die
 * Abfrage am Operationsnamen (`query Funds(…)`) statt die Abfrage zu parsen; das genügt als Gegenstück zum Referenz-Adapter.
 * Alle Namen und Zahlen sind erfunden.
 */

export interface BeispielDaten {
  funds: { id: string; name: string; shortName?: string; vintage: number; committedCapital: string; currency: string }[];
  companies: { id: string; name: string; website?: string; sector?: string; city?: string; contacts: { id: string; firstName: string; lastName: string; email?: string; title?: string }[] }[];
  investments: { id: string; fundId: string; companyId: string; instrument: string; label?: string; firstInvestedOn: string; status: string }[];
  transactions: { id: string; investmentId: string; type: string; date: string; amount: string; roundId?: string; note?: string; reversesId?: string; capitalized?: boolean }[];
  valuations: { id: string; investmentId: string; date: string; value: string; method: string; note?: string; basis?: string }[];
  rounds: { id: string; companyId: string; name: string; closedOn: string; preMoney: string; postMoney: string; pricePerShare: string; sharesAfter: number; participants: { amount: string; shares: number; role: string; fundId?: string; investor?: { id: string; name: string } }[] }[];
  metrics: { id: string; companyId: string; name: string; periodStart: string; periodEnd: string; scenario: string; value: string }[];
  totals: { fundId: string; investmentId?: string; measure: string; amount: string; asOf?: string }[];
}

/** Erfundene Demo-Daten: zwei Fonds, ein Unternehmen in beiden Fonds, ein Unternehmen unter zwei IDs, ein dritter Investor in einer Runde. */
export function beispielDaten(): BeispielDaten {
  const zinsen = ["01-31", "02-28", "03-31", "04-30", "05-31", "06-30"].map((tag, i) => ({ id: `t-a2-zins-${i + 1}`, investmentId: "i-a2", type: "INTEREST_ACCRUAL", date: `2025-${tag}`, amount: "1000.00" }));
  return {
    funds: [
      { id: "f-1", name: "Beispielfonds Eins", shortName: "BSP-1", vintage: 2021, committedCapital: "50000000.00", currency: "EUR" },
      { id: "f-2", name: "Beispielfonds Zwei", vintage: 2023, committedCapital: "30000000.00", currency: "EUR" },
    ],
    companies: [
      { id: "c-1", name: "Nordlicht Robotik GmbH", website: "https://nordlicht-robotik.example", sector: "Robotik", city: "Kiel", contacts: [{ id: "p-1", firstName: "Mara", lastName: "Feld", email: "mara.feld@nordlicht-robotik.example", title: "Geschäftsführerin" }] },
      { id: "c-2", name: "Kiesel Analytics GmbH", website: "https://kiesel-analytics.example", sector: "Software", city: "Jena", contacts: [] },
      // Dasselbe Unternehmen, im zweiten Fonds unter eigener ID geführt (gleiche Website).
      { id: "c-2b", name: "Kiesel Analytics", website: "https://www.kiesel-analytics.example/", sector: "Software", city: "Jena", contacts: [] },
    ],
    investments: [
      { id: "i-a1", fundId: "f-1", companyId: "c-1", instrument: "EQUITY", firstInvestedOn: "2024-03-01", status: "ACTIVE" },
      { id: "i-a2", fundId: "f-1", companyId: "c-2", instrument: "LOAN", label: "Darlehen 2025", firstInvestedOn: "2025-01-01", status: "ACTIVE" },
      { id: "i-b1", fundId: "f-2", companyId: "c-1", instrument: "EQUITY", firstInvestedOn: "2024-03-01", status: "ACTIVE" },
      { id: "i-b2", fundId: "f-2", companyId: "c-2b", instrument: "CONVERTIBLE_LOAN", firstInvestedOn: "2024-06-01", status: "ACTIVE" },
    ],
    transactions: [
      { id: "t-a1-1", investmentId: "i-a1", type: "COMMITMENT", date: "2024-03-01", amount: "1000000.00", roundId: "r-1" },
      { id: "t-a1-2", investmentId: "i-a1", type: "DRAWDOWN", date: "2024-03-01", amount: "1000000.00", roundId: "r-1" },
      { id: "t-a2-1", investmentId: "i-a2", type: "COMMITMENT", date: "2025-01-01", amount: "200000.00" },
      { id: "t-a2-2", investmentId: "i-a2", type: "DRAWDOWN", date: "2025-01-01", amount: "200000.00" },
      ...zinsen,
      { id: "t-a2-3", investmentId: "i-a2", type: "REPAYMENT", date: "2025-06-30", amount: "50000.00" },
      { id: "t-b1-1", investmentId: "i-b1", type: "COMMITMENT", date: "2024-03-01", amount: "500000.00", roundId: "r-1" },
      { id: "t-b1-2", investmentId: "i-b1", type: "DRAWDOWN", date: "2024-03-01", amount: "500000.00", roundId: "r-1" },
      { id: "t-b2-1", investmentId: "i-b2", type: "COMMITMENT", date: "2024-06-01", amount: "300000.00" },
      { id: "t-b2-2", investmentId: "i-b2", type: "DRAWDOWN", date: "2024-06-01", amount: "300000.00" },
      { id: "t-b2-3", investmentId: "i-b2", type: "CONVERSION", date: "2025-03-31", amount: "300000.00", note: "Wandlung in Anteile" },
    ],
    valuations: [
      { id: "v-a1", investmentId: "i-a1", date: "2024-12-31", value: "1200000.00", method: "LAST_ROUND", note: "Preis der Series A", basis: "Series A" },
      { id: "v-b1", investmentId: "i-b1", date: "2024-12-31", value: "600000.00", method: "LAST_ROUND", note: "Preis der Series A", basis: "Series A" },
    ],
    rounds: [
      {
        id: "r-1", companyId: "c-1", name: "Series A", closedOn: "2024-03-01", preMoney: "8000000.00", postMoney: "10000000.00", pricePerShare: "10.0000", sharesAfter: 1000000,
        participants: [
          { amount: "1000000.00", shares: 100000, role: "LEAD", fundId: "f-1" },
          { amount: "500000.00", shares: 50000, role: "PARTICIPANT", fundId: "f-2" },
          { amount: "500000.00", shares: 50000, role: "PARTICIPANT", investor: { id: "x-1", name: "Weidenbach Kapital AG" } },
        ],
      },
    ],
    metrics: [
      { id: "m-1", companyId: "c-1", name: "Revenue", periodStart: "2026-01-01", periodEnd: "2026-03-31", scenario: "ACTUAL", value: "1500000.00" },
      { id: "m-2", companyId: "c-1", name: "Headcount", periodStart: "2026-01-01", periodEnd: "2026-03-31", scenario: "ACTUAL", value: "42" },
      { id: "m-3", companyId: "c-2", name: "Revenue", periodStart: "2026-01-01", periodEnd: "2026-12-31", scenario: "BUDGET", value: "800000.00" },
      { id: "m-4", companyId: "c-2", name: "Burn multiple", periodStart: "2026-01-01", periodEnd: "2026-03-31", scenario: "ACTUAL", value: "1.8" },
    ],
    totals: [
      { fundId: "f-1", measure: "COMMITMENTS", amount: "1200000.00" },
      { fundId: "f-1", measure: "DRAWDOWNS", amount: "1200000.00" },
      { fundId: "f-1", investmentId: "i-a2", measure: "DRAWDOWNS", amount: "200000.00" },
      { fundId: "f-2", measure: "COMMITMENTS", amount: "800000.00" },
    ],
  };
}

export interface BeispielOptionen {
  /** Einträge je Seite (klein, damit die Tests das Blättern sehen). */
  seite?: number;
  /** Diese Anfragen (1-basiert) scheitern einmal mit einer vorübergehenden Störung. */
  stoerungen?: number[];
  /** Diese Anfragen (1-basiert) melden eine Ratenbegrenzung mit Wartezeit. */
  drosselungen?: number[];
}

/** Vorübergehende Störung der Beispiel-API (wie ein Zeitlimit oder ein 503). */
export class BeispielStoerung extends Error {
  constructor(readonly warteSekunden?: number) {
    super(warteSekunden === undefined ? "temporary_failure" : "rate_limited");
  }
}

interface Anfrage {
  query: string;
  variables?: Record<string, unknown>;
}

const verbindung = <T>(alle: T[], nach: unknown, groesse: number) => {
  const start = typeof nach === "string" && nach !== "" ? Number(nach) : 0;
  const nodes = alle.slice(start, start + groesse);
  const ende = start + nodes.length;
  return { nodes, pageInfo: { hasNextPage: ende < alle.length, endCursor: ende < alle.length ? String(ende) : null } };
};

/** Eine `QuellAbfrage` gegen die Beispiel-API im Speicher (für Tests ohne Netz). Zählt die Anfragen in `anfragen`. */
export function beispielApi(daten: BeispielDaten = beispielDaten(), optionen: BeispielOptionen = {}): QuellAbfrage & { anfragen: Anfrage[] } {
  const groesse = optionen.seite ?? 2;
  const anfragen: Anfrage[] = [];
  const fn = async (pfad: string, koerper?: object) => {
    if (pfad !== "/graphql") throw new Error("unknown_path");
    const a = koerper as Anfrage;
    anfragen.push(a);
    const nr = anfragen.length;
    if (optionen.stoerungen?.includes(nr)) throw new BeispielStoerung();
    if (optionen.drosselungen?.includes(nr)) throw new BeispielStoerung(2);
    return { data: antwort(daten, a, groesse) };
  };
  return Object.assign(fn, { anfragen });
}

function antwort(d: BeispielDaten, a: Anfrage, groesse: number): unknown {
  const v = a.variables ?? {};
  const name = /^\s*query\s+(\w+)/.exec(a.query)?.[1];
  const company = (id: string) => {
    const c = d.companies.find((x) => x.id === id)!;
    return { id: c.id, name: c.name, website: c.website ?? null, sector: c.sector ?? null, city: c.city ?? null, contacts: c.contacts.map((p) => ({ ...p, email: p.email ?? null, title: p.title ?? null })) };
  };
  const transaktionen = (investmentId: string, nach: unknown) =>
    verbindung(d.transactions.filter((t) => t.investmentId === investmentId).map((t) => ({ id: t.id, type: t.type, date: t.date, amount: t.amount, round: t.roundId ? { id: t.roundId } : null, note: t.note ?? null, reverses: t.reversesId ? { id: t.reversesId } : null, capitalized: t.capitalized ?? false })), nach, 3);
  const portfolio = (fundId: string) => new Set(d.investments.filter((i) => i.fundId === fundId).map((i) => i.companyId));
  switch (name) {
    case "Funds":
      return { funds: verbindung(d.funds.map((f) => ({ ...f, shortName: f.shortName ?? null })), v.after, 1) };
    case "FundInvestments": {
      const alle = d.investments.filter((i) => i.fundId === v.fundId).map((i) => ({
        id: i.id, instrument: i.instrument, label: i.label ?? null, firstInvestedOn: i.firstInvestedOn, status: i.status,
        company: company(i.companyId),
        transactions: transaktionen(i.id, null),
        valuations: d.valuations.filter((x) => x.investmentId === i.id).map((x) => ({ id: x.id, date: x.date, value: x.value, method: x.method, note: x.note ?? null, basis: x.basis ?? null })),
      }));
      return { fund: { investments: verbindung(alle, v.after, groesse) } };
    }
    case "InvestmentTransactions":
      return { investment: { transactions: transaktionen(String(v.investmentId), v.after) } };
    case "FundRounds": {
      const firmen = portfolio(String(v.fundId));
      const alle = d.rounds.filter((r) => firmen.has(r.companyId)).map((r) => ({
        id: r.id, company: { id: r.companyId }, name: r.name, closedOn: r.closedOn, preMoney: r.preMoney, postMoney: r.postMoney, pricePerShare: r.pricePerShare, sharesAfter: r.sharesAfter,
        participants: r.participants.map((p) => ({ amount: p.amount, shares: p.shares, role: p.role, fund: p.fundId ? { id: p.fundId } : null, investor: p.investor ?? null })),
      }));
      return { fund: { rounds: verbindung(alle, v.after, groesse) } };
    }
    case "FundMetrics": {
      const firmen = portfolio(String(v.fundId));
      const alle = d.metrics.filter((m) => firmen.has(m.companyId)).map((m) => ({ id: m.id, company: { id: m.companyId }, name: m.name, periodStart: m.periodStart, periodEnd: m.periodEnd, scenario: m.scenario, value: m.value }));
      return { fund: { metrics: verbindung(alle, v.after, groesse) } };
    }
    case "FundTotals":
      return { fund: { totals: d.totals.filter((t) => t.fundId === v.fundId).map((t) => ({ investment: t.investmentId ? { id: t.investmentId } : null, measure: t.measure, amount: t.amount, asOf: t.asOf ?? null })) } };
    default:
      throw new Error("unknown_operation");
  }
}
