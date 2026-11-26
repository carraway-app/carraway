import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { FONDS_ID, rendereApp, spieleApi } from "../test/hilfen";

const url = `/fonds?fondsId=${FONDS_ID}`;

function gruppenDerListe(verzeichnis: HTMLElement) {
  return within(verzeichnis)
    .getAllByRole("list")
    .map((liste) => [document.getElementById(liste.getAttribute("aria-labelledby") ?? "")?.textContent, within(liste).getAllByRole("button").map((k) => k.textContent)]);
}

describe("Fondsverwaltung: Inhaltsverzeichnis", () => {
  it("gliedert die Bereiche nach Gruppen, hält den Bereich in der Adresse und führt den Fokus in den Inhalt", async () => {
    spieleApi();
    const nutzer = userEvent.setup();
    const { router } = rendereApp(url);
    const verzeichnis = await screen.findByRole("navigation", { name: "Bereiche des Fonds" });
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(within(verzeichnis).getByRole("button", { name: "Stammdaten" }).getAttribute("aria-current")).toBe("page");
    const gruppen = gruppenDerListe(verzeichnis);
    expect(gruppen.map((g) => g[0])).toEqual(["Stammdaten", "Kapital", "Abschluss", "Ablage"]);
    expect(gruppen[1]![1]).toEqual(expect.arrayContaining(["Kapitaltransaktionen"]));
    expect(gruppen[2]![1]).toEqual(expect.arrayContaining(["Zinsabgrenzung", "Periodensperre"]));
    expect(gruppen[3]![1]).toEqual(["Dokumente", "Felder"]);

    await nutzer.click(within(verzeichnis).getByRole("button", { name: "Dokumente" }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ fondsId: FONDS_ID, tab: "dokumente" }));
    expect(within(verzeichnis).getByRole("button", { name: "Dokumente" }).getAttribute("aria-current")).toBe("page");
    await waitFor(() => expect(document.activeElement?.getAttribute("role")).toBe("region"));
    expect(document.activeElement?.getAttribute("aria-labelledby")).toBe(within(verzeichnis).getByRole("button", { name: "Dokumente" }).id);

    // Stammdaten ist der Standard und steht nicht in der Adresse.
    await nutzer.click(within(verzeichnis).getByRole("button", { name: "Stammdaten" }));
    await waitFor(() => expect(router.state.location.search).not.toHaveProperty("tab"));
  });

  it("bisherige Adressen führen auf den Bereich; unbekannte Werte fallen auf Stammdaten zurück", async () => {
    spieleApi();
    rendereApp(`${url}&tab=felder`);
    const verzeichnis = await screen.findByRole("navigation", { name: "Bereiche des Fonds" });
    expect(within(verzeichnis).getByRole("button", { name: "Felder" }).getAttribute("aria-current")).toBe("page");
  });

  it("Englisch: Gruppen und Beschriftung", async () => {
    localStorage.setItem("carraway.sprache", "en");
    spieleApi();
    rendereApp(url);
    const verzeichnis = await screen.findByRole("navigation", { name: "Fund sections" });
    expect(gruppenDerListe(verzeichnis).map((g) => g[0])).toEqual(["Master data", "Capital", "Closing", "Records"]);
  });
});
