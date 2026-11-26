import { describe, expect, it } from "vitest";
import { Decimal, faktorAlsZahl, konvertiere, sichtenFuerPosten, summeMitLuecken, waehleKurs, zerlegeFxEffekt, type Wechselkurs } from "../index.js";

// Erwartungswerte aus referenz/referenz_waehrung.py (exakte Brüche, kaufmännisch auf Cent gerundet), Kurse und Beträge erfunden.

const KURSE: Wechselkurs[] = [
  { datum: "2026-09-28", basis: "EUR", quote: "USD", kurs: "1.0850" },
  { datum: "2026-09-30", basis: "EUR", quote: "USD", kurs: "1.1000" },
  { datum: "2026-09-30", basis: "EUR", quote: "GBP", kurs: "0.8600" },
  { datum: "2026-06-30", basis: "EUR", quote: "GBP", kurs: "0.8500" },
  { datum: "2026-09-29", basis: "GBP", quote: "USD", kurs: "1.2800" },
  { datum: "2026-03-31", basis: "EUR", quote: "CHF", kurs: "0.9700" },
];

const UMRECHNUNGEN = [
  {"betrag": "1000.00", "von": "USD", "nach": "EUR", "stichtag": "2026-09-30", "ergebnis": "909.09", "weg": "invers", "kursDatum": "2026-09-30", "luecke": null},
  {"betrag": "1000.00", "von": "EUR", "nach": "USD", "stichtag": "2026-09-30", "ergebnis": "1100.00", "weg": "direkt", "kursDatum": "2026-09-30", "luecke": null},
  {"betrag": "1000.00", "von": "EUR", "nach": "USD", "stichtag": "2026-09-29", "ergebnis": "1085.00", "weg": "direkt", "kursDatum": "2026-09-28", "luecke": null},
  {"betrag": "2500.55", "von": "GBP", "nach": "USD", "stichtag": "2026-09-30", "ergebnis": "3200.70", "weg": "direkt", "kursDatum": "2026-09-29", "luecke": null},
  {"betrag": "2500.55", "von": "USD", "nach": "GBP", "stichtag": "2026-09-30", "ergebnis": "1953.55", "weg": "invers", "kursDatum": "2026-09-29", "luecke": null},
  {"betrag": "1234.56", "von": "USD", "nach": "GBP", "stichtag": "2026-09-28", "ergebnis": null, "weg": null, "kursDatum": null, "luecke": "kein_kurs"},
  {"betrag": "999.99", "von": "CHF", "nach": "USD", "stichtag": "2026-04-02", "ergebnis": null, "weg": null, "kursDatum": null, "luecke": "kein_kurs"},
  {"betrag": "1.00", "von": "EUR", "nach": "EUR", "stichtag": "2026-09-30", "ergebnis": "1.00", "weg": "gleich", "kursDatum": "2026-09-30", "luecke": null},
  {"betrag": "0.01", "von": "USD", "nach": "EUR", "stichtag": "2026-09-30", "ergebnis": "0.01", "weg": "invers", "kursDatum": "2026-09-30", "luecke": null},
  {"betrag": "0.50", "von": "EUR", "nach": "USD", "stichtag": "2026-09-28", "ergebnis": "0.54", "weg": "direkt", "kursDatum": "2026-09-28", "luecke": null},
  {"betrag": "-2.50", "von": "EUR", "nach": "GBP", "stichtag": "2026-09-30", "ergebnis": "-2.15", "weg": "direkt", "kursDatum": "2026-09-30", "luecke": null},
  {"betrag": "100.00", "von": "EUR", "nach": "GBP", "stichtag": "2026-07-03", "ergebnis": "85.00", "weg": "direkt", "kursDatum": "2026-06-30", "luecke": null},
  {"betrag": "100.00", "von": "EUR", "nach": "GBP", "stichtag": "2026-07-08", "ergebnis": null, "weg": null, "kursDatum": null, "luecke": "veraltet"},
  {"betrag": "12345.67", "von": "GBP", "nach": "EUR", "stichtag": "2026-09-30", "ergebnis": "14355.43", "weg": "invers", "kursDatum": "2026-09-30", "luecke": null}
] as const;

const ZERLEGUNGEN = [
  {"alt": "100000.00", "neu": "120000.00", "kursAlt": "0.90909091", "kursNeu": "0.8700", "gesamt": "13490.91", "wert": "17400.00", "waehrung": "-3909.09", "fonds_alt": "90909.09", "fonds_neu": "104400.00"},
  {"alt": "100000.00", "neu": "100000.00", "kursAlt": "0.9000", "kursNeu": "0.8700", "gesamt": "-3000.00", "wert": "0.00", "waehrung": "-3000.00", "fonds_alt": "90000.00", "fonds_neu": "87000.00"},
  {"alt": "250000.00", "neu": "180000.00", "kursAlt": "1.1000", "kursNeu": "1.2500", "gesamt": "-50000.00", "wert": "-87500.00", "waehrung": "37500.00", "fonds_alt": "275000.00", "fonds_neu": "225000.00"},
  {"alt": "0.00", "neu": "50000.00", "kursAlt": "0.9000", "kursNeu": "0.9500", "gesamt": "47500.00", "wert": "47500.00", "waehrung": "0.00", "fonds_alt": "0.00", "fonds_neu": "47500.00"},
  {"alt": "33333.33", "neu": "44444.44", "kursAlt": "0.9123", "kursNeu": "0.9234", "gesamt": "10630.00", "wert": "10260.00", "waehrung": "370.00", "fonds_alt": "30410.00", "fonds_neu": "41040.00"}
] as const;

describe("Umrechnung (Referenz mit Brüchen)", () => {
  it.each(UMRECHNUNGEN)("$betrag $von → $nach am $stichtag", (u) => {
    const w = waehleKurs(KURSE, u.von, u.nach, u.stichtag);
    if (u.luecke) {
      expect(w.ok).toBe(false);
      if (!w.ok) expect(w.luecke.grund).toBe(u.luecke);
      return;
    }
    expect(w.ok).toBe(true);
    if (w.ok) {
      expect(konvertiere(u.betrag, w.faktor).toFixed(2)).toBe(u.ergebnis);
      expect(w.faktor.weg).toBe(u.weg);
      expect(w.faktor.kursDatum).toBe(u.kursDatum);
    }
  });

  it("Lücken tragen von, nach, Stichtag und den letzten vorhandenen Kurs, nie einen Wert", () => {
    const alt = waehleKurs(KURSE, "EUR", "GBP", "2026-07-08");
    expect(alt).toEqual({ ok: false, luecke: { von: "EUR", nach: "GBP", stichtag: "2026-07-08", grund: "veraltet", letzterKursDatum: "2026-06-30" } });
    const keiner = waehleKurs(KURSE, "EUR", "JPY", "2026-09-30");
    expect(keiner).toEqual({ ok: false, luecke: { von: "EUR", nach: "JPY", stichtag: "2026-09-30", grund: "kein_kurs", letzterKursDatum: null } });
    // Kurse nach dem Stichtag zählen nicht.
    expect(waehleKurs(KURSE, "EUR", "USD", "2026-09-27").ok).toBe(false);
  });

  it("ein eigener Höchstalter ist wählbar, ein Eintrag am Stichtag zählt immer", () => {
    expect(waehleKurs(KURSE, "EUR", "GBP", "2026-07-08", 10).ok).toBe(true);
    expect(waehleKurs(KURSE, "EUR", "GBP", "2026-06-30", 0).ok).toBe(true);
  });

  it("Weg über EUR nennt beide Einträge und das ältere Datum; bei Gleichstand gilt der direkte Eintrag", () => {
    const kurse: Wechselkurs[] = [
      { datum: "2026-09-30", basis: "EUR", quote: "USD", kurs: "1.1000" },
      { datum: "2026-09-29", basis: "EUR", quote: "GBP", kurs: "0.8000" },
    ];
    const w = waehleKurs(kurse, "USD", "GBP", "2026-09-30");
    expect(w.ok && w.faktor.weg).toBe("ueber_eur");
    if (w.ok) {
      expect(w.faktor.kursDatum).toBe("2026-09-29");
      expect(w.faktor.stuetzstellen).toHaveLength(2);
      expect(konvertiere("110.00", w.faktor).toFixed(2)).toBe("80.00");
    }
    const gleich = waehleKurs([{ datum: "2026-09-30", basis: "USD", quote: "EUR", kurs: "0.9000" }, { datum: "2026-09-30", basis: "EUR", quote: "USD", kurs: "1.1000" }], "EUR", "USD", "2026-09-30");
    expect(gleich.ok && gleich.faktor.weg).toBe("direkt");
  });

  it("der Kehrwert wird nicht gerundet: Umrechnung hin und zurück verändert eine runde Summe nicht über den Cent hinaus", () => {
    const w = waehleKurs(KURSE, "USD", "EUR", "2026-09-30");
    const z = waehleKurs(KURSE, "EUR", "USD", "2026-09-30");
    expect(w.ok && z.ok).toBe(true);
    if (w.ok && z.ok) {
      expect(konvertiere(konvertiere("1100000.00", w.faktor), z.faktor).toFixed(2)).toBe("1100000.00");
      expect(faktorAlsZahl(w.faktor, 8)).toBe("0.90909091");
    }
  });
});

describe("Zerlegung des Währungseffekts (Referenz mit Brüchen)", () => {
  it.each(ZERLEGUNGEN)("$alt → $neu bei $kursAlt → $kursNeu", (z) => {
    const r = zerlegeFxEffekt({ wertAltLokal: z.alt, wertNeuLokal: z.neu, kursAlt: z.kursAlt, kursNeu: z.kursNeu });
    expect(r).toEqual({ fondsAlt: z.fonds_alt, fondsNeu: z.fonds_neu, gesamt: z.gesamt, wert: z.wert, waehrung: z.waehrung });
    // Beide Teile ergeben genau die Gesamtänderung.
    expect(new Decimal(r.wert).plus(r.waehrung).toFixed(2)).toBe(r.gesamt);
  });
});

const SICHTEN = [
  { datum: "2026-09-30", fonds: "100000.00", lokal: null, lokalWaehrung: "USD", vergleichsWaehrung: "GBP", erg: { fonds: "100000.00", lokal: "110000.00", vergleich: "86000.00" } },
  { datum: "2026-09-30", fonds: "100000.00", lokal: "108123.45", lokalWaehrung: "USD", vergleichsWaehrung: "USD", erg: { fonds: "100000.00", lokal: "108123.45", vergleich: "108123.45" } },
  { datum: "2026-09-30", fonds: "55555.55", lokal: null, lokalWaehrung: "EUR", vergleichsWaehrung: "GBP", erg: { fonds: "55555.55", lokal: "55555.55", vergleich: "47777.77" } },
  { datum: "2026-07-20", fonds: "100000.00", lokal: null, lokalWaehrung: "USD", vergleichsWaehrung: "GBP", erg: { fonds: "100000.00", lokal: null, vergleich: null } },
  { datum: "2026-09-30", fonds: "250.25", lokal: null, lokalWaehrung: "GBP", vergleichsWaehrung: null, erg: { fonds: "250.25", lokal: "215.22", vergleich: null } },
  { datum: "2026-09-30", fonds: "99999.99", lokal: "100.00", lokalWaehrung: "EUR", vergleichsWaehrung: "EUR", erg: { fonds: "99999.99", lokal: "100.00", vergleich: "99999.99" } },
] as const;

describe("Sichten auf einen Posten (Referenz mit Brüchen)", () => {
  it.each(SICHTEN)("$datum $fonds EUR, lokal $lokalWaehrung, Vergleich $vergleichsWaehrung", (f) => {
    const r = sichtenFuerPosten({ datum: f.datum, fonds: f.fonds, lokal: f.lokal }, { fondsWaehrung: "EUR", lokalWaehrung: f.lokalWaehrung, vergleichsWaehrung: f.vergleichsWaehrung, kurse: KURSE });
    expect(r.fonds.toFixed(2)).toBe(f.erg.fonds);
    expect(r.lokal?.toFixed(2) ?? null).toBe(f.erg.lokal);
    expect(r.vergleich?.toFixed(2) ?? null).toBe(f.erg.vergleich);
    // Eine Lücke steht immer mit ihrem Grund da; ohne Lücke gibt es für jede Umrechnung einen verwendeten Kurs.
    if (f.erg.lokal === null || (f.vergleichsWaehrung !== null && f.erg.vergleich === null)) expect(r.luecken.length).toBeGreaterThan(0);
    else expect(r.luecken).toEqual([]);
  });
});

describe("Summen mit Lücken", () => {
  it("ein fehlender Posten macht die Summe zur Lücke, nie zu einer Teilsumme", () => {
    expect(summeMitLuecken(["1.10", "2.20", "3.30"])?.toFixed(2)).toBe("6.60");
    expect(summeMitLuecken(["1.10", null, "3.30"])).toBeNull();
    expect(summeMitLuecken([])?.toFixed(2)).toBe("0.00");
  });
});
