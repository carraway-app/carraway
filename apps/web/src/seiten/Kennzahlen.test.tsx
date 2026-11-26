import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BET_ID, FONDS_ID, alsRolle, rendereApp, spieleApi } from "../test/hilfen";

/** Kennzahlen der Portfoliounternehmen in der Oberfläche: Reiter an der Beteiligung, Seite am Fonds, Katalog in der Verwaltung. */

const schmal = (text: string | null) => (text ?? "").replace(/\s/g, " ");
const dialog = () => within(screen.getByRole("dialog"));

const def = (schluessel: string, de: string, en: string, typ: string, einheit: string, extra: Record<string, unknown> = {}) => ({
  id: `d-${schluessel}`,
  schluessel,
  katalogVersion: 1,
  bezeichnungDe: de,
  bezeichnungEn: en,
  einheit,
  typ,
  kategorie: "finanzen",
  periodizitaet: "quartal",
  aggregation: "summe",
  pflicht: false,
  reihenfolge: 10,
  gueltigAb: "2026-01-01",
  gueltigBis: null,
  ...extra,
});
const UMSATZ = def("umsatz", "Umsatz", "Revenue", "betrag", "EUR", { pflicht: true });
const EBITDA = def("ebitda", "EBITDA", "EBITDA", "betrag", "EUR", { reihenfolge: 20 });
const UNGC = def("esg_verstoesse_ungc", "Verstöße gegen UNGC", "Violations of UNGC", "ja_nein", "", { kategorie: "esg_governance", periodizitaet: "jahr", aggregation: "stand", reihenfolge: 140 });
const katalogDaten = { daten: [UMSATZ, EBITDA, UNGC] };

const wert = (id: string, w: string) => ({ id, wert: w, quelle: "intern", bestaetigtAm: "2026-10-05T10:00:00.000Z", kommentar: null });
const punkt = (beginn: string, ende: string, ist: string | null, plan: string | null, abw: { absolut: string; prozent: string | null } | null = null) => ({
  periodeBeginn: beginn,
  periodeEnde: ende,
  ist: ist ? wert(`i-${beginn}`, ist) : null,
  plan: plan ? wert(`p-${beginn}`, plan) : null,
  forecast: null,
  abweichung: abw ? { ...abw, schritte: [] } : null,
});

const reiheDaten = {
  beteiligungId: BET_ID,
  fondsId: FONDS_ID,
  von: "2025-01-01",
  bis: "2026-12-31",
  stand: null,
  kennzahlen: [
    {
      ...UMSATZ,
      angefordert: true,
      punkte: [punkt("2026-04-01", "2026-06-30", "1000000", "1000000", { absolut: "0", prozent: "0.00" }), punkt("2026-07-01", "2026-09-30", "1234567.89", "1300000", { absolut: "-65432.11", prozent: "-5.03" })],
      verdichtung: { wert: "2234567.89", schritte: [], zeitraeume: 2 },
    },
    {
      ...EBITDA,
      angefordert: false,
      punkte: [punkt("2026-07-01", "2026-09-30", "-80000", "-200000", { absolut: "120000", prozent: "60.00" })],
      verdichtung: null,
    },
    { ...UNGC, angefordert: true, punkte: [], verdichtung: null },
  ],
  offen: [
    { id: "o1", folge: 5, beteiligungId: BET_ID, definitionId: UMSATZ.id, periodeBeginn: "2026-10-01", periodeEnde: "2026-12-31", szenario: "ist", wert: "50.5", quelle: "intern", erfasstVon: "x", erfasstAm: "2026-11-01T10:00:00.000Z", status: "entwurf", kommentar: null, abfrageId: null, bestaetigtVon: null, bestaetigtAm: null, verworfenVon: null, verworfenAm: null, schluessel: "umsatz", bezeichnungDe: "Umsatz", bezeichnungEn: "Revenue", typ: "betrag" },
    { id: "o2", folge: 6, beteiligungId: BET_ID, definitionId: EBITDA.id, periodeBeginn: "2026-10-01", periodeEnde: "2026-12-31", szenario: "ist", wert: "10", quelle: "unternehmen", erfasstVon: "extern:a1", erfasstAm: "2026-11-02T10:00:00.000Z", status: "eingereicht", kommentar: null, abfrageId: "a1", bestaetigtVon: null, bestaetigtAm: null, verworfenVon: null, verworfenAm: null, schluessel: "ebitda", bezeichnungDe: "EBITDA", bezeichnungEn: "EBITDA", typ: "betrag" },
  ],
};

const kennzahlenAntworten = {
  "/api/v1/kennzahlen/katalog": { koerper: katalogDaten },
  [`/api/v1/beteiligungen/${BET_ID}/kennzahlen`]: { koerper: reiheDaten },
  [`/api/v1/fonds/${FONDS_ID}/kennzahlen/auswahl`]: { koerper: { daten: [{ schluessel: "umsatz", reihenfolge: 0, gueltig: true, definition: UMSATZ }, { schluessel: "esg_verstoesse_ungc", reihenfolge: 1, gueltig: true, definition: UNGC }] } },
};

afterEach(() => vi.unstubAllGlobals());

describe("Beteiligung: Reiter Kennzahlen", () => {
  it("zeigt Werte je Zeitraum und Szenario, die Abweichung gegen den Plan mit Hervorhebung und die Verdichtung", async () => {
    spieleApi(kennzahlenAntworten);
    rendereApp(`/beteiligungen/${BET_ID}?ansicht=kennzahlen`);
    const nutzer = userEvent.setup();
    const tabelle = await screen.findByRole("region", { name: "Kennzahlen des Unternehmens, Ist" });
    const kopf = within(tabelle).getAllByRole("columnheader").map((h) => h.textContent);
    expect(kopf).toEqual(expect.arrayContaining(["Kennzahl", "Q2 2026", "Q3 2026", "Gesamt im Zeitraum"]));
    const umsatz = within(tabelle).getByRole("row", { name: /Umsatz/ });
    expect(schmal(umsatz.textContent)).toContain("1.234.567,89 €");
    expect(schmal(umsatz.textContent)).toContain("Abweichung -65.432,11 € (-5,0 %)");
    expect(within(umsatz).getByText("angefordert")).toBeTruthy();
    expect(schmal(umsatz.textContent)).toContain("2.234.567,89 €"); // Verdichtung (Summe)
    // EBITDA: +60 % ist über der Schwelle und deshalb hervorgehoben, Umsatz Q3 (−5 %) nicht
    const abweichungen = [...tabelle.querySelectorAll(".app-kz-abw")];
    expect(abweichungen.filter((x) => x.classList.contains("app-kz-abw--stark")).map((x) => schmal(x.textContent))).toEqual([expect.stringContaining("+120.000,00 €")]);
    expect(screen.getByText(/ab 10 % hervorgehoben/)).toBeTruthy();
    // Szenario Plan: Planwerte ohne Abweichung
    await nutzer.click(screen.getByRole("button", { name: "Plan" }));
    const planTabelle = await screen.findByRole("region", { name: "Kennzahlen des Unternehmens, Plan" });
    expect(schmal(within(planTabelle).getByRole("row", { name: /Umsatz/ }).textContent)).toContain("1.300.000,00 €");
    expect(planTabelle.querySelector(".app-kz-abw")).toBeNull();
    // Forecast: nichts bestätigt
    await nutzer.click(screen.getByRole("button", { name: "Forecast" }));
    expect(within(await screen.findByRole("region", { name: "Kennzahlen des Unternehmens, Forecast" })).getAllByText("–").length).toBeGreaterThan(3);
  });

  it("Diagramme mit Textfassung und Tabelle als Alternative; Ja/Nein ohne Diagramm", async () => {
    spieleApi(kennzahlenAntworten);
    rendereApp(`/beteiligungen/${BET_ID}?ansicht=kennzahlen`);
    const nutzer = userEvent.setup();
    await screen.findByRole("region", { name: /Kennzahlen des Unternehmens, Ist/ });
    await nutzer.click(screen.getByRole("button", { name: "Diagramme" }));
    const bilder = await screen.findAllByRole("img", { name: /Zeiträume|Zeitraum/ });
    expect(bilder).toHaveLength(2); // Umsatz und EBITDA; die Ja/Nein-Kennzahl hat keines
    expect(bilder[0]!.getAttribute("aria-label")).toBe("Umsatz: 2 Zeiträume, von Q2 2026 bis Q3 2026. Dieselben Werte stehen in der Tabelle.");
    expect(document.querySelectorAll(".app-kz-linie--ist").length).toBe(2);
    expect(document.querySelectorAll(".app-kz-linie--plan").length).toBe(2);
    expect(screen.queryByRole("img", { name: /UNGC/ })).toBeNull();
    await nutzer.click(screen.getByRole("button", { name: "Tabelle" }));
    expect(await screen.findByRole("region", { name: /Kennzahlen des Unternehmens, Ist/ })).toBeTruthy();
  });

  it("Englisch: Reiter, Szenarien, Bezeichnungen und Abweichung in englischer Schreibweise", async () => {
    localStorage.setItem("carraway.sprache", "en");
    spieleApi(kennzahlenAntworten);
    rendereApp(`/beteiligungen/${BET_ID}?ansicht=kennzahlen`);
    const tabelle = await screen.findByRole("region", { name: "Company key figures, Actual" });
    expect(screen.getByRole("button", { name: "KPIs" }).getAttribute("aria-current")).toBe("page");
    const umsatz = within(tabelle).getByRole("row", { name: /Revenue/ });
    expect(schmal(umsatz.textContent)).toContain("€1,234,567.89");
    expect(schmal(umsatz.textContent)).toContain("Deviation -€65,432.11 (-5.0%)");
    expect(screen.getByRole("button", { name: "Forecast" })).toBeTruthy();
  });

  it("der Reiter wechselt zwischen Überblick und Kennzahlen über die Adresse", async () => {
    spieleApi(kennzahlenAntworten);
    const { router } = rendereApp(`/beteiligungen/${BET_ID}`);
    const nutzer = userEvent.setup();
    expect(await screen.findByRole("button", { name: "Übersicht" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Übersicht" }).getAttribute("aria-current")).toBe("page");
    await nutzer.click(screen.getByRole("button", { name: "Kennzahlen" }));
    expect(await screen.findByRole("region", { name: /Kennzahlen des Unternehmens, Ist/ })).toBeTruthy();
    expect(router.state.location.search).toMatchObject({ tab: "kennzahlen" });
    await nutzer.click(screen.getByRole("button", { name: "Übersicht" }));
    expect(await screen.findByRole("heading", { level: 2, name: "Deal" })).toBeTruthy();
  });

  it("Erfassen: Dezimalkomma wird zum kanonischen Wert, Zeitraum und Szenario gehen an die API; Fehler stehen am Feld", async () => {
    const api = spieleApi({ ...kennzahlenAntworten, ...alsRoleAntwort(), [`POST /api/v1/beteiligungen/${BET_ID}/kennzahlen/werte`]: { status: 201, koerper: { id: "neu" } } });
    rendereApp(`/beteiligungen/${BET_ID}?ansicht=kennzahlen`);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Wert erfassen" }));
    fireEvent.change(dialog().getByLabelText("Kennzahl"), { target: { value: "ebitda" } });
    fireEvent.change(dialog().getByLabelText("Zeitraum"), { target: { value: "quartal" } });
    fireEvent.change(dialog().getByLabelText("Jahr"), { target: { value: "2026" } });
    fireEvent.change(dialog().getByLabelText("Nummer"), { target: { value: "3" } });
    fireEvent.change(dialog().getByLabelText("Szenario"), { target: { value: "plan" } });
    // erst ungültig: drei Nachkommastellen
    fireEvent.change(dialog().getByLabelText("Wert"), { target: { value: "12,345" } });
    await nutzer.click(dialog().getByRole("button", { name: "Speichern" }));
    expect(await dialog().findByText("Betrag mit Dezimalkomma, z. B. 1234,56")).toBeTruthy();
    expect(api.anfragen("POST", `/api/v1/beteiligungen/${BET_ID}/kennzahlen/werte`)).toHaveLength(0);
    fireEvent.change(dialog().getByLabelText("Wert"), { target: { value: "-1.250,5" } });
    await nutzer.click(dialog().getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(api.anfragen("POST", `/api/v1/beteiligungen/${BET_ID}/kennzahlen/werte`)).toHaveLength(1));
    expect(api.anfragen("POST", `/api/v1/beteiligungen/${BET_ID}/kennzahlen/werte`)[0]!.koerper).toEqual({ schluessel: "ebitda", periodeBeginn: "2026-07-01", periodeEnde: "2026-09-30", szenario: "plan", wert: "-1250.5" });
  });

  it("Prüfen: bestätigen und verwerfen offener Werte; Werte aus dem Link lassen sich nur ansehen, intern erfasste ändern; Betrachter sehen keine Knöpfe", async () => {
    const api = spieleApi({
      ...kennzahlenAntworten,
      ...alsRoleAntwort(),
      "POST /api/v1/kennzahlen/werte/o1/bestaetigen": { koerper: { id: "o1", status: "bestaetigt" } },
      "POST /api/v1/kennzahlen/werte/o2/verwerfen": { koerper: { id: "o2" } },
      "PATCH /api/v1/kennzahlen/werte/o1": { koerper: { id: "o1" } },
    });
    rendereApp(`/beteiligungen/${BET_ID}?ansicht=kennzahlen`);
    const nutzer = userEvent.setup();
    const offen = within(await screen.findByRole("region", { name: "Offene Kennzahlenwerte" }));
    const zeile1 = offen.getByRole("row", { name: /Umsatz/ });
    expect(zeile1.textContent).toContain("Intern");
    expect(zeile1.textContent).toContain("Entwurf");
    const zeile2 = offen.getByRole("row", { name: /EBITDA/ });
    expect(zeile2.textContent).toContain("Unternehmen (Link)");
    expect(zeile2.textContent).toContain("Eingereicht");
    expect(within(zeile2).queryByRole("button", { name: /ändern/i })).toBeNull(); // Werte aus dem Link ändert niemand
    await nutzer.click(within(zeile1).getByRole("button", { name: "Umsatz Q4 2026 bestätigen" }));
    await waitFor(() => expect(api.anfragen("POST", "/api/v1/kennzahlen/werte/o1/bestaetigen")).toHaveLength(1));
    await nutzer.click(within(zeile2).getByRole("button", { name: "EBITDA Q4 2026 verwerfen" }));
    await waitFor(() => expect(api.anfragen("POST", "/api/v1/kennzahlen/werte/o2/verwerfen")).toHaveLength(1));
    // Ändern: Wert mit Komma vorbelegt, Speichern sendet den kanonischen Wert
    await nutzer.click(within(zeile1).getByRole("button", { name: "Umsatz Q4 2026 ändern" }));
    expect((dialog().getByLabelText("Wert") as HTMLInputElement).value).toBe("50,5");
    fireEvent.change(dialog().getByLabelText("Wert"), { target: { value: "51" } });
    await nutzer.click(dialog().getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(api.anfragen("PATCH", "/api/v1/kennzahlen/werte/o1")).toHaveLength(1));
    expect(api.anfragen("PATCH", "/api/v1/kennzahlen/werte/o1")[0]!.koerper).toEqual({ wert: "51", kommentar: null });
  });

  it("Betrachter: lesen ja, Wert erfassen, Bestätigen und Ändern nein", async () => {
    spieleApi({ ...kennzahlenAntworten, "/api/v1/me": alsRolle("betrachter") });
    rendereApp(`/beteiligungen/${BET_ID}?ansicht=kennzahlen`);
    await screen.findByRole("region", { name: "Offene Kennzahlenwerte" });
    expect(screen.queryByRole("button", { name: "Wert erfassen" })).toBeNull();
    expect(screen.queryByRole("button", { name: /bestätigen/ })).toBeNull();
  });
});

const alsRoleAntwort = () => ({ "/api/v1/me": alsRolle("bearbeiter") });

const abfrageZeile = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  beteiligungId: BET_ID,
  periodeBeginn: "2026-07-01",
  periodeEnde: "2026-09-30",
  faelligAm: "2099-10-15",
  status: "offen",
  sprache: "de",
  hinweis: null,
  tokenAblauf: "2099-11-30T10:00:00.000Z",
  erstelltVon: "x",
  organisation: "Alpha Energie",
  anzahlKennzahlen: 2,
  abgelaufen: false,
  erinnerung: null,
  ...extra,
});

const uebersichtDaten = (abfrage: Record<string, unknown> | null, extra: Record<string, unknown> = {}) => ({
  fondsId: FONDS_ID,
  periode: { beginn: "2026-07-01", ende: "2026-09-30", art: "quartal" },
  kennzahlen: [UMSATZ, EBITDA],
  unternehmen: [
    { beteiligungId: BET_ID, organisation: "Alpha Energie", angefordert: 2, eingereicht: 1, bestaetigt: 0, fehlend: ["umsatz", "ebitda"], abfrage, ...extra },
    { beteiligungId: "b2", organisation: "Beta Medizin", angefordert: 2, eingereicht: 2, bestaetigt: 2, fehlend: [], abfrage: null },
  ],
  summe: { angefordert: 4, eingereicht: 3, bestaetigt: 2 },
});

describe("Fonds: Kennzahlen-Abfragen", () => {
  const seite = `/fonds/${FONDS_ID}/kennzahlen`;
  const uebersichtPfad = `/api/v1/fonds/${FONDS_ID}/kennzahlen/uebersicht`;
  const listePfad = `/api/v1/fonds/${FONDS_ID}/kennzahlen/abfragen`;

  it("zeigt den Stand je Unternehmen für den gewählten Zeitraum und Erinnerungen an offene Anfragen", async () => {
    const api = spieleApi({
      ...kennzahlenAntworten,
      [uebersichtPfad]: { koerper: uebersichtDaten({ id: "a1", status: "offen", faelligAm: "2026-10-15", erinnerung: "ueberfaellig", abgelaufen: false }) },
      [listePfad]: { koerper: { daten: [abfrageZeile("a1", { faelligAm: "2026-10-15", erinnerung: "ueberfaellig" }), abfrageZeile("a2", { organisation: "Beta Medizin", erinnerung: null })] } },
    });
    rendereApp(seite);
    const tabelle = within(await screen.findByRole("region", { name: "Kennzahlen je Unternehmen im Zeitraum" }));
    const alpha = tabelle.getByRole("row", { name: /Alpha Energie/ });
    expect(schmal(alpha.textContent)).toMatch(/2\s*1\s*0/);
    expect(alpha.textContent).toContain("Offen");
    expect(alpha.textContent).toContain("fällig 15.10.2026");
    expect(alpha.textContent).toContain("Umsatz, EBITDA");
    expect(within(alpha).getByRole("link", { name: "Alpha Energie" }).getAttribute("href")).toBe(`/beteiligungen/${BET_ID}?tab=kennzahlen`);
    expect(tabelle.getByRole("row", { name: /Beta Medizin/ }).textContent).toContain("keine Anfrage");
    expect(screen.getByText("Gesamt: 4 angefordert, 3 eingereicht, 2 bestätigt.")).toBeTruthy();
    // der Zeitraum geht als Kurzform an die API: das laufende Quartal
    const q = Math.floor(new Date().getMonth() / 3) + 1;
    expect(api.anfragen("GET", uebersichtPfad)[0]!.query.get("periode")).toBe(`${new Date().getFullYear()}-Q${q}`);
    // Erinnerungen
    await userEvent.setup().click(screen.getByRole("tab", { name: /^Erinnerungen/ }));
    const erinnerung = within(await screen.findByRole("region", { name: "Erinnerungen an offene Anfragen" }));
    expect(erinnerung.getByRole("row", { name: /Alpha Energie/ }).textContent).toContain("überfällig seit 15.10.2026");
    expect(erinnerung.queryByRole("row", { name: /Beta Medizin/ })).toBeNull();
  });

  it("legt eine Anfrage an, zeigt den Link einmalig zum Kopieren und das Unternehmen bekommt Sprache, Fälligkeit und Kennzahlen mit", async () => {
    const token = "Z".repeat(43);
    const api = spieleApi({
      ...kennzahlenAntworten,
      ...alsRoleAntwort(),
      [uebersichtPfad]: { koerper: uebersichtDaten(null) },
      [listePfad]: { koerper: { daten: [] } },
      [`POST /api/v1/beteiligungen/${BET_ID}/kennzahlen/abfragen`]: { status: 201, koerper: { abfrage: { id: "a9" }, link: { token, pfad: `/extern/abfrage/${token}`, ablauf: "2099-11-30T10:00:00.000Z" } } },
    });
    rendereApp(seite);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Abfrage anlegen: Alpha Energie" }));
    fireEvent.change(dialog().getByLabelText("Fällig am"), { target: { value: "2099-10-15" } });
    fireEvent.change(dialog().getByLabelText("Sprache der Seite"), { target: { value: "en" } });
    await nutzer.type(dialog().getByLabelText("Hinweis an das Unternehmen (optional)"), "Bitte bis zum Stichtag.");
    await nutzer.click(dialog().getByRole("button", { name: "Anfrage anlegen" }));
    const link = await screen.findByLabelText("Link zum Kopieren");
    expect((link as HTMLInputElement).value).toBe(`${window.location.origin}/extern/abfrage/${token}`);
    expect(screen.getByText(/Dieser Link wird nur jetzt angezeigt/)).toBeTruthy();
    const body = api.anfragen("POST", `/api/v1/beteiligungen/${BET_ID}/kennzahlen/abfragen`)[0]!.koerper as Record<string, unknown>;
    const q = Math.floor(new Date().getMonth() / 3);
    expect(body).toMatchObject({ faelligAm: "2099-10-15", sprache: "en", hinweis: "Bitte bis zum Stichtag.", gueltigTage: 30, periodeBeginn: `${new Date().getFullYear()}-${String(q * 3 + 1).padStart(2, "0")}-01` });
    // Die Auswahl des Fonds, soweit sie zum Quartal passt: die Jahreskennzahl wird weder angeboten noch mitgeschickt.
    expect(body.schluessel).toEqual(["umsatz"]);
    await nutzer.click(screen.getByRole("button", { name: "Link kopieren" }));
    expect(await screen.findByText("Link kopiert.")).toBeTruthy();
    expect(await navigator.clipboard.readText()).toBe(`${window.location.origin}/extern/abfrage/${token}`);
  });

  it("neuer Link zeigt den neuen Link, Zurückziehen ruft die API; bei Betrachtern fehlen die Knöpfe", async () => {
    const token = "N".repeat(43);
    const api = spieleApi({
      ...kennzahlenAntworten,
      ...alsRoleAntwort(),
      [uebersichtPfad]: { koerper: uebersichtDaten({ id: "a1", status: "offen", faelligAm: "2099-10-15", erinnerung: null, abgelaufen: false }) },
      [listePfad]: { koerper: { daten: [] } },
      "POST /api/v1/kennzahlen/abfragen/a1/neuer-link": { koerper: { abfrage: { id: "a1" }, link: { token, pfad: `/extern/abfrage/${token}`, ablauf: "2099-12-01T10:00:00.000Z" } } },
      "POST /api/v1/kennzahlen/abfragen/a1/widerrufen": { koerper: { id: "a1" } },
    });
    rendereApp(seite);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Neuer Link für Alpha Energie" }));
    expect(((await screen.findByLabelText("Link zum Kopieren")) as HTMLInputElement).value).toContain(token);
    await nutzer.click(dialog().getByRole("button", { name: "Schließen" }));
    await nutzer.click(screen.getByRole("button", { name: "Anfrage an Alpha Energie zurückziehen" }));
    await waitFor(() => expect(api.anfragen("POST", "/api/v1/kennzahlen/abfragen/a1/widerrufen")).toHaveLength(1));
  });

  it("Prüfen: eingereichte Werte mit Anmerkung, einzeln bestätigen oder alle", async () => {
    const detail = {
      abfrage: abfrageZeile("a1", { status: "eingereicht" }),
      organisation: "Alpha Energie",
      kennzahlen: [
        { ...UMSATZ, wert: { id: "w1", wert: "100", status: "eingereicht", quelle: "unternehmen", kommentar: "ohne Sonderposten", verworfenAm: null } },
        { ...EBITDA, wert: { id: "w2", wert: "-5", status: "eingereicht", quelle: "unternehmen", kommentar: null, verworfenAm: null } },
      ],
    };
    const api = spieleApi({
      ...kennzahlenAntworten,
      ...alsRoleAntwort(),
      [uebersichtPfad]: { koerper: uebersichtDaten({ id: "a1", status: "eingereicht", faelligAm: "2099-10-15", erinnerung: null, abgelaufen: false }) },
      [listePfad]: { koerper: { daten: [] } },
      "/api/v1/kennzahlen/abfragen/a1": { koerper: detail },
      "POST /api/v1/kennzahlen/werte/w1/bestaetigen": { koerper: { id: "w1" } },
      "POST /api/v1/kennzahlen/abfragen/a1/bestaetigen": { koerper: { id: "a1", status: "bestaetigt" } },
    });
    rendereApp(seite);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Angaben von Alpha Energie prüfen" }));
    const d = dialog();
    expect(await d.findByText("ohne Sonderposten")).toBeTruthy();
    expect(schmal(d.getByRole("row", { name: /Umsatz/ }).textContent)).toContain("100,00 €");
    expect(schmal(d.getByRole("row", { name: /EBITDA/ }).textContent)).toContain("-5,00 €");
    await nutzer.click(d.getByRole("button", { name: "Umsatz bestätigen" }));
    await waitFor(() => expect(api.anfragen("POST", "/api/v1/kennzahlen/werte/w1/bestaetigen")).toHaveLength(1));
    await nutzer.click(d.getByRole("button", { name: "Alle eingereichten Werte bestätigen" }));
    await waitFor(() => expect(api.anfragen("POST", "/api/v1/kennzahlen/abfragen/a1/bestaetigen")).toHaveLength(1));
  });

  it("Verwalter des Fonds ändert die Auswahl, Bearbeiter sieht sie nur", async () => {
    const api = spieleApi({
      ...kennzahlenAntworten,
      ...{ "/api/v1/me": alsRolle("verwalter") },
      [uebersichtPfad]: { koerper: uebersichtDaten(null) },
      [listePfad]: { koerper: { daten: [] } },
      [`PUT /api/v1/fonds/${FONDS_ID}/kennzahlen/auswahl`]: { koerper: { schluessel: ["umsatz", "ebitda"] } },
    });
    rendereApp(`${seite}?tab=auswahl`);
    const nutzer = userEvent.setup();
    const gruppe = within(await screen.findByRole("group", { name: "Kennzahlen auswählen" }));
    expect((gruppe.getByRole("checkbox", { name: /^Umsatz/ }) as HTMLInputElement).checked).toBe(true);
    expect((gruppe.getByRole("checkbox", { name: /^EBITDA/ }) as HTMLInputElement).checked).toBe(false);
    await nutzer.click(gruppe.getByRole("checkbox", { name: /^EBITDA/ }));
    await nutzer.click(gruppe.getByRole("checkbox", { name: /^Verstöße gegen UNGC/ }));
    await nutzer.click(screen.getByRole("button", { name: "Auswahl speichern" }));
    await waitFor(() => expect(api.anfragen("PUT", `/api/v1/fonds/${FONDS_ID}/kennzahlen/auswahl`)).toHaveLength(1));
    expect(api.anfragen("PUT", `/api/v1/fonds/${FONDS_ID}/kennzahlen/auswahl`)[0]!.koerper).toEqual({ schluessel: ["umsatz", "ebitda"] });
  });

  it("Bearbeiter sieht die Auswahl nur und kann sie nicht speichern", async () => {
    spieleApi({ ...kennzahlenAntworten, "/api/v1/me": alsRolle("bearbeiter"), [uebersichtPfad]: { koerper: uebersichtDaten(null) }, [listePfad]: { koerper: { daten: [] } } });
    rendereApp(`${seite}?tab=auswahl`);
    await screen.findByRole("group", { name: "Kennzahlen auswählen" });
    expect(screen.getByText("Die Auswahl ändern Verwalter des Fonds.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Auswahl speichern" })).toBeNull();
    expect(screen.getByRole("checkbox", { name: /^Umsatz/ }).matches(":disabled")).toBe(true);
  });
});

describe("Verwaltung: Kennzahlenkatalog", () => {
  it("zeigt den Katalog mit Versionen, legt eine neue Version an und setzt Kennzahlen außer Kraft", async () => {
    const api = spieleApi({
      ...kennzahlenAntworten,
      "/api/v1/fonds": { koerper: { daten: [{ id: FONDS_ID, name: "Beispielfonds I", kurzname: "BF I", vintage: 2019, zeichnungskapital: "60000000.00", waehrung: "EUR" }] } },
      "POST /api/v1/kennzahlen/katalog/umsatz/versionen": { status: 201, koerper: { ...UMSATZ, katalogVersion: 2 } },
      "DELETE /api/v1/kennzahlen/katalog/ebitda": { koerper: { ...EBITDA, gueltigBis: "2026-11-19" } },
      "POST /api/v1/kennzahlen/katalog": { status: 201, koerper: { ...UMSATZ, schluessel: "kunden_wert" } },
    });
    rendereApp("/verwaltung?bereich=kennzahlen");
    const nutzer = userEvent.setup();
    const tabelle = within(await screen.findByRole("region", { name: "Kennzahlenkatalog" }));
    expect(tabelle.getByRole("row", { name: /umsatz/ }).textContent).toContain("Umsatz");
    expect(tabelle.getByRole("row", { name: /esg_verstoesse_ungc/ }).textContent).toContain("Ja/Nein");
    expect(api.anfragen("GET", "/api/v1/kennzahlen/katalog")[0]!.query.get("alle")).toBe("false");
    await nutzer.click(screen.getByRole("checkbox", { name: "Alle Versionen zeigen" }));
    await waitFor(() => expect(api.anfragen("GET", "/api/v1/kennzahlen/katalog").some((a) => a.query.get("alle") === "true")).toBe(true));

    await nutzer.click(await screen.findByRole("button", { name: "Neue Version von Umsatz" }));
    fireEvent.change(dialog().getByLabelText("Bezeichnung (Deutsch)"), { target: { value: "Umsatz netto" } });
    fireEvent.change(dialog().getByLabelText("Gültig ab"), { target: { value: "2027-01-01" } });
    await nutzer.click(dialog().getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(api.anfragen("POST", "/api/v1/kennzahlen/katalog/umsatz/versionen")).toHaveLength(1));
    expect(api.anfragen("POST", "/api/v1/kennzahlen/katalog/umsatz/versionen")[0]!.koerper).toMatchObject({ bezeichnungDe: "Umsatz netto", gueltigAb: "2027-01-01", einheit: "EUR", pflicht: true });

    await nutzer.click(screen.getByRole("button", { name: "EBITDA außer Kraft setzen" }));
    await waitFor(() => expect(api.anfragen("DELETE", "/api/v1/kennzahlen/katalog/ebitda")).toHaveLength(1));

    await nutzer.click(screen.getByRole("button", { name: "Neue Kennzahl" }));
    await nutzer.type(dialog().getByLabelText("Schlüssel"), "kunden_wert");
    await nutzer.type(dialog().getByLabelText("Bezeichnung (Deutsch)"), "Kundenwert");
    await nutzer.type(dialog().getByLabelText("Bezeichnung (Englisch)"), "Customer value");
    await nutzer.click(dialog().getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(api.anfragen("POST", "/api/v1/kennzahlen/katalog")).toHaveLength(1));
    expect(api.anfragen("POST", "/api/v1/kennzahlen/katalog")[0]!.koerper).toMatchObject({ schluessel: "kunden_wert", bezeichnungDe: "Kundenwert", bezeichnungEn: "Customer value", typ: "betrag", kategorie: "finanzen" });
  });

  it("Fehler der API erscheinen übersetzt im Dialog", async () => {
    spieleApi({
      ...kennzahlenAntworten,
      "POST /api/v1/kennzahlen/katalog": { status: 409, koerper: { error: { code: "metric_exists", message: "x" } } },
    });
    rendereApp("/verwaltung?bereich=kennzahlen");
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Neue Kennzahl" }));
    await nutzer.type(dialog().getByLabelText("Schlüssel"), "umsatz");
    await nutzer.type(dialog().getByLabelText("Bezeichnung (Deutsch)"), "Umsatz");
    await nutzer.type(dialog().getByLabelText("Bezeichnung (Englisch)"), "Revenue");
    await nutzer.click(dialog().getByRole("button", { name: "Speichern" }));
    expect(await dialog().findByText(/Diese Kennzahl gibt es schon/)).toBeTruthy();
  });
});
