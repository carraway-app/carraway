import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { FONDS_ID, alsRolle, fehler, rendereApp, spieleApi } from "../test/hilfen";

const buchhaltungUrl = (bereich: string, unter?: string) => `/buchhaltung?${unter ? `tab=${bereich}&unter=${unter}` : `bereich=${bereich}`}`;
const pfad = (rest: string) => `/api/v1/fonds/${FONDS_ID}/${rest}`;

describe("Buchhaltung: Stammdaten bearbeiten", () => {
  const gliederungZeile = (schluessel: string, eltern: string | null, de: string, en: string, reihenfolge: number, seite = "soll") => ({ id: `g-${schluessel}`, fondsId: FONDS_ID, sicht: "bilanz", schluessel, elternSchluessel: eltern, bezeichnungDe: de, bezeichnungEn: en, reihenfolge, seite });
  const basis = {
    [pfad("buchhaltung")]: { koerper: { fondsId: FONDS_ID, beraternummer: 1234567, mandantennummer: 12345, wirtschaftsjahrBeginn: 1, sachkontenlaenge: 4, belegpraefix: "B", geaendertVon: "x", geaendertAm: "2026-11-20T09:00:00.000Z", konfiguriert: true } },
    [pfad("mittelarten")]: { koerper: { daten: [] } },
    [pfad("konten")]: { koerper: { daten: [{ id: "k1", fondsId: FONDS_ID, nummer: "1200", bezeichnung: "Bank", art: "aktiv", beteiligungId: null }, { id: "k2", fondsId: FONDS_ID, nummer: "0100", bezeichnung: "Anteile Alpha", art: "aktiv", beteiligungId: "b1" }] } },
    [pfad("gliederung")]: {
      koerper: { daten: [gliederungZeile("aktiva", null, "Aktiva", "Assets", 10), gliederungZeile("aktiva.liquide", "aktiva", "Liquide Mittel", "Cash", 20), gliederungZeile("aktiva.beteiligungen", "aktiva", "Beteiligungen", "Holdings", 30)] },
    },
    [pfad("kontenregeln")]: { koerper: { daten: [] } },
    [pfad("belegvorlagen")]: { koerper: { daten: [] } },
  };

  it("Sachkonten: anlegen und ändern (mit Beteiligung), entfernen nach Rückfrage, Serverfehler sichtbar", async () => {
    const api = spieleApi({
      ...basis,
      [`PUT ${pfad("konten")}`]: { koerper: { daten: [] } },
      [`DELETE ${pfad("konten/1200")}`]: fehler(409, "KONTO_IN_VERWENDUNG", { nummer: "1200" }),
      [`DELETE ${pfad("konten/0100")}`]: { status: 204, koerper: null },
    });
    rendereApp(buchhaltungUrl("einstellungen", "konten"));
    const nutzer = userEvent.setup();
    const karte = within(await screen.findByRole("region", { name: "Sachkonten des Fonds" }));
    await nutzer.click(karte.getByRole("button", { name: "Konto anlegen" }));
    fireEvent.change(karte.getByLabelText("Nummer"), { target: { value: "1300" } });
    fireEvent.change(karte.getByLabelText("Bezeichnung"), { target: { value: "Forderungen" } });
    await nutzer.selectOptions(karte.getByLabelText("Beteiligung"), "Alpha Energie");
    await nutzer.click(karte.getByRole("button", { name: "Konto speichern" }));
    await waitFor(() => expect(api.anfragen("PUT", pfad("konten"))).toHaveLength(1));
    expect(api.anfragen("PUT", pfad("konten"))[0]!.koerper).toEqual({ konten: [{ nummer: "1300", bezeichnung: "Forderungen", art: "aktiv", beteiligungId: expect.any(String) }] });
    // ändern: Die Nummer bleibt fest.
    await nutzer.click(karte.getByRole("button", { name: "Konto 1200 bearbeiten" }));
    expect((karte.getByLabelText("Nummer") as HTMLInputElement).disabled).toBe(true);
    fireEvent.change(karte.getByLabelText("Bezeichnung"), { target: { value: "Bank Hauptkonto" } });
    await nutzer.selectOptions(karte.getByLabelText("Art"), "passiv");
    await nutzer.click(karte.getByRole("button", { name: "Konto speichern" }));
    await waitFor(() => expect(api.anfragen("PUT", pfad("konten"))).toHaveLength(2));
    expect(api.anfragen("PUT", pfad("konten"))[1]!.koerper).toEqual({ konten: [{ nummer: "1200", bezeichnung: "Bank Hauptkonto", art: "passiv", beteiligungId: null }] });
    // entfernen: erst die Rückfrage, dann der Aufruf; der Serverfehler wird gezeigt
    await nutzer.click(karte.getByRole("button", { name: "Konto 1200 entfernen" }));
    expect(api.anfragen("DELETE", pfad("konten/1200"))).toHaveLength(0);
    await nutzer.click(karte.getByRole("button", { name: "Ja, Konto 1200 entfernen" }));
    expect(await karte.findByText(/lässt sich nicht löschen/)).toBeTruthy();
    // ein freies Konto lässt sich entfernen
    await nutzer.click(karte.getByRole("button", { name: "Konto 0100 entfernen" }));
    await nutzer.click(karte.getByRole("button", { name: "Ja, Konto 0100 entfernen" }));
    await waitFor(() => expect(api.anfragen("DELETE", pfad("konten/0100"))).toHaveLength(1));
    expect(await karte.findByText("Konto entfernt.")).toBeTruthy();
  });

  it("ohne Rolle Verwalter: nur Ansicht bei Sachkonten, Gliederung und Kontenzuordnung", async () => {
    spieleApi({ ...basis, "/api/v1/ich": alsRolle("bearbeiter") });
    rendereApp(buchhaltungUrl("einstellungen", "konten"));
    const karte = within(await screen.findByRole("region", { name: "Sachkonten des Fonds" }));
    expect(karte.getByText("Anteile Alpha")).toBeTruthy();
    expect(karte.queryByRole("button", { name: "Konto anlegen" })).toBeNull();
    expect(karte.queryByRole("button", { name: /bearbeiten/ })).toBeNull();
    expect(screen.queryByRole("region", { name: "Gliederung bearbeiten" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Zuordnung speichern/ })).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "Buchungsregeln" }));
    expect((await screen.findByLabelText("Konto: Zinsen")).matches(":disabled")).toBe(true);
  });

  it("Gliederung: Unterposition anlegen, umbenennen, verschieben, entfernen und speichern; Serverfehler sichtbar", async () => {
    const api = spieleApi({
      ...basis,
      [`PUT ${pfad("gliederung/bilanz")}`]: fehler(409, "GLIEDERUNG_POSITION_IN_VERWENDUNG", { positionen: ["aktiva.beteiligungen"] }),
    });
    rendereApp(buchhaltungUrl("einstellungen", "konten"));
    const nutzer = userEvent.setup();
    const editor = within(await screen.findByRole("region", { name: "Gliederung bearbeiten" }));
    expect(await editor.findByText("Liquide Mittel")).toBeTruthy();
    // Unterposition zu Aktiva: Das Schlüsselformat wird vor dem Übernehmen geprüft.
    await nutzer.click(editor.getByRole("button", { name: "Unterposition zu Aktiva hinzufügen" }));
    fireEvent.change(editor.getByLabelText("Schlüssel der Position"), { target: { value: "Aktiva Neu" } });
    fireEvent.change(editor.getByLabelText("Bezeichnung (Deutsch)"), { target: { value: "Forderungen" } });
    fireEvent.change(editor.getByLabelText("Bezeichnung (Englisch)"), { target: { value: "Receivables" } });
    await nutzer.click(editor.getByRole("button", { name: "Position übernehmen" }));
    expect(await editor.findByText(/besteht aus Kleinbuchstaben/)).toBeTruthy();
    fireEvent.change(editor.getByLabelText("Schlüssel der Position"), { target: { value: "aktiva.forderungen" } });
    await nutzer.click(editor.getByRole("button", { name: "Position übernehmen" }));
    expect(editor.getByText("Forderungen")).toBeTruthy();
    expect(editor.getByText("Es gibt ungespeicherte Änderungen.")).toBeTruthy();
    // umbenennen: Der Schlüssel bleibt fest.
    await nutzer.click(editor.getByRole("button", { name: "Position bearbeiten: Beteiligungen" }));
    expect((editor.getByLabelText("Schlüssel der Position") as HTMLInputElement).disabled).toBe(true);
    fireEvent.change(editor.getByLabelText("Bezeichnung (Deutsch)"), { target: { value: "Finanzanlagen" } });
    await nutzer.click(editor.getByRole("button", { name: "Position übernehmen" }));
    // verschieben: Forderungen steht hinter Beteiligungen und rückt zweimal nach oben
    await nutzer.click(editor.getByRole("button", { name: "Position nach oben: Forderungen" }));
    await nutzer.click(editor.getByRole("button", { name: "Position nach oben: Forderungen" }));
    // eine Position mit Unterpositionen lässt sich nicht entfernen, eine ohne schon
    expect((editor.getByRole("button", { name: "Position entfernen: Aktiva" }) as HTMLButtonElement).disabled).toBe(true);
    await nutzer.click(editor.getByRole("button", { name: "Position entfernen: Liquide Mittel" }));
    expect(editor.queryByText("Liquide Mittel")).toBeNull();
    await nutzer.click(editor.getByRole("button", { name: "Gliederung speichern" }));
    expect(await editor.findByText(/Eine Kontenregel verweist auf eine Position/)).toBeTruthy();
    expect(api.anfragen("PUT", pfad("gliederung/bilanz"))[0]!.koerper).toEqual({
      positionen: [
        { schluessel: "aktiva", elternSchluessel: null, bezeichnungDe: "Aktiva", bezeichnungEn: "Assets", seite: "soll" },
        { schluessel: "aktiva.forderungen", elternSchluessel: "aktiva", bezeichnungDe: "Forderungen", bezeichnungEn: "Receivables", seite: "soll" },
        { schluessel: "aktiva.beteiligungen", elternSchluessel: "aktiva", bezeichnungDe: "Finanzanlagen", bezeichnungEn: "Holdings", seite: "soll" },
      ],
    });
    // Verwerfen stellt den gespeicherten Stand wieder her.
    await nutzer.click(editor.getByRole("button", { name: "Änderungen verwerfen" }));
    expect(editor.getByText("Liquide Mittel")).toBeTruthy();
    expect(editor.queryByText("Forderungen")).toBeNull();
  });

  it("Buchungsregeln: je Quelle speichern, auch für Kapitalabruf und Ausschüttung; Feldfehler am Feld", async () => {
    const regel = { id: "br1", fondsId: FONDS_ID, quelle: "zins", konto: "1200", gegenkonto: "8000", richtung: "S", buSchluessel: null, buchungstext: "Zins {organisation}", geaendertVon: "x", geaendertAm: "2026-11-20T09:00:00.000Z" };
    const api = spieleApi({
      ...basis,
      [pfad("buchungsregeln")]: { koerper: { daten: [regel] } },
      [`PUT ${pfad("buchungsregeln/abruf")}`]: { koerper: { ...regel, quelle: "abruf" } },
      [`PUT ${pfad("buchungsregeln/zins")}`]: fehler(400, "EINGABE_UNGUELTIG", { felder: [{ feld: "konto", code: "invalid_format", meldung: "x" }] }),
    });
    rendereApp(buchhaltungUrl("einstellungen", "regeln"));
    const nutzer = userEvent.setup();
    const karte = within(await screen.findByRole("region", { name: "Kontenzuordnung des Exports" }));
    expect((karte.getByLabelText("Konto: Zinsen") as HTMLInputElement).value).toBe("1200");
    expect(karte.getByText("Kapitalabruf (noch nicht eingerichtet)")).toBeTruthy();
    expect(karte.getByText("Ausschüttung (noch nicht eingerichtet)")).toBeTruthy();
    fireEvent.change(karte.getByLabelText("Konto: Kapitalabruf"), { target: { value: "1200" } });
    fireEvent.change(karte.getByLabelText("Gegenkonto: Kapitalabruf"), { target: { value: "9000" } });
    await nutzer.selectOptions(karte.getByLabelText("Konto auf der Seite: Kapitalabruf"), "H");
    fireEvent.change(karte.getByLabelText("BU-Schlüssel (leer = keiner): Kapitalabruf"), { target: { value: "9" } });
    fireEvent.change(karte.getByLabelText("Buchungstext: Kapitalabruf"), { target: { value: "Abruf {valuta}" } });
    await nutzer.click(karte.getByRole("button", { name: "Zuordnung speichern: Kapitalabruf" }));
    await waitFor(() => expect(api.anfragen("PUT", pfad("buchungsregeln/abruf"))).toHaveLength(1));
    expect(api.anfragen("PUT", pfad("buchungsregeln/abruf"))[0]!.koerper).toEqual({ konto: "1200", gegenkonto: "9000", richtung: "H", buSchluessel: "9", buchungstext: "Abruf {valuta}" });
    await nutzer.click(karte.getByRole("button", { name: "Zuordnung speichern: Zinsen" }));
    expect(await karte.findByText(/Das Format passt nicht/)).toBeTruthy();
  });

  it("Export: Fondsbewegungen auswählen; Vorschau und Export senden die Bewegungen", async () => {
    const zeile = { vorgangId: null, fondsBewegungId: "x", organisation: "Fonds", art: "abruf", valuta: "2026-03-15", betrag: "250000.00", konto: "1200", gegenkonto: "9000", richtung: "S", belegfeld: "FND-1", buchungstext: "Abruf", mitBeleg: false, bereitsExportiert: false };
    const api = spieleApi({
      "/api/v1/zinslaeufe": { koerper: { daten: [] } },
      [pfad("buchungsexporte")]: { koerper: { daten: [] } },
      [`POST ${pfad("buchungsexport/vorschau")}`]: { koerper: { format: "EXTF", datumVon: "2026-03-15", datumBis: "2026-03-15", zeilen: [zeile], anzahl: 1, probleme: [], ohneBeleg: ["x"] } },
      [`POST ${pfad("buchungsexport")}`]: { status: 201, koerper: { id: "ex1" } },
    });
    rendereApp(buchhaltungUrl("export"));
    const nutzer = userEvent.setup();
    await nutzer.selectOptions(await screen.findByLabelText("Was exportiert wird"), "bewegungen");
    expect((screen.getByRole("button", { name: "Vorschau" }) as HTMLButtonElement).disabled).toBe(true);
    const gruppe = within(screen.getByRole("group", { name: "Fondsbewegungen (Kapitalabruf, Ausschüttung)" }));
    expect(gruppe.getAllByRole("checkbox")).toHaveLength(2);
    await nutzer.click(gruppe.getByRole("checkbox", { name: /^Kapitalabruf, / }));
    await nutzer.click(screen.getByRole("button", { name: "Vorschau" }));
    await waitFor(() => expect(api.anfragen("POST", pfad("buchungsexport/vorschau"))).toHaveLength(1));
    expect(api.anfragen("POST", pfad("buchungsexport/vorschau"))[0]!.koerper).toEqual({ fondsBewegungIds: [expect.any(String)], wiederholung: false });
    expect(await screen.findByText("FND-1")).toBeTruthy();
    await nutzer.click(screen.getByRole("button", { name: "Exportieren" }));
    await waitFor(() => expect(api.anfragen("POST", pfad("buchungsexport"))).toHaveLength(1));
    expect(api.anfragen("POST", pfad("buchungsexport"))[0]!.koerper).toEqual({ fondsBewegungIds: [expect.any(String)], wiederholung: false });
  });
});
