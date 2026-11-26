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
  fundId: FONDS_ID,
  type: "disbursement",
  referenceType: "transaction",
  referenceId: "v1",
  investmentId: "b1",
  language: "de",
  status: "draft",
  voucherNumber: null as string | null,
  nextStage: 0,
  createdBy: ANDERE_ID,
  createdAt: "2026-11-20T09:00:00.000Z",
  approvedAt: null,
  findings: [] as { field: string; code: string }[],
  template: {
    fields: [
      { key: "organizationName", section: "header", required: true },
      { key: "amount", section: "header", required: true },
      { key: "projectNumber", section: "details", required: true },
    ],
  },
  data: {
    date: "2026-03-31",
    amount: "100000.00",
    values: { organizationName: "Alpha Energie", amount: "100000.00", projectNumber: "P-100" } as Record<string, string | null>,
    sourcesOfFunds: [
      { key: "eigenmittel", labelDe: "Eigenmittel", labelEn: "Own funds", ratio: "0.400000", amount: "40000.00" },
      { key: "landesmittel", labelDe: "Landesmittel", labelEn: "State funds", ratio: "0.600000", amount: "60000.00" },
    ],
  },
  stages: ["review", "approval"],
  history: [] as unknown[],
  nextStageName: "review" as string | null,
  fileSha256: null as string | null,
  ...extra,
});
const belegZeile = (extra: Record<string, unknown> = {}) => ({ ...beleg(), amount: "100000.00", date: "2026-03-31", ...extra });

/** Ordnet per Tastatur: Griff aufnehmen, mit den Pfeiltasten bewegen, ablegen. */
const ordne = (griff: HTMLElement, ...tasten: string[]) => {
  fireEvent.keyDown(griff, { key: " " });
  for (const taste of tasten) fireEvent.keyDown(griff, { key: taste });
  fireEvent.keyDown(griff, { key: " " });
};

describe("Belege: Liste", () => {
  it("listet Nummer, Art, Datum, Betrag, Status und fehlende Angaben und führt zum Beleg", async () => {
    const api = spieleApi({
      "/api/v1/vouchers": { koerper: { data: [belegZeile({ findings: [{ field: "projectNumber", code: "required_field_missing" }] }), belegZeile({ id: "be-2", type: "interest_posting", status: "approved", voucherNumber: "B-000007", amount: "6000.00", date: "2026-09-30" })] } },
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
    expect(api.anfragen("GET", "/api/v1/vouchers")[0]!.query.get("fundId")).toBe(FONDS_ID);
    // Nur über die Navigation erreichbar, Filter nach Status
    await nutzer.selectOptions(screen.getByLabelText("Status"), "freigegeben");
    await waitFor(() => expect(api.anfragen("GET", "/api/v1/vouchers").some((a) => a.query.get("status") === "approved")).toBe(true));
  });

  it("englisch: Texte, Beträge und Daten in der Sprache der Oberfläche", async () => {
    englisch();
    spieleApi({ "/api/v1/vouchers": { koerper: { data: [belegZeile()] } } });
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
    spieleApi({ "/api/v1/vouchers": { koerper: { data: [] } } });
    rendereApp(`/fonds/${FONDS_ID}`);
    await userEvent.setup().click(await screen.findByRole("link", { name: "Belege" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Belege" })).toBeTruthy();
    expect(screen.getByText(/Noch keine Belege/)).toBeTruthy();
  });
});

describe("Beleg: Prüfung und Freigabe", () => {
  it("zeigt fehlende eigene Pflichtfelder beim Namen und speichert die Eingabe am Entwurf", async () => {
    const pfad = `/api/v1/vouchers/${BELEG_ID}`;
    const feld = { key: "custom_referenz", manual: "text", section: "details", required: true, labelDe: "Referenz", labelEn: "Reference" };
    const api = spieleApi({
      [pfad]: { koerper: beleg({ template: { fields: [feld] }, findings: [{ field: feld.key, code: "required_field_missing" }] }) },
      [`PATCH ${pfad}/field-values`]: { koerper: beleg() },
    });
    rendereApp(`/belege/${BELEG_ID}`);
    const nutzer = userEvent.setup();
    expect(await screen.findByText(/Diese Pflichtfelder sind leer: Referenz/)).toBeTruthy();
    await nutzer.type(screen.getByLabelText("Referenz *"), "V-17");
    await nutzer.click(screen.getByRole("button", { name: "Feldwerte speichern" }));
    await waitFor(() => expect(api.anfragen("PATCH", `${pfad}/field-values`)[0]?.koerper).toEqual({ values: { custom_referenz: "V-17" } }));
  });

  it("verwendet beim Direktlink den Fonds des Belegs und wechselt zur Belegliste", async () => {
    const zweiter = { ...fondsDaten.daten[0]!, id: "22222222-2222-4222-8222-222222222222", name: "Beispielfonds II" };
    localStorage.setItem("carraway.fonds", zweiter.id);
    spieleApi({
      "/api/v1/fonds": { koerper: { daten: [...fondsDaten.daten, zweiter] } },
      [`/api/v1/vouchers/${BELEG_ID}`]: { koerper: beleg() },
      "/api/v1/vouchers": { koerper: { data: [] } },
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
      [`/api/v1/vouchers/${BELEG_ID}`]: { koerper: beleg({ findings: [{ field: "projectNumber", code: "required_field_missing" }], data: { ...beleg().data, values: { organizationName: "Alpha Energie", amount: "100000.00", projectNumber: null } } }) },
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
    expect(screen.getByRole("link", { name: "PDF-Entwurf öffnen" }).getAttribute("href")).toBe(`/api/v1/vouchers/${BELEG_ID}/file`);
  });

  it("erteilt die Prüfung, verlangt für die Rückgabe einen Kommentar und sperrt die Person, die den Beleg erzeugt hat", async () => {
    const api = spieleApi({
      [`/api/v1/vouchers/${BELEG_ID}`]: { koerper: beleg() },
      "/api/v1/users/names": { koerper: namenDaten },
      [`POST /api/v1/vouchers/${BELEG_ID}/stage`]: { koerper: beleg({ status: "reviewed", nextStage: 1 }) },
    });
    rendereApp(`/belege/${BELEG_ID}`);
    const nutzer = userEvent.setup();
    const erteilen = (await screen.findByRole("button", { name: "Prüfung erteilen" })) as HTMLButtonElement;
    expect(erteilen.disabled).toBe(false);
    await nutzer.click(screen.getByRole("button", { name: "Zurückgeben" }));
    expect(await screen.findByText("Für die Rückgabe ist ein Kommentar erforderlich.")).toBeTruthy();
    expect(api.anfragen("POST", `/api/v1/vouchers/${BELEG_ID}/stage`)).toHaveLength(0);
    await nutzer.click(erteilen);
    await waitFor(() => expect(api.anfragen("POST", `/api/v1/vouchers/${BELEG_ID}/stage`)).toHaveLength(1));
    expect(api.anfragen("POST", `/api/v1/vouchers/${BELEG_ID}/stage`)[0]!.koerper).toEqual({ stage: "review", result: "ok" });
  });

  it("gesperrt für die Person, die den Beleg erzeugt hat, und für Bearbeiter ohne Freigeberrolle; die Gründe stehen da", async () => {
    spieleApi({ [`/api/v1/vouchers/${BELEG_ID}`]: { koerper: beleg({ createdBy: ICH_ID }) } });
    const a = rendereApp(`/belege/${BELEG_ID}`);
    expect((await screen.findByRole("button", { name: "Prüfung erteilen" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Sie haben den Beleg erzeugt oder zuletzt neu befüllt/)).toBeTruthy();
    a.unmount();
    spieleApi({ "/api/v1/me": alsRolle("bearbeiter"), [`/api/v1/vouchers/${BELEG_ID}`]: { koerper: beleg() } });
    rendereApp(`/belege/${BELEG_ID}`);
    expect((await screen.findByRole("button", { name: "Prüfung erteilen" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Stufen erteilen nur Personen mit der Rolle Freigeber.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Neu befüllen" })).toBeTruthy();
  });

  it("freigegeben: Nummer, Hash und Datei, keine Stufen mehr; englisch", async () => {
    englisch();
    spieleApi({
      [`/api/v1/vouchers/${BELEG_ID}`]: {
        koerper: beleg({
          status: "approved",
          voucherNumber: "B-000042",
          nextStage: 2,
          nextStageName: null,
          fileSha256: "ab".repeat(32),
          history: [
            { id: "p1", voucherId: BELEG_ID, stageIndex: 0, stage: "review", result: "ok", comment: null, actor: ANDERE_ID, at: "2026-11-20T10:00:00.000Z" },
            { id: "p2", voucherId: BELEG_ID, stageIndex: 1, stage: "approval", result: "ok", comment: "in Ordnung", actor: ICH_ID, at: "2026-11-20T11:00:00.000Z" },
          ],
        }),
      },
      "/api/v1/users/names": { koerper: namenDaten },
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
    beleg({ status: "approved", voucherNumber: "B-000042", nextStage: 2, nextStageName: null, fileSha256: "ab".repeat(32), reversedAt: null, reversedBy: null, reversalReason: null, ...extra });
  const PFAD_STORNO = `POST /api/v1/vouchers/${BELEG_ID}/reverse`;

  it("Freigeber stornieren mit Grund; ohne Grund ist der Knopf gesperrt, Serverfehler werden gezeigt", async () => {
    const api = spieleApi({
      [`/api/v1/vouchers/${BELEG_ID}`]: { koerper: frei() },
      [PFAD_STORNO]: fehler(409, "voucher_reversed"),
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
    await waitFor(() => expect(api.anfragen("POST", `/api/v1/vouchers/${BELEG_ID}/reverse`)).toHaveLength(1));
    expect(api.anfragen("POST", `/api/v1/vouchers/${BELEG_ID}/reverse`)[0]!.koerper).toEqual({ reason: "Betrag falsch" });
    expect(await screen.findByText("Der Beleg ist storniert und lässt sich nicht mehr ändern.")).toBeTruthy();
  });

  it("storniert: Status, Grund und Person stehen da, die Datei bleibt, es gibt keine Stufen und keinen Stornieren-Knopf", async () => {
    spieleApi({
      [`/api/v1/vouchers/${BELEG_ID}`]: { koerper: frei({ status: "reversed", reversedAt: "2026-11-21T08:00:00.000Z", reversedBy: ANDERE_ID, reversalReason: "Betrag falsch" }) },
      "/api/v1/users/names": { koerper: namenDaten },
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
    spieleApi({ [`/api/v1/vouchers/${BELEG_ID}`]: { koerper: frei() }, "/api/v1/me": alsRolle("bearbeiter") });
    rendereApp(`/belege/${BELEG_ID}`);
    await screen.findByText(/Freigegeben als B-000042/);
    expect(screen.queryByRole("button", { name: "Stornieren …" })).toBeNull();
    expect(screen.queryByRole("form", { name: "Beleg stornieren" })).toBeNull();
  });

  it("Liste: stornierter Beleg mit Status, Filter nach Status", async () => {
    const api = spieleApi({ "/api/v1/vouchers": { koerper: { data: [belegZeile({ status: "reversed", voucherNumber: "B-000007" }), belegZeile({ id: "be-2", status: "approved", voucherNumber: "B-000008" })] } } });
    rendereApp("/belege");
    const nutzer = userEvent.setup();
    const bereich = await screen.findByRole("region", { name: "Belege des Fonds" });
    expect(within(bereich).getAllByRole("row")[1]!.textContent).toContain("Storniert");
    await nutzer.selectOptions(screen.getByLabelText("Status"), "storniert");
    await waitFor(() => expect(api.anfragen("GET", "/api/v1/vouchers").some((a) => a.query.get("status") === "reversed")).toBe(true));
  });
});

describe("Beleg erzeugen", () => {
  it("am Zinslauf: sendet Art, Bezug und Sprache und führt zum Beleg", async () => {
    const api = spieleApi({
      [`/api/v1/zinslaeufe/${ZL_ID}`]: { koerper: { ...zinslaufDaten, status: "gebucht" } },
      "POST /api/v1/vouchers": { status: 201, koerper: beleg({ type: "interest_posting", referenceType: "interest_run", referenceId: ZL_ID }) },
      [`/api/v1/vouchers/${BELEG_ID}`]: { koerper: beleg({ type: "interest_posting" }) },
    });
    rendereApp(`/zinslaeufe/${ZL_ID}`);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Beleg erzeugen" }));
    await nutzer.click(dialog().getByRole("button", { name: "Erzeugen" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Zinsbuchung" })).toBeTruthy();
    expect(api.anfragen("POST", "/api/v1/vouchers")[0]!.koerper).toEqual({ type: "interest_posting", referenceType: "interest_run", referenceId: ZL_ID, language: "de" });
  });

  it("bietet aktive eigene Belegarten derselben Basis-Art an und sendet die gewählte; ohne eigene Art gibt es keine Auswahl", async () => {
    const eintrag = (art: string, zusatz: object) => ({ type: art, standard: true, fields: [], headerDe: "", headerEn: "", footerDe: "", footerEn: "", catalog: [], customTypeId: null, labelDe: null, labelEn: null, active: true, ...zusatz });
    const api = spieleApi({
      [`/api/v1/zinslaeufe/${ZL_ID}`]: { koerper: { ...zinslaufDaten, status: "gebucht" } },
      [`/api/v1/funds/${FONDS_ID}/voucher-templates`]: {
        koerper: {
          data: [
            eintrag("zinsbuchung", {}),
            eintrag("zinsbuchung", { customTypeId: "art-z", labelDe: "Zinsmeldung", labelEn: "Interest notice" }),
            eintrag("zinsbuchung", { customTypeId: "art-still", labelDe: "Alt", labelEn: "Old", active: false }),
            eintrag("auszahlung", { customTypeId: "art-a", labelDe: "Andere Basis", labelEn: "Other base" }),
          ],
        },
      },
      "POST /api/v1/vouchers": { status: 201, koerper: beleg({ type: "interest_posting", referenceType: "interest_run", referenceId: ZL_ID, customTypeId: "art-z", typeNameDe: "Zinsmeldung", typeNameEn: "Interest notice" }) },
      [`/api/v1/vouchers/${BELEG_ID}`]: { koerper: beleg({ type: "interest_posting", customTypeId: "art-z", typeNameDe: "Zinsmeldung", typeNameEn: "Interest notice" }) },
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
    expect(api.anfragen("POST", "/api/v1/vouchers")[0]!.koerper).toEqual({ type: "interest_posting", customTypeId: "art-z", referenceType: "interest_run", referenceId: ZL_ID, language: "de" });
  });

  it("gibt es schon einen Beleg, führt ein Link dorthin; ohne Rolle Bearbeiter gibt es den Knopf nicht", async () => {
    spieleApi({
      [`/api/v1/zinslaeufe/${ZL_ID}`]: { koerper: { ...zinslaufDaten, status: "gebucht" } },
      "POST /api/v1/vouchers": fehler(409, "voucher_exists", { voucherId: BELEG_ID }),
    });
    const a = rendereApp(`/zinslaeufe/${ZL_ID}`);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Beleg erzeugen" }));
    await nutzer.click(dialog().getByRole("button", { name: "Erzeugen" }));
    expect(await dialog().findByText("Für diesen Vorfall gibt es schon einen Beleg.")).toBeTruthy();
    expect(dialog().getByRole("link", { name: "Beleg öffnen" }).getAttribute("href")).toBe(`/belege/${BELEG_ID}`);
    a.unmount();
    spieleApi({ "/api/v1/me": alsRolle("betrachter"), [`/api/v1/zinslaeufe/${ZL_ID}`]: { koerper: { ...zinslaufDaten, status: "gebucht" } } });
    rendereApp(`/zinslaeufe/${ZL_ID}`);
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("button", { name: "Beleg erzeugen" })).toBeNull();
  });
});

const LAUF_ID = "sl-1";
const lauf = (extra: Record<string, unknown> = {}) => ({
  id: LAUF_ID,
  fundId: FONDS_ID,
  periodFrom: "2026-07-01",
  periodTo: "2026-09-30",
  sourceFileName: "susa.csv",
  fileType: "csv",
  format: "datev",
  size: 100,
  sha256: "cd".repeat(32),
  status: "reviewed",
  uploadedBy: ANDERE_ID,
  uploadedAt: "2026-11-20T09:00:00.000Z",
  reviewedBy: ANDERE_ID,
  reviewedAt: "2026-11-20T09:05:00.000Z",
  errorCount: 0,
  warningCount: 1,
  sum: { accounts: 6, balanceSum: "0.00", debit: "1170.00", credit: "1170.00" },
  appliedBy: null,
  appliedAt: null,
  replacedAt: null,
  replacedByRunId: null,
  ...extra,
});
const buchhaltungUrl = (bereich: string) => `/buchhaltung?bereich=${bereich}`;

describe("Buchhaltung: Saldenlisten", () => {
  it("öffnet die referenzierte Kontenzeile und zeigt die Übernahme zum historischen Stand", async () => {
    const stand = "2026-11-21T09:00:00Z", stichtag = "2026-09-30";
    spieleApi({
      [`/api/v1/balance-runs/${LAUF_ID}`]: { koerper: { ...lauf({ status: "applied", appliedAt: stand, appliedBy: ANDERE_ID }), findings: [] } },
      [`/api/v1/balance-runs/${LAUF_ID}/balances`]: { koerper: { data: [{ account: "0120", balance: "-12.34", label: "Bankkonto" }] } },
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
      [`/api/v1/funds/${FONDS_ID}/balance-runs`]: { koerper: { data: [lauf()] } },
      [`POST /api/v1/funds/${FONDS_ID}/balance-runs`]: { status: 201, koerper: lauf({ id: "sl-2", status: "uploaded", errorCount: null, warningCount: null, sum: null }) },
      [`POST /api/v1/balance-runs/${LAUF_ID}/validate`]: { koerper: lauf() },
      [`POST /api/v1/balance-runs/${LAUF_ID}/apply`]: { koerper: lauf({ status: "applied" }) },
      [`/api/v1/balance-runs/${LAUF_ID}`]: { koerper: { ...lauf(), findings: [{ sequence: 1, row: 4, column: null, code: "unknown_account", severity: "warning", message: "x", params: { account: "7000" } }] } },
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
    expect(api.anfragen("POST", `/api/v1/funds/${FONDS_ID}/balance-runs`)).toHaveLength(0);
    fireEvent.change(screen.getByLabelText("Zeitraum von"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText("Zeitraum bis"), { target: { value: "2026-12-31" } });
    await nutzer.click(screen.getByRole("button", { name: "Hochladen" }));
    await waitFor(() => expect(api.anfragen("POST", `/api/v1/funds/${FONDS_ID}/balance-runs`)).toHaveLength(1));
    const formular = api.anfragen("POST", `/api/v1/funds/${FONDS_ID}/balance-runs`)[0]!.formular!;
    expect((formular.get("file") as File).name).toBe("neu.csv");
    expect(formular.get("periodFrom")).toBe("2026-10-01");
    expect(formular.get("periodTo")).toBe("2026-12-31");

    await nutzer.click(within(liste).getAllByRole("button", { name: "Prüfen" })[0]!);
    await waitFor(() => expect(api.anfragen("POST", `/api/v1/balance-runs/${LAUF_ID}/validate`)).toHaveLength(1));
    // Übernahme: Hochgeladen von einer anderen Person, die angemeldete Verwalterin darf
    await nutzer.click(within(liste).getAllByRole("button", { name: "Übernehmen" })[0]!);
    await waitFor(() => expect(api.anfragen("POST", `/api/v1/balance-runs/${LAUF_ID}/apply`)).toHaveLength(1));
    await nutzer.click(within(liste).getAllByRole("button", { name: "Befunde der Prüfung" })[0]!);
    expect(await screen.findByText(/Das Konto steht nicht im Kontenrahmen des Fonds\. \(7000\)/)).toBeTruthy();
    expect(screen.getByText(/Zeile 4/)).toBeTruthy();
  });

  it("Übernehmen ist für die Person gesperrt, die hochgeladen oder geprüft hat; englisch", async () => {
    englisch();
    spieleApi({ [`/api/v1/funds/${FONDS_ID}/balance-runs`]: { koerper: { data: [lauf({ uploadedBy: ICH_ID })] } } });
    rendereApp(buchhaltungUrl("saldenlisten"));
    const liste = await screen.findByRole("region", { name: "Trial balances of the fund" });
    expect((within(liste).getByRole("button", { name: "Take over" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(liste).getByText(/Only a different person with the role Approver/)).toBeTruthy();
    expect(within(liste).getAllByRole("row")[1]!.textContent).toContain("Checked");
  });
});

const auswertungDaten = {
  view: "balance_sheet",
  periodFrom: "2026-07-01",
  periodTo: "2026-09-30",
  run: { id: LAUF_ID, sourceFileName: "susa.csv", appliedAt: "2026-11-20T10:00:00.000Z", appliedBy: ICH_ID },
  rows: [
    { key: "aktiva", level: 0, labelDe: "Aktiva", labelEn: "Assets", side: "debit", value: "1050.00", leaf: false, accounts: [], steps: [] },
    {
      key: "aktiva.beteiligungen",
      level: 1,
      labelDe: "Beteiligungen",
      labelEn: "Equity investments",
      side: "debit",
      value: "750.00",
      leaf: true,
      accounts: [
        { account: "0100", label: "Beteiligungen", balance: "800.00", ruleId: "r1", contribution: "800.00" },
        { account: "0110", label: "Wertberichtigungen", balance: "-50.00", ruleId: "r1", contribution: "-50.00" },
      ],
      steps: [],
    },
  ],
  unassigned: [{ account: "7000", label: "Sonstiges", balance: "5.00" }],
  ambiguous: [],
};
const periodenDaten = { data: [{ runId: LAUF_ID, periodFrom: "2026-07-01", periodTo: "2026-09-30", appliedAt: "2026-11-20T10:00:00.000Z" }] };
const schrittW = (zeichen: string, bezeichnung: string, wert: string) => ({ symbol: zeichen, label: bezeichnung, value: wert });
const abstimmungDaten = {
  periodFrom: "2026-07-01",
  periodTo: "2026-09-30",
  portfolio: {
    total: { key: "pf.portfolio", label: "Portfolio zu Buchwerten", carraway: "500000.00", accounting: "490000.00", difference: "10000.00", linked: false, steps: [schrittW("", "Buchwerte", "500000.00"), schrittW("=", "Differenz", "10000.00")] },
    rows: [{ key: "b", label: "Beta Medizin (darlehen)", carraway: "100000.00", accounting: "90000.00", difference: "10000.00", linked: true, steps: [] }],
    withoutAccount: [{ investmentId: "b9", label: "Gamma (darlehen)", bookValue: "5000.00" }],
  },
  liquidity: null,
};

describe("Buchhaltung: Auswertungen", () => {
  it("zeigt die Zeilen, die Herkunft je Zeile, nicht zugeordnete Konten und die Ausgaben als Links", async () => {
    const api = spieleApi({
      [`/api/v1/funds/${FONDS_ID}/periods`]: { koerper: periodenDaten },
      [`/api/v1/funds/${FONDS_ID}/evaluation/balance_sheet`]: { koerper: auswertungDaten },
    });
    rendereApp(buchhaltungUrl("auswertung"));
    const nutzer = userEvent.setup();
    const tabelle = within(await screen.findByRole("region", { name: /Bilanz: Zeilen der Auswertung/ }));
    expect(tabelle.getByText("Aktiva")).toBeTruthy();
    expect(schmal(tabelle.getByText("1.050,00 €").textContent)).toBe("1.050,00 €");
    expect(api.anfragen("GET", `/api/v1/funds/${FONDS_ID}/evaluation/balance_sheet`)[0]!.query.get("to")).toBe("2026-09-30");
    // Herkunft: erst nach dem Öffnen
    expect(screen.queryByText("Wertberichtigungen")).toBeNull();
    await nutzer.click(screen.getByRole("button", { name: "Herkunft von Beteiligungen zeigen" }));
    const herkunft = within(screen.getByRole("region", { name: "Herkunft: Beteiligungen" }));
    expect(herkunft.getByText("0110")).toBeTruthy();
    expect(herkunft.getAllByText("-50,00 €")).toHaveLength(2); // Saldo und Beitrag
    await nutzer.click(screen.getByRole("button", { name: "Herkunft von Beteiligungen verbergen" }));
    expect(screen.queryByRole("region", { name: "Herkunft: Beteiligungen" })).toBeNull();
    expect(screen.getByText("1 Konten haben in dieser Sicht keine gültige Kontenregel und fehlen in den Summen.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ausgabe: PDF" }).getAttribute("href")).toBe(`/api/v1/funds/${FONDS_ID}/evaluation/balance_sheet/file?to=2026-09-30&format=pdf&language=de`);
    expect(screen.getByRole("link", { name: "Ausgabe: Excel" }).getAttribute("href")).toContain("format=xlsx");
  });

  it("Portfolio: Abstimmung mit Differenz und Beteiligungen ohne Konto; englisch", async () => {
    englisch();
    spieleApi({
      [`/api/v1/funds/${FONDS_ID}/periods`]: { koerper: periodenDaten },
      [`/api/v1/funds/${FONDS_ID}/evaluation/balance_sheet`]: { koerper: auswertungDaten },
      [`/api/v1/funds/${FONDS_ID}/evaluation/portfolio`]: { koerper: { ...auswertungDaten, view: "portfolio" } },
      [`/api/v1/funds/${FONDS_ID}/reconciliation`]: { koerper: abstimmungDaten },
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
    spieleApi({ [`/api/v1/funds/${FONDS_ID}/periods`]: { koerper: { data: [] } } });
    rendereApp(buchhaltungUrl("auswertung"));
    expect(await screen.findByText(/Es gibt noch keine übernommene Saldenliste/)).toBeTruthy();
  });
});

describe("Buchhaltung: Buchungsexport", () => {
  const gebucht = { daten: [{ ...zinslaufListeDaten.daten[0]!, status: "gebucht" }] };
  const vorschau = {
    format: "EXTF 700 / Buchungsstapel 13",
    dateFrom: "2026-09-30",
    dateTo: "2026-09-30",
    rows: [{ transactionId: "v1", organization: "Alpha Energie", type: "interest", valueDate: "2026-09-30", amount: "16200.62", account: "1200", contraAccount: "4200", direction: "debit", voucherField: "FND-ABCDEF01", postingText: "Zins Alpha Energie", hasVoucher: false, alreadyExported: false }],
    count: 1,
    issues: [{ code: "invalid_account_length" }],
    withoutVoucher: ["v1"],
  };

  it("Vorschau zeigt Konten, Belegfeld und Probleme; Export sendet die Auswahl; schon exportiert wird erklärt", async () => {
    const api = spieleApi({
      "/api/v1/zinslaeufe": { koerper: gebucht },
      [`/api/v1/funds/${FONDS_ID}/posting-exports`]: { koerper: { data: [] } },
      [`POST /api/v1/funds/${FONDS_ID}/posting-exports/preview`]: { koerper: vorschau },
      [`POST /api/v1/funds/${FONDS_ID}/posting-exports`]: fehler(409, "posting_export_already_exported", { transactionIds: ["v1"] }),
    });
    rendereApp(buchhaltungUrl("export"));
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Vorschau" }));
    const zeilen = within(await screen.findByRole("region", { name: "Zeilen des Exports" }));
    expect(zeilen.getByText("FND-ABCDEF01")).toBeTruthy();
    expect(zeilen.getByText("1200")).toBeTruthy();
    expect(screen.getByText(/1 Vorgänge haben noch keinen freigegebenen Beleg/)).toBeTruthy();
    expect(screen.getByText(/Kontonummer hat nicht die Länge/)).toBeTruthy();
    expect(api.anfragen("POST", `/api/v1/funds/${FONDS_ID}/posting-exports/preview`)[0]!.koerper).toEqual({ interestRunId: ZL_ID, repeat: false });
    await nutzer.click(screen.getByRole("button", { name: "Exportieren" }));
    expect(await screen.findByText(/Vorgänge sind schon exportiert/)).toBeTruthy();
    // Wiederholung verlangt einen Grund
    await nutzer.click(screen.getByLabelText(/Erneuter Export/));
    expect((screen.getByRole("button", { name: "Exportieren" }) as HTMLButtonElement).disabled).toBe(true);
    await nutzer.type(screen.getByLabelText("Grund"), "Konten korrigiert");
    expect((screen.getByRole("button", { name: "Exportieren" }) as HTMLButtonElement).disabled).toBe(false);
    await nutzer.click(screen.getByRole("button", { name: "Exportieren" }));
    await waitFor(() => expect(api.anfragen("POST", `/api/v1/funds/${FONDS_ID}/posting-exports`)).toHaveLength(2));
    expect(api.anfragen("POST", `/api/v1/funds/${FONDS_ID}/posting-exports`)[1]!.koerper).toEqual({ interestRunId: ZL_ID, repeat: true, reason: "Konten korrigiert" });
  });

  it("Liste der Exporte mit Download-Link nur für Bearbeiter; englisch", async () => {
    englisch();
    const export1 = { id: "ex1", fundId: FONDS_ID, formatVersion: "EXTF 700 / Buchungsstapel 13", generatedBy: ICH_ID, generatedAt: "2026-11-20T10:00:00.000Z", dateFrom: "2026-09-30", dateTo: "2026-09-30", count: 2, sum: "12000.00", repeat: false, reason: null, fileName: "EXTF_Buchungsstapel.csv", fileSha256: "ee".repeat(32) };
    spieleApi({ "/api/v1/zinslaeufe": { koerper: { daten: [] } }, [`/api/v1/funds/${FONDS_ID}/posting-exports`]: { koerper: { data: [export1] } } });
    rendereApp(buchhaltungUrl("export"));
    expect(await screen.findByText("There is no booked interest run yet.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Download file" }).getAttribute("href")).toBe("/api/v1/posting-exports/ex1/file");
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
  const VORSCHAU = `POST /api/v1/funds/${FONDS_ID}/posting-exports/preview`;
  const EXPORT = `POST /api/v1/funds/${FONDS_ID}/posting-exports`;
  const vorschau = {
    format: "EXTF 700 / Buchungsstapel 13",
    dateFrom: "2026-09-30",
    dateTo: "2026-09-30",
    rows: [{ transactionId: "v1", fundMovementId: null, organization: "Alpha Energie", type: "interest", valueDate: "2026-09-30", amount: "6000.00", account: "1200", contraAccount: "4200", direction: "debit", voucherField: "B-000001", postingText: "Zins", hasVoucher: true, alreadyExported: false }],
    count: 1,
    issues: [{ code: "zero_amount" }],
    withoutVoucher: [],
  };
  const aufbauen = () =>
    spieleApi({
      "/api/v1/zinslaeufe": { koerper: { daten: [] } },
      [`/api/v1/funds/${FONDS_ID}/posting-exports`]: { koerper: { data: [] } },
      [JOURNAL]: {
        koerper: journalAntwort([
          zeile("v1"),
          zeile("v2", { typ: "auszahlung", valuta: "2026-03-31", betrag: "100000.00", buchhaltung: { belegnummer: "B-000002", exportiertAm: null } }),
          zeile("v3", { buchhaltung: { belegnummer: "B-000003", exportiertAm: "2026-10-05T09:00:00.000Z" } }),
          zeile("bw1", { quelle: "fondsbewegung", typ: "abruf", beteiligung: null, betrag: "500000.00" }),
        ]),
      },
      [VORSCHAU]: { koerper: vorschau },
      [EXPORT]: { status: 201, koerper: { id: "ex1", withoutVoucher: [] } },
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
    expect(api.anfragen("POST", `/api/v1/funds/${FONDS_ID}/posting-exports/preview`)[0]!.koerper).toEqual({ transactionIds: ["v1"], fundMovementIds: ["bw1"], repeat: false });

    await nutzer.click(screen.getByRole("button", { name: "Exportieren" }));
    await waitFor(() => expect(api.anfragen("POST", `/api/v1/funds/${FONDS_ID}/posting-exports`)).toHaveLength(1));
    expect(api.anfragen("POST", `/api/v1/funds/${FONDS_ID}/posting-exports`)[0]!.koerper).toEqual({ transactionIds: ["v1"], fundMovementIds: ["bw1"], repeat: false });
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
    spieleApi({ "/api/v1/me": alsRolle("betrachter"), "/api/v1/zinslaeufe": { koerper: { daten: [] } }, [`/api/v1/funds/${FONDS_ID}/posting-exports`]: { koerper: { data: [] } } });
    rendereApp(buchhaltungUrl("export"));
    await screen.findByText("Bisherige Exporte");
    expect(screen.queryByLabelText("Was exportiert wird")).toBeNull();
  });
});

describe("Buchhaltung: Einstellungen", () => {
  const konfig = { fundId: FONDS_ID, advisorNumber: 1234567, clientNumber: 12345, fiscalYearStart: 1, accountNumberLength: 4, voucherPrefix: "B", updatedBy: "x", updatedAt: "2026-11-20T09:00:00.000Z", configured: true };
  const basis = {
    [`/api/v1/funds/${FONDS_ID}/accounting`]: { koerper: konfig },
    [`/api/v1/funds/${FONDS_ID}/funding-sources`]: { koerper: { data: [{ id: "m1", fundId: FONDS_ID, key: "land", labelDe: "Landesmittel", labelEn: "State funds", ratio: "0.600000", reportingType: "public_funds", validFrom: "2020-01-01", validTo: null }, { id: "m2", fundId: FONDS_ID, key: "eigen", labelDe: "Eigenmittel", labelEn: "Own funds", ratio: "0.400000", reportingType: null, validFrom: "2020-01-01", validTo: null }] } },
    [`/api/v1/funds/${FONDS_ID}/accounts`]: { koerper: { data: [{ id: "k1", fundId: FONDS_ID, accountNumber: "1200", label: "Bank", type: "asset", investmentId: null }] } },
    [`/api/v1/funds/${FONDS_ID}/layout`]: { koerper: { data: [{ id: "g1", fundId: FONDS_ID, view: "balance_sheet", key: "aktiva.liquide", parentKey: null, labelDe: "Guthaben bei Kreditinstituten", labelEn: "Cash at bank", order: 10, side: "debit" }] } },
    [`/api/v1/funds/${FONDS_ID}/account-rules`]: { koerper: { data: [{ id: "r1", fundId: FONDS_ID, view: "balance_sheet", accountFrom: "1200", accountTo: "1299", itemKey: "aktiva.liquide", validFrom: "2020-01-01", validTo: null, createdBy: "x", createdAt: "2026-11-20T09:00:00.000Z" }] } },
    [`/api/v1/funds/${FONDS_ID}/voucher-templates`]: {
      koerper: { data: [{ type: "disbursement", standard: true, fields: [{ key: "amount", section: "header", required: true }], headerDe: "", headerEn: "", footerDe: "", footerEn: "", catalog: [{ key: "betrag", kind: "amount", labelDe: "Betrag", labelEn: "Amount" }, { key: "projektnummer", kind: "text", labelDe: "Projektnummer", labelEn: "Project number" }] }] },
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
      [`PUT /api/v1/funds/${FONDS_ID}/accounting`]: { koerper: konfig },
      [`PUT /api/v1/funds/${FONDS_ID}/funding-sources`]: { koerper: { data: [] } },
      [`POST /api/v1/funds/${FONDS_ID}/layout/standard`]: { koerper: { newItems: 31 } },
      [`POST /api/v1/funds/${FONDS_ID}/account-rules`]: { status: 201, koerper: {} },
      [`PUT /api/v1/funds/${FONDS_ID}/voucher-templates/disbursement`]: { koerper: { type: "disbursement" } },
    });
    rendereApp(buchhaltungUrl("einstellungen"));
    const nutzer = userEvent.setup();
    const konfigKarte = within(await karteInnen("Konfiguration"));
    fireEvent.change(konfigKarte.getByLabelText("Mandantennummer"), { target: { value: "777" } });
    await nutzer.click(konfigKarte.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(api.anfragen("PUT", `/api/v1/funds/${FONDS_ID}/accounting`)).toHaveLength(1));
    expect(api.anfragen("PUT", `/api/v1/funds/${FONDS_ID}/accounting`)[0]!.koerper).toEqual({ advisorNumber: 1234567, clientNumber: 777, fiscalYearStart: 1, accountNumberLength: 4, voucherPrefix: "B" });

    const mittel = within(screen.getByRole("region", { name: "Mittelarten" }));
    fireEvent.change(mittel.getByLabelText("Gültig ab"), { target: { value: "2027-01-01" } });
    fireEvent.change(mittel.getAllByLabelText("Quote in Prozent")[0]!, { target: { value: "50" } });
    fireEvent.change(mittel.getAllByLabelText("Quote in Prozent")[1]!, { target: { value: "50" } });
    // Meldeart: die erste bleibt, der zweiten wird eine zugeordnet (für die Förder- und Meldeberichte)
    expect((mittel.getAllByLabelText("Meldeart")[0] as HTMLSelectElement).value).toBe("foerdermittel");
    fireEvent.change(mittel.getAllByLabelText("Meldeart")[1]!, { target: { value: "eigenmittel" } });
    await nutzer.click(mittel.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(api.anfragen("PUT", `/api/v1/funds/${FONDS_ID}/funding-sources`)).toHaveLength(1));
    expect(api.anfragen("PUT", `/api/v1/funds/${FONDS_ID}/funding-sources`)[0]!.koerper).toEqual({
      validFrom: "2027-01-01",
      fundingSources: [
        { key: "land", labelDe: "Landesmittel", labelEn: "State funds", ratio: "0.500000", reportingType: "public_funds" },
        { key: "eigen", labelDe: "Eigenmittel", labelEn: "Own funds", ratio: "0.500000", reportingType: "own_funds" },
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
    await waitFor(() => expect(api.anfragen("POST", `/api/v1/funds/${FONDS_ID}/account-rules`)).toHaveLength(1));
    expect(api.anfragen("POST", `/api/v1/funds/${FONDS_ID}/account-rules`)[0]!.koerper).toEqual({ view: "balance_sheet", accountFrom: "1300", itemKey: "aktiva.liquide", validFrom: "2026-10-01" });

    await nutzer.click(screen.getByRole("button", { name: "Belegvorlagen" }));
    const vorlagen = within(await karteInnen("Belegvorlagen"));
    // Betrag steht schon auf dem Beleg, Projektnummer ist nur im Katalog der verfügbaren Felder
    expect(vorlagen.queryByLabelText("Pflicht: Projektnummer")).toBeNull();
    await nutzer.click(vorlagen.getByRole("button", { name: "Feld hinzufügen: Projektnummer" }));
    expect(vorlagen.queryByRole("button", { name: "Feld hinzufügen: Projektnummer" })).toBeNull();
    await nutzer.click(vorlagen.getByLabelText("Pflicht: Projektnummer"));
    await nutzer.click(vorlagen.getByRole("button", { name: "Speichern: Auszahlung" }));
    await waitFor(() => expect(api.anfragen("PUT", `/api/v1/funds/${FONDS_ID}/voucher-templates/disbursement`)).toHaveLength(1));
    expect((api.anfragen("PUT", `/api/v1/funds/${FONDS_ID}/voucher-templates/disbursement`)[0]!.koerper as { fields: unknown[] }).fields).toEqual([
      { key: "amount", section: "header", required: true },
      { key: "projectNumber", section: "details", required: true },
    ]);
  });

  it("Belegvorlagen: Belegart per Auswahl, Felder hinzufügen, ordnen und entfernen", async () => {
    const vorlage = (art: string, felder: string[]) => ({ type: art, standard: true, fields: felder.map((schluessel) => ({ key: schluessel, section: "header", required: false })), headerDe: "", headerEn: "", footerDe: "", footerEn: "", catalog: [{ key: "betrag", kind: "amount", labelDe: "Betrag", labelEn: "Amount" }, { key: "projektnummer", kind: "text", labelDe: "Projektnummer", labelEn: "Project number" }, { key: "belegdatum", kind: "date", labelDe: "Belegdatum", labelEn: "Voucher date" }] });
    const api = spieleApi({
      ...basis,
      [`/api/v1/funds/${FONDS_ID}/voucher-templates`]: { koerper: { data: [vorlage("auszahlung", ["betrag", "projektnummer"]), vorlage("verkauf", ["belegdatum"])] } },
      [`PUT /api/v1/funds/${FONDS_ID}/voucher-templates/sale`]: { koerper: { type: "sale" } },
    });
    rendereApp("/buchhaltung?tab=einstellungen&unter=vorlagen");
    const nutzer = userEvent.setup();
    const vorlagen = within(await karteInnen("Belegvorlagen"));
    expect(vorlagen.getByText(/Eine Belegvorlage legt fest/)).toBeTruthy();
    const zeilen = () => within(vorlagen.getByRole("list", { name: /^Felder auf dem Beleg/ })).getAllByRole("listitem").map((li) => within(li).getByRole("button", { name: /^Feld verschieben: / }).getAttribute("aria-label")!.replace("Feld verschieben: ", ""));
    expect(zeilen()).toEqual(["Betrag", "Projektnummer"]);
    ordne(vorlagen.getByRole("button", { name: "Feld verschieben: Projektnummer" }), "ArrowUp");
    expect(zeilen()).toEqual(["Projektnummer", "Betrag"]);
    await nutzer.click(vorlagen.getByRole("button", { name: "Feld entfernen: Betrag" }));
    expect(zeilen()).toEqual(["Projektnummer"]);
    // Wechsel der Belegart zeigt deren Vorlage
    await nutzer.selectOptions(vorlagen.getByLabelText("Belegart"), "verkauf");
    expect(zeilen()).toEqual(["Belegdatum"]);
    await nutzer.click(vorlagen.getByRole("button", { name: "Feld hinzufügen: Betrag" }));
    await nutzer.click(vorlagen.getByLabelText("Pflicht: Betrag"));
    await nutzer.click(vorlagen.getByRole("button", { name: "Speichern: Verkauf" }));
    await waitFor(() => expect(api.anfragen("PUT", `/api/v1/funds/${FONDS_ID}/voucher-templates/sale`)).toHaveLength(1));
    expect((api.anfragen("PUT", `/api/v1/funds/${FONDS_ID}/voucher-templates/sale`)[0]!.koerper as { fields: unknown[] }).fields).toEqual([
      { key: "voucherDate", section: "header", required: false },
      { key: "amount", section: "details", required: true },
    ]);
  });

  describe("eigene Belegarten", () => {
    const katalog = [{ key: "betrag", kind: "amount", labelDe: "Betrag", labelEn: "Amount" }, { key: "projektnummer", kind: "text", labelDe: "Projektnummer", labelEn: "Project number" }];
    const zeile = (art: string, zusatz: object = {}) => ({ type: art, standard: true, fields: [{ key: "amount", section: "header", required: true }], headerDe: "", headerEn: "", footerDe: "", footerEn: "", catalog: katalog, customTypeId: null, labelDe: null, labelEn: null, active: true, ...zusatz });
    const eigene = zeile("auszahlung", { customTypeId: "art-1", labelDe: "Abruf Sonderprogramm", labelEn: "Special programme call", active: true });
    const url = `/api/v1/funds/${FONDS_ID}/voucher-templates`;
    const arten = `/api/v1/funds/${FONDS_ID}/voucher-types`;

    it("Verwalter legen eine Belegart mit Name in beiden Sprachen und Basis-Art an; sie erscheint in der Auswahl", async () => {
      const api = spieleApi({
        ...basis,
        [url]: { koerper: { data: [zeile("auszahlung"), zeile("verkauf")] } },
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
      expect(api.anfragen("POST", arten)[0]!.koerper).toEqual({ baseType: "sale", labelDe: "Abruf Sonderprogramm", labelEn: "Special programme call" });
    });

    it("ergänzt ein eigenes Betragsfeld mit Pflicht und zweisprachiger Beschriftung", async () => {
      const api = spieleApi({ ...basis, [url]: { koerper: { data: [eigene] } }, [`PUT ${url}/art-1`]: { koerper: eigene } });
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
        fields: [{ key: "amount" }, { key: expect.stringMatching(/^custom_/), manual: "amount", required: true, labelDe: "Gebühr", labelEn: "Fee" }],
      }));
    });

    it("eigene Belegart: Auswahl nennt den Namen, Vorlage speichert unter der Id, Name ändern und Stilllegen, Löschen nach Rückfrage", async () => {
      const api = spieleApi({
        ...basis,
        [url]: { koerper: { data: [zeile("auszahlung"), eigene] } },
        [`PUT ${url}/art-1`]: { koerper: { type: "disbursement" } },
        [`PUT ${arten}/art-1`]: { koerper: { id: "art-1" } },
        [`DELETE ${arten}/art-1`]: fehler(409, "voucher_type_in_use", { voucherId: "b" }),
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
      expect(api.anfragen("PUT", `${arten}/art-1`)[0]!.koerper).toEqual({ labelDe: "Abruf Plus", labelEn: "Special programme call", active: false });
      // Löschen: Rückfrage, dann Serverfehler sichtbar
      await nutzer.click(vorlagen.getByRole("button", { name: "Belegart löschen" }));
      expect(api.anfragen("DELETE", `${arten}/art-1`)).toHaveLength(0);
      await nutzer.click(vorlagen.getByRole("button", { name: "Ja, löschen" }));
      expect(await vorlagen.findByText("Es gibt Belege dieser Art. Sie lässt sich nur stilllegen.")).toBeTruthy();
    });

    it("ohne Rolle Verwalter: keine Knöpfe zum Anlegen, Ändern und Löschen", async () => {
      spieleApi({ ...basis, "/api/v1/me": alsRolle("bearbeiter"), [url]: { koerper: { data: [zeile("auszahlung"), eigene] } } });
      rendereApp("/buchhaltung?tab=einstellungen&unter=vorlagen");
      const vorlagen = within(await karteInnen("Belegvorlagen"));
      expect(vorlagen.queryByRole("button", { name: "Eigene Belegart anlegen" })).toBeNull();
      await userEvent.setup().selectOptions(vorlagen.getByLabelText("Belegart"), "art-1");
      expect(vorlagen.queryByRole("button", { name: "Belegart löschen" })).toBeNull();
      expect(vorlagen.queryByRole("button", { name: "Name speichern" })).toBeNull();
    });
  });

  it("ohne Rolle Verwalter: Hinweis, Felder gesperrt, keine Speichern-Knöpfe", async () => {
    spieleApi({ ...basis, "/api/v1/me": alsRolle("bearbeiter") });
    rendereApp(buchhaltungUrl("einstellungen"));
    expect(await screen.findByText("Einstellungen ändern darf die Verwalterin oder der Verwalter des Fonds.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Speichern" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Standardgliederung anlegen" })).toBeNull();
    expect(((await screen.findByLabelText("Beraternummer")) as HTMLInputElement).disabled).toBe(true);
  });

  it("zeigt Fehlercodes der API übersetzt (Quoten ergeben nicht 100 %), englisch", async () => {
    englisch();
    spieleApi({ ...basis, [`PUT /api/v1/funds/${FONDS_ID}/funding-sources`]: fehler(409, "funding_sources_sum_invalid") });
    rendereApp(buchhaltungUrl("einstellungen"));
    const mittel = within(await screen.findByRole("region", { name: "Types of funds" }));
    fireEvent.change(mittel.getByLabelText("Valid from"), { target: { value: "2027-01-01" } });
    await userEvent.setup().click(mittel.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("The shares of the types of funds do not add up to 100%.")).toBeTruthy();
  });
});
