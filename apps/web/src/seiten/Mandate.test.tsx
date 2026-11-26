import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { BET_ID, FONDS_ID, ORG_A, rendereApp, spieleApi } from "../test/hilfen";

/** Gremienmandate (Issue #156): Abschnitt an der Beteiligung und Liste im Fonds. */

const mandat = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  beteiligungId: BET_ID,
  gremium: "beirat",
  gremiumName: null,
  rolle: "vorsitz",
  beginn: "2024-03-01",
  ende: null,
  bemerkung: null,
  person: { id: "p1", vorname: "Erika", nachname: "Muster" },
  organisation: { id: ORG_A, name: "Alpha Energie" },
  ...extra,
});

describe("Gremienmandate", () => {
  it("zeigt die Mandate der Beteiligung mit Status und beendet ein Mandat über den Dialog", async () => {
    const api = spieleApi({
      [`/api/v1/beteiligungen/${BET_ID}/mandate`]: { koerper: { daten: [mandat("m1", { gremiumName: "Investorenbeirat" }), mandat("m2", { gremium: "aufsichtsrat", rolle: "mitglied", beginn: "2020-01-01", ende: "2022-12-31" })] } },
      [`PATCH /api/v1/beteiligungen/${BET_ID}/mandate/m1`]: { koerper: mandat("m1", { ende: "2026-06-30" }) },
    });
    rendereApp(`/beteiligungen/${BET_ID}?tab=gremien`);
    const region = within(await screen.findByRole("region", { name: "Gremien" }));
    const zeilen = await region.findAllByRole("row");
    const laufend = zeilen.find((z) => z.textContent?.includes("Investorenbeirat"))!;
    expect(within(laufend).getByText("Laufend")).toBeTruthy();
    expect(within(laufend).getByText("Vorsitz")).toBeTruthy();
    const beendet = zeilen.find((z) => z.textContent?.includes("Aufsichtsrat"))!;
    expect(within(beendet).getByText("Beendet")).toBeTruthy();

    const nutzer = userEvent.setup();
    await nutzer.click(within(laufend).getByRole("button", { name: "Mandat von Erika Muster bearbeiten" }));
    const dialog = within(await screen.findByRole("dialog"));
    await nutzer.type(dialog.getByLabelText("Ende", { exact: false }), "2026-06-30");
    await nutzer.click(dialog.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(api.anfragen("PATCH", `/api/v1/beteiligungen/${BET_ID}/mandate/m1`)).toHaveLength(1));
    expect(api.anfragen("PATCH", `/api/v1/beteiligungen/${BET_ID}/mandate/m1`)[0]!.koerper).toMatchObject({ personId: "p1", gremiumName: "Investorenbeirat", ende: "2026-06-30" });
  });

  it("listet im Fonds die Mandate aller Beteiligungen, auf Wunsch auch beendete", async () => {
    const api = spieleApi({
      [`/api/v1/fonds/${FONDS_ID}/mandate`]: { koerper: { daten: [mandat("m1")] } },
    });
    rendereApp(`/fonds?fondsId=${FONDS_ID}&tab=gremien`);
    const region = within(await screen.findByRole("region", { name: "Gremienmandate im Portfolio" }));
    expect((await region.findByRole("link", { name: "Alpha Energie" })).getAttribute("href")).toBe(`/beteiligungen/${BET_ID}?tab=gremien`);
    // Vorgabe: nur die heute laufenden (mit Stichtag); ohne Haken alle.
    expect(api.anfragen("GET", `/api/v1/fonds/${FONDS_ID}/mandate`).some((a) => a.query.has("stichtag"))).toBe(true);
    await userEvent.setup().click(region.getByLabelText("Nur heute laufende"));
    await waitFor(() => expect(api.anfragen("GET", `/api/v1/fonds/${FONDS_ID}/mandate`).some((a) => !a.query.has("stichtag"))).toBe(true));
  });
});
