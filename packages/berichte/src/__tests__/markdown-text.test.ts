import { describe, expect, it } from "vitest";
import { markdownZuText } from "../markdown-text";

describe("markdownZuText (Kopf- und Fußtexte im PDF)", () => {
  it("entfernt Auszeichnung, behält Listenpunkte und Links", () => {
    const t = markdownZuText("# Titel\n\nText mit **fett**, *kursiv*, `code` und snake_case_name.\n\n* eins\n+ zwei\n- drei\n\n> Zitat\n\n[Seite](https://beispiel.test) ![Logo](https://fremd.test/x.png)");
    expect(t).toBe("Titel\n\nText mit fett, kursiv, code und snake_case_name.\n\n- eins\n- zwei\n- drei\n\nZitat\n\nSeite (https://beispiel.test) Logo");
  });

  it("lässt HTML und Typst-Zeichen unverändert (sie werden im PDF nie als Auszeichnung gelesen)", () => {
    expect(markdownZuText('<b>x</b> #panic("x") \\*stern\\*')).toBe('<b>x</b> #panic("x") *stern*');
  });

  it("gibt Codeblöcke ohne Zaun aus und kürzt Leerraum", () => {
    expect(markdownZuText("\n```\na = 1\n```\n")).toBe("a = 1");
  });
});
