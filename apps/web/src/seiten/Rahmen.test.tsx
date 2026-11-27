import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { BERICHT_ID, FONDS_ID, ICH_ID, ZL_ID, alsRolle, beteiligungDaten, fondsDaten, ichDaten, rendereApp, spieleApi, uebersichtDaten, waehleFonds } from "../test/hilfen";

const url = `/funds/${FONDS_ID}`;
const NAV_SCHLUESSEL = `carraway.nav.${ICH_ID}`;

/** Rahmen der Anwendung (Etappe 19): Seitenleiste mit Gruppen, Schmal-Modus, Konto unten links, Pfad in der Kopfzeile. */
describe("Rahmen: Seitenleiste", () => {
  it("wechselt in den Fondskontext: Rückweg, Fonds mit Umschalter, Orte des Fonds mit Zeichen", async () => {
    spieleApi();
    rendereApp(url);
    const leiste = within(await screen.findByRole("complementary", { name: "Seitenleiste" }));
    const nav = within(leiste.getByRole("navigation", { name: "Hauptnavigation" }));
    expect(leiste.getByRole("link", { name: "Alle Bereiche" }).getAttribute("href")).toBe("/funds");
    // Mit nur einem Fonds steht der Kopf ohne Umschalter da.
    expect(leiste.getByText("Beispielfonds I", { selector: ".app-kontext__titel" })).toBeTruthy();
    expect(leiste.queryByRole("button", { name: /Fonds auswählen$/ })).toBeNull();
    for (const gruppe of ["Portfolio", "Kapital", "Finanzen", "Fonds"]) expect(nav.getByRole("button", { name: gruppe })).toBeTruthy();
    for (const eintrag of ["Übersicht", "Kennzahlen", "Planung", "Bewertungsrunde", "Zielfonds", "Investoren", "Journal", "Belege", "Zinsen", "Buchhaltung", "Meldungen", "Berichte", "Stammdaten", "Dokumente"]) {
      expect(nav.getByRole("link", { name: eintrag }).querySelector("svg[data-glyph]")).not.toBeNull();
    }
    expect(nav.getByRole("link", { name: "Übersicht" }).getAttribute("aria-current")).toBe("page");
    expect(nav.getByRole("link", { name: "Belege" }).getAttribute("href")).toBe(`/vouchers?fundId=${FONDS_ID}`);
    // Keine Fondsauswahl als eigenes Feld mehr, keine globalen Einträge im Fondskontext; Verwaltung steht im Kontomenü.
    expect(screen.queryByRole("combobox", { name: "Fonds" })).toBeNull();
    expect(nav.queryByRole("link", { name: "Dealflow" })).toBeNull();
    expect(nav.queryByRole("link", { name: "Verwaltung" })).toBeNull();
  });

  it("global: Fonds, Dashboard, Dealflow und Kontakte, Daten; die Finanzbereiche stehen nur im Fonds", async () => {
    spieleApi();
    rendereApp("/dealflow");
    const nav = within(await screen.findByRole("navigation", { name: "Hauptnavigation" }));
    expect(nav.getAllByRole("link").map((l) => l.textContent)).toEqual(["Fonds", "Dashboard", "Dealflow", "Kontakte", "Register", "Datenübernahme"]);
    expect(nav.getByRole("link", { name: "Dealflow" }).getAttribute("aria-current")).toBe("page");
    expect(screen.queryByRole("link", { name: "Alle Bereiche" })).toBeNull();
  });
  it("führt von der Fondsliste in den Fonds und hält beim Wechsel über den Umschalter den Bereich", async () => {
    const zweiter = { ...fondsDaten.daten[0]!, id: "22222222-2222-4222-8222-222222222222", name: "Beispielfonds II" };
    spieleApi({
      "/api/v1/fonds": { koerper: { daten: [...fondsDaten.daten, zweiter] } },
      [`/api/v1/fonds/${zweiter.id}/bewegungen`]: { koerper: { daten: [] } },
    });
    const nutzer = userEvent.setup();
    const { router } = rendereApp("/funds");
    await screen.findByRole("region", { name: "Fondsliste" });
    // Global ist „Fonds“ aktiv; ein Fonds führt auf seine Übersicht (Fonds und Portfolio sind ein Ziel).
    expect(within(screen.getByRole("navigation", { name: "Hauptnavigation" })).getByRole("link", { name: "Fonds" }).getAttribute("aria-current")).toBe("page");
    await nutzer.click(within(screen.getByRole("main")).getByRole("link", { name: "Beispielfonds I" }));
    await waitFor(() => expect(router.state.location.pathname).toBe(url));
    const nav = within(await screen.findByRole("navigation", { name: "Hauptnavigation" }));
    await nutzer.click(nav.getByRole("link", { name: "Investoren" }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ fondsId: FONDS_ID, tab: "kapital" }));
    await waehleFonds("Beispielfonds II");
    await waitFor(() => expect(router.state.location.search).toMatchObject({ fondsId: zweiter.id, tab: "kapital" }));
    expect(await screen.findByRole("heading", { level: 1, name: zweiter.name })).toBeTruthy();
    expect(within(screen.getByRole("navigation", { name: "Hauptnavigation" })).getByRole("link", { name: "Investoren" }).getAttribute("aria-current")).toBe("page");
  });
  it("zeigt beim direkten Aufruf einer Beteiligung den Rückweg zum zugehörigen Fonds", async () => {
    const zweiter = { ...fondsDaten.daten[0]!, id: "22222222-2222-4222-8222-222222222222", name: "Beispielfonds II" };
    localStorage.setItem("carraway.fonds", zweiter.id);
    spieleApi({ "/api/v1/fonds": { koerper: { daten: [...fondsDaten.daten, zweiter] } } });
    rendereApp(`/investments/${beteiligungDaten.beteiligung.id}`);
    await screen.findByRole("heading", { name: beteiligungDaten.organisation.name, level: 1 });
    // Objektkontext: der Rückweg führt zum Fonds der Beteiligung, nicht zum zuletzt gemerkten
    const leiste = within(screen.getByRole("complementary", { name: "Seitenleiste" }));
    expect((await leiste.findByRole("link", { name: "Beispielfonds I" })).getAttribute("href")).toBe(`/funds/${FONDS_ID}`);
  });
  it.each([
    [`/reports/${BERICHT_ID}`, "/reports"],
    [`/interest-runs/${ZL_ID}`, "/interest-runs"],
  ])("nimmt beim Direktlink %s den Fonds aus den Detaildaten", async (pfad, liste) => {
    const zweiter = { ...fondsDaten.daten[0]!, id: "22222222-2222-4222-8222-222222222222", name: "Beispielfonds II" };
    localStorage.setItem("carraway.fonds", zweiter.id);
    spieleApi({
      "/api/v1/fonds": { koerper: { daten: [...fondsDaten.daten, zweiter] } },
      [`/api/v1/fonds/${zweiter.id}/uebersicht`]: { koerper: uebersichtDaten },
    });
    const { router } = rendereApp(pfad);
    const nav = within(await screen.findByRole("navigation", { name: "Hauptnavigation" }));
    expect(await screen.findByRole("button", { name: /^Beispielfonds I .*, Fonds auswählen$/ })).toBeTruthy();
    expect(nav.getByRole("link", { name: "Journal" }).getAttribute("href")).toBe(`/funds/${FONDS_ID}/journal`);
    await waehleFonds("Beispielfonds II");
    await waitFor(() => expect(router.state.location.pathname).toBe(liste));
    expect(router.state.location.search).toEqual({ fondsId: zweiter.id });
  });
  it("bleibt auf /reports/templates und wechselt den Fonds nur über den Umschalter der Leiste", async () => {
    const zweiter = { ...fondsDaten.daten[0]!, id: "22222222-2222-4222-8222-222222222222", name: "Beispielfonds II" };
    spieleApi({
      "/api/v1/fonds": { koerper: { daten: [...fondsDaten.daten, zweiter] } },
      "/api/v1/resolution-templates": { koerper: { daten: [], platzhalter: [] } },
    });
    const { router } = rendereApp(`/reports/templates?fundId=${FONDS_ID}`);
    await screen.findByRole("button", { name: /^Beispielfonds I .*, Fonds auswählen$/ });
    await waehleFonds("Beispielfonds II");
    await waitFor(() => expect(router.state.location.search).toEqual({ fondsId: zweiter.id }));
    expect(router.state.location.pathname).toBe("/reports/templates");
    expect(within(screen.getByRole("main")).queryByRole("combobox", { name: "Fonds" })).toBeNull();
  });
  it("wechselt auf /decision-proposals den Fonds über die Auswahl der Seite (Dealflow, globale Leiste)", async () => {
    const zweiter = { ...fondsDaten.daten[0]!, id: "22222222-2222-4222-8222-222222222222", name: "Beispielfonds II" };
    spieleApi({
      "/api/v1/fonds": { koerper: { daten: [...fondsDaten.daten, zweiter] } },
      "/api/v1/resolution-templates": { koerper: { daten: [], platzhalter: [] } },
    });
    const { router } = rendereApp(`/decision-proposals?fundId=${FONDS_ID}`);
    const auswahl = await within(await screen.findByRole("main")).findByRole<HTMLSelectElement>("combobox", { name: "Fonds" });
    expect(auswahl.value).toBe(FONDS_ID);
    await userEvent.selectOptions(auswahl, zweiter.id);
    await waitFor(() => expect(router.state.location.search).toEqual({ fondsId: zweiter.id }));
    expect(router.state.location.pathname).toBe("/decision-proposals");
  });

  it("meldet die leere Fondsliste und verlinkt zur Einrichtung", async () => {
    spieleApi({ "/api/v1/fonds": { koerper: { daten: [] } } });
    rendereApp("/");
    const main = within(await screen.findByRole("main"));
    expect((await main.findByRole("link", { name: "Fonds" })).getAttribute("href")).toBe("/funds");
    expect(screen.queryByRole("link", { name: "Alle Bereiche" })).toBeNull();
  });
  it("klebt am Rand und scrollt für sich (Seitenleiste ist eine eigene Landmarke)", async () => {
    spieleApi();
    rendereApp(url);
    const leiste = await screen.findByRole("complementary", { name: "Seitenleiste" });
    expect(leiste.className).toContain("app-seitenleiste");
    expect(leiste.querySelector(".app-seitenleiste__mitte")).not.toBeNull();
  });

  it("klappt Gruppen ein und merkt das je Person; die Gruppe mit der aktiven Seite zeigt nur diese", async () => {
    spieleApi();
    const nutzer = userEvent.setup();
    const { unmount } = rendereApp(`/interest-runs`);
    const nav = await screen.findByRole("navigation", { name: "Hauptnavigation" });
    const kopf = within(nav).getByRole("button", { name: "Finanzen" });
    expect(kopf.getAttribute("aria-expanded")).toBe("true");
    await nutzer.click(kopf);
    expect(kopf.getAttribute("aria-expanded")).toBe("false");
    expect(within(nav).queryByRole("link", { name: "Belege" })).toBeNull();
    expect(within(nav).getByRole("link", { name: "Zinsen" }).getAttribute("aria-current")).toBe("page");
    expect(JSON.parse(localStorage.getItem(NAV_SCHLUESSEL) ?? "{}")).toEqual({ schmal: false, eingeklappt: ["finanzen"] });
    unmount();

    // Neuer Aufruf: der Zustand kommt aus dem Speicher.
    spieleApi();
    rendereApp(`/interest-runs`);
    const nav2 = await screen.findByRole("navigation", { name: "Hauptnavigation" });
    expect(within(nav2).getByRole("button", { name: "Finanzen" }).getAttribute("aria-expanded")).toBe("false");
    expect(within(nav2).getByRole("button", { name: "Portfolio" }).getAttribute("aria-expanded")).toBe("true");
    await nutzer.click(within(nav2).getByRole("button", { name: "Finanzen" }));
    expect(within(nav2).getByRole("link", { name: "Belege" })).toBeTruthy();
  });
  it("schaltet auf die schmale Leiste um: nur Zeichen mit Tooltip, per Tastatur bedienbar, gemerkt", async () => {
    spieleApi();
    const nutzer = userEvent.setup();
    const { unmount } = rendereApp(url);
    const umschalter = await screen.findByRole("button", { name: "Seitenleiste einklappen" });
    expect(umschalter.getAttribute("aria-expanded")).toBe("true");
    umschalter.focus();
    await nutzer.keyboard("{Enter}");
    const schmal = await screen.findByRole("button", { name: "Seitenleiste ausklappen" });
    expect(schmal.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("complementary", { name: "Seitenleiste" }).getAttribute("data-schmal")).toBe("ja");
    const nav = screen.getByRole("navigation", { name: "Hauptnavigation" });
    expect(within(nav).getByRole("link", { name: "Journal" }).getAttribute("title")).toBe("Journal");
    expect(within(nav).queryByRole("button", { name: "Finanzen" })).toBeNull();
    expect(JSON.parse(localStorage.getItem(NAV_SCHLUESSEL) ?? "{}").schmal).toBe(true);
    unmount();

    spieleApi();
    rendereApp(url);
    expect((await screen.findByRole("complementary", { name: "Seitenleiste" })).getAttribute("data-schmal")).toBe("ja");
  });

  it("der Rückweg führt aus dem Fonds in die globale Leiste", async () => {
    spieleApi();
    const nutzer = userEvent.setup();
    const { router } = rendereApp(url);
    await nutzer.click(await screen.findByRole("link", { name: "Alle Bereiche" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/funds"));
    expect(within(screen.getByRole("navigation", { name: "Hauptnavigation" })).getByRole("link", { name: "Dealflow" })).toBeTruthy();
  });
});

describe("Rahmen: Konto unten links", () => {
  it("öffnet nach oben ein Menü mit Sprache, Einstellungen und Abmelden; Verwaltung nur für globale Verwalter, kein Eintrag für Mailversand und API-Hilfe mehr", async () => {
    spieleApi();
    const nutzer = userEvent.setup();
    rendereApp(url);
    const knopf = await screen.findByRole("button", { name: "Kontomenü: Vera Beispiel" });
    expect(knopf.closest(".app-seitenleiste__fuss")).not.toBeNull();
    expect(knopf.textContent).toContain("Vera Beispiel");
    await nutzer.click(knopf);
    const menue = screen.getByRole("menu", { name: "Kontomenü" });
    expect(menue.parentElement?.className).toContain("cw-menue--oben");
    expect(within(menue).getByRole("menuitemradio", { name: "Deutsch" }).getAttribute("aria-checked")).toBe("true");
    expect(within(menue).getByRole("menuitemradio", { name: "English" }).getAttribute("aria-checked")).toBe("false");
    expect(within(menue).getByRole("menuitem", { name: "Einstellungen" }).getAttribute("href")).toBe("/settings/mailbox");
    expect(within(menue).getByRole("menuitem", { name: "Verwaltung" }).getAttribute("href")).toBe("/administration");
    expect(within(menue).queryByRole("menuitem", { name: "API-Hilfe" })).toBeNull();
    expect(within(menue).queryByRole("menuitem", { name: "Mailversand" })).toBeNull();
    expect(within(menue).getAllByRole("menuitem").map((e) => e.textContent)).toEqual(["Einstellungen", "Verwaltung", "Abmelden"]);
    expect(within(menue).getByRole("menuitem", { name: "Abmelden" })).toBeTruthy();
    expect(menue.textContent).toContain("Version 0.1");
  });

  it("wechselt die Sprache im Menü", async () => {
    spieleApi();
    const nutzer = userEvent.setup();
    rendereApp(url);
    await nutzer.click(await screen.findByRole("button", { name: /Kontomenü/ }));
    await nutzer.click(screen.getByRole("menuitemradio", { name: "English" }));
    await waitFor(() => expect(document.documentElement.lang).toBe("en"));
    expect(await screen.findByRole("navigation", { name: "Main navigation" })).toBeTruthy();
  });

  it("führt über das Menü zu den Einstellungen und schließt mit Escape", async () => {
    spieleApi({ "/api/v1/me": alsRolle("bearbeiter") });
    const nutzer = userEvent.setup();
    const { router } = rendereApp(url);
    await nutzer.click(await screen.findByRole("button", { name: /Kontomenü/ }));
    expect(screen.queryByRole("menuitem", { name: "Verwaltung" })).toBeNull();
    await nutzer.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    await nutzer.click(screen.getByRole("button", { name: /Kontomenü/ }));
    await nutzer.click(screen.getByRole("menuitem", { name: "Einstellungen" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/settings/mailbox"));
  });
});

describe("Rahmen: Kopfzeile", () => {
  it("zeigt den Pfad zur Seite und die Suche", async () => {
    spieleApi();
    rendereApp(`/funds/${FONDS_ID}/scenarios`);
    const pfad = await screen.findByRole("navigation", { name: "Pfad" });
    const eintraege = within(pfad).getAllByRole("listitem");
    await waitFor(() => expect(eintraege.map((e) => e.textContent)).toEqual(["Fonds", "Beispielfonds I", "Planung"]));
    expect(within(pfad).getAllByRole("listitem").at(-1)!.getAttribute("aria-current")).toBe("page");
    expect(within(pfad).getByRole("link", { name: "Beispielfonds I" }).getAttribute("href")).toBe(url);
    const kopf = screen.getByRole("banner", { name: "Kopfzeile" });
    expect(within(kopf).getByRole("button", { name: /Suche/ })).toBeTruthy();
  });
  it("nennt die Gruppe im Pfad", async () => {
    spieleApi();
    rendereApp("/dealflow");
    const pfad = await screen.findByRole("navigation", { name: "Pfad" });
    expect(within(pfad).getAllByRole("listitem").map((e) => e.textContent)).toEqual(["Dealflow & CRM", "Dealflow"]);
  });

  it("auf englisch: Pfad und Gruppen übersetzt", async () => {
    localStorage.setItem("carraway.sprache", "en");
    spieleApi({ "/api/v1/me": { koerper: { ...ichDaten } } });
    rendereApp("/interest-runs");
    const pfad = await screen.findByRole("navigation", { name: "Path" });
    await waitFor(() => expect(within(pfad).getAllByRole("listitem").map((e) => e.textContent)).toEqual(["Funds", "Beispielfonds I", "Interest"]));
  });
});

describe("Rahmen: Bereiche des Fonds in der Seitenleiste", () => {
  it("zeigt auf allen Fondsseiten den Kopf über dem Bereich; ein Wechsel in der Leiste ist eine eigene Adresse", async () => {
    spieleApi();
    const nutzer = userEvent.setup();
    const { router } = rendereApp(url);
    const nav = within(await screen.findByRole("navigation", { name: "Hauptnavigation" }));
    expect(nav.getByRole("link", { name: "Übersicht" }).getAttribute("aria-current")).toBe("page");
    // Bereiche der Erweiterungen (ESG) gibt es nur im Build „Voll“ (ee/web/src/kern-tests/Rahmen.test.tsx).
    expect(nav.queryByRole("link", { name: "ESG" })).toBeNull();
    for (const [name, pfad] of [["Kennzahlen", `${url}/metrics`], ["Planung", `${url}/scenarios`], ["Bewertungsrunde", `${url}/valuation-round`], ["Zielfonds", `${url}/target-funds`], ["Übersicht", url]] as const) {
      await nutzer.click(nav.getByRole("link", { name }));
      await waitFor(() => expect(router.state.location.pathname).toBe(pfad));
      await waitFor(() => expect(nav.getByRole("link", { name }).getAttribute("aria-current")).toBe("page"));
      const haupt = screen.getByRole("main");
      expect(within(haupt).getAllByRole("heading", { level: 1 })).toHaveLength(1);
    }
  });

  it("fehlt dort, wo kein Fonds im Mittelpunkt steht", async () => {
    spieleApi();
    rendereApp("/dealflow");
    const nav = within(await screen.findByRole("navigation", { name: "Hauptnavigation" }));
    expect(nav.queryByRole("link", { name: "Planung" })).toBeNull();
  });
});

describe("Rahmen: schmale Fenster", () => {
  it("die Seitenleiste ist ein Menü: Knopf in der Kopfzeile öffnet und schließt sie, Escape schließt", async () => {
    spieleApi();
    const nutzer = userEvent.setup();
    rendereApp(url);
    const knopf = await screen.findByRole("button", { name: "Menü öffnen" });
    expect(knopf.getAttribute("aria-expanded")).toBe("false");
    const leiste = screen.getByRole("complementary", { name: "Seitenleiste" });
    expect(leiste.getAttribute("data-mobil-offen")).toBeNull();
    await nutzer.click(knopf);
    expect(screen.getByRole("dialog", { name: "Hauptnavigation" })).toBe(leiste);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Menü schließen" }));
    await nutzer.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /Kontomenü:/ }));
    await nutzer.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Menü schließen" }));
    expect(leiste.getAttribute("data-mobil-offen")).toBe("ja");
    await nutzer.keyboard("{Escape}");
    expect(leiste.getAttribute("data-mobil-offen")).toBeNull();
    expect(document.activeElement).toBe(knopf);
  });

  it("jede Navigation schließt das Menü", async () => {
    spieleApi();
    const nutzer = userEvent.setup();
    const { router } = rendereApp(url);
    await nutzer.click(await screen.findByRole("button", { name: "Menü öffnen" }));
    await nutzer.click(within(screen.getByRole("navigation", { name: "Hauptnavigation" })).getByRole("link", { name: "Zinsen" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/interest-runs"));
    expect(screen.getByRole("complementary", { name: "Seitenleiste" }).getAttribute("data-mobil-offen")).toBeNull();
  });
});
