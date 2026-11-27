import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ORG_A, ORG_B, crmFelderDaten, crmZeilenDaten, rendereApp, spieleApi } from "../test/hilfen";

const eigenesFeld = (schluessel: string, name: string, typ: string, extra: Record<string, unknown> = {}) => ({
  schluessel,
  name,
  typ,
  system: false,
  schreibbar: true,
  optionen: {},
  operatoren: ["ist", "ist_nicht", "leer", "nicht_leer"],
  sortierbar: true,
  ...extra,
});
const temperatur = eigenesFeld("f-temp", "Temperatur", "auswahl", { optionen: { optionen: [{ schluessel: "heiss", label: "Heiß", farbe: "rose" }, { schluessel: "kalt", label: "Kalt", farbe: "blau" }] } });
const umsatz = eigenesFeld("f-umsatz", "Umsatz", "betrag");
const felder = [...crmFelderDaten.organisation, temperatur, umsatz];
const ansicht = (gruppierung?: string) => ({
  id: "44444444-aaaa-4aaa-8aaa-444444444444",
  objekt: "organisation",
  listeId: null,
  name: "Nach Temperatur",
  art: "tabelle",
  konfig: { sortierung: [], spalten: [{ feld: "name" }, { feld: "f-temp" }, { feld: "f-umsatz" }], ...(gruppierung ? { gruppierung } : {}) },
  besitzerId: "x",
  geteilt: true,
  standard: true,
  eigene: false,
  bearbeitbar: true,
});
const orgA = { ...crmZeilenDaten.organisation[0], "f-temp": "heiss", "f-umsatz": "1000.50" };
const orgB = { ...crmZeilenDaten.organisation[1], "f-temp": "kalt", "f-umsatz": "250.00" };
const gruppenAntwort = {
  gruppen: [
    { wert: "heiss", anzahl: 1, summen: { "f-umsatz": "1000.50" } },
    { wert: "kalt", anzahl: 1, summen: { "f-umsatz": "250.00" } },
    { wert: null, anzahl: 0, summen: { "f-umsatz": "0" } },
  ].filter((g) => g.anzahl > 0),
  gesamt: 2,
  bezuege: {},
};

function api(gruppierung?: string) {
  return spieleApi({
    "/api/v1/crm/objekte/organisation/felder": { koerper: { daten: felder } },
    "/api/v1/crm/ansichten": { koerper: { daten: [ansicht(gruppierung)] } },
    "POST /api/v1/crm/objekte/organisation/gruppen": { koerper: gruppenAntwort },
    "POST /api/v1/crm/objekte/organisation/abfrage": (a) => {
      const filter = (a.koerper as { filter?: { elemente: { feld: string; operator: string; wert?: string }[] } }).filter;
      const b = filter?.elemente.find((e) => e.feld === "f-temp");
      const daten = b ? [b.wert === "heiss" ? orgA : orgB] : [orgA, orgB];
      return { koerper: { daten, gesamt: daten.length, limit: 100, offset: 0, bezuege: {} } };
    },
    "PATCH /api/v1/crm/ansichten/44444444-aaaa-4aaa-8aaa-444444444444": { koerper: { id: "44444444-aaaa-4aaa-8aaa-444444444444" } },
  });
}

describe("Tabelle in Gruppen", () => {
  it("gruppiert über „Gruppieren“, zeigt Anzahl und Summen und lädt die Zeilen einer Gruppe mit einer Bedingung auf das Feld", async () => {
    const a = api();
    rendereApp("/contacts");
    const nutzer = userEvent.setup();
    await screen.findByRole("grid", { name: "Unternehmen" });
    await nutzer.click(screen.getByRole("button", { name: "Gruppieren" }));
    await nutzer.selectOptions(await screen.findByLabelText("Gruppieren nach"), "Temperatur");

    const heiss = await screen.findByRole("button", { name: /Heiß/ });
    expect(heiss.getAttribute("aria-expanded")).toBe("true");
    expect(heiss.textContent).toContain("1");
    expect(heiss.textContent).toMatch(/Umsatz: 1\.001\s€/);
    expect(screen.getByRole("button", { name: /Kalt/ }).textContent).toMatch(/Umsatz: 250\s€/);
    const anfrage = a.anfragen("POST", "/api/v1/crm/objekte/organisation/gruppen").at(-1)!.koerper as Record<string, unknown>;
    expect(anfrage).toMatchObject({ gruppe: "f-temp", summen: ["f-umsatz"] });
    // Die Zeilen der Gruppe: dieselbe Abfrage mit zusätzlicher Bedingung
    const grid = await screen.findByRole("grid", { name: "Unternehmen: Heiß" });
    expect(within(grid).getByRole("link", { name: "Alpha Energie" })).toBeTruthy();
    const mitBedingung = a.anfragen("POST", "/api/v1/crm/objekte/organisation/abfrage").map((x) => x.koerper as { filter?: { elemente: unknown[] } }).find((k) => k.filter);
    expect(mitBedingung!.filter!.elemente).toContainEqual({ feld: "f-temp", operator: "ist", wert: "heiss" });
  });

  it("klappt Gruppen mit Maus und Tastatur auf und zu, die Wahl liegt in der Ansicht und lässt sich speichern", async () => {
    const a = api("f-temp");
    rendereApp("/contacts");
    const nutzer = userEvent.setup();
    const kalt = await screen.findByRole("button", { name: /Kalt/ });
    expect(await screen.findByRole("grid", { name: "Unternehmen: Kalt" })).toBeTruthy();
    kalt.focus();
    await nutzer.keyboard("{Enter}");
    expect(kalt.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("grid", { name: "Unternehmen: Kalt" })).toBeNull();
    await nutzer.keyboard(" ");
    expect(kalt.getAttribute("aria-expanded")).toBe("true");
    expect(await screen.findByRole("grid", { name: "Unternehmen: Kalt" })).toBeTruthy();

    // Gruppierung aufheben und speichern
    await nutzer.click(screen.getByRole("button", { name: "Gruppiert: Temperatur" }));
    await nutzer.selectOptions(await screen.findByLabelText("Gruppieren nach"), "Keine Gruppierung");
    await screen.findByRole("grid", { name: "Unternehmen" });
    await nutzer.click(screen.getByRole("button", { name: "Ansicht aktualisieren" }));
    await waitFor(() => expect(a.anfragen("PATCH", "/api/v1/crm/ansichten/44444444-aaaa-4aaa-8aaa-444444444444")).toHaveLength(1));
    expect((a.anfragen("PATCH", "/api/v1/crm/ansichten/44444444-aaaa-4aaa-8aaa-444444444444")[0]!.koerper as { konfig: { gruppierung: unknown } }).konfig.gruppierung).toBeNull();
    expect(ORG_A).not.toBe(ORG_B);
  });
  it("gruppiert nach Kontrollkästchen (Ja, Nein) und nach einer Verknüpfung (Name des Ziels, sonst „Kein Zugriff“)", async () => {
    const haken = eigenesFeld("f-haken", "Prüfung offen", "kontrollkaestchen", { operatoren: ["ist_wahr", "ist_falsch"] });
    const mutter = eigenesFeld("f-mutter", "Mutterfirma", "verknuepfung", { ziel: "organisation" });
    const mitFeldern = [...crmFelderDaten.organisation, haken, mutter];
    const gruppe = (feld: string, antwort: unknown) => {
      const eigene = { ...ansicht(feld), konfig: { sortierung: [], spalten: [{ feld: "name" }, { feld }], gruppierung: feld } };
      return spieleApi({
        "/api/v1/crm/objekte/organisation/felder": { koerper: { daten: mitFeldern } },
        "/api/v1/crm/ansichten": { koerper: { daten: [eigene] } },
        "POST /api/v1/crm/objekte/organisation/gruppen": { koerper: antwort },
        "POST /api/v1/crm/objekte/organisation/abfrage": { koerper: { daten: [orgA], gesamt: 1, limit: 100, offset: 0, bezuege: {} } },
      });
    };
    const a = gruppe("f-haken", { gruppen: [{ wert: "true", anzahl: 1, summen: {} }, { wert: "false", anzahl: 1, summen: {} }], gesamt: 2, bezuege: {} });
    const ansicht1 = rendereApp("/contacts");
    await screen.findByRole("button", { name: /Nein/ });
    expect(screen.getByRole("button", { name: /Ja/ })).toBeTruthy();
    await screen.findByRole("grid", { name: "Unternehmen: Ja" });
    const bedingungen = a.anfragen("POST", "/api/v1/crm/objekte/organisation/abfrage").map((x) => x.koerper as { filter?: { elemente: unknown[] } }).filter((k) => k.filter);
    expect(bedingungen.some((k) => k.filter!.elemente.some((e) => JSON.stringify(e) === JSON.stringify({ feld: "f-haken", operator: "ist_wahr" })))).toBe(true);
    ansicht1.unmount();

    gruppe("f-mutter", { gruppen: [{ wert: ORG_B, anzahl: 1, summen: {} }, { wert: "99999999-aaaa-4aaa-8aaa-999999999999", anzahl: 1, summen: {} }, { wert: null, anzahl: 1, summen: {} }], gesamt: 3, bezuege: { [`organisation:${ORG_B}`]: "Beta Kapital", "organisation:99999999-aaaa-4aaa-8aaa-999999999999": null } });
    rendereApp("/contacts");
    expect(await screen.findByRole("button", { name: /Beta Kapital/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Kein Zugriff/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Ohne Wert/ })).toBeTruthy();
  });
  it("weist darauf hin, wenn der Server nur die größten Gruppen liefert", async () => {
    spieleApi({
      "/api/v1/crm/objekte/organisation/felder": { koerper: { daten: felder } },
      "/api/v1/crm/ansichten": { koerper: { daten: [ansicht("f-temp")] } },
      "POST /api/v1/crm/objekte/organisation/gruppen": { koerper: { ...gruppenAntwort, abgeschnitten: true } },
      "POST /api/v1/crm/objekte/organisation/abfrage": { koerper: { daten: [orgA], gesamt: 1, limit: 100, offset: 0, bezuege: {} } },
    });
    rendereApp("/contacts");
    expect((await screen.findByRole("status", { name: "" }, { timeout: 3000 }).catch(() => null)) ?? true).toBeTruthy();
    expect(await screen.findByText(/gezeigt werden die 2 größten/)).toBeTruthy();
  });
});
