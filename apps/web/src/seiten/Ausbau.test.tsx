import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DEAL_ID, FONDS_ID, ICH_ID, ORG_A, ORG_B, alsRolle, dealDetailDaten, fehler, organisationDaten, rendereApp, spieleApi, wiedervorlageDaten } from "../test/hilfen";

/** Etappe 7 in der Oberfläche: Rollen, Beziehungen, Zusammenführen, Import, Wiedervorlagen, Auswertung, Vorlagen, Suche. Alle Daten sind erfunden. */

const person = { id: "p1", vorname: "Eva", nachname: "Muster", email: "eva@example.org", funktion: "Geschäftsführung" };

describe("Rollen und Beziehungen", () => {
  it("fügt auf der Organisation eine Rolle hinzu: Person über die Suche wählen, Rolle und Zeitraum senden", async () => {
    const api = spieleApi({
      "/api/v1/suche": { koerper: { q: "eva", organisationen: [], personen: [{ ...person, organisation: { id: ORG_A, name: "Alpha Energie" }, score: 1 }], deals: [] } },
      "POST /api/v1/kontaktrollen": { status: 201, koerper: { id: "r1" } },
    });
    rendereApp(`/organizations/${ORG_A}`);
    const nutzer = userEvent.setup();
    // Die Rolle gehört zur Zeile des Kontakts: Zeilenmenü, „Rolle hinzufügen“
    const tabelle = await screen.findByRole("region", { name: "Kontakte des Unternehmens" });
    await nutzer.click(await within(tabelle).findByRole("button", { name: "Weitere Aktionen" }));
    await nutzer.click(await screen.findByRole("menuitem", { name: "Rolle hinzufügen" }));
    const dialog = await screen.findByRole("dialog", { name: "Rolle hinzufügen: Eva Muster" });
    await nutzer.selectOptions(within(dialog).getByLabelText("Rolle"), "gruender");
    await nutzer.type(within(dialog).getByLabelText("Von (optional)"), "2020-01-01");
    await nutzer.click(within(dialog).getByRole("button", { name: "Rolle speichern" }));
    await waitFor(() => expect(api.anfragen("POST", "/api/v1/kontaktrollen")).toHaveLength(1));
    expect(api.anfragen("POST", "/api/v1/kontaktrollen")[0]?.koerper).toEqual({ personId: "p1", organisationId: ORG_A, rolle: "gruender", von: "2020-01-01" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("zeigt Rollen und Beziehungen mit Gegenüber, Richtung und Entfernen", async () => {
    const api = spieleApi({
      [`/api/v1/organisationen/${ORG_A}`]: {
        koerper: {
          ...organisationDaten,
          rollen: [{ id: "r1", rolle: "co_investor", von: "2021-03-01", bis: null, person: { id: "p1", vorname: "Eva", nachname: "Muster" } }],
          beziehungen: [
            { id: "b1", art: "co_investor", richtung: "aus", bemerkung: null, organisation: { id: ORG_B, name: "Beta Medizin" }, fonds: null },
            { id: "b2", art: "berater", richtung: "ein", bemerkung: "Seit 2022", organisation: { id: "c1", name: "Gamma Beratung" }, fonds: null },
            { id: "b3", art: "investor", richtung: "aus", bemerkung: null, organisation: null, fonds: { id: FONDS_ID, name: "Beispielfonds I", kurzname: "BF I" } },
          ],
        },
      },
      "DELETE /api/v1/organisationsbeziehungen/b1": { status: 204, koerper: null },
      "DELETE /api/v1/kontaktrollen/r1": { status: 204, koerper: null },
    });
    const { router } = rendereApp(`/organizations/${ORG_A}`);
    // Rollen stehen als Etiketten in der Zeile des Kontakts, nicht in einer zweiten Liste
    const rollen = await screen.findByRole("region", { name: "Kontakte des Unternehmens" });
    expect(await within(rollen).findAllByRole("link", { name: "Eva Muster" })).toHaveLength(1);
    expect(within(rollen).getByRole("link", { name: "Eva Muster" }).getAttribute("href")).toBe("/people/p1");
    const chip = within(rollen).getByText("Co-Investor");
    expect(chip.closest(".app-chip")?.getAttribute("title")).toBe("seit 01.03.2021 · unbefristet");
    expect(screen.queryByRole("region", { name: "Rollen" })).toBeNull();
    const nutzer = userEvent.setup();
    await nutzer.click(within(rollen).getByRole("button", { name: "Rolle entfernen: Co-Investor bei Eva Muster" }));
    await waitFor(() => expect(api.anfragen("DELETE", "/api/v1/kontaktrollen/r1")).toHaveLength(1));
    await nutzer.click(await within(await screen.findByRole("navigation", { name: /^(Hauptnavigation|Main navigation)$/ })).findByRole("link", { name: /^Beziehungen/ }));
    expect(router.state.location.search).toEqual({ unter: "beziehungen" });
    const beziehungen = await screen.findByRole("region", { name: "Beziehungen" });
    expect(within(beziehungen).getByRole("link", { name: "Beta Medizin" }).getAttribute("href")).toBe(`/organizations/${ORG_B}`);
    expect(within(beziehungen).getByText(/Co-Investor von/)).toBeTruthy();
    expect(within(beziehungen).getByText(/ist Berater dieser Organisation/)).toBeTruthy();
    expect(within(beziehungen).getByText("Investor in Beispielfonds I")).toBeTruthy();
    await nutzer.click(within(beziehungen).getByRole("button", { name: "Beziehung „Co-Investor von Beta Medizin“ entfernen" }));
    await waitFor(() => expect(api.anfragen("DELETE", "/api/v1/organisationsbeziehungen/b1")).toHaveLength(1));
  });

  it("legt eine Beziehung zu einem Fonds an", async () => {
    const api = spieleApi({ "POST /api/v1/organisationsbeziehungen": { status: 201, koerper: { id: "b9" } } });
    rendereApp(`/organizations/${ORG_A}?subtab=relationships`);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Beziehung hinzufügen" }));
    const dialog = await screen.findByRole("dialog", { name: "Beziehung hinzufügen" });
    await nutzer.selectOptions(within(dialog).getByLabelText("Art"), "investor");
    await nutzer.click(within(dialog).getByRole("button", { name: "Fonds" }));
    await nutzer.selectOptions(await within(dialog).findByLabelText("Fonds wählen"), FONDS_ID);
    await nutzer.type(within(dialog).getByLabelText("Bemerkung (optional)"), "Anteilseigner");
    await nutzer.click(within(dialog).getByRole("button", { name: "Beziehung speichern" }));
    await waitFor(() => expect(api.anfragen("POST", "/api/v1/organisationsbeziehungen")).toHaveLength(1));
    expect(api.anfragen("POST", "/api/v1/organisationsbeziehungen")[0]?.koerper).toEqual({ vonOrganisationId: ORG_A, art: "investor", fondsId: FONDS_ID, bemerkung: "Anteilseigner" });
  });

  it("zeigt die Personenseite mit Rollen, Organisation und Aktivitäten", async () => {
    spieleApi({
      "/api/v1/personen/p1": {
        koerper: {
          ...person,
          organisationId: ORG_A,
          zusammengefuehrtIn: null,
          organisation: { id: ORG_A, name: "Alpha Energie" },
          rollen: [{ id: "r1", rolle: "gruender", von: "2020-01-01", bis: "2022-12-31", organisation: { id: ORG_A, name: "Alpha Energie" } }],
          letzteAktivitaet: "2026-09-10",
        },
      },
    });
    rendereApp("/people/p1");
    expect(await screen.findByRole("heading", { level: 1, name: "Eva Muster" })).toBeTruthy();
    const rollen = await screen.findByRole("region", { name: "Unternehmen des Kontakts" });
    expect(within(rollen).getByRole("link", { name: "Alpha Energie" })).toBeTruthy();
    expect(within(rollen).getByText("Gründung").closest(".app-chip")?.getAttribute("title")).toBe("seit 01.01.2020 · bis 31.12.2022");
    expect(screen.getAllByText(/10\.09\.2026/).length).toBeGreaterThanOrEqual(1);
    await userEvent.setup().click(await within(await screen.findByRole("navigation", { name: /^(Hauptnavigation|Main navigation)$/ })).findByRole("link", { name: /^Aktivitäten/ }));
    expect(await screen.findByText("Erstes Gespräch")).toBeTruthy();
  });

  it("zeigt bei ähnlichen Personen die Kandidaten und legt erst nach Bestätigung an", async () => {
    const kandidat = { id: "p9", vorname: "Eva", nachname: "Musterfrau", email: "eva@example.org", organisation: null, grund: "email", score: 1 };
    const api = spieleApi({
      "POST /api/v1/personen": (a) => ((a.koerper as { dubletteBestaetigt?: boolean }).dubletteBestaetigt ? { status: 201, koerper: { id: "p10" } } : fehler(409, "possible_duplicate", { kandidaten: [kandidat] })),
    });
    rendereApp(`/organizations/${ORG_A}`);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Neuer Kontakt" }));
    const dialog = await screen.findByRole("dialog", { name: "Person hinzufügen" });
    await nutzer.type(within(dialog).getByLabelText("Vorname"), "Eva");
    await nutzer.type(within(dialog).getByLabelText("Nachname"), "Musterfrau");
    await nutzer.click(within(dialog).getByRole("button", { name: "Person anlegen" }));
    const hinweis = await within(dialog).findByRole("alert");
    expect(within(hinweis).getByRole("link", { name: "Eva Musterfrau" }).getAttribute("href")).toBe("/people/p9");
    expect(within(hinweis).getByText(/Gleiche E-Mail-Adresse/)).toBeTruthy();
    await nutzer.click(within(hinweis).getByRole("button", { name: "Trotzdem neu anlegen" }));
    await waitFor(() => expect(api.anfragen("POST", "/api/v1/personen")).toHaveLength(2));
    expect(api.anfragen("POST", "/api/v1/personen")[1]?.koerper).toMatchObject({ dubletteBestaetigt: true, organisationId: ORG_A });
  });
});

describe("Zusammenführen", () => {
  const vorschau = {
    ziel: { id: ORG_A },
    quelle: { id: ORG_B },
    felder: [
      { feld: "name", ziel: "Alpha Energie", quelle: "Alpha Energie GmbH", abweichend: true, vorschlag: "ziel" },
      { feld: "art", ziel: "unternehmen", quelle: "unternehmen", abweichend: false, vorschlag: "ziel" },
      { feld: "ort", ziel: null, quelle: "Hamburg", abweichend: true, vorschlag: "quelle" },
    ],
    verschiebt: { personen: 2, deals: 1, aktivitaeten: 3, beteiligungen: 1, rollen: 0, beziehungen: 0, runden: 0, rundenpositionen: 0 },
    fondsIds: [FONDS_ID],
    verdeckteFonds: false,
    freigabeNoetig: true,
    darfAusfuehren: true,
    ueberschneidungen: [],
    ueberschneidungVerdeckt: false,
  };
  const dubletten = { "/api/v1/organisationen/dubletten": { koerper: { daten: [{ id: ORG_B, name: "Alpha Energie GmbH", art: "unternehmen", ort: "Hamburg", score: 0.9 }] } } };

  it("führt zwei Organisationen zusammen: Vorschau mit Umzug und Feldwahl, Wahl senden, Seite des Ziels öffnen", async () => {
    const api = spieleApi({
      ...dubletten,
      [`POST /api/v1/organisationen/${ORG_A}/zusammenfuehren/vorschau`]: { koerper: vorschau },
      [`POST /api/v1/organisationen/${ORG_A}/zusammenfuehren`]: { koerper: { organisation: { id: ORG_A }, quelleId: ORG_B, verschoben: {} } },
    });
    const { router } = rendereApp(`/organizations/${ORG_A}`);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Zusammenführen" }));
    const dialog = await screen.findByRole("dialog", { name: "Organisation zusammenführen" });
    await nutzer.click(await within(dialog).findByRole("button", { name: /Alpha Energie GmbH/ }));
    expect(api.anfragen("POST", `/api/v1/organisationen/${ORG_A}/zusammenfuehren/vorschau`)[0]?.koerper).toEqual({ quelleId: ORG_B });

    // Was umzieht, kommt von der API
    expect(await within(dialog).findByText("Das zieht um")).toBeTruthy();
    expect(within(dialog).getByText(/Beteiligungen:/).textContent).toContain("1");
    expect(within(dialog).getByText(/Aktivitäten:/).textContent).toContain("3");
    expect(within(dialog).getByText(/Diese Organisation hält Beteiligungen/)).toBeTruthy();
    // Vorgabe aus der Vorschau; die Wahl ändern: Name vom zusammengeführten Datensatz
    const nameQuelle = within(dialog).getByRole("radio", { name: "Name: Wert des zusammengeführten Datensatzes" }) as HTMLInputElement;
    expect((within(dialog).getByRole("radio", { name: "Name: Wert des bleibenden Datensatzes" }) as HTMLInputElement).checked).toBe(true);
    expect((within(dialog).getByRole("radio", { name: "Ort: Wert des zusammengeführten Datensatzes" }) as HTMLInputElement).checked).toBe(true);
    await nutzer.click(nameQuelle);
    await nutzer.click(within(dialog).getByRole("button", { name: "Jetzt zusammenführen" }));
    await waitFor(() => expect(api.anfragen("POST", `/api/v1/organisationen/${ORG_A}/zusammenfuehren`)).toHaveLength(1));
    expect(api.anfragen("POST", `/api/v1/organisationen/${ORG_A}/zusammenfuehren`)[0]?.koerper).toEqual({ quelleId: ORG_B, felder: { name: "quelle", ort: "quelle" } });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(router.state.location.pathname).toBe(`/organizations/${ORG_A}`);
  });

  it("findet das Gegenstück über das Suchfeld und lässt das eigene Unternehmen aus", async () => {
    const api = spieleApi({
      ...dubletten,
      "/api/v1/suche": {
        koerper: {
          q: "alpha",
          organisationen: [
            { id: ORG_A, name: "Alpha Energie", art: "unternehmen", ort: null, score: 1 },
            { id: ORG_B, name: "Alpha Energie GmbH", art: "unternehmen", ort: "Hamburg", score: 0.9 },
          ],
          personen: [],
          deals: [],
          beteiligungen: [],
          dokumente: [],
        },
      },
      [`POST /api/v1/organisationen/${ORG_A}/zusammenfuehren/vorschau`]: { koerper: vorschau },
    });
    rendereApp(`/organizations/${ORG_A}`);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Zusammenführen" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Organisation zusammenführen" }));
    await nutzer.type(dialog.getByRole("combobox", { name: "Datensatz suchen" }), "alpha");
    const optionen = await dialog.findAllByRole("option");
    expect(optionen).toHaveLength(1);
    await nutzer.click(optionen[0]!);
    await waitFor(() => expect(api.anfragen("POST", `/api/v1/organisationen/${ORG_A}/zusammenfuehren/vorschau`)).toHaveLength(1));
    expect(api.anfragen("POST", `/api/v1/organisationen/${ORG_A}/zusammenfuehren/vorschau`)[0]?.koerper).toEqual({ quelleId: ORG_B });
  });

  it("tauscht die Reihenfolge: dann bleibt der andere Datensatz, die Vorschau wird neu geholt", async () => {
    const api = spieleApi({
      ...dubletten,
      [`POST /api/v1/organisationen/${ORG_A}/zusammenfuehren/vorschau`]: { koerper: vorschau },
      [`POST /api/v1/organisationen/${ORG_B}/zusammenfuehren/vorschau`]: { koerper: { ...vorschau, ziel: { id: ORG_B }, quelle: { id: ORG_A } } },
      [`POST /api/v1/organisationen/${ORG_B}/zusammenfuehren`]: { koerper: { organisation: { id: ORG_B }, quelleId: ORG_A, verschoben: {} } },
      [`/api/v1/organisationen/${ORG_B}`]: { koerper: { ...organisationDaten, id: ORG_B, name: "Alpha Energie GmbH" } },
    });
    const { router } = rendereApp(`/organizations/${ORG_A}`);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Zusammenführen" }));
    const dialog = await screen.findByRole("dialog", { name: "Organisation zusammenführen" });
    await nutzer.click(await within(dialog).findByRole("button", { name: /Alpha Energie GmbH/ }));
    await nutzer.click(await within(dialog).findByRole("button", { name: "Reihenfolge tauschen" }));
    await waitFor(() => expect(api.anfragen("POST", `/api/v1/organisationen/${ORG_B}/zusammenfuehren/vorschau`)).toHaveLength(1));
    expect(api.anfragen("POST", `/api/v1/organisationen/${ORG_B}/zusammenfuehren/vorschau`)[0]?.koerper).toEqual({ quelleId: ORG_A });
    await nutzer.click(await within(dialog).findByRole("button", { name: "Jetzt zusammenführen" }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/organizations/${ORG_B}`));
    expect(api.anfragen("POST", `/api/v1/organisationen/${ORG_B}/zusammenfuehren`)[0]?.koerper).toMatchObject({ quelleId: ORG_A });
  });

  it("sperrt das Ausführen bei Überschneidung der Fonds und bei fehlender Freigeberrolle", async () => {
    spieleApi({
      ...dubletten,
      [`POST /api/v1/organisationen/${ORG_A}/zusammenfuehren/vorschau`]: { koerper: { ...vorschau, ueberschneidungen: [{ fondsId: FONDS_ID, instrument: "darlehen" }], darfAusfuehren: false } },
    });
    rendereApp(`/organizations/${ORG_A}`);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Zusammenführen" }));
    const dialog = await screen.findByRole("dialog", { name: "Organisation zusammenführen" });
    await nutzer.click(await within(dialog).findByRole("button", { name: /Alpha Energie GmbH/ }));
    expect(await within(dialog).findByText(/selben Fonds gehalten/)).toBeTruthy();
    expect(within(dialog).getByText(/Dafür fehlt eine Rolle/)).toBeTruthy();
    expect((within(dialog).getByRole("button", { name: "Jetzt zusammenführen" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("bietet das Zusammenführen nur mit Schreibrecht an, und auf Englisch vollständig", async () => {
    spieleApi({ "/api/v1/me": alsRolle("betrachter") });
    rendereApp(`/organizations/${ORG_A}`);
    await screen.findByRole("heading", { level: 1, name: "Alpha Energie" });
    expect(screen.queryByRole("button", { name: "Zusammenführen" })).toBeNull();
  });

  it("zeigt ohne Rechte-Einschränkung auch auf Englisch Dialog und Vorschau", async () => {
    localStorage.setItem("carraway.sprache", "en");
    spieleApi({ ...dubletten, [`POST /api/v1/organisationen/${ORG_A}/zusammenfuehren/vorschau`]: { koerper: vorschau } });
    rendereApp(`/organizations/${ORG_A}`);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Merge" }));
    const dialog = await screen.findByRole("dialog", { name: "Merge organisation" });
    await nutzer.click(await within(dialog).findByRole("button", { name: /Alpha Energie GmbH/ }));
    expect(await within(dialog).findByText("What moves")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Merge now" })).toBeTruthy();
    expect(within(dialog).getByText("Holdings:", { exact: false })).toBeTruthy();
    localStorage.removeItem("carraway.sprache");
  });
});

describe("Kontaktimport", () => {
  const csv = "typ;name;art\r\norganisation;Neu Sensorik GmbH;unternehmen\r\norganisation;Delta Energie Systeme GmbH;unternehmen";
  const zeile = (zusatz: Record<string, unknown> & { status: string }) => ({ typ: "organisation", fehler: [] as string[], vorhanden: null, kandidaten: [] as unknown[], organisation: null, vorschlag: "anlegen", ergebnis: null as string | null, id: null, ...zusatz });
  const antwort = {
    unbekannteSpalten: ["bemerkung"],
    zusammenfassung: { zeilen: 4, neu: 1, vorhanden: 1, mitKandidaten: 1, fehler: 1 },
    zeilen: [
      zeile({ zeile: 2, anzeige: "Neu Sensorik GmbH", status: "neu" }),
      zeile({ zeile: 3, anzeige: "Alpha Energie GmbH", status: "vorhanden", vorhanden: { id: ORG_A, name: "Alpha Energie", zeileInDatei: null }, vorschlag: "zusammenfuehren" }),
      zeile({ zeile: 4, anzeige: "Delta Energie Systeme GmbH", status: "neu", kandidaten: [{ id: ORG_B, name: "Delta Energie GmbH", art: "unternehmen", ort: null, score: 0.6 }], vorschlag: "ueberspringen" }),
      zeile({ zeile: 5, anzeige: "Ohne Art", status: "fehler", fehler: ["art_fehlt"] }),
    ],
  };

  it("lädt eine Datei, zeigt die Vorschau mit Kandidaten und Fehlern und übernimmt mit den gewählten Entscheidungen", async () => {
    const api = spieleApi({
      "POST /api/v1/kontaktimport/vorschau": { koerper: antwort },
      "POST /api/v1/kontaktimport": {
        koerper: {
          unbekannteSpalten: [],
          zusammenfassung: { angelegt: 1, ergaenzt: 1, unveraendert: 0, uebersprungen: 0, fehler: 1 },
          zeilen: antwort.zeilen.map((z) => ({ ...z, ergebnis: z.status === "fehler" ? "fehler" : "angelegt" })),
        },
      },
    });
    rendereApp("/contacts/import");
    const nutzer = userEvent.setup({ applyAccept: false });
    await screen.findByRole("heading", { level: 1, name: "Kontaktimport" });
    // Vorlagen als Links, in beiden Sprachen und Formaten
    expect(screen.getByRole("link", { name: "Vorlage CSV, DE" }).getAttribute("href")).toBe("/api/v1/contact-import/template?language=de&format=csv");
    expect(screen.getByRole("link", { name: "Vorlage XLSX, EN" }).getAttribute("href")).toBe("/api/v1/contact-import/template?language=en&format=xlsx");

    await nutzer.upload(screen.getByLabelText("Datei (CSV oder Excel)"), new File([csv], "kontakte.csv", { type: "text/csv" }));
    await nutzer.click(screen.getByRole("button", { name: "Datei prüfen" }));
    const vorschau = await screen.findByRole("region", { name: "Vorschau" });
    const gesendet = api.anfragen("POST", "/api/v1/kontaktimport/vorschau")[0]?.koerper as { format: string; inhalt: string };
    expect(gesendet.format).toBe("csv");
    expect(Buffer.from(gesendet.inhalt, "base64").toString("utf8")).toBe(csv);
    expect(screen.getByText("4 Zeilen: 1 neu, 1 bereits vorhanden, 1 mit ähnlichen Datensätzen, 1 mit Fehlern.")).toBeTruthy();
    expect(screen.getByText(/Diese Spalten gehören nicht zur Vorlage.*bemerkung/)).toBeTruthy();
    expect(within(vorschau).getByText(/Alpha Energie$/)).toBeTruthy();
    expect(within(vorschau).getByText(/Art fehlt/)).toBeTruthy();
    // Vorschläge der API sind vorbelegt
    expect((within(vorschau).getByLabelText("Aktion für Zeile 3") as HTMLSelectElement).value).toBe("zusammenfuehren");
    expect((within(vorschau).getByLabelText("Aktion für Zeile 4") as HTMLSelectElement).value).toBe("ueberspringen");
    expect(within(vorschau).queryByLabelText("Aktion für Zeile 5")).toBeNull();

    await nutzer.selectOptions(within(vorschau).getByLabelText("Aktion für Zeile 4"), `zusammenfuehren:${ORG_B}`);
    await nutzer.click(screen.getByRole("button", { name: "Übernehmen" }));
    await waitFor(() => expect(api.anfragen("POST", "/api/v1/kontaktimport")).toHaveLength(1));
    expect(api.anfragen("POST", "/api/v1/kontaktimport")[0]?.koerper).toMatchObject({ format: "csv", entscheidungen: [{ zeile: 4, aktion: "zusammenfuehren", zielId: ORG_B }] });
    expect(await screen.findByText("Übernommen: 1 angelegt, 1 ergänzt, 0 unverändert, 0 übersprungen, 1 mit Fehlern.")).toBeTruthy();
    await nutzer.click(screen.getByRole("button", { name: "Weitere Datei prüfen" }));
    expect(screen.queryByRole("region", { name: "Vorschau" })).toBeNull();
  });

  it("lehnt andere Dateitypen ab und meldet unlesbare Dateien der API verständlich", async () => {
    spieleApi({ "POST /api/v1/kontaktimport/vorschau": fehler(400, "import_invalid", { grund: "zu_gross_entpackt" }) });
    rendereApp("/contacts/import");
    const nutzer = userEvent.setup({ applyAccept: false });
    const feld = await screen.findByLabelText("Datei (CSV oder Excel)");
    await nutzer.upload(feld, new File(["x"], "bild.png", { type: "image/png" }));
    expect(await screen.findByText("Bitte eine CSV- oder Excel-Datei (.csv, .xlsx) wählen.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Datei prüfen" }) as HTMLButtonElement).disabled).toBe(true);
    await nutzer.upload(feld, new File(["x"], "bombe.xlsx"));
    await nutzer.click(screen.getByRole("button", { name: "Datei prüfen" }));
    expect(await screen.findByText("Die Excel-Datei ist entpackt zu groß.")).toBeTruthy();
  });

  it("ist auf Englisch vollständig", async () => {
    localStorage.setItem("carraway.sprache", "en");
    spieleApi({ "POST /api/v1/kontaktimport/vorschau": { koerper: antwort } });
    rendereApp("/contacts/import");
    const nutzer = userEvent.setup({ applyAccept: false });
    await screen.findByRole("heading", { level: 1, name: "Contact import" });
    await nutzer.upload(screen.getByLabelText("File (CSV or Excel)"), new File([csv], "contacts.csv"));
    await nutzer.click(screen.getByRole("button", { name: "Check file" }));
    const vorschau = await screen.findByRole("region", { name: "Preview" });
    expect(screen.getByText("4 rows: 1 new, 1 already present, 1 with similar records, 1 with errors.")).toBeTruthy();
    expect(within(vorschau).getByText(/Type missing/)).toBeTruthy();
    expect(within(vorschau).getByRole("option", { name: "Complete: Delta Energie GmbH" })).toBeTruthy();
    localStorage.removeItem("carraway.sprache");
  });
});

describe("Wiedervorlagen", () => {
  const eintrag = { ...wiedervorlageDaten, zustaendigId: ICH_ID, ueberfaellig: true };
  const namen = { "/api/v1/users/names": { koerper: { daten: [{ id: ICH_ID, name: "Vera Beispiel" }] } } };

  it("zeigt in der Kopfzeile die Zahl der fälligen Wiedervorlagen mit eigenem Namen und führt zur Liste", async () => {
    const api = spieleApi({ "/api/v1/wiedervorlagen": (a) => ({ koerper: { daten: a.query.get("zustaendig") === "alle" ? [eintrag, { ...eintrag, id: "a2", titel: "Zweites Gespräch" }] : [eintrag] } }), ...namen });
    const { router } = rendereApp("/contacts?object=today");
    const nutzer = userEvent.setup();
    const zaehler = await screen.findByRole("link", { name: "Wiedervorlagen 2: meine fälligen, davon 1 überfällig" });
    expect(zaehler.getAttribute("href")).toBe("/follow-ups?assignee=me");
    // Die Kachel „Wiedervorlagen“ im Reiter „Heute“ bleibt eine eigene Region
    expect(screen.getByRole("heading", { name: /Wiedervorlagen/ })).toBeTruthy();
    await nutzer.click(zaehler);
    const liste = await screen.findByRole("region", { name: "Wiedervorlagen" });
    expect(await within(liste).findByText("Erstes Gespräch")).toBeTruthy();
    expect(within(liste).getByText("Überfällig")).toBeTruthy();
    expect(await within(liste).findByText("Vera Beispiel")).toBeTruthy();
    expect(api.aufrufe.some((a) => a.pfad === "/api/v1/wiedervorlagen" && a.query.get("zustaendig") === "ich")).toBe(true);
    await nutzer.click(screen.getByRole("button", { name: "Alle" }));
    expect(await within(await screen.findByRole("region", { name: "Wiedervorlagen" })).findByText("Zweites Gespräch")).toBeTruthy();
    await waitFor(() => expect(router.state.location.search).toEqual({ zustaendig: "alle" }));
  });

  it("erledigt und stellt zurück (neues Datum) und lädt den Zähler neu", async () => {
    let anzahl = { ueberfaellig: 1, heute: 1, gesamt: 2 };
    const api = spieleApi({
      "/api/v1/wiedervorlagen": { koerper: { daten: [eintrag] } },
      "/api/v1/wiedervorlagen/anzahl": () => ({ koerper: anzahl }),
      "POST /api/v1/aktivitaeten/a1/erledigt": () => {
        anzahl = { ueberfaellig: 0, heute: 1, gesamt: 1 };
        return { koerper: {} };
      },
      "POST /api/v1/aktivitaeten/a1/zurueckstellen": { koerper: {} },
      ...namen,
    });
    rendereApp("/follow-ups?assignee=me");
    const nutzer = userEvent.setup();
    await screen.findByText("Erstes Gespräch");
    await nutzer.click(screen.getByRole("button", { name: "Wiedervorlage „Erstes Gespräch“ zurückstellen" }));
    const feld = await screen.findByLabelText("Neues Datum");
    fireEvent.change(feld, { target: { value: "2099-01-31" } });
    await nutzer.click(screen.getByRole("button", { name: "Zurückstellen" }));
    await waitFor(() => expect(api.anfragen("POST", "/api/v1/aktivitaeten/a1/zurueckstellen")).toHaveLength(1));
    expect(api.anfragen("POST", "/api/v1/aktivitaeten/a1/zurueckstellen")[0]?.koerper).toEqual({ datum: "2099-01-31" });

    await nutzer.click(screen.getByRole("button", { name: "Wiedervorlage „Erstes Gespräch“ als erledigt melden" }));
    await waitFor(() => expect(api.anfragen("POST", "/api/v1/aktivitaeten/a1/erledigt")).toHaveLength(1));
    expect(await screen.findByRole("link", { name: "Wiedervorlagen 1: meine fälligen, davon 0 überfällig" })).toBeTruthy();
  });

  it("ist auf Englisch vollständig und blendet Aktionen für Betrachter aus", async () => {
    localStorage.setItem("carraway.sprache", "en");
    spieleApi({ "/api/v1/me": alsRolle("betrachter"), "/api/v1/wiedervorlagen": { koerper: { daten: [eintrag] } }, ...namen });
    rendereApp("/follow-ups");
    expect(await screen.findByRole("heading", { level: 1, name: "Follow-ups" })).toBeTruthy();
    expect(await screen.findByText("Overdue")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Follow-ups 2: my due ones, 1 of them overdue" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Snooze/ })).toBeNull();
    localStorage.removeItem("carraway.sprache");
  });
});

describe("Auswertung: Trichter erweitert", () => {
  it("zeichnet das Quartalsdiagramm mit Tabelle, zeigt Verweildauer und Konversion und verlinkt die CSV-Ausfuhr", async () => {
    spieleApi();
    rendereApp("/dealflow/analytics?from=2026-01-01&fundId=" + FONDS_ID);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("tab", { name: "Verlauf je Quartal" }));
    const diagramm = await screen.findByRole("img", { name: "Diagramm: Eingänge, Abschlüsse und Absagen je Quartal" });
    expect(diagramm.querySelectorAll("rect")).toHaveLength(9);
    expect(diagramm.querySelector("title")?.textContent).toBe("2026-Q1: 4 Eingänge, 0 Abschlüsse, 1 Absagen");
    const reihe = within(screen.getByRole("region", { name: "Verlauf je Quartal" })).getAllByRole("row");
    expect(within(reihe[2] as HTMLElement).getAllByRole("cell").map((c) => c.textContent)).toEqual(["2026-Q2", "5", "1", "1"]);

    await nutzer.click(screen.getByRole("tab", { name: "Verweildauer je Phase" }));
    const dauer = within(await screen.findByRole("region", { name: "Verweildauer je Phase" })).getAllByRole("row");
    expect(within(dauer[1] as HTMLElement).getAllByRole("cell").map((c) => c.textContent)).toEqual(["Anfrage", "", "12,5", "8"]);
    expect(within(dauer[6] as HTMLElement).getAllByRole("cell").map((c) => c.textContent)).toEqual(["Closing", "", "–", "0"]);

    await nutzer.click(screen.getByRole("tab", { name: "Konversion" }));
    const betreuung = within(await screen.findByRole("region", { name: "Konversion nach Betreuung" })).getAllByRole("row");
    expect(within(betreuung[1] as HTMLElement).getAllByRole("cell").map((c) => (c.textContent ?? "").replace(/\s/g, " "))).toEqual(["Anna Berger", "7", "4", "2", "1", "14,3 %"]);
    expect(within(screen.getByRole("region", { name: "Konversion nach Quelle" })).getByText("Ohne Quelle")).toBeTruthy();
    expect(within(betreuung[2] as HTMLElement).getByText("Ohne Betreuung")).toBeTruthy();

    const export_ = screen.getByRole("link", { name: "Als CSV herunterladen: Auswertung des Trichters" });
    expect(export_.getAttribute("href")).toBe(`/api/v1/dealflow/funnel/export?language=de&from=2026-01-01&fundId=${FONDS_ID}`);
    expect(export_.hasAttribute("download")).toBe(true);
  });

  it("ist auf Englisch vollständig", async () => {
    localStorage.setItem("carraway.sprache", "en");
    spieleApi();
    rendereApp("/dealflow/analytics");
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("tab", { name: "Trend per quarter" }));
    expect(await screen.findByRole("img", { name: "Chart: deals entering, closed and rejected per quarter" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Trend per quarter" })).toBeTruthy();
    await nutzer.click(screen.getByRole("tab", { name: "Time in each phase" }));
    expect(await screen.findByRole("region", { name: "Time in each phase" })).toBeTruthy();
    await nutzer.click(screen.getByRole("tab", { name: "Conversion" }));
    expect(await screen.findByRole("region", { name: "Conversion by owner" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Download as CSV: funnel analysis" }).getAttribute("href")).toBe("/api/v1/dealflow/funnel/export?language=en");
    localStorage.removeItem("carraway.sprache");
  });
});

describe("Beschlussvorlagen", () => {
  const vorlage = { id: "v1", fondsId: FONDS_ID, fonds: { id: FONDS_ID, name: "Beispielfonds I", kurzname: "BF I" }, name: "Standard", text: "{{organisation}} erhält {{ticket}}.", aktualisiertAm: "2026-10-01T08:00:00.000Z" };
  const liste = { daten: [vorlage], platzhalter: ["organisation", "ticket", "fonds"] };

  it("füllt den Beschlussvorschlag eines Deals aus einer Vorlage und zeigt ihn nur als Text", async () => {
    let text: string | null = null;
    const api = spieleApi({
      [`/api/v1/deals/${DEAL_ID}`]: () => ({ koerper: { ...dealDetailDaten, beschlussvorschlag: text } }),
      "/api/v1/resolution-templates": { koerper: liste },
      [`POST /api/v1/deals/${DEAL_ID}/beschlussvorschlag`]: () => {
        text = "<b>Alpha</b> erhält 2.450.000 EUR.";
        return { koerper: { beschlussvorschlag: text, vorlageId: "v1", deal: {} } };
      },
    });
    rendereApp(`/deals/${DEAL_ID}?tab=decision`);
    const nutzer = userEvent.setup();
    const abschnitt = await screen.findByRole("region", { name: "Beschlussvorschlag" });
    expect(within(abschnitt).getByText("Noch kein Beschlussvorschlag.")).toBeTruthy();
    await nutzer.click(within(abschnitt).getByRole("button", { name: "Vorschlag aus Vorlage" }));
    const dialog = await screen.findByRole("dialog", { name: "Beschlussvorschlag aus Vorlage" });
    expect(await within(dialog).findByRole("option", { name: /Standard/ })).toBeTruthy();
    await nutzer.selectOptions(within(dialog).getByLabelText("Instrument"), "wandeldarlehen");
    await nutzer.click(within(dialog).getByRole("button", { name: "Vorschlag einsetzen" }));
    await waitFor(() => expect(api.anfragen("POST", `/api/v1/deals/${DEAL_ID}/beschlussvorschlag`)).toHaveLength(1));
    expect(api.anfragen("POST", `/api/v1/deals/${DEAL_ID}/beschlussvorschlag`)[0]?.koerper).toEqual({ vorlageId: "v1", sprache: "de", instrument: "wandeldarlehen" });
    const neu = await within(await screen.findByRole("region", { name: "Beschlussvorschlag" })).findByText("<b>Alpha</b> erhält 2.450.000 EUR.");
    // Text, kein Markup
    expect(neu.querySelector("b")).toBeNull();
    expect(neu.textContent).toBe("<b>Alpha</b> erhält 2.450.000 EUR.");
  });

  it("legt eine Vorlage an, meldet unbekannte Platzhalter und löscht; Bearbeiter sehen sie nur", async () => {
    const api = spieleApi({
      "/api/v1/resolution-templates": { koerper: liste },
      "POST /api/v1/resolution-templates": (a) => ((a.koerper as { text: string }).text.includes("{{gewinn}}") ? fehler(400, "placeholder_unknown", { unbekannt: ["gewinn"] }) : { status: 201, koerper: { id: "v2" } }),
      "DELETE /api/v1/resolution-templates/v1": { status: 204, koerper: null },
    });
    rendereApp("/decision-proposals");
    const nutzer = userEvent.setup();
    expect(await screen.findByText("{{organisation}} erhält {{ticket}}.")).toBeTruthy();
    await nutzer.click(screen.getByRole("button", { name: "Neue Vorlage" }));
    const dialog = await screen.findByRole("dialog", { name: "Neue Vorlage" });
    expect(within(dialog).getByText(/\{\{organisation\}\} \{\{ticket\}\} \{\{fonds\}\}/)).toBeTruthy();
    await nutzer.type(within(dialog).getByLabelText("Name"), "Kurz");
    fireEvent.change(within(dialog).getByLabelText("Text"), { target: { value: "{{gewinn}}" } });
    await nutzer.click(within(dialog).getByRole("button", { name: "Vorlage anlegen" }));
    expect(await within(dialog).findByText("Unbekannte Platzhalter: gewinn")).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText("Text"), { target: { value: "{{organisation}}" } });
    await nutzer.click(within(dialog).getByRole("button", { name: "Vorlage anlegen" }));
    await waitFor(() => expect(api.anfragen("POST", "/api/v1/resolution-templates")).toHaveLength(2));
    expect(api.anfragen("POST", "/api/v1/resolution-templates")[1]?.koerper).toEqual({ fondsId: FONDS_ID, name: "Kurz", text: "{{organisation}}" });
    await nutzer.click(await screen.findByRole("button", { name: "Vorlage „Standard“ löschen" }));
    await waitFor(() => expect(api.anfragen("DELETE", "/api/v1/resolution-templates/v1")).toHaveLength(1));
  });

  it("zeigt Bearbeitern ohne Verwalterrolle die Vorlagen nur zum Lesen", async () => {
    spieleApi({ "/api/v1/me": alsRolle("bearbeiter"), "/api/v1/resolution-templates": { koerper: liste } });
    rendereApp("/decision-proposals");
    expect(await screen.findByText("Vorlagen pflegen nur Verwalter dieses Fonds. Sie können sie hier lesen.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Neue Vorlage" })).toBeNull();
    expect(screen.queryByRole("button", { name: /löschen/ })).toBeNull();
  });
});

describe("Suche", () => {
  const ergebnis = {
    q: "alp",
    organisationen: [{ id: ORG_A, name: "Alpha Energie", art: "unternehmen", ort: "Hamburg", score: 1.2 }],
    personen: [{ ...person, organisation: { id: ORG_A, name: "Alpha Energie" }, score: 0.5 }],
    deals: [{ id: DEAL_ID, titel: "Alpha, Wachstum", phase: "pruefung", status: "offen", organisation: { id: ORG_A, name: "Alpha Energie" }, score: 0.9 }],
  };

  it("öffnet mit Strg+K, sucht serverseitig und öffnet das erste Ergebnis mit der Tastatur", async () => {
    const api = spieleApi({ "/api/v1/suche": { koerper: ergebnis } });
    const { router } = rendereApp("/contacts");
    const nutzer = userEvent.setup();
    await screen.findByRole("heading", { level: 1, name: "Kontakte" });
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    const dialog = await screen.findByRole("dialog", { name: "Suche" });
    const feld = await within(dialog).findByLabelText("Suchbegriff");
    await waitFor(() => expect(document.activeElement).toBe(feld));
    await nutzer.type(feld, "alp");
    expect(await within(dialog).findByText("3 Datensätze gefunden")).toBeTruthy();
    expect(api.aufrufe.filter((a) => a.pfad === "/api/v1/suche").every((a) => a.query.get("q") === "alp")).toBe(true);
    expect(within(dialog).getByRole("heading", { name: "Deals" })).toBeTruthy();
    // Pfeil nach unten springt in die Liste, Pfeil nach oben zurück ins Feld
    await nutzer.keyboard("{ArrowDown}");
    const erster = within(dialog).getAllByRole("button", { name: /Alpha Energie/ })[0];
    await waitFor(() => expect(document.activeElement?.textContent).toContain("Alpha Energie"));
    await nutzer.keyboard("{ArrowDown}");
    expect(document.activeElement?.textContent).toContain("Eva Muster");
    await nutzer.keyboard("{ArrowUp}{ArrowUp}");
    expect(document.activeElement).toBe(feld);
    expect(erster).toBeTruthy();
    await nutzer.keyboard("{Enter}");
    await waitFor(() => expect(router.state.location.pathname).toBe(`/organizations/${ORG_A}`));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("öffnet auch mit Cmd+K und über den Knopf, schließt mit Escape und öffnet Personen und Deals", async () => {
    spieleApi({ "/api/v1/suche": { koerper: ergebnis } });
    const { router } = rendereApp("/contacts");
    const nutzer = userEvent.setup();
    await screen.findByRole("heading", { level: 1, name: "Kontakte" });
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    await screen.findByRole("dialog", { name: "Suche" });
    await nutzer.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // ohne Strg: kein Öffnen
    fireEvent.keyDown(document, { key: "k" });
    expect(screen.queryByRole("dialog")).toBeNull();

    await nutzer.click(screen.getByRole("button", { name: /^Suchen/ }));
    const dialog = await screen.findByRole("dialog", { name: "Suche" });
    await nutzer.type(within(dialog).getByLabelText("Suchbegriff"), "alp");
    await nutzer.click(await within(dialog).findByRole("button", { name: /Alpha, Wachstum/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/deals/${DEAL_ID}`));
  });

  it("fragt bei weniger als zwei Zeichen nicht und meldet fehlende Treffer; auf Englisch vollständig", async () => {
    localStorage.setItem("carraway.sprache", "en");
    const api = spieleApi({ "/api/v1/suche": { koerper: { q: "zz", organisationen: [], personen: [], deals: [] } } });
    rendereApp("/contacts");
    const nutzer = userEvent.setup();
    await screen.findByRole("heading", { level: 1, name: "Contacts" });
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    const dialog = await screen.findByRole("dialog", { name: "Search" });
    await nutzer.type(within(dialog).getByLabelText("Search term"), "z");
    await new Promise((r) => setTimeout(r, 300));
    expect(api.aufrufe.some((a) => a.pfad === "/api/v1/suche")).toBe(false);
    await nutzer.type(within(dialog).getByLabelText("Search term"), "z");
    expect(await within(dialog).findByText("No results. Try a different search term.")).toBeTruthy();
    localStorage.removeItem("carraway.sprache");
  });
});
