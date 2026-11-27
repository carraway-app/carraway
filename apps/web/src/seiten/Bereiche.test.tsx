import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { BET_ID, DEAL_ID, FONDS_ID, ORG_A, alsRolle, rendereApp, spieleApi } from "../test/hilfen";

/** Demo-Rollen des Rechtemodells (`packages/db/src/demo/zugaenge.ts`) als Antwort von `/me`. */
const NUR_KONTAKTE = alsRolle("bearbeiter", { bereiche: ["kontakte"], stufeOhneFonds: "bearbeiter" });
const CONTROLLING = alsRolle("bearbeiter", { bereiche: ["portfolio", "finanzen", "berichte", "meldewesen", "kennzahlen"] });

/** Ein Ort in der Leiste, ein Reiter oder eine Sprungmarke mit diesem Namen. */
const hatEintrag = (name: RegExp) => screen.queryAllByRole("link", { name }).length > 0 || screen.queryAllByRole("tab", { name }).length > 0;
const angefragt = (api: ReturnType<typeof spieleApi>, teil: string) => api.aufrufe.some((a) => a.pfad.includes(teil));

describe("Bereiche in der Oberfläche", () => {
  it("Organisation (nur Kontakte): Deals, Beteiligungen, Runden und Dokumente fehlen, es gibt keine Anfrage und keinen 403", async () => {
    const api = spieleApi({ "/api/v1/me": NUR_KONTAKTE });
    rendereApp(`/organizations/${ORG_A}`);
    expect(await screen.findByRole("heading", { level: 1, name: "Alpha Energie" })).toBeTruthy();
    expect(hatEintrag(/^Kontakte/)).toBe(true);
    expect(hatEintrag(/^Aufgaben/)).toBe(true);
    for (const name of [/^Deals/, /^Beteiligungen/, /^Runden/, /^Dokumente/]) expect(hatEintrag(name)).toBe(false);
    expect(angefragt(api, "/finanzierungsrunden")).toBe(false);
    expect(angefragt(api, "/meldedaten")).toBe(false);
    expect(angefragt(api, "/api/v1/documents")).toBe(false);
  });

  it("Organisation (nur Kontakte): ?tab=rounds fällt auf den ersten Eintrag zurück", async () => {
    const api = spieleApi({ "/api/v1/me": NUR_KONTAKTE });
    rendereApp(`/organizations/${ORG_A}?tab=rounds`);
    expect(await screen.findByRole("region", { name: "Kontakte des Unternehmens" })).toBeTruthy();
    expect(angefragt(api, "/finanzierungsrunden")).toBe(false);
  });

  it("Organisation bearbeiten (nur Kontakte): ohne Meldewesen keine Felder für Sitzland und Region, keine Meldedaten-Anfrage", async () => {
    const api = spieleApi({ "/api/v1/me": NUR_KONTAKTE });
    const nutzer = userEvent.setup();
    rendereApp(`/organizations/${ORG_A}`);
    await nutzer.click(await screen.findByRole("button", { name: "Organisation bearbeiten" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Rechtsform")).toBeTruthy();
    expect(within(dialog).queryByLabelText(/Sitzland/)).toBeNull();
    expect(angefragt(api, "/meldedaten")).toBe(false);
  });

  it("Organisation mit allen Bereichen (globale Verwaltung) zeigt weiterhin alles", async () => {
    spieleApi();
    rendereApp(`/organizations/${ORG_A}`);
    await screen.findByRole("heading", { level: 1, name: "Alpha Energie" });
    for (const name of [/^Deals/, /^Beteiligungen/, /^Runden/, /^Dokumente/]) expect(hatEintrag(name)).toBe(true);
  });

  it("Beteiligung (Controlling): Dokumente, eigene Felder und Registerhinweise fehlen; Zinsen, Kennzahlen und Beleg bleiben", async () => {
    const api = spieleApi({ "/api/v1/me": CONTROLLING });
    const nutzer = userEvent.setup();
    rendereApp(`/investments/${BET_ID}`);
    expect(await screen.findByRole("heading", { level: 1, name: "Alpha Energie" })).toBeTruthy();
    expect(hatEintrag(/^Dokumente/)).toBe(false);
    expect(screen.queryByRole("link", { name: /Eigene Felder|Felder/ })).toBeNull();
    await nutzer.click(within(screen.getByRole("navigation", { name: /^(Hauptnavigation|Main navigation)$/ })).getByRole("link", { name: /^Finanzierung/ }));
    expect(await screen.findByRole("tab", { name: /^Zinsen/ })).toBeTruthy();
    await nutzer.click(within(screen.getByRole("navigation", { name: /^(Hauptnavigation|Main navigation)$/ })).getByRole("link", { name: /^Unternehmen/ }));
    expect(await screen.findByRole("tab", { name: /^Kennzahlen/ })).toBeTruthy();
    expect(angefragt(api, "/api/v1/documents")).toBe(false);
    await nutzer.click(await screen.findByRole("button", { name: /Weitere Aktionen/ }));
    expect(await screen.findByRole("menuitem", { name: "Beleg erzeugen" })).toBeTruthy();
  });

  it("Beteiligung (nur Portfolio): Zinsen, Kennzahlen, ESG, Quartalsbericht und Beleg fehlen", async () => {
    spieleApi({ "/api/v1/me": alsRolle("bearbeiter", { bereiche: ["portfolio"] }) });
    const nutzer = userEvent.setup();
    rendereApp(`/investments/${BET_ID}`);
    expect(await screen.findByRole("heading", { level: 1, name: "Alpha Energie" })).toBeTruthy();
    for (const name of [/^Dokumente/]) expect(hatEintrag(name)).toBe(false);
    await nutzer.click(within(screen.getByRole("navigation", { name: /^(Hauptnavigation|Main navigation)$/ })).getByRole("link", { name: /^Finanzierung/ }));
    expect(await screen.findByRole("tab", { name: /^Transaktionen/ })).toBeTruthy();
    for (const name of [/^Zinsen/, /^Kennzahlen/, /^ESG/, /^Förder/]) expect(hatEintrag(name)).toBe(false);
    expect(screen.queryByRole("link", { name: /Quartalsbericht/ })).toBeNull();
    await nutzer.click(await screen.findByRole("button", { name: /Weitere Aktionen/ }));
    expect(screen.queryByRole("menuitem", { name: "Beleg erzeugen" })).toBeNull();
  });

  it("Deal (Dealflow ohne Kontakte): Aufgaben, Termine, Verknüpft, Dokumente und Seitenpanel fehlen", async () => {
    const api = spieleApi({ "/api/v1/me": alsRolle("bearbeiter", { bereiche: ["dealflow"], stufeOhneFonds: "bearbeiter" }) });
    rendereApp(`/deals/${DEAL_ID}`);
    expect(await screen.findByRole("heading", { level: 1, name: "Alpha, Wachstum" })).toBeTruthy();
    expect(hatEintrag(/^Kontakte/)).toBe(true);
    for (const name of [/^Aufgaben/, /^Termine/, /^Verknüpft/, /^Dokumente/]) expect(hatEintrag(name)).toBe(false);
    expect(angefragt(api, "/api/v1/crm/")).toBe(false);
  });

  it("Fonds (nur Portfolio): Kennzahlen, ESG und Zinsen fehlen in der Leiste", async () => {
    spieleApi({ "/api/v1/me": alsRolle("bearbeiter", { bereiche: ["portfolio"] }) });
    rendereApp(`/funds/${FONDS_ID}`);
    await screen.findByRole("heading", { level: 1, name: "Beispielfonds I" });
    const leiste = await screen.findByRole("navigation", { name: "Hauptnavigation" });
    expect(within(leiste).getByRole("link", { name: /Planung/ })).toBeTruthy();
    for (const name of [/Kennzahlen/, /ESG/, /Zinsen/]) expect(within(leiste).queryByRole("link", { name })).toBeNull();
  });

  it("Fonds (Controlling): Kennzahlen und Zinsen stehen in der Leiste", async () => {
    spieleApi({ "/api/v1/me": CONTROLLING });
    rendereApp(`/funds/${FONDS_ID}`);
    await screen.findByRole("heading", { level: 1, name: "Beispielfonds I" });
    const leiste = await screen.findByRole("navigation", { name: "Hauptnavigation" });
    for (const name of [/Kennzahlen/, /Zinsen/]) expect(await within(leiste).findByRole("link", { name })).toBeTruthy();
  });

  it("Einstellungen (nur Portfolio): der Reiter Postfach fehlt, mit Kontakten ist er da", async () => {
    spieleApi({ "/api/v1/me": alsRolle("bearbeiter", { bereiche: ["portfolio"] }) });
    const ohne = rendereApp("/settings/mailbox");
    expect(await screen.findByRole("tab", { name: /Sicherheit/ })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: /Postfach/ })).toBeNull();
    ohne.unmount();
    spieleApi({ "/api/v1/me": NUR_KONTAKTE });
    rendereApp("/settings/mailbox");
    expect(await screen.findByRole("tab", { name: /Postfach/ })).toBeTruthy();
  });
});
