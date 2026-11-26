import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Tabelle, type TabelleSpalte } from "./index";

interface Zeile {
  id: number;
  name: string;
  betrag: string;
}
const zeilen: Zeile[] = [
  { id: 1, name: "Alpha", betrag: "10,00" },
  { id: 2, name: "Beta", betrag: "5,50" },
];
const spalten: TabelleSpalte<Zeile>[] = [
  { schluessel: "name", kopf: "Name", zelle: (z) => z.name },
  { schluessel: "betrag", kopf: "Betrag", zahl: true, zelle: (z) => z.betrag },
];

describe("Tabelle: Summenzeile", () => {
  it("setzt die Fußzeile als tfoot mit Zeilenkopf in der ersten Zelle und rechtsbündigen Zahlenzellen", () => {
    render(<Tabelle dicht beschriftung="Posten" spalten={spalten} zeilen={zeilen} zeilenSchluessel={(z) => z.id} fusszeile={{ name: "Summe", betrag: "15,50" }} />);
    const tabelle = screen.getByRole("table");
    const fuss = tabelle.querySelector("tfoot")!;
    expect(fuss).toBeTruthy();
    const kopf = within(fuss).getByRole("rowheader", { name: "Summe" });
    expect(kopf.getAttribute("scope")).toBe("row");
    const zahl = within(fuss).getByRole("cell", { name: "15,50" });
    expect(zahl.className).toContain("cw-zahl");
    // Die Fußzeile steht nach dem Körper.
    expect(tabelle.lastElementChild).toBe(fuss);
  });

  it("lässt die Fußzeile ohne Angabe, ohne Zeilen und beim Laden weg und ergänzt die Aktionsspalte leer", () => {
    const { rerender } = render(<Tabelle beschriftung="Posten" spalten={spalten} zeilen={zeilen} zeilenSchluessel={(z) => z.id} />);
    expect(document.querySelector("tfoot")).toBeNull();
    rerender(<Tabelle beschriftung="Posten" spalten={spalten} zeilen={[]} zeilenSchluessel={(z) => z.id} fusszeile={{ name: "Summe" }} />);
    expect(document.querySelector("tfoot")).toBeNull();
    rerender(<Tabelle laedt beschriftung="Posten" spalten={spalten} zeilen={zeilen} zeilenSchluessel={(z) => z.id} fusszeile={{ name: "Summe" }} />);
    expect(document.querySelector("tfoot")).toBeNull();
    rerender(<Tabelle beschriftung="Posten" spalten={spalten} zeilen={zeilen} zeilenSchluessel={(z) => z.id} aktionen={() => []} fusszeile={{ name: "Summe" }} />);
    expect(document.querySelectorAll("tfoot tr > *")).toHaveLength(3);
  });
});

describe("Tabelle: feste Spalten und Umbruch", () => {
  const alle = (tabelle: HTMLElement) => Array.from(tabelle.querySelectorAll("th, td"));
  it("fixiert standardmäßig die erste Spalte in Kopf, Körper und Fußzeile", () => {
    render(<Tabelle beschriftung="Posten" spalten={spalten} zeilen={zeilen} zeilenSchluessel={(z) => z.id} fusszeile={{ name: "Summe", betrag: "15,50" }} />);
    const tabelle = screen.getByRole("table");
    const fest = alle(tabelle).filter((c) => c.classList.contains("cw-fest"));
    // Kopf, zwei Zeilen, Fußzeile
    expect(fest).toHaveLength(4);
    expect(fest.every((c) => c.classList.contains("cw-fest--kante"))).toBe(true);
    expect(tabelle.className).not.toContain("cw-tabelle--fest-2");
  });
  it("festeSpalten={0} schaltet ab, 2 fixiert zwei Spalten", () => {
    const { unmount } = render(<Tabelle beschriftung="A" spalten={spalten} zeilen={zeilen} zeilenSchluessel={(z) => z.id} festeSpalten={0} />);
    expect(document.querySelector(".cw-fest")).toBeNull();
    unmount();
    render(<Tabelle beschriftung="B" spalten={spalten} zeilen={zeilen} zeilenSchluessel={(z) => z.id} festeSpalten={2} />);
    const tabelle = screen.getByRole("table");
    expect(tabelle.className).toContain("cw-tabelle--fest-2");
    const zeile = tabelle.querySelector("tbody tr")!;
    expect(zeile.children[0]!.className).toContain("cw-fest");
    expect(zeile.children[0]!.className).not.toContain("cw-fest--kante");
    expect(zeile.children[1]!.className).toContain("cw-fest--zweite");
    expect(zeile.children[1]!.className).toContain("cw-fest--kante");
  });
  it("umbruch markiert Kopf und Zellen der Spalte", () => {
    render(<Tabelle beschriftung="C" spalten={[...spalten, { schluessel: "bem", kopf: "Bemerkung", umbruch: true, zelle: () => "Text" }]} zeilen={zeilen} zeilenSchluessel={(z) => z.id} />);
    expect(screen.getByRole("columnheader", { name: "Bemerkung" }).className).toContain("cw-tabelle__umbruch");
    expect(screen.getAllByRole("cell", { name: "Text" })[0]!.className).toContain("cw-tabelle__umbruch");
    expect(screen.getByRole("columnheader", { name: "Betrag" }).className).not.toContain("cw-tabelle__umbruch");
  });
});
