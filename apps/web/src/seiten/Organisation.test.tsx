import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ORG_A, organisationDaten, rendereApp, spieleApi } from "../test/hilfen";

describe("Organisation", () => {
  it("zeigt Kontakte (eine Tabelle, nicht doppelt), Deals und Beteiligungen", async () => {
    spieleApi();
    rendereApp(`/organizations/${ORG_A}`);
    expect(await screen.findByRole("heading", { level: 1, name: "Alpha Energie" })).toBeTruthy();
    const kontakte = await screen.findByRole("region", { name: "Kontakte des Unternehmens" });
    expect(await within(kontakte).findByText("Eva Muster")).toBeTruthy();
    // Die frühere Karte „Personen“ gibt es nicht mehr, dieselben Leute stehen nur einmal da.
    expect(screen.queryByRole("region", { name: "Personen" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Rollen" })).toBeNull();
    expect(screen.getAllByText("Eva Muster")).toHaveLength(1);
    const nutzer = userEvent.setup();
    await nutzer.click(within(screen.getByRole("navigation", { name: /^(Hauptnavigation|Main navigation)$/ })).getByRole("link", { name: /^Deals/ }));
    expect(within(await screen.findByRole("region", { name: "Deals" })).getByText("Alpha, Wachstum")).toBeTruthy();
    await nutzer.click(within(screen.getByRole("navigation", { name: /^(Hauptnavigation|Main navigation)$/ })).getByRole("link", { name: /^Beteiligungen/ }));
    const fonds = within(await screen.findByRole("region", { name: "Beteiligungen" })).getByRole("link", { name: "Beispielfonds I" });
    expect(fonds.getAttribute("href")).toBe("/funds/11111111-1111-4111-8111-111111111111");
    expect(within(screen.getByRole("region", { name: "Beteiligungen" })).getByRole("link", { name: "Wandeldarlehen" }).getAttribute("href")).toBe("/investments/b1");
  });

  it("verknüpft eine neue Aktivität über das Suchfeld mit einem Deal", async () => {
    const leer = { q: "x", organisationen: [], personen: [], deals: [], beteiligungen: [], dokumente: [] };
    const api = spieleApi({
      "/api/v1/suche": { koerper: { ...leer, deals: [{ id: "d-suche", titel: "Alpha, Wachstum", organisation: { id: ORG_A, name: "Alpha Energie" } }] } },
      "POST /api/v1/aktivitaeten": { status: 201, koerper: { id: "a-neu" } },
    });
    const nutzer = userEvent.setup();
    rendereApp(`/organizations/${ORG_A}?tab=activity`);
    await nutzer.click(await screen.findByRole("button", { name: "Aktivität erfassen" }));
    const dialog = within(await screen.findByRole("dialog"));
    await nutzer.type(dialog.getByLabelText("Titel"), "Gespräch");
    await nutzer.type(dialog.getByRole("combobox", { name: "Deal (optional)" }), "Alpha");
    await nutzer.click(await dialog.findByRole("option", { name: /Alpha, Wachstum/ }));
    await nutzer.click(dialog.getByRole("button", { name: "Aktivität speichern" }));
    await waitFor(() => expect(api.anfragen("POST", "/api/v1/aktivitaeten")).toHaveLength(1));
    expect(api.anfragen("POST", "/api/v1/aktivitaeten")[0]!.koerper).toMatchObject({ organisationId: ORG_A, dealId: "d-suche", titel: "Gespräch" });
  });

  it("macht die Website nur bei http und https zum Link, in neuem Tab ohne Rückbezug", async () => {
    spieleApi({ [`/api/v1/organisationen/${ORG_A}`]: { koerper: { ...organisationDaten, website: "https://example.org/start" } } });
    rendereApp(`/organizations/${ORG_A}`);
    const link = await screen.findByRole("link", { name: "https://example.org/start" });
    expect(link.getAttribute("href")).toBe("https://example.org/start");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it.each(["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<b>x</b>", "vbscript:x", "keine adresse"])("zeigt %s als einfachen Text ohne Link", async (website) => {
    spieleApi({ [`/api/v1/organisationen/${ORG_A}`]: { koerper: { ...organisationDaten, website } } });
    rendereApp(`/organizations/${ORG_A}`);
    const text = await screen.findByText(website);
    expect(text.closest("a")).toBeNull();
    expect(document.querySelector(`a[href^="javascript" i], a[href^="data" i], a[href^="vbscript" i]`)).toBeNull();
  });

  it("bearbeitet Rechtsform, Sitzland, Region und NACE-Abschnitt an einer Stelle", async () => {
    const api = spieleApi({
      [`/api/v1/organizations/${ORG_A}/reporting-data`]: { koerper: { organisationId: ORG_A, sitzland: "DE", region: "Bayern" } },
      [`PUT /api/v1/organizations/${ORG_A}/reporting-data`]: { koerper: { organisationId: ORG_A, sitzland: "AT", region: "Bayern" } },
      [`PATCH /api/v1/organisationen/${ORG_A}`]: { koerper: organisationDaten },
    });
    const nutzer = userEvent.setup();
    rendereApp(`/organizations/${ORG_A}`);
    await nutzer.click(await screen.findByRole("button", { name: "Organisation bearbeiten" }));
    const dialog = await screen.findByRole("dialog");
    const land = within(dialog).getByLabelText(/Sitzland/) as HTMLInputElement;
    await waitFor(() => expect(land.value).toBe("DE"));
    expect((within(dialog).getByLabelText("Region des Unternehmens") as HTMLInputElement).value).toBe("Bayern");
    await nutzer.clear(land);
    await nutzer.type(land, "at");
    await nutzer.type(within(dialog).getByLabelText("Rechtsform"), "GmbH");
    await nutzer.selectOptions(within(dialog).getByLabelText(/NACE-Abschnitt/), "J");
    await nutzer.click(within(dialog).getByRole("button", { name: "Änderungen speichern" }));
    await waitFor(() => expect(api.anfragen("PUT", `/api/v1/organizations/${ORG_A}/reporting-data`)).toHaveLength(1));
    expect(api.anfragen("PUT", `/api/v1/organizations/${ORG_A}/reporting-data`)[0]!.koerper).toEqual({ sitzland: "AT", region: "Bayern" });
    await waitFor(() => expect(api.anfragen("PATCH", `/api/v1/organisationen/${ORG_A}`)).toHaveLength(1));
    expect(api.anfragen("PATCH", `/api/v1/organisationen/${ORG_A}`)[0]!.koerper).toMatchObject({ naceAbschnitt: "J", rechtsform: "GmbH" });
  });

  it("gliedert die Bereiche in Gruppen, ohne Reiter, und öffnet über alte Adressen den richtigen Eintrag", async () => {
    spieleApi();
    const { unmount } = rendereApp(`/organizations/${ORG_A}`);
    await screen.findByRole("heading", { level: 1, name: "Alpha Energie" });
    expect(screen.queryByRole("tab")).toBeNull();
    const nav = screen.getByRole("navigation", { name: "Hauptnavigation" });
    for (const gruppe of ["Unternehmen", "Engagement", "Kapital", "Zusammenarbeit", "Ablage"]) expect(within(nav).getByRole("button", { name: gruppe })).toBeTruthy();
    for (const eintrag of ["Kontakte", "Beziehungen", "Deals", "Beteiligungen", "Runden", "Register", "Aktivitäten", "Termine", "Aufgaben", "Dokumente", "Verknüpft"]) {
      expect(within(nav).getByRole("link", { name: new RegExp(`^${eintrag}`) })).toBeTruthy();
    }
    await waitFor(() => expect(within(nav).getByRole("link", { name: /^Kontakte/ }).getAttribute("aria-current")).toBe("page"));
    unmount();

    for (const [suche, eintrag] of [
      ["tab=activity&subtab=appointments", "Termine"],
      ["tab=activity", "Aktivitäten"],
      ["tab=engagement&subtab=investments", "Beteiligungen"],
      ["tab=overview&subtab=relationships", "Beziehungen"],
      ["tab=register", "Register"],
      ["tab=documents", "Dokumente"],
    ] as const) {
      spieleApi();
      const { unmount: weg } = rendereApp(`/organizations/${ORG_A}?${suche}`);
      const knopf = await within(await screen.findByRole("navigation", { name: /^(Hauptnavigation|Main navigation)$/ })).findByRole("link", { name: new RegExp(`^${eintrag}`) });
      expect(knopf.getAttribute("aria-current")).toBe("page");
      weg();
    }
  });

  it("Investor: Abschnitt Vehikel mit Tabelle, Beteiligungen je Vehikel und Anlegen", async () => {
    const vehikel = [
      {
        id: "v1",
        investorId: ORG_A,
        name: "Alpha Seedfonds I",
        art: "fonds",
        auflagejahr: 2018,
        status: "aktiv",
        standard: true,
        anzahlPositionen: 2,
        positionen: [{ id: "p1", rundeId: "r1", runde: "Seed", datum: "2021-05-31", status: "abgeschlossen", unternehmen: { id: "o9", name: "Beta Medizin" }, betrag: "500000.00", anteile: "40500", rolle: "co" }],
      },
      { id: "v2", investorId: ORG_A, name: "Alpha Wachstumsfonds II", art: "gesellschaft", auflagejahr: null, status: "in_liquidation", standard: false, anzahlPositionen: 0, positionen: [] },
    ];
    const api = spieleApi({
      [`/api/v1/organisationen/${ORG_A}`]: { koerper: { ...organisationDaten, art: "investor", vehikelAnzahl: 2 } },
      [`/api/v1/organisationen/${ORG_A}/vehikel`]: { koerper: { daten: vehikel } },
      [`POST /api/v1/organisationen/${ORG_A}/vehikel`]: { status: 201, koerper: { ...vehikel[1], id: "v3", name: "Alpha SPV" } },
    });
    rendereApp(`/organizations/${ORG_A}?tab=engagement&subtab=vehicles`);
    const tabelle = within(await screen.findByRole("region", { name: "Vehikel des Investors" }));
    const seed = tabelle.getAllByRole("row").find((z) => z.textContent?.includes("Alpha Seedfonds I"))!;
    expect(within(seed).getByText("Standard")).toBeTruthy();
    // Löschen nur ohne Positionen
    expect((within(seed).getByRole("button", { name: "Vehikel Alpha Seedfonds I löschen" }) as HTMLButtonElement).disabled).toBe(true);
    expect(tabelle.getByText("In Liquidation")).toBeTruthy();
    const positionen = within(screen.getByRole("region", { name: "Positionen von Alpha Seedfonds I" }));
    expect(positionen.getByRole("link", { name: "Beta Medizin" })).toBeTruthy();
    // Ein Position zählt mehr, als sichtbar ist: Hinweis
    expect(screen.getByText("1 Position in einer Runde, die Sie nicht sehen dürfen.")).toBeTruthy();

    const nutzer = userEvent.setup();
    await nutzer.click(screen.getByRole("button", { name: "Vehikel anlegen" }));
    const dialog = within(await screen.findByRole("dialog"));
    await nutzer.type(dialog.getByLabelText("Name"), "Alpha SPV");
    await nutzer.selectOptions(dialog.getByLabelText("Art"), "spv");
    await nutzer.type(dialog.getByLabelText("Auflagejahr (optional)"), "2024");
    await nutzer.click(dialog.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(api.anfragen("POST", `/api/v1/organisationen/${ORG_A}/vehikel`)).toHaveLength(1));
    expect(api.anfragen("POST", `/api/v1/organisationen/${ORG_A}/vehikel`)[0]!.koerper).toEqual({ name: "Alpha SPV", art: "spv", auflagejahr: 2024, status: "aktiv" });
  });

  it("Unternehmen ohne Vehikel: kein Abschnitt Vehikel", async () => {
    spieleApi();
    rendereApp(`/organizations/${ORG_A}`);
    await screen.findByRole("heading", { level: 1, name: "Alpha Energie" });
    expect(screen.queryByRole("button", { name: /^Vehikel/ })).toBeNull();
  });
});
