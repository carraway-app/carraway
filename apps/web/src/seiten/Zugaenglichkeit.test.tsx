import { screen } from "@testing-library/react";
import axe from "axe-core";
import { describe, expect, it } from "vitest";
import { ICH_ID, ORG_A, rendereApp, spieleApi, wiedervorlageDaten } from "../test/hilfen";

/**
 * Zugänglichkeit mit axe-core in jsdom (Nacharbeiten 2). Geprüft werden die Regeln, die ohne Layout und Farben laufen: Namen von Schaltflächen und
 * Links müssen ihren sichtbaren Text enthalten, Landmarken müssen unterscheidbar sein, ARIA muss gültig sein. Kontrast und Überläufe misst der
 * Durchlauf im Browser (`scripts/abnahme/durchlauf.mjs`).
 */
const REGELN = ["label-content-name-mismatch", "landmark-unique", "aria-allowed-attr", "aria-valid-attr-value", "aria-required-children", "duplicate-id-aria", "button-name", "link-name", "label", "region"];

async function pruefe() {
  const ergebnis = await axe.run(document.body, { runOnly: { type: "rule", values: REGELN.filter((r) => r !== "region") }, resultTypes: ["violations"] });
  return ergebnis.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
}

describe("Zugänglichkeit (axe)", () => {
  for (const sprache of ["de", "en"] as const) {
    it(`Kontaktseite mit Kopfzeile ist in Ordnung (${sprache})`, async () => {
      localStorage.setItem("carraway.sprache", sprache);
      spieleApi({
        "/api/v1/wiedervorlagen": { koerper: { daten: [{ ...wiedervorlageDaten, zustaendigId: ICH_ID, ueberfaellig: true }] } },
        "/api/v1/benutzer/namen": { koerper: { daten: [{ id: ICH_ID, name: "Vera Beispiel" }] } },
      });
      rendereApp("/kontakte");
      await screen.findByRole("link", { name: /^(Wiedervorlagen|Follow-ups) \d/ });
      expect(await pruefe()).toEqual([]);
    });
  }

  it("Organisationsseite ist in Ordnung", async () => {
    spieleApi({});
    rendereApp(`/organisationen/${ORG_A}`);
    await screen.findByRole("heading", { level: 1 });
    expect(await pruefe()).toEqual([]);
  });
});
