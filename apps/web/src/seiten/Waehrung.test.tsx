import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { BET_ID, FONDS_ID, fehler, rendereApp, spieleApi, uebersichtDaten } from "../test/hilfen";

const betraege = (fonds: string, lokal: string | null, vergleich: string | null) => ({ fonds, lokal, vergleich });
const sicht = (vergleich: string | null = null) => ({
  beteiligungId: BET_ID,
  stichtag: "2026-09-30",
  stand: null,
  waehrungen: { fonds: "EUR", lokal: "USD", vergleich },
  kennzahlen: {
    investiert: betraege("1000000.00", "1080000.00", vergleich ? "830000.00" : null),
    rueckfluesse: betraege("250000.00", null, vergleich ? "207500.00" : null),
    bewertung: betraege("2000000.00", "2200000.00", vergleich ? "1700000.00" : null),
  },
  bewertungKurse: [{ tag: "2026-09-30", von: "EUR", nach: "USD", kurs: "1.1", kursDatum: "2026-09-30", weg: "direkt" }],
  vorgaenge: [],
  bewertungen: [],
  luecken: [{ verwendung: "kosten", tag: "2026-03-15", von: "EUR", nach: "USD", grund: "veraltet", letzterKursDatum: "2026-02-01" }],
});
const waehrungenListe = { daten: [{ waehrung: "EUR", letzterKurs: "2026-09-30" }, { waehrung: "GBP", letzterKurs: "2026-09-30" }, { waehrung: "USD", letzterKurs: "2026-09-30" }] };

describe("Währungssicht an der Beteiligung", () => {
  it("zeigt Lokal, Fonds und Vergleich getrennt; eine Lücke steht als „Kurs fehlt“, Kurs und Datum werden genannt", async () => {
    spieleApi({
      [`/api/v1/beteiligungen/${BET_ID}/waehrungssicht`]: (a) => ({ koerper: sicht(a.query.get("vergleich")) }),
      "/api/v1/wechselkurse/waehrungen": { koerper: waehrungenListe },
    });
    rendereApp(`/beteiligungen/${BET_ID}`);
    const nutzer = userEvent.setup();
    const leiste = await screen.findByRole("region", { name: "Währungssicht" });
    // Standard: Fondswährung, die Zahlen der Kennzahlen
    const kennzahlen = screen.getByRole("region", { name: "Kennzahlen" });
    expect(kennzahlen.textContent).toContain("1,0 Mio.");
    expect(within(leiste).getByRole("button", { name: "Fonds" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(leiste).getByText("Fonds: EUR, lokal: USD")).toBeTruthy();

    // Lokal: Beträge in USD mit eigenem Zeichen; der Rückfluss hat keinen lokalen Betrag und keinen Kurs: Lücke statt Zahl.
    await nutzer.click(within(leiste).getByRole("button", { name: "Lokal" }));
    await waitFor(() => expect(screen.getByRole("region", { name: "Kennzahlen" }).textContent).toContain("Investiert (USD)"));
    const lokal = screen.getByRole("region", { name: "Kennzahlen" }).textContent ?? "";
    expect(lokal).toContain("1,1 Mio.");
    expect(lokal).toContain("$");
    expect(lokal).not.toContain("1,0 Mio. €");
    expect(lokal).toContain("Kurs fehlt");
    expect(within(leiste).getByText(/1 EUR = 1,1000 USD \(Kurs vom 30\.09\.2026, angewendet auf 30\.09\.2026\)/)).toBeTruthy();
    expect(within(leiste).getByText(/EUR nach USD am 15\.03\.2026: letzter Kurs vom 01\.02\.2026 ist zu alt/)).toBeTruthy();
    expect(within(leiste).getByText(/Multiple, IRR, TVPI, DPI und Abrufe rechnen in der Fondswährung/)).toBeTruthy();

    // Vergleich mit GBP: eigene Währung, Wahl in der Leiste
    await nutzer.click(within(leiste).getByRole("button", { name: "Vergleich" }));
    await waitFor(() => expect(screen.getByRole("region", { name: "Kennzahlen" }).textContent).toContain("Investiert (GBP)"));
    expect(screen.getByRole("region", { name: "Kennzahlen" }).textContent).toContain("£");
  });

  it("ohne Fremdwährung und ohne Kurse erscheint die Leiste nicht", async () => {
    const eur = { ...sicht(), waehrungen: { fonds: "EUR", lokal: "EUR", vergleich: null }, luecken: [] };
    spieleApi({
      [`/api/v1/beteiligungen/${BET_ID}/waehrungssicht`]: { koerper: eur },
      "/api/v1/wechselkurse/waehrungen": { koerper: { daten: [] } },
    });
    rendereApp(`/beteiligungen/${BET_ID}`);
    expect(await screen.findByRole("heading", { level: 1, name: "Alpha Energie" })).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("region", { name: "Währungssicht" })).toBeNull());
  });
});

describe("Währungssicht am Fonds", () => {
  it("zeigt die Vergleichsauswahl nur im Vergleich; ohne verfügbare Währung bleibt sie deaktiviert", async () => {
    spieleApi({ "/api/v1/wechselkurse/waehrungen": { koerper: { daten: [] } } });
    rendereApp(`/fonds/${FONDS_ID}`);
    const nutzer = userEvent.setup();
    const leiste = await screen.findByRole("region", { name: "Währungssicht" });
    expect(within(leiste).queryByRole("combobox")).toBeNull();
    await nutzer.click(within(leiste).getByRole("button", { name: "Vergleich" }));
    const wahl = await within(leiste).findByRole<HTMLSelectElement>("combobox", { name: "Vergleichswährung" });
    expect(wahl.disabled).toBe(true);
    expect(wahl.selectedOptions[0]?.textContent).toBe("Keine Kurse für eine Vergleichswährung");
    expect(within(leiste).getByRole("button", { name: "Vergleich" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("behält die Währungswahl bei leerem Bestand bedienbar und schreibt die Auswahl in die URL", async () => {
    spieleApi({
      [`/api/v1/fonds/${FONDS_ID}/uebersicht`]: { koerper: { ...uebersichtDaten, beteiligungen: [] } },
      "/api/v1/wechselkurse/waehrungen": { koerper: waehrungenListe },
    });
    const { router } = rendereApp(`/fonds/${FONDS_ID}?sicht=vergleich`);
    const nutzer = userEvent.setup();
    expect(await screen.findByRole("heading", { name: "0 Beteiligungen" })).toBeTruthy();
    const leiste = screen.getByRole("region", { name: "Währungssicht" });
    const wahl = within(leiste).getByRole("combobox", { name: "Vergleichswährung" });
    await within(wahl).findByRole("option", { name: "USD" });
    await nutzer.selectOptions(wahl, "USD");
    expect(router.state.location.search).toMatchObject({ sicht: "vergleich", vergleich: "USD" });
    expect(within(leiste).getByText("USD", { selector: "span" })).toBeTruthy();
  });

  it("zeigt je Beteiligung Investiert und Bewertung in der Währung der Sicht", async () => {
    const fonds = {
      fondsId: FONDS_ID,
      stichtag: "2026-09-30",
      stand: null,
      waehrungen: { fonds: "EUR", vergleich: null },
      zeilen: [
        { beteiligungId: BET_ID, organisation: { id: "o1", name: "Alpha Energie" }, instrument: "wandeldarlehen", lokalWaehrung: "USD", investiert: betraege("1000000.00", "1080000.00", null), rueckfluesse: betraege("0.00", "0.00", null), bewertung: betraege("2000000.00", "2200000.00", null), luecken: [], bewertungKurse: [] },
      ],
      summen: { investiert: { fonds: "1000000.00", vergleich: null }, rueckfluesse: { fonds: "0.00", vergleich: null }, bewertung: { fonds: "2000000.00", vergleich: null } },
      luecken: [],
    };
    spieleApi({
      [`/api/v1/fonds/${FONDS_ID}/waehrungssicht`]: { koerper: fonds },
      "/api/v1/wechselkurse/waehrungen": { koerper: waehrungenListe },
    });
    rendereApp(`/fonds/${FONDS_ID}?sicht=lokal`);
    const tabelle = await screen.findByRole("table");
    await waitFor(() => expect(within(tabelle).getByText(/1\.080\.000/)).toBeTruthy());
    expect(within(tabelle).getByText(/2\.200\.000/)).toBeTruthy();
    expect(within(tabelle).getByRole("columnheader", { name: /Investiert \(lokal\)/ })).toBeTruthy();
  });

  it("sortiert Vergleichswerte in der Vergleichswährung und lässt gemischte Lokalwerte unsortiert", async () => {
    const fondsSicht = `/api/v1/fonds/${FONDS_ID}/waehrungssicht`;
    spieleApi({
      [fondsSicht]: (anfrage) => {
        const vergleich = anfrage.query.get("vergleich");
        return {
          koerper: {
            waehrungen: { fonds: "EUR", vergleich },
            zeilen: [
              { beteiligungId: BET_ID, lokalWaehrung: "USD", investiert: betraege("1000", "1080", "900"), bewertung: betraege("2000000", "2200000", "4000000"), bewertungKurse: [] },
              { beteiligungId: "b2", lokalWaehrung: "GBP", investiert: betraege("2000", "1600", "1800"), bewertung: betraege("4500000", "1800000", "3000000"), bewertungKurse: [] },
            ],
            navVergleich: "8123456",
            summen: { bewertung: { fonds: "6500000", vergleich: "7000000" } },
            luecken: [],
          },
        };
      },
    });
    rendereApp(`/fonds/${FONDS_ID}?sicht=vergleich&vergleich=CHF`);
    const nutzer = userEvent.setup();
    const tabelle = within(await screen.findByRole("table"));
    expect(await screen.findByText(/8,1 Mio.*CHF/)).toBeTruthy();
    await nutzer.click(await tabelle.findByRole("button", { name: "Nach Bewertung (CHF) sortieren" }));
    const ersteBeteiligung = () => within(tabelle.getAllByRole("row")[1]!).getByRole("link").textContent;
    expect(ersteBeteiligung()).toBe("Alpha Energie");
    await nutzer.click(tabelle.getByRole("button", { name: "Nach Bewertung (CHF) sortieren" }));
    expect(ersteBeteiligung()).toBe("Beta Medizin");

    await nutzer.click(screen.getByRole("button", { name: "Lokal" }));
    expect(await screen.findByText("Für die Sortierung nach Bewertung eine einheitliche Währung wählen.")).toBeTruthy();
    expect(tabelle.queryByRole("button", { name: /Nach Bewertung/ })).toBeNull();
    expect(ersteBeteiligung()).toBe("Alpha Energie");
  });

  it("lädt Wechselkurse für Beträge erst in der Währungssicht und bietet bei einem Fehler eine Wiederholung an", async () => {
    const fondsSicht = `/api/v1/fonds/${FONDS_ID}/waehrungssicht`;
    const api = spieleApi({ [fondsSicht]: fehler(500, "internal_error") });
    rendereApp(`/fonds/${FONDS_ID}`);
    const nutzer = userEvent.setup();
    const leiste = await screen.findByRole("region", { name: "Währungssicht" });
    expect(api.anfragen("GET", fondsSicht)).toHaveLength(0);
    await nutzer.click(within(leiste).getByRole("button", { name: "Lokal" }));
    const erneut = await screen.findByRole("button", { name: "Erneut versuchen" });
    expect(screen.queryByText("Kurs fehlt")).toBeNull();
    const bisher = api.anfragen("GET", fondsSicht).length;
    await nutzer.click(erneut);
    await waitFor(() => expect(api.anfragen("GET", fondsSicht).length).toBeGreaterThan(bisher));
  });

});
