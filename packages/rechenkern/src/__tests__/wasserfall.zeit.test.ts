import { describe, expect, it } from "vitest";
import { wasserfallKnicke, wasserfallKurve } from "../index.js";

describe("Wasserfall: Laufzeit der Kurve", () => {
  it("200 Punkte und die Knickpunkte mit drei Klassen in unter zwei Sekunden", () => {
    const eingabe = {
      exitdatum: "2027-03-31",
      klassen: [
        { id: "B", name: "B", rang: 1, praeferenzFaktor: "1.5", partizipierend: false, umwandelbar: true },
        { id: "A", name: "A", rang: 2, praeferenzFaktor: "1", partizipierend: true, capFaktor: "3", verzinsung: "0.05", umwandelbar: true },
        { id: "S", name: "S", rang: 2, praeferenzFaktor: "1", partizipierend: false, umwandelbar: true },
      ],
      inhaber: [
        { id: "g", name: "G", klasseId: null, anteile: "5000000", investiert: "0" },
        { id: "s1", name: "S", klasseId: "S", anteile: "800000", investiert: "400000", datum: "2023-02-01" },
        { id: "a1", name: "A", klasseId: "A", anteile: "1200000", investiert: "3000000", datum: "2024-06-30" },
        { id: "a2", name: "A2", klasseId: "A", anteile: "300000", investiert: "900000", datum: "2025-06-30" },
        { id: "b1", name: "B", klasseId: "B", anteile: "1500000", investiert: "9000000", datum: "2026-01-31" },
      ],
    };
    const start = performance.now();
    const werte = Array.from({ length: 200 }, (_, i) => String((i + 1) * 1_000_000));
    wasserfallKurve(eingabe, werte, ["a1"]);
    const knicke = wasserfallKnicke(eingabe, "200000000");
    const dauer = performance.now() - start;
    expect(knicke.length).toBeGreaterThan(0);
    expect(dauer).toBeLessThan(2000);
  });
});
