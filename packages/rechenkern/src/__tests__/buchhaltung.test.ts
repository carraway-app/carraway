import { describe, expect, it } from "vitest";
import { bereicheUeberschneiden, kontoInBereich, regelGilt, rechneSicht, zeitraeumeUeberschneiden, type Position, type Regel } from "../buchhaltung";

const pos = (schluessel: string, eltern: string | null, seite: "soll" | "haben", reihenfolge: number): Position => ({ schluessel, elternSchluessel: eltern, bezeichnungDe: schluessel, bezeichnungEn: `${schluessel} en`, reihenfolge, seite });
const regel = (id: string, von: string, bis: string, position: string, ab = "2026-01-01", bisDatum: string | null = null): Regel => ({ id, kontoVon: von, kontoBis: bis, positionSchluessel: position, gueltigAb: ab, gueltigBis: bisDatum });

describe("Kontenregeln", () => {
  it("Gültigkeit, Bereiche und Überschneidungen", () => {
    expect(regelGilt({ gueltigAb: "2026-01-01", gueltigBis: "2026-06-30" }, "2026-06-30")).toBe(true);
    expect(regelGilt({ gueltigAb: "2026-01-01", gueltigBis: "2026-06-30" }, "2026-07-01")).toBe(false);
    expect(regelGilt({ gueltigAb: "2026-01-01", gueltigBis: null }, "2025-12-31")).toBe(false);
    expect(kontoInBereich("1250", "1200", "1299")).toBe(true);
    expect(kontoInBereich("12500", "1200", "1299")).toBe(false);
    expect(bereicheUeberschneiden({ kontoVon: "1200", kontoBis: "1299" }, { kontoVon: "1299", kontoBis: "1300" })).toBe(true);
    expect(bereicheUeberschneiden({ kontoVon: "1200", kontoBis: "1298" }, { kontoVon: "1299", kontoBis: "1300" })).toBe(false);
    expect(zeitraeumeUeberschneiden({ gueltigAb: "2026-01-01", gueltigBis: "2026-06-30" }, { gueltigAb: "2026-07-01", gueltigBis: null })).toBe(false);
    expect(zeitraeumeUeberschneiden({ gueltigAb: "2026-01-01", gueltigBis: null }, { gueltigAb: "2026-07-01", gueltigBis: null })).toBe(true);
  });
});

describe("rechneSicht", () => {
  const positionen = [
    pos("aktiva", null, "soll", 1),
    pos("aktiva.anlagen", "aktiva", "soll", 1),
    pos("aktiva.bank", "aktiva", "soll", 2),
    pos("passiva", null, "haben", 2),
    pos("passiva.kapital", "passiva", "haben", 1),
    pos("passiva.ergebnis", "passiva", "haben", 2),
  ];
  const salden = [
    { konto: "0100", bezeichnung: "Beteiligungen", saldo: "800.00" },
    { konto: "0190", bezeichnung: "Wertberichtigung", saldo: "-50.00" },
    { konto: "1200", bezeichnung: "Bank", saldo: "300.00" },
    { konto: "2000", bezeichnung: "Kapital", saldo: "-1000.00" },
    { konto: "4000", bezeichnung: "Ertrag", saldo: "-120.00" },
    { konto: "6000", bezeichnung: "Aufwand", saldo: "70.00" },
    { konto: "9999", bezeichnung: "Offen", saldo: "0.00" },
  ];
  const regeln = [regel("r1", "0100", "0199", "aktiva.anlagen"), regel("r2", "1200", "1200", "aktiva.bank"), regel("r3", "2000", "2999", "passiva.kapital"), regel("r4", "4000", "6999", "passiva.ergebnis")];

  it("Blätter aus Salden und Regeln, Oberpositionen als Summe, Wertberichtigung mindert, Vorzeichen nach Seite", () => {
    const a = rechneSicht({ positionen, regeln, salden, stichtag: "2026-09-30" });
    const wert = (k: string) => a.zeilen.find((z) => z.schluessel === k)!.wert;
    expect(wert("aktiva.anlagen")).toBe("750.00");
    expect(wert("aktiva.bank")).toBe("300.00");
    expect(wert("aktiva")).toBe("1050.00");
    expect(wert("passiva.kapital")).toBe("1000.00");
    expect(wert("passiva.ergebnis")).toBe("50.00"); // Ertrag 120 − Aufwand 70
    expect(wert("passiva")).toBe("1050.00");
    expect(a.zeilen.map((z) => [z.schluessel, z.ebene])).toEqual([["aktiva", 0], ["aktiva.anlagen", 1], ["aktiva.bank", 1], ["passiva", 0], ["passiva.kapital", 1], ["passiva.ergebnis", 1]]);
    expect(a.nichtZugeordnet).toEqual([{ konto: "9999", bezeichnung: "Offen", saldo: "0.00" }]);
    expect(a.mehrdeutig).toEqual([]);
  });

  it("Herkunft: Konten mit Saldo, Beitrag und Regel; die Schritte ergeben den Wert", () => {
    const a = rechneSicht({ positionen, regeln, salden, stichtag: "2026-09-30" });
    const anlagen = a.zeilen.find((z) => z.schluessel === "aktiva.anlagen")!;
    expect(anlagen.konten).toEqual([
      { konto: "0100", bezeichnung: "Beteiligungen", saldo: "800.00", regelId: "r1", beitrag: "800.00" },
      { konto: "0190", bezeichnung: "Wertberichtigung", saldo: "-50.00", regelId: "r1", beitrag: "-50.00" },
    ]);
    expect(anlagen.schritte.map((s) => `${s.zeichen}${s.wert}`)).toEqual(["+800.00", "−50.00", "=750.00"]);
    expect(anlagen.schritte[0]!.quellen).toEqual(["r1"]);
    const ergebnis = a.zeilen.find((z) => z.schluessel === "passiva.ergebnis")!;
    expect(ergebnis.konten.map((k) => k.beitrag)).toEqual(["120.00", "-70.00"]);
    const oberposition = a.zeilen.find((z) => z.schluessel === "aktiva")!;
    expect(oberposition.blatt).toBe(false);
    expect(oberposition.schritte.map((s) => `${s.zeichen}${s.wert}`)).toEqual(["+750.00", "+300.00", "=1050.00"]);
  });

  it("Versionierung: je Stichtag gilt die zu diesem Zeitpunkt gültige Regel", () => {
    const versioniert = [regel("alt", "1200", "1200", "aktiva.bank", "2026-01-01", "2026-06-30"), regel("neu", "1200", "1200", "aktiva.anlagen", "2026-07-01")];
    const q2 = rechneSicht({ positionen, regeln: versioniert, salden: [{ konto: "1200", saldo: "10.00" }], stichtag: "2026-06-30" });
    const q3 = rechneSicht({ positionen, regeln: versioniert, salden: [{ konto: "1200", saldo: "10.00" }], stichtag: "2026-09-30" });
    expect(q2.zeilen.find((z) => z.schluessel === "aktiva.bank")!.wert).toBe("10.00");
    expect(q2.zeilen.find((z) => z.schluessel === "aktiva.anlagen")!.wert).toBe("0.00");
    expect(q3.zeilen.find((z) => z.schluessel === "aktiva.anlagen")!.wert).toBe("10.00");
    const vor = rechneSicht({ positionen, regeln: versioniert, salden: [{ konto: "1200", saldo: "10.00" }], stichtag: "2025-12-31" });
    expect(vor.nichtZugeordnet).toHaveLength(1);
  });

  it("mehrere gültige Regeln: die engste gilt und der Fall wird gemeldet", () => {
    const a = rechneSicht({ positionen, regeln: [regel("breit", "1000", "1999", "aktiva.anlagen"), regel("eng", "1200", "1200", "aktiva.bank")], salden: [{ konto: "1200", saldo: "5.00" }], stichtag: "2026-09-30" });
    expect(a.zeilen.find((z) => z.schluessel === "aktiva.bank")!.wert).toBe("5.00");
    expect(a.mehrdeutig).toEqual([{ konto: "1200", regelIds: ["eng", "breit"] }]);
  });

  it("Cent-genau ohne Gleitkomma", () => {
    const a = rechneSicht({ positionen, regeln: [regel("r", "1000", "1999", "aktiva.bank")], salden: [{ konto: "1000", saldo: "0.10" }, { konto: "1001", saldo: "0.20" }], stichtag: "2026-09-30" });
    expect(a.zeilen.find((z) => z.schluessel === "aktiva.bank")!.wert).toBe("0.30");
  });
});
