import { aufDeutsch, aufEnglisch } from "@carraway/api/kontakte/api-namen";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExternesFormular } from "./Formular";
import { parseWert, wertFuerFeld, type ExterneAbfrage } from "./abfrage";
import { EXTERN_TEXTE } from "./texte";

/** Öffentliche Abfrageseite mit nachgebautem `fetch`: kein Server, keine Sitzung. Alle Daten sind erfunden. */

const TOKEN = "T".repeat(43);

const basis: ExterneAbfrage = {
  unternehmen: "Alpha Beispiel",
  periodeBeginn: "2026-07-01",
  periodeEnde: "2026-09-30",
  faelligAm: "2026-10-15",
  sprache: "de",
  hinweis: null,
  ablauf: "2026-11-30T12:00:00.000Z",
  status: "offen",
  schreibgeschuetzt: false,
  kennzahlen: [
    { schluessel: "umsatz", bezeichnungDe: "Umsatz", bezeichnungEn: "Revenue", einheit: "EUR", typ: "betrag", pflicht: true, wert: null, kommentar: null },
    { schluessel: "mitarbeitende_vzae", bezeichnungDe: "Mitarbeitende (VZÄ)", bezeichnungEn: "Employees (FTE)", einheit: "Anzahl", typ: "zahl", pflicht: true, wert: null, kommentar: null },
    { schluessel: "arr", bezeichnungDe: "ARR", bezeichnungEn: "ARR", einheit: "EUR", typ: "betrag", pflicht: false, wert: null, kommentar: null },
    { schluessel: "esg_verstoesse_ungc", bezeichnungDe: "Verstöße gegen UNGC", bezeichnungEn: "Violations of UNGC", einheit: "", typ: "ja_nein", pflicht: false, wert: null, kommentar: null },
  ],
};

interface Aufruf {
  methode: string;
  url: string;
  init: RequestInit;
  koerper: unknown;
}

/** `antworten` je Methode; eine Funktion bekommt den Körper und liefert die Antwort. */
function abrufer(antworten: Partial<Record<"GET" | "PUT" | "POST", () => Response>>) {
  const aufrufe: Aufruf[] = [];
  const f = vi.fn(async (url: RequestInfo | URL, init: RequestInit = {}) => {
    const methode = (init.method ?? "GET") as "GET" | "PUT" | "POST";
    aufrufe.push({ methode, url: String(url), init, koerper: init.body ? aufDeutsch(JSON.parse(String(init.body))) : undefined });
    const antwort = antworten[methode];
    if (!antwort) throw new Error(`unerwarteter Aufruf ${methode}`);
    return antwort();
  });
  return { f: f as unknown as typeof fetch, aufrufe };
}
const ok = (daten: unknown) => () => new Response(JSON.stringify(aufEnglisch(daten)), { status: 200, headers: { "Content-Type": "application/json" } });
const fehler = (status: number, code: string, zusatz: object = {}) => () => new Response(JSON.stringify({ error: { code, message: "x", ...aufEnglisch(zusatz) } }), { status, headers: { "Content-Type": "application/json" } });

/**
 * Die Seite startet in der Browsersprache (jsdom: Englisch) und wechselt erst nach der Antwort in die Sprache der Anfrage. Darum wartet der Helfer
 * auf den geladenen Zustand (Name des Unternehmens in der Überschrift und `<html lang>` in der erwarteten Sprache), nicht nur auf irgendeine Überschrift.
 */
async function oeffne(daten: ExterneAbfrage, antworten: Parameters<typeof abrufer>[0] = {}, startSprache?: "de" | "en") {
  const a = abrufer({ GET: ok(daten), ...antworten });
  render(<ExternesFormular token={TOKEN} abrufer={a.f} {...(startSprache ? { startSprache } : {})} />);
  await screen.findByRole("heading", { level: 1, name: new RegExp(daten.unternehmen) });
  await waitFor(() => expect(document.documentElement.lang).toBe(startSprache ?? daten.sprache));
  return a;
}

// Sprachzustand zwischen den Tests zurücksetzen: gespeicherte Wahl, `<html lang>`, Tab-Titel und Browsersprache (feste Vorgabe Deutsch).
beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    // Speicher gesperrt: nichts zurückzusetzen
  }
  document.documentElement.lang = "de";
  document.title = "";
  vi.spyOn(window.navigator, "language", "get").mockReturnValue("de-DE");
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("Öffentliche Abfrageseite", () => {
  it("lädt ohne Anmeldung nur mit dem Token, ohne Cookies und ohne Referrer", async () => {
    const a = await oeffne(basis);
    expect(a.aufrufe).toHaveLength(1);
    expect(a.aufrufe[0]).toMatchObject({ methode: "GET", url: `/api/v1/external/requests/${TOKEN}` });
    expect(a.aufrufe[0]!.init).toMatchObject({ credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store" });
    const kopf = a.aufrufe[0]!.init.headers as Record<string, string>;
    expect(Object.keys(kopf).map((k) => k.toLowerCase())).not.toContain("authorization");
  });

  it("Deutsch: Titel, Zeitraum, Fälligkeit, Gültigkeit, Pflichtmarken, Hilfe zum Dezimalkomma", async () => {
    await oeffne(basis);
    expect(screen.getByRole("heading", { level: 1, name: "Kennzahlen für Alpha Beispiel" })).toBeTruthy();
    expect(screen.getByText(/Zeitraum 01\.07\.2026 bis 30\.09\.2026/)).toBeTruthy();
    expect(screen.getByText("Bitte bis zum 15.10.2026 einreichen.")).toBeTruthy();
    expect(screen.getByText(/Dieser Link ist gültig bis 30\.11\.2026\./)).toBeTruthy();
    expect(screen.getByLabelText(/Umsatz \(EUR\) \(Pflichtangabe\)/)).toBeTruthy();
    expect(screen.getByLabelText(/ARR \(EUR\) \(freiwillig\)/)).toBeTruthy();
    expect(screen.getAllByText("Dezimalkomma, z. B. 1234,56").length).toBeGreaterThan(0);
    expect(document.documentElement.lang).toBe("de");
    expect(screen.getByRole("button", { name: "Entwurf speichern" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Einreichen" })).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull(); // keine Navigation
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("Englisch: die Sprache der Anfrage gilt beim Öffnen, englische Bezeichnungen, Dezimalpunkt", async () => {
    await oeffne({ ...basis, sprache: "en" });
    expect(screen.getByRole("heading", { level: 1, name: "Key figures for Alpha Beispiel" })).toBeTruthy();
    expect(screen.getByText(/period 01\/07\/2026 to 30\/09\/2026/)).toBeTruthy();
    expect(screen.getByText("Please submit by 15/10/2026.")).toBeTruthy();
    expect(screen.getByLabelText(/Revenue \(EUR\) \(required\)/)).toBeTruthy();
    expect(screen.getByLabelText(/Employees \(FTE\) \(Anzahl\) \(required\)/)).toBeTruthy();
    expect(screen.getAllByText("Decimal point, e.g. 1234.56").length).toBeGreaterThan(0);
    expect(document.documentElement.lang).toBe("en");
    expect(screen.getByRole("button", { name: "Save draft" })).toBeTruthy();
  });

  it("Sprachumschalter: Texte und eingegebene Zahlen wechseln mit, der aktive Knopf ist ausgezeichnet", async () => {
    const nutzer = userEvent.setup();
    await oeffne(basis);
    const de = screen.getByRole("button", { name: "Deutsch" });
    const en = screen.getByRole("button", { name: "English" });
    expect(de.getAttribute("aria-pressed")).toBe("true");
    expect(en.getAttribute("aria-pressed")).toBe("false");
    await nutzer.type(screen.getByLabelText(/Umsatz/), "1234,5");
    await nutzer.click(en);
    expect(en.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Key figures for Alpha Beispiel");
    expect((screen.getByLabelText(/Revenue/) as HTMLInputElement).value).toBe("1234.5");
    await nutzer.click(de);
    expect((screen.getByLabelText(/Umsatz/) as HTMLInputElement).value).toBe("1234,5");
    expect(document.documentElement.lang).toBe("de");
  });

  it("Entwurf speichern: Werte kanonisch an die API (Dezimalkomma, Tausenderpunkt), leere Felder als null, Bestätigung als Statusmeldung", async () => {
    const nutzer = userEvent.setup();
    const gespeichert: ExterneAbfrage = { ...basis, kennzahlen: basis.kennzahlen.map((k) => (k.schluessel === "umsatz" ? { ...k, wert: "1234567.89" } : k)) };
    const a = await oeffne(basis, { PUT: ok(gespeichert) });
    await nutzer.type(screen.getByLabelText(/Umsatz/), "1.234.567,89");
    await nutzer.click(screen.getByRole("radio", { name: "Nein" }));
    await nutzer.type(screen.getByLabelText(/ARR/), "12,5");
    await nutzer.click(screen.getByRole("button", { name: "Entwurf speichern" }));
    await waitFor(() => expect(a.aufrufe.filter((x) => x.methode === "PUT")).toHaveLength(1));
    const put = a.aufrufe.find((x) => x.methode === "PUT")!;
    expect(put.init).toMatchObject({ credentials: "omit" });
    expect(put.koerper).toEqual({
      werte: [
        { schluessel: "umsatz", wert: "1234567.89", kommentar: null },
        { schluessel: "mitarbeitende_vzae", wert: null, kommentar: null },
        { schluessel: "arr", wert: "12.5", kommentar: null },
        { schluessel: "esg_verstoesse_ungc", wert: "no", kommentar: null },
      ],
    });
    expect(await screen.findByText(/Entwurf gespeichert/)).toBeTruthy();
    expect((screen.getByLabelText(/Umsatz/) as HTMLInputElement).value).toBe("1234567,89");
    expect(a.aufrufe.some((x) => x.methode === "POST")).toBe(false);
  });

  it("ungültige Eingabe: Fehler am Feld (aria-invalid, beschrieben), Fokus auf das erste Feld, keine Anfrage", async () => {
    const nutzer = userEvent.setup();
    const a = await oeffne(basis, { PUT: ok(basis) });
    const umsatz = screen.getByLabelText(/Umsatz/) as HTMLInputElement;
    await nutzer.type(umsatz, "12,345");
    await nutzer.type(screen.getByLabelText(/Mitarbeitende/), "1e3");
    await nutzer.click(screen.getByRole("button", { name: "Entwurf speichern" }));
    expect(umsatz.getAttribute("aria-invalid")).toBe("true");
    const beschreibung = document.getElementById(umsatz.getAttribute("aria-describedby")!)!;
    expect(beschreibung.textContent).toMatch(/höchstens zwei Nachkommastellen/);
    expect(screen.getByLabelText(/Mitarbeitende/).getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(umsatz);
    expect(screen.getByText("Bitte prüfen Sie die markierten Felder.")).toBeTruthy();
    expect(a.aufrufe.filter((x) => x.methode !== "GET")).toHaveLength(0);
    // Mehrdeutiges „1.234“ wird auf Deutsch nicht geraten
    expect(parseWert("betrag", "1.234", "de")).toEqual({ fehler: "betrag" });
    expect(parseWert("betrag", "1.234", "en")).toEqual({ fehler: "betrag" });
    expect(parseWert("betrag", "1,234.5", "en")).toEqual({ wert: "1234.5" });
    expect(parseWert("betrag", "-4000", "de")).toEqual({ wert: "-4000" });
    expect(parseWert("ja_nein", "vielleicht", "de")).toEqual({ fehler: "jaNein" });
    expect(wertFuerFeld("betrag", "12.5", "de")).toBe("12,5");
  });

  it("einreichen ohne Pflichtangaben: Meldung mit den Namen, kein Aufruf; mit Pflichtangaben erst speichern, dann einreichen, dann die Dankeseite", async () => {
    const nutzer = userEvent.setup();
    const eingereicht: ExterneAbfrage = {
      ...basis,
      status: "eingereicht",
      schreibgeschuetzt: true,
      kennzahlen: basis.kennzahlen.map((k) => (k.schluessel === "umsatz" ? { ...k, wert: "100" } : k.schluessel === "mitarbeitende_vzae" ? { ...k, wert: "12" } : k)),
    };
    const a = await oeffne(basis, { PUT: ok(basis), POST: ok(eingereicht) });
    await nutzer.click(screen.getByRole("button", { name: "Einreichen" }));
    expect(await screen.findByText("Bitte füllen Sie die Pflichtangaben aus: Umsatz, Mitarbeitende (VZÄ).")).toBeTruthy();
    expect(a.aufrufe.filter((x) => x.methode !== "GET")).toHaveLength(0);
    await nutzer.type(screen.getByLabelText(/Umsatz/), "100");
    await nutzer.type(screen.getByLabelText(/Mitarbeitende/), "12");
    await nutzer.click(screen.getByRole("button", { name: "Einreichen" }));
    expect(await screen.findByRole("heading", { name: "Vielen Dank, Ihre Angaben sind eingereicht." })).toBeTruthy();
    expect(a.aufrufe.map((x) => `${x.methode} ${x.url.replace(TOKEN, ":token")}`)).toEqual(["GET /api/v1/external/requests/:token", "PUT /api/v1/external/requests/:token", "POST /api/v1/external/requests/:token/submit"]);
    expect(screen.queryByRole("button", { name: "Einreichen" })).toBeNull();
    const liste = screen.getByText("Umsatz (EUR)").closest("dl")!;
    expect(within(liste).getByText("100,00")).toBeTruthy();
    expect(within(liste).getByText("12")).toBeTruthy();
    expect(within(liste).getAllByText("keine Angabe").length).toBe(2);
  });

  it("Englische Dankeseite und Werte in englischer Schreibweise", async () => {
    const nutzer = userEvent.setup();
    const eingereicht: ExterneAbfrage = { ...basis, sprache: "en", status: "eingereicht", schreibgeschuetzt: true, kennzahlen: basis.kennzahlen.map((k) => (k.schluessel === "umsatz" ? { ...k, wert: "1234567.5" } : k.schluessel === "mitarbeitende_vzae" ? { ...k, wert: "12" } : k)) };
    await oeffne({ ...basis, sprache: "en" }, { PUT: ok(basis), POST: ok(eingereicht) });
    await nutzer.type(screen.getByLabelText(/Revenue/), "1,234,567.5");
    await nutzer.type(screen.getByLabelText(/Employees/), "12");
    await nutzer.click(screen.getByRole("button", { name: "Submit" }));
    expect(await screen.findByRole("heading", { name: "Thank you, your answers have been submitted." })).toBeTruthy();
    expect(screen.getByText("1,234,567.50")).toBeTruthy();
  });

  it("schon eingereicht: nur lesen, keine Eingabefelder, Hinweis", async () => {
    await oeffne({ ...basis, status: "eingereicht", schreibgeschuetzt: true, kennzahlen: basis.kennzahlen.map((k) => (k.schluessel === "esg_verstoesse_ungc" ? { ...k, wert: "yes", kommentar: "siehe Bericht" } : k)) });
    expect(screen.getByText("Ihre Angaben sind eingereicht und lassen sich nicht mehr ändern.")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Einreichen" })).toBeNull();
    expect(screen.getByText("Ja")).toBeTruthy();
    expect(screen.getByText(/siehe Bericht/)).toBeTruthy();
  });

  it("Fehler der API werden verständlich gezeigt: ungültiger, zurückgezogener, abgelaufener Link; zu viele Anfragen; Pflichtfehler des Servers", async () => {
    const text = (art: string, sprache: "de" | "en") => EXTERN_TEXTE[sprache][art as "fehlerLink"] as string;
    for (const [status, code, art] of [[404, "metric_request_not_found", "fehlerLink"], [410, "metric_request_revoked", "fehlerWiderrufen"], [410, "metric_request_expired", "fehlerAbgelaufen"], [429, "too_many_requests", "fehlerZuViele"], [500, "internal_error", "fehlerAllgemein"]] as const) {
      for (const sprache of ["de", "en"] as const) {
        const a = abrufer({ GET: fehler(status, code) });
        const { unmount } = render(<ExternesFormular token={TOKEN} abrufer={a.f} startSprache={sprache} />);
        expect((await screen.findByRole("alert")).textContent).toBe(text(art, sprache));
        unmount();
      }
    }
    // Netzwerkfehler
    const kaputt = vi.fn(async () => {
      throw new TypeError("offline");
    });
    const { unmount } = render(<ExternesFormular token={TOKEN} abrufer={kaputt as unknown as typeof fetch} startSprache="de" />);
    expect((await screen.findByRole("alert")).textContent).toBe(EXTERN_TEXTE.de.fehlerAllgemein);
    unmount();
    // Server meldet beim Einreichen fehlende Pflichtangaben
    const nutzer = userEvent.setup();
    await oeffne(basis, { PUT: ok(basis), POST: fehler(400, "metric_required_missing", { fehlend: ["umsatz"] }) });
    await nutzer.type(screen.getByLabelText(/Umsatz/), "1");
    await nutzer.type(screen.getByLabelText(/Mitarbeitende/), "1");
    await nutzer.click(screen.getByRole("button", { name: "Einreichen" }));
    expect(await screen.findByText("Bitte füllen Sie die Pflichtangaben aus: Umsatz.")).toBeTruthy();
    expect(screen.getByLabelText(/Umsatz/).getAttribute("aria-invalid")).toBe("true");
  });

  it("Zugänglichkeit: jedes Feld hat eine Beschriftung, die Statusmeldungen laufen in einer Live-Zone, Gruppen haben eine Legende", async () => {
    await oeffne(basis);
    for (const feld of screen.getAllByRole("textbox")) expect(feld.id).not.toBe("");
    expect(screen.getAllByRole("textbox").every((f) => document.querySelector(`label[for="${f.id}"]`) !== null)).toBe(true);
    expect(document.querySelector('[aria-live="polite"]')).not.toBeNull();
    expect(screen.getByRole("group", { name: /Verstöße gegen UNGC/ })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Sprache" })).toBeTruthy();
    expect(document.querySelectorAll("h1")).toHaveLength(1);
  });
});

// ESG-Fragebogen (Etappe 16) -------------------------------------------------------------------------------------------------

const esgAbfrage: ExterneAbfrage = {
  ...basis,
  art: "esg",
  periodeBeginn: "2025-01-01",
  periodeEnde: "2025-12-31",
  kennzahlen: [
    {
      schluessel: "esg_thg_scope1",
      bezeichnungDe: "Treibhausgasemissionen Scope 1",
      bezeichnungEn: "Greenhouse gas emissions scope 1",
      einheit: "t CO2e",
      typ: "zahl",
      pflicht: false,
      wert: null,
      kommentar: null,
      esg: true,
      regelwerk: "DelVO (EU) 2022/1288 Anhang I Tabelle 1 Nr. 1",
      erlaeuterungDe: "Direkte Treibhausgasemissionen im Berichtsjahr in Tonnen CO2-Äquivalent.",
      erlaeuterungEn: "Direct greenhouse gas emissions in the reporting year in tonnes of CO2 equivalent.",
      geschaetzt: false,
      quellenangabe: null,
    },
    {
      schluessel: "esg_fossile_brennstoffe",
      bezeichnungDe: "Tätigkeit im Sektor fossiler Brennstoffe",
      bezeichnungEn: "Activity in the fossil fuel sector",
      einheit: "",
      typ: "ja_nein",
      pflicht: false,
      wert: null,
      kommentar: null,
      esg: true,
      regelwerk: "DelVO (EU) 2022/1288 Anhang I Tabelle 1 Nr. 4",
      erlaeuterungDe: "Ist das Unternehmen im Sektor fossiler Brennstoffe tätig?",
      erlaeuterungEn: "Is the company active in the fossil fuel sector?",
      geschaetzt: false,
      quellenangabe: null,
    },
    // im ESG-Fragebogen gehört auch der Umsatz zu den Angaben mit Kennzeichen und Quelle
    { schluessel: "umsatz", bezeichnungDe: "Umsatz", bezeichnungEn: "Revenue", einheit: "EUR", typ: "betrag", pflicht: false, wert: null, kommentar: null, esg: false, regelwerk: null, erlaeuterungDe: null, erlaeuterungEn: null, geschaetzt: false, quellenangabe: null },
  ],
};

describe("Öffentliche Abfrageseite: ESG-Fragebogen", () => {
  it("Deutsch: eigener Titel und Einleitung, Erläuterung und Grundlage je Datenpunkt, Schätzkennzeichen und Quelle je Wert, keine Pflichtangabe", async () => {
    await oeffne(esgAbfrage);
    expect(screen.getByRole("heading", { level: 1, name: "Nachhaltigkeitsangaben für Alpha Beispiel" })).toBeTruthy();
    expect(screen.getByText(/Lücken sind erlaubt/)).toBeTruthy();
    expect(screen.getByText("Direkte Treibhausgasemissionen im Berichtsjahr in Tonnen CO2-Äquivalent.", { exact: false })).toBeTruthy();
    expect(screen.getByText("Grundlage: DelVO (EU) 2022/1288 Anhang I Tabelle 1 Nr. 1")).toBeTruthy();
    // Kennzeichen und Quelle je Wert (auch beim Umsatz), beschriftet und mit dem Feld verbunden
    expect(screen.getAllByRole("checkbox", { name: "Der Wert ist geschätzt" })).toHaveLength(3);
    expect(screen.getAllByLabelText("Quelle (z. B. Nachhaltigkeitsbericht oder Schätzverfahren)")).toHaveLength(3);
    const scope1 = screen.getByLabelText(/Treibhausgasemissionen Scope 1/);
    expect(document.getElementById(scope1.getAttribute("aria-describedby")!.split(" ")[0]!)!.textContent).toContain("Direkte Treibhausgasemissionen");
    expect(screen.getAllByText("(freiwillig)").length).toBeGreaterThan(0);
    expect(screen.queryByText("(Pflichtangabe)")).toBeNull();
  });

  it("Entwurf: Kennzeichen und Quelle gehen mit dem Wert an die API; Einreichen verlangt keine Pflichtangabe; die Leseansicht nennt beides", async () => {
    const nutzer = userEvent.setup();
    const gespeichert: ExterneAbfrage = {
      ...esgAbfrage,
      kennzahlen: esgAbfrage.kennzahlen.map((k) => (k.schluessel === "esg_thg_scope1" ? { ...k, wert: "100", geschaetzt: true, quellenangabe: "Schätzung nach Branchenwerten" } : k)),
    };
    const a = await oeffne(esgAbfrage, { PUT: ok(gespeichert), POST: ok({ ...gespeichert, status: "eingereicht", schreibgeschuetzt: true }) });
    expect(document.querySelectorAll("[data-kennzahl]")).toHaveLength(3);
    await nutzer.type(screen.getByLabelText(/Treibhausgasemissionen Scope 1/), "100");
    const scope1Gruppe = document.querySelector<HTMLElement>('[data-kennzahl="esg_thg_scope1"]')!;
    await nutzer.click(within(scope1Gruppe).getByRole("checkbox", { name: "Der Wert ist geschätzt" }));
    await nutzer.type(within(scope1Gruppe).getByLabelText(/^Quelle/), "Schätzung nach Branchenwerten");
    await nutzer.click(screen.getByRole("button", { name: "Entwurf speichern" }));
    await waitFor(() => expect(a.aufrufe.filter((x) => x.methode === "PUT")).toHaveLength(1));
    expect(a.aufrufe.find((x) => x.methode === "PUT")!.koerper).toEqual({
      werte: [
        { schluessel: "esg_thg_scope1", wert: "100", kommentar: null, geschaetzt: true, quellenangabe: "Schätzung nach Branchenwerten" },
        { schluessel: "esg_fossile_brennstoffe", wert: null, kommentar: null },
        { schluessel: "umsatz", wert: null, kommentar: null },
      ],
    });
    expect(await screen.findByText(/Entwurf gespeichert/)).toBeTruthy();
    // der gespeicherte Stand kommt mit Kennzeichen und Quelle zurück in die Felder
    expect(within(document.querySelector<HTMLElement>('[data-kennzahl="esg_thg_scope1"]')!).getByRole<HTMLInputElement>("checkbox", { name: "Der Wert ist geschätzt" }).checked).toBe(true);
    await nutzer.click(screen.getByRole("button", { name: "Einreichen" }));
    await waitFor(() => expect(a.aufrufe.some((x) => x.methode === "POST")).toBe(true));
    expect(await screen.findByText("Vielen Dank, Ihre Angaben sind eingereicht.")).toBeTruthy();
    expect(screen.getByText("(geschätzt)")).toBeTruthy();
    expect(screen.getByText(/Quelle: Schätzung nach Branchenwerten/)).toBeTruthy();
  });

  it("Englisch: Titel, Hinweise, Erläuterung in der Sprache der Seite und Beschriftungen des Kennzeichens", async () => {
    await oeffne({ ...esgAbfrage, sprache: "en" });
    expect(screen.getByRole("heading", { level: 1, name: "Sustainability information for Alpha Beispiel" })).toBeTruthy();
    expect(screen.getByText(/gaps are fine/)).toBeTruthy();
    expect(screen.getByText("Direct greenhouse gas emissions in the reporting year in tonnes of CO2 equivalent.", { exact: false })).toBeTruthy();
    expect(screen.getByText("Basis: DelVO (EU) 2022/1288 Anhang I Tabelle 1 Nr. 4")).toBeTruthy();
    expect(screen.getAllByRole("checkbox", { name: "The value is estimated" })).toHaveLength(3);
    expect(screen.getAllByLabelText("Source (e.g. sustainability report or estimation method)")).toHaveLength(3);
    expect(EXTERN_TEXTE.en.geschaetztMarke).toBe("estimated");
  });

  it("eine gewöhnliche Kennzahlenanfrage zeigt kein Schätzkennzeichen und sendet es nicht; ESG-Datenpunkte in ihr schon", async () => {
    const nutzer = userEvent.setup();
    const gemischt: ExterneAbfrage = { ...basis, kennzahlen: [basis.kennzahlen[0]!, { ...esgAbfrage.kennzahlen[0]!, pflicht: false }] };
    const a = await oeffne(gemischt, { PUT: ok(gemischt) });
    expect(screen.queryByText(/Lücken sind erlaubt/)).toBeNull();
    expect(screen.getAllByRole("checkbox", { name: "Der Wert ist geschätzt" })).toHaveLength(1);
    await nutzer.type(screen.getByLabelText(/Umsatz/), "5");
    await nutzer.type(screen.getByLabelText(/Treibhausgasemissionen Scope 1/), "7");
    await nutzer.click(screen.getByRole("button", { name: "Entwurf speichern" }));
    await waitFor(() => expect(a.aufrufe.filter((x) => x.methode === "PUT")).toHaveLength(1));
    expect(a.aufrufe.find((x) => x.methode === "PUT")!.koerper).toEqual({
      werte: [
        { schluessel: "umsatz", wert: "5", kommentar: null },
        { schluessel: "esg_thg_scope1", wert: "7", kommentar: null, geschaetzt: false, quellenangabe: null },
      ],
    });
  });
});
