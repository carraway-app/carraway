import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ORG_A, ORG_B, aktivitaetDaten, crmFelderDaten, crmZeilenDaten, organisationDaten, rendereApp, spieleApi } from "../test/hilfen";

const person = { id: "p1", vorname: "Anna", nachname: "Berger", email: "anna@alpha.example", funktion: "CFO", organisationId: ORG_A, organisation: { id: ORG_A, name: "Alpha Energie" }, zusammengefuehrtIn: null, rollen: [], letzteAktivitaet: null };
const eigenesFeld = { schluessel: "f-temp", definitionId: "f-temp", name: "Temperatur", typ: "auswahl", system: false, schreibbar: true, optionen: { optionen: [{ schluessel: "heiss", label: "Heiß", farbe: "rose" }, { schluessel: "kalt", label: "Kalt", farbe: "blau" }] }, operatoren: ["ist"], sortierbar: true };
const orgMitEigenemFeld = { id: ORG_A, werte: { ...crmZeilenDaten.organisation[0], "f-temp": "heiss" }, felder: [...crmFelderDaten.organisation, eigenesFeld], bezuege: {} };

describe("Datensatzseiten (CRM)", () => {
  it("zeigt Attribute neben den Reitern und bearbeitet ein Feld einzeln, eigene Felder eingeschlossen", async () => {
    const api = spieleApi({
      [`/api/v1/organisationen/${ORG_A}`]: { koerper: { ...organisationDaten, email: "info@alpha.example" } },
      [`/api/v1/crm/datensaetze/organisation/${ORG_A}`]: { koerper: orgMitEigenemFeld },
      [`PATCH /api/v1/crm/datensaetze/organisation/${ORG_A}`]: { koerper: { id: ORG_A } },
    });
    rendereApp(`/organizations/${ORG_A}`);
    const nutzer = userEvent.setup();
    await screen.findByText("Temperatur");
    const attribute = screen.getByRole("region", { name: "Attribute" });
    expect(within(attribute).getByText("Hamburg")).toBeTruthy();
    // Art und Sektor stehen im Kopf und deshalb nicht noch einmal in den Attributen (keine doppelten Felder)
    expect(within(attribute).queryByText("Sektor")).toBeNull();
    expect(within(attribute).getByText("Temperatur")).toBeTruthy();
    expect(within(attribute).getByText("Heiß")).toBeTruthy();
    // Name steht im Kopf, nicht noch einmal in den Attributen
    expect(within(attribute).queryByText("Name")).toBeNull();
    // Schnellaktionen in der Kopfzeile des Panels und im Seitenkopf
    expect(within(attribute).getByRole("link", { name: "E-Mail an Alpha Energie" }).getAttribute("href")).toBe("mailto:info@alpha.example");
    expect(screen.getByRole("link", { name: "E-Mail schreiben" })).toBeTruthy();

    await nutzer.click(within(attribute).getByRole("button", { name: "Bearbeiten: Ort" }));
    const eingabe = within(attribute).getByLabelText("Ort");
    await nutzer.clear(eingabe);
    await nutzer.type(eingabe, "Köln{Enter}");
    await waitFor(() => expect(api.anfragen("PATCH", `/api/v1/crm/datensaetze/organisation/${ORG_A}`)).toHaveLength(1));
    expect(api.anfragen("PATCH", `/api/v1/crm/datensaetze/organisation/${ORG_A}`)[0]!.koerper).toEqual({ system: { ort: "Köln" } });

    await nutzer.click(within(attribute).getByRole("button", { name: "Bearbeiten: Temperatur" }));
    await nutzer.selectOptions(within(attribute).getByLabelText("Temperatur"), "Kalt");
    await waitFor(() => expect(api.anfragen("PATCH", `/api/v1/crm/datensaetze/organisation/${ORG_A}`)).toHaveLength(2));
    expect(api.anfragen("PATCH", `/api/v1/crm/datensaetze/organisation/${ORG_A}`)[1]!.koerper).toEqual({ eigene: { "f-temp": "kalt" } });
  });

  it("zeigt Aufgaben, legt eine an und hakt sie ab", async () => {
    const aufgabe = { id: "t1", titel: "Unterlagen anfordern", notiz: null, faellig: "2020-01-01", erledigtAm: null, zustaendigId: "x", zustaendigName: "Vera Beispiel", organisation: { id: ORG_A, name: "Alpha Energie" }, person: null, deal: null };
    const api = spieleApi({
      "/api/v1/crm/aufgaben": { koerper: { daten: [aufgabe] } },
      "/api/v1/crm/zustaendige": { koerper: { daten: [{ id: "u1", name: "Vera Beispiel" }, { id: "u2", name: "Max Muster" }] } },
      "POST /api/v1/crm/aufgaben": { status: 201, koerper: { id: "t2" } },
      "PATCH /api/v1/crm/aufgaben/t1": { koerper: { id: "t1" } },
      "POST /api/v1/crm/aufgaben/t1/erledigt": { koerper: { id: "t1" } },
    });
    rendereApp(`/organizations/${ORG_A}?tab=tasks`);
    const nutzer = userEvent.setup();
    // Der Bereich des Verzeichnisses trägt den Namen des Eintrags und umschließt den Aufgabenabschnitt, der denselben Namen hat.
    const bereich = (await screen.findAllByRole("region", { name: "Aufgaben" }))[0]!;
    expect(await within(bereich).findByText("Unterlagen anfordern")).toBeTruthy();
    expect(within(bereich).getByText("Überfällig")).toBeTruthy();
    expect(within(bereich).getByRole("button", { name: /^Vera Beispiel: Zuständigkeit ändern/ })).toBeTruthy();

    await nutzer.type(within(bereich).getByLabelText("Aufgabe"), "Termin vereinbaren");
    await nutzer.type(within(bereich).getByLabelText("Fällig am"), "2026-12-01");
    await nutzer.click(within(bereich).getByRole("button", { name: "Aufgabe anlegen" }));
    await waitFor(() => expect(api.anfragen("POST", "/api/v1/crm/aufgaben")).toHaveLength(1));
    expect(api.anfragen("POST", "/api/v1/crm/aufgaben")[0]!.koerper).toEqual({ titel: "Termin vereinbaren", faellig: "2026-12-01", organisationId: ORG_A });

    await nutzer.click(within(bereich).getByRole("checkbox", { name: "Erledigt: Unterlagen anfordern" }));
    await waitFor(() => expect(api.anfragen("POST", "/api/v1/crm/aufgaben/t1/erledigt")).toHaveLength(1));
    // Ohne Zuweisung entfällt die Zuständigkeit: „Niemand“ in der Personenauswahl
    await nutzer.click(within(bereich).getByRole("button", { name: /: Zuständig wählen$/ }));
    await nutzer.click(await screen.findByRole("option", { name: "Niemand" }));
    await nutzer.type(within(bereich).getByLabelText("Aufgabe"), "Ohne Zuständige");
    await nutzer.click(within(bereich).getByRole("button", { name: "Aufgabe anlegen" }));
    await waitFor(() => expect(api.anfragen("POST", "/api/v1/crm/aufgaben")).toHaveLength(2));
    expect(api.anfragen("POST", "/api/v1/crm/aufgaben")[1]!.koerper).toEqual({ titel: "Ohne Zuständige", zustaendigId: null, organisationId: ORG_A });
  });

  it("weist eine Aufgabe über die durchsuchbare Personenauswahl neu zu und filtert „Meine“ und „Alle“", async () => {
    const aufgabe = { id: "t1", titel: "Unterlagen anfordern", notiz: null, faellig: null, erledigtAm: null, zustaendigId: "u1", zustaendigName: "Vera Beispiel", organisation: { id: ORG_A, name: "Alpha Energie" }, person: null, deal: null };
    const api = spieleApi({
      "/api/v1/crm/aufgaben": { koerper: { daten: [aufgabe] } },
      "/api/v1/crm/zustaendige": { koerper: { daten: [{ id: "u1", name: "Vera Beispiel" }, { id: "u2", name: "Max Muster" }] } },
      "PATCH /api/v1/crm/aufgaben/t1": { koerper: { id: "t1" } },
    });
    rendereApp(`/organizations/${ORG_A}?tab=tasks`);
    const nutzer = userEvent.setup();
    // Der Bereich des Verzeichnisses trägt den Namen des Eintrags und umschließt den Aufgabenabschnitt, der denselben Namen hat.
    const bereich = (await screen.findAllByRole("region", { name: "Aufgaben" }))[0]!;
    await within(bereich).findByText("Unterlagen anfordern");
    await nutzer.click(within(bereich).getByRole("button", { name: /^Vera Beispiel: Zuständigkeit ändern/ }));
    const feld = await screen.findByRole("combobox", { name: "Person suchen" });
    await nutzer.type(feld, "{ArrowDown}{Enter}");
    await waitFor(() => expect(api.anfragen("PATCH", "/api/v1/crm/aufgaben/t1")).toHaveLength(1));
    expect(api.anfragen("PATCH", "/api/v1/crm/aufgaben/t1")[0]!.koerper).toEqual({ zustaendigId: "u2" });

    await nutzer.click(within(bereich).getByRole("button", { name: "Meine" }));
    await waitFor(() => expect(api.anfragen("GET", "/api/v1/crm/aufgaben").some((a) => a.query.get("zustaendig") === "ich")).toBe(true));
  });

  it("zeigt Rückverweise im Reiter „Verknüpft“", async () => {
    spieleApi({
      [`/api/v1/crm/datensaetze/organisation/${ORG_A}/verknuepfungen`]: {
        koerper: {
          eingehend: [{ typ: "organisation", id: ORG_B, name: "Beta Medizin", art: "erwaehnung", quelleId: "q1" }],
          ausgehend: [{ typ: "person", id: "p1", name: "Anna Berger", art: "relation", quelleId: "f1" }],
        },
      },
    });
    rendereApp(`/organizations/${ORG_A}?tab=linked`);
    const eingehend = await screen.findByRole("region", { name: "Verweisen auf diesen Datensatz" });
    expect(within(eingehend).getByRole("link", { name: "Beta Medizin" }).getAttribute("href")).toBe(`/organizations/${ORG_B}`);
    expect(within(eingehend).getByText(/Erwähnung in einer Notiz/)).toBeTruthy();
    const ausgehend = screen.getByRole("region", { name: "Dieser Datensatz verweist auf" });
    expect(within(ausgehend).getByRole("link", { name: "Anna Berger" }).getAttribute("href")).toBe("/people/p1");
  });

  it("Kontakt: eine Tabelle der Unternehmen, Verknüpfen in der Schublade mit Funktion, Hauptunternehmen und Rolle", async () => {
    const api = spieleApi({
      "/api/v1/personen/p1": { koerper: person },
      "/api/v1/crm/beschaeftigungen": { koerper: { daten: [{ id: "b1", funktion: "CFO", von: "2024-01-01", bis: null, haupt: true, person: { id: "p1", vorname: "Anna", nachname: "Berger", email: null, telefon: null, linkedin: null }, organisation: { id: ORG_A, name: "Alpha Energie", email: "info@alpha.example", telefon: null, website: "https://alpha.example", linkedin: null } }] } },
      "/api/v1/suche": { koerper: { q: "bet", organisationen: [{ id: ORG_B, name: "Beta Medizin", art: "unternehmen", ort: "Berlin", score: 1 }], personen: [], deals: [] } },
      "POST /api/v1/crm/beschaeftigungen": { status: 201, koerper: { id: "b2" } },
      "POST /api/v1/kontaktrollen": { status: 201, koerper: { id: "r1" } },
    });
    rendereApp("/people/p1");
    const nutzer = userEvent.setup();
    expect(await screen.findByRole("heading", { level: 1, name: "Anna Berger" })).toBeTruthy();
    expect(await screen.findByRole("region", { name: "Attribute" })).toBeTruthy();
    const bereich = await screen.findByRole("region", { name: "Unternehmen des Kontakts" });
    expect(await within(bereich).findByText("Hauptunternehmen")).toBeTruthy();
    expect(within(bereich).getByRole("link", { name: "Alpha Energie" })).toBeTruthy();
    // Schnellaktionen des Unternehmens in der Zeile
    expect(within(bereich).getByRole("link", { name: "E-Mail an Alpha Energie" }).getAttribute("href")).toBe("mailto:info@alpha.example");
    expect(within(bereich).getByRole("link", { name: "Website: Alpha Energie" })).toBeTruthy();

    await nutzer.click(screen.getByRole("button", { name: "Unternehmen verknüpfen" }));
    const dialog = await screen.findByRole("dialog", { name: "Unternehmen verknüpfen" });
    await nutzer.type(within(dialog).getByLabelText("Unternehmen suchen"), "bet");
    await nutzer.click(await within(dialog).findByRole("button", { name: /^Beta Medizin/ }));
    await nutzer.type(within(dialog).getByLabelText("Funktion"), "Beirätin");
    await nutzer.selectOptions(within(dialog).getByLabelText("Rolle (optional)"), "berater");
    await nutzer.click(within(dialog).getByRole("button", { name: "Verknüpfen" }));
    await waitFor(() => expect(api.anfragen("POST", "/api/v1/crm/beschaeftigungen")).toHaveLength(1));
    expect(api.anfragen("POST", "/api/v1/crm/beschaeftigungen")[0]!.koerper).toEqual({ personId: "p1", organisationId: ORG_B, funktion: "Beirätin", haupt: false });
    await waitFor(() => expect(api.anfragen("POST", "/api/v1/kontaktrollen")).toHaveLength(1));
    expect(api.anfragen("POST", "/api/v1/kontaktrollen")[0]!.koerper).toEqual({ personId: "p1", organisationId: ORG_B, rolle: "berater" });
  });

  it("Deal: Kontakte am Deal hinzufügen", async () => {
    const api = spieleApi({
      "/api/v1/crm/deals/d1/kontakte": { koerper: { daten: [{ personId: "p1", vorname: "Anna", nachname: "Berger", email: "anna@alpha.example", telefon: null, funktion: "CFO", rolle: "Gründerin" }] } },
      "/api/v1/suche": { koerper: { q: "jon", organisationen: [], personen: [{ id: "p2", vorname: "Jonas", nachname: "Keller", email: null, organisation: null, score: 1 }], deals: [] } },
      "POST /api/v1/crm/deals/d1/kontakte": { status: 201, koerper: {} },
    });
    rendereApp("/deals/d1?tab=contacts");
    const nutzer = userEvent.setup();
    const bereich = await screen.findByRole("region", { name: "Kontakte des Deals" });
    expect(await within(bereich).findByRole("link", { name: "Anna Berger" })).toBeTruthy();
    expect(within(bereich).getByRole("link", { name: "E-Mail an Anna Berger" })).toBeTruthy();
    await nutzer.type(within(bereich).getByRole("combobox", { name: "Kontakt suchen" }), "jon");
    await nutzer.click(await within(bereich).findByRole("option", { name: /^Jonas Keller/ }));
    await nutzer.type(within(bereich).getByLabelText("Rolle"), "Investor");
    await nutzer.click(within(bereich).getByRole("button", { name: "Verknüpfen" }));
    await waitFor(() => expect(api.anfragen("POST", "/api/v1/crm/deals/d1/kontakte")).toHaveLength(1));
    expect(api.anfragen("POST", "/api/v1/crm/deals/d1/kontakte")[0]!.koerper).toEqual({ personId: "p2", rolle: "Investor" });
  });
});

describe("Notizen mit Erwähnungen", () => {
  it("fügt eine Erwähnung in die Notiz ein und sendet sie mit", async () => {
    const api = spieleApi({
      "/api/v1/suche": { koerper: { q: "bet", organisationen: [{ id: ORG_B, name: "Beta Medizin", art: "unternehmen", ort: null, score: 1 }], personen: [], deals: [] } },
      "POST /api/v1/aktivitaeten": { status: 201, koerper: { ...aktivitaetDaten, id: "a2" } },
    });
    rendereApp(`/organizations/${ORG_A}?tab=activity`);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Aktivität erfassen" }));
    const dialog = await screen.findByRole("dialog", { name: "Aktivität erfassen" });
    await nutzer.type(within(dialog).getByLabelText("Titel"), "Abstimmung");
    await nutzer.type(within(dialog).getByLabelText("Notiz"), "Gespräch mit");
    await nutzer.click(within(dialog).getByRole("button", { name: "Datensatz erwähnen" }));
    await nutzer.type(within(dialog).getByLabelText("Unternehmen, Kontakt oder Deal suchen"), "bet");
    await nutzer.click(await within(dialog).findByRole("button", { name: /^Beta Medizin/ }));
    expect((within(dialog).getByLabelText("Notiz") as HTMLTextAreaElement).value).toBe(`Gespräch mit @[Beta Medizin](organisation:${ORG_B}) `);
    await nutzer.click(within(dialog).getByRole("button", { name: "Aktivität speichern" }));
    await waitFor(() => expect(api.anfragen("POST", "/api/v1/aktivitaeten")).toHaveLength(1));
    expect(api.anfragen("POST", "/api/v1/aktivitaeten")[0]!.koerper).toMatchObject({ notiz: `Gespräch mit @[Beta Medizin](organisation:${ORG_B})` });
  });

  it("zeigt Erwähnungen als Links und gibt HTML in Notizen nur als Text aus", async () => {
    spieleApi({
      "/api/v1/aktivitaeten": { koerper: { daten: [{ ...aktivitaetDaten, notiz: `<img src=x onerror="alert(1)"> mit @[Beta <b>Medizin</b>](organisation:${ORG_B}) besprochen` }] } },
    });
    rendereApp(`/organizations/${ORG_A}?tab=activity`);
    const link = await screen.findByRole("link", { name: "@Beta <b>Medizin</b>" });
    expect(link.getAttribute("href")).toBe(`/organizations/${ORG_B}`);
    const absatz = link.closest("p")!;
    expect(absatz.querySelector("img")).toBeNull();
    expect(absatz.querySelector("b")).toBeNull();
    expect(absatz.textContent).toContain('<img src=x onerror="alert(1)">');
    expect(absatz.textContent).toContain("besprochen");
    fireEvent.click(link);
  });
});

describe("Notizen mit Markdown", () => {
  it("zeigt Auszeichnung und Listen, aber keine Skript-Links", async () => {
    spieleApi({
      "/api/v1/aktivitaeten": { koerper: { daten: [{ ...aktivitaetDaten, notiz: "Ergebnis **gut**\n\n- erstens\n- zweitens\n\n[Zugang](javascript:alert(1)) und [Seite](https://beispiel.test)" }] } },
    });
    rendereApp(`/organizations/${ORG_A}?tab=activity`);
    expect((await screen.findByText("gut")).tagName).toBe("STRONG");
    expect(screen.getAllByRole("listitem").some((li) => li.textContent === "zweitens")).toBe(true);
    expect(screen.queryByRole("link", { name: "Zugang" })).toBeNull();
    const seite = screen.getByRole("link", { name: "Seite" });
    expect(seite.getAttribute("rel")).toBe("noopener noreferrer");
  });
});

describe("Datensatzseiten auf Englisch", () => {
  it("übersetzt Reiter, Attribute und Aufgaben", async () => {
    localStorage.setItem("carraway.sprache", "en");
    spieleApi();
    rendereApp(`/organizations/${ORG_A}?tab=tasks`);
    await waitFor(() => expect(within(screen.getByRole("navigation", { name: /^(Hauptnavigation|Main navigation)$/ })).getByRole("link", { name: "Tasks" }).getAttribute("aria-current")).toBe("page"));
    expect(within(screen.getByRole("navigation", { name: /^(Hauptnavigation|Main navigation)$/ })).getByRole("link", { name: "Linked" })).toBeTruthy();
    expect(within(screen.getByRole("navigation", { name: /^(Hauptnavigation|Main navigation)$/ })).getByRole("button", { name: "Collaboration" })).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Create task" })).toBeTruthy();
    expect(screen.getByText("No tasks.")).toBeTruthy();
  });
});

describe("Kontaktseite: Inhaltsverzeichnis", () => {
  it("zeigt die Bereiche ohne Reiter und öffnet über alte Adressen den richtigen Eintrag", async () => {
    spieleApi({ "/api/v1/personen/p1": { koerper: person } });
    const { unmount } = rendereApp("/people/p1");
    expect(await screen.findByRole("heading", { level: 1, name: "Anna Berger" })).toBeTruthy();
    expect(screen.queryByRole("tab")).toBeNull();
    const nav = screen.getByRole("navigation", { name: "Hauptnavigation" });
    for (const eintrag of ["Unternehmen", "Aktivitäten", "Termine", "Aufgaben", "Verknüpft"]) expect(within(nav).getByRole("link", { name: new RegExp(`^${eintrag}`) })).toBeTruthy();
    await waitFor(() => expect(within(nav).getByRole("link", { name: /^Unternehmen/ }).getAttribute("aria-current")).toBe("page"));
    unmount();

    for (const [suche, eintrag] of [
      ["tab=activity", "Aktivitäten"],
      ["tab=activity&subtab=appointments", "Termine"],
      ["tab=tasks", "Aufgaben"],
      ["tab=linked", "Verknüpft"],
    ] as const) {
      spieleApi({ "/api/v1/personen/p1": { koerper: person } });
      const { unmount: weg } = rendereApp(`/people/p1?${suche}`);
      const knopf = await within(await screen.findByRole("navigation", { name: /^(Hauptnavigation|Main navigation)$/ })).findByRole("link", { name: new RegExp(`^${eintrag}`) });
      expect(knopf.getAttribute("aria-current")).toBe("page");
      weg();
    }
  });
});
