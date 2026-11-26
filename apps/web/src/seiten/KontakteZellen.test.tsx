import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ORG_A, ORG_B, crmFelderDaten, rendereApp, spieleApi } from "../test/hilfen";

const eigenesFeld = (schluessel: string, name: string, typ: string, extra: Record<string, unknown> = {}) => ({
  schluessel,
  name,
  typ,
  system: false,
  schreibbar: true,
  optionen: {},
  operatoren: ["ist", "ist_nicht", "leer", "nicht_leer"],
  sortierbar: false,
  ...extra,
});
const felder = [...crmFelderDaten.person, eigenesFeld("f-betreuer", "Betreuer", "benutzer"), eigenesFeld("f-firma", "Hauptfirma", "verknuepfung", { ziel: "organisation", optionen: { ziel: "organisation" } })];
const ansicht = {
  id: "33333333-aaaa-4aaa-8aaa-333333333333",
  objekt: "person",
  listeId: null,
  name: "Betreuung",
  art: "tabelle",
  konfig: { sortierung: [], spalten: [{ feld: "name" }, { feld: "f-betreuer" }, { feld: "f-firma" }] },
  besitzerId: "x",
  geteilt: true,
  standard: true,
  eigene: false,
  bearbeitbar: true,
};
const zeile = { id: "p1", name: "Anna Berger", email: "anna@alpha.example", telefon: null, linkedin: null, "f-betreuer": "u1", "f-firma": ORG_A };
const bezuege = { "benutzer:u1": "Vera Beispiel", [`organisation:${ORG_A}`]: "Alpha Energie" };

function api() {
  // Die Abfrage liefert nach dem Schreiben den neuen Stand (wie der Server), samt Namen in den Bezügen.
  const stand = { ...zeile };
  const namen: Record<string, string> = { ...bezuege, "benutzer:u2": "Max Muster", [`organisation:${ORG_B}`]: "Beta Medizin" };
  const speichern = (a: { koerper?: unknown }) => {
    Object.assign(stand, (a.koerper as { eigene: Record<string, unknown> }).eigene);
    return { koerper: { id: "p1" } };
  };
  return spieleApi({
    "/api/v1/crm/objekte/person/felder": { koerper: { daten: felder } },
    "/api/v1/crm/ansichten": { koerper: { daten: [ansicht] } },
    "POST /api/v1/crm/objekte/person/abfrage": () => ({ koerper: { daten: [stand], gesamt: 1, limit: 100, offset: 0, bezuege: namen } }),
    "/api/v1/crm/zustaendige": { koerper: { daten: [{ id: "u1", name: "Vera Beispiel" }, { id: "u2", name: "Max Muster" }] } },
    "/api/v1/suche": { koerper: { q: "be", organisationen: [{ id: ORG_B, name: "Beta Medizin", art: "unternehmen", ort: "Berlin", score: 1 }], personen: [], deals: [] } },
    "PATCH /api/v1/crm/datensaetze/person/p1": speichern,
  });
}
const patches = (a: ReturnType<typeof spieleApi>) => a.anfragen("PATCH", "/api/v1/crm/datensaetze/person/p1");

async function oeffne() {
  const a = api();
  rendereApp("/kontakte?objekt=person");
  const grid = await screen.findByRole("grid", { name: "Kontakte" });
  const zelle = (spalte: number) => grid.querySelector<HTMLElement>(`[data-z="0:${spalte}"]`)!;
  return { a, grid, zelle, nutzer: userEvent.setup() };
}

describe("Tabelle: Personen- und Verknüpfungsfelder in der Zelle bearbeiten", () => {
  it("wählt eine Person per Tastatur aus der Suche und zeigt den Namen sofort", async () => {
    const { a, grid, zelle, nutzer } = await oeffne();
    expect(within(zelle(1)).getByText("Vera Beispiel")).toBeTruthy();
    expect(zelle(1).getAttribute("aria-readonly")).toBeNull();
    zelle(1).focus();
    await nutzer.keyboard("{Enter}");
    const feld = await screen.findByRole("combobox", { name: "Person suchen" });
    expect(feld.closest("[role=group]")?.getAttribute("aria-label")).toBe("Betreuer: Anna Berger");
    // Das Popover hängt im Dokument, nicht in der (abschneidenden) Zelle.
    expect(grid.contains(feld)).toBe(false);
    await nutzer.keyboard("{ArrowDown}{Enter}");
    await waitFor(() => expect(patches(a)).toHaveLength(1));
    expect(patches(a)[0]!.koerper).toEqual({ eigene: { "f-betreuer": "u2" } });
    expect(await within(zelle(1)).findByText("Max Muster")).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "Person suchen" })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(zelle(1)));
  });

  it("Escape und Klick daneben verwerfen, „Wert entfernen“ leert das Feld", async () => {
    const { a, zelle, nutzer } = await oeffne();
    zelle(1).focus();
    await nutzer.keyboard("{Enter}");
    await screen.findByRole("combobox", { name: "Person suchen" });
    await nutzer.keyboard("{Escape}");
    expect(screen.queryByRole("combobox", { name: "Person suchen" })).toBeNull();
    expect(patches(a)).toHaveLength(0);

    await nutzer.dblClick(zelle(1));
    await screen.findByRole("combobox", { name: "Person suchen" });
    await nutzer.click(document.body);
    expect(screen.queryByRole("combobox", { name: "Person suchen" })).toBeNull();
    expect(patches(a)).toHaveLength(0);

    zelle(1).focus();
    await nutzer.keyboard("{Enter}");
    await nutzer.click(await screen.findByRole("option", { name: "Wert entfernen" }));
    await waitFor(() => expect(patches(a)).toHaveLength(1));
    expect(patches(a)[0]!.koerper).toEqual({ eigene: { "f-betreuer": null } });
  });

  it("Verknüpfungsfeld: Suche ab zwei Zeichen, Wahl schreibt die Kennung mit demselben Aufruf wie die Datensatzseite", async () => {
    const { a, zelle, nutzer } = await oeffne();
    expect(within(zelle(2)).getByRole("link", { name: "Alpha Energie" })).toBeTruthy();
    zelle(2).focus();
    await nutzer.keyboard("{Enter}");
    const feld = await screen.findByRole("combobox", { name: "Unternehmen suchen" });
    await nutzer.type(feld, "be");
    await nutzer.click(await screen.findByRole("option", { name: /^Beta Medizin/ }));
    await waitFor(() => expect(patches(a)).toHaveLength(1));
    expect(patches(a)[0]!.koerper).toEqual({ eigene: { "f-firma": ORG_B } });
    expect(await within(zelle(2)).findByRole("link", { name: "Beta Medizin" })).toBeTruthy();
  });

  it("zeigt Fehler der API wie bei jeder Zelle", async () => {
    const a = spieleApi({
      "/api/v1/crm/objekte/person/felder": { koerper: { daten: felder } },
      "/api/v1/crm/ansichten": { koerper: { daten: [ansicht] } },
      "POST /api/v1/crm/objekte/person/abfrage": { koerper: { daten: [zeile], gesamt: 1, limit: 100, offset: 0, bezuege } },
      "/api/v1/crm/zustaendige": { koerper: { daten: [{ id: "u2", name: "Max Muster" }] } },
      "PATCH /api/v1/crm/datensaetze/person/p1": { status: 400, koerper: { error: { code: "field_value_invalid", message: "x", fields: [{ field: "f-betreuer", code: "unknown_user", message: "Aktive Person nicht gefunden" }] } } },
    });
    rendereApp("/kontakte?objekt=person");
    const grid = await screen.findByRole("grid", { name: "Kontakte" });
    const nutzer = userEvent.setup();
    grid.querySelector<HTMLElement>('[data-z="0:1"]')!.focus();
    await nutzer.keyboard("{Enter}");
    await screen.findByRole("combobox", { name: "Person suchen" });
    await nutzer.keyboard("{ArrowDown}{Enter}");
    expect((await screen.findByRole("alert")).textContent).toContain("Feldwert");
    expect(a.anfragen("PATCH", "/api/v1/crm/datensaetze/person/p1")).toHaveLength(1);
  });
});
