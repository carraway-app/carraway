import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { alsRolle, FONDS_ID, ICH_ID, RUNDE_ID, fehler, rendereApp, rundeDetailDaten, rundenListeDaten, spieleApi } from "../test/hilfen";
import { de } from "../i18n/de";
import { en } from "../i18n/en";

const URL_RUNDE = `/fonds/${FONDS_ID}/bewertungsrunde`;

describe("Bewertungsrunde", () => {
  it("ist vom Portfolio aus erreichbar und zeigt die offene Runde mit ihren Entwürfen", async () => {
    spieleApi();
    rendereApp(`/fonds/${FONDS_ID}`);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Bewertungsrunde" }));
    expect(await screen.findByRole("heading", { level: 2, name: "Bewertungsrunde" })).toBeTruthy();
    const offen = within(await screen.findByRole("region", { name: /Offene Runde zum 31\.12\.2026/ }));
    const tabelle = within(await offen.findByRole("region", { name: "Entwürfe der Bewertungsrunde" }));
    expect(tabelle.getAllByRole("row")).toHaveLength(3);
    // Die Liste der Übersprungenen kommt mit der Runde aus der API, auch nach dem Neuladen der Seite.
    expect(offen.getByText(/Es gibt keine frühere Bewertung, die sich fortschreiben ließe\./)).toBeTruthy();
    expect(offen.getByRole("link", { name: "Gamma Logistik" }).getAttribute("href")).toContain("/beteiligungen/b3");
    expect(tabelle.getByRole("link", { name: "Zur Beteiligung Alpha Energie" }).getAttribute("href")).toContain("/beteiligungen/b1");
    // frühere Runden stehen getrennt
    expect(within(screen.getByRole("region", { name: "Frühere Runden" })).getByText("Freigegeben")).toBeTruthy();
  });

  it("legt eine Runde mit dem gewählten Vorschlag an und zeigt die übersprungenen Beteiligungen mit Grund", async () => {
    const neueRunde = { ...rundenListeDaten.daten[0]!, id: "ru9" };
    let angelegt = false;
    const api = spieleApi({
      [`/api/v1/fonds/${FONDS_ID}/bewertungsrunden`]: () => ({ koerper: { daten: angelegt ? [neueRunde] : [] } }),
      [`POST /api/v1/fonds/${FONDS_ID}/bewertungsrunde`]: () => {
        angelegt = true;
        return {
          status: 201,
          koerper: {
            runde: neueRunde,
            bewertungen: rundeDetailDaten.bewertungen,
            uebersprungen: [
              { beteiligungId: "b2", organisation: "Beta Medizin", grund: "bewertung_vorhanden" },
              { beteiligungId: "b3", organisation: "Gamma Logistik", grund: "keine_vorherige_bewertung" },
            ],
          },
        };
      },
      "/api/v1/bewertungsrunden/ru9": {
        koerper: {
          ...rundeDetailDaten,
          runde: neueRunde,
          uebersprungen: [
            { beteiligungId: "b2", organisation: "Beta Medizin", grund: "bewertung_vorhanden" },
            { beteiligungId: "b3", organisation: "Gamma Logistik", grund: "keine_vorherige_bewertung" },
          ],
        },
      },
    });
    rendereApp(`${URL_RUNDE}?stichtag=2026-12-31`);
    const nutzer = userEvent.setup();
    expect(await screen.findByText(de.runde.keineOffene)).toBeTruthy();
    expect((screen.getByLabelText("Stichtag") as HTMLInputElement).value).toBe("2026-12-31");
    await nutzer.click(screen.getByRole("button", { name: "Letzte Runde" }));
    expect(screen.getByText(de.runde.vorschlagHilfe.letzte_runde ?? "")).toBeTruthy();
    await nutzer.click(screen.getByRole("button", { name: "Runde anlegen" }));
    expect(await screen.findByText("Die Runde ist angelegt: 2 Entwürfe, 2 übersprungen.")).toBeTruthy();
    expect(api.anfragen("POST", `/api/v1/fonds/${FONDS_ID}/bewertungsrunde`)[0]!.koerper).toEqual({ stichtag: "2026-12-31", vorschlag: "letzte_runde" });
    const offen = within(await screen.findByRole("region", { name: /Offene Runde zum 31\.12\.2026/ }));
    expect(await offen.findByText(/Es gibt schon eine freigegebene Bewertung zum Stichtag\./)).toBeTruthy();
    expect(offen.getByText(/Es gibt keine frühere Bewertung, die sich fortschreiben ließe\./)).toBeTruthy();
    expect(offen.getByRole("link", { name: "Gamma Logistik" }).getAttribute("href")).toContain("/beteiligungen/b3");
  });

  it("ändert den Wert eines Entwurfs der Runde mit PATCH und lädt die Runde neu", async () => {
    let wert = "2000000.00";
    const api = spieleApi({
      [`/api/v1/bewertungsrunden/${RUNDE_ID}`]: () => ({ koerper: { ...rundeDetailDaten, bewertungen: [{ ...rundeDetailDaten.bewertungen[0]!, wert }, rundeDetailDaten.bewertungen[1]!] } }),
      "PATCH /api/v1/bewertungen/rw1": (anfrage) => {
        wert = (anfrage.koerper as { wert: string }).wert;
        return { koerper: { ...rundeDetailDaten.bewertungen[0]!, wert, erstelltVon: ICH_ID } };
      },
    });
    rendereApp(URL_RUNDE);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Entwurf ändern: Alpha Energie" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Entwurf ändern" }));
    const feld = dialog.getByLabelText("Wert in Euro") as HTMLInputElement;
    expect(feld.value).toBe("2000000");
    await nutzer.clear(feld);
    await nutzer.type(feld, "2150000,50");
    await nutzer.click(dialog.getByRole("button", { name: "Änderung speichern" }));
    await waitFor(() => expect(api.anfragen("PATCH", "/api/v1/bewertungen/rw1")).toHaveLength(1));
    expect(api.anfragen("PATCH", "/api/v1/bewertungen/rw1")[0]!.koerper).toEqual({ wert: "2150000.50", methode: "letzte_runde", begruendung: "Fortgeschrieben vom 2026-09-30" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByText(/2\.150\.001/)).toBeTruthy();
  });

  it("zeigt Fehler beim Ändern und verlangt für andere Methoden als Anschaffungskosten eine Begründung", async () => {
    spieleApi({ "PATCH /api/v1/bewertungen/rw1": fehler(409, "period_locked", { gesperrtBis: "2026-12-31" }) });
    rendereApp(URL_RUNDE);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Entwurf ändern: Alpha Energie" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Entwurf ändern" }));
    expect(dialog.getByText(de.bewertungen.form.begruendungHilfePflicht)).toBeTruthy();
    await nutzer.click(dialog.getByRole("button", { name: "Änderung speichern" }));
    expect(await dialog.findByText(/gesperrt/i)).toBeTruthy();
  });

  it("blendet das Ändern für Betrachter aus und sperrt die Freigabe, wenn die Person einen Entwurf der Runde angelegt hat", async () => {
    spieleApi({ "/api/v1/me": alsRolle("betrachter") });
    const { unmount } = rendereApp(URL_RUNDE);
    await screen.findByRole("button", { name: "Alle Entwürfe freigeben" });
    expect(screen.queryByRole("button", { name: /Entwurf ändern/ })).toBeNull();
    unmount();

    spieleApi({
      [`/api/v1/bewertungsrunden/${RUNDE_ID}`]: { koerper: { ...rundeDetailDaten, bewertungen: [{ ...rundeDetailDaten.bewertungen[0]!, erstelltVon: ICH_ID }, rundeDetailDaten.bewertungen[1]!] } },
    });
    rendereApp(URL_RUNDE);
    const freigeben = await screen.findByRole("button", { name: "Alle Entwürfe freigeben" });
    await waitFor(() => expect((freigeben as HTMLButtonElement).disabled).toBe(true));
    expect(await screen.findByText(de.runde.vierAugenEntwurf)).toBeTruthy();
  });

  it("gibt alle Entwürfe frei, wenn eine andere Person die Runde angelegt hat", async () => {
    const api = spieleApi({
      [`POST /api/v1/bewertungsrunden/${RUNDE_ID}/freigeben`]: { koerper: { runde: { ...rundenListeDaten.daten[0]!, status: "freigegeben" }, freigegeben: 2 } },
    });
    rendereApp(URL_RUNDE);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Alle Entwürfe freigeben" }));
    expect(await screen.findByText("Die Runde ist freigegeben: 2 Bewertungen gelten jetzt.")).toBeTruthy();
    expect(api.anfragen("POST", `/api/v1/bewertungsrunden/${RUNDE_ID}/freigeben`)).toHaveLength(1);
  });

  it("sperrt die Freigabe für die Person, die die Runde angelegt hat, und lässt das Verwerfen zu", async () => {
    const api = spieleApi({
      [`/api/v1/fonds/${FONDS_ID}/bewertungsrunden`]: { koerper: { daten: [{ ...rundenListeDaten.daten[0]!, erstelltVon: ICH_ID }] } },
      [`POST /api/v1/bewertungsrunden/${RUNDE_ID}/verwerfen`]: { koerper: { ...rundenListeDaten.daten[0]!, status: "verworfen" } },
    });
    rendereApp(URL_RUNDE);
    const nutzer = userEvent.setup();
    const freigeben = await screen.findByRole("button", { name: "Alle Entwürfe freigeben" });
    expect((freigeben as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(de.rechte.vierAugenRunde)).toBeTruthy();
    await nutzer.click(screen.getByRole("button", { name: "Runde verwerfen" }));
    expect(await screen.findByText(de.runde.verworfenMeldung)).toBeTruthy();
    expect(api.anfragen("POST", `/api/v1/bewertungsrunden/${RUNDE_ID}/verwerfen`)).toHaveLength(1);
  });

  it("blendet das Anlegen für Betrachter aus und übersetzt valuation_round_open in beiden Sprachen", async () => {
    spieleApi({ "/api/v1/me": alsRolle("betrachter") });
    const { unmount } = rendereApp(URL_RUNDE);
    await screen.findByRole("heading", { level: 2, name: "Bewertungsrunde" });
    expect(screen.queryByRole("button", { name: "Runde anlegen" })).toBeNull();
    expect((screen.getByRole("button", { name: "Alle Entwürfe freigeben" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(de.rechte.braucht("Freigeber"))).toBeTruthy();
    unmount();

    spieleApi({ [`POST /api/v1/fonds/${FONDS_ID}/bewertungsrunde`]: fehler(409, "valuation_round_open", { bewertungsrundeId: RUNDE_ID }) });
    localStorage.setItem("carraway.sprache", "en");
    rendereApp(URL_RUNDE);
    const nutzer = userEvent.setup();
    fireEvent.change(await screen.findByLabelText("Reporting date"), { target: { value: "2026-12-31" } });
    await nutzer.click(screen.getByRole("button", { name: "Start round" }));
    expect(await screen.findByText(en.fehler.valuation_round_open)).toBeTruthy();
    localStorage.removeItem("carraway.sprache");
  });
});
