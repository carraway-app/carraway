import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ladeSeitentexte, SpracheProvider } from "../i18n";
import { de } from "../i18n/de";
import { erstelleQueryClient } from "../router";
import { spieleApi } from "../test/hilfen";
import { DealSuchfeld, PersonSuchfeld } from "./NeuAnlegenFelder";
import type { SuchfeldTreffer } from "./Suchfeld";

/** „Neu anlegen“ im Suchfeld für Personen und Deals (Issue #296) samt Vorschlägen für die Funktion. Alle Daten sind erfunden. */

const leer = { q: "x", organisationen: [], personen: [], deals: [], beteiligungen: [], dokumente: [] };

async function rendere(ziel: "person" | "deal", beiAbsenden: () => void) {
  // Wie der Wächter des Routers: Die Textbereiche der Seite stehen vor dem Zeichnen bereit (Seiten mit diesen Feldern gehören zu stamm und crm).
  await ladeSeitentexte("/contacts");
  function Seite() {
    const [wert, setWert] = useState<SuchfeldTreffer | null>(null);
    const Feld = ziel === "person" ? PersonSuchfeld : DealSuchfeld;
    return (
      <form onSubmit={(e) => { e.preventDefault(); beiAbsenden(); }}>
        <Feld label="Verknüpfung" wert={wert} onWahl={setWert} />
      </form>
    );
  }
  const queryClient = erstelleQueryClient({ wiederholen: false });
  const router = createRouter({ routeTree: createRootRoute({ component: Seite }), history: createMemoryHistory({ initialEntries: ["/"] }) });
  return render(
    <QueryClientProvider client={queryClient}>
      <SpracheProvider>
        <RouterProvider router={router} />
      </SpracheProvider>
    </QueryClientProvider>,
  );
}

describe("Neu anlegen im Suchfeld", () => {
  it("legt eine Person vorbefüllt an, schlägt die Funktion vor und übernimmt sie ins Feld, ohne das Formular abzusenden", async () => {
    const api = spieleApi({
      "/api/v1/suche": { koerper: leer },
      "/api/v1/personen/values": { koerper: { daten: [{ wert: "Geschäftsführerin", anzahl: 4 }, { wert: "Geschäftsführer", anzahl: 2 }] } },
      "POST /api/v1/personen": { status: 201, koerper: { id: "np1", vorname: "Erika", nachname: "Neu", email: null, funktion: "Geschäftsführerin" } },
    });
    const abgesendet = vi.fn();
    await rendere("person", abgesendet);
    const nutzer = userEvent.setup();
    const feld = await screen.findByRole("combobox", { name: "Verknüpfung" });
    await nutzer.type(feld, "Erika Neu");
    await nutzer.click(await screen.findByRole("option", { name: de.auswahl.anlegen("Erika Neu") }));

    const dialog = within(await screen.findByRole("dialog", { name: de.personForm.titelNeu }));
    expect((dialog.getByLabelText(de.personForm.vorname) as HTMLInputElement).value).toBe("Erika");
    expect((dialog.getByLabelText(de.personForm.nachname) as HTMLInputElement).value).toBe("Neu");
    const funktion = dialog.getByRole("combobox", { name: de.personForm.funktion });
    await nutzer.type(funktion, "Gesch");
    await nutzer.click(await dialog.findByRole("option", { name: /^Geschäftsführerin/ }));
    expect((funktion as HTMLInputElement).value).toBe("Geschäftsführerin");
    await nutzer.click(dialog.getByRole("button", { name: de.personForm.anlegen }));

    await waitFor(() => expect(api.anfragen("POST", "/api/v1/personen")).toHaveLength(1));
    expect(api.anfragen("POST", "/api/v1/personen")[0]!.koerper).toMatchObject({ vorname: "Erika", nachname: "Neu", funktion: "Geschäftsführerin" });
    expect(await screen.findByText(de.auswahl.gewaehlt(`Erika Neu · ${de.suche.ohneOrganisation}`))).toBeTruthy();
    expect((screen.getByRole("combobox", { name: "Verknüpfung" }) as HTMLInputElement).value).toBe("Erika Neu");
    expect(screen.queryByRole("dialog")).toBeNull();
    // Das Absenden im Dialog hat das Formular dahinter nicht ausgelöst.
    expect(abgesendet).not.toHaveBeenCalled();
  });

  it("legt einen Deal mit vorbefülltem Titel an und übernimmt ihn ins Feld", async () => {
    const api = spieleApi({
      "/api/v1/suche": { koerper: leer },
      "/api/v1/organisationen/values": { koerper: { daten: [] } },
      "/api/v1/organisationen/dubletten": { koerper: { daten: [] } },
      "POST /api/v1/deals": {
        status: 201,
        koerper: { id: "nd1", titel: "Projekt Neu", phase: "sourcing", status: "offen", organisation: { id: "no1", name: "Neu GmbH" } },
      },
    });
    const abgesendet = vi.fn();
    await rendere("deal", abgesendet);
    const nutzer = userEvent.setup();
    const feld = await screen.findByRole("combobox", { name: "Verknüpfung" });
    await nutzer.type(feld, "Projekt Neu");
    await nutzer.click(await screen.findByRole("option", { name: de.auswahl.anlegen("Projekt Neu") }));

    const dialog = within(await screen.findByRole("dialog", { name: de.neuerDeal.titel }));
    expect((dialog.getByLabelText(de.neuerDeal.dealTitel) as HTMLInputElement).value).toBe("Projekt Neu");
    await nutzer.click(dialog.getByRole("button", { name: de.neuerDeal.neu }));
    await nutzer.type(dialog.getByLabelText(de.neuerDeal.orgName), "Neu GmbH");
    await nutzer.click(dialog.getByRole("button", { name: de.neuerDeal.anlegen }));

    await waitFor(() => expect(api.anfragen("POST", "/api/v1/deals")).toHaveLength(1));
    expect(await screen.findByText(de.auswahl.gewaehlt("Projekt Neu · Neu GmbH"))).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(abgesendet).not.toHaveBeenCalled();
  });
});
