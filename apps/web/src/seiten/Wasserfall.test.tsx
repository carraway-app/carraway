import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { alsRolle, BET_ID, ORG_A, mitarbeiterpoolDaten, beteiligungDaten, fehler, FONDS_ID, kapitalDaten, KLASSE_ID, klasseDaten, rendereApp, spieleApi, wasserfallDaten, wasserfallGewandeltDaten, letzteRegion, type OffeneWandlungDaten } from "../test/hilfen";
import { de } from "../i18n/de";
import { en } from "../i18n/en";

const url = `/beteiligungen/${BET_ID}`;
const kapitalUrl = `${url}?tab=finanzierung&unter=kapitaltabelle`;
const wasserfallUrl = `${url}?tab=finanzierung&unter=wasserfall`;
const WASSERFALL = `/api/v1/beteiligungen/${BET_ID}/wasserfall`;
const schmal = (text: string | null) => (text ?? "").replace(/\s/g, " ");

afterEach(() => localStorage.removeItem("carraway.sprache"));

describe("Captable", () => {
  it("zeigt Inhaber, Klassen und die Position des Fonds hervorgehoben", async () => {
    spieleApi();
    rendereApp(kapitalUrl);
    const karte = await screen.findByRole("region", { name: "Beteiligungsverhältnisse" });
    expect(screen.getByRole("region", { name: "Captable" }).contains(karte)).toBe(true);
    const abschnitt = within(karte);
    expect(abschnitt.getByRole("heading", { name: "Captable" })).toBeTruthy();
    const tabellenbereich = await abschnitt.findByRole("region", { name: "Captable nach Inhaber und Klasse" });
    expect(tabellenbereich.tabIndex).toBe(0);
    const tabelle = within(tabellenbereich);
    // Standard voll verwässert: Kopf + Gründer + 3 Positionen + Pool (zugeteilt, frei)
    const zeilen = tabelle.getAllByRole("row");
    expect(zeilen).toHaveLength(7);
    expect(tabelle.getByText("Gründer und übrige Anteile")).toBeTruthy();
    expect(tabelle.getByText("ESOP: zugeteilt")).toBeTruthy();
    expect(tabelle.getByText("ESOP: frei")).toBeTruthy();
    // Der Fonds trägt die Markierung, der Co-Investor nicht
    const fondsZeile = zeilen.find((z) => z.textContent?.includes("Beispielfonds I"))!;
    expect(within(fondsZeile).getByText("Dieser Fonds")).toBeTruthy();
    expect(schmal(fondsZeile.textContent)).toContain("81.000");
    expect(schmal(fondsZeile.textContent)).toContain("7,7143 %");
    expect(abschnitt.getAllByRole("link", { name: "Beta Medizin" })[0]!.getAttribute("href")).toContain("/organisationen/");
    expect(schmal(abschnitt.getByText(/Anteile\. Letzte Runde/).textContent)).toContain("Voll verwässert 1.050.000 Anteile. Letzte Runde: Seed, Post-Money 10.000.000 €.");
    expect(schmal(abschnitt.getByText(/Dieser Fonds hält/).textContent)).toContain("Anteil des Fonds: 8,1 % unverwässert, 7,7143 % voll verwässert.");
    // Pool-Zeilen haben keine Klassenauswahl
    const poolZeile = zeilen.find((z) => z.textContent?.includes("ESOP: frei"))!;
    expect(within(poolZeile).queryByRole("combobox")).toBeNull();
    // Umschalten auf unverwässert: nur ausgegebene Anteile
    await userEvent.setup().click(abschnitt.getByRole("button", { name: "Unverwässert" }));
    const unverwaessert = within(await abschnitt.findByRole("region", { name: "Captable nach Inhaber und Klasse" }));
    await waitFor(() => expect(unverwaessert.getAllByRole("row")).toHaveLength(5));
    const fondsUnv = unverwaessert.getAllByRole("row").find((z) => z.textContent?.includes("Beispielfonds I"))!;
    expect(schmal(fondsUnv.textContent)).toContain("8,1 %");
    expect(schmal(abschnitt.getByText(/Anteile\. Letzte Runde/).textContent)).toContain("Unverwässert 1.000.000 Anteile.");
    const klassen = within(abschnitt.getByRole("region", { name: "Captable je Klasse" }));
    expect(klassen.getByText("Rang 1")).toBeTruthy();
    expect(klassen.getByText("12,15 %")).toBeTruthy();
  });

  it("schaltet voll verwässert offene Wandlungen als Schätzung zu und kennzeichnet nicht schätzbare als offen", async () => {
    const wandlung = (x: Partial<OffeneWandlungDaten>): OffeneWandlungDaten => ({
      instrumentId: "i1", bezeichnung: "Wandeldarlehen 2026", beteiligungId: BET_ID, fonds: { id: FONDS_ID, name: "Beispielfonds I" }, diesesFonds: true, status: "geschaetzt", grund: null, fehlend: [], hinweise: [],
      kapital: "100000.00", zinsen: "3000.00", betrag: "103000.00", abschlag: "0.2", bewertungsobergrenze: "6000000", preisJeAnteil: "7.500000", massgeblich: "bewertungsobergrenze", anteile: "13733", ...x,
    });
    const liste = [wandlung({}), wandlung({ instrumentId: "i2", bezeichnung: "Wandeldarlehen 2025", status: "offen", grund: "keine_parameter", fehlend: ["abschlag", "bewertungsobergrenze"], abschlag: null, bewertungsobergrenze: null, preisJeAnteil: null, massgeblich: null, anteile: null, hinweise: ["ohne_zinsen"] })];
    const offene = { ...kapitalDaten.offeneWandlungen, liste, anteile: "13733" };
    const mitDaten = {
      ...kapitalDaten,
      mitWandlungen: true,
      anteileMitWandlungen: "1063733",
      offeneWandlungen: offene,
      zeilen: [...kapitalDaten.zeilen, { ...kapitalDaten.zeilen[1]!, id: "wandlung:i1", halter: { art: "wandlung", id: "i1", name: "Beispielfonds I · Wandeldarlehen 2026", vehikel: null }, klasseId: null, klasseName: null, runde: null, anteile: "13733", anteilUnverwaessert: null, anteilVollVerwaessert: "0.012910", investiert: "0.00", ausgegeben: false }],
    };
    const api = spieleApi({
      [`/api/v1/beteiligungen/${BET_ID}/kapitaltabelle`]: (a) => ({ koerper: a.query.get("offeneWandlungen") === "true" ? mitDaten : { ...kapitalDaten, offeneWandlungen: offene } }),
    });
    rendereApp(kapitalUrl);
    const abschnitt = within(await screen.findByRole("region", { name: "Beteiligungsverhältnisse" }));
    const schalter = await abschnitt.findByRole("checkbox", { name: "inkl. offener Wandlungen" });
    expect(abschnitt.queryByText(/Offene Wandlung:/)).toBeNull();
    await userEvent.setup().click(schalter);
    await waitFor(() => expect(schmal(abschnitt.getByText(/Anteile\. Letzte Runde/).textContent)).toContain("Voll verwässert inkl. offener Wandlungen 1.063.733 Anteile."));
    expect(api.anfragen("GET", `/api/v1/beteiligungen/${BET_ID}/kapitaltabelle`).some((x) => x.query.get("offeneWandlungen") === "true")).toBe(true);
    const tabelle = within(abschnitt.getByRole("region", { name: "Captable nach Inhaber und Klasse" }));
    const zeile = tabelle.getAllByRole("row").find((z) => z.textContent?.includes("Offene Wandlung: Beispielfonds I · Wandeldarlehen 2026"))!;
    expect(within(zeile).getByText("Schätzung").getAttribute("title")).toContain("Schätzung aus Wandlungspreis");
    expect(schmal(zeile.textContent)).toContain("13.733");
    expect(within(zeile).queryByRole("combobox")).toBeNull();
    // Annahmen als Hinweis, offene Wandlung mit Grund
    expect(abschnitt.getByText(/Annahme: die Zinsen wandeln mit/)).toBeTruthy();
    const schaetzungen = within(abschnitt.getByRole("region", { name: "Offene Wandlungen zum Stichtag" }));
    const offen = schaetzungen.getAllByRole("row").find((z) => z.textContent?.includes("Wandeldarlehen 2025"))!;
    expect(within(offen).getByText("Offen")).toBeTruthy();
    expect(schmal(offen.textContent)).toContain("Weder Abschlag noch Bewertungsobergrenze erfasst");
    expect(schmal(offen.textContent)).toContain("ohne Zinsen (keine Konditionen)");
    const geschaetzt = schaetzungen.getAllByRole("row").find((z) => z.textContent?.includes("Wandeldarlehen 2026"))!;
    expect(schmal(geschaetzt.textContent)).toContain("maßgeblich: Bewertungsobergrenze");
    // Unverwässert: kein Schalter, keine Schätzung
    await userEvent.setup().click(abschnitt.getByRole("button", { name: "Unverwässert" }));
    await waitFor(() => expect(abschnitt.queryByRole("checkbox", { name: "inkl. offener Wandlungen" })).toBeNull());
    expect(abschnitt.queryByText(/Offene Wandlung:/)).toBeNull();
  });

  it("zeigt die Mitarbeiterbeteiligung mit Stand und Zuteilungen nach Kategorie", async () => {
    spieleApi();
    rendereApp(kapitalUrl);
    const abschnitt = within(await letzteRegion("Mitarbeiterbeteiligung"));
    expect(await abschnitt.findByText("ESOP (Optionen)")).toBeTruthy();
    const zuteilungen = within(abschnitt.getByRole("region", { name: "Zuteilungen: ESOP" }));
    expect(zuteilungen.getByText("Mitarbeitende")).toBeTruthy();
    expect(abschnitt.getByRole("button", { name: "Zuteilung anlegen: ESOP" })).toBeTruthy();
  });

  it("erfasst einen Austritt an einer bestehenden Zuteilung mit Teilverfall und Rückkauf; die Vorgabe folgt der Art", async () => {
    const pfad = `/api/v1/organisationen/${ORG_A}/mitarbeiterpools/esop/zuteilungen/z1/austritte`;
    const api = spieleApi({ [`POST ${pfad}`]: { status: 201, koerper: mitarbeiterpoolDaten.daten[0]!.zuteilungen[0] } });
    rendereApp(kapitalUrl);
    const nutzer = userEvent.setup();
    const abschnitt = within(await letzteRegion("Mitarbeiterbeteiligung"));
    await nutzer.click(await abschnitt.findByRole("button", { name: "Zuteilung ändern: Mitarbeitende" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Zuteilung ändern" }));
    // Die Zuteilung selbst trägt keine Leaver-Felder mehr; die Austritte stehen in einer eigenen Liste
    expect(dialog.queryByLabelText("Austrittsdatum")).toBeNull();
    expect(dialog.getByText("Noch keine Austritte.")).toBeTruthy();
    await nutzer.click(dialog.getByRole("button", { name: "Austritt erfassen" }));
    const formular = within(dialog.getByRole("form", { name: "Austritt erfassen" }));
    await nutzer.selectOptions(formular.getByLabelText("Art (Leaver)"), "bad_leaver");
    expect((formular.getByLabelText(/Gevestete Einheiten/) as HTMLSelectElement).value).toBe("verfallen");
    fireEvent.change(formular.getByLabelText("Austrittsdatum"), { target: { value: "2024-06-30" } });
    expect(formular.getByText(/ohne Austritt noch 30\.000/)).toBeTruthy();
    await nutzer.type(formular.getByLabelText(/Betroffene Einheiten/), "5000");
    expect(formular.queryByLabelText(/Rückkaufpreis/)).toBeNull();
    await nutzer.selectOptions(formular.getByLabelText(/Gevestete Einheiten/), "rueckkauf");
    await nutzer.type(formular.getByLabelText(/Rückkaufpreis/), "0,5");
    await nutzer.click(formular.getByRole("button", { name: "Austritt speichern" }));
    await waitFor(() => expect(api.anfragen("POST", pfad)).toHaveLength(1));
    expect(api.anfragen("POST", pfad)[0]!.koerper).toEqual({ art: "bad_leaver", austrittAm: "2024-06-30", anzahl: "5000", gevestet: "rueckkauf", rueckkaufpreis: "0.5" });
  });

  it("zeigt mehrere Austritte als Teilbetroffenheit in der Tabelle und entfernt einen Austritt", async () => {
    const pool = mitarbeiterpoolDaten.daten[0]!;
    const zuteilung = {
      ...pool.zuteilungen[0]!,
      betroffen: "15000",
      austritte: [
        { id: "a1", art: "good_leaver" as const, austrittAm: "2024-03-31", anzahl: "10000", gevestet: "bleiben" as const, rueckkaufpreis: null },
        { id: "a2", art: "bad_leaver" as const, austrittAm: "2025-06-30", anzahl: "5000", gevestet: "rueckkauf" as const, rueckkaufpreis: "0.5000" },
        { id: "a3", art: "good_leaver" as const, austrittAm: "2027-01-31", anzahl: "1000", gevestet: "bleiben" as const, rueckkaufpreis: null },
      ],
    };
    const pfad = `/api/v1/organisationen/${ORG_A}/mitarbeiterpools/esop/zuteilungen/z1/austritte/a2`;
    const api = spieleApi({
      [`/api/v1/organisationen/${ORG_A}/mitarbeiterpools`]: { koerper: { daten: [{ ...pool, zuteilungen: [zuteilung] }] } },
      [`DELETE ${pfad}`]: { koerper: zuteilung },
    });
    rendereApp(kapitalUrl);
    const nutzer = userEvent.setup();
    const abschnitt = within(await letzteRegion("Mitarbeiterbeteiligung"));
    const tabelle = within(await abschnitt.findByRole("region", { name: "Zuteilungen: ESOP" }));
    // Stichtag 30.09.2026: zwei Austritte gelten (der dritte liegt danach), 15.000 von 30.000 betroffen; die übrigen bleiben zugeteilt
    expect(tabelle.getByText("Zugeteilt")).toBeTruthy();
    expect(schmal(tabelle.getByText(/2 Austritte/).textContent)).toBe("2 Austritte · 15.000 von 30.000");
    await nutzer.click(abschnitt.getByRole("button", { name: "Zuteilung ändern: Mitarbeitende" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Zuteilung ändern" }));
    const liste = within(dialog.getByRole("region", { name: "Austritte: Mitarbeitende" }));
    expect(liste.getAllByRole("row")).toHaveLength(4);
    expect(liste.getByText(/Rückkauf zu 0,50/)).toBeTruthy();
    await nutzer.click(liste.getByRole("button", { name: "Austritt entfernen: 30.06.2025" }));
    await waitFor(() => expect(api.anfragen("DELETE", pfad)).toHaveLength(1));
  });

  it("bearbeitet eine Änderung der Größe im Seitenpanel und löscht sie nach Bestätigung im Dialog (kein Browser-Dialog)", async () => {
    const pool = mitarbeiterpoolDaten.daten[0]!;
    const pfad = `/api/v1/organisationen/${ORG_A}/mitarbeiterpools/esop/aenderungen/a1`;
    const api = spieleApi({ [`PATCH ${pfad}`]: { koerper: pool.aenderungen[0] }, [`DELETE ${pfad}`]: { status: 204, koerper: null } });
    rendereApp(kapitalUrl);
    const nutzer = userEvent.setup();
    const abschnitt = within(await letzteRegion("Mitarbeiterbeteiligung"));
    const verlauf = within(await abschnitt.findByRole("region", { name: "Verlauf der Größe: ESOP" }));
    await nutzer.click(verlauf.getByRole("button", { name: "Änderung der Größe ändern: 01.01.2022" }));
    const panel = within(await screen.findByRole("dialog", { name: "Änderung der Größe bearbeiten" }));
    const anzahl = panel.getByLabelText(/Änderung \(Einheiten/) as HTMLInputElement;
    expect(anzahl.value).toBe("50000");
    await nutzer.clear(anzahl);
    await nutzer.type(anzahl, "60000");
    await nutzer.click(panel.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(api.anfragen("PATCH", pfad)).toHaveLength(1));
    expect(api.anfragen("PATCH", pfad)[0]!.koerper).toEqual({ anzahl: "60000", datum: "2022-01-01", beschluss: "Gesellschafterbeschluss", rundeId: null, basis: null });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Änderung der Größe bearbeiten" })).toBeNull());
    await nutzer.click(verlauf.getByRole("button", { name: "Änderung der Größe löschen: 01.01.2022" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Änderung der Größe löschen" }));
    expect(api.anfragen("DELETE", pfad)).toHaveLength(0);
    await nutzer.click(dialog.getByRole("button", { name: "Abbrechen" }));
    expect(api.anfragen("DELETE", pfad)).toHaveLength(0);
    await nutzer.click(verlauf.getByRole("button", { name: "Änderung der Größe löschen: 01.01.2022" }));
    await nutzer.click(within(await screen.findByRole("dialog", { name: "Änderung der Größe löschen" })).getByRole("button", { name: "Löschen" }));
    await waitFor(() => expect(api.anfragen("DELETE", pfad)).toHaveLength(1));
  });

  it("zeigt Vehikel · Investor und gruppiert auf Wunsch nach Investor", async () => {
    spieleApi();
    rendereApp(kapitalUrl);
    const nutzer = userEvent.setup();
    const tabelle = within(await screen.findByRole("region", { name: "Captable nach Inhaber und Klasse" }));
    expect(tabelle.getByText(/Beta Medizin Fonds II ·/)).toBeTruthy();
    await nutzer.click(screen.getByRole("button", { name: "Je Investor" }));
    const gruppiert = within(await screen.findByRole("region", { name: "Captable nach Investor" }));
    const zeile = gruppiert.getAllByRole("row").find((z) => z.textContent?.includes("Beta Medizin"))!;
    expect(schmal(zeile.textContent)).toContain("2 Vehikel");
    expect(schmal(zeile.textContent)).toContain("81.000");
    expect(gruppiert.getAllByRole("row")).toHaveLength(6); // Kopf + Gründer + Fonds + Investor + Pool (zugeteilt, frei; voll verwässert)
  });

  it("bietet Bearbeitern die Klasse je Position an und sendet sie mit PATCH", async () => {
    const api = spieleApi({ "PATCH /api/v1/rundenpositionen/p3": { koerper: { id: "p3", anteilsklasseId: KLASSE_ID } } });
    rendereApp(kapitalUrl);
    const nutzer = userEvent.setup();
    const tabelle = within(await screen.findByRole("region", { name: "Captable nach Inhaber und Klasse" }));
    // Zwei Positionen des Co-Investors heißen gleich: die ohne Klasse hat den leeren Wert
    const auswahl = tabelle.getAllByRole("combobox", { name: "Klasse für Beta Medizin (Seed)" }).find((c) => (c as HTMLSelectElement).value === "")!;
    await nutzer.selectOptions(auswahl, KLASSE_ID);
    await waitFor(() => expect(api.anfragen("PATCH", "/api/v1/rundenpositionen/p3")).toHaveLength(1));
    expect(api.anfragen("PATCH", "/api/v1/rundenpositionen/p3")[0]!.koerper).toEqual({ anteilsklasseId: KLASSE_ID });
    // Gründeranteile haben keine Auswahl
    const stamm = tabelle.getAllByRole("row").find((z) => z.textContent?.includes("Gründer und übrige"))!;
    expect(within(stamm).queryByRole("combobox")).toBeNull();
  });

  it("zeigt Betrachtern nur die Ansicht und im früheren Wissensstand einen Hinweis", async () => {
    spieleApi({ "/api/v1/me": alsRolle("betrachter") });
    const { unmount } = rendereApp(kapitalUrl);
    const tabelle = await screen.findByRole("region", { name: "Captable nach Inhaber und Klasse" });
    expect(within(tabelle).queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Neue Klasse" })).toBeNull();
    unmount();

    spieleApi();
    rendereApp(`${kapitalUrl}&stand=2026-07-01T10:00:00Z`);
    expect(await screen.findByText(de.kapital.stand)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Neue Klasse" })).toBeNull();
  });

  it("fehlt bei Beteiligungen ohne Anteile aus Runden (Darlehen)", async () => {
    spieleApi({
      [`/api/v1/beteiligungen/${BET_ID}`]: { koerper: { ...beteiligungDaten, runden: beteiligungDaten.runden.map((r) => ({ ...r, positionen: r.positionen.map((p) => ({ ...p, diesesFonds: false })) })) } },
    });
    rendereApp(kapitalUrl);
    await screen.findByRole("heading", { level: 1, name: "Alpha Energie" });
    expect(screen.queryByRole("region", { name: "Captable" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Beteiligungsverhältnisse" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Exit-Szenario" })).toBeNull();
  });
});

describe("Anteilsklassen", () => {
  it("listet die Klassen des Unternehmens", async () => {
    spieleApi();
    rendereApp(kapitalUrl);
    const tabelle = within(await screen.findByRole("region", { name: "Anteilsklassen des Unternehmens" }));
    expect(tabelle.getByText("Seed-Vorzugsanteile")).toBeTruthy();
    expect(tabelle.getByText("1×")).toBeTruthy();
    expect(tabelle.getByRole("button", { name: "Anteilsklasse ändern: Seed-Vorzugsanteile" })).toBeTruthy();
  });

  it("legt eine partizipierende Klasse an: Cap erscheint erst bei Partizipation, Verzinsung geht als Bruch", async () => {
    const api = spieleApi({ [`POST /api/v1/organisationen/${klasseDaten.organisationId}/anteilsklassen`]: { status: 201, koerper: klasseDaten } });
    rendereApp(kapitalUrl);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Neue Klasse" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Neue Anteilsklasse" }));
    expect(dialog.queryByLabelText("Cap (Vielfaches des investierten Betrags)")).toBeNull();
    await nutzer.type(dialog.getByLabelText("Name"), "Serie A-Vorzugsanteile");
    fireEvent.change(dialog.getByLabelText("Rang"), { target: { value: "2" } });
    fireEvent.change(dialog.getByLabelText("Präferenzfaktor"), { target: { value: "1,5" } });
    await nutzer.click(dialog.getByRole("checkbox", { name: /Partizipierend/ }));
    await nutzer.type(dialog.getByLabelText("Cap (Vielfaches des investierten Betrags)"), "3");
    await nutzer.type(dialog.getByLabelText("Verzinsung der Präferenz in % pro Jahr"), "6,5");
    await nutzer.click(dialog.getByRole("button", { name: "Klasse speichern" }));
    const pfad = `/api/v1/organisationen/${klasseDaten.organisationId}/anteilsklassen`;
    await waitFor(() => expect(api.anfragen("POST", pfad)).toHaveLength(1));
    expect(api.anfragen("POST", pfad)[0]!.koerper).toEqual({
      name: "Serie A-Vorzugsanteile",
      rang: 2,
      praeferenzFaktor: "1.5",
      partizipierend: true,
      capFaktor: "3",
      kumulierteVerzinsung: "0.065",
      umwandelbar: true,
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("ändert eine Klasse und zeigt den Fehler zu Cap und Faktor am Feld", async () => {
    const pfad = `/api/v1/organisationen/${klasseDaten.organisationId}/anteilsklassen/${KLASSE_ID}`;
    const api = spieleApi({
      [`PATCH ${pfad}`]: () => ({ status: 400, koerper: { error: { code: "invalid_input", message: "x", fields: [{ field: "capFaktor", code: "cap_below_preference", message: "x" }] } } }),
    });
    rendereApp(kapitalUrl);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Anteilsklasse ändern: Seed-Vorzugsanteile" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Anteilsklasse ändern" }));
    expect((dialog.getByLabelText("Name") as HTMLInputElement).value).toBe("Seed-Vorzugsanteile");
    await nutzer.click(dialog.getByRole("checkbox", { name: /Partizipierend/ }));
    await nutzer.type(dialog.getByLabelText("Cap (Vielfaches des investierten Betrags)"), "0,5");
    await nutzer.click(dialog.getByRole("button", { name: "Klasse speichern" }));
    expect(await dialog.findByText(de.feldfehler.cap_below_preference)).toBeTruthy();
    expect(api.anfragen("PATCH", pfad)[0]!.koerper).toMatchObject({ partizipierend: true, capFaktor: "0.5", rang: 1, name: "Seed-Vorzugsanteile" });
  });

  it("übersetzt den Fehler bei doppeltem Namen", async () => {
    spieleApi({ [`POST /api/v1/organisationen/${klasseDaten.organisationId}/anteilsklassen`]: fehler(409, "share_class_name_exists") });
    rendereApp(kapitalUrl);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Neue Klasse" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Neue Anteilsklasse" }));
    await nutzer.type(dialog.getByLabelText("Name"), "Seed-Vorzugsanteile");
    await nutzer.click(dialog.getByRole("button", { name: "Klasse speichern" }));
    expect(await dialog.findByText(de.fehler.share_class_name_exists)).toBeTruthy();
  });
});

describe("Exit-Szenario", () => {
  it("rechnet mit einer Schnellwahl, zeigt Rückflüsse, Entscheidungen und den Rechenweg", async () => {
    const api = spieleApi();
    rendereApp(wasserfallUrl);
    const nutzer = userEvent.setup();
    const abschnitt = within(await letzteRegion("Exit-Szenario"));
    expect(abschnitt.getByText(/Post-Money der letzten Runde: 10\.000\.000/)).toBeTruthy();
    await nutzer.click(abschnitt.getByRole("button", { name: "1× Post-Money" }));
    await waitFor(() => expect(api.anfragen("POST", WASSERFALL)).toHaveLength(1));
    const anfrage = api.anfragen("POST", WASSERFALL)[0]!.koerper as Record<string, string>;
    expect(anfrage.exitwert).toBe("10000000");
    expect(anfrage.exitdatum).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(anfrage).not.toHaveProperty("kosten");
    expect(anfrage).not.toHaveProperty("treuhandAnteil");

    const tabelle = within(await screen.findByRole("region", { name: "Rückflüsse je Inhaber und Klasse" }));
    const fonds = tabelle.getAllByRole("row").find((z) => z.textContent?.includes("Beispielfonds I"))!;
    expect(within(fonds).getByText("Dieser Fonds")).toBeTruthy();
    expect(schmal(fonds.textContent)).toContain("1.000.000,00 €");
    expect(schmal(fonds.textContent)).toContain("1,00x");
    expect(fonds.textContent).toContain("Behält die Präferenz");
    expect(tabelle.getAllByRole("row").some((z) => z.textContent?.includes("Gründer und übrige Anteile") && z.textContent.includes("Stammanteile"))).toBe(true);
    const kennzahlen = schmal(abschnitt.getByText("Rückfluss des Fonds").closest("div")?.parentElement?.textContent ?? "");
    expect(kennzahlen).toContain("1.000.000 €");
    // Rechenweg als eigener Abschnitt
    const herkunft = within(await screen.findByRole("region", { name: "Rechenweg" }));
    expect(herkunft.getByText("Entscheidung Seed-Vorzugsanteile: behält die Präferenz")).toBeTruthy();
    expect(herkunft.getByText("Rest nach Präferenzen")).toBeTruthy();
  });

  it("schaltet das Ergebnis auf je Investor um: Positionen eines Investors stehen in einer Zeile", async () => {
    spieleApi({ [`POST ${WASSERFALL}`]: { koerper: wasserfallDaten } });
    rendereApp(wasserfallUrl);
    const nutzer = userEvent.setup();
    const abschnitt = within(await letzteRegion("Exit-Szenario"));
    await nutzer.type(abschnitt.getByLabelText("Exitwert in Euro"), "10000000");
    await nutzer.click(abschnitt.getByRole("button", { name: "Berechnen" }));
    await screen.findByRole("region", { name: "Rückflüsse je Inhaber und Klasse" });
    await nutzer.click(abschnitt.getByRole("button", { name: "Je Investor" }));
    const tabelle = within(await screen.findByRole("region", { name: "Rückflüsse je Investor" }));
    const beta = tabelle.getAllByRole("row").filter((z) => z.textContent?.includes("Beta Medizin"));
    expect(beta).toHaveLength(1);
    expect(schmal(beta[0]!.textContent)).toContain("1.900.000,00 €");
    expect(screen.queryByRole("region", { name: "Rückflüsse je Inhaber und Klasse" })).toBeNull();
  });

  it("zeigt die Umwandlung und sendet Kosten und Treuhand (in Prozent als Bruch)", async () => {
    const api = spieleApi({ [`POST ${WASSERFALL}`]: { koerper: wasserfallGewandeltDaten } });
    rendereApp(wasserfallUrl);
    const nutzer = userEvent.setup();
    const abschnitt = within(await letzteRegion("Exit-Szenario"));
    await nutzer.type(abschnitt.getByLabelText("Exitwert in Euro"), "20.500.000".replace(/\./g, ""));
    await nutzer.type(abschnitt.getByLabelText("Transaktionskosten in Euro (optional)"), "500000");
    await nutzer.type(abschnitt.getByLabelText("Einbehalt in Treuhand in % (optional)"), "7,5");
    await nutzer.click(abschnitt.getByRole("button", { name: "Berechnen" }));
    await waitFor(() => expect(api.anfragen("POST", WASSERFALL)).toHaveLength(1));
    expect(api.anfragen("POST", WASSERFALL)[0]!.koerper).toMatchObject({ exitwert: "20500000", kosten: "500000", treuhandAnteil: "0.075" });
    const tabelle = within(await screen.findByRole("region", { name: "Rückflüsse je Inhaber und Klasse" }));
    expect(tabelle.getAllByText("Wandelt in Stammanteile um").length).toBe(2);
    const klassen = within(screen.getByRole("region", { name: "Rückflüsse je Klasse" }));
    expect(klassen.getByText("Wandelt in Stammanteile um")).toBeTruthy();
  });

  it("zeigt Fehler der API am Feld und fragt ohne Angabe nicht an", async () => {
    spieleApi({
      [`POST ${WASSERFALL}`]: () => ({ status: 400, koerper: { error: { code: "invalid_input", message: "x", fields: [{ field: "kosten", code: "costs_exceed_exit_value", message: "x" }] } } }),
    });
    rendereApp(wasserfallUrl);
    const nutzer = userEvent.setup();
    const abschnitt = within(await letzteRegion("Exit-Szenario"));
    await nutzer.type(abschnitt.getByLabelText("Exitwert in Euro"), "100");
    await nutzer.type(abschnitt.getByLabelText("Transaktionskosten in Euro (optional)"), "200");
    await nutzer.click(abschnitt.getByRole("button", { name: "Berechnen" }));
    expect(await abschnitt.findByText(de.feldfehler.costs_exceed_exit_value)).toBeTruthy();
  });

  it("übersetzt Fehler der Beteiligung ohne Anteile", async () => {
    spieleApi({ [`POST ${WASSERFALL}`]: fehler(409, "waterfall_no_shares") });
    rendereApp(wasserfallUrl);
    const nutzer = userEvent.setup();
    const abschnitt = within(await letzteRegion("Exit-Szenario"));
    await nutzer.type(abschnitt.getByLabelText("Exitwert in Euro"), "100");
    await nutzer.click(abschnitt.getByRole("button", { name: "Berechnen" }));
    expect(await abschnitt.findByText(de.fehler.waterfall_no_shares)).toBeTruthy();
  });

  it("englisch: Texte, Schnellwahl und übersetzter Rechenweg mit unveränderten Klassennamen", async () => {
    localStorage.setItem("carraway.sprache", "en");
    spieleApi();
    rendereApp(wasserfallUrl);
    const nutzer = userEvent.setup();
    const abschnitt = within(await letzteRegion("Exit scenario"));
    await nutzer.click(abschnitt.getByRole("button", { name: "2× post-money" }));
    const tabelle = within(await screen.findByRole("region", { name: "Proceeds by holder and class" }));
    expect(tabelle.getAllByText("Keeps the preference").length).toBeGreaterThan(0);
    const herkunft = within(await screen.findByRole("region", { name: "Calculation steps" }));
    expect(herkunft.getByText("Decision Seed-Vorzugsanteile: keeps the preference")).toBeTruthy();
    expect(herkunft.getByText("Remainder after preferences")).toBeTruthy();
    expect(herkunft.getByText("Claim Seed-Vorzugsanteile (rank 1)")).toBeTruthy();
    expect(en.wasserfall.titel).toBe("Exit scenario");
  });
});

describe("Diagramm des Rückflusses", () => {
  it("ruft die Kurve mit dem 5-Fachen der Post-Money-Bewertung ab, beschreibt sie als Text und markiert das Szenario", async () => {
    const api = spieleApi();
    rendereApp(wasserfallUrl);
    const nutzer = userEvent.setup();
    const diagramm = await screen.findByRole("img", { name: /Liniendiagramm mit 7 Punkten/ });
    expect(schmal(diagramm.getAttribute("aria-label"))).toBe("Liniendiagramm mit 7 Punkten bis zu einem Exitwert von 50.000.000 €; der höchste Rückfluss des Fonds beträgt 4.050.000 €. Dieselben Werte stehen in der Tabelle.");
    const anfrage = api.anfragen("GET", `${WASSERFALL}/kurve`)[0]!;
    expect(anfrage.query.get("bis")).toBe("50000000");
    expect(anfrage.query.get("punkte")).toBe("60");
    expect(anfrage.query.get("exitdatum")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(diagramm.querySelector(".app-kurve__szenario")).toBeNull();
    const abschnitt = within(screen.getAllByRole("region", { name: "Exit-Szenario" }).at(-1)!);
    await nutzer.click(abschnitt.getByRole("button", { name: "0,5× Post-Money" }));
    await waitFor(() => expect(screen.getByRole("img", { name: /Liniendiagramm/ }).querySelector(".app-kurve__szenario")).not.toBeNull());
  });

  it("lässt sich als Tabelle lesen, mit den Knickpunkten und ihren Ereignissen", async () => {
    spieleApi();
    rendereApp(wasserfallUrl);
    const nutzer = userEvent.setup();
    await screen.findByRole("img", { name: /Liniendiagramm/ });
    const kurve = within(screen.getByRole("heading", { level: 2, name: "Rückfluss des Fonds über den Exitwert" }).closest("section")!);
    await nutzer.click(kurve.getByRole("button", { name: "Tabelle" }));
    const knicke = within(await screen.findByRole("region", { name: "Knickpunkte der Verteilung" }));
    expect(knicke.getByText("Präferenz Rang 1 voll bedient")).toBeTruthy();
    expect(knicke.getByText("Seed-Vorzugsanteile wandelt um")).toBeTruthy();
    const punkte = within(kurve.getAllByRole("region", { name: "Rückfluss des Fonds über den Exitwert" })[0]!);
    expect(punkte.getAllByRole("row")).toHaveLength(6);
    await nutzer.click(kurve.getByRole("button", { name: "Diagramm" }));
    expect(await screen.findByRole("img", { name: /Liniendiagramm/ })).toBeTruthy();
  });

  it("zeigt Fehler der Kurve", async () => {
    spieleApi({ [`${WASSERFALL}/kurve`]: fehler(409, "waterfall_no_shares") });
    rendereApp(wasserfallUrl);
    expect(await screen.findByText(de.fehler.waterfall_no_shares)).toBeTruthy();
  });
});
