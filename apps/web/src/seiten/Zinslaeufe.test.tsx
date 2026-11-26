import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { FONDS_ID, ZL_ID, abgrenzungDaten, alsRolle, fehler, rendereApp, spieleApi, zinslaufDaten } from "../test/hilfen";

const schmal = (text: string | null) => (text ?? "").replace(/\s/g, " ");
const dialog = () => within(screen.getByRole("dialog"));

describe("Zinsläufe: Liste", () => {
  it("ist über die Navigation erreichbar und listet die Läufe des Fonds", async () => {
    const api = spieleApi();
    rendereApp(`/fonds/${FONDS_ID}`);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("link", { name: "Zinsen" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Zinsen" })).toBeTruthy();
    const zeile = within(screen.getByRole("region", { name: "Zinsläufe" })).getAllByRole("row")[1]!;
    expect(zeile.textContent).toContain("30.09.2026");
    expect(zeile.textContent).toContain("Geprüft");
    expect(schmal(zeile.textContent)).toContain("16.200,62 €");
    expect(api.anfragen("GET", "/api/v1/zinslaeufe")[0]!.query.get("fondsId")).toBe(FONDS_ID);
    // Fondsauswahl der Kopfzeile bleibt auf der Seite
    expect((screen.getByRole("combobox", { name: "Fonds" }) as HTMLSelectElement).value).toBe(FONDS_ID);
  });

  it("berechnet einen Lauf und nennt Darlehen ohne Konditionen", async () => {
    const api = spieleApi({
      "POST /api/v1/zinslaeufe": { status: 201, koerper: { ...zinslaufDaten, id: "neu1", status: "berechnet", hinweise: { ohneKonditionen: ["b2"] } } },
    });
    rendereApp("/zinslaeufe");
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Neuer Zinslauf" }));
    fireEvent.change(dialog().getByLabelText("Stichtag"), { target: { value: "2026-12-31" } });
    await nutzer.click(dialog().getByRole("button", { name: "Zinslauf berechnen" }));
    expect(await dialog().findByText("Der Zinslauf ist berechnet.")).toBeTruthy();
    expect(dialog().getByText(/1 aktives Darlehen hat keine Konditionen/)).toBeTruthy();
    expect(dialog().getByRole("link", { name: "Beta Medizin" }).getAttribute("href")).toBe("/beteiligungen/b2");
    expect(dialog().getByRole("link", { name: "Zinslauf öffnen" }).getAttribute("href")).toBe("/zinslaeufe/neu1");
    expect(api.anfragen("POST", "/api/v1/zinslaeufe")[0]!.koerper).toEqual({ fondsId: FONDS_ID, stichtag: "2026-12-31" });
  });

  it("meldet einen Stichtag außerhalb am Feld", async () => {
    spieleApi({
      "POST /api/v1/zinslaeufe": { status: 400, koerper: { error: { code: "invalid_input", message: "x", fields: [{ field: "stichtag", code: "as_of_out_of_range", message: "x" }] } } },
    });
    rendereApp("/zinslaeufe");
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Neuer Zinslauf" }));
    await nutzer.click(dialog().getByRole("button", { name: "Zinslauf berechnen" }));
    expect(await dialog().findByText("Das Datum liegt außerhalb des erlaubten Zeitraums.")).toBeTruthy();
  });
});

describe("Zinslauf: Detail", () => {
  it("zeigt den Status als Schrittfolge, die Positionen mit Kapitalsegmenten und das Kontrollbericht", async () => {
    spieleApi();
    rendereApp(`/zinslaeufe/${ZL_ID}`);
    const nutzer = userEvent.setup();
    expect(await screen.findByRole("heading", { level: 1, name: /30\.09\.2026/ })).toBeTruthy();

    const schritte = within(screen.getByRole("list", { name: "Status des Zinslaufs" })).getAllByRole("listitem");
    expect(schritte).toHaveLength(4);
    expect(schritte[0]!.textContent).toContain("erledigt");
    expect(schritte[1]!.getAttribute("aria-current")).toBe("step");
    expect(schritte[2]!.textContent).toContain("offen");

    const tabelle = within(screen.getByRole("region", { name: "Positionen" }));
    const zeile = tabelle.getAllByRole("row")[1]!;
    expect(schmal(zeile.textContent)).toContain("31.12.2025 bis 31.12.2026");
    expect(schmal(zeile.textContent)).toContain("31.12.2025 bis 30.06.2026: 1.000.000,00 €");
    expect(schmal(zeile.textContent)).toContain("15.000,12 €"); // fester Teil
    expect(schmal(zeile.textContent)).toContain("1.200,50 €"); // gewinnabhängiger Teil
    expect(schmal(zeile.textContent)).toContain("16.200,62 €");
    expect(within(zeile).getByText("Kapitalisiert")).toBeTruthy();
    expect(within(zeile).getByText("Gestundet")).toBeTruthy();

    await nutzer.click(within(zeile).getByRole("button", { name: "Herkunft der Zinsen für Alpha Energie" }));
    expect(within(screen.getByRole("dialog")).getByText(/Fester Zins 31\.12\.2025 bis 30\.06\.2026 auf 1\.000\.000/)).toBeTruthy();
  });

  it("rendert das Kontrollbericht je Prüfung mit Status und betroffenen Darlehen", async () => {
    spieleApi();
    rendereApp(`/zinslaeufe/${ZL_ID}`);
    await userEvent.setup().click(await screen.findByRole("tab", { name: /Kontrollbericht/ }));
    const bericht = within(await screen.findByRole("region", { name: "Kontrollbericht" }));
    expect(await bericht.findByText("Es gibt Abweichungen. Sie werden ausgewiesen, nicht geglättet.")).toBeTruthy();
    const pruefungen = bericht.getAllByRole("listitem").filter((li) => li.className === "app-kontrolle");
    expect(pruefungen).toHaveLength(5);
    expect(pruefungen[0]!.textContent).toContain("In Ordnung");
    expect(pruefungen[0]!.textContent).toContain("Die Summe der Positionen entspricht der Summe der Buchungen.");
    expect(schmal(pruefungen[0]!.textContent)).toContain("Noch keine Buchungen (Status Geprüft), deshalb nur die Summe der Positionen: 16.200,62 €.");
    const abweichung = pruefungen[3]!;
    expect(abweichung.textContent).toContain("Abweichung");
    expect(abweichung.textContent).toContain("Ein aktives Darlehen hat keine Konditionen.");
    expect(abweichung.textContent).toContain("Darlehen: Delta Optik");
    expect(abweichung.textContent).not.toContain("b9");
  });

  it("zeigt four_eyes_violated übersetzt mit der Erklärung, in beiden Sprachen", async () => {
    const freigegeben = fehler(409, "four_eyes_violated");
    spieleApi({ [`POST /api/v1/zinslaeufe/${ZL_ID}/freigeben`]: freigegeben });
    rendereApp(`/zinslaeufe/${ZL_ID}`);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Freigeben" }));
    const hinweis = await screen.findByRole("alert");
    expect(hinweis.textContent).toContain("Dieser Schritt braucht eine zweite Person");
    // das Stepper bleibt beim Status, nichts wurde gebucht
    expect(screen.queryByRole("button", { name: "Buchen" })).toBeNull();
  });

  it("führt Prüfen, Freigeben und Buchen je nach Status; verworfene und gebuchte Läufe haben keine Aktionen", async () => {
    const api = spieleApi({ [`/api/v1/zinslaeufe/${ZL_ID}`]: { koerper: { ...zinslaufDaten, status: "berechnet", geprueftVon: null, geprueftAm: null } }, [`POST /api/v1/zinslaeufe/${ZL_ID}/pruefen`]: { koerper: {} } });
    const { unmount } = rendereApp(`/zinslaeufe/${ZL_ID}`);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Prüfen" }));
    expect(api.anfragen("POST", `/api/v1/zinslaeufe/${ZL_ID}/pruefen`)).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Verwerfen" })).toBeTruthy();
    unmount();

    spieleApi({ [`/api/v1/zinslaeufe/${ZL_ID}`]: { koerper: { ...zinslaufDaten, status: "freigegeben" } } });
    const zweite = rendereApp(`/zinslaeufe/${ZL_ID}`);
    expect(await screen.findByRole("button", { name: "Buchen" })).toBeTruthy();
    zweite.unmount();

    spieleApi({ [`/api/v1/zinslaeufe/${ZL_ID}`]: { koerper: { ...zinslaufDaten, status: "verworfen", verworfenVon: "system", verworfenAm: "2026-11-20T10:00:00.000Z" } } });
    const dritte = rendereApp(`/zinslaeufe/${ZL_ID}`);
    expect(await screen.findByText("Dieser Zinslauf ist verworfen. Es wurde nichts gebucht.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Buchen" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Verwerfen" })).toBeNull();
    for (const p of within(screen.getByRole("list", { name: "Status des Zinslaufs" })).getAllByRole("listitem")) expect(p.hasAttribute("aria-current")).toBe(false);
    dritte.unmount();

    spieleApi({ [`/api/v1/zinslaeufe/${ZL_ID}`]: { koerper: { ...zinslaufDaten, status: "gebucht" } } });
    rendereApp(`/zinslaeufe/${ZL_ID}`);
    expect(await screen.findByText("Der Zinslauf ist gebucht.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Verwerfen" })).toBeNull();
  });

  it("zeigt die Seite auf Englisch", async () => {
    spieleApi();
    localStorage.setItem("carraway.sprache", "en");
    rendereApp(`/zinslaeufe/${ZL_ID}`);
    expect(await screen.findByRole("button", { name: "Approve" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Control report/ })).toBeTruthy();
    expect(screen.getByText("Reviewed", { selector: ".cw-schritt__label" })).toBeTruthy();
    localStorage.removeItem("carraway.sprache");
  });
});

describe("Abgrenzung auf der Fondsseite", () => {
  it("zeigt aufgelaufene Zinsen je Darlehen mit Summe, Herkunft und Fehlern", async () => {
    const api = spieleApi({ [`/api/v1/fonds/${FONDS_ID}/abgrenzung`]: { koerper: abgrenzungDaten } });
    rendereApp(`/fonds?fondsId=${FONDS_ID}&tab=abgrenzung`);
    const nutzer = userEvent.setup();
    const kachel = within(await screen.findByRole("region", { name: "Abgrenzung der Zinsen" }));
    const zeile = (await kachel.findAllByRole("row"))[1]!;
    expect(schmal(zeile.textContent)).toContain("12.000,00 €");
    expect(schmal(zeile.textContent)).toContain("15.200,50 € (30.06.2026 bis 30.09.2026)");
    expect(schmal(zeile.textContent)).toContain("27.200,50 €");
    const fehlerZeile = kachel.getAllByRole("row")[2]!;
    expect(fehlerZeile.textContent).toContain("Nicht berechenbar");
    expect(kachel.getByText(/Für einige Darlehen fehlen Angaben/)).toBeTruthy();
    expect(schmal(kachel.getByText("Summe: Gesamt").nextElementSibling?.textContent ?? "")).toBe("27.200,50 €");
    expect(api.anfragen("GET", `/api/v1/fonds/${FONDS_ID}/abgrenzung`)[0]!.query.get("stichtag")).toBe("2026-09-30");

    await nutzer.click(within(zeile).getByRole("button", { name: "Herkunft der Abgrenzung für Alpha Energie" }));
    expect(within(screen.getByRole("dialog")).getByText("Abgrenzung (auf Cent, kaufmännisch)")).toBeTruthy();
  });

  it("übernimmt einen neuen Stichtag in URL und Abfrage und gibt den Wissensstand an die Beteiligung weiter", async () => {
    const pfad = `/api/v1/fonds/${FONDS_ID}/abgrenzung`;
    const api = spieleApi({ [pfad]: { koerper: abgrenzungDaten } });
    const stand = "2026-10-01T00:00:00Z";
    const { router } = rendereApp(`/fonds?fondsId=${FONDS_ID}&tab=abgrenzung&stand=${encodeURIComponent(stand)}`);
    const datum = await waitFor(() => {
      const input = screen.getByLabelText<HTMLInputElement>("Stichtag");
      expect(input.value).toBe("2026-09-30");
      return input;
    });
    fireEvent.change(datum, { target: { value: "2026-06-30" } });
    await waitFor(() => expect(router.state.location.search).toMatchObject({ fondsId: FONDS_ID, tab: "abgrenzung", stichtag: "2026-06-30", stand }));
    await waitFor(() => expect(api.anfragen("GET", pfad).some(({ query }) => query.get("stichtag") === "2026-06-30")).toBe(true));
    const link = await screen.findByRole("link", { name: "Alpha Energie" });
    const url = new URL(link.getAttribute("href")!, "https://carraway.test");
    expect(url.searchParams.get("stichtag")).toBe("2026-06-30");
    expect(url.searchParams.get("stand")).toBe(stand);
    expect(screen.getByText("Die Abgrenzung zeigt den Stichtag nach heutigem Wissensstand.")).toBeTruthy();
  });
});

describe("Zinsläufe: Bereiche je Fonds", () => {
  const jeFonds = (finanzen: "bearbeiter" | null) =>
    alsRolle("bearbeiter", {
      bereiche: ["portfolio", ...(finanzen ? ["finanzen"] : [])],
      bereicheJeFonds: { [FONDS_ID]: { portfolio: "bearbeiter", ...(finanzen ? { finanzen } : {}) } },
      stufeOhneFondsJeBereich: {},
    } as never);

  it("ohne Bereich Finanzen an diesem Fonds fehlt „Neuer Zinslauf“, mit ihm erscheint der Knopf", async () => {
    spieleApi({ "/api/v1/me": jeFonds(null) });
    const ohne = rendereApp("/zinslaeufe");
    await screen.findByRole("heading", { level: 1, name: "Zinsen" });
    expect(screen.queryByRole("button", { name: "Neuer Zinslauf" })).toBeNull();
    ohne.unmount();
    spieleApi({ "/api/v1/me": jeFonds("bearbeiter") });
    rendereApp("/zinslaeufe");
    expect(await screen.findByRole("button", { name: "Neuer Zinslauf" })).toBeTruthy();
  });
});
