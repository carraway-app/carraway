import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { alsRolle, BET_ID, DEAL_ID, FONDS_ID, ICH_ID, ZL_ID, dealDetailDaten, fehler, rendereApp, spieleApi, zinslaufDaten, zustimmung } from "../test/hilfen";
import { de } from "../i18n/de";
import { en } from "../i18n/en";

const ICH = "/api/v1/ich";
const ANDERE = "88888888-8888-4888-8888-888888888888";
const ICH_EIGENE = ICH_ID;

describe("Rechte in der Oberfläche", () => {
  it("blendet für Betrachter schreibende Aktionen aus und nennt den Grund", async () => {
    spieleApi({ [ICH]: alsRolle("betrachter") });
    const { unmount } = rendereApp("/dealflow");
    await screen.findByRole("heading", { name: /Dealflow/i });
    expect(screen.queryByRole("button", { name: "Neuer Deal" })).toBeNull();
    expect(screen.getByText(de.rechte.nurLesen)).toBeTruthy();
    unmount();

    spieleApi({ [ICH]: alsRolle("betrachter") });
    const kontakte = rendereApp("/kontakte");
    await screen.findByRole("heading", { name: /Kontakte/i });
    expect(screen.queryByRole("button", { name: "Neue Organisation" })).toBeNull();
    kontakte.unmount();

    spieleApi({ [ICH]: alsRolle("betrachter") });
    rendereApp(`/beteiligungen/${BET_ID}`);
    expect(await screen.findByText(de.rechte.nurLesenRolle("Betrachter"))).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Vorgang erfassen" })).toBeNull();
    expect(screen.queryByRole("button", { name: /stornieren/ })).toBeNull();
  });

  it("bietet Bearbeitern das Erfassen an, nicht aber das Freigeben; globale Verwalter dürfen alles", async () => {
    spieleApi({ [ICH]: alsRolle("bearbeiter") });
    const { unmount } = rendereApp("/dealflow");
    expect(await screen.findByRole("button", { name: "Neuer Deal" })).toBeTruthy();
    unmount();

    spieleApi({ [ICH]: alsRolle("bearbeiter"), [`/api/v1/zinslaeufe/${ZL_ID}`]: { koerper: { ...zinslaufDaten, geprueftVon: ANDERE } } });
    const lauf = rendereApp(`/zinslaeufe/${ZL_ID}`);
    const freigeben = await screen.findByRole("button", { name: "Freigeben" });
    expect((freigeben as HTMLButtonElement).disabled).toBe(true);
    expect(freigeben.getAttribute("aria-describedby")).toBeTruthy();
    expect(screen.getByText(de.rechte.braucht("Freigeber"))).toBeTruthy();
    expect((screen.getByRole("button", { name: "Verwerfen" }) as HTMLButtonElement).disabled).toBe(true);
    lauf.unmount();

    spieleApi({ [`/api/v1/zinslaeufe/${ZL_ID}`]: { koerper: { ...zinslaufDaten, geprueftVon: ANDERE } } });
    rendereApp(`/zinslaeufe/${ZL_ID}`);
    expect((await screen.findByRole("button", { name: "Freigeben" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("sperrt die Freigabe für die Person, die geprüft hat, zeigt Namen statt IDs und erklärt die Regel in beiden Sprachen", async () => {
    const api = spieleApi({
      [ICH]: alsRolle("freigeber"),
      "/api/v1/benutzer/namen": { koerper: { daten: [{ id: ICH_EIGENE, name: "Vera Beispiel" }, { id: ANDERE, name: "Berta Beispiel" }] } },
      [`/api/v1/zinslaeufe/${ZL_ID}`]: { koerper: { ...zinslaufDaten, berechnetVon: ANDERE, geprueftVon: ICH_EIGENE } },
    });
    rendereApp(`/zinslaeufe/${ZL_ID}`);
    const freigeben = await screen.findByRole("button", { name: "Freigeben" });
    expect((freigeben as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(de.rechte.vierAugenFreigabe)).toBeTruthy();
    const fakten = within(screen.getByRole("region", { name: "Status des Zinslaufs" }));
    expect((await fakten.findByText(/^Berta Beispiel,/))).toBeTruthy();
    expect(fakten.getByText(/^Vera Beispiel,/)).toBeTruthy();
    const namenAnfrage = api.anfragen("GET", "/api/v1/benutzer/namen")[0]!;
    expect(namenAnfrage.query.get("ids")?.split(",").sort()).toEqual([ANDERE, ICH_EIGENE].sort());
  });

  it("fragt keine Namen für Altbestand ('system') und zeigt dafür einen neutralen Text", async () => {
    const api = spieleApi();
    rendereApp(`/zinslaeufe/${ZL_ID}`);
    await screen.findByRole("button", { name: "Freigeben" });
    expect(api.anfragen("GET", "/api/v1/benutzer/namen")).toHaveLength(0);
    expect(screen.getAllByText(/^System,/).length).toBeGreaterThan(0);
  });

  it("erklärt VIER_AUGEN_VERLETZT beim Freigeben in beiden Sprachen", async () => {
    spieleApi({ [`/api/v1/zinslaeufe/${ZL_ID}`]: { koerper: { ...zinslaufDaten, geprueftVon: ANDERE } }, [`POST /api/v1/zinslaeufe/${ZL_ID}/freigeben`]: fehler(409, "VIER_AUGEN_VERLETZT") });
    localStorage.setItem("carraway.sprache", "en");
    rendereApp(`/zinslaeufe/${ZL_ID}`);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Approve" }));
    expect((await screen.findByRole("alert")).textContent).toContain(en.fehler.VIER_AUGEN_VERLETZT);
  });
});

describe("Beschluss und Übergang mit echten Personen", () => {
  it("sperrt Zustimmen für Bearbeiter und erklärt es; Ablehnen bleibt möglich", async () => {
    const api = spieleApi({ [ICH]: alsRolle("bearbeiter"), [`/api/v1/deals/${DEAL_ID}`]: { koerper: { ...dealDetailDaten, fondsId: FONDS_ID } }, [`POST /api/v1/deals/${DEAL_ID}/beschluesse`]: { status: 201, koerper: {} } });
    rendereApp(`/deals/${DEAL_ID}?tab=beschluss`);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Beschluss erfassen" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Beschluss erfassen" }));
    expect((dialog.getByRole("option", { name: "Zugestimmt" }) as HTMLOptionElement).disabled).toBe(true);
    expect((dialog.getByLabelText("Ergebnis") as HTMLSelectElement).value).toBe("abgelehnt");
    expect(dialog.getByText(de.rechte.zustimmenBraucht("Freigeber"))).toBeTruthy();
    await nutzer.type(dialog.getByLabelText("Gremium"), "Ausschuss");
    await nutzer.click(dialog.getByRole("button", { name: "Beschluss speichern" }));
    expect(api.anfragen("POST", `/api/v1/deals/${DEAL_ID}/beschluesse`)[0]!.koerper).toMatchObject({ ergebnis: "abgelehnt" });
    expect(JSON.stringify(api.anfragen("POST", `/api/v1/deals/${DEAL_ID}/beschluesse`)[0]!.koerper)).not.toContain("fondsId");
  });

  it("verlangt bei Zustimmung ohne Fonds am Deal einen Fonds und sendet ihn mit", async () => {
    const api = spieleApi({ [ICH]: alsRolle("freigeber"), [`/api/v1/deals/${DEAL_ID}`]: { koerper: { ...dealDetailDaten, fondsId: null } }, [`POST /api/v1/deals/${DEAL_ID}/beschluesse`]: { status: 201, koerper: {} } });
    rendereApp(`/deals/${DEAL_ID}?tab=beschluss`);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Beschluss erfassen" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Beschluss erfassen" }));
    expect((dialog.getByLabelText("Fonds des Beschlusses") as HTMLSelectElement).value).toBe(FONDS_ID);
    // Ablehnen braucht keinen Fonds
    await nutzer.selectOptions(dialog.getByRole("combobox", { name: "Ergebnis" }), "abgelehnt");
    expect(dialog.queryByLabelText("Fonds des Beschlusses")).toBeNull();
    await nutzer.selectOptions(dialog.getByRole("combobox", { name: "Ergebnis" }), "zugestimmt");
    await nutzer.type(dialog.getByLabelText("Gremium"), "Ausschuss");
    await nutzer.click(dialog.getByRole("button", { name: "Beschluss speichern" }));
    expect(api.anfragen("POST", `/api/v1/deals/${DEAL_ID}/beschluesse`)[0]!.koerper).toMatchObject({ ergebnis: "zugestimmt", fondsId: FONDS_ID });
  });

  it("sperrt den Übergang für die Person, die zugestimmt hat, und zeigt, wer den Beschluss erfasst hat", async () => {
    spieleApi({
      [ICH]: alsRolle("freigeber"),
      "/api/v1/benutzer/namen": { koerper: { daten: [{ id: ICH_EIGENE, name: "Vera Beispiel" }] } },
      [`/api/v1/deals/${DEAL_ID}`]: { koerper: { ...dealDetailDaten, beschluesse: [{ ...zustimmung, erfasstVon: ICH_EIGENE }] } },
    });
    rendereApp(`/deals/${DEAL_ID}`);
    const knopf = await screen.findByRole("button", { name: "Ins Portfolio übernehmen" });
    expect((knopf as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(de.rechte.vierAugenBeschluss)).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("button", { name: /^Beschluss/ }));
    expect(await screen.findByRole("cell", { name: "Vera Beispiel" })).toBeTruthy();
  });

  it("belegt die Übernahme mit dem Fonds des Beschlusses vor und übersetzt die neuen Fehlercodes", async () => {
    const zweiterFonds = "22222222-2222-4222-8222-222222222222";
    spieleApi({
      "/api/v1/fonds": { koerper: { daten: [{ id: FONDS_ID, name: "Beispielfonds I", kurzname: "BF I", vintage: 2019, zeichnungskapital: "1", waehrung: "EUR" }, { id: zweiterFonds, name: "Beispielfonds II", kurzname: "BF II", vintage: 2021, zeichnungskapital: "1", waehrung: "EUR" }] } },
      [`/api/v1/deals/${DEAL_ID}`]: { koerper: { ...dealDetailDaten, fondsId: null, beschluesse: [{ ...zustimmung, fondsId: zweiterFonds }] } },
      [`POST /api/v1/deals/${DEAL_ID}/beteiligung`]: fehler(409, "BESCHLUSS_FONDS_ABWEICHEND"),
    });
    rendereApp(`/deals/${DEAL_ID}`);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Ins Portfolio übernehmen" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Ins Portfolio übernehmen" }));
    expect((dialog.getByLabelText("Fonds") as HTMLSelectElement).value).toBe(zweiterFonds);
    await nutzer.click(dialog.getByRole("button", { name: "Beteiligung anlegen" }));
    expect((await dialog.findByRole("alert")).textContent).toContain(de.fehler.BESCHLUSS_FONDS_ABWEICHEND);
    for (const code of ["DEAL_FONDS_GESPERRT", "FONDS_ERFORDERLICH", "FONDS_NUR_BEI_ZUSTIMMUNG"] as const) {
      expect(de.fehler[code].length).toBeGreaterThan(10);
      expect(en.fehler[code].length).toBeGreaterThan(10);
    }
  });
});

describe("Periodensperre am Formular", () => {
  it("zeigt PERIODE_GESPERRT mit Datum, ohne Datum und auf Englisch", async () => {
    const pfad = `POST /api/v1/beteiligungen/${BET_ID}/vorgaenge`;
    const neuer = async (antwort: ReturnType<typeof fehler>, bereitsEn = false) => {
      spieleApi({ [pfad]: antwort });
      if (bereitsEn) localStorage.setItem("carraway.sprache", "en");
      const app = rendereApp(`/beteiligungen/${BET_ID}`);
      const nutzer = userEvent.setup();
      await nutzer.click(await screen.findByRole("button", { name: bereitsEn ? "Record transaction" : "Vorgang erfassen" }));
      const dialog = within(await screen.findByRole("dialog"));
      await nutzer.type(dialog.getByLabelText(bereitsEn ? "Amount in euro" : "Betrag in Euro"), "1000");
      await nutzer.click(dialog.getByRole("button", { name: bereitsEn ? /Book transaction/ : "Vorgang buchen" }));
      const text = (await dialog.findByRole("alert")).textContent ?? "";
      app.unmount();
      return text;
    };
    const mit = await neuer(fehler(409, "PERIODE_GESPERRT", { gesperrtBis: "2026-06-30", valuta: "2026-05-31" }));
    expect(mit).toContain(de.fehler.PERIODE_GESPERRT);
    expect(mit).toContain("Gesperrt bis 30.06.2026.");
    const ohne = await neuer(fehler(409, "PERIODE_GESPERRT"));
    expect(ohne).toContain(de.fehler.PERIODE_GESPERRT);
    expect(ohne).not.toContain("Gesperrt bis");
    const englisch = await neuer(fehler(409, "PERIODE_GESPERRT", { gesperrtBis: "2026-06-30" }), true);
    expect(englisch).toContain(en.fehler.PERIODE_GESPERRT);
    expect(englisch).toContain("Locked until 30/06/2026.");
  });
});
