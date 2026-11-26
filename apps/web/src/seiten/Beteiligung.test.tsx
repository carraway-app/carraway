import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { BET_ID, FONDS_ID, ORG_A, ORG_B, beteiligungDaten, fehler, rendereApp, spieleApi } from "../test/hilfen";

const url = `/beteiligungen/${BET_ID}`;
const verlaufUrl = `${url}?tab=bewertung&unter=verlauf`;
const vorgaengeUrl = `${url}?tab=finanzierung&unter=transaktionen`;
const rundenUrl = `${url}?tab=finanzierung`;
const RUNDEN_API = `/api/v1/organisationen/${ORG_A}/finanzierungsrunden`;
const rundenPosition = (id: string, art: "fonds" | "organisation", name: string, extra: Record<string, unknown> = {}) => ({
  id,
  investor: { art, id: art === "fonds" ? FONDS_ID : ORG_B, name },
  betrag: art === "fonds" ? "1000000.00" : "500000.00",
  anteile: art === "fonds" ? "81000" : "40500",
  rolle: art === "fonds" ? "lead" : "co",
  anteilsklasse: null,
  gezahlt: art === "fonds" ? null : "100000.00",
  offen: art === "fonds" ? null : "400000.00",
  buchungen: [] as unknown[],
  ...extra,
});
const rundenAntwort = (id: string, bezeichnung: string, datum: string, status: "entwurf" | "abgeschlossen") => ({
  id,
  organisationId: ORG_A,
  bezeichnung,
  datum,
  preMoney: "8000000.00",
  postMoney: "10000000.00",
  preisJeAnteil: "12.3457",
  anteileGesamtNach: "810000.0000",
  status,
  abgeschlossenAm: status === "abgeschlossen" ? "2026-03-16T08:00:00.000Z" : null,
  abgeschlossenVon: null,
  wiedergeoeffnetAm: null,
  wiedergeoeffnetVon: null,
  wiedereroeffnungGrund: null,
  positionen: [rundenPosition(`${id}-p1`, "fonds", "Beispielfonds I"), rundenPosition(`${id}-p2`, "organisation", "Beta Medizin")],
  pruefung: { volumen: "1500000.00", postMoneyErwartet: "10000000.00", anteileErwartet: "810000", anteileVergeben: "121500", abweichungen: [], schliessbar: true },
});
/** Zwei Runden: ein Entwurf (neuer) und eine abgeschlossene Seed-Runde. */
const MIT_RUNDEN = { [RUNDEN_API]: { koerper: { daten: [rundenAntwort("r2", "Serie A", "2025-06-30", "entwurf"), rundenAntwort("r1", "Seed", "2021-05-31", "abgeschlossen")] } } };
const verzeichnis = () => within(screen.getByRole("navigation", { name: /^(Bereiche der Beteiligung|Sections of the holding)$/ }));
const eintrag = (name: string | RegExp) => verzeichnis().getByRole("button", { name });
const aktiv = () => verzeichnis().getAllByRole("button").filter((b) => b.getAttribute("aria-current") === "page").map((b) => b.textContent?.replace(/\d+$/, ""));
const schmal = (text: string | null) => (text ?? "").replace(/\s/g, " ");

describe("Beteiligung", () => {
  it("zeigt Kopf, Kennzahlen und die Reiter; die Übersicht ist der Standard", async () => {
    const api = spieleApi();
    rendereApp(url);

    expect(await screen.findByRole("heading", { level: 1, name: "Alpha Energie" })).toBeTruthy();
    // Fonds, Instrument und Status im Kopf
    const kopf = screen.getByRole("heading", { level: 1 }).closest("header")!;
    expect(within(kopf).getByRole("link", { name: "Beispielfonds I" }).getAttribute("href")).toBe("/fonds/11111111-1111-4111-8111-111111111111");
    expect(kopf.textContent).toContain("Wandeldarlehen");
    expect(within(kopf).getByLabelText<HTMLInputElement>("Stichtag").value).toBe("2026-09-30");
    expect(within(kopf).getByText("Aktiv")).toBeTruthy();

    const kennzahlen = screen.getByRole("region", { name: "Kennzahlen" });
    for (const titel of ["Investiert", "Rückflüsse", "Bewertung", "Multiple", "IRR"]) expect(within(kennzahlen).getByText(titel)).toBeTruthy();
    const text = schmal(kennzahlen.textContent);
    expect(text).toContain("1,0 Mio. €");
    expect(text).toContain("250.000 €");
    expect(text).toContain("2,0 Mio. €");
    expect(text).toContain("2,25x");
    expect(text).toContain("12,3 %"); // IRR kommt als Bruch 0.1234
    // Das Inhaltsverzeichnis gliedert die Bereiche; die Übersicht ist der Standard
    expect(aktiv()).toEqual(["Übersicht"]);
    // Ohne Angaben im Pfad fragt die Seite ohne Parameter
    expect(api.anfragen("GET", `/api/v1/beteiligungen/${BET_ID}`)[0]?.query.toString()).toBe("");
  });

  it("gibt dem Diagramm eine Textfassung, endet am Stichtag und lässt sich als Tabelle lesen", async () => {
    spieleApi();
    rendereApp(verlaufUrl);
    const nutzer = userEvent.setup();
    const diagramm = await screen.findByRole("img", { name: /Bewertungen, von/ });
    // drei Bewertungen bis zum Stichtag, die vom 31.03.2027 gehört nicht dazu
    expect(schmal(diagramm.getAttribute("aria-label"))).toBe("3 Bewertungen, von 1.500.000 € am 30.09.2024 bis 2.000.000 € am 30.09.2026.");
    const saeulen = diagramm.querySelectorAll(".app-verlauf__balken");
    expect(saeulen).toHaveLength(3);
    expect(saeulen[2]?.className).toContain("app-verlauf__balken--aktuell");
    expect(saeulen[0]?.className).not.toContain("--aktuell");
    // Werte in Mio. an den Säulen
    expect(diagramm.textContent).toContain("2,0");

    // Die Seite hat weitere Diagramme mit eigener Umschaltung (Exit-Szenario): nur die des Bewertungsverlaufs bedienen
    const verlauf = within(screen.getByRole("heading", { level: 2, name: "Bewertungsverlauf" }).closest("section")!);
    await nutzer.click(verlauf.getByRole("button", { name: "Tabelle" }));
    const tabelle = within(screen.getAllByRole("region", { name: "Bewertungsverlauf" }).at(-1)!).getByRole("table");
    const zeilen = within(tabelle).getAllByRole("row");
    expect(zeilen).toHaveLength(4); // Kopf plus drei Stichtage
    expect(zeilen[2]!.textContent).toContain("Letzte Runde");
    expect(zeilen[2]!.textContent).toContain("Runde Serie A");
    expect(screen.queryByRole("img", { name: /Bewertungen, von/ })).toBeNull();
    expect(verlauf.getByRole("button", { name: "Tabelle" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("verknüpft Storno-Paare sichtbar, mit Text und Sprung zum Gegenstück", async () => {
    spieleApi();
    rendereApp(vorgaengeUrl);
    const nutzer = userEvent.setup();
    const tabelle = within(await screen.findByRole("region", { name: "Vorgänge" })).getByRole("table");
    const zeilen = within(tabelle).getAllByRole("row");
    expect(zeilen).toHaveLength(5);
    // Original: durchgestrichener Betrag, Hinweis „Storniert“ und Verweis auf den Storno
    expect(zeilen[2]!.querySelector("s")?.textContent).toMatch(/600\.000/);
    expect(zeilen[2]!.textContent).toContain("Storniert");
    expect(zeilen[3]!.textContent).toContain("Storno");
    expect(zeilen[3]!.textContent).toContain("Falscher Betrag");
    expect(schmal(zeilen[3]!.textContent)).toContain("-600.000 €");
    // Beträge stehen rechtsbündig in Zahlenzellen
    expect(within(zeilen[1]!).getAllByRole("cell")[4]!.className).toContain("cw-zahl");

    await nutzer.click(within(zeilen[3]!).getByRole("link", { name: "Zum Vorgang Auszahlung vom 30.06.2021" }));
    expect(within(tabelle).getAllByRole("row")[2]!.getAttribute("aria-current")).toBe("true");
    expect(within(tabelle).getAllByRole("row")[3]!.getAttribute("aria-current")).toBeNull();

    await nutzer.click(within(zeilen[2]!).getByRole("link", { name: "Zum Vorgang Auszahlung vom 15.07.2021" }));
    expect(within(tabelle).getAllByRole("row")[3]!.getAttribute("aria-current")).toBe("true");
  });

  it("verlinkt ein Storno nicht, wenn sein Gegenstück nicht in der Liste steht", async () => {
    const ohneOriginal = { ...beteiligungDaten, vorgaenge: beteiligungDaten.vorgaenge.filter((v) => v.id !== "v2") };
    spieleApi({ [`/api/v1/beteiligungen/${BET_ID}`]: { koerper: ohneOriginal } });
    rendereApp(vorgaengeUrl);
    const tabelle = within(await screen.findByRole("region", { name: "Vorgänge" })).getByRole("table");
    const storno = within(tabelle).getAllByRole("row").find((z) => z.textContent?.includes("Falscher Betrag"))!;
    expect(storno.textContent).toContain("Storno");
    expect(within(storno).queryByRole("link")).toBeNull();
  });

  it("zeigt Runden als Reiter oben und Details darunter, mit hervorgehobenem Fonds und den Co-Investoren", async () => {
    spieleApi(MIT_RUNDEN);
    rendereApp(rundenUrl);
    // Standard: die neueste abgeschlossene Runde; der Entwurf steht als neueste oben in der Liste
    const liste = within(await screen.findByRole("tablist", { name: "Runden" }));
    const eintraege = liste.getAllByRole("tab");
    expect(eintraege).toHaveLength(2);
    expect(eintraege[0]!.textContent).toContain("Serie A");
    expect(eintraege[0]!.textContent).toContain("Entwurf");
    expect(eintraege[0]!.getAttribute("aria-selected")).toBe("false");
    expect(eintraege[1]!.textContent).toContain("Seed");
    expect(eintraege[1]!.textContent).toContain("Abgeschlossen");
    expect(schmal(eintraege[1]!.textContent)).toContain("31.05.2021");
    expect(eintraege[1]!.getAttribute("aria-selected")).toBe("true");
    expect(aktiv()).toEqual(["Finanzierungsrunden"]);

    const runde = await screen.findByRole("article", { name: /Seed/ });
    expect(schmal(runde.textContent)).toContain("8.000.000,00 €");
    expect(schmal(runde.textContent)).toContain("12,3457 €");
    const zeilen = within(within(runde).getByRole("table")).getAllByRole("row");
    expect(zeilen).toHaveLength(4); // Kopf, zwei Positionen, Summenzeile
    // Der eigene Fonds ist markiert (aria-current und Text), der Co-Investor ist verlinkt
    expect(zeilen[1]!.getAttribute("aria-current")).toBe("true");
    expect(zeilen[1]!.textContent).toContain("Eigener Fonds");
    expect(zeilen[1]!.textContent).toContain("Lead");
    expect(zeilen[2]!.getAttribute("aria-current")).toBeNull();
    expect(within(zeilen[2]!).getByRole("link", { name: "Beta Medizin" }).getAttribute("href")).toMatch(/^\/organisationen\//);
    expect(zeilen[2]!.textContent).toContain("Co-Investor");
    expect(schmal(zeilen[2]!.textContent)).toContain("400.000,00 €");

    // Die Auswahl wechselt die Details; die Runden stehen nie doppelt untereinander
    await userEvent.setup().click(eintraege[0]!);
    expect(await screen.findByRole("article", { name: /Serie A/ })).toBeTruthy();
    expect(screen.queryByRole("article", { name: /Seed/ })).toBeNull();
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(eintraege[0]!.getAttribute("aria-selected")).toBe("true");
    expect(eintraege[1]!.getAttribute("aria-selected")).toBe("false");
  });

  it("zeigt in den Details die Felder der Runde, die Aktionen eines Entwurfs und den Zähler im Verzeichnis", async () => {
    spieleApi(MIT_RUNDEN);
    rendereApp(rundenUrl);
    const nutzer = userEvent.setup();
    expect(await within(await screen.findByRole("navigation", { name: /^Bereiche der Beteiligung$/ })).findByRole("button", { name: /^Finanzierungsrunden\s*2$/ })).toBeTruthy();
    const liste = within(await screen.findByRole("tablist", { name: "Runden" }));
    await nutzer.click(liste.getByRole("tab", { name: /Serie A/ }));
    const runde = within(await screen.findByRole("article", { name: /Serie A/ }));
    expect(runde.getByRole("button", { name: "Runde abschließen" })).toBeTruthy();
    expect(runde.getByRole("button", { name: "Runde bearbeiten" })).toBeTruthy();
    expect(runde.getByRole("button", { name: "Position hinzufügen" })).toBeTruthy();
    expect(runde.getByRole("button", { name: "Entwurf löschen" })).toBeTruthy();
    await nutzer.click(runde.getByRole("button", { name: "Eigene Felder anzeigen: Serie A" }));
    expect(await screen.findByRole("heading", { name: "Eigene Felder: Serie A" })).toBeTruthy();
  });

  it("verlinkt den Deal und die Organisation", async () => {
    spieleApi();
    rendereApp(url);
    const deal = await screen.findByRole("link", { name: "Zum Deal: Alpha, Wachstum" });
    expect(deal.getAttribute("href")).toBe("/deals/d1");
    expect(screen.getByRole("link", { name: "Alpha Energie" }).getAttribute("href")).toMatch(/^\/organisationen\//);
  });

  it("öffnet die Herkunft einer Kennzahl mit den Rechenschritten", async () => {
    spieleApi();
    rendereApp(url);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Herkunft von IRR anzeigen" }));
    const dialog = await screen.findByRole("dialog", { name: "Herkunft von IRR" });
    const schritte = within(dialog).getAllByRole("listitem");
    expect(schritte).toHaveLength(3);
    expect(schritte[1]!.textContent).toContain("Bewertung als Endwert am 30.09.2026");
    expect(schritte[2]!.textContent).toContain("IRR der Beteiligung (XIRR, act/365)");
  });

  it("springt von den Kacheln Investiert, Rückflüsse und Bewertung zur Stelle; Multiple und IRR öffnen den Rechenweg", async () => {
    spieleApi();
    const { router } = rendereApp(url);
    const nutzer = userEvent.setup();
    const kennzahlen = within(await screen.findByRole("region", { name: "Kennzahlen" }));
    expect(aktiv()).toEqual(["Übersicht"]);

    await nutzer.click(kennzahlen.getByRole("button", { name: /^Investiert/ }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ tab: "finanzierung", unter: "transaktionen" }));
    expect(aktiv()).toEqual(["Transaktionen"]);
    expect(await screen.findByRole("region", { name: "Vorgänge" })).toBeTruthy();

    await nutzer.click(kennzahlen.getByRole("button", { name: /^Bewertung/ }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ tab: "bewertung", unter: "bewertungen" }));
    expect(aktiv()).toEqual(["Bewertungen"]);

    await nutzer.click(kennzahlen.getByRole("button", { name: /^Rückflüsse/ }));
    await waitFor(() => expect(aktiv()).toEqual(["Transaktionen"]));

    // Der Rechenweg bleibt als eigener Knopf in der Kachel erreichbar
    await nutzer.click(kennzahlen.getByRole("button", { name: "Herkunft von Bewertung anzeigen" }));
    expect(await screen.findByRole("dialog", { name: "Herkunft von Bewertung" })).toBeTruthy();
    await nutzer.keyboard("{Escape}");

    // Multiple und IRR haben keine eigene Stelle: die Kachel öffnet den Rechenweg und lässt den Bereich stehen
    await nutzer.click(kennzahlen.getByRole("button", { name: "Herkunft von Multiple anzeigen" }));
    expect(await screen.findByRole("dialog", { name: "Herkunft von Multiple" })).toBeTruthy();
    expect(aktiv()).toEqual(["Transaktionen"]);
  });

  it("reicht Stichtag und Wissensstand an die API weiter und trägt sie in den Quartalsbericht", async () => {
    const api = spieleApi();
    rendereApp(`${url}?stichtag=2026-06-30&stand=2026-07-01T10:00:00Z`);
    await screen.findByRole("heading", { level: 1, name: "Alpha Energie" });
    const anfrage = api.anfragen("GET", `/api/v1/beteiligungen/${BET_ID}`)[0]!;
    expect(anfrage.query.get("stichtag")).toBe("2026-06-30");
    expect(anfrage.query.get("stand")).toBe("2026-07-01T10:00:00Z");
    expect(screen.getByText(/Ansicht mit dem Wissensstand/)).toBeTruthy();
    const bericht = new URL(screen.getByRole("link", { name: "Quartalsbericht (PDF, Entwurf)" }).getAttribute("href")!, "http://x");
    expect(bericht.pathname).toBe(`/api/v1/investments/${BET_ID}/reports/quarterly-report`);
    expect(bericht.searchParams.get("asOf")).toBe("2026-09-30"); // der Stichtag der Antwort
    expect(bericht.searchParams.get("knowledgeDate")).toBe("2026-07-01T10:00:00Z");
    expect(bericht.searchParams.get("language")).toBe("de");
    expect(bericht.searchParams.get("format")).toBe("pdf");
    expect(screen.getByRole("link", { name: "Quartalsbericht (PDF, Entwurf)" }).hasAttribute("download")).toBe(true);
  });

  it("wechselt den Stichtag über die URL", async () => {
    const api = spieleApi();
    const { router } = rendereApp(url);
    await screen.findByRole("heading", { level: 1, name: "Alpha Energie" });
    fireEvent.change(screen.getByLabelText("Stichtag"), { target: { value: "2026-06-30" } });
    expect(router.state.location.search).toEqual({ stichtag: "2026-06-30" });
    await screen.findByRole("heading", { level: 1, name: "Alpha Energie" });
    expect(api.anfragen("GET", `/api/v1/beteiligungen/${BET_ID}`).some((a) => a.query.get("stichtag") === "2026-06-30")).toBe(true);
  });

  it("zeigt Seite, Reiter und Herkunft auf Englisch", async () => {
    localStorage.setItem("carraway.sprache", "en");
    spieleApi();
    rendereApp(url);
    const nutzer = userEvent.setup();
    expect(await screen.findByRole("navigation", { name: "Sections of the holding" })).toBeTruthy();
    for (const name of ["Overview", "Transactions", "Financing rounds", "Cap table", "Exit scenario", "Valuations", "Valuation history", "KPIs", "Documents"]) expect(eintrag(new RegExp(`^${name}`))).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Deal" })).toBeTruthy();
    expect(schmal(screen.getByRole("region", { name: "Key figures" }).textContent)).toContain("2.25x");
    expect(screen.getByRole("link", { name: "Quarterly report (PDF, draft)" })).toBeTruthy();

    await nutzer.click(eintrag(/^Financing rounds/));
    expect(await screen.findByRole("region", { name: "Record and close rounds" })).toBeTruthy();
    await nutzer.click(eintrag("Transactions"));
    const vorgaenge = within((await screen.findAllByRole("region", { name: "Transactions" })).at(-1)!).getByRole("table");
    expect(vorgaenge.textContent).toContain("Disbursement");
    expect(vorgaenge.textContent).toContain("Reversed");
    await nutzer.click(eintrag("Valuation history"));
    expect(await screen.findByRole("heading", { level: 2, name: "Valuation history" })).toBeTruthy();
    expect(screen.getByRole("img", { name: /3 valuations, from €1,500,000 on 30\/09\/2024 to €2,000,000 on 30\/09\/2026/ })).toBeTruthy();

    await nutzer.click(screen.getByRole("button", { name: "Show origin of Valuation" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("Latest valuation on 30/09/2026 (Last round)");
    expect(dialog.textContent).not.toContain("Letzte Bewertung");
    await nutzer.keyboard("{Escape}");
    await nutzer.click(screen.getByRole("button", { name: "Show origin of IRR" }));
    const irr = await screen.findByRole("dialog");
    expect(irr.textContent).toContain("Valuation as terminal value on 30/09/2026");
    expect(irr.textContent).toContain("Disbursements (1 payments, excluding cancelled pairs)");
    expect(irr.textContent).toContain("IRR of the holding (XIRR, act/365)");
    const mit = new URL(screen.getByRole("link", { name: "Quarterly report (PDF, draft)" }).getAttribute("href")!, "http://x");
    expect(mit.searchParams.get("language")).toBe("en");
  });

  it("gliedert in Gruppen; bei einem Darlehen ohne Anteile aus Runden entfallen Captable und Exit-Szenario", async () => {
    spieleApi();
    rendereApp(url);
    const nav = await screen.findByRole("navigation", { name: "Bereiche der Beteiligung" });
    const gruppe = (name: string) => within(within(nav).getByRole("list", { name })).getAllByRole("button").map((b) => b.textContent?.replace(/\d+$/, ""));
    expect(gruppe("Position")).toEqual(["Übersicht"]);
    // Der Fonds hält in der Beispielbeteiligung Anteile aus der Seed-Runde
    expect(gruppe("Kapital")).toEqual(["Finanzierungsrunden", "Instrumente", "Transaktionen", "Zinsen", "Captable", "Exit-Szenario"]);
    expect(gruppe("Wert")).toEqual(["Bewertungen", "Bewertungsverlauf", "Währung"]);
    // ESG ist ein Eintrag der Erweiterung (ee/web); der Kern allein hat nur die Kennzahlen.
    expect(gruppe("Unternehmen")).toEqual(["Kennzahlen", "Gremien"]);
    expect(gruppe("Ablage")).toEqual(["Dokumente"]);
    expect(gruppe("Stammdaten")).toEqual(["Förderung und Buchhaltung", "Zusatzfelder Beteiligung", "Zusatzfelder Instrument"]);
  });

  it("zeigt bei einem Darlehen (keine Anteile des Fonds aus Runden) weder Captable noch Exit-Szenario; deren Adresse fällt auf die Runden zurück", async () => {
    const ohneAnteile = { ...beteiligungDaten, runden: beteiligungDaten.runden.map((r) => ({ ...r, positionen: r.positionen.map((p) => ({ ...p, diesesFonds: false })) })) };
    spieleApi({ [`/api/v1/beteiligungen/${BET_ID}`]: { koerper: ohneAnteile } });
    rendereApp(`${url}?tab=finanzierung&unter=wasserfall`);
    const nav = await screen.findByRole("navigation", { name: "Bereiche der Beteiligung" });
    expect(within(nav).queryByRole("button", { name: "Captable" })).toBeNull();
    expect(within(nav).queryByRole("button", { name: "Exit-Szenario" })).toBeNull();
    expect(within(nav).getByRole("button", { name: "Finanzierungsrunden" })).toBeTruthy();
    expect(aktiv()).toEqual(["Finanzierungsrunden"]);
  });

  it("zeigt ohne Bewertung, Vorgang, Runde und Deal die Leerzustände", async () => {
    spieleApi({
      [`/api/v1/beteiligungen/${BET_ID}`]: { koerper: { ...beteiligungDaten, bewertungsverlauf: [], vorgaenge: [], runden: [], deal: null } },
    });
    rendereApp(url);
    const nutzer = userEvent.setup();
    expect(await screen.findByText("Zu dieser Beteiligung gibt es keinen Deal.")).toBeTruthy();
    await nutzer.click(eintrag(/^Finanzierungsrunden/));
    expect(await screen.findByText(/Noch keine Runde erfasst/)).toBeTruthy();
    await nutzer.click(eintrag("Transaktionen"));
    expect(await screen.findByText("Bis zu diesem Stichtag gibt es keine Vorgänge.")).toBeTruthy();
    await nutzer.click(eintrag("Bewertungsverlauf"));
    expect(await screen.findByText("Zu diesem Stichtag gibt es noch keine Bewertung.")).toBeTruthy();
  });

  it("Verzeichnis: Knöpfe mit aria-current, Standard Übersicht, nie mehrere Bereiche gleichzeitig", async () => {
    spieleApi();
    rendereApp(url);
    const nav = await screen.findByRole("navigation", { name: "Bereiche der Beteiligung" });
    expect(within(nav).getByRole("button", { name: "Übersicht" }).getAttribute("aria-current")).toBe("page");
    expect(aktiv()).toEqual(["Übersicht"]);
    expect(screen.queryByRole("tablist")).toBeNull();
    // Der Bereich ist nach dem Eintrag benannt
    expect(screen.getByRole("region", { name: "Übersicht" })).toBeTruthy();
    expect(screen.getAllByRole("region", { name: "Übersicht" })).toHaveLength(1);
    // Runden, Vorgänge und Bewertungen gehören nicht zur Übersicht.
    expect(screen.queryByRole("region", { name: "Vorgänge" })).toBeNull();
    expect(screen.queryByRole("article", { name: /Seed/ })).toBeNull();
    expect(screen.queryByRole("heading", { level: 2, name: "Bewertungen" })).toBeNull();
  });

  it("Bereiche stehen in der Adresse mit den bisherigen Kennungen; Zurück führt zum vorigen Bereich", async () => {
    spieleApi();
    const { router } = rendereApp(url);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: /^Finanzierungsrunden/ }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ tab: "finanzierung", unter: "runden" }));
    await nutzer.click(eintrag("Exit-Szenario"));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ tab: "finanzierung", unter: "wasserfall" }));
    await nutzer.click(eintrag("Dokumente"));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ tab: "dokumente" }));
    expect((router.state.location.search as Record<string, unknown>).unter).toBeUndefined();
    router.history.back();
    await waitFor(() => expect(router.state.location.search).toMatchObject({ tab: "finanzierung", unter: "wasserfall" }));
    await waitFor(() => expect(aktiv()).toEqual(["Exit-Szenario"]));
    // Der erste Eintrag ist der Standard und steht nicht in der Adresse
    await nutzer.click(eintrag("Übersicht"));
    await waitFor(() => expect(router.state.location.search).toEqual({}));
  });

  it("nimmt alte Adressen an: ?tab=finanzierung öffnet die Runden", async () => {
    spieleApi();
    rendereApp(`${url}?tab=finanzierung`);
    await screen.findByRole("navigation", { name: "Bereiche der Beteiligung" });
    expect(aktiv()).toEqual(["Finanzierungsrunden"]);
  });

  it("lädt Inhalte erst mit dem Reiter (träge)", async () => {
    const api = spieleApi();
    rendereApp(url);
    const nutzer = userEvent.setup();
    await screen.findByRole("navigation", { name: "Bereiche der Beteiligung" });
    expect(api.anfragen("GET", `/api/v1/beteiligungen/${BET_ID}/kennzahlen`)).toHaveLength(0);
    await nutzer.click(eintrag("Kennzahlen"));
    await waitFor(() => expect(api.anfragen("GET", `/api/v1/beteiligungen/${BET_ID}/kennzahlen`).length).toBeGreaterThan(0));
  });

  it("fällt bei einem unbekannten Reiter auf die Übersicht zurück", async () => {
    spieleApi();
    rendereApp(`${url}?tab=gibtesnicht`);
    await screen.findByRole("navigation", { name: "Bereiche der Beteiligung" });
    expect(aktiv()).toEqual(["Übersicht"]);
  });

  it("zeigt einen übersetzten Fehler, wenn es die Beteiligung nicht gibt", async () => {
    spieleApi({ [`/api/v1/beteiligungen/${BET_ID}`]: () => fehler(404, "investment_not_found") });
    rendereApp(url);
    expect((await screen.findByRole("alert")).textContent).toContain("Die Beteiligung wurde nicht gefunden.");
  });
});
