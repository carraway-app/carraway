import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Markdown, Textbereich, parseMarkdown, sichereUrl } from "./index";

const html = (text: string) => render(<Markdown text={text} />).container.innerHTML;

describe("Markdown: Darstellung", () => {
  it("setzt Absätze, Zeilenumbrüche, fett, kursiv und Code", () => {
    const { container } = render(<Markdown text={"Eins **fett** und *kursiv* und `code`\nzweite Zeile\n\nNeuer Absatz mit snake_case_name"} />);
    expect(container.querySelectorAll("p")).toHaveLength(2);
    expect(container.querySelector("strong")?.textContent).toBe("fett");
    expect(container.querySelector("em")?.textContent).toBe("kursiv");
    expect(container.querySelector("code")?.textContent).toBe("code");
    expect(container.querySelector("br")).not.toBeNull();
    expect(container.querySelectorAll("p")[1]!.textContent).toBe("Neuer Absatz mit snake_case_name");
  });

  it("kennt Listen (auch verschachtelt), Überschriften, Zitate und Codeblöcke", () => {
    const { container } = render(<Markdown text={"# Titel\n\n- a\n- b\n  - b1\n- c\n\n1. eins\n2. zwei\n\n> zitiert\n\n```\n<b>roh</b>\n```"} />);
    expect(container.querySelector(".cw-md__kopf")?.textContent).toBe("Titel");
    expect(container.querySelectorAll("ul > li")).toHaveLength(4);
    expect(container.querySelector("ul ul li")?.textContent).toBe("b1");
    expect(container.querySelectorAll("ol > li")).toHaveLength(2);
    expect(container.querySelector("blockquote")?.textContent).toBe("zitiert");
    expect(container.querySelector("pre code")?.textContent).toBe("<b>roh</b>");
    expect(container.querySelector("pre b")).toBeNull();
  });

  it("gibt Escapes und offene Auszeichnung unverändert als Text aus", () => {
    expect(render(<Markdown text={"\\*kein kursiv\\* und 2 * 3 * 4"} />).container.textContent).toBe("*kein kursiv* und 2 * 3 * 4");
  });

  it("gibt bei leerem Text nichts aus", () => {
    expect(render(<Markdown text="  " />).container.innerHTML).toBe("");
    expect(render(<Markdown text={null} />).container.innerHTML).toBe("");
  });

  it("lässt renderLink eigene Adressen darstellen (Erwähnung mit „@“)", () => {
    render(<Markdown text="siehe @[Beispiel GmbH](person:1)" renderLink={(href, kinder) => (href.startsWith("person:") ? <b data-ziel={href}>{kinder}</b> : undefined)} />);
    const b = document.querySelector("b")!;
    expect(b.textContent).toBe("@Beispiel GmbH");
    expect(b.getAttribute("data-ziel")).toBe("person:1");
  });
});

describe("Markdown: Sicherheit", () => {
  it("führt kein Skript und kein HTML aus: Tags bleiben Text", () => {
    const quelle = '<script>window.__x = 1</script><img src=x onerror="window.__x = 2"><b>fett?</b> <a href="javascript:alert(1)">x</a>';
    const { container } = render(<Markdown text={quelle} />);
    expect(container.querySelector("script, img, b, a")).toBeNull();
    expect(container.textContent).toBe(quelle);
    expect((window as unknown as { __x?: number }).__x).toBeUndefined();
  });

  it("rendert javascript:, data: und vbscript: nicht als Link", () => {
    for (const ziel of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html;base64,AAAA", "vbscript:x", "//evil.example/pfad", " javascript:alert(1)"]) {
      const { container } = render(<Markdown text={`[Klick](${ziel})`} />);
      expect(container.querySelector("a")).toBeNull();
      expect(container.textContent).toBe("Klick");
    }
    expect(sichereUrl("https://beispiel.test/a?b=1")).toBe(true);
    expect(sichereUrl("mailto:a@beispiel.test")).toBe(true);
    expect(sichereUrl("/organisationen/1")).toBe(true);
    expect(sichereUrl("//evil.test")).toBe(false);
  });

  it("setzt rel=noopener noreferrer und öffnet externe Links in neuem Tab", () => {
    render(<Markdown text="[Seite](https://beispiel.test) und https://beispiel.test/weiter, danach [intern](/hilfe)" />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(3);
    for (const l of links.slice(0, 2)) {
      expect(l.getAttribute("rel")).toBe("noopener noreferrer");
      expect(l.getAttribute("target")).toBe("_blank");
    }
    expect(links[1]!.getAttribute("href")).toBe("https://beispiel.test/weiter");
    expect(links[2]!.getAttribute("target")).toBeNull();
  });

  it("lädt keine Bilder, auch nicht von fremden Hosts", () => {
    const { container } = render(<Markdown text={"![Logo](https://fremd.test/pixel.png) und ![x](/lokal.png)"} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toBe("Logo und x");
  });

  it("hält die Schachtelungstiefe begrenzt, ohne zu hängen", () => {
    const tief = `${"> ".repeat(500)}x\n${"*".repeat(300)}a${"*".repeat(300)}\n${"- ".repeat(300)}y`;
    expect(() => parseMarkdown(tief)).not.toThrow();
    expect(html(tief)).toContain("x");
  });
});

describe("Textbereich mit Markdown", () => {
  it("zeigt die Vorschau auf Wunsch, behält den Quelltext im Feld und lädt nichts Unsicheres", async () => {
    render(<Textbereich label="Notiz" markdown defaultValue={"**fett** <script>x</script>"} />);
    const feld = screen.getByLabelText("Notiz") as HTMLTextAreaElement;
    fireEvent.click(screen.getByRole("button", { name: "Vorschau" }));
    expect((await screen.findByText("fett")).tagName).toBe("STRONG");
    expect(document.querySelector("script")).toBeNull();
    expect(feld.value).toBe("**fett** <script>x</script>");
    expect(feld.hidden).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Bearbeiten" }));
    expect(feld.hidden).toBe(false);
  });

  it("bleibt ohne markdown ein schlichtes Feld ohne Umschalter", () => {
    render(<Textbereich label="Notiz" />);
    expect(screen.queryByRole("button", { name: "Vorschau" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Notiz"), { target: { value: "x" } });
  });
});
