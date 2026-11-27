import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { alsRolle, FONDS_ID, rendereApp, spieleApi, feldImStichtagMenue } from "../test/hilfen";

const uebersichtsAnfragen = (fetch: ReturnType<typeof spieleApi>) => fetch.mock.calls.map(([u]) => String(u)).filter((u) => new URL(u).pathname === `/api/v1/funds/${FONDS_ID}/overview`);

describe("Wissensstand nach Rechten (Stichtag-Menü)", () => {
  const bereiche = ["portfolio", "kennzahlen", "finanzen"];
  it.each([
    ["Bearbeiter im Bereich Finanzen", alsRolle("bearbeiter", { bereiche, bereicheJeFonds: { [FONDS_ID]: { portfolio: "bearbeiter", finanzen: "bearbeiter" } } }), true],
    ["Verwalter des Fonds", alsRolle("verwalter", { bereiche, bereicheJeFonds: { [FONDS_ID]: { portfolio: "verwalter", finanzen: "betrachter" } } }), true],
    ["Investment ohne Bereich Finanzen", alsRolle("bearbeiter", { bereiche: ["portfolio", "kennzahlen"], bereicheJeFonds: { [FONDS_ID]: { portfolio: "bearbeiter" } } }), false],
    ["Betrachter im Bereich Finanzen", alsRolle("betrachter", { bereiche, bereicheJeFonds: { [FONDS_ID]: { portfolio: "betrachter", finanzen: "betrachter" } } }), false],
  ])("%s: Wissensstand %s", async (_name, ich, sichtbar) => {
    spieleApi({ "/api/v1/me": ich });
    rendereApp(`/funds/${FONDS_ID}`);
    await screen.findByRole("heading", { level: 1, name: "Beispielfonds I" });
    expect(await feldImStichtagMenue()).toBeTruthy();
    expect(screen.queryByLabelText("Wissensstand", { selector: "input" }) !== null).toBe(sichtbar);
  });
});

describe("Fondsrahmen", () => {
  it.each(["metrics", "scenarios", "reserves", "interest", "valuation-round"])("zeigt auf %s Fondsname und Kennzahlen; die Bereiche stehen in der Seitenleiste, keine zweite Spalte", async (bereich) => {
    spieleApi();
    rendereApp(`/funds/${FONDS_ID}/${bereich}`);
    const haupt = await screen.findByRole("main");
    const titel = await within(haupt).findByRole("heading", { level: 1, name: "Beispielfonds I" });
    expect(within(haupt).getAllByRole("heading", { level: 1 })).toHaveLength(1);
    const kennzahlen = haupt.querySelector(".cw-kennzahlen")!;
    expect(kennzahlen.textContent).toContain("TVPI");
    expect(titel.compareDocumentPosition(kennzahlen) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(haupt.querySelector(".cw-inhalt")).toBeNull();
    // kein „zurück“-Link mehr zur Übersicht
    expect(within(haupt).queryByRole("link", { name: /Zum Portfolio|Zurück/ })).toBeNull();
    const nav = within(screen.getByRole("navigation", { name: "Hauptnavigation" }));
    expect(nav.getAllByRole("link").some((k) => k.getAttribute("aria-current") === "page")).toBe(true);
  });

  it("zeigt Stichtag und Wissensstand nur auf der Übersicht, den Stand überall", async () => {
    spieleApi();
    rendereApp(`/funds/${FONDS_ID}/scenarios`);
    const nutzer = userEvent.setup();
    await screen.findByRole("heading", { level: 1, name: "Beispielfonds I" });
    expect(screen.queryByRole("button", { name: /^Stichtag:/ })).toBeNull();
    expect(document.querySelector(".app-meta-stand")).not.toBeNull();
    await nutzer.click(within(screen.getByRole("navigation", { name: "Hauptnavigation" })).getByRole("link", { name: "Übersicht" }));
    expect(await feldImStichtagMenue()).toBeTruthy();
    expect(document.querySelector(".app-meta-stand")).not.toBeNull();
  });

  it("lässt die Kennzahlen unverändert, wenn die Bewertungsrunde einen eigenen Stichtag trägt", async () => {
    const fetch = spieleApi();
    rendereApp(`/funds/${FONDS_ID}/valuation-round?asOf=2024-06-30`);
    await waitFor(() => expect(document.querySelector(".cw-kennzahlen")).not.toBeNull());
    const anfragen = uebersichtsAnfragen(fetch);
    expect(anfragen.length).toBeGreaterThan(0);
    expect(anfragen.every((u) => !u.includes("asOf"))).toBe(true);
  });

  it("lässt die Kennzahlen unverändert, wenn die Zinsen einen eigenen Stichtag und Wissensstand tragen", async () => {
    const fetch = spieleApi();
    rendereApp(`/funds/${FONDS_ID}/interest?asOf=2026-06-30`);
    await screen.findByRole("table");
    const anfragen = uebersichtsAnfragen(fetch);
    expect(anfragen.length).toBeGreaterThan(0);
    expect(anfragen.every((u) => !u.includes("asOf"))).toBe(true);
    const zinsen = fetch.mock.calls.map(([u]) => new URL(String(u))).filter((u) => u.pathname === `/api/v1/funds/${FONDS_ID}/interest`);
    expect(zinsen[0]!.searchParams.get("asOf")).toBe("2026-06-30");
  });

  it("fragt die Übersicht beim Wechsel zwischen den Bereichen nicht erneut ab", async () => {
    const fetch = spieleApi();
    rendereApp(`/funds/${FONDS_ID}`);
    const nutzer = userEvent.setup();
    await screen.findByRole("table");
    for (const name of ["Planung", "Kennzahlen", "Bewertungsrunde", "Übersicht"]) {
      await nutzer.click(within(screen.getByRole("navigation", { name: "Hauptnavigation" })).getByRole("link", { name }));
      await waitFor(() => expect(within(screen.getByRole("navigation", { name: "Hauptnavigation" })).getByRole("link", { name }).getAttribute("aria-current")).toBe("page"));
      // Die Kennzahlen bleiben beim Wechsel stehen.
      expect(document.querySelector(".cw-kennzahlen")).not.toBeNull();
    }
    expect(uebersichtsAnfragen(fetch)).toHaveLength(1);
  });

  it("zeigt Meldungen und Journal ohne den Rahmen", async () => {
    spieleApi();
    const { router } = rendereApp(`/funds/${FONDS_ID}/filings`);
    await screen.findAllByRole("heading", { level: 1 });
    expect(document.querySelector(".cw-kennzahlen")).toBeNull();
    await router.navigate({ to: "/funds/$fundId/journal", params: { fundId: FONDS_ID }, search: {} });
    await waitFor(() => expect(router.state.location.pathname).toBe(`/funds/${FONDS_ID}/journal`));
    await screen.findAllByRole("heading", { level: 1 });
    expect(document.querySelector(".cw-kennzahlen")).toBeNull();
  });

  it("Planung hat zwei Reiter mit eigener Adresse, die beim Scrollen stehen bleiben", async () => {
    spieleApi();
    const { router } = rendereApp(`/funds/${FONDS_ID}/scenarios`);
    const nutzer = userEvent.setup();
    const reiter = await screen.findByRole("tablist", { name: "Planung" });
    expect(reiter.closest(".cw-tabs--fest")).not.toBeNull();
    expect(within(reiter).getByRole("tab", { name: "Szenarien" }).getAttribute("aria-selected")).toBe("true");
    await nutzer.click(within(reiter).getByRole("tab", { name: "Reserven" }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/funds/${FONDS_ID}/reserves`));
    expect(within(screen.getByRole("navigation", { name: "Hauptnavigation" })).getByRole("link", { name: "Planung" }).getAttribute("aria-current")).toBe("page");
  });
});
