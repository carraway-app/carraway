import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { BEWEGUNG_FERTIG_ID, BEWEGUNG_OFFEN_ID, FONDS_ID, alsRolle, bewegungenDaten, fehler, fondsDaten, rendereApp, spieleApi } from "../test/hilfen";

const url = `/funds?fundId=${FONDS_ID}&tab=capital`;
const freigabePfad = `/api/v1/fonds/${FONDS_ID}/bewegungen/${BEWEGUNG_OFFEN_ID}/mitteilungen/freigeben`;
const buchungPfad = `/api/v1/funds/${FONDS_ID}/postings`;
const vorschauPfad = `/api/v1/funds/${FONDS_ID}/fund-movements/preview`;
const aufteilung = [{ zeichnungId: "zeichnung-1", organisationId: "investor-1", investor: "Investor Am Park", zusage: "50000.00", anteil: "1.0000", betrag: "500.00" }];
const vorschau = { verteilungsquelle: "berechnet", fondsId: FONDS_ID, art: "abruf", valuta: "2026-09-30", betrag: "500.00", waehrung: "EUR", verteilungsbasis: "zusage", aufteilung };
const knopf = "Mitteilungen freigeben: Kapitalabruf vom 15.03.2026";

describe("Kapitalbewegungen und Mitteilungen", () => {
  it("benennt Fondskennzahlen und Investorentabelle getrennt und hält die Tabelle fokussierbar", async () => {
    const kapitalstand = { abgerufen: "500.00", eingezahlt: "400.00", offen: "100.00", ueberfaellig: "0.00", ungeklaert: "0.00" };
    spieleApi({
      [`/api/v1/fonds/${FONDS_ID}/bewegungen/kapitalstand`]: {
        koerper: {
          quellenstand: "2026-10-01T10:11:12.345678Z",
          fonds: kapitalstand,
          konten: [{ organisationId: "investor-1", investor: "Investor Am Park", ...kapitalstand }],
        },
      },
    });
    rendereApp(url);
    const tabelle = await screen.findByRole("region", { name: "Kapitalstand je Investor" });
    expect(within(tabelle).getByRole("cell", { name: "Investor Am Park" })).toBeTruthy();
    expect(tabelle.tabIndex).toBe(0);
    const kennzahlen = screen.getByRole("region", { name: "Kapitalstand des Fonds" });
    expect(within(kennzahlen).getByText("Eingezahlt")).toBeTruthy();
  });

  it("listet die Bewegungen mit Status; offene bieten die Freigabe an, freigegebene nicht", async () => {
    spieleApi();
    rendereApp(url);
    const abschnitt = within(await screen.findByRole("region", { name: "Kapitalabrufe und Ausschüttungen" }));
    const zeilen = await abschnitt.findAllByRole("row");
    expect(zeilen).toHaveLength(3); // Kopf, Abruf, Ausschüttung
    expect(zeilen[1]!.textContent).toContain("Kapitalabruf");
    expect(zeilen[1]!.textContent).toContain("15.03.2026");
    expect(zeilen[1]!.textContent).toContain("Nicht freigegeben");
    expect(within(zeilen[1]!).getByRole("button", { name: knopf })).toBeTruthy();
    expect(zeilen[2]!.textContent).toContain("Freigegeben, 5 Investoren");
    expect(within(zeilen[2]!).queryByRole("button", { name: /Mitteilungen freigeben/ })).toBeNull();
  });

  it("Freigabe mit Sprachwahl und Vier-Augen-Hinweis; die Liste wird danach neu geladen", async () => {
    let erledigt = false;
    const api = spieleApi({
      [`/api/v1/fonds/${FONDS_ID}/bewegungen`]: () => ({
        koerper: { daten: bewegungenDaten.daten.map((b) => (b.id === BEWEGUNG_OFFEN_ID && erledigt ? { ...b, anzahlMitteilungen: 5 } : b)) },
      }),
      [`POST ${freigabePfad}`]: () => {
        erledigt = true;
        return { status: 201, koerper: { bewegungId: BEWEGUNG_OFFEN_ID, anzahl: 5, mitteilungen: [] } };
      },
    });
    rendereApp(url);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: knopf }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByText(/Vier-Augen-Prinzip: Die Mitteilungen gibt eine andere Person frei/)).toBeTruthy();
    await nutzer.click(dialog.getByRole("button", { name: "Englisch" }));
    await nutzer.click(dialog.getByRole("button", { name: "Jetzt freigeben" }));
    await waitFor(() => expect(api.anfragen("POST", freigabePfad)).toHaveLength(1));
    expect(api.anfragen("POST", freigabePfad)[0]!.koerper).toEqual({ sprache: "en" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findAllByText("Freigegeben, 5 Investoren")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: knopf })).toBeNull();
  });

  it("Vorgabe der Sprache ist Deutsch; ein Fehler der API steht übersetzt im offenen Dialog", async () => {
    const api = spieleApi({ [`POST ${freigabePfad}`]: fehler(409, "four_eyes_violated") });
    rendereApp(url);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: knopf }));
    const dialog = within(await screen.findByRole("dialog"));
    await nutzer.click(dialog.getByRole("button", { name: "Jetzt freigeben" }));
    expect((await dialog.findByRole("alert")).textContent).toContain("Dieser Schritt braucht eine zweite Person");
    expect(api.anfragen("POST", freigabePfad)[0]!.koerper).toEqual({ sprache: "de" });
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("ein Betrachter sieht die Liste, aber keine Freigabe, und einen Hinweis zur Rolle", async () => {
    spieleApi({ "/api/v1/me": alsRolle("betrachter") });
    rendereApp(url);
    const abschnitt = within(await screen.findByRole("region", { name: "Kapitalabrufe und Ausschüttungen" }));
    expect(await abschnitt.findByText("Nicht freigegeben")).toBeTruthy();
    expect(abschnitt.queryByRole("button", { name: /Mitteilungen freigeben/ })).toBeNull();
    expect(abschnitt.getByText(/Freigeber oder Verwalter/)).toBeTruthy();
  });

  it("ein Bearbeiter darf nicht freigeben", async () => {
    spieleApi({ "/api/v1/me": alsRolle("bearbeiter") });
    rendereApp(url);
    const abschnitt = within(await screen.findByRole("region", { name: "Kapitalabrufe und Ausschüttungen" }));
    expect(await abschnitt.findByText("Nicht freigegeben")).toBeTruthy();
    expect(abschnitt.queryByRole("button", { name: /Mitteilungen freigeben/ })).toBeNull();
  });

  it("zeigt bei früherem Wissensstand den aktuellen Buchungsstand und sperrt die Freigabe", async () => {
    spieleApi({ "/api/v1/fonds": { koerper: { daten: fondsDaten.daten.map((fonds) => ({ ...fonds, waehrung: "USD" })) } } });
    const stand = "2026-09-30T10:00:00Z";
    const stichtag = "2026-09-30";
    rendereApp(`${url}&asOf=${stichtag}&knowledgeDate=${encodeURIComponent(stand)}`);
    const abschnitt = within(await screen.findByRole("region", { name: "Kapitalabrufe und Ausschüttungen" }));
    expect(await abschnitt.findByText("Nicht freigegeben")).toBeTruthy();
    expect(within(abschnitt.getByRole("region", { name: "Kapitalbewegungen des Fonds" })).getAllByText(/\$/)).toHaveLength(2);
    expect(screen.getByText("Kapitaltransaktionen zeigen den aktuellen Buchungsstand.")).toBeTruthy();
    expect(abschnitt.queryByRole("button", { name: knopf })).toBeNull();
    expect(abschnitt.queryByRole("link", { name: /Journal/ })).toBeNull();
    expect(abschnitt.queryByRole("button", { name: "Kapitalabruf anlegen" })).toBeNull();
    expect(abschnitt.queryByRole("button", { name: /Aktionen für/ })).toBeNull();
  });

  it("zeigt Stornos sowie stornierte Bewegungen und bietet keine weitere Stornierung an", async () => {
    const [offen, fertig] = bewegungenDaten.daten as [(typeof bewegungenDaten.daten)[number], (typeof bewegungenDaten.daten)[number]];
    spieleApi({
      [`/api/v1/fonds/${FONDS_ID}/bewegungen`]: {
        koerper: {
          daten: [
            { ...offen, id: "s-1", betrag: "-250000.17", istStorno: true },
            { ...offen, id: "s-2", storniert: true },
            { ...fertig, storniert: true },
          ],
        },
      },
    });
    rendereApp(url);
    const abschnitt = within(await screen.findByRole("region", { name: "Kapitalabrufe und Ausschüttungen" }));
    const zeilen = await abschnitt.findAllByRole("row");
    expect(zeilen).toHaveLength(4);
    expect(zeilen[1]!.textContent).toContain("-250.000,17");
    expect(within(zeilen[1]!).getByText("Storno")).toBeTruthy();
    expect(within(zeilen[2]!).getByText("Storniert")).toBeTruthy();
    expect(zeilen[3]!.textContent).toContain("Freigegeben, 5 Investoren");
    expect(zeilen[3]!.textContent).toContain("Storniert, Mitteilungen bleiben bestehen");
    expect(abschnitt.queryByRole("button", { name: /Mitteilungen freigeben/ })).toBeNull();
    await userEvent.click(within(zeilen[3]!).getByRole("button", { name: /Aktionen für/ }));
    expect(screen.queryByRole("menuitem", { name: "Stornieren" })).toBeNull();
  });


  it.each([
    ["Kapitalabruf", "abruf"],
    ["Ausschüttung", "ausschuettung"],
  ])("prüft die Aufteilung und bucht %s direkt im Fonds", async (name, art) => {
    const api = spieleApi({
      "/api/v1/me": alsRolle("bearbeiter"),
      [vorschauPfad]: { koerper: { ...vorschau, art } },
      [`POST ${buchungPfad}`]: { status: 201, koerper: { typ: "fondsbewegung", bewegung: bewegungenDaten.daten[0] } },
    });
    rendereApp(url);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: `${name} anlegen` }));
    const dialog = within(await screen.findByRole("dialog"));
    await nutzer.type(dialog.getByRole("textbox", { name: "Betrag (EUR)" }), "500,00");
    await nutzer.click(dialog.getByRole("button", { name: "Aufteilung prüfen" }));
    expect(await dialog.findByText("Investor Am Park")).toBeTruthy();
    expect(dialog.getByText(/500,00/)).toBeTruthy();
    expect(api.anfragen("POST", buchungPfad)).toHaveLength(0);
    const betrag = dialog.getByRole("textbox", { name: "Betrag (EUR)" });
    await nutzer.clear(betrag);
    await nutzer.type(betrag, "501");
    expect(dialog.queryByRole("button", { name: `${name} buchen` })).toBeNull();
    expect(dialog.queryByText("Investor Am Park")).toBeNull();
    await nutzer.clear(betrag);
    await nutzer.type(betrag, "500,00");
    await nutzer.click(dialog.getByRole("button", { name: `${name} buchen` }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.anfragen("POST", buchungPfad)[0]!.koerper).toMatchObject({ kind: "fund_posting", type: art === "abruf" ? "capital_call" : "distribution", amount: "500.00" });
    expect(api.anfragen("GET", `/api/v1/fonds/${FONDS_ID}/bewegungen`)).toHaveLength(2);
  });

  it("verhindert eine Buchung ohne Zeichnungen und verlinkt deren Verwaltung", async () => {
    const api = spieleApi({ [vorschauPfad]: { koerper: { ...vorschau, verteilungsbasis: null, aufteilung: [] } } });
    rendereApp(url);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Kapitalabruf anlegen" }));
    const dialog = within(await screen.findByRole("dialog"));
    await nutzer.type(dialog.getByRole("textbox", { name: "Betrag (EUR)" }), "500");
    await nutzer.click(dialog.getByRole("button", { name: "Aufteilung prüfen" }));
    expect(await dialog.findByText(/keine Zeichnungen hinterlegt/)).toBeTruthy();
    expect(dialog.getByRole("link", { name: "Fondszeichnungen verwalten" }).getAttribute("href")).toContain("tab=investors");
    expect(dialog.queryByRole("button", { name: "Kapitalabruf buchen" })).toBeNull();
    expect(api.anfragen("POST", buchungPfad)).toHaveLength(0);
  });

  it("zeigt die Überschreitung des Zeichnungskapitals bei der Vorschau", async () => {
    const api = spieleApi({ [vorschauPfad]: fehler(409, "call_exceeds_subscribed_capital") });
    rendereApp(url);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Kapitalabruf anlegen" }));
    const dialog = within(await screen.findByRole("dialog"));
    await nutzer.type(dialog.getByRole("textbox", { name: "Betrag (EUR)" }), "100000000");
    await nutzer.click(dialog.getByRole("button", { name: "Aufteilung prüfen" }));
    expect((await dialog.findByRole("alert")).textContent).toContain("Die Abrufe würden das Zeichnungskapital des Fonds übersteigen.");
    expect(api.anfragen("POST", buchungPfad)).toHaveLength(0);
  });

  it("öffnet die gespeicherte Aufteilung aus einem direkten Link auch für Betrachter", async () => {
    spieleApi({
      "/api/v1/me": alsRolle("betrachter"),
      [`/api/v1/fondsbewegungen/${BEWEGUNG_FERTIG_ID}`]: {
        koerper: { ...vorschau, art: "ausschuettung", verteilungsquelle: "mitteilungen", aufteilung: [{ ...aufteilung[0], zeichnungId: null, zusage: null, anteil: null }] },
      },
    });
    rendereApp(`${url}&movementId=${BEWEGUNG_FERTIG_ID}&knowledgeDate=2026-09-30T10:00:00Z`);
    const dialog = within(await screen.findByRole("dialog"));
    expect(await dialog.findByText("Beträge aus den freigegebenen Mitteilungen.")).toBeTruthy();
    expect(dialog.getByText("Investor Am Park")).toBeTruthy();
    expect(dialog.getByText("Kapitaltransaktionen zeigen den aktuellen Buchungsstand.")).toBeTruthy();
    expect(dialog.queryByRole("columnheader", { name: "Zusage" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Ausschüttung anlegen" })).toBeNull();
  });

  it("bucht eine Teilzahlung mit Wertstellung für den gewählten Investor", async () => {
    const detail = `/api/v1/fondsbewegungen/${BEWEGUNG_OFFEN_ID}`;
    const pfad = detail + "/zahlungen";
    const api = spieleApi({
      [detail]: { koerper: { ...vorschau, id: BEWEGUNG_OFFEN_ID } },
      [pfad]: { koerper: { faelligAm: "2026-10-15", positionen: [{ organisationId: "investor-1", eingezahlt: "0.00", offen: "500.00", ueberfaellig: "0.00", ungeklaert: "0.00" }], zahlungen: [] } },
      [`POST ${pfad}`]: { status: 201, koerper: {} },
    });
    rendereApp(`${url}&movementId=${BEWEGUNG_OFFEN_ID}&asOf=2026-10-15`);
    const dialog = within(await screen.findByRole("dialog"));
    const nutzer = userEvent.setup();
    await nutzer.click(await dialog.findByRole("button", { name: "Zahlung erfassen" }));
    await nutzer.type(dialog.getByRole("textbox", { name: "Betrag (EUR)" }), "200,50");
    await nutzer.click(dialog.getByRole("button", { name: "Zahlung buchen" }));
    await waitFor(() => expect(api.anfragen("POST", pfad)[0]?.koerper).toMatchObject({
      organisationId: "investor-1", betrag: "200.50", valuta: "2026-10-15",
    }));
  });

  it("storniert eine offene Bewegung mit Grund direkt im Fonds und aktualisiert die Liste", async () => {
    const [original, ausschuettung] = bewegungenDaten.daten;
    const stornoPfad = `/api/v1/fondsbewegungen/${BEWEGUNG_OFFEN_ID}/storno`;
    let storniert = false;
    const api = spieleApi({
      [`/api/v1/fonds/${FONDS_ID}/bewegungen`]: () => ({ koerper: { daten: [{ ...original, storniert }, ausschuettung] } }),
      [`POST ${stornoPfad}`]: () => {
        storniert = true;
        return { status: 201, koerper: {} };
      },
    });
    rendereApp(url);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Aktionen für Kapitalabruf vom 15.03.2026" }));
    await nutzer.click(screen.getByRole("menuitem", { name: "Stornieren" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Buchung stornieren" }));
    await nutzer.type(dialog.getByRole("textbox", { name: "Grund" }), "Doppelt erfasst");
    await nutzer.click(dialog.getByRole("button", { name: "Stornieren" }));
    expect(await screen.findByText("Storniert")).toBeTruthy();
    expect(api.anfragen("POST", stornoPfad)[0]!.koerper).toEqual({ grund: "Doppelt erfasst" });
  });
});

it.each([
  ["Abgerufen", "Kapitalabruf", "investor-1"],
  ["Eingezahlt", "Teilzahlung", "zahlung-1"],
])("öffnet aus %s die gebuchte Position und ihre Belege mit demselben Wissensstand", async (kennzahl, art, positionId) => {
  const stichtag = "2026-03-31", stand = "2026-04-01T10:11:12.123456Z";
  const pfad = `/api/v1/fonds/${FONDS_ID}/bewegungen/herkunft`;
  const basis = { bewegungId: BEWEGUNG_OFFEN_ID, organisationId: "investor-1", investor: "Investor Am Park", datum: "2026-03-15" };
  const api = spieleApi({
    "/api/v1/me": alsRolle("betrachter"),
    [pfad]: { koerper: {
      waehrung: "EUR",
      abgerufen: [{ ...basis, id: "investor-1", art: "abruf", betrag: "500.00", offen: "100.00", faelligAm: stichtag }],
      eingezahlt: [{ ...basis, id: "zahlung-1", art: "teilzahlung", betrag: "400.00", referenz: "Kontoauszug 8" }],
      nachweise: {
        abruf: { id: BEWEGUNG_OFFEN_ID, valuta: basis.datum, betrag: "500.00", bemerkung: "Erster Abruf" },
        belege: [{ id: "b1", datei: "Abrufbeleg.pdf", am: stand }],
        mitteilungen: [{ id: "m1", organisationId: basis.organisationId, datei: "Mitteilung.pdf", von: "system", am: stand }],
      },
    } },
  });
  rendereApp(`${url}&asOf=${stichtag}&knowledgeDate=${stand}`);
  const nutzer = userEvent.setup();
  await nutzer.click(await screen.findByRole("button", { description: `Herkunft von ${kennzahl} anzeigen` }));
  const dialog = within(await screen.findByRole("dialog"));
  await nutzer.click(await dialog.findByText(`= ${kennzahl}`, { selector: "summary span" }));
  const einzelwert = dialog.getByRole("link", { name: `${art} · Investor Am Park` });
  expect(einzelwert.getAttribute("href")).toContain(`/${BEWEGUNG_OFFEN_ID}/${positionId}`);
  await nutzer.click(einzelwert);
  await screen.findByRole("heading", { name: art, level: 1 });
  expect(screen.getByText(/Stichtag 31\.03\.2026 · Wissensstand/)).toBeTruthy();
  expect(screen.getByText("Erster Abruf")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Abrufbeleg.pdf" }).getAttribute("href")).toBe("/api/v1/vouchers/b1/file");
  const mitteilung = new URL(screen.getByRole("link", { name: "Mitteilung.pdf" }).getAttribute("href")!, "http://localhost");
  expect(mitteilung.searchParams.get("knowledgeDate")).toBe(stand);
  expect(mitteilung.searchParams.get("asOf")).toBe(stichtag);
  const query = api.anfragen("GET", pfad).at(-1)!.query;
  expect(Object.fromEntries(query)).toEqual({ stichtag, stand, bewegungId: BEWEGUNG_OFFEN_ID });
  if (kennzahl === "Eingezahlt") {
    expect(screen.getByText("Kontoauszug 8")).toBeTruthy();
    await nutzer.click(screen.getByRole("link", { name: /15\.03\.2026 · 500,00/ }));
    await screen.findByRole("heading", { name: "Kapitalabruf", level: 1 });
  }
});
