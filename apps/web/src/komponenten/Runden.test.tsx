import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { BET_ID, FONDS_ID, ORG_A, ORG_B, rendereApp, spieleApi, type Anfrage, zeilenAktion } from "../test/hilfen";
import { anteilNachRunde } from "./Runden";

const RUNDEN = `/api/v1/organisationen/${ORG_A}/finanzierungsrunden`;
const schmal = (text: string | null) => (text ?? "").replace(/\s/g, " ");
const pruefung = (volumen: string) => ({ volumen, postMoneyErwartet: "10000000.00", anteileErwartet: "1000000", anteileVergeben: "0", abweichungen: [] as unknown[], schliessbar: true });
const position = (id: string, art: "fonds" | "organisation", name: string, betrag: string, anteile: string, extra: Record<string, unknown> = {}) => ({
  id,
  investor: { art, id: art === "fonds" ? FONDS_ID : ORG_B, name },
  betrag,
  anteile,
  rolle: art === "fonds" ? "lead" : "co",
  anteilsklasse: null,
  gezahlt: null,
  offen: null,
  buchungen: [] as unknown[],
  ...extra,
});
const runde = (id: string, bezeichnung: string, datum: string, status: "entwurf" | "abgeschlossen", positionen: ReturnType<typeof position>[], volumen: string) => ({
  id,
  organisationId: ORG_A,
  bezeichnung,
  datum,
  preMoney: "8000000.00",
  postMoney: "10000000.00",
  preisJeAnteil: "10.0000",
  anteileGesamtNach: "1156723.0000",
  status,
  abgeschlossenAm: status === "abgeschlossen" ? "2026-03-16T08:00:00.000Z" : null,
  abgeschlossenVon: null,
  wiedergeoeffnetAm: null,
  wiedergeoeffnetVon: null,
  wiedereroeffnungGrund: null,
  positionen,
  pruefung: pruefung(volumen),
});

const fondsOnly = [position("p1", "fonds", "Beispielfonds I", "718000.10", "71800"), position("p2", "fonds", "Beispielfonds II", "281999.95", "28200")];
const gemischt = [
  position("q1", "fonds", "Beispielfonds I", "1000000.10", "71800"),
  position("q2", "organisation", "Beta Medizin", "500000.20", "40500", { gezahlt: "100000.10", offen: "400000.10" }),
];

describe("anteilNachRunde", () => {
  it("rechnet Anteile durch Anteile nach der Runde mit zwei Stellen", () => {
    expect(anteilNachRunde("71800", "1156723.0000")).toBe("6.21");
    expect(anteilNachRunde("1", "3")).toBe("33.33");
    expect(anteilNachRunde("2", "3")).toBe("66.67");
  });
  it("liefert ohne Anteile oder Gesamtzahl nichts", () => {
    expect(anteilNachRunde(null, "100")).toBeNull();
    expect(anteilNachRunde("5", null)).toBeNull();
    expect(anteilNachRunde("5", "0")).toBeNull();
  });
});

describe("Runden: Anteil und Summenzeile", () => {
  it("zeigt Anteil nach der Runde und die Summe; Gezahlt und Offen nur bei vollständigen Werten; Betrag entspricht dem Volumen der Prüfung", async () => {
    const voll = runde("r1", "Seed", "2021-05-31", "abgeschlossen", gemischt, "1500000.30");
    expect(voll.pruefung.volumen).toBe("1500000.30");
    const leer = runde("r2", "Serie A", "2022-05-31", "abgeschlossen", fondsOnly, "1000000.05");
    spieleApi({ [RUNDEN]: { koerper: { daten: [voll, leer] } } });
    rendereApp(`/investments/${BET_ID}?tab=financing`);
    const nutzer = userEvent.setup();

    // Serie A (neuer) ist die Vorgabe: Fondszeilen ohne Gezahlt/Offen
    let tabelle = within(await screen.findByRole("table"));
    // Anteil nach der Runde steht unter den Anteilen, Gezahlt unter Offen (zusammengefasste Spalten)
    expect(tabelle.getByRole("columnheader", { name: "Anteile" })).toBeTruthy();
    let zeilen = tabelle.getAllByRole("row");
    expect(schmal(zeilen[1]!.textContent)).toContain("6,21 %");
    let fuss = zeilen[zeilen.length - 1]!;
    expect(within(fuss).getByRole("rowheader", { name: "Summe Runde" })).toBeTruthy();
    expect(schmal(fuss.textContent)).toContain("1.000.000,05 €");
    expect(schmal(fuss.textContent)).toContain("100.000");
    expect(schmal(fuss.textContent)).toContain("8,65 %"); // 100000 / 1156723
    expect(fuss.querySelectorAll("td")[3]!.textContent).toBe("");

    await nutzer.click(within(screen.getByRole("tablist", { name: "Runden" })).getByRole("tab", { name: /Seed/ }));
    tabelle = within(await screen.findByRole("table"));
    zeilen = tabelle.getAllByRole("row");
    fuss = zeilen[zeilen.length - 1]!;
    // Betragssumme (in Cent) entspricht dem Volumen der Prüfung
    expect(schmal(fuss.textContent)).toContain(schmal(new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(Number(voll.pruefung.volumen))));
    expect(schmal(fuss.textContent)).toContain("112.300"); // 71800 + 40500
    // Gezahlt/Offen: nicht jede Zeile hat einen Wert
    expect(fuss.querySelectorAll("td")[3]!.textContent).toBe("");
  });

  it("summiert Gezahlt und Offen, wenn jede Position einen Wert hat", async () => {
    const alle = [
      position("s1", "organisation", "Beta Medizin", "100.10", "10", { gezahlt: "50.05", offen: "50.05" }),
      position("s2", "organisation", "Gamma Kapital", "200.20", "20", { gezahlt: "100.10", offen: "100.10" }),
    ];
    spieleApi({ [RUNDEN]: { koerper: { daten: [runde("r1", "Seed", "2021-05-31", "abgeschlossen", alle, "300.30")] } } });
    rendereApp(`/investments/${BET_ID}?tab=financing`);
    const zeilen = within(await screen.findByRole("table")).getAllByRole("row");
    const fuss = zeilen[zeilen.length - 1]!;
    expect(schmal(fuss.textContent)).toContain("300,30 €");
    expect(schmal(fuss.textContent)).toContain("150,15 €");
  });
});

it("kennzeichnet die Prüfung einer Runde mit ausgeblendetem Unternehmensbestand als vorläufig", async () => {
  const entwurf = runde("r1", "Seed", "2021-05-31", "entwurf", fondsOnly, "1000000.05");
  spieleApi({
    [RUNDEN]: { koerper: { daten: [{ ...entwurf, anteileGesamtNach: null, pruefung: { ...entwurf.pruefung, bestandAusgeblendet: true } }] } },
  });
  rendereApp(`/investments/${BET_ID}?tab=financing`);
  expect(await screen.findByText(/Vorläufige Prüfung anhand der Eingaben/)).toBeTruthy();
  expect(screen.queryByText(/Alle Prüfungen sind in Ordnung/)).toBeNull();
});

describe("Runden: Reiter", () => {
  it("zeigt Name, Datum und Volumen im Reiter und wechselt mit den Pfeiltasten", async () => {
    const alt = runde("r1", "Seed", "2021-05-31", "abgeschlossen", gemischt, "1500000.30");
    const neu = runde("r9", "Serie Z", "2026-01-15", "entwurf", gemischt, "1500000.30");
    spieleApi({ [RUNDEN]: { koerper: { daten: [alt, neu] } } });
    rendereApp(`/investments/${BET_ID}?tab=financing`);
    const nutzer = userEvent.setup();
    const leiste = within(await screen.findByRole("tablist", { name: "Runden" }));
    const reiter = leiste.getAllByRole("tab");
    expect(reiter).toHaveLength(2);
    expect(reiter[0]!.textContent).toContain("Serie Z"); // neueste zuerst
    expect(reiter[0]!.textContent).toMatch(/2026/);
    expect(reiter[1]!.getAttribute("aria-selected")).toBe("true"); // Vorgabe: neueste abgeschlossene
    expect(within(leiste.getByRole("tab", { selected: true }).closest(".cw-untertabs")! as HTMLElement).getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(reiter[1]!.id);
    reiter[1]!.focus();
    await nutzer.keyboard("{ArrowLeft}");
    expect(document.activeElement).toBe(reiter[0]);
    await nutzer.keyboard("{Enter}");
    expect(reiter[0]!.getAttribute("aria-selected")).toBe("true");
    expect(await screen.findByRole("article", { name: /Serie Z/ })).toBeTruthy();
    await nutzer.keyboard("{End}");
    expect(document.activeElement).toBe(reiter[1]);
  });
});

describe("Runden: neue Runde wird gewählt", () => {
  async function anlegen(url: string) {
    const bestehend = runde("r1", "Seed", "2021-05-31", "abgeschlossen", gemischt, "1500000.30");
    const neu = runde("r9", "Serie Z", "2026-01-15", "entwurf", gemischt, "1500000.30");
    let angelegt = false;
    const api = spieleApi({
      [RUNDEN]: () => ({ koerper: { daten: angelegt ? [neu, bestehend] : [bestehend] } }),
      [`POST ${RUNDEN}`]: () => {
        angelegt = true;
        return { status: 201, koerper: { ...neu, dubletten: [] } };
      },
    });
    rendereApp(url);
    const nutzer = userEvent.setup();
    return { api, nutzer };
  }

  it("wählt die neue Runde in der Liste (Beteiligung)", async () => {
    const { api, nutzer } = await anlegen(`/investments/${BET_ID}?tab=financing`);
    await nutzer.click(await screen.findByRole("button", { name: "Neue Runde" }));
    const d = within(screen.getByRole("dialog"));
    await nutzer.type(d.getByLabelText("Bezeichnung"), "Serie Z");
    await nutzer.type(d.getByLabelText("Pre-Money"), "8000000");
    await nutzer.type(d.getByLabelText("Preis je Anteil"), "10");
    await nutzer.click(d.getByRole("button", { name: "Als Entwurf anlegen" }));
    await waitFor(() => expect(api.anfragen("POST", RUNDEN)).toHaveLength(1));
    const liste = within(screen.getByRole("tablist", { name: "Runden" }));
    await waitFor(() => expect(liste.getByRole("tab", { name: /Serie Z/ }).getAttribute("aria-selected")).toBe("true"));
    expect(liste.getByRole("tab", { name: /Seed/ }).getAttribute("aria-selected")).toBe("false");
    expect(await screen.findByRole("article", { name: /Serie Z/ })).toBeTruthy();
  });

  it("wählt die neue Runde auch auf der Organisationsseite (mit Fondswahl)", async () => {
    const { api, nutzer } = await anlegen(`/organizations/${ORG_A}`);
    await nutzer.click(await within(await screen.findByRole("navigation", { name: /^(Hauptnavigation|Main navigation)$/ })).findByRole("link", { name: /^Runden/ }));
    await nutzer.click(await screen.findByRole("button", { name: "Neue Runde" }));
    const d = within(screen.getByRole("dialog"));
    await nutzer.type(d.getByLabelText("Bezeichnung"), "Serie Z");
    await nutzer.type(d.getByLabelText("Pre-Money"), "8000000");
    await nutzer.type(d.getByLabelText("Preis je Anteil"), "10");
    await nutzer.click(d.getByRole("button", { name: "Als Entwurf anlegen" }));
    await waitFor(() => expect(api.anfragen("POST", RUNDEN)).toHaveLength(1));
    const liste = within(screen.getByRole("tablist", { name: "Runden" }));
    await waitFor(() => expect(liste.getByRole("tab", { name: /Serie Z/ }).getAttribute("aria-selected")).toBe("true"));
  });
});

describe("Runden: Vehikel einer Position zuordnen", () => {
  const VEHIKEL = `/api/v1/organisationen/${ORG_B}/vehikel`;
  const vehikel = (id: string, name: string, standard: boolean) => ({ id, investorId: ORG_B, name, art: "fonds", auflagejahr: null, status: "aktiv", standard, anzahlPositionen: 0, positionen: [] });
  const mitVehikel = (status: "entwurf" | "abgeschlossen") =>
    runde("r1", "Serie A", "2022-05-31", status, [position("q2", "organisation", "Beta Medizin", "500000.20", "40500", { vehikel: { id: "v1", name: "Beta Seedfonds" } })], "500000.20");
  const PATCH_URL = "/api/v1/finanzierungsrunden/r1/positionen/q2";

  it("Entwurf: zeigt die Vehikel des Investors und sendet das gewählte zusammen mit den Feldern", async () => {
    const api = spieleApi({
      [RUNDEN]: { koerper: { daten: [mitVehikel("entwurf")] } },
      [VEHIKEL]: { koerper: { daten: [vehikel("v1", "Beta Seedfonds", true), vehikel("v2", "Beta Wachstumsfonds", false)] } },
      [`PATCH ${PATCH_URL}`]: { koerper: mitVehikel("entwurf") },
    });
    rendereApp(`/investments/${BET_ID}?tab=financing`);
    const nutzer = userEvent.setup();
    await nutzer.click((await zeilenAktion(/Position von .* ändern/))!);
    const d = within(await screen.findByRole("dialog"));
    const auswahl = (await d.findByLabelText("Vehikel")) as HTMLSelectElement;
    expect(auswahl.value).toBe("v1");
    await nutzer.selectOptions(auswahl, "v2");
    await nutzer.click(d.getByRole("button", { name: "Position speichern" }));
    await waitFor(() => expect(api.anfragen("PATCH", PATCH_URL)).toHaveLength(1));
    expect(api.anfragen("PATCH", PATCH_URL)[0]!.koerper).toMatchObject({ vehikelId: "v2", betrag: "500000.20" });
  });

  it("zeigt keine Auswahl, wenn der Investor nur ein Vehikel hat", async () => {
    spieleApi({
      [RUNDEN]: { koerper: { daten: [mitVehikel("entwurf")] } },
      [VEHIKEL]: { koerper: { daten: [vehikel("v1", "Beta Seedfonds", true)] } },
    });
    rendereApp(`/investments/${BET_ID}?tab=financing`);
    const nutzer = userEvent.setup();
    await nutzer.click((await zeilenAktion(/Position von .* ändern/))!);
    const d = within(await screen.findByRole("dialog"));
    await d.findByLabelText("Zusage");
    expect(d.queryByLabelText("Vehikel")).toBeNull();
  });

  it("abgeschlossene Runde: nur das Vehikel, sonst nichts", async () => {
    const api = spieleApi({
      [RUNDEN]: { koerper: { daten: [mitVehikel("abgeschlossen")] } },
      [VEHIKEL]: { koerper: { daten: [vehikel("v1", "Beta Seedfonds", true), vehikel("v2", "Beta Wachstumsfonds", false)] } },
      [`PATCH ${PATCH_URL}`]: { koerper: mitVehikel("abgeschlossen") },
    });
    rendereApp(`/investments/${BET_ID}?tab=financing`);
    const nutzer = userEvent.setup();
    await nutzer.click((await zeilenAktion(/Vehikel der Position von .* ändern/))!);
    const d = within(await screen.findByRole("dialog"));
    await nutzer.selectOptions(await d.findByLabelText("Vehikel"), "v2");
    expect(d.queryByLabelText("Zusage")).toBeNull();
    await nutzer.click(d.getByRole("button", { name: "Position speichern" }));
    await waitFor(() => expect(api.anfragen("PATCH", PATCH_URL)).toHaveLength(1));
    expect(api.anfragen("PATCH", PATCH_URL)[0]!.koerper).toEqual({ vehikelId: "v2" });
  });
});

describe("Runden: Vorschau im Dialog", () => {
  it("fragt die Vorschau nur mit vollständiger, entprellter Eingabe ab", async () => {
    const vorschauen: Anfrage[] = [];
    spieleApi({
      [RUNDEN]: { koerper: { daten: [] } },
      [`POST ${RUNDEN}/vorschau`]: (a) => {
        vorschauen.push(a);
        return { koerper: { postMoney: "15000000.00", anteileGesamtNach: "1416667", pruefung: { volumen: "0.00", postMoneyErwartet: "0", anteileErwartet: "0", anteileVergeben: "0", abweichungen: [], schliessbar: true }, dubletten: [] } };
      },
    });
    rendereApp(`/investments/${BET_ID}?tab=financing`);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Neue Runde" }));
    const d = within(screen.getByRole("dialog"));
    await nutzer.type(d.getByLabelText("Bezeichnung"), "Serie B");
    await nutzer.type(d.getByLabelText("Pre-Money"), "13500000");
    await nutzer.type(d.getByLabelText("Preis je Anteil"), "9");
    await waitFor(() => expect(vorschauen.length).toBeGreaterThan(0));
    for (const a of vorschauen) expect(a.koerper).toMatchObject({ preMoney: "13500000", preisJeAnteil: "9" });
  });
});
