import { useState } from "react";
import { createEvent, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SortierbareListe, type SortierbareListeTexte } from "./index";

const texte: SortierbareListeTexte = {
  griff: (n) => `Verschieben: ${n}`,
  hinweis: "Leertaste nimmt auf",
  aufgenommen: (n, nr, von) => `${n} aufgenommen, ${nr} von ${von}`,
  verschoben: (n, nr, von) => `${n}, Position ${nr} von ${von}`,
  abgelegt: (n, nr, von) => `${n} abgelegt, ${nr} von ${von}`,
  abgebrochen: (n) => `${n} abgebrochen`,
};
const start = ["Name", "Ort", "Land", "Branche"];

function Beispiel({ onAendern }: { onAendern?: (neu: string[]) => void }) {
  const [liste, setListe] = useState(start);
  return (
    <SortierbareListe
      aria-label="Angezeigt"
      eintraege={liste}
      schluessel={(e) => e}
      name={(e) => e}
      zeile={(e) => <span>{e}</span>}
      texte={texte}
      onAendern={(neu) => {
        onAendern?.(neu);
        setListe(neu);
      }}
    />
  );
}
const reihenfolge = () => within(screen.getByRole("list", { name: "Angezeigt" })).getAllByRole("listitem").map((li) => li.textContent);
const griff = (n: string) => screen.getByRole("button", { name: `Verschieben: ${n}` });
const meldung = () => screen.getByRole("status").textContent;

describe("SortierbareListe", () => {
  it("ordnet per Tastatur: Leertaste nimmt auf, Pfeiltasten verschieben, Leertaste legt ab", () => {
    const geaendert = vi.fn();
    render(<Beispiel onAendern={geaendert} />);
    fireEvent.keyDown(griff("Ort"), { key: " " });
    expect(meldung()).toBe("Ort aufgenommen, 2 von 4");
    expect(griff("Ort").getAttribute("aria-pressed")).toBe("true");
    fireEvent.keyDown(griff("Ort"), { key: "ArrowDown" });
    expect(meldung()).toBe("Ort, Position 3 von 4");
    expect(reihenfolge()).toEqual(["Name", "Land", "Ort", "Branche"]);
    // Erst das Ablegen meldet die neue Reihenfolge nach außen.
    expect(geaendert).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(griff("Ort"));
    fireEvent.keyDown(griff("Ort"), { key: " " });
    expect(geaendert).toHaveBeenCalledExactlyOnceWith(["Name", "Land", "Ort", "Branche"]);
    expect(meldung()).toBe("Ort abgelegt, 3 von 4");
    expect(griff("Ort").getAttribute("aria-pressed")).toBe("false");
  });

  it("begrenzt an den Enden, kennt Pos1 und Ende und bricht mit Escape ab", () => {
    const geaendert = vi.fn();
    render(<Beispiel onAendern={geaendert} />);
    fireEvent.keyDown(griff("Name"), { key: " " });
    fireEvent.keyDown(griff("Name"), { key: "ArrowUp" });
    expect(reihenfolge()[0]).toBe("Name");
    fireEvent.keyDown(griff("Name"), { key: "End" });
    expect(reihenfolge()).toEqual(["Ort", "Land", "Branche", "Name"]);
    fireEvent.keyDown(griff("Name"), { key: "Home" });
    fireEvent.keyDown(griff("Name"), { key: "ArrowDown" });
    expect(reihenfolge()).toEqual(["Ort", "Name", "Land", "Branche"]);
    // fireEvent liefert false, wenn die Taste verbraucht wurde (ein Dialog darüber bleibt dann offen).
    expect(fireEvent.keyDown(griff("Name"), { key: "Escape" })).toBe(false);
    expect(meldung()).toBe("Name abgebrochen");
    expect(reihenfolge()).toEqual(start);
    expect(geaendert).not.toHaveBeenCalled();
  });

  it("meldet nichts, wenn die Zeile an ihrer Stelle abgelegt wird", () => {
    const geaendert = vi.fn();
    render(<Beispiel onAendern={geaendert} />);
    fireEvent.keyDown(griff("Land"), { key: " " });
    fireEvent.keyDown(griff("Land"), { key: " " });
    expect(geaendert).not.toHaveBeenCalled();
  });

  it("ordnet per Ziehen am Griff: Einfügelinie an der Zielposition, Ablegen ändert die Reihenfolge", () => {
    const geaendert = vi.fn();
    render(<Beispiel onAendern={geaendert} />);
    const zeilen = screen.getAllByRole("listitem");
    const dataTransfer = { setData: vi.fn(), setDragImage: vi.fn(), effectAllowed: "", dropEffect: "" };
    fireEvent.dragStart(griff("Name"), { dataTransfer });
    expect(zeilen[0]!.hasAttribute("data-gezogen")).toBe(true);
    // jsdom misst 0 × 0: ohne Zeigerposition gilt die obere Hälfte (Linie vor „Branche“), mit clientY darunter die untere (Linie dahinter).
    fireEvent.dragOver(zeilen[3]!, { dataTransfer });
    expect(zeilen[3]!.getAttribute("data-einfuegen")).toBe("vor");
    const unten = createEvent.dragOver(zeilen[3]!, { dataTransfer });
    Object.defineProperty(unten, "clientY", { value: 10 });
    fireEvent(zeilen[3]!, unten);
    expect(zeilen[3]!.getAttribute("data-einfuegen")).toBe("nach");
    fireEvent.drop(zeilen[3]!, { dataTransfer });
    expect(geaendert).toHaveBeenCalledExactlyOnceWith(["Ort", "Land", "Branche", "Name"]);
    expect(meldung()).toBe("Name abgelegt, 4 von 4");
    expect(screen.getAllByRole("listitem").some((li) => li.hasAttribute("data-gezogen") || li.hasAttribute("data-einfuegen"))).toBe(false);
  });

  it("zeigt direkt neben der gezogenen Zeile keine Linie und ändert dort nichts", () => {
    const geaendert = vi.fn();
    render(<Beispiel onAendern={geaendert} />);
    const zeilen = screen.getAllByRole("listitem");
    const dataTransfer = { setData: vi.fn(), setDragImage: vi.fn(), effectAllowed: "", dropEffect: "" };
    fireEvent.dragStart(griff("Ort"), { dataTransfer });
    fireEvent.dragOver(zeilen[2]!, { dataTransfer });
    expect(zeilen[2]!.hasAttribute("data-einfuegen")).toBe(false);
    fireEvent.drop(zeilen[2]!, { dataTransfer });
    expect(geaendert).not.toHaveBeenCalled();
  });
});
