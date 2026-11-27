import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { de } from "../i18n/de";
import { FONDS_ID, rendereApp, spieleApi } from "../test/hilfen";

/** Suchfeld mit Vorschlägen (Issue #274): Tastatur, leere Treffer, Escape, Wertfeld mit exaktem Treffer. Alle Daten sind erfunden. */

const PFAD = `/api/v1/fonds/${FONDS_ID}/investorenzugaenge`;
const URL = `/funds?fundId=${FONDS_ID}&tab=investors`;
const v = de.verwaltung.investoren;
const z = v.fonds.zeichnungen;
const SICHT = {
  zeichnungskapital: "1000.00",
  waehrung: "EUR",
  abgedeckt: "0.00",
  vollstaendig: true,
  organisationen: [],
  erfassungMoeglich: true,
  closings: [],
  closingMoeglich: false,
  zeichnungen: [],
};
const leer = { q: "x", organisationen: [], personen: [], deals: [], dokumente: [] };

async function oeffneDialog() {
  const nutzer = userEvent.setup();
  rendereApp(URL);
  await nutzer.click(await screen.findByRole("button", { name: z.anlegen }));
  const dialog = within(screen.getByRole("dialog", { name: z.anlegen }));
  return { nutzer, dialog, feld: dialog.getByRole("combobox", { name: v.form.organisation }) as HTMLInputElement };
}

describe("Verknüpfungsfeld", () => {
  it("folgt dem Combobox-Muster: Hinweis unter zwei Zeichen, leere Treffer, Escape schließt nur die Liste", async () => {
    spieleApi({ [PFAD]: { koerper: SICHT }, "/api/v1/suche": { koerper: leer } });
    const { nutzer, dialog, feld } = await oeffneDialog();
    expect(feld.getAttribute("aria-autocomplete")).toBe("list");
    expect(feld.getAttribute("aria-expanded")).toBe("false");
    await nutzer.type(feld, "x");
    expect(await dialog.findByText(de.auswahl.hinweis)).toBeTruthy();
    await nutzer.type(feld, "yz");
    // Ohne Treffer bleibt nur der Eintrag „Neu anlegen“.
    const neu = await dialog.findByRole("option", { name: de.auswahl.anlegen("xyz") });
    expect(feld.getAttribute("aria-expanded")).toBe("true");
    expect(feld.getAttribute("aria-activedescendant")).toBe(neu.id);
    await nutzer.keyboard("{Escape}");
    expect(feld.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("dialog", { name: z.anlegen })).toBeTruthy();
  });

  it("wählt per Pfeiltasten und Enter und löst die Auswahl beim Weitertippen", async () => {
    const A = { id: "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1", name: "Anleger Eins AG", art: "investor", ort: "Köln" };
    const B = { id: "b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2", name: "Anleger Zwei AG", art: "investor", ort: null };
    spieleApi({ [PFAD]: { koerper: SICHT }, "/api/v1/suche": { koerper: { ...leer, organisationen: [A, B] } } });
    const { nutzer, dialog, feld } = await oeffneDialog();
    await nutzer.type(feld, "Anleger");
    await dialog.findByRole("option", { name: new RegExp(B.name) });
    await nutzer.keyboard("{ArrowDown}{Enter}");
    expect(feld.value).toBe(B.name);
    expect(dialog.getByText(de.auswahl.gewaehlt(`${B.name} · ${de.organisationArt.investor}`))).toBeTruthy();
    await nutzer.type(feld, "x");
    expect(dialog.queryByText(de.auswahl.gewaehlt(`${B.name} · ${de.organisationArt.investor}`))).toBeNull();
  });
});

describe("Wertfeld mit Vorschlägen", () => {
  it("schlägt erfasste Orte vor, hebt den exakten Treffer hervor und lässt freie Eingabe zu", async () => {
    spieleApi({
      [PFAD]: { koerper: SICHT },
      "/api/v1/suche": { koerper: leer },
      "/api/v1/organisationen/dubletten": { koerper: { daten: [] } },
      "/api/v1/organisationen/values": { koerper: { daten: [{ wert: "Berlin", anzahl: 3 }, { wert: "Bern", anzahl: 1 }] } },
    });
    const { nutzer, dialog, feld } = await oeffneDialog();
    await nutzer.type(feld, "Neu AG");
    await nutzer.click(await dialog.findByRole("option", { name: de.auswahl.anlegen("Neu AG") }));
    const anlage = within(await screen.findByRole("dialog", { name: de.organisationForm.titelNeu }));
    const ort = anlage.getByRole("combobox", { name: de.organisationForm.ort }) as HTMLInputElement;
    await nutzer.type(ort, "bern");
    const exakt = await anlage.findByRole("option", { name: new RegExp(`^Bern\\s*${de.auswahl.vorhanden}`) });
    expect(exakt.getAttribute("data-exakt")).toBe("true");
    // Der exakte Treffer steht oben; Enter übernimmt die erfasste Schreibweise.
    await nutzer.keyboard("{Enter}");
    expect(ort.value).toBe("Bern");
    await nutzer.clear(ort);
    await nutzer.type(ort, "Potsdam");
    expect(ort.value).toBe("Potsdam");
  });
});
