import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { alleTransaktionen } from "../komponenten/RundenTransaktionen";
import { alsRolle, BET_ID, FONDS_ID, ORG_A, hauptInstrument, instrumentDaten, rendereApp, spieleApi } from "../test/hilfen";

/** Runden mit Brückenrunde, Transaktionen je Runde, „Ohne Runde“ und „Alle“; Runde ändern; Neue Runde als Brücke; Runde im Vorgangsdialog. */

const rundenUrl = `/beteiligungen/${BET_ID}?tab=finanzierung`;
const RUNDEN = `/api/v1/organisationen/${ORG_A}/finanzierungsrunden`;
const TRANSAKTIONEN = `/api/v1/organisationen/${ORG_A}/rundentransaktionen`;
const dialog = () => within(screen.getByRole("dialog"));
const schmal = (text: string | null) => (text ?? "").replace(/\s/g, " ");

const position = (id: string) => ({
  id,
  investor: { art: "fonds" as const, id: FONDS_ID, name: "Beispielfonds I" },
  betrag: "1000000.00",
  anteile: "81000",
  rolle: "lead",
  anteilsklasse: null,
  instrumentId: null,
  beteiligungId: null,
  gezahlt: null,
  offen: null,
  buchungen: [] as unknown[],
});
const eigenkapital = (id: string, bezeichnung: string, datum: string) => ({
  id,
  organisationId: ORG_A,
  art: "eigenkapital" as const,
  bezeichnung,
  datum,
  preMoney: "8000000.00",
  postMoney: "10000000.00",
  preisJeAnteil: "12.3457",
  anteileGesamtNach: "810000.0000",
  status: "abgeschlossen" as const,
  abgeschlossenAm: "2026-03-16T08:00:00.000Z",
  abgeschlossenVon: null,
  wiedergeoeffnetAm: null,
  wiedergeoeffnetVon: null,
  wiedereroeffnungGrund: null,
  positionen: [position(`${id}-p1`)],
  pruefung: { volumen: "1000000.00", postMoneyErwartet: "10000000.00", anteileErwartet: "810000", anteileVergeben: "81000", abweichungen: [], schliessbar: true },
});
const bruecke = (id: string, bezeichnung: string, datum: string) => ({
  ...eigenkapital(id, bezeichnung, datum),
  art: "bruecke" as const,
  preMoney: null,
  postMoney: null,
  preisJeAnteil: null,
  anteileGesamtNach: null,
  positionen: [] as ReturnType<typeof position>[],
  pruefung: { volumen: "0.00", postMoneyErwartet: null, anteileErwartet: null, anteileVergeben: "0", abweichungen: [], schliessbar: false },
});

const transaktion = (id: string, valuta: string, art: string, betrag: string, extra: Record<string, unknown> = {}) => ({
  id,
  valuta,
  art,
  betrag,
  bemerkung: null,
  kapitalisiert: false,
  fonds: { id: FONDS_ID, name: "Beispielfonds I" },
  beteiligungId: BET_ID,
  instrument: { id: "i1", bezeichnung: "Wandeldarlehen 2021", art: "wandeldarlehen" },
  tranche: null as { id: string; nummer: number | null; bezeichnung: string } | null,
  anteile: null as string | null,
  storniert: false,
  storniertVorgangId: null,
  quelle: "automatisch" as "automatisch" | "manuell" | null,
  ...extra,
});

const SEED = eigenkapital("r1", "Seed", "2021-05-31");
const BRUECKE = bruecke("rb", "Brücke 2022", "2022-03-15");
const SERIE_A = eigenkapital("r2", "Serie A", "2023-06-30");
const rundenListe = [SERIE_A, BRUECKE, SEED]; // neueste zuerst, wie die API sie liefert

const transaktionenDaten = {
  organisationId: ORG_A,
  runden: [
    {
      id: "r2",
      bezeichnung: "Serie A",
      datum: "2023-06-30",
      art: "eigenkapital",
      status: "abgeschlossen",
      transaktionen: [transaktion("t-wandlung", "2023-06-30", "tilgung", "250000.00", { instrument: { id: "i1", bezeichnung: "Wandeldarlehen 2021", art: "wandeldarlehen" } }), transaktion("t-anteile", "2023-06-30", "zusage", "250000.00", { instrument: { id: "i2", bezeichnung: "Serie-A-Anteile", art: "offene_beteiligung" }, anteile: "20250" })],
    },
    {
      id: "rb",
      bezeichnung: "Brücke 2022",
      datum: "2022-03-15",
      art: "bruecke",
      status: "abgeschlossen",
      transaktionen: [
        transaktion("t-b1", "2022-03-20", "auszahlung", "100000.00", { tranche: { id: "tr1", nummer: 1, bezeichnung: "Erste Rate" } }),
        transaktion("t-b2", "2022-04-20", "auszahlung", "50000.00", { storniert: true, storniertVorgangId: "t-b3" }),
      ],
    },
    { id: "r1", bezeichnung: "Seed", datum: "2021-05-31", art: "eigenkapital", status: "abgeschlossen", transaktionen: [transaktion("t-s1", "2021-06-30", "zusage", "1000000.00", { instrument: { id: "i3", bezeichnung: "Seed-Anteile", art: "offene_beteiligung" }, anteile: "81000" })] },
  ],
  ohneRunde: [transaktion("t-o1", "2022-01-10", "zinszahlung", "5000.00", { quelle: null })],
};
const leereBruecke = { ...transaktionenDaten, runden: transaktionenDaten.runden.map((r) => (r.id === "rb" ? { ...r, transaktionen: [] } : r)) };

const mitRunden = (daten = transaktionenDaten, zusatz: Record<string, unknown> = {}) => ({
  [RUNDEN]: { koerper: { daten: rundenListe } },
  [TRANSAKTIONEN]: { koerper: daten },
  ...zusatz,
});

const reiter = async () => within(await screen.findByRole("tablist", { name: "Runden" }));
const tabellenZeilen = (karte: HTMLElement) => within(within(karte).getByRole("table")).getAllByRole("row");

describe("Runden: Reiter", () => {
  it("zeigt Brückenrunden als Reiter mit Marke und nur dem Datum, dazu „Ohne Runde“ mit Zähler und „Alle“", async () => {
    spieleApi(mitRunden());
    rendereApp(rundenUrl);
    const tabs = (await reiter()).getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual([expect.stringContaining("Serie A"), expect.stringContaining("Brücke 2022"), expect.stringContaining("Seed"), expect.stringContaining("Ohne Runde"), expect.stringContaining("Alle")]);
    // Brücke: Marke und Datum, kein Volumen
    expect(tabs[1]!.textContent).toContain("Brückenrunde");
    expect(schmal(tabs[1]!.textContent)).toContain("15.03.2022");
    expect(tabs[1]!.textContent).not.toContain("€");
    expect(tabs[0]!.textContent).toContain("€");
    // Zähler
    expect(tabs[3]!.textContent).toMatch(/Ohne Runde.*1$/s);
    expect(tabs[4]!.textContent).toMatch(/Alle.*6$/s);
    // Vorgabe: die neueste abgeschlossene Eigenkapitalrunde, nicht die Brücke
    expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
  });

  it("zeigt „Ohne Runde“ nur bei nicht zugeordneten Transaktionen", async () => {
    spieleApi(mitRunden({ ...transaktionenDaten, ohneRunde: [] }));
    rendereApp(rundenUrl);
    const tabs = (await reiter()).getAllByRole("tab");
    expect(tabs.map((t) => t.textContent?.replace(/\d+$/, ""))).not.toContain("Ohne Runde");
    expect(tabs.some((t) => t.textContent?.startsWith("Alle"))).toBe(true);
  });
});

describe("Runden: Brückenrunde", () => {
  it("zeigt Hinweis und Transaktionen statt Bewertung und Investoren; Felder, Bearbeiten, Löschen nur ohne Zuordnung", async () => {
    spieleApi(mitRunden(leereBruecke));
    rendereApp(rundenUrl);
    const nutzer = userEvent.setup();
    await nutzer.click((await reiter()).getByRole("tab", { name: /Brücke 2022/ }));
    const runde = within(await screen.findByRole("article", { name: /Brücke 2022/ }));
    expect(runde.getByText(/Brückenrunde ohne Bewertung und Anteile, zum Beispiel für Darlehen zwischen zwei Runden/)).toBeTruthy();
    expect(runde.queryByText("Pre-Money")).toBeNull();
    expect(runde.queryByText("Summe Runde")).toBeNull();
    expect(runde.getByRole("button", { name: /^Eigene Felder anzeigen/ })).toBeTruthy();
    expect(runde.getByRole("button", { name: "Bearbeiten" })).toBeTruthy();
    expect(runde.getByRole("button", { name: "Löschen" })).toBeTruthy();
    expect(runde.queryByRole("button", { name: "Wieder öffnen" })).toBeNull();
    expect(runde.queryByRole("button", { name: "Runde abschließen" })).toBeNull();
    expect(runde.getByRole("region", { name: "Transaktionen" })).toBeTruthy();
    expect(runde.getByText("Keine Transaktionen.")).toBeTruthy();
  });

  it("blendet „Löschen“ aus, solange der Brücke Transaktionen zugeordnet sind, und bearbeitet nur Bezeichnung und Datum", async () => {
    const api = spieleApi(mitRunden(transaktionenDaten, { [`PATCH /api/v1/finanzierungsrunden/rb`]: { koerper: BRUECKE } }));
    rendereApp(rundenUrl);
    const nutzer = userEvent.setup();
    await nutzer.click((await reiter()).getByRole("tab", { name: /Brücke 2022/ }));
    const runde = within(await screen.findByRole("article", { name: /Brücke 2022/ }));
    expect(runde.queryByRole("button", { name: "Löschen" })).toBeNull();
    await nutzer.click(runde.getByRole("button", { name: "Bearbeiten" }));
    const d = dialog();
    expect(d.queryByLabelText("Pre-Money")).toBeNull();
    const name = d.getByLabelText("Bezeichnung");
    await nutzer.clear(name);
    await nutzer.type(name, "Brücke Frühjahr");
    await nutzer.click(d.getByRole("button", { name: "Änderungen speichern" }));
    await waitFor(() => expect(api.anfragen("PATCH", "/api/v1/finanzierungsrunden/rb")).toHaveLength(1));
    expect(api.anfragen("PATCH", "/api/v1/finanzierungsrunden/rb")[0]!.koerper).toEqual({ bezeichnung: "Brücke Frühjahr" });
  });
});

describe("Runden: Transaktionen", () => {
  it("zeigt je Runde Datum, Fonds, Instrument, Art, Tranche, Betrag und Anteile; Stornos sind durchgestrichen und markiert", async () => {
    spieleApi(mitRunden());
    rendereApp(rundenUrl);
    const nutzer = userEvent.setup();
    await nutzer.click((await reiter()).getByRole("tab", { name: /Brücke 2022/ }));
    const karte = await screen.findByRole("region", { name: "Transaktionen" });
    const zeilen = tabellenZeilen(karte);
    expect(zeilen).toHaveLength(3); // Kopf und zwei Vorgänge
    expect(within(zeilen[0]!).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Datum", "Fonds", "Instrument", "Art", "Tranche", "Betrag", "Anteile", "Aktion"]);
    const erste = schmal(zeilen[1]!.textContent);
    expect(erste).toContain("20.03.2022");
    expect(erste).toContain("Beispielfonds I");
    expect(erste).toContain("Auszahlung");
    expect(erste).toContain("1. Erste Rate");
    expect(erste).toContain("100.000,00 €");
    const link = within(zeilen[1]!).getByRole("link", { name: "Instrument Wandeldarlehen 2021 öffnen" });
    expect(link.getAttribute("href")).toContain(`/beteiligungen/${BET_ID}`);
    // Storno
    expect(within(zeilen[1]!).queryByText("Storniert")).toBeNull();
    expect(within(zeilen[2]!).getByText("Storniert")).toBeTruthy();
    expect(within(zeilen[2]!).getByText("20.04.2022").className).toContain("app-storniert");
    // Anteile erscheinen in der Eigenkapitalrunde
    await nutzer.click((await reiter()).getByRole("tab", { name: /Serie A/ }));
    const serie = tabellenZeilen(await screen.findByRole("region", { name: "Transaktionen" }));
    expect(schmal(serie.find((z) => z.textContent?.includes("Serie-A-Anteile"))!.textContent)).toContain("20.250");
  });

  it("zeigt unter „Ohne Runde“ den Hinweis zur Zuordnung", async () => {
    spieleApi(mitRunden());
    rendereApp(rundenUrl);
    const nutzer = userEvent.setup();
    await nutzer.click((await reiter()).getByRole("tab", { name: /Ohne Runde/ }));
    const karte = within(await screen.findByRole("region", { name: "Transaktionen" }));
    expect(karte.getByText(/noch keiner Runde zugeordnet.*„Runde ändern“/)).toBeTruthy();
    expect(karte.getAllByRole("row")).toHaveLength(2);
    expect(karte.getByText("Zinszahlung")).toBeTruthy();
  });

  it("zeigt unter „Alle“ jede Transaktion chronologisch mit ihrer Runde („—“ ohne Runde, Brücke markiert)", async () => {
    spieleApi(mitRunden());
    rendereApp(rundenUrl);
    const nutzer = userEvent.setup();
    await nutzer.click((await reiter()).getByRole("tab", { name: /^Alle/ }));
    const karte = await screen.findByRole("region", { name: "Transaktionen" });
    const zeilen = tabellenZeilen(karte);
    expect(zeilen).toHaveLength(7);
    expect(within(zeilen[0]!).getAllByRole("columnheader").map((h) => h.textContent)).toContain("Runde");
    const daten = zeilen.slice(1).map((z) => within(z).getAllByRole("cell")[0]!.textContent);
    expect(daten).toEqual(["30.06.2021", "10.01.2022", "20.03.2022", "20.04.2022", "30.06.2023", "30.06.2023"]);
    const rundenSpalte = zeilen.slice(1).map((z) => schmal(within(z).getAllByRole("cell")[7]!.textContent));
    expect(rundenSpalte[0]).toBe("Seed");
    expect(rundenSpalte[1]).toBe("—");
    expect(rundenSpalte[2]).toContain("Brücke 2022");
    expect(rundenSpalte[2]).toContain("Brückenrunde");
    expect(rundenSpalte[4]).toBe("Serie A");
  });
});

describe("Runden: Runde ändern", () => {
  it("ordnet einen Vorgang über PUT einer anderen Runde zu", async () => {
    const api = spieleApi(mitRunden(transaktionenDaten, { "PUT /api/v1/vorgaenge/t-o1/runde": { koerper: { vorgangId: "t-o1", rundeId: "rb", quelle: "manuell", geaendert: true } } }));
    rendereApp(rundenUrl);
    const nutzer = userEvent.setup();
    await nutzer.click((await reiter()).getByRole("tab", { name: /Ohne Runde/ }));
    await nutzer.click(await screen.findByRole("button", { name: /^Runde ändern: Zinszahlung vom 10\.01\.2022/ }));
    const d = dialog();
    const auswahl = d.getByLabelText("Runde") as HTMLSelectElement;
    expect(Array.from(auswahl.options).map((o) => schmal(o.textContent))).toEqual(["Keiner Runde zuordnen", "Serie A · 30.06.2023", "Brücke 2022 · 15.03.2022 (Brückenrunde)", "Seed · 31.05.2021"]);
    expect((d.getByRole("button", { name: "Zuordnung speichern" }) as HTMLButtonElement).disabled).toBe(true);
    await nutzer.selectOptions(auswahl, "rb");
    await nutzer.click(d.getByRole("button", { name: "Zuordnung speichern" }));
    await waitFor(() => expect(api.anfragen("PUT", "/api/v1/vorgaenge/t-o1/runde")).toHaveLength(1));
    expect(api.anfragen("PUT", "/api/v1/vorgaenge/t-o1/runde")[0]!.koerper).toEqual({ rundeId: "rb" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("entfernt die Zuordnung mit „Keiner Runde zuordnen“ (rundeId null)", async () => {
    const api = spieleApi(mitRunden(transaktionenDaten, { "PUT /api/v1/vorgaenge/t-s1/runde": { koerper: { vorgangId: "t-s1", rundeId: null, quelle: "manuell", geaendert: true } } }));
    rendereApp(rundenUrl);
    const nutzer = userEvent.setup();
    await nutzer.click((await reiter()).getByRole("tab", { name: /Seed/ }));
    await nutzer.click(await screen.findByRole("button", { name: /^Runde ändern: Zusage vom 30\.06\.2021/ }));
    const d = dialog();
    expect((d.getByLabelText("Runde") as HTMLSelectElement).value).toBe("r1");
    await nutzer.selectOptions(d.getByLabelText("Runde"), "");
    await nutzer.click(d.getByRole("button", { name: "Zuordnung speichern" }));
    await waitFor(() => expect(api.anfragen("PUT", "/api/v1/vorgaenge/t-s1/runde")).toHaveLength(1));
    expect(api.anfragen("PUT", "/api/v1/vorgaenge/t-s1/runde")[0]!.koerper).toEqual({ rundeId: null });
  });

  it("bietet „Runde ändern“ nur mit Recht zum Buchen am Fonds an", async () => {
    spieleApi({ ...mitRunden(), "/api/v1/ich": alsRolle("betrachter") });
    rendereApp(rundenUrl);
    const nutzer = userEvent.setup();
    await nutzer.click((await reiter()).getByRole("tab", { name: /Ohne Runde/ }));
    const karte = within(await screen.findByRole("region", { name: "Transaktionen" }));
    expect(karte.getAllByRole("row")).toHaveLength(2);
    expect(karte.queryByRole("button", { name: /^Runde ändern/ })).toBeNull();
  });
});

describe("Runden: Neue Runde als Brücke", () => {
  it("zeigt bei der Brücke nur Bezeichnung und Datum und sendet art bruecke ohne Bewertung und Positionen", async () => {
    const api = spieleApi({ ...mitRunden(), [`POST ${RUNDEN}`]: { status: 201, koerper: BRUECKE } });
    rendereApp(rundenUrl);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Neue Runde" }));
    const d = dialog();
    expect(d.getByLabelText("Pre-Money")).toBeTruthy();
    await nutzer.click(d.getByRole("button", { name: "Brückenrunde" }));
    expect(d.queryByLabelText("Pre-Money")).toBeNull();
    expect(d.queryByLabelText("Preis je Anteil")).toBeNull();
    expect(d.queryByText("Investoren")).toBeNull();
    expect(d.getByText(/keine Bewertung und keine Anteile/)).toBeTruthy();
    await nutzer.type(d.getByLabelText("Bezeichnung"), "Brücke 2024");
    await nutzer.click(d.getByRole("button", { name: "Brückenrunde anlegen" }));
    await waitFor(() => expect(api.anfragen("POST", RUNDEN)).toHaveLength(1));
    const koerper = api.anfragen("POST", RUNDEN)[0]!.koerper as Record<string, unknown>;
    expect(koerper).toMatchObject({ art: "bruecke", bezeichnung: "Brücke 2024" });
    expect(koerper).not.toHaveProperty("preMoney");
    expect(koerper).not.toHaveProperty("positionen");
  });
});

describe("Vorgang erfassen: Runde", () => {
  const VORGANG = `POST /api/v1/beteiligungen/${BET_ID}/vorgaenge`;
  const mitInstrumentRunde = {
    ...mitRunden(),
    [`/api/v1/beteiligungen/${BET_ID}/instrumentdaten`]: { koerper: { ...instrumentDaten, instrumente: [{ ...hauptInstrument, runde: { id: "rb", bezeichnung: "Brücke 2022" } }] } },
    [VORGANG]: { status: 201, koerper: { vorgang: {}, buchwert: "1100000.00" } },
  };
  const oeffne = async () => {
    rendereApp(`/beteiligungen/${BET_ID}`);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Vorgang erfassen" }));
    const d = await screen.findByRole("dialog").then((e) => within(e));
    return { nutzer, d };
  };

  it("belegt die Runde mit der des Instruments vor und sendet ohne eigene Wahl keine rundeId", async () => {
    const api = spieleApi(mitInstrumentRunde);
    const { nutzer, d } = await oeffne();
    await waitFor(() => expect((d.getByLabelText("Instrument") as HTMLSelectElement).value).toBe(hauptInstrument.id));
    const runde = await d.findByLabelText("Runde (optional)");
    expect((runde as HTMLSelectElement).value).toBe("rb");
    expect(Array.from((runde as HTMLSelectElement).options).map((o) => schmal(o.textContent))).toEqual(["Keiner Runde zuordnen", "Serie A · 30.06.2023", "Brücke 2022 · 15.03.2022 (Brückenrunde)", "Seed · 31.05.2021"]);
    await nutzer.type(d.getByLabelText("Betrag in Euro"), "50000");
    await nutzer.click(d.getByRole("button", { name: "Vorgang buchen" }));
    await waitFor(() => expect(api.anfragen("POST", `/api/v1/beteiligungen/${BET_ID}/vorgaenge`)).toHaveLength(1));
    expect(api.anfragen("POST", `/api/v1/beteiligungen/${BET_ID}/vorgaenge`)[0]!.koerper).not.toHaveProperty("rundeId");
  });

  it("sendet die gewählte Runde und für „Keiner Runde zuordnen“ null", async () => {
    const api = spieleApi(mitInstrumentRunde);
    const { nutzer, d } = await oeffne();
    await waitFor(() => expect((d.getByLabelText("Instrument") as HTMLSelectElement).value).toBe(hauptInstrument.id));
    await nutzer.selectOptions(await d.findByLabelText("Runde (optional)"), "r2");
    await nutzer.type(d.getByLabelText("Betrag in Euro"), "50000");
    await nutzer.click(d.getByRole("button", { name: "Vorgang buchen" }));
    await waitFor(() => expect(api.anfragen("POST", `/api/v1/beteiligungen/${BET_ID}/vorgaenge`)).toHaveLength(1));
    expect(api.anfragen("POST", `/api/v1/beteiligungen/${BET_ID}/vorgaenge`)[0]!.koerper).toMatchObject({ rundeId: "r2" });
  });

  it("sendet rundeId null, wenn „Keiner Runde zuordnen“ gewählt wird", async () => {
    const api = spieleApi(mitInstrumentRunde);
    const { nutzer, d } = await oeffne();
    await waitFor(() => expect((d.getByLabelText("Instrument") as HTMLSelectElement).value).toBe(hauptInstrument.id));
    await nutzer.selectOptions(await d.findByLabelText("Runde (optional)"), "");
    await nutzer.type(d.getByLabelText("Betrag in Euro"), "50000");
    await nutzer.click(d.getByRole("button", { name: "Vorgang buchen" }));
    await waitFor(() => expect(api.anfragen("POST", `/api/v1/beteiligungen/${BET_ID}/vorgaenge`)).toHaveLength(1));
    expect(api.anfragen("POST", `/api/v1/beteiligungen/${BET_ID}/vorgaenge`)[0]!.koerper).toMatchObject({ rundeId: null });
  });
});

describe("Instrument anlegen: Runden", () => {
  it("bietet Eigenkapital keine Brückenrunde an, Darlehen schon", async () => {
    spieleApi(mitRunden());
    rendereApp(`/beteiligungen/${BET_ID}?tab=finanzierung&unter=instrumente`);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: /^Instrument anlegen/ }));
    const d = await screen.findByRole("dialog").then((e) => within(e));
    const optionen = () => Array.from((d.getByLabelText("Runde (optional)") as HTMLSelectElement).options).map((o) => schmal(o.textContent));
    expect(optionen()).toEqual(["Keine Runde", "Serie A", "Seed"]);
    await nutzer.selectOptions(d.getByLabelText("Art"), "wandeldarlehen");
    expect(optionen()).toEqual(["Keine Runde", "Serie A", "Brücke 2022 (Brückenrunde)", "Seed"]);
  });
});


describe("alleTransaktionen: Reihenfolge am selben Tag", () => {
  it("Zusage vor Auszahlung vor Zins vor Tilgung, dann nach Erfassung und Id, über alle Gruppen", () => {
    const a = transaktion("z-a", "2024-01-10", "auszahlung", "10.00", { erfasstAm: "2024-01-10T08:00:00Z" });
    const b = transaktion("z-b", "2024-01-10", "zusage", "10.00", { erfasstAm: "2024-01-10T09:00:00Z" });
    const c = transaktion("z-c", "2024-01-10", "tilgung", "1.00", { erfasstAm: "2024-01-10T07:00:00Z" });
    const d = transaktion("z-d", "2024-01-10", "zins", "1.00", { erfasstAm: "2024-01-10T10:00:00Z" });
    const e = transaktion("z-e", "2024-01-09", "tilgung", "1.00", { erfasstAm: "2024-01-09T10:00:00Z" });
    const daten = {
      organisationId: ORG_A,
      runden: [{ id: "r", bezeichnung: "R", datum: "2024-01-10", art: "eigenkapital" as const, status: "abgeschlossen" as const, transaktionen: [a, c] }],
      ohneRunde: [d, b, e],
    };
    expect(alleTransaktionen(daten as never).map((z) => z.id)).toEqual(["z-e", "z-b", "z-a", "z-d", "z-c"]);
  });
});
