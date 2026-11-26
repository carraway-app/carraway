import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { BET_ID, DEAL_ID, FONDS_ID, ORG_A, alsRolle, rendereApp, spieleApi } from "../test/hilfen";

/** Demo-Rollen des Rechtemodells (`packages/db/src/demo/zugaenge.ts`) als Antwort von `/ich`. */
const NUR_KONTAKTE = alsRolle("bearbeiter", { bereiche: ["kontakte"], stufeOhneFonds: "bearbeiter" });
const CONTROLLING = alsRolle("bearbeiter", { bereiche: ["portfolio", "finanzen", "berichte", "meldewesen", "kennzahlen"] });

const hatEintrag = (name: RegExp) => screen.queryByRole("button", { name }) !== null;
const angefragt = (api: ReturnType<typeof spieleApi>, teil: string) => api.aufrufe.some((a) => a.pfad.includes(teil));

describe("Bereiche in der Oberfläche", () => {
  it("Organisation (nur Kontakte): Deals, Beteiligungen, Runden und Dokumente fehlen, es gibt keine Anfrage und keinen 403", async () => {
    const api = spieleApi({ "/api/v1/ich": NUR_KONTAKTE });
    rendereApp(`/organisationen/${ORG_A}`);
    expect(await screen.findByRole("heading", { level: 1, name: "Alpha Energie" })).toBeTruthy();
    expect(hatEintrag(/^Kontakte/)).toBe(true);
    expect(hatEintrag(/^Aufgaben/)).toBe(true);
    for (const name of [/^Deals/, /^Beteiligungen/, /^Runden/, /^Dokumente/]) expect(hatEintrag(name)).toBe(false);
    expect(angefragt(api, "/finanzierungsrunden")).toBe(false);
    expect(angefragt(api, "/meldedaten")).toBe(false);
    expect(angefragt(api, "/api/v1/dokumente")).toBe(false);
  });

  it("Organisation (nur Kontakte): ?tab=runden fällt auf den ersten Eintrag zurück", async () => {
    const api = spieleApi({ "/api/v1/ich": NUR_KONTAKTE });
    rendereApp(`/organisationen/${ORG_A}?tab=runden`);
    expect(await screen.findByRole("region", { name: "Kontakte des Unternehmens" })).toBeTruthy();
    expect(angefragt(api, "/finanzierungsrunden")).toBe(false);
  });

  it("Organisation bearbeiten (nur Kontakte): ohne Meldewesen keine Felder für Sitzland und Region, keine Meldedaten-Anfrage", async () => {
    const api = spieleApi({ "/api/v1/ich": NUR_KONTAKTE });
    const nutzer = userEvent.setup();
    rendereApp(`/organisationen/${ORG_A}`);
    await nutzer.click(await screen.findByRole("button", { name: "Organisation bearbeiten" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Rechtsform")).toBeTruthy();
    expect(within(dialog).queryByLabelText(/Sitzland/)).toBeNull();
    expect(angefragt(api, "/meldedaten")).toBe(false);
  });

  it("Organisation mit allen Bereichen (globale Verwaltung) zeigt weiterhin alles", async () => {
    spieleApi();
    rendereApp(`/organisationen/${ORG_A}`);
    await screen.findByRole("heading", { level: 1, name: "Alpha Energie" });
    for (const name of [/^Deals/, /^Beteiligungen/, /^Runden/, /^Dokumente/]) expect(hatEintrag(name)).toBe(true);
  });

  it("Beteiligung (Controlling): Dokumente, eigene Felder und Registerhinweise fehlen; Zinsen, Kennzahlen und Beleg bleiben", async () => {
    const api = spieleApi({ "/api/v1/ich": CONTROLLING });
    const nutzer = userEvent.setup();
    rendereApp(`/beteiligungen/${BET_ID}`);
    expect(await screen.findByRole("heading", { level: 1, name: "Alpha Energie" })).toBeTruthy();
    expect(hatEintrag(/^Dokumente/)).toBe(false);
    expect(screen.queryByRole("button", { name: /Eigene Felder|Felder/ })).toBeNull();
    expect(hatEintrag(/^Zinsen/)).toBe(true);
    expect(hatEintrag(/^Kennzahlen/)).toBe(true);
    expect(angefragt(api, "/api/v1/dokumente")).toBe(false);
    await nutzer.click(await screen.findByRole("button", { name: /Weitere Aktionen/ }));
    expect(await screen.findByRole("menuitem", { name: "Beleg erzeugen" })).toBeTruthy();
  });

  it("Beteiligung (nur Portfolio): Zinsen, Kennzahlen, ESG, Quartalsbericht und Beleg fehlen", async () => {
    spieleApi({ "/api/v1/ich": alsRolle("bearbeiter", { bereiche: ["portfolio"] }) });
    const nutzer = userEvent.setup();
    rendereApp(`/beteiligungen/${BET_ID}`);
    expect(await screen.findByRole("heading", { level: 1, name: "Alpha Energie" })).toBeTruthy();
    for (const name of [/^Zinsen/, /^Kennzahlen/, /^ESG/, /^Dokumente/, /^Förder/]) expect(hatEintrag(name)).toBe(false);
    expect(screen.queryByRole("link", { name: /Quartalsbericht/ })).toBeNull();
    await nutzer.click(await screen.findByRole("button", { name: /Weitere Aktionen/ }));
    expect(screen.queryByRole("menuitem", { name: "Beleg erzeugen" })).toBeNull();
  });

  it("Deal (Dealflow ohne Kontakte): Aufgaben, Termine, Verknüpft, Dokumente und Seitenpanel fehlen", async () => {
    const api = spieleApi({ "/api/v1/ich": alsRolle("bearbeiter", { bereiche: ["dealflow"], stufeOhneFonds: "bearbeiter" }) });
    rendereApp(`/deals/${DEAL_ID}`);
    expect(await screen.findByRole("heading", { level: 1, name: "Alpha, Wachstum" })).toBeTruthy();
    expect(hatEintrag(/^Kontakte/)).toBe(true);
    for (const name of [/^Aufgaben/, /^Termine/, /^Verknüpft/, /^Dokumente/]) expect(hatEintrag(name)).toBe(false);
    expect(angefragt(api, "/api/v1/crm/")).toBe(false);
  });

  it("Fonds (nur Portfolio): Kennzahlen, ESG und Zinsen fehlen im Verzeichnis", async () => {
    spieleApi({ "/api/v1/ich": alsRolle("bearbeiter", { bereiche: ["portfolio"] }) });
    rendereApp(`/fonds/${FONDS_ID}`);
    await screen.findByRole("heading", { level: 1, name: "Beispielfonds I" });
    const verzeichnis = await screen.findByRole("navigation", { name: "Bereiche des Portfolios" });
    expect(within(verzeichnis).getByRole("button", { name: /Szenarien/ })).toBeTruthy();
    for (const name of [/Kennzahlen/, /ESG/, /Zinsen/]) expect(within(verzeichnis).queryByRole("button", { name })).toBeNull();
  });

  it("Fonds (Controlling): Kennzahlen, ESG und Zinsen stehen im Verzeichnis", async () => {
    spieleApi({ "/api/v1/ich": CONTROLLING });
    rendereApp(`/fonds/${FONDS_ID}`);
    await screen.findByRole("heading", { level: 1, name: "Beispielfonds I" });
    const verzeichnis = await screen.findByRole("navigation", { name: "Bereiche des Portfolios" });
    for (const name of [/Kennzahlen/, /Zinsen/]) expect(await within(verzeichnis).findByRole("button", { name })).toBeTruthy();
  });

  it("Einstellungen (nur Portfolio): der Reiter Postfach fehlt, mit Kontakten ist er da", async () => {
    spieleApi({ "/api/v1/ich": alsRolle("bearbeiter", { bereiche: ["portfolio"] }) });
    const ohne = rendereApp("/einstellungen/postfach");
    expect(await screen.findByRole("tab", { name: /Sicherheit/ })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: /Postfach/ })).toBeNull();
    ohne.unmount();
    spieleApi({ "/api/v1/ich": NUR_KONTAKTE });
    rendereApp("/einstellungen/postfach");
    expect(await screen.findByRole("tab", { name: /Postfach/ })).toBeTruthy();
  });
});
