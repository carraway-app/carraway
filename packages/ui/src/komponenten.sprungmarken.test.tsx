import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SprungAbschnitt, Sprungmarken, Tabs } from "./index";

describe("Sprungmarken", () => {
  const marken = [
    { id: "captable", label: "Captable" },
    { id: "klassen", label: "Anteilsklassen", zaehler: 2 },
  ];
  function Seite({ onWahl }: { onWahl?: (id: string) => void }) {
    return (
      <>
        <Sprungmarken aria-label="Abschnitte" marken={marken} onWahl={onWahl} />
        <SprungAbschnitt id="captable" titel="Captable">Tabelle</SprungAbschnitt>
        <SprungAbschnitt id="klassen" titel="Anteilsklassen">Klassen</SprungAbschnitt>
      </>
    );
  }

  it("verlinkt jeden Abschnitt, markiert den ersten und springt mit Fokus", () => {
    const wahl = vi.fn();
    render(<Seite onWahl={wahl} />);
    const nav = screen.getByRole("navigation", { name: "Abschnitte" });
    const links = nav.querySelectorAll("a");
    expect(links).toHaveLength(2);
    expect(links[0]!.getAttribute("href")).toBe("#abschnitt-captable");
    expect(links[0]!.getAttribute("aria-current")).toBe("location");
    fireEvent.click(screen.getByRole("link", { name: /Anteilsklassen/ }));
    expect(wahl).toHaveBeenCalledWith("klassen");
    expect(document.activeElement?.id).toBe("abschnitt-klassen");
    expect(screen.getByRole("link", { name: /Anteilsklassen/ }).getAttribute("aria-current")).toBe("location");
    expect(screen.getByRole("region", { name: "Anteilsklassen" })).toBeTruthy();
  });

  it("zeigt bei nur einem Abschnitt keine Marken", () => {
    render(<Sprungmarken aria-label="Abschnitte" marken={[marken[0]!]} />);
    expect(screen.queryByRole("navigation")).toBeNull();
  });
});

describe("Tabs fest", () => {
  it("trägt die Klasse für die stehende Reiterleiste", () => {
    const { container } = render(<Tabs fest aria-label="Sichten" aktiv="a" onWechsel={() => {}} tabs={[{ id: "a", label: "Anteile" }, { id: "b", label: "Exit-Szenario" }]} />);
    expect(container.querySelector(".cw-tabs--fest")).not.toBeNull();
  });
});
