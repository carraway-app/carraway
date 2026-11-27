import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { alsRolle, FONDS_ID, rendereApp, spieleApi } from "../test/hilfen";

const LISTE = { id: "11111111-aaaa-4aaa-8aaa-111111111111", name: "Co-Investoren 2026", objekt: "organisation", beschreibung: null, besitzerId: null, eintraege: 3 };
const leer = { koerper: { q: "x", organisationen: [], personen: [], deals: [], dokumente: [] } };

describe("Befehlsleiste (Strg+K)", () => {
  it("springt zu Orten der Leiste, Reitern, Ansichten und Listen; Aktionen stehen auf den Seiten, nicht in der Suche", async () => {
    spieleApi({ "/api/v1/crm/listen": { koerper: { daten: [LISTE] } }, "/api/v1/suche": leer });
    const { router } = rendereApp(`/funds/${FONDS_ID}`);
    const nutzer = userEvent.setup();
    await screen.findByRole("heading", { level: 1, name: "Beispielfonds I" });

    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    let dialog = await screen.findByRole("dialog", { name: "Suche" });
    // ohne Eingabe stehen Orte und Befehle schon da, auch die Liste; Anlegen gibt es hier nicht
    expect(await within(dialog).findByRole("button", { name: "Liste öffnen: Co-Investoren 2026" })).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "Neues Unternehmen anlegen" })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Neuen Deal anlegen" })).toBeNull();
    // Reiter eines Ortes im Fonds
    await nutzer.click(within(dialog).getByRole("button", { name: "Beispielfonds I · Planung · Reserven" }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/funds/${FONDS_ID}/reserves`));

    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    dialog = await screen.findByRole("dialog", { name: "Suche" });
    await nutzer.click(within(dialog).getByRole("button", { name: "Beispielfonds I · Finanzen · Zinsen" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/interest-runs"));

    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    dialog = await screen.findByRole("dialog", { name: "Suche" });
    await nutzer.click(within(dialog).getByRole("button", { name: "Liste öffnen: Co-Investoren 2026" }));
    await waitFor(() => expect(router.state.location.search).toEqual({ liste: LISTE.id }));

    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    dialog = await screen.findByRole("dialog", { name: "Suche" });
    await nutzer.click(within(dialog).getByRole("button", { name: "Heute: Aufgaben und Termine" }));
    await waitFor(() => expect(router.state.location.search).toEqual({ objekt: "heute" }));
  });

  it("filtert beim Tippen und führt mit Eingabe den ersten Eintrag aus, wenn es keinen Treffer gibt", async () => {
    spieleApi({ "/api/v1/suche": leer });
    const { router } = rendereApp("/contacts");
    const nutzer = userEvent.setup();
    await screen.findByRole("grid", { name: "Unternehmen" });
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    const dialog = await screen.findByRole("dialog", { name: "Suche" });
    await nutzer.type(within(dialog).getByLabelText("Suchbegriff"), "dealflow-board");
    await waitFor(() => expect(within(dialog).queryByRole("button", { name: "Zu den Kontakten" })).toBeNull());
    expect(within(dialog).getByRole("button", { name: "Zum Dealflow-Board" })).toBeTruthy();
    await nutzer.keyboard("{Enter}");
    await waitFor(() => expect(router.state.location.pathname).toBe("/dealflow"));
  });

  it("zeigt Anlegen nur mit Schreibrecht und ist auf Englisch vollständig", async () => {
    localStorage.setItem("carraway.sprache", "en");
    spieleApi({ "/api/v1/suche": leer, "/api/v1/me": alsRolle("betrachter") });
    rendereApp("/contacts");
    await screen.findByRole("grid", { name: "Companies" });
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    const dialog = await screen.findByRole("dialog", { name: "Search" });
    expect(within(dialog).getByRole("button", { name: "Go to the deal flow board" })).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "Create new company" })).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Deal flow & CRM · Contacts" })).toBeTruthy();
  });
});
