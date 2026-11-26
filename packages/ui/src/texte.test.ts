import { describe, expect, it } from "vitest";
import { texte } from "./texte";

describe("Texttabelle", () => {
  it("hat in Deutsch und Englisch dieselben Schlüssel", () => {
    expect(Object.keys(texte.en).sort()).toEqual(Object.keys(texte.de).sort());
  });

  it("hat keine leeren Texte", () => {
    for (const sprache of ["de", "en"] as const) {
      for (const [schluessel, wert] of Object.entries(texte[sprache])) {
        const text = typeof wert === "function" ? wert("X") : wert;
        expect(text.trim(), `${sprache}.${schluessel}`).not.toBe("");
      }
    }
  });
});
