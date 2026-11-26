import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ORG_A, dealDetailDaten, crmFelderDaten, organisationDaten, rendereApp, spieleApi } from "../test/hilfen";

const kontaktOrg = { ...organisationDaten, email: "info@alpha.example", telefon: "+49 40 123456", linkedin: "https://www.linkedin.com/company/alpha-beispiel", website: "https://alpha.example" };
const dealFelder = [
  ...crmFelderDaten.deal,
  ...[
    ["unternehmenEmail", "E-Mail des Unternehmens", "email"],
    ["unternehmenTelefon", "Telefon des Unternehmens", "telefon"],
    ["unternehmenWebsite", "Website des Unternehmens", "url"],
  ].map(([schluessel, name, typ]) => ({ schluessel, name, typ, system: true, schreibbar: false, optionen: {}, operatoren: [], sortierbar: true })),
];
const dealZeile = { id: "d1", titel: "Alpha, Wachstum", unternehmen: ORG_A, phase: "anfrage", status: "offen", ticket: "2450000.00", quelle: "Empfehlung", betreuung: "Anna Berger", aktualisiertAm: "2026-09-29", unternehmenEmail: "info@alpha.example", unternehmenTelefon: "+49 40 123456", unternehmenWebsite: "https://alpha.example" };
const bezuege = { [`organisation:${ORG_A}`]: "Alpha Energie" };

describe("Schnellaktionen überall", () => {
  it("Unternehmen: Kopfzeile mit Telefon und LinkedIn, Mail als Knopf, Website in der Metazeile", async () => {
    spieleApi({ [`/api/v1/organisationen/${ORG_A}`]: { koerper: kontaktOrg } });
    rendereApp(`/organisationen/${ORG_A}`);
    await screen.findByRole("heading", { level: 1, name: "Alpha Energie" });
    const kopf = screen.getByRole("heading", { level: 1 }).closest("header") ?? document.body;
    expect(within(kopf).getByRole("link", { name: "Anrufen: Alpha Energie" }).getAttribute("href")).toBe("tel:+49401234 56".replace(" ", ""));
    expect(within(kopf).getByRole("link", { name: "LinkedIn: Alpha Energie" })).toBeTruthy();
    expect(within(kopf).getByRole("link", { name: "E-Mail schreiben" }).getAttribute("href")).toBe("mailto:info@alpha.example");
    // und in der Attributleiste das ganze Set
    const attribute = await screen.findByRole("complementary", { name: "Attribute" });
    expect(within(attribute).getByRole("link", { name: "E-Mail an Alpha Energie" })).toBeTruthy();
  });

  it("Kontakt: Kopfzeile mit Telefon und LinkedIn", async () => {
    spieleApi({
      "/api/v1/personen/p1": {
        koerper: { id: "p1", vorname: "Anna", nachname: "Berger", email: "anna@alpha.example", funktion: "CFO", telefon: "+49 40 111", linkedin: "https://www.linkedin.com/in/anna-berger-beispiel", organisationId: ORG_A, zusammengefuehrtIn: null, organisation: { id: ORG_A, name: "Alpha Energie" }, rollen: [], letzteAktivitaet: null },
      },
    });
    rendereApp("/personen/p1");
    await screen.findByRole("heading", { level: 1, name: "Anna Berger" });
    const kopf = screen.getByRole("heading", { level: 1 }).closest("header") ?? document.body;
    expect(within(kopf).getByRole("link", { name: "Anrufen: Anna Berger" })).toBeTruthy();
    expect(within(kopf).getByRole("link", { name: "LinkedIn: Anna Berger" })).toBeTruthy();
  });

  it("Deals: Zeilen der Tabelle zeigen Mail, Telefon und Website des Unternehmens", async () => {
    spieleApi({
      "/api/v1/crm/objekte/deal/felder": { koerper: { daten: dealFelder } },
      "POST /api/v1/crm/objekte/deal/abfrage": { koerper: { daten: [dealZeile], gesamt: 1, limit: 100, offset: 0, bezuege } },
    });
    rendereApp("/kontakte?objekt=deal");
    const grid = await screen.findByRole("grid", { name: "Deals" });
    expect(await within(grid).findByRole("link", { name: "E-Mail an Alpha Energie" })).toBeTruthy();
    expect(within(grid).getByRole("link", { name: "Anrufen: Alpha Energie" })).toBeTruthy();
    expect(within(grid).getByRole("link", { name: "Website: Alpha Energie" })).toBeTruthy();
  });

  it("Deals: Schnellaktionen stehen im Detailkopf", async () => {
    spieleApi({
      "/api/v1/deals/d1": { koerper: { ...dealDetailDaten, organisation: { id: ORG_A, name: "Alpha Energie", email: "info@alpha.example", telefon: "+49 40 123456", website: null, linkedin: null } } },
      "/api/v1/crm/objekte/deal/felder": { koerper: { daten: dealFelder } },
      "POST /api/v1/crm/objekte/deal/board": {
        koerper: { spalten: [{ wert: "anfrage", anzahl: 1, summe: "2450000.00", karten: [dealZeile] }], bezuege },
      },
    });
    rendereApp("/dealflow");
    const board = await screen.findByRole("region", { name: "Deals nach Phase" });
    expect(within(board).queryByRole("link", { name: "E-Mail an Alpha Energie" })).toBeNull();
    await userEvent.setup().click(within(board).getByRole("link", { name: "Alpha, Wachstum" }));
    expect(await screen.findByRole("link", { name: "E-Mail an Alpha Energie" })).toBeTruthy();
  });

  it("Befehlsleiste: Treffer tragen Schnellaktionen neben dem Eintrag (nicht darin), die Pfeiltasten bleiben bei den Treffern", async () => {
    spieleApi({
      "/api/v1/suche": {
        koerper: {
          q: "alp",
          organisationen: [{ id: ORG_A, name: "Alpha Energie", art: "unternehmen", ort: "Hamburg", email: "info@alpha.example", telefon: "+49 40 123456", website: null, linkedin: null, score: 1 }],
          personen: [{ id: "p1", vorname: "Anna", nachname: "Berger", email: "anna@alpha.example", telefon: null, linkedin: null, organisation: { id: ORG_A, name: "Alpha Energie" }, score: 1 }],
          deals: [{ id: "d1", titel: "Alpha, Wachstum", phase: "anfrage", status: "offen", organisation: { id: ORG_A, name: "Alpha Energie", email: "info@alpha.example", telefon: null, website: null, linkedin: null }, score: 1 }],
          dokumente: [],
        },
      },
    });
    rendereApp("/kontakte");
    const nutzer = userEvent.setup();
    await screen.findByRole("grid", { name: "Unternehmen" });
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    const dialog = await screen.findByRole("dialog", { name: "Suche" });
    await nutzer.type(within(dialog).getByLabelText("Suchbegriff"), "alp");
    const treffer = await within(dialog).findByRole("button", { name: /^Alpha Energie/ });
    const zeile = treffer.closest("li")!;
    expect(within(zeile).getByRole("link", { name: "E-Mail an Alpha Energie" }).getAttribute("href")).toBe("mailto:info@alpha.example");
    expect(within(zeile).getByRole("link", { name: "Anrufen: Alpha Energie" })).toBeTruthy();
    // Aktionen sind Geschwister des Eintrags, kein Knopf steckt in einem Knopf
    expect(treffer.querySelector("a, button")).toBeNull();
    expect(within(dialog).getByRole("link", { name: "E-Mail an Anna Berger" })).toBeTruthy();
    // Deals bieten die Wege des Unternehmens an
    expect(within(dialog.querySelector('li:has(button[class*="knopf"]:not(:empty)) ') ?? dialog).getAllByRole("link", { name: "E-Mail an Alpha Energie" }).length).toBeGreaterThan(0);
    // Pfeil nach unten geht von Treffer zu Treffer, nicht auf die Schnellaktion
    treffer.focus();
    await nutzer.keyboard("{ArrowDown}");
    expect(document.activeElement?.className).toContain("app-auswahlliste__knopf");
  });
});
