import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { FONDS_ID, rendereApp, spieleApi } from "../test/hilfen";

const url = `/funds?fundId=${FONDS_ID}`;

describe("Fondsverwaltung: Leiste, Reiter und Sprungmarken", () => {
  it("Stammdaten: Abschnitte untereinander mit Sprungmarken; Investoren und Dokumente sind eigene Orte in der Leiste", async () => {
    spieleApi();
    const nutzer = userEvent.setup();
    const { router } = rendereApp(url);
    const marken = await screen.findByRole("navigation", { name: "Bereiche des Fonds" });
    expect(within(marken).getAllByRole("link").map((m) => m.textContent)).toEqual(["Stammdaten", "Gremien", "Zinsabgrenzung", "Periodensperre", "Felder"]);
    expect(screen.queryByRole("tablist")).toBeNull();
    const leiste = within(screen.getByRole("navigation", { name: "Hauptnavigation" }));
    expect(leiste.getByRole("link", { name: "Stammdaten" }).getAttribute("aria-current")).toBe("page");

    await nutzer.click(leiste.getByRole("link", { name: "Dokumente" }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ fondsId: FONDS_ID, tab: "dokumente" }));
    await waitFor(() => expect(leiste.getByRole("link", { name: "Dokumente" }).getAttribute("aria-current")).toBe("page"));

    await nutzer.click(leiste.getByRole("link", { name: "Investoren" }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ tab: "kapital" }));
    const reiter = await screen.findByRole("tablist", { name: "Investoren" });
    expect(within(reiter).getAllByRole("tab").map((r) => r.textContent)).toEqual(["Kapitaltransaktionen", "Investoren"]);

    // Stammdaten ist der Standard und steht nicht in der Adresse.
    await nutzer.click(leiste.getByRole("link", { name: "Stammdaten" }));
    await waitFor(() => expect(router.state.location.search).not.toHaveProperty("tab"));
  });

  it("bisherige Adressen eines Abschnitts führen auf die Stammdaten mit diesem Abschnitt", async () => {
    spieleApi();
    rendereApp(`${url}&tab=fields`);
    expect(await screen.findByRole("region", { name: "Felder" })).toBeTruthy();
    const leiste = within(screen.getByRole("navigation", { name: "Hauptnavigation" }));
    expect(leiste.getByRole("link", { name: "Stammdaten" }).getAttribute("aria-current")).toBe("page");
  });

  it("Englisch: Sprungmarken und Leiste", async () => {
    localStorage.setItem("carraway.sprache", "en");
    spieleApi();
    rendereApp(url);
    const marken = await screen.findByRole("navigation", { name: "Fund sections" });
    expect(within(marken).getAllByRole("link")[0]!.textContent).toBe("Fund details");
    expect(within(screen.getByRole("navigation", { name: "Main navigation" })).getByRole("link", { name: "Master data" })).toBeTruthy();
  });
});

