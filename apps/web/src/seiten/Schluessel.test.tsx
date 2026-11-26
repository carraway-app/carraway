import { fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { alsRolle, BET_ID, fehler, ORG_A, rendereApp, spieleApi, letzteRegion } from "../test/hilfen";

const url = `/beteiligungen/${BET_ID}?tab=foerderung`;
const SCHLUESSEL = `/api/v1/beteiligungen/${BET_ID}/buchhaltungsschluessel`;
const MELDEDATEN = `/api/v1/organisationen/${ORG_A}/meldedaten`;
const schmal = (text: string | null) => (text ?? "").replace(/\s+/g, " ");
const gefuellt = {
  beteiligungId: BET_ID,
  projektnummer: "P-100",
  vertragsnummer: "V-7",
  partnernummer: null,
  buchungskreis: "BK1",
  foerderprogramm: "demo_wachstum",
  foerderprogrammBezeichnung: "Beispielprogramm Wachstum",
  geaendertVon: "demo",
  geaendertAm: "2026-09-01T10:00:00.000Z",
  organisationId: ORG_A,
  sitzland: "DE",
  region: "Bayern",
};

describe("Förderung und Buchhaltung an der Beteiligung", () => {
  it("zeigt die Schlüssel an einer Stelle und speichert sie; Sitzland und Region stehen nur zur Ansicht da, mit Verweis auf die Organisation", async () => {
    const nutzer = userEvent.setup();
    const api = spieleApi({ [SCHLUESSEL]: { koerper: gefuellt }, [`PUT ${SCHLUESSEL}`]: { koerper: gefuellt } });
    rendereApp(url);

    const abschnitt = within(await letzteRegion("Förderung und Buchhaltung"));
    expect((await abschnitt.findByLabelText("Projektnummer") as HTMLInputElement).value).toBe("P-100");
    expect((abschnitt.getByLabelText("Buchungskreis") as HTMLInputElement).value).toBe("BK1");
    expect((abschnitt.getByLabelText("Partnernummer") as HTMLInputElement).value).toBe("");
    expect((abschnitt.getByLabelText("Förderprogramm") as HTMLSelectElement).value).toBe("demo_wachstum");
    // Sitzland und Region: Stammdaten der Organisation, hier nur zur Ansicht (kein Eingabefeld) mit Verweis.
    expect(abschnitt.queryByLabelText(/Sitzland/)).toBeNull();
    expect(abschnitt.queryByLabelText(/Region/)).toBeNull();
    expect(schmal(abschnitt.getByText(/Stammdaten des Unternehmens/).textContent)).toContain("Sitzland DE, Region Bayern");
    expect(abschnitt.getByRole("link", { name: "Sitzland und Region bei der Organisation ändern" }).getAttribute("href")).toBe(`/organisationen/${ORG_A}`);

    fireEvent.change(abschnitt.getByLabelText("Partnernummer"), { target: { value: "PN-3" } });
    fireEvent.change(abschnitt.getByLabelText("Förderprogramm"), { target: { value: "" } });
    await nutzer.click(abschnitt.getByRole("button", { name: "Schlüssel speichern" }));

    await waitFor(() => expect(api.anfragen("PUT", SCHLUESSEL)).toHaveLength(1));
    expect(api.anfragen("PUT", SCHLUESSEL)[0]!.koerper).toEqual({ foerderprogramm: null, projektnummer: "P-100", vertragsnummer: "V-7", partnernummer: "PN-3", buchungskreis: "BK1" });
    expect(api.anfragen("PUT", MELDEDATEN)).toHaveLength(0); // Meldedaten ändert nur die Organisation
    expect(await abschnitt.findByText("Die Schlüssel sind gespeichert.")).toBeTruthy();
  });

  it("zeigt Fehler am Feld und sendet nie Meldedaten", async () => {
    const nutzer = userEvent.setup();
    const api = spieleApi({ [SCHLUESSEL]: { koerper: gefuellt }, [`PUT ${SCHLUESSEL}`]: fehler(404, "FOERDERPROGRAMM_NICHT_GEFUNDEN") });
    rendereApp(url);
    const abschnitt = within(await letzteRegion("Förderung und Buchhaltung"));
    await abschnitt.findByDisplayValue("P-100");
    await nutzer.click(abschnitt.getByRole("button", { name: "Schlüssel speichern" }));
    expect(await abschnitt.findByText("Das Förderprogramm gibt es nicht.")).toBeTruthy();
    expect(api.anfragen("PUT", MELDEDATEN)).toHaveLength(0);
  });

  it("zeigt Betrachtern die Werte, aber ohne Speichern", async () => {
    spieleApi({ "/api/v1/ich": alsRolle("betrachter"), [SCHLUESSEL]: { koerper: gefuellt } });
    rendereApp(url);
    const abschnitt = within(await letzteRegion("Förderung und Buchhaltung"));
    expect((await abschnitt.findByLabelText("Projektnummer")).matches(":disabled")).toBe(true);
    expect(abschnitt.queryByRole("button", { name: "Schlüssel speichern" })).toBeNull();
    expect(abschnitt.getByText(/nur Leserechte/)).toBeTruthy();
  });
});
