import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { rendereApp, spieleApi } from "../test/hilfen";

const LISTE = { id: "11111111-aaaa-4aaa-8aaa-111111111111", name: "Co-Investoren 2026", objekt: "organisation", beschreibung: null, besitzerId: null, eintraege: 3 };
const leer = { koerper: { q: "x", organisationen: [], personen: [], deals: [], dokumente: [] } };

describe("Befehlsleiste (Strg+K)", () => {
  it("legt Datensätze an und springt zu Ansichten, Listen und Aufgaben", async () => {
    spieleApi({ "/api/v1/crm/listen": { koerper: { daten: [LISTE] } }, "/api/v1/suche": leer });
    const { router } = rendereApp("/dealflow");
    const nutzer = userEvent.setup();
    await screen.findByRole("region", { name: /^Anfrage/ });

    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    let dialog = await screen.findByRole("dialog", { name: "Suche" });
    // ohne Eingabe stehen die Befehle schon da, auch die Liste
    expect(await within(dialog).findByRole("button", { name: "Liste öffnen: Co-Investoren 2026" })).toBeTruthy();
    await nutzer.click(within(dialog).getByRole("button", { name: "Neues Unternehmen anlegen" }));
    expect(await screen.findByRole("dialog", { name: "Neue Organisation" })).toBeTruthy();
    expect(router.state.location.pathname).toBe("/kontakte");
    // der Parameter bleibt nicht in der Adresse hängen
    await waitFor(() => expect(router.state.location.search).toEqual({}));

    await nutzer.keyboard("{Escape}");
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    dialog = await screen.findByRole("dialog", { name: "Suche" });
    await nutzer.click(within(dialog).getByRole("button", { name: "Liste öffnen: Co-Investoren 2026" }));
    await waitFor(() => expect(router.state.location.search).toEqual({ liste: LISTE.id }));

    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    dialog = await screen.findByRole("dialog", { name: "Suche" });
    await nutzer.click(within(dialog).getByRole("button", { name: "Heute: Aufgaben und Termine" }));
    await waitFor(() => expect(router.state.location.search).toEqual({ objekt: "heute" }));
  });

  it("filtert die Befehle beim Tippen und führt mit Eingabe den ersten aus, wenn es keinen Treffer gibt", async () => {
    spieleApi({ "/api/v1/suche": leer });
    const { router } = rendereApp("/kontakte");
    const nutzer = userEvent.setup();
    await screen.findByRole("grid", { name: "Unternehmen" });
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    const dialog = await screen.findByRole("dialog", { name: "Suche" });
    await nutzer.type(within(dialog).getByLabelText("Suchbegriff"), "neuen deal");
    await waitFor(() => expect(within(dialog).queryByRole("button", { name: "Zu den Kontakten" })).toBeNull());
    expect(within(dialog).getByRole("button", { name: "Neuen Deal anlegen" })).toBeTruthy();
    await nutzer.keyboard("{Enter}");
    await waitFor(() => expect(router.state.location.pathname).toBe("/dealflow"));
    expect(await screen.findByRole("dialog", { name: "Neuer Deal" })).toBeTruthy();
  });

  it("zeigt Anlegen nur mit Schreibrecht und ist auf Englisch vollständig", async () => {
    localStorage.setItem("carraway.sprache", "en");
    spieleApi({ "/api/v1/suche": leer, "/api/v1/me": { koerper: { id: "u", name: "Lesende", email: "l@x.example", technisch: false, globalVerwalter: false, zweiFaktorAktiv: true, passwortAendern: false, zweiFaktorErforderlich: false, rollen: [] } } });
    rendereApp("/kontakte");
    await screen.findByRole("grid", { name: "Companies" });
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    const dialog = await screen.findByRole("dialog", { name: "Search" });
    expect(within(dialog).getByRole("button", { name: "Go to the deal flow board" })).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "Create new company" })).toBeNull();
  });
});
