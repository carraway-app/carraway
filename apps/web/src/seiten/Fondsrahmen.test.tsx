import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { FONDS_ID, rendereApp, spieleApi } from "../test/hilfen";

const uebersichtsAnfragen = (fetch: ReturnType<typeof spieleApi>) => fetch.mock.calls.map(([u]) => String(u)).filter((u) => new URL(u).pathname === `/api/v1/fonds/${FONDS_ID}/uebersicht`);

describe("Fondsrahmen", () => {
  it.each(["kennzahlen", "szenarien", "reserven", "zinsen", "bewertungsrunde"])("zeigt auf %s Fondsname und Kennzahlen über dem Inhaltsverzeichnis", async (bereich) => {
    spieleApi();
    rendereApp(`/fonds/${FONDS_ID}/${bereich}`);
    const haupt = await screen.findByRole("main");
    const titel = await within(haupt).findByRole("heading", { level: 1, name: "Beispielfonds I" });
    expect(within(haupt).getAllByRole("heading", { level: 1 })).toHaveLength(1);
    const kennzahlen = haupt.querySelector(".cw-kennzahlen")!;
    expect(kennzahlen.textContent).toContain("TVPI");
    const verzeichnis = within(haupt).getByRole("navigation", { name: "Bereiche des Portfolios" });
    expect(titel.compareDocumentPosition(kennzahlen) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(kennzahlen.compareDocumentPosition(verzeichnis) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // kein „zurück“-Link mehr zur Übersicht
    expect(within(haupt).queryByRole("link", { name: /Zum Portfolio|Zurück/ })).toBeNull();
    expect(within(verzeichnis).getAllByRole("button").some((k) => k.getAttribute("aria-current") === "page")).toBe(true);
  });

  it("zeigt Stichtag und Wissensstand nur auf der Übersicht, den Stand überall", async () => {
    spieleApi();
    rendereApp(`/fonds/${FONDS_ID}/szenarien`);
    const nutzer = userEvent.setup();
    await screen.findByRole("heading", { level: 1, name: "Beispielfonds I" });
    expect(screen.queryByLabelText("Stichtag")).toBeNull();
    expect(document.querySelector(".app-meta-stand")).not.toBeNull();
    await nutzer.click(within(screen.getByRole("navigation", { name: "Bereiche des Portfolios" })).getByRole("button", { name: "Übersicht" }));
    expect(await screen.findByLabelText("Stichtag")).toBeTruthy();
    expect(document.querySelector(".app-meta-stand")).not.toBeNull();
  });

  it("lässt die Kennzahlen unverändert, wenn die Bewertungsrunde einen eigenen Stichtag trägt", async () => {
    const fetch = spieleApi();
    rendereApp(`/fonds/${FONDS_ID}/bewertungsrunde?stichtag=2024-06-30`);
    await waitFor(() => expect(document.querySelector(".cw-kennzahlen")).not.toBeNull());
    const anfragen = uebersichtsAnfragen(fetch);
    expect(anfragen.length).toBeGreaterThan(0);
    expect(anfragen.every((u) => !u.includes("stichtag"))).toBe(true);
  });

  it("lässt die Kennzahlen unverändert, wenn die Zinsen einen eigenen Stichtag und Wissensstand tragen", async () => {
    const fetch = spieleApi();
    rendereApp(`/fonds/${FONDS_ID}/zinsen?stichtag=2026-06-30`);
    await screen.findByRole("table");
    const anfragen = uebersichtsAnfragen(fetch);
    expect(anfragen.length).toBeGreaterThan(0);
    expect(anfragen.every((u) => !u.includes("stichtag"))).toBe(true);
    const zinsen = fetch.mock.calls.map(([u]) => new URL(String(u))).filter((u) => u.pathname === `/api/v1/fonds/${FONDS_ID}/zinsen`);
    expect(zinsen[0]!.searchParams.get("stichtag")).toBe("2026-06-30");
  });

  it("fragt die Übersicht beim Wechsel zwischen den Bereichen nicht erneut ab", async () => {
    const fetch = spieleApi();
    rendereApp(`/fonds/${FONDS_ID}`);
    const nutzer = userEvent.setup();
    await screen.findByRole("table");
    for (const name of ["Szenarien", "Reserven", "Zinsen", "Kennzahlen", "Übersicht"]) {
      await nutzer.click(within(screen.getByRole("navigation", { name: "Bereiche des Portfolios" })).getByRole("button", { name }));
      await waitFor(() => expect(within(screen.getByRole("navigation", { name: "Bereiche des Portfolios" })).getByRole("button", { name }).getAttribute("aria-current")).toBe("page"));
      // Die Kennzahlen bleiben beim Wechsel stehen.
      expect(document.querySelector(".cw-kennzahlen")).not.toBeNull();
    }
    expect(uebersichtsAnfragen(fetch)).toHaveLength(1);
  });

  it("zeigt Meldungen und Journal ohne den Rahmen", async () => {
    spieleApi();
    const { router } = rendereApp(`/fonds/${FONDS_ID}/meldungen`);
    await screen.findAllByRole("heading", { level: 1 });
    expect(document.querySelector(".cw-kennzahlen")).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Bereiche des Portfolios" })).toBeNull();
    await router.navigate({ to: "/fonds/$fondsId/journal", params: { fondsId: FONDS_ID }, search: {} });
    await waitFor(() => expect(router.state.location.pathname).toBe(`/fonds/${FONDS_ID}/journal`));
    await screen.findAllByRole("heading", { level: 1 });
    expect(document.querySelector(".cw-kennzahlen")).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Bereiche des Portfolios" })).toBeNull();
  });
});
