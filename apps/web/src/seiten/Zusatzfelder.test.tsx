import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { BET_ID, FONDS_ID, rendereApp, spieleApi } from "../test/hilfen";

const wahlOptionen = { optionen: [{ schluessel: "niedrig", label: "Niedrig", farbe: "blau" }, { schluessel: "hoch", label: "Hoch", farbe: "rose" }] };
const antwort = (objekt: string, id: string, werte: Record<string, unknown> = {}) => ({
  objekt,
  id,
  stand: null,
  werte,
  bezuege: {},
  felder: [
    { id: "f-sicherheit", schluessel: "sicherheit", name: "Sicherheit", typ: "text", optionen: {}, position: 0, version: 1, archiviert: false, wert: (werte["f-sicherheit"] as string | undefined) ?? null },
    { id: "f-risiko", schluessel: "risiko", name: "Risikoklasse", typ: "auswahl", optionen: wahlOptionen, position: 1, version: 1, archiviert: false, wert: (werte["f-risiko"] as string | undefined) ?? null },
  ],
});

describe("Eigene Felder an Beteiligung, Instrument und Fonds", () => {
  it("zeigt die Felder im Bereich „Zusatzfelder“ der Beteiligung, getrennt nach Beteiligung und Instrument, und setzt einen Wert", async () => {
    const api = spieleApi({
      [`/api/v1/beteiligungen/${BET_ID}/felder`]: { koerper: antwort("beteiligung", BET_ID) },
      [`/api/v1/beteiligungen/${BET_ID}/instrumentfelder`]: { koerper: antwort("instrument", BET_ID, { "f-sicherheit": "Erstrangig" }) },
      [`PUT /api/v1/beteiligungen/${BET_ID}/felder`]: { koerper: antwort("beteiligung", BET_ID, { "f-risiko": "hoch" }) },
    });
    rendereApp(`/investments/${BET_ID}?tab=fields`);
    const nutzer = userEvent.setup();
    // Alte Adresse ?tab=fields führt zu den Stammdaten; die Felder stehen dort als Abschnitt mit Sprungmarke.
    expect(await screen.findByRole("link", { name: "Zusatzfelder Beteiligung" })).toBeTruthy();
    const beteiligung = within(await screen.findByRole("region", { name: "Zusatzfelder Beteiligung" }));
    expect(await beteiligung.findByText("Risikoklasse")).toBeTruthy();
    await nutzer.click(beteiligung.getByRole("button", { name: "Wert bearbeiten: Risikoklasse" }));
    await nutzer.selectOptions(beteiligung.getByLabelText("Risikoklasse"), "Hoch");
    await waitFor(() => expect(api.anfragen("PUT", `/api/v1/beteiligungen/${BET_ID}/felder`)).toHaveLength(1));
    expect(api.anfragen("PUT", `/api/v1/beteiligungen/${BET_ID}/felder`)[0]!.koerper).toEqual({ werte: { "f-risiko": "hoch" } });

    // Instrument: eigener Eintrag mit eigenen Werten
    expect(await within(await screen.findByRole("region", { name: "Zusatzfelder Instrument" })).findByText("Erstrangig")).toBeTruthy();
  });

  it("der Fonds hat einen Reiter „Felder“; mit Wissensstand ist alles nur lesbar und ein Hinweis erscheint", async () => {
    spieleApi({
      [`/api/v1/fonds/${FONDS_ID}/felder`]: { koerper: antwort("fonds", FONDS_ID, { "f-sicherheit": "Frühphase" }) },
    });
    rendereApp(`/funds?fundId=${FONDS_ID}&tab=fields&knowledgeDate=2026-10-01T00:00:00Z`);
    const bereich = await screen.findByRole("heading", { name: "Eigene Felder" });
    const kopf = bereich.closest("div")!.parentElement!;
    expect(await within(kopf).findByText("Frühphase")).toBeTruthy();
    expect(within(kopf).getByText(/früheren Wissensstand/)).toBeTruthy();
    expect(within(kopf).queryByRole("button", { name: /Wert bearbeiten/ })).toBeNull();
  });
});
