import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { abgrenzungDaten, fehler, FONDS_ID, kontrolleDaten, rendereApp, spieleApi, uebersichtDaten, umgebungDaten, ZL_ID } from "../test/hilfen";
import { de } from "../i18n/de";

const schmal = (text: string | null) => (text ?? "").replace(/\s/g, " ");
const nichtAngemeldet = fehler(401, "not_authenticated");

describe("Link zur Einrichtung", () => {
  it("steht nur auf der Anmeldeseite, wenn die API die Einrichtung als offen meldet", async () => {
    spieleApi({ "/api/v1/me": nichtAngemeldet, "/api/v1/environment": { koerper: { ...umgebungDaten, einrichtungOffen: true } } });
    const { unmount } = rendereApp("/anmelden");
    expect(await screen.findByRole("link", { name: de.anmeldung.einrichten })).toBeTruthy();
    unmount();

    spieleApi({ "/api/v1/me": nichtAngemeldet, "/api/v1/environment": { koerper: { ...umgebungDaten, einrichtungOffen: false } } });
    rendereApp("/anmelden");
    await screen.findByRole("heading", { name: "Anmelden" });
    expect(screen.queryByRole("link", { name: de.anmeldung.einrichten })).toBeNull();
    expect(screen.queryByText(de.anmeldung.neueInstallation)).toBeNull();
  });
});

describe("Offene Kaufpreisforderungen im Portfolio", () => {
  it("zeigt sie unter der Bewertung und behandelt ein fehlendes Feld in alten Ständen als 0,00", async () => {
    const mit = uebersichtDaten.beteiligungen.map((b, i) => (i === 0 ? { ...b, offeneForderungen: "50000.00" } : b));
    spieleApi({ [`/api/v1/fonds/${FONDS_ID}/uebersicht`]: { koerper: { ...uebersichtDaten, beteiligungen: mit } } });
    rendereApp(`/fonds/${FONDS_ID}`);
    const tabelle = within(await screen.findByRole("table"));
    const zeilen = tabelle.getAllByRole("row");
    expect(schmal(zeilen[1]!.textContent)).toContain("zuzüglich 50.000 € offene Kaufpreisforderungen");
    // Altbestand ohne das Feld (zweite und dritte Zeile): kein Zusatz, kein Fehler
    expect(zeilen[2]!.textContent).not.toContain("Kaufpreisforderungen");
    expect(schmal(zeilen[2]!.textContent)).toContain("4.500.000 €");
  });

  it("übersetzt den Zusatz ins Englische", async () => {
    const mit = uebersichtDaten.beteiligungen.map((b, i) => (i === 0 ? { ...b, offeneForderungen: "50000.00" } : b));
    spieleApi({ [`/api/v1/fonds/${FONDS_ID}/uebersicht`]: { koerper: { ...uebersichtDaten, beteiligungen: mit } } });
    localStorage.setItem("carraway.sprache", "en");
    rendereApp(`/fonds/${FONDS_ID}`);
    const tabelle = within(await screen.findByRole("table"));
    expect(schmal(tabelle.getAllByRole("row")[1]!.textContent)).toContain("plus €50,000 open purchase price receivables");
    localStorage.removeItem("carraway.sprache");
  });
});

describe("Kontrollbericht und Abgrenzung nach Code", () => {
  it("übersetzt den Kontrollbericht des Zinslaufs nach Code, Parametern und Hinweiscode ins Englische", async () => {
    spieleApi();
    localStorage.setItem("carraway.sprache", "en");
    rendereApp(`/zinslaeufe/${ZL_ID}`);
    await userEvent.setup().click(await screen.findByRole("tab", { name: /Control report/ }));
    const bericht = within(await screen.findByRole("region", { name: "Control report" }));
    expect(await bericht.findByText("One active loan has no terms.")).toBeTruthy();
    expect(bericht.getByText("The sum of the positions matches the sum of the bookings.")).toBeTruthy();
    expect(schmal(bericht.getByText(/No bookings yet/).textContent)).toContain("No bookings yet (status Reviewed), so only the sum of the positions: €16,200.62.");
    localStorage.removeItem("carraway.sprache");
  });

  it("fällt bei Prüfungen ohne bekannten Code auf die Übersetzung nach Schlüssel zurück", async () => {
    const alt = { ...kontrolleDaten, pruefungen: kontrolleDaten.pruefungen.map(({ code: _code, ...rest }) => rest) };
    spieleApi({ [`/api/v1/zinslaeufe/${ZL_ID}/kontrolle`]: { koerper: alt } });
    rendereApp(`/zinslaeufe/${ZL_ID}`);
    await userEvent.setup().click(await screen.findByRole("tab", { name: /Kontrollbericht/ }));
    const bericht = within(await screen.findByRole("region", { name: "Kontrollbericht" }));
    expect(await bericht.findByText("Jedes aktive Darlehen hat Konditionen")).toBeTruthy();
  });

  it("übersetzt den Grund einer nicht berechenbaren Abgrenzung nach fehlerCode und zeigt den Freitext nur als Zusatz", async () => {
    spieleApi({ [`/api/v1/fonds/${FONDS_ID}/abgrenzung`]: { koerper: abgrenzungDaten } });
    rendereApp(`/fonds?fondsId=${FONDS_ID}&tab=abgrenzung`);
    const kachel = within(await screen.findByRole("region", { name: "Abgrenzung der Zinsen" }));
    const zeile = (await kachel.findAllByRole("row"))[2]!;
    expect(zeile.textContent).toContain("Nicht berechenbar");
    expect(zeile.textContent).toContain(de.fehler.calculation_failed);
    expect(zeile.textContent).toContain("Grund der Berechnung: Jahresüberschuss 2025 fehlt");
  });

  it("verweist von der Zinsabgrenzung auf Fonds → Zinsen für die Portfolioansicht", async () => {
    spieleApi({ [`/api/v1/fonds/${FONDS_ID}/abgrenzung`]: { koerper: abgrenzungDaten } });
    rendereApp(`/fonds?fondsId=${FONDS_ID}&tab=abgrenzung`);
    const kachel = within(await screen.findByRole("region", { name: "Abgrenzung der Zinsen" }));
    expect(kachel.getByRole("link", { name: "Zinsen" }).getAttribute("href")).toBe(`/fonds/${FONDS_ID}/zinsen`);
  });

  it("zeigt bei einem Altstand ohne fehlerCode den Rückfalltext", async () => {
    const alt = { ...abgrenzungDaten, darlehen: abgrenzungDaten.darlehen.map(({ ...d }) => ("fehlerCode" in d ? { ...d, fehlerCode: undefined, fehlerParams: undefined } : d)) };
    spieleApi({ [`/api/v1/fonds/${FONDS_ID}/abgrenzung`]: { koerper: alt } });
    rendereApp(`/fonds?fondsId=${FONDS_ID}&tab=abgrenzung`);
    const kachel = within(await screen.findByRole("region", { name: "Abgrenzung der Zinsen" }));
    const zeile = (await kachel.findAllByRole("row"))[2]!;
    expect(zeile.textContent).toContain(de.fehler.calculation_failed);
  });
});
