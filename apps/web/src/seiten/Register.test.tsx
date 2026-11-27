import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { alsRolle, BET_ID, ORG_A, rendereApp, spieleApi } from "../test/hilfen";
import { de } from "../i18n/de";
import { en } from "../i18n/en";

/** Register am Unternehmen (Etappe 18) mit gespielter API, in beiden Sprachen. Alle Daten sind erfunden. */

const REGISTER = `/api/v1/organisationen/${ORG_A}/register`;
const url = `/organizations/${ORG_A}?tab=register`;

const eintrag = {
  id: "e1",
  organisationId: ORG_A,
  gericht: "Amtsgericht Beispielstadt",
  registerart: "HRB",
  nummer: "HRB 99001",
  firma: "Alpha Energie GmbH",
  rechtsform: "GmbH",
  sitz: "Beispielstadt",
  anschrift: "Beispielweg 1, 99999 Beispielstadt",
  gegenstand: null,
  kapital: "25000.00",
  kapitalWaehrung: "EUR",
  vertretung: [{ name: "Johanna Beispielhalter", funktion: "Geschäftsführerin" }],
  prokura: [],
  standDatum: "2026-09-30",
  quelle: "manuell",
  dokumentId: null,
  erfasstAm: "2026-10-01T08:00:00.000Z",
  erfasstVon: "x",
};

const registerDaten = {
  aktuell: eintrag,
  historie: [{ ...eintrag, id: "e0", sitz: "Musterhausen", standDatum: "2026-03-01" }],
  ereignisse: [
    { id: "v1", organisationId: ORG_A, registereintragId: "e1", datum: "2026-11-02", art: "insolvenz", text: "Eröffnung des Verfahrens (Beispiel).", quelle: "manuell", externeId: null, erledigtAm: null, erledigtVon: null, erfasstAm: "2026-11-02T08:00:00.000Z" },
  ],
  abweichungen: [
    { feld: "firma", code: "FIRMA_ABWEICHEND", crm: "Alpha Energie AG", register: "Alpha Energie GmbH" },
    { feld: "geschaeftsfuehrung", code: "GESCHAEFTSFUEHRUNG_ABWEICHEND", crm: "Eva Muster", register: "Johanna Beispielhalter", fehltImCrm: ["Johanna Beispielhalter"], nichtImRegister: ["Eva Muster"] },
  ],
  hinweise: [{ ereignisId: "v1", art: "insolvenz", datum: "2026-11-02", text: "x", beteiligungId: BET_ID, fondsId: "f", fondsName: "Beispielfonds I", aktion: "insolvenz" }],
  beobachtung: { aktiv: false, letztePruefungAm: null, letztesErgebnis: null },
  auszug: null,
  anbieterEingerichtet: false,
};

afterEach(() => localStorage.removeItem("carraway.sprache"));

const abschnitt = async () => within(await screen.findByRole("region", { name: "Handelsregister" }));

describe("Register am Unternehmen", () => {
  it("zeigt Stand, Abweichungen, Hinweise, Bekanntmachungen und Verlauf", async () => {
    spieleApi({ [REGISTER]: { koerper: registerDaten }, "/api/v1/register/meldungen": { koerper: { daten: [] } } });
    rendereApp(url);
    const r = await abschnitt();
    expect(r.getByText("Alpha Energie GmbH", { selector: "dd" })).toBeTruthy();
    expect(r.getByText("HRB HRB 99001, Amtsgericht Beispielstadt")).toBeTruthy();
    expect(r.getAllByText("Von Hand erfasst").length).toBeGreaterThan(0);
    const diff = within(r.getByRole("region", { name: "Abgleich mit den Stammdaten" }));
    expect(diff.getAllByRole("row")).toHaveLength(3);
    expect(diff.getByText("Im Register, nicht in den Stammdaten: Johanna Beispielhalter")).toBeTruthy();
    expect(diff.getByText("In den Stammdaten, nicht im Register: Eva Muster")).toBeTruthy();
    expect(r.getByText(/Beispielfonds I: Insolvenz vom 02\.11\.2026/)).toBeTruthy();
    expect(r.getByRole("link", { name: "Insolvenz an der Beteiligung erfassen" }).getAttribute("href")).toBe(`/investments/${BET_ID}#abschnitt-instrument`);
    expect(within(r.getByRole("region", { name: "Bekanntmachungen" })).getByText("Eröffnung des Verfahrens (Beispiel).")).toBeTruthy();
    expect(within(r.getByRole("region", { name: "Verlauf der Registerdaten" })).getByText("Musterhausen")).toBeTruthy();
    expect(r.getByText("Es ist kein Anbieter eingerichtet; die Beobachtung hat derzeit keine Wirkung.")).toBeTruthy();
  });

  it("übernimmt ein Feld mit einem Klick und sendet nur dieses Feld", async () => {
    const api = spieleApi({
      [REGISTER]: { koerper: registerDaten },
      "/api/v1/register/meldungen": { koerper: { daten: [] } },
      [`POST ${REGISTER}/uebernehmen`]: { koerper: { uebernommen: ["firma"] } },
    });
    rendereApp(url);
    const r = await abschnitt();
    await userEvent.setup().click(r.getByRole("button", { name: "Firma aus dem Register übernehmen" }));
    await waitFor(() => expect(api.anfragen("POST", `${REGISTER}/uebernehmen`)).toHaveLength(1));
    expect(api.anfragen("POST", `${REGISTER}/uebernehmen`)[0]!.koerper).toEqual({ felder: ["firma"] });
    expect(await r.findByText("Die Felder sind aus dem Register übernommen.")).toBeTruthy();
  });

  it("erledigt eine Bekanntmachung und schaltet die Beobachtung (nur Verwalter)", async () => {
    const api = spieleApi({
      [REGISTER]: { koerper: registerDaten },
      "/api/v1/register/meldungen": { koerper: { daten: [] } },
      [`POST ${REGISTER}/ereignisse/v1/erledigen`]: { koerper: { id: "v1" } },
      [`PUT ${REGISTER}/beobachtung`]: { koerper: { aktiv: true, letztePruefungAm: null, letztesErgebnis: null } },
    });
    rendereApp(url);
    const r = await abschnitt();
    const nutzer = userEvent.setup();
    await nutzer.click(r.getByRole("button", { name: "Hinweis erledigt: Eröffnung des Verfahrens (Beispiel)." }));
    await waitFor(() => expect(api.anfragen("POST", `${REGISTER}/ereignisse/v1/erledigen`)).toHaveLength(1));
    await nutzer.click(r.getByRole("checkbox", { name: "Dieses Unternehmen beobachten" }));
    await waitFor(() => expect(api.anfragen("PUT", `${REGISTER}/beobachtung`)).toHaveLength(1));
    expect(api.anfragen("PUT", `${REGISTER}/beobachtung`)[0]!.koerper).toEqual({ aktiv: true });
  });

  it("zeigt Betrachtern keine Schreibaktionen und eine gesperrte Beobachtung", async () => {
    spieleApi({ "/api/v1/me": alsRolle("betrachter"), [REGISTER]: { koerper: registerDaten }, "/api/v1/register/meldungen": { koerper: { daten: [] } } });
    rendereApp(url);
    const r = await abschnitt();
    expect(r.queryByRole("button", { name: /übernehmen/ })).toBeNull();
    expect(r.queryByRole("button", { name: "Registerstand erfassen" })).toBeNull();
    expect((r.getByRole("checkbox", { name: "Dieses Unternehmen beobachten" }) as HTMLInputElement).disabled).toBe(true);
    expect(r.getByText("Die Beobachtung schalten Verwalter.")).toBeTruthy();
  });

  it("erfasst einen Registerstand von Hand", async () => {
    const api = spieleApi({
      [REGISTER]: { koerper: { ...registerDaten, aktuell: null, historie: [], abweichungen: [], hinweise: [], ereignisse: [] } },
      "/api/v1/register/meldungen": { koerper: { daten: [] } },
      [`POST ${REGISTER}/eintraege`]: { koerper: { eintrag, neu: true }, status: 201 },
    });
    rendereApp(url);
    const r = await abschnitt();
    expect(r.getByText("Noch kein Registereintrag erfasst.")).toBeTruthy();
    const nutzer = userEvent.setup();
    await nutzer.click(r.getByRole("button", { name: "Registerstand erfassen" }));
    const f = within(r.getByRole("form", { name: "Registerstand erfassen" }));
    await nutzer.type(f.getByLabelText("Registergericht"), "Amtsgericht Beispielstadt");
    await nutzer.type(f.getByLabelText("Registernummer"), "HRB 99001");
    await nutzer.type(f.getByLabelText("Firma"), "Alpha Energie GmbH");
    await nutzer.type(f.getByLabelText("Stand-Datum"), "2026-09-30");
    await nutzer.type(f.getByLabelText("Vertretung"), "Johanna Beispielhalter | Geschäftsführerin");
    await nutzer.click(f.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(api.anfragen("POST", `${REGISTER}/eintraege`)).toHaveLength(1));
    expect(api.anfragen("POST", `${REGISTER}/eintraege`)[0]!.koerper).toMatchObject({
      gericht: "Amtsgericht Beispielstadt",
      registerart: "HRB",
      nummer: "HRB 99001",
      standDatum: "2026-09-30",
      vertretung: [{ name: "Johanna Beispielhalter", funktion: "Geschäftsführerin" }],
      dokumentId: null,
    });
  });

  it("zeigt Fehler der API übersetzt", async () => {
    spieleApi({
      [REGISTER]: { koerper: registerDaten },
      "/api/v1/register/meldungen": { koerper: { daten: [] } },
      [`POST ${REGISTER}/uebernehmen`]: { koerper: { error: { code: "register_no_difference", message: "x" } }, status: 409 },
    });
    rendereApp(url);
    const r = await abschnitt();
    await userEvent.setup().click(r.getByRole("button", { name: "Firma aus dem Register übernehmen" }));
    expect(await r.findByText(de.fehler.register_no_difference)).toBeTruthy();
  });

  it("ist in Englisch vollständig übersetzt", async () => {
    localStorage.setItem("carraway.sprache", "en");
    spieleApi({ [REGISTER]: { koerper: registerDaten }, "/api/v1/register/meldungen": { koerper: { daten: [] } } });
    rendereApp(url);
    const r = within(await screen.findByRole("region", { name: "Commercial register" }));
    expect(r.getAllByText("Entered by hand").length).toBeGreaterThan(0);
    expect(r.getByRole("button", { name: "Take over Company name from the register" })).toBeTruthy();
    expect(r.getByText("The management in the register differs from the people in the master data.")).toBeTruthy();
    expect(r.getByText(/Beispielfonds I: Insolvency of 02\/11\/2026/)).toBeTruthy();
    expect(r.getByText("Monitor this company")).toBeTruthy();
    expect(en.register.titel).toBe("Commercial register");
  });
});

describe("Hinweis auf der Beteiligung", () => {
  const hinweis = { ereignisId: "v1", art: "insolvenz", datum: "2026-11-02", text: "x", beteiligungId: BET_ID, fondsId: "f", fondsName: "Beispielfonds I", aktion: "insolvenz" };

  it("verweist auf den Ablauf, ohne zu buchen", async () => {
    const api = spieleApi({ [`/api/v1/beteiligungen/${BET_ID}/register-hinweise`]: { koerper: { daten: [hinweis] } } });
    rendereApp(`/investments/${BET_ID}`);
    expect(await screen.findByText(/Registerhinweis: Insolvenz vom 02\.11\.2026/)).toBeTruthy();
    // Der Hinweis führt zum Insolvenzablauf im Abschnitt Instrument derselben Seite, nicht zum Unternehmen.
    const link = screen.getByRole("link", { name: "Insolvenz an der Beteiligung erfassen" });
    expect(link.getAttribute("href")).toBe("#abschnitt-instrument");
    expect(document.getElementById("abschnitt-instrument")).not.toBeNull();
    expect(api.aufrufe.filter((a) => a.methode !== "GET")).toHaveLength(0);
  });

  it("führt bei einer Kapitalerhöhung zur Rundenerfassung am Unternehmen", async () => {
    spieleApi({ [`/api/v1/beteiligungen/${BET_ID}/register-hinweise`]: { koerper: { daten: [{ ...hinweis, art: "kapitalerhoehung", aktion: "runde" }] } } });
    rendereApp(`/investments/${BET_ID}`);
    const link = await screen.findByRole("link", { name: "Runde am Unternehmen erfassen" });
    expect(link.getAttribute("href")).toMatch(/^\/organizations\/.+#runden-titel$/);
  });

  it("zeigt in Englisch den übersetzten Hinweis und ohne Hinweise nichts", async () => {
    localStorage.setItem("carraway.sprache", "en");
    spieleApi({ [`/api/v1/beteiligungen/${BET_ID}/register-hinweise`]: { koerper: { daten: [hinweis] } } });
    const { unmount } = rendereApp(`/investments/${BET_ID}`);
    expect(await screen.findByText(/Register note: Insolvency of 02\/11\/2026/)).toBeTruthy();
    unmount();
    spieleApi({ [`/api/v1/beteiligungen/${BET_ID}/register-hinweise`]: { koerper: { daten: [] } } });
    rendereApp(`/investments/${BET_ID}`);
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByText(/Register note/)).toBeNull();
  });
});
