import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { NEUE_ORG_ID, ORG_A, kandidat, aktivitaetDaten, fehler, organisationDaten, rendereApp, spieleApi, wiedervorlageDaten } from "../test/hilfen";

const LISTE = { id: "11111111-aaaa-4aaa-8aaa-111111111111", name: "Co-Investoren 2026", objekt: "organisation", beschreibung: null, besitzerId: null, eintraege: 3 };
const abfragen = (api: ReturnType<typeof spieleApi>, objekt = "organisation") => api.anfragen("POST", `/api/v1/crm/objekte/${objekt}/abfrage`);
const letzte = (api: ReturnType<typeof spieleApi>, objekt = "organisation") => abfragen(api, objekt).at(-1)!.koerper as Record<string, unknown>;
const gitter = (name = "Unternehmen") => screen.findByRole("grid", { name });
const zelle = (grid: HTMLElement, zeile: number, spalte: number) => grid.querySelector<HTMLElement>(`[data-z="${zeile}:${spalte}"]`)!;

describe("Kontakte (CRM)", () => {
  it("zeigt Unternehmen, Kontakte und Deals als Tabellen in Reitern", async () => {
    spieleApi();
    const { router } = rendereApp("/kontakte");
    const nutzer = userEvent.setup();
    const unternehmen = await gitter();
    expect(within(unternehmen).getByRole("link", { name: "Alpha Energie" }).getAttribute("href")).toBe(`/organisationen/${ORG_A}`);
    expect(within(unternehmen).getByText("Investor")).toBeTruthy();

    await nutzer.click(screen.getByRole("tab", { name: "Kontakte" }));
    const kontakte = await gitter("Kontakte");
    expect(within(kontakte).getByRole("link", { name: "Anna Berger" }).getAttribute("href")).toBe("/personen/p1");
    // Verknüpfung zum Unternehmen: Name aus den Bezügen der Antwort, als Link
    expect(within(kontakte).getByRole("link", { name: "Alpha Energie" })).toBeTruthy();
    expect(router.state.location.search).toEqual({ objekt: "person" });

    await nutzer.click(screen.getByRole("tab", { name: "Deals" }));
    const deals = await gitter("Deals");
    expect(within(deals).getByRole("link", { name: "Alpha, Wachstum" }).getAttribute("href")).toBe("/deals/d1");
    expect(within(deals).getByText("Due Diligence")).toBeTruthy();
  });

  it("sucht serverseitig und trägt die Suche in die URL ein", async () => {
    const api = spieleApi();
    const { router } = rendereApp("/kontakte");
    const nutzer = userEvent.setup();
    await gitter();
    await nutzer.type(screen.getByLabelText("Suche"), "alp");
    await waitFor(() => expect(router.state.location.search).toEqual({ suche: "alp" }));
    await waitFor(() => expect(screen.queryByRole("link", { name: "Beta Medizin" })).toBeNull());
    expect(letzte(api).suche).toBe("alp");
    expect(abfragen(api).filter((a) => (a.koerper as { suche?: string }).suche === "alp")).toHaveLength(1);
  });

  it("zeigt Mail, Telefon und Adressen als Schnellaktionen und kopiert die Adresse", async () => {
    spieleApi();
    rendereApp("/kontakte");
    const nutzer = userEvent.setup();
    const grid = await gitter();
    const mail = within(grid).getByRole("link", { name: "E-Mail an Alpha Energie" });
    expect(mail.getAttribute("href")).toBe("mailto:info@alpha.example");
    expect(within(grid).getByRole("link", { name: "Anrufen: Alpha Energie" }).getAttribute("href")).toBe("tel:+49401234 56".replace(" ", ""));
    expect(within(grid).getByRole("link", { name: "Website: Alpha Energie" }).getAttribute("href")).toBe("https://alpha.example/");
    // Beta hat weder Mail noch Telefon: keine Schnellaktionen
    expect(within(grid).queryByRole("link", { name: "E-Mail an Beta Medizin" })).toBeNull();
    await nutzer.click(within(grid).getByRole("button", { name: "E-Mail-Adresse kopieren: Alpha Energie" }));
    expect(await navigator.clipboard.readText()).toBe("info@alpha.example");
    expect((await within(grid).findAllByText("Kopiert")).length).toBeGreaterThan(0);
  });

  it("bedient die Tabelle mit der Tastatur: Pfeile, Eingabe bearbeitet die Zelle, Escape verwirft", async () => {
    const api = spieleApi({ [`PATCH /api/v1/crm/datensaetze/organisation/${ORG_A}`]: { koerper: { id: ORG_A } } });
    rendereApp("/kontakte");
    const nutzer = userEvent.setup();
    const grid = await gitter();
    zelle(grid, 0, 0).focus();
    await nutzer.keyboard("{ArrowDown}");
    await waitFor(() => expect(document.activeElement).toBe(zelle(grid, 1, 0)));
    await nutzer.keyboard("{ArrowRight}{ArrowRight}{ArrowUp}");
    await waitFor(() => expect(document.activeElement).toBe(zelle(grid, 0, 2)));

    // Ort der ersten Zeile ändern
    await nutzer.keyboard("{Enter}");
    const eingabe = await within(grid).findByLabelText("Ort: Alpha Energie");
    await nutzer.clear(eingabe);
    await nutzer.type(eingabe, "Köln{Enter}");
    await waitFor(() => expect(api.anfragen("PATCH", `/api/v1/crm/datensaetze/organisation/${ORG_A}`)).toHaveLength(1));
    expect(api.anfragen("PATCH", `/api/v1/crm/datensaetze/organisation/${ORG_A}`)[0]!.koerper).toEqual({ system: { ort: "Köln" } });

    // Escape verwirft: keine zweite Anfrage
    await waitFor(() => expect(document.activeElement).toBe(zelle(grid, 0, 2)));
    await nutzer.keyboard("{Enter}");
    await nutzer.type(await within(grid).findByLabelText("Ort: Alpha Energie"), "Bonn{Escape}");
    expect(within(grid).queryByLabelText("Ort: Alpha Energie")).toBeNull();
    expect(api.anfragen("PATCH", `/api/v1/crm/datensaetze/organisation/${ORG_A}`)).toHaveLength(1);
  });

  it("zeigt Fehler beim Speichern einer Zelle (400 field_value_invalid)", async () => {
    spieleApi({ [`PATCH /api/v1/crm/datensaetze/organisation/${ORG_A}`]: () => fehler(400, "field_value_invalid", { felder: [{ feld: "website", code: "invalid_value", meldung: "x" }] }) });
    rendereApp("/kontakte");
    const nutzer = userEvent.setup();
    const grid = await gitter();
    zelle(grid, 0, 2).focus();
    await nutzer.keyboard("{Enter}");
    await nutzer.type(await within(grid).findByLabelText("Ort: Alpha Energie"), "!{Enter}");
    expect((await screen.findByRole("alert")).textContent).toContain("Feldwert");
  });

  it("sortiert über den Spaltenkopf und merkt es in aria-sort", async () => {
    const api = spieleApi();
    rendereApp("/kontakte");
    const nutzer = userEvent.setup();
    const grid = await gitter();
    await nutzer.click(within(grid).getByRole("button", { name: "Name" }));
    await waitFor(() => expect(letzte(api).sortierung).toEqual([{ feld: "name", richtung: "auf" }]));
    await waitFor(() => expect(within(screen.getByRole("grid", { name: "Unternehmen" })).getByRole("button", { name: "Name" }).closest('[role="columnheader"]')?.getAttribute("aria-sort")).toBe("ascending"));
    await nutzer.click(within(grid).getByRole("button", { name: "Name" }));
    await waitFor(() => expect(letzte(api).sortierung).toEqual([{ feld: "name", richtung: "ab" }]));
  });

  it("filtert mit Bedingungen und Gruppen und schickt sie an den Server", async () => {
    const api = spieleApi();
    rendereApp("/kontakte");
    const nutzer = userEvent.setup();
    await gitter();
    await nutzer.click(screen.getByRole("button", { name: "Filter" }));
    const panel = await screen.findByRole("dialog", { name: "Filter" });
    await nutzer.click(within(panel).getByRole("button", { name: "Bedingung hinzufügen" }));
    await nutzer.type(within(panel).getByLabelText("Wert der Bedingung 1"), "alp");
    await nutzer.click(within(panel).getByRole("button", { name: "Bedingung hinzufügen" }));
    await nutzer.selectOptions(within(panel).getByLabelText("Feld der Bedingung 2"), "Art");
    await nutzer.selectOptions(within(panel).getByLabelText("Wert der Bedingung 2"), "investor");
    await nutzer.selectOptions(within(panel).getByLabelText("Verknüpfung der Bedingungen"), "Eine Bedingung genügt (ODER)");
    // eine unvollständige dritte Bedingung entfällt beim Anwenden
    await nutzer.click(within(panel).getByRole("button", { name: "Bedingung hinzufügen" }));
    await nutzer.click(within(panel).getByRole("button", { name: "Anwenden" }));
    await waitFor(() => expect(letzte(api).filter).toBeTruthy());
    expect(letzte(api).filter).toEqual({
      verknuepfung: "oder",
      elemente: [
        { feld: "name", operator: "enthaelt", wert: "alp" },
        { feld: "art", operator: "ist", wert: "investor" },
      ],
    });
    expect(await screen.findByRole("button", { name: "Filter (2)" })).toBeTruthy();
  });

  it("speichert die Ansicht, lädt eine geteilte Ansicht und zeigt Besitz und Teilung", async () => {
    const ANSICHT = "22222222-bbbb-4bbb-8bbb-222222222222";
    const konfig = { filter: { verknuepfung: "und", elemente: [{ feld: "ort", operator: "ist", wert: "Berlin" }] }, sortierung: [{ feld: "name", richtung: "ab" }], spalten: [{ feld: "name" }, { feld: "ort", breite: 300 }] };
    const api = spieleApi({
      "/api/v1/crm/ansichten": { koerper: { daten: [{ id: ANSICHT, objekt: "organisation", listeId: null, name: "Berliner", art: "tabelle", konfig, besitzerId: "x", geteilt: true, standard: false, eigene: false, bearbeitbar: false }] } },
      "POST /api/v1/crm/ansichten": { status: 201, koerper: { id: "33333333-cccc-4ccc-8ccc-333333333333" } },
    });
    const { router } = rendereApp("/kontakte");
    const nutzer = userEvent.setup();
    await gitter();
    await nutzer.selectOptions(screen.getByLabelText("Ansicht"), `Berliner (geteilt)`);
    await waitFor(() => expect(router.state.location.search).toEqual({ ansicht: ANSICHT }));
    await waitFor(() => expect(letzte(api).filter).toEqual(konfig.filter));
    expect(letzte(api).sortierung).toEqual(konfig.sortierung);
    // fremde geteilte Ansicht: weder löschen noch teilen
    expect(screen.queryByRole("button", { name: "Löschen" })).toBeNull();

    await nutzer.click(screen.getByRole("button", { name: "Als neue Ansicht speichern" }));
    const dialog = await screen.findByRole("dialog", { name: "Als neue Ansicht speichern" });
    await nutzer.type(within(dialog).getByLabelText("Name der Ansicht"), "Meine Sicht");
    await nutzer.click(within(dialog).getByRole("checkbox"));
    await nutzer.click(within(dialog).getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(api.anfragen("POST", "/api/v1/crm/ansichten")).toHaveLength(1));
    expect(api.anfragen("POST", "/api/v1/crm/ansichten")[0]!.koerper).toMatchObject({ objekt: "organisation", name: "Meine Sicht", art: "tabelle", geteilt: true, konfig: { filter: konfig.filter, sortierung: konfig.sortierung } });
  });

  it("wählt Zeilen und fügt sie einer Liste hinzu, mit Rückmeldung", async () => {
    const api = spieleApi({
      "/api/v1/crm/listen": { koerper: { daten: [LISTE] } },
      "POST /api/v1/crm/objekte/organisation/massenaktion": { koerper: { erfolgreich: 1, hinzugefuegt: 1, fehler: [] } },
    });
    rendereApp("/kontakte");
    const nutzer = userEvent.setup();
    const grid = await gitter();
    await nutzer.click(within(grid).getByRole("checkbox", { name: "Zeile auswählen: Alpha Energie" }));
    const leiste = await screen.findByRole("region", { name: "Aktionen für die Auswahl" });
    expect(within(leiste).getByText("1 ausgewählt")).toBeTruthy();
    await nutzer.click(within(leiste).getByRole("button", { name: "Zur Liste hinzufügen" }));
    const dialog = await screen.findByRole("dialog", { name: "Zur Liste hinzufügen" });
    await nutzer.selectOptions(within(dialog).getByLabelText("Liste"), "Co-Investoren 2026");
    await nutzer.click(within(dialog).getByRole("button", { name: "Hinzufügen" }));
    await waitFor(() => expect(api.anfragen("POST", "/api/v1/crm/objekte/organisation/massenaktion")).toHaveLength(1));
    expect(api.anfragen("POST", "/api/v1/crm/objekte/organisation/massenaktion")[0]!.koerper).toEqual({ ids: [ORG_A], aktion: { art: "liste_hinzufuegen", listeId: LISTE.id } });
    expect(await screen.findByText("1 Datensatz geändert.")).toBeTruthy();
  });

  it("archiviert nur nach Bestätigung und meldet abgelehnte Datensätze mit Grund", async () => {
    const api = spieleApi({ "POST /api/v1/crm/objekte/organisation/massenaktion": { koerper: { erfolgreich: 0, hinzugefuegt: 0, fehler: [{ id: ORG_A, code: "record_referenced" }] } } });
    rendereApp("/kontakte");
    const nutzer = userEvent.setup();
    const grid = await gitter();
    await nutzer.click(within(grid).getByRole("checkbox", { name: "Alle Zeilen auswählen" }));
    await nutzer.click(await screen.findByRole("button", { name: "Archivieren" }));
    expect(api.anfragen("POST", "/api/v1/crm/objekte/organisation/massenaktion")).toHaveLength(0);
    const dialog = await screen.findByRole("dialog", { name: "2 Datensätze archivieren" });
    await nutzer.click(within(dialog).getByRole("button", { name: "Archivieren" }));
    expect(await screen.findByText(/Beteiligungen, Deals oder Zugänge/)).toBeTruthy();
    expect(api.anfragen("POST", "/api/v1/crm/objekte/organisation/massenaktion")[0]!.koerper).toEqual({ ids: [ORG_A, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"], aktion: { art: "archivieren" } });
  });

  it("legt ein eigenes Feld an (globale Verwalter)", async () => {
    const api = spieleApi({
      "/api/v1/crm/objekte/organisation/felder": () => ({ koerper: { daten: [] } }),
      "POST /api/v1/crm/felder": { status: 201, koerper: { id: "f1" } },
    });
    rendereApp("/kontakte");
    const nutzer = userEvent.setup();
    await gitter();
    await nutzer.click(screen.getByRole("button", { name: "Felder verwalten" }));
    const panel = await screen.findByRole("dialog", { name: "Eigene Felder" });
    await nutzer.click(await within(panel).findByRole("button", { name: "Neues Feld" }));
    await nutzer.type(within(panel).getByLabelText("Name des Feldes"), "Temperatur");
    await nutzer.selectOptions(within(panel).getByLabelText("Typ"), "Auswahl");
    await nutzer.type(within(panel).getByLabelText("Option 1"), "Heiß");
    await nutzer.click(within(panel).getByRole("button", { name: "Option hinzufügen" }));
    await nutzer.type(within(panel).getByLabelText("Option 2"), "Kalt");
    await nutzer.selectOptions(within(panel).getByLabelText("Farbe der Option 2"), "Blau");
    await nutzer.click(within(panel).getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(api.anfragen("POST", "/api/v1/crm/felder")).toHaveLength(1));
    expect(api.anfragen("POST", "/api/v1/crm/felder")[0]!.koerper).toEqual({
      objekt: "organisation",
      name: "Temperatur",
      typ: "auswahl",
      optionen: { optionen: [{ schluessel: "heiss", label: "Heiß", farbe: "grau" }, { schluessel: "kalt", label: "Kalt", farbe: "blau" }] },
    });
  });

  it("importiert CSV mit Zuordnung der Spalten und zeigt Vorschau und Ergebnis", async () => {
    const api = spieleApi({
      "POST /api/v1/crm/import/kopfzeile": { koerper: { spalten: ["Name", "Ort", "Notizen"] } },
      "POST /api/v1/crm/import/vorschau": { koerper: { zusammenfassung: { zeilen: 2, neu: 1, dubletten: 1, fehler: 0, leer: 0 }, zeilen: [{ zeile: 2, status: "neu", name: "Neu GmbH", fehler: [] }, { zeile: 3, status: "dublette", name: "Alpha Energie", dublette: { id: ORG_A, name: "Alpha Energie", score: 1 }, fehler: [] }] } },
      "POST /api/v1/crm/import": { koerper: { zusammenfassung: { zeilen: 2, angelegt: 1, aktualisiert: 0, uebersprungen: 1, fehler: 0, leer: 0 }, zeilen: [{ zeile: 2, status: "angelegt", name: "Neu GmbH", fehler: [] }, { zeile: 3, status: "uebersprungen", name: "Alpha Energie", fehler: [] }] } },
    });
    rendereApp("/kontakte");
    const nutzer = userEvent.setup();
    await gitter();
    await nutzer.click(screen.getByRole("button", { name: "Import" }));
    const panel = await screen.findByRole("dialog", { name: "CSV-Import mit Zuordnung" });
    const csv = "Name;Ort;Notizen\nNeu GmbH;Köln;x\nAlpha Energie;Hamburg;y\n";
    const text = within(panel).getByLabelText("Oder CSV-Text einfügen");
    fireEvent.change(text, { target: { value: csv } });
    fireEvent.blur(text);
    // Vorschlag aus den Kopfzeilen: Name und Ort sind zugeordnet, Notizen nicht
    expect((await within(panel).findByLabelText("Spalte „Name“") as HTMLSelectElement).value).toBe("name");
    expect((within(panel).getByLabelText("Spalte „Ort“") as HTMLSelectElement).value).toBe("ort");
    expect((within(panel).getByLabelText("Spalte „Notizen“") as HTMLSelectElement).value).toBe("");
    expect(within(panel).getByRole("button", { name: "Importieren" }).hasAttribute("disabled")).toBe(true);

    await nutzer.click(within(panel).getByRole("button", { name: "Vorschau" }));
    expect(await within(panel).findByText(/Vorschau: 1 neue Zeile, 1 Dublette, 0 Fehler\./)).toBeTruthy();
    expect(within(panel).getByText(/Ähnlich wie „Alpha Energie“/)).toBeTruthy();
    expect(api.anfragen("POST", "/api/v1/crm/import/vorschau")[0]!.koerper).toEqual({ objekt: "organisation", csv, zuordnung: [{ spalte: 0, feld: "name" }, { spalte: 1, feld: "ort" }], dubletten: "ueberspringen", unternehmenAnlegen: false });

    await nutzer.click(within(panel).getByRole("button", { name: "Importieren" }));
    expect(await within(panel).findByText("Importiert: 1 angelegt, 0 aktualisiert, 0 Zeilen mit Fehlern übersprungen.")).toBeTruthy();
    expect(api.anfragen("POST", "/api/v1/crm/import")).toHaveLength(1);
  });

  it("zeigt Ähnliches beim Tippen und legt erst nach ausdrücklicher Bestätigung an (409 possible_duplicate)", async () => {
    const alpha = { id: ORG_A, name: "Alpha Energie", art: "unternehmen", sektor: "Energie", ort: "Hamburg", website: null };
    const api = spieleApi({
      "/api/v1/organisationen/dubletten": (a) => ({ koerper: { daten: a.query.get("name")?.startsWith("Alpha") ? [kandidat] : [] } }),
      "POST /api/v1/organisationen": (a) =>
        (a.koerper as { dubletteBestaetigt?: boolean }).dubletteBestaetigt
          ? { status: 201, koerper: { ...alpha, id: NEUE_ORG_ID, name: "Alpha Energie GmbH" } }
          : fehler(409, "possible_duplicate", { kandidaten: [kandidat] }),
      [`/api/v1/organisationen/${NEUE_ORG_ID}`]: { koerper: { ...organisationDaten, id: NEUE_ORG_ID, name: "Alpha Energie GmbH" } },
    });
    const { router } = rendereApp("/kontakte");
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Neues Unternehmen" }));
    const dialog = await screen.findByRole("dialog", { name: "Neue Organisation" });

    await nutzer.type(within(dialog).getByLabelText("Name"), "Alpha Energie GmbH");
    expect(await within(dialog).findByText("Ähnliche Organisationen.")).toBeTruthy();
    expect(api.anfragen("POST", "/api/v1/organisationen")).toHaveLength(0);

    await nutzer.click(within(dialog).getByRole("button", { name: "Organisation anlegen" }));
    const bestaetigung = await within(dialog).findByRole("alert");
    expect(within(bestaetigung).getByText("Es gibt bereits ähnliche Organisationen.")).toBeTruthy();
    expect(router.state.location.pathname).toBe("/kontakte");

    await nutzer.click(within(dialog).getByRole("button", { name: "Trotzdem neu anlegen" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Alpha Energie GmbH" })).toBeTruthy();
    expect(router.state.location.pathname).toBe(`/organisationen/${NEUE_ORG_ID}`);
  });

  it("legt einen Kontakt ohne Unternehmen an", async () => {
    const api = spieleApi({ "POST /api/v1/personen": { status: 201, koerper: { id: "p9" } } });
    rendereApp("/kontakte?objekt=person");
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Neuer Kontakt" }));
    const dialog = await screen.findByRole("dialog", { name: "Person hinzufügen" });
    await nutzer.type(within(dialog).getByLabelText("Vorname"), "Mia");
    await nutzer.type(within(dialog).getByLabelText("Nachname"), "Muster");
    await nutzer.click(within(dialog).getByRole("button", { name: "Person anlegen" }));
    await waitFor(() => expect(api.anfragen("POST", "/api/v1/personen")).toHaveLength(1));
    expect(api.anfragen("POST", "/api/v1/personen")[0]!.koerper).toEqual({ vorname: "Mia", nachname: "Muster" });
  });

  it("zeigt im Reiter „Heute“ fällige Wiedervorlagen und meldet sie als erledigt", async () => {
    let offen = true;
    const api = spieleApi({
      "/api/v1/wiedervorlagen": () => ({ koerper: { daten: offen ? [wiedervorlageDaten] : [] } }),
      "POST /api/v1/aktivitaeten/a1/erledigt": () => {
        offen = false;
        return { koerper: { ...aktivitaetDaten, wiedervorlageErledigtAm: "2026-10-02T08:00:00.000Z" } };
      },
    });
    rendereApp("/kontakte?objekt=heute");
    const nutzer = userEvent.setup();
    expect(await screen.findByText("Erstes Gespräch")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Alpha, Wachstum" }).getAttribute("href")).toBe("/deals/d1");
    await nutzer.click(screen.getByRole("button", { name: "Wiedervorlage „Erstes Gespräch“ als erledigt melden" }));
    expect(await screen.findByText("Keine fälligen Wiedervorlagen.")).toBeTruthy();
    expect(api.anfragen("POST", "/api/v1/aktivitaeten/a1/erledigt")).toHaveLength(1);
    expect(api.anfragen("GET", "/api/v1/fonds")).toHaveLength(1);
  });

  it("ist auch auf Englisch vollständig", async () => {
    localStorage.setItem("carraway.sprache", "en");
    spieleApi();
    rendereApp("/kontakte");
    expect(await screen.findByRole("heading", { level: 1, name: "Contacts" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "New company" })).toBeTruthy();
    const grid = await screen.findByRole("grid", { name: "Companies" });
    expect(within(grid).getByRole("button", { name: "Type" })).toBeTruthy();
    expect(within(grid).getByText("Investor")).toBeTruthy();
    expect(screen.getByLabelText("Search")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Export as CSV" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Today" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    expect(await screen.findByRole("dialog", { name: "Filter" })).toBeTruthy();
  });
});
