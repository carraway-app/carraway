import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { BET_ID, INSTR_ID, MS_ERFUELLT, MS_OFFEN, fehler, instrumentDaten, rendereApp, spieleApi, waehleAktion } from "../test/hilfen";
import { feldpruefungTexte } from "../i18n/feldpruefung";

const url = `/beteiligungen/${BET_ID}`;
const vorgaengeUrl = `${url}?tab=finanzierung&unter=transaktionen`;
const instrumenteUrl = `${url}?tab=finanzierung&unter=instrumente`;
const schmal = (text: string | null) => (text ?? "").replace(/\s/g, " ");
const abschnitt = async () => within(await screen.findByRole("region", { name: "Instrument" }));
const dialog = () => within(screen.getByRole("dialog"));
const instrumente = async () => within(await screen.findByRole("region", { name: "Instrumente" }));
/** „Vorgang erfassen“ öffnen; der Dialog lädt erst beim Öffnen. */
async function oeffneVorgang(nutzer: Parameters<typeof waehleAktion>[0]) {
  await waehleAktion(nutzer, "Vorgang erfassen");
  await screen.findByRole("dialog");
}

describe("Instrument: Anzeige", () => {
  it("zeigt Buchwert mit Herkunft und Jahresüberschüsse; Konditionen und Tranchen stehen im Bereich Instrumente", async () => {
    spieleApi();
    rendereApp(url);
    const nutzer = userEvent.setup();
    const inst = await abschnitt();
    await inst.findByText("Jahresüberschüsse");

    const kennzahlen = inst.getByRole("region", { name: "Buchwert" });
    expect(schmal(kennzahlen.textContent)).toContain("1.012.000,00 €");
    await nutzer.click(within(kennzahlen).getByRole("button", { name: "Herkunft von Buchwert anzeigen" }));
    expect(within(screen.getByRole("dialog")).getByText("Kapitalisierte Zinsen")).toBeTruthy();
    await nutzer.click(dialog().getByRole("button", { name: "Schließen" }));

    const ueberschuesse = inst.getByRole("region", { name: "Jahresüberschüsse" });
    expect(schmal(ueberschuesse.textContent)).toContain("250.000,00 €");
    // nichts davon doppelt in der Übersicht
    expect(inst.queryByRole("region", { name: "Konditionen" })).toBeNull();
    expect(inst.queryByRole("region", { name: "Meilensteine" })).toBeNull();
  });

  it("zeigt je Instrument Zusage, Konditionen mit Verlauf und die Tranchen mit Stand und Bedingung", async () => {
    spieleApi();
    rendereApp(instrumenteUrl);
    const inst = await instrumente();
    const karte = await inst.findByRole("group", { name: /^Wandeldarlehen 2021/ });
    expect(schmal(karte.textContent)).toContain("Zusage");
    expect(schmal(karte.textContent)).toContain("1.000.000,00 €");
    expect(within(karte).getByText("0 von 2 gezahlt")).toBeTruthy();
    expect(schmal(within(karte).getByRole("heading", { name: "Konditionen" }).closest("section")!.textContent)).toContain("6,5 %");

    // gültig ist die zweite Version (ab 2023), beide stehen im Verlauf
    const verlauf = inst.getByRole("group", { name: "Verlauf der Versionen · Wandeldarlehen 2021" });
    const zeilen = within(verlauf).getAllByRole("row");
    expect(zeilen).toHaveLength(3);
    expect(zeilen[2]!.getAttribute("aria-current")).toBe("true");
    expect(schmal(zeilen[1]!.textContent)).toContain("6 %");
    expect(zeilen[2]!.textContent).toContain("10\u00A0% / Kappung 2\u00A0%");

    const tranchen = within(within(karte).getByRole("table"));
    const reihen = tranchen.getAllByRole("row");
    expect(reihen).toHaveLength(3);
    expect(schmal(reihen[1]!.textContent)).toContain("Produktfreigabe");
    expect(reihen[1]!.textContent).toContain("Teilweise gezahlt");
    expect(reihen[1]!.textContent).toContain("Erfüllt am 15.03.2022");
    expect(schmal(reihen[2]!.textContent)).toContain("Umsatz über 2 Mio. €");
    expect(reihen[2]!.textContent).toContain("Zugesagt");
    expect(reihen[2]!.textContent).toContain("Offen");
  });

  it("zeigt den Abschnitt auf Englisch mit übersetztem Rechenweg", async () => {
    spieleApi();
    localStorage.setItem("carraway.sprache", "en");
    rendereApp(url);
    const nutzer = userEvent.setup();
    const inst = await abschnitt();
    await nutzer.click(await inst.findByRole("button", { name: "Show origin of Carrying amount" }));
    expect(within(screen.getByRole("dialog")).getByText("Capitalised interest")).toBeTruthy();
    await nutzer.click(screen.getByRole("button", { name: "Instruments" }));
    expect(await screen.findByRole("button", { name: "Terms: Wandeldarlehen 2021" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add tranche: Wandeldarlehen 2021" })).toBeTruthy();
    localStorage.removeItem("carraway.sprache");
  });

  it("sperrt Änderungen mit einem Wissensstand in der URL", async () => {
    spieleApi();
    rendereApp(`${url}?stand=2026-11-01T10:00:00Z`);
    const inst = await abschnitt();
    await inst.findByText("Jahresüberschüsse");
    expect(screen.queryByRole("button", { name: "Vorgang erfassen" })).toBeNull();
    expect(inst.getByText(/Änderungen sind erst im aktuellen Stand möglich/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /stornieren/ })).toBeNull();
  });
});

describe("Vorgang erfassen", () => {
  it("meldet einen Invariantenfehler als Hinweis mit Beträgen", async () => {
    const api = spieleApi({
      [`POST /api/v1/beteiligungen/${BET_ID}/vorgaenge`]: fehler(409, "AUSZAHLUNG_UEBER_ZUSAGE", { zusage: "1000000.00", investiert: "1000000.00" }),
    });
    rendereApp(url);
    const nutzer = userEvent.setup();
    await oeffneVorgang(nutzer);
    const d = dialog();
    await nutzer.selectOptions(d.getByLabelText("Art"), "auszahlung");
    await nutzer.type(d.getByLabelText("Betrag in Euro"), "50000");
    await nutzer.click(d.getByRole("button", { name: "Vorgang buchen" }));

    const hinweis = await d.findByRole("alert");
    expect(hinweis.textContent).toContain("Die Auszahlungen würden die Zusage übersteigen");
    expect(schmal(hinweis.textContent)).toContain("Die Zusage beträgt 1.000.000 €, bisher ausgezahlt sind 1.000.000 €.");
    const body = api.anfragen("POST", `/api/v1/beteiligungen/${BET_ID}/vorgaenge`)[0]!.koerper;
    expect(body).toMatchObject({ art: "auszahlung", betrag: "50000", instrumentId: INSTR_ID });
  });

  it("zeigt Feldfehler am Feld und den Buchwert nach dem Buchen", async () => {
    let versuche = 0;
    spieleApi({
      [`POST /api/v1/beteiligungen/${BET_ID}/vorgaenge`]: () => {
        versuche++;
        return versuche === 1
          ? { status: 400, koerper: { fehler: { code: "EINGABE_UNGUELTIG", meldung: "x", felder: [{ feld: "betrag", code: "invalid_format", meldung: "x" }] } } }
          : { status: 201, koerper: { vorgang: {}, buchwert: "1062000.00" } };
      },
    });
    rendereApp(url);
    const nutzer = userEvent.setup();
    await oeffneVorgang(nutzer);
    const d = dialog();
    // Die Eingabe wird schon beim Tippen geprüft; eine ungültige Eingabe geht nicht an die API.
    await nutzer.type(d.getByLabelText("Betrag in Euro"), "abc");
    expect(await d.findByText(feldpruefungTexte.de.zahlFormat)).toBeTruthy();
    await nutzer.click(d.getByRole("button", { name: "Vorgang buchen" }));
    expect(versuche).toBe(0);
    // Ein Fehler der API erscheint weiter am Feld.
    await nutzer.clear(d.getByLabelText("Betrag in Euro"));
    await nutzer.type(d.getByLabelText("Betrag in Euro"), "1000");
    await nutzer.click(d.getByRole("button", { name: "Vorgang buchen" }));
    expect(await d.findByText("Das Format passt nicht (zum Beispiel bei E-Mail, Betrag oder Datum).")).toBeTruthy();
    expect(d.getByLabelText("Betrag in Euro").getAttribute("aria-invalid")).toBe("true");
    await nutzer.click(d.getByRole("button", { name: "Vorgang buchen" }));
    expect(await d.findByText(/Der Buchwert beträgt jetzt 1\.062\.000,00/)).toBeTruthy();
  });

  it("sperrt die Auszahlung zu einer Tranche mit offener Bedingung und erklärt warum", async () => {
    const api = spieleApi();
    rendereApp(url);
    const nutzer = userEvent.setup();
    await oeffneVorgang(nutzer);
    const d = dialog();
    expect((d.getByLabelText("Instrument") as HTMLSelectElement).value).toBe(INSTR_ID);
    await nutzer.type(d.getByLabelText("Betrag in Euro"), "100000");
    await nutzer.selectOptions(d.getByLabelText("Tranche (optional)"), MS_OFFEN);
    expect(d.getByText(/Die Bedingung der Tranche „Umsatzziel“ ist noch nicht erfüllt/)).toBeTruthy();
    const knopf = d.getByRole("button", { name: "Vorgang buchen" }) as HTMLButtonElement;
    expect(knopf.disabled).toBe(true);
    expect(knopf.getAttribute("aria-describedby")).toBe("tranche-gesperrt");
    await nutzer.selectOptions(d.getByLabelText("Tranche (optional)"), MS_ERFUELLT);
    expect((d.getByRole("button", { name: "Vorgang buchen" }) as HTMLButtonElement).disabled).toBe(false);
    expect(api.anfragen("POST", `/api/v1/beteiligungen/${BET_ID}/vorgaenge`)).toHaveLength(0);
  });
});

describe("Storno", () => {
  it("storniert mit Grund und Valuta nicht vor dem Original", async () => {
    const api = spieleApi({ "POST /api/v1/vorgaenge/v4/storno": { status: 201, koerper: { storno: {}, original: {} } } });
    rendereApp(vorgaengeUrl);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Auszahlung vom 31.07.2021 stornieren" }));
    const d = dialog();
    expect(d.getByLabelText("Valuta des Storno (optional)").getAttribute("min")).toBe("2021-07-31");
    await nutzer.type(d.getByLabelText("Grund"), "Doppelt gebucht");
    await nutzer.click(d.getByRole("button", { name: "Stornieren" }));
    await screen.findByRole("heading", { level: 1 });
    expect(api.anfragen("POST", "/api/v1/vorgaenge/v4/storno")[0]!.koerper).toEqual({ grund: "Doppelt gebucht" });
  });

  it("zeigt den Grund als Pflichtfeld und den Valutafehler am Feld; stornierte Zeilen haben keinen Knopf", async () => {
    spieleApi({
      "POST /api/v1/vorgaenge/v4/storno": { status: 400, koerper: { fehler: { code: "EINGABE_UNGUELTIG", meldung: "x", felder: [{ feld: "valuta", code: "storno_vor_original", meldung: "x" }, { feld: "grund", code: "too_small", meldung: "x" }] } } },
    });
    rendereApp(vorgaengeUrl);
    const nutzer = userEvent.setup();
    expect(await screen.findAllByRole("button", { name: /stornieren$/ })).toHaveLength(2); // v1 und v4; v2 ist storniert, v3 ist ein Storno
    await nutzer.click(screen.getByRole("button", { name: "Auszahlung vom 31.07.2021 stornieren" }));
    const d = dialog();
    // Ohne Grund geht nichts an die API; die Pflichtangabe steht am Feld.
    await nutzer.click(d.getByRole("button", { name: "Stornieren" }));
    expect(await d.findByText(feldpruefungTexte.de.pflicht)).toBeTruthy();
    // Ein Datum vor der Valuta des Originals meldet das Feld sofort.
    fireEvent.change(d.getByLabelText(/Valuta/), { target: { value: "2000-01-01" } });
    expect(await d.findByText(/darf nicht vor dem/)).toBeTruthy();
    fireEvent.change(d.getByLabelText(/Valuta/), { target: { value: "" } });
    await nutzer.type(d.getByLabelText("Grund"), "Fehlbuchung");
    await nutzer.click(d.getByRole("button", { name: "Stornieren" }));
    expect(await d.findByText("Die Valuta des Storno darf nicht vor der des Originals liegen.")).toBeTruthy();
  });
});

describe("Konditionen, Tranchen, Jahresüberschüsse", () => {
  it("legt eine neue Version an: Prozent als Anteil, ohne Zinsperiode und Anker", async () => {
    const api = spieleApi({ [`POST /api/v1/beteiligungen/${BET_ID}/konditionen`]: { status: 201, koerper: {} } });
    rendereApp(instrumenteUrl);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Konditionen: Wandeldarlehen 2021" }));
    const d = dialog();
    expect((d.getByLabelText("Zinsperiode") as HTMLSelectElement).disabled).toBe(true);
    const satz = d.getByLabelText("Fester Zins");
    expect((satz as HTMLInputElement).value).toBe("6.5");
    await nutzer.clear(satz);
    await nutzer.type(satz, "7,25");
    await nutzer.click(d.getByRole("button", { name: "Konditionen speichern" }));
    await screen.findByRole("heading", { level: 1 });
    const body = api.anfragen("POST", `/api/v1/beteiligungen/${BET_ID}/konditionen`)[0]!.koerper as Record<string, unknown>;
    expect(body.satzFix).toBe("0.0725");
    expect(body.instrumentId).toBe(INSTR_ID);
    expect(body.gewinnabhaengigSatz).toBe("0.1");
    expect(body.kappungSatz).toBe("0.02");
    expect(body.kapitalisieren).toBe(true);
    expect(body).not.toHaveProperty("zinsperiode");
    expect(body).not.toHaveProperty("anker");
  });

  it("markiert die Bedingung einer Tranche als erfüllt", async () => {
    const api = spieleApi({ [`POST /api/v1/tranchen/${MS_OFFEN}/erfuellt`]: { koerper: {} } });
    rendereApp(instrumenteUrl);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Bedingung erfüllt: Tranche Umsatzziel" }));
    await nutzer.type(dialog().getByLabelText("Nachweis (optional)"), "Bericht Q3");
    await nutzer.click(dialog().getByRole("button", { name: "Als erfüllt markieren" }));
    await screen.findByRole("heading", { level: 1 });
    expect(api.anfragen("POST", `/api/v1/tranchen/${MS_OFFEN}/erfuellt`)[0]!.koerper).toMatchObject({ nachweis: "Bericht Q3" });
  });

  it("ändert einen Jahresüberschuss", async () => {
    const api = spieleApi({ [`PUT /api/v1/beteiligungen/${BET_ID}/jahresueberschuss/2025`]: { koerper: {} } });
    rendereApp(url);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Jahresüberschuss 2025 ändern" }));
    const betrag = dialog().getByLabelText("Jahresüberschuss in Euro") as HTMLInputElement;
    expect(betrag.value).toBe("250000");
    await nutzer.clear(betrag);
    await nutzer.type(betrag, "-1000");
    await nutzer.click(dialog().getByRole("button", { name: "Jahresüberschuss speichern" }));
    await screen.findByRole("heading", { level: 1 });
    expect(api.anfragen("PUT", `/api/v1/beteiligungen/${BET_ID}/jahresueberschuss/2025`)[0]!.koerper).toEqual({ betrag: "-1000" });
  });

  it("prüft den Jahresüberschuss am Feld: Jahr im Bereich, Betrag mit höchstens zwei Nachkommastellen", async () => {
    const api = spieleApi({ [`PUT /api/v1/beteiligungen/${BET_ID}/jahresueberschuss/2025`]: { koerper: {} } });
    rendereApp(url);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Jahresüberschuss 2025 ändern" }));
    const betrag = dialog().getByLabelText("Jahresüberschuss in Euro");
    await nutzer.clear(betrag);
    await nutzer.type(betrag, "12,345");
    // zu viele Nachkommastellen: sofort, ohne das Feld zu verlassen
    expect(dialog().getByText(feldpruefungTexte.de.nachkomma(2))).toBeTruthy();
    await nutzer.clear(betrag);
    await nutzer.type(betrag, "1.250,50");
    expect(dialog().queryByText(feldpruefungTexte.de.nachkomma(2))).toBeNull();
    await nutzer.click(dialog().getByRole("button", { name: "Jahresüberschuss speichern" }));
    await screen.findByRole("heading", { level: 1 });
    expect(api.anfragen("PUT", `/api/v1/beteiligungen/${BET_ID}/jahresueberschuss/2025`)[0]!.koerper).toEqual({ betrag: "1250.50" });
  });

  it("zeigt Forderungen und bucht die Erfüllung", async () => {
    const api = spieleApi({
      [`/api/v1/beteiligungen/${BET_ID}/instrumentdaten`]: { koerper: { ...instrumentDaten, forderungen: [{ id: "f1", beteiligungId: BET_ID, verkaufId: "x", art: "treuhand", betrag: "50000.00", faelligAm: "2027-01-31", erfuelltAm: null, vorgangId: null }] } },
      "POST /api/v1/forderungen/f1/erfuellt": { koerper: {} },
    });
    rendereApp(url);
    const nutzer = userEvent.setup();
    const tabelle = within(await screen.findByRole("region", { name: "Forderungen" }));
    expect(schmal(tabelle.getAllByRole("row")[1]!.textContent)).toContain("Treuhandbetrag");
    await nutzer.click(tabelle.getByRole("button", { name: "Forderung Treuhandbetrag als erfüllt buchen" }));
    await nutzer.click(dialog().getByRole("button", { name: "Erfüllt buchen" }));
    await screen.findByRole("heading", { level: 1 });
    expect(api.anfragen("POST", "/api/v1/forderungen/f1/erfuellt")).toHaveLength(1);
  });
});
