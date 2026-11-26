import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { BET_ID, INSTR_ID, KLASSE_ID, MS_OFFEN, beteiligungDaten, fehler, hauptInstrument, instrumentDaten, instrumentZeile, rendereApp, spieleApi, trancheZeile, waehleAktion, zinsenDaten } from "../test/hilfen";
import type { Anfrage } from "../test/hilfen";

/** Bereiche Instrumente, Zinsen, Transaktionen, Vorgang erfassen und Wertberichtigung bei einer Beteiligung mit zwei Instrumenten (Darlehen und Eigenkapital). */

const url = `/beteiligungen/${BET_ID}`;
const instrumenteUrl = `${url}?tab=finanzierung&unter=instrumente`;
const zinsenUrl = `${url}?tab=finanzierung&unter=zinsen`;
const vorgaengeUrl = `${url}?tab=finanzierung&unter=transaktionen`;
const SEED_ID = "i2";
const T_SEED = "t-seed";
const schmal = (text: string | null) => (text ?? "").replace(/\s/g, " ");
const dialog = () => within(screen.getByRole("dialog"));

const seed = instrumentZeile(SEED_ID, "Seed-Anteile", "offene_beteiligung", {
  istHauptinstrument: false,
  runde: { id: "r1", bezeichnung: "Seed" },
  anteilsklasse: { id: KLASSE_ID, name: "Serie Seed" },
  zusage: "500000.00",
  ausgezahlt: "100000.00",
  offeneZusage: "400000.00",
  kapitalisiert: "0.00",
  zinsen: "0.00",
  buchwert: "100000.00",
  tranchen: [trancheZeile(T_SEED, SEED_ID, 1, "Erste Rate", "300000.00", { geplantAm: "2026-12-31" }, { zahlung: "teilweise_gezahlt", ausgezahlt: "100000.00", offen: "200000.00" })],
});
const zweiDaten = { ...instrumentDaten, instrumente: [hauptInstrument, seed] };
const vorgangZeile = (id: string, art: string, valuta: string, betrag: string, extra: Record<string, unknown> = {}) => ({ ...beteiligungDaten.vorgaenge[0]!, id, art, valuta, betrag, ...extra });
const zweiDetail = {
  ...beteiligungDaten,
  instrumente: [hauptInstrument, seed],
  vorgaenge: [
    vorgangZeile("a1", "auszahlung", "2021-07-31", "1000000.00"),
    vorgangZeile("a2", "auszahlung", "2022-01-31", "100000.00", { instrumentId: SEED_ID, instrumentBezeichnung: "Seed-Anteile", trancheId: T_SEED }),
    vorgangZeile("a3", "zins", "2022-12-31", "12000.00", { kapitalisiert: true }),
    vorgangZeile("a4", "zinszahlung", "2023-01-15", "5000.00"),
    vorgangZeile("a5", "dividende", "2024-06-30", "2000.00", { instrumentId: SEED_ID, instrumentBezeichnung: "Seed-Anteile" }),
    vorgangZeile("a6", "wertberichtigung", "2025-12-31", "30000.00"),
  ],
};
const zweiInstrumente = {
  [`/api/v1/beteiligungen/${BET_ID}/instrumentdaten`]: { koerper: zweiDaten },
  [`/api/v1/beteiligungen/${BET_ID}`]: (a: Anfrage) => ({ koerper: { ...zweiDetail, stichtag: a.query.get("stichtag") ?? zweiDetail.stichtag } }),
};

describe("Bereich Instrumente", () => {
  it("zeigt zwei Instrumente mit Tranchen; Wandlung und Konditionen nur beim passenden Instrument", async () => {
    spieleApi(zweiInstrumente);
    rendereApp(instrumenteUrl);
    const inst = within(await screen.findByRole("region", { name: "Instrumente" }));
    const darlehen = await inst.findByRole("group", { name: /^Wandeldarlehen 2021/ });
    const eigen = inst.getByRole("group", { name: /^Seed-Anteile/ });
    expect(within(darlehen).getByRole("button", { name: "Wandlung: Wandeldarlehen 2021" })).toBeTruthy();
    expect(within(darlehen).getByRole("button", { name: "Konditionen: Wandeldarlehen 2021" })).toBeTruthy();
    expect(within(eigen).queryByRole("button", { name: /^Wandlung/ })).toBeNull();
    expect(within(eigen).queryByRole("button", { name: /^Konditionen/ })).toBeNull();
    expect(schmal(eigen.textContent)).toContain("Serie Seed");
    expect(schmal(eigen.textContent)).toContain("500.000,00 €");
    expect(within(eigen).getByText("0 von 1 gezahlt")).toBeTruthy();
    const zeile = within(eigen).getAllByRole("row")[1]!;
    expect(zeile.textContent).toContain("Erste Rate");
    expect(zeile.textContent).toContain("Teilweise gezahlt");
    expect(inst.getByRole("button", { name: "Instrument anlegen" })).toBeTruthy();
  });

  it("zeigt den Verzicht nur am Darlehen und verlangt nach geänderten Beträgen eine neue Vorschau", async () => {
    const pfad = `/api/v1/instruments/${INSTR_ID}/waivers`;
    const antwort = { result: { remainingPrincipal: "750.00", remainingCarryingAmount: "600.00", impairmentUsed: "50.00", loss: "200.00", steps: [] } };
    const api = spieleApi({ ...zweiInstrumente, [pfad]: { koerper: { data: [] } }, [`POST ${pfad}/preview`]: { koerper: antwort }, [`POST ${pfad}`]: { status: 201, koerper: antwort } });
    rendereApp(instrumenteUrl);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Verzicht: Wandeldarlehen 2021" }));
    expect(screen.queryByRole("button", { name: "Verzicht: Seed-Anteile" })).toBeNull();
    const d = within(await screen.findByRole("dialog"));
    await nutzer.type(d.getByLabelText("Verzicht auf Kapital"), "250");
    await nutzer.type(d.getByLabelText("Grund"), "Vertragsänderung");
    await nutzer.click(d.getByRole("button", { name: "Vorschau" }));
    expect(await d.findByText("Verbrauchte Wertberichtigung")).toBeTruthy();
    await nutzer.type(d.getByLabelText("Verzicht auf Zinsen"), "10");
    expect(d.queryByRole("button", { name: "Verzicht buchen" })).toBeNull();
    await nutzer.click(d.getByRole("button", { name: "Vorschau" }));
    await nutzer.click(await d.findByRole("button", { name: "Verzicht buchen" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.anfragen("POST", pfad)).toHaveLength(1);
  });

  it("legt ein Instrument mit erster Tranche an: erst das Instrument, dann die Tranche samt Zusage; ein Fehler bei der Tranche legt kein zweites Instrument an", async () => {
    let versuche = 0;
    const api = spieleApi({
      ...zweiInstrumente,
      [`/api/v1/organisationen/${beteiligungDaten.organisation.id}/finanzierungsrunden`]: { koerper: { daten: [{ id: "r1", bezeichnung: "Seed" }] } },
      [`POST /api/v1/beteiligungen/${BET_ID}/instrumente`]: { status: 201, koerper: { id: "i3" } },
      "POST /api/v1/instrumente/i3/tranchen": () => {
        versuche++;
        return versuche === 1 ? fehler(409, "tranches_exceed_commitment") : { status: 201, koerper: {} };
      },
    });
    rendereApp(instrumenteUrl);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Instrument anlegen" }));
    await screen.findByRole("dialog");
    const d = dialog();
    expect(within(d.getByLabelText("Art")).getAllByRole("option").map((o) => o.textContent)).toContain("Venture Debt");
    expect(within(d.getByLabelText("Art")).getAllByRole("option").map((o) => o.textContent)).toContain("Gesellschafterdarlehen");
    await nutzer.selectOptions(d.getByLabelText("Art"), "venture_debt");
    await nutzer.type(d.getByLabelText("Bezeichnung (optional)"), "Venture Debt 2026");
    await nutzer.selectOptions(d.getByLabelText("Runde (optional)"), "r1");
    await nutzer.type(d.getByLabelText("Betrag in Euro"), "750000");
    await nutzer.click(d.getByRole("button", { name: "Instrument anlegen" }));
    expect(await d.findByText(/Das Instrument ist angelegt, die Tranche nicht/)).toBeTruthy();
    await nutzer.click(d.getByRole("button", { name: "Instrument anlegen" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.anfragen("POST", `/api/v1/beteiligungen/${BET_ID}/instrumente`)).toHaveLength(1);
    expect(api.anfragen("POST", `/api/v1/beteiligungen/${BET_ID}/instrumente`)[0]!.koerper).toEqual({ art: "venture_debt", bezeichnung: "Venture Debt 2026", rundeId: "r1" });
    const tranchen = api.anfragen("POST", "/api/v1/instrumente/i3/tranchen");
    expect(tranchen).toHaveLength(2);
    expect(tranchen[1]!.koerper).toMatchObject({ betrag: "750000", zusageErhoehen: true });
  });
});

describe("Tranche anlegen", () => {
  it("bietet „Zusage erhöhen“ vorbelegt an, wenn die Tranche die Zusage übersteigt, und sendet zusageErhoehen", async () => {
    const api = spieleApi({ ...zweiInstrumente, [`POST /api/v1/instrumente/${SEED_ID}/tranchen`]: { status: 201, koerper: {} } });
    rendereApp(instrumenteUrl);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Tranche anlegen: Seed-Anteile" }));
    const d = await screen.findByRole("dialog").then((e) => within(e));
    // Zusage 500.000, Tranchen bisher 300.000: 100.000 reichen
    await nutzer.type(d.getByLabelText("Betrag in Euro"), "100000");
    expect(d.queryByText("Zusage erhöhen")).toBeNull();
    await nutzer.clear(d.getByLabelText("Betrag in Euro"));
    await nutzer.type(d.getByLabelText("Betrag in Euro"), "300000");
    expect(d.getByRole("button", { name: "Ja" }).getAttribute("aria-pressed")).toBe("true");
    expect(schmal(d.getByText(/übersteigt die Zusage um/).textContent)).toContain("100.000,00 €");
    await nutzer.type(d.getByLabelText("Bezeichnung"), "Zweite Rate");
    await nutzer.type(d.getByLabelText("Bedingung (optional)"), "Meilenstein erreicht");
    fireEvent.change(d.getByLabelText("Geplant am (optional)"), { target: { value: "2027-06-30" } });
    await nutzer.click(d.getByRole("button", { name: "Tranche speichern" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const koerper = api.anfragen("POST", `/api/v1/instrumente/${SEED_ID}/tranchen`)[0]!.koerper as Record<string, unknown>;
    expect(koerper).toMatchObject({ bezeichnung: "Zweite Rate", betrag: "300000", bedingung: "Meilenstein erreicht", geplantAm: "2027-06-30", zusageErhoehen: true });
  });

  it("sendet ohne Überschreitung kein zusageErhoehen; „Nein“ lässt die API den Fehler melden", async () => {
    const api = spieleApi({
      ...zweiInstrumente,
      [`POST /api/v1/instrumente/${SEED_ID}/tranchen`]: (a) => ((a.koerper as Record<string, unknown>).zusageErhoehen ? { status: 201, koerper: {} } : (a.koerper as { betrag: string }).betrag === "100000" ? { status: 201, koerper: {} } : fehler(409, "tranches_exceed_commitment")),
    });
    rendereApp(instrumenteUrl);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Tranche anlegen: Seed-Anteile" }));
    const d = await screen.findByRole("dialog").then((e) => within(e));
    await nutzer.type(d.getByLabelText("Betrag in Euro"), "300000");
    await nutzer.click(d.getByRole("button", { name: "Nein" }));
    await nutzer.click(d.getByRole("button", { name: "Tranche speichern" }));
    expect((await d.findByRole("alert")).textContent).toContain("Die Tranchen würden die Zusage des Instruments übersteigen");
    expect(api.anfragen("POST", `/api/v1/instrumente/${SEED_ID}/tranchen`)[0]!.koerper).not.toHaveProperty("zusageErhoehen");
    await nutzer.clear(d.getByLabelText("Betrag in Euro"));
    await nutzer.type(d.getByLabelText("Betrag in Euro"), "100000");
    await nutzer.click(d.getByRole("button", { name: "Tranche speichern" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.anfragen("POST", `/api/v1/instrumente/${SEED_ID}/tranchen`)[1]!.koerper).toEqual({ bezeichnung: "Tranche 2", betrag: "100000" });
  });

  it("Instrument bearbeiten: die Art ist änderbar, solange es keine Vorgänge, Tranchen oder Konditionen gibt, sonst gesperrt mit Hinweis", async () => {
    const leer = instrumentZeile("i3", "Neues Instrument", "offene_beteiligung", {
      istHauptinstrument: false,
      zusage: "0.00",
      ausgezahlt: "0.00",
      offeneZusage: "0.00",
      kapitalisiert: "0.00",
      zinsen: "0.00",
      buchwert: "0.00",
      tranchen: [],
    });
    const api = spieleApi({
      ...zweiInstrumente,
      [`/api/v1/beteiligungen/${BET_ID}/instrumentdaten`]: { koerper: { ...zweiDaten, instrumente: [hauptInstrument, seed, leer] } },
      "PATCH /api/v1/instrumente/i3": { koerper: {} },
    });
    rendereApp(instrumenteUrl);
    const nutzer = userEvent.setup();
    // Mit Tranchen (Seed-Anteile): gesperrt, Hinweis
    await nutzer.click(await screen.findByRole("button", { name: "Bearbeiten: Seed-Anteile" }));
    let d = await screen.findByRole("dialog").then((e) => within(e));
    expect((d.getByLabelText("Art") as HTMLSelectElement).disabled).toBe(true);
    expect(d.getByText(/Die Art lässt sich nicht mehr ändern/)).toBeTruthy();
    await nutzer.click(d.getByRole("button", { name: "Schließen" }));
    // Leer: änderbar; nur die geänderte Art geht mit
    await nutzer.click(await screen.findByRole("button", { name: "Bearbeiten: Neues Instrument" }));
    d = await screen.findByRole("dialog").then((e) => within(e));
    const art = d.getByLabelText("Art") as HTMLSelectElement;
    expect(art.disabled).toBe(false);
    await nutzer.selectOptions(art, "gesellschafterdarlehen");
    await nutzer.click(d.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(api.anfragen("PATCH", "/api/v1/instrumente/i3")).toHaveLength(1));
    expect(api.anfragen("PATCH", "/api/v1/instrumente/i3")[0]!.koerper).toMatchObject({ art: "gesellschafterdarlehen", bezeichnung: "Neues Instrument" });
  });

  it("ändert eine Tranche", async () => {
    const api = spieleApi({ ...zweiInstrumente, [`PATCH /api/v1/tranchen/${MS_OFFEN}`]: { koerper: {} } });
    rendereApp(instrumenteUrl);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Tranche Umsatzziel bearbeiten" }));
    const d = await screen.findByRole("dialog").then((e) => within(e));
    expect((d.getByLabelText("Betrag in Euro") as HTMLInputElement).value).toBe("600000");
    await nutzer.clear(d.getByLabelText("Betrag in Euro"));
    await nutzer.type(d.getByLabelText("Betrag in Euro"), "550000");
    await nutzer.click(d.getByRole("button", { name: "Tranche speichern" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.anfragen("PATCH", `/api/v1/tranchen/${MS_OFFEN}`)[0]!.koerper).toMatchObject({ bezeichnung: "Umsatzziel", betrag: "550000", bedingung: "Umsatz über 2 Mio. €" });
  });

  it("Wandeldarlehen bearbeiten: Parameter anzeigen, Prozent als Bruch senden, leer als null; andere Arten haben die Felder nicht", async () => {
    const wandel = { ...hauptInstrument, wandlungsabschlag: "0.200000", bewertungsobergrenze: "6000000.00", zinsenWandeln: false };
    const api = spieleApi({
      ...zweiInstrumente,
      [`/api/v1/beteiligungen/${BET_ID}/instrumentdaten`]: { koerper: { ...zweiDaten, instrumente: [wandel, seed] } },
      [`PATCH /api/v1/instrumente/${INSTR_ID}`]: { koerper: {} },
    });
    rendereApp(instrumenteUrl);
    const nutzer = userEvent.setup();
    // Anzeige an der Karte
    const karte = (await screen.findByText("Wandeldarlehen 2021")).closest("section, article, div")!.parentElement!;
    expect(within(karte).getByText("20 %", { exact: false })).toBeTruthy();
    expect(within(karte).getByText("Zinsen wandeln mit")).toBeTruthy();
    // Dialog: vorbelegt, ändern, leeren
    await nutzer.click(await screen.findByRole("button", { name: "Bearbeiten: Wandeldarlehen 2021" }));
    let d = await screen.findByRole("dialog").then((e) => within(e));
    expect((d.getByLabelText("Wandlungsabschlag in Prozent") as HTMLInputElement).value).toBe("20");
    expect((d.getByLabelText("Bewertungsobergrenze in EUR") as HTMLInputElement).value).toBe("6000000");
    expect((d.getByLabelText("Zinsen wandeln mit") as HTMLSelectElement).value).toBe("nein");
    await nutzer.clear(d.getByLabelText("Wandlungsabschlag in Prozent"));
    await nutzer.type(d.getByLabelText("Wandlungsabschlag in Prozent"), "12,5");
    await nutzer.clear(d.getByLabelText("Bewertungsobergrenze in EUR"));
    await nutzer.selectOptions(d.getByLabelText("Zinsen wandeln mit"), "ja");
    await nutzer.click(d.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(api.anfragen("PATCH", `/api/v1/instrumente/${INSTR_ID}`)).toHaveLength(1));
    expect(api.anfragen("PATCH", `/api/v1/instrumente/${INSTR_ID}`)[0]!.koerper).toMatchObject({ wandlungsabschlag: "0.125", bewertungsobergrenze: null, zinsenWandeln: true });
    // Anderes Instrument: keine Wandlungsfelder
    await nutzer.click(await screen.findByRole("button", { name: "Bearbeiten: Seed-Anteile" }));
    d = await screen.findByRole("dialog").then((e) => within(e));
    expect(d.queryByLabelText("Wandlungsabschlag in Prozent")).toBeNull();
  });

  it("Abschlag über 100 Prozent wird am Feld abgewiesen, ohne Anfrage", async () => {
    const api = spieleApi({ ...zweiInstrumente, [`PATCH /api/v1/instrumente/${INSTR_ID}`]: { koerper: {} } });
    rendereApp(instrumenteUrl);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Bearbeiten: Wandeldarlehen 2021" }));
    const d = await screen.findByRole("dialog").then((e) => within(e));
    await nutzer.type(d.getByLabelText("Wandlungsabschlag in Prozent"), "120");
    await nutzer.click(d.getByRole("button", { name: "Speichern" }));
    expect(api.anfragen("PATCH", `/api/v1/instrumente/${INSTR_ID}`)).toHaveLength(0);
    expect(d.getByLabelText("Wandlungsabschlag in Prozent").getAttribute("aria-invalid")).toBe("true");
  });

  it("Wandlung wird mit den Parametern des Instruments vorbelegt", async () => {
    const wandel = { ...hauptInstrument, wandlungsabschlag: "0.200000", bewertungsobergrenze: "6000000.00", zinsenWandeln: false };
    spieleApi({ ...zweiInstrumente, [`/api/v1/beteiligungen/${BET_ID}/instrumentdaten`]: { koerper: { ...zweiDaten, instrumente: [wandel, seed] } } });
    rendereApp(instrumenteUrl);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Wandlung: Wandeldarlehen 2021" }));
    const d = await screen.findByRole("dialog").then((e) => within(e));
    expect((d.getByLabelText(/Discount|Abschlag/i) as HTMLInputElement).value).toBe("20");
    expect((d.getByLabelText(/Bewertungsobergrenze in Euro/) as HTMLInputElement).value).toBe("6000000");
  });

  it("öffnet die Wandlung für genau das Wandeldarlehen", async () => {
    spieleApi(zweiInstrumente);
    rendereApp(instrumenteUrl);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Wandlung: Wandeldarlehen 2021" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });
});

describe("Vorgang erfassen mit mehreren Instrumenten", () => {
  const optionen = (el: HTMLElement) => within(el).getAllByRole("option").map((o) => o.textContent);

  it("gruppiert die Arten, bietet weder Wertberichtigung noch Zusage an und verlangt das Instrument", async () => {
    spieleApi(zweiInstrumente);
    rendereApp(url);
    const nutzer = userEvent.setup();
    await waehleAktion(nutzer, "Vorgang erfassen");
    const d = await screen.findByRole("dialog").then((e) => within(e));
    expect(optionen(d.getByLabelText("Art"))).toEqual(["Auszahlung", "Zinszahlung", "Dividende", "Tilgung", "Verkaufserlös / Rückfluss"]);
    expect(Array.from(d.getByLabelText("Art").querySelectorAll("optgroup")).map((g) => g.label)).toEqual(["Investieren", "Erträge", "Rückflüsse"]);
    expect(d.queryByRole("option", { name: "Wertberichtigung" })).toBeNull();
    expect(d.queryByRole("option", { name: "Zusage" })).toBeNull();
    // zwei Instrumente: keine Vorbelegung, Buchen erst nach der Wahl
    expect((d.getByLabelText("Instrument") as HTMLSelectElement).value).toBe("");
    expect((d.getByRole("button", { name: "Vorgang buchen" }) as HTMLButtonElement).disabled).toBe(true);
    // „Zusage“ geht über die Tranche
    expect(d.getByRole("button", { name: "Tranche anlegen" })).toBeTruthy();
  });

  it("zeigt je Instrument nur die offenen Tranchen und sendet Instrument und Tranche", async () => {
    const api = spieleApi({ ...zweiInstrumente, [`POST /api/v1/investments/${BET_ID}/transactions`]: { status: 201, koerper: { transaction: {}, bookValue: "1100000.00" } } });
    rendereApp(url);
    const nutzer = userEvent.setup();
    await waehleAktion(nutzer, "Vorgang erfassen");
    const d = await screen.findByRole("dialog").then((e) => within(e));
    await nutzer.selectOptions(d.getByLabelText("Instrument"), INSTR_ID);
    expect(optionen(d.getByLabelText("Tranche (optional)")).map((o) => o?.replace(/\s+/g, " "))).toEqual([
      "Keine Tranche",
      expect.stringContaining("1. Produktfreigabe"),
      expect.stringContaining("2. Umsatzziel"),
    ]);
    await nutzer.selectOptions(d.getByLabelText("Instrument"), SEED_ID);
    expect(optionen(d.getByLabelText("Tranche (optional)"))).toHaveLength(2);
    await nutzer.selectOptions(d.getByLabelText("Tranche (optional)"), T_SEED);
    await nutzer.type(d.getByLabelText("Betrag in Euro"), "50000");
    await nutzer.click(d.getByRole("button", { name: "Vorgang buchen" }));
    expect(await d.findByText(/Der Buchwert beträgt jetzt 1\.100\.000,00/)).toBeTruthy();
    expect(api.anfragen("POST", `/api/v1/investments/${BET_ID}/transactions`)[0]!.koerper).toMatchObject({ type: "disbursement", instrumentId: SEED_ID, trancheId: T_SEED, amount: "50000" });
  });

  it("lässt je Art nur passende Instrumente zu: Zinszahlung nur Darlehen (vorbelegt, mit offenen Zinsbuchungen), Dividende nur Eigenkapital", async () => {
    const api = spieleApi({ ...zweiInstrumente, [`POST /api/v1/investments/${BET_ID}/transactions`]: { status: 201, koerper: { transaction: {}, bookValue: "1012000.00" } } });
    rendereApp(url);
    const nutzer = userEvent.setup();
    await waehleAktion(nutzer, "Vorgang erfassen");
    const d = await screen.findByRole("dialog").then((e) => within(e));
    await nutzer.selectOptions(d.getByLabelText("Art"), "dividende");
    expect(optionen(d.getByLabelText("Instrument"))).toEqual(["Seed-Anteile"]);
    expect((d.getByLabelText("Instrument") as HTMLSelectElement).value).toBe(SEED_ID);
    await nutzer.selectOptions(d.getByLabelText("Art"), "zinszahlung");
    expect(optionen(d.getByLabelText("Instrument"))).toEqual(["Wandeldarlehen 2021"]);
    expect((d.getByLabelText("Instrument") as HTMLSelectElement).value).toBe(INSTR_ID);
    const begleicht = await d.findByLabelText("Begleicht Zinsbuchung (optional)");
    expect(optionen(begleicht).map((o) => schmal(o))).toEqual(["Keine bestimmte Zinsbuchung", "Zinsbuchung bis 31.12.2025 (offen 25.000 €)"]);
    await nutzer.selectOptions(begleicht, "z2");
    await nutzer.type(d.getByLabelText("Betrag in Euro"), "25000");
    await nutzer.click(d.getByRole("button", { name: "Vorgang buchen" }));
    await d.findByText(/Der Buchwert beträgt jetzt/);
    expect(api.anfragen("POST", `/api/v1/investments/${BET_ID}/transactions`)[0]!.koerper).toMatchObject({ type: "interest_payment", instrumentId: INSTR_ID, settledTransactionId: "z2", amount: "25000" });
  });

  it("zeigt Fehler zu Instrument und Tranche mit ihren Texten", async () => {
    spieleApi({ ...zweiInstrumente, [`POST /api/v1/investments/${BET_ID}/transactions`]: fehler(409, "instrument_not_active") });
    rendereApp(url);
    const nutzer = userEvent.setup();
    await waehleAktion(nutzer, "Vorgang erfassen");
    const d = await screen.findByRole("dialog").then((e) => within(e));
    await nutzer.selectOptions(d.getByLabelText("Instrument"), INSTR_ID);
    await nutzer.type(d.getByLabelText("Betrag in Euro"), "1000");
    await nutzer.click(d.getByRole("button", { name: "Vorgang buchen" }));
    expect((await d.findByRole("alert")).textContent).toContain("Das Instrument ist nicht aktiv");
  });

  it("verweist von „Tranche anlegen“ im Dialog auf den Tranchendialog", async () => {
    spieleApi(zweiInstrumente);
    rendereApp(url);
    const nutzer = userEvent.setup();
    await waehleAktion(nutzer, "Vorgang erfassen");
    const d = await screen.findByRole("dialog").then((e) => within(e));
    await nutzer.click(d.getByRole("button", { name: "Tranche anlegen" }));
    expect(await screen.findByRole("heading", { name: "Tranche anlegen" })).toBeTruthy();
  });
});

describe("Bereich Zinsen", () => {
  it("zeigt Summen, Konditionen, Fälligkeit und die Perioden mit Status; die laufende Periode ist markiert", async () => {
    spieleApi(zweiInstrumente);
    rendereApp(zinsenUrl);
    const bereich = within(await screen.findByRole("region", { name: "Zinsen" }));
    const summe = await bereich.findByRole("region", { name: "Summe" });
    expect(schmal(summe.textContent)).toContain("48.500 €");
    expect(schmal(summe.textContent)).toContain("25.000 €");
    const karte = bereich.getByRole("group", { name: /^Wandeldarlehen 2021/ });
    const konditionen = schmal(within(karte).getByRole("heading", { name: "Konditionen" }).closest("section")!.textContent);
    expect(konditionen).toContain("6,5 %");
    expect(konditionen).toContain("31.12.2027");
    expect(schmal(karte.textContent)).toContain("Nächste Fälligkeit");
    expect(karte.textContent).toContain("31.12.2026");
    const zeilen = within(karte).getAllByRole("row");
    expect(zeilen).toHaveLength(4);
    expect(zeilen[1]!.textContent).toContain("Gezahlt");
    expect(zeilen[2]!.textContent).toContain("Offen");
    expect(zeilen[3]!.textContent).toContain("laufend");
    expect(zeilen[3]!.textContent).toContain("Aufgelaufen");
    expect(bereich.getByRole("link", { name: "Zinsläufe des Fonds" }).getAttribute("href")).toContain("/zinslaeufe");
  });

  it("zeigt gewandelte Zinsen als Stand „Gewandelt“ statt „Offen“", async () => {
    const i = zinsenDaten.instrumente[0]!;
    const periode = { ...i.perioden[1]!, gezahlt: "0.00", gewandelt: "25000.00", offen: "0.00", faellig: null as string | null, status: "gewandelt" };
    const daten = { ...zinsenDaten, instrumente: [{ ...i, status: "gewandelt", gebucht: "25000.00", gezahlt: "0.00", gewandelt: "25000.00", offen: "0.00", aufgelaufen: null as string | null, perioden: [periode] }], summe: { ...zinsenDaten.summe, gebucht: "25000.00", gezahlt: "0.00", gewandelt: "25000.00", offen: "0.00" } };
    spieleApi({ ...zweiInstrumente, [`/api/v1/beteiligungen/${BET_ID}/zinsen`]: { koerper: daten } });
    rendereApp(zinsenUrl);
    const summe = await screen.findByRole("region", { name: "Summe" });
    expect(within(summe).getByText("Gewandelt")).toBeTruthy();
    const karte = screen.getByRole("group", { name: /^Wandeldarlehen 2021/ });
    const zeilen = within(karte).getAllByRole("row");
    expect(zeilen).toHaveLength(2);
    expect(zeilen[1]!.textContent).toContain("Gewandelt");
    expect(zeilen[1]!.textContent).not.toContain("Offen");
  });

  it("folgt dem Stichtag der Seite", async () => {
    const api = spieleApi({
      ...zweiInstrumente,
      [`/api/v1/beteiligungen/${BET_ID}/zinsen`]: (a) => ({ koerper: { ...zinsenDaten, stichtag: a.query.get("stichtag") ?? zinsenDaten.stichtag, summe: { ...zinsenDaten.summe, offen: a.query.get("stichtag") === "2026-06-30" ? "7777.00" : zinsenDaten.summe.offen } } }),
    });
    rendereApp(zinsenUrl);
    expect(await screen.findByRole("region", { name: "Summe" })).toBeTruthy();
    expect(api.anfragen("GET", `/api/v1/beteiligungen/${BET_ID}/zinsen`)[0]!.query.get("stichtag")).toBe("2026-09-30");
    fireEvent.change(screen.getByLabelText("Stichtag"), { target: { value: "2026-06-30" } });
    await waitFor(() => expect(api.anfragen("GET", `/api/v1/beteiligungen/${BET_ID}/zinsen`).some((a) => a.query.get("stichtag") === "2026-06-30")).toBe(true));
    await waitFor(() => expect(schmal(screen.getByRole("region", { name: "Summe" }).textContent)).toContain("7.777 €"));
  });

  it("öffnet „Zinszahlung erfassen“ mit Art und Instrument vorbelegt", async () => {
    spieleApi(zweiInstrumente);
    rendereApp(zinsenUrl);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Zinszahlung erfassen: Wandeldarlehen 2021" }));
    const d = await screen.findByRole("dialog").then((e) => within(e));
    expect((d.getByLabelText("Art") as HTMLSelectElement).value).toBe("zinszahlung");
    expect((d.getByLabelText("Instrument") as HTMLSelectElement).value).toBe(INSTR_ID);
  });

  it("fehlt im Verzeichnis, wenn kein Instrument Zinsen trägt", async () => {
    spieleApi({ [`/api/v1/beteiligungen/${BET_ID}`]: { koerper: { ...beteiligungDaten, instrumente: [seed] } } });
    rendereApp(url);
    const nav = await screen.findByRole("navigation", { name: "Bereiche der Beteiligung" });
    expect(within(nav).queryByRole("button", { name: "Zinsen" })).toBeNull();
    expect(within(nav).getByRole("button", { name: "Instrumente" })).toBeTruthy();
  });
});

describe("Transaktionen mit Instrument", () => {
  it("zeigt Instrument und Tranche, kennzeichnet Zinsen, Zinszahlung, Dividende und Wertberichtigung und filtert nach Instrument", async () => {
    spieleApi(zweiInstrumente);
    rendereApp(vorgaengeUrl);
    const nutzer = userEvent.setup();
    const tabelle = within(await screen.findByRole("region", { name: "Vorgänge" })).getByRole("table");
    const kopf = within(tabelle).getAllByRole("columnheader").map((c) => c.textContent);
    expect(kopf.slice(0, 4)).toEqual(["Valuta", "Art", "Instrument", "Tranche"]);
    const zeilen = within(tabelle).getAllByRole("row");
    expect(zeilen).toHaveLength(7);
    const text = (i: number) => schmal(zeilen[i]!.textContent);
    expect(text(2)).toContain("Seed-Anteile");
    expect(within(zeilen[2]!).getAllByRole("cell")[3]!.textContent).toBe("1");
    expect(text(3)).toContain("Zins (kapitalisiert)");
    expect(text(4)).toContain("Zinszahlung");
    expect(text(5)).toContain("Dividende");
    expect(text(6)).toContain("Wertberichtigung bilanziell (Bewertung)");

    await nutzer.selectOptions(screen.getByLabelText("Instrument"), SEED_ID);
    const gefiltert = within(tabelle).getAllByRole("row");
    expect(gefiltert).toHaveLength(3);
    expect(schmal(gefiltert[1]!.textContent)).toContain("Auszahlung");
    expect(schmal(gefiltert[2]!.textContent)).toContain("Dividende");
    await nutzer.selectOptions(screen.getByLabelText("Instrument"), "");
    expect(within(tabelle).getAllByRole("row")).toHaveLength(7);
  });

  it("zeigt den Instrumentfilter nur bei mehr als einem Instrument", async () => {
    spieleApi();
    rendereApp(vorgaengeUrl);
    await screen.findByRole("region", { name: "Vorgänge" });
    expect(screen.queryByLabelText("Instrument")).toBeNull();
  });
});

describe("Wertberichtigung unter Bewertungen", () => {
  const bewertungenUrl = `${url}?tab=bewertung&unter=bewertungen`;

  it("bucht eine bilanzielle Wertberichtigung auf das gewählte Instrument und erklärt, dass sie den Buchwert senkt", async () => {
    const api = spieleApi({ ...zweiInstrumente, [`POST /api/v1/investments/${BET_ID}/transactions`]: { status: 201, koerper: { transaction: {}, bookValue: "982000.00" } } });
    rendereApp(bewertungenUrl);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Wertberichtigung (bilanziell)" }));
    const d = await screen.findByRole("dialog").then((e) => within(e));
    expect(d.getByText(/senkt den Buchwert des Instruments, nicht den beizulegenden Wert/)).toBeTruthy();
    expect((d.getByRole("button", { name: "Wertberichtigung buchen" }) as HTMLButtonElement).disabled).toBe(true);
    await nutzer.selectOptions(d.getByLabelText("Instrument"), INSTR_ID);
    await nutzer.type(d.getByLabelText("Betrag in Euro (Auflösung negativ)"), "30000");
    await nutzer.type(d.getByLabelText("Begründung"), "Umsatz unter Plan");
    await nutzer.click(d.getByRole("button", { name: "Wertberichtigung buchen" }));
    expect(await d.findByText(/Der Buchwert beträgt jetzt 982\.000,00/)).toBeTruthy();
    expect(api.anfragen("POST", `/api/v1/investments/${BET_ID}/transactions`)[0]!.koerper).toMatchObject({ type: "impairment", instrumentId: INSTR_ID, amount: "30000", remark: "Umsatz unter Plan" });
  });

  it("belegt das einzige Instrument vor", async () => {
    spieleApi();
    rendereApp(bewertungenUrl);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Wertberichtigung (bilanziell)" }));
    const d = await screen.findByRole("dialog").then((e) => within(e));
    await waitFor(() => expect((d.getByLabelText("Instrument") as HTMLSelectElement).value).toBe(INSTR_ID));
  });
});
