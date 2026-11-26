import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Fakten, Feld, Karte, KartenRaster, Leer, Popover } from "./index";

describe("Karte und Kartenraster", () => {
  it("benennt die Gruppe nach dem Titel und zeigt die Aktion im Kopf", () => {
    render(
      <KartenRaster>
        <Karte titel="Konditionen" aktion={<button>Neue Version</button>}>
          <p>Inhalt</p>
        </Karte>
      </KartenRaster>,
    );
    const gruppe = screen.getByRole("group", { name: "Konditionen" });
    expect(gruppe.querySelector("h2")?.textContent).toBe("Konditionen");
    expect(gruppe.querySelector(".cw-karte__aktion button")?.textContent).toBe("Neue Version");
    expect(gruppe.textContent).toContain("Inhalt");
  });

  it("nimmt die Überschriftenebene 3 und die volle Breite", () => {
    render(<Karte titel="Teil" ebene={3} breit />);
    expect(screen.getByRole("heading", { level: 3, name: "Teil" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Teil" }).className).toContain("cw-karte--breit");
  });
});

describe("Popover", () => {
  it("öffnet und schließt per Klick, Escape und Klick daneben; der Fokus kehrt zurück", () => {
    render(
      <div>
        <button>außen</button>
        <Popover aria-label="Wissensstand" ausloeser="Wissensstand">
          <input aria-label="Zeitpunkt" />
        </Popover>
      </div>,
    );
    const knopf = screen.getByRole("button", { name: "Wissensstand" });
    expect(knopf.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("group", { name: "Wissensstand" })).toBeNull();
    fireEvent.click(knopf);
    expect(knopf.getAttribute("aria-expanded")).toBe("true");
    expect(knopf.getAttribute("aria-controls")).toBe(screen.getByRole("group", { name: "Wissensstand" }).id);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("group", { name: "Wissensstand" })).toBeNull();
    expect(document.activeElement).toBe(knopf);
    fireEvent.click(knopf);
    fireEvent.mouseDown(screen.getByRole("button", { name: "außen" }));
    expect(screen.queryByRole("group", { name: "Wissensstand" })).toBeNull();
  });

  it("markiert einen gesetzten Wert am Auslöser", () => {
    render(
      <Popover aria-label="Filter" ausloeser="Filter" aktiv>
        <span>x</span>
      </Popover>,
    );
    expect(screen.getByRole("button", { name: "Filter" }).getAttribute("data-aktiv")).toBe("true");
  });
});

describe("Feld: kompakt und Beschriftung versteckt", () => {
  it("behält die Beschriftung für Screenreader, zeigt sie aber nicht", () => {
    render(<Feld label="Stichtag" type="date" kompakt labelVersteckt />);
    const eingabe = screen.getByLabelText("Stichtag");
    expect(eingabe.closest(".cw-feld")?.className).toContain("cw-feld--kompakt");
    expect(screen.getByText("Stichtag").className).toContain("cw-nur-lesen");
  });
});

describe("Leer kompakt und Fakten als Liste", () => {
  it("zeigt den Leer-Zustand in einer Zeile mit der Aktion am Ende", () => {
    const { container } = render(<Leer kompakt beschreibung="Noch nicht erfasst: Konditionen" aktion={<button>erfassen</button>} />);
    expect(container.querySelector(".cw-leer--zeile")).not.toBeNull();
    expect(container.querySelector(".cw-leer__kachel")).toBeNull();
    expect(screen.getByRole("button", { name: "erfassen" })).toBeTruthy();
  });

  it("Fakten tragen die Darstellung als Klasse", () => {
    const { container } = render(<Fakten darstellung="liste" eintraege={[{ label: "Sektor", wert: "Energie" }]} />);
    expect(container.querySelector("dl")?.className).toContain("cw-fakten--liste");
  });
});
