import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Menue, MenueSegment, THEMA_SCHLUESSEL, aktuellesThema, aktualisiereBrowserfarbe, gespeichertesThema, setzeThema, useThema, type Thema } from "./index";

beforeEach(() => {
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.classList.remove("cw-thema-wechsel");
  document.head.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove());
  document.documentElement.style.removeProperty("--cw-bg");
});
afterEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

describe("Thema: Merkzettel und Anwendung", () => {
  it("ohne Wert, mit unbekanntem Wert und bei gesperrtem Speicher gilt system", () => {
    expect(gespeichertesThema()).toBe("system");
    localStorage.setItem(THEMA_SCHLUESSEL, "lila");
    expect(gespeichertesThema()).toBe("system");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("gesperrt");
    });
    expect(gespeichertesThema()).toBe("system");
    vi.restoreAllMocks();
  });

  it("setzt data-theme sofort, merkt den Wert und meldet Hörer; ohne Attribut gilt wie im CSS dunkel", () => {
    expect(aktuellesThema()).toBe("dunkel");
    for (const thema of ["hell", "dunkel", "system"] as Thema[]) {
      setzeThema(thema);
      expect(document.documentElement.dataset.theme).toBe(thema);
      expect(aktuellesThema()).toBe(thema);
      expect(localStorage.getItem(THEMA_SCHLUESSEL)).toBe(thema);
      expect(gespeichertesThema()).toBe(thema);
    }
  });

  it("merken: false lässt den Browserspeicher unberührt; gesperrter Speicher bricht die Anwendung nicht ab", () => {
    setzeThema("hell", false);
    expect(document.documentElement.dataset.theme).toBe("hell");
    expect(localStorage.getItem(THEMA_SCHLUESSEL)).toBeNull();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("gesperrt");
    });
    expect(() => setzeThema("dunkel")).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe("dunkel");
    vi.restoreAllMocks();
  });

  it("der Farbübergang gilt nur kurz (Klasse am Wurzelelement, die CSS nur ohne reduzierte Bewegung nutzt)", () => {
    vi.useFakeTimers();
    setzeThema("hell");
    expect(document.documentElement.classList.contains("cw-thema-wechsel")).toBe(true);
    vi.advanceTimersByTime(300);
    expect(document.documentElement.classList.contains("cw-thema-wechsel")).toBe(false);
  });

  it("die Browserleiste übernimmt --cw-bg des gültigen Themas", () => {
    document.documentElement.style.setProperty("--cw-bg", " #101714 ");
    aktualisiereBrowserfarbe();
    const metas = document.head.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
    expect(metas).toHaveLength(1);
    expect(metas[0]!.content).toBe("#101714");
    document.documentElement.style.setProperty("--cw-bg", "#F7F4ED");
    setzeThema("hell");
    expect(document.head.querySelectorAll('meta[name="theme-color"]')).toHaveLength(1);
    expect(document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"]')!.content).toBe("#F7F4ED");
  });

  it("useThema folgt jedem Wechsel, auch von außen", () => {
    function Anzeige() {
      const [thema, setze] = useThema();
      return (
        <button type="button" onClick={() => setze("hell")}>
          {thema}
        </button>
      );
    }
    setzeThema("system");
    render(<Anzeige />);
    expect(screen.getByRole("button").textContent).toBe("system");
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("button").textContent).toBe("hell");
    act(() => setzeThema("dunkel"));
    expect(screen.getByRole("button").textContent).toBe("dunkel");
  });
});

describe("MenueSegment im Menü", () => {
  const optionen = [
    { wert: "system" as const, label: "System" },
    { wert: "hell" as const, label: "Hell" },
    { wert: "dunkel" as const, label: "Dunkel" },
  ];

  it("hat Einträge des Menüs, bleibt nach der Wahl offen und wechselt mit Pfeil links und rechts", () => {
    const wahl = vi.fn();
    render(
      <Menue aria-label="Konto" ausloeser="Konto" eintraege={[]} block={{ label: "Thema", inhalt: <MenueSegment aria-label="Thema" value="system" onChange={wahl} options={optionen} /> }} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Konto" }));
    const menue = screen.getByRole("menu");
    const eintraege = screen.getAllByRole("menuitemradio");
    expect(eintraege.map((e) => [e.textContent, e.getAttribute("aria-checked")])).toEqual([
      ["System", "true"],
      ["Hell", "false"],
      ["Dunkel", "false"],
    ]);
    // Pfeil rechts springt zum nächsten Segment, am Ende zurück zum ersten.
    eintraege[0]!.focus();
    fireEvent.keyDown(eintraege[0]!, { key: "ArrowRight" });
    expect(document.activeElement).toBe(eintraege[1]);
    fireEvent.keyDown(eintraege[1]!, { key: "ArrowLeft" });
    fireEvent.keyDown(eintraege[0]!, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(eintraege[2]);
    // Wahl: Rückruf, Menü bleibt offen.
    fireEvent.click(eintraege[1]!);
    expect(wahl).toHaveBeenCalledWith("hell");
    expect(screen.getByRole("menu")).toBe(menue);
  });
});
