import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { alsRolle, ANDERE_ID, FONDS_ID, ICH_ID, fehler, fondsDaten, rendereApp, spieleApi } from "../test/hilfen";

const LAUF_ID = "ml1";
const NEU_ID = "ml2";
const text = (de: string, en = de) => ({ de, en });

const definition = {
  schema: 1,
  hinweis: text("Vorlage, fachlich zu prüfen. Aufbau ohne Formularvorgabe.", "Template, subject to professional review."),
  filter: undefined,
  regeln: [],
  abschnitte: [
    {
      id: "a",
      typ: "felder",
      titel: text("Mittelverwendung", "Use of funds"),
      felder: [
        { id: "x", bezeichnung: text("Auszahlungen im Zeitraum", "Disbursements in the period"), format: "betrag", quelle: { art: "vorgang" } },
        { id: "k", bezeichnung: text("Kapitalabrufe", "Capital calls"), format: "betrag", quelle: { art: "fondsbewegung" } },
        { id: "h", bezeichnung: text("Verantwortliche Person", "Person responsible"), format: "text", quelle: { art: "manuell" }, pflicht: true },
      ],
    },
    {
      id: "t",
      typ: "tabelle",
      je: "programm",
      titel: text("Portfolio je Programm", "Portfolio by programme"),
      spalten: [
        { id: "name", bezeichnung: text("Programm", "Programme"), format: "text", quelle: { art: "stammdaten", feld: "gruppe.bezeichnung" } },
        { id: "inv", bezeichnung: text("Investiert", "Invested"), format: "betrag", quelle: { art: "bestand" }, summe: true },
      ],
    },
  ],
};

const werte = [
  { schluessel: "a.x", art: "vorgang", wert: "1234.56", manuell: false, geaendertVon: null as string | null, geaendertAm: "2026-11-20T10:00:00.000Z" },
  { schluessel: "a.k", art: "fondsbewegung", wert: null as string | null, manuell: false, geaendertVon: null as string | null, geaendertAm: "2026-11-20T10:00:00.000Z" },
  { schluessel: "a.h", art: "manuell", wert: null as string | null, manuell: true, geaendertVon: null as string | null, geaendertAm: "2026-11-20T10:00:00.000Z" },
  { schluessel: "t.p1.name", art: "stammdaten", wert: "Programm Eins", manuell: false, geaendertVon: null as string | null, geaendertAm: "2026-11-20T10:00:00.000Z" },
  { schluessel: "t.p1.inv", art: "bestand", wert: "5000.00", manuell: false, geaendertVon: null as string | null, geaendertAm: "2026-11-20T10:00:00.000Z" },
  { schluessel: "t._ohne.name", art: "stammdaten", wert: null as string | null, manuell: false, geaendertVon: null as string | null, geaendertAm: "2026-11-20T10:00:00.000Z" },
  { schluessel: "t._ohne.inv", art: "bestand", wert: "700.00", manuell: false, geaendertVon: null as string | null, geaendertAm: "2026-11-20T10:00:00.000Z" },
  { schluessel: "t._summe.inv", art: "berechnet", wert: "5700.00", manuell: false, geaendertVon: null as string | null, geaendertAm: "2026-11-20T10:00:00.000Z" },
];
const zelle = (s: string) => ({ schluessel: s, wert: werte.find((w) => w.schluessel === s)?.wert ?? null });
const anzeige = [
  { id: "a", typ: "felder", felder: ["x", "k", "h"].map((id) => ({ id, ...zelle(`a.${id}`) })) },
  {
    id: "t",
    typ: "tabelle",
    je: "programm",
    zeilen: [
      { schluessel: "p1", bezeichnung: "Programm Eins", gruppeOhne: false, zellen: { name: { id: "name", ...zelle("t.p1.name") }, inv: { id: "inv", ...zelle("t.p1.inv") } } },
      { schluessel: "_ohne", bezeichnung: null, gruppeOhne: true, zellen: { name: { id: "name", ...zelle("t._ohne.name") }, inv: { id: "inv", ...zelle("t._ohne.inv") } } },
    ],
    summen: { inv: { id: "inv", ...zelle("t._summe.inv") } },
  },
];

const laufDaten = {
  id: LAUF_ID,
  fondsId: FONDS_ID,
  foerderprogrammId: null,
  definitionId: "d1",
  definitionSchluessel: "foerderbericht_quartal",
  definitionVersion: 1,
  format: "xlsx",
  sprache: "de",
  periodeArt: "quartal",
  periodeKennung: "2026-Q3",
  periodeBeginn: "2026-07-01",
  periodeEnde: "2026-09-30",
  fassung: 1,
  vorgaengerId: null,
  standVorgabe: null,
  stand: "2026-11-20T10:00:00.000Z",
  berechnetAm: "2026-11-20T10:00:00.000Z",
  status: "entwurf" as "entwurf" | "geprueft" | "freigegeben",
  freigabestufen: ["Investmentmanager", "Teamleitung"],
  naechsteStufe: 0,
  erstelltVon: ANDERE_ID,
  erstelltAm: "2026-11-20T10:00:00.000Z",
  freigegebenAm: null,
  meta: { schluessel: "foerderbericht_quartal", version: 1, bezeichnungDe: "Förderbericht je Quartal (Vorlage)", bezeichnungEn: "Funding report per quarter (template)", herausgeber: "Carraway (Vorlage)", rhythmus: "quartal", format: "xlsx" },
  definition,
  foerderprogramm: null,
  anzeige,
  werte,
  befunde: [
    { regelId: "pflicht_h", schwere: "fehler", code: "PFLICHT_FEHLT", refs: ["h"], params: { feld: "h" }, meldung: text("Pflichtfeld „Verantwortliche Person“ ist leer.", "Required field “Person responsible” is empty."), kommentar: null },
    { regelId: "erlaeuterung_fehlt", schwere: "warnung", code: "PFLICHT_FEHLT", refs: ["e"], params: { felder: "e" }, meldung: text("Es ist keine Erläuterung erfasst.", "No commentary has been entered."), kommentar: null as { text: string; von: string; am: string } | null },
  ],
  protokoll: [] as { id: string; laufId: string; stufeIndex: number; stufe: string; ergebnis: string; kommentar: string | null; akteur: string; am: string }[],
  dateien: [] as { id: string; art: string; format: string; name: string; sha256: string; groesse: number; erzeugtAm: string }[],
  naechsteStufeName: "Investmentmanager" as string | null,
};

const laufZeile = (extra: Record<string, unknown> = {}) => {
  const { definition: _d, anzeige: _a, werte: _w, befunde: _b, protokoll: _p, dateien: _f, meta, ...rest } = laufDaten;
  return { ...rest, bezeichnungDe: meta.bezeichnungDe, bezeichnungEn: meta.bezeichnungEn, ...extra };
};

const fondsDefinitionen = {
  daten: [
    { id: "d1", schluessel: "foerderbericht_quartal", version: 1, bezeichnungDe: "Förderbericht je Quartal (Vorlage)", bezeichnungEn: "Funding report per quarter (template)", herausgeber: "H", rhythmus: "quartal", format: "xlsx", gueltigAb: "2026-01-01", gueltigBis: null, erstelltVon: "system", erstelltAm: "2026-01-01T00:00:00.000Z", aktiviert: true, foerderprogramm: null },
    { id: "d2", schluessel: "efre_indikatoren", version: 1, bezeichnungDe: "EFRE-Indikatorbericht (Vorlage)", bezeichnungEn: "ERDF indicator report (template)", herausgeber: "H", rhythmus: "jahr", format: "xlsx", gueltigAb: "2026-01-01", gueltigBis: null, erstelltVon: "system", erstelltAm: "2026-01-01T00:00:00.000Z", aktiviert: false, foerderprogramm: null },
  ],
};
const programme = { daten: [{ id: "pg1", schluessel: "demo_wachstum", bezeichnung: "Beispielprogramm Wachstum", erstelltVon: "system", erstelltAm: "2026-01-01T00:00:00.000Z" }] };
const LAEUFE = `/api/v1/reporting-runs`;
const standard = {
  [`/api/v1/funds/${FONDS_ID}/reporting-definitions`]: { koerper: fondsDefinitionen },
  "/api/v1/funding-programs": { koerper: programme },
  [LAEUFE]: { koerper: { daten: [laufZeile()] } },
  [`${LAEUFE}/${LAUF_ID}`]: { koerper: laufDaten },
};
const herkunft = {
  schluessel: "a.x",
  art: "vorgang",
  wert: "1234.56",
  manuell: false,
  geaendertVon: null,
  schritte: [
    { zeichen: "", bezeichnung: "Vorgangsarten", wert: "auszahlung" },
    { zeichen: "", bezeichnung: "Anzahl der Vorgänge (inklusive Stornos)", wert: "2" },
    { zeichen: "=", bezeichnung: "Summe der Vorgänge nach Storno", wert: "1234.56" },
  ],
  filter: [{ foerderprogramm: ["demo_wachstum"] }],
  operanden: [],
  beteiligungen: [{ id: "b1", name: "Alpha Energie", instrument: "darlehen" }],
  vorgaenge: [{ id: "v1", beteiligungId: "b1", art: "auszahlung", valuta: "2026-08-15", betrag: "1234.56" }],
  vorgaengeGesamt: 3,
  kennzahlWerte: [],
  kennzahlWerteGesamt: 0,
  bewegungen: [],
};

describe("Meldungen am Fonds", () => {
  it("listet Läufe mit Status und Stufe, Definitionen mit Aktivierung und öffnet einen Lauf", async () => {
    const api = spieleApi(standard);
    rendereApp(`/fonds/${FONDS_ID}/meldungen`);
    const laeufe = within(await screen.findByRole("region", { name: "Meldeläufe des Fonds" }));
    const zeilen = laeufe.getAllByRole("row");
    expect(zeilen).toHaveLength(2);
    expect(zeilen[1]!.textContent).toContain("Q3 2026");
    expect(zeilen[1]!.textContent).toContain("Entwurf");
    expect(zeilen[1]!.textContent).toContain("Stufe 1 von 2: Investmentmanager");
    expect(within(zeilen[1]!).getByRole("link", { name: /Meldelauf öffnen: Förderbericht je Quartal \(Vorlage\) Q3 2026/ }).getAttribute("href")).toBe(`/meldungen/${LAUF_ID}`);
    expect(api.anfragen("GET", LAEUFE)[0]!.query.get("fondsId")).toBe(FONDS_ID);
    await userEvent.setup().click(screen.getByRole("tab", { name: "Definitionen des Fonds" }));
    const defs = within(await screen.findByRole("region", { name: "Meldedefinitionen" }));
    expect(defs.getAllByRole("row")).toHaveLength(3);
  });

  it("aktiviert eine Definition mit Förderprogramm und deaktiviert eine andere", async () => {
    const api = spieleApi({
      ...standard,
      [`PUT /api/v1/funds/${FONDS_ID}/reporting-definitions/efre_indikatoren`]: { koerper: { aktiviert: true, foerderprogramm: { schluessel: "demo_wachstum", bezeichnung: "Beispielprogramm Wachstum" } } },
      [`PUT /api/v1/funds/${FONDS_ID}/reporting-definitions/foerderbericht_quartal`]: { koerper: { aktiviert: false, foerderprogramm: null } },
    });
    rendereApp(`/fonds/${FONDS_ID}/meldungen?tab=definitionen`);
    const nutzer = userEvent.setup();
    const auswahl = await screen.findByLabelText(/Förderprogramm als Filter \(optional\): EFRE-Indikatorbericht/);
    await nutzer.selectOptions(auswahl, "demo_wachstum");
    await nutzer.click(screen.getByRole("button", { name: "EFRE-Indikatorbericht (Vorlage) für den Fonds aktivieren" }));
    await waitFor(() => expect(api.anfragen("PUT", `/api/v1/funds/${FONDS_ID}/reporting-definitions/efre_indikatoren`)).toHaveLength(1));
    expect(api.anfragen("PUT", `/api/v1/funds/${FONDS_ID}/reporting-definitions/efre_indikatoren`)[0]!.koerper).toEqual({ aktiv: true, foerderprogramm: "demo_wachstum" });
    await nutzer.click(screen.getByRole("button", { name: "Förderbericht je Quartal (Vorlage) für den Fonds deaktivieren" }));
    await waitFor(() => expect(api.anfragen("PUT", `/api/v1/funds/${FONDS_ID}/reporting-definitions/foerderbericht_quartal`)).toHaveLength(1));
    expect(api.anfragen("PUT", `/api/v1/funds/${FONDS_ID}/reporting-definitions/foerderbericht_quartal`)[0]!.koerper).toEqual({ aktiv: false });
  });

  it("legt einen Lauf an (Quartal, Sprache, Wissensstand) und öffnet ihn", async () => {
    const api = spieleApi({ ...standard, [`POST ${LAEUFE}`]: { status: 201, koerper: { ...laufDaten, id: NEU_ID, fassung: 2 } }, [`${LAEUFE}/${NEU_ID}`]: { koerper: { ...laufDaten, id: NEU_ID, fassung: 2 } } });
    rendereApp(`/fonds/${FONDS_ID}/meldungen`);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Meldelauf anlegen" }));
    const dialog = within(screen.getByRole("dialog"));
    fireEvent.change(dialog.getByLabelText("Jahr"), { target: { value: "2026" } });
    await nutzer.selectOptions(dialog.getByLabelText("Zeitraum"), "3");
    await nutzer.click(dialog.getByRole("button", { name: "Englisch" }));
    await nutzer.click(dialog.getByRole("button", { name: "Lauf anlegen" }));
    expect(await screen.findByRole("heading", { level: 1, name: /Förderbericht je Quartal \(Vorlage\) Q3 2026 · Fassung 2/ })).toBeTruthy();
    expect(api.anfragen("POST", LAEUFE)[0]!.koerper).toEqual({ fondsId: FONDS_ID, definition: "foerderbericht_quartal", sprache: "en", jahr: 2026, nummer: 3 });
  });

  it("zeigt den übersetzten Fehler, wenn die Definition nicht aktiviert ist", async () => {
    spieleApi({ ...standard, [`POST ${LAEUFE}`]: fehler(409, "reporting_definition_not_activated") });
    rendereApp(`/fonds/${FONDS_ID}/meldungen`);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Meldelauf anlegen" }));
    await nutzer.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Lauf anlegen" }));
    expect(await screen.findByText(/nicht aktiviert/)).toBeTruthy();
  });

  it("Betrachter sehen die Läufe, aber keine Knöpfe zum Anlegen und Aktivieren", async () => {
    spieleApi({ ...standard, "/api/v1/me": alsRolle("betrachter") });
    rendereApp(`/fonds/${FONDS_ID}/meldungen?tab=definitionen`);
    await screen.findByRole("region", { name: "Meldedefinitionen" });
    expect(screen.queryByRole("button", { name: "Meldelauf anlegen" })).toBeNull();
    expect(screen.queryByRole("button", { name: /für den Fonds aktivieren/ })).toBeNull();
    expect(screen.getByText(/Aktivieren und Deaktivieren dürfen Verwalter/)).toBeTruthy();
  });

  it("zeigt Englisch", async () => {
    localStorage.setItem("carraway.sprache", "en");
    spieleApi(standard);
    rendereApp(`/fonds/${FONDS_ID}/meldungen`);
    const laeufe = within(await screen.findByRole("region", { name: "Report runs of the fund" }));
    expect(laeufe.getAllByRole("row")[1]!.textContent).toContain("Draft");
    expect(laeufe.getAllByRole("row")[1]!.textContent).toContain("Step 1 of 2: Investmentmanager");
    expect(screen.getByRole("button", { name: "Create report run" })).toBeTruthy();
  });
});

describe("Meldelauf: Werte, Herkunft und Eingaben", () => {
  it("verwendet beim Direktlink den Fonds des Meldelaufs und wechselt zu den Meldungen des neuen Fonds", async () => {
    const zweiter = { ...fondsDaten.daten[0]!, id: "22222222-2222-4222-8222-222222222222", name: "Beispielfonds II" };
    localStorage.setItem("carraway.fonds", zweiter.id);
    spieleApi({
      ...standard,
      "/api/v1/fonds": { koerper: { daten: [...fondsDaten.daten, zweiter] } },
      [`/api/v1/funds/${zweiter.id}/reporting-definitions`]: { koerper: fondsDefinitionen },
    });
    const { router } = rendereApp(`/meldungen/${LAUF_ID}`);
    const nav = within(await screen.findByRole("navigation", { name: "Hauptnavigation" }));
    expect(nav.getByRole("link", { name: "Journal" }).getAttribute("href")).toBe(`/fonds/${FONDS_ID}/journal`);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Fonds" }), zweiter.id);
    await waitFor(() => expect(router.state.location.pathname).toBe(`/fonds/${zweiter.id}/meldungen`));
  });

  it("zeigt Werte im Zahlenformat, fehlende Werte als k. A. und die Gruppe ohne Zuordnung", async () => {
    spieleApi(standard);
    rendereApp(`/meldungen/${LAUF_ID}?tab=inhalt`);
    expect(await screen.findByRole("heading", { level: 1, name: /Förderbericht je Quartal \(Vorlage\) Q3 2026 · Fassung 1/ })).toBeTruthy();
    expect(screen.getByText(/Vorlage, fachlich zu prüfen. Aufbau ohne Formularvorgabe./)).toBeTruthy();
    const felder = within(screen.getByRole("region", { name: /^Mittelverwendung/ }));
    expect(felder.getByRole("button", { name: /Herkunft von Auszahlungen im Zeitraum: 1\.234,56\s€/ })).toBeTruthy();
    expect(felder.getByRole("button", { name: /Herkunft von Kapitalabrufe: k\. A\./ })).toBeTruthy();
    const tabelle = within(screen.getByRole("region", { name: "Portfolio je Programm" }));
    expect(tabelle.getAllByRole("row").map((r) => r.textContent).join("|")).toContain("Ohne Zuordnung");
    expect(tabelle.getByRole("button", { name: /Herkunft von Summe: Investiert: 5\.700,00\s€/ })).toBeTruthy();
    expect(screen.getByText(/Gerechnet zum Wissensstand/)).toBeTruthy();
  });

  it("öffnet die Herkunft eines Werts mit Rechenschritten, Filtern und den Datensätzen dahinter", async () => {
    const api = spieleApi({ ...standard, [`${LAEUFE}/${LAUF_ID}/provenance`]: { koerper: herkunft } });
    rendereApp(`/meldungen/${LAUF_ID}?tab=inhalt`);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: /Herkunft von Auszahlungen im Zeitraum/ }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(await dialog.findByText("Summe der Vorgänge nach Storno")).toBeTruthy();
    expect(dialog.getByText(/foerderprogramm: demo_wachstum/)).toBeTruthy();
    expect(dialog.getByRole("link", { name: "Beteiligung öffnen: Alpha Energie" }).getAttribute("href")).toBe("/beteiligungen/b1");
    expect(dialog.getByText("1 von 3 gezeigt.")).toBeTruthy();
    expect(api.anfragen("GET", `${LAEUFE}/${LAUF_ID}/provenance`)[0]!.query.get("schluessel")).toBe("a.x");
  });

  it("übersetzt die Rechenschritte der Herkunft ins Englische", async () => {
    localStorage.setItem("carraway.sprache", "en");
    spieleApi({ ...standard, [`${LAEUFE}/${LAUF_ID}/provenance`]: { koerper: herkunft } });
    rendereApp(`/meldungen/${LAUF_ID}?tab=inhalt`);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: /Provenance of Disbursements in the period/ }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(await dialog.findByText("Total of the transactions after reversals")).toBeTruthy();
    expect(dialog.getByText("Filters applied")).toBeTruthy();
  });

  it("gibt eine Eingabe von Hand ein und zeigt den übersetzten Fehler bei falschem Format", async () => {
    const api = spieleApi({ ...standard, [`PUT ${LAEUFE}/${LAUF_ID}/inputs`]: (a) => (a.koerper && (a.koerper as { wert: string }).wert === "=1+1" ? fehler(400, "reporting_value_invalid") : { koerper: { schluessel: "a.h", wert: "Erika Beispiel", geaendertVon: ICH_ID, geaendertAm: "2026-11-20T10:00:00.000Z" } }) });
    rendereApp(`/meldungen/${LAUF_ID}?tab=inhalt`);
    const nutzer = userEvent.setup();
    const feld = await screen.findByLabelText("Wert für Verantwortliche Person eingeben");
    await nutzer.type(feld, "Erika Beispiel");
    await nutzer.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(api.anfragen("PUT", `${LAEUFE}/${LAUF_ID}/inputs`)).toHaveLength(1));
    expect(api.anfragen("PUT", `${LAEUFE}/${LAUF_ID}/inputs`)[0]!.koerper).toEqual({ schluessel: "a.h", wert: "Erika Beispiel" });
    await nutzer.clear(feld);
    await nutzer.type(feld, "=1+1");
    await nutzer.click(screen.getByRole("button", { name: "Speichern" }));
    expect(await screen.findByText(/passt nicht zum Format/)).toBeTruthy();
  });

  it("nach der Freigabe gibt es keine Eingabefelder mehr, dafür Dateien mit Prüfsumme", async () => {
    const frei = {
      ...laufDaten,
      status: "freigegeben" as const,
      naechsteStufe: 2,
      naechsteStufeName: null,
      protokoll: [
        { id: "p1", laufId: LAUF_ID, stufeIndex: 0, stufe: "Investmentmanager", ergebnis: "ok", kommentar: null, akteur: ICH_ID, am: "2026-11-21T10:00:00.000Z" },
        { id: "p2", laufId: LAUF_ID, stufeIndex: 1, stufe: "Teamleitung", ergebnis: "ok", kommentar: "Geprüft", akteur: "88888888-8888-4888-8888-888888888888", am: "2026-11-22T10:00:00.000Z" },
      ],
      dateien: [
        { id: "f1", art: "meldung", format: "xlsx", name: "foerderbericht-bf-i-2026-q3-f1.xlsx", sha256: "ab".repeat(32), groesse: 20480, erzeugtAm: "2026-11-22T10:00:00.000Z" },
        { id: "f2", art: "pruefansicht", format: "pdf", name: "foerderbericht-bf-i-2026-q3-f1-pruefansicht.pdf", sha256: "cd".repeat(32), groesse: 40960, erzeugtAm: "2026-11-22T10:00:00.000Z" },
      ],
    };
    spieleApi({ ...standard, [`${LAEUFE}/${LAUF_ID}`]: { koerper: frei } });
    rendereApp(`/meldungen/${LAUF_ID}`);
    expect(await screen.findByText(/Alle Stufen sind erteilt/)).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("tab", { name: "Datei" }));
    const dateien = within(await screen.findByRole("region", { name: "Dateien" }));
    expect(dateien.getByRole("link", { name: "Meldung (Excel) herunterladen" }).getAttribute("href")).toBe(`/api/v1/reporting-runs/${LAUF_ID}/file?type=submission`);
    expect(dateien.getByRole("link", { name: "Prüfansicht (PDF) herunterladen" }).getAttribute("href")).toBe(`/api/v1/reporting-runs/${LAUF_ID}/file?type=review_view`);
    expect(dateien.getByText("ab".repeat(32))).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("tab", { name: /^Inhalt/ }));
    await waitFor(() => expect(screen.getByRole("tab", { name: /^Inhalt/ }).getAttribute("aria-selected")).toBe("true"));
    expect(screen.queryByLabelText("Wert für Verantwortliche Person eingeben")).toBeNull();
    await userEvent.setup().click(screen.getByRole("tab", { name: /^Protokoll/ }));
    expect((await screen.findAllByRole("region", { name: "Protokoll der Stufen" })).length).toBeGreaterThan(0);
  });
});

describe("Meldelauf: Befunde und Stufen", () => {
  it("listet Fehler und Warnungen, kommentiert eine Warnung", async () => {
    const api = spieleApi({ ...standard, [`PUT ${LAEUFE}/${LAUF_ID}/findings/erlaeuterung_fehlt/comment`]: { koerper: { regelId: "erlaeuterung_fehlt", text: "Keine Besonderheiten.", von: ICH_ID, am: "2026-11-20T11:00:00.000Z" } } });
    rendereApp(`/meldungen/${LAUF_ID}`);
    const bereich = within(await screen.findByRole("region", { name: "Befunde der Prüfregeln" }));
    expect(bereich.getByText("Pflichtfeld „Verantwortliche Person“ ist leer.")).toBeTruthy();
    expect(bereich.getByText("Es ist keine Erläuterung erfasst.")).toBeTruthy();
    expect(bereich.getAllByText("Ein Pflichtwert fehlt.")).toHaveLength(2);
    const nutzer = userEvent.setup();
    await nutzer.type(bereich.getByLabelText("Kommentar zur Warnung Es ist keine Erläuterung erfasst."), "Keine Besonderheiten.");
    await nutzer.click(bereich.getByRole("button", { name: "Kommentar speichern" }));
    await waitFor(() => expect(api.anfragen("PUT", `${LAEUFE}/${LAUF_ID}/findings/erlaeuterung_fehlt/comment`)).toHaveLength(1));
    expect(api.anfragen("PUT", `${LAEUFE}/${LAUF_ID}/findings/erlaeuterung_fehlt/comment`)[0]!.koerper).toEqual({ text: "Keine Besonderheiten." });
  });

  it("erteilt die nächste Stufe und sperrt sie für den Ersteller mit Erklärung", async () => {
    const api = spieleApi({ ...standard, [`POST ${LAEUFE}/${LAUF_ID}/stage`]: { koerper: { ...laufDaten, status: "geprueft", naechsteStufe: 1 } } });
    rendereApp(`/meldungen/${LAUF_ID}`);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Stufe „Investmentmanager“ erteilen" }));
    await waitFor(() => expect(api.anfragen("POST", `${LAEUFE}/${LAUF_ID}/stage`)).toHaveLength(1));
    expect(api.anfragen("POST", `${LAEUFE}/${LAUF_ID}/stage`)[0]!.koerper).toEqual({ stufe: "Investmentmanager", ergebnis: "ok" });
  });

  it("der Ersteller kann nicht freigeben, die Seite sagt warum", async () => {
    spieleApi({ ...standard, [`${LAEUFE}/${LAUF_ID}`]: { koerper: { ...laufDaten, erstelltVon: ICH_ID } } });
    rendereApp(`/meldungen/${LAUF_ID}`);
    const knopf = (await screen.findByRole("button", { name: "Stufe „Investmentmanager“ erteilen" })) as HTMLButtonElement;
    expect(knopf.disabled).toBe(true);
    expect(screen.getByText("Sie haben den Lauf angelegt und können ihn nicht freigeben.")).toBeTruthy();
  });

  it("wer eine Eingabe gemacht hat, kann nicht freigeben (auch aus einer früheren Fassung)", async () => {
    const mitEingabe = werte.map((w) => (w.schluessel === "a.h" ? { ...w, wert: "Erika", geaendertVon: ICH_ID } : w));
    spieleApi({ ...standard, [`${LAEUFE}/${LAUF_ID}`]: { koerper: { ...laufDaten, werte: mitEingabe } } });
    rendereApp(`/meldungen/${LAUF_ID}`);
    const knopf = (await screen.findByRole("button", { name: "Stufe „Investmentmanager“ erteilen" })) as HTMLButtonElement;
    expect(knopf.disabled).toBe(true);
    expect(screen.getByText(/Sie haben eine Eingabe gemacht oder eine Warnung kommentiert/)).toBeTruthy();
  });

  it("die letzte Stufe zeigt offene Fehler und fehlende Kommentare als Sperre; Serverfehler sind übersetzt", async () => {
    const letzte = { ...laufDaten, status: "geprueft", naechsteStufe: 1, naechsteStufeName: "Teamleitung", protokoll: [{ id: "p1", laufId: LAUF_ID, stufeIndex: 0, stufe: "Investmentmanager", ergebnis: "ok", kommentar: null, akteur: "88888888-8888-4888-8888-888888888888", am: "2026-11-21T10:00:00.000Z" }] };
    spieleApi({ ...standard, [`${LAEUFE}/${LAUF_ID}`]: { koerper: letzte } });
    rendereApp(`/meldungen/${LAUF_ID}`);
    const knopf = (await screen.findByRole("button", { name: "Stufe „Teamleitung“ erteilen" })) as HTMLButtonElement;
    expect(knopf.disabled).toBe(true);
    expect(screen.getByText("Die letzte Stufe ist gesperrt, solange Fehler offen sind.")).toBeTruthy();
  });

  it("reporting_run_errors_open und four_eyes_violated werden übersetzt angezeigt", async () => {
    spieleApi({ ...standard, [`POST ${LAEUFE}/${LAUF_ID}/stage`]: fehler(409, "four_eyes_violated") });
    rendereApp(`/meldungen/${LAUF_ID}`);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Stufe „Investmentmanager“ erteilen" }));
    expect((await screen.findAllByRole("alert")).length).toBeGreaterThan(0);
  });

  it("die Rückgabe verlangt einen Kommentar", async () => {
    const stufe1 = { ...laufDaten, status: "geprueft", naechsteStufe: 1, naechsteStufeName: "Teamleitung", protokoll: [{ id: "p1", laufId: LAUF_ID, stufeIndex: 0, stufe: "Investmentmanager", ergebnis: "ok", kommentar: null, akteur: "88888888-8888-4888-8888-888888888888", am: "2026-11-21T10:00:00.000Z" }] };
    const api = spieleApi({ ...standard, [`${LAEUFE}/${LAUF_ID}`]: { koerper: stufe1 }, [`POST ${LAEUFE}/${LAUF_ID}/stage`]: { koerper: laufDaten } });
    rendereApp(`/meldungen/${LAUF_ID}`);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: /Zurückgeben/ }));
    expect(api.anfragen("POST", `${LAEUFE}/${LAUF_ID}/stage`)).toHaveLength(0);
    await nutzer.type(screen.getByLabelText("Kommentar (bei Rückgabe Pflicht)"), "Zahlen prüfen");
    await nutzer.click(screen.getByRole("button", { name: /Zurückgeben/ }));
    await waitFor(() => expect(api.anfragen("POST", `${LAEUFE}/${LAUF_ID}/stage`)).toHaveLength(1));
    expect(api.anfragen("POST", `${LAEUFE}/${LAUF_ID}/stage`)[0]!.koerper).toEqual({ stufe: "Teamleitung", ergebnis: "zurueck", kommentar: "Zahlen prüfen" });
  });

  it("Englisch: Werte, Befunde und Hinweise", async () => {
    localStorage.setItem("carraway.sprache", "en");
    spieleApi(standard);
    rendereApp(`/meldungen/${LAUF_ID}`);
    expect(await screen.findByRole("heading", { level: 1, name: /Funding report per quarter \(template\) Q3 2026 · Version 1/ })).toBeTruthy();
    expect(within(await screen.findByRole("region", { name: "Findings of the validation rules" })).getByText("Required field “Person responsible” is empty.")).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("tab", { name: /^Content/ }));
    const felder = within(await screen.findByRole("region", { name: /^Use of funds/ }));
    expect(felder.getByRole("button", { name: /Provenance of Capital calls: n\/a/ })).toBeTruthy();
    expect(felder.getByRole("button", { name: /Provenance of Disbursements in the period: €1,234\.56/ })).toBeTruthy();
    expect(screen.getByText("Template, subject to professional review.")).toBeTruthy();
  });
});

describe("Verwaltung der Meldedefinitionen", () => {
  const kopf = { id: "d1", schluessel: "foerderbericht_quartal", version: 1, bezeichnungDe: "Förderbericht je Quartal (Vorlage)", bezeichnungEn: "Funding report per quarter (template)", herausgeber: "H", rhythmus: "quartal", format: "xlsx", gueltigAb: "2026-01-01", gueltigBis: null as string | null, erstelltVon: "system", erstelltAm: "2026-01-01T00:00:00.000Z" };
  const liste = { daten: [{ ...kopf, anzahlVersionen: 1, hinweis: text("Vorlage, fachlich zu prüfen.") }] };
  const version = { ...kopf, definition, vorschau: definition.abschnitte.map((a) => ({ id: a.id, typ: a.typ, titel: a.titel, anzahl: (a.felder ?? a.spalten)!.length, felder: (a.felder ?? a.spalten)!.map((f) => ({ id: f.id, bezeichnung: f.bezeichnung, format: f.format, quelle: f.quelle.art })) })) };
  const verwaltung = { "/api/v1/reporting-definitions": { koerper: liste }, "/api/v1/funding-programs": { koerper: programme }, "/api/v1/reporting-definitions/foerderbericht_quartal": { koerper: { daten: [kopf] } }, "/api/v1/reporting-definitions/foerderbericht_quartal/versions/1": { koerper: version } };

  it("listet Definitionen mit Vorlagenhinweis und zeigt eine Version als Aufbau und JSON", async () => {
    spieleApi(verwaltung);
    rendereApp("/verwaltung?bereich=meldewesen");
    const tabelle = within(await screen.findByRole("region", { name: "Meldedefinitionen" }));
    expect(tabelle.getAllByRole("row")[1]!.textContent).toContain("Vorlage, fachlich zu prüfen");
    const nutzer = userEvent.setup();
    await nutzer.click(screen.getByRole("button", { name: "Definition ansehen: Förderbericht je Quartal (Vorlage)" }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(await dialog.findByText(/Mittelverwendung \(Felder, 3 Felder\)/)).toBeTruthy();
    expect(dialog.getByLabelText("Inhalt (JSON, nur lesen)").textContent).toContain('"schema": 1');
    expect(dialog.getByRole("heading", { level: 2, name: "Förderbericht je Quartal (Vorlage), Version 1" })).toBeTruthy();
  });

  it("Editor: ungültiges JSON, Prüfung mit Pfad und Meldung, Speichern als neue Version", async () => {
    const api = spieleApi({
      ...verwaltung,
      "POST /api/v1/reporting-definitions/validate": (a) =>
        (a.koerper as { definition: { schema?: number } }).definition.schema === 2
          ? { koerper: { ok: false, vorschau: null, probleme: [{ pfad: "abschnitte.0.felder.1.quelle.schluessel", code: "unbekannte_kennzahl", meldung: "x", params: { schluessel: "gibt_es_nicht" } }] } }
          : { koerper: { ok: true, vorschau: [], probleme: [] } },
      "POST /api/v1/reporting-definitions/foerderbericht_quartal/versions": { status: 201, koerper: { ...kopf, version: 2 } },
    });
    rendereApp("/verwaltung?bereich=meldewesen");
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Neue Version von Förderbericht je Quartal (Vorlage)" }));
    const dialog = within(screen.getByRole("dialog"));
    const json = dialog.getByLabelText("Inhalt der Definition (JSON)");
    fireEvent.change(json, { target: { value: "{kaputt" } });
    await nutzer.click(dialog.getByRole("button", { name: "Prüfen" }));
    expect(await dialog.findByText("Der Text ist kein gültiges JSON.")).toBeTruthy();
    fireEvent.change(json, { target: { value: JSON.stringify({ schema: 2 }) } });
    await nutzer.click(dialog.getByRole("button", { name: "Prüfen" }));
    expect(await dialog.findByText("abschnitte.0.felder.1.quelle.schluessel: Die Kennzahl „gibt_es_nicht“ steht nicht im Katalog.")).toBeTruthy();
    expect(dialog.getByText("Ein Fehler in der Definition")).toBeTruthy();
    fireEvent.change(json, { target: { value: JSON.stringify({ schema: 1, abschnitte: [] }) } });
    await nutzer.click(dialog.getByRole("button", { name: "Prüfen" }));
    expect(await dialog.findByText("Der Aufbau ist gültig.")).toBeTruthy();
    await nutzer.click(dialog.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(api.anfragen("POST", "/api/v1/reporting-definitions/foerderbericht_quartal/versions")).toHaveLength(1));
    const k = api.anfragen("POST", "/api/v1/reporting-definitions/foerderbericht_quartal/versions")[0]!.koerper as Record<string, unknown>;
    expect(k.definition).toEqual({ schema: 1, abschnitte: [] });
    expect(k.rhythmus).toBe("quartal");
    expect(k.format).toBe("xlsx");
  });

  it("zeigt die Fehler der API beim Speichern mit Pfad (englisch übersetzt)", async () => {
    localStorage.setItem("carraway.sprache", "en");
    spieleApi({ ...verwaltung, "POST /api/v1/reporting-definitions": fehler(400, "reporting_definition_invalid", { definitionsfehler: [{ pfad: "abschnitte.0", code: "zyklus", meldung: "Zyklische Verweise: a → b → a.", params: { kreis: "a → b → a" } }] }) });
    rendereApp("/verwaltung?bereich=meldewesen");
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "New definition" }));
    const dialog = within(screen.getByRole("dialog"));
    fireEvent.change(dialog.getByLabelText("Key"), { target: { value: "test_neu" } });
    fireEvent.change(dialog.getByLabelText("Name (German)"), { target: { value: "Neu" } });
    fireEvent.change(dialog.getByLabelText("Name (English)"), { target: { value: "New" } });
    fireEvent.change(dialog.getByLabelText("Publisher"), { target: { value: "H" } });
    fireEvent.change(dialog.getByLabelText("Content of the definition (JSON)"), { target: { value: "{}" } });
    await nutzer.click(dialog.getByRole("button", { name: "Save" }));
    expect(await dialog.findByText("abschnitte.0: Cyclic references: a → b → a.")).toBeTruthy();
  });

  it("legt ein Förderprogramm an", async () => {
    const api = spieleApi({ ...verwaltung, "POST /api/v1/funding-programs": { status: 201, koerper: programme.daten[0] } });
    rendereApp("/verwaltung?bereich=meldewesen");
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Programm anlegen" }));
    const dialog = within(screen.getByRole("dialog"));
    fireEvent.change(dialog.getByLabelText("Schlüssel"), { target: { value: "demo_neu" } });
    fireEvent.change(dialog.getByLabelText("Bezeichnung"), { target: { value: "Beispielprogramm Neu" } });
    await nutzer.click(dialog.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(api.anfragen("POST", "/api/v1/funding-programs")).toHaveLength(1));
    expect(api.anfragen("POST", "/api/v1/funding-programs")[0]!.koerper).toEqual({ schluessel: "demo_neu", bezeichnung: "Beispielprogramm Neu" });
  });
});
