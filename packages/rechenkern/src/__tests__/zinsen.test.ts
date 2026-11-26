import { describe, expect, it } from "vitest";
import {
  abgrenzung,
  kapitalAm,
  kapitalabschnitte,
  kapitalverlauf,
  zinsenImZeitraum,
  zinslauf,
  type Kapitalbewegung,
  type Zinsdarlehen,
} from "../index.js";

// Alle Erwartungswerte stammen aus referenz/referenz_zinsen.py (exakte Brüche, `python3 -I`), nicht aus diesem Code.
// Beträge, Daten und Sätze sind erfunden. Zinsen werden ungerundet verglichen (8 Nachkommastellen),
// nur `betragGebucht` ist auf Cent gerundet.

const bewegungenA: Kapitalbewegung[] = [
  { datum: "2026-07-01", art: "tilgung", betrag: 30_000 },
  { datum: "2026-01-01", art: "auszahlung", betrag: 100_000 },
  { datum: "2026-10-01", art: "kapitalisierung", betrag: 2_000 },
  { datum: "2026-04-01", art: "auszahlung", betrag: 50_000 },
];

describe("kapitalverlauf", () => {
  it("sortiert und bildet die Treppenfunktion", () => {
    const { wert, schritte } = kapitalverlauf(bewegungenA);
    expect(wert.staende.map((s) => [s.ab, s.kapital.toString()])).toEqual([
      ["2026-01-01", "100000"],
      ["2026-04-01", "150000"],
      ["2026-07-01", "120000"],
      ["2026-10-01", "122000"],
    ]);
    expect(schritte.at(-1)?.wert).toBe("122000");
    expect(kapitalAm(wert, "2025-12-31").toString()).toBe("0");
    expect(kapitalAm(wert, "2026-06-30").toString()).toBe("150000");
    expect(kapitalAm(wert, "2026-07-01").toString()).toBe("120000");
  });

  it("zerlegt einen Zeitraum an jeder Änderung", () => {
    const { wert } = kapitalverlauf(bewegungenA);
    const a = kapitalabschnitte(wert, "2026-02-01", "2026-08-01");
    expect(a.map((x) => [x.von, x.bis, x.kapital.toString()])).toEqual([
      ["2026-02-01", "2026-04-01", "100000"],
      ["2026-04-01", "2026-07-01", "150000"],
      ["2026-07-01", "2026-08-01", "120000"],
    ]);
  });

  it("fasst Bewegungen am selben Tag zusammen", () => {
    const { wert } = kapitalverlauf([
      { datum: "2026-01-01", art: "auszahlung", betrag: 1000 },
      { datum: "2026-02-01", art: "tilgung", betrag: 1000 },
      { datum: "2026-02-01", art: "auszahlung", betrag: 500 },
    ]);
    expect(wert.staende.map((s) => s.kapital.toString())).toEqual(["1000", "500"]);
  });

  it("lehnt negatives Kapital ab", () => {
    expect(() =>
      kapitalverlauf([
        { datum: "2026-01-01", art: "auszahlung", betrag: 1000 },
        { datum: "2026-02-01", art: "tilgung", betrag: 1000.01 },
      ]),
    ).toThrow(/negativ/);
  });

  it("lehnt eine erste Bewegung ohne Auszahlung, Beträge unter null und ungültige Daten ab", () => {
    expect(() => kapitalverlauf([{ datum: "2026-01-01", art: "tilgung", betrag: 1 }])).toThrow(/Auszahlung/);
    expect(() => kapitalverlauf([{ datum: "2026-01-01", art: "auszahlung", betrag: -5 }])).toThrow(/größer als null/);
    expect(() => kapitalverlauf([{ datum: "2026-02-30", art: "auszahlung", betrag: 5 }])).toThrow();
  });
});

describe("zinsenImZeitraum", () => {
  it("teilt bei Kapitaländerungen, 30E/360", () => {
    const e = zinsenImZeitraum(bewegungenA, "2026-01-01", "2027-01-01", { satzFix: "0.05", methode: "30E/360" });
    expect(e.segmente.map((s) => s.betrag.toFixed(2))).toEqual(["1250.00", "1875.00", "1500.00", "1525.00"]);
    expect(e.betragFix.toFixed(8)).toBe("6150.00000000");
    expect(e.betragGesamt.toFixed(8)).toBe("6150.00000000");
    expect(e.schritte.at(-1)?.bezeichnung).toBe("Zinsen gesamt");
  });

  it("teilt bei Kapitaländerungen, act/365", () => {
    const e = zinsenImZeitraum(bewegungenA, "2026-01-01", "2027-01-01", { satzFix: "0.05", methode: "act/365" });
    expect(e.segmente.map((s) => s.kalendertage)).toEqual([90, 91, 92, 92]);
    expect(e.betragFix.toFixed(8)).toBe("6152.60273973");
  });

  const gewinn = (ueberschuss: number) => ({
    satzFix: "0.05",
    methode: "30E/360" as const,
    gewinnabhaengig: { satz: "0.10", bemessung: { 2026: ueberschuss }, kappungSatz: "0.08" },
  });

  it("Gewinnzins unter der Kappung: 10 % von 40.000", () => {
    const e = zinsenImZeitraum(bewegungenA, "2026-01-01", "2027-01-01", gewinn(40_000));
    expect(e.gewinnzeilen).toHaveLength(1);
    expect(e.gewinnzeilen[0]?.durchschnittskapital.toFixed(8)).toBe("123052.05479452");
    expect(e.betragGewinn.toFixed(8)).toBe("4000.00000000");
    expect(e.betragGesamt.toFixed(8)).toBe("10150.00000000");
  });

  it("Gewinnzins über der Kappung: begrenzt auf 8 % des Durchschnittskapitals", () => {
    const e = zinsenImZeitraum(bewegungenA, "2026-01-01", "2027-01-01", gewinn(300_000));
    expect(e.gewinnzeilen[0]?.ungekappt.toFixed(8)).toBe("30000.00000000");
    expect(e.gewinnzeilen[0]?.kappung.toFixed(8)).toBe("9844.16438356");
    expect(e.betragGewinn.toFixed(8)).toBe("9844.16438356");
    expect(e.betragGesamt.toFixed(8)).toBe("15994.16438356");
  });

  it("verlangt den Jahresüberschuss jedes berührten Jahres", () => {
    expect(() => zinsenImZeitraum(bewegungenA, "2026-01-01", "2027-02-01", gewinn(1))).toThrow(/2027/);
  });
});

const bewegungenC: Kapitalbewegung[] = [
  { datum: "2026-01-01", art: "auszahlung", betrag: 100_000 },
  { datum: "2026-04-15", art: "auszahlung", betrag: 50_000 },
];

const quartalsdarlehen: Zinsdarlehen = {
  id: "d1",
  bewegungen: bewegungenC,
  bedingungen: { satzFix: "0.06", methode: "30E/360" },
  zinsperiode: "quartalsweise",
  anker: "2026-03-31",
};

describe("zinslauf", () => {
  it("quartalsweise, Perioden am Monatsende, Teilperiode am Anfang", () => {
    const p = zinslauf([quartalsdarlehen], "2026-12-31");
    expect(p.map((x) => [x.von, x.bis])).toEqual([
      ["2026-01-01", "2026-03-31"],
      ["2026-03-31", "2026-06-30"],
      ["2026-06-30", "2026-09-30"],
      ["2026-09-30", "2026-12-31"],
    ]);
    expect(p.map((x) => x.betragGesamt.toFixed(8))).toEqual(["1483.33333333", "2125.00000000", "2250.00000000", "2250.00000000"]);
    expect(p.map((x) => x.betragGebucht.toFixed(2))).toEqual(["1483.33", "2125.00", "2250.00", "2250.00"]);
    expect(p[1]?.kapitalien.map((k) => k.kapital.toString())).toEqual(["100000", "150000"]);
    expect(p[0]?.schritte.at(-1)?.wert).toBe("1483.33");
  });

  it("nur Perioden, die bis zum Stichtag enden", () => {
    expect(zinslauf([quartalsdarlehen], "2026-09-29")).toHaveLength(2);
  });

  it("überspringt bereits gebuchte Perioden", () => {
    const p = zinslauf([{ ...quartalsdarlehen, gebuchtePerioden: ["2026-03-31", "2026-06-30"] }], "2026-12-31");
    expect(p.map((x) => x.bis)).toEqual(["2026-09-30", "2026-12-31"]);
    expect(p[0]?.betragGebucht.toFixed(2)).toBe("2250.00");
  });

  it("Stundung verschiebt nur die Fälligkeit, nicht die Zinsen", () => {
    const p = zinslauf([{ ...quartalsdarlehen, stundungBis: "2026-08-15" }], "2026-12-31");
    expect(p.map((x) => x.faelligAm)).toEqual(["2026-08-15", "2026-08-15", "2026-09-30", "2026-12-31"]);
    expect(p.map((x) => x.gestundet)).toEqual([true, true, false, false]);
    expect(p.map((x) => x.betragGebucht.toFixed(2))).toEqual(["1483.33", "2125.00", "2250.00", "2250.00"]);
  });

  it("jährlich, act/365, erste Periode ab Auszahlung", () => {
    const p = zinslauf(
      [
        {
          id: "d2",
          bewegungen: [{ datum: "2026-03-15", art: "auszahlung", betrag: 80_000 }],
          bedingungen: { satzFix: "0.04", methode: "act/365" },
          zinsperiode: "jaehrlich",
          anker: "2026-12-31",
        },
      ],
      "2027-12-31",
    );
    expect(p.map((x) => [x.von, x.bis])).toEqual([
      ["2026-03-15", "2026-12-31"],
      ["2026-12-31", "2027-12-31"],
    ]);
    expect(p.map((x) => x.betragGesamt.toFixed(8))).toEqual(["2551.23287671", "3200.00000000"]);
    expect(p.map((x) => x.betragGebucht.toFixed(2))).toEqual(["2551.23", "3200.00"]);
  });

  it("endfällig: eine Periode bis zum Fälligkeitstag, erst ab Fälligkeit", () => {
    const d: Zinsdarlehen = {
      id: "d3",
      bewegungen: [{ datum: "2026-01-01", art: "auszahlung", betrag: 100_000 }],
      bedingungen: { satzFix: "0.05", methode: "act/365" },
      zinsperiode: "endfaellig",
      anker: "2026-04-01",
    };
    expect(zinslauf([d], "2026-03-31")).toHaveLength(0);
    const p = zinslauf([d], "2026-12-31");
    expect(p).toHaveLength(1);
    expect(p[0]?.betragGesamt.toFixed(8)).toBe("1232.87671233");
    expect(() => zinslauf([{ ...d, anker: "2026-01-01" }], "2026-12-31")).toThrow(/Fälligkeit/);
  });

  it("Kapitalisierung über zwei Perioden (Zinseszins)", () => {
    const p = zinslauf(
      [
        {
          id: "d4",
          bewegungen: [{ datum: "2025-01-01", art: "auszahlung", betrag: 200_000 }],
          bedingungen: { satzFix: "0.08", methode: "30E/360" },
          zinsperiode: "jaehrlich",
          anker: "2026-01-01",
          kapitalisieren: true,
        },
      ],
      "2027-01-01",
    );
    expect(p.map((x) => x.betragGebucht.toFixed(2))).toEqual(["16000.00", "17280.00"]);
    expect(p[1]?.kapitalien.map((k) => k.kapital.toString())).toEqual(["216000"]);
    expect(p.every((x) => x.kapitalisiert)).toBe(true);
  });

  it("Kapitalisierung schlägt den gerundeten Buchungsbetrag zu (act/365, quartalsweise)", () => {
    const p = zinslauf(
      [
        {
          id: "d5",
          bewegungen: [{ datum: "2026-01-01", art: "auszahlung", betrag: 100_000 }],
          bedingungen: { satzFix: "0.05", methode: "act/365" },
          zinsperiode: "quartalsweise",
          anker: "2026-04-01",
          kapitalisieren: true,
        },
      ],
      "2026-07-01",
    );
    expect(p[0]?.betragGesamt.toFixed(8)).toBe("1232.87671233");
    expect(p[0]?.betragGebucht.toFixed(2)).toBe("1232.88");
    expect(p[1]?.kapitalien[0]?.kapital.toFixed(2)).toBe("101232.88");
    expect(p[1]?.betragGesamt.toFixed(8)).toBe("1261.94412055");
    expect(p[1]?.betragGebucht.toFixed(2)).toBe("1261.94");
  });

  it("Gewinnanteil in einer Teilperiode, unter und über der Kappung", () => {
    const d = (ueberschuss: number): Zinsdarlehen => ({
      id: "d6",
      bewegungen: [{ datum: "2026-01-01", art: "auszahlung", betrag: 100_000 }],
      bedingungen: {
        satzFix: "0.05",
        methode: "30E/360",
        gewinnabhaengig: { satz: "0.10", bemessung: { 2026: ueberschuss }, kappungSatz: "0.08" },
      },
      zinsperiode: "quartalsweise",
      anker: "2026-04-01",
    });
    const unter = zinslauf([d(60_000)], "2026-04-01")[0]!;
    expect(unter.betragFix.toFixed(8)).toBe("1250.00000000");
    expect(unter.betragGewinn.toFixed(8)).toBe("1479.45205479");
    expect(unter.betragGesamt.toFixed(8)).toBe("2729.45205479");
    expect(unter.betragGebucht.toFixed(2)).toBe("2729.45");
    const ueber = zinslauf([d(200_000)], "2026-04-01")[0]!;
    expect(ueber.betragGewinn.toFixed(8)).toBe("1972.60273973");
    expect(ueber.betragGebucht.toFixed(2)).toBe("3222.60");
  });

  it("mehrere Darlehen ergeben getrennte Positionen", () => {
    const p = zinslauf([quartalsdarlehen, { ...quartalsdarlehen, id: "d7" }], "2026-03-31");
    expect(p.map((x) => x.darlehenId)).toEqual(["d1", "d7"]);
  });
});

describe("abgrenzung", () => {
  it("Zinsen seit dem letzten Periodenende bis zum Stichtag", () => {
    const a = abgrenzung(quartalsdarlehen, "2026-11-15");
    expect([a.von, a.bis]).toEqual(["2026-09-30", "2026-11-15"]);
    expect(a.betragGesamt.toFixed(8)).toBe("1125.00000000");
    expect(a.betragGebucht.toFixed(2)).toBe("1125.00");
  });

  it("vor der ersten Periode ab der ersten Auszahlung, mit Rundung nur beim Buchungsbetrag", () => {
    const a = abgrenzung(quartalsdarlehen, "2026-02-20");
    expect(a.von).toBe("2026-01-01");
    expect(a.betragGesamt.toFixed(8)).toBe("816.66666667");
    expect(a.betragGebucht.toFixed(2)).toBe("816.67");
  });

  it("am Periodenende ist nichts abzugrenzen, vor der Auszahlung ebenso", () => {
    expect(abgrenzung(quartalsdarlehen, "2026-06-30").betragGesamt.toFixed(2)).toBe("0.00");
    expect(abgrenzung(quartalsdarlehen, "2025-06-30").betragGesamt.toFixed(2)).toBe("0.00");
  });
});
