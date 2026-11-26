import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { BERICHT_ID, FONDS_ID, ICH_ID, ZL_ID, alsRolle, beteiligungDaten, fondsDaten, ichDaten, rendereApp, spieleApi, uebersichtDaten } from "../test/hilfen";

const url = `/fonds/${FONDS_ID}`;
const NAV_SCHLUESSEL = `carraway.nav.${ICH_ID}`;

/** Rahmen der Anwendung (Etappe 19): Seitenleiste mit Gruppen, Schmal-Modus, Konto unten links, Pfad in der Kopfzeile. */
describe("Rahmen: Seitenleiste", () => {
  it("gruppiert die Navigation und zeigt Zeichen vor jedem Eintrag", async () => {
    spieleApi();
    rendereApp(url);
    const nav = await screen.findByRole("navigation", { name: "Hauptnavigation" });
    for (const gruppe of ["Dealflow & CRM", "Finanzen", "Daten"]) expect(within(nav).getByRole("button", { name: gruppe })).toBeTruthy();
    expect(within(nav).getAllByRole("link").slice(0, 2).map((link) => link.textContent)).toEqual(["Fonds", "Portfolio"]);
    for (const eintrag of ["Fonds", "Portfolio", "Dealflow", "Kontakte", "Journal", "Zinsen", "Belege", "Buchhaltung", "Meldungen", "Berichte", "Register", "Datenübernahme"]) {
      const link = within(nav).getByRole("link", { name: eintrag });
      expect(link.querySelector("svg[data-glyph]")).not.toBeNull();
    }
    expect(within(nav).getByRole("link", { name: "Portfolio" }).getAttribute("aria-current")).toBe("page");
    // Verwaltung steht im Kontomenü, nicht in der Seitenleiste.
    expect(within(nav).queryByRole("link", { name: "Verwaltung" })).toBeNull();
  });

  it("öffnet die Fondsliste und hält den Kapitalreiter beim Wechsel des Fonds", async () => {
    const zweiter = { ...fondsDaten.daten[0]!, id: "22222222-2222-4222-8222-222222222222", name: "Beispielfonds II" };
    spieleApi({
      "/api/v1/fonds": { koerper: { daten: [...fondsDaten.daten, zweiter] } },
      [`/api/v1/fonds/${zweiter.id}/bewegungen`]: { koerper: { daten: [] } },
    });
    const nutzer = userEvent.setup();
    const { router } = rendereApp(url);
    const nav = within(await screen.findByRole("navigation", { name: "Hauptnavigation" }));
    await nutzer.click(nav.getByRole("link", { name: "Fonds" }));
    await screen.findByRole("region", { name: "Fondsliste" });
    const auswahl = screen.getByRole<HTMLSelectElement>("combobox", { name: "Fonds" });
    expect(auswahl.selectedOptions[0]?.textContent).toBe("Fonds auswählen");
    await nutzer.selectOptions(auswahl, FONDS_ID);
    await nutzer.click(await screen.findByRole("button", { name: "Kapitaltransaktionen" }));
    await nutzer.selectOptions(screen.getByRole("combobox", { name: "Fonds" }), zweiter.id);
    await waitFor(() => expect(router.state.location.search).toMatchObject({ fondsId: zweiter.id, tab: "kapital" }));
    expect(await screen.findByRole("heading", { level: 1, name: zweiter.name })).toBeTruthy();
    expect(nav.getByRole("link", { name: "Fonds" }).getAttribute("aria-current")).toBe("page");
    expect(nav.getByRole("link", { name: "Portfolio" }).getAttribute("aria-current")).toBeNull();
  });

  it("zeigt beim direkten Aufruf einer Beteiligung den zugehörigen Fonds im Journal-Link", async () => {
    const zweiter = { ...fondsDaten.daten[0]!, id: "22222222-2222-4222-8222-222222222222", name: "Beispielfonds II" };
    localStorage.setItem("carraway.fonds", zweiter.id);
    spieleApi({ "/api/v1/fonds": { koerper: { daten: [...fondsDaten.daten, zweiter] } } });
    rendereApp(`/beteiligungen/${beteiligungDaten.beteiligung.id}`);
    await screen.findByRole("heading", { name: beteiligungDaten.organisation.name, level: 1 });
    const nav = within(screen.getByRole("navigation", { name: "Hauptnavigation" }));
    expect(nav.getByRole("link", { name: "Journal" }).getAttribute("href")).toBe(`/fonds/${FONDS_ID}/journal`);
    await waitFor(() => expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Fonds" }).value).toBe(FONDS_ID));
  });

  it.each([
    [`/berichte/${BERICHT_ID}`, "/berichte"],
    [`/zinslaeufe/${ZL_ID}`, "/zinslaeufe"],
  ])("nimmt beim Direktlink %s den Fonds aus den Detaildaten", async (pfad, liste) => {
    const zweiter = { ...fondsDaten.daten[0]!, id: "22222222-2222-4222-8222-222222222222", name: "Beispielfonds II" };
    localStorage.setItem("carraway.fonds", zweiter.id);
    spieleApi({
      "/api/v1/fonds": { koerper: { daten: [...fondsDaten.daten, zweiter] } },
      [`/api/v1/fonds/${zweiter.id}/uebersicht`]: { koerper: uebersichtDaten },
    });
    const { router } = rendereApp(pfad);
    const nav = within(await screen.findByRole("navigation", { name: "Hauptnavigation" }));
    const auswahl = screen.getByRole<HTMLSelectElement>("combobox", { name: "Fonds" });
    expect(auswahl.value).toBe(FONDS_ID);
    expect(nav.getByRole("link", { name: "Journal" }).getAttribute("href")).toBe(`/fonds/${FONDS_ID}/journal`);
    await userEvent.selectOptions(auswahl, zweiter.id);
    await waitFor(() => expect(router.state.location.pathname).toBe(liste));
    expect(router.state.location.search).toEqual({ fondsId: zweiter.id });
  });

  it.each(["/berichte/vorlagen", "/beschlussvorlagen"])("bleibt auf %s und verwendet nur die Fondsauswahl der Seitenleiste", async (pfad) => {
    const zweiter = { ...fondsDaten.daten[0]!, id: "22222222-2222-4222-8222-222222222222", name: "Beispielfonds II" };
    spieleApi({
      "/api/v1/fonds": { koerper: { daten: [...fondsDaten.daten, zweiter] } },
      "/api/v1/beschlussvorlagen": { koerper: { daten: [], platzhalter: [] } },
    });
    const { router } = rendereApp(`${pfad}?fondsId=${FONDS_ID}`);
    const auswahl = await screen.findByRole<HTMLSelectElement>("combobox", { name: "Fonds" });
    expect(auswahl.value).toBe(FONDS_ID);
    await userEvent.selectOptions(auswahl, zweiter.id);
    await waitFor(() => expect(router.state.location.search).toEqual({ fondsId: zweiter.id }));
    expect(router.state.location.pathname).toBe(pfad);
    expect(within(screen.getByRole("main")).queryByRole("combobox", { name: "Fonds" })).toBeNull();
  });

  it("meldet die leere Fondsliste und verlinkt zur Einrichtung", async () => {
    spieleApi({ "/api/v1/fonds": { koerper: { daten: [] } } });
    rendereApp("/");
    const auswahl = await screen.findByRole<HTMLSelectElement>("combobox", { name: "Fonds" });
    await waitFor(() => expect(auswahl.selectedOptions[0]?.textContent).toBe("Noch kein Fonds"));
    const main = within(screen.getByRole("main"));
    expect(main.getByRole("link", { name: "Fonds" }).getAttribute("href")).toBe("/fonds");
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
    const { unmount } = rendereApp(`/zinslaeufe`);
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
    rendereApp(`/dealflow`);
    const nav2 = await screen.findByRole("navigation", { name: "Hauptnavigation" });
    expect(within(nav2).getByRole("button", { name: "Finanzen" }).getAttribute("aria-expanded")).toBe("false");
    expect(within(nav2).getByRole("button", { name: "Dealflow & CRM" }).getAttribute("aria-expanded")).toBe("true");
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

  it("zeigt oben die Fondsauswahl und wechselt den Fonds", async () => {
    spieleApi();
    const { router } = rendereApp("/dealflow");
    const auswahl = within(await screen.findByRole("complementary", { name: "Seitenleiste" })).getByLabelText("Fonds");
    await waitFor(() => expect((auswahl as HTMLSelectElement).disabled).toBe(false));
    expect((auswahl as HTMLSelectElement).value).toBe(FONDS_ID);
    fireEvent.change(auswahl, { target: { value: FONDS_ID } });
    await waitFor(() => expect(router.state.location.pathname).toBe(url));
  });
});

describe("Rahmen: Konto unten links", () => {
  it("öffnet nach oben ein Menü mit Sprache, Einstellungen, API-Hilfe und Abmelden; Verwaltung nur für globale Verwalter", async () => {
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
    expect(within(menue).getByRole("menuitem", { name: "Einstellungen" }).getAttribute("href")).toBe("/einstellungen/postfach");
    expect(within(menue).getByRole("menuitem", { name: "Verwaltung" }).getAttribute("href")).toBe("/verwaltung");
    const api = within(menue).getByRole("menuitem", { name: "API-Hilfe" });
    expect(api.getAttribute("href")).toBe("/api/v1/docs");
    expect(api.getAttribute("target")).toBe("_blank");
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
    spieleApi({ "/api/v1/ich": alsRolle("bearbeiter") });
    const nutzer = userEvent.setup();
    const { router } = rendereApp(url);
    await nutzer.click(await screen.findByRole("button", { name: /Kontomenü/ }));
    expect(screen.queryByRole("menuitem", { name: "Verwaltung" })).toBeNull();
    await nutzer.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    await nutzer.click(screen.getByRole("button", { name: /Kontomenü/ }));
    await nutzer.click(screen.getByRole("menuitem", { name: "Einstellungen" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/einstellungen/postfach"));
  });
});

describe("Rahmen: Kopfzeile", () => {
  it("zeigt den Pfad zur Seite und die Suche", async () => {
    spieleApi();
    rendereApp(`/beteiligungen/b1`);
    const pfad = await screen.findByRole("navigation", { name: "Pfad" });
    const eintraege = within(pfad).getAllByRole("listitem");
    expect(eintraege.map((e) => e.textContent)).toEqual(["Portfolio", "Beteiligung"]);
    expect(eintraege[1]!.getAttribute("aria-current")).toBe("page");
    expect(within(pfad).getByRole("link", { name: "Portfolio" })).toBeTruthy();
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
    spieleApi({ "/api/v1/ich": { koerper: { ...ichDaten } } });
    rendereApp("/zinslaeufe");
    const pfad = await screen.findByRole("navigation", { name: "Path" });
    expect(within(pfad).getAllByRole("listitem").map((e) => e.textContent)).toEqual(["Finance", "Interest"]);
  });
});

describe("Rahmen: Reiterleiste des Fonds", () => {
  it("zeigt auf allen Portfolio-Seiten den Seitenkopf vor den Reitern und behält beim Wechsel den Fokus", async () => {
    spieleApi();
    const nutzer = userEvent.setup();
    const { router } = rendereApp(url);
    const leiste = await screen.findByRole("navigation", { name: "Bereiche des Portfolios" });
    expect(within(leiste).getByRole("button", { name: "Übersicht" }).getAttribute("aria-current")).toBe("page");
    for (const name of ["Szenarien", "Reserven", "Zinsen", "Kennzahlen", "Bewertungsrunde"]) expect(within(leiste).getByRole("button", { name })).toBeTruthy();
    // Reiter der Erweiterungen (ESG) gibt es nur im Build „Voll“ (ee/web/src/kern-tests/Rahmen.test.tsx).
    expect(within(leiste).queryByRole("button", { name: "ESG" })).toBeNull();
    expect(within(leiste).queryByRole("button", { name: "Buchhaltung" })).toBeNull();
    // Gliederung: Gruppenköpfe mit ihren Einträgen
    const gruppen = within(leiste).getAllByRole("list").map((liste) => [liste.getAttribute("aria-labelledby") ? document.getElementById(liste.getAttribute("aria-labelledby")!)?.textContent : null, within(liste).getAllByRole("button").map((k) => k.textContent)]);
    expect(gruppen).toEqual([
      ["Bestand", ["Übersicht", "Kennzahlen", "Zinsen"]],
      ["Planung", ["Szenarien", "Reserven"]],
      ["Bewertung", ["Bewertungsrunde"]],
    ]);
    function pruefeReihenfolge() {
      const haupt = screen.getByRole("main");
      const titel = within(haupt).getByRole("heading", { level: 1 });
      const verzeichnis = within(haupt).getByRole("navigation", { name: "Bereiche des Portfolios" });
      expect(titel.compareDocumentPosition(verzeichnis) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      return verzeichnis;
    }
    pruefeReihenfolge();
    // Nach einem Wechsel über die Tastatur oder die Maus liegt der Fokus auf dem Inhaltsbereich, benannt nach dem Eintrag.
    within(leiste).getByRole("button", { name: "Zinsen" }).focus();
    await nutzer.keyboard("{Enter}");
    await waitFor(() => expect(within(pruefeReihenfolge()).getByRole("button", { name: "Zinsen" }).getAttribute("aria-current")).toBe("page"));
    await waitFor(() => expect(document.activeElement).toBe(screen.getAllByRole("region", { name: "Zinsen" }).find((e) => e.classList.contains("cw-inhalt__bereich"))));

    for (const [id, name] of [["szenarien", "Szenarien"], ["reserven", "Reserven"], ["kennzahlen", "Kennzahlen"], ["bewertungsrunde", "Bewertungsrunde"], ["", "Übersicht"]]) {
      await nutzer.click(within(pruefeReihenfolge()).getByRole("button", { name }));
      await waitFor(() => expect(within(pruefeReihenfolge()).getByRole("button", { name }).getAttribute("aria-current")).toBe("page"));
      expect(router.state.location.pathname).toBe(id ? `${url}/${id}` : url);
      await waitFor(() => expect((document.activeElement as HTMLElement | null)?.classList.contains("cw-inhalt__bereich")).toBe(true));
      expect(document.activeElement?.getAttribute("role")).toBe("region");
    }
    pruefeReihenfolge();
  });

  it("fehlt dort, wo kein Fonds im Mittelpunkt steht", async () => {
    spieleApi();
    rendereApp("/dealflow");
    await screen.findByRole("navigation", { name: "Hauptnavigation" });
    expect(screen.queryByRole("navigation", { name: "Bereiche des Portfolios" })).toBeNull();
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
    await nutzer.click(within(screen.getByRole("navigation", { name: "Hauptnavigation" })).getByRole("link", { name: "Kontakte" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/kontakte"));
    expect(screen.getByRole("complementary", { name: "Seitenleiste" }).getAttribute("data-mobil-offen")).toBeNull();
  });
});
