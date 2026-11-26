import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { FONDS_ID, rendereApp, spieleApi } from "../test/hilfen";

const url = `/fonds?fondsId=${FONDS_ID}&tab=kapital`;
const kostenPfad = `/api/v1/fonds/${FONDS_ID}/kosten`;
const anteile = [
  { organisationId: "investor-1", investor: "Investor Am Park", betrag: "60.00" },
  { organisationId: "investor-2", investor: "Investor Hafen", betrag: "40.00" },
];
const buchung = {
  id: "kosten-1", art: "fondskosten", valuta: "2026-03-01", betrag: "100.00", verteilung: "grundlage", zeitraumVon: null, zeitraumBis: null, satz: null,
  bemerkung: "Prüfung", storniertKostenId: null, storniertDurchId: null, erfasstAm: "2026-03-01T10:00:00.000Z", anteile,
};
const konto = (organisationId: string, investor: string, navAnteil: string) => ({
  organisationId, investor, zusage: "50000.00", anteil: "0.5", ausgetreten: false, abgerufen: "1000.00", eingezahlt: "1000.00", offen: "0.00",
  ausgeschuettet: "0.00", offeneZusage: "49000.00", verwaltungsverguetung: "0.00", fondskosten: "50.00", kostenausgleich: "0.00", ergebnisanteil: "0.00",
  navAnteil, nettoIrr: "-0.05",
  schritte: [
    { zeichen: "", bezeichnung: "Eingezahltes Kapital", wert: "1000.00" },
    { zeichen: "−", bezeichnung: "Fondskosten", wert: "50.00" },
    { zeichen: "=", bezeichnung: "NAV-Anteil", wert: navAnteil },
  ],
});
const antworten = {
  [kostenPfad]: { koerper: { waehrung: "EUR", stichtag: null, summen: { verwaltungsverguetung: "0.00", fondskosten: "100.00" }, buchungen: [buchung] } },
  [`/api/v1/fonds/${FONDS_ID}/kapitalkonten`]: { koerper: { stichtag: "2026-06-30", waehrung: "EUR", nav: "1900.00", konten: [konto("investor-1", "Investor Am Park", "950.00"), konto("investor-2", "Investor Hafen", "950.00")] } },
};

describe("Vergütung und Kosten des Fonds", () => {
  it("zeigt Buchungen, Summen, Aufteilung und die Kapitalkonten mit Rechenweg", async () => {
    spieleApi(antworten);
    rendereApp(url);
    const abschnitt = within(await screen.findByRole("region", { name: "Vergütung und Kosten" }));
    expect((await abschnitt.findAllByRole("row"))[1]!.textContent).toContain("Fondskosten");
    const nutzer = userEvent.setup();
    await nutzer.click(abschnitt.getByRole("button", { name: "Aufteilung: Fondskosten vom 01.03.2026" }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByText("Investor Hafen")).toBeTruthy();
    await nutzer.click(dialog.getByRole("button", { name: /Schließen/ }));

    const konten = within(await screen.findByRole("region", { name: "Kapitalkonten" }));
    expect((await konten.findAllByRole("row"))).toHaveLength(3);
    await nutzer.click(konten.getByRole("button", { name: "Rechenweg: Kapitalkonto Investor Am Park" }));
    expect(within(await screen.findByRole("dialog")).getByText("NAV-Anteil")).toBeTruthy();
  });

  it("prüft zuerst die Aufteilung und bucht dann mit derselben Eingabe", async () => {
    const vorschau = { art: "fondskosten", valuta: "2026-09-30", betrag: "100.00", verteilung: "grundlage", verteilungsbasis: "zusage", zeitraumVon: null, zeitraumBis: null, satz: null, berechnung: null, waehrung: "EUR",
      aufteilung: anteile.map((a) => ({ ...a, zusage: "50000.00", anteil: "0.5", ausgetreten: false })) };
    const api = spieleApi({
      ...antworten,
      [`POST ${kostenPfad}/vorschau`]: { koerper: vorschau },
      [`POST ${kostenPfad}`]: { status: 201, koerper: { ...buchung, id: "kosten-2" } },
    });
    rendereApp(url);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Kosten buchen" }));
    const dialog = within(await screen.findByRole("dialog"));
    await nutzer.selectOptions(dialog.getByLabelText("Art"), "fondskosten");
    await nutzer.type(dialog.getByLabelText(/Betrag \(EUR\)/), "100");
    await nutzer.click(dialog.getByRole("button", { name: "Aufteilung prüfen" }));
    await waitFor(() => expect(api.anfragen("POST", `${kostenPfad}/vorschau`)).toHaveLength(1));
    expect(api.anfragen("POST", `${kostenPfad}/vorschau`)[0]!.koerper).toMatchObject({ art: "fondskosten", betrag: "100", verteilung: "grundlage" });
    await nutzer.click(await dialog.findByRole("button", { name: "Buchen" }));
    await waitFor(() => expect(api.anfragen("POST", kostenPfad)).toHaveLength(1));
    expect(api.anfragen("POST", kostenPfad)[0]!.koerper).toMatchObject({ art: "fondskosten", betrag: "100.00", verteilung: "grundlage" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("bucht eine eigene Aufteilung; unveränderte Zeilen behalten den Betrag der Vorschau", async () => {
    const vorschau = { art: "verwaltungsverguetung", valuta: "2026-09-30", betrag: "100.00", verteilung: "grundlage", verteilungsbasis: "zusage", zeitraumVon: null, zeitraumBis: null, satz: null, berechnung: null, waehrung: "EUR",
      aufteilung: anteile.map((a) => ({ ...a, zusage: "50000.00", anteil: "0.5", ausgetreten: false })) };
    const api = spieleApi({
      ...antworten,
      [`POST ${kostenPfad}/vorschau`]: { koerper: vorschau },
      [`POST ${kostenPfad}`]: { status: 201, koerper: { ...buchung, id: "kosten-3" } },
    });
    rendereApp(url);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Kosten buchen" }));
    const dialog = within(await screen.findByRole("dialog"));
    await nutzer.type(dialog.getByLabelText(/Betrag \(EUR\)/), "100");
    await nutzer.click(dialog.getByRole("button", { name: "Eigene Aufteilung" }));
    await nutzer.click(dialog.getByRole("button", { name: "Aufteilung prüfen" }));
    const park = await dialog.findByLabelText("Investor Am Park");
    expect((dialog.getByLabelText("Investor Hafen") as HTMLInputElement).value).toBe("40,00");
    await nutzer.clear(park);
    await nutzer.type(park, "70");
    expect(await dialog.findByRole("alert")).toBeTruthy();
    expect((dialog.getByRole("button", { name: "Buchen" }) as HTMLButtonElement).disabled).toBe(true);
    await nutzer.clear(park);
    await nutzer.type(park, "60");
    await nutzer.click(dialog.getByRole("button", { name: "Buchen" }));
    await waitFor(() => expect(api.anfragen("POST", kostenPfad)).toHaveLength(1));
    const koerper = api.anfragen("POST", kostenPfad)[0]!.koerper as { verteilung: string; anteile: { organisationId: string; betrag: string }[] };
    expect(koerper.verteilung).toBe("manuell");
    expect(koerper.anteile.map((a) => [a.organisationId, Number(a.betrag)])).toEqual([["investor-1", 60], ["investor-2", 40]]);
  });
});
