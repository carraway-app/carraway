import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ladeSeitentexte, SpracheProvider } from "../i18n";
import { alsRolle, FONDS_ID, fondsDaten, ichDaten, spieleApi } from "../test/hilfen";
import FondsStammdaten from "./FondsStammdaten";

const detailPfad = `/api/v1/fonds/${FONDS_ID}`;
const bestand = fondsDaten.daten[0]!;

async function rendereStammdaten(fondsId?: string) {
  await ladeSeitentexte("/funds", "de");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onFondsWahl = vi.fn();
  render(
    <SpracheProvider>
      <QueryClientProvider client={qc}>
        <FondsStammdaten fondsId={fondsId} onFondsWahl={onFondsWahl} />
      </QueryClientProvider>
    </SpracheProvider>,
  );
  return onFondsWahl;
}

describe("Fondsstammdaten", () => {
  it("zeigt die Daten des Fonds für eine lesende Rolle", async () => {
    spieleApi({ "/api/v1/me": alsRolle("betrachter") });
    await rendereStammdaten(FONDS_ID);
    expect(await screen.findByText(bestand.name)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Fonds bearbeiten" })).toBeNull();
  });

  it("legt ohne vorhandenen Fonds einen Fonds an und meldet dessen Kennung zurück", async () => {
    const neu = { ...bestand, name: "Neuer Fonds", kurzname: "NF", vintage: 2026, zeichnungskapital: "1200000.50", waehrung: "USD" };
    const api = spieleApi({
      "/api/v1/me": { koerper: { ...ichDaten, globalVerwalter: true, rollen: [] } },
      "/api/v1/fonds": { koerper: { daten: [] } },
      "POST /api/v1/fonds": { status: 201, koerper: neu },
    });
    const auswahl = await rendereStammdaten();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Fonds anlegen" }));
    const dialog = within(screen.getByRole("dialog", { name: "Fonds anlegen" }));
    await user.type(dialog.getByLabelText("Fondsname"), neu.name);
    await user.type(dialog.getByLabelText("Kurzname"), neu.kurzname);
    await user.type(dialog.getByLabelText("Auflagejahr (Vintage)"), String(neu.vintage));
    await user.type(dialog.getByLabelText("Zeichnungskapital"), "1 200 000,50");
    await user.selectOptions(dialog.getByLabelText("Fondswährung"), neu.waehrung);
    await user.click(dialog.getByRole("button", { name: "Fonds anlegen" }));
    await waitFor(() => expect(auswahl).toHaveBeenCalledWith(neu.id));
    expect(api.anfragen("POST", "/api/v1/fonds")[0]?.koerper).toEqual({
      name: neu.name, kurzname: neu.kurzname, vintage: neu.vintage, zeichnungskapital: neu.zeichnungskapital, waehrung: neu.waehrung,
    });
  });

  it("speichert nur bearbeitete Felder und lädt danach die Stammdaten neu", async () => {
    let aktuell = bestand;
    const api = spieleApi({
      "/api/v1/me": alsRolle("verwalter"),
      [detailPfad]: () => ({ koerper: aktuell }),
      [`PATCH ${detailPfad}`]: () => {
        aktuell = { ...bestand, name: "Geänderter Fonds" };
        return { koerper: aktuell };
      },
    });
    await rendereStammdaten(FONDS_ID);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Fonds bearbeiten" }));
    const dialog = within(screen.getByRole("dialog", { name: "Fonds bearbeiten" }));
    expect(dialog.getByLabelText<HTMLSelectElement>("Fondswährung").disabled).toBe(true);
    await user.clear(dialog.getByLabelText("Fondsname"));
    await user.type(dialog.getByLabelText("Fondsname"), "Geänderter Fonds");
    await user.click(dialog.getByRole("button", { name: "Speichern" }));
    expect(await screen.findByText("Geänderter Fonds")).toBeTruthy();
    expect(api.anfragen("PATCH", detailPfad)[0]?.koerper).toEqual({ name: "Geänderter Fonds" });
  });
});

describe("Fondsstammdaten: Prüfung am Feld", () => {
  it("bietet die Währung als Auswahl und prüft das Zeichnungskapital beim Verlassen", async () => {
    spieleApi({
      "/api/v1/me": { koerper: { ...ichDaten, globalVerwalter: true, rollen: [] } },
      "/api/v1/fonds": { koerper: { daten: [] } },
    });
    await rendereStammdaten();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Fonds anlegen" }));
    const dialog = within(screen.getByRole("dialog", { name: "Fonds anlegen" }));
    const waehrung = dialog.getByLabelText<HTMLSelectElement>("Fondswährung");
    expect(waehrung.tagName).toBe("SELECT");
    expect(waehrung.value).toBe("EUR");
    expect(Array.from(waehrung.options).some((o) => o.value === "USD" && /US/.test(o.textContent ?? ""))).toBe(true);
    await user.type(dialog.getByLabelText("Zeichnungskapital"), "0");
    await user.tab();
    expect(dialog.getByText("Der Wert muss größer als 0 sein.")).toBeTruthy();
    await user.click(dialog.getByRole("button", { name: "Fonds anlegen" }));
    expect(dialog.getAllByText("Bitte eine Angabe machen.").length).toBeGreaterThan(0);
  });
});
