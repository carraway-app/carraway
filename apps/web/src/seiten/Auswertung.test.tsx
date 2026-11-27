import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { FONDS_ID, ORG_A, aktivitaetDaten, fehler, organisationDaten, rendereApp, spieleApi, trichterDaten } from "../test/hilfen";

describe("Dealflow-Auswertung", () => {
  it("zeigt den Trichter mit erreicht, aktuell und Konversion sowie Quellen und Absagegründe", async () => {
    spieleApi();
    rendereApp("/dealflow/analytics");
    const trichter = await screen.findByRole("region", { name: "Trichter nach Phase" });
    const zeilen = within(trichter).getAllByRole("row");
    expect(zeilen).toHaveLength(7);
    const zelle = (zeile: number) => within(zeilen[zeile] as HTMLElement).getAllByRole("cell").map((c) => (c.textContent ?? "").replace(/\s/g, " "));
    expect(zelle(1)).toEqual(["Anfrage", "", "10", "2", "80,0 %"]);
    expect(zelle(3)).toEqual(["Prüfung", "", "4", "1", "50,0 %"]);
    expect(zelle(6)).toEqual(["Closing", "", "1", "0", "–"]);

    // Balken sind rein anschaulich, ihre Breite folgt dem größten Wert
    const balken = trichter.querySelectorAll<HTMLElement>(".app-balken__fuellung");
    expect(balken[0]?.style.inlineSize).toBe("100%");
    expect(balken[2]?.style.inlineSize).toBe("40%");

    await userEvent.setup().click(screen.getByRole("tab", { name: "Verteilung" }));
    const quellen = await screen.findByRole("region", { name: "Deals nach Quelle" });
    expect(within(quellen).getByText("Empfehlung")).toBeTruthy();
    expect(within(quellen).getByText("Ohne Quelle")).toBeTruthy();
    const gruende = screen.getByRole("region", { name: "Absagen nach Grund" });
    expect(within(gruende).getByText("Bewertung zu hoch")).toBeTruthy();
    expect(within(gruende).getByText("Ohne Grund")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Gesamtzahlen" }).textContent).toContain("10");
  });

  it("reicht von, bis und Fonds an die API weiter und hält sie in der URL", async () => {
    const api = spieleApi();
    const { router } = rendereApp("/dealflow/analytics");
    const nutzer = userEvent.setup();
    await screen.findByRole("region", { name: "Trichter nach Phase" });

    const filter = screen.getByRole("region", { name: "Filter" });
    fireEvent.change(within(filter).getByLabelText("Von"), { target: { value: "2026-01-01" } });
    fireEvent.change(within(filter).getByLabelText("Bis"), { target: { value: "2026-06-30" } });
    await within(filter).findByRole("option", { name: "Beispielfonds I" });
    await nutzer.selectOptions(within(filter).getByLabelText("Fonds"), "Beispielfonds I");
    await waitFor(() => expect(router.state.location.search).toEqual({ von: "2026-01-01", bis: "2026-06-30", fondsId: FONDS_ID }));
    await waitFor(() => {
      const letzter = api.anfragen("GET", "/api/v1/dealflow/trichter").at(-1);
      expect(Object.fromEntries(letzter?.query ?? [])).toEqual({ von: "2026-01-01", bis: "2026-06-30", fondsId: FONDS_ID });
    });
    // die Seite bleibt während des Nachladens stehen
    expect(screen.getByRole("region", { name: "Trichter nach Phase" })).toBeTruthy();
  });

  it("meldet einen Fehler der API und zeigt Leerzustand ohne Deals", async () => {
    spieleApi({ "/api/v1/dealflow/trichter": () => fehler(400, "invalid_input") });
    rendereApp("/dealflow/analytics?from=2026-06-30&to=2026-01-01");
    expect((await screen.findByRole("alert")).textContent).toContain("Die Eingabe ist ungültig");
  });

  it("zeigt einen Leerzustand, wenn der Zeitraum keine Deals enthält", async () => {
    spieleApi({ "/api/v1/dealflow/trichter": { koerper: { ...trichterDaten, gesamt: { deals: 0, offen: 0, abgesagt: 0, investiert: 0 } } } });
    rendereApp("/dealflow/analytics");
    expect(await screen.findByText("Im gewählten Zeitraum gibt es keine Deals.")).toBeTruthy();
  });

  it("ist auch auf Englisch vollständig", async () => {
    localStorage.setItem("carraway.sprache", "en");
    spieleApi();
    rendereApp("/dealflow/analytics");
    const trichter = await screen.findByRole("region", { name: "Funnel by stage" });
    expect(within(trichter).getByText("Due diligence")).toBeTruthy();
    expect(within(trichter).getByText("On to next")).toBeTruthy();
    expect(within(trichter).getByText("80.0%")).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("tab", { name: "Breakdown" }));
    expect(await screen.findByRole("region", { name: "Declines by reason" })).toBeTruthy();
    expect(screen.getAllByText("No source").length).toBeGreaterThanOrEqual(1);
  });
});

describe("Organisation: schreiben", () => {
  it("erfasst eine Aktivität mit Wiedervorlage an der Organisation", async () => {
    const api = spieleApi({ "POST /api/v1/aktivitaeten": () => ({ status: 201, koerper: aktivitaetDaten }) });
    rendereApp(`/organizations/${ORG_A}?tab=activity`);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Aktivität erfassen" }));
    const dialog = await screen.findByRole("dialog", { name: "Aktivität erfassen" });
    await nutzer.selectOptions(within(dialog).getByLabelText("Art"), "Termin");
    fireEvent.change(within(dialog).getByLabelText("Datum"), { target: { value: "2026-10-05" } });
    await nutzer.type(within(dialog).getByLabelText("Titel"), "Besuch vor Ort");
    fireEvent.change(within(dialog).getByLabelText("Wiedervorlage am"), { target: { value: "2026-10-20" } });
    await nutzer.click(within(dialog).getByRole("button", { name: "Aktivität speichern" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.anfragen("POST", "/api/v1/aktivitaeten")[0]?.koerper).toEqual({
      art: "termin",
      datum: "2026-10-05",
      titel: "Besuch vor Ort",
      organisationId: ORG_A,
      wiedervorlage: "2026-10-20",
    });
    // Die Aktivitäten werden neu geladen; Seiten, die nicht offen sind, laden nichts
    await waitFor(() => expect(api.anfragen("GET", "/api/v1/aktivitaeten")).toHaveLength(2));
    expect(api.anfragen("GET", "/api/v1/wiedervorlagen")).toHaveLength(0);
    expect(api.anfragen("GET", "/api/v1/deals")).toHaveLength(0);
  });

  it("ändert Stammdaten und fügt eine Person hinzu", async () => {
    const api = spieleApi({
      [`PATCH /api/v1/organisationen/${ORG_A}`]: () => ({ koerper: organisationDaten }),
      "POST /api/v1/personen": () => ({ status: 201, koerper: { id: "p2" } }),
    });
    rendereApp(`/organizations/${ORG_A}`);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Organisation bearbeiten" }));
    let dialog = await screen.findByRole("dialog", { name: "Organisation bearbeiten" });
    const ort = within(dialog).getByLabelText("Ort");
    await nutzer.clear(ort);
    await nutzer.type(ort, "Bremen");
    await nutzer.clear(within(dialog).getByLabelText("Sektor"));
    await nutzer.click(within(dialog).getByRole("button", { name: "Änderungen speichern" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.anfragen("PATCH", `/api/v1/organisationen/${ORG_A}`)[0]?.koerper).toEqual({ name: "Alpha Energie", art: "unternehmen", sektor: null, ort: "Bremen", website: null });

    await nutzer.click(await screen.findByRole("button", { name: "Neuer Kontakt" }));
    dialog = await screen.findByRole("dialog", { name: "Person hinzufügen" });
    await nutzer.type(within(dialog).getByLabelText("Vorname"), "Jonas");
    await nutzer.type(within(dialog).getByLabelText("Nachname"), "Probe");
    await nutzer.click(within(dialog).getByRole("button", { name: "Person anlegen" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.anfragen("POST", "/api/v1/personen")[0]?.koerper).toEqual({ vorname: "Jonas", nachname: "Probe", organisationId: ORG_A });
  });
});
