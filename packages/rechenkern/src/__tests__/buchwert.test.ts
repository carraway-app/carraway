import { describe, expect, it } from "vitest";
import { buchwert, verkaufsergebnis } from "../index.js";

// Erwartungswerte aus referenz/referenz_buchwert.py (exakte Brüche), Beträge erfunden.

describe("buchwert", () => {
  it("Darlehen: 500.000 + 12.345,67 − 100.000 − 50.000,50 = 362.345,17", () => {
    const b = buchwert({ investiert: 500_000, kapitalisiert: "12345.67", tilgungen: 100_000, wertberichtigungen: "50000.50" });
    expect(b.wert.toFixed(2)).toBe("362345.17");
    expect(b.schritte.at(-1)).toMatchObject({ zeichen: "=", wert: "362345.17" });
  });

  it("Auflösung (negative Wertberichtigung) erhöht den Buchwert wieder", () => {
    expect(buchwert({ investiert: 1000, wertberichtigungen: -250 }).wert.toString()).toBe("1250");
  });
});

describe("verkaufsergebnis", () => {
  it("Teilverkauf 0,333333 von 437.345,17: Abgang 145.781,58, Ergebnis 49.218,42", () => {
    const e = verkaufsergebnis({ buchwert: "437345.17", anteilVerkauft: "0.333333", kaufpreis: 200_000, kosten: 5000 }).wert;
    expect(e.buchwertAbgang.toFixed(2)).toBe("145781.58");
    expect(e.erloes.toFixed(2)).toBe("195000.00");
    expect(e.ergebnis.toFixed(2)).toBe("49218.42");
  });

  it("Vollverkauf mit Verlust: 600.000 − 10.000 − 750.000 = −160.000", () => {
    const e = verkaufsergebnis({ buchwert: 750_000, anteilVerkauft: 1, kaufpreis: 600_000, kosten: 10_000 }).wert;
    expect(e.buchwertAbgang.toString()).toBe("750000");
    expect(e.ergebnis.toFixed(2)).toBe("-160000.00");
  });

  it("Anteil 0,5 bei Buchwert 250.000: Abgang 125.000, Ergebnis 175.000", () => {
    const e = verkaufsergebnis({ buchwert: 250_000, anteilVerkauft: "0.5", kaufpreis: 300_000 }).wert;
    expect(e.buchwertAbgang.toFixed(2)).toBe("125000.00");
    expect(e.ergebnis.toFixed(2)).toBe("175000.00");
  });

  it("lehnt ungültigen Anteil, Kaufpreis und Kosten ab", () => {
    expect(() => verkaufsergebnis({ buchwert: 1, anteilVerkauft: 0, kaufpreis: 1 })).toThrow();
    expect(() => verkaufsergebnis({ buchwert: 1, anteilVerkauft: "1.1", kaufpreis: 1 })).toThrow();
    expect(() => verkaufsergebnis({ buchwert: 1, anteilVerkauft: 1, kaufpreis: -1 })).toThrow();
    expect(() => verkaufsergebnis({ buchwert: 1, anteilVerkauft: 1, kaufpreis: 1, kosten: -1 })).toThrow();
  });
});
