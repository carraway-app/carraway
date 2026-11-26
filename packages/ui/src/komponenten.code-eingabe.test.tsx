import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { CodeEingabe } from "./index";

function Probe({ onFertig, fehler }: { onFertig?: (c: string) => void; fehler?: string }) {
  const [code, setCode] = useState("");
  return <CodeEingabe label="Code aus der Authenticator-App" ziffer={(n, v) => `Ziffer ${n} von ${v}`} value={code} onChange={setCode} onFertig={onFertig} fehler={fehler} name="code" />;
}

const feld = (nr: number) => screen.getByLabelText(`Ziffer ${nr} von 6`) as HTMLInputElement;
const werte = () => Array.from({ length: 6 }, (_, i) => feld(i + 1).value).join("|");
const tippe = (nr: number, text: string) => fireEvent.change(feld(nr), { target: { value: text } });
const einfuegen = (nr: number, text: string) => fireEvent.paste(feld(nr), { clipboardData: { getData: () => text } });

describe("CodeEingabe", () => {
  it("ist eine beschriftete Gruppe mit sechs Feldern, Ziffer n von 6, numerischer Tastatur und one-time-code am ersten Feld", () => {
    render(<Probe />);
    const gruppe = screen.getByRole("group", { name: "Code aus der Authenticator-App" });
    expect(gruppe.querySelectorAll("input")).toHaveLength(6);
    expect(feld(1).getAttribute("inputmode")).toBe("numeric");
    expect(feld(1).autocomplete).toBe("one-time-code");
    expect(feld(2).autocomplete).toBe("off");
    expect(feld(6)).toBeTruthy();
  });

  it("nimmt nur Ziffern an und springt nach jeder Ziffer ins nächste Feld", () => {
    render(<Probe />);
    tippe(1, "a");
    expect(werte()).toBe("|||||");
    tippe(1, "4");
    expect(document.activeElement).toBe(feld(2));
    tippe(2, "7");
    expect(werte()).toBe("4|7||||");
    expect(document.activeElement).toBe(feld(3));
  });

  it("Rücktaste löscht die Ziffer; im leeren Feld springt sie zurück und löscht dort", () => {
    render(<Probe />);
    tippe(1, "1");
    tippe(2, "2");
    expect(document.activeElement).toBe(feld(3));
    fireEvent.keyDown(feld(3), { key: "Backspace" });
    expect(werte()).toBe("1|||||");
    expect(document.activeElement).toBe(feld(2));
    fireEvent.keyDown(feld(2), { key: "Backspace" });
    expect(werte()).toBe("|||||");
    expect(document.activeElement).toBe(feld(1));
  });

  it("Pfeiltasten wechseln das Feld, aber nie hinter das erste leere", () => {
    render(<Probe />);
    tippe(1, "1");
    tippe(2, "2");
    fireEvent.keyDown(feld(3), { key: "ArrowLeft" });
    expect(document.activeElement).toBe(feld(2));
    fireEvent.keyDown(feld(2), { key: "ArrowRight" });
    expect(document.activeElement).toBe(feld(3));
    fireEvent.keyDown(feld(3), { key: "ArrowRight" });
    expect(document.activeElement).toBe(feld(3));
    fireEvent.keyDown(feld(1), { key: "ArrowLeft" });
    expect(document.activeElement).toBe(feld(1));
  });

  it("Einfügen verteilt einen Code auch mit Leerzeichen auf alle Felder und schickt automatisch ab", () => {
    const fertig = vi.fn();
    render(<Probe onFertig={fertig} />);
    einfuegen(1, " 123 456 ");
    expect(werte()).toBe("1|2|3|4|5|6");
    expect(fertig).toHaveBeenCalledTimes(1);
    expect(fertig).toHaveBeenCalledWith("123456");
  });

  it("Einfügen in ein späteres Feld füllt von dort; zu viele Ziffern werden abgeschnitten", () => {
    render(<Probe />);
    tippe(1, "9");
    einfuegen(2, "87");
    expect(werte()).toBe("9|8|7|||");
    einfuegen(3, "1234567890");
    expect(werte()).toBe("1|2|3|4|5|6");
  });

  it("schickt erst beim sechsten Feld ab, einmal, und die ganze Eingabe auf einmal (Autofill im ersten Feld) zählt ebenso", () => {
    const fertig = vi.fn();
    render(<Probe onFertig={fertig} />);
    for (const [i, z] of ["1", "2", "3", "4", "5"].entries()) tippe(i + 1, z);
    expect(fertig).not.toHaveBeenCalled();
    tippe(6, "6");
    expect(fertig).toHaveBeenCalledWith("123456");
    expect(fertig).toHaveBeenCalledTimes(1);
  });

  it("Autofill des ganzen Codes in das erste Feld verteilt ihn", () => {
    const fertig = vi.fn();
    render(<Probe onFertig={fertig} />);
    tippe(1, "654321");
    expect(werte()).toBe("6|5|4|3|2|1");
    expect(fertig).toHaveBeenCalledWith("654321");
  });

  it("ersetzt eine Ziffer im belegten Feld", () => {
    render(<Probe />);
    einfuegen(1, "111111");
    tippe(3, "13");
    expect(werte()).toBe("1|1|3|1|1|1");
  });

  it("markiert die Felder bei einem Fehler als ungültig und verbindet die Meldung mit der Gruppe", () => {
    render(<Probe fehler="Der Code stimmt nicht." />);
    expect(feld(1).getAttribute("aria-invalid")).toBe("true");
    const gruppe = screen.getByRole("group");
    expect(gruppe.getAttribute("aria-describedby")).toBe(screen.getByText("Der Code stimmt nicht.").id);
  });
});
