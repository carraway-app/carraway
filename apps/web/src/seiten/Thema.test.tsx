import { readFileSync } from "node:fs";
import { join } from "node:path";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { THEMA_SCHLUESSEL } from "@carraway/ui";
import { alsRolle, rendereApp, spieleApi } from "../test/hilfen";

/** Thema: Wahl im Kontomenü und in den Einstellungen, Speichern je Person, Abgleich nach der Anmeldung, Skript vor dem ersten Anstrich. */

const wurzel = () => document.documentElement;
const einstellungen = { sprache: "de", mailBerichtFreigegeben: false, mailRegisterEreignis: false, mailVerfuegbar: true };
const einstellungenApi = (abweichend: Parameters<typeof spieleApi>[0] = {}) =>
  spieleApi({
    "/api/v1/me": alsRolle("bearbeiter"),
    "/api/v1/postfach": { koerper: { anbieter: { microsoft: true, google: false, imap: true }, schluesselVorhanden: true, verbindungen: [] } },
    "/api/v1/settings": { koerper: einstellungen },
    "/api/v1/settings/calendar-link": { koerper: { aktiv: false, erstelltAm: null, letzterZugriffAm: null } },
    ...abweichend,
  });

beforeEach(() => {
  wurzel().removeAttribute("data-theme");
  wurzel().classList.remove("cw-thema-wechsel");
});
afterEach(() => {
  wurzel().removeAttribute("data-theme");
});

describe("Thema: Kontomenü", () => {
  it("wählt Hell und Dunkel sofort, ohne Neuladen und ohne das Menü zu schließen; speichert im Browser und beim Server", async () => {
    wurzel().dataset.theme = "system";
    const api = spieleApi({ "PATCH /api/v1/theme": (a) => ({ koerper: a.koerper }) });
    const nutzer = userEvent.setup();
    rendereApp("/");
    await nutzer.click(await screen.findByRole("button", { name: /Kontomenü/ }));
    const gruppe = await screen.findByRole("group", { name: "Thema" });
    const wahl = (name: string) => within(gruppe).getByRole("menuitemradio", { name });
    expect(wahl("System").getAttribute("aria-checked")).toBe("true");
    // Zeichen und Text stehen im Eintrag
    expect(wahl("Hell").querySelector("svg[data-glyph]")?.getAttribute("data-glyph")).toBe("Sun");
    expect(wahl("Dunkel").querySelector("svg[data-glyph]")?.getAttribute("data-glyph")).toBe("Moon");

    await nutzer.click(wahl("Hell"));
    expect(wurzel().dataset.theme).toBe("hell");
    expect(localStorage.getItem(THEMA_SCHLUESSEL)).toBe("hell");
    expect(wahl("Hell").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("menu")).toBeTruthy();
    await waitFor(() => expect(api.anfragen("PATCH", "/api/v1/theme")).toHaveLength(1));
    expect(api.anfragen("PATCH", "/api/v1/theme")[0]!.koerper).toEqual({ theme: "light" });

    await nutzer.click(wahl("Dunkel"));
    expect(wurzel().dataset.theme).toBe("dunkel");
    await nutzer.click(wahl("System"));
    expect(wurzel().dataset.theme).toBe("system");
    await waitFor(() => expect(api.anfragen("PATCH", "/api/v1/theme").map((a) => a.koerper)).toEqual([{ theme: "light" }, { theme: "dark" }, { theme: "system" }]));
  });

  it("ist mit der Tastatur bedienbar: Pfeile zum Eintrag und zwischen den Segmenten, Eingabetaste wählt", async () => {
    wurzel().dataset.theme = "system";
    const api = spieleApi({ "PATCH /api/v1/theme": (a) => ({ koerper: a.koerper }) });
    const nutzer = userEvent.setup();
    rendereApp("/");
    const knopf = await screen.findByRole("button", { name: /Kontomenü/ });
    knopf.focus();
    await nutzer.keyboard("{ArrowDown}");
    const gruppe = await screen.findByRole("group", { name: "Thema" });
    const system = within(gruppe).getByRole("menuitemradio", { name: "System" });
    // Der erste Eintrag des Menüs ist das erste Segment des Themas.
    await waitFor(() => expect(document.activeElement).toBe(system));
    await nutzer.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(within(gruppe).getByRole("menuitemradio", { name: "Hell" }));
    await nutzer.keyboard("{Enter}");
    expect(wurzel().dataset.theme).toBe("hell");
    await nutzer.keyboard("{ArrowRight}{Enter}");
    expect(wurzel().dataset.theme).toBe("dunkel");
    await waitFor(() => expect(api.anfragen("PATCH", "/api/v1/theme")).toHaveLength(2));
    // Escape schließt das Menü und gibt den Fokus zurück.
    await nutzer.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(knopf);
  });

  it("zeigt die Beschriftungen auf Englisch", async () => {
    localStorage.setItem("carraway.sprache", "en");
    spieleApi();
    const nutzer = userEvent.setup();
    rendereApp("/");
    await nutzer.click(await screen.findByRole("button", { name: /Account menu/ }));
    const gruppe = await screen.findByRole("group", { name: "Theme" });
    expect(within(gruppe).getAllByRole("menuitemradio").map((e) => e.textContent)).toEqual(["System", "Light", "Dark"]);
  });

  it("übernimmt nach der Anmeldung den Wert des Servers, wenn er vom Browser abweicht; der Browser merkt ihn", async () => {
    wurzel().dataset.theme = "system";
    const api = spieleApi({ "/api/v1/theme": { koerper: { thema: "hell" } } });
    rendereApp("/");
    await waitFor(() => expect(wurzel().dataset.theme).toBe("hell"));
    expect(localStorage.getItem(THEMA_SCHLUESSEL)).toBe("hell");
    expect(api.anfragen("GET", "/api/v1/theme")).toHaveLength(1);
  });

  it("überschreibt eine Wahl dieser Sitzung nicht mehr mit dem Wert des Servers", async () => {
    wurzel().dataset.theme = "system";
    let antwort: (wert: Response) => void = () => {};
    const spaet = new Promise<Response>((r) => (antwort = r));
    const api = spieleApi({ "PATCH /api/v1/theme": (a) => ({ koerper: a.koerper }) });
    const echt = globalThis.fetch;
    // Der Abgleich antwortet erst, nachdem die Person gewählt hat.
    vi.stubGlobal("fetch", (eingabe: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(eingabe instanceof Request ? eingabe.url : String(eingabe), "http://localhost");
      return url.pathname === "/api/v1/theme" && (init?.method ?? "GET") === "GET" ? spaet : echt(eingabe, init);
    });
    const nutzer = userEvent.setup();
    rendereApp("/");
    await nutzer.click(await screen.findByRole("button", { name: /Kontomenü/ }));
    await nutzer.click(await screen.findByRole("menuitemradio", { name: "Dunkel" }));
    antwort(Response.json({ thema: "hell" }));
    await waitFor(() => expect(api.anfragen("PATCH", "/api/v1/theme")).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(wurzel().dataset.theme).toBe("dunkel");
  });

  it("bleibt bei einem Fehler des Servers beim gewählten Thema", async () => {
    wurzel().dataset.theme = "system";
    spieleApi({ "PATCH /api/v1/theme": { status: 500, koerper: { error: { code: "UNBEKANNT", message: "x" } } } });
    const nutzer = userEvent.setup();
    rendereApp("/");
    await nutzer.click(await screen.findByRole("button", { name: /Kontomenü/ }));
    await nutzer.click(await screen.findByRole("menuitemradio", { name: "Hell" }));
    await new Promise((r) => setTimeout(r, 50));
    expect(wurzel().dataset.theme).toBe("hell");
  });
});

describe("Thema: Einstellungen", () => {
  it("bietet dieselbe Wahl im Reiter Darstellung, auf Deutsch und Englisch", async () => {
    wurzel().dataset.theme = "hell";
    const api = einstellungenApi({ "PATCH /api/v1/theme": (a) => ({ koerper: a.koerper }) });
    const nutzer = userEvent.setup();
    rendereApp("/einstellungen/postfach?tab=darstellung");
    const gruppe = await screen.findByRole("group", { name: "Thema" });
    expect(within(gruppe).getByRole("button", { name: "Hell" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(gruppe).getByRole("button", { name: "System" }).getAttribute("aria-pressed")).toBe("false");
    await nutzer.click(within(gruppe).getByRole("button", { name: "Dunkel" }));
    expect(wurzel().dataset.theme).toBe("dunkel");
    await waitFor(() => expect(api.anfragen("PATCH", "/api/v1/theme")[0]?.koerper).toEqual({ theme: "dark" }));
    expect(within(gruppe).getByRole("button", { name: "Dunkel" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("zeigt den Reiter auf Englisch", async () => {
    localStorage.setItem("carraway.sprache", "en");
    einstellungenApi();
    rendereApp("/einstellungen/postfach?tab=darstellung");
    const gruppe = await screen.findByRole("group", { name: "Theme" });
    expect(within(gruppe).getAllByRole("button").map((b) => b.textContent)).toEqual(["System", "Light", "Dark"]);
    expect(screen.getByRole("tab", { name: "Appearance" })).toBeTruthy();
  });
});

describe("Thema: Skript vor dem ersten Anstrich (index.html)", () => {
  const html = readFileSync(join(process.cwd(), "index.html"), "utf8");
  const skript = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];

  /** Führt das Skript wie der Browser beim Laden aus; `matchMedia` ersetzt den Hörer für das Betriebssystem. */
  function fuehreAus() {
    const hoerer: (() => void)[] = [];
    vi.stubGlobal("matchMedia", () => ({ addEventListener: (_: string, h: () => void) => hoerer.push(h) }));
    new Function(skript!)();
    return hoerer;
  }
  beforeEach(() => {
    document.head.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove());
    wurzel().style.removeProperty("--cw-bg");
  });

  it("steht im Kopf der Seite vor dem Einstieg (kein Neuladen, kein Aufblitzen)", () => {
    expect(skript).toBeTruthy();
    expect(html.indexOf("<script>")).toBeLessThan(html.indexOf('type="module"'));
  });

  it.each([
    ["hell", "hell"],
    ["dunkel", "dunkel"],
    ["system", "system"],
    [null, "system"],
    ["lila", "system"],
    ["", "system"],
  ])("Merkzettel %s ergibt data-theme %s", (gemerkt, erwartet) => {
    if (gemerkt !== null) localStorage.setItem(THEMA_SCHLUESSEL, gemerkt);
    fuehreAus();
    expect(wurzel().dataset.theme).toBe(erwartet);
  });

  it("liest dieselbe Stelle wie die Anwendung", () => {
    expect(skript).toContain(`"${THEMA_SCHLUESSEL}"`);
  });

  it("fällt bei gesperrtem Speicher auf system zurück", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("gesperrt");
    });
    fuehreAus();
    expect(wurzel().dataset.theme).toBe("system");
    vi.restoreAllMocks();
  });

  it("legt die Browserleiste an und füllt sie aus --cw-bg, sobald die Seite geladen ist und wenn das Betriebssystem wechselt", () => {
    const hoerer = fuehreAus();
    const meta = document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"]')!;
    expect(meta).toBeTruthy();
    wurzel().style.setProperty("--cw-bg", "#101714");
    document.dispatchEvent(new Event("DOMContentLoaded"));
    expect(meta.content).toBe("#101714");
    wurzel().style.setProperty("--cw-bg", "#F7F4ED");
    hoerer.forEach((h) => h());
    expect(meta.content).toBe("#F7F4ED");
  });
});
