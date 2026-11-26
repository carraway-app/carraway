import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { alsRolle, fehler, ORG_A, rendereApp, spieleApi } from "../test/hilfen";
import { de } from "../i18n/de";

/** Register über alle Unternehmen (Etappe 18): Meldungen, Datei-Import, Suche. Alle Daten sind erfunden. */

const meldung = (id: string, text: string, gelesenAm: string | null = null) => ({
  id,
  organisationId: ORG_A,
  ereignisId: null,
  art: "ereignis",
  text,
  erstelltAm: "2026-11-18T08:00:00.000Z",
  gelesenAm,
  gelesenVon: gelesenAm ? "x" : null,
  organisation: "Alpha Energie GmbH",
});

const statusOhne = { anbieterEingerichtet: false, anbieter: null };
const statusMit = { anbieterEingerichtet: true, anbieter: "test" };
const basis = (zusatz: Record<string, unknown> = {}) => spieleApi({ "/api/v1/register/meldungen": { koerper: { daten: [] } }, "/api/v1/register/status": { koerper: statusOhne }, ...zusatz });

afterEach(() => localStorage.removeItem("carraway.sprache"));

describe("Register: Übersicht", () => {
  it("ist in der Navigation, zeigt ungelesene Meldungen und markiert eine als gelesen", async () => {
    const api = basis({
      "/api/v1/register/meldungen": { koerper: { daten: [meldung("m1", "Insolvenzverfahren eröffnet (Beispiel).")] } },
      "POST /api/v1/register/meldungen/m1/gelesen": { koerper: meldung("m1", "Insolvenzverfahren eröffnet (Beispiel).", "2026-11-20T09:00:00.000Z") },
    });
    rendereApp("/register");
    const nutzer = userEvent.setup();
    expect(await screen.findByRole("heading", { level: 1, name: de.register.uebersicht.titel })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Register" })).toBeTruthy();
    const karte = within(await screen.findByRole("region", { name: "Meldungen aus dem Register" }));
    expect(await karte.findByText("Insolvenzverfahren eröffnet (Beispiel).")).toBeTruthy();
    expect(karte.getByRole("link", { name: "Alpha Energie GmbH" })).toBeTruthy();
    // Standard: nur ungelesene
    expect(api.anfragen("GET", "/api/v1/register/meldungen")[0]!.query.get("ungelesen")).toBe("true");
    await nutzer.click(karte.getByRole("button", { name: "Als gelesen markieren: Insolvenzverfahren eröffnet (Beispiel)." }));
    await waitFor(() => expect(api.anfragen("POST", "/api/v1/register/meldungen/m1/gelesen")).toHaveLength(1));
    // Alle Meldungen: ohne Filter
    await nutzer.click(karte.getByLabelText("Nur ungelesene"));
    await waitFor(() => expect(api.anfragen("GET", "/api/v1/register/meldungen").some((a) => a.query.get("ungelesen") === null)).toBe(true));
  });

  it("zeigt eine leere Liste und gelesene Meldungen ohne Knopf", async () => {
    basis({ "/api/v1/register/meldungen": { koerper: { daten: [meldung("m2", "Neuer Registerstand.", "2026-11-19T09:00:00.000Z")] } } });
    rendereApp("/register");
    const karte = within(await screen.findByRole("region", { name: "Meldungen aus dem Register" }));
    expect(await karte.findByText("Neuer Registerstand.")).toBeTruthy();
    expect(karte.queryByRole("button", { name: /Als gelesen markieren/ })).toBeNull();
    expect(karte.getByText(/Gelesen am/)).toBeTruthy();
  });

  it("Datei: nur prüfen zählt ohne zu übernehmen, Importieren übernimmt, Fehler stehen mit Zeile und Feld da", async () => {
    const eingang = JSON.stringify({ eintraege: [{ organisationName: "Alpha Energie GmbH", eintrag: { gericht: "Amtsgericht Beispielstadt", registerart: "HRB", nummer: "HRB 99001", firma: "Alpha Energie GmbH", standDatum: "2026-09-30" } }] });
    const api = basis({
      "POST /api/v1/register/import": (a: { koerper?: unknown }) => ((a.koerper as { nurPruefen: boolean }).nurPruefen ? { koerper: { zeilen: 1, uebernommen: false } } : { koerper: { zeilen: 1, uebernommen: true, angelegt: 1, unveraendert: 0, ereignisse: 2 } }),
    });
    rendereApp("/register");
    const nutzer = userEvent.setup();
    await userEvent.setup().click(await screen.findByRole("tab", { name: "Sammelaktualisierung aus einer Datei" }));
    const karte = within(await screen.findByRole("region", { name: "Sammelaktualisierung aus einer Datei" }));
    // ohne Datei: lokale Meldung
    await nutzer.click(karte.getByRole("button", { name: "Nur prüfen" }));
    expect(await karte.findByText("Bitte zuerst eine Datei wählen.")).toBeTruthy();
    expect(api.anfragen("POST", "/api/v1/register/import")).toHaveLength(0);

    await nutzer.upload(karte.getByLabelText("Datei (JSON oder CSV)"), new File([eingang], "register.json", { type: "application/json" }));
    expect((karte.getByLabelText("Format") as HTMLSelectElement).value).toBe("json");
    await nutzer.click(karte.getByRole("button", { name: "Nur prüfen" }));
    expect(await karte.findByText("1 Zeile ist gültig. Es wurde nichts übernommen.")).toBeTruthy();
    expect(api.anfragen("POST", "/api/v1/register/import")[0]!.koerper).toEqual({ format: "json", inhalt: eingang, nurPruefen: true });
    await nutzer.click(karte.getByRole("button", { name: "Importieren" }));
    expect(await karte.findByText("1 Zeile verarbeitet: 1 neue Registerstände, 0 unverändert, 2 neue Bekanntmachungen.")).toBeTruthy();
    expect(api.anfragen("POST", "/api/v1/register/import")[1]!.koerper).toMatchObject({ nurPruefen: false });
  });

  it("Datei: eine CSV-Endung stellt das Format ein; Fehler der Datei erscheinen als Tabelle", async () => {
    basis({ "POST /api/v1/register/import": fehler(422, "register_import_invalid", { anzahlFehler: 2, zeilen: [{ zeile: 2, feld: "standDatum", meldung: "Kein gültiges Datum." }, { zeile: 3, feld: "organisationName", meldung: "Das Unternehmen gibt es nicht." }] }) });
    rendereApp("/register");
    const nutzer = userEvent.setup();
    await userEvent.setup().click(await screen.findByRole("tab", { name: "Sammelaktualisierung aus einer Datei" }));
    const karte = within(await screen.findByRole("region", { name: "Sammelaktualisierung aus einer Datei" }));
    await nutzer.upload(karte.getByLabelText("Datei (JSON oder CSV)"), new File(["organisationName;gericht\nAlpha;AG"], "register.csv", { type: "text/csv" }));
    expect((karte.getByLabelText("Format") as HTMLSelectElement).value).toBe("csv");
    await nutzer.click(karte.getByRole("button", { name: "Importieren" }));
    const tabelle = within(await karte.findByRole("region", { name: "2 Fehler in der Datei" }));
    expect(tabelle.getByText("Kein gültiges Datum.")).toBeTruthy();
    expect(tabelle.getByText("organisationName")).toBeTruthy();
    expect(await karte.findByText(de.fehler.register_import_invalid)).toBeTruthy();
  });

  it("Suche: ohne Anbieter steht „kein Anbieter eingerichtet“", async () => {
    basis();
    rendereApp("/register");
    await userEvent.setup().click(await screen.findByRole("tab", { name: "Suche beim Anbieter" }));
    const karte = within(await screen.findByRole("region", { name: "Suche beim Anbieter" }));
    expect(await karte.findByText(/Es ist kein Anbieter eingerichtet/)).toBeTruthy();
    expect(karte.queryByRole("button", { name: "Suchen" })).toBeNull();
  });

  it("Suche: mit Anbieter wird nach Firma gesucht und die Trefferliste gezeigt; englisch", async () => {
    localStorage.setItem("carraway.sprache", "en");
    const api = basis({
      "/api/v1/register/status": { koerper: statusMit },
      "/api/v1/register/suche": { koerper: { daten: [{ gericht: "Amtsgericht Beispielstadt", registerart: "HRB", nummer: "HRB 99001", firma: "Alpha Energie GmbH", sitz: "Beispielstadt", rechtsform: "GmbH" }] } },
    });
    rendereApp("/register");
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("tab", { name: "Search at the provider" }));
    const karte = within(await screen.findByRole("region", { name: "Search at the provider" }));
    await nutzer.click(await karte.findByRole("button", { name: "Search" }));
    expect(await karte.findByText("Please enter a company name or register number.")).toBeTruthy();
    expect(api.anfragen("GET", "/api/v1/register/suche")).toHaveLength(0);
    await nutzer.type(karte.getByLabelText("Company name"), "Alpha");
    await nutzer.click(karte.getByRole("button", { name: "Search" }));
    expect(await karte.findByText("Amtsgericht Beispielstadt, HRB HRB 99001")).toBeTruthy();
    expect(api.anfragen("GET", "/api/v1/register/suche")[0]!.query.get("firma")).toBe("Alpha");
    expect(karte.getByText("Configured provider: test")).toBeTruthy();
  });

  it("Datei einlesen darf nur, wer irgendwo Bearbeiter ist", async () => {
    basis({ "/api/v1/me": alsRolle("betrachter") });
    rendereApp("/register");
    await userEvent.setup().click(await screen.findByRole("tab", { name: "Sammelaktualisierung aus einer Datei" }));
    const karte = within(await screen.findByRole("region", { name: "Sammelaktualisierung aus einer Datei" }));
    expect(await karte.findByText(/Bearbeiter/)).toBeTruthy();
    expect(karte.queryByRole("button", { name: "Importieren" })).toBeNull();
  });
});
