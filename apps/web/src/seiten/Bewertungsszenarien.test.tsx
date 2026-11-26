import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { FONDS_ID, rendereApp, spieleApi } from "../test/hilfen";

const S1 = "11111111-aaaa-4aaa-8aaa-000000000001";
const BET = "bbbbbbbb-1111-4111-8111-000000000001";

const kopf = (status: "entwurf" | "festgeschrieben") => ({
  id: S1, fondsId: FONDS_ID, name: "Basis", basisStichtag: "2026-11-20", status, erstelltVon: "x", erstelltAm: "2026-11-20T08:00:00.000Z", geaendertAm: "2026-11-20T08:00:00.000Z",
  festgeschriebenAm: status === "festgeschrieben" ? "2026-11-21T08:00:00.000Z" : null, festgeschriebenVon: null, ergebnisHash: status === "festgeschrieben" ? "ab".repeat(32) : null, wissensstand: null,
});
const werte = (nav: string | null) => ({ nav, tvpi: nav ? "1.3550" : null, dpi: "0.0000", rvpi: nav ? "1.3550" : null, carry: nav ? "177500.00" : null, navNetto: nav ? "3210000.00" : null });
const detail = (status: "entwurf" | "festgeschrieben") => ({
  ...kopf(status),
  annahmen: { gebuehren: { basis: "zeichnungskapital", satz: "0", bisJahr: null, sonstigeJahr: "0" }, carrySatz: "0.2", beteiligungen: {}, neuinvestitionen: [], wertpfad: "linear" },
  ergebnis: {
    basisStichtag: "2026-11-20", endJahr: 2028, waehrung: "EUR", zeichnungskapital: "10000000.00", jahre: [], beteiligungen: [], summen: {}, befunde: [], schritte: [],
    bewertungsszenario: {
      waehrung: "EUR", carrySatz: "0.2",
      beteiligungen: [{ id: BET, name: "Alpha Energie", aktuell: "2500000.00", erwartet: null, abweichung: null, faelle: [
        { schluessel: "base", name: null, gewicht: "0.5", methode: "wert", wert: "1800000.00", abweichung: "-700000.00", eingaben: {} },
        { schluessel: "bull", name: null, gewicht: "0.5", methode: "multiple", wert: null, abweichung: null, eingaben: {} },
      ] }],
      aktuell: werte("3300000.00"), faelle: [{ schluessel: "base", name: null, ...werte("2600000.00") }, { schluessel: "bull", name: null, ...werte(null) }], erwartet: werte(null),
      befunde: [{ code: "BEWERTUNG_KENNZAHL_FEHLT", schwere: "warnung", beteiligungId: BET, params: { fall: "bull", kennzahl: "umsatz" } }],
    },
  },
  pruefsumme: null,
});
const antworten = (status: "entwurf" | "festgeschrieben") => ({
  [`/api/v1/fonds/${FONDS_ID}/szenarien`]: { koerper: { daten: [kopf(status)] } },
  [`/api/v1/szenarien/${S1}`]: { koerper: detail(status) },
  [`/api/v1/fonds/${FONDS_ID}/szenarien/vorlage`]: { koerper: { basisStichtag: "2026-11-20", beteiligungen: [{ id: BET, organisation: "Alpha Energie", instrument: "offene_beteiligung", wert: "2500000.00", investiert: "1500000.00" }] } },
  [`PATCH /api/v1/szenarien/${S1}`]: { koerper: kopf(status) },
});

describe("Bewertungsszenarien im Bereich Szenarien", () => {
  it("zeigt Fälle, Lücke statt Zahl, Erwartungswert und Fondswirkung; der Entwurf nennt das Wasserzeichen", async () => {
    spieleApi(antworten("entwurf"));
    rendereApp(`/fonds/${FONDS_ID}/szenarien?tab=bewertung`);
    const fall = await screen.findByText(/Basis \(50 %\): 1\.800\.000/, {}, { timeout: 5000 });
    const tabelle = fall.closest("table")!;
    expect(within(tabelle).getAllByText("Lücke").length).toBeGreaterThan(0);
    const wirkung = screen.getByText("Carry-Vorschau").closest("table")!;
    expect(within(wirkung).getAllByText("Lücke").length).toBeGreaterThan(0);
    expect(screen.getByText(/Wasserzeichen ENTWURF/)).toBeTruthy();
    expect(screen.getByText(/Für den Fall bull fehlt der bestätigte Wert der Kennzahl umsatz/)).toBeTruthy();
  });

  it("der Editor verlangt genau 100 % und schickt die Fälle als Brüche; festgeschrieben gibt es keine Bearbeitung", async () => {
    const api = spieleApi(antworten("entwurf"));
    rendereApp(`/fonds/${FONDS_ID}/szenarien?tab=bewertung`);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Fälle bearbeiten: Alpha Energie" }));
    const speichern = screen.getByRole("button", { name: "Fälle speichern" });
    // Vorbelegt: 50 / 25 / 25, aber ohne Beträge: die Prozente stimmen, die Methode ist fester Wert
    expect(screen.getByText(/Summe der Wahrscheinlichkeiten: 100 %/)).toBeTruthy();
    const proz = screen.getAllByLabelText("Wahrscheinlichkeit in %");
    await nutzer.clear(proz[0]!);
    await nutzer.type(proz[0]!, "40");
    expect(screen.getByText(/Die Wahrscheinlichkeiten müssen genau 100 % ergeben/)).toBeTruthy();
    expect((speichern as HTMLButtonElement).disabled).toBe(true);
    await nutzer.clear(proz[0]!);
    await nutzer.type(proz[0]!, "50");
    const betraege = screen.getAllByLabelText("Wert in Fondswährung");
    await nutzer.type(betraege[0]!, "1800000");
    await nutzer.type(betraege[1]!, "1000000");
    await nutzer.type(betraege[2]!, "4000000");
    await nutzer.click(speichern);
    await waitFor(() => expect(api.anfragen("PATCH", `/api/v1/szenarien/${S1}`)).toHaveLength(1));
    const koerper = api.anfragen("PATCH", `/api/v1/szenarien/${S1}`)[0]!.koerper as { annahmen: { bewertung: { beteiligungen: Record<string, { faelle: { schluessel: string; gewicht: string }[] }> } } };
    expect(koerper.annahmen.bewertung.beteiligungen[BET]!.faelle.map((f) => [f.schluessel, f.gewicht])).toEqual([["base", "0.5"], ["bear", "0.25"], ["bull", "0.25"]]);
  });

  it("festgeschrieben: keine Bearbeitung, Hinweis mit Prüfsumme", async () => {
    spieleApi(antworten("festgeschrieben"));
    rendereApp(`/fonds/${FONDS_ID}/szenarien?tab=bewertung`);
    expect(await screen.findByText(/Eingaben und Ergebnis sind eingefroren/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Fälle bearbeiten/ })).toBeNull();
  });
});

describe("Bewertungsszenarien: Erlös laut Wasserfall und Kennzahl in Fremdwährung", () => {
  it("zeigt je Fall den Erlös laut Wasserfall, den Grund ohne Captable und die Währung der Kennzahl mit Kurs; ältere Szenarien ohne die Angabe bleiben lesbar", async () => {
    const d = detail("entwurf");
    const faelle = [
      { schluessel: "base", name: null, gewicht: "0.5", methode: "multiple", wert: "691244.24", abweichung: "-1808755.76", eingaben: { kennzahlWaehrung: "USD", kurs: "0.92165899", kursDatum: "2026-11-20" }, exit: { unternehmenswert: "4608294.93", erloesFonds: "1500000.00", grund: null, unterschied: "808755.76", beteiligungenDesFonds: 1 } },
      { schluessel: "bull", name: null, gewicht: "0.5", methode: "multiple", wert: "368663.59", abweichung: "-2131336.41", eingaben: {}, exit: { unternehmenswert: "3686635.94", erloesFonds: null, grund: "keine_kapitaltabelle", unterschied: null, beteiligungenDesFonds: 1 } },
    ];
    const mit = { ...d, ergebnis: { ...d.ergebnis, bewertungsszenario: { ...d.ergebnis.bewertungsszenario, beteiligungen: [{ ...d.ergebnis.bewertungsszenario.beteiligungen[0]!, faelle, erwartetErloes: null }] } } };
    spieleApi({ ...antworten("entwurf"), [`/api/v1/szenarien/${S1}`]: { koerper: mit } });
    rendereApp(`/fonds/${FONDS_ID}/szenarien?tab=bewertung`);
    expect(await screen.findByText(/Basis: 1\.500\.000/, {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByText(/Bulle: keine Captable|bull: keine Captable/)).toBeTruthy();
    expect(screen.getByText(/Kennzahl in USD, Kurs 0\.92165899 vom 20\.11\.2026/)).toBeTruthy();
    expect(screen.getByText(/Der Erlös laut Wasserfall zeigt/)).toBeTruthy();
  });
});
