import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { Beschaeftigung } from "../../api/crm";
import { ORG_A, organisationDaten, rendereApp, spieleApi } from "../../test/hilfen";

const eva = { id: "p1", vorname: "Eva", nachname: "Muster", email: "eva@example.org", telefon: "+49 40 1", linkedin: null };
const orgDaten = { id: ORG_A, name: "Alpha Energie", email: null, telefon: null, website: null, linkedin: null };
const beschaeftigung: Beschaeftigung = { id: "b1", funktion: "Geschäftsführung", von: "2020-01-01", bis: null, haupt: true, person: eva, organisation: orgDaten };
const karte = { objekt: "person", id: "p1", name: "Eva Muster", firma: { id: ORG_A, name: "Alpha Energie" }, art: null, phase: null, funktion: "Geschäftsführung", email: "eva@example.org", telefon: "+49 40 1", linkedin: null, website: null };

const seite = (karteAntwort: { status?: number; koerper: unknown } = { koerper: karte }) => ({
  [`/api/v1/organisationen/${ORG_A}`]: { koerper: { ...organisationDaten, rollen: [] } },
  "/api/v1/crm/beschaeftigungen": { koerper: { daten: [beschaeftigung] } },
  "/api/v1/crm/datensaetze/person/p1/karte": karteAntwort,
});

async function verweis() {
  const tabelle = await screen.findByRole("region", { name: "Kontakte des Unternehmens" });
  return within(tabelle).findByRole("link", { name: "Eva Muster" });
}

describe("Vorschaukarte an Verweisen", () => {
  it("öffnet beim Überfahren mit Name, Unternehmen, Mail und Telefon, ist per aria-describedby mit dem Verweis verbunden und lädt nur einmal", async () => {
    const api = spieleApi(seite());
    rendereApp(`/organisationen/${ORG_A}`);
    const nutzer = userEvent.setup();
    const link = await verweis();
    expect(api.anfragen("GET", "/api/v1/crm/datensaetze/person/p1/karte")).toHaveLength(0);
    await nutzer.hover(link);
    const name = await screen.findByText("Alpha Energie", { selector: ".app-vorschau__zeile" }, { timeout: 3000 });
    const beschreibung = document.getElementById(link.getAttribute("aria-describedby") ?? "");
    expect(beschreibung).toBeTruthy();
    expect(beschreibung!.textContent).toContain("Eva Muster");
    expect(beschreibung!.textContent).toContain("eva@example.org");
    expect(beschreibung!.textContent).toContain("+49 40 1");
    expect(name.closest(".app-vorschau")).toBeTruthy();
    // Schnellaktionen in der Karte
    const flaeche = name.closest(".app-vorschau") as HTMLElement;
    expect(within(flaeche).getByRole("link", { name: /E-Mail an Eva Muster/ }).getAttribute("href")).toBe("mailto:eva@example.org");
    await nutzer.unhover(link);
    await waitFor(() => expect(document.querySelector(".app-vorschau")).toBeNull(), { timeout: 3000 });
    expect(link.getAttribute("aria-describedby")).toBeNull();
    // Zweites Überfahren: aus dem Zwischenspeicher, keine zweite Abfrage
    await nutzer.hover(link);
    await screen.findByText("Alpha Energie", { selector: ".app-vorschau__zeile" }, { timeout: 3000 });
    expect(api.anfragen("GET", "/api/v1/crm/datensaetze/person/p1/karte")).toHaveLength(1);
  });

  it("öffnet beim Fokus per Tastatur, nimmt dem Verweis den Fokus nicht und schließt mit Escape", async () => {
    spieleApi(seite());
    rendereApp(`/organisationen/${ORG_A}`);
    const nutzer = userEvent.setup();
    const link = await verweis();
    link.focus();
    // Fokus durch Programm gilt in jsdom nicht als „focus-visible“; erst die Tastatur öffnet.
    await nutzer.tab({ shift: true });
    await nutzer.tab();
    expect(document.activeElement).toBe(link);
    await screen.findByText("Alpha Energie", { selector: ".app-vorschau__zeile" });
    expect(link.getAttribute("aria-describedby")).toBeTruthy();
    await nutzer.keyboard("{Escape}");
    expect(document.querySelector(".app-vorschau")).toBeNull();
    expect(document.activeElement).toBe(link);
  });

  it("zeigt bei einem Fehler nur „Keine Vorschau verfügbar“ und lässt den Verweis wie er ist", async () => {
    spieleApi(seite({ status: 404, koerper: { fehler: { code: "DATENSATZ_NICHT_GEFUNDEN", meldung: "Datensatz nicht gefunden." } } }));
    rendereApp(`/organisationen/${ORG_A}`);
    const nutzer = userEvent.setup();
    const link = await verweis();
    await nutzer.hover(link);
    expect(await screen.findByText("Keine Vorschau verfügbar", {}, { timeout: 3000 })).toBeTruthy();
    expect(link.getAttribute("href")).toBe("/personen/p1");
  });

  it("öffnet auf Touch-Geräten keine Karte", async () => {
    const api = spieleApi(seite());
    rendereApp(`/organisationen/${ORG_A}`);
    const link = await verweis();
    link.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "touch" }));
    link.dispatchEvent(new PointerEvent("pointerenter", { pointerType: "touch" }));
    await new Promise((r) => setTimeout(r, 600));
    expect(document.querySelector(".app-vorschau")).toBeNull();
    expect(api.anfragen("GET", "/api/v1/crm/datensaetze/person/p1/karte")).toHaveLength(0);
  });
});
