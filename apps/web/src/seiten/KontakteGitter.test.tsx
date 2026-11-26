import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { rendereApp, spieleApi } from "../test/hilfen";

const zelle = (grid: HTMLElement, zeile: number, spalte: number) => grid.querySelector<HTMLElement>(`[data-z="${zeile}:${spalte}"]`)!;

describe("Tabelle der Datensätze: ein Scrollbereich mit klebenden Rändern", () => {
  it("legt Kopf, Zeilen, Auswahl, erste Spalte und Aktionsspalte in denselben Scrollbereich", async () => {
    spieleApi();
    rendereApp("/kontakte");
    const grid = await screen.findByRole("grid", { name: "Unternehmen" });
    // Das Gitter selbst ist der Scrollbereich: Kopfzeile und Zeilen liegen darin, kein zweiter Scrollbereich dazwischen.
    expect(grid.classList.contains("app-gitter")).toBe(true);
    const kopf = grid.querySelector<HTMLElement>(".app-gitter__kopf")!;
    expect(kopf).toBeTruthy();
    expect(grid.querySelector(".app-gitter__fenster")).toBeNull();
    const zeilen = within(grid).getAllByRole("row");
    expect(zeilen.length).toBeGreaterThan(2);
    for (const z of zeilen) expect(grid.contains(z)).toBe(true);

    // Auswahl und erste Spalte kleben links, die Aktionsspalte rechts, im Kopf wie in den Zeilen.
    for (const reihe of [kopf, zeilen[1]!]) {
      expect(reihe.querySelector(".app-gitter__auswahl.app-gitter__links")).toBeTruthy();
      expect(reihe.querySelector(".app-gitter__erste")).toBeTruthy();
      expect(reihe.querySelector(".app-gitter__rechts")).toBeTruthy();
    }
    expect(zelle(grid, 0, 0).classList.contains("app-gitter__erste")).toBe(true);
    expect(zelle(grid, 0, 1).classList.contains("app-gitter__erste")).toBe(false);
    // Die Schnellaktionen liegen in der klebenden Spalte.
    expect(within(grid.querySelector<HTMLElement>(".app-gitter__aktionen.app-gitter__rechts")!).getAllByRole("link").length).toBeGreaterThan(0);
  });

  it("gibt den Schnellaktionen feste Plätze: fünf je Zeile, leere als unsichtbare Platzhalter ohne Fokus", async () => {
    spieleApi();
    rendereApp("/kontakte");
    const grid = await screen.findByRole("grid", { name: "Unternehmen" });
    const zellen = Array.from(grid.querySelectorAll<HTMLElement>(".app-gitter__aktionen"));
    expect(zellen.length).toBeGreaterThan(1);
    let mitPlatzhalter = 0;
    for (const z of zellen) {
      const reihe = z.querySelector<HTMLElement>(".app-schnell")!;
      // Mail, Kopieren, Telefon, LinkedIn, Website: immer fünf Plätze, entweder Bedienelement oder Platzhalter.
      expect(Array.from(reihe.children).filter((k) => k.matches(".app-schnell__knopf, .app-schnell__platz"))).toHaveLength(5);
      const platzhalter = Array.from(z.querySelectorAll<HTMLElement>(".app-schnell__platz"));
      if (platzhalter.length) mitPlatzhalter += 1;
      for (const p of platzhalter) {
        expect(p.getAttribute("aria-hidden")).toBe("true");
        expect(p.matches("a, button, [tabindex]")).toBe(false);
        expect(p.textContent).toBe("");
      }
    }
    expect(mitPlatzhalter).toBeGreaterThan(0);
    // Eine Zeile ganz ohne Kontaktweg: nur Platzhalter, nicht im Zugänglichkeitsbaum.
    const leer = zellen.find((z) => !z.querySelector(".app-schnell__knopf"))!;
    expect(leer.querySelector(".app-schnell")!.getAttribute("aria-hidden")).toBe("true");
    expect(within(leer).queryByRole("group")).toBeNull();
  });

  it("leitet die Breite der Aktionsspalte aus den Tokens ab und schneidet Inhalte an der Zelle ab", () => {
    const css = readFileSync(resolve(process.cwd(), "src/crm.css"), "utf8");
    const quelle = readFileSync(resolve(process.cwd(), "src/komponenten/crm/Datengitter.tsx"), "utf8");
    expect(css).toMatch(/--app-gitter-aktion:\s*calc\(5 \* var\(--h-xs\)/);
    expect(quelle).toContain("var(--app-gitter-aktion)");
    expect(quelle).not.toMatch(/AKTION_BREITE/);
    const regel = css.match(/\n\.app-gitter__aktionen\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(regel).toMatch(/overflow:\s*hidden/);
    expect(regel).toMatch(/min-width:\s*0/);
  });

  it("bleibt per Tastatur bedienbar: Pfeile bewegen den Fokus, Spaltenköpfe sortieren", async () => {
    spieleApi();
    rendereApp("/kontakte");
    const nutzer = userEvent.setup();
    const grid = await screen.findByRole("grid", { name: "Unternehmen" });
    zelle(grid, 0, 0).focus();
    await nutzer.keyboard("{ArrowDown}{ArrowRight}");
    await waitFor(() => expect(document.activeElement).toBe(zelle(grid, 1, 1)));
    await nutzer.keyboard("{End}");
    await waitFor(() => expect(document.activeElement?.getAttribute("data-z")?.startsWith("1:")).toBe(true));
    expect(within(grid).getAllByRole("columnheader").length).toBeGreaterThan(3);
  });

  it("legt die Stile fest: ein Scrollbereich in beide Richtungen, klebende Ränder mit Grund der Zeile, Kopf klebt oben", () => {
    const css = readFileSync(resolve(process.cwd(), "src/crm.css"), "utf8");
    const regel = (wahl: string) => new RegExp(`(?:^|\\n)${wahl.replace(/[.[\]()]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
    expect(regel(".app-gitter")).toMatch(/overflow:\s*auto/);
    expect(regel(".app-gitter__kopf")).toMatch(/position:\s*sticky;\s*top:\s*0/);
    expect(regel(".app-gitter .app-gitter__links, .app-gitter .app-gitter__rechts")).toMatch(/position:\s*sticky/);
    expect(regel(".app-gitter .app-gitter__links, .app-gitter .app-gitter__rechts")).toMatch(/background:\s*inherit/);
    expect(regel(".app-gitter__rechts")).toMatch(/right:\s*0/);
    expect(regel(".app-gitter__auswahl.app-gitter__links")).toMatch(/left:\s*0/);
    // Kein zweiter Scrollbereich im Gitter (er würde das Kleben am Rand verhindern).
    expect(css).not.toMatch(/\.app-gitter__fenster\s*\{[^}]*overflow/);
    // Eine durchscheinende Zeilenfarbe würde in den klebenden Zellen Inhalt hindurchlassen: die Auswahl ist das deckende Token --cw-selected.
    expect(regel(".app-gitter__zeile[data-gewaehlt]")).toMatch(/background:\s*var\(--cw-selected\)/);
    const ui = readFileSync(resolve(process.cwd(), "../../packages/ui/src/styles/komponenten.css"), "utf8");
    expect(ui).toMatch(/\.cw-tabelle td\.cw-tabelle__aktion, \.cw-tabelle th\.cw-tabelle__aktion \{[^}]*position:\s*sticky;\s*right:\s*0/);
  });
});
