import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { BET_ID, beteiligungDaten, rendereApp, spieleApi, vorgang } from "../test/hilfen";

const basis = `/investments/${BET_ID}?tab=financing&subtab=transactions`;
const SEED = { id: "r1", bezeichnung: "Seed", art: "eigenkapital", datum: "2021-05-31" };
const SERIE_A = { id: "r2", bezeichnung: "Serie A", art: "eigenkapital", datum: "2022-03-31" };

/** Erfundene Buchungen: Zusage, zwei Auszahlungen, Tilgung, Zinsbuchung und -zahlung, eine Einlage aus Wandlung, eine Wertberichtigung. */
const MISCH = {
  ...beteiligungDaten,
  vorgaenge: [
    vorgang("a1", "zusage", "2021-05-31", "1000000.00", { runde: SEED }),
    vorgang("a2", "auszahlung", "2021-06-30", "400000.00", { runde: SEED }),
    vorgang("a3", "auszahlung", "2022-02-01", "300000.00"),
    vorgang("a4", "tilgung", "2022-06-30", "50000.00", { runde: SERIE_A }),
    vorgang("a5", "zins", "2022-07-01", "7000.00"),
    vorgang("a6", "zinszahlung", "2022-07-15", "7000.00"),
    vorgang("a7", "auszahlung", "2022-08-01", "250000.00", { runde: SERIE_A, ohneGeldfluss: true }),
    vorgang("a8", "wertberichtigung", "2023-01-31", "-1000.00"),
  ],
};
const mitMisch = () => spieleApi({ [`/api/v1/beteiligungen/${BET_ID}`]: { koerper: MISCH } });
const zeilenDer = (tabelle: HTMLElement) => within(tabelle).getAllByRole("row").slice(1);
const filterLeiste = async () => within(await screen.findByRole("group", { name: "Vorgänge nach Art" }));

describe("Transaktionen: Filter, Gruppierung, Summen", () => {
  it("zeigt Reiter mit Anzahl, blendet leere aus und zählt Buchungen ohne Geldfluss nicht als Auszahlung oder Rückfluss", async () => {
    mitMisch();
    rendereApp(basis);
    const leiste = await filterLeiste();
    const namen = leiste.getAllByRole("button").map((b) => b.textContent);
    expect(namen).toEqual(["Alle 8", "Auszahlungen 2", "Rückflüsse 2", "Zinsen 2", "Zusagen 1", "Wandlung 1", "Sonstige 1"]);
  });

  it("blendet Reiter ohne Treffer aus (nur Alle bleibt)", async () => {
    spieleApi();
    rendereApp(basis);
    const leiste = await filterLeiste();
    expect(leiste.getAllByRole("button").map((b) => b.textContent)).toEqual(["Alle 4", "Auszahlungen 3", "Zusagen 1"]);
  });

  it("filtert, schreibt den Filter in die Adresse und zeigt die Summe der sichtbaren Zeilen in der Fußzeile", async () => {
    mitMisch();
    const { router } = rendereApp(basis);
    const nutzer = userEvent.setup();
    const leiste = await filterLeiste();
    await nutzer.click(leiste.getByRole("button", { name: /^Auszahlungen/ }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ art: "auszahlungen" }));
    const tabelle = screen.getByRole("region", { name: "Vorgänge" });
    expect(zeilenDer(tabelle)).toHaveLength(3); // zwei Zeilen und die Fußzeile
    expect(tabelle.textContent).not.toContain("Tilgung");
    expect(tabelle.textContent).not.toContain("ohne Geldfluss");
    const fuss = within(tabelle).getAllByRole("row").at(-1)!;
    expect(fuss.textContent).toContain("Summe (2)");
    expect(fuss.textContent).toMatch(/700\.000/);

    await nutzer.click(leiste.getByRole("button", { name: /^Wandlung/ }));
    const wandlung = screen.getByRole("region", { name: "Vorgänge" });
    expect(zeilenDer(wandlung)).toHaveLength(1);
    expect(wandlung.textContent).toContain("ohne Geldfluss");
    expect(within(wandlung).queryByText(/Summe/)).toBeNull();

    await nutzer.click(leiste.getByRole("button", { name: /^Alle/ }));
    await waitFor(() => expect(router.state.location.search).not.toHaveProperty("art"));
    // „ohne Geldfluss“ steht auch unter Alle als Chip
    expect(screen.getByRole("region", { name: "Vorgänge" }).textContent).toContain("ohne Geldfluss");
  });

  it("liest Filter und Gruppierung aus der Adresse", async () => {
    mitMisch();
    rendereApp(`${basis}&kind=returns&grouping=year`);
    const leiste = await filterLeiste();
    expect(leiste.getByRole("button", { name: /^Rückflüsse/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("combobox", { name: "Gruppierung" })).toHaveProperty("value", "jahr");
    expect(screen.getByRole("region", { name: "Gruppe 2022" })).toBeTruthy();
  });

  it("gruppiert nach Jahr mit Summen je Gruppe (Auszahlungen und Rückflüsse getrennt unter Alle)", async () => {
    mitMisch();
    const { router } = rendereApp(basis);
    const nutzer = userEvent.setup();
    await nutzer.selectOptions(await screen.findByRole("combobox", { name: "Gruppierung" }), "jahr");
    await waitFor(() => expect(router.state.location.search).toMatchObject({ gruppierung: "jahr" }));
    const gruppen = screen.getAllByRole("region").filter((r) => /^Gruppe /.test(r.getAttribute("aria-label") ?? ""));
    expect(gruppen.map((g) => g.getAttribute("aria-label"))).toEqual(["Gruppe 2021", "Gruppe 2022", "Gruppe 2023"]);
    const kopf = (g: HTMLElement) => g.querySelector(".app-tx-gruppe__kopf")!.textContent!;
    expect(kopf(gruppen[0]!)).toMatch(/Auszahlungen 400\.000/);
    expect(kopf(gruppen[0]!)).toMatch(/Zusagen 1\.000\.000/);
    expect(kopf(gruppen[1]!)).toMatch(/Auszahlungen 300\.000/); // die Einlage aus Wandlung zählt nicht
    expect(kopf(gruppen[1]!)).toMatch(/Rückflüsse 57\.000/);
    expect(kopf(gruppen[2]!)).toContain("1 Vorgang");
    expect(kopf(gruppen[2]!)).not.toMatch(/Auszahlungen|Rückflüsse/);
    // Zurück auf „nicht gruppiert“ entfernt den Parameter
    await nutzer.selectOptions(screen.getByRole("combobox", { name: "Gruppierung" }), "keine");
    await waitFor(() => expect(router.state.location.search).not.toHaveProperty("gruppierung"));
  });

  it("gruppiert nach Runde chronologisch, Buchungen ohne Runde zuletzt", async () => {
    mitMisch();
    rendereApp(`${basis}&grouping=round&kind=disbursements`);
    await screen.findByRole("group", { name: "Vorgänge nach Art" });
    const gruppen = screen.getAllByRole("region").filter((r) => /^Gruppe /.test(r.getAttribute("aria-label") ?? ""));
    expect(gruppen.map((g) => g.getAttribute("aria-label"))).toEqual(["Gruppe Seed", "Gruppe Keiner Runde zugeordnet"]);
    // Serie A hält nur die Einlage aus Wandlung (keine Auszahlung); unter „Auszahlungen“ steht sie nicht
    expect(gruppen[0]!.querySelector(".app-tx-gruppe__kopf")!.textContent).toMatch(/400\.000/);
    expect(gruppen[1]!.querySelector(".app-tx-gruppe__kopf")!.textContent).toMatch(/300\.000/);
    // Gesamtzeile des Filters unter den Gruppen
    expect(document.querySelector(".app-tx-gesamt")!.textContent).toMatch(/Summe \(2\).*700\.000/);
  });

  it("öffnet die Transaktionen aus den Kacheln Investiert und Rückflüsse mit dem passenden Filter", async () => {
    spieleApi();
    const { router } = rendereApp(`/investments/${BET_ID}`);
    const nutzer = userEvent.setup();
    const kennzahlen = within(await screen.findByRole("region", { name: "Kennzahlen" }));
    await nutzer.click(kennzahlen.getByRole("button", { name: /^Investiert/ }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ tab: "finanzierung", unter: "transaktionen", art: "auszahlungen" }));
    expect((await filterLeiste()).getByRole("button", { name: /^Auszahlungen/ }).getAttribute("aria-pressed")).toBe("true");

    await nutzer.click(kennzahlen.getByRole("button", { name: /^Rückflüsse/ }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ art: "rueckfluesse" }));
    expect((await filterLeiste()).getByRole("button", { name: /^Rückflüsse/ }).getAttribute("aria-pressed")).toBe("true");
  });
});
