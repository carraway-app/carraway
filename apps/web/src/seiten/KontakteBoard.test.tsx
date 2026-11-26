import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ORG_A, ORG_B, crmFelderDaten, crmZeilenDaten, rendereApp, spieleApi } from "../test/hilfen";

const LISTE = "11111111-aaaa-4aaa-8aaa-111111111111";
const ANSICHT = "55555555-aaaa-4aaa-8aaa-555555555555";
const stufe = {
  schluessel: "f-stufe",
  name: "Stufe",
  typ: "auswahl",
  system: false,
  schreibbar: true,
  optionen: { optionen: [{ schluessel: "erst", label: "Erstkontakt", farbe: "grau" }, { schluessel: "gespraech", label: "Gespräch", farbe: "blau" }, { schluessel: "zusage", label: "Zusage", farbe: "signal" }] },
  operatoren: ["ist", "ist_nicht", "leer", "nicht_leer"],
  sortierbar: true,
  listeId: LISTE,
};
const volumen = { ...stufe, schluessel: "f-volumen", name: "Volumen", typ: "betrag", optionen: {}, operatoren: ["gleich"] };
const felder = [...crmFelderDaten.organisation, stufe, volumen];
const ansicht = {
  id: ANSICHT,
  objekt: "organisation",
  listeId: LISTE,
  name: "LP-Pipeline nach Stufe",
  art: "kanban",
  konfig: { sortierung: [], spalten: [{ feld: "name" }, { feld: "f-volumen" }, { feld: "ort" }], gruppierung: "f-stufe" },
  besitzerId: "x",
  geteilt: true,
  standard: true,
  eigene: false,
  bearbeitbar: true,
};
const alpha = { ...crmZeilenDaten.organisation[0], "f-stufe": "erst", "f-volumen": "2000000" };
const beta = { ...crmZeilenDaten.organisation[1], "f-stufe": "gespraech", "f-volumen": "500000" };

function api() {
  return spieleApi({
    "/api/v1/crm/objekte/organisation/felder": { koerper: { daten: felder } },
    "/api/v1/crm/ansichten": { koerper: { daten: [ansicht] } },
    "/api/v1/crm/listen": { koerper: { daten: [{ id: LISTE, name: "LP-Pipeline", objekt: "organisation", beschreibung: null, besitzerId: null, eintraege: 2 }] } },
    "POST /api/v1/crm/objekte/organisation/board": {
      koerper: {
        spalten: [
          { wert: "erst", anzahl: 1, summe: "2000000.00", karten: [alpha] },
          { wert: "gespraech", anzahl: 1, summe: "500000.00", karten: [beta] },
          { wert: "zusage", anzahl: 0, summe: "0", karten: [] },
        ],
        bezuege: {},
      },
    },
    "POST /api/v1/crm/objekte/organisation/gruppen": {
      koerper: { gruppen: [{ wert: "erst", anzahl: 1, summen: { "f-volumen": "2000000.00" } }, { wert: "gespraech", anzahl: 1, summen: { "f-volumen": "500000.00" } }], gesamt: 2, bezuege: {} },
    },
    "PATCH /api/v1/crm/listen/11111111-aaaa-4aaa-8aaa-111111111111/eintraege/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa": { koerper: { id: "e1" } },
  });
}

describe("Board nach einem Listenfeld (Kontakte)", () => {
  it("zeigt die gespeicherte Kanban-Ansicht mit Spalten je Option, Anzahl, Summe und Karten mit Schnellaktionen", async () => {
    const a = api();
    rendereApp(`/kontakte?liste=${LISTE}`);
    const board = await screen.findByRole("region", { name: "Unternehmen: Board" });
    expect(await within(board).findByRole("heading", { name: /Erstkontakt/ })).toBeTruthy();
    expect(within(board).getByRole("heading", { name: /Zusage/ })).toBeTruthy();
    const karte = within(board).getByRole("link", { name: "Alpha Energie" });
    expect(karte.getAttribute("href")).toBe(`/organisationen/${ORG_A}`);
    expect(within(board).getByRole("link", { name: "E-Mail an Alpha Energie" }).getAttribute("href")).toBe("mailto:info@alpha.example");
    const anfrage = a.anfragen("POST", "/api/v1/crm/objekte/organisation/board")[0]!.koerper as Record<string, unknown>;
    expect(anfrage).toMatchObject({ gruppe: "f-stufe", summe: "f-volumen", listeId: LISTE });
    expect(screen.getByRole("button", { name: "Board", pressed: true })).toBeTruthy();
  });

  it("verschiebt eine Karte mit der Tastatur: geschrieben wird der Wert am Eintrag der Liste, nicht am Datensatz", async () => {
    const a = api();
    rendereApp(`/kontakte?liste=${LISTE}`);
    const nutzer = userEvent.setup();
    const griff = await screen.findByRole("button", { name: "Verschieben: Alpha Energie" });
    griff.focus();
    await nutzer.keyboard(" {ArrowRight}{Enter}");
    await waitFor(() => expect(a.anfragen("PATCH", `/api/v1/crm/listen/${LISTE}/eintraege/${ORG_A}`)).toHaveLength(1));
    expect(a.anfragen("PATCH", `/api/v1/crm/listen/${LISTE}/eintraege/${ORG_A}`)[0]!.koerper).toEqual({ felder: { "f-stufe": "gespraech" } });
    expect(a.anfragen("PATCH", `/api/v1/crm/datensaetze/organisation/${ORG_A}`)).toHaveLength(0);
    expect(ORG_B).toBeTruthy();
  });

  it("wechselt zwischen Tabelle und Board über die Darstellung", async () => {
    api();
    rendereApp(`/kontakte?liste=${LISTE}`);
    const nutzer = userEvent.setup();
    await screen.findByRole("region", { name: "Unternehmen: Board" });
    await nutzer.click(screen.getByRole("button", { name: "Tabelle" }));
    // Die Spaltenwahl des Boards gilt in der Tabelle als Gruppierung: dieselbe Ansicht, anders dargestellt.
    expect(await screen.findByRole("button", { name: /Erstkontakt/ })).toBeTruthy();
    expect(await screen.findByRole("grid", { name: "Unternehmen: Erstkontakt" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Unternehmen: Board" })).toBeNull();
  });
});
