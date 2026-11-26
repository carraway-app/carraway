import { describe, expect, it } from "vitest";
import { filterVon, gruppiere, summen, summiere, zaehle, type TxZeile } from "./transaktionen";

const z = (art: string, valuta: string, betrag: string, extra: Partial<TxZeile> = {}): TxZeile => ({ art, valuta, betrag, ohneGeldfluss: false, instrumentId: "i1", instrumentBezeichnung: "Darlehen", runde: null, ...extra });

describe("Transaktionen: Filter, Gruppen, Summen", () => {
  it("ordnet eine Zinszahlung Rückflüssen und Zinsen zu, Wandlungsbuchungen nur Wandlung", () => {
    expect(filterVon(z("zinszahlung", "2024-01-01", "1"))).toEqual(["rueckfluesse", "zinsen"]);
    expect(filterVon(z("zins", "2024-01-01", "1"))).toEqual(["zinsen"]);
    expect(filterVon(z("auszahlung", "2024-01-01", "1", { ohneGeldfluss: true }))).toEqual(["wandlung"]);
    expect(filterVon(z("wertberichtigung", "2024-01-01", "1"))).toEqual(["sonstige"]);
    expect(zaehle([z("auszahlung", "2024-01-01", "5"), z("tilgung", "2024-02-01", "1", { ohneGeldfluss: true })])).toMatchObject({ alle: 2, auszahlungen: 1, rueckfluesse: 0, wandlung: 1 });
  });

  it("summiert ohne Gleitkomma und mit Storno", () => {
    expect(summiere(["600000.00", "-600000.00", "0.10", "0.20"])).toBe("0.3000");
    expect(summiere(["-1.50"])).toBe("-1.5000");
    expect(summen([z("auszahlung", "2024-01-01", "10"), z("tilgung", "2024-01-02", "4")], "alle")).toEqual({ auszahlungen: "10.0000", rueckfluesse: "4.0000" });
    expect(summen([z("zins", "2024-01-01", "10")], "zinsen")).toEqual({});
  });

  it("gruppiert Runden nach Datum mit Zeilen ohne Runde zuletzt, Jahre aufsteigend", () => {
    const a = { id: "ra", bezeichnung: "Serie A", datum: "2023-01-01" };
    const s = { id: "rs", bezeichnung: "Seed", datum: "2021-01-01" };
    const zeilen = [z("zusage", "2021-01-01", "1"), z("auszahlung", "2022-01-01", "2", { runde: a }), z("auszahlung", "2023-05-01", "3", { runde: s }), z("zins", "2023-06-01", "4", { runde: a })];
    expect(gruppiere(zeilen, "runde", (x) => x).map((g) => [g.name, g.zeilen.length])).toEqual([["Seed", 1], ["Serie A", 2], [null, 1]]);
    expect(gruppiere(zeilen, "jahr", (x) => x).map((g) => [g.name, g.zeilen.length])).toEqual([["2021", 1], ["2022", 1], ["2023", 2]]);
    expect(gruppiere(zeilen, "art", (x) => x.toUpperCase()).map((g) => g.name)).toEqual(["ZUSAGE", "AUSZAHLUNG", "ZINS"]);
  });
});

import { formatBetragMitCent } from "./transaktionen";
describe("formatBetragMitCent", () => {
  it("zeigt Cent nur, wenn der Betrag welche hat", () => {
    expect(formatBetragMitCent("4.55", "de").replace(/\s/g, " ")).toBe("4,55 €");
    expect(formatBetragMitCent("600000.00", "de").replace(/\s/g, " ")).toBe("600.000 €");
    expect(formatBetragMitCent("-4.55", "en")).toBe("-€4.55");
  });
});
