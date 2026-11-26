import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { alsRolle, BET_ID, bewertungZeile, fehler, letzteRegion, rendereApp, spieleApi } from "../test/hilfen";
import { de } from "../i18n/de";
import { en } from "../i18n/en";

const schmal = (text: string | null) => (text ?? "").replace(/\s/g, " ");
const region = () => within(screen.getAllByRole("region", { name: "Bewertungen" }).at(-1)!);
/** Wartet auf den Abschnitt und liefert die Tabellenzeile, deren Wertspalte den Text enthält. */
const zeileMit = async (text: string, name = "Bewertungen") => {
  const bereich = within(await letzteRegion(name));
  await bereich.findAllByRole("row");
  const treffer = () => bereich.queryAllByRole("row").find((r) => r.querySelectorAll("td, th")[1]?.textContent?.includes(text));
  await waitFor(() => expect(treffer()).toBeTruthy());
  return treffer()!;
};

describe("Bewertungen an der Beteiligung", () => {
  it("listet alle Status und zeigt den Verlauf der Ersetzungen", async () => {
    spieleApi();
    rendereApp(`/beteiligungen/${BET_ID}?tab=bewertung`);
    await screen.findByRole("heading", { name: "Bewertungen" });
    const zeilen = await region().findAllByRole("row");
    expect(zeilen).toHaveLength(6); // Kopf plus fünf Bewertungen
    const gueltig = await zeileMit("2.000.000");
    expect(within(gueltig).getByText("Freigegeben")).toBeTruthy();
    expect(schmal(gueltig.textContent)).toContain("Freigegeben von Berta Beispiel am");
    const korrektur = await zeileMit("2.200.000");
    expect(within(korrektur).getByText("Entwurf")).toBeTruthy();
    expect(schmal(korrektur.textContent)).toContain("Ersetzt bei der Freigabe die geltende Bewertung über 2.000.000");
    const ersetzt = await zeileMit("1.800.000");
    expect(within(ersetzt).getByText("Ersetzt")).toBeTruthy();
    expect(ersetzt.textContent).toContain("Ersetzt am");
    expect(ersetzt.textContent).toContain("Ereignis (automatisch)");
    const nachfolger = await zeileMit("1.900.000");
    expect(schmal(nachfolger.textContent)).toContain("Ersetzt die Bewertung über 1.800.000");
  });

  it("sperrt Freigeben für die Person, die den Entwurf erfasst hat, und erklärt es", async () => {
    spieleApi();
    rendereApp(`/beteiligungen/${BET_ID}?tab=bewertung`);
    const eigene = await zeileMit("2.200.000");
    const freigeben = await within(eigene).findByRole("button", { name: /Freigeben: Bewertung zum 30\.09\.2026/ });
    expect((freigeben as HTMLButtonElement).disabled).toBe(true);
    expect(within(eigene).getByText(de.rechte.vierAugenBewertung)).toBeTruthy();
    // Verwerfen bleibt möglich: es ist nicht an das Vier-Augen-Prinzip gebunden
    expect((within(eigene).getByRole("button", { name: /Verwerfen/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("gibt einen fremden Entwurf frei und lädt die Liste neu", async () => {
    const api = spieleApi({ "POST /api/v1/bewertungen/w4/freigeben": { koerper: bewertungZeile("w4", "2026-12-31", "2500000.00", "freigegeben") } });
    rendereApp(`/beteiligungen/${BET_ID}?tab=bewertung`);
    const nutzer = userEvent.setup();
    const fremde = await zeileMit("2.500.000");
    await nutzer.click(await within(fremde).findByRole("button", { name: /Freigeben: Bewertung zum 31\.12\.2026/ }));
    expect(api.anfragen("POST", "/api/v1/bewertungen/w4/freigeben")).toHaveLength(1);
    await screen.findByRole("heading", { name: "Bewertungen" });
    expect(api.anfragen("GET", `/api/v1/beteiligungen/${BET_ID}/bewertungen`).length).toBeGreaterThan(1);
  });

  it("verwirft einen Entwurf", async () => {
    const api = spieleApi({ "POST /api/v1/bewertungen/w4/verwerfen": { koerper: bewertungZeile("w4", "2026-12-31", "2500000.00", "verworfen") } });
    rendereApp(`/beteiligungen/${BET_ID}?tab=bewertung`);
    const nutzer = userEvent.setup();
    await nutzer.click(await within(await zeileMit("2.500.000")).findByRole("button", { name: /Verwerfen/ }));
    expect(api.anfragen("POST", "/api/v1/bewertungen/w4/verwerfen")).toHaveLength(1);
  });

  it("erfasst eine Bewertung und meldet die fehlende Begründung am Feld", async () => {
    const api = spieleApi({
      [`POST /api/v1/beteiligungen/${BET_ID}/bewertungen`]: (a) =>
        (a.koerper as { begruendung?: string }).begruendung
          ? { status: 201, koerper: { bewertung: bewertungZeile("n1", "2026-09-30", "3000000.00", "entwurf"), ersetzt: null } }
          : fehler(400, "EINGABE_UNGUELTIG", { felder: [{ feld: "begruendung", code: "begruendung_erforderlich", meldung: "x" }] }),
    });
    rendereApp(`/beteiligungen/${BET_ID}?tab=bewertung`);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Bewertung erfassen" }));
    const dialog = within(screen.getByRole("dialog"));
    fireEvent.change(dialog.getByLabelText("Wert in Euro"), { target: { value: "3000000" } });
    await nutzer.selectOptions(dialog.getByLabelText("Methode"), "multiplikator");
    expect(dialog.getByText("Pflicht bei dieser Methode.")).toBeTruthy();
    await nutzer.click(dialog.getByRole("button", { name: "Entwurf speichern" }));
    expect(await dialog.findByText(de.feldfehler.begruendung_erforderlich)).toBeTruthy();
    fireEvent.change(dialog.getByLabelText("Begründung"), { target: { value: "Vergleichsmultiplikator" } });
    await nutzer.click(dialog.getByRole("button", { name: "Entwurf speichern" }));
    await screen.findByRole("heading", { name: "Bewertungen" });
    const aufrufe = api.anfragen("POST", `/api/v1/beteiligungen/${BET_ID}/bewertungen`);
    expect(aufrufe).toHaveLength(2);
    expect(aufrufe[1]!.koerper).toEqual({ stichtag: "2026-09-30", wert: "3000000", methode: "multiplikator", begruendung: "Vergleichsmultiplikator" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("korrigiert eine freigegebene Bewertung als neuen Entwurf zum selben Stichtag", async () => {
    const api = spieleApi({ [`POST /api/v1/beteiligungen/${BET_ID}/bewertungen`]: { status: 201, koerper: { bewertung: bewertungZeile("n2", "2025-09-30", "2100000.00", "entwurf"), ersetzt: null } } });
    rendereApp(`/beteiligungen/${BET_ID}?tab=bewertung`);
    const nutzer = userEvent.setup();
    // Zum 30.09.2026 ist schon ein Entwurf offen: dort gibt es keine zweite Korrektur
    expect(within(await zeileMit("2.000.000")).queryByRole("button", { name: /Korrigieren/ })).toBeNull();
    await nutzer.click(await within(await zeileMit("1.900.000")).findByRole("button", { name: /Korrigieren: Bewertung zum 30\.09\.2025/ }));
    const dialog = within(screen.getByRole("dialog"));
    expect((dialog.getByLabelText("Stichtag") as HTMLInputElement).value).toBe("2025-09-30");
    expect((dialog.getByLabelText("Wert in Euro") as HTMLInputElement).value).toBe("1900000");
    fireEvent.change(dialog.getByLabelText("Wert in Euro"), { target: { value: "2100000" } });
    await nutzer.click(dialog.getByRole("button", { name: "Entwurf speichern" }));
    await screen.findByRole("heading", { name: "Bewertungen" });
    expect(api.anfragen("POST", `/api/v1/beteiligungen/${BET_ID}/bewertungen`)[0]!.koerper).toMatchObject({ stichtag: "2025-09-30", wert: "2100000", methode: "letzte_runde" });
  });

  it("sperrt Freigeben für Bearbeiter mit der Rolle als Grund und blendet das Erfassen für Betrachter aus", async () => {
    spieleApi({ "/api/v1/ich": alsRolle("bearbeiter") });
    const { unmount } = rendereApp(`/beteiligungen/${BET_ID}?tab=bewertung`);
    const fremde = await zeileMit("2.500.000");
    expect((await within(fremde).findByRole("button", { name: /Freigeben/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(fremde).getByText(de.rechte.braucht("Freigeber"))).toBeTruthy();
    expect(screen.getByRole("button", { name: "Bewertung erfassen" })).toBeTruthy();
    unmount();

    spieleApi({ "/api/v1/ich": alsRolle("betrachter") });
    rendereApp(`/beteiligungen/${BET_ID}?tab=bewertung`);
    await screen.findByRole("heading", { name: "Bewertungen" });
    expect(screen.queryByRole("button", { name: "Bewertung erfassen" })).toBeNull();
  });

  it("übersetzt die Fehler des Freigebens (Status, Vier-Augen) in beiden Sprachen", async () => {
    spieleApi({ "POST /api/v1/bewertungen/w4/freigeben": fehler(409, "BEWERTUNG_STATUS_UNGUELTIG", { status: "verworfen" }) });
    localStorage.setItem("carraway.sprache", "en");
    rendereApp(`/beteiligungen/${BET_ID}?tab=bewertung`);
    const nutzer = userEvent.setup();
    const fremde = await zeileMit("2,500,000", "Valuations");
    await nutzer.click(await within(fremde).findByRole("button", { name: /Release: valuation at 31\/12\/2026/ }));
    expect(await screen.findByText(en.fehler.BEWERTUNG_STATUS_UNGUELTIG)).toBeTruthy();
    expect(screen.getAllByText(/Replaced on/).length).toBeGreaterThan(0);
    localStorage.removeItem("carraway.sprache");
  });

  it("nimmt Bewertungen im früheren Wissensstand ohne Aktionen", async () => {
    spieleApi();
    rendereApp(`/beteiligungen/${BET_ID}?tab=bewertung&stand=2026-10-06T08:00:00Z`);
    await screen.findByRole("heading", { name: "Bewertungen" });
    expect(screen.queryByRole("button", { name: "Bewertung erfassen" })).toBeNull();
    expect(screen.getByText(de.bewertungen.stand)).toBeTruthy();
  });
});
