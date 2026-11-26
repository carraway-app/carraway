import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { BET_ID, FONDS_ID, ORG_A, ORG_B, fehler, ichDaten, instrumentDaten, instrumentZeile, kapitalDaten, letzteRegion, rendereApp, spieleApi } from "../test/hilfen";

/** Oberfläche für SAFE, Optionsscheine (Ausübung, Storno) und Anteilsübertragungen (Liste, Erfassen, Storno, Sammelzeilen „Andere Fonds“). */

const url = `/beteiligungen/${BET_ID}`;
const instrumenteUrl = `${url}?tab=finanzierung&unter=instrumente`;
const kapitalUrl = `${url}?tab=finanzierung&unter=kapitaltabelle`;
const OS_ID = "os1";
const SAFE_ID = "safe1";
const AUS_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const UE_ID = "bbbbbbbb-0000-4000-8000-000000000001";
const UE_STORNO = "bbbbbbbb-0000-4000-8000-000000000002";
const UE_VERDECKT = "bbbbbbbb-0000-4000-8000-000000000003";
const dialog = () => within(screen.getByRole("dialog"));

const optionsschein = instrumentZeile(OS_ID, "Optionsscheine 2026", "optionsschein", {
  darlehensartig: false,
  istHauptinstrument: false,
  tranchen: [],
  optionsschein: {
    anzahl: "20000",
    ausuebungspreis: "1.2500",
    ausgabeAm: "2026-01-15",
    laufzeitBis: "2031-01-14",
    stichtag: "2026-11-26",
    ausgeuebt: "5000",
    offen: "15000",
    verfallen: "0",
    status: "laufend",
    schritte: [],
    ausuebungen: [{ id: AUS_ID, datum: "2026-05-01", anzahl: "5000", preisJeAnteil: "1.2500", betrag: "6250.00", zusageVorgangId: null, auszahlungVorgangId: null, bemerkung: null }],
  },
});
const safe = instrumentZeile(SAFE_ID, "SAFE 2026", "safe", { darlehensartig: false, istHauptinstrument: false, tranchen: [], wandlungsabschlag: "0.200000", bewertungsobergrenze: "6000000.00" });
const instrumente = { [`/api/v1/beteiligungen/${BET_ID}/instrumentdaten`]: { koerper: { ...instrumentDaten, instrumente: [safe, optionsschein] } } };

describe("SAFE und Optionsscheine auf der Instrumentenseite", () => {
  it("SAFE: Aktion „Wandeln“ und Wandlungsparameter ohne Zinsen; Wandlungsdialog ohne Zinsfelder", async () => {
    spieleApi(instrumente);
    rendereApp(instrumenteUrl);
    const inst = within(await letzteRegion("Instrumente"));
    const karte = await inst.findByRole("group", { name: /^SAFE 2026/ });
    expect(within(karte).queryByText("Zinsen wandeln mit")).toBeNull();
    expect(within(karte).getByText("Abschlag")).toBeTruthy();
    await userEvent.setup().click(within(karte).getByRole("button", { name: "Wandeln: SAFE 2026" }));
    const d = await screen.findByRole("dialog").then((e) => within(e));
    expect(d.getByText(/Wandeldarlehen oder SAFE/)).toBeTruthy();
    expect(d.queryByLabelText("Zinsen")).toBeNull();
    expect(d.queryByLabelText(/Gewandelte Zinsen/)).toBeNull();
    await userEvent.setup().keyboard("{Escape}");
  });

  it("Optionsscheine: Bedingungen und Stand, Ausübungen; Ausüben bucht über die API", async () => {
    const api = spieleApi({ ...instrumente, [`POST /api/v1/instrumente/${OS_ID}/exercises`]: { status: 201, koerper: {} } });
    rendereApp(instrumenteUrl);
    const inst = within(await letzteRegion("Instrumente"));
    const karte = within(await inst.findByRole("group", { name: /^Optionsscheine 2026/ }));
    expect(karte.getByText("Noch offen")).toBeTruthy();
    expect(karte.getByText(/Laufend/)).toBeTruthy();
    expect(karte.getByText("Ausübungspreis je Anteil")).toBeTruthy();
    expect(karte.getByRole("row", { name: /5\.000/ })).toBeTruthy();
    expect(karte.queryByText(/Wandeln/)).toBeNull();
    const nutzer = userEvent.setup();
    await nutzer.click(karte.getByRole("button", { name: "Ausüben: Optionsscheine 2026" }));
    const d = await screen.findByRole("dialog").then((e) => within(e));
    expect(d.getByText("Noch offen: 15.000.")).toBeTruthy();
    fireEvent.change(d.getByLabelText("Datum der Ausübung"), { target: { value: "2026-06-01" } });
    await nutzer.type(d.getByLabelText("Anzahl Anteile"), "2000");
    await nutzer.click(d.getByRole("button", { name: "Ausübung buchen" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.anfragen("POST", `/api/v1/instrumente/${OS_ID}/exercises`)[0]!.koerper).toEqual({ date: "2026-06-01", shares: "2000" });
  });

  it("Storno einer Ausübung mit Grund; Fehler der API (abhängige Übertragung) erscheint im Dialog", async () => {
    let versuche = 0;
    const api = spieleApi({
      ...instrumente,
      [`POST /api/v1/instrumente/${OS_ID}/exercises/${AUS_ID}/reverse`]: () => {
        versuche++;
        return versuche === 1 ? fehler(409, "warrant_exercise_reversal_dependent") : { status: 201, koerper: {} };
      },
    });
    rendereApp(instrumenteUrl);
    const inst = within(await letzteRegion("Instrumente"));
    const karte = within(await inst.findByRole("group", { name: /^Optionsscheine 2026/ }));
    const nutzer = userEvent.setup();
    await nutzer.click(karte.getByRole("button", { name: /Ausübung vom .* über 5\.000 Anteile stornieren/ }));
    const d = await screen.findByRole("dialog").then((e) => within(e));
    await nutzer.type(d.getByLabelText("Grund"), "Irrtum");
    await nutzer.click(d.getByRole("button", { name: "Ausübung stornieren" }));
    expect(await d.findByText(/Bitte zuerst die Übertragung stornieren/)).toBeTruthy();
    await nutzer.click(d.getByRole("button", { name: "Ausübung stornieren" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.anfragen("POST", `/api/v1/instrumente/${OS_ID}/exercises/${AUS_ID}/reverse`)[1]!.koerper).toEqual({ reason: "Irrtum" });
  });

  it("Optionsschein anlegen: Anzahl und Ausübungspreis gehören zum Instrument", async () => {
    const api = spieleApi({ ...instrumente, [`POST /api/v1/beteiligungen/${BET_ID}/instrumente`]: { status: 201, koerper: { id: "neu" } } });
    rendereApp(instrumenteUrl);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Instrument anlegen" }));
    await screen.findByRole("dialog");
    const d = dialog();
    await nutzer.selectOptions(d.getByLabelText("Art"), "optionsschein");
    await nutzer.type(d.getByLabelText("Anzahl Optionsscheine"), "20000");
    await nutzer.type(d.getByLabelText("Ausübungspreis je Anteil"), "1,25");
    fireEvent.change(d.getByLabelText("Laufzeit bis (optional)"), { target: { value: "2031-01-14" } });
    await nutzer.click(d.getByRole("button", { name: "Instrument anlegen" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.anfragen("POST", `/api/v1/beteiligungen/${BET_ID}/instrumente`)[0]!.koerper).toEqual({ art: "optionsschein", optionsscheinAnzahl: "20000", ausuebungspreis: "1.25", laufzeitBis: "2031-01-14" });
  });
});

const uebertragung = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  organizationId: ORG_A,
  date: "2026-05-01",
  source: "p2",
  seller: { type: "investor", id: ORG_B, name: "Beta Medizin", vehicle: { id: "v1", name: "Beta Medizin" } },
  buyer: { type: "fund", id: FONDS_ID, name: "Beispielfonds I", vehicle: null },
  shares: "20000",
  pricePerShare: "20.000000",
  purchasePrice: "400000.00",
  saleId: null,
  buyerInstrumentId: null,
  note: null,
  recordedAt: "2026-05-01T08:00:00.000Z",
  reversedAt: null,
  ...extra,
});
const uebertragungen = [
  uebertragung(UE_ID),
  uebertragung(UE_STORNO, { date: "2026-04-01", shares: "100", reversedAt: "2026-04-02T08:00:00.000Z" }),
  uebertragung(UE_VERDECKT, { date: "2026-06-01", source: null, seller: { type: "fund", id: null, name: "", vehicle: null }, pricePerShare: null, purchasePrice: null }),
];
const SHARE = `/api/v1/organisationen/${ORG_A}/share-transfers`;

describe("Optionsschein bearbeiten und Captable-Zeilen", () => {
  it("Bearbeiten übernimmt den Ausübungspreis ohne Nullen am Ende und sendet ihn unverändert", async () => {
    const api = spieleApi({ ...instrumente, [`PATCH /api/v1/instrumente/${OS_ID}`]: { status: 200, koerper: {} } });
    rendereApp(instrumenteUrl);
    const inst = within(await letzteRegion("Instrumente"));
    const karte = within(await inst.findByRole("group", { name: /^Optionsscheine 2026/ }));
    const nutzer = userEvent.setup();
    await nutzer.click(karte.getByRole("button", { name: "Bearbeiten: Optionsscheine 2026" }));
    const d = await screen.findByRole("dialog").then((e) => within(e));
    expect((d.getByLabelText("Ausübungspreis je Anteil") as HTMLInputElement).value).toBe("1.25");
    await nutzer.click(d.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.anfragen("PATCH", `/api/v1/instrumente/${OS_ID}`)[0]!.koerper).toMatchObject({ optionsscheinAnzahl: "20000", ausuebungspreis: "1.25" });
  });

  it("Captable: Zeilen aus Ausübung, Übertragung und Sammelzeilen anderer Fonds haben keine Klassenwahl und tragen die richtigen Namen", async () => {
    const z = kapitalDaten.zeilen[1]!;
    const sammel = (id: string, halter: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ ...z, id, halter, diesesFonds: false, anteile: "100", ausgegeben: true, ...extra });
    spieleApi({
      "/api/v1/ich": { koerper: { ...ichDaten, globalVerwalter: true } },
      [`/api/v1/beteiligungen/${BET_ID}/kapitaltabelle`]: {
        koerper: {
          ...kapitalDaten,
          zeilen: [
            ...kapitalDaten.zeilen,
            sammel(`ausuebung:${AUS_ID}`, { art: "fonds", id: FONDS_ID, name: "Beispielfonds I", vehikel: null }),
            sammel("ausuebung:verdeckt:stamm", { art: "fonds", id: null, name: "", vehikel: null }),
            sammel("optionsschein:verdeckt", { art: "optionsschein", id: null, name: "", vehikel: null }, { ausgegeben: false }),
          ],
        },
      },
    });
    rendereApp(kapitalUrl);
    const abschnitt = within(await letzteRegion("Captable"));
    const tabelle = within(await abschnitt.findByRole("region", { name: "Captable nach Inhaber und Klasse" }));
    const zeilen = tabelle.getAllByRole("row");
    const verdeckt = zeilen.find((r) => r.textContent?.includes("Andere Fonds"))!;
    expect(verdeckt).toBeTruthy();
    expect(within(verdeckt).queryByRole("combobox")).toBeNull();
    const ausuebung = zeilen.find((r) => r.textContent?.includes("Aus Optionsscheinen") && !r.textContent.includes("Andere Fonds"))!;
    expect(within(ausuebung).queryByRole("combobox")).toBeNull();
    expect(zeilen.some((r) => r.textContent?.includes("Optionsscheine anderer Fonds"))).toBe(true);
  });
});

describe("Anteilsübertragungen in der Captable", () => {
  it("listet Übertragungen mit Stand; verdeckte Fonds als „Andere Fonds“ ohne Preis, stornierte markiert ohne Storno-Knopf", async () => {
    spieleApi({ [SHARE]: { koerper: { data: uebertragungen } }, "/api/v1/ich": { koerper: { ...ichDaten, globalVerwalter: true } } });
    rendereApp(kapitalUrl);
    const abschnitt = within(await letzteRegion("Anteilsübertragungen"));
    const tabelle = within(await abschnitt.findByRole("table"));
    const zeilen = tabelle.getAllByRole("row");
    expect(zeilen).toHaveLength(4);
    expect(zeilen[1]!.textContent).toContain("Beta Medizin");
    expect(zeilen[1]!.textContent).toContain("Gebucht");
    expect(zeilen[2]!.textContent).toContain("Storniert am");
    expect(within(zeilen[2]!).queryByRole("button", { name: /stornieren/ })).toBeNull();
    expect(zeilen[3]!.textContent).toContain("Andere Fonds");
    expect(zeilen[3]!.textContent).not.toContain("20,00");
  });

  it("Storno der Übertragung mit Grund über die API", async () => {
    const api = spieleApi({ [SHARE]: { koerper: { data: [uebertragung(UE_ID)] } }, [`POST ${SHARE}/${UE_ID}/reverse`]: { status: 201, koerper: {} }, "/api/v1/ich": { koerper: { ...ichDaten, globalVerwalter: true } } });
    rendereApp(kapitalUrl);
    const abschnitt = within(await letzteRegion("Anteilsübertragungen"));
    const nutzer = userEvent.setup();
    await nutzer.click(await abschnitt.findByRole("button", { name: /Übertragung vom .* über 20\.000 Anteile stornieren/ }));
    const d = await screen.findByRole("dialog").then((e) => within(e));
    await nutzer.type(d.getByLabelText("Grund"), "Falscher Käufer");
    await nutzer.click(d.getByRole("button", { name: "Übertragung stornieren" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.anfragen("POST", `${SHARE}/${UE_ID}/reverse`)[0]!.koerper).toEqual({ reason: "Falscher Käufer" });
  });

  it("Erfassen: Quelle aus der Captable zum Datum, Käufer ein Fonds; ausgeübte Optionsscheine sind wählbar", async () => {
    const quelle = `ausuebung:${AUS_ID}`;
    const api = spieleApi({
      [SHARE]: { koerper: { data: [] } },
      [`POST ${SHARE}`]: { status: 201, koerper: uebertragung(UE_ID) },
      [`/api/v1/beteiligungen/${BET_ID}/kapitaltabelle`]: {
        koerper: {
          ...kapitalDaten,
          zeilen: [
            ...kapitalDaten.zeilen,
            { ...kapitalDaten.zeilen[1]!, id: quelle, anteile: "5000", ausgegeben: true },
            { ...kapitalDaten.zeilen[1]!, id: "ausuebung:verdeckt:stamm", anteile: "100", ausgegeben: true, halter: { art: "fonds", id: null, name: "", vehikel: null } },
          ],
        },
      },
      "/api/v1/ich": { koerper: { ...ichDaten, globalVerwalter: true } },
    });
    rendereApp(kapitalUrl);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Übertragung erfassen" }));
    const d = await screen.findByRole("dialog").then((e) => within(e));
    const quellen = await d.findByLabelText("Abgebender Bestand");
    await waitFor(() => expect(within(quellen).getAllByRole("option").length).toBeGreaterThanOrEqual(2));
    const optionen = within(quellen).getAllByRole("option");
    expect(optionen.some((o) => (o as HTMLOptionElement).value === quelle)).toBe(true);
    expect(optionen.some((o) => (o as HTMLOptionElement).value.includes("verdeckt"))).toBe(false);
    await nutzer.selectOptions(quellen, quelle);
    await nutzer.click(d.getByRole("button", { name: "Fonds dieser Plattform" }));
    await nutzer.selectOptions(d.getByLabelText("Käuferfonds"), FONDS_ID);
    await nutzer.type(d.getByLabelText("Anzahl Anteile"), "2000");
    await nutzer.type(d.getByLabelText("Preis je Anteil"), "10,5");
    await nutzer.click(d.getByRole("button", { name: "Übertragung buchen" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.anfragen("POST", SHARE)[0]!.koerper).toMatchObject({ source: quelle, buyerFundId: FONDS_ID, shares: "2000", pricePerShare: "10.5" });
  });
});
