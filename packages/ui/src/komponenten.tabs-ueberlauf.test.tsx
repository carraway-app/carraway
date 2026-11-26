import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Tabs, UiSprache } from "./index";

const eintraege = Array.from({ length: 12 }, (_, i) => ({ id: `t${i}`, label: `Bereich ${i}` }));
const ui = (aktiv: string) => (
  <UiSprache sprache="de">
    <Tabs aria-label="Bereiche" tabs={eintraege} aktiv={aktiv} onWechsel={() => {}} />
  </UiSprache>
);

/** jsdom kennt kein Layout: die Leiste ist 100 px breit, jeder Reiter 80 px; Reiter n liegt bei n × 80 minus die Verschiebung der Leiste. */
function mocheLayout() {
  return vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (this.getAttribute("role") === "tablist") return { left: 0, right: 100, top: 0, bottom: 40, width: 100, height: 40, x: 0, y: 0, toJSON: () => ({}) };
    const nr = Number(/Bereich (\d+)/.exec(this.textContent ?? "")?.[1] ?? 0);
    const versatz = (this.parentElement?.scrollLeft ?? 0) as number;
    const links = nr * 80 - versatz;
    return { left: links, right: links + 80, top: 0, bottom: 40, width: 80, height: 40, x: links, y: 0, toJSON: () => ({}) };
  });
}

afterEach(() => vi.restoreAllMocks());

describe("Tabs: Überlauf", () => {
  it("verschiebt nur die Leiste, bis der aktive Reiter sichtbar ist, und lässt die Seite stehen", () => {
    mocheLayout();
    const seite = vi.fn();
    window.scrollTo = seite;
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const { rerender } = render(ui("t10"));
    const liste = screen.getByRole("tablist");
    // Reiter 10 liegt bei 800 bis 880, die Leiste zeigt 0 bis 100: Der rechte Rand muss ans rechte Ende der Leiste (880 - 100)
    expect(liste.scrollLeft).toBe(780);
    expect(screen.getByRole("tab", { name: "Bereich 10" }).getAttribute("aria-selected")).toBe("true");
    rerender(ui("t0"));
    expect(liste.scrollLeft).toBe(0);
    // nie scrollIntoView (würde die Seite mitnehmen), nie scrollTo der Seite
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(seite).not.toHaveBeenCalled();
  });

  it("lässt die Leiste stehen, wenn der aktive Reiter schon im Bild ist, und läuft ohne Layout", () => {
    mocheLayout();
    const { rerender } = render(ui("t0"));
    expect(screen.getByRole("tablist").scrollLeft).toBe(0);
    rerender(ui("t0"));
    vi.restoreAllMocks();
    render(ui("t3"));
    expect(screen.getAllByRole("tab").length).toBeGreaterThanOrEqual(12);
  });

  it("die Leiste scrollt waagerecht und blendet an den Kanten aus (Stilregeln vorhanden)", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles/komponenten.css"), "utf8");
    expect(css).toMatch(/\.cw-tabs__liste,\s*\.cw-untertabs__liste\s*\{[^}]*overflow-x:\s*auto/);
    expect(css).toMatch(/animation-timeline:\s*scroll\(self inline\)/);
    expect(css).toMatch(/mask-image:\s*linear-gradient\(to right, transparent 0, #000 var\(--cw-fl\)/);
  });
});
