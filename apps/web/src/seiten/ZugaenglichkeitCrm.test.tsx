import { fireEvent, screen, within } from "@testing-library/react";
import axe from "axe-core";
import { describe, expect, it } from "vitest";
import { ORG_A, crmDealAntworten, crmZeilenDaten, rendereApp, spieleApi, dealflowAuswahl } from "../test/hilfen";

/**
 * Zugänglichkeit der CRM-Seiten mit axe-core in jsdom: Tabelle (Gitter mit Spaltenköpfen, Griffen, Auswahl), Filter-Panel, Board mit Griffen,
 * Datensatzseiten mit Attributleiste. Kontrast und Überläufe misst der Browserdurchlauf (`scripts/abnahme/durchlauf.mjs`).
 */
const REGELN = ["label-content-name-mismatch", "landmark-unique", "aria-allowed-attr", "aria-valid-attr-value", "aria-required-children", "aria-required-parent", "aria-roles", "duplicate-id-aria", "button-name", "link-name", "label", "aria-input-field-name", "scrollable-region-focusable"];

async function pruefe() {
  const ergebnis = await axe.run(document.body, { runOnly: { type: "rule", values: REGELN }, resultTypes: ["violations"] });
  return ergebnis.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
}

describe("Zugänglichkeit der CRM-Seiten (axe)", () => {
  for (const sprache of ["de", "en"] as const) {
    it(`Tabelle, Auswahl und Filter (${sprache})`, async () => {
      localStorage.setItem("carraway.sprache", sprache);
      spieleApi();
      rendereApp("/contacts");
      const grid = await screen.findByRole("grid");
      fireEvent.click(grid.querySelector<HTMLInputElement>('input[type="checkbox"][aria-label]:not([aria-label^="Alle"]):not([aria-label^="Select all"])')!);
      expect(await pruefe()).toEqual([]);
      fireEvent.click(screen.getByRole("button", { name: /^Filter/ }));
      await screen.findByRole("dialog");
      fireEvent.click(screen.getByRole("button", { name: sprache === "de" ? "Bedingung hinzufügen" : "Add condition" }));
      expect(await pruefe()).toEqual([]);
    });

    it(`Board (${sprache})`, async () => {
      localStorage.setItem("carraway.sprache", sprache);
      spieleApi();
      rendereApp("/dealflow");
      await screen.findByRole("button", { name: sprache === "de" ? "Verschieben: Alpha, Wachstum" : "Move: Alpha, Wachstum" });
      expect(await pruefe()).toEqual([]);
    });

    it(`Eingang, Zuordnung und Kartenvorschau (${sprache})`, async () => {
      localStorage.setItem("carraway.sprache", sprache);
      spieleApi();
      const deutsch = sprache === "de";
      rendereApp("/dealflow?section=inbox");
      fireEvent.click(await screen.findByRole("button", { name: deutsch ? /^Zuweisen:/ : /^Assign:/ }));
      const zuordnung = await screen.findByRole("dialog", { name: deutsch ? "Zuordnung bearbeiten" : "Edit assignment" });
      const investmentmanagement = within(zuordnung).getByRole("combobox", { name: deutsch ? "Investmentmanagement" : "Investment manager" });
      await within(investmentmanagement).findByRole("option", { name: "Vera Beispiel" });
      expect(await pruefe()).toEqual([]);
      fireEvent.keyDown(document, { key: "Escape" });
      const nav = screen.getByRole("tablist", { name: deutsch ? "Dealflow-Ansichten" : "Deal flow views" });
      fireEvent.click(within(nav).getByRole("tab", { name: "Pipeline" }));
      await screen.findByRole("region", { name: deutsch ? "Deals nach Phase" : "Deals by stage" });
      await dealflowAuswahl();
      fireEvent.click(await screen.findByRole("button", { name: deutsch ? "Kartenfelder" : "Card fields" }));
      const vorschau = await screen.findByRole("region", { name: deutsch ? "Kartenvorschau" : "Card preview" });
      await within(vorschau).findByText("Alpha, Wachstum");
      expect(await pruefe()).toEqual([]);
    });

    it(`gleichzeitige Pipeline-Gruppen und Listen (${sprache})`, async () => {
      localStorage.setItem("carraway.sprache", sprache);
      const deutsch = sprache === "de";
      spieleApi(crmDealAntworten([
        { ...crmZeilenDaten.deal[0]!, dealtyp: "erstinvestment" },
        { ...crmZeilenDaten.deal[1]!, status: "offen", dealtyp: "anschlussinvestment" },
      ]));
      rendereApp("/dealflow?group=deal-type");
      fireEvent.click(await screen.findByRole("button", { name: deutsch ? /^Anschlussinvestment/ : /^Follow-on investment/ }));
      await screen.findByRole("region", { name: deutsch ? "Deals nach Phase · Anschlussinvestment" : "Deals by stage · Follow-on investment" });
      expect(await pruefe()).toEqual([]);
      fireEvent.click(screen.getByRole("button", { name: deutsch ? "Liste" : "List" }));
      await screen.findByRole("region", { name: deutsch ? "Deals in der Pipeline · Erstinvestment" : "Deals in the pipeline · Initial investment" });
      expect(await pruefe()).toEqual([]);
    });

    it(`Datensatzseiten (${sprache})`, async () => {
      localStorage.setItem("carraway.sprache", sprache);
      spieleApi();
      const { unmount } = rendereApp(`/organizations/${ORG_A}`);
      await screen.findByRole("heading", { level: 1 });
      await screen.findByText("Hamburg", { selector: "dd *, dd" });
      expect(await pruefe()).toEqual([]);
      unmount();
      const zwei = rendereApp("/deals/d1");
      await screen.findByRole("heading", { level: 1 });
      await screen.findByRole("region", { name: sprache === "de" ? "Attribute" : "Attributes" });
      expect(await pruefe()).toEqual([]);
      zwei.unmount();
    });
  }
});
