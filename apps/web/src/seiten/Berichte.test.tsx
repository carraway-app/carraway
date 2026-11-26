import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { BET_ID, FONDS_ID, rendereApp, spieleApi } from "../test/hilfen";

const link = (name: string | RegExp) => {
  const a = screen.getByRole("link", { name });
  return { a, url: new URL(a.getAttribute("href")!, "http://x") };
};

describe("Berichte", () => {
  it("zeigt alle Berichte als Entwurf mit Downloads je Fonds und Stichtag", async () => {
    spieleApi();
    rendereApp("/berichte?tab=downloads");
    expect(await screen.findByRole("heading", { level: 1, name: "Berichte" })).toBeTruthy();
    expect(await screen.findByText("Die Downloads sind Entwürfe.")).toBeTruthy();
    for (const titel of ["Fondsbericht", "Portfolioliste", "Quartalsbericht", "Gremienvorlage"]) {
      const karte = screen.getByRole("region", { name: titel });
      expect(within(karte).getByText("Entwurf")).toBeTruthy();
    }
    expect(screen.getByRole("region", { name: "Fondsbericht" }).textContent).toContain("Kennzahlen und Beteiligungen");
    // Der Fonds der Kopfzeile ist der der Berichte
    expect((screen.getByRole("combobox", { name: "Fonds" }) as HTMLSelectElement).value).toBe(FONDS_ID);
    expect(screen.getByRole("heading", { level: 1 }).closest("header")?.textContent).toContain("Beispielfonds I");
  });

  it("baut normale Download-Links mit Stichtag, Sprache und Format", async () => {
    spieleApi();
    rendereApp("/berichte?tab=downloads");
    await screen.findByRole("heading", { level: 1, name: "Berichte" });

    await screen.findByRole("link", { name: "PDF herunterladen: Fondsbericht" });
    const pdf = link("PDF herunterladen: Fondsbericht");
    expect(pdf.url.pathname).toBe(`/api/v1/funds/${FONDS_ID}/reports/fund-report`);
    expect(Object.fromEntries(pdf.url.searchParams)).toEqual({ format: "pdf", language: "de", asOf: "2026-09-30" });
    expect(pdf.a.hasAttribute("download")).toBe(true);
    const excel = link("Excel herunterladen: Fondsbericht");
    expect(Object.fromEntries(excel.url.searchParams)).toEqual({ format: "xlsx", language: "de", asOf: "2026-09-30" });
    const liste = link("Excel herunterladen: Portfolioliste");
    expect(liste.url.pathname).toBe(`/api/v1/funds/${FONDS_ID}/reports/portfolio-list`);
    expect(Object.fromEntries(liste.url.searchParams)).toEqual({ format: "xlsx", language: "de", asOf: "2026-09-30" });
    const quartal = link("PDF herunterladen: Quartalsbericht, Alpha Energie");
    expect(quartal.url.pathname).toBe(`/api/v1/investments/${BET_ID}/reports/quarterly-report`);
    expect(Object.fromEntries(quartal.url.searchParams)).toEqual({ format: "pdf", language: "de", asOf: "2026-09-30" });
    // Die Gremienvorlage gilt für heute und bekommt keinen Stichtag
    const gremium = link("PDF herunterladen: Gremienvorlage");
    expect(gremium.url.pathname).toBe("/api/v1/reports/committee-pack");
    expect(Object.fromEntries(gremium.url.searchParams)).toEqual({ format: "pdf", language: "de" });
    // Alle Downloads sind echte Links
    expect(screen.getAllByRole("link", { name: /herunterladen/ })).toHaveLength(5);
    expect(screen.queryAllByRole("button", { name: /herunterladen/ })).toHaveLength(0);
  });

  it("wählt die Sprache des Berichts unabhängig von der Oberfläche und folgt ihr ohne Wahl", async () => {
    spieleApi();
    const { router } = rendereApp("/berichte?tab=downloads");
    const nutzer = userEvent.setup();
    await screen.findByRole("heading", { level: 1, name: "Berichte" });

    await nutzer.click(await screen.findByRole("button", { name: "Englisch" }));
    expect(router.state.location.search).toEqual({ tab: "downloads", sprache: "en" });
    expect(document.documentElement.lang).toBe("de"); // Oberfläche bleibt Deutsch
    expect(screen.getByRole("heading", { level: 1, name: "Berichte" })).toBeTruthy();
    expect(link("PDF herunterladen: Fondsbericht").url.searchParams.get("language")).toBe("en");
    expect(link("PDF herunterladen: Gremienvorlage").url.searchParams.get("language")).toBe("en");
    expect(screen.getByRole("button", { name: "Englisch" }).getAttribute("aria-pressed")).toBe("true");

    // Zurück auf Deutsch, dann folgt die Berichtssprache der Oberfläche, wenn nichts gewählt ist
    await nutzer.click(screen.getByRole("button", { name: "Deutsch" }));
    expect(link("PDF herunterladen: Fondsbericht").url.searchParams.get("language")).toBe("de");
  });

  it("nimmt die Oberflächensprache als Vorgabe für den Bericht", async () => {
    localStorage.setItem("carraway.sprache", "en");
    spieleApi();
    rendereApp("/berichte?tab=downloads");
    expect(await screen.findByRole("heading", { level: 1, name: "Reports" })).toBeTruthy();
    expect(await screen.findByText("The downloads are drafts.")).toBeTruthy();
    const pdf = link("Download PDF: Fund report");
    expect(pdf.url.searchParams.get("language")).toBe("en");
    expect(screen.getByRole("region", { name: "Committee paper" }).textContent).toContain("Draft");
    // Berichtssprache getrennt wählbar: Deutsch im englischen Menü
    await userEvent.setup().click(screen.getByRole("button", { name: "German" }));
    expect(link("Download PDF: Fund report").url.searchParams.get("language")).toBe("de");
    expect(document.documentElement.lang).toBe("en");
  });

  it("übernimmt Stichtag und Wissensstand in alle Links", async () => {
    const api = spieleApi();
    const { router } = rendereApp("/berichte?tab=downloads");
    await screen.findByRole("heading", { level: 1, name: "Berichte" });

    fireEvent.change(screen.getByLabelText("Stichtag"), { target: { value: "2026-06-30" } });
    await userEvent.setup().click(screen.getByRole("button", { name: "Wissensstand" }));
    fireEvent.change(screen.getByLabelText("Wissensstand", { selector: "input" }), { target: { value: "2026-07-15T08:30" } });

    const erwartet = new Date("2026-07-15T08:30").toISOString().replace(".000Z", "Z");
    await screen.findByText(`Der Bericht wird beim Download erzeugt. Wissensstand: ${new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(erwartet))}.`);
    expect(router.state.location.search).toEqual({ tab: "downloads", stichtag: "2026-06-30", stand: erwartet });
    // Die Übersicht des Fonds wird mit beiden Angaben neu gefragt; die Links tragen den Stichtag der Antwort und den Wissensstand
    expect(api.anfragen("GET", `/api/v1/funds/${FONDS_ID}/uebersicht`).some((a) => a.query.get("stichtag") === "2026-06-30" && a.query.get("stand") === erwartet)).toBe(true);
    for (const name of ["PDF herunterladen: Fondsbericht", "Excel herunterladen: Portfolioliste", "PDF herunterladen: Quartalsbericht, Alpha Energie", "PDF herunterladen: Gremienvorlage"]) {
      expect(link(name).url.searchParams.get("knowledgeDate"), name).toBe(erwartet);
    }
    expect(link("PDF herunterladen: Fondsbericht").url.searchParams.get("asOf")).toBe("2026-09-30"); // Antwort des gespielten Servers
  });

  it("sagt ohne Wissensstand, dass der Bericht beim Download erzeugt wird", async () => {
    spieleApi();
    rendereApp("/berichte?tab=downloads");
    expect(await screen.findByText("Der Bericht wird beim Download erzeugt. Wissensstand: Zeitpunkt des Downloads.")).toBeTruthy();
  });

  it("wählt die Beteiligung für den Quartalsbericht", async () => {
    spieleApi();
    rendereApp("/berichte?tab=downloads");
    const nutzer = userEvent.setup();
    await screen.findByRole("heading", { level: 1, name: "Berichte" });
    const auswahl = await screen.findByLabelText<HTMLSelectElement>("Beteiligung");
    expect(within(auswahl).getAllByRole("option").map((o) => o.textContent)).toEqual(["Alpha Energie", "Beta Medizin", "Gamma Logistik"]);

    await nutzer.selectOptions(auswahl, "Beta Medizin");

    const quartal = link("PDF herunterladen: Quartalsbericht, Beta Medizin");
    expect(quartal.url.pathname).toBe("/api/v1/investments/b2/reports/quarterly-report");
  });

  it("wechselt den Fonds über die Kopfzeile, ohne die Seite zu verlassen", async () => {
    const zweiterFonds = "22222222-2222-4222-8222-222222222222";
    spieleApi({
      "/api/v1/fonds": { koerper: { daten: [
        { id: FONDS_ID, name: "Beispielfonds I", kurzname: "BF I", vintage: 2019, zeichnungskapital: "60000000.00", waehrung: "EUR" },
        { id: zweiterFonds, name: "Beispielfonds II", kurzname: "BF II", vintage: 2022, zeichnungskapital: "40000000.00", waehrung: "EUR" },
      ] } },
      [`/api/v1/funds/${zweiterFonds}/uebersicht`]: { koerper: { stichtag: "2026-03-31", snapshot: null, kennzahlen: {}, beteiligungen: [] } },
    });
    const { router } = rendereApp("/berichte?tab=downloads");
    await screen.findByRole("heading", { level: 1, name: "Berichte" });

    await userEvent.setup().selectOptions(screen.getByRole("combobox", { name: "Fonds" }), "Beispielfonds II");

    expect(router.state.location.pathname).toBe("/berichte");
    expect(router.state.location.search).toEqual({ fondsId: zweiterFonds });
    await userEvent.setup().click(await screen.findByRole("tab", { name: "Direkte Downloads" }));
    expect(await screen.findByText("Der Fonds hat zu diesem Stichtag keine Beteiligung.")).toBeTruthy();
    expect(link("PDF herunterladen: Fondsbericht").url.pathname).toBe(`/api/v1/funds/${zweiterFonds}/reports/fund-report`);
    expect(link("PDF herunterladen: Fondsbericht").url.searchParams.get("asOf")).toBe("2026-03-31");
  });

  it("zeigt ohne Fonds einen Leerzustand", async () => {
    spieleApi({ "/api/v1/fonds": { koerper: { daten: [] } } });
    rendereApp("/berichte?tab=downloads");
    expect(await within(await screen.findByRole("main")).findByText("Noch kein Fonds")).toBeTruthy();
  });
});
