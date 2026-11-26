import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { FONDS_ID, rendereApp, spieleApi, uebersichtDaten } from "../test/hilfen";

const k = (value: string | null) => ({ value, steps: [{ operator: "=", label: "NAV, ohne Doppelzählung", value: value ?? "Lücke" }] });
const gruppe = (key: string | null, type: string, fairValue: string, share: string) => ({ key, label: key, type, count: 1, invested: "100.00", fairValue, investedShare: "0.5", fairValueShare: share });
const dashboard = {
  managerName: "Beispiel Kapitalverwaltung",
  knowledgeDate: null,
  asOf: "2026-09-30",
  homeCurrency: "EUR",
  funds: [{ fundId: FONDS_ID, name: "Testfonds", shortName: "TF", currency: "EUR", commitment: "1000.00", paidIn: "500.00", distributions: "50.00", nav: "700.00", tvpi: "1.5", dpi: "0.1", irr: null, home: { commitment: "1000.00", paidIn: "500.00", distributions: "50.00", nav: "700.00" } }],
  internalHoldings: [{ id: "i1", fundId: FONDS_ID, targetFundId: "x", name: "Anteil", eliminated: true }],
  totals: { commitment: k("1000.00"), paidIn: k("500.00"), distributions: k("50.00"), nav: k("2400000.00"), tvpi: k("1.5"), dpi: k("0.1"), rvpi: k("1.4") },
  gaps: [],
  allocation: {
    invested: "200.00",
    fairValue: "400.00",
    sector: [gruppe("Software", "value", "300.00", "0.75"), gruppe(null, "target_funds", "100.00", "0.25")],
    country: [gruppe(null, "unknown", "400.00", "1")],
    stage: [gruppe("Seed", "value", "400.00", "1")],
    fund: [{ ...gruppe(FONDS_ID, "value", "400.00", "1"), label: "Testfonds" }],
  },
  history: {
    dates: ["2026-03-31", "2026-06-30", "2026-09-30"],
    funds: [{ fundId: FONDS_ID, name: "Testfonds", currency: "EUR", points: ["2026-03-31", "2026-06-30", "2026-09-30"].map((asOf, i) => ({ asOf, nav: i === 2 ? "700.00" : null, portfolioValue: "400.00", home: { nav: i === 2 ? "700.00" : null, portfolioValue: "400.00" } })) }],
    total: ["2026-03-31", "2026-06-30", "2026-09-30"].map((asOf, i) => ({ asOf, nav: i === 2 ? "700.00" : null, portfolioValue: "400.00" })),
  },
};

describe("Portfolio-Dashboard", () => {
  it("zeigt Kennzahlen ohne Doppelzählung, Allokation und Verlauf jeweils als Diagramm und Tabelle", async () => {
    spieleApi({ "/api/v1/portfolio/dashboard": { koerper: dashboard } });
    rendereApp("/portfolio");
    const nutzer = userEvent.setup();
    expect(await screen.findByRole("heading", { level: 1, name: "Portfolio-Dashboard" })).toBeTruthy();
    const kennzahlen = await screen.findByRole("region", { name: "Kennzahlen über alle Fonds" });
    expect(kennzahlen.textContent).toContain("2,4 Mio.");
    expect(screen.getByText("Ein Anteil an einem eigenen Zielfonds ist herausgerechnet.")).toBeTruthy();
    const allokation = screen.getByRole("list", { name: "Balkendiagramm: Allokation nach Sektor in 2 Gruppen" });
    expect(within(allokation).getByText("Software")).toBeTruthy();
    expect(within(allokation).getByText("Zielfonds")).toBeTruthy();
    const verlauf = within(screen.getByRole("region", { name: "Verlauf" }));
    const diagramm = verlauf.getByRole("group", { name: "Verlauf" });
    expect(within(diagramm).getByRole("img", { name: /Liniendiagramm: Portfoliowert von 1 Fonds/ })).toBeTruthy();
    verlauf.getByRole("button", { name: "Tabelle" }).focus();
    await nutzer.tab();
    expect(document.activeElement).toBe(diagramm);
    const karte = screen.getByRole("region", { name: "Allokation" });
    await nutzer.click(within(karte).getByRole("button", { name: "Tabelle" }));
    await waitFor(() => expect(within(karte).getByRole("table")).toBeTruthy());
    expect(within(karte).getByText("75,0 %")).toBeTruthy();
    await nutzer.click(within(karte).getByRole("button", { name: "Land" }));
    await waitFor(() => expect(within(karte).getByText("ohne Angabe")).toBeTruthy());
  });
});

describe("Zielfonds eines Dachfonds", () => {
  it("listet Zielfonds mit Wert und Wertansatz", async () => {
    const metrik = (value: string | null) => ({ value, steps: [] });
    spieleApi({
      [`/api/v1/fonds/${FONDS_ID}/uebersicht`]: { koerper: uebersichtDaten },
      [`/api/v1/fonds/${FONDS_ID}/target-funds`]: {
        koerper: {
          fundId: FONDS_ID, currency: "EUR", asOf: "2026-09-30", knowledgeDate: null,
          data: [{ id: "z1", name: "Fremder Zielfonds", targetFundId: null, targetFundName: null, organizationId: null, metrics: { commitment: metrik("1000.00"), called: metrik("500.00"), unfunded: metrik("500.00"), distributed: metrik("50.00"), value: { value: "500.00", steps: [], method: "reported_nav", reportId: "m1" }, dpi: metrik("0.1"), tvpi: metrik("1.1"), irr: metrik(null) } }, { id: null, name: "Zielfonds", metrics: { value: { value: "150.00" } } }],
          totals: { commitment: "1000.00", called: "500.00", unfunded: "500.00", distributed: "50.00", value: "650.00" },
        },
      },
    });
    rendereApp(`/fonds/${FONDS_ID}/zielfonds`);
    expect(await screen.findByRole("button", { name: "Fremder Zielfonds" })).toBeTruthy();
    const sammel = screen.getByRole("cell", { name: "Zielfonds" }).closest("tr")!;
    expect(sammel.textContent).toContain("150");
    expect(within(sammel).queryByRole("button")).toBeNull();
    expect(screen.getByText("NAV-Meldung fortgeschrieben")).toBeTruthy();
  });
});
