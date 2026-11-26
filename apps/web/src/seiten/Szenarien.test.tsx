import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { alsRolle, FONDS_ID, rendereApp, spieleApi } from "../test/hilfen";
import { de } from "../i18n/de";

/** Szenarien, Vergleich und Reserven (Etappe 18) mit gespielter API, in beiden Sprachen. Alle Daten sind erfunden. */

const S1 = "11111111-aaaa-4aaa-8aaa-000000000001";
const S2 = "11111111-aaaa-4aaa-8aaa-000000000002";
const S3 = "11111111-aaaa-4aaa-8aaa-000000000003";
const S4 = "11111111-aaaa-4aaa-8aaa-000000000004";
const BET = "bbbbbbbb-1111-4111-8111-000000000001";

const kopf = (id: string, name: string, status: "entwurf" | "festgeschrieben" = "entwurf") => ({
  id,
  fondsId: FONDS_ID,
  name,
  basisStichtag: "2026-11-20",
  status,
  erstelltVon: "x",
  erstelltAm: "2026-11-20T08:00:00.000Z",
  geaendertAm: "2026-11-20T08:00:00.000Z",
  festgeschriebenAm: status === "festgeschrieben" ? "2026-11-21T08:00:00.000Z" : null,
  festgeschriebenVon: null,
  ergebnisHash: status === "festgeschrieben" ? "ab".repeat(32) : null,
  wissensstand: null,
});

const jahr = (j: number, tvpi: string) => ({ jahr: j, datum: `${j}-12-31`, ist: false, tvpi, irrNetto: "0.05", dpi: "0.1", navNetto: "1.00", abrufe: "1.00", ausschuettungenNetto: "0.00" });
const ergebnis = (tvpiEnde: string) => ({
  basisStichtag: "2026-11-20",
  endJahr: 2028,
  waehrung: "EUR",
  zeichnungskapital: "10000000.00",
  jahre: [jahr(2026, "1.0500"), jahr(2027, "0.9000"), jahr(2028, tvpiEnde)],
  beteiligungen: [{ id: BET, name: "Alpha Energie", wert: "100.00", investiert: "80.00", ausstiegsJahr: 2028, erloesBeiAusstieg: "5000000.00", wahrscheinlichkeit: "0.5", erwarteterErloes: "2500000.00", folgeinvestitionen: "0.00", erloesQuelle: "wasserfall" }],
  summen: { investitionen: "0.00", gebuehren: "300000.00", abrufe: "300000.00", ausschuettungenBrutto: "0.00", carry: "0.00", ausschuettungenNetto: "0.00" },
  befunde: [
    { code: "WASSERFALL_FALLBACK_QUOTE", schwere: "hinweis", beteiligungId: BET, params: { quote: "0.15" } },
    { code: "ZUSAGE_UEBERSCHRITTEN", schwere: "warnung", params: { jahr: 2028, betrag: "12000.00" } },
  ],
  schritte: [],
});

const vergleich = (ids: string[]) => {
  const namen: Record<string, string> = { [S1]: "Basis", [S2]: "Oben", [S3]: "Unten", [S4]: "Vierter" };
  const tvpi: Record<string, string> = { [S1]: "1.4000", [S2]: "2.1000", [S3]: "0.8000", [S4]: "1.0000" };
  return {
    fondsId: FONDS_ID,
    szenarien: ids.map((id) => ({ ...kopf(id, namen[id]!), ergebnis: ergebnis(tvpi[id]!) })),
    vergleich: {
      jahre: [2026, 2027, 2028],
      kennzahlen: [
        { schluessel: "tvpiEnde", werte: ids.map((id) => tvpi[id]!) },
        { schluessel: "irrNettoEnde", werte: ids.map(() => "0.0812") },
        { schluessel: "gebuehrenSumme", werte: ids.map(() => "300000.00") },
        { schluessel: "tvpiTiefpunktJahr", werte: ids.map(() => "2027") },
      ],
      jkurve: [2026, 2027, 2028].map((j, i) => ({ jahr: j, werte: ids.map((id) => ({ tvpi: i === 2 ? tvpi[id]! : i === 0 ? "1.0500" : "0.9000", irrNetto: "0.05" })) })),
    },
  };
};

const schmal = (text: string | null) => (text ?? "").replace(/\s/g, " ");

const URL_S = `/fonds/${FONDS_ID}/szenarien`;
const API_S = `/api/v1/fonds/${FONDS_ID}/szenarien`;
const liste = { daten: [kopf(S1, "Basis", "festgeschrieben"), kopf(S2, "Oben"), kopf(S3, "Unten"), kopf(S4, "Vierter")] };
const vorlage = { basisStichtag: "2026-11-20", beteiligungen: [{ id: BET, organisation: "Alpha Energie", instrument: "offene_beteiligung", wert: "2500000.00", investiert: "2000000.00" }] };

const standard = (zusatz: Record<string, unknown> = {}) =>
  spieleApi({
    [API_S]: { koerper: liste },
    [`${API_S}/vorlage`]: { koerper: vorlage },
    [`${API_S}/vergleich`]: (a: { query: URLSearchParams }) => ({ koerper: vergleich((a.query.get("ids") ?? "").split(",")) }),
    ...zusatz,
  });

afterEach(() => localStorage.removeItem("carraway.sprache"));

describe("Szenarien: Liste und Vergleich", () => {
  it("zeigt die Szenarien mit Status, vergleicht zwei und zeigt Kennzahlen, J-Kurve mit Tabelle und Befunde", async () => {
    const api = standard();
    rendereApp(URL_S);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("checkbox", { name: "Basis vergleichen" }));
    expect(screen.getAllByText("Festgeschrieben").length).toBeGreaterThan(0);
    await nutzer.click(screen.getByRole("checkbox", { name: "Oben vergleichen" }));
    await nutzer.click(screen.getByRole("button", { name: "Vergleich anzeigen" }));
    const v = within(await screen.findByRole("region", { name: "Vergleich" }));
    expect(api.anfragen("GET", `${API_S}/vergleich`)[0]!.query.get("ids")).toBe(`${S1},${S2}`);
    const tabelle = v;
    const zeile = tabelle.getAllByRole("row").find((r) => r.textContent?.includes("TVPI zum Prognoseende"))!;
    expect(schmal(zeile.textContent)).toContain("1,40x");
    expect(zeile.textContent).toContain("2,10x");
    expect(schmal(tabelle.getAllByRole("row").find((r) => r.textContent?.includes("IRR netto"))!.textContent)).toContain("8,1 %");
    // J-Kurve: Diagramm mit Textfassung und Umschalten auf die Tabelle
    expect(v.getByRole("img", { name: /Liniendiagramm mit 2 Szenarios über 3 Jahre/ })).toBeTruthy();
    await nutzer.click(v.getByRole("button", { name: "Tabelle" }));
    expect(within(v.getByRole("region", { name: "J-Kurve · Tabelle" })).getAllByRole("row")).toHaveLength(4);
    // Befunde mit eingesetzten Namen und Beträgen
    expect(v.getAllByText(/Basis: Alpha Energie: Der Fonds hat keine Captable/).length).toBe(1);
    expect(v.getAllByText((t) => /Ab 2028 übersteigen die Abrufe das Zeichnungskapital \(um 12\.000/.test(schmal(t))).length).toBe(2);
    expect(v.getByRole("link", { name: "Szenariobericht als PDF herunterladen" }).getAttribute("href")).toBe(`/api/v1/funds/${FONDS_ID}/scenarios/report?ids=${S1},${S2}&format=pdf&language=de`);
    expect(v.getByRole("link", { name: "Szenariobericht als Excel herunterladen" }).getAttribute("href")).toContain("format=xlsx");
  });

  it("ein festgeschriebenes Szenario lässt sich als Bericht zur Freigabe anlegen; Entwürfe bieten das nicht an", async () => {
    const BERICHT = "00000000-0000-4000-8000-0000000000b1";
    const api = standard({ "POST /api/v1/reports": { status: 201, koerper: { id: BERICHT, art: "szenariobericht", status: "entwurf" } } });
    rendereApp(URL_S);
    const nutzer = userEvent.setup();
    await waehle(nutzer, "Basis", "Als Bericht freigeben");
    await waitFor(() => expect(api.anfragen("POST", "/api/v1/reports")).toHaveLength(1));
    expect(api.anfragen("POST", "/api/v1/reports")[0]!.koerper).toMatchObject({ art: "szenariobericht", fondsId: FONDS_ID, szenarioIds: [S1], sprache: "de" });
    expect(await eintraege(nutzer, "Oben")).not.toContain("Als Bericht freigeben");
  });

  it("lässt höchstens drei Szenarien zum Vergleich zu", async () => {
    standard();
    rendereApp(URL_S);
    const nutzer = userEvent.setup();
    for (const n of ["Basis", "Oben", "Unten"]) await nutzer.click(await screen.findByRole("checkbox", { name: `${n} vergleichen` }));
    expect((screen.getByRole("checkbox", { name: "Vierter vergleichen" }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(de.szenarien.auswahlMax)).toBeTruthy();
  });

  it("legt ein Szenario mit Annahmen als JSON an (Prozent werden zu Brüchen)", async () => {
    const api = standard({ [`POST ${API_S}`]: { koerper: kopf("neu", "Neu"), status: 201 } });
    rendereApp(URL_S);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Neues Szenario" }));
    const f = within(await screen.findByRole("form", { name: "Neues Szenario" }));
    await nutzer.type(f.getByLabelText("Name"), "Neu");
    await nutzer.type(f.getByLabelText("Satz je Jahr in %"), "2,5");
    await nutzer.type(f.getByLabelText("Carry in %"), "20");
    const firma = within(f.getByRole("group", { name: "Alpha Energie" }));
    await nutzer.selectOptions(firma.getByLabelText("Ausstieg"), "multiple");
    await nutzer.type(firma.getByLabelText("Jahr"), "2030");
    await nutzer.type(firma.getByLabelText("Multiple auf den Wertansatz"), "2.5");
    await nutzer.clear(firma.getByLabelText("Wahrscheinlichkeit in %"));
    await nutzer.type(firma.getByLabelText("Wahrscheinlichkeit in %"), "70");
    await nutzer.click(f.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(api.anfragen("POST", API_S)).toHaveLength(1));
    const k = api.anfragen("POST", API_S)[0]!.koerper as { name: string; basisStichtag: string; annahmen: Record<string, unknown> };
    expect(k.name).toBe("Neu");
    expect(k.basisStichtag).toBe("2026-11-20");
    expect(k.annahmen).toMatchObject({
      carrySatz: "0.2",
      gebuehren: { satz: "0.025", basis: "zeichnungskapital" },
      beteiligungen: { [BET]: { ausstieg: { art: "exit", jahr: 2030, multiple: "2.5", wahrscheinlichkeit: "0.7" } } },
    });
  });

  it("Neuinvestitionen: anlegen, im Entwurf ändern und entfernen; leere Zeilen werden nicht gesendet", async () => {
    const detail = { ...kopf(S2, "Oben"), annahmen: { wertpfad: "linear", gebuehren: { basis: "zeichnungskapital", satz: "0", bisJahr: null, sonstigeJahr: "0" }, carrySatz: "0", beteiligungen: {}, neuinvestitionen: [{ name: "Beispiel Neu AG", jahr: 2028, betrag: "500000.00", ausstiegJahr: 2033, multiple: "3" }] } };
    const api = standard({
      [`POST ${API_S}`]: { koerper: kopf("neu", "Neu"), status: 201 },
      [`/api/v1/szenarien/${S2}`]: { koerper: detail },
      [`PATCH /api/v1/szenarien/${S2}`]: { koerper: kopf(S2, "Oben") },
    });
    rendereApp(URL_S);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Neues Szenario" }));
    const neu = within(await screen.findByRole("form", { name: "Neues Szenario" }));
    await nutzer.type(neu.getByLabelText("Name"), "Mit Neuinvestition");
    await nutzer.click(neu.getByRole("button", { name: "Neuinvestition hinzufügen" }));
    await nutzer.click(neu.getByRole("button", { name: "Neuinvestition hinzufügen" })); // bleibt leer
    const zeile = within(neu.getByRole("group", { name: "Neuinvestition 1" }));
    await nutzer.type(zeile.getByLabelText("Name des Unternehmens"), "Beispiel Neu AG");
    await nutzer.type(zeile.getByLabelText("Investitionsjahr"), "2028");
    await nutzer.type(zeile.getByLabelText("Betrag"), "500000");
    await nutzer.type(zeile.getByLabelText("Ausstiegsjahr (optional)"), "2033");
    await nutzer.type(zeile.getByLabelText("Multiple auf den Betrag (optional)"), "3");
    await nutzer.click(neu.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(api.anfragen("POST", API_S)).toHaveLength(1));
    expect((api.anfragen("POST", API_S)[0]!.koerper as { annahmen: { neuinvestitionen: unknown } }).annahmen.neuinvestitionen).toEqual([{ name: "Beispiel Neu AG", jahr: 2028, betrag: "500000", ausstiegJahr: 2033, multiple: "3" }]);

    // Bearbeiten: gespeicherte Neuinvestition erscheint, lässt sich ändern und entfernen
    await waehle(nutzer, "Oben", "Bearbeiten");
    const alt = within(await screen.findByRole("form", { name: /bearbeiten/ }));
    expect((alt.getByLabelText("Name des Unternehmens") as HTMLInputElement).value).toBe("Beispiel Neu AG");
    await nutzer.clear(alt.getByLabelText("Betrag"));
    await nutzer.type(alt.getByLabelText("Betrag"), "750000");
    await nutzer.click(alt.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(api.anfragen("PATCH", `/api/v1/szenarien/${S2}`)).toHaveLength(1));
    expect((api.anfragen("PATCH", `/api/v1/szenarien/${S2}`)[0]!.koerper as { annahmen: { neuinvestitionen: unknown } }).annahmen.neuinvestitionen).toEqual([{ name: "Beispiel Neu AG", jahr: 2028, betrag: "750000", ausstiegJahr: 2033, multiple: "3" }]);
    await waehle(nutzer, "Oben", "Bearbeiten");
    const wieder = within(await screen.findByRole("form", { name: /bearbeiten/ }));
    await nutzer.click(wieder.getByRole("button", { name: "Neuinvestition 1 entfernen" }));
    await nutzer.click(wieder.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(api.anfragen("PATCH", `/api/v1/szenarien/${S2}`)).toHaveLength(2));
    expect((api.anfragen("PATCH", `/api/v1/szenarien/${S2}`)[1]!.koerper as { annahmen: { neuinvestitionen: unknown } }).annahmen.neuinvestitionen).toEqual([]);
  });

  it("zeigt Fehler der API übersetzt", async () => {
    standard({ [`POST ${API_S}`]: { koerper: { error: { code: "scenario_name_exists", message: "x" } }, status: 409 } });
    rendereApp(URL_S);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Neues Szenario" }));
    const f = within(await screen.findByRole("form", { name: "Neues Szenario" }));
    await nutzer.type(f.getByLabelText("Name"), "Basis");
    await nutzer.click(f.getByRole("button", { name: "Speichern" }));
    expect(await f.findByText(de.fehler.scenario_name_exists)).toBeTruthy();
  });
});

/** Öffnet das Zeilenmenü eines Szenarios und wählt den Eintrag. */
async function waehle(nutzer: ReturnType<typeof userEvent.setup>, szenario: string, eintrag: string) {
  await nutzer.click(await screen.findByRole("button", { name: `Weitere Aktionen: ${szenario}` }));
  await nutzer.click(await screen.findByRole("menuitem", { name: eintrag }));
}
/** Namen der Einträge im geöffneten Zeilenmenü (leer, wenn es kein Menü gibt). */
async function eintraege(nutzer: ReturnType<typeof userEvent.setup>, szenario: string) {
  const knopf = screen.queryByRole("button", { name: `Weitere Aktionen: ${szenario}` });
  if (!knopf) return [];
  await nutzer.click(knopf);
  const namen = (await screen.findAllByRole("menuitem")).map((e) => e.textContent);
  await nutzer.keyboard("{Escape}");
  return namen;
}

describe("Szenarien: Rechte und Festschreiben", () => {
  it("Freigeber schreibt einen Entwurf nach Bestätigung fest, Bearbeiter sieht den Knopf nicht", async () => {
    const api = standard({ "/api/v1/me": alsRolle("freigeber"), [`POST /api/v1/szenarien/${S2}/festschreiben`]: { koerper: kopf(S2, "Oben", "festgeschrieben") } });
    const { unmount } = rendereApp(URL_S);
    const nutzer = userEvent.setup();
    expect(await eintraege(nutzer, "Basis")).not.toContain("Festschreiben"); // schon festgeschrieben
    await waehle(nutzer, "Oben", "Festschreiben");
    const dialog = within(await screen.findByRole("dialog", { name: "Festschreiben" }));
    expect(dialog.getByText(/Eingaben und Ergebnis werden unveränderlich festgehalten/)).toBeTruthy();
    await nutzer.click(dialog.getByRole("button", { name: "Festschreiben" }));
    await waitFor(() => expect(api.anfragen("POST", `/api/v1/szenarien/${S2}/festschreiben`)).toHaveLength(1));
    unmount();

    standard({ "/api/v1/me": alsRolle("bearbeiter") });
    rendereApp(URL_S);
    await screen.findByRole("checkbox", { name: "Basis vergleichen" });
    expect(screen.getByRole("button", { name: "Neues Szenario" })).toBeTruthy();
    const bearbeiter = userEvent.setup();
    expect(await eintraege(bearbeiter, "Oben")).toEqual(["Bearbeiten", "Duplizieren", "Löschen"]); // kein Festschreiben
    expect(await eintraege(bearbeiter, "Basis")).not.toContain("Bearbeiten"); // festgeschrieben: nur duplizieren
  });

  it("Betrachter sieht Liste, Vergleich und Export, aber keine Schreibaktionen", async () => {
    standard({ "/api/v1/me": alsRolle("betrachter") });
    rendereApp(URL_S);
    await screen.findByRole("checkbox", { name: "Basis vergleichen" });
    expect(screen.queryByRole("button", { name: "Neues Szenario" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Weitere Aktionen:/ })).toBeNull();
    expect(screen.getAllByRole("link", { name: /Szenariobericht als PDF herunterladen/ }).length).toBeGreaterThan(0);
  });

  it("ist in Englisch vollständig übersetzt", async () => {
    localStorage.setItem("carraway.sprache", "en");
    standard();
    rendereApp(URL_S);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("checkbox", { name: "Compare Basis" }));
    await nutzer.click(screen.getByRole("button", { name: "Show comparison" }));
    const v = within(await screen.findByRole("region", { name: "Comparison" }));
    expect(v.getByText("TVPI at the end of the projection")).toBeTruthy();
    expect(v.getByText(/Basis: Alpha Energie: The fund has no cap table for this company/)).toBeTruthy();
    expect(v.getAllByText((t) => /From 2028, capital calls exceed the fund size \(by .*12,000/.test(schmal(t))).length).toBeGreaterThan(0);
    expect(v.getByRole("link", { name: "Download the scenario report as PDF" }).getAttribute("href")).toContain("language=en");
    expect(screen.getByText("Locked")).toBeTruthy();
  });
});

describe("Reserven", () => {
  const reserven = {
    fondsId: FONDS_ID,
    stichtag: "2026-11-20",
    waehrung: "EUR",
    zeichnungskapital: "10000000.00",
    abgerufen: "2500000.00",
    investiert: "2550000.00",
    belegt: "2550000.00",
    reserven: [{ beteiligungId: BET, organisation: "Alpha Energie", status: "aktiv", geplant: "1000000.00", gueltigAb: "2026-01-01", bemerkung: null, verbraucht: "250000.00", offen: "750000.00" }],
    summeGeplant: "1000000.00",
    summeOffen: "750000.00",
    gebuehrenPrognose: "300000.00",
    szenario: { id: S1, name: "Basis", status: "festgeschrieben", basisStichtag: "2026-11-20" },
    verfuegbar: "6400000.00",
    befunde: [{ code: "VERFUEGBAR_NEGATIV", schwere: "warnung" }],
    schritte: [{ zeichen: "", bezeichnung: "Zeichnungskapital", wert: "10000000" }],
  };

  it("zeigt Reserve gegen Verbrauch, den verfügbaren Betrag mit Rechenweg und plant eine Reserve", async () => {
    const api = spieleApi({ [`/api/v1/fonds/${FONDS_ID}/reserven`]: { koerper: reserven }, [`PUT /api/v1/beteiligungen/b1/reserve`]: { koerper: { id: "r" }, status: 201 } });
    rendereApp(`/fonds/${FONDS_ID}/reserven`);
    const abschnitt = within((await screen.findAllByRole("region", { name: "Reserven" }))[0]!);
    await abschnitt.findByRole("region", { name: "Unternehmen · Geplant" });
    const zeile = abschnitt.getAllByRole("row").find((r) => r.textContent?.includes("Alpha Energie"))!;
    expect(schmal(zeile.textContent)).toContain("750.000");
    expect(abschnitt.getAllByText((t) => /6\.400\.000/.test(schmal(t))).length).toBeGreaterThan(0);
    expect(abschnitt.getAllByText(/Gebührenprognose aus dem Szenario „Basis“/).length).toBeGreaterThan(0);
    expect(abschnitt.getByText(de.szenarien.reservenSeite.befunde.VERFUEGBAR_NEGATIV!)).toBeTruthy();
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Reserve planen" }));
    const f = within(await screen.findByRole("form", { name: "Reserve planen" }));
    await waitFor(() => expect(f.getAllByRole("option").length).toBeGreaterThan(1));
    await nutzer.selectOptions(f.getByLabelText("Beteiligung"), "b1");
    await nutzer.type(f.getByLabelText("Betrag"), "500000");
    await nutzer.click(f.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(api.anfragen("PUT", "/api/v1/beteiligungen/b1/reserve")).toHaveLength(1));
    expect(api.anfragen("PUT", "/api/v1/beteiligungen/b1/reserve")[0]!.koerper).toMatchObject({ betrag: "500000", bemerkung: null });
  });

  it("zeigt Betrachtern kein Formular und ist in Englisch übersetzt", async () => {
    localStorage.setItem("carraway.sprache", "en");
    spieleApi({ "/api/v1/me": alsRolle("betrachter"), [`/api/v1/fonds/${FONDS_ID}/reserven`]: { koerper: { ...reserven, befunde: [] } } });
    rendereApp(`/fonds/${FONDS_ID}/reserven`);
    const abschnitt = within((await screen.findAllByRole("region", { name: "Reserves" }))[0]!);
    await abschnitt.findByRole("region", { name: "Company · Planned" });
    expect(abschnitt.getAllByText("Available for new investments").length).toBeGreaterThan(0);
    expect(abschnitt.getByText(/Fee projection from the scenario “Basis”/)).toBeTruthy();
    expect(screen.queryByRole("form", { name: "Plan a reserve" })).toBeNull();
  });
});
