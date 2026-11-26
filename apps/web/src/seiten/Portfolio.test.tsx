import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { BET_ID, bewertungZeile, FONDS_ID, fehler, fondsDaten, rendereApp, spieleApi, uebersichtDaten } from "../test/hilfen";

const url = `/fonds/${FONDS_ID}`;
const ohneGeschuetztesLeerzeichen = (text: string | null) => (text ?? "").replace(/\s/g, " ");

describe("Portfolio", () => {
  it("zeigt Fondsname, Kennzahlen und Beteiligungen aus der API", async () => {
    const fetch = spieleApi();
    rendereApp(url);

    expect(await screen.findByRole("heading", { level: 1, name: "Beispielfonds I" })).toBeTruthy();
    const kennzahlen = screen.getByRole("region", { name: "Kennzahlen" });
    for (const titel of ["NAV", "TVPI", "DPI", "RVPI", "IRR"]) expect(within(kennzahlen).getByText(titel)).toBeTruthy();
    const text = ohneGeschuetztesLeerzeichen(kennzahlen.textContent);
    expect(text).toContain("25,8 Mio. €");
    expect(text).toContain("1,11x");
    expect(text).toContain("0,49x");
    expect(text).toContain("2,3 %"); // IRR kommt als Bruch 0.0229 und wird als Prozent gezeigt

    const tabelle = screen.getAllByRole("table")[0]!;
    const zeilen = within(tabelle).getAllByRole("row");
    expect(zeilen).toHaveLength(4); // Kopf plus drei Beteiligungen
    expect(within(tabelle).getByRole("link", { name: "Alpha Energie" }).getAttribute("href")).toBe("/beteiligungen/b1");
    expect(ohneGeschuetztesLeerzeichen(zeilen[1]!.textContent)).toContain("2.000.000 €");
    expect(zeilen[1]!.textContent).toContain("Wandeldarlehen");
    expect(zeilen[1]!.textContent).toContain("2,00x");
    expect(zeilen[3]!.textContent).toContain("Insolvent");

    expect(screen.getByLabelText<HTMLInputElement>("Stichtag").value).toBe("2026-09-30");
    expect(screen.getByRole("banner", { name: "Kopfzeile" }).textContent).not.toContain("30.09.2026");
    expect(screen.getByRole("heading", { level: 2, name: "3 Beteiligungen" })).toBeTruthy();
    expect((screen.getByRole("combobox", { name: "Fonds" }) as HTMLSelectElement).value).toBe(FONDS_ID);
    // Fondsliste und Übersicht werden je einmal geholt, nicht mehrfach
    expect(fetch.mock.calls.filter(([u]) => String(u).includes("/overview"))).toHaveLength(1);
  });

  it("zeigt den Portfoliowert auch bei fehlenden Bilanzsalden", async () => {
    spieleApi({ [`/api/v1/fonds/${FONDS_ID}/uebersicht`]: { koerper: {
      ...uebersichtDaten, kennzahlen: { ...uebersichtDaten.kennzahlen, nav: { wert: null, schritte: [] } },
    } } });
    rendereApp(url);
    const k = within(await screen.findByRole("region", { name: "Kennzahlen" }));
    expect(k.getByText("Salden fehlen")).toBeTruthy();
    expect(k.getByText("Portfoliowert")).toBeTruthy();
  });

  it("zeigt NAV und Beteiligungsbeträge in der Fondswährung", async () => {
    spieleApi({ "/api/v1/fonds": { koerper: { daten: fondsDaten.daten.map((fonds) => ({ ...fonds, waehrung: "USD" })) } } });
    rendereApp(url);
    const kennzahlen = await screen.findByRole("region", { name: "Kennzahlen" });
    expect(ohneGeschuetztesLeerzeichen(kennzahlen.textContent)).toContain("25,8 Mio. $");
    const tabelle = screen.getAllByRole("table")[0]!;
    expect(ohneGeschuetztesLeerzeichen(tabelle.textContent)).toContain("2.000.000 $");
  });

  it("sortiert nach Bewertung und Multiple, Zeilen ohne Wert bleiben am Ende", async () => {
    spieleApi();
    rendereApp(url);
    const nutzer = userEvent.setup();
    await screen.findByRole("table");
    const namen = () => within(screen.getAllByRole("table")[0]!).getAllByRole("row").slice(1).map((z) => within(z).getAllByRole("cell")[0]!.textContent);

    await nutzer.click(screen.getByRole("button", { name: "Nach Bewertung sortieren" }));
    expect(namen()).toEqual(["Beta Medizin", "Alpha Energie", "Gamma Logistik"]);
    await nutzer.click(screen.getByRole("button", { name: "Nach Bewertung sortieren" }));
    expect(namen()).toEqual(["Alpha Energie", "Beta Medizin", "Gamma Logistik"]);
    await nutzer.click(screen.getByRole("button", { name: "Nach Multiple sortieren" }));
    expect(namen()).toEqual(["Alpha Energie", "Beta Medizin", "Gamma Logistik"]);
    expect(screen.getByRole("columnheader", { name: /Multiple/ }).getAttribute("aria-sort")).toBe("descending");
  });

  it("wechselt die Sprache: Texte, Zahlenformat, <html lang> und localStorage", async () => {
    spieleApi();
    rendereApp(url);
    const nutzer = userEvent.setup();
    await screen.findByRole("heading", { level: 1 });
    expect(document.documentElement.lang).toBe("de");

    await nutzer.click(screen.getByRole("button", { name: /Kontomenü/ }));
    await nutzer.click(screen.getByRole("menuitemradio", { name: "English" }));

    expect(document.documentElement.lang).toBe("en");
    expect(localStorage.getItem("carraway.sprache")).toBe("en");
    expect(screen.getByRole("region", { name: "Holdings" })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Main navigation" })).toBeTruthy();
    const text = ohneGeschuetztesLeerzeichen(screen.getByRole("region", { name: "Key figures" }).textContent);
    expect(text).toContain("€25.8m");
    expect(text).toContain("1.11x");
    expect(text).toContain("2.3%");
    expect(screen.getByLabelText<HTMLInputElement>("As at").value).toBe("2026-09-30");
    expect(within(screen.getAllByRole("table")[0]!).getAllByRole("row")[1]!.textContent).toContain("Convertible loan");
  });

  it("übernimmt die gespeicherte Sprache beim Start", async () => {
    localStorage.setItem("carraway.sprache", "en");
    spieleApi();
    rendereApp(url);
    expect(await screen.findByRole("region", { name: "Holdings" })).toBeTruthy();
    expect(document.documentElement.lang).toBe("en");
  });

  it("öffnet die Herkunft mit den Rechenschritten, schließt mit Escape und gibt den Fokus zurück", async () => {
    spieleApi();
    rendereApp(url);
    const nutzer = userEvent.setup();
    const knopf = await screen.findByRole("button", { name: "Herkunft von IRR anzeigen" });

    await nutzer.click(knopf);

    const dialog = await screen.findByRole("dialog", { name: "Herkunft von IRR" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    const schritte = within(dialog).getAllByRole("listitem");
    expect(schritte).toHaveLength(2);
    expect(schritte[0]!.textContent).toContain("NAV als Endwert am 30.09.2026");
    expect(schritte[0]!.textContent).toContain("25.796.900");
    expect(schritte[1]!.textContent).toContain("IRR (XIRR, act/365)");
    expect(schritte[1]!.textContent).toContain("0,0229");
    // Fokus im Panel
    expect(dialog.contains(document.activeElement)).toBe(true);

    await nutzer.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(knopf);
  });

  it("öffnet NAV-Zeilen mit Centbeträgen und behält Datum und Wissensstand an allen Quellen", async () => {
    const stand = "2026-10-01T10:11:12.345678Z", stichtag = "2026-09-30";
    const fetch = spieleApi({
      [`/api/v1/fonds/${FONDS_ID}/nav-einzelwerte`]: { koerper: {
        portfolio: [{ beteiligungId: BET_ID, bewertungId: "w1", datum: "2026-06-30", wert: "12.34", bezeichnung: "Beispielwert", nachweise: [{ dokumentId: "d1", dateiname: "Bewertung.pdf", seite: 3 }] }],
        salden: [{ id: "s1", laufId: "l1", gruppe: "bank", konto: "1200", bezeichnung: "Bank", saldo: "3.45" }],
      } },
      [`/api/v1/beteiligungen/${BET_ID}/bewertungen`]: { koerper: { daten: [bewertungZeile("w1", "2026-06-30", "12.34", "freigegeben")] } },
    });
    rendereApp(`${url}?stichtag=${stichtag}&stand=${stand}`);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Herkunft von NAV anzeigen" }));
    const dialog = await screen.findByRole("dialog");
    const schalter = await within(dialog).findByText("Portfoliowert", { selector: "summary span" });
    await nutzer.click(schalter);
    await nutzer.click(within(dialog).getByText(/Bankguthaben laut/, { selector: "summary span" }));
    expect(ohneGeschuetztesLeerzeichen(dialog.textContent)).toContain("12,34 €");
    expect(dialog.textContent).toContain("30.06.2026");
    for (const [name, feld, wert] of [["Beispielwert", "bewertungId", "w1"], [/Bewertung.pdf/, "seite", "3"], ["1200 Bank", "laufId", "l1"]] as const) {
      const href = within(dialog).getByRole("link", { name }).getAttribute("href")!;
      const link = new URL(href, "http://localhost");
      expect(link.searchParams.get(feld)).toBe(wert);
      expect(link.searchParams.get("stichtag")).toBe(stichtag);
      expect(link.searchParams.get("stand")).toBe(stand);
    }
    await nutzer.click(within(dialog).getByRole("link", { name: "Beispielwert" }));
    await screen.findByRole("heading", { name: "Bewertungen" });
    expect(await screen.findByRole("cell", { name: /12,34/ })).toBeTruthy();
    expect(fetch.anfragen("GET", `/api/v1/beteiligungen/${BET_ID}/bewertungen`).at(-1)?.query.get("stand")).toBe(stand);
    expect(fetch.anfragen("GET", `/api/v1/beteiligungen/${BET_ID}/bewertungen`).at(-1)?.query.get("bewertungId")).toBe("w1");
    expect(fetch.mock.calls.some(([u]) => String(u).includes("nav-components") && new URL(String(u)).searchParams.get("knowledgeDate") === stand)).toBe(true);
  });

  it("hält den Tabulator im Dialog", async () => {
    spieleApi();
    rendereApp(url);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Herkunft von NAV anzeigen" }));
    const dialog = await screen.findByRole("dialog");
    const schliessen = within(dialog).getByRole("button", { name: "Schließen" });
    expect(document.activeElement).toBe(schliessen);
    await nutzer.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
    await nutzer.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("zeigt die Herkunft auf Englisch mit übersetzten Rechenschritten", async () => {
    localStorage.setItem("carraway.sprache", "en");
    spieleApi();
    rendereApp(url);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Show origin of NAV" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("Fund NAV");
    expect(dialog.textContent).toContain("25,796,900");
  });

  it("legt den Stichtag in die URL und fragt die Übersicht dafür ab", async () => {
    const fetch = spieleApi();
    const { router } = rendereApp(url);
    await screen.findByRole("heading", { level: 1 });
    const nutzer = userEvent.setup();
    const feld = screen.getByLabelText("Stichtag");
    await nutzer.clear(feld);
    await nutzer.type(feld, "2026-06-30");
    expect(router.state.location.search).toEqual({ stichtag: "2026-06-30" });
    expect(fetch.mock.calls.some(([u]) => String(u).includes("asOf=2026-06-30"))).toBe(true);
  });

  it("zeigt einen übersetzten Fehler zum API-Code und fällt bei unbekannten Codes zurück", async () => {
    spieleApi({ [`/api/v1/fonds/${FONDS_ID}/uebersicht`]: { status: 404, koerper: { error: { code: "fund_not_found", message: "x" } } } });
    rendereApp(url);
    expect((await screen.findByRole("alert")).textContent).toContain("Der Fonds wurde nicht gefunden.");
  });

  it("verwendet für unbekannte Fehlercodes die allgemeine Meldung", async () => {
    spieleApi({ [`/api/v1/fonds/${FONDS_ID}/uebersicht`]: { status: 500, koerper: { error: { code: "NEUER_CODE", message: "x" } } } });
    rendereApp(url);
    expect((await screen.findByRole("alert")).textContent).toContain("Es ist ein unbekannter Fehler aufgetreten.");
  });

  it("leitet die Startseite auf den ersten Fonds um", async () => {
    spieleApi();
    const { router } = rendereApp("/");
    expect(await screen.findByRole("heading", { level: 1, name: "Beispielfonds I" })).toBeTruthy();
    expect(router.state.location.pathname).toBe(url);
  });
});

describe("Snapshot und Wissensstand", () => {
  const uebersichtUrl = `/api/v1/fonds/${FONDS_ID}/uebersicht`;
  const veraltet = { ...uebersichtDaten, snapshot: { berechnetAm: "2026-11-20T09:00:00.000Z", veraltet: true } };
  const frisch = { ...uebersichtDaten, snapshot: { berechnetAm: "2026-11-20T09:05:00.000Z", veraltet: false } };

  it("zeigt, wann der Snapshot berechnet wurde, und bietet nichts an, solange er aktuell ist", async () => {
    spieleApi();
    rendereApp(url);
    expect((await screen.findByText(/Berechnet am 20\.11\.2026, \d{2}:\d{2}\./)).textContent).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Neu berechnen" })).toBeNull();
  });

  it("meldet veraltete Zahlen, fordert die Neuberechnung an und lädt danach neu", async () => {
    let angefordert = false;
    const api = spieleApi({
      [uebersichtUrl]: () => ({ koerper: angefordert ? frisch : veraltet }),
      [`POST /api/v1/fonds/${FONDS_ID}/neuberechnen`]: () => {
        angefordert = true;
        return { status: 202, koerper: { angefordert: true, fondsId: FONDS_ID, stichtag: "2026-09-30" } };
      },
    });
    rendereApp(url);
    const nutzer = userEvent.setup();
    const hinweis = await screen.findByText("Die gespeicherten Zahlen sind veraltet.");
    expect(hinweis.closest("[role=status]")?.textContent).toContain("Seit der Berechnung wurden neue Daten erfasst.");

    await nutzer.click(screen.getByRole("button", { name: "Neu berechnen" }));

    // Stichtag des gezeigten Stands geht mit; während der Worker rechnet, ist der Knopf gesperrt
    const post = api.anfragen("POST", `/api/v1/fonds/${FONDS_ID}/neuberechnen`);
    expect(post).toHaveLength(1);
    expect(post[0]!.query.get("stichtag")).toBe("2026-09-30");
    expect((await screen.findByRole("button", { name: "Wird neu berechnet" })) as HTMLButtonElement).toHaveProperty("disabled", true);
    // Die Seite fragt nach, bis sich `berechnetAm` ändert
    await waitFor(() => expect(screen.queryByText("Die gespeicherten Zahlen sind veraltet.")).toBeNull(), { timeout: 4000 });
    expect(screen.getByText(/Berechnet am 20\.11\.2026, \d{2}:\d{2}\./)).toBeTruthy();
    expect(api.anfragen("GET", uebersichtUrl).length).toBeGreaterThanOrEqual(2);
    // danach wird nicht weiter nachgefragt
    const anzahl = api.anfragen("GET", uebersichtUrl).length;
    await new Promise((r) => setTimeout(r, 1500));
    expect(api.anfragen("GET", uebersichtUrl)).toHaveLength(anzahl);
  });

  it("übersetzt die Meldung zu einem Stichtag ohne Snapshot", async () => {
    spieleApi({
      [uebersichtUrl]: { koerper: veraltet },
      [`POST /api/v1/fonds/${FONDS_ID}/neuberechnen`]: () =>
        fehler(400, "invalid_input", { felder: [{ feld: "stichtag", code: "as_of_not_stored", meldung: "x" }] }),
    });
    rendereApp(url);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Neu berechnen" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Für diesen Stichtag wird kein Snapshot gespeichert");
  });

  it("zeigt auf Englisch Hinweis und Knopf", async () => {
    localStorage.setItem("carraway.sprache", "en");
    spieleApi({ [uebersichtUrl]: { koerper: veraltet } });
    rendereApp(url);
    expect(await screen.findByText("The stored figures are out of date.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Recalculate" })).toBeTruthy();
    expect(screen.getByText(/Calculated on 20\/11\/2026, \d{2}:\d{2}\./)).toBeTruthy();
  });

  it("sagt bei einem Stichtag ohne gespeicherten Snapshot, dass live gerechnet wird", async () => {
    spieleApi({ [uebersichtUrl]: { koerper: { ...uebersichtDaten, snapshot: null } } });
    rendereApp(url);
    expect(await screen.findByText("Live gerechnet, für diesen Stichtag gibt es keinen gespeicherten Snapshot.")).toBeTruthy();
  });

  it("reicht den Wissensstand als UTC-Zeitpunkt an die API weiter und erklärt ihn", async () => {
    const api = spieleApi();
    const { router } = rendereApp(url);
    await screen.findByRole("heading", { level: 1 });
    // Der Wissensstand steht hinter einem kleinen Knopf in der Werkzeugleiste des Kopfs, die Erklärung in der Fläche.
    expect(screen.queryByLabelText("Wissensstand", { selector: "input" })).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "Wissensstand" }));
    expect(screen.getByText(/Zeigt den Stichtag so, wie er zu diesem Zeitpunkt bekannt war/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Wissensstand", { selector: "input" }), { target: { value: "2026-06-30T12:00" } });

    // Die Eingabe ist Ortszeit; URL und API tragen denselben Zeitpunkt in UTC
    const erwartet = new Date("2026-06-30T12:00").toISOString().replace(".000Z", "Z");
    expect(router.state.location.search).toEqual({ stand: erwartet });
    await waitFor(() => expect(api.anfragen("GET", uebersichtUrl).some((a) => a.query.get("stand") === erwartet)).toBe(true));
    expect(await screen.findByText(/Live gerechnet mit dem Wissensstand/)).toBeTruthy();
    // Beteiligungen führen mit demselben Wissensstand weiter
    const link = screen.getByRole("link", { name: "Alpha Energie" });
    expect(new URL(link.getAttribute("href")!, "http://x").searchParams.get("stand")).toBe(erwartet);

    await userEvent.setup().click(screen.getByRole("button", { name: "Aktueller Stand" }));
    expect(router.state.location.search).toEqual({});
  });

  it("liest Wissensstand und Stichtag aus der URL, auch wenn das Plus im Versatz als Leerzeichen ankommt", async () => {
    const api = spieleApi();
    rendereApp(`${url}?stichtag=2026-06-30&stand=2026-06-30T12:00:00 02:00`);
    await screen.findByRole("heading", { level: 1 });
    const anfrage = api.anfragen("GET", uebersichtUrl)[0]!;
    expect(anfrage.query.get("stichtag")).toBe("2026-06-30");
    expect(anfrage.query.get("stand")).toBe("2026-06-30T10:00:00Z");
    expect(anfrage.query.get("stand")).not.toContain(" ");
  });

  it("verwirft einen ungültigen Wissensstand in der URL", async () => {
    const api = spieleApi();
    rendereApp(`${url}?stand=gestern`);
    await screen.findByRole("heading", { level: 1 });
    expect(api.anfragen("GET", uebersichtUrl)[0]!.query.has("stand")).toBe(false);
  });
});
