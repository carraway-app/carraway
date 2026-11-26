import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { FONDS_ID, alsRolle, fondsDaten, ichAlsApi, ichDaten, rendereApp, spieleApi } from "../test/hilfen";

const kontakte = alsRolle("bearbeiter", { bereiche: ["kontakte"], bereicheJeFonds: { [FONDS_ID]: { kontakte: "bearbeiter" } } });

describe("Navigation nach den Rechten der Sitzung", () => {
  it.each(["/portal", "/portal/dokumente", "/", `/fonds/${FONDS_ID}`])("zeigt Investoren unter %s den Portalhinweis ohne interne Abfragen", async (pfad) => {
    const api = spieleApi({ "/api/v1/me": { koerper: ichAlsApi({ ...ichDaten, globalVerwalter: false, investor: true }) } });
    rendereApp(pfad);
    await screen.findByRole("heading", { level: 1, name: /Investorenportal/ });
    expect(screen.getByRole("button", { name: "Abmelden" })).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Hauptnavigation" })).toBeNull();
    expect(api.aufrufe.filter((a) => !["/api/v1/me", "/api/v1/environment"].includes(a.pfad))).toEqual([]);
  });

  it("lässt die Kontaktrolle auch über einen gespeicherten Deal-Link nur Kontakte öffnen", async () => {
    const api = spieleApi({ "/api/v1/me": kontakte });
    const { router } = rendereApp("/kontakte?objekt=deal&neu=1");
    await screen.findByRole("button", { name: "Neues Unternehmen" });
    expect(router.state.location.search).toEqual({});
    expect(screen.queryByRole("tab", { name: "Deals" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: "Neuer Deal" })).toBeNull();
    expect(api.aufrufe.filter((a) => a.pfad.includes("/deal"))).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: /^Suchen/ }));
    const suche = within(await screen.findByRole("dialog", { name: "Suche" }));
    expect(suche.queryByRole("button", { name: /Deal/ })).toBeNull();
  });

  it("zeigt mit Leserecht im Dealflow die Deals, auch bei Schreibrecht in Kontakte ohne Anlage", async () => {
    spieleApi({ "/api/v1/me": alsRolle("bearbeiter", { bereiche: ["kontakte", "dealflow"], bereicheJeFonds: { [FONDS_ID]: { kontakte: "bearbeiter", dealflow: "betrachter" } } }) });
    rendereApp("/kontakte?objekt=deal&neu=1");
    expect((await screen.findByRole("tab", { name: "Deals" })).getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByRole("button", { name: "Neuer Deal" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("lädt für Controlling weder Zähler noch Liste der Wiedervorlagen, auch beim Direktaufruf", async () => {
    const api = spieleApi({ "/api/v1/me": alsRolle("bearbeiter", { bereiche: ["portfolio", "finanzen", "berichte", "meldewesen", "kennzahlen"] }) });
    rendereApp("/wiedervorlagen");
    await screen.findByRole("heading", { level: 1, name: "Fonds" });
    expect(screen.queryByRole("link", { name: /Wiedervorlagen/ })).toBeNull();
    expect(api.anfragen("GET", "/api/v1/wiedervorlagen/anzahl")).toHaveLength(0);
    expect(api.anfragen("GET", "/api/v1/wiedervorlagen")).toHaveLength(0);
  });

  it.each([false, true])("öffnet über die Fondsauswahl die erlaubten Stammdaten (Portfolio am ersten Fonds: %s)", async (mitPortfolio) => {
    const fonds = { ...fondsDaten.daten[0]!, id: "22222222-2222-4222-8222-222222222222", name: "Beispielfonds II" };
    const api = spieleApi({
      "/api/v1/me": alsRolle("bearbeiter", {
        bereiche: mitPortfolio ? ["kontakte", "portfolio"] : ["kontakte"],
        rollen: [FONDS_ID, fonds.id].map((fondsId) => ({ fondsId, rolle: "bearbeiter" })),
        bereicheJeFonds: { [FONDS_ID]: { kontakte: "bearbeiter", ...(mitPortfolio ? { portfolio: "betrachter" } : {}) }, [fonds.id]: { kontakte: "bearbeiter" } },
      }),
      "/api/v1/fonds": { koerper: { daten: [...fondsDaten.daten, fonds] } },
      [`/api/v1/fonds/${fonds.id}`]: { koerper: fonds },
    });
    const { router } = rendereApp("/kontakte");
    await screen.findByRole("option", { name: fonds.name });
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Fonds" }), fonds.id);
    await screen.findByRole("heading", { level: 1, name: fonds.name });
    expect(router.state.location.pathname).toBe("/fonds");
    expect(router.state.location.search).toEqual({ fondsId: fonds.id });
    expect(api.anfragen("GET", `/api/v1/fonds/${fonds.id}/uebersicht`)).toHaveLength(0);
  });
});
