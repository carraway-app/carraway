import { readFileSync } from "node:fs";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Rechenschritt } from "@carraway/rechenkern";
import {
  Auswahl,
  Button,
  ButtonLink,
  Delta,
  Etikett,
  Feld,
  Herkunft,
  Hinweis,
  IconButton,
  Initiale,
  Kennzahl,
  Leer,
  Logo,
  NavLeiste,
  Schrittfolge,
  Segment,
  Seitenkopf,
  Status,
  Tabelle,
  Textbereich,
  UiSprache,
} from "./index";

describe("Button", () => {
  it("ist ein echter Button mit type=button und Variantenklassen", () => {
    render(<Button variante="gefahr" groesse="l">Bericht erstellen</Button>);
    const b = screen.getByRole("button", { name: "Bericht erstellen" });
    expect(b.tagName).toBe("BUTTON");
    expect(b.getAttribute("type")).toBe("button");
    expect(b.className).toContain("cw-button--gefahr");
    expect(b.className).toContain("cw-button--l");
  });

  it("Icon-Button trägt aria-label und verlangt es im Typ", () => {
    render(<IconButton icon={<svg />} aria-label="Zeile löschen" />);
    const b = screen.getByRole("button", { name: "Zeile löschen" });
    expect(b.className).toContain("cw-button--icon");
    // @ts-expect-error aria-label fehlt
    void (<Button icon={<svg />} />);
  });

  it("ButtonLink ist ein <a>", () => {
    render(<ButtonLink href="/bericht">Bericht öffnen</ButtonLink>);
    expect(screen.getByRole("link", { name: "Bericht öffnen" }).getAttribute("href")).toBe("/bericht");
  });
});

describe("Feld", () => {
  it("verbindet Label, Hilfe und Fehler", () => {
    const { rerender } = render(<Feld label="Stichtag" hilfe="Format TT.MM.JJJJ" />);
    const mitHilfe = screen.getByLabelText("Stichtag");
    expect(mitHilfe.getAttribute("aria-invalid")).toBeNull();
    expect(mitHilfe.getAttribute("aria-describedby")).toBeTruthy();

    rerender(<Feld label="Stichtag" hilfe="Format TT.MM.JJJJ" fehler="Datum fehlt" />);
    const feld = screen.getByLabelText("Stichtag");
    expect(feld.getAttribute("aria-invalid")).toBe("true");
    const meldung = document.getElementById(feld.getAttribute("aria-describedby")!);
    expect(meldung?.textContent).toBe("Datum fehlt");
  });
});

describe("Auswahl und Textbereich", () => {
  it("verbinden Label, Hilfe und Fehler wie Feld", () => {
    const { rerender } = render(
      <>
        <Auswahl label="Instrument" hilfe="Art der Beteiligung">
          <option value="a">Darlehen</option>
        </Auswahl>
        <Textbereich label="Protokoll" hilfe="Freitext" />
      </>,
    );
    expect(screen.getByLabelText("Instrument").tagName).toBe("SELECT");
    expect(screen.getByLabelText("Protokoll").tagName).toBe("TEXTAREA");
    rerender(
      <>
        <Auswahl label="Instrument" fehler="Pflichtfeld">
          <option value="a">Darlehen</option>
        </Auswahl>
        <Textbereich label="Protokoll" fehler="Zu lang" />
      </>,
    );
    for (const [name, text] of [["Instrument", "Pflichtfeld"], ["Protokoll", "Zu lang"]] as const) {
      const feld = screen.getByLabelText(name);
      expect(feld.getAttribute("aria-invalid")).toBe("true");
      expect(document.getElementById(feld.getAttribute("aria-describedby")!)?.textContent).toBe(text);
    }
  });
});

describe("Segment", () => {
  it("setzt aria-pressed und meldet Wechsel", () => {
    const onChange = vi.fn();
    render(<Segment aria-label="Ansicht" options={[{ wert: "a", label: "Tabelle" }, { wert: "b", label: "Karten" }]} value="a" onChange={onChange} />);
    expect(screen.getByRole("button", { name: "Tabelle" }).getAttribute("aria-pressed")).toBe("true");
    const karten = screen.getByRole("button", { name: "Karten" });
    expect(karten.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(karten);
    expect(onChange).toHaveBeenCalledWith("b");
  });
});

describe("Status", () => {
  it("zeigt Standardtexte je Variante und Sprache", () => {
    const { rerender } = render(<Status variante="beispiel" />);
    expect(screen.getByText("Beispieldaten").className).toContain("cw-status--beispiel");
    rerender(<UiSprache sprache="en"><Status variante="freigegeben" /></UiSprache>);
    expect(screen.getByText("Approved").className).toContain("cw-status--freigegeben");
  });
});

describe("Delta", () => {
  it("Anstieg mit ▲ im deutschen Format", () => {
    const { container } = render(<Delta wert={8.4} />);
    expect(container.textContent).toContain("▲");
    expect(container.textContent?.replace(/\u00a0/g, " ")).toContain("8,4 %");
    expect(container.firstElementChild?.className).toBe("cw-delta");
  });
  it("Rückgang mit ▼ und negativer Klasse", () => {
    const { container } = render(<Delta wert={-3.25} />);
    expect(container.textContent).toContain("▼");
    expect(container.firstElementChild?.className).toContain("cw-delta--minus");
  });
  it("Null mit ± und Nullklasse (auch nach Rundung)", () => {
    const { container } = render(<Delta wert={0.04} />);
    expect(container.textContent).toContain("±");
    expect(container.firstElementChild?.className).toContain("cw-delta--null");
  });
  it("englisches Format und Screenreader-Text", () => {
    render(<UiSprache sprache="en"><Delta wert={8.4} /></UiSprache>);
    expect(screen.getByText(/Increase/)).toBeTruthy();
    expect(document.body.textContent).toContain("8.4%");
  });
});

describe("Kennzahl", () => {
  it("öffnet die Herkunft über die gesamte Kachel, wenn ein Rechenweg verfügbar ist", () => {
    const onHerkunft = vi.fn();
    const { rerender } = render(<Kennzahl titel="TVPI" wert="1,42x" hervorgehoben onHerkunft={onHerkunft} delta={<Delta wert={2} />} />);
    const kachel = screen.getByRole("button", { name: "Herkunft von TVPI anzeigen" });
    expect(kachel.contains(screen.getByText("TVPI"))).toBe(true);
    expect(kachel.contains(screen.getByText("1,42x"))).toBe(true);
    fireEvent.click(screen.getByText("1,42x"));
    expect(onHerkunft).toHaveBeenCalledOnce();
    expect(screen.getByText("1,42x").parentElement?.className).toContain("cw-kennzahl--hervorgehoben");
    expect(screen.getByText("1,42x").parentElement?.className).not.toContain("cw-kennzahl--ziel");
    rerender(<Kennzahl titel="TVPI" wert="1,42x" />);
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("mit onZiel springt die Kachel; der Rechenweg ist ein eigener Knopf daneben, nicht darin", () => {
    const onZiel = vi.fn();
    const onHerkunft = vi.fn();
    render(<Kennzahl titel="TVPI" wert="1,42x" onZiel={onZiel} zielLabel="TVPI: zu den Bewertungen" onHerkunft={onHerkunft} />);
    const ziel = screen.getByRole("button", { name: "TVPI: zu den Bewertungen" });
    const rechenweg = screen.getByRole("button", { name: "Herkunft von TVPI anzeigen" });
    expect(ziel.contains(rechenweg)).toBe(false);
    expect(ziel.querySelector("button")).toBeNull();
    expect(rechenweg.querySelector("svg[data-glyph]")).not.toBeNull();
    fireEvent.click(ziel);
    expect(onZiel).toHaveBeenCalledOnce();
    expect(onHerkunft).not.toHaveBeenCalled();
    fireEvent.click(rechenweg);
    expect(onHerkunft).toHaveBeenCalledOnce();
    expect(onZiel).toHaveBeenCalledOnce();
  });
  it("mit onZiel ohne onHerkunft gibt es keinen Rechenweg-Knopf", () => {
    render(<Kennzahl titel="TVPI" wert="1,42x" onZiel={() => {}} />);
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });
  it("Herkunfts-Label auf Englisch", () => {
    render(<UiSprache sprache="en"><Kennzahl titel="TVPI" wert="1.42x" onHerkunft={() => {}} /></UiSprache>);
    expect(screen.getByRole("button", { name: "Show origin of TVPI" })).toBeTruthy();
  });
});

describe("Herkunft", () => {
  const schritte: Rechenschritt[] = [
    { zeichen: "", bezeichnung: "Einzahlungen", wert: "10.000.000" },
    { zeichen: "+", bezeichnung: "Ausschüttungen", wert: "4.000.000" },
    { zeichen: "÷", bezeichnung: "Eingezahltes Kapital", wert: "10.000.000" },
    { zeichen: "=", bezeichnung: "DPI", wert: "0,40" },
  ];
  it("zeigt jeden Schritt in der Reihenfolge, Stichtag und Quellen", () => {
    render(<Herkunft titel="DPI" stichtag="2026-09-30" schritte={schritte} quellen={[{ label: "Vorgang 1", href: "#v1" }]} />);
    const eintraege = screen.getAllByRole("listitem").filter((li) => li.closest("ol"));
    expect(eintraege.map((li) => li.textContent)).toEqual(["Einzahlungen10.000.000", "+Ausschüttungen4.000.000", "÷Eingezahltes Kapital10.000.000", "=DPI0,40"]);
    expect(eintraege[3]?.className).toBe("cw-herkunft__ergebnis");
    expect(screen.getByText(/30\.09\.2026/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Vorgang 1" }).getAttribute("href")).toBe("#v1");
  });
  it("Stichtag englisch", () => {
    render(<UiSprache sprache="en"><Herkunft titel="DPI" stichtag="2026-09-30" schritte={schritte} /></UiSprache>);
    expect(screen.getByText(/30\/09\/2026/)).toBeTruthy();
  });
});

describe("Initiale", () => {
  it("zeigt den ersten Buchstaben groß, aria-hidden, mit Größe und Variante", () => {
    const { container } = render(<Initiale name="  beispielfonds I" groesse="l" variante="akzent" />);
    const el = container.firstElementChild!;
    expect(el.getAttribute("data-buchstabe")).toBe("B");
    expect(el.getAttribute("aria-hidden")).toBe("true");
    expect(el.className).toContain("cw-initiale--l");
    expect(el.className).toContain("cw-initiale--akzent");
  });
});

describe("Tabelle", () => {
  interface Zeile { id: number; name: string; betrag: number }
  const zeilen: Zeile[] = [{ id: 1, name: "Unternehmen A", betrag: 100 }, { id: 2, name: "Unternehmen B", betrag: 200 }];
  const spalten = [
    { schluessel: "name", kopf: "Name", zelle: (z: Zeile) => z.name, sortierbar: true },
    { schluessel: "betrag", kopf: "Betrag", zelle: (z: Zeile) => z.betrag, zahl: true },
  ];
  it("rendert Kopf, Zeilen, aria-sort, Auswahl und scrollbare Hülle", () => {
    const onSortieren = vi.fn();
    const { container } = render(
      <Tabelle beschriftung="Beteiligungen" spalten={spalten} zeilen={zeilen} zeilenSchluessel={(z) => z.id} ausgewaehlt={(z) => z.id === 2} sortierung={{ schluessel: "name", richtung: "ab" }} onSortieren={onSortieren} />,
    );
    expect(screen.getByRole("region", { name: "Beteiligungen" }).className).toBe("cw-tabelle-huelle");
    expect(screen.getByRole("columnheader", { name: /Name/ }).getAttribute("aria-sort")).toBe("descending");
    expect(screen.getByRole("columnheader", { name: "Betrag" }).className).toBe("cw-zahl");
    expect(screen.getByRole("cell", { name: "200" }).className).toBe("cw-zahl");
    const rows = container.querySelectorAll("tbody tr");
    expect(rows[1]?.getAttribute("aria-current")).toBe("true");
    expect(rows[0]?.getAttribute("aria-current")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Nach Name sortieren" }));
    expect(onSortieren).toHaveBeenCalledWith("name");
  });
});

describe("NavLeiste", () => {
  const gruppen = [
    { id: "a", label: "Übersicht", items: [{ id: "fonds", href: "/a", label: "Fonds", aktiv: true }, { id: "kontakte", href: "/b", label: "Kontakte" }] },
    { id: "b", label: "Finanzen", items: [{ id: "journal", href: "/c", label: "Journal" }] },
  ];
  it("markiert den aktiven Eintrag mit aria-current und benennt die Navigation", () => {
    render(<NavLeiste gruppen={gruppen} />);
    expect(screen.getByRole("navigation", { name: "Hauptnavigation" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Fonds" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Kontakte" }).getAttribute("aria-current")).toBeNull();
  });
  it("ruft onVorladen beim Überfahren und bei Fokus auf", () => {
    const vorladen = vi.fn();
    render(<NavLeiste gruppen={[{ id: "a", label: "", items: [{ id: "f", href: "/a", label: "Fonds", onVorladen: vorladen }] }]} />);
    fireEvent.pointerEnter(screen.getByRole("link", { name: "Fonds" }));
    fireEvent.focus(screen.getByRole("link", { name: "Fonds" }));
    expect(vorladen).toHaveBeenCalledTimes(2);
  });
  it("Gruppen lassen sich einklappen; die eingeklappte Gruppe zeigt nur den aktiven Eintrag", () => {
    const onGruppe = vi.fn();
    const { rerender } = render(<NavLeiste gruppen={gruppen} onGruppe={onGruppe} />);
    const kopf = screen.getByRole("button", { name: "Übersicht" });
    expect(kopf.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(kopf);
    expect(onGruppe).toHaveBeenCalledWith("a", true);
    rerender(<NavLeiste gruppen={gruppen} onGruppe={onGruppe} eingeklappt={["a"]} />);
    expect(screen.getByRole("button", { name: "Übersicht" }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("link", { name: "Kontakte" })).toBeNull();
    expect(screen.getByRole("link", { name: "Fonds" })).toBeTruthy();
  });
  it("Schmal: nur Zeichen, Name als Tooltip, keine Gruppenköpfe", () => {
    render(<NavLeiste gruppen={gruppen} schmal eingeklappt={["a"]} />);
    expect(screen.queryByRole("button", { name: "Übersicht" })).toBeNull();
    expect(screen.getByRole("link", { name: "Kontakte" }).getAttribute("title")).toBe("Kontakte");
  });
  it("englischer Navigationsname", () => {
    render(<UiSprache sprache="en"><NavLeiste gruppen={[]} /></UiSprache>);
    expect(screen.getByRole("navigation", { name: "Main navigation" })).toBeTruthy();
  });
});

describe("Hinweis", () => {
  it("Info als status, Fehler als alert", () => {
    const { rerender } = render(<Hinweis titel="Stichtag">Werte sind vorläufig.</Hinweis>);
    expect(screen.getByRole("status").textContent).toContain("Werte sind vorläufig.");
    rerender(<Hinweis variante="fehler">Import fehlgeschlagen.</Hinweis>);
    expect(screen.getByRole("alert").className).toContain("cw-hinweis--fehler");
  });
});

describe("Etikett, Leer, Seitenkopf, Logo", () => {
  it("Etikett", () => {
    render(<Etikett>Portfolio</Etikett>);
    expect(screen.getByText("Portfolio").className).toBe("cw-etikett");
  });
  it("Leer nutzt Standardtexte, eigenes Zeichen und Aktion", () => {
    const { container } = render(<Leer zeichen="A" aktion={<Button>Beteiligung erfassen</Button>} />);
    expect(container.querySelector(".cw-leer__kachel")?.getAttribute("data-zeichen")).toBe("A");
    expect(screen.getByText("Noch keine Einträge")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Beteiligung erfassen" })).toBeTruthy();
  });
  it("Leer auf Englisch", () => {
    render(<UiSprache sprache="en"><Leer /></UiSprache>);
    expect(screen.getByText("No entries yet")).toBeTruthy();
  });
  it("Seitenkopf mit h1, Meta-Zeile, Zeitbezug und Aktionen", () => {
    render(<Seitenkopf meta="Fonds" titel="Beispielfonds I" zeitbezug={<Button>Stichtag wählen</Button>} aktionen={<Button>Bericht erstellen</Button>} />);
    expect(screen.getByRole("heading", { level: 1, name: "Beispielfonds I" })).toBeTruthy();
    expect(screen.getByText("Fonds").className).toBe("cw-seitenkopf__meta");
    expect(screen.getAllByRole("button").map((knopf) => knopf.textContent)).toEqual(["Stichtag wählen", "Bericht erstellen"]);
  });
  it("Logo mit Namen; die Farben folgen dem Thema, es gibt keine Variante für den Grund", () => {
    const { rerender } = render(<Logo />);
    expect(screen.getByRole("img", { name: "Carraway" }).className).toBe("cw-logo");
    const logo = screen.getByRole("img", { name: "Carraway" });
    expect(logo.querySelector(".cw-logo__wort")?.textContent).toBe("Carraway");
    expect(logo.querySelector(".cw-logo__zeichen")).toBeTruthy();
    const css = readFileSync("src/styles/komponenten.css", "utf8");
    expect(css).toContain('url("../zeichen/carraway-mark.svg")');
    expect(css).toMatch(/@container \(width > 32px\)[^{]*\{\s*\.cw-logo__zeichen::before[^}]*carraway-mark-gross\.svg/);
    rerender(<Logo nurZeichen />);
    expect(screen.getByRole("img", { name: "Carraway" }).textContent).toBe("");
  });
});

describe("Feinschliff (Sichtprüfung Etappe 4)", () => {
  const css = readFileSync("src/styles/komponenten.css", "utf8");
  const regel = (selektor: string) => css.split("\n").find((z) => z.startsWith(`${selektor} {`)) ?? "";

  it("Seitenkopf: Titel mit Sprache, Trennung statt Bruch im Wort", () => {
    render(<Seitenkopf titel="Wachstumsfinanzierung Beispiel-Unternehmen" titelSprache="de" />);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.getAttribute("lang")).toBe("de");
    const titel = regel(".cw-seitenkopf__titel");
    expect(titel).toContain("hyphens: auto");
    expect(titel).not.toContain("anywhere");
  });

  it("Kennzahl: Wert einzeilig, Schrift schrumpft mit der Zeichenzahl", () => {
    const { container } = render(<Kennzahl titel="NAV" wert="8,3 Mio. €" />);
    const wert = container.querySelector<HTMLElement>(".cw-kennzahl__wert")!;
    expect(wert.style.getPropertyValue("--zeichen")).toBe("10");
    expect(regel(".cw-kennzahl__wert")).toContain("white-space: nowrap");
    expect(regel(".cw-kennzahl")).toContain("container-type: inline-size");
  });

  it("Initiale: kleine Größe wenig angeschnitten, m und l behalten den Anschnitt", () => {
    expect(regel(".cw-initiale::after")).toContain("left: 12%");
    expect(regel(".cw-initiale::after")).toContain("top: -14%");
    expect(regel(".cw-initiale--m::after, .cw-initiale--l::after")).toContain("top: -40%");
  });
});

describe("Schrittfolge", () => {
  const schritte = [
    { id: "a", label: "Berechnet" },
    { id: "b", label: "Geprüft" },
    { id: "c", label: "Gebucht" },
  ];
  it("markiert erledigt, aktuell und offen in Text und aria-current", () => {
    render(<Schrittfolge schritte={schritte} aktuell="b" aria-label="Status" />);
    const punkte = screen.getAllByRole("listitem");
    expect(punkte[0]!.textContent).toContain("erledigt");
    expect(punkte[1]!.getAttribute("aria-current")).toBe("step");
    expect(punkte[1]!.textContent).toContain("aktueller Schritt");
    expect(punkte[2]!.textContent).toContain("offen");
  });
  it("ohne aktuellen Schritt ist alles offen, englisch mit eigenen Texten", () => {
    render(<UiSprache sprache="en"><Schrittfolge schritte={schritte} aktuell={null} /></UiSprache>);
    for (const p of screen.getAllByRole("listitem")) expect(p.textContent).toContain("pending");
  });
});
