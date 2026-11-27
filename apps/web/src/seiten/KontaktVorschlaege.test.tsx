import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { alsRolle, rendereApp, spieleApi } from "../test/hilfen";
import { de } from "../i18n/de";

/** Kontakte aus Postfach und Kalender in der Oberfläche: Vorschlagsliste und eigene Teilnahme. Alle Daten sind erfunden. */

const k = de.mail.kontakte;
const vorschlag = { id: "00000000-0000-4000-8000-000000000701", adresse: "max@neu.example.com", name: "Max Neumann", bereiche: ["mail"], erstelltAm: "2026-11-20T08:00:00.000Z", unternehmen: { id: null, name: "Neu", neu: true } };

describe("Neue Kontakte aus Postfach und Kalender", () => {
  it("listet Vorschläge mit Unternehmen und übernimmt einen", async () => {
    const api = spieleApi({
      "/api/v1/me": alsRolle("bearbeiter"),
      "/api/v1/kontaktvorschlaege": { koerper: { modus: "vorschlag", daten: [vorschlag] } },
      [`POST /api/v1/kontaktvorschlaege/${vorschlag.id}/uebernehmen`]: { koerper: { personId: "00000000-0000-4000-8000-000000000702" } },
    });
    rendereApp("/contacts/suggestions");
    const nutzer = userEvent.setup();
    const tabelle = within(await screen.findByRole("region", { name: k.listeTitel }));
    expect(await tabelle.findByText("max@neu.example.com")).toBeTruthy();
    expect(tabelle.getByText(k.unternehmenNeu("Neu"))).toBeTruthy();
    await nutzer.click(tabelle.getByRole("button", { name: k.uebernehmenFuer("max@neu.example.com") }));
    await waitFor(() => expect(api.anfragen("POST", `/api/v1/kontaktvorschlaege/${vorschlag.id}/uebernehmen`)).toHaveLength(1));
    expect(await screen.findByText(k.uebernommen)).toBeTruthy();
  });

  it("führt einen Vorschlag mit einer über das Suchfeld gefundenen Person zusammen", async () => {
    const api = spieleApi({
      "/api/v1/me": alsRolle("bearbeiter"),
      "/api/v1/kontaktvorschlaege": { koerper: { modus: "vorschlag", daten: [vorschlag] } },
      "/api/v1/suche": { koerper: { q: "eva", organisationen: [], personen: [{ id: "p-eva", vorname: "Eva", nachname: "Muster", email: null, telefon: null, linkedin: null, organisation: null, score: 1 }], deals: [], beteiligungen: [], dokumente: [] } },
      [`POST /api/v1/kontaktvorschlaege/${vorschlag.id}/zusammenfuehren`]: { koerper: { personId: "p-eva" } },
    });
    rendereApp("/contacts/suggestions");
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: k.zusammenfuehrenFuer("max@neu.example.com") }));
    const dialog = within(await screen.findByRole("dialog", { name: k.zusammenfuehrenTitel }));
    await nutzer.type(dialog.getByRole("combobox", { name: k.zielPerson }), "eva");
    await nutzer.click(await dialog.findByRole("option", { name: /^Eva Muster/ }));
    await nutzer.click(dialog.getByRole("button", { name: k.zusammenfuehren }));
    await waitFor(() => expect(api.anfragen("POST", `/api/v1/kontaktvorschlaege/${vorschlag.id}/zusammenfuehren`)).toHaveLength(1));
    expect(api.anfragen("POST", `/api/v1/kontaktvorschlaege/${vorschlag.id}/zusammenfuehren`)[0]!.koerper).toEqual({ personId: "p-eva" });
  });

  it("eigene Teilnahme und Sperrliste in den Einstellungen speichern", async () => {
    const api = spieleApi({
      "/api/v1/me": alsRolle("bearbeiter"),
      "/api/v1/postfach": { koerper: { anbieter: { microsoft: true, google: false, imap: false }, schluesselVorhanden: true, verbindungen: [] } },
      "/api/v1/postfach/kontakte": { koerper: { modus: "vorschlag", teilnehmen: false, sperrliste: [], darfAnlegen: true } },
      "PUT /api/v1/postfach/kontakte": { koerper: { modus: "vorschlag", teilnehmen: true, sperrliste: ["familie.example"], darfAnlegen: true } },
    });
    rendereApp("/settings/mailbox?tab=mailbox");
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByLabelText(k.teilnehmen));
    await nutzer.type(screen.getByLabelText(k.sperrliste), "familie.example");
    await nutzer.click(screen.getByRole("button", { name: k.speichern }));
    await waitFor(() => expect(api.anfragen("PUT", "/api/v1/postfach/kontakte")).toHaveLength(1));
    expect(api.anfragen("PUT", "/api/v1/postfach/kontakte")[0]!.koerper).toEqual({ teilnehmen: true, sperrliste: ["familie.example"] });
  });
});
