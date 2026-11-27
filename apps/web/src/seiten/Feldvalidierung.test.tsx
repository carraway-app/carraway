import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { feldpruefungTexte } from "../i18n/feldpruefung";
import { BET_ID, INSTR_ID, rendereApp, spieleApi, waehleAktion } from "../test/hilfen";

const url = `/investments/${BET_ID}`;
const instrumenteUrl = `${url}?tab=financing&subtab=instruments`;
const dialog = () => within(screen.getByRole("dialog"));

describe("Prüfung direkt am Feld: Vorgang erfassen", () => {
  it("prüft den Betrag beim Tippen, sendet nichts Ungültiges und liest die deutsche Schreibweise", async () => {
    const pfad = `POST /api/v1/investments/${BET_ID}/transactions`;
    const api = spieleApi({ [pfad]: { status: 201, koerper: { vorgang: {}, buchwert: "1062000.00" } } });
    rendereApp(url);
    const nutzer = userEvent.setup();
    await waehleAktion(nutzer, "Vorgang erfassen");
    await screen.findByRole("dialog");
    const betrag = dialog().getByLabelText("Betrag in Euro");

    await nutzer.type(betrag, "-5");
    expect(dialog().getByText(feldpruefungTexte.de.negativ)).toBeTruthy();
    await nutzer.clear(betrag);
    await nutzer.type(betrag, "0");
    await nutzer.tab();
    expect(dialog().getByText(feldpruefungTexte.de.positivNoetig)).toBeTruthy();
    await nutzer.clear(betrag);
    await nutzer.type(betrag, "12,345");
    expect(dialog().getByText(feldpruefungTexte.de.nachkomma(2))).toBeTruthy();

    await nutzer.click(dialog().getByRole("button", { name: "Vorgang buchen" }));
    expect(api.anfragen("POST", pfad.replace("POST ", ""))).toHaveLength(0);

    await nutzer.clear(betrag);
    await nutzer.type(betrag, "1.250,50");
    expect(betrag.getAttribute("aria-invalid")).toBeNull();
    await nutzer.click(dialog().getByRole("button", { name: "Vorgang buchen" }));
    await dialog().findByText(/Der Buchwert beträgt jetzt/);
    expect(api.anfragen("POST", pfad.replace("POST ", ""))[0]!.koerper).toMatchObject({ amount: "1250.50" });
  });

  it("meldet ein leeres Pflichtfeld erst beim Verlassen und ein ungültiges Datum sofort", async () => {
    spieleApi();
    rendereApp(url);
    const nutzer = userEvent.setup();
    await waehleAktion(nutzer, "Vorgang erfassen");
    await screen.findByRole("dialog");
    expect(dialog().queryByText(feldpruefungTexte.de.pflicht)).toBeNull();
    await nutzer.click(dialog().getByLabelText("Betrag in Euro"));
    await nutzer.tab();
    expect(dialog().getByText(feldpruefungTexte.de.pflicht)).toBeTruthy();
  });
});

describe("Prüfung direkt am Feld: Konditionen", () => {
  it("hält Prozentsätze im Bereich 0 bis 100 und sendet erst nach der Korrektur", async () => {
    const pfad = `/api/v1/beteiligungen/${BET_ID}/konditionen`;
    const api = spieleApi({ [`POST ${pfad}`]: { status: 201, koerper: {} } });
    rendereApp(instrumenteUrl);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Konditionen: Wandeldarlehen 2021" }));
    const satz = dialog().getByLabelText("Fester Zins");
    await nutzer.clear(satz);
    await nutzer.type(satz, "150");
    expect(dialog().getByText(feldpruefungTexte.de.bereich(0, 100))).toBeTruthy();
    await nutzer.click(dialog().getByRole("button", { name: "Konditionen speichern" }));
    expect(api.anfragen("POST", pfad)).toHaveLength(0);
    await nutzer.clear(satz);
    await nutzer.type(satz, "7,25");
    expect(dialog().queryByText(feldpruefungTexte.de.bereich(0, 100))).toBeNull();
    await nutzer.click(dialog().getByRole("button", { name: "Konditionen speichern" }));
    await screen.findByRole("heading", { level: 1 });
    expect(api.anfragen("POST", pfad)[0]!.koerper).toMatchObject({ satzFix: "0.0725", instrumentId: INSTR_ID });
  });
});
