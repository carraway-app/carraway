import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Tabs, UiSprache, reiterImUeberlauf } from "./index";

const eintraege = Array.from({ length: 12 }, (_, i) => ({ id: `t${i}`, label: `Bereich ${i}` }));
const ui = (aktiv: string, onWechsel: (id: string) => void = () => {}) => (
  <UiSprache sprache="de">
    <Tabs aria-label="Bereiche" tabs={eintraege} aktiv={aktiv} onWechsel={onWechsel} />
  </UiSprache>
);

/** jsdom kennt kein Layout: die Leiste ist 410 px breit, jeder Reiter und der Auslöser „Mehr“ 80 px. */
function mocheLayout(leiste = 410) {
  return vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const breite = this.classList.contains("cw-tabs__leiste") ? leiste : this.getAttribute("role") === "tab" || this.classList.contains("cw-tabs__mehr") ? 80 : 0;
    return { left: 0, right: breite, top: 0, bottom: 40, width: breite, height: 40, x: 0, y: 0, toJSON: () => ({}) };
  });
}

/** Taste am fokussierten Element; danach Mikroaufgaben abwarten (das Menü setzt den Fokus nachgelagert). */
async function taste(key: string) {
  fireEvent.keyDown(document.activeElement!, { key });
  await act(async () => {});
}
async function klick(el: Element) {
  fireEvent.mouseDown(el);
  fireEvent.click(el);
  await act(async () => {});
}

const sichtbar = () => screen.getAllByRole("tab").map((t) => t.textContent);

afterEach(() => vi.restoreAllMocks());

describe("Tabs: Überlauf mit „Mehr“", () => {
  it("zeigt so viele Reiter, wie hineinpassen; der aktive bleibt sichtbar, der Rest steht hinter „Mehr“", () => {
    mocheLayout();
    render(ui("t10"));
    // 410 px: „Mehr“ braucht 80 plus 4 Luft, es bleiben 326 für vier Reiter, der aktive zuerst gesetzt
    expect(sichtbar()).toEqual(["Bereich 0", "Bereich 1", "Bereich 2", "Bereich 10"]);
    expect(screen.getByRole("button", { name: "+8 Mehr" })).toBeTruthy();
  });

  it("ohne Überlauf oder ohne Layout gibt es kein „Mehr“", () => {
    mocheLayout(2000);
    const { unmount } = render(ui("t0"));
    expect(sichtbar()).toHaveLength(12);
    expect(screen.queryByRole("button", { name: /Mehr/ })).toBeNull();
    unmount();
    vi.restoreAllMocks();
    render(ui("t3"));
    expect(sichtbar()).toHaveLength(12);
  });

  it("„Mehr“ öffnet ein Menü mit allen Reitern, der aktive ist markiert, ein Klick wählt aus", async () => {
    mocheLayout();
    const wechsel = vi.fn();
    render(ui("t10", wechsel));
    await klick(screen.getByRole("button", { name: "+8 Mehr" }));
    const menue = within(screen.getByRole("menu", { name: "Mehr: Bereiche" }));
    const punkte = menue.getAllByRole("menuitemradio");
    expect(punkte.map((p) => p.textContent)).toEqual(eintraege.map((e) => e.label));
    expect(punkte.filter((p) => p.getAttribute("aria-checked") === "true").map((p) => p.textContent)).toEqual(["Bereich 10"]);
    await klick(menue.getByRole("menuitemradio", { name: "Bereich 7" }));
    expect(wechsel).toHaveBeenCalledWith("t7");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("Tastatur: Pfeile zwischen den sichtbaren Reitern; im Menü Pfeile, Escape schließt und gibt den Fokus an „Mehr“ zurück", async () => {
    mocheLayout();
    const wechsel = vi.fn();
    render(ui("t10", wechsel));
    act(() => screen.getByRole("tab", { name: "Bereich 10" }).focus());
    await taste("ArrowRight");
    expect(document.activeElement?.textContent).toBe("Bereich 0");
    await taste("ArrowLeft");
    expect(document.activeElement?.textContent).toBe("Bereich 10");
    await taste("ArrowLeft");
    expect(document.activeElement?.textContent).toBe("Bereich 2");

    const mehr = screen.getByRole("button", { name: "+8 Mehr" });
    act(() => mehr.focus());
    await taste("ArrowDown");
    expect(document.activeElement?.getAttribute("role")).toBe("menuitemradio");
    expect(document.activeElement?.textContent).toBe("Bereich 0");
    await taste("ArrowDown");
    expect(document.activeElement?.textContent).toBe("Bereich 1");
    await taste("Escape");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(mehr);
    await taste("ArrowUp");
    expect(document.activeElement?.textContent).toBe("Bereich 11");
    await klick(document.activeElement!);
    expect(wechsel).toHaveBeenCalledWith("t11");
  });

  it("Rechenregel: aktiver Reiter immer sichtbar, Reihenfolge bleibt, unbekannte Breiten zeigen alles", () => {
    const b = new Map(eintraege.map((e) => [e.id, 100]));
    const ids = eintraege.map((e) => e.id);
    expect([...reiterImUeberlauf(ids, "t5", b, 1200, 0, 80)]).toEqual([]);
    expect(ids.filter((id) => !reiterImUeberlauf(ids, "t5", b, 500, 0, 80).has(id))).toEqual(["t0", "t1", "t2", "t5"]);
    expect([...reiterImUeberlauf(ids, "t5", new Map(), 500, 0, 80)]).toEqual([]);
  });

  it("Rückfall bei sehr schmalen Fenstern: die Leiste scrollt und blendet an den Kanten aus (Stilregeln vorhanden)", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles/komponenten.css"), "utf8");
    expect(css).toMatch(/\.cw-tabs__liste,\s*\.cw-untertabs__liste\s*\{[^}]*overflow-x:\s*auto/);
    expect(css).toMatch(/animation-timeline:\s*scroll\(self inline\)/);
  });
});
