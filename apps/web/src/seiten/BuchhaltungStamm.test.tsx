import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { FONDS_ID, alsRolle, fehler, rendereApp, spieleApi } from "../test/hilfen";

const buchhaltungUrl = (bereich: string, unter?: string) => `/buchhaltung?${unter ? `tab=${bereich}&unter=${unter}` : `bereich=${bereich}`}`;
const pfad = (rest: string) => `/api/v1/funds/${FONDS_ID}/${rest}`;

/** Ordnet per Tastatur: Griff aufnehmen, mit den Pfeiltasten bewegen, ablegen. */
const ordne = (griff: HTMLElement, ...tasten: string[]) => {
  fireEvent.keyDown(griff, { key: " " });
  for (const taste of tasten) fireEvent.keyDown(griff, { key: taste });
  fireEvent.keyDown(griff, { key: " " });
};

describe("Buchhaltung: Stammdaten bearbeiten", () => {
  const gliederungZeile = (schluessel: string, eltern: string | null, de: string, en: string, reihenfolge: number, seite = "debit") => ({ id: `g-${schluessel}`, fundId: FONDS_ID, view: "balance_sheet", key: schluessel, parentKey: eltern, labelDe: de, labelEn: en, order: reihenfolge, side: seite });
  const basis = {
    [pfad("accounting")]: { koerper: { fundId: FONDS_ID, advisorNumber: 1234567, clientNumber: 12345, fiscalYearStart: 1, accountNumberLength: 4, voucherPrefix: "B", updatedBy: "x", updatedAt: "2026-11-20T09:00:00.000Z", configured: true } },
    [pfad("funding-sources")]: { koerper: { data: [] } },
    [pfad("accounts")]: { koerper: { data: [{ id: "k1", fundId: FONDS_ID, accountNumber: "1200", label: "Bank", type: "asset", investmentId: null }, { id: "k2", fundId: FONDS_ID, accountNumber: "0100", label: "Anteile Alpha", type: "asset", investmentId: "b1" }] } },
    [pfad("layout")]: {
      koerper: { data: [gliederungZeile("aktiva", null, "Aktiva", "Assets", 10), gliederungZeile("aktiva.liquide", "aktiva", "Liquide Mittel", "Cash", 20), gliederungZeile("aktiva.beteiligungen", "aktiva", "Beteiligungen", "Holdings", 30)] },
    },
    [pfad("account-rules")]: { koerper: { data: [] } },
    [pfad("voucher-templates")]: { koerper: { data: [] } },
  };

  it("Sachkonten: anlegen und ändern (mit Beteiligung), entfernen nach Rückfrage, Serverfehler sichtbar", async () => {
    const api = spieleApi({
      ...basis,
      [`PUT ${pfad("accounts")}`]: { koerper: { data: [] } },
      [`DELETE ${pfad("accounts/1200")}`]: fehler(409, "account_in_use", { accountNumber: "1200" }),
      [`DELETE ${pfad("accounts/0100")}`]: { status: 204, koerper: null },
    });
    rendereApp(buchhaltungUrl("einstellungen", "konten"));
    const nutzer = userEvent.setup();
    const karte = within(await screen.findByRole("region", { name: "Sachkonten des Fonds" }));
    await nutzer.click(karte.getByRole("button", { name: "Konto anlegen" }));
    fireEvent.change(karte.getByLabelText("Nummer"), { target: { value: "1300" } });
    fireEvent.change(karte.getByLabelText("Bezeichnung"), { target: { value: "Forderungen" } });
    await nutzer.selectOptions(karte.getByLabelText("Beteiligung"), "Alpha Energie");
    await nutzer.click(karte.getByRole("button", { name: "Konto speichern" }));
    await waitFor(() => expect(api.anfragen("PUT", pfad("accounts"))).toHaveLength(1));
    expect(api.anfragen("PUT", pfad("accounts"))[0]!.koerper).toEqual({ accounts: [{ accountNumber: "1300", label: "Forderungen", type: "asset", investmentId: expect.any(String) }] });
    // ändern: Die Nummer bleibt fest.
    await nutzer.click(karte.getByRole("button", { name: "Konto 1200 bearbeiten" }));
    expect((karte.getByLabelText("Nummer") as HTMLInputElement).disabled).toBe(true);
    fireEvent.change(karte.getByLabelText("Bezeichnung"), { target: { value: "Bank Hauptkonto" } });
    await nutzer.selectOptions(karte.getByLabelText("Art"), "passiv");
    await nutzer.click(karte.getByRole("button", { name: "Konto speichern" }));
    await waitFor(() => expect(api.anfragen("PUT", pfad("accounts"))).toHaveLength(2));
    expect(api.anfragen("PUT", pfad("accounts"))[1]!.koerper).toEqual({ accounts: [{ accountNumber: "1200", label: "Bank Hauptkonto", type: "liability", investmentId: null }] });
    // entfernen: erst die Rückfrage, dann der Aufruf; der Serverfehler wird gezeigt
    await nutzer.click(karte.getByRole("button", { name: "Konto 1200 entfernen" }));
    expect(api.anfragen("DELETE", pfad("accounts/1200"))).toHaveLength(0);
    await nutzer.click(karte.getByRole("button", { name: "Ja, Konto 1200 entfernen" }));
    expect(await karte.findByText(/lässt sich nicht löschen/)).toBeTruthy();
    // ein freies Konto lässt sich entfernen
    await nutzer.click(karte.getByRole("button", { name: "Konto 0100 entfernen" }));
    await nutzer.click(karte.getByRole("button", { name: "Ja, Konto 0100 entfernen" }));
    await waitFor(() => expect(api.anfragen("DELETE", pfad("accounts/0100"))).toHaveLength(1));
    expect(await karte.findByText("Konto entfernt.")).toBeTruthy();
  });

  it("ohne Rolle Verwalter: nur Ansicht bei Sachkonten, Gliederung und Kontenzuordnung", async () => {
    spieleApi({ ...basis, "/api/v1/me": alsRolle("bearbeiter") });
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
      [`PUT ${pfad("layout/balance_sheet")}`]: fehler(409, "layout_item_in_use", { items: ["aktiva.beteiligungen"] }),
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
    ordne(editor.getByRole("button", { name: "Position verschieben: Forderungen" }), "ArrowUp", "ArrowUp");
    // eine Position mit Unterpositionen lässt sich nicht entfernen, eine ohne schon
    expect((editor.getByRole("button", { name: "Position entfernen: Aktiva" }) as HTMLButtonElement).disabled).toBe(true);
    await nutzer.click(editor.getByRole("button", { name: "Position entfernen: Liquide Mittel" }));
    expect(editor.queryByText("Liquide Mittel")).toBeNull();
    await nutzer.click(editor.getByRole("button", { name: "Gliederung speichern" }));
    expect(await editor.findByText(/Eine Kontenregel verweist auf eine Position/)).toBeTruthy();
    expect(api.anfragen("PUT", pfad("layout/balance_sheet"))[0]!.koerper).toEqual({
      items: [
        { key: "aktiva", parentKey: null, labelDe: "Aktiva", labelEn: "Assets", side: "debit" },
        { key: "aktiva.forderungen", parentKey: "aktiva", labelDe: "Forderungen", labelEn: "Receivables", side: "debit" },
        { key: "aktiva.beteiligungen", parentKey: "aktiva", labelDe: "Finanzanlagen", labelEn: "Holdings", side: "debit" },
      ],
    });
    // Verwerfen stellt den gespeicherten Stand wieder her.
    await nutzer.click(editor.getByRole("button", { name: "Änderungen verwerfen" }));
    expect(editor.getByText("Liquide Mittel")).toBeTruthy();
    expect(editor.queryByText("Forderungen")).toBeNull();
  });

  it("Buchungsregeln: je Quelle speichern, auch für Kapitalabruf und Ausschüttung; Feldfehler am Feld", async () => {
    const regel = { id: "br1", fundId: FONDS_ID, source: "interest", account: "1200", contraAccount: "8000", direction: "debit", taxKey: null, postingText: "Zins {organisation}", updatedBy: "x", updatedAt: "2026-11-20T09:00:00.000Z" };
    const api = spieleApi({
      ...basis,
      [pfad("posting-rules")]: { koerper: { data: [regel] } },
      [`PUT ${pfad("posting-rules/capital_call")}`]: { koerper: { ...regel, source: "capital_call" } },
      [`PUT ${pfad("posting-rules/interest")}`]: fehler(400, "invalid_input", { fields: [{ field: "account", code: "invalid_format", message: "x" }] }),
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
    await waitFor(() => expect(api.anfragen("PUT", pfad("posting-rules/capital_call"))).toHaveLength(1));
    expect(api.anfragen("PUT", pfad("posting-rules/capital_call"))[0]!.koerper).toEqual({ account: "1200", contraAccount: "9000", direction: "credit", taxKey: "9", postingText: "Abruf {valuta}" });
    await nutzer.click(karte.getByRole("button", { name: "Zuordnung speichern: Zinsen" }));
    expect(await karte.findByText(/Das Format passt nicht/)).toBeTruthy();
  });

  it("Export: Fondsbewegungen auswählen; Vorschau und Export senden die Bewegungen", async () => {
    const zeile = { transactionId: null, fundMovementId: "x", organization: "Fonds", type: "capital_call", valueDate: "2026-03-15", amount: "250000.00", account: "1200", contraAccount: "9000", direction: "debit", voucherField: "FND-1", postingText: "Abruf", hasVoucher: false, alreadyExported: false };
    const api = spieleApi({
      "/api/v1/zinslaeufe": { koerper: { daten: [] } },
      [pfad("posting-exports")]: { koerper: { data: [] } },
      [`POST ${pfad("posting-exports/preview")}`]: { koerper: { format: "EXTF", dateFrom: "2026-03-15", dateTo: "2026-03-15", rows: [zeile], count: 1, issues: [], withoutVoucher: ["x"] } },
      [`POST ${pfad("posting-exports")}`]: { status: 201, koerper: { id: "ex1" } },
    });
    rendereApp(buchhaltungUrl("export"));
    const nutzer = userEvent.setup();
    await nutzer.selectOptions(await screen.findByLabelText("Was exportiert wird"), "bewegungen");
    expect((screen.getByRole("button", { name: "Vorschau" }) as HTMLButtonElement).disabled).toBe(true);
    const gruppe = within(screen.getByRole("group", { name: "Fondsbewegungen (Kapitalabruf, Ausschüttung)" }));
    expect(gruppe.getAllByRole("checkbox")).toHaveLength(2);
    await nutzer.click(gruppe.getByRole("checkbox", { name: /^Kapitalabruf, / }));
    await nutzer.click(screen.getByRole("button", { name: "Vorschau" }));
    await waitFor(() => expect(api.anfragen("POST", pfad("posting-exports/preview"))).toHaveLength(1));
    expect(api.anfragen("POST", pfad("posting-exports/preview"))[0]!.koerper).toEqual({ fundMovementIds: [expect.any(String)], repeat: false });
    expect(await screen.findByText("FND-1")).toBeTruthy();
    await nutzer.click(screen.getByRole("button", { name: "Exportieren" }));
    await waitFor(() => expect(api.anfragen("POST", pfad("posting-exports"))).toHaveLength(1));
    expect(api.anfragen("POST", pfad("posting-exports"))[0]!.koerper).toEqual({ fundMovementIds: [expect.any(String)], repeat: false });
  });
});
