import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { fehler, ORG_A, rendereApp, spieleApi } from "../test/hilfen";

describe("Globale Suchpalette", () => {
  it("filtert Befehle sofort, nimmt nach Pfeilnavigation weiter Eingaben an und gibt den Fokus zurück", async () => {
    const api = spieleApi();
    rendereApp("/kontakte");
    const nutzer = userEvent.setup();
    const ausloeser = await screen.findByRole("button", { name: /^Suchen/ });
    await nutzer.click(ausloeser);
    const dialog = within(await screen.findByRole("dialog", { name: "Suche" }));
    const feld = dialog.getByRole<HTMLInputElement>("searchbox", { name: "Suchbegriff" });
    expect(document.activeElement).toBe(feld);
    expect(dialog.getByRole("button", { name: "Heute: Aufgaben und Termine" })).toBeTruthy();

    await nutzer.keyboard("z");
    expect(dialog.queryByRole("button", { name: "Heute: Aufgaben und Termine" })).toBeNull();
    expect(dialog.getByRole("button", { name: "Zu den Unternehmen" })).toBeTruthy();
    expect(api.anfragen("GET", "/api/v1/suche")).toHaveLength(0);

    await nutzer.keyboard("{ArrowDown}u");
    expect(document.activeElement).toBe(feld);
    expect(feld.value).toBe("zu");
    await nutzer.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Suche" })).toBeNull();
    expect(document.activeElement).toBe(ausloeser);
  });

  it("öffnet die Fondsverwaltung über den Kurznamen eines sichtbaren Fonds", async () => {
    spieleApi();
    rendereApp("/kontakte");
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: /^Suchen/ }));
    const dialog = within(await screen.findByRole("dialog", { name: "Suche" }));
    await nutzer.type(dialog.getByRole("searchbox"), "bf i");
    await nutzer.click(await dialog.findByRole("button", { name: /Beispielfonds I/ }));
    expect((await screen.findByRole("button", { name: "Stammdaten" })).getAttribute("aria-current")).toBe("page");
  });

  it("entfernt alte Treffer sofort und überspringt Schnellaktionen nur bei Pfeilnavigation", async () => {
    const api = spieleApi({
      "/api/v1/suche": ({ query }) => ({
        koerper: {
          q: query.get("q"),
          organisationen: query.get("q") === "alp"
            ? [{ id: ORG_A, name: "Alpha Energie", art: "unternehmen", email: "info@alpha.example" }]
            : [],
          personen: [],
          deals: [],
          dokumente: [],
        },
      }),
    });
    rendereApp("/kontakte");
    const nutzer = userEvent.setup();
    await screen.findByRole("grid", { name: "Unternehmen" });
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    const dialog = within(await screen.findByRole("dialog", { name: "Suche" }));
    const feld = dialog.getByRole("searchbox", { name: "Suchbegriff" });
    await nutzer.type(feld, "alp");
    const treffer = await dialog.findByRole("button", { name: /^Alpha Energie/ });
    await nutzer.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(treffer);
    await nutzer.tab();
    expect(document.activeElement).toBe(dialog.getByRole("link", { name: "E-Mail an Alpha Energie" }));
    await nutzer.tab({ shift: true });
    await nutzer.keyboard("{ArrowUp}{Backspace}");
    expect(dialog.queryByRole("button", { name: /^Alpha Energie/ })).toBeNull();
    expect(api.anfragen("GET", "/api/v1/suche").map((a) => a.query.get("q"))).toEqual(["alp"]);
    await waitFor(() => expect(api.anfragen("GET", "/api/v1/suche").map((a) => a.query.get("q"))).toEqual(["alp", "al"]));
  });
  it("unterscheidet kurze Eingaben, laufende Suche, Fehler und leere Ergebnisse", async () => {
    let versuch = 0;
    spieleApi({
      "/api/v1/suche": () => ++versuch === 1
        ? fehler(503, "DIENST_NICHT_VERFUEGBAR")
        : { koerper: { organisationen: [], personen: [], deals: [], dokumente: [] } },
    });
    rendereApp("/kontakte");
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: /^Suchen/ }));
    const dialog = within(await screen.findByRole("dialog", { name: "Suche" }));
    const feld = dialog.getByRole<HTMLInputElement>("searchbox");
    const status = dialog.getByRole("status");
    await nutzer.type(feld, "q");
    expect(status.textContent).toContain("mindestens zwei Zeichen");
    await nutzer.type(feld, "xx");
    expect(status.textContent).toContain("Suche läuft");
    await nutzer.click(await dialog.findByRole("button", { name: "Suche wiederholen" }));
    expect(document.activeElement).toBe(feld);
    expect(feld.value).toBe("qxx");
    await waitFor(() => expect(status.textContent).toContain("Keine Treffer"));
    expect(versuch).toBe(2);
  });

  it("öffnet über den Importbefehl den Kontaktimport", async () => {
    spieleApi();
    rendereApp("/kontakte");
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: /^Suchen/ }));
    const dialog = within(await screen.findByRole("dialog", { name: "Suche" }));
    await nutzer.click(dialog.getByRole("button", { name: /^Kontakte importieren/ }));
    expect(await screen.findByRole("heading", { name: "Kontaktimport" })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Suche" })).toBeNull();
  });

  it("übergibt den Fokus an ein Zielformular und schließt bei Escape nur die obere Ebene", async () => {
    spieleApi();
    rendereApp("/kontakte");
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: /^Suchen/ }));
    const dialog = within(await screen.findByRole("dialog", { name: "Suche" }));
    await nutzer.click(dialog.getByRole("button", { name: "Neues Unternehmen anlegen" }));

    const formular = await screen.findByRole("dialog", { name: "Neue Organisation" });
    const feld = within(formular).getByRole("textbox", { name: /^Name/ });
    expect(document.activeElement).toBe(feld);
    expect(screen.queryByRole("dialog", { name: "Suche" })).toBeNull();

    await nutzer.keyboard("{Control>}k{/Control}");
    await screen.findByRole("dialog", { name: "Suche" });
    await nutzer.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Suche" })).toBeNull();
    expect(document.activeElement).toBe(feld);
    await nutzer.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Neue Organisation" })).toBeNull();
  });

});
