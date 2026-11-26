import { createEvent, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { rendereApp, spieleApi } from "../test/hilfen";

const kopfNamen = (grid: HTMLElement) =>
  Array.from(grid.querySelectorAll<HTMLElement>(".app-gitter__kopf [data-kopf]")).map((k) => k.getAttribute("data-kopf")!);
const dialogListe = (dialog: HTMLElement, name: string) => within(dialog).getByRole("list", { name });
const dataTransfer = () => ({ setData: () => {}, setDragImage: () => {}, effectAllowed: "", dropEffect: "" });

describe("Spalten ordnen (Dialog und Tabellenkopf)", () => {
  async function oeffneDialog() {
    spieleApi();
    rendereApp("/kontakte");
    const nutzer = userEvent.setup();
    const grid = await screen.findByRole("grid", { name: "Unternehmen" });
    await nutzer.click(screen.getByRole("button", { name: "Spalten" }));
    const dialog = await screen.findByRole("dialog", { name: "Spalten" });
    return { nutzer, grid, dialog };
  }

  it("trennt Angezeigt und Ausgeblendet, ohne Pfeil-Knöpfe", async () => {
    const { dialog } = await oeffneDialog();
    expect(within(dialog).getByRole("heading", { name: "Angezeigt" })).toBeTruthy();
    expect(within(dialog).getByRole("heading", { name: "Ausgeblendet" })).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: /nach oben|nach unten/ })).toBeNull();
    const angezeigt = within(dialogListe(dialog, "Angezeigt")).getAllByRole("listitem");
    expect(angezeigt.length).toBeGreaterThan(2);
    // Jede angezeigte Zeile hat einen Ziehgriff und ein angehaktes Kontrollkästchen.
    for (const li of angezeigt) {
      expect(within(li).getByRole("button", { name: /^Spalte verschieben: / })).toBeTruthy();
      expect((within(li).getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
    }
  });

  it("ordnet per Tastatur mit Ansage und ändert die Spalten der Tabelle", async () => {
    const { grid, dialog } = await oeffneDialog();
    const vorher = kopfNamen(grid);
    const zweite = within(dialogListe(dialog, "Angezeigt")).getAllByRole("listitem")[1]!;
    const griff = within(zweite).getByRole("button", { name: /^Spalte verschieben: / });
    const name = griff.getAttribute("aria-label")!.replace("Spalte verschieben: ", "");
    fireEvent.keyDown(griff, { key: " " });
    expect(within(dialog).getByRole("status").textContent).toBe(`Spalte ${name}, Position 2 von ${vorher.length}, aufgenommen`);
    fireEvent.keyDown(griff, { key: "ArrowDown" });
    expect(within(dialog).getByRole("status").textContent).toBe(`Spalte ${name}, Position 3 von ${vorher.length}`);
    // Vor dem Ablegen bleibt die Tabelle unverändert.
    expect(kopfNamen(grid)).toEqual(vorher);
    fireEvent.keyDown(griff, { key: " " });
    expect(within(dialog).getByRole("status").textContent).toBe(`Spalte ${name} abgelegt, Position 3 von ${vorher.length}`);
    await waitFor(() => expect(kopfNamen(grid)).toEqual([vorher[0], vorher[2], vorher[1], ...vorher.slice(3)]));
  });

  it("blendet aus und ein: Einblenden hängt unten an, ausgeblendete stehen alphabetisch", async () => {
    const { nutzer, grid, dialog } = await oeffneDialog();
    const vorher = kopfNamen(grid);
    const ausgeblendet = () => within(dialogListe(dialog, "Ausgeblendet")).queryAllByRole("listitem").map((li) => li.textContent!);
    const zeile = within(dialogListe(dialog, "Angezeigt")).getAllByRole("listitem")[1]!;
    const anzeigename = zeile.textContent!;
    await nutzer.click(within(zeile).getByRole("checkbox"));
    await waitFor(() => expect(kopfNamen(grid)).toHaveLength(vorher.length - 1));
    expect(ausgeblendet()).toContain(anzeigename);
    const sortiert = [...ausgeblendet()].sort((a, b) => a.localeCompare(b));
    expect(ausgeblendet()).toEqual(sortiert);
    await nutzer.click(within(within(dialogListe(dialog, "Ausgeblendet")).getByText(anzeigename).closest("li")!).getByRole("checkbox"));
    await waitFor(() => expect(kopfNamen(grid)).toHaveLength(vorher.length));
    const angezeigt = within(dialogListe(dialog, "Angezeigt")).getAllByRole("listitem");
    expect(angezeigt.at(-1)!.textContent).toBe(anzeigename);
    expect(kopfNamen(grid).at(-1)).toBe(vorher[1]);
  });

  it("verschiebt Spalten im Tabellenkopf per Ziehen; die erste Spalte bleibt vorn", async () => {
    spieleApi();
    rendereApp("/kontakte");
    const grid = await screen.findByRole("grid", { name: "Unternehmen" });
    const vorher = kopfNamen(grid);
    const kopf = (k: string) => grid.querySelector<HTMLElement>(`.app-gitter__kopf [data-kopf="${k}"]`)!;
    expect(kopf(vorher[0]!).getAttribute("draggable")).toBeNull();
    expect(kopf(vorher[1]!).getAttribute("draggable")).toBe("true");
    const dt = dataTransfer();
    // Spalte 2 vor Spalte 4 (Zeigerposition links der Mitte).
    fireEvent.dragStart(kopf(vorher[1]!), { dataTransfer: dt });
    fireEvent.dragOver(kopf(vorher[3]!), { dataTransfer: dt });
    expect(kopf(vorher[3]!).getAttribute("data-einfuegen")).toBe("vor");
    fireEvent.drop(kopf(vorher[3]!), { dataTransfer: dt });
    await waitFor(() => expect(kopfNamen(grid)).toEqual([vorher[0], vorher[2], vorher[1], ...vorher.slice(3)]));
    expect(grid.parentElement!.querySelector(":scope > [role=status]")!.textContent).toContain("abgelegt");
    // Vor die erste Spalte lässt sich nichts ziehen: das Ziel wird auf Position 2 begrenzt, die Reihenfolge ändert sich nicht (Position 2 ist schon die Spalte).
    const jetzt = kopfNamen(grid);
    fireEvent.dragStart(kopf(jetzt[2]!), { dataTransfer: dt });
    fireEvent.dragOver(kopf(jetzt[0]!), { dataTransfer: dt });
    fireEvent.drop(kopf(jetzt[0]!), { dataTransfer: dt });
    await waitFor(() => expect(kopfNamen(grid)).toEqual([jetzt[0], jetzt[2], jetzt[1], ...jetzt.slice(3)]));
  });

  it("lässt den Breitengriff und das Sortieren unberührt", async () => {
    spieleApi();
    rendereApp("/kontakte");
    const nutzer = userEvent.setup();
    const grid = await screen.findByRole("grid", { name: "Unternehmen" });
    const namen = kopfNamen(grid);
    const griff = within(grid.querySelector<HTMLElement>(`.app-gitter__kopf [data-kopf="${namen[1]}"]`)!).getByRole("separator");
    // Der Griff beginnt keine Spaltenbewegung: dragstart wird abgebrochen, solange er gezogen wird.
    fireEvent.pointerDown(griff, { clientX: 100 });
    const start = createEvent.dragStart(grid.querySelector<HTMLElement>(`.app-gitter__kopf [data-kopf="${namen[1]}"]`)!, { dataTransfer: dataTransfer() });
    fireEvent(grid.querySelector<HTMLElement>(`.app-gitter__kopf [data-kopf="${namen[1]}"]`)!, start);
    expect(start.defaultPrevented).toBe(true);
    fireEvent.pointerUp(window);
    // Pfeiltasten am Griff ändern weiter die Breite, Alt+Pfeil verschiebt die Spalte.
    const breite = Number(griff.getAttribute("aria-valuenow"));
    griff.focus();
    await nutzer.keyboard("{ArrowRight}");
    await waitFor(() => expect(Number(griff.getAttribute("aria-valuenow"))).toBe(breite + 16));
    await nutzer.keyboard("{Alt>}{ArrowRight}{/Alt}");
    await waitFor(() => expect(kopfNamen(grid)).toEqual([namen[0], namen[2], namen[1], ...namen.slice(3)]));
    expect(grid.parentElement!.querySelector(":scope > [role=status]")!.textContent).toContain("Position 3 von");
    // Sortieren per Klick bleibt.
    await nutzer.click(within(grid.querySelector<HTMLElement>(`.app-gitter__kopf [data-kopf="${namen[0]}"]`)!).getByRole("button"));
    await waitFor(() => expect(grid.querySelector(`.app-gitter__kopf [data-kopf="${namen[0]}"]`)!.getAttribute("aria-sort")).toBe("ascending"));
  });
});
