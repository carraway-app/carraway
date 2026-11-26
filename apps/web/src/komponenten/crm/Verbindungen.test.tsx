import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { Beschaeftigung } from "../../api/crm";
import { ORG_A, ORG_B, alsRolle, organisationDaten, rendereApp, spieleApi } from "../../test/hilfen";
import { baueVerbindungen } from "./verbindungenLogik";

const eva = { id: "p1", vorname: "Eva", nachname: "Muster", email: "eva@example.org", telefon: "+49 40 1", linkedin: null };
const orgDaten = { id: ORG_A, name: "Alpha Energie", email: null, telefon: null, website: null, linkedin: null };
const b = (id: string, extra: Partial<Beschaeftigung> = {}): Beschaeftigung => ({ id, funktion: "Geschäftsführung", von: "2020-01-01", bis: null, haupt: true, person: eva, organisation: orgDaten, ...extra });

describe("baueVerbindungen", () => {
  it("führt Beschäftigungen, Rollen und die ältere Personenliste zu einer Zeile je Person und Unternehmen zusammen", () => {
    const rollen = [
      { id: "r1", rolle: "gruender", von: null, bis: null, person: { id: "p1", vorname: "Eva", nachname: "Muster" } },
      { id: "r2", rolle: "berater", von: null, bis: null, person: { id: "p2", vorname: "Max", nachname: "Nur-Rolle" } },
    ];
    const alt = [
      { id: "p1", vorname: "Eva", nachname: "Muster", email: "eva@example.org", funktion: "Geschäftsführung" },
      { id: "p3", vorname: "Uli", nachname: "Alt", email: "uli@example.org", funktion: "Leitung" },
    ];
    const zeilen = baueVerbindungen("organisation", [b("b1"), b("b2", { haupt: false, bis: "2019-01-01", von: "2018-01-01" })], rollen, alt);
    // Eva zweimal (zwei Beschäftigungen), die Rolle hängt nur an der ersten Zeile; Max nur mit Rolle; Uli nur aus der älteren Liste
    expect(zeilen.map((z) => [z.gegenId, z.beschaeftigungId, z.rollen.length])).toEqual([
      ["p1", "b1", 1],
      ["p1", "b2", 0],
      ["p2", null, 1],
      ["p3", null, 0],
    ]);
    expect(zeilen[3]).toMatchObject({ name: "Uli Alt", email: "uli@example.org", funktion: "Leitung" });
  });

  it("auf der Seite des Kontakts stehen die Unternehmen, Rollen werden über das Unternehmen zugeordnet", () => {
    const rollen = [{ id: "r1", rolle: "co_investor", von: null, bis: null, organisation: { id: ORG_B, name: "Beta Medizin" } }];
    const zeilen = baueVerbindungen("person", [b("b1", { organisation: { ...orgDaten, website: "https://alpha.example" } })], rollen);
    expect(zeilen.map((z) => [z.name, z.beschaeftigungId, z.rollen.length, z.website])).toEqual([
      ["Alpha Energie", "b1", 0, "https://alpha.example"],
      ["Beta Medizin", null, 1, null],
    ]);
  });
});

describe("Verbindungen: Zeilenaktionen", () => {
  const seite = {
    [`/api/v1/organisationen/${ORG_A}`]: { koerper: { ...organisationDaten, rollen: [{ id: "r1", rolle: "gruender", von: "2020-01-01", bis: null, person: { id: "p1", vorname: "Eva", nachname: "Muster" } }] } },
    "/api/v1/crm/beschaeftigungen": { koerper: { daten: [b("b1")] } },
  };

  it("ändert Funktion und Zeitraum einer Beschäftigung", async () => {
    const api = spieleApi({ ...seite, "PATCH /api/v1/crm/beschaeftigungen/b1": { koerper: { id: "b1" } } });
    rendereApp(`/organisationen/${ORG_A}`);
    const nutzer = userEvent.setup();
    const tabelle = await screen.findByRole("region", { name: "Kontakte des Unternehmens" });
    await within(tabelle).findByText("Eva Muster");
    expect(within(tabelle).getByText("Hauptunternehmen")).toBeTruthy();
    await nutzer.click(await within(tabelle).findByRole("button", { name: "Weitere Aktionen" }));
    await nutzer.click(await screen.findByRole("menuitem", { name: "Funktion und Zeitraum ändern" }));
    const dialog = await screen.findByRole("dialog", { name: "Funktion und Zeitraum: Eva Muster" });
    const funktion = within(dialog).getByLabelText("Funktion");
    await nutzer.clear(funktion);
    await nutzer.type(funktion, "Beirat");
    await nutzer.type(within(dialog).getByLabelText("Bis (optional)"), "2026-06-30");
    await nutzer.click(within(dialog).getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(api.anfragen("PATCH", "/api/v1/crm/beschaeftigungen/b1")).toHaveLength(1));
    expect(api.anfragen("PATCH", "/api/v1/crm/beschaeftigungen/b1")[0]!.koerper).toEqual({ funktion: "Beirat", von: "2020-01-01", bis: "2026-06-30", haupt: true });
  });

  it("löst eine Verknüpfung erst nach Bestätigung", async () => {
    const api = spieleApi({ ...seite, "DELETE /api/v1/crm/beschaeftigungen/b1": { status: 204, koerper: null } });
    rendereApp(`/organisationen/${ORG_A}`);
    const nutzer = userEvent.setup();
    const tabelle = await screen.findByRole("region", { name: "Kontakte des Unternehmens" });
    await within(tabelle).findByText("Eva Muster");
    await nutzer.click(await within(tabelle).findByRole("button", { name: "Weitere Aktionen" }));
    await nutzer.click(await screen.findByRole("menuitem", { name: "Verknüpfung lösen" }));
    expect(api.anfragen("DELETE", "/api/v1/crm/beschaeftigungen/b1")).toHaveLength(0);
    const dialog = await screen.findByRole("dialog", { name: "Verknüpfung mit Eva Muster lösen" });
    await nutzer.click(within(dialog).getByRole("button", { name: "Verknüpfung lösen" }));
    await waitFor(() => expect(api.anfragen("DELETE", "/api/v1/crm/beschaeftigungen/b1")).toHaveLength(1));
  });

  it("Betrachter sehen die Tabelle ohne Verknüpfen, Etiketten ohne Entfernen und keine Zeilenmenüs", async () => {
    spieleApi({
      ...seite,
      "/api/v1/ich": alsRolle("betrachter"),
    });
    rendereApp(`/organisationen/${ORG_A}`);
    const tabelle = await screen.findByRole("region", { name: "Kontakte des Unternehmens" });
    await within(tabelle).findByText("Eva Muster");
    expect(within(tabelle).getByText("Gründung")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Kontakt verknüpfen" })).toBeNull();
    expect(within(tabelle).queryByRole("button", { name: /Rolle entfernen/ })).toBeNull();
    expect(within(tabelle).queryByRole("button", { name: "Weitere Aktionen" })).toBeNull();
  });

  it("legt bei einem Fehler der Rolle die Beschäftigung nicht ein zweites Mal an, wenn man erneut sendet", async () => {
    let rollenVersuche = 0;
    const api = spieleApi({
      ...seite,
      "/api/v1/suche": { koerper: { q: "max", organisationen: [], personen: [{ id: "p9", vorname: "Max", nachname: "Neu", email: null, telefon: null, linkedin: null, organisation: null, score: 1 }], deals: [] } },
      "POST /api/v1/crm/beschaeftigungen": { status: 201, koerper: { id: "b9" } },
      "POST /api/v1/kontaktrollen": () => {
        rollenVersuche++;
        return rollenVersuche === 1 ? { status: 409, koerper: { fehler: { code: "ROLLE_BEREITS_VORHANDEN", meldung: "x" } } } : { status: 201, koerper: { id: "r9" } };
      },
    });
    rendereApp(`/organisationen/${ORG_A}`);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Kontakt verknüpfen" }));
    const dialog = await screen.findByRole("dialog", { name: "Kontakt verknüpfen" });
    await nutzer.type(within(dialog).getByLabelText("Kontakt suchen"), "max");
    await nutzer.click(await within(dialog).findByRole("button", { name: /^Max Neu/ }));
    await nutzer.selectOptions(within(dialog).getByLabelText("Rolle (optional)"), "berater");
    await nutzer.click(within(dialog).getByRole("button", { name: "Verknüpfen" }));
    await within(dialog).findByRole("alert");
    await nutzer.click(within(dialog).getByRole("button", { name: "Verknüpfen" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Kontakt verknüpfen" })).toBeNull());
    expect(api.anfragen("POST", "/api/v1/crm/beschaeftigungen")).toHaveLength(1);
    expect(api.anfragen("POST", "/api/v1/kontaktrollen")).toHaveLength(2);
  });
  it("weist beim erneuten Verknüpfen auf die bestehende Verbindung hin, lässt sie öffnen und erlaubt trotzdem eine weitere", async () => {
    const api = spieleApi({
      ...seite,
      "/api/v1/suche": { koerper: { q: "eva", organisationen: [], personen: [{ id: "p1", vorname: "Eva", nachname: "Muster", email: null, telefon: null, linkedin: null, organisation: null, score: 1 }], deals: [] } },
      "POST /api/v1/crm/beschaeftigungen": { status: 201, koerper: { id: "b9" } },
    });
    rendereApp(`/organisationen/${ORG_A}`);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Kontakt verknüpfen" }));
    const dialog = await screen.findByRole("dialog", { name: "Kontakt verknüpfen" });
    expect(within(dialog).queryByRole("status")).toBeNull();
    await nutzer.type(within(dialog).getByLabelText("Kontakt suchen"), "eva");
    await nutzer.click(await within(dialog).findByRole("button", { name: /^Eva Muster/ }));
    const hinweis = await within(dialog).findByRole("status");
    expect(hinweis.textContent).toContain("Diese Verbindung besteht bereits");
    expect(within(dialog).getAllByText(/Geschäftsführung/).length).toBeGreaterThan(0);
    // Trotzdem verknüpfen (zweiter Zeitraum) bleibt möglich
    await nutzer.type(within(dialog).getByLabelText("Seit (optional)"), "2024-01-01");
    await nutzer.click(within(dialog).getByRole("button", { name: "Verknüpfen" }));
    await waitFor(() => expect(api.anfragen("POST", "/api/v1/crm/beschaeftigungen")).toHaveLength(1));
  });

  it("„Bestehende öffnen“ wechselt zur Bearbeitung der vorhandenen Beschäftigung", async () => {
    spieleApi({
      ...seite,
      "/api/v1/suche": { koerper: { q: "eva", organisationen: [], personen: [{ id: "p1", vorname: "Eva", nachname: "Muster", email: null, telefon: null, linkedin: null, organisation: null, score: 1 }], deals: [] } },
    });
    rendereApp(`/organisationen/${ORG_A}`);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Kontakt verknüpfen" }));
    const dialog = await screen.findByRole("dialog", { name: "Kontakt verknüpfen" });
    await nutzer.type(within(dialog).getByLabelText("Kontakt suchen"), "eva");
    await nutzer.click(await within(dialog).findByRole("button", { name: /^Eva Muster/ }));
    await nutzer.click(await within(dialog).findByRole("button", { name: "Bestehende öffnen" }));
    expect(await screen.findByRole("dialog", { name: "Funktion und Zeitraum: Eva Muster" })).toBeTruthy();
  });
});
