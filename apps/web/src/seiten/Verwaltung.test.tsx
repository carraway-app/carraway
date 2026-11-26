import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { alsRolle, FONDS_ID, ICH_ID, fehler, rendereApp, spieleApi } from "../test/hilfen";
import { de } from "../i18n/de";
import { feldpruefungTexte } from "../i18n/feldpruefung";
import { en } from "../i18n/en";

/** Karte im Inhalt eines Bereichs: Der Inhaltsbereich selbst trägt als Region den Namen des Eintrags und wird hier übergangen. */
const karteInnen = (name: string) =>
  waitFor(() => {
    const karte = screen.queryAllByRole("region", { name }).find((r) => !r.classList.contains("cw-inhalt__bereich"));
    if (!karte) throw new Error(`Karte ${name} fehlt`);
    return karte;
  });

const BERTA = "77777777-7777-4777-8777-777777777777";
const SCHLUESSEL_ID = "66666666-6666-4666-8666-666666666666";

const person = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  email: `${name.split(" ")[0]!.toLowerCase()}@beispiel.example`,
  aktiv: true,
  technisch: false,
  globalVerwalter: false,
  zweiFaktorAktiv: true,
  passwortAendern: false,
  rollen: [],
  ...extra,
});
const benutzer = { daten: [person(ICH_ID, "Vera Beispiel", { globalVerwalter: true }), person(BERTA, "Berta Beispiel", { passwortAendern: true, zweiFaktorAktiv: false }), person("t1", "API: Export", { technisch: true })] };
const schluesselZeile = (extra: Record<string, unknown> = {}) => ({
  id: SCHLUESSEL_ID,
  name: "Berichtsexport",
  benutzerId: "t1",
  vorschau: "cwk_ab12cd",
  scopes: [{ fondsId: FONDS_ID, recht: "lesen" }],
  ablauf: "2027-02-01T00:00:00.000Z",
  erstelltAm: "2026-11-01T00:00:00.000Z",
  zuletztGenutzt: null,
  widerrufenAm: null,
  status: "aktiv",
  ...extra,
});
const sperre = (extra: Record<string, unknown> = {}) => ({ fondsId: FONDS_ID, gesperrtBis: "2026-06-30", gesetztVon: ICH_ID, gesetztVonName: "Vera Beispiel", gesetztAm: "2026-07-05T08:00:00.000Z", grund: "Quartal abgeschlossen", ...extra });

const verwaltungApi = (extra: Parameters<typeof spieleApi>[0] = {}) =>
  spieleApi({
    "/api/v1/benutzer": { koerper: benutzer },
    [`/api/v1/fonds/${FONDS_ID}/rollen`]: { koerper: { daten: [{ benutzerId: BERTA, name: "Berta Beispiel", email: "berta@beispiel.example", aktiv: true, rolle: "bearbeiter" }] } },
    "/api/v1/api-schluessel": { koerper: { daten: [schluesselZeile()] } },
    [`/api/v1/fonds/${FONDS_ID}/periodensperre`]: { koerper: sperre() },
    "/api/v1/dokumente/aufbewahrung": { koerper: { aufbewahrungTage: 30, daten: [], endgueltigGeloescht: 0 } },
    ...extra,
  });

describe("Verwaltung: Zugang", () => {
  it("führt Personen ohne globale Verwaltung zurück zur Startseite und zeigt ihnen keinen Menüpunkt", async () => {
    verwaltungApi({ "/api/v1/ich": alsRolle("verwalter") });
    const { router } = rendereApp("/verwaltung");
    await waitFor(() => expect(router.state.location.pathname).toBe(`/fonds/${FONDS_ID}`));
    expect(screen.queryByRole("link", { name: "Verwaltung" })).toBeNull();
  });

  it("zeigt globalen Verwaltern den Menüpunkt im Kontomenü", async () => {
    verwaltungApi();
    rendereApp("/dealflow");
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: /Kontomenü/ }));
    expect(screen.getByRole("menuitem", { name: "Verwaltung" })).toBeTruthy();
  });
});

describe("Verwaltung: Benutzer", () => {
  it("listet Personen (ohne technische Benutzer) und legt eine Person mit Startpasswort an", async () => {
    const api = verwaltungApi({ "POST /api/v1/benutzer": { status: 201, koerper: { id: "n1", name: "Neue Person", email: "neu@beispiel.example", aktiv: true, globalVerwalter: false } } });
    rendereApp("/verwaltung");
    const nutzer = userEvent.setup();
    const tabelle = await karteInnen("Benutzer");
    expect(within(tabelle).getByText("Berta Beispiel")).toBeTruthy();
    expect(within(tabelle).queryByText("API: Export")).toBeNull();
    expect(within(tabelle).getByText("Startpasswort")).toBeTruthy();
    // die eigene Person ist nicht sperrbar
    expect((within(tabelle).getByRole("button", { name: "Vera Beispiel sperren" }) as HTMLButtonElement).disabled).toBe(true);

    await nutzer.click(screen.getByRole("button", { name: "Benutzer anlegen" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Benutzer anlegen" }));
    await nutzer.type(dialog.getByLabelText("Name"), "Neue Person");
    await nutzer.type(dialog.getByLabelText("E-Mail-Adresse"), "neu@beispiel.example");
    await nutzer.type(dialog.getByLabelText("Startpasswort"), "kurz");
    await nutzer.click(dialog.getByRole("button", { name: "Benutzer anlegen" }));
    expect(dialog.getByText(de.passwort.zuKurz(12))).toBeTruthy();
    expect(api.anfragen("POST", "/api/v1/benutzer")).toHaveLength(0);
    await nutzer.clear(dialog.getByLabelText("Startpasswort"));
    await nutzer.type(dialog.getByLabelText("Startpasswort"), "Startpasswort-123456");
    await nutzer.click(dialog.getByRole("checkbox"));
    await nutzer.click(dialog.getByRole("button", { name: "Benutzer anlegen" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.anfragen("POST", "/api/v1/benutzer")[0]!.koerper).toEqual({ name: "Neue Person", email: "neu@beispiel.example", passwort: "Startpasswort-123456", globalVerwalter: true });
    expect(screen.getByText(de.verwaltung.benutzer.angelegtText("Neue Person"))).toBeTruthy();
  });

  it("sperrt eine Person und zeigt LETZTER_VERWALTER übersetzt", async () => {
    const api = verwaltungApi({
      [`PATCH /api/v1/benutzer/${BERTA}`]: fehler(409, "LETZTER_VERWALTER"),
    });
    rendereApp("/verwaltung");
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Berta Beispiel sperren" }));
    expect((await screen.findByRole("alert")).textContent).toContain(de.fehler.LETZTER_VERWALTER);
    expect(api.anfragen("PATCH", `/api/v1/benutzer/${BERTA}`)[0]!.koerper).toEqual({ aktiv: false });
  });
});

describe("Verwaltung: Rollen", () => {
  it("weist eine Rolle zu, ändert sie und entzieht sie (204 ohne Körper)", async () => {
    const api = verwaltungApi({
      [`PUT /api/v1/fonds/${FONDS_ID}/rollen/${ICH_ID}`]: { koerper: { benutzerId: ICH_ID, fondsId: FONDS_ID, rolle: "freigeber" } },
      [`PUT /api/v1/fonds/${FONDS_ID}/rollen/${BERTA}`]: { koerper: {} },
      [`DELETE /api/v1/fonds/${FONDS_ID}/rollen/${BERTA}`]: { status: 204, koerper: null },
    });
    rendereApp("/verwaltung?bereich=rollen");
    const nutzer = userEvent.setup();
    const bereich = within(await screen.findByRole("region", { name: "Rollen je Fonds" }));
    expect(await bereich.findByText("Berta Beispiel")).toBeTruthy();
    await nutzer.selectOptions(bereich.getByRole("combobox", { name: "Person" }), ICH_ID);
    await nutzer.selectOptions(bereich.getByRole("combobox", { name: /^Rolle$/ }), "freigeber");
    await nutzer.click(bereich.getByRole("button", { name: "Rolle zuweisen" }));
    await waitFor(() => expect(api.anfragen("PUT", `/api/v1/fonds/${FONDS_ID}/rollen/${ICH_ID}`)).toHaveLength(1));
    expect(api.anfragen("PUT", `/api/v1/fonds/${FONDS_ID}/rollen/${ICH_ID}`)[0]!.koerper).toEqual({ rolle: "freigeber" });

    await nutzer.selectOptions(bereich.getByRole("combobox", { name: "Rolle von Berta Beispiel" }), "freigeber");
    await waitFor(() => expect(api.anfragen("PUT", `/api/v1/fonds/${FONDS_ID}/rollen/${BERTA}`)).toHaveLength(1));

    await nutzer.click(bereich.getByRole("button", { name: "Berta Beispiel die Rolle an diesem Fonds entziehen" }));
    await waitFor(() => expect(api.anfragen("DELETE", `/api/v1/fonds/${FONDS_ID}/rollen/${BERTA}`)).toHaveLength(1));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("Verwaltung: Rollen und Gruppen", () => {
  const ROLLE_ID = "55555555-5555-4555-8555-555555555555";
  const GRUPPE_ID = "44444444-4444-4444-8444-444444444444";
  const stand = {
    fondsOffen: true,
    bereiche: ["portfolio", "finanzen", "kennzahlen", "berichte", "meldewesen", "dealflow", "kontakte", "dokumente", "daten", "fondsverwaltung"],
    rollen: [{ id: ROLLE_ID, name: "Kontakte", beschreibung: null, bereiche: ["kontakte"], bereichStufen: {}, erstelltAm: "2026-11-01T00:00:00.000Z" }],
    gruppen: [{ id: GRUPPE_ID, name: "Relationship Management", beschreibung: null, stufe: "bearbeiter", fondsBeschraenkt: false, bereicheJeFonds: false, fondsIds: [], fondsBereiche: {}, rollenIds: [ROLLE_ID], mitglieder: [BERTA], erstelltAm: "2026-11-01T00:00:00.000Z" }],
  };

  it("zeigt Fondszugriff, Rollen und Gruppen, legt eine Rolle mit Bereichen an und stellt den Fondszugriff um", async () => {
    const api = verwaltungApi({
      "/api/v1/rechte": { koerper: stand },
      "POST /api/v1/rechte/rollen": { status: 201, koerper: { ...stand.rollen[0], id: "neu", name: "Controlling", bereiche: ["finanzen", "berichte"] } },
      "PUT /api/v1/rechte/einstellung": { koerper: { fondsOffen: false } },
    });
    rendereApp("/verwaltung?bereich=rechte");
    const nutzer = userEvent.setup();
    expect(await screen.findByText("Relationship Management")).toBeTruthy();
    expect(screen.getAllByText("Kontakte").length).toBeGreaterThan(0);
    expect(screen.getByText(de.verwaltung.rechte.alleFonds)).toBeTruthy();

    await nutzer.click(screen.getByRole("button", { name: de.verwaltung.rechte.rolleAnlegen }));
    const dialog = within(await screen.findByRole("dialog", { name: de.verwaltung.rechte.rolleNeu }));
    await nutzer.type(dialog.getByLabelText("Name"), "Controlling");
    await nutzer.click(dialog.getByLabelText("Finanzen und Buchhaltung"));
    await nutzer.click(dialog.getByLabelText("Berichte"));
    // Höchste Stufe je Bereich: Finanzen nur lesen, Berichte ohne Grenze.
    await nutzer.selectOptions(dialog.getByLabelText(`${de.verwaltung.rechte.grenze}: Finanzen und Buchhaltung`), "betrachter");
    await nutzer.click(dialog.getByRole("button", { name: de.verwaltung.rechte.speichern }));
    await waitFor(() => expect(api.anfragen("POST", "/api/v1/rechte/rollen")).toHaveLength(1));
    expect(api.anfragen("POST", "/api/v1/rechte/rollen")[0]!.koerper).toEqual({ name: "Controlling", beschreibung: null, bereiche: ["finanzen", "berichte"], bereichStufen: { finanzen: "betrachter" } });

    await nutzer.click(screen.getByRole("button", { name: de.verwaltung.rechte.zugriff.zugewiesen }));
    await waitFor(() => expect(api.anfragen("PUT", "/api/v1/rechte/einstellung")).toHaveLength(1));
    expect(api.anfragen("PUT", "/api/v1/rechte/einstellung")[0]!.koerper).toEqual({ fondsOffen: false });
  });

  it("Gruppe mit Bereichen je Fonds: Auswahl je Fonds aus den Bereichen ihrer Rollen", async () => {
    const api = verwaltungApi({
      "/api/v1/rechte": { koerper: stand },
      [`PATCH /api/v1/rechte/gruppen/${GRUPPE_ID}`]: { koerper: { ...stand.gruppen[0], fondsBeschraenkt: true, bereicheJeFonds: true, fondsIds: [FONDS_ID], fondsBereiche: { [FONDS_ID]: ["kontakte"] } } },
    });
    rendereApp("/verwaltung?bereich=rechte");
    const nutzer = userEvent.setup();
    expect(await screen.findByText("Relationship Management")).toBeTruthy();
    const gruppen = within(screen.getByRole("region", { name: de.verwaltung.rechte.gruppenTitel }));
    await nutzer.click(gruppen.getByRole("button", { name: "Weitere Aktionen" }));
    await nutzer.click(await screen.findByRole("menuitem", { name: de.verwaltung.rechte.bearbeiten }));
    const dialog = within(await screen.findByRole("dialog", { name: "Relationship Management" }));
    await nutzer.click(dialog.getByLabelText(de.verwaltung.rechte.fondsBeschraenkt));
    await nutzer.click(dialog.getByLabelText("Beispielfonds I"));
    await nutzer.click(dialog.getByLabelText(de.verwaltung.rechte.bereicheJeFonds));
    const jeFonds = within(dialog.getByRole("group", { name: de.verwaltung.rechte.bereicheJeFondsLegende("Beispielfonds I") }));
    await nutzer.click(jeFonds.getByLabelText("Kontakte"));
    await nutzer.click(dialog.getByRole("button", { name: de.verwaltung.rechte.speichern }));
    await waitFor(() => expect(api.anfragen("PATCH", `/api/v1/rechte/gruppen/${GRUPPE_ID}`)).toHaveLength(1));
    expect(api.anfragen("PATCH", `/api/v1/rechte/gruppen/${GRUPPE_ID}`)[0]!.koerper).toMatchObject({ fondsBeschraenkt: true, bereicheJeFonds: true, fondsIds: [FONDS_ID], fondsBereiche: { [FONDS_ID]: ["kontakte"] } });
  });
});

describe("Verwaltung: API-Schlüssel", () => {
  it("zeigt den neuen Schlüssel genau einmal, nicht im Cache, und die Liste danach nur mit Vorschau", async () => {
    const klartext = "cwk_GEHEIMER-KLARTEXT-nur-einmal-0123456789";
    const api = verwaltungApi({ "POST /api/v1/api-schluessel": { status: 201, koerper: { ...schluesselZeile({ name: "Neuer Schlüssel", vorschau: "cwk_GEHEIM" }), schluessel: klartext } } });
    const { queryClient } = rendereApp("/verwaltung?bereich=schluessel");
    const nutzer = userEvent.setup();
    expect(await screen.findByText("cwk_ab12cd…")).toBeTruthy();
    await nutzer.click(screen.getByRole("button", { name: "Schlüssel anlegen" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Schlüssel anlegen" }));
    await nutzer.click(dialog.getByRole("button", { name: "Schlüssel anlegen" }));
    expect(dialog.getByText(de.verwaltung.schluessel.form.nameFehlt)).toBeTruthy();
    await nutzer.type(dialog.getByLabelText("Name"), "Neuer Schlüssel");
    await nutzer.selectOptions(dialog.getByLabelText("Beispielfonds I"), "schreiben");
    await nutzer.click(dialog.getByRole("button", { name: "Schlüssel anlegen" }));

    const erzeugt = within(await screen.findByRole("dialog", { name: "Schlüssel angelegt" }));
    expect(erzeugt.getByText(klartext)).toBeTruthy();
    expect(erzeugt.getByText(de.verwaltung.schluessel.form.einmaligText)).toBeTruthy();
    expect(erzeugt.getByRole("button", { name: "Schlüssel kopieren" })).toBeTruthy();
    const anfrage = api.anfragen("POST", "/api/v1/api-schluessel")[0]!.koerper as { name: string; scopes: unknown; ablauf: string };
    expect(anfrage.name).toBe("Neuer Schlüssel");
    expect(anfrage.scopes).toEqual([{ fondsId: FONDS_ID, recht: "schreiben" }]);
    // Der Klartext liegt in keinem Cache.
    const alleDaten = JSON.stringify([...queryClient.getQueryCache().getAll().map((q) => q.state.data), ...queryClient.getMutationCache().getAll().map((m) => m.state.data)]);
    expect(alleDaten).not.toContain("GEHEIMER-KLARTEXT");

    await nutzer.click(erzeugt.getByRole("button", { name: "Schließen" }));
    expect(screen.queryByText(klartext)).toBeNull();
    await nutzer.click(screen.getByRole("button", { name: "Schlüssel anlegen" }));
    expect(screen.queryByText(klartext)).toBeNull();
  });

  it("widerruft einen Schlüssel erst nach einer zweiten Bestätigung", async () => {
    const api = verwaltungApi({ [`DELETE /api/v1/api-schluessel/${SCHLUESSEL_ID}`]: { koerper: schluesselZeile({ status: "widerrufen", widerrufenAm: "2026-11-20T00:00:00.000Z" }) } });
    rendereApp("/verwaltung?bereich=schluessel");
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Schlüssel Berichtsexport widerrufen" }));
    expect(api.anfragen("DELETE", `/api/v1/api-schluessel/${SCHLUESSEL_ID}`)).toHaveLength(0);
    await nutzer.click(screen.getByRole("button", { name: "Schlüssel Berichtsexport endgültig widerrufen" }));
    await waitFor(() => expect(api.anfragen("DELETE", `/api/v1/api-schluessel/${SCHLUESSEL_ID}`)).toHaveLength(1));
  });
});

describe("Verwaltung: Periodensperre", () => {
  it("zeigt die Sperre, schiebt sie vor, und verlangt beim Zurücknehmen einen Grund (am Formular und vom Server)", async () => {
    let versuche = 0;
    const api = verwaltungApi({
      [`PUT /api/v1/fonds/${FONDS_ID}/periodensperre`]: () => {
        versuche++;
        return versuche === 2
          ? { status: 400, koerper: { fehler: { code: "EINGABE_UNGUELTIG", meldung: "x", felder: [{ feld: "grund", code: "grund_erforderlich", meldung: "x" }] } } }
          : { koerper: sperre({ gesperrtBis: "2026-09-30" }) };
      },
    });
    rendereApp("/verwaltung?bereich=sperre");
    const nutzer = userEvent.setup();
    const bereich = within(await screen.findByRole("region", { name: "Periodensperre" }));
    expect(await bereich.findByText("30.06.2026")).toBeTruthy();
    expect(bereich.getByText(/Vera Beispiel, /)).toBeTruthy();
    expect(bereich.getByText("Quartal abgeschlossen")).toBeTruthy();

    const datum = bereich.getByLabelText("Neues Sperrdatum");
    fireEvent.change(datum, { target: { value: "2026-09-30" } });
    await nutzer.click(bereich.getByRole("button", { name: "Sperre setzen" }));
    await waitFor(() => expect(api.anfragen("PUT", `/api/v1/fonds/${FONDS_ID}/periodensperre`)).toHaveLength(1));
    expect(api.anfragen("PUT", `/api/v1/fonds/${FONDS_ID}/periodensperre`)[0]!.koerper).toEqual({ gesperrtBis: "2026-09-30" });
    expect(await bereich.findByText(de.verwaltung.sperre.gesetztMeldung)).toBeTruthy();

    // zurück: Begründung wird Pflicht, ohne Begründung wird nichts gesendet
    fireEvent.change(datum, { target: { value: "2026-03-31" } });
    expect(bereich.getByText(de.verwaltung.sperre.zurueckHinweis)).toBeTruthy();
    await nutzer.click(bereich.getByRole("button", { name: "Sperre zurücknehmen" }));
    expect(bereich.getByText(feldpruefungTexte.de.pflicht)).toBeTruthy();
    expect(api.anfragen("PUT", `/api/v1/fonds/${FONDS_ID}/periodensperre`)).toHaveLength(1);
    await nutzer.type(bereich.getByLabelText(/Begründung/), "Korrektur Q1");
    await nutzer.click(bereich.getByRole("button", { name: "Sperre zurücknehmen" }));
    // der Server lehnt (hier gespielt) trotzdem ab: Feldfehler am Feld
    expect(await bereich.findByText(de.feldfehler.grund_erforderlich)).toBeTruthy();
    expect(api.anfragen("PUT", `/api/v1/fonds/${FONDS_ID}/periodensperre`)[1]!.koerper).toEqual({ gesperrtBis: "2026-03-31", grund: "Korrektur Q1" });
  });
});

describe("Verwaltung: Sprache", () => {
  it("steht auf Englisch, das Verzeichnis ist gegliedert und lässt sich mit Tab und Enter bedienen", async () => {
    localStorage.setItem("carraway.sprache", "en");
    verwaltungApi();
    const { router } = rendereApp("/verwaltung");
    const nutzer = userEvent.setup();
    expect(await screen.findByRole("heading", { name: new RegExp(en.verwaltung.titel, "i") })).toBeTruthy();
    const verzeichnis = within(screen.getByRole("navigation", { name: en.verwaltung.bereiche }));
    expect(verzeichnis.getByRole("list", { name: "Access" })).toBeTruthy();
    expect(verzeichnis.getByRole("list", { name: "Business rules" })).toBeTruthy();
    expect(verzeichnis.getByRole("list", { name: "Operations" })).toBeTruthy();
    expect(verzeichnis.getByRole("button", { name: "Users" }).getAttribute("aria-current")).toBe("page");
    const eintrag = verzeichnis.getByRole("button", { name: "Roles and groups" });
    eintrag.focus();
    await nutzer.keyboard("{Enter}");
    await waitFor(() => expect(router.state.location.search).toMatchObject({ tab: "rechte" }));
    expect(verzeichnis.getByRole("button", { name: "Roles and groups" }).getAttribute("aria-current")).toBe("page");
    await nutzer.click(verzeichnis.getByRole("button", { name: "Roles per fund" }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ tab: "rollen" }));
    expect(await screen.findByRole("region", { name: "Roles per fund" })).toBeTruthy();
  });

  it("gliedert die neun Bereiche des Kerns in Zugänge, fachliche Vorgaben und Betrieb und öffnet die bisherigen Adressen", async () => {
    verwaltungApi();
    rendereApp("/verwaltung?tab=sperre");
    const verzeichnis = within(await screen.findByRole("navigation", { name: de.verwaltung.bereiche }));
    const namen = (gruppe: string) => within(verzeichnis.getByRole("list", { name: gruppe })).getAllByRole("button").map((k) => k.textContent);
    expect(namen("Zugänge")).toEqual(["Benutzer", "Rollen und Gruppen", "Rollen je Fonds", "API-Schlüssel"]);
    expect(namen("Fachliche Vorgaben")).toEqual(["Kennzahlen", "Meldewesen", "Wechselkurse"]);
    expect(namen("Betrieb")).toEqual(["Periodensperre", "Export und API", "Betrieb"]);
    expect(verzeichnis.getByRole("button", { name: "Periodensperre" }).getAttribute("aria-current")).toBe("page");
    expect(await screen.findByRole("region", { name: "Periodensperre" })).toBeTruthy();
  });
});

describe("Verwaltung: Export und API", () => {
  it("bietet globalen Verwaltern den Vollexport als Download mit Erklärung und den Link zur API-Dokumentation", async () => {
    verwaltungApi();
    rendereApp("/verwaltung?bereich=daten");
    const knopf = await screen.findByRole("link", { name: de.datenuebernahme.export.knopf });
    expect(knopf.getAttribute("href")).toBe("/api/v1/export?format=zip");
    expect(knopf.hasAttribute("download")).toBe(true);
    // Erklärung: was drin ist, was nicht, dass es protokolliert wird
    expect(screen.getByText(de.datenuebernahme.export.enthaeltListe[1]!)).toBeTruthy();
    expect(screen.getByText(de.datenuebernahme.export.ausgeschlossenListe[0]!)).toBeTruthy();
    expect(screen.getByText(de.datenuebernahme.export.protokolliert)).toBeTruthy();
    const doku = screen.getByRole("link", { name: de.datenuebernahme.api.doku });
    expect(doku.getAttribute("href")).toBe("/api/v1/docs");
    expect(doku.getAttribute("target")).toBe("_blank");
    expect(doku.getAttribute("rel")).toContain("noopener");
    // Hilfe für Integrationen: Idempotency-Key und Stapel
    expect(screen.getByText(/Idempotency-Key: Schicken Sie/)).toBeTruthy();
    expect(screen.getByText(/POST \/api\/v1\/stapel: bis zu 100/)).toBeTruthy();
  });

  it("zeigt den Export nicht, wenn die Person keine globale Verwaltung hat (Weiterleitung)", async () => {
    verwaltungApi({ "/api/v1/ich": alsRolle("verwalter") });
    const { router } = rendereApp("/verwaltung?bereich=daten");
    await waitFor(() => expect(router.state.location.pathname).toBe(`/fonds/${FONDS_ID}`));
    expect(screen.queryByRole("link", { name: de.datenuebernahme.export.knopf })).toBeNull();
  });

  it("zeigt gelöschte Dokumente mit dem Datum, ab dem die Datei entfernt wird, und den Grund, wenn sie bleibt", async () => {
    verwaltungApi({
      "/api/v1/dokumente/aufbewahrung": {
        koerper: {
          aufbewahrungTage: 30,
          endgueltigGeloescht: 2,
          daten: [
            { id: "d1", dateiname: "vertrag-alt.pdf", groesse: 1000, geloeschtAm: "2026-10-01T08:00:00.000Z", geloeschtVon: ICH_ID, entferntAb: "2026-10-31T08:00:00.000Z", faellig: true, haltegrund: "fundstelle" },
            { id: "d2", dateiname: "protokoll.pdf", groesse: 1000, geloeschtAm: "2026-11-10T08:00:00.000Z", geloeschtVon: ICH_ID, entferntAb: "2026-12-10T08:00:00.000Z", faellig: false, haltegrund: null },
          ],
        },
      },
    });
    rendereApp("/verwaltung?bereich=daten");
    const tabelle = await screen.findByRole("region", { name: de.datenuebernahme.aufbewahrung.tabelle });
    expect(within(tabelle).getByText("vertrag-alt.pdf")).toBeTruthy();
    expect(within(tabelle).getByText(de.datenuebernahme.aufbewahrung.haltegrund.fundstelle!)).toBeTruthy();
    expect(within(tabelle).getByText("10.12.2026")).toBeTruthy();
    expect(within(tabelle).getByText(de.datenuebernahme.aufbewahrung.stand.wartet)).toBeTruthy();
    expect(screen.getByText(de.datenuebernahme.aufbewahrung.text(30))).toBeTruthy();
    expect(screen.getByText(de.datenuebernahme.aufbewahrung.endgueltig(2))).toBeTruthy();
  });

  it("holt die Fassungen früher freigegebener LP-Berichte nach und zeigt Ergebnis und übersprungene Berichte", async () => {
    const api = verwaltungApi({
      "POST /api/v1/berichte/varianten-nachholen": { koerper: { geprueft: 2, angelegt: [{ berichtId: "b1", varianten: 3 }], uebersprungen: [{ berichtId: "b2", grund: "nicht_reproduzierbar" }] } },
    });
    rendereApp("/verwaltung?bereich=daten");
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: de.datenuebernahme.varianten.knopf }));
    await waitFor(() => expect(api.anfragen("POST", "/api/v1/berichte/varianten-nachholen")).toHaveLength(1));
    expect(await screen.findByText(de.datenuebernahme.varianten.ergebnis(2, 1))).toBeTruthy();
    expect(screen.getByText(de.datenuebernahme.varianten.uebersprungen(de.datenuebernahme.varianten.gruende.nicht_reproduzierbar!, "b2"))).toBeTruthy();
  });

  it("beschriftet Export und API auf Englisch", async () => {
    localStorage.setItem("carraway.sprache", "en");
    verwaltungApi();
    rendereApp("/verwaltung?bereich=daten");
    expect(await screen.findByRole("link", { name: en.datenuebernahme.export.knopf })).toBeTruthy();
    expect(screen.getByRole("link", { name: en.datenuebernahme.api.doku })).toBeTruthy();
    expect(screen.getByRole("button", { name: en.verwaltung.reiter.daten }).getAttribute("aria-current")).toBe("page");
  });
});

const betriebStatus = (extra: Record<string, unknown> = {}) => ({
  ampel: "warnung",
  erzeugtAm: "2026-11-21T10:15:00.000Z",
  datenbank: { erreichbar: true },
  migrationen: { ok: true, bekannt: 45, angewendet: 45, meldung: null },
  worker: { status: "ausgefallen", herzschlagAlterSekunden: 125, grenzeSekunden: 30 },
  rueckstaende: {
    snapshots: { anzahl: 0, aeltesterSekunden: 0 },
    mail: { anzahl: 3, aeltesterSekunden: 700 },
    auslesung: null,
    register: { anzahl: 0, aeltesterSekunden: 0 },
    warnungSekunden: 300,
  },
  speicher: { beschreibbar: true },
  smtp: { konfiguriert: false },
  erweiterungen: {},
  ...extra,
});

describe("Verwaltung: Betrieb", () => {
  it("zeigt Datenbank, Migrationen, Worker, Rückstände, Ablage und SMTP", async () => {
    verwaltungApi({ "/api/v1/betrieb/status": { koerper: betriebStatus() } });
    rendereApp("/verwaltung?bereich=betrieb");
    const tabelle = within(await screen.findByRole("region", { name: de.verwaltung.betrieb.tabelle }));
    expect(tabelle.getByText("Alle 45 Migrationen angewendet")).toBeTruthy();
    expect(tabelle.getByText("Letzter Herzschlag vor 2 min, der Worker gilt als ausgefallen")).toBeTruthy();
    expect(tabelle.getByText("3 wartend, der älteste seit 12 min")).toBeTruthy();
    expect(tabelle.getByText(de.verwaltung.betrieb.smtp.aus)).toBeTruthy();
    // Rückstand der KI-Auslesung und KI-Anbieter zeigt nur der Build „Voll“ (ee/web/src/kern-tests/Verwaltung.test.tsx).
    expect(tabelle.queryByText(de.verwaltung.betrieb.ki.name)).toBeNull();
    expect(screen.getAllByText(de.verwaltung.betrieb.ampel.warnung).length).toBeGreaterThan(1);
  });

  it("meldet eine Störung bei falschem Migrationsstand und nicht beschreibbarer Ablage", async () => {
    verwaltungApi({
      "/api/v1/betrieb/status": { koerper: betriebStatus({ ampel: "fehler", migrationen: { ok: false, bekannt: 45, angewendet: 44, meldung: "fehlt" }, speicher: { beschreibbar: false } }) },
    });
    rendereApp("/verwaltung?bereich=betrieb");
    expect(await screen.findByText(de.verwaltung.betrieb.migrationen.fehler)).toBeTruthy();
    expect(screen.getByText(de.verwaltung.betrieb.speicher.fehler)).toBeTruthy();
    expect(screen.getAllByText(de.verwaltung.betrieb.ampel.fehler).length).toBeGreaterThan(1);
  });

  it("beschriftet den Bereich auf Englisch", async () => {
    localStorage.setItem("carraway.sprache", "en");
    verwaltungApi({ "/api/v1/betrieb/status": { koerper: betriebStatus({ ampel: "ok", worker: { status: "ok", herzschlagAlterSekunden: 4, grenzeSekunden: 30 }, smtp: { konfiguriert: true } }) } });
    rendereApp("/verwaltung?bereich=betrieb");
    const tabelle = within(await screen.findByRole("region", { name: en.verwaltung.betrieb.tabelle }));
    expect(tabelle.getByText("Last heartbeat 4 s ago")).toBeTruthy();
    expect(tabelle.getByText(en.verwaltung.betrieb.smtp.an)).toBeTruthy();
    expect(screen.getByRole("button", { name: en.verwaltung.reiter.betrieb }).getAttribute("aria-current")).toBe("page");
  });
});

describe("Verwaltung: Einladung per Mail", () => {
  const MIT_MAIL = { koerper: { umgebung: "echt", einrichtungOffen: false, anmeldung: { zweiFaktorPflicht: true, registrierungOffen: false, anbieter: [], passwortZuruecksetzen: true } } };
  const eingeladen = person("e1", "Emil Eingeladen", { einladungOffen: true, zweiFaktorAktiv: false });

  it("ohne Mailversand gibt es nur das Startpasswort", async () => {
    verwaltungApi();
    rendereApp("/verwaltung");
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Benutzer anlegen" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Benutzer anlegen" }));
    expect(dialog.queryByLabelText(de.verwaltung.einladung.zugang)).toBeNull();
    expect(dialog.getByLabelText("Startpasswort")).toBeTruthy();
  });

  it("mit Mailversand lädt der Dialog ohne Passwort ein und sendet die Sprache der Oberfläche", async () => {
    const api = verwaltungApi({ "/api/v1/umgebung": MIT_MAIL, "POST /api/v1/benutzer": { status: 201, koerper: { id: "n1", name: "Neue Person", email: "neu@beispiel.example", aktiv: true, globalVerwalter: false, einladung: true } } });
    rendereApp("/verwaltung");
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Benutzer anlegen" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Benutzer anlegen" }));
    await nutzer.type(dialog.getByLabelText("Name"), "Neue Person");
    await nutzer.type(dialog.getByLabelText("E-Mail-Adresse"), "neu@beispiel.example");
    await nutzer.selectOptions(dialog.getByLabelText(de.verwaltung.einladung.zugang), "einladung");
    expect(dialog.queryByLabelText("Startpasswort")).toBeNull();
    expect(dialog.getByText(de.verwaltung.einladung.mailHilfe)).toBeTruthy();
    await nutzer.click(dialog.getByRole("button", { name: "Benutzer anlegen" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.anfragen("POST", "/api/v1/benutzer")[0]!.koerper).toEqual({ name: "Neue Person", email: "neu@beispiel.example", globalVerwalter: false, sprache: "de" });
    expect(screen.getByText(de.verwaltung.einladung.angelegtText("Neue Person"))).toBeTruthy();
  });

  it("zeigt offene Einladungen und sendet sie erneut", async () => {
    const api = verwaltungApi({
      "/api/v1/umgebung": MIT_MAIL,
      "/api/v1/benutzer": { koerper: { daten: [...benutzer.daten, eingeladen] } },
      [`POST /api/v1/benutzer/e1/einladung`]: { status: 204, koerper: null },
    });
    rendereApp("/verwaltung");
    const tabelle = await karteInnen("Benutzer");
    expect(within(tabelle).getByText(de.verwaltung.einladung.offen)).toBeTruthy();
    await userEvent.setup().click(within(tabelle).getByRole("button", { name: de.verwaltung.einladung.erneutFuer("Emil Eingeladen") }));
    expect(await screen.findByText(de.verwaltung.einladung.erneutGesendet("Emil Eingeladen"))).toBeTruthy();
    expect(api.anfragen("POST", "/api/v1/benutzer/e1/einladung")[0]!.koerper).toEqual({ sprache: "de" });
  });

  it("Texte der Einladung sind auf Englisch vorhanden", () => {
    expect(en.verwaltung.einladung.perMail).not.toBe(de.verwaltung.einladung.perMail);
    expect(en.verwaltung.einladung.angelegtText("X")).toContain("72 hours");
  });
});
