import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { alsRolle, FONDS_ID, fehler, rendereApp, spieleApi, vorlagenDaten } from "../test/hilfen";
import { de } from "../i18n/de";
import { en } from "../i18n/en";

const URL_VORLAGEN = `/reports/templates?fundId=${FONDS_ID}`;
const PUT_LP = `PUT /api/v1/funds/${FONDS_ID}/report-templates/lp_report`;
const PUT_STUFEN = `PUT /api/v1/funds/${FONDS_ID}/approval-stages`;

/** Ordnet per Tastatur: Griff aufnehmen, mit den Pfeiltasten bewegen, ablegen. */
const ordne = (griff: HTMLElement, ...tasten: string[]) => {
  fireEvent.keyDown(griff, { key: " " });
  for (const taste of tasten) fireEvent.keyDown(griff, { key: taste });
  fireEvent.keyDown(griff, { key: " " });
};

describe("Vorlagen und Freigabestufen", () => {
  it("ist für Verwalter von der Berichtsliste aus erreichbar", async () => {
    spieleApi();
    rendereApp("/reports");
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("link", { name: "Vorlagen und Stufen" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Vorlagen und Freigabestufen" })).toBeTruthy();
  });

  it("zeigt die Konfiguration als Formular und speichert die ganze Konfiguration mit der gewählten Reihenfolge", async () => {
    // Nach dem Speichern liefert die API die neue Konfiguration; das Formular baut sich dabei neu auf, die Meldung bleibt trotzdem stehen.
    let gespeichert: Record<string, unknown> | null = null;
    const api = spieleApi({
      [PUT_LP]: (anfrage) => {
        gespeichert = anfrage.koerper as Record<string, unknown>;
        return { koerper: { art: "lp_bericht", angepasst: true, konfiguration: gespeichert } };
      },
      [`/api/v1/funds/${FONDS_ID}/report-templates`]: () => ({ koerper: { daten: vorlagenDaten.daten.map((v) => (v.art === "lp_bericht" && gespeichert ? { ...v, konfiguration: gespeichert } : v)) } }),
    });
    rendereApp(URL_VORLAGEN);
    const nutzer = userEvent.setup();
    const bereich = within(await screen.findByRole("region", { name: "Berichtsvorlagen" }));
    expect(await bereich.findByText("Angepasst")).toBeTruthy();
    // Einheit TEUR ist aus der Vorlage gesetzt
    expect(bereich.getByRole("button", { name: "Tausend Euro" }).getAttribute("aria-pressed")).toBe("true");
    await nutzer.click(bereich.getByRole("button", { name: "Euro" }));
    ordne(bereich.getByRole("button", { name: "Eintrag verschieben: Kapitalkonten" }), "ArrowUp");
    await nutzer.click(bereich.getByRole("checkbox", { name: "Herkunft der Zahlen" }));
    await nutzer.click(bereich.getByRole("checkbox", { name: "Zeichnungskapital" }));
    await nutzer.click(bereich.getByRole("button", { name: "Vorlage speichern" }));
    await waitFor(() => expect(api.anfragen("PUT", `/api/v1/funds/${FONDS_ID}/report-templates/lp_report`)).toHaveLength(1));
    expect(api.anfragen("PUT", `/api/v1/funds/${FONDS_ID}/report-templates/lp_report`)[0]!.koerper).toEqual({
      einheit: "EUR",
      abschnitte: ["vorwort", "kennzahlen", "kapitalkonten", "marktumfeld", "portfolio", "realisierungen", "bewertung", "ausblick"],
      kennzahlen: ["nav", "tvpi", "zeichnungskapital"],
      spalten: ["unternehmen", "bewertung"],
    });
    expect(await bereich.findByText(de.vorlagen.vorlage.gespeichert)).toBeTruthy();
    // Die neu aufgebauten Werte sind die gespeicherten, und die Meldung bleibt, bis weiter geändert wird.
    await waitFor(() => expect(bereich.getByRole("button", { name: "Euro" }).getAttribute("aria-pressed")).toBe("true"));
    expect(bereich.getByText(de.vorlagen.vorlage.gespeichert)).toBeTruthy();
    await nutzer.click(bereich.getByRole("button", { name: "Tausend Euro" }));
    expect(bereich.queryByText(de.vorlagen.vorlage.gespeichert)).toBeNull();
  });

  it("bietet nur an, was die API als erlaubt meldet (keine eigene Abschrift in der Oberfläche)", async () => {
    const daten = {
      daten: vorlagenDaten.daten.map((v) =>
        v.art === "lp_bericht" ? { ...v, erlaubt: { ...v.erlaubt, spalten: ["unternehmen", "bewertung"], kennzahlen: ["nav", "tvpi"] } } : v,
      ),
    };
    spieleApi({ [`/api/v1/funds/${FONDS_ID}/report-templates`]: { koerper: daten } });
    rendereApp(URL_VORLAGEN);
    const bereich = within(await screen.findByRole("region", { name: "Berichtsvorlagen" }));
    await bereich.findByText("Angepasst");
    expect(bereich.queryByRole("checkbox", { name: "Rückflüsse" })).toBeNull();
    expect(bereich.queryByRole("checkbox", { name: "Zeichnungskapital" })).toBeNull();
    expect(bereich.getByRole("checkbox", { name: "NAV" })).toBeTruthy();
  });

  it("eigene Felder als Spalten: angeboten werden die Felder der vier Objekte, gesendet werden die gewählten in ihrer Reihenfolge", async () => {
    const definition = (objekt: string, id: string, name: string) => ({ id, objekt, schluessel: name.toLowerCase(), name, typ: "text", optionen: {}, position: 0, version: 1, archiviertAm: null });
    const daten = {
      daten: vorlagenDaten.daten.map((v) => (v.art === "lp_bericht" ? { ...v, konfiguration: { ...v.konfiguration, zusatzfelder: [] }, erlaubt: { ...v.erlaubt, zusatzfelder: true } } : v)),
    };
    const api = spieleApi({
      [`/api/v1/funds/${FONDS_ID}/report-templates`]: { koerper: daten },
      "/api/v1/zusatzfelder/fonds/definitionen": { koerper: { daten: [definition("fonds", "11111111-1111-4111-8111-111111111111", "Strategie")] } },
      "/api/v1/zusatzfelder/runde/definitionen": { koerper: { daten: [] } },
      "/api/v1/zusatzfelder/instrument/definitionen": { koerper: { daten: [definition("instrument", "22222222-2222-4222-8222-222222222222", "Sicherheit")] } },
      "/api/v1/zusatzfelder/beteiligung/definitionen": { koerper: { daten: [definition("beteiligung", "33333333-3333-4333-8333-333333333333", "Board-Sitz")] } },
      [PUT_LP]: { koerper: { art: "lp_bericht", angepasst: true, konfiguration: {} } },
    });
    rendereApp(URL_VORLAGEN);
    const nutzer = userEvent.setup();
    const bereich = within(await screen.findByRole("region", { name: "Berichtsvorlagen" }));
    await nutzer.click(await bereich.findByRole("checkbox", { name: "Board-Sitz (Beteiligung)" }));
    await nutzer.click(bereich.getByRole("checkbox", { name: "Strategie (Fonds)" }));
    await nutzer.click(bereich.getByRole("button", { name: "Vorlage speichern" }));
    await waitFor(() => expect(api.anfragen("PUT", `/api/v1/funds/${FONDS_ID}/report-templates/lp_report`)).toHaveLength(1));
    expect(api.anfragen("PUT", `/api/v1/funds/${FONDS_ID}/report-templates/lp_report`)[0]!.koerper).toMatchObject({ zusatzfelder: ["33333333-3333-4333-8333-333333333333", "11111111-1111-4111-8111-111111111111"] });
  });

  it("setzt Standardwerte ein, ohne zu speichern", async () => {
    const api = spieleApi();
    rendereApp(URL_VORLAGEN);
    const nutzer = userEvent.setup();
    const bereich = within(await screen.findByRole("region", { name: "Berichtsvorlagen" }));
    await bereich.findByText("Angepasst");
    expect((bereich.getByRole("checkbox", { name: "Rückflüsse" }) as HTMLInputElement).checked).toBe(false);
    await nutzer.click(bereich.getByRole("button", { name: "Standardwerte einsetzen" }));
    expect((bereich.getByRole("checkbox", { name: "Rückflüsse" }) as HTMLInputElement).checked).toBe(true);
    expect(api.anfragen("PUT", `/api/v1/funds/${FONDS_ID}/report-templates/lp_report`)).toHaveLength(0);
  });

  it("Quartalsbericht: Einheit und Abschnitte (mit Kennzahlen des Unternehmens), leere Auswahl wird abgelehnt", async () => {
    const api = spieleApi({ [`PUT /api/v1/funds/${FONDS_ID}/report-templates/quarterly_report`]: { koerper: { art: "quartalsbericht", angepasst: true, konfiguration: {} } } });
    rendereApp(URL_VORLAGEN);
    const nutzer = userEvent.setup();
    const bereich = within(await screen.findByRole("region", { name: "Berichtsvorlagen" }));
    await nutzer.selectOptions(await bereich.findByLabelText("Berichtsart"), "quartalsbericht");
    expect((await bereich.findByRole("checkbox", { name: "Kennzahlen des Unternehmens" })) as HTMLInputElement).toBeTruthy();
    expect((bereich.getByRole("checkbox", { name: "Vorgänge des Quartals" }) as HTMLInputElement).checked).toBe(true);
    await nutzer.click(bereich.getByRole("button", { name: "Tausend Euro" }));
    await nutzer.click(bereich.getByRole("checkbox", { name: "Vorgänge des Quartals" }));
    await nutzer.click(bereich.getByRole("button", { name: "Vorlage speichern" }));
    await waitFor(() => expect(api.anfragen("PUT", `/api/v1/funds/${FONDS_ID}/report-templates/quarterly_report`)).toHaveLength(1));
    expect(api.anfragen("PUT", `/api/v1/funds/${FONDS_ID}/report-templates/quarterly_report`)[0]!.koerper).toEqual({ einheit: "TEUR", abschnitte: ["bewertungsverlauf", "unternehmenskennzahlen"], kennzahlen: [], spalten: [], unternehmenskennzahlen: [] });

    await nutzer.selectOptions(bereich.getByLabelText("Berichtsart"), "portfolioliste");
    await nutzer.click(await bereich.findByRole("button", { name: "Standardwerte einsetzen" }));
    for (const box of bereich.getAllByRole("checkbox")) if ((box as HTMLInputElement).checked) await nutzer.click(box);
    await nutzer.click(bereich.getByRole("button", { name: "Vorlage speichern" }));
    expect(await bereich.findByText(de.vorlagen.vorlage.mindestensEins)).toBeTruthy();
    expect(api.anfragen("PUT", `/api/v1/funds/${FONDS_ID}/report-templates/portfolio_list`)).toHaveLength(0);
  });

  it("Quartalsbericht: Kennzahlen des Unternehmens aus der Auswahl des Fonds wählen und mitspeichern", async () => {
    const definition = (schluessel: string, de: string, en: string) => ({ schluessel, bezeichnungDe: de, bezeichnungEn: en, kategorie: "finanzen", einheit: "EUR", typ: "betrag" });
    const auswahl = { daten: [
      { schluessel: "umsatz", reihenfolge: 0, gueltig: true, definition: definition("umsatz", "Umsatz", "Revenue") },
      { schluessel: "ebitda", reihenfolge: 1, gueltig: true, definition: definition("ebitda", "EBITDA", "EBITDA") },
    ] };
    const api = spieleApi({
      [`/api/v1/fonds/${FONDS_ID}/kennzahlen/auswahl`]: { koerper: auswahl },
      [`PUT /api/v1/funds/${FONDS_ID}/report-templates/quarterly_report`]: { koerper: { art: "quartalsbericht", angepasst: true, konfiguration: {} } },
    });
    rendereApp(URL_VORLAGEN);
    const nutzer = userEvent.setup();
    const bereich = within(await screen.findByRole("region", { name: "Berichtsvorlagen" }));
    await nutzer.selectOptions(await bereich.findByLabelText("Berichtsart"), "quartalsbericht");
    const gruppe = within(await bereich.findByRole("group", { name: de.vorlagen.vorlage.unternehmenskennzahlen }));
    expect(gruppe.getByRole("checkbox", { name: "Umsatz" })).toBeTruthy();
    await nutzer.click(gruppe.getByRole("checkbox", { name: "EBITDA" }));
    await nutzer.click(gruppe.getByRole("checkbox", { name: "Umsatz" }));
    ordne(gruppe.getByRole("button", { name: "Eintrag verschieben: EBITDA" }), "ArrowUp");
    await nutzer.click(bereich.getByRole("button", { name: "Vorlage speichern" }));
    await waitFor(() => expect(api.anfragen("PUT", `/api/v1/funds/${FONDS_ID}/report-templates/quarterly_report`)).toHaveLength(1));
    expect(api.anfragen("PUT", `/api/v1/funds/${FONDS_ID}/report-templates/quarterly_report`)[0]!.koerper).toMatchObject({ unternehmenskennzahlen: ["ebitda", "umsatz"] });
    // Ohne den Abschnitt gibt es die Auswahl nicht.
    await nutzer.click(bereich.getByRole("checkbox", { name: "Kennzahlen des Unternehmens" }));
    expect(bereich.queryByRole("group", { name: de.vorlagen.vorlage.unternehmenskennzahlen })).toBeNull();
  });

  it("zeigt Feldfehler der API", async () => {
    spieleApi({ [PUT_LP]: fehler(400, "invalid_input", { felder: [{ feld: "abschnitte", code: "custom", meldung: "x" }] }) });
    rendereApp(URL_VORLAGEN);
    const nutzer = userEvent.setup();
    const bereich = within(await screen.findByRole("region", { name: "Berichtsvorlagen" }));
    await bereich.findByText("Angepasst");
    await nutzer.click(bereich.getByRole("button", { name: "Vorlage speichern" }));
    expect(await bereich.findByText(/abschnitte: Die Angabe passt nicht\./)).toBeTruthy();
  });

  it("bearbeitet die Stufen: umbenennen, ergänzen, keine doppelten Namen, speichern", async () => {
    const api = spieleApi({ [PUT_STUFEN]: { koerper: { stages: [] } } });
    rendereApp(URL_VORLAGEN);
    const nutzer = userEvent.setup();
    const bereich = within(await screen.findByRole("region", { name: "Freigabestufen" }));
    const erste = await bereich.findByLabelText("Name der Stufe 1");
    expect((erste as HTMLInputElement).value).toBe("Investmentmanager");
    fireEvent.change(erste, { target: { value: "Fachbereich" } });
    await nutzer.click(bereich.getByRole("button", { name: "Stufe hinzufügen" }));
    expect((bereich.getByLabelText("Name der Stufe 4") as HTMLInputElement).value).toBe("");
    await nutzer.click(bereich.getByRole("button", { name: "Stufen speichern" }));
    expect(await bereich.findByText(de.vorlagen.stufen.leer)).toBeTruthy();
    fireEvent.change(bereich.getByLabelText("Name der Stufe 4"), { target: { value: "teamleitung" } });
    await nutzer.click(bereich.getByRole("button", { name: "Stufen speichern" }));
    expect(await bereich.findByText(de.vorlagen.stufen.doppelt)).toBeTruthy();
    expect(api.anfragen("PUT", `/api/v1/funds/${FONDS_ID}/approval-stages`)).toHaveLength(0);
    fireEvent.change(bereich.getByLabelText("Name der Stufe 4"), { target: { value: "Aufsicht" } });
    ordne(bereich.getByRole("button", { name: "Stufe verschieben: Aufsicht" }), "ArrowUp");
    await nutzer.click(bereich.getByRole("button", { name: "Stufen speichern" }));
    await waitFor(() => expect(api.anfragen("PUT", `/api/v1/funds/${FONDS_ID}/approval-stages`)).toHaveLength(1));
    expect(api.anfragen("PUT", `/api/v1/funds/${FONDS_ID}/approval-stages`)[0]!.koerper).toEqual({ stages: ["Fachbereich", "Teamleitung", "Aufsicht", "Geschäftsführung"] });
  });

  it("erlaubt keine Stufe unter zwei und keine über sechs", async () => {
    spieleApi({ [`/api/v1/funds/${FONDS_ID}/approval-stages`]: { koerper: { stages: ["A", "B"] } } });
    rendereApp(URL_VORLAGEN);
    const nutzer = userEvent.setup();
    const bereich = within(await screen.findByRole("region", { name: "Freigabestufen" }));
    expect((await bereich.findByRole("button", { name: "Stufe entfernen: A" }) as HTMLButtonElement).disabled).toBe(true);
    for (let i = 0; i < 4; i++) await nutzer.click(bereich.getByRole("button", { name: "Stufe hinzufügen" }));
    expect((bereich.getByRole("button", { name: "Stufe hinzufügen" }) as HTMLButtonElement).disabled).toBe(true);
    expect(bereich.getAllByRole("listitem")).toHaveLength(6);
  });

  it("zeigt Freigebern und Bearbeitern nur den Hinweis ohne Formulare, in beiden Sprachen", async () => {
    spieleApi({ "/api/v1/me": alsRolle("freigeber") });
    const { unmount } = rendereApp(URL_VORLAGEN);
    expect(await screen.findByText(de.vorlagen.nurVerwalter)).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Berichtsvorlagen" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Stufen speichern" })).toBeNull();
    unmount();

    spieleApi({ "/api/v1/me": alsRolle("freigeber") });
    localStorage.setItem("carraway.sprache", "en");
    rendereApp("/reports");
    await screen.findByRole("heading", { level: 1, name: "Reports" });
    expect(screen.queryByRole("link", { name: en.vorlagen.link })).toBeNull();
    localStorage.removeItem("carraway.sprache");
  });
});
