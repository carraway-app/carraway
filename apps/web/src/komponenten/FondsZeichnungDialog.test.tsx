import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { formatProzent } from "@carraway/ui";
import { de } from "../i18n/de";
import { formatBetragCent } from "../lib/zahl";
import { FONDS_ID, fondsDaten, rendereApp, spieleApi } from "../test/hilfen";

/** LP-Zusagen schrittweise erfassen und Abdeckung des Zeichnungskapitals (Issue #275), ohne Erweiterungen. Alle Daten sind erfunden. */

const PFAD = `/api/v1/fonds/${FONDS_ID}/investorenzugaenge`;
const URL = `/funds?fundId=${FONDS_ID}&tab=investors`;
const v = de.verwaltung.investoren;
const z = v.fonds.zeichnungen;
const abdeckung = de.portfolio.zusagen;
const ERSTER = { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", name: "Fondsanleger GmbH" };
const ZWEITER = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Anleger Zwei GmbH" };
const TEIL = {
  zeichnungskapital: "30000000.00",
  waehrung: "EUR",
  abgedeckt: "10000000.00",
  vollstaendig: false,
  organisationen: [],
  erfassungMoeglich: true,
  closings: [],
  closingMoeglich: false,
  zeichnungen: [{ ...ERSTER, zusage: "10000000.00", anteil: "0.333333", ausgetreten: false, abgerufen: "0.00" }],
};

/** Text des Hinweises zur Abdeckung (über die Fortschrittsanzeige gefunden). */
const hinweisText = async () => (await screen.findByRole("progressbar", { name: abdeckung.titel })).closest(".cw-hinweis")?.textContent ?? "";

describe("LP-Zusagen schrittweise erfassen", () => {
  it("zeigt die Abdeckung, fügt eine Zusage hinzu, ändert und entfernt eine Zusage", async () => {
    const api = spieleApi({
      [PFAD]: { koerper: TEIL },
      [`POST ${PFAD}/zeichnungen`]: { status: 201, koerper: { daten: [] } },
      [`PATCH ${PFAD}/zeichnungen/${ERSTER.id}`]: { koerper: {} },
      [`DELETE ${PFAD}/zeichnungen/${ERSTER.id}`]: { status: 204, koerper: null },
      "/api/v1/suche": { koerper: { q: "anl", organisationen: [{ ...ERSTER, art: "investor", ort: "Hamburg" }, { ...ZWEITER, art: "investor", ort: "Berlin" }], personen: [], deals: [], dokumente: [] } },
    });
    const nutzer = userEvent.setup();
    rendereApp(URL);

    expect(await hinweisText()).toContain(abdeckung.abdeckung(formatProzent(33.3, "de"), formatBetragCent("10000000", "de"), formatBetragCent("30000000", "de")));
    await nutzer.click(screen.getByRole("button", { name: z.bearbeitenAktion }));
    const dialog = within(screen.getByRole("dialog", { name: z.anlegen }));
    // Ohne Erweiterung LP-Portal kein Hinweis auf Portal-Konten.
    expect(dialog.queryByText(/Portal/i)).toBeNull();
    await dialog.findByRole("form", { name: z.neu });
    expect(dialog.getByRole("form", { name: z.neu }).textContent).toContain(z.offen(formatBetragCent("20000000", "de")));

    // Suchfeld statt Liste: Treffer aus der Suche (nur Investoren), bereits erfasste stehen nicht zur Wahl.
    const suchfeld = dialog.getByRole("combobox", { name: v.form.organisation });
    await nutzer.type(suchfeld, "Anl");
    const liste = await dialog.findByRole("listbox", { name: de.auswahl.trefferZu(v.form.organisation) });
    await within(liste).findByRole("option", { name: new RegExp(ZWEITER.name) });
    expect(within(liste).queryByRole("option", { name: new RegExp(ERSTER.name) })).toBeNull();
    expect(api.anfragen("GET", "/api/v1/suche").at(-1)?.query.get("art")).toBe("investor");
    await nutzer.keyboard("{ArrowDown}{ArrowUp}{Enter}");
    expect(dialog.getByText(de.auswahl.gewaehlt(`${ZWEITER.name} · ${de.organisationArt.investor} · Berlin`))).toBeTruthy();
    await nutzer.type(dialog.getByLabelText(z.zusage), "5000000");
    await nutzer.click(dialog.getByRole("button", { name: z.hinzufuegen }));
    expect(await dialog.findByText(z.gespeichert)).toBeTruthy();
    expect(api.anfragen("POST", `${PFAD}/zeichnungen`)[0]?.koerper).toEqual({ zeichnungen: [{ organisationId: ZWEITER.id, zusage: "5000000" }] });

    await nutzer.click(dialog.getByRole("button", { name: z.bearbeitenFuer(ERSTER.name) }));
    const bearbeiten = within(dialog.getByRole("form", { name: z.bearbeitenFuer(ERSTER.name) }));
    await nutzer.clear(bearbeiten.getByLabelText(z.zusage));
    await nutzer.type(bearbeiten.getByLabelText(z.zusage), "12000000");
    await nutzer.click(bearbeiten.getByRole("button", { name: z.speichern }));
    expect(await dialog.findByText(z.geaendert)).toBeTruthy();
    expect(api.anfragen("PATCH", `${PFAD}/zeichnungen/${ERSTER.id}`)[0]?.koerper).toEqual({ zusage: "12000000" });

    await nutzer.click(dialog.getByRole("button", { name: z.entfernenFuer(ERSTER.name) }));
    await waitFor(() => expect(api.anfragen("DELETE", `${PFAD}/zeichnungen/${ERSTER.id}`)).toHaveLength(1));
    expect(await dialog.findByText(z.entfernt)).toBeTruthy();
  });

  it("legt aus dem Suchfeld eine neue Investor-Organisation an und übernimmt sie", async () => {
    const NEU = { id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", name: "Neuer Anleger AG", art: "investor", sektor: null, ort: null, website: null };
    const api = spieleApi({
      [PFAD]: { koerper: TEIL },
      "/api/v1/suche": { koerper: { q: "neuer", organisationen: [], personen: [], deals: [], dokumente: [] } },
      "/api/v1/organisationen/dubletten": { koerper: { daten: [] } },
      "POST /api/v1/organisationen": { status: 201, koerper: NEU },
      [`POST ${PFAD}/zeichnungen`]: { status: 201, koerper: { daten: [] } },
    });
    const nutzer = userEvent.setup();
    rendereApp(URL);
    await nutzer.click(await screen.findByRole("button", { name: z.bearbeitenAktion }));
    const dialog = within(screen.getByRole("dialog", { name: z.anlegen }));
    await nutzer.type(dialog.getByRole("combobox", { name: v.form.organisation }), NEU.name);
    await nutzer.click(await dialog.findByRole("option", { name: de.auswahl.anlegen(NEU.name) }));

    const anlage = within(await screen.findByRole("dialog", { name: de.organisationForm.titelNeu }));
    expect((anlage.getByLabelText(de.organisationForm.name) as HTMLInputElement).value).toBe(NEU.name);
    expect((anlage.getByLabelText(de.organisationForm.art) as HTMLSelectElement).value).toBe("investor");
    await nutzer.click(anlage.getByRole("button", { name: de.organisationForm.anlegen }));
    expect(api.anfragen("POST", "/api/v1/organisationen")[0]?.koerper).toMatchObject({ name: NEU.name, art: "investor" });

    const zurueck = within(await screen.findByRole("dialog", { name: z.anlegen }));
    expect((zurueck.getByRole("combobox", { name: v.form.organisation }) as HTMLInputElement).value).toBe(NEU.name);
    await nutzer.type(zurueck.getByLabelText(z.zusage), "1000");
    await nutzer.click(zurueck.getByRole("button", { name: z.hinzufuegen }));
    await waitFor(() => expect(api.anfragen("POST", `${PFAD}/zeichnungen`)[0]?.koerper).toEqual({ zeichnungen: [{ organisationId: NEU.id, zusage: "1000" }] }));
  });

  it("zeigt auf der Fondsseite den Hinweis mit Link zum Vervollständigen, solange die Zusagen unvollständig sind", async () => {
    spieleApi({
      "/api/v1/fonds": { koerper: { daten: [{ ...fondsDaten.daten[0]!, abgedeckt: "15000000.00", zusagenVollstaendig: false }] } },
    });
    rendereApp(`/funds/${FONDS_ID}`);
    expect(await hinweisText()).toContain(abdeckung.abdeckung(formatProzent(25, "de"), formatBetragCent("15000000", "de"), formatBetragCent("60000000", "de")));
    expect(screen.getByRole("link", { name: abdeckung.zumVervollstaendigen }).getAttribute("href")).toContain("tab=investors");
  });

  it("zeigt keinen Hinweis bei vollständigen Zusagen", async () => {
    spieleApi({
      "/api/v1/fonds": { koerper: { daten: [{ ...fondsDaten.daten[0]!, abgedeckt: "60000000.00", zusagenVollstaendig: true }] } },
    });
    rendereApp(`/funds/${FONDS_ID}`);
    expect(await screen.findByRole("heading", { name: fondsDaten.daten[0]!.name })).toBeTruthy();
    expect(screen.queryByText(abdeckung.titel, { exact: false })).toBeNull();
  });
});
