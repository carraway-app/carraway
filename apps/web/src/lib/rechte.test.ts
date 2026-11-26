import { describe, expect, it } from "vitest";
import type { Ich } from "../api/anmeldung";
import { hatIrgendwoRolle, hatRolle, rolleAm } from "./rechte";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

const basis = { globalVerwalter: false, rollen: [], bereiche: null, stufeOhneFonds: null, bereicheJeFonds: null, stufeOhneFondsJeBereich: null } as unknown as Ich;
const ich = (extra: Record<string, unknown>): Ich => ({ ...basis, ...extra }) as Ich;

/** Fonds A: Portfolio bearbeiten, Finanzen nur lesen; Fonds B: nur Kontakte. Ohne Fonds: Kontakte als Bearbeiter. */
const jeFonds = ich({
  rollen: [{ fondsId: A, rolle: "bearbeiter" }, { fondsId: B, rolle: "bearbeiter" }],
  bereiche: ["portfolio", "finanzen", "kontakte"],
  stufeOhneFonds: "bearbeiter",
  bereicheJeFonds: { [A]: { portfolio: "bearbeiter", finanzen: "betrachter" }, [B]: { kontakte: "bearbeiter" } },
  stufeOhneFondsJeBereich: { kontakte: "bearbeiter" },
});

describe("Rechtehilfe: Stufe je Fonds und Bereich", () => {
  it("nutzt die Stufe an genau diesem Fonds und Bereich", () => {
    expect(rolleAm(jeFonds, A, "portfolio")).toBe("bearbeiter");
    expect(rolleAm(jeFonds, A, "finanzen")).toBe("betrachter");
    expect(hatRolle(jeFonds, A, "bearbeiter", "portfolio")).toBe(true);
    expect(hatRolle(jeFonds, A, "bearbeiter", "finanzen")).toBe(false);
    expect(hatRolle(jeFonds, A, "betrachter", "finanzen")).toBe(true);
  });

  it("Fonds ohne den Bereich bieten nichts an, auch wenn die Person dort eine Stufe hat", () => {
    expect(rolleAm(jeFonds, B, "portfolio")).toBeNull();
    expect(hatRolle(jeFonds, B, "betrachter", "portfolio")).toBe(false);
    expect(hatRolle(jeFonds, B, "bearbeiter", "kontakte")).toBe(true);
  });

  it("ohne Bereich gilt die Stufe am Fonds über alle Bereiche (rückwärtskompatibel)", () => {
    expect(rolleAm(jeFonds, B)).toBe("bearbeiter");
    expect(hatRolle(jeFonds, B, "bearbeiter")).toBe(true);
  });

  it("ohne Bereiche je Fonds (null) gilt die Stufe am Fonds für jeden Bereich", () => {
    const klassisch = ich({ rollen: [{ fondsId: A, rolle: "freigeber" }], bereiche: ["portfolio"] });
    expect(hatRolle(klassisch, A, "freigeber", "portfolio")).toBe(true);
    expect(hatRolle(klassisch, B, "betrachter", "portfolio")).toBe(false);
  });

  it("globale Verwalter sind überall Verwalter", () => {
    const g = ich({ globalVerwalter: true });
    expect(hatRolle(g, B, "verwalter", "portfolio")).toBe(true);
    expect(hatIrgendwoRolle(g, "verwalter", "portfolio")).toBe(true);
  });

  it("ohne Fonds zählt je Bereich die Stufe ohne Fonds oder an irgendeinem Fonds", () => {
    expect(hatIrgendwoRolle(jeFonds, "bearbeiter", "kontakte")).toBe(true);
    expect(hatIrgendwoRolle(jeFonds, "bearbeiter", "portfolio")).toBe(true);
    expect(hatIrgendwoRolle(jeFonds, "bearbeiter", "finanzen")).toBe(false);
    expect(hatIrgendwoRolle(jeFonds, "betrachter", "finanzen")).toBe(true);
    expect(hatIrgendwoRolle(jeFonds, "betrachter", "dealflow")).toBe(false);
    // ohne Bereich wie bisher
    expect(hatIrgendwoRolle(jeFonds, "bearbeiter")).toBe(true);
    expect(hatIrgendwoRolle(ich({ stufeOhneFonds: "betrachter" }), "bearbeiter")).toBe(false);
  });
});
