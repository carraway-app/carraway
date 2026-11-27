import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  alsRolle,
  ANDERE_ID,
  BERICHT_ID,
  DRITTE_ID,
  FONDS_ID,
  ICH_ID,
  berichtDetailDaten,
  berichtKontrolleGruen,
  berichtKontrolleRot,
  berichtZeile,
  fehler,
  protokollZeile,
  rendereApp,
  spieleApi,
} from "../test/hilfen";
import { de } from "../i18n/de";
import { feldpruefungTexte } from "../i18n/feldpruefung";
import { en } from "../i18n/en";

const URL_BERICHT = `/reports/${BERICHT_ID}`;
const detail = (extra: Record<string, unknown>) => ({ koerper: { ...berichtDetailDaten, ...extra } });
const STUFE = `POST /api/v1/reports/${BERICHT_ID}/stage`;
const kontrolleRot = { [`/api/v1/reports/${BERICHT_ID}/checks`]: { koerper: berichtKontrolleRot } };

describe("Berichte mit Freigabe: Liste und Anlegen", () => {
  it("listet die Berichte des Fonds mit Status und aktueller Stufe", async () => {
    const api = spieleApi();
    rendereApp("/reports");
    const tabelle = within(await screen.findByRole("region", { name: "Berichte mit Freigabe" }));
    const zeilen = tabelle.getAllByRole("row");
    expect(zeilen).toHaveLength(3);
    expect(zeilen[1]!.textContent).toContain("LP-Bericht");
    expect(zeilen[1]!.textContent).toContain("Entwurf");
    expect(zeilen[1]!.textContent).toContain("Stufe 1 von 3: Investmentmanager");
    expect(zeilen[2]!.textContent).toContain("Alle Stufen erteilt");
    expect(within(zeilen[1]!).getByRole("link", { name: /Bericht öffnen: LP-Bericht zum 30\.09\.2026/ }).getAttribute("href")).toBe(`/reports/${BERICHT_ID}`);
    expect(api.anfragen("GET", "/api/v1/reports")[0]!.query.get("fondsId")).toBe(FONDS_ID);
    expect(api.anfragen("GET", `/api/v1/fonds/${FONDS_ID}/uebersicht`)).toHaveLength(0);
    // die bisherigen Downloads bleiben
    await userEvent.setup().click(screen.getByRole("tab", { name: "Direkte Downloads" }));
    expect(await screen.findByRole("region", { name: "Fondsbericht" })).toBeTruthy();
  });

  it("legt einen LP-Bericht an und öffnet ihn", async () => {
    const api = spieleApi({ "POST /api/v1/reports": { status: 201, koerper: berichtZeile } });
    rendereApp("/reports");
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Bericht anlegen" }));
    const dialog = within(screen.getByRole("dialog"));
    await nutzer.selectOptions(dialog.getByLabelText("Art"), "lp_bericht");
    fireEvent.change(dialog.getByLabelText("Stichtag (optional)"), { target: { value: "2026-09-30" } });
    await nutzer.click(dialog.getByRole("button", { name: "Englisch" }));
    await nutzer.click(dialog.getByRole("button", { name: "Bericht anlegen" }));
    expect(await screen.findByRole("heading", { level: 1, name: /LP-Bericht 30\.09\.2026/ })).toBeTruthy();
    expect(api.anfragen("POST", "/api/v1/reports")[0]!.koerper).toEqual({ art: "lp_bericht", format: "pdf", sprache: "en", fondsId: FONDS_ID, stichtag: "2026-09-30" });
  });

  it("Währungssicht: Vergleich braucht einen Währungscode, gesendet wird nur für Berichte mit Zeilen je Beteiligung", async () => {
    const api = spieleApi({ "POST /api/v1/reports": { status: 201, koerper: berichtZeile } });
    rendereApp("/reports");
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Bericht anlegen" }));
    const dialog = within(screen.getByRole("dialog"));
    await nutzer.selectOptions(dialog.getByLabelText("Art"), "portfolioliste");
    await nutzer.click(dialog.getByRole("button", { name: "Vergleich" }));
    await nutzer.click(dialog.getByRole("button", { name: "Bericht anlegen" }));
    // Ohne gültigen Code geht nichts an die API.
    expect(await dialog.findByText(feldpruefungTexte.de.waehrung)).toBeTruthy();
    expect(api.anfragen("POST", "/api/v1/reports")).toHaveLength(0);
    await nutzer.selectOptions(dialog.getByLabelText("Vergleichswährung (Code, z. B. USD)"), "GBP");
    await nutzer.click(dialog.getByRole("button", { name: "Bericht anlegen" }));
    await waitFor(() => expect(api.anfragen("POST", "/api/v1/reports")).toHaveLength(1));
    expect(api.anfragen("POST", "/api/v1/reports")[0]!.koerper).toMatchObject({ art: "portfolioliste", waehrungssicht: "vergleich", vergleichswaehrung: "GBP" });
  });

  it("verlangt für den Quartalsbericht eine Beteiligung und sendet keinen Wissensstand aus der Zukunft", async () => {
    const api = spieleApi({ "POST /api/v1/reports": { status: 201, koerper: { ...berichtZeile, art: "quartalsbericht" } } });
    rendereApp("/reports");
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Bericht anlegen" }));
    const dialog = within(screen.getByRole("dialog"));
    await nutzer.selectOptions(dialog.getByLabelText("Art"), "quartalsbericht");
    expect(dialog.getByLabelText("Beteiligung")).toBeTruthy();
    const zukunft = new Date(Date.now() + 48 * 3600_000);
    // Wissensstand nur als Datum
    const lokal = `${zukunft.getFullYear()}-${String(zukunft.getMonth() + 1).padStart(2, "0")}-${String(zukunft.getDate()).padStart(2, "0")}`;
    fireEvent.change(dialog.getByLabelText("Wissensstand (optional)"), { target: { value: lokal } });
    await nutzer.click(dialog.getByRole("button", { name: "Bericht anlegen" }));
    expect(await dialog.findByText(de.feldfehler.knowledge_date_in_future)).toBeTruthy();
    expect(api.anfragen("POST", "/api/v1/reports")).toHaveLength(0);
    fireEvent.change(dialog.getByLabelText("Wissensstand (optional)"), { target: { value: "" } });
    await nutzer.click(dialog.getByRole("button", { name: "Bericht anlegen" }));
    await waitFor(() => expect(api.anfragen("POST", "/api/v1/reports")).toHaveLength(1));
    expect(api.anfragen("POST", "/api/v1/reports")[0]!.koerper).toMatchObject({ art: "quartalsbericht", beteiligungId: "b1" });
  });

  it("macht aus einem früheren Tag das Tagesende (Europe/Berlin) als Wissensstand", async () => {
    const api = spieleApi({ "POST /api/v1/reports": { status: 201, koerper: berichtZeile } });
    rendereApp("/reports");
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Bericht anlegen" }));
    const dialog = within(screen.getByRole("dialog"));
    fireEvent.change(dialog.getByLabelText("Wissensstand (optional)"), { target: { value: "2026-06-30" } });
    await nutzer.click(dialog.getByRole("button", { name: "Bericht anlegen" }));
    await waitFor(() => expect(api.anfragen("POST", "/api/v1/reports")).toHaveLength(1));
    expect(api.anfragen("POST", "/api/v1/reports")[0]!.koerper).toMatchObject({ stand: "2026-06-30T21:59:59.999999Z" });
  });

  it("blendet das Anlegen für Betrachter aus", async () => {
    spieleApi({ "/api/v1/me": alsRolle("betrachter") });
    rendereApp("/reports");
    await screen.findByRole("region", { name: "Berichte mit Freigabe" });
    expect(screen.queryByRole("button", { name: "Bericht anlegen" })).toBeNull();
  });
});

describe("Berichtigung anlegen", () => {
  it("verlangt den Grund, öffnet den Entwurf und verlinkt die Vorfassung", async () => {
    const neu = "11111111-1111-4111-8111-111111111112";
    const grund = "Vorwort ergänzt";
    const pfad = `/api/v1/reports/${BERICHT_ID}/correction`;
    const api = spieleApi({
      [`/api/v1/reports/${BERICHT_ID}`]: detail({ status: "freigegeben" }),
      [`POST ${pfad}`]: { status: 201, koerper: { id: neu } },
      [`/api/v1/reports/${neu}`]: detail({ id: neu, vorfassungId: BERICHT_ID, berichtigungsgrund: grund }),
      [`/api/v1/reports/${neu}/checks`]: { koerper: berichtKontrolleGruen },
    });
    rendereApp(URL_BERICHT);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByText("Bericht berichtigen"));
    const speichern = screen.getByRole("button", { name: "Berichtigungsentwurf anlegen" }) as HTMLButtonElement;
    expect(speichern.disabled).toBe(true);
    await nutzer.type(screen.getByLabelText(/Berichtigungsgrund/), grund);
    await nutzer.click(speichern);
    expect((await screen.findByRole("link", { name: "Vorfassung öffnen" })).getAttribute("href")).toBe(URL_BERICHT);
    expect(screen.getByText(new RegExp(grund))).toBeTruthy();
    expect(api.anfragen("POST", pfad).map((a) => a.koerper)).toEqual([{ grund }]);
  });

  it("verweist bei bestehender Berichtigung direkt auf die Nachfassung", async () => {
    spieleApi({ [`/api/v1/reports/${BERICHT_ID}`]: detail({ status: "freigegeben", nachfassungId: "folge" }) });
    rendereApp(URL_BERICHT);
    expect((await screen.findByRole("link", { name: "Berichtigung öffnen" })).getAttribute("href")).toBe("/reports/folge");
    expect(screen.queryByText("Bericht berichtigen")).toBeNull();
  });
});

describe("Bericht: Stufen und Vier-Augen", () => {
  it("zeigt die Stufen mit Namen und Zeitpunkten und das Kontrollbericht mit übersetzten Codes", async () => {
    spieleApi({
      [`/api/v1/reports/${BERICHT_ID}`]: detail({
        status: "geprueft",
        naechsteStufe: 1,
        naechsteStufeName: "Teamleitung",
        protokoll: [protokollZeile(0, "Investmentmanager", "ok", DRITTE_ID)],
      }),
      ...kontrolleRot,
    });
    rendereApp(URL_BERICHT);
    expect(await screen.findByRole("heading", { level: 1, name: /LP-Bericht 30\.09\.2026/ })).toBeTruthy();
    const schritte = within(await screen.findByRole("list", { name: "Stufen der Freigabe" })).getAllByRole("listitem");
    expect(schritte).toHaveLength(4);
    expect(schritte[0]!.textContent).toContain("Investmentmanager");
    expect(schritte[0]!.textContent).toContain("Friedrich Beispiel, ");
    expect(schritte[0]!.textContent).toContain("erledigt");
    expect(schritte[1]!.getAttribute("aria-current")).toBe("step");
    expect(schritte[1]!.textContent).toContain("Offen");
    expect(schritte[3]!.textContent).toContain("Freigegeben");

    await userEvent.setup().click(screen.getByRole("tab", { name: /Kontrollbericht/ }));
    const kontrolle = within(await screen.findByRole("region", { name: "Kontrollbericht" }));
    expect(await kontrolle.findByText("Eine aktive Beteiligung hat keine freigegebene Bewertung zum Stichtag.")).toBeTruthy();
    expect(kontrolle.getByText("Der Fonds-NAV weicht vom Eigenkapital laut Saldenliste ab.")).toBeTruthy();
    expect(kontrolle.getByText("Die Summe der Portfoliozeilen entspricht den Summen der Vorgänge des Fonds.")).toBeTruthy();
    expect(kontrolle.getByText("Unternehmen: Beta Medizin")).toBeTruthy();
    expect(kontrolle.getByText(/NAV: 25\.796\.900,00/)).toBeTruthy();
    expect(kontrolle.getByText(/Eigenkapital: 25\.000\.000,00/)).toBeTruthy();
  });

  it("sperrt die Stufe für den Ersteller und für frühere Freigeber und nennt den Grund", async () => {
    spieleApi({ [`/api/v1/reports/${BERICHT_ID}`]: detail({ erstelltVon: ICH_ID }) });
    const { unmount } = rendereApp(URL_BERICHT);
    const knopf = await screen.findByRole("button", { name: "Stufe „Investmentmanager“ erteilen" });
    expect((knopf as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(de.bericht.vierAugen.selbstErsteller)).toBeTruthy();
    expect(await screen.findByText(/Nach den sichtbaren Angaben ausgeschlossen: Vera Beispiel\./)).toBeTruthy();
    unmount();

    spieleApi({
      [`/api/v1/reports/${BERICHT_ID}`]: detail({ status: "geprueft", naechsteStufe: 1, naechsteStufeName: "Teamleitung", protokoll: [protokollZeile(0, "Investmentmanager", "ok", ICH_ID)] }),
    });
    const zweite = rendereApp(URL_BERICHT);
    expect((await screen.findByRole("button", { name: "Stufe „Teamleitung“ erteilen" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(de.bericht.vierAugen.selbstFreigeber)).toBeTruthy();
    zweite.unmount();

    spieleApi({
      [`/api/v1/reports/${BERICHT_ID}`]: detail({ abschnitte: [{ id: "a1", berichtId: BERICHT_ID, schluessel: "vorwort", textDe: "Text", textEn: "", status: "entwurf", geaendertVon: ICH_ID, geaendertAm: "2026-11-20T09:30:00.000Z" }] }),
    });
    rendereApp(URL_BERICHT);
    expect((await screen.findByRole("button", { name: "Stufe „Investmentmanager“ erteilen" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(de.bericht.vierAugen.selbstBearbeiter)).toBeTruthy();
  });

  it("sperrt Bearbeiter mit der Rolle als Grund", async () => {
    spieleApi({ "/api/v1/me": alsRolle("bearbeiter") });
    rendereApp(URL_BERICHT);
    expect((await screen.findByRole("button", { name: "Stufe „Investmentmanager“ erteilen" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(de.bericht.vierAugen.rolle("Freigeber"))).toBeTruthy();
  });

  it("erteilt die erste Stufe mit dem Namen der nächsten Stufe", async () => {
    const api = spieleApi({ [STUFE]: { koerper: { ...berichtZeile, status: "geprueft", naechsteStufe: 1 } } });
    rendereApp(URL_BERICHT);
    const nutzer = userEvent.setup();
    fireEvent.change(await screen.findByLabelText("Kommentar"), { target: { value: "Zahlen geprüft" } });
    await nutzer.click(screen.getByRole("button", { name: "Stufe „Investmentmanager“ erteilen" }));
    await waitFor(() => expect(api.anfragen("POST", `/api/v1/reports/${BERICHT_ID}/stage`)).toHaveLength(1));
    expect(api.anfragen("POST", `/api/v1/reports/${BERICHT_ID}/stage`)[0]!.koerper).toEqual({ stufe: "Investmentmanager", ergebnis: "ok", kommentar: "Zahlen geprüft" });
  });

  it("gibt eine Stufe nur mit Kommentar zurück", async () => {
    const api = spieleApi({
      [`/api/v1/reports/${BERICHT_ID}`]: detail({ status: "geprueft", naechsteStufe: 1, naechsteStufeName: "Teamleitung", protokoll: [protokollZeile(0, "Investmentmanager", "ok", DRITTE_ID)] }),
      [STUFE]: { koerper: { ...berichtZeile, naechsteStufe: 0 } },
    });
    rendereApp(URL_BERICHT);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Zurückgeben" }));
    expect(await screen.findByText(de.feldfehler.comment_required)).toBeTruthy();
    expect(api.anfragen("POST", `/api/v1/reports/${BERICHT_ID}/stage`)).toHaveLength(0);
    fireEvent.change(screen.getByLabelText("Kommentar"), { target: { value: "Kennzahlen unklar" } });
    await nutzer.click(screen.getByRole("button", { name: "Zurückgeben" }));
    await waitFor(() => expect(api.anfragen("POST", `/api/v1/reports/${BERICHT_ID}/stage`)).toHaveLength(1));
    expect(api.anfragen("POST", `/api/v1/reports/${BERICHT_ID}/stage`)[0]!.koerper).toEqual({ stufe: "Teamleitung", ergebnis: "zurueck", kommentar: "Kennzahlen unklar" });
  });

  it("bietet im ersten Zustand keine Rückgabe an (nichts erteilt)", async () => {
    spieleApi();
    rendereApp(URL_BERICHT);
    expect(((await screen.findByRole("button", { name: "Zurückgeben" })) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(de.bericht.aktion.keineZurueck)).toBeTruthy();
  });

  it("verlangt in der letzten Stufe bei rotem Kontrollbericht eine begründete Überschreibung und gibt dann frei", async () => {
    let freigegeben = false;
    const letzteStufe = { status: "geprueft", naechsteStufe: 2, naechsteStufeName: "Geschäftsführung", protokoll: [protokollZeile(0, "Investmentmanager", "ok", DRITTE_ID), protokollZeile(1, "Teamleitung", "ok", ANDERE_ID)] };
    const api = spieleApi({
      [`/api/v1/reports/${BERICHT_ID}`]: () =>
        freigegeben
          ? { koerper: { ...berichtDetailDaten, ...letzteStufe, status: "freigegeben", naechsteStufe: 3, naechsteStufeName: null, dateiName: "lp-bericht.pdf", dateiSha256: "cd".repeat(32), dateiGroesse: 20480, erzeugtAm: "2026-11-21T10:00:00.000Z", kontrolleUeberschrieben: { grund: "Beta Medizin wird nachgereicht" } } }
          : { koerper: { ...berichtDetailDaten, ...letzteStufe, erstelltVon: ANDERE_ID } },
      ...kontrolleRot,
      [STUFE]: () => {
        freigegeben = true;
        return { koerper: { ...berichtZeile, status: "freigegeben", naechsteStufe: 3 } };
      },
    });
    rendereApp(`${URL_BERICHT}?tab=approval`);
    const nutzer = userEvent.setup();
    expect(await screen.findByText("Der Kontrollbericht zeigt Abweichungen.")).toBeTruthy();
    // die normale Freigabe gibt es hier nicht; die Überschreibung verlangt eine Begründung
    expect(screen.queryByRole("button", { name: "Stufe „Geschäftsführung“ erteilen" })).toBeNull();
    await nutzer.click(screen.getByRole("button", { name: "Trotz Abweichungen freigeben" }));
    expect(await screen.findByText(de.bericht.aktion.grundPflicht)).toBeTruthy();
    expect(api.anfragen("POST", `/api/v1/reports/${BERICHT_ID}/stage`)).toHaveLength(0);
    fireEvent.change(screen.getByLabelText("Begründung der Überschreibung"), { target: { value: "Beta Medizin wird nachgereicht" } });
    await nutzer.click(screen.getByRole("button", { name: "Trotz Abweichungen freigeben" }));
    await waitFor(() => expect(api.anfragen("POST", `/api/v1/reports/${BERICHT_ID}/stage`)).toHaveLength(1));
    expect(api.anfragen("POST", `/api/v1/reports/${BERICHT_ID}/stage`)[0]!.koerper).toEqual({
      stufe: "Geschäftsführung",
      ergebnis: "ok",
      kontrolleUeberschreiben: { grund: "Beta Medizin wird nachgereicht" },
    });
    // nach der Freigabe: Datei als freigegeben markiert, Hash sichtbar, Überschreibung im Kontrollbericht
    expect(screen.queryByRole("button", { name: "Trotz Abweichungen freigeben" })).toBeNull();
    await nutzer.click(screen.getByRole("tab", { name: /Kontrollbericht/ }));
    expect(await screen.findByText(/Bei der Freigabe überschrieben\. Begründung: Beta Medizin wird nachgereicht/)).toBeTruthy();
    await nutzer.click(screen.getByRole("tab", { name: "Datei" }));
    const datei = within(await screen.findByRole("region", { name: "Datei" }));
    expect(await datei.findByText("Freigegeben")).toBeTruthy();
    expect(datei.getByText("cd".repeat(32))).toBeTruthy();
    expect(datei.getByRole("link", { name: "Freigegebene Datei herunterladen" }).getAttribute("href")).toBe(`/api/v1/reports/${BERICHT_ID}/file`);
  });

  it("erteilt die letzte Stufe bei grünem Kontrollbericht ohne Überschreibung", async () => {
    const api = spieleApi({
      [`/api/v1/reports/${BERICHT_ID}`]: detail({ status: "geprueft", naechsteStufe: 2, naechsteStufeName: "Geschäftsführung", protokoll: [protokollZeile(0, "Investmentmanager", "ok", DRITTE_ID), protokollZeile(1, "Teamleitung", "ok", ANDERE_ID)] }),
      [`/api/v1/reports/${BERICHT_ID}/checks`]: { koerper: berichtKontrolleGruen },
      [STUFE]: { koerper: { ...berichtZeile, status: "freigegeben" } },
    });
    rendereApp(URL_BERICHT);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("tab", { name: /Kontrollbericht/ }));
    await screen.findByText(de.bericht.kontrolle.gesamtOk);
    await nutzer.click(screen.getByRole("tab", { name: "Freigabe" }));
    await nutzer.click(await screen.findByRole("button", { name: "Stufe „Geschäftsführung“ erteilen" }));
    await waitFor(() => expect(api.anfragen("POST", `/api/v1/reports/${BERICHT_ID}/stage`)).toHaveLength(1));
    expect(api.anfragen("POST", `/api/v1/reports/${BERICHT_ID}/stage`)[0]!.koerper).toEqual({ stufe: "Geschäftsführung", ergebnis: "ok" });
  });

  it("übersetzt checks_failed, report_stage_wrong und four_eyes_violated in beiden Sprachen", async () => {
    spieleApi({ [STUFE]: fehler(409, "four_eyes_violated") });
    rendereApp(`${URL_BERICHT}`);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Stufe „Investmentmanager“ erteilen" }));
    expect(await screen.findByText(/jede Stufe eines Berichts/)).toBeTruthy();

    localStorage.setItem("carraway.sprache", "en");
    spieleApi({ [STUFE]: fehler(409, "checks_failed") });
    const en2 = rendereApp(`${URL_BERICHT}`);
    await nutzer.click(await screen.findByRole("button", { name: 'Give stage "Investmentmanager"' }));
    expect(await screen.findByText(en.fehler.checks_failed)).toBeTruthy();
    en2.unmount();
    localStorage.removeItem("carraway.sprache");
    expect(de.fehler.report_stage_wrong).toBeTruthy();
    expect(en.fehler.report_stage_wrong).toBeTruthy();
  });
});

describe("Bericht: Freitexte und Datei", () => {
  it("bearbeitet die Freitexte des LP-Berichts im Entwurf und speichert sie je Abschnitt", async () => {
    const api = spieleApi({ [`PUT /api/v1/reports/${BERICHT_ID}/sections/foreword`]: { koerper: { id: "a1", berichtId: BERICHT_ID, schluessel: "vorwort", textDe: "Liebe Investoren", textEn: "Dear investors", status: "entwurf", geaendertVon: ICH_ID, geaendertAm: "2026-11-20T10:00:00.000Z" } } });
    rendereApp(`${URL_BERICHT}?tab=content`);
    const nutzer = userEvent.setup();
    const bereich = within(await screen.findByRole("region", { name: "Freitexte" }));
    expect(bereich.getByLabelText("Marktumfeld: Text deutsch")).toBeTruthy();
    expect(bereich.getByLabelText("Ausblick: Text englisch")).toBeTruthy();
    fireEvent.change(bereich.getByLabelText("Vorwort: Text deutsch"), { target: { value: "Liebe Investoren" } });
    fireEvent.change(bereich.getByLabelText("Vorwort: Text englisch"), { target: { value: "Dear investors" } });
    await nutzer.click(bereich.getByRole("button", { name: "Abschnitt „Vorwort“ speichern" }));
    await waitFor(() => expect(api.anfragen("PUT", `/api/v1/reports/${BERICHT_ID}/sections/foreword`)).toHaveLength(1));
    expect(api.anfragen("PUT", `/api/v1/reports/${BERICHT_ID}/sections/foreword`)[0]!.koerper).toEqual({ textDe: "Liebe Investoren", textEn: "Dear investors" });
  });

  it("zeigt die Freitexte nach der ersten Stufe nur noch zum Lesen", async () => {
    spieleApi({
      [`/api/v1/reports/${BERICHT_ID}`]: detail({
        status: "geprueft",
        naechsteStufe: 1,
        naechsteStufeName: "Teamleitung",
        abschnitte: [{ id: "a1", berichtId: BERICHT_ID, schluessel: "vorwort", textDe: "Liebe Investoren", textEn: "", status: "entwurf", geaendertVon: ANDERE_ID, geaendertAm: "2026-11-20T09:30:00.000Z" }],
      }),
    });
    rendereApp(`${URL_BERICHT}?tab=content`);
    const bereich = within(await screen.findByRole("region", { name: "Freitexte" }));
    expect(await bereich.findByText("Liebe Investoren")).toBeTruthy();
    expect(bereich.getByText(de.bericht.abschnitte.gesperrt)).toBeTruthy();
    expect(bereich.queryByRole("textbox")).toBeNull();
    expect(bereich.queryByRole("button", { name: /speichern/ })).toBeNull();
  });

  it("zeigt Freitexte nur beim LP-Bericht und bietet im Entwurf den Download mit Wasserzeichen", async () => {
    spieleApi({ [`/api/v1/reports/${BERICHT_ID}`]: detail({ art: "fondsbericht", konfiguration: { einheit: "EUR", abschnitte: ["kennzahlen"], kennzahlen: [], spalten: [] } }) });
    rendereApp(`${URL_BERICHT}?tab=file`);
    const datei = within(await screen.findByRole("region", { name: "Datei" }));
    expect(datei.getByRole("link", { name: "Entwurf herunterladen (mit Wasserzeichen)" }).getAttribute("href")).toBe(`/api/v1/reports/${BERICHT_ID}/file`);
    expect(screen.queryByRole("region", { name: "Freitexte" })).toBeNull();
  });
});
