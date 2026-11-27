import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it } from "vitest";
import { alsRolle, BET_ID, FONDS_ID, uebersichtDaten, ORG_A, ORG_B, fehler, fondsDaten, hauptInstrument, instrumentDaten, instrumentZeile, rendereApp, spieleApi, trancheZeile, waehleFonds, zeilenAktion } from "../test/hilfen";
import { de } from "../i18n/de";
import { en } from "../i18n/en";

/** jsdom hat kein Layout: Das Scroll-Fenster des Journals bekommt eine feste Größe, damit der Virtualisierer Zeilen rendert. */
beforeAll(() => {
  const groesse = (name: "offsetHeight" | "offsetWidth" | "clientHeight" | "clientWidth", wert: number) =>
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains("app-journal__fenster") ? wert : 0;
      },
    });
  const original = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    return this.classList.contains("app-journal__fenster") ? ({ width: 1100, height: 560, top: 0, left: 0, right: 1100, bottom: 560, x: 0, y: 0, toJSON: () => ({}) } as DOMRect) : original.call(this);
  };
  groesse("offsetHeight", 560);
  groesse("offsetWidth", 1100);
  groesse("clientHeight", 560);
  groesse("clientWidth", 1100);
  if (!("ResizeObserver" in window)) {
    class Beobachter {
      constructor(private readonly rueckruf: ResizeObserverCallback) {}
      observe(ziel: Element) {
        this.rueckruf([{ target: ziel, contentRect: { width: 1100, height: 560 } } as ResizeObserverEntry], this as unknown as ResizeObserver);
      }
      unobserve() {}
      disconnect() {}
    }
    Object.assign(window, { ResizeObserver: Beobachter });
  }
});

const dialog = () => within(screen.getByRole("dialog"));
const RUNDEN = `/api/v1/organisationen/${ORG_A}/finanzierungsrunden`;
const JOURNAL = `/api/v1/fonds/${FONDS_ID}/journal`;
const BUCHUNGEN = `POST /api/v1/funds/${FONDS_ID}/postings`;
const schmal = (text: string | null) => (text ?? "").replace(/\s/g, " ");

const pruefungGruen = { volumen: "2000000.00", postMoneyErwartet: "10000000.00", anteileErwartet: "1000000", anteileVergeben: "200000", abweichungen: [] as unknown[], schliessbar: true };
const position = (id: string, art: "fonds" | "organisation", name: string, extra: Record<string, unknown> = {}) => ({
  id,
  investor: { art, id: art === "fonds" ? FONDS_ID : ORG_B, name },
  betrag: art === "fonds" ? "1500000.00" : "500000.00",
  anteile: art === "fonds" ? "150000" : "50000",
  rolle: art === "fonds" ? "lead" : "co",
  anteilsklasse: null,
  instrumentId: null as string | null,
  beteiligungId: null as string | null,
  gezahlt: art === "fonds" ? null : "100000.00",
  offen: art === "fonds" ? null : "400000.00",
  buchungen: [] as unknown[],
  ...extra,
});
const runde = (id: string, status: "entwurf" | "abgeschlossen", extra: Record<string, unknown> = {}) => ({
  id,
  organisationId: ORG_A,
  bezeichnung: id === "r1" ? "Serie A" : "Serie B",
  datum: "2026-03-15",
  preMoney: "8000000.00",
  postMoney: "10000000.00",
  preisJeAnteil: "10.0000",
  anteileGesamtNach: "1000000",
  status,
  abgeschlossenAm: status === "abgeschlossen" ? "2026-03-16T08:00:00.000Z" : null,
  abgeschlossenVon: null,
  wiedergeoeffnetAm: null,
  wiedergeoeffnetVon: null,
  wiedereroeffnungGrund: null,
  positionen: [position(`${id}-p1`, "fonds", "Beispielfonds I"), position(`${id}-p2`, "organisation", "Beta Medizin")],
  pruefung: pruefungGruen,
  ...extra,
});

const MIT_RUNDEN = (daten: unknown[]) => ({ [RUNDEN]: { koerper: { daten } } });

describe("Finanzierungsrunden an der Beteiligung", () => {
  it("zeigt Runden mit Status, Positionen, Zahlungsstand und die Prüfung eines Entwurfs; Englisch übersetzt alles", async () => {
    spieleApi(
      MIT_RUNDEN([
        runde("r2", "entwurf", { pruefung: { ...pruefungGruen, abweichungen: [{ code: "POST_MONEY_ABWEICHEND", schwere: "fehler", werte: { postMoney: "9000000.00", erwartet: "10000000.00", volumen: "2000000.00" } }], schliessbar: false } }),
        runde("r1", "abgeschlossen"),
      ]),
    );
    rendereApp(`/investments/${BET_ID}?tab=financing`);
    const nutzer = userEvent.setup();
    const abschnitt = within(await screen.findByRole("region", { name: de.finanzierungsrunden.titel }));
    // Liste links: beide Runden mit Status; Standard ist die neueste abgeschlossene
    const liste = within(await abschnitt.findByRole("tablist", { name: "Runden" }));
    expect(liste.getAllByRole("tab")).toHaveLength(2);
    expect(liste.getByRole("tab", { name: /Serie B/ }).textContent).toContain("Entwurf");
    expect(liste.getByRole("tab", { name: /Serie A/ }).textContent).toContain("Abgeschlossen");
    expect(liste.getByRole("tab", { name: /Serie A/ }).getAttribute("aria-selected")).toBe("true");
    expect(abschnitt.getByRole("tab", { name: /Serie A/ }).textContent).toContain("Abgeschlossen");
    const tabelle = within(abschnitt.getByRole("region", { name: /^Positionen der Runde Serie A, / }));
    expect(tabelle.getByText("Beta Medizin")).toBeTruthy();
    expect(schmal(tabelle.getByText(/400\.000,00/).textContent)).toContain("400.000,00 €");
    expect(schmal(abschnitt.getByRole("article", { name: /Serie A/ }).textContent)).toContain("8.000.000,00 €");
    expect(abschnitt.getByRole("button", { name: "Wieder öffnen" })).toBeTruthy();
    expect(abschnitt.queryByRole("button", { name: "Runde abschließen" })).toBeNull();
    expect(abschnitt.queryByText(/Post-Money ist 9\.000\.000,00/)).toBeNull(); // die Prüfung gibt es nur beim Entwurf
    // Der Entwurf zeigt Prüfung und Abschließen; es steht immer nur eine Runde in den Details
    await nutzer.click(liste.getByRole("tab", { name: /Serie B/ }));
    expect((await abschnitt.findByRole("tab", { name: /Serie B/ })).textContent).toContain("Entwurf");
    expect(abschnitt.getAllByRole("article")).toHaveLength(1);
    expect(schmal(abschnitt.getByText(/Post-Money ist 9\.000\.000,00/).textContent)).toContain("ergibt 10.000.000,00");
    expect(abschnitt.getByRole("button", { name: "Runde abschließen" })).toBeTruthy();
    expect(abschnitt.queryByRole("button", { name: "Wieder öffnen" })).toBeNull();
  });

  it("Englisch: Überschrift, Status und Prüfsatz", async () => {
    localStorage.setItem("carraway.sprache", "en");
    spieleApi(MIT_RUNDEN([runde("r2", "entwurf", { pruefung: { ...pruefungGruen, abweichungen: [{ code: "KEINE_POSITIONEN", schwere: "fehler", werte: {} }], schliessbar: false } })]));
    rendereApp(`/investments/${BET_ID}?tab=financing`);
    const abschnitt = within(await screen.findByRole("region", { name: en.finanzierungsrunden.titel }));
    expect((await abschnitt.findByRole("tab", { name: /Serie B/ })).textContent).toContain("Draft");
    expect(abschnitt.getByText("The round has no positions yet.")).toBeTruthy();
  });

  it("Betrachter sehen keine Schaltflächen zum Anlegen, Abschließen oder Wiedereröffnen; Bearbeiter kein Wiedereröffnen", async () => {
    spieleApi({ "/api/v1/me": alsRolle("betrachter"), ...MIT_RUNDEN([runde("r2", "entwurf"), runde("r1", "abgeschlossen")]) });
    const erste = rendereApp(`/investments/${BET_ID}?tab=financing`);
    const a1 = within(await screen.findByRole("region", { name: de.finanzierungsrunden.titel }));
    await a1.findByRole("tab", { name: /Serie A/ });
    expect(a1.queryByRole("button", { name: "Neue Runde" })).toBeNull();
    expect(a1.queryByRole("button", { name: "Runde abschließen" })).toBeNull();
    expect(a1.queryByRole("button", { name: "Wieder öffnen" })).toBeNull();
    erste.unmount();
    spieleApi({ "/api/v1/me": alsRolle("bearbeiter"), ...MIT_RUNDEN([runde("r2", "entwurf"), runde("r1", "abgeschlossen")]) });
    rendereApp(`/investments/${BET_ID}?tab=financing`);
    const a2 = within(await screen.findByRole("region", { name: de.finanzierungsrunden.titel }));
    await a2.findByRole("tab", { name: /Serie A/ });
    expect(a2.getByRole("button", { name: "Neue Runde" })).toBeTruthy();
    expect(a2.queryByRole("button", { name: "Wieder öffnen" })).toBeNull();
    await userEvent.setup().click(a2.getByRole("tab", { name: /Serie B/ }));
    expect(await a2.findByRole("button", { name: "Runde abschließen" })).toBeTruthy();
  });

  it("neue Runde: Hinweise kommen live von der Vorschau der API, Anlegen sendet Positionen mit Fonds und Organisation", async () => {
    const api = spieleApi({
      ...MIT_RUNDEN([]),
      [`POST ${RUNDEN}/vorschau`]: {
        koerper: { postMoney: "10000000.00", anteileGesamtNach: "1000000", pruefung: { ...pruefungGruen, abweichungen: [{ code: "POSITION_PREIS_ABWEICHEND", schwere: "hinweis", werte: { betrag: "1500000.00", anteile: "1", erwartet: "150000" } }] } },
      },
      [`POST ${RUNDEN}`]: { status: 201, koerper: runde("neu", "entwurf") },
    });
    rendereApp(`/investments/${BET_ID}?tab=financing`);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Neue Runde" }));
    const d = dialog();
    await nutzer.type(d.getByLabelText("Bezeichnung"), "Serie C");
    await nutzer.type(d.getByLabelText("Pre-Money"), "8000000");
    await nutzer.type(d.getByLabelText("Preis je Anteil"), "10");
    // Investor 1: der Fonds
    await nutzer.type(d.getByLabelText("Zusage"), "1500000");
    await nutzer.type(d.getByLabelText("Anteile"), "150000");
    await nutzer.click(d.getByRole("button", { name: "Investor hinzufügen" }));
    expect(d.getByRole("region", { name: "Investoren der neuen Runde" })).toBeTruthy();
    // Live-Hinweise aus der Vorschau
    expect(await d.findByText(/Abgeleitet: Post-Money 10\.000\.000,00/, undefined, { timeout: 3000 })).toBeTruthy();
    expect(d.getByText(/passt nicht zum Preis je Anteil/)).toBeTruthy();
    // Entfernen und wieder hinzufügen
    await nutzer.click(d.getByRole("button", { name: "Beispielfonds I entfernen" }));
    expect(d.getByText("Noch kein Investor in der Runde.")).toBeTruthy();
    await nutzer.type(d.getByLabelText("Zusage"), "1500000");
    await nutzer.type(d.getByLabelText("Anteile"), "150000");
    await nutzer.click(d.getByRole("button", { name: "Investor hinzufügen" }));
    await nutzer.click(d.getByRole("button", { name: "Als Entwurf anlegen" }));
    await waitFor(() => expect(api.anfragen("POST", `${RUNDEN}`)).toHaveLength(1));
    expect(api.anfragen("POST", RUNDEN)[0]!.koerper).toMatchObject({
      bezeichnung: "Serie C",
      preMoney: "8000000",
      preisJeAnteil: "10",
      positionen: [{ fondsId: FONDS_ID, betrag: "1500000", anteile: "150000", rolle: "co" }],
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("Dublette: die Vorschau warnt vor einer Runde mit gleichem Datum und Preis, das Anlegen bleibt möglich", async () => {
    const dublette = { id: "r-alt", bezeichnung: "Serie B", datum: "2026-03-15", gleichesDatum: true, gleicherPreis: true };
    const api = spieleApi({
      ...MIT_RUNDEN([]),
      [`POST ${RUNDEN}/vorschau`]: { koerper: { postMoney: "10000000.00", anteileGesamtNach: "1000000", pruefung: pruefungGruen, dubletten: [dublette, { ...dublette, id: "r-e", bezeichnung: "Entwurf", gleichesDatum: false }] } },
      [`POST ${RUNDEN}`]: { status: 201, koerper: { ...runde("neu", "entwurf"), dubletten: [dublette] } },
    });
    rendereApp(`/investments/${BET_ID}?tab=financing`);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Neue Runde" }));
    const d = dialog();
    await nutzer.type(d.getByLabelText("Bezeichnung"), "Serie C");
    await nutzer.type(d.getByLabelText("Pre-Money"), "8000000");
    await nutzer.type(d.getByLabelText("Preis je Anteil"), "10");
    await nutzer.type(d.getByLabelText("Zusage"), "1500000");
    await nutzer.type(d.getByLabelText("Anteile"), "150000");
    await nutzer.click(d.getByRole("button", { name: "Investor hinzufügen" }));
    const hinweis = await d.findByText(/dasselbe Datum und denselben Preis je Anteil/, undefined, { timeout: 3000 });
    expect(hinweis.textContent).toContain("Serie B");
    expect(d.getByText(/Die Runde „Entwurf“ .* hat denselben Preis je Anteil\./)).toBeTruthy();
    expect(d.getByText("Mögliche Dublette")).toBeTruthy();
    // Nur ein Hinweis: Anlegen ist nicht gesperrt.
    await nutzer.click(d.getByRole("button", { name: "Als Entwurf anlegen" }));
    await waitFor(() => expect(api.anfragen("POST", RUNDEN)).toHaveLength(1));
  });

  it("neuer Investor: Dublettenhinweis nach 409, Anlegen erst nach Bestätigung, danach entsteht sein erstes Vehikel und ist gewählt", async () => {
    const kandidat = { id: ORG_B, name: "Beta Medizin", art: "unternehmen", ort: "Berlin", aehnlichkeit: 0.9 };
    let versuche = 0;
    const api = spieleApi({
      ...MIT_RUNDEN([]),
      "POST /api/v1/organisationen": (anfrage) => {
        versuche++;
        return (anfrage.koerper as { dubletteBestaetigt?: boolean } | undefined)?.dubletteBestaetigt
          ? { status: 201, koerper: { id: "neu-org", name: "Beta Medizin GmbH", art: "investor" } }
          : fehler(409, "possible_duplicate", { kandidaten: [kandidat] });
      },
      "POST /api/v1/organisationen/neu-org/vehikel": { status: 201, koerper: { id: "neu-v", investorId: "neu-org", name: "Beta Seedfonds I", art: "fonds", auflagejahr: null, status: "aktiv", standard: true } },
    });
    rendereApp(`/investments/${BET_ID}?tab=financing`);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Neue Runde" }));
    const d = dialog();
    await nutzer.click(d.getByRole("button", { name: "Neuer Investor" }));
    await nutzer.type(d.getByLabelText("Name des neuen Investors"), "Beta Medizin GmbH");
    await nutzer.type(d.getByLabelText("Name des Vehikels (leer = wie der Investor)"), "Beta Seedfonds I");
    await nutzer.click(d.getByRole("button", { name: "Investor anlegen" }));
    expect(await d.findByRole("button", { name: de.dubletten.trotzdemAnlegen })).toBeTruthy();
    expect(versuche).toBe(1);
    await nutzer.click(d.getByRole("button", { name: de.dubletten.trotzdemAnlegen }));
    await waitFor(() => expect(versuche).toBe(2));
    expect(api.anfragen("POST", "/api/v1/organisationen")[1]!.koerper).toMatchObject({ name: "Beta Medizin GmbH", art: "investor", dubletteBestaetigt: true });
    await waitFor(() => expect(api.anfragen("POST", "/api/v1/organisationen/neu-org/vehikel")).toHaveLength(1));
    expect(api.anfragen("POST", "/api/v1/organisationen/neu-org/vehikel")[0]!.koerper).toEqual({ name: "Beta Seedfonds I" });
    // Danach ist das neue Vehikel mit seinem Investor gewählt
    expect(await d.findByText(/Beta Seedfonds I · Beta Medizin GmbH/)).toBeTruthy();
  });

  it("Co-Investor über die Vehikel-Suche: Anzeige „Vehikel · Investor“, gesendet wird vehikelId", async () => {
    const api = spieleApi({
      ...MIT_RUNDEN([]),
      [`POST ${RUNDEN}/vorschau`]: { koerper: { postMoney: "10000000.00", anteileGesamtNach: "1000000", pruefung: pruefungGruen, dubletten: [] } },
      [`POST ${RUNDEN}`]: { status: 201, koerper: runde("neu", "entwurf") },
      "/api/v1/vehikel": (anfrage) => ({
        koerper: { daten: anfrage.query.get("suche") === "beta" ? [] : [{ id: "v-seed", name: "Musterkapital Seedfonds I", art: "fonds", auflagejahr: 2018, status: "aktiv", standard: true, investor: { id: ORG_B, name: "Musterkapital GmbH" } }] },
      }),
      "/api/v1/suche": { koerper: { organisationen: [{ id: "org-ohne", name: "Beta Ohne Vehikel", art: "investor", ort: null }], personen: [], deals: [], beteiligungen: [], dokumente: [] } },
    });
    rendereApp(`/investments/${BET_ID}?tab=financing`);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Neue Runde" }));
    const d = dialog();
    await nutzer.type(d.getByLabelText("Bezeichnung"), "Serie C");
    await nutzer.type(d.getByLabelText("Pre-Money"), "8000000");
    await nutzer.type(d.getByLabelText("Preis je Anteil"), "10");
    await nutzer.click(d.getByRole("button", { name: "Vehikel" }));
    await nutzer.type(d.getByLabelText("Vehikel oder Investor suchen"), "muster");
    await nutzer.click(await d.findByRole("button", { name: /Musterkapital Seedfonds I · Musterkapital GmbH/ }));
    await nutzer.type(d.getByLabelText("Zusage"), "500000");
    await nutzer.type(d.getByLabelText("Anteile"), "50000");
    await nutzer.click(d.getByRole("button", { name: "Investor hinzufügen" }));
    const investoren = within(d.getByRole("region", { name: "Investoren der neuen Runde" }));
    expect(investoren.getByText("Musterkapital Seedfonds I · Musterkapital GmbH")).toBeTruthy();
    // Eine Organisation ohne Vehikel steht ebenfalls zur Wahl und geht als organisationId (Standard-Vehikel der API)
    await nutzer.clear(d.getByLabelText("Vehikel oder Investor suchen"));
    await nutzer.type(d.getByLabelText("Vehikel oder Investor suchen"), "beta");
    await nutzer.click(await d.findByRole("button", { name: /Beta Ohne Vehikel/ }));
    await nutzer.type(d.getByLabelText("Zusage"), "100000");
    await nutzer.type(d.getByLabelText("Anteile"), "10000");
    await nutzer.click(d.getByRole("button", { name: "Investor hinzufügen" }));
    await nutzer.click(d.getByRole("button", { name: "Als Entwurf anlegen" }));
    await waitFor(() => expect(api.anfragen("POST", RUNDEN)).toHaveLength(1));
    expect(api.anfragen("POST", RUNDEN)[0]!.koerper).toMatchObject({
      positionen: [
        { vehikelId: "v-seed", betrag: "500000", anteile: "50000", rolle: "co" },
        { organisationId: "org-ohne", betrag: "100000", anteile: "10000", rolle: "co" },
      ],
    });
  });

  it("Runde abschließen: Zusage und Auszahlung des eigenen Fonds werden mitgesendet; die Abweichungen der API werden gezeigt", async () => {
    let versuch = 0;
    const api = spieleApi({
      ...MIT_RUNDEN([runde("r2", "entwurf")]),
      "POST /api/v1/finanzierungsrunden/r2/abschliessen": (anfrage) => {
        versuch++;
        return versuch === 1
          ? fehler(409, "round_inconsistent", { abweichungen: [{ code: "ANTEILE_UEBER_GESAMT", schwere: "fehler", werte: { anteileVergeben: "200000", anteileGesamtNach: "100000" } }] })
          : { koerper: { runde: runde("r2", "abgeschlossen"), buchungen: [{ positionId: "r2-p1", fondsId: FONDS_ID, beteiligungId: BET_ID, beteiligungAngelegt: false, vorgangIds: ["v1", "v2"] }], anfrage: anfrage.koerper } };
      },
    });
    rendereApp(`/investments/${BET_ID}?tab=financing`);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Runde abschließen" }));
    const d = dialog();
    // Die Zusage ist vorbelegt, Art und Bezeichnung des Instruments haben Vorgaben
    expect((d.getByRole("checkbox", { name: /Zusage über 1\.500\.000,00/ }) as HTMLInputElement).checked).toBe(true);
    expect((d.getByLabelText("Art des Instruments") as HTMLSelectElement).value).toBe("offene_beteiligung");
    expect((d.getByLabelText("Bezeichnung des Instruments") as HTMLInputElement).value).toBe("Serie B-Anteile");
    await nutzer.click(d.getByRole("button", { name: "Auszahlung hinzufügen" }));
    await nutzer.type(d.getByLabelText("Betrag"), "500000");
    await nutzer.click(d.getByRole("button", { name: "Runde abschließen" }));
    expect(await d.findByText(/Die Positionen vergeben 200\.000 Anteile, nach der Runde gibt es nur 100\.000/)).toBeTruthy();
    await nutzer.click(d.getByRole("button", { name: "Runde abschließen" }));
    expect(await d.findByText("Die Runde ist abgeschlossen. Gebuchte Vorgänge: 2.")).toBeTruthy();
    expect(api.anfragen("POST", "/api/v1/finanzierungsrunden/r2/abschliessen")[1]!.koerper).toMatchObject({
      fondsBuchungen: [{ positionId: "r2-p1", zusage: true, zusageValuta: "2026-03-15", art: "offene_beteiligung", bezeichnung: "Serie B-Anteile", auszahlungen: [{ betrag: "500000" }] }],
    });
  });

  it("Runde abschließen: Art, Bezeichnung und Verzicht auf die Zusage gehen mit; die Fehlermeldung zur Position wird erklärt", async () => {
    let versuch = 0;
    const api = spieleApi({
      ...MIT_RUNDEN([runde("r2", "entwurf")]),
      "POST /api/v1/finanzierungsrunden/r2/abschliessen": () => {
        versuch++;
        return versuch === 1 ? fehler(409, "round_commitment_exists", {}) : { koerper: { runde: runde("r2", "abgeschlossen"), buchungen: [{ positionId: "r2-p1", fondsId: FONDS_ID, beteiligungId: BET_ID, beteiligungAngelegt: false, instrumentId: "i9", instrumentAngelegt: true, trancheId: null, vorgangIds: [] }] } };
      },
    });
    rendereApp(`/investments/${BET_ID}?tab=financing`);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Runde abschließen" }));
    const d = dialog();
    await nutzer.selectOptions(d.getByLabelText("Art des Instruments"), "wandeldarlehen");
    // Der Vorschlag folgt der Art, solange die Bezeichnung nicht von Hand geändert wurde
    expect((d.getByLabelText("Bezeichnung des Instruments") as HTMLInputElement).value).toBe("Wandeldarlehen Serie B");
    await nutzer.clear(d.getByLabelText("Bezeichnung des Instruments"));
    await nutzer.type(d.getByLabelText("Bezeichnung des Instruments"), "Brückendarlehen");
    await nutzer.click(d.getByRole("checkbox", { name: /Zusage über/ }));
    await nutzer.click(d.getByRole("button", { name: "Runde abschließen" }));
    expect(await d.findByText(/Zusage des Fonds aus dieser Runde/)).toBeTruthy();
    await nutzer.click(d.getByRole("button", { name: "Runde abschließen" }));
    await d.findByText(/Die Runde ist abgeschlossen/);
    expect(api.anfragen("POST", "/api/v1/finanzierungsrunden/r2/abschliessen")[1]!.koerper).toMatchObject({
      fondsBuchungen: [{ positionId: "r2-p1", zusage: false, art: "wandeldarlehen", bezeichnung: "Brückendarlehen", auszahlungen: [] }],
    });
  });

  it("zeigt in der Runde bei der Position des eigenen Fonds den Verweis auf das Instrument", async () => {
    spieleApi(MIT_RUNDEN([runde("r1", "abgeschlossen", { positionen: [position("r1-p1", "fonds", "Beispielfonds I", { instrumentId: "i9", beteiligungId: BET_ID }), position("r1-p2", "organisation", "Beta Medizin")] })]));
    rendereApp(`/investments/${BET_ID}?tab=financing`);
    const link = await screen.findByRole("link", { name: "Instrument von Beispielfonds I öffnen" });
    expect(link.getAttribute("href")).toContain("subtab=instruments");
    expect(link.getAttribute("href")).toContain(`/investments/${BET_ID}`);
  });

  it("Zahlung eines Co-Investors erfassen und Wiedereröffnen mit Begründung (Verwalter)", async () => {
    const api = spieleApi({
      ...MIT_RUNDEN([runde("r1", "abgeschlossen")]),
      "POST /api/v1/rundenpositionen/r1-p2/zahlungen": { status: 201, koerper: { zahlung: {}, zusage: "500000.00", gezahlt: "300000.00", offen: "200000.00", daten: [] } },
      "POST /api/v1/finanzierungsrunden/r1/wiedereroeffnen": { koerper: runde("r1", "entwurf") },
    });
    rendereApp(`/investments/${BET_ID}?tab=financing`);
    const nutzer = userEvent.setup();
    await nutzer.click((await zeilenAktion("Zahlung erfassen: Beta Medizin"))!);
    let d = dialog();
    await nutzer.type(d.getByLabelText("Betrag"), "200000");
    await nutzer.click(d.getByRole("button", { name: "Erfassen" }));
    expect(await d.findByText(/Gezahlt 300\.000,00.*offen 200\.000,00/)).toBeTruthy();
    expect(api.anfragen("POST", "/api/v1/rundenpositionen/r1-p2/zahlungen")[0]!.koerper).toMatchObject({ art: "einzahlung", betrag: "200000" });
    await nutzer.click(d.getByRole("button", { name: "Schließen" }));
    await nutzer.click(screen.getByRole("button", { name: "Wieder öffnen" }));
    d = dialog();
    await nutzer.type(d.getByLabelText("Begründung"), "Betrag falsch");
    await nutzer.click(d.getByRole("button", { name: "Wieder öffnen" }));
    await waitFor(() => expect(api.anfragen("POST", "/api/v1/finanzierungsrunden/r1/wiedereroeffnen")).toHaveLength(1));
    expect(api.anfragen("POST", "/api/v1/finanzierungsrunden/r1/wiedereroeffnen")[0]!.koerper).toEqual({ grund: "Betrag falsch" });
  });
});

describe("Rundenentwürfe bearbeiten und Runden an der Organisation", () => {
  it("Entwurf bearbeiten: nur geänderte Felder gehen an die API, ein geleertes Post-Money leitet wieder ab; Abgeschlossene bieten es nicht an", async () => {
    const api = spieleApi({ ...MIT_RUNDEN([runde("r2", "entwurf"), runde("r1", "abgeschlossen")]), "PATCH /api/v1/finanzierungsrunden/r2": { koerper: runde("r2", "entwurf") } });
    rendereApp(`/investments/${BET_ID}?tab=financing`);
    const nutzer = userEvent.setup();
    const abschnitt = within(await screen.findByRole("region", { name: de.finanzierungsrunden.titel }));
    await abschnitt.findByRole("tab", { name: /Serie A/ });
    expect(abschnitt.queryByRole("button", { name: "Runde bearbeiten" })).toBeNull(); // Abgeschlossene bieten es nicht an
    await nutzer.click(abschnitt.getByRole("tab", { name: /Serie B/ }));
    expect(abschnitt.getAllByRole("button", { name: "Runde bearbeiten" })).toHaveLength(1);
    await nutzer.click(abschnitt.getByRole("button", { name: "Runde bearbeiten" }));
    const d = dialog();
    expect((d.getByRole("button", { name: "Änderungen speichern" }) as HTMLButtonElement).disabled).toBe(true);
    const name = d.getByLabelText("Bezeichnung");
    await nutzer.clear(name);
    await nutzer.type(name, "Serie B2");
    await nutzer.clear(d.getByLabelText(/Post-Money/));
    await nutzer.click(d.getByRole("button", { name: "Änderungen speichern" }));
    await waitFor(() => expect(api.anfragen("PATCH", "/api/v1/finanzierungsrunden/r2")).toHaveLength(1));
    expect(api.anfragen("PATCH", "/api/v1/finanzierungsrunden/r2")[0]!.koerper).toEqual({ bezeichnung: "Serie B2", postMoney: null });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("Positionen eines Entwurfs ändern, entfernen und hinzufügen", async () => {
    const api = spieleApi({
      ...MIT_RUNDEN([runde("r2", "entwurf"), runde("r1", "abgeschlossen")]),
      "PATCH /api/v1/finanzierungsrunden/r2/positionen/r2-p2": { koerper: runde("r2", "entwurf") },
      "DELETE /api/v1/finanzierungsrunden/r2/positionen/r2-p2": { koerper: runde("r2", "entwurf") },
      "POST /api/v1/finanzierungsrunden/r2/positionen": { status: 201, koerper: runde("r2", "entwurf") },
    });
    rendereApp(`/investments/${BET_ID}?tab=financing`);
    const nutzer = userEvent.setup();
    const abschnitt = within(await screen.findByRole("region", { name: de.finanzierungsrunden.titel }));
    // Abgeschlossene Runden haben keine Positionsaktionen
    await abschnitt.findByRole("tab", { name: /Serie A/ });
    expect(await zeilenAktion(/Position von .* ändern/)).toBeNull();
    await nutzer.keyboard("{Escape}");
    await nutzer.click(abschnitt.getByRole("tab", { name: /Serie B/ }));
    await nutzer.click((await zeilenAktion("Position von Beta Medizin ändern"))!);
    let d = dialog();
    const betrag = d.getByLabelText("Zusage");
    await nutzer.clear(betrag);
    await nutzer.type(betrag, "600000");
    await nutzer.click(d.getByRole("button", { name: "Position speichern" }));
    await waitFor(() => expect(api.anfragen("PATCH", "/api/v1/finanzierungsrunden/r2/positionen/r2-p2")).toHaveLength(1));
    expect(api.anfragen("PATCH", "/api/v1/finanzierungsrunden/r2/positionen/r2-p2")[0]!.koerper).toEqual({ betrag: "600000", anteile: "50000", rolle: "co", anteilsklasseId: null });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await nutzer.click((await zeilenAktion("Position von Beta Medizin entfernen"))!);
    await waitFor(() => expect(api.anfragen("DELETE", "/api/v1/finanzierungsrunden/r2/positionen/r2-p2")).toHaveLength(1));
    // die zwei Positionen des Entwurfs haben je ein Zeilenmenü
    await waitFor(() => expect(within(screen.getByRole("region", { name: /^Positionen der Runde Serie B/ })).getAllByRole("button", { name: "Weitere Aktionen" })).toHaveLength(2));

    await nutzer.click(abschnitt.getByRole("button", { name: "Position hinzufügen" }));
    d = dialog();
    await nutzer.type(d.getByLabelText("Zusage"), "250000");
    await nutzer.type(d.getByLabelText("Anteile"), "25000");
    await nutzer.click(d.getByRole("button", { name: "Position hinzufügen" }));
    await waitFor(() => expect(api.anfragen("POST", "/api/v1/finanzierungsrunden/r2/positionen")).toHaveLength(1));
    expect(api.anfragen("POST", "/api/v1/finanzierungsrunden/r2/positionen")[0]!.koerper).toMatchObject({ fondsId: FONDS_ID, betrag: "250000", anteile: "25000", rolle: "co" });
  });

  it("die Organisationsseite zeigt dieselbe Liste mit Details wie die Beteiligung, ohne Knopf für Felder", async () => {
    spieleApi(MIT_RUNDEN([runde("r2", "entwurf"), runde("r1", "abgeschlossen")]));
    rendereApp(`/organizations/${ORG_A}?tab=rounds`);
    const abschnitt = within(await screen.findByRole("region", { name: de.finanzierungsrunden.titel }));
    const liste = within(await abschnitt.findByRole("tablist", { name: "Runden" }));
    expect(liste.getAllByRole("tab")).toHaveLength(2);
    expect(abschnitt.getByRole("tab", { name: /Serie A/ })).toBeTruthy();
    expect(abschnitt.queryByRole("button", { name: /Eigene Felder anzeigen/ })).toBeNull();
    await userEvent.setup().click(liste.getByRole("tab", { name: /Serie B/ }));
    expect(await abschnitt.findByRole("button", { name: "Runde abschließen" })).toBeTruthy();
  });

  it("die Organisationsseite bietet die Runden mit Fondswahl an; eine 403 der Liste zeigt eine leere Liste statt eines Fehlers", async () => {
    spieleApi({ [RUNDEN]: fehler(403, "forbidden") });
    rendereApp(`/organizations/${ORG_A}?tab=rounds`);
    const abschnitt = within(await screen.findByRole("region", { name: de.finanzierungsrunden.titel }));
    expect(await screen.findByLabelText(de.finanzierungsrunden.fondswahl)).toBeTruthy();
    expect(await abschnitt.findByText(de.finanzierungsrunden.keine)).toBeTruthy();
    expect(abschnitt.queryByRole("alert")).toBeNull();
    expect(abschnitt.getByRole("button", { name: "Neue Runde" })).toBeTruthy();
  });
});

const journalZeile = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  quelle: "vorgang",
  typ: "auszahlung",
  valuta: "2026-03-20",
  erfasstAm: "2026-03-21T08:00:00.123456Z",
  betrag: "60000.00",
  kassenwirkung: "-60000.00",
  richtung: "abfluss",
  beteiligung: { id: BET_ID, organisationId: ORG_A, organisationName: "Alpha Energie", instrument: "wandeldarlehen" },
  kapitalisiert: false,
  stornoVon: null,
  storniertDurch: null,
  bemerkung: null,
  herkunft: { art: "manuell", id: null },
  erfasstVon: { id: "u1", name: "Vera Beispiel" },
  verweis: null,
  ...extra,
});
const journalAntwort = (daten: unknown[], extra: Record<string, unknown> = {}) => ({
  daten,
  weitere: false,
  naechsterCursor: null,
  summen: {
    nachTyp: [
      { typ: "auszahlung", anzahl: 2, summe: "50000.00", kassenwirkung: "-50000.00" },
      { typ: "abruf", anzahl: 1, summe: "1000000.00", kassenwirkung: "1000000.00" },
      { typ: "verkauf", anzahl: 1, summe: null, kassenwirkung: null },
    ],
    gesamt: { anzahl: 4, kassenwirkung: "950000.00" },
  },
  ...extra,
});

describe("Journal", () => {
  const url = `/funds/${FONDS_ID}/journal`;

  it("zeigt Zeilen mit Kassenwirkung, Storno-Verknüpfung und Herkunft, dazu die Summen; die Navigation führt hierher", async () => {
    spieleApi({
      [JOURNAL]: {
        koerper: journalAntwort([
          journalZeile("j1", { stornoVon: "j2", betrag: "-10000.00", kassenwirkung: "10000.00", richtung: "zufluss" }),
          journalZeile("j2", { storniertDurch: "j1", betrag: "10000.00", kassenwirkung: "-10000.00" }),
          journalZeile("j3", { quelle: "fondsbewegung", typ: "abruf", betrag: "1000000.00", kassenwirkung: "1000000.00", richtung: "zufluss", beteiligung: null, herkunft: { art: "import", id: "lauf1" } }),
          journalZeile("j4", { quelle: "ereignis", typ: "verkauf", betrag: "7000.00", kassenwirkung: null, richtung: null, verweis: { art: "verkauf", id: "vk1", storniert: true } }),
        ]),
      },
    });
    rendereApp(url);
    const tabelle = within(await screen.findByRole("table", { name: "Journal des Fonds" }));
    const zeilen = tabelle.getAllByRole("row");
    expect(zeilen.length).toBe(1 + 4);
    const erste = within(zeilen[1]!);
    expect(schmal(erste.getByText(/-10\.000,00/, { selector: "div" }).textContent)).toBeTruthy();
    expect(erste.getByRole("button", { name: /Storno: Zur Gegenbuchung/ })).toBeTruthy();
    expect(within(zeilen[2]!).getByRole("button", { name: /Storniert: Zur Gegenbuchung/ })).toBeTruthy();
    expect(within(zeilen[2]!).getByText(/\(Abfluss\)/)).toBeTruthy();
    expect(within(zeilen[3]!).getByRole("link", { name: "Import" }).getAttribute("href")).toBe("/import/lauf1");
    expect(within(zeilen[4]!).getByText("Verkauf storniert")).toBeTruthy();
    // Storno ist bei einer stornierten Zeile und bei einem Storno nicht anbietbar, bei der normalen Zeile schon
    expect(within(zeilen[1]!).queryByRole("button", { name: /Aktionen für/ })).toBeNull();
    expect(within(zeilen[2]!).queryByRole("button", { name: /Aktionen für/ })).toBeNull();
    expect(within(zeilen[3]!).getByRole("button", { name: /Aktionen für Abruf vom/ })).toBeTruthy();
    // Summen
    const summen = within(screen.getByRole("region", { name: de.journal.summen.titel }));
    expect(summen.getByText("Gesamt")).toBeTruthy();
    expect(schmal(summen.getByText(/950\.000,00/).textContent)).toContain("950.000,00 €");
    // Navigationseintrag unter dem Fonds
    expect(screen.getByRole("link", { name: "Journal" }).getAttribute("href")).toBe(url);
  });

  it("erzeugt am Journalvorgang ohne feste Basis-Art einen Beleg mit manuellem Datum", async () => {
    const api = spieleApi({
      [JOURNAL]: { koerper: journalAntwort([journalZeile("j1", { typ: "zusage" })]) },
      [`/api/v1/funds/${FONDS_ID}/voucher-templates`]: { koerper: { data: [{ type: "custom", customTypeId: "art-1", active: true, labelDe: "Mitteilung", fields: [{ key: "custom_frist", manual: "date", labelDe: "Frist" }] }] } },
      "POST /api/v1/vouchers": fehler(409, "voucher_exists", { voucherId: "be-1" }),
    });
    rendereApp(url);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: /Aktionen für Zusage/ }));
    await nutzer.click(await screen.findByRole("menuitem", { name: "Beleg erzeugen" }));
    const panel = within(await screen.findByRole("dialog"));
    fireEvent.change(panel.getByLabelText("Frist"), { target: { value: "2027-02-01" } });
    await nutzer.click(panel.getByRole("button", { name: "Erzeugen" }));
    await waitFor(() => expect(api.anfragen("POST", "/api/v1/vouchers")[0]?.koerper).toEqual({ type: "custom", customTypeId: "art-1", referenceType: "transaction", referenceId: "j1", language: "de", values: { custom_frist: "2027-02-01" } }));
  });

  it("zeigt Belegnummer und Exportstand der Buchhaltung je Zeile und bietet bei einer Fondsbewegung „Beleg erzeugen“ an", async () => {
    const bewegungId = "33333333-3333-4333-8333-333333333333";
    spieleApi({
      [JOURNAL]: {
        koerper: journalAntwort([
          journalZeile("j1", { buchhaltung: { belegnummer: "B-000007", exportiertAm: "2026-04-02T08:00:00.000Z" } }),
          journalZeile(bewegungId, { quelle: "fondsbewegung", typ: "abruf", betrag: "1000000.00", kassenwirkung: "1000000.00", richtung: "zufluss", beteiligung: null, buchhaltung: { belegnummer: null, exportiertAm: null } }),
        ]),
      },
    });
    rendereApp(url);
    const tabelle = within(await screen.findByRole("table", { name: "Journal des Fonds" }));
    const zeilen = tabelle.getAllByRole("row");
    expect(within(zeilen[1]!).getByText("Beleg B-000007")).toBeTruthy();
    expect(within(zeilen[1]!).getByText(/Exportiert am/)).toBeTruthy();
    expect(within(zeilen[1]!).getByRole("button", { name: /Aktionen für Auszahlung/ })).toBeTruthy();
    expect(within(zeilen[2]!).queryByText(/^Beleg [A-Z]-/)).toBeNull();
    const kapitalbewegung = within(zeilen[2]!).getByRole("link", { name: de.journal.kapitalbewegungOeffnen("Abruf") });
    const ziel = new URL(kapitalbewegung.getAttribute("href")!, "http://x");
    expect(ziel.pathname).toBe("/funds");
    expect(Object.fromEntries(ziel.searchParams)).toEqual({ fundId: FONDS_ID, tab: "capital", movementId: bewegungId });
    const ausloeser = within(zeilen[2]!).getByRole("button", { name: /Aktionen für Abruf/ });
    const nutzer = userEvent.setup();
    ausloeser.focus();
    await nutzer.keyboard("{ArrowUp}");
    const menue = screen.getByRole("menu");
    expect(tabelle.queryByRole("menu")).toBeNull();
    expect(within(menue).queryByRole("menuitem", { name: /Stornieren/ })).toBeNull();
    expect(document.activeElement).toBe(within(menue).getByRole("menuitem", { name: "Beleg erzeugen" }));
    await nutzer.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(ausloeser);

    await nutzer.keyboard("{Enter}{Enter}");
    const panel = await screen.findByRole("dialog");
    expect(panel.getAttribute("aria-label")).toBe("Beleg erzeugen");
    await nutzer.keyboard("{Escape}");
    await waitFor(() => expect(document.activeElement).toBe(ausloeser));
  });

  it("zeigt die Beträge in der Fondswährung und kennzeichnet ungeladene Gegenbuchungen", async () => {
    spieleApi({
      "/api/v1/fonds": { koerper: { daten: [{ ...fondsDaten.daten[0]!, waehrung: "USD" }] } },
      [JOURNAL]: { koerper: journalAntwort([journalZeile("j1", { stornoVon: "nicht-geladen" })]) },
    });
    rendereApp(url);
    const tabelle = within(await screen.findByRole("table", { name: de.journal.tabelle }));
    expect(tabelle.getByText(/^60\.000,00\s*\$$/)).toBeTruthy();
    expect(tabelle.getByTitle(de.journal.gegenbuchungNichtGeladen)).toBeTruthy();
    expect(tabelle.queryByRole("button", { name: /Zur Gegenbuchung/ })).toBeNull();
  });

  it("Filter stehen in der URL und gehen als Abfrage an die API; Export-Links tragen Filter und Sprache", async () => {
    const api = spieleApi({ [JOURNAL]: { koerper: journalAntwort([journalZeile("j1")]) } });
    const { router } = rendereApp(`${url}?type=disbursement&from=2026-01-01&valuations=1`);
    await screen.findByRole("table", { name: "Journal des Fonds" });
    const letzte = api.anfragen("GET", JOURNAL).at(-1)!;
    expect(Object.fromEntries(letzte.query)).toMatchObject({ typ: "auszahlung", von: "2026-01-01", bewertungen: "1", limit: "100" });
    const csv = screen.getByRole("link", { name: "CSV" });
    const q = new URL(csv.getAttribute("href")!, "http://x").searchParams;
    expect(Object.fromEntries(q)).toMatchObject({ format: "csv", language: "de", entryType: "disbursement", from: "2026-01-01", valuations: "1" });
    expect(screen.getByRole("link", { name: "Excel" }).getAttribute("href")).toContain("format=xlsx");
    const nutzer = userEvent.setup();
    await nutzer.selectOptions(screen.getByLabelText("Typ"), "abruf");
    await waitFor(() => expect(router.state.location.search).toMatchObject({ typ: "abruf" }));
    await waitFor(() => expect(Object.fromEntries(api.anfragen("GET", JOURNAL).at(-1)!.query)).toMatchObject({ typ: "abruf" }));
  });

  it("lässt leere Filterergebnisse am Tabellenkopf exportieren", async () => {
    spieleApi({ [JOURNAL]: { koerper: journalAntwort([]) } });
    rendereApp(`${url}?to=2026-01-01`);
    const buchungen = within(await screen.findByRole("region", { name: "Buchungen" }));
    expect(await buchungen.findByText(de.journal.keineGefiltert)).toBeTruthy();
    expect(buchungen.queryByRole("table")).toBeNull();
    for (const format of ["CSV", "Excel"]) {
      const download = buchungen.getByRole("link", { name: format });
      expect(new URL(download.getAttribute("href")!, "http://x").searchParams.get("to")).toBe("2026-01-01");
    }
    const valuta = within(screen.getByRole("group", { name: "Valuta" }));
    expect(valuta.getByLabelText("Von")).toBeTruthy();
    expect(valuta.getByLabelText("Bis")).toBeTruthy();
  });

  it("meldet einen umgekehrten Zeitraum am Datumsfeld und wartet auf eine Korrektur", async () => {
    const api = spieleApi({ [JOURNAL]: { koerper: journalAntwort([]) } });
    rendereApp(`${url}?from=2026-02-02&to=2026-01-01`);
    expect(await screen.findByText(de.journal.filter.zeitraumUngueltig)).toBeTruthy();
    expect(screen.queryByRole("link", { name: "CSV" })).toBeNull();
    expect(api.anfragen("GET", JOURNAL)).toHaveLength(0);
  });

  it("setzt leere Filter zurück und behält den früheren Wissensstand", async () => {
    spieleApi({ [JOURNAL]: { koerper: journalAntwort([]) } });
    const stand = "2026-09-30T10:00:00Z";
    const { router } = rendereApp(`${url}?knowledgeDate=${encodeURIComponent(stand)}&type=disbursement&to=2026-02-31`);
    expect((await screen.findByLabelText<HTMLInputElement>("Bis")).value).toBe("");
    await userEvent.click(await screen.findByRole("button", { name: de.journal.filter.zuruecksetzen }));
    await screen.findByText(de.journal.keine);
    expect(router.state.location.search).toEqual({ stand });
    expect(screen.queryByRole("button", { name: de.journal.neueBuchung })).toBeNull();
  });

  it("bleibt beim Fondswechsel im Journal und übernimmt die Rechte des neuen Fonds", async () => {
    const zweiter = { ...fondsDaten.daten[0]!, id: "22222222-2222-4222-8222-222222222222", name: "Beispielfonds II" };
    spieleApi({
      "/api/v1/me": alsRolle("bearbeiter", { rollen: [{ fondsId: FONDS_ID, rolle: "bearbeiter" }, { fondsId: zweiter.id, rolle: "betrachter" }] }),
      "/api/v1/fonds": { koerper: { daten: [...fondsDaten.daten, zweiter] } },
      [JOURNAL]: { koerper: journalAntwort([]) },
      [`/api/v1/fonds/${zweiter.id}/journal`]: { koerper: journalAntwort([]) },
    });
    const { router } = rendereApp(`${url}?type=disbursement&from=2026-01-01`);
    expect(await screen.findByRole("button", { name: de.journal.neueBuchung })).toBeTruthy();
    await waehleFonds(zweiter.name);
    await waitFor(() => expect(router.state.location.pathname).toBe(`/funds/${zweiter.id}/journal`));
    expect(router.state.location.search).toEqual({});
    await waitFor(() => expect(screen.queryByRole("button", { name: de.journal.neueBuchung })).toBeNull());
  });

  it("Englisch: Spalten, Typnamen und Export in englischer Sprache", async () => {
    localStorage.setItem("carraway.sprache", "en");
    spieleApi({ [JOURNAL]: { koerper: journalAntwort([journalZeile("j1")]) } });
    rendereApp(url);
    const tabelle = within(await screen.findByRole("table", { name: "Journal of the fund" }));
    expect(tabelle.getByRole("columnheader", { name: "Cash effect" })).toBeTruthy();
    expect(tabelle.getByText("Disbursement")).toBeTruthy();
    expect(tabelle.getByText(/\(Outflow\)/)).toBeTruthy();
    expect(new URL(screen.getByRole("link", { name: "CSV" }).getAttribute("href")!, "http://x").searchParams.get("language")).toBe("en");
  });

  it("lädt weitere Seiten mit dem Cursor nach", async () => {
    const api = spieleApi({
      [JOURNAL]: (anfrage) =>
        anfrage.query.get("cursor") === "c2"
          ? { koerper: journalAntwort([journalZeile("j2", { typ: "rueckfluss", kassenwirkung: "5.00", richtung: "zufluss", betrag: "5.00" })], { summen: null }) }
          : { koerper: journalAntwort([journalZeile("j1")], { weitere: true, naechsterCursor: "c2" }) },
    });
    rendereApp(url);
    const nutzer = userEvent.setup();
    await screen.findByRole("table", { name: "Journal des Fonds" });
    expect(screen.getByText("1 Zeilen geladen")).toBeTruthy();
    await nutzer.click(screen.getByRole("button", { name: "Mehr laden" }));
    expect(await screen.findByText("2 Zeilen geladen")).toBeTruthy();
    expect(api.anfragen("GET", JOURNAL).some((a) => a.query.get("cursor") === "c2")).toBe(true);
    expect(screen.queryByRole("button", { name: "Mehr laden" })).toBeNull();
  });

  it("erfasst Beteiligungsvorgänge und bietet Fondsbewegungen nur als Journalfilter an", async () => {
    const api = spieleApi({
      [JOURNAL]: { koerper: journalAntwort([journalZeile("j1")]) },
      [BUCHUNGEN]: { status: 201, koerper: { typ: "auszahlung", vorgang: {}, buchwert: "1012000.00" } },
    });
    rendereApp(url);
    const nutzer = userEvent.setup();
    const filter = within(await screen.findByRole("form", { name: de.journal.filter.beschriftung }));
    expect(filter.getByRole("option", { name: de.journal.typen.abruf })).toBeTruthy();
    expect(filter.getByRole("option", { name: de.journal.typen.ausschuettung })).toBeTruthy();

    await nutzer.click(await screen.findByRole("button", { name: "Neue Buchung" }));
    const d = dialog();
    const buchungsart = within(d.getByLabelText("Art der Buchung"));
    expect(buchungsart.queryByRole("option", { name: de.journal.typen.abruf })).toBeNull();
    expect(buchungsart.queryByRole("option", { name: de.journal.typen.ausschuettung })).toBeNull();
    await nutzer.selectOptions(d.getByLabelText("Art der Buchung"), "auszahlung");
    await nutzer.selectOptions(d.getByLabelText("Beteiligung"), BET_ID);
    await nutzer.type(d.getByLabelText("Betrag"), "25000");
    await nutzer.click(d.getByRole("button", { name: "Buchen" }));
    expect(await d.findByText(/Die Buchung ist angelegt\. Buchwert danach: 1\.012\.000,00/)).toBeTruthy();
    expect(api.anfragen("POST", `/api/v1/funds/${FONDS_ID}/postings`)[0]!.koerper).toMatchObject({ kind: "disbursement", investmentId: BET_ID, amount: "25000" });
  });

  it("sucht die Beteiligung im Buchungsdialog und im Filter, wenn der Fonds viele hat (Issue #298)", async () => {
    const vorlage = uebersichtDaten.beteiligungen[0]!;
    const viele = Array.from({ length: 20 }, (_, i) => ({ ...vorlage, id: `x${i}`, organisation: { ...vorlage.organisation, name: `Unternehmen ${String(i).padStart(2, "0")}` } }));
    const treffer = { id: "x7", fondsId: FONDS_ID, instrument: "darlehen", status: "aktiv", organisation: { id: "o7", name: "Unternehmen 07", ort: "Köln" } };
    const api = spieleApi({
      [JOURNAL]: { koerper: journalAntwort([journalZeile("j1")]) },
      [`/api/v1/fonds/${FONDS_ID}/uebersicht`]: { koerper: { ...uebersichtDaten, beteiligungen: viele } },
      "/api/v1/suche": { koerper: { q: "07", organisationen: [], personen: [], deals: [], beteiligungen: [treffer], dokumente: [] } },
      [`/api/v1/beteiligungen/x7/instrumentdaten`]: { koerper: instrumentDaten },
      [BUCHUNGEN]: { status: 201, koerper: { typ: "auszahlung", vorgang: {}, buchwert: "1012000.00" } },
    });
    rendereApp(url);
    const nutzer = userEvent.setup();
    const filter = within(await screen.findByRole("form", { name: de.journal.filter.beschriftung }));
    expect(await filter.findByRole("combobox", { name: de.journal.filter.beteiligung })).toBeTruthy();

    await nutzer.click(await screen.findByRole("button", { name: "Neue Buchung" }));
    const d = dialog();
    await nutzer.selectOptions(d.getByLabelText("Art der Buchung"), "auszahlung");
    const feld = await d.findByRole("combobox", { name: "Beteiligung" });
    await nutzer.type(feld, "Unternehmen 07");
    await nutzer.click(await d.findByRole("option", { name: /Unternehmen 07/ }));
    await nutzer.type(d.getByLabelText("Betrag"), "25000");
    await nutzer.click(d.getByRole("button", { name: "Buchen" }));
    await waitFor(() => expect(api.anfragen("POST", `/api/v1/funds/${FONDS_ID}/postings`)).toHaveLength(1));
    expect(api.anfragen("POST", `/api/v1/funds/${FONDS_ID}/postings`)[0]!.koerper).toMatchObject({ investmentId: "x7" });
    const suche = api.anfragen("GET", "/api/v1/suche").at(-1);
    expect(suche?.query.get("objekt")).toBe("beteiligung");
    expect(suche?.query.get("fondsId")).toBe(FONDS_ID);
  });

  it("zeigt im Journal die Spalte Instrument", async () => {
    spieleApi({ [JOURNAL]: { koerper: journalAntwort([journalZeile("j1", { instrumentId: "i1", instrumentBezeichnung: "Wandeldarlehen 2021" }), journalZeile("b1", { quelle: "fondsbewegung", typ: "abruf", beteiligung: null })]) } });
    rendereApp(url);
    const tabelle = within(await screen.findByRole("table", { name: "Journal des Fonds" }));
    expect(tabelle.getByRole("columnheader", { name: "Instrument" })).toBeTruthy();
    expect(tabelle.getByText("Wandeldarlehen 2021")).toBeTruthy();
  });

  it("Buchungsdialog bei zwei Instrumenten: Instrument ist Pflicht und folgt der Art, die Auszahlung wählt eine offene Tranche, keine Wertberichtigung", async () => {
    const seed = instrumentZeile("i2", "Seed-Anteile", "offene_beteiligung", {
      istHauptinstrument: false,
      zusage: "500000.00",
      ausgezahlt: "100000.00",
      offeneZusage: "400000.00",
      tranchen: [trancheZeile("t-seed", "i2", 1, "Erste Rate", "300000.00", { geplantAm: "2026-12-31" }, { zahlung: "teilweise_gezahlt", ausgezahlt: "100000.00", offen: "200000.00" })],
    });
    const api = spieleApi({
      [JOURNAL]: { koerper: journalAntwort([journalZeile("j1")]) },
      [`/api/v1/beteiligungen/${BET_ID}/instrumentdaten`]: { koerper: { ...instrumentDaten, instrumente: [hauptInstrument, seed] } },
      [BUCHUNGEN]: { status: 201, koerper: { typ: "dividende", vorgang: {}, buchwert: "1012000.00" } },
    });
    rendereApp(url);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Neue Buchung" }));
    const d = dialog();
    const arten = within(d.getByLabelText("Art der Buchung"));
    expect(arten.queryByRole("option", { name: de.journal.typen.wertberichtigung })).toBeNull();
    expect(arten.getByRole("option", { name: de.journal.typen.zinszahlung })).toBeTruthy();
    expect(arten.getByRole("option", { name: de.journal.typen.dividende })).toBeTruthy();
    expect(d.queryByLabelText("Instrument")).toBeNull();
    await nutzer.selectOptions(d.getByLabelText("Beteiligung"), BET_ID);
    // Zinszahlung: nur das Darlehen; mit genau einem passenden ist es vorbelegt
    await nutzer.selectOptions(d.getByLabelText("Art der Buchung"), "zinszahlung");
    const instrument = (await d.findByLabelText("Instrument")) as HTMLSelectElement;
    expect(within(instrument).getAllByRole("option").map((o) => o.textContent)).toEqual([hauptInstrument.bezeichnung]);
    // Auszahlung: beide Instrumente, keines vorbelegt; die Tranche folgt dem Instrument
    await nutzer.selectOptions(d.getByLabelText("Art der Buchung"), "auszahlung");
    expect((d.getByLabelText("Instrument") as HTMLSelectElement).value).toBe("");
    expect(d.getByRole("button", { name: "Buchen" }).hasAttribute("disabled")).toBe(true);
    await nutzer.selectOptions(d.getByLabelText("Instrument"), "i2");
    await nutzer.selectOptions(d.getByLabelText("Tranche (optional)"), "t-seed");
    await nutzer.type(d.getByLabelText("Betrag"), "25000");
    await nutzer.click(d.getByRole("button", { name: "Buchen" }));
    await waitFor(() => expect(api.anfragen("POST", `/api/v1/funds/${FONDS_ID}/postings`)).toHaveLength(1));
    expect(api.anfragen("POST", `/api/v1/funds/${FONDS_ID}/postings`)[0]!.koerper).toMatchObject({ kind: "disbursement", investmentId: BET_ID, instrumentId: "i2", trancheId: "t-seed", amount: "25000" });
  });

  it("storniert Beteiligungsvorgänge und bietet für Fondsbewegungen die Belegerstellung an", async () => {
    const api = spieleApi({
      [JOURNAL]: { koerper: journalAntwort([journalZeile("v1"), journalZeile("b1", { quelle: "fondsbewegung", typ: "abruf", betrag: "100.00", kassenwirkung: "100.00", richtung: "zufluss", beteiligung: null })]) },
      "POST /api/v1/transactions/v1/reverse": { status: 201, koerper: { reversal: {}, original: {} } },
    });
    rendereApp(url);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: /Aktionen für Auszahlung vom/ }));
    await nutzer.click(screen.getByRole("menuitem", { name: /Stornieren/ }));
    await nutzer.type(dialog().getByLabelText("Grund"), "Falscher Betrag");
    await nutzer.click(dialog().getByRole("button", { name: "Stornieren" }));
    await waitFor(() => expect(api.anfragen("POST", "/api/v1/transactions/v1/reverse")).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("table", { name: "Journal des Fonds" })));
    await nutzer.click(screen.getByRole("button", { name: /Aktionen für Abruf vom/ }));
    expect(screen.queryByRole("menuitem", { name: /Stornieren/ })).toBeNull();
    expect(screen.getByRole("menuitem", { name: de.buchhaltung.erzeugen.knopf })).toBeTruthy();
  });

  it.each([
    ["betrachter", undefined],
    ["bearbeiter", "2026-09-30T10:00:00Z"],
  ] as const)("zeigt das Journal für %s mit Wissensstand %s ohne Schreibaktionen", async (rolle, stand) => {
    const bewegungId = "33333333-3333-4333-8333-333333333333";
    spieleApi({
      "/api/v1/me": alsRolle(rolle),
      [JOURNAL]: { koerper: journalAntwort([journalZeile("j1"), journalZeile(bewegungId, { quelle: "fondsbewegung", typ: "abruf", beteiligung: null })]) },
    });
    rendereApp(stand ? `${url}?knowledgeDate=${encodeURIComponent(stand)}` : url);
    await screen.findByRole("table", { name: "Journal des Fonds" });
    expect(screen.queryByRole("button", { name: "Neue Buchung" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Aktionen für/ })).toBeNull();
    const kapital = screen.getByRole("link", { name: de.journal.kapitalbewegungOeffnen("Abruf") });
    const ziel = new URL(kapital.getAttribute("href")!, "http://x");
    expect(Object.fromEntries(ziel.searchParams)).toEqual({ fundId: FONDS_ID, tab: "capital", movementId: bewegungId, ...(stand ? { knowledgeDate: stand } : {}) });
  });
});
