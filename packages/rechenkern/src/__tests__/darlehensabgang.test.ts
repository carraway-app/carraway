import { describe, expect, it } from "vitest";
import { abgrenzung, darlehensverzicht, Decimal, kapitalAnErwerber, zinslauf, type Zinsdarlehen } from "../index.js";

const d = (x: string) => new Decimal(x);
const basis = { kapital: d("1000.01"), buchwert: d("750.00"), wertberichtigung: d("250.01"), gebuchteZinsen: d("10"), aufgelaufeneZinsen: [{ bis: "2026-07-01", betrag: "20.25" }] };

describe("Kapitalabgang und Forderungsverzicht", () => {
  it("rundet den Nominalabgang unabhängig vom Buchwert und nennt die Quelle", () => {
    const abgang = kapitalAnErwerber(basis.kapital, "0.5", "instrument");
    expect(abgang.wert.toFixed(2)).toBe("500.01");
    expect(abgang.schritte[0]?.quellen).toEqual(["instrument"]);
  });
  it("verbraucht die Wertberichtigung anteilig, bei Vollverzicht bis auf den letzten Cent", () => {
    const teil = darlehensverzicht(basis, d("500"), d("12.25"));
    expect(teil.verbrauch.toFixed(2)).toBe("125.00");
    expect(teil.verlust.toFixed(2)).toBe("387.25");
    expect(teil.gebucht.toFixed(2)).toBe("10.00");
    expect(teil.aufgelaufen[0]?.betrag.toFixed(2)).toBe("2.25");
    expect(darlehensverzicht(basis, basis.kapital, d("0")).verbrauch.eq(basis.wertberichtigung)).toBe(true);
    expect(() => darlehensverzicht(basis, d("0"), d("30.26"))).toThrow();
  });
  it("mindert laufende Zinsen und deren spätere Kapitalisierung genau einmal", () => {
    const loan: Zinsdarlehen = {
      id: "loan", bewegungen: [{ datum: "2025-01-01", art: "auszahlung", betrag: "1000" }], bedingungen: { satzFix: "0.1", methode: "30E/360" },
      anker: "2026-01-01", zinsperiode: "jaehrlich", kapitalisieren: true, zinsverzichte: [{ bis: "2025-07-01", betrag: "40" }],
    };
    expect(abgrenzung(loan, "2025-07-01").betragGebucht.toFixed(2)).toBe("10.00");
    const lauf = zinslauf([loan], "2027-01-01");
    expect(lauf.map((p) => p.betragGebucht.toFixed(2))).toEqual(["60.00", "106.00"]);
  });
});
