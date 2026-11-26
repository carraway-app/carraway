import { lazy, useState, type ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Inhaltsverzeichnis, UiSprache, type VerzeichnisGruppe } from "./index";

const gruppen = (inhalt: (id: string) => () => ReactNode = (id) => () => <p>Inhalt {id}</p>): VerzeichnisGruppe[] => [
  { id: "position", label: "Position", eintraege: [{ id: "uebersicht", label: "Übersicht", inhalt: inhalt("uebersicht") }, { id: "transaktionen", label: "Transaktionen", inhalt: inhalt("transaktionen") }] },
  { id: "kapital", label: "Kapital", eintraege: [{ id: "runden", label: "Finanzierungsrunden", zaehler: 2, inhalt: inhalt("runden") }, { id: "exit", label: "Exit-Szenario", deaktiviert: true, inhalt: inhalt("exit") }] },
  { id: "leer", label: "Leer", eintraege: [] },
  { id: "lose", eintraege: [{ id: "notizen", label: "Notizen", inhalt: inhalt("notizen") }] },
];

function Gesteuert({ start = "uebersicht", onWechsel }: { start?: string; onWechsel?: (id: string) => void }) {
  const [aktiv, setAktiv] = useState(start);
  return (
    <UiSprache sprache="de">
      <Inhaltsverzeichnis
        aria-label="Bereiche"
        gruppen={gruppen()}
        aktiv={aktiv}
        onWechsel={(id) => {
          onWechsel?.(id);
          setAktiv(id);
        }}
      />
    </UiSprache>
  );
}

describe("Inhaltsverzeichnis", () => {
  it("rendert Gruppen als Listen in einer Navigation, ohne Tablist, und blendet leere Gruppen aus", () => {
    render(<Gesteuert />);
    const nav = screen.getByRole("navigation", { name: "Bereiche" });
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(within(nav).getAllByRole("list")).toHaveLength(3);
    expect(within(nav).getByText("Position")).toBeTruthy();
    expect(within(nav).queryByText("Leer")).toBeNull();
    // Gruppe ohne Beschriftung: Einträge ohne Kopf
    expect(within(nav).getByRole("button", { name: "Notizen" })).toBeTruthy();
    expect(within(nav).getByRole("list", { name: "Position" })).toBeTruthy();
  });

  it("markiert den aktiven Eintrag mit aria-current und zeigt Zähler", () => {
    render(<Gesteuert />);
    expect(screen.getByRole("button", { name: "Übersicht" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name: "Transaktionen" }).getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("button", { name: /Finanzierungsrunden/ }).textContent).toContain("2");
  });

  it("zeigt genau den Inhalt des aktiven Eintrags in einem benannten Bereich", () => {
    render(<Gesteuert />);
    const bereich = screen.getByRole("region", { name: "Übersicht" });
    expect(bereich.getAttribute("tabindex")).toBe("-1");
    expect(within(bereich).getByText("Inhalt uebersicht")).toBeTruthy();
    expect(screen.queryByText("Inhalt transaktionen")).toBeNull();
  });

  it("baut Inhalte träge: nur der aktive Eintrag wird aufgerufen", () => {
    const gebaut: string[] = [];
    render(
      <UiSprache sprache="de">
        <Inhaltsverzeichnis aria-label="Bereiche" gruppen={gruppen((id) => () => (gebaut.push(id), <p>x</p>))} aktiv="runden" onWechsel={() => {}} />
      </UiSprache>,
    );
    expect(new Set(gebaut)).toEqual(new Set(["runden"]));
  });

  it("hat eine eigene Suspense-Grenze: das Verzeichnis bleibt beim Laden stehen", async () => {
    let fertig: () => void = () => {};
    const Traege = lazy(() => new Promise<{ default: () => ReactNode }>((ok) => (fertig = () => ok({ default: () => <p>geladen</p> }))));
    render(
      <UiSprache sprache="de">
        <Inhaltsverzeichnis aria-label="Bereiche" gruppen={[{ id: "g", eintraege: [{ id: "a", label: "Alpha", inhalt: () => <Traege /> }] }]} aktiv="a" onWechsel={() => {}} />
      </UiSprache>,
    );
    expect(screen.getByRole("button", { name: "Alpha" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Wird geladen");
    await act(async () => fertig());
    await waitFor(() => expect(screen.getByText("geladen")).toBeTruthy());
  });

  it("Wechsel ruft onWechsel; der aktive Eintrag löst nichts aus; Fokus geht auf den Inhalt, nicht beim ersten Rendern", () => {
    const onWechsel = vi.fn();
    render(<Gesteuert onWechsel={onWechsel} />);
    expect(document.activeElement).toBe(document.body);
    fireEvent.click(screen.getByRole("button", { name: "Übersicht" }));
    expect(onWechsel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Transaktionen" }));
    expect(onWechsel).toHaveBeenCalledWith("transaktionen");
    expect(screen.getByRole("button", { name: "Transaktionen" }).getAttribute("aria-current")).toBe("page");
    expect(document.activeElement).toBe(screen.getByRole("region", { name: "Transaktionen" }));
  });

  it("ändert sich der Eintrag von außen (Adresse), bleibt der Fokus stehen", () => {
    const { rerender } = render(
      <UiSprache sprache="de">
        <Inhaltsverzeichnis aria-label="Bereiche" gruppen={gruppen()} aktiv="uebersicht" onWechsel={() => {}} />
      </UiSprache>,
    );
    rerender(
      <UiSprache sprache="de">
        <Inhaltsverzeichnis aria-label="Bereiche" gruppen={gruppen()} aktiv="transaktionen" onWechsel={() => {}} />
      </UiSprache>,
    );
    expect(document.activeElement).toBe(document.body);
  });

  it("deaktivierte Einträge sind nicht wählbar", () => {
    const onWechsel = vi.fn();
    render(<Gesteuert onWechsel={onWechsel} />);
    const exit = screen.getByRole("button", { name: "Exit-Szenario" });
    expect((exit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(exit);
    expect(onWechsel).not.toHaveBeenCalled();
  });

  it("schmale Darstellung: Knopf „Bereich: Name“ klappt die Liste auf und nach der Wahl zu", () => {
    render(<Gesteuert />);
    const knopf = screen.getByRole("button", { name: "Bereich: Übersicht" });
    expect(knopf.getAttribute("aria-expanded")).toBe("false");
    expect(knopf.getAttribute("aria-controls")).toBe(screen.getByRole("navigation", { name: "Bereiche" }).id);
    fireEvent.click(knopf);
    expect(knopf.getAttribute("aria-expanded")).toBe("true");
    expect(knopf.parentElement?.getAttribute("data-offen")).toBe("ja");
    fireEvent.click(screen.getByRole("button", { name: "Transaktionen" }));
    const neu = screen.getByRole("button", { name: "Bereich: Transaktionen" });
    expect(neu.getAttribute("aria-expanded")).toBe("false");
  });

  it("englische Beschriftung", () => {
    render(
      <UiSprache sprache="en">
        <Inhaltsverzeichnis aria-label="Sections" gruppen={gruppen()} aktiv="uebersicht" onWechsel={() => {}} />
      </UiSprache>,
    );
    expect(screen.getByRole("button", { name: "Section: Übersicht" })).toBeTruthy();
  });

});
