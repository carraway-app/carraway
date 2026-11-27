import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { BET_ID, fehler, instrumentDaten, rendereApp, spieleApi, waehleAktion } from "../test/hilfen";

const url = `/investments/${BET_ID}`;
const schmal = (text: string | null) => (text ?? "").replace(/\s/g, " ");
const dialog = () => within(screen.getByRole("dialog"));
const abschnitt = async () => within(await screen.findByRole("region", { name: "Instrument" }));

const ergebnis = {
  ergebnis: {
    wandlungsbetrag: "1062000.00",
    preisJeAnteil: "10.4",
    massgeblich: "abschlag",
    anzahlAnteile: "102115",
    schritte: [
      { zeichen: "", bezeichnung: "Offenes Kapital am Cut-off", wert: "1000000" },
      { zeichen: "=", bezeichnung: "Wandlungsbetrag (Kapital plus Zinsen)", wert: "1062000" },
      { zeichen: "=", bezeichnung: "Agio (Wandlungsbetrag − Nominal − Spitzenbetrag)", wert: "959845" },
    ],
  },
  gebucht: { zinsen: "62000.00", spitzenbetrag: "40.00", umgewandelt: "1061960.00", nominal: "102115.00", agio: "959845.00" },
  vorgaenge: [
    { beteiligung: "darlehen", art: "zins", valuta: "2026-11-01", betrag: "62000.00" },
    { beteiligung: "ziel", art: "zusage", valuta: "2026-11-01", betrag: "1061960.00" },
  ],
  zielBeteiligungId: "ziel1",
};

async function fuelleWandlung(nutzer: ReturnType<typeof userEvent.setup>) {
  const d = dialog();
  await nutzer.type(d.getByLabelText("Nennwert je Anteil in Euro"), "1");
  await nutzer.type(d.getByLabelText("Abschlag in Prozent (optional)"), "20");
  await nutzer.type(d.getByLabelText("Bezeichnung der Runde"), "Serie B");
  await nutzer.type(d.getByLabelText("Pre-Money in Euro"), "8000000");
  await nutzer.type(d.getByLabelText("Post-Money in Euro"), "10000000");
  await nutzer.type(d.getByLabelText("Preis je Anteil in Euro"), "13");
  await nutzer.type(d.getByLabelText("Anteile nach der Runde"), "769231");
}

describe("Wandlung", () => {
  it("bucht erst nach einer Vorschau mit unveränderten Eingaben und zeigt das Ergebnis mit Herkunft", async () => {
    const api = spieleApi({
      [`POST /api/v1/beteiligungen/${BET_ID}/wandlung/vorschau`]: { koerper: { vorschau: true, ...ergebnis, runde: { id: null, organisationId: "o", preisJeAnteil: "13" } } },
      [`POST /api/v1/beteiligungen/${BET_ID}/wandlung`]: { status: 201, koerper: { wandlung: {}, ...ergebnis, rundeId: "r", vorgangIds: [] } },
    });
    rendereApp(`${url}?tab=financing&subtab=instruments`);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Wandlung: Wandeldarlehen 2021" }));
    await screen.findByRole("dialog");
    const d = dialog();
    const buchen = () => d.getByRole("button", { name: "Wandlung buchen" }) as HTMLButtonElement;
    expect(buchen().disabled).toBe(true);
    expect(d.getByText("Gebucht wird erst nach einer Vorschau mit unveränderten Eingaben.")).toBeTruthy();
    expect(d.getByLabelText("Cut-off").getAttribute("max")).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    await fuelleWandlung(nutzer);
    await nutzer.click(d.getByRole("button", { name: "Vorschau rechnen" }));
    const vorschau = await d.findByRole("region", { name: "Vorschau" });
    // Ergebnis aus gebucht (Cent), Regel übersetzt, Buchungen, Rechenweg
    expect(schmal(vorschau.textContent)).toContain("62.000,00 €");
    expect(schmal(vorschau.textContent)).toContain("Rundenpreis mit Abschlag");
    expect(schmal(vorschau.textContent)).toContain("102.115");
    expect(within(vorschau).getByText("Zielbeteiligung")).toBeTruthy();
    expect(within(vorschau).getByText("Wandlungsbetrag (Kapital plus Zinsen)")).toBeTruthy();
    expect(buchen().disabled).toBe(false);
    expect(api.anfragen("POST", `/api/v1/beteiligungen/${BET_ID}/wandlung`)).toHaveLength(0);

    // Eingabe ändern: Buchen ist wieder gesperrt
    await nutzer.type(d.getByLabelText("Nennwert je Anteil in Euro"), "0");
    expect(buchen().disabled).toBe(true);
    expect(d.getByText(/Die Eingaben haben sich seit der Vorschau geändert/)).toBeTruthy();
    await nutzer.click(d.getByRole("button", { name: "Vorschau rechnen" }));
    await d.findByText("Wandlungsbetrag", { selector: "dt" });
    expect(buchen().disabled).toBe(false);

    await nutzer.click(buchen());
    expect(await d.findByText("Die Wandlung ist gebucht.")).toBeTruthy();
    expect(d.getByRole("link", { name: "Zur Zielbeteiligung" }).getAttribute("href")).toBe("/investments/ziel1");
    const vorschauBody = api.anfragen("POST", `/api/v1/beteiligungen/${BET_ID}/wandlung/vorschau`)[1]!.koerper;
    const buchungBody = api.anfragen("POST", `/api/v1/beteiligungen/${BET_ID}/wandlung`)[0]!.koerper;
    expect(buchungBody).toEqual(vorschauBody);
    expect(buchungBody).toMatchObject({ nennwertJeAnteil: "10", zinsenWandeln: true, preisregel: { discount: "0.2" }, runde: { neu: { bezeichnung: "Serie B", anteileGesamtNach: "769231" } } });
  });

  it("sendet abweichende Beträge samt Behandlung des Rests und zeigt den Rest in der Vorschau", async () => {
    const abweichend = {
      ...ergebnis,
      ergebnis: { ...ergebnis.ergebnis, darlehenRest: "10000.00", zinsenRest: "0", restbehandlung: { darlehen: "erlassen", zinsen: null } },
    };
    const api = spieleApi({ [`POST /api/v1/beteiligungen/${BET_ID}/wandlung/vorschau`]: { koerper: { vorschau: true, ...abweichend, runde: { id: null, organisationId: "o", preisJeAnteil: "13" } } } });
    rendereApp(`${url}?tab=financing&subtab=instruments`);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Wandlung: Wandeldarlehen 2021" }));
    await screen.findByRole("dialog");
    const d = dialog();
    await fuelleWandlung(nutzer);
    await nutzer.type(d.getByLabelText("Gewandeltes Darlehen in Euro"), "90000");
    await nutzer.selectOptions(d.getByLabelText("Rest des Darlehens"), "erlassen");
    await nutzer.click(d.getByRole("button", { name: "Vorschau rechnen" }));
    const vorschau = await d.findByRole("region", { name: "Vorschau" });
    expect(schmal(vorschau.textContent)).toContain("Darlehen, nicht gewandelt");
    expect(schmal(vorschau.textContent)).toContain("10.000,00 € · Wird erlassen");
    expect(schmal(vorschau.textContent)).not.toContain("Zinsen, nicht gewandelt");
    expect(api.anfragen("POST", `/api/v1/beteiligungen/${BET_ID}/wandlung/vorschau`)[0]!.koerper).toMatchObject({ gewandeltesDarlehen: "90000", darlehenRest: "erlassen" });
    expect(api.anfragen("POST", `/api/v1/beteiligungen/${BET_ID}/wandlung/vorschau`)[0]!.koerper).not.toHaveProperty("gewandelteZinsen");
  });

  it("zeigt Feldfehler der Vorschau an den Feldern und Fachfehler als Hinweis", async () => {
    spieleApi({
      [`POST /api/v1/beteiligungen/${BET_ID}/wandlung/vorschau`]: {
        status: 400,
        koerper: { error: { code: "invalid_input", message: "x", fields: [{ field: "preisregel.discount", code: "invalid_format", message: "x" }, { field: "cutoff", code: "as_of_out_of_range", message: "x" }] } },
      },
    });
    rendereApp(`${url}?tab=financing&subtab=instruments`);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Wandlung: Wandeldarlehen 2021" }));
    await screen.findByRole("dialog");
    await fuelleWandlung(nutzer);
    await nutzer.click(dialog().getByRole("button", { name: "Vorschau rechnen" }));
    expect(await dialog().findByText("Das Datum liegt außerhalb des erlaubten Zeitraums.")).toBeTruthy();
    expect(dialog().getByLabelText("Abschlag in Prozent (optional)").getAttribute("aria-invalid")).toBe("true");
  });

  it("blendet die Wandlung bei einem gewandelten Darlehen aus", async () => {
    spieleApi({ [`/api/v1/beteiligungen/${BET_ID}/instrumentdaten`]: { koerper: { ...instrumentDaten, wandlung: { cutoff: "2026-01-31", wandlungsbetrag: "1062000.00", anzahlAnteile: "102115", preisJeAnteil: "10.4", massgeblich: "rundenpreis", zielBeteiligungId: "ziel1" } } } });
    rendereApp(url);
    const inst = await abschnitt();
    await inst.findByRole("heading", { name: "Wandlung" });
    expect(screen.queryByRole("menuitem", { name: "Wandlung" })).toBeNull();
    expect(inst.getByRole("link", { name: "Zur Zielbeteiligung" })).toBeTruthy();
  });

  it("verweist bei einem Ziel in derselben Beteiligung auf das Instrument, nur bei Altdaten auf die andere Beteiligung", async () => {
    const wandlung = { cutoff: "2026-01-31", wandlungsbetrag: "1062000.00", anzahlAnteile: "102115", preisJeAnteil: "10.4", massgeblich: "rundenpreis", darlehenBeteiligungId: BET_ID, zielBeteiligungId: BET_ID, zielInstrumentId: "i-ziel" };
    spieleApi({ [`/api/v1/beteiligungen/${BET_ID}/instrumentdaten`]: { koerper: { ...instrumentDaten, wandlung } } });
    rendereApp(url);
    const inst = await abschnitt();
    await inst.findByRole("heading", { name: "Wandlung" });
    expect(inst.queryByRole("link", { name: "Zur Zielbeteiligung" })).toBeNull();
    const link = inst.getByRole("link", { name: "Zum Instrument" });
    expect(link.getAttribute("href")).toBe(`/investments/${BET_ID}?tab=financing&subtab=instruments#instrument-i-ziel`);
  });
});

describe("Verkauf, Kaufpreisanpassung, Insolvenz", () => {
  it("zeigt nach dem Buchen die Auswertung des Servers als Erfolgsansicht", async () => {
    const auswertung = {
      principalDisposed: "1100000.00",
      buchwertVorher: "1012000.00",
      buchwertAbgang: "1012000.00",
      erloes: "1500000.00",
      ergebnis: "488000.00",
      barzufluss: "1450000.00",
      schritte: [{ zeichen: "", bezeichnung: "Buchwert vor dem Verkauf", wert: "1012000" }, { zeichen: "=", bezeichnung: "Erlös", wert: "1500000" }],
    };
    const api = spieleApi({
      [`POST /api/v1/beteiligungen/${BET_ID}/verkauf/vorschau`]: {
        koerper: { vorschau: true, ergebnis: auswertung, forderung: { art: "treuhand", betrag: "50000.00", faelligAm: "2027-06-30" }, verkaeuferdarlehen: null, status: "exit" },
      },
      [`POST /api/v1/beteiligungen/${BET_ID}/verkauf`]: {
        status: 201,
        koerper: {
          verkauf: {},
          ergebnis: {
            buchwertVorher: "1012000.00",
            buchwertAbgang: "1012000.00",
            erloes: "1500000.00",
            ergebnis: "488000.00",
            barzufluss: "1450000.00",
            schritte: [{ zeichen: "", bezeichnung: "Buchwert vor dem Verkauf", wert: "1012000" }, { zeichen: "=", bezeichnung: "Erlös", wert: "1500000" }],
          },
          forderung: { id: "f" },
          verkaeuferdarlehenBeteiligungId: "vd1",
          status: "exit",
        },
      },
    });
    rendereApp(url);
    const nutzer = userEvent.setup();
    await waehleAktion(nutzer, "Verkauf");
    const d = dialog();
    await nutzer.type(d.getByLabelText("Kaufpreis in Euro"), "1550000");
    await nutzer.type(d.getByLabelText("Kosten in Euro (optional)"), "50000");
    await nutzer.type(d.getByLabelText("Treuhandbetrag in Euro (optional)"), "50000");
    await nutzer.type(d.getByLabelText("Freigabe des Treuhandbetrags am"), "2027-06-30");
    await nutzer.click(d.getByRole("button", { name: "Vorschau berechnen" }));
    expect(await d.findByRole("group", { name: "Vorschau des Verkaufs" })).toBeTruthy();
    expect(d.getByText("Kapitalabgang an den Erwerber")).toBeTruthy();
    expect(api.anfragen("POST", `/api/v1/beteiligungen/${BET_ID}/verkauf`)).toHaveLength(0);
    await nutzer.click(d.getByRole("button", { name: "Verkauf buchen" }));

    expect(await d.findByText("Der Verkauf ist gebucht.")).toBeTruthy();
    const text = schmal(d.getByRole("heading", { name: "Auswertung" }).parentElement!.textContent);
    expect(text).toContain("Buchwertabgang1.012.000,00 €");
    expect(text).toContain("Gewinn488.000,00 €");
    expect(text).toContain("Barzufluss1.450.000,00 €");
    expect(text).toContain("Exit");
    expect(d.getByText("Treuhandforderung angelegt")).toBeTruthy();
    expect(d.getByRole("link", { name: "Zum Verkäuferdarlehen" }).getAttribute("href")).toBe("/investments/vd1");
    expect(d.getAllByText("Buchwert vor dem Verkauf")).toHaveLength(2); // Kennzahl und Rechenweg
    expect(api.anfragen("POST", `/api/v1/beteiligungen/${BET_ID}/verkauf`)[0]!.koerper).toMatchObject({
      anteilVerkauft: "1",
      kaufpreis: "1550000",
      kosten: "50000",
      treuhand: { betrag: "50000", freigabeAm: "2027-06-30" },
    });
  });

  it("zeigt sale_invalid mit Beträgen und bei Verlust das Wort Verlust", async () => {
    spieleApi({ [`POST /api/v1/beteiligungen/${BET_ID}/verkauf/vorschau`]: fehler(409, "sale_invalid", { erloes: "100.00", treuhand: "200.00", verkaeuferdarlehen: "0.00" }) });
    rendereApp(url);
    const nutzer = userEvent.setup();
    await waehleAktion(nutzer, "Verkauf");
    await nutzer.type(dialog().getByLabelText("Kaufpreis in Euro"), "100");
    await nutzer.click(dialog().getByRole("button", { name: "Vorschau berechnen" }));
    const hinweis = await dialog().findByRole("alert");
    expect(schmal(hinweis.textContent)).toContain("Erlös 100 €, Treuhandbetrag 200 €, Verkäuferdarlehen 0 €.");
  });

  it("bucht eine negative Kaufpreisanpassung und die Insolvenz mit Wertberichtigung", async () => {
    const mitVerkauf = { ...instrumentDaten, verkaeufe: [{ id: "vk1", beteiligungId: BET_ID, datum: "2026-10-01", anteilVerkauft: "1.000000", kaufpreis: "1500000.00", kosten: "0.00", buchwertAbgang: "1012000.00", erloes: "1500000.00", ergebnis: "488000.00", schritte: [], anpassungen: [], ergebnisMitAnpassungen: "488000.00" }] };
    const api = spieleApi({
      [`/api/v1/beteiligungen/${BET_ID}/instrumentdaten`]: { koerper: mitVerkauf },
      [`POST /api/v1/beteiligungen/${BET_ID}/kaufpreisanpassung`]: { status: 201, koerper: {} },
      [`POST /api/v1/beteiligungen/${BET_ID}/insolvenz`]: { koerper: {} },
    });
    rendereApp(url);
    const nutzer = userEvent.setup();
    await abschnitt();
    await waehleAktion(nutzer, "Kaufpreisanpassung");
    await nutzer.type(dialog().getByLabelText("Betrag in Euro (Rückzahlung negativ)"), "-25000");
    await nutzer.type(dialog().getByLabelText("Grund"), "Working-Capital-Abgleich");
    await nutzer.click(dialog().getByRole("button", { name: "Anpassung buchen" }));
    await screen.findByRole("heading", { level: 1 });
    expect(api.anfragen("POST", `/api/v1/beteiligungen/${BET_ID}/kaufpreisanpassung`)[0]!.koerper).toMatchObject({ betrag: "-25000", verkaufId: "vk1" });

    await waehleAktion(nutzer, "Insolvenz");
    await nutzer.click(dialog().getByRole("button", { name: "Ja" }));
    await nutzer.click(dialog().getByRole("button", { name: "Insolvenz buchen" }));
    await screen.findByRole("heading", { level: 1 });
    expect(api.anfragen("POST", `/api/v1/beteiligungen/${BET_ID}/insolvenz`)[0]!.koerper).toMatchObject({ wertberichtigungAufNull: true });
  });
});
