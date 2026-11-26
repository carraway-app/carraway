import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { BET_ID, ORG_A, rendereApp, spieleApi, type Anfrage } from "../test/hilfen";
import { POOL_SHUFFLE_START, aufstockungGueltig, poolAufstockungAus, summeBetraege } from "./PoolShuffle";

const RUNDEN = `/api/v1/organisationen/${ORG_A}/finanzierungsrunden`;
const POOLS = `/api/v1/organisationen/${ORG_A}/mitarbeiterpools`;

describe("Option Pool Shuffle: Hilfen", () => {
  it("summiert Beträge der API in Cent", () => {
    expect(summeBetraege([])).toBe("0.00");
    expect(summeBetraege(["1000000.1", "500000.25", "3"])).toBe("1500003.35");
    expect(summeBetraege(["1,5"])).toBeUndefined();
  });

  it("baut die Aufstockung nur mit einer Anzahl über null; neuer Pool nur, wenn das Unternehmen keinen hat", () => {
    const w = { ...POOL_SHUFFLE_START, aktiv: true, aufstockung: "150.000" };
    expect(poolAufstockungAus({ ...w, aktiv: false }, [])).toBeUndefined();
    expect(poolAufstockungAus({ ...w, aufstockung: "0" }, [])).toBeUndefined();
    expect(poolAufstockungAus(w, [{ id: "p1" }])).toEqual({ basis: "pre_money", anzahl: "150000" });
    expect(poolAufstockungAus(w, [])).toEqual({ basis: "pre_money", anzahl: "150000", neuerPool: { art: "esop", bezeichnung: "ESOP" } });
    expect(poolAufstockungAus({ ...w, aufstockung: "150,000" }, [{ id: "p1" }])).toEqual({ basis: "pre_money", anzahl: "150000" });
    expect(aufstockungGueltig({ ...w, aufstockung: "" })).toBe(false);
    expect(aufstockungGueltig({ ...w, aktiv: false, aufstockung: "" })).toBe(true);
    expect(poolAufstockungAus({ ...w, poolId: "p2", basis: "post_money" }, [{ id: "p1" }, { id: "p2" }])).toEqual({ basis: "post_money", anzahl: "150000", poolId: "p2" });
  });
});

describe("Option Pool Shuffle im Dialog „Neue Finanzierungsrunde“", () => {
  it("schlägt Aufstockung und Preis vor, zeigt Kennwerte, übernimmt den Vorschlag und schickt die Aufstockung mit der Runde", async () => {
    const vorschlaege: Anfrage[] = [];
    const api = spieleApi({
      [RUNDEN]: { koerper: { daten: [] } },
      [POOLS]: { koerper: { daten: [{ id: "p1", bezeichnung: "ESOP 2025", art: "esop" }] } },
      [`POST ${RUNDEN}/pool-vorschlag`]: (a) => {
        vorschlaege.push(a);
        const k = a.koerper as { aufstockung?: string; preisJeAnteil?: string };
        return {
          koerper: {
            anteileVorher: "1250000",
            anteileVorherQuelle: "runde",
            poolVorher: "100000",
            vorschlag: { aufstockung: "150000", preisJeAnteil: "9.0000" },
            grund: null,
            kennwerte: { neueAnteile: "166666", poolVorher: "100000", poolNachher: k.aufstockung === "150000" ? "250000" : "100000", poolAnteilNachher: "0.150000", vollVerwaessertNachher: "1666666", preisJeAnteil: k.preisJeAnteil ?? "9.0000", effektivePreMoney: "12150000.00" },
          },
        };
      },
      [`POST ${RUNDEN}/vorschau`]: { koerper: { postMoney: "15000000.00", anteileGesamtNach: "1416667", pruefung: { volumen: "0.00", postMoneyErwartet: "0", anteileErwartet: "0", anteileVergeben: "0", abweichungen: [], schliessbar: true }, dubletten: [] } },
      [`POST ${RUNDEN}`]: { status: 201, koerper: { id: "r9", dubletten: [] } },
    });
    rendereApp(`/beteiligungen/${BET_ID}?tab=finanzierung`);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Neue Runde" }));
    const d = within(screen.getByRole("dialog"));
    await nutzer.type(d.getByLabelText("Bezeichnung"), "Serie B");
    await nutzer.type(d.getByLabelText("Pre-Money"), "13500000");
    await nutzer.click(d.getByLabelText("Pool zur Runde aufstocken (Option Pool Shuffle)"));
    await nutzer.type(d.getByLabelText("Zielgröße des Pools in % (voll verwässert nach der Runde)"), "15");
    await nutzer.type(d.getByLabelText("Volumen (leer = Summe der Investoren)"), "1500000");
    expect(await d.findByText("Aufgestockt wird der Pool „ESOP 2025“.")).toBeTruthy();
    expect(await d.findByText(/Vorschlag: 150\.000 Anteile Aufstockung/)).toBeTruthy();
    expect(vorschlaege.at(-1)?.koerper).toMatchObject({ preMoney: "13500000", volumen: "1500000", zielAnteil: "0.15", basis: "pre_money" });
    expect(d.getByText("Aus der letzten abgeschlossenen Runde: 1.250.000.")).toBeTruthy();
    expect(d.getByText("Effektive Pre-Money")).toBeTruthy();

    await nutzer.click(d.getByRole("button", { name: "Vorschlag übernehmen" }));
    expect((d.getByLabelText("Preis je Anteil") as HTMLInputElement).value).toBe("9.0000");
    expect((d.getByLabelText("Aufstockung (Anteile)") as HTMLInputElement).value).toBe("150000");
    // Überschriebene Werte gehen an die API, die Kennwerte folgen ihnen
    await waitFor(() => expect(vorschlaege.at(-1)?.koerper).toMatchObject({ aufstockung: "150000", preisJeAnteil: "9.0000" }));

    await nutzer.click(d.getByRole("button", { name: "Als Entwurf anlegen" }));
    await waitFor(() => expect(api.anfragen("POST", RUNDEN)).toHaveLength(1));
    expect(api.anfragen("POST", RUNDEN)[0]!.koerper).toMatchObject({ preMoney: "13500000", preisJeAnteil: "9.0000", poolAufstockung: { basis: "pre_money", anzahl: "150000" } });
  });

  async function dialog(pools: unknown[], anlegen: { status: number; koerper: unknown }) {
    const api = spieleApi({
      [RUNDEN]: { koerper: { daten: [] } },
      [POOLS]: { koerper: { daten: pools } },
      [`POST ${RUNDEN}/pool-vorschlag`]: { koerper: { anteileVorher: null, anteileVorherQuelle: null, poolVorher: "0", vorschlag: null, grund: "ohne_anteile", kennwerte: null } },
      [`POST ${RUNDEN}`]: anlegen,
    });
    rendereApp(`/beteiligungen/${BET_ID}?tab=finanzierung`);
    const nutzer = userEvent.setup();
    await nutzer.click(await screen.findByRole("button", { name: "Neue Runde" }));
    const d = within(screen.getByRole("dialog"));
    await nutzer.type(d.getByLabelText("Bezeichnung"), "Serie B");
    await nutzer.type(d.getByLabelText("Pre-Money"), "13500000");
    await nutzer.type(d.getByLabelText("Preis je Anteil"), "9");
    await nutzer.click(d.getByLabelText("Pool zur Runde aufstocken (Option Pool Shuffle)"));
    return { api, nutzer, d };
  }

  it("ohne Aufstockung bei gesetztem Häkchen wird nichts angelegt, das Feld meldet es", async () => {
    const { api, nutzer, d } = await dialog([{ id: "p1", bezeichnung: "ESOP 2025", art: "esop" }], { status: 201, koerper: { id: "r9", dubletten: [] } });
    await nutzer.click(d.getByRole("button", { name: "Als Entwurf anlegen" }));
    expect(await d.findByText("Bitte die Aufstockung als ganze Zahl über null angeben oder das Häkchen entfernen.")).toBeTruthy();
    expect(api.anfragen("POST", RUNDEN)).toHaveLength(0);
  });

  it("zeigt den Feldfehler der API am Pool (mehrere Pools, keiner gewählt)", async () => {
    const zwei = [
      { id: "p1", bezeichnung: "ESOP 2025", art: "esop" },
      { id: "p2", bezeichnung: "VSOP 2025", art: "vsop" },
    ];
    const { nutzer, d } = await dialog(zwei, { status: 400, koerper: { fehler: { code: "EINGABE_UNGUELTIG", meldung: "x", felder: [{ feld: "poolAufstockung.poolId", code: "pool_waehlen", meldung: "x" }] } } });
    await nutzer.type(d.getByLabelText("Aufstockung (Anteile)"), "1000");
    await nutzer.click(d.getByRole("button", { name: "Als Entwurf anlegen" }));
    expect(await d.findByText("Das Unternehmen hat mehrere Pools; bitte einen wählen.")).toBeTruthy();
  });
});
