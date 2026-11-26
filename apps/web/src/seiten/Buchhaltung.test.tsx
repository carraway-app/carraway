import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ANDERE_ID, FONDS_ID, ICH_ID, ZL_ID, alsRolle, fehler, fondsDaten, namenDaten, rendereApp, spieleApi, zinslaufDaten, zinslaufListeDaten } from "../test/hilfen";

/** Karte im Inhalt eines Bereichs: Der Inhaltsbereich selbst trägt als Region den Namen des Eintrags und wird hier übergangen. */
const karteInnen = (name: string) =>
  waitFor(() => {
    const karte = screen.queryAllByRole("region", { name }).find((r) => !r.classList.contains("cw-inhalt__bereich"));
    if (!karte) throw new Error(`Karte ${name} fehlt`);
    return karte;
  });

const schmal = (text: string | null) => (text ?? "").replace(/\s/g, " ");
const dialog = () => within(screen.getByRole("dialog"));
const englisch = () => localStorage.setItem("carraway.sprache", "en");

const BELEG_ID = "be-1";
const beleg = (extra: Record<string, unknown> = {}) => ({
  id: BELEG_ID,
  fondsId: FONDS_ID,
  art: "auszahlung",
  bezugArt: "vorgang",
  bezugId: "v1",
  beteiligungId: "b1",
  sprache: "de",
  status: "entwurf",
  belegnummer: null as string | null,
  naechsteStufe: 0,
  erstelltVon: ANDERE_ID,
  erstelltAm: "2026-11-20T09:00:00.000Z",
  freigegebenAm: null,
  befunde: [] as { feld: string; code: string }[],
  vorlage: {
    felder: [
      { schluessel: "organisation_name", abschnitt: "kopf", pflicht: true },
      { schluessel: "betrag", abschnitt: "kopf", pflicht: true },
      { schluessel: "projektnummer", abschnitt: "details", pflicht: true },
    ],
  },
  daten: {
    datum: "2026-03-31",
    betrag: "100000.00",
    werte: { organisation_name: "Alpha Energie", betrag: "100000.00", projektnummer: "P-100" } as Record<string, string | null>,
    mittelherkunft: [
      { schluessel: "eigenmittel", bezeichnungDe: "Eigenmittel", bezeichnungEn: "Own funds", quote: "0.400000", betrag: "40000.00" },
      { schluessel: "landesmittel", bezeichnungDe: "Landesmittel", bezeichnungEn: "State funds", quote: "0.600000", betrag: "60000.00" },
    ],
  },
  stufen: ["Prüfung", "Freigabe"],
  protokoll: [] as unknown[],
  naechsteStufeName: "Prüfung" as string | null,
  dateiSha256: null as string | null,
  ...extra,
});
const belegZeile = (extra: Record<string, unknown> = {}) => ({ ...beleg(), betrag: "100000.00", datum: "2026-03-31", ...extra });

describe("Belege: Liste", () => {
  it("listet Nummer, Art, Datum, Betrag, Status und fehlende Angaben und führt zum Beleg", async () => {
    const api = spieleApi({
      "/api/v1/belege": { koerper: { daten: [belegZeile({ befunde: [{ feld: "projektnummer", code: "pflichtfeld_fehlt" }] }), belegZeile({ id: "be-2", art: "zinsbuchung", status: "freigegeben", belegnummer: "B-000007", betrag: "6000.00", datum: "2026-09-30" })] } },
    });
    rendereApp("/belege");
    const nutzer = userEvent.setup();
    const bereich = await screen.findByRole("region", { name: "Belege des Fonds" });
    const zeilen = within(bereich).getAllByRole("row");
    expect(zeilen[1]!.textContent).toContain("Auszahlung");
    expect(zeilen[1]!.textContent).toContain("ohne Nummer");
    expect(zeilen[1]!.textContent).toContain("31.03.2026");
    expect(schmal(zeilen[1]!.textContent)).toContain("100.000,00 €");
    expect(zeilen[1]!.textContent).toContain("Entwurf");
    expect(zeilen[1]!.textContent).toContain("1 Angabe fehlt");
    expect(zeilen[2]!.textContent).toContain("B-000007");
    expect(zeilen[2]!.textContent).toContain("Freigegeben");
    expect(api.anfragen("GET", "/api/v1/belege")[0]!.query.get("fondsId")).toBe(FONDS_ID);
    // Nur über die Navigation erreichbar, Filter nach Status
    await nutzer.selectOptions(screen.getByLabelText("Status"), "freigegeben");
    await waitFor(() => expect(api.anfragen("GET", "/api/v1/belege").some((a) => a.query.get("status") === "freigegeben")).toBe(true));
  });

  it("englisch: Texte, Beträge und Daten in der Sprache der Oberfläche", async () => {
    englisch();
    spieleApi({ "/api/v1/belege": { koerper: { daten: [belegZeile()] } } });
    rendereApp("/belege");
    const bereich = await screen.findByRole("region", { name: "Vouchers of the fund" });
    const zeile = within(bereich).getAllByRole("row")[1]!;
    expect(zeile.textContent).toContain("Disbursement");
    expect(zeile.textContent).toContain("no number");
    expect(zeile.textContent).toContain("31/03/2026");
    expect(schmal(zeile.textContent)).toContain("€100,000.00");
    expect(zeile.textContent).toContain("Draft");
  });

  it("ist über die Navigation erreichbar", async () => {
    spieleApi({ "/api/v1/belege": { koerper: { daten: [] } } });
    rendereApp(`/fonds/${FONDS_ID}`);
    await userEvent.setup().click(await screen.findByRole("link", { name: "Belege" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Belege" })).toBeTruthy();
    expect(screen.getByText(/Noch keine Belege/)).toBeTruthy();
  });
});

describe("Beleg: Prüfung und Freigabe", () => {
  it("zeigt fehlende eigene Pflichtfelder beim Namen und speichert die Eingabe am Entwurf", async () => {
    const pfad = `/api/v1/belege/${BELEG_ID}`;
    const feld = { schluessel: "eigen_referenz", manuell: "text", abschnitt: "details", pflicht: true, bezeichnungDe: "Referenz", bezeichnungEn: "Reference" };
    const api = spieleApi({
      [pfad]: { koerper: beleg({ vorlage: { felder: [feld] }, befunde: [{ feld: feld.schluessel, code: "pflichtfeld_fehlt" }] }) },
      [`PATCH ${pfad}/feldwerte`]: { koerper: beleg() },
    });
    rendereApp(`/belege/${BELEG_ID}`);
    const nutzer = userEvent.setup();
    expect(await screen.findByText(/Diese Pflichtfelder sind leer: Referenz/)).toBeTruthy();
    await nutzer.type(screen.getByLabelText("Referenz *"), "V-17");
    await nutzer.click(screen.getByRole("button", { name: "Feldwerte speichern" }));
    await waitFor(() => expect(api.anfragen("PATCH", `${pfad}/feldwerte`)[0]?.koerper).toEqual({ werte: { eigen_referenz: "V-17" } }));
  });

  it("verwendet beim Direktlink den Fonds des Belegs und wechselt zur Belegliste", async () => {
    const zweiter = { ...fondsDaten.daten[0]!, id: "22222222-2222-4222-8222-222222222222", name: "Beispielfonds II" };
    localStorage.setItem("carraway.fonds", zweiter.id);
    spieleApi({
      "/api/v1/fonds": { koerper: { daten: [...fondsDaten.daten, zweiter] } },
      [`/api/v1/belege/${BELEG_ID}`]: { koerper: beleg() },
      "/api/v1/belege": { koerper: { daten: [] } },
    });
    const { router } = rendereApp(`/belege/${BELEG_ID}`);
    const nav = within(await screen.findByRole("navigation", { name: "Hauptnavigation" }));
    expect(nav.getByRole("link", { name: "Journal" }).getAttribute("href")).toBe(`/fonds/${FONDS_ID}/journal`);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Fonds" }), zweiter.id);
    await waitFor(() => expect(router.state.location.pathname).toBe("/belege"));
    expect(router.state.location.search).toEqual({ fondsId: zweiter.id });
  });

  it("zeigt Angaben, Mittelherkunft und fehlende Pflichtfelder; die Stufe ist gesperrt, bis nichts mehr fehlt", async () => {
    spieleApi({
      [`/api/v1/belege/${BELEG_ID}`]: { koerper: beleg({ befunde: [{ feld: "projektnummer", code: "pflichtfeld_fehlt" }], daten: { ...beleg().daten, werte: { organisation_name: "Alpha Energie", betrag: "100000.00", projektnummer: null } } }) },
    });
    rendereApp(`/belege/${BELEG_ID}`);
    expect(await screen.findByRole("heading", { level: 1, name: "Auszahlung" })).toBeTruthy();
    const angaben = within(screen.getByRole("region", { name: "Angaben" }));
    expect(angaben.getByText("Alpha Energie")).toBeTruthy();
    expect(angaben.getByText("fehlt")).toBeTruthy();
    expect(screen.getByText("Pflichtangaben fehlen")).toBeTruthy();
    expect(screen.getByText(/Diese Pflichtfelder sind leer: Projektnummer/)).toBeTruthy();
    const mittel = within(screen.getByRole("region", { name: "Mittelherkunft" }));
    expect(mittel.getByText("Landesmittel")).toBeTruthy();
    expect(schmal(mittel.getByText(/60.000,00/).textContent)).toContain("60.000,00 €");
    expect(mittel.getByText("60 %") ?? mittel.getByText(/60/)).toBeTruthy();
    const knopf = screen.getByRole("button", { name: "Prüfung erteilen" }) as HTMLButtonElement;
    expect(knopf.disabled).toBe(true);
    expect(screen.getByText("Pflichtangaben fehlen.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "PDF-Entwurf öffnen" }).getAttribute("href")).toBe(`/api/v1/belege/${BELEG_ID}/datei`);
  });

  it("erteilt die Prüfung, verlangt für die Rückgabe einen Kommentar und sperrt die Person, die den Beleg erzeugt hat", async () => {
    const api = spieleApi({
      [`/api/v1/belege/${BELEG_ID}`]: { koerper: beleg() },
      "/api/v1/benutzer/namen": { koerper: namenDaten },
      [`POST /api/v1/belege/${BELEG_ID}/stufe`]: { koerper: beleg({ status: "geprueft", naechsteStufe: 1 }) },
    });
    rendereApp(`/belege/${BELEG_ID}`);
    const nutzer = userEvent.setup();
    const erteilen = (await screen.findByRole("button", { name: "Prüfung erteilen" })) as HTMLButtonElement;
    expect(erteilen.disabled).toBe(false);
    await nutzer.click(screen.getByRole("button", { name: "Zurückgeben" }));
    expect(await screen.findByText("Für die Rückgabe ist ein Kommentar erforderlich.")).toBeTruthy();
    expect(api.anfragen("POST", `/api/v1/belege/${BELEG_ID}/stufe`)).toHaveLength(0);
    await nutzer.click(erteilen);
    await waitFor(() => expect(api.anfragen("POST", `/api/v1/belege/${BELEG_ID}/stufe`)).toHaveLength(1));
    expect(api.anfragen("POST", `/api/v1/belege/${BELEG_ID}/stufe`)[0]!.koerper).toEqual({ stufe: "Prüfung", ergebnis: "ok" });
  });

  it("gesperrt für die Person, die den Beleg erzeugt hat, und für Bearbeiter ohne Freigeberrolle; die Gründe stehen da", async () => {
    spieleApi({ [`/api/v1/belege/${BELEG_ID}`]: { koerper: beleg({ erstelltVon: ICH_ID }) } });
    const a = rendereApp(`/belege/${BELEG_ID}`);
    expect((await screen.findByRole("button", { name: "Prüfung erteilen" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Sie haben den Beleg erzeugt oder zuletzt neu befüllt/)).toBeTruthy();
    a.unmount();
    spieleApi({ "/api/v1/ich": alsRolle("bearbeiter"), [`/api/v1/belege/${BELEG_ID}`]: { koerper: beleg() } });
    rendereApp(`/belege/${BELEG_ID}`);
    expect((await screen.findByRole("button", { name: "Prüfung erteilen" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Stufen erteilen nur Personen mit der Rolle Freigeber.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Neu befüllen" })).toBeTruthy();
  });

  it("freigegeben: Nummer, Hash und Datei, keine Stufen mehr; englisch", async () => {
    englisch();
    spieleApi({
      [`/api/v1/belege/${BELEG_ID}`]: {
        koerper: beleg({
          status: "freigegeben",
          belegnummer: "B-000042",
          naechsteStufe: 2,
          naechsteStufeName: null,
          dateiSha256: "ab".repeat(32),
          protokoll: [
            { id: "p1", belegId: BELEG_ID, stufeIndex: 0, stufe: "Prüfung", ergebnis: "ok", kommentar: null, akteur: ANDERE_ID, am: "2026-11-20T10:00:00.000Z" },
            { id: "p2", belegId: BELEG_ID, stufeIndex: 1, stufe: "Freigabe", ergebnis: "ok", kommentar: "in Ordnung", akteur: ICH_ID, am: "2026-11-20T11:00:00.000Z" },
          ],
        }),
      },
      "/api/v1/benutzer/namen": { koerper: namenDaten },
    });
    rendereApp(`/belege/${BELEG_ID}`);
    expect(await screen.findByRole("heading", { level: 1, name: "Disbursement B-000042" })).toBeTruthy();
    expect(screen.getByText("Approved as B-000042. The file is stored unchanged.")).toBeTruthy();
    expect(screen.getByText("ab".repeat(32))).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open PDF" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Grant/ })).toBeNull();
    const protokoll = within(screen.getByRole("region", { name: "Log of the stages" }));
    expect(await protokoll.findByText("Berta Beispiel")).toBeTruthy();
    expect(protokoll.getByText("in Ordnung")).toBeTruthy();
  });
});

describe("Beleg stornieren", () => {
  const frei = (extra: Record<string, unknown> = {}) =>
    beleg({ status: "freigegeben", belegnummer: "B-000042", naechsteStufe: 2, naechsteStufeName: null, dateiSha256: "ab".repeat(32), stornoAm: null, stornoVon: null, stornoGrund: null, ...extra });
  const PFAD_STORNO = `POST /api/v1/belege/${BELEG_ID}/storno`;

  it("Freigeber stornieren mit Grund; ohne Grund ist der Knopf gesperrt, Serverfehler werden gezeigt", async () => {
    const api = spieleApi({
      [`/api/v1/belege/${BELEG_ID}`]: { koerper: frei() },
      [PFAD_STORNO]: fehler(409, "BELEG_STORNIERT"),
    });
    rendereApp(`/belege/${BELEG_ID}`);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Stornieren …" }));
    const formular = within(await screen.findByRole("form", { name: "Beleg stornieren" }));
    const knopf = formular.getByRole("button", { name: "Beleg stornieren" }) as HTMLButtonElement;
    expect(knopf.disabled).toBe(true);
    await nutzer.type(formular.getByLabelText("Grund der Stornierung"), "Betrag falsch");
    expect(knopf.disabled).toBe(false);
    await nutzer.click(knopf);
    await waitFor(() => expect(api.anfragen("POST", `/api/v1/belege/${BELEG_ID}/storno`)).toHaveLength(1));
    expect(api.anfragen("POST", `/api/v1/belege/${BELEG_ID}/storno`)[0]!.koerper).toEqual({ grund: "Betrag falsch" });
    expect(await screen.findByText("Der Beleg ist storniert und lässt sich nicht mehr ändern.")).toBeTruthy();
  });

  it("storniert: Status, Grund und Person stehen da, die Datei bleibt, es gibt keine Stufen und keinen Stornieren-Knopf", async () => {
    spieleApi({
      [`/api/v1/belege/${BELEG_ID}`]: { koerper: frei({ status: "storniert", stornoAm: "2026-11-21T08:00:00.000Z", stornoVon: ANDERE_ID, stornoGrund: "Betrag falsch" }) },
      "/api/v1/benutzer/namen": { koerper: namenDaten },
    });
    rendereApp(`/belege/${BELEG_ID}`);
    expect(await screen.findByText("Der Beleg ist storniert.")).toBeTruthy();
    expect((await screen.findAllByText(/Die Belegnummer B-000042 bleibt vergeben/)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Betrag falsch/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Storniert").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "PDF öffnen" })).toBeTruthy();
    expect(screen.queryByRole("form", { name: "Beleg stornieren" })).toBeNull();
    expect(screen.queryByRole("button", { name: /erteilen/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Neu befüllen" })).toBeNull();
  });

  it("nur mit Rolle Freigeber und nur beim freigegebenen Beleg; die Liste kennt den Status", async () => {
    spieleApi({ [`/api/v1/belege/${BELEG_ID}`]: { koerper: frei() }, "/api/v1/ich": alsRolle("bearbeiter") });
    rendereApp(`/belege/${BELEG_ID}`);
    await screen.findByText(/Freigegeben als B-000042/);
    expect(screen.queryByRole("button", { name: "Stornieren …" })).toBeNull();
    expect(screen.queryByRole("form", { name: "Beleg stornieren" })).toBeNull();
  });

  it("Liste: stornierter Beleg mit Status, Filter nach Status", async () => {
    const api = spieleApi({ "/api/v1/belege": { koerper: { daten: [belegZeile({ status: "storniert", belegnummer: "B-000007" }), belegZeile({ id: "be-2", status: "freigegeben", belegnummer: "B-000008" })] } } });
    rendereApp("/belege");
    const nutzer = userEvent.setup();
    const bereich = await screen.findByRole("region", { name: "Belege des Fonds" });
    expect(within(bereich).getAllByRole("row")[1]!.textContent).toContain("Storniert");
    await nutzer.selectOptions(screen.getByLabelText("Status"), "storniert");
    await waitFor(() => expect(api.anfragen("GET", "/api/v1/belege").some((a) => a.query.get("status") === "storniert")).toBe(true));
  });
});

describe("Beleg erzeugen", () => {
  it("am Zinslauf: sendet Art, Bezug und Sprache und führt zum Beleg", async () => {
    const api = spieleApi({
      [`/api/v1/zinslaeufe/${ZL_ID}`]: { koerper: { ...zinslaufDaten, status: "gebucht" } },
      "POST /api/v1/belege": { status: 201, koerper: beleg({ art: "zinsbuchung", bezugArt: "zinslauf", bezugId: ZL_ID }) },
      [`/api/v1/belege/${BELEG_ID}`]: { koerper: beleg({ art: "zinsbuchung" }) },
    });
    rendereApp(`/zinslaeufe/${ZL_ID}`);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Beleg erzeugen" }));
    await nutzer.click(dialog().getByRole("button", { name: "Erzeugen" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Zinsbuchung" })).toBeTruthy();
    expect(api.anfragen("POST", "/api/v1/belege")[0]!.koerper).toEqual({ art: "zinsbuchung", bezugArt: "zinslauf", bezugId: ZL_ID, sprache: "de" });
  });

  it("bietet aktive eigene Belegarten derselben Basis-Art an und sendet die gewählte; ohne eigene Art gibt es keine Auswahl", async () => {
    const eintrag = (art: string, zusatz: object) => ({ art, standard: true, felder: [], kopfDe: "", kopfEn: "", fussDe: "", fussEn: "", katalog: [], eigeneArtId: null, bezeichnungDe: null, bezeichnungEn: null, aktiv: true, ...zusatz });
    const api = spieleApi({
      [`/api/v1/zinslaeufe/${ZL_ID}`]: { koerper: { ...zinslaufDaten, status: "gebucht" } },
      [`/api/v1/fonds/${FONDS_ID}/belegvorlagen`]: {
        koerper: {
          daten: [
            eintrag("zinsbuchung", {}),
            eintrag("zinsbuchung", { eigeneArtId: "art-z", bezeichnungDe: "Zinsmeldung", bezeichnungEn: "Interest notice" }),
            eintrag("zinsbuchung", { eigeneArtId: "art-still", bezeichnungDe: "Alt", bezeichnungEn: "Old", aktiv: false }),
            eintrag("auszahlung", { eigeneArtId: "art-a", bezeichnungDe: "Andere Basis", bezeichnungEn: "Other base" }),
          ],
        },
      },
      "POST /api/v1/belege": { status: 201, koerper: beleg({ art: "zinsbuchung", bezugArt: "zinslauf", bezugId: ZL_ID, eigeneArtId: "art-z", artNameDe: "Zinsmeldung", artNameEn: "Interest notice" }) },
      [`/api/v1/belege/${BELEG_ID}`]: { koerper: beleg({ art: "zinsbuchung", eigeneArtId: "art-z", artNameDe: "Zinsmeldung", artNameEn: "Interest notice" }) },
    });
    rendereApp(`/zinslaeufe/${ZL_ID}`);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Beleg erzeugen" }));
    const auswahl = await dialog().findByLabelText("Belegart");
    expect(within(auswahl).getAllByRole("option").map((o) => o.textContent)).toEqual(["Zinsbuchung", "Zinsmeldung"]);
    await nutzer.selectOptions(auswahl, "art-z");
    await nutzer.click(dialog().getByRole("button", { name: "Erzeugen" }));
    // Detailseite zeigt den eigenen Namen statt der festen Art.
    expect(await screen.findByRole("heading", { level: 1, name: "Zinsmeldung" })).toBeTruthy();
    expect(api.anfragen("POST", "/api/v1/belege")[0]!.koerper).toEqual({ art: "zinsbuchung", eigeneArtId: "art-z", bezugArt: "zinslauf", bezugId: ZL_ID, sprache: "de" });
  });

  it("gibt es schon einen Beleg, führt ein Link dorthin; ohne Rolle Bearbeiter gibt es den Knopf nicht", async () => {
    spieleApi({
      [`/api/v1/zinslaeufe/${ZL_ID}`]: { koerper: { ...zinslaufDaten, status: "gebucht" } },
      "POST /api/v1/belege": fehler(409, "BELEG_VORHANDEN", { belegId: BELEG_ID }),
    });
    const a = rendereApp(`/zinslaeufe/${ZL_ID}`);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Beleg erzeugen" }));
    await nutzer.click(dialog().getByRole("button", { name: "Erzeugen" }));
    expect(await dialog().findByText("Für diesen Vorfall gibt es schon einen Beleg.")).toBeTruthy();
    expect(dialog().getByRole("link", { name: "Beleg öffnen" }).getAttribute("href")).toBe(`/belege/${BELEG_ID}`);
    a.unmount();
    spieleApi({ "/api/v1/ich": alsRolle("betrachter"), [`/api/v1/zinslaeufe/${ZL_ID}`]: { koerper: { ...zinslaufDaten, status: "gebucht" } } });
    rendereApp(`/zinslaeufe/${ZL_ID}`);
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("button", { name: "Beleg erzeugen" })).toBeNull();
  });
});

const LAUF_ID = "sl-1";
const lauf = (extra: Record<string, unknown> = {}) => ({
  id: LAUF_ID,
  fondsId: FONDS_ID,
  zeitraumVon: "2026-07-01",
  zeitraumBis: "2026-09-30",
  dateiname: "susa.csv",
  dateityp: "csv",
  format: "datev",
  groesse: 100,
  sha256: "cd".repeat(32),
  status: "geprueft",
  hochgeladenVon: ANDERE_ID,
  hochgeladenAm: "2026-11-20T09:00:00.000Z",
  geprueftVon: ANDERE_ID,
  geprueftAm: "2026-11-20T09:05:00.000Z",
  fehlerAnzahl: 0,
  warnungAnzahl: 1,
  summe: { konten: 6, saldensumme: "0.00", soll: "1170.00", haben: "1170.00" },
  uebernommenVon: null,
  uebernommenAm: null,
  ersetztAm: null,
  ersetztVonLaufId: null,
  ...extra,
});
const buchhaltungUrl = (bereich: string) => `/buchhaltung?bereich=${bereich}`;

describe("Buchhaltung: Saldenlisten", () => {
  it("öffnet die referenzierte Kontenzeile und zeigt die Übernahme zum historischen Stand", async () => {
    const stand = "2026-11-21T09:00:00Z", stichtag = "2026-09-30";
    spieleApi({
      [`/api/v1/saldenlaeufe/${LAUF_ID}`]: { koerper: { ...lauf({ status: "uebernommen", uebernommenAm: stand, uebernommenVon: ANDERE_ID }), befunde: [] } },
      [`/api/v1/saldenlaeufe/${LAUF_ID}/salden`]: { koerper: { daten: [{ konto: "0120", saldo: "-12.34", bezeichnung: "Bankkonto" }] } },
    });
    rendereApp(`/buchhaltung?fondsId=${FONDS_ID}&laufId=${LAUF_ID}&konto=0120&stichtag=${stichtag}&stand=${stand}`);
    expect(await screen.findByRole("heading", { name: "susa.csv" })).toBeTruthy();
    expect(screen.getByText("0120 Bankkonto")).toBeTruthy();
    expect(screen.getByText(/-12,34/)).toBeTruthy();
    expect(screen.getByText(/30.09.2026.*Wissensstand/)).toBeTruthy();
    expect(screen.getByText("Übernommen")).toBeTruthy();
  });

  it("listet die Listen, lädt hoch (multipart), prüft und übernimmt mit Vier-Augen-Hinweis; Befunde in beiden Sprachen", async () => {
    const api = spieleApi({
      [`/api/v1/fonds/${FONDS_ID}/saldenlaeufe`]: { koerper: { daten: [lauf()] } },
      [`POST /api/v1/fonds/${FONDS_ID}/saldenlaeufe`]: { status: 201, koerper: lauf({ id: "sl-2", status: "hochgeladen", fehlerAnzahl: null, warnungAnzahl: null, summe: null }) },
      [`POST /api/v1/saldenlaeufe/${LAUF_ID}/pruefen`]: { koerper: lauf() },
      [`POST /api/v1/saldenlaeufe/${LAUF_ID}/uebernehmen`]: { koerper: lauf({ status: "uebernommen" }) },
      [`/api/v1/saldenlaeufe/${LAUF_ID}`]: { koerper: { ...lauf(), befunde: [{ nr: 1, zeile: 4, spalte: null, code: "SUSA_KONTO_UNBEKANNT", schweregrad: "warnung", meldung: "x", params: { konto: "7000" } }] } },
    });
    rendereApp(buchhaltungUrl("saldenlisten"));
    const nutzer = userEvent.setup();
    const liste = await screen.findByRole("region", { name: "Saldenlisten des Fonds" });
    const zeile = within(liste).getAllByRole("row")[1]!;
    expect(zeile.textContent).toContain("01.07.2026 – 30.09.2026");
    expect(zeile.textContent).toContain("susa.csv");
    expect(zeile.textContent).toContain("Geprüft");
    expect(zeile.textContent).toContain("0 / 1");

    await nutzer.upload(screen.getByLabelText("Datei"), new File(["Konto;Saldo"], "neu.csv", { type: "text/csv" }));
    expect(screen.getByText("neu.csv")).toBeTruthy();
    expect(api.anfragen("POST", `/api/v1/fonds/${FONDS_ID}/saldenlaeufe`)).toHaveLength(0);
    fireEvent.change(screen.getByLabelText("Zeitraum von"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText("Zeitraum bis"), { target: { value: "2026-12-31" } });
    await nutzer.click(screen.getByRole("button", { name: "Hochladen" }));
    await waitFor(() => expect(api.anfragen("POST", `/api/v1/fonds/${FONDS_ID}/saldenlaeufe`)).toHaveLength(1));
    const formular = api.anfragen("POST", `/api/v1/fonds/${FONDS_ID}/saldenlaeufe`)[0]!.formular!;
    expect((formular.get("datei") as File).name).toBe("neu.csv");
    expect(formular.get("zeitraumVon")).toBe("2026-10-01");
    expect(formular.get("zeitraumBis")).toBe("2026-12-31");

    await nutzer.click(within(liste).getAllByRole("button", { name: "Prüfen" })[0]!);
    await waitFor(() => expect(api.anfragen("POST", `/api/v1/saldenlaeufe/${LAUF_ID}/pruefen`)).toHaveLength(1));
    // Übernahme: Hochgeladen von einer anderen Person, die angemeldete Verwalterin darf
    await nutzer.click(within(liste).getAllByRole("button", { name: "Übernehmen" })[0]!);
    await waitFor(() => expect(api.anfragen("POST", `/api/v1/saldenlaeufe/${LAUF_ID}/uebernehmen`)).toHaveLength(1));
    await nutzer.click(within(liste).getAllByRole("button", { name: "Befunde der Prüfung" })[0]!);
    expect(await screen.findByText(/Das Konto steht nicht im Kontenrahmen des Fonds\. \(7000\)/)).toBeTruthy();
    expect(screen.getByText(/Zeile 4/)).toBeTruthy();
  });

  it("Übernehmen ist für die Person gesperrt, die hochgeladen oder geprüft hat; englisch", async () => {
    englisch();
    spieleApi({ [`/api/v1/fonds/${FONDS_ID}/saldenlaeufe`]: { koerper: { daten: [lauf({ hochgeladenVon: ICH_ID })] } } });
    rendereApp(buchhaltungUrl("saldenlisten"));
    const liste = await screen.findByRole("region", { name: "Trial balances of the fund" });
    expect((within(liste).getByRole("button", { name: "Take over" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(liste).getByText(/Only a different person with the role Approver/)).toBeTruthy();
    expect(within(liste).getAllByRole("row")[1]!.textContent).toContain("Checked");
  });
});

const auswertungDaten = {
  sicht: "bilanz",
  zeitraumVon: "2026-07-01",
  zeitraumBis: "2026-09-30",
  lauf: { id: LAUF_ID, dateiname: "susa.csv", uebernommenAm: "2026-11-20T10:00:00.000Z", uebernommenVon: ICH_ID },
  zeilen: [
    { schluessel: "aktiva", ebene: 0, bezeichnungDe: "Aktiva", bezeichnungEn: "Assets", seite: "soll", wert: "1050.00", blatt: false, konten: [], schritte: [] },
    {
      schluessel: "aktiva.beteiligungen",
      ebene: 1,
      bezeichnungDe: "Beteiligungen",
      bezeichnungEn: "Equity investments",
      seite: "soll",
      wert: "750.00",
      blatt: true,
      konten: [
        { konto: "0100", bezeichnung: "Beteiligungen", saldo: "800.00", regelId: "r1", beitrag: "800.00" },
        { konto: "0110", bezeichnung: "Wertberichtigungen", saldo: "-50.00", regelId: "r1", beitrag: "-50.00" },
      ],
      schritte: [],
    },
  ],
  nichtZugeordnet: [{ konto: "7000", bezeichnung: "Sonstiges", saldo: "5.00" }],
  mehrdeutig: [],
};
const periodenDaten = { daten: [{ laufId: LAUF_ID, zeitraumVon: "2026-07-01", zeitraumBis: "2026-09-30", uebernommenAm: "2026-11-20T10:00:00.000Z" }] };
const schrittW = (zeichen: string, bezeichnung: string, wert: string) => ({ zeichen, bezeichnung, wert });
const abstimmungDaten = {
  zeitraumVon: "2026-07-01",
  zeitraumBis: "2026-09-30",
  portfolio: {
    gesamt: { schluessel: "pf.portfolio", bezeichnung: "Portfolio zu Buchwerten", carraway: "500000.00", buchhaltung: "490000.00", differenz: "10000.00", verknuepft: false, schritte: [schrittW("", "Buchwerte", "500000.00"), schrittW("=", "Differenz", "10000.00")] },
    zeilen: [{ schluessel: "b", bezeichnung: "Beta Medizin (darlehen)", carraway: "100000.00", buchhaltung: "90000.00", differenz: "10000.00", verknuepft: true, schritte: [] }],
    ohneKonto: [{ beteiligungId: "b9", bezeichnung: "Gamma (darlehen)", buchwert: "5000.00" }],
  },
  liquiditaet: null,
};

describe("Buchhaltung: Auswertungen", () => {
  it("zeigt die Zeilen, die Herkunft je Zeile, nicht zugeordnete Konten und die Ausgaben als Links", async () => {
    const api = spieleApi({
      [`/api/v1/fonds/${FONDS_ID}/perioden`]: { koerper: periodenDaten },
      [`/api/v1/fonds/${FONDS_ID}/auswertung/bilanz`]: { koerper: auswertungDaten },
    });
    rendereApp(buchhaltungUrl("auswertung"));
    const nutzer = userEvent.setup();
    const tabelle = within(await screen.findByRole("region", { name: /Bilanz: Zeilen der Auswertung/ }));
    expect(tabelle.getByText("Aktiva")).toBeTruthy();
    expect(schmal(tabelle.getByText("1.050,00 €").textContent)).toBe("1.050,00 €");
    expect(api.anfragen("GET", `/api/v1/fonds/${FONDS_ID}/auswertung/bilanz`)[0]!.query.get("bis")).toBe("2026-09-30");
    // Herkunft: erst nach dem Öffnen
    expect(screen.queryByText("Wertberichtigungen")).toBeNull();
    await nutzer.click(screen.getByRole("button", { name: "Herkunft von Beteiligungen zeigen" }));
    const herkunft = within(screen.getByRole("region", { name: "Herkunft: Beteiligungen" }));
    expect(herkunft.getByText("0110")).toBeTruthy();
    expect(herkunft.getAllByText("-50,00 €")).toHaveLength(2); // Saldo und Beitrag
    await nutzer.click(screen.getByRole("button", { name: "Herkunft von Beteiligungen verbergen" }));
    expect(screen.queryByRole("region", { name: "Herkunft: Beteiligungen" })).toBeNull();
    expect(screen.getByText("1 Konten haben in dieser Sicht keine gültige Kontenregel und fehlen in den Summen.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ausgabe: PDF" }).getAttribute("href")).toBe(`/api/v1/fonds/${FONDS_ID}/auswertung/bilanz/datei?bis=2026-09-30&format=pdf&sprache=de`);
    expect(screen.getByRole("link", { name: "Ausgabe: Excel" }).getAttribute("href")).toContain("format=xlsx");
  });

  it("Portfolio: Abstimmung mit Differenz und Beteiligungen ohne Konto; englisch", async () => {
    englisch();
    spieleApi({
      [`/api/v1/fonds/${FONDS_ID}/perioden`]: { koerper: periodenDaten },
      [`/api/v1/fonds/${FONDS_ID}/auswertung/bilanz`]: { koerper: auswertungDaten },
      [`/api/v1/fonds/${FONDS_ID}/auswertung/portfolio`]: { koerper: { ...auswertungDaten, sicht: "portfolio" } },
      [`/api/v1/fonds/${FONDS_ID}/abstimmung`]: { koerper: abstimmungDaten },
    });
    rendereApp(buchhaltungUrl("auswertung"));
    const nutzer = userEvent.setup();
    await nutzer.selectOptions(await screen.findByLabelText("View"), "portfolio");
    const abst = within(await screen.findByRole("region", { name: "Reconciliation against the platform" }));
    expect(abst.getByText("Portfolio zu Buchwerten")).toBeTruthy();
    expect(abst.getAllByText(/10,000\.00/).length).toBeGreaterThan(0);
    expect(abst.getAllByText("Difference").length).toBeGreaterThan(0);
    expect(abst.getByText(/Gamma \(darlehen\): €5,000\.00/)).toBeTruthy();
    expect(abst.getAllByText(/Buchwerte/).length).toBeGreaterThan(0); // Zeile und Rechenweg
  });

  it("ohne übernommene Saldenliste: Hinweis", async () => {
    spieleApi({ [`/api/v1/fonds/${FONDS_ID}/perioden`]: { koerper: { daten: [] } } });
    rendereApp(buchhaltungUrl("auswertung"));
    expect(await screen.findByText(/Es gibt noch keine übernommene Saldenliste/)).toBeTruthy();
  });
});

describe("Buchhaltung: Buchungsexport", () => {
  const gebucht = { daten: [{ ...zinslaufListeDaten.daten[0]!, status: "gebucht" }] };
  const vorschau = {
    format: "EXTF 700 / Buchungsstapel 13",
    datumVon: "2026-09-30",
    datumBis: "2026-09-30",
    zeilen: [{ vorgangId: "v1", organisation: "Alpha Energie", art: "zins", valuta: "2026-09-30", betrag: "16200.62", konto: "1200", gegenkonto: "4200", richtung: "S", belegfeld: "FND-ABCDEF01", buchungstext: "Zins Alpha Energie", mitBeleg: false, bereitsExportiert: false }],
    anzahl: 1,
    probleme: [{ code: "EXPORT_KONTO_LAENGE" }],
    ohneBeleg: ["v1"],
  };

  it("Vorschau zeigt Konten, Belegfeld und Probleme; Export sendet die Auswahl; schon exportiert wird erklärt", async () => {
    const api = spieleApi({
      "/api/v1/zinslaeufe": { koerper: gebucht },
      [`/api/v1/fonds/${FONDS_ID}/buchungsexporte`]: { koerper: { daten: [] } },
      [`POST /api/v1/fonds/${FONDS_ID}/buchungsexport/vorschau`]: { koerper: vorschau },
      [`POST /api/v1/fonds/${FONDS_ID}/buchungsexport`]: fehler(409, "BUCHUNGSEXPORT_BEREITS_EXPORTIERT", { vorgangIds: ["v1"] }),
    });
    rendereApp(buchhaltungUrl("export"));
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Vorschau" }));
    const zeilen = within(await screen.findByRole("region", { name: "Zeilen des Exports" }));
    expect(zeilen.getByText("FND-ABCDEF01")).toBeTruthy();
    expect(zeilen.getByText("1200")).toBeTruthy();
    expect(screen.getByText(/1 Vorgänge haben noch keinen freigegebenen Beleg/)).toBeTruthy();
    expect(screen.getByText(/Kontonummer hat nicht die Länge/)).toBeTruthy();
    expect(api.anfragen("POST", `/api/v1/fonds/${FONDS_ID}/buchungsexport/vorschau`)[0]!.koerper).toEqual({ zinslaufId: ZL_ID, wiederholung: false });
    await nutzer.click(screen.getByRole("button", { name: "Exportieren" }));
    expect(await screen.findByText(/Vorgänge sind schon exportiert/)).toBeTruthy();
    // Wiederholung verlangt einen Grund
    await nutzer.click(screen.getByLabelText(/Erneuter Export/));
    expect((screen.getByRole("button", { name: "Exportieren" }) as HTMLButtonElement).disabled).toBe(true);
    await nutzer.type(screen.getByLabelText("Grund"), "Konten korrigiert");
    expect((screen.getByRole("button", { name: "Exportieren" }) as HTMLButtonElement).disabled).toBe(false);
    await nutzer.click(screen.getByRole("button", { name: "Exportieren" }));
    await waitFor(() => expect(api.anfragen("POST", `/api/v1/fonds/${FONDS_ID}/buchungsexport`)).toHaveLength(2));
    expect(api.anfragen("POST", `/api/v1/fonds/${FONDS_ID}/buchungsexport`)[1]!.koerper).toEqual({ zinslaufId: ZL_ID, wiederholung: true, grund: "Konten korrigiert" });
  });

  it("Liste der Exporte mit Download-Link nur für Bearbeiter; englisch", async () => {
    englisch();
    const export1 = { id: "ex1", fondsId: FONDS_ID, formatVersion: "EXTF 700 / Buchungsstapel 13", erzeugtVon: ICH_ID, erzeugtAm: "2026-11-20T10:00:00.000Z", datumVon: "2026-09-30", datumBis: "2026-09-30", anzahl: 2, summe: "12000.00", wiederholung: false, grund: null, dateiName: "EXTF_Buchungsstapel.csv", dateiSha256: "ee".repeat(32) };
    spieleApi({ "/api/v1/zinslaeufe": { koerper: { daten: [] } }, [`/api/v1/fonds/${FONDS_ID}/buchungsexporte`]: { koerper: { daten: [export1] } } });
    rendereApp(buchhaltungUrl("export"));
    expect(await screen.findByText("There is no booked interest run yet.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Download file" }).getAttribute("href")).toBe("/api/v1/buchungsexporte/ex1/datei");
    expect(schmal(screen.getByText("€12,000.00").textContent)).toBe("€12,000.00");
  });
});

describe("Buchhaltung: freie Auswahl für den Export", () => {
  const JOURNAL = `/api/v1/fonds/${FONDS_ID}/journal`;
  const zeile = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    quelle: "vorgang",
    typ: "zins",
    valuta: "2026-09-30",
    erfasstAm: "2026-10-01T08:00:00.000000Z",
    betrag: "6000.00",
    kassenwirkung: "6000.00",
    richtung: "zufluss",
    beteiligung: { id: "b1", organisationId: "o1", organisationName: "Alpha Energie", instrument: "wandeldarlehen" },
    kapitalisiert: false,
    stornoVon: null,
    storniertDurch: null,
    bemerkung: null,
    herkunft: { art: "manuell", id: null },
    erfasstVon: { id: "u1", name: "Vera Beispiel" },
    buchhaltung: { belegnummer: null as string | null, exportiertAm: null as string | null },
    verweis: null,
    ...extra,
  });
  const journalAntwort = (daten: unknown[]) => ({ daten, weitere: false, naechsterCursor: null, summen: { nachTyp: [], gesamt: { anzahl: daten.length, kassenwirkung: "0.00" } } });
  const VORSCHAU = `POST /api/v1/fonds/${FONDS_ID}/buchungsexport/vorschau`;
  const EXPORT = `POST /api/v1/fonds/${FONDS_ID}/buchungsexport`;
  const vorschau = {
    format: "EXTF 700 / Buchungsstapel 13",
    datumVon: "2026-09-30",
    datumBis: "2026-09-30",
    zeilen: [{ vorgangId: "v1", fondsBewegungId: null, organisation: "Alpha Energie", art: "zins", valuta: "2026-09-30", betrag: "6000.00", konto: "1200", gegenkonto: "4200", richtung: "S", belegfeld: "B-000001", buchungstext: "Zins", mitBeleg: true, bereitsExportiert: false }],
    anzahl: 1,
    probleme: [{ code: "EXPORT_BETRAG_NULL" }],
    ohneBeleg: [],
  };
  const aufbauen = () =>
    spieleApi({
      "/api/v1/zinslaeufe": { koerper: { daten: [] } },
      [`/api/v1/fonds/${FONDS_ID}/buchungsexporte`]: { koerper: { daten: [] } },
      [JOURNAL]: {
        koerper: journalAntwort([
          zeile("v1"),
          zeile("v2", { typ: "auszahlung", valuta: "2026-03-31", betrag: "100000.00", buchhaltung: { belegnummer: "B-000002", exportiertAm: null } }),
          zeile("v3", { buchhaltung: { belegnummer: "B-000003", exportiertAm: "2026-10-05T09:00:00.000Z" } }),
          zeile("bw1", { quelle: "fondsbewegung", typ: "abruf", beteiligung: null, betrag: "500000.00" }),
        ]),
      },
      [VORSCHAU]: { koerper: vorschau },
      [EXPORT]: { status: 201, koerper: { id: "ex1", ohneBeleg: [] } },
    });

  async function waehleQuelle() {
    const nutzer = userEvent.setup();
    await nutzer.selectOptions(await screen.findByLabelText("Was exportiert wird"), "auswahl");
    return nutzer;
  }

  it("filtert nach Zeitraum, Art und Beteiligung über das Journal, blendet schon Exportiertes aus und wählt Zeilen mit Kästchen", async () => {
    const api = aufbauen();
    rendereApp(buchhaltungUrl("export"));
    const nutzer = await waehleQuelle();
    const tabelle = within(await screen.findByRole("region", { name: "Buchungen zur Auswahl für den Export" }));
    // v3 ist schon exportiert und fehlt standardmäßig; Fondsbewegungen sind dabei
    expect(tabelle.queryByLabelText(/Zins vom 30\.09\.2026, Alpha Energie wählen/)).toBeTruthy();
    expect(tabelle.getAllByRole("checkbox")).toHaveLength(1 + 3);
    expect(tabelle.getByText("B-000002")).toBeTruthy();
    // Erste Anfrage: nur exportierbare Arten
    const erste = api.anfragen("GET", JOURNAL)[0]!;
    expect(erste.query.get("typ")).toBe("zusage,auszahlung,rueckfluss,zins,tilgung,wertberichtigung,abruf,ausschuettung");

    // Filter reichen an die API durch
    const filter = within(screen.getByRole("form", { name: "Filter der Buchungen für den Export" }));
    await nutzer.type(filter.getByLabelText("Von (Valuta)"), "2026-01-01");
    await nutzer.type(filter.getByLabelText("Bis (Valuta)"), "2026-12-31");
    await nutzer.selectOptions(filter.getByLabelText("Typ"), "zins");
    await nutzer.selectOptions(filter.getByLabelText("Beteiligung"), "b1");
    await waitFor(() => {
      const letzte = api.anfragen("GET", JOURNAL).at(-1)!;
      expect(letzte.query.get("von")).toBe("2026-01-01");
      expect(letzte.query.get("bis")).toBe("2026-12-31");
      expect(letzte.query.get("typ")).toBe("zins");
      expect(letzte.query.get("beteiligungId")).toBe("b1");
    });

    // Schon Exportiertes lässt sich einblenden
    await nutzer.click(filter.getByLabelText("Schon exportierte ausblenden"));
    expect(await screen.findAllByLabelText(/Zins vom 30\.09\.2026, Alpha Energie wählen/)).toHaveLength(2);
    expect(within(screen.getByRole("region", { name: "Buchungen zur Auswahl für den Export" })).getByText(/Exportiert am 05\.10\.2026/)).toBeTruthy();
  });

  it("Vorschau und Export senden genau die gewählten Vorgänge und Fondsbewegungen; Probleme erscheinen in der Vorschau; danach ist die Auswahl leer", async () => {
    const api = aufbauen();
    rendereApp(buchhaltungUrl("export"));
    const nutzer = await waehleQuelle();
    const tabelle = within(await screen.findByRole("region", { name: "Buchungen zur Auswahl für den Export" }));
    expect((screen.getByRole("button", { name: "Vorschau" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Noch nichts gewählt.")).toBeTruthy();

    await nutzer.click(tabelle.getByLabelText(/Zins vom 30\.09\.2026, Alpha Energie wählen/));
    await nutzer.click(tabelle.getByLabelText(/Abruf vom 30\.09\.2026, – wählen|Abruf vom 30\.09\.2026, .* wählen/));
    expect(screen.getByText("2 Buchungen gewählt.")).toBeTruthy();
    await nutzer.click(screen.getByRole("button", { name: "Vorschau" }));
    expect(await screen.findByText(/Betrag von null/)).toBeTruthy();
    expect(api.anfragen("POST", `/api/v1/fonds/${FONDS_ID}/buchungsexport/vorschau`)[0]!.koerper).toEqual({ vorgangIds: ["v1"], fondsBewegungIds: ["bw1"], wiederholung: false });

    await nutzer.click(screen.getByRole("button", { name: "Exportieren" }));
    await waitFor(() => expect(api.anfragen("POST", `/api/v1/fonds/${FONDS_ID}/buchungsexport`)).toHaveLength(1));
    expect(api.anfragen("POST", `/api/v1/fonds/${FONDS_ID}/buchungsexport`)[0]!.koerper).toEqual({ vorgangIds: ["v1"], fondsBewegungIds: ["bw1"], wiederholung: false });
    expect(await screen.findByText("Noch nichts gewählt.")).toBeTruthy();
    // Das Journal hinter der Auswahl wird neu gelesen, damit Exportiertes dort nicht weiter als offen erscheint.
    await waitFor(() => expect(api.anfragen("GET", JOURNAL).length).toBeGreaterThanOrEqual(2));
  });

  it("alle angezeigten wählen, die Auswahl bleibt beim Ändern des Filters und lässt sich leeren; englisch", async () => {
    englisch();
    aufbauen();
    rendereApp(buchhaltungUrl("export"));
    const nutzer = userEvent.setup();
    await nutzer.selectOptions(await screen.findByLabelText("What is exported"), "auswahl");
    const tabelle = within(await screen.findByRole("region", { name: "Entries to choose from for the export" }));
    await nutzer.click(tabelle.getByLabelText("Select all entries shown"));
    expect(screen.getByText("3 entries selected.")).toBeTruthy();
    await nutzer.selectOptions(within(screen.getByRole("form", { name: "Filters for the entries of the export" })).getByLabelText("Type"), "zins");
    expect(screen.getByText("3 entries selected.")).toBeTruthy();
    await nutzer.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(screen.getByText("Nothing selected yet.")).toBeTruthy();
  });

  it("ohne Bearbeiter-Recht gibt es die Auswahl nicht", async () => {
    aufbauen();
    spieleApi({ "/api/v1/ich": alsRolle("betrachter"), "/api/v1/zinslaeufe": { koerper: { daten: [] } }, [`/api/v1/fonds/${FONDS_ID}/buchungsexporte`]: { koerper: { daten: [] } } });
    rendereApp(buchhaltungUrl("export"));
    await screen.findByText("Bisherige Exporte");
    expect(screen.queryByLabelText("Was exportiert wird")).toBeNull();
  });
});

describe("Buchhaltung: Einstellungen", () => {
  const konfig = { fondsId: FONDS_ID, beraternummer: 1234567, mandantennummer: 12345, wirtschaftsjahrBeginn: 1, sachkontenlaenge: 4, belegpraefix: "B", geaendertVon: "x", geaendertAm: "2026-11-20T09:00:00.000Z", konfiguriert: true };
  const basis = {
    [`/api/v1/fonds/${FONDS_ID}/buchhaltung`]: { koerper: konfig },
    [`/api/v1/fonds/${FONDS_ID}/mittelarten`]: { koerper: { daten: [{ id: "m1", fondsId: FONDS_ID, schluessel: "land", bezeichnungDe: "Landesmittel", bezeichnungEn: "State funds", quote: "0.600000", meldeArt: "foerdermittel", gueltigAb: "2020-01-01", gueltigBis: null }, { id: "m2", fondsId: FONDS_ID, schluessel: "eigen", bezeichnungDe: "Eigenmittel", bezeichnungEn: "Own funds", quote: "0.400000", meldeArt: null, gueltigAb: "2020-01-01", gueltigBis: null }] } },
    [`/api/v1/fonds/${FONDS_ID}/konten`]: { koerper: { daten: [{ id: "k1", fondsId: FONDS_ID, nummer: "1200", bezeichnung: "Bank", art: "aktiv", beteiligungId: null }] } },
    [`/api/v1/fonds/${FONDS_ID}/gliederung`]: { koerper: { daten: [{ id: "g1", fondsId: FONDS_ID, sicht: "bilanz", schluessel: "aktiva.liquide", elternSchluessel: null, bezeichnungDe: "Guthaben bei Kreditinstituten", bezeichnungEn: "Cash at bank", reihenfolge: 10, seite: "soll" }] } },
    [`/api/v1/fonds/${FONDS_ID}/kontenregeln`]: { koerper: { daten: [{ id: "r1", fondsId: FONDS_ID, sicht: "bilanz", kontoVon: "1200", kontoBis: "1299", positionSchluessel: "aktiva.liquide", gueltigAb: "2020-01-01", gueltigBis: null, erstelltVon: "x", erstelltAm: "2026-11-20T09:00:00.000Z" }] } },
    [`/api/v1/fonds/${FONDS_ID}/belegvorlagen`]: {
      koerper: { daten: [{ art: "auszahlung", standard: true, felder: [{ schluessel: "betrag", abschnitt: "kopf", pflicht: true }], kopfDe: "", kopfEn: "", fussDe: "", fussEn: "", katalog: [{ schluessel: "betrag", typ: "betrag", bezeichnungDe: "Betrag", bezeichnungEn: "Amount" }, { schluessel: "projektnummer", typ: "text", bezeichnungDe: "Projektnummer", bezeichnungEn: "Project number" }] }] },
    },
  };

  it("gliedert in Buchen, Auswerten und Einstellungen; alte Adressen öffnen den richtigen Eintrag", async () => {
    spieleApi(basis);
    const { router } = rendereApp("/buchhaltung?tab=einstellungen&unter=regeln");
    const verzeichnis = within(await screen.findByRole("navigation", { name: "Bereiche der Buchhaltung" }));
    const namen = (gruppe: string) => within(verzeichnis.getByRole("list", { name: gruppe })).getAllByRole("button").map((k) => k.textContent);
    expect(namen("Buchen")).toEqual(["Saldenlisten", "Buchungsexport"]);
    expect(namen("Auswerten")).toEqual(["Auswertungen"]);
    expect(namen("Einstellungen")).toEqual(["Konfiguration", "Konten und Gliederung", "Buchungsregeln", "Belegvorlagen"]);
    expect(verzeichnis.getByRole("button", { name: "Buchungsregeln" }).getAttribute("aria-current")).toBe("page");
    expect(await screen.findByRole("region", { name: "Buchungsregeln" })).toBeTruthy();
    // Wechsel schreibt tab und unter; der erste Eintrag steht nicht in der Adresse
    await userEvent.setup().click(verzeichnis.getByRole("button", { name: "Belegvorlagen" }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ tab: "einstellungen", unter: "vorlagen" }));
    await userEvent.setup().click(verzeichnis.getByRole("button", { name: "Saldenlisten" }));
    await waitFor(() => expect(router.state.location.search).not.toHaveProperty("tab"));
  });

  it("öffnet ?tab=einstellungen ohne unter beim ersten Unterbereich", async () => {
    spieleApi(basis);
    rendereApp("/buchhaltung?tab=einstellungen");
    const verzeichnis = within(await screen.findByRole("navigation", { name: "Bereiche der Buchhaltung" }));
    expect(verzeichnis.getByRole("button", { name: "Konfiguration" }).getAttribute("aria-current")).toBe("page");
  });

  it("Verwalter speichern Konfiguration, Mittelarten (als Anteil), Standardgliederung, Regel und Belegvorlage", async () => {
    const api = spieleApi({
      ...basis,
      [`PUT /api/v1/fonds/${FONDS_ID}/buchhaltung`]: { koerper: konfig },
      [`PUT /api/v1/fonds/${FONDS_ID}/mittelarten`]: { koerper: { daten: [] } },
      [`POST /api/v1/fonds/${FONDS_ID}/gliederung/standard`]: { koerper: { neuePositionen: 31 } },
      [`POST /api/v1/fonds/${FONDS_ID}/kontenregeln`]: { status: 201, koerper: {} },
      [`PUT /api/v1/fonds/${FONDS_ID}/belegvorlagen/auszahlung`]: { koerper: { art: "auszahlung" } },
    });
    rendereApp(buchhaltungUrl("einstellungen"));
    const nutzer = userEvent.setup();
    const konfigKarte = within(await karteInnen("Konfiguration"));
    fireEvent.change(konfigKarte.getByLabelText("Mandantennummer"), { target: { value: "777" } });
    await nutzer.click(konfigKarte.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(api.anfragen("PUT", `/api/v1/fonds/${FONDS_ID}/buchhaltung`)).toHaveLength(1));
    expect(api.anfragen("PUT", `/api/v1/fonds/${FONDS_ID}/buchhaltung`)[0]!.koerper).toEqual({ beraternummer: 1234567, mandantennummer: 777, wirtschaftsjahrBeginn: 1, sachkontenlaenge: 4, belegpraefix: "B" });

    const mittel = within(screen.getByRole("region", { name: "Mittelarten" }));
    fireEvent.change(mittel.getByLabelText("Gültig ab"), { target: { value: "2027-01-01" } });
    fireEvent.change(mittel.getAllByLabelText("Quote in Prozent")[0]!, { target: { value: "50" } });
    fireEvent.change(mittel.getAllByLabelText("Quote in Prozent")[1]!, { target: { value: "50" } });
    // Meldeart: die erste bleibt, der zweiten wird eine zugeordnet (für die Förder- und Meldeberichte)
    expect((mittel.getAllByLabelText("Meldeart")[0] as HTMLSelectElement).value).toBe("foerdermittel");
    fireEvent.change(mittel.getAllByLabelText("Meldeart")[1]!, { target: { value: "eigenmittel" } });
    await nutzer.click(mittel.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(api.anfragen("PUT", `/api/v1/fonds/${FONDS_ID}/mittelarten`)).toHaveLength(1));
    expect(api.anfragen("PUT", `/api/v1/fonds/${FONDS_ID}/mittelarten`)[0]!.koerper).toEqual({
      gueltigAb: "2027-01-01",
      mittelarten: [
        { schluessel: "land", bezeichnungDe: "Landesmittel", bezeichnungEn: "State funds", quote: "0.500000", meldeArt: "foerdermittel" },
        { schluessel: "eigen", bezeichnungDe: "Eigenmittel", bezeichnungEn: "Own funds", quote: "0.500000", meldeArt: "eigenmittel" },
      ],
    });

    await nutzer.click(screen.getByRole("button", { name: "Konten und Gliederung" }));
    await nutzer.click(await screen.findByRole("button", { name: "Standardgliederung anlegen" }));
    expect(await screen.findByText("31 Positionen angelegt.")).toBeTruthy();

    const regeln = within(screen.getByRole("region", { name: "Gliederung und Kontenregeln" }));
    expect(regeln.getByText("1200 – 1299")).toBeTruthy();
    fireEvent.change(regeln.getByLabelText("Konto von"), { target: { value: "1300" } });
    await nutzer.selectOptions(regeln.getByLabelText("Position"), "aktiva.liquide");
    fireEvent.change(regeln.getAllByLabelText("Gültig ab").at(-1)!, { target: { value: "2026-10-01" } });
    await nutzer.click(regeln.getByRole("button", { name: "Kontenregel anlegen" }));
    await waitFor(() => expect(api.anfragen("POST", `/api/v1/fonds/${FONDS_ID}/kontenregeln`)).toHaveLength(1));
    expect(api.anfragen("POST", `/api/v1/fonds/${FONDS_ID}/kontenregeln`)[0]!.koerper).toEqual({ sicht: "bilanz", kontoVon: "1300", positionSchluessel: "aktiva.liquide", gueltigAb: "2026-10-01" });

    await nutzer.click(screen.getByRole("button", { name: "Belegvorlagen" }));
    const vorlagen = within(await karteInnen("Belegvorlagen"));
    // Betrag steht schon auf dem Beleg, Projektnummer ist nur im Katalog der verfügbaren Felder
    expect(vorlagen.queryByLabelText("Pflicht: Projektnummer")).toBeNull();
    await nutzer.click(vorlagen.getByRole("button", { name: "Feld hinzufügen: Projektnummer" }));
    expect(vorlagen.queryByRole("button", { name: "Feld hinzufügen: Projektnummer" })).toBeNull();
    await nutzer.click(vorlagen.getByLabelText("Pflicht: Projektnummer"));
    await nutzer.click(vorlagen.getByRole("button", { name: "Speichern: Auszahlung" }));
    await waitFor(() => expect(api.anfragen("PUT", `/api/v1/fonds/${FONDS_ID}/belegvorlagen/auszahlung`)).toHaveLength(1));
    expect((api.anfragen("PUT", `/api/v1/fonds/${FONDS_ID}/belegvorlagen/auszahlung`)[0]!.koerper as { felder: unknown[] }).felder).toEqual([
      { schluessel: "betrag", abschnitt: "kopf", pflicht: true },
      { schluessel: "projektnummer", abschnitt: "details", pflicht: true },
    ]);
  });

  it("Belegvorlagen: Belegart per Auswahl, Felder hinzufügen, ordnen und entfernen", async () => {
    const vorlage = (art: string, felder: string[]) => ({ art, standard: true, felder: felder.map((schluessel) => ({ schluessel, abschnitt: "kopf", pflicht: false })), kopfDe: "", kopfEn: "", fussDe: "", fussEn: "", katalog: [{ schluessel: "betrag", typ: "betrag", bezeichnungDe: "Betrag", bezeichnungEn: "Amount" }, { schluessel: "projektnummer", typ: "text", bezeichnungDe: "Projektnummer", bezeichnungEn: "Project number" }, { schluessel: "belegdatum", typ: "datum", bezeichnungDe: "Belegdatum", bezeichnungEn: "Voucher date" }] });
    const api = spieleApi({
      ...basis,
      [`/api/v1/fonds/${FONDS_ID}/belegvorlagen`]: { koerper: { daten: [vorlage("auszahlung", ["betrag", "projektnummer"]), vorlage("verkauf", ["belegdatum"])] } },
      [`PUT /api/v1/fonds/${FONDS_ID}/belegvorlagen/verkauf`]: { koerper: { art: "verkauf" } },
    });
    rendereApp("/buchhaltung?tab=einstellungen&unter=vorlagen");
    const nutzer = userEvent.setup();
    const vorlagen = within(await karteInnen("Belegvorlagen"));
    expect(vorlagen.getByText(/Eine Belegvorlage legt fest/)).toBeTruthy();
    const zeilen = () => within(vorlagen.getByRole("table")).getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell")[1]!.textContent);
    expect(zeilen()).toEqual(["Betrag", "Projektnummer"]);
    await nutzer.click(vorlagen.getByRole("button", { name: "Nach oben: Projektnummer" }));
    expect(zeilen()).toEqual(["Projektnummer", "Betrag"]);
    await nutzer.click(vorlagen.getByRole("button", { name: "Feld entfernen: Betrag" }));
    expect(zeilen()).toEqual(["Projektnummer"]);
    // Wechsel der Belegart zeigt deren Vorlage
    await nutzer.selectOptions(vorlagen.getByLabelText("Belegart"), "verkauf");
    expect(zeilen()).toEqual(["Belegdatum"]);
    await nutzer.click(vorlagen.getByRole("button", { name: "Feld hinzufügen: Betrag" }));
    await nutzer.click(vorlagen.getByLabelText("Pflicht: Betrag"));
    await nutzer.click(vorlagen.getByRole("button", { name: "Speichern: Verkauf" }));
    await waitFor(() => expect(api.anfragen("PUT", `/api/v1/fonds/${FONDS_ID}/belegvorlagen/verkauf`)).toHaveLength(1));
    expect((api.anfragen("PUT", `/api/v1/fonds/${FONDS_ID}/belegvorlagen/verkauf`)[0]!.koerper as { felder: unknown[] }).felder).toEqual([
      { schluessel: "belegdatum", abschnitt: "kopf", pflicht: false },
      { schluessel: "betrag", abschnitt: "details", pflicht: true },
    ]);
  });

  describe("eigene Belegarten", () => {
    const katalog = [{ schluessel: "betrag", typ: "betrag", bezeichnungDe: "Betrag", bezeichnungEn: "Amount" }, { schluessel: "projektnummer", typ: "text", bezeichnungDe: "Projektnummer", bezeichnungEn: "Project number" }];
    const zeile = (art: string, zusatz: object = {}) => ({ art, standard: true, felder: [{ schluessel: "betrag", abschnitt: "kopf", pflicht: true }], kopfDe: "", kopfEn: "", fussDe: "", fussEn: "", katalog, eigeneArtId: null, bezeichnungDe: null, bezeichnungEn: null, aktiv: true, ...zusatz });
    const eigene = zeile("auszahlung", { eigeneArtId: "art-1", bezeichnungDe: "Abruf Sonderprogramm", bezeichnungEn: "Special programme call", aktiv: true });
    const url = `/api/v1/fonds/${FONDS_ID}/belegvorlagen`;
    const arten = `/api/v1/fonds/${FONDS_ID}/belegarten`;

    it("Verwalter legen eine Belegart mit Name in beiden Sprachen und Basis-Art an; sie erscheint in der Auswahl", async () => {
      const api = spieleApi({
        ...basis,
        [url]: { koerper: { daten: [zeile("auszahlung"), zeile("verkauf")] } },
        [`POST ${arten}`]: { status: 201, koerper: { id: "art-1" } },
      });
      rendereApp("/buchhaltung?tab=einstellungen&unter=vorlagen");
      const nutzer = userEvent.setup();
      const vorlagen = within(await karteInnen("Belegvorlagen"));
      await nutzer.click(vorlagen.getByRole("button", { name: "Eigene Belegart anlegen" }));
      // Pflicht: beide Namen
      await nutzer.click(vorlagen.getByRole("button", { name: "Belegart anlegen" }));
      expect(vorlagen.getByText("Bitte beide Namen angeben.")).toBeTruthy();
      expect(api.anfragen("POST", arten)).toHaveLength(0);
      fireEvent.change(vorlagen.getByLabelText("Name (Deutsch)"), { target: { value: "Abruf Sonderprogramm" } });
      fireEvent.change(vorlagen.getByLabelText("Name (Englisch)"), { target: { value: "Special programme call" } });
      await nutzer.selectOptions(vorlagen.getByLabelText("Basis-Art"), "verkauf");
      await nutzer.click(vorlagen.getByRole("button", { name: "Belegart anlegen" }));
      await waitFor(() => expect(api.anfragen("POST", arten)).toHaveLength(1));
      expect(api.anfragen("POST", arten)[0]!.koerper).toEqual({ basisArt: "verkauf", bezeichnungDe: "Abruf Sonderprogramm", bezeichnungEn: "Special programme call" });
    });

    it("ergänzt ein eigenes Betragsfeld mit Pflicht und zweisprachiger Beschriftung", async () => {
      const api = spieleApi({ ...basis, [url]: { koerper: { daten: [eigene] } }, [`PUT ${url}/art-1`]: { koerper: eigene } });
      rendereApp("/buchhaltung?tab=einstellungen&unter=vorlagen");
      const karte = within(await karteInnen("Belegvorlagen"));
      const nutzer = userEvent.setup();
      await nutzer.click(karte.getByRole("button", { name: "Eigenes Feld hinzufügen" }));
      await nutzer.type(karte.getByLabelText("Feldname (Deutsch)"), "Gebühr");
      await nutzer.type(karte.getByLabelText("Feldname (Englisch)"), "Fee");
      await nutzer.selectOptions(karte.getByLabelText("Typ"), "betrag");
      await nutzer.click(karte.getByRole("checkbox", { name: /Gebühr/ }));
      await nutzer.click(karte.getByRole("button", { name: "Speichern: Abruf Sonderprogramm" }));
      await waitFor(() => expect(api.anfragen("PUT", `${url}/art-1`)[0]?.koerper).toMatchObject({
        felder: [{ schluessel: "betrag" }, { schluessel: expect.stringMatching(/^eigen_/), manuell: "betrag", pflicht: true, bezeichnungDe: "Gebühr", bezeichnungEn: "Fee" }],
      }));
    });

    it("eigene Belegart: Auswahl nennt den Namen, Vorlage speichert unter der Id, Name ändern und Stilllegen, Löschen nach Rückfrage", async () => {
      const api = spieleApi({
        ...basis,
        [url]: { koerper: { daten: [zeile("auszahlung"), eigene] } },
        [`PUT ${url}/art-1`]: { koerper: { art: "auszahlung" } },
        [`PUT ${arten}/art-1`]: { koerper: { id: "art-1" } },
        [`DELETE ${arten}/art-1`]: fehler(409, "BELEGART_IN_VERWENDUNG", { belegId: "b" }),
      });
      rendereApp("/buchhaltung?tab=einstellungen&unter=vorlagen");
      const nutzer = userEvent.setup();
      const vorlagen = within(await karteInnen("Belegvorlagen"));
      const auswahl = vorlagen.getByLabelText("Belegart");
      expect(within(auswahl).getAllByRole("option").map((o) => o.textContent)).toEqual(["Auszahlung (Standardvorlage)", "Abruf Sonderprogramm (eigene Belegart)"]);
      await nutzer.selectOptions(auswahl, "art-1");
      expect(vorlagen.getByText("Eigene Belegart · Basis-Art: Auszahlung")).toBeTruthy();
      // Vorlage unter der Id speichern
      await nutzer.click(vorlagen.getByRole("button", { name: "Speichern: Abruf Sonderprogramm" }));
      await waitFor(() => expect(api.anfragen("PUT", `${url}/art-1`)).toHaveLength(1));
      // Name ändern und stilllegen
      fireEvent.change(vorlagen.getByLabelText("Name (Deutsch)"), { target: { value: "Abruf Plus" } });
      await nutzer.click(vorlagen.getByLabelText("Stillgelegt: nicht mehr für neue Belege wählbar"));
      await nutzer.click(vorlagen.getByRole("button", { name: "Name speichern" }));
      await waitFor(() => expect(api.anfragen("PUT", `${arten}/art-1`)).toHaveLength(1));
      expect(api.anfragen("PUT", `${arten}/art-1`)[0]!.koerper).toEqual({ bezeichnungDe: "Abruf Plus", bezeichnungEn: "Special programme call", aktiv: false });
      // Löschen: Rückfrage, dann Serverfehler sichtbar
      await nutzer.click(vorlagen.getByRole("button", { name: "Belegart löschen" }));
      expect(api.anfragen("DELETE", `${arten}/art-1`)).toHaveLength(0);
      await nutzer.click(vorlagen.getByRole("button", { name: "Ja, löschen" }));
      expect(await vorlagen.findByText("Es gibt Belege dieser Art. Sie lässt sich nur stilllegen.")).toBeTruthy();
    });

    it("ohne Rolle Verwalter: keine Knöpfe zum Anlegen, Ändern und Löschen", async () => {
      spieleApi({ ...basis, "/api/v1/ich": alsRolle("bearbeiter"), [url]: { koerper: { daten: [zeile("auszahlung"), eigene] } } });
      rendereApp("/buchhaltung?tab=einstellungen&unter=vorlagen");
      const vorlagen = within(await karteInnen("Belegvorlagen"));
      expect(vorlagen.queryByRole("button", { name: "Eigene Belegart anlegen" })).toBeNull();
      await userEvent.setup().selectOptions(vorlagen.getByLabelText("Belegart"), "art-1");
      expect(vorlagen.queryByRole("button", { name: "Belegart löschen" })).toBeNull();
      expect(vorlagen.queryByRole("button", { name: "Name speichern" })).toBeNull();
    });
  });

  it("ohne Rolle Verwalter: Hinweis, Felder gesperrt, keine Speichern-Knöpfe", async () => {
    spieleApi({ ...basis, "/api/v1/ich": alsRolle("bearbeiter") });
    rendereApp(buchhaltungUrl("einstellungen"));
    expect(await screen.findByText("Einstellungen ändern darf die Verwalterin oder der Verwalter des Fonds.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Speichern" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Standardgliederung anlegen" })).toBeNull();
    expect(((await screen.findByLabelText("Beraternummer")) as HTMLInputElement).disabled).toBe(true);
  });

  it("zeigt Fehlercodes der API übersetzt (Quoten ergeben nicht 100 %), englisch", async () => {
    englisch();
    spieleApi({ ...basis, [`PUT /api/v1/fonds/${FONDS_ID}/mittelarten`]: fehler(409, "MITTELARTEN_SUMME_UNGUELTIG") });
    rendereApp(buchhaltungUrl("einstellungen"));
    const mittel = within(await screen.findByRole("region", { name: "Types of funds" }));
    fireEvent.change(mittel.getByLabelText("Valid from"), { target: { value: "2027-01-01" } });
    await userEvent.setup().click(mittel.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("The shares of the types of funds do not add up to 100%.")).toBeTruthy();
  });
});
