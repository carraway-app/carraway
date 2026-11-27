import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { alsRolle, BET_ID, ICH_ID, fehler, instrumentDaten, rendereApp, spieleApi, waehleAktion } from "../test/hilfen";
import { de } from "../i18n/de";
import { en } from "../i18n/en";
import { feldpruefungTexte } from "../i18n/feldpruefung";

const url = `/investments/${BET_ID}`;
const schmal = (text: string | null) => (text ?? "").replace(/\s/g, " ");
const dialog = () => within(screen.getByRole("dialog"));
const abschnitt = async () => within(await screen.findByRole("region", { name: "Instrument" }));

const auswertung = {
  buchwertVorher: "1012000.00",
  buchwertAbgang: "1012000.00",
  erloes: "1500000.00",
  ergebnis: "488000.00",
  barzufluss: "1450000.00",
  schritte: [{ zeichen: "=", bezeichnung: "Erlös", wert: "1500000" }],
};
const VORSCHAU = `POST /api/v1/beteiligungen/${BET_ID}/verkauf/vorschau`;
const BUCHEN = `POST /api/v1/beteiligungen/${BET_ID}/verkauf`;

const verkauf = (extra: Record<string, unknown> = {}) => ({
  id: "vk1",
  beteiligungId: BET_ID,
  datum: "2026-10-01",
  anteilVerkauft: "1.000000",
  kaufpreis: "1500000.00",
  kosten: "0.00",
  buchwertAbgang: "1012000.00",
  erloes: "1500000.00",
  ergebnis: "488000.00",
  schritte: [],
  anpassungen: [],
  ergebnisMitAnpassungen: "488000.00",
  storniertAm: null,
  storniertVon: null,
  ...extra,
});
const mitVerkauf = (extra: Record<string, unknown> = {}) => ({ [`/api/v1/beteiligungen/${BET_ID}/instrumentdaten`]: { koerper: { ...instrumentDaten, verkaeufe: [verkauf(extra)] } } });

describe("Verkauf: Vorschau vor dem Buchen", () => {
  it("zeigt die Auswertung des Servers vor dem Buchen und bucht nur mit unveränderten Eingaben", async () => {
    const api = spieleApi({
      [VORSCHAU]: { koerper: { vorschau: true, ergebnis: auswertung, forderung: { art: "treuhand", betrag: "50000.00", faelligAm: "2027-06-30" }, verkaeuferdarlehen: { betrag: "100000.00", schuldnerOrganisationId: null }, status: "exit" } },
      [BUCHEN]: { status: 201, koerper: { verkauf: {}, ergebnis: auswertung, forderung: null, verkaeuferdarlehenBeteiligungId: null, status: "exit" } },
    });
    rendereApp(url);
    const nutzer = userEvent.setup();
    await waehleAktion(nutzer, "Verkauf");
    const d = dialog();
    await nutzer.type(d.getByLabelText("Kaufpreis in Euro"), "1550000");
    expect(d.queryByRole("button", { name: "Verkauf buchen" })).toBeNull();
    await nutzer.click(d.getByRole("button", { name: "Vorschau berechnen" }));

    const vorschau = within(await d.findByRole("group", { name: "Vorschau des Verkaufs" }));
    expect(vorschau.getByText("Noch nichts gebucht. Bitte die Auswertung prüfen.")).toBeTruthy();
    expect(schmal(vorschau.getByText("Buchwertabgang").parentElement!.textContent)).toContain("1.012.000,00 €");
    expect(schmal(vorschau.getByText("Gewinn").parentElement!.textContent)).toContain("488.000,00 €");
    expect(schmal(vorschau.getByText(/Treuhandforderung über/).textContent)).toContain("50.000,00 €, fällig am 30.06.2027");
    expect(schmal(vorschau.getByText(/Verkäuferdarlehen über/).textContent)).toContain("100.000,00 €");
    expect(api.anfragen("POST", `/api/v1/beteiligungen/${BET_ID}/verkauf/vorschau`)[0]!.koerper).toMatchObject({ kaufpreis: "1550000", anteilVerkauft: "1" });
    expect(api.anfragen("POST", `/api/v1/beteiligungen/${BET_ID}/verkauf`)).toHaveLength(0);
    const buchen = vorschau.getByRole("button", { name: "Verkauf buchen" }) as HTMLButtonElement;
    expect(buchen.disabled).toBe(false);

    // Eine Änderung der Eingaben macht die Vorschau ungültig
    await nutzer.type(d.getByLabelText("Kosten in Euro (optional)"), "1000");
    expect(d.getByText(de.verkaufForm.veraltet)).toBeTruthy();
    expect((vorschau.getByRole("button", { name: "Verkauf buchen" }) as HTMLButtonElement).disabled).toBe(true);
    await nutzer.click(d.getByRole("button", { name: "Vorschau berechnen" }));
    // die Vorschau wird neu aufgebaut, daher frisch abfragen
    await waitFor(() => expect((d.getByRole("button", { name: "Verkauf buchen" }) as HTMLButtonElement).disabled).toBe(false));
    await nutzer.click(d.getByRole("button", { name: "Verkauf buchen" }));
    expect(await d.findByText("Der Verkauf ist gebucht.")).toBeTruthy();
    expect(api.anfragen("POST", `/api/v1/beteiligungen/${BET_ID}/verkauf`)).toHaveLength(1);
  });

  it("zeigt Prüffehler der Vorschau am Feld und bucht nichts", async () => {
    const api = spieleApi({ [VORSCHAU]: fehler(400, "invalid_input", { felder: [{ feld: "kaufpreis", code: "invalid_format", meldung: "x" }] }) });
    rendereApp(url);
    const nutzer = userEvent.setup();
    await waehleAktion(nutzer, "Verkauf");
    await nutzer.type(dialog().getByLabelText("Kaufpreis in Euro"), "1550000");
    await nutzer.click(dialog().getByRole("button", { name: "Vorschau berechnen" }));
    expect(await dialog().findByText(de.feldfehler.invalid_format)).toBeTruthy();
    expect(dialog().queryByRole("button", { name: "Verkauf buchen" })).toBeNull();
    expect(api.anfragen("POST", `/api/v1/beteiligungen/${BET_ID}/verkauf`)).toHaveLength(0);
  });
});

describe("Verkauf: Prüfung am Feld", () => {
  it("meldet Pflichtangaben und Grenzen am Feld und sendet nichts", async () => {
    const api = spieleApi({});
    rendereApp(url);
    const nutzer = userEvent.setup();
    await waehleAktion(nutzer, "Verkauf");
    const d = dialog();
    const f = feldpruefungTexte.de;
    // Kaufpreis fehlt, Anteil 0 und ein Darlehen ohne Satz und Fälligkeit
    await nutzer.clear(d.getByLabelText(/^Verkaufter Anteil/));
    await nutzer.type(d.getByLabelText(/^Verkaufter Anteil/), "0");
    await nutzer.type(d.getByLabelText(/^Verkäuferdarlehen in Euro/), "100000");
    await nutzer.click(d.getByRole("button", { name: "Vorschau berechnen" }));
    expect(d.getAllByText(f.pflicht).length).toBeGreaterThanOrEqual(3);
    expect(d.getByText(f.bereich(0, 100))).toBeTruthy();
    expect(api.anfragen("POST", VORSCHAU)).toHaveLength(0);
    // ein falsches Zeichen wird sofort gemeldet
    await nutzer.type(d.getByLabelText("Kaufpreis in Euro"), "12x");
    expect(d.getByText(f.zahlFormat)).toBeTruthy();
  });
});

describe("Verkauf stornieren", () => {
  it("storniert den ganzen Verkauf mit Grund", async () => {
    const api = spieleApi({ ...mitVerkauf(), "POST /api/v1/verkaeufe/vk1/storno": { status: 201, koerper: { verkauf: verkauf({ storniertAm: "2026-11-21T08:00:00.000Z" }) } } });
    rendereApp(url);
    const nutzer = userEvent.setup();
    await nutzer.click(await (await abschnitt()).findByRole("button", { name: "Verkauf stornieren: vom 01.10.2026" }));
    const d = dialog();
    expect(d.getByText(/die Bewertung des Verkaufs wird zurückgenommen/)).toBeTruthy();
    await nutzer.type(d.getByLabelText("Grund"), "Erfassung am falschen Datum");
    await nutzer.click(d.getByRole("button", { name: "Verkauf stornieren" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.anfragen("POST", "/api/v1/verkaeufe/vk1/storno")[0]!.koerper).toEqual({ grund: "Erfassung am falschen Datum" });
  });

  it("übersetzt die Ablehnungsgründe des Stornos", async () => {
    const codes = ["sale_already_reversed", "sale_reversal_later_sale", "sale_reversal_loan_used", "sale_reversal_exceeds_sale", "receivable_reversed"] as const;
    for (const code of codes) {
      spieleApi({ ...mitVerkauf(), "POST /api/v1/verkaeufe/vk1/storno": fehler(409, code) });
      const { unmount } = rendereApp(url);
      const nutzer = userEvent.setup();
      await nutzer.click(await (await abschnitt()).findByRole("button", { name: "Verkauf stornieren: vom 01.10.2026" }));
      await nutzer.type(dialog().getByLabelText("Grund"), "Test");
      await nutzer.click(dialog().getByRole("button", { name: "Verkauf stornieren" }));
      expect((await dialog().findByRole("alert")).textContent).toContain(de.fehler[code]);
      expect(screen.getByRole("dialog")).toBeTruthy();
      unmount();
    }
  });

  it("nennt bei gesperrter Periode das Sperrdatum und übersetzt ins Englische", async () => {
    spieleApi({ ...mitVerkauf(), "POST /api/v1/verkaeufe/vk1/storno": fehler(409, "period_locked", { gesperrtBis: "2026-09-30" }) });
    localStorage.setItem("carraway.sprache", "en");
    rendereApp(url);
    const nutzer = userEvent.setup();
    await nutzer.click(await (await abschnitt()).findByRole("button", { name: "Reverse sale of 01/10/2026" }));
    await nutzer.type(dialog().getByLabelText("Reason"), "Test");
    await nutzer.click(dialog().getByRole("button", { name: "Reverse sale" }));
    const hinweis = await dialog().findByRole("alert");
    expect(hinweis.textContent).toContain(en.fehler.period_locked);
    expect(hinweis.textContent).toContain("30/09/2026");
    localStorage.removeItem("carraway.sprache");
  });

  it("zeigt einen stornierten Verkauf als storniert mit Person und ohne Knopf, und blendet das Stornieren für Betrachter aus", async () => {
    spieleApi(mitVerkauf({ storniertAm: "2026-11-21T08:00:00.000Z", storniertVon: ICH_ID }));
    const { unmount } = rendereApp(url);
    const inst = await abschnitt();
    expect(await inst.findByText("Storniert")).toBeTruthy();
    expect(await inst.findByText(/Storniert von Vera Beispiel am/)).toBeTruthy();
    expect(inst.queryByRole("button", { name: /stornieren/ })).toBeNull();
    unmount();

    spieleApi({ ...mitVerkauf(), "/api/v1/me": alsRolle("betrachter") });
    rendereApp(url);
    await (await abschnitt()).findByRole("heading", { name: /Verkäufe · 01\.10\.2026/ });
    expect(screen.queryByRole("button", { name: /Verkauf vom .* stornieren/ })).toBeNull();
  });
});

describe("Exit mit Buchwert oder offenem Kapital (Issue #193)", () => {
  const exit = (buchwert: string, offenesKapital: string) => ({
    [`/api/v1/beteiligungen/${BET_ID}/instrumentdaten`]: {
      koerper: {
        ...instrumentDaten,
        beteiligung: { ...instrumentDaten.beteiligung, status: "exit" },
        instrumente: instrumentDaten.instrumente.map((i) => ({ ...i, status: "verkauft", offenesKapital, buchwert })),
        zustand: { ...instrumentDaten.zustand, offenesKapital },
        buchwert: { ...instrumentDaten.buchwert, wert: buchwert },
      },
    },
  });

  it("weist auf stehengebliebenen Buchwert hin, statt ihn zu verstecken", async () => {
    spieleApi(exit("1012000.00", "1012000.00"));
    rendereApp(url);
    const inst = await abschnitt();
    expect(await inst.findByText(de.inst.exitMitRest)).toBeTruthy();
    expect(inst.getAllByText("1.012.000,00 €").length).toBeGreaterThan(0);
  });

  it("weist auch auf offenes Kapital eines Darlehens hin, wenn der Buchwert schon null ist", async () => {
    spieleApi(exit("0.00", "250000.00"));
    rendereApp(url);
    expect(await (await abschnitt()).findByText(de.inst.exitMitRest)).toBeTruthy();
  });

  it("zeigt keinen Hinweis, wenn Buchwert und offenes Kapital null sind", async () => {
    spieleApi(exit("0.00", "0.00"));
    rendereApp(url);
    const inst = await abschnitt();
    expect(await inst.findByText(de.inst.nichtAktiv)).toBeTruthy();
    expect(inst.queryByText(de.inst.exitMitRest)).toBeNull();
  });
});
