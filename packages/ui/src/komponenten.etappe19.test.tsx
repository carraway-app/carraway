import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { lazy, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { BellIcon, Dialog, Fakten, KennzahlenReihe, Kennzahl, Leer, Menue, Seitenpanel, Tabelle, Tabs, UnterTabs, UiSprache, Werkzeugleiste } from "./index";

const TABS = [
  { id: "a", label: "Übersicht" },
  { id: "b", label: "Finanzierung", zaehler: 3 },
  { id: "c", label: "Bewertung", deaktiviert: true },
  { id: "d", label: "Dokumente" },
];

describe("Tabs", () => {
  it("zeigt ein Zeichen je Reiter als Schmuck und einen benannten Zähler, ohne den Namen zu ändern", () => {
    render(<Tabs aria-label="Bereiche" tabs={[{ id: "a", label: "Eingang", icon: BellIcon, zaehler: 2, zaehlerLabel: "2 Deals" }, { id: "b", label: "Pipeline" }]} aktiv="a" onWechsel={() => {}} />);
    const a = screen.getByRole("tab", { name: /Eingang/ });
    expect(a.querySelector("svg[data-glyph='Bell']")?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByLabelText("2 Deals").textContent).toBe("2");
    expect(screen.getByRole("tab", { name: "Pipeline" }).querySelector("svg")).toBeNull();
  });

  it("nutzt tablist, tab und tabpanel mit Verweisen und Roving-Tabindex", () => {
    render(
      <Tabs aria-label="Bereiche" tabs={TABS} aktiv="a" onWechsel={() => {}}>
        <p>Inhalt A</p>
      </Tabs>,
    );
    expect(screen.getByRole("tablist", { name: "Bereiche" })).toBeTruthy();
    const a = screen.getByRole("tab", { name: "Übersicht" });
    expect(a.getAttribute("aria-selected")).toBe("true");
    expect(a.tabIndex).toBe(0);
    expect(screen.getByRole("tab", { name: /Finanzierung/ }).tabIndex).toBe(-1);
    const panel = screen.getByRole("tabpanel", { name: "Übersicht" });
    expect(a.getAttribute("aria-controls")).toBe(panel.id);
    expect(panel.textContent).toBe("Inhalt A");
  });

  it("zeigt den Zähler und wechselt nur bei einem anderen Reiter", () => {
    const onWechsel = vi.fn();
    render(<Tabs aria-label="Bereiche" tabs={TABS} aktiv="a" onWechsel={onWechsel} />);
    expect(screen.getByRole("tab", { name: /Finanzierung/ }).textContent).toContain("3");
    fireEvent.click(screen.getByRole("tab", { name: "Übersicht" }));
    expect(onWechsel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("tab", { name: /Finanzierung/ }));
    expect(onWechsel).toHaveBeenCalledWith("b");
  });

  it("Pfeiltasten bewegen den Fokus und überspringen Deaktiviertes, ohne zu wechseln; Pos1 und Ende springen", () => {
    const onWechsel = vi.fn();
    render(<Tabs aria-label="Bereiche" tabs={TABS} aktiv="a" onWechsel={onWechsel} />);
    const a = screen.getByRole("tab", { name: "Übersicht" });
    const b = screen.getByRole("tab", { name: /Finanzierung/ });
    const d = screen.getByRole("tab", { name: "Dokumente" });
    a.focus();
    fireEvent.keyDown(a, { key: "ArrowRight" });
    expect(document.activeElement).toBe(b);
    expect(b.tabIndex).toBe(0);
    expect(a.tabIndex).toBe(-1);
    fireEvent.keyDown(b, { key: "ArrowRight" });
    expect(document.activeElement).toBe(d);
    fireEvent.keyDown(d, { key: "ArrowRight" });
    expect(document.activeElement).toBe(a);
    fireEvent.keyDown(a, { key: "End" });
    expect(document.activeElement).toBe(d);
    fireEvent.keyDown(d, { key: "Home" });
    expect(document.activeElement).toBe(a);
    fireEvent.keyDown(a, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(d);
    expect(onWechsel).not.toHaveBeenCalled();
  });

  it("deaktivierte Reiter lassen sich nicht wählen", () => {
    const onWechsel = vi.fn();
    render(<Tabs aria-label="Bereiche" tabs={TABS} aktiv="a" onWechsel={onWechsel} />);
    fireEvent.click(screen.getByRole("tab", { name: "Bewertung" }));
    expect(onWechsel).not.toHaveBeenCalled();
  });

  it("baut nur den Inhalt des aktiven Reiters (träges Laden)", () => {
    const bauen = { a: vi.fn(() => <p>Inhalt A</p>), b: vi.fn(() => <p>Inhalt B</p>) };
    function Seite() {
      const [aktiv, setAktiv] = useState("a");
      return (
        <Tabs
          aria-label="Bereiche"
          aktiv={aktiv}
          onWechsel={setAktiv}
          tabs={[
            { id: "a", label: "A", inhalt: bauen.a },
            { id: "b", label: "B", inhalt: bauen.b },
          ]}
        />
      );
    }
    render(<Seite />);
    expect(bauen.a).toHaveBeenCalled();
    expect(bauen.b).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("tab", { name: "B" }));
    expect(bauen.b).toHaveBeenCalled();
    expect(screen.queryByText("Inhalt A")).toBeNull();
    expect(screen.getByText("Inhalt B")).toBeTruthy();
  });

  it("jeder Reiter hat eine eigene Suspense-Grenze: die Leiste bleibt beim Laden stehen", async () => {
    let fertig: () => void = () => {};
    const Traege = lazy(() => new Promise<{ default: () => React.JSX.Element }>((r) => (fertig = () => r({ default: () => <p>Geladen</p> }))));
    render(<Tabs aria-label="Bereiche" aktiv="a" onWechsel={() => {}} tabs={[{ id: "a", label: "A", inhalt: () => <Traege /> }]} />);
    expect(screen.getByRole("tab", { name: "A" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Wird geladen");
    fertig();
    await waitFor(() => expect(screen.getByText("Geladen")).toBeTruthy());
  });
});

describe("UnterTabs", () => {
  it("ist eine zweite Stufe mit eigener Klasse und denselben Rollen", () => {
    const onWechsel = vi.fn();
    const { container } = render(
      <Tabs aria-label="Bereiche" tabs={[{ id: "f", label: "Finanzierung" }]} aktiv="f" onWechsel={() => {}}>
        <UnterTabs aria-label="Finanzierung" tabs={[{ id: "runden", label: "Runden" }, { id: "wasserfall", label: "Wasserfall" }]} aktiv="runden" onWechsel={onWechsel}>
          <p>Runden</p>
        </UnterTabs>
      </Tabs>,
    );
    expect(container.querySelector(".cw-untertabs")).not.toBeNull();
    expect(screen.getAllByRole("tablist")).toHaveLength(2);
    fireEvent.click(screen.getByRole("tab", { name: "Wasserfall" }));
    expect(onWechsel).toHaveBeenCalledWith("wasserfall");
    expect(screen.getByRole("tabpanel", { name: "Runden" }).textContent).toBe("Runden");
  });
});

describe("Menue", () => {
  const eintraege = [
    { id: "a", label: "Einstellungen", href: "/einstellungen" },
    { id: "b", label: "Deutsch", ausgewaehlt: true, onClick: vi.fn() },
    { id: "c", label: "Abmelden", gefahr: true, trennerDavor: true, onClick: vi.fn() },
  ];

  it("öffnet per Klick, ist ein Menü mit Einträgen und schließt bei Escape mit Fokus auf dem Auslöser", () => {
    render(<Menue aria-label="Konto" ausloeser="K" eintraege={eintraege} kopf="Vera" richtung="oben" />);
    const knopf = screen.getByRole("button", { name: "Konto" });
    expect(knopf.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(knopf);
    expect(knopf.getAttribute("aria-expanded")).toBe("true");
    const menue = screen.getByRole("menu", { name: "Konto" });
    expect(menue.parentElement?.className).toContain("cw-menue--oben");
    expect(screen.getByRole("menuitem", { name: "Einstellungen" }).getAttribute("href")).toBe("/einstellungen");
    expect(screen.getByRole("menuitemradio", { name: "Deutsch" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(menue, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(knopf);
  });

  it("Pfeiltasten wandern durch die Einträge, ArrowDown am Auslöser öffnet mit dem ersten", async () => {
    render(<Menue aria-label="Konto" ausloeser="K" eintraege={eintraege} />);
    const knopf = screen.getByRole("button", { name: "Konto" });
    fireEvent.keyDown(knopf, { key: "ArrowDown" });
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Einstellungen"));
    const menue = screen.getByRole("menu");
    fireEvent.keyDown(menue, { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toContain("Deutsch");
    fireEvent.keyDown(menue, { key: "End" });
    expect(document.activeElement?.textContent).toBe("Abmelden");
    fireEvent.keyDown(menue, { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toBe("Einstellungen");
    fireEvent.keyDown(menue, { key: "ArrowUp" });
    expect(document.activeElement?.textContent).toBe("Abmelden");
  });

  it("ruft den Eintrag auf und schließt; ein Klick daneben schließt ebenfalls", () => {
    render(
      <div>
        <Menue aria-label="Konto" ausloeser="K" eintraege={eintraege} />
        <p>Daneben</p>
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Konto" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Abmelden" }));
    expect(eintraege[2]?.onClick).toHaveBeenCalled();
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Konto" }));
    fireEvent.mouseDown(screen.getByText("Daneben"));
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("Seitenpanel und Dialog", () => {
  it("Seitenpanel ist modal, schließt bei Escape und gibt den Fokus zurück", () => {
    const onSchliessen = vi.fn();
    function Seite() {
      const [offen, setOffen] = useState(false);
      return (
        <>
          <button onClick={() => setOffen(true)}>Öffnen</button>
          {offen ? (
            <Seitenpanel titel="Neue Beteiligung" onSchliessen={() => (onSchliessen(), setOffen(false))}>
              <input aria-label="Name" />
            </Seitenpanel>
          ) : null}
        </>
      );
    }
    render(<Seite />);
    const ausloeser = screen.getByRole("button", { name: "Öffnen" });
    ausloeser.focus();
    fireEvent.click(ausloeser);
    const dialog = screen.getByRole("dialog", { name: "Neue Beteiligung" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(screen.getByLabelText("Name"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onSchliessen).toHaveBeenCalled();
    expect(document.activeElement).toBe(ausloeser);
  });

  it("Dialog trägt seine Überschrift und eigene Aktionen; der Tabulator bleibt im Dialog", () => {
    render(
      <Dialog titel="Löschen?" onSchliessen={() => {}} aktionen={<button>Ja, löschen</button>}>
        <p>Das lässt sich nicht rückgängig machen.</p>
      </Dialog>,
    );
    expect(screen.getByRole("dialog", { name: "Löschen?" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Löschen?" })).toBeTruthy();
    const knopf = screen.getByRole("button", { name: "Ja, löschen" });
    knopf.focus();
    fireEvent.keyDown(knopf, { key: "Tab" });
    expect(document.activeElement).toBe(knopf);
  });

  it("englische Beschriftung des Schließen-Knopfs", () => {
    render(
      <UiSprache sprache="en">
        <Seitenpanel titel="X" onSchliessen={() => {}}>
          <p>Inhalt</p>
        </Seitenpanel>
      </UiSprache>,
    );
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
  });
});

describe("Tabelle: Dichte, Laden, Leer, Zeilenmenü", () => {
  const spalten = [{ schluessel: "n", kopf: "Name", zelle: (z: { n: string }) => z.n }];

  it("zeigt Platzhalter beim Laden und markiert die Tabelle als beschäftigt", () => {
    const { container } = render(<Tabelle beschriftung="T" spalten={spalten} zeilen={[]} zeilenSchluessel={(z: { n: string }) => z.n} laedt />);
    expect(container.querySelectorAll(".cw-tabelle__laden")).toHaveLength(3);
    expect(container.querySelector("table")?.getAttribute("aria-busy")).toBe("true");
  });

  it("zeigt den leeren Zustand, wenn es keine Zeilen gibt", () => {
    render(<Tabelle beschriftung="T" spalten={spalten} zeilen={[]} zeilenSchluessel={(z: { n: string }) => z.n} leer={<Leer titel="Keine Beteiligungen" />} />);
    expect(screen.getByText("Keine Beteiligungen")).toBeTruthy();
  });

  it("dicht setzt die Klasse; lange Tabellen scrollen in sich mit stehendem Kopf", () => {
    const zeilen = Array.from({ length: 20 }, (_, i) => ({ n: `Z${i}` }));
    const { container } = render(<Tabelle beschriftung="T" spalten={spalten} zeilen={zeilen} zeilenSchluessel={(z) => z.n} dicht />);
    expect(container.querySelector("table")?.className).toContain("cw-tabelle--dicht");
    expect(container.querySelector(".cw-tabelle-huelle--lang")).not.toBeNull();
  });

  it("Zeilenmenü: ein Menü je Zeile mit Aktionen, ohne Aktionen kein Menü", async () => {
    const onKlick = vi.fn();
    render(
      <Tabelle
        beschriftung="T"
        spalten={spalten}
        zeilen={[{ n: "Alpha" }, { n: "Beta" }]}
        zeilenSchluessel={(z) => z.n}
        aktionen={(z) => (z.n === "Alpha" ? [{ id: "x", label: "Stornieren", onClick: onKlick }] : [])}
      />,
    );
    // Das Zeilenmenü lädt träge.
    expect(await screen.findAllByRole("button", { name: "Weitere Aktionen" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Weitere Aktionen" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Stornieren" }));
    expect(onKlick).toHaveBeenCalled();
  });
});

describe("Kennzahlenreihe, Werkzeugleiste, Fakten", () => {
  it("Kennzahlenreihe ist ein benannter Bereich", () => {
    render(
      <KennzahlenReihe aria-label="Kennzahlen">
        <Kennzahl titel="NAV" wert="1,0 Mio. €" />
      </KennzahlenReihe>,
    );
    expect(screen.getByRole("region", { name: "Kennzahlen" }).className).toContain("cw-kennzahlen");
  });

  it("Werkzeugleiste gruppiert links und rechts", () => {
    render(
      <Werkzeugleiste aria-label="Filter" rechts={<button>Neu</button>}>
        <input aria-label="Suche" />
      </Werkzeugleiste>,
    );
    expect(screen.getByRole("group", { name: "Filter" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Neu" })).toBeTruthy();
  });

  it("Fakten als Beschreibungsliste", () => {
    const { container } = render(<Fakten eintraege={[{ label: "Sektor", wert: "Energie" }, { label: "Ort", wert: "Hamburg" }]} />);
    expect(container.querySelectorAll("dt")).toHaveLength(2);
    expect(container.querySelector("dd")?.textContent).toBe("Energie");
  });
});
