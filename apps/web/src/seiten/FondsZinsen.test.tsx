import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BET_ID, FONDS_ID, fondsZinsenDaten, rendereApp, spieleApi } from "../test/hilfen";

/** Fonds → Zinsen: Zinsen aller Instrumente des Fonds mit eigenem Stichtag, Summen und Verweis auf die Beteiligung. */

const url = `/fonds/${FONDS_ID}/zinsen`;
const zinsenUrl = `/api/v1/fonds/${FONDS_ID}/zinsen`;
const schmal = (text: string | null) => (text ?? "").replace(/\s/g, " ");

describe("Fonds → Zinsen", () => {
  it("zeigt Summenkacheln, je Instrument eine Zeile und die Summenzeile", async () => {
    spieleApi();
    rendereApp(url);
    const summe = await screen.findByRole("region", { name: "Summe" });
    expect(schmal(summe.textContent)).toContain("48.500 €");
    expect(schmal(summe.textContent)).toContain("25.000 €");
    const tabelle = await screen.findByRole("table");
    const zeilen = within(tabelle).getAllByRole("row");
    // Kopf, zwei Instrumente, Summe
    expect(zeilen).toHaveLength(4);
    expect(zeilen[1]!.textContent).toContain("Wandeldarlehen 2021");
    expect(zeilen[1]!.textContent).toContain("6,5");
    expect(zeilen[2]!.textContent).toContain("Darlehen 2024");
    expect(zeilen[3]!.textContent).toContain("Summe");
    expect(tabelle.querySelector("tfoot")).not.toBeNull();
    expect(tabelle.querySelector(".cw-fest")).not.toBeNull();
  });

  it("verlinkt das Unternehmen auf den Zinsen-Bereich der Beteiligung und die Zinsläufe", async () => {
    spieleApi();
    rendereApp(url);
    const link = await screen.findByRole("link", { name: "Zinsen der Beteiligung Alpha Energie öffnen" });
    const ziel = link.getAttribute("href") ?? "";
    expect(ziel).toContain(`/beteiligungen/${BET_ID}`);
    expect(ziel).toContain("unter=zinsen");
    expect(ziel).toContain("tab=finanzierung");
    expect(screen.getByRole("link", { name: "Zinsläufe" }).getAttribute("href")).toContain("/zinslaeufe");
  });

  it("fragt mit dem eigenen Stichtag der Seite ab", async () => {
    const api = spieleApi();
    rendereApp(url);
    await screen.findByRole("table");
    fireEvent.change(screen.getByLabelText("Stichtag"), { target: { value: "2026-06-30" } });
    await waitFor(() => expect(api.anfragen("GET", zinsenUrl).some((a) => a.query.get("stichtag") === "2026-06-30")).toBe(true));
  });

  it("zeigt einen Hinweis, wenn der Fonds kein Instrument mit Zinsen hat", async () => {
    spieleApi({ [zinsenUrl]: { koerper: { ...fondsZinsenDaten, instrumente: [], summe: { aufgelaufen: "0.00", gebucht: "0.00", kapitalisiert: "0.00", gezahlt: "0.00", gewandelt: "0.00", offen: "0.00" } } } });
    rendereApp(url);
    expect(await screen.findByText("Der Fonds hat kein Instrument mit Zinsen.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("zeigt Gewandelt als Spalte und Kachel nur, wenn Zinsen gewandelt wurden, und zählt sie nicht zu Offen", async () => {
    const eins = fondsZinsenDaten.instrumente[0]!;
    const gewandelt = { ...eins, status: "gewandelt", gewandelt: "5840.00", offen: "0.00", gezahlt: "0.00", gebucht: "5840.00", aufgelaufen: null as string | null, naechsteFaelligkeit: null as string | null };
    const daten = { ...fondsZinsenDaten, instrumente: [gewandelt], summe: { ...fondsZinsenDaten.summe, aufgelaufen: "0.00", gebucht: "5840.00", gezahlt: "0.00", gewandelt: "5840.00", offen: "0.00" } };
    spieleApi({ [zinsenUrl]: { koerper: daten } });
    rendereApp(url);
    const summe = await screen.findByRole("region", { name: "Summe" });
    expect(within(summe).getByText("Gewandelt")).toBeTruthy();
    expect(schmal(summe.textContent)).toContain("5.840 €");
    expect(within(await screen.findByRole("table")).getByRole("columnheader", { name: "Gewandelt" })).toBeTruthy();
  });

  it("blendet Gewandelt aus, wenn nichts gewandelt wurde", async () => {
    spieleApi();
    rendereApp(url);
    await screen.findByRole("table");
    expect(screen.queryByText("Gewandelt")).toBeNull();
  });
});
