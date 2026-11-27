import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Auswahl, Feld, Textbereich } from "./index";

/** Passwortmanager bieten in Fachformularen nichts an; Zugangsfelder behalten ihre `autocomplete`-Tokens. */

const IGNORE = ["data-1p-ignore", "data-lpignore", "data-bwignore", "data-form-type"] as const;

describe("Feld und Passwortmanager", () => {
  it("setzt in Fachfeldern autocomplete=off und die Ignore-Attribute", () => {
    render(<Feld label="Fondsname" name="name" />);
    const feld = screen.getByLabelText("Fondsname");
    expect(feld.getAttribute("autocomplete")).toBe("off");
    expect(feld.getAttribute("data-lpignore")).toBe("true");
    expect(feld.getAttribute("data-form-type")).toBe("other");
    expect(feld.hasAttribute("data-1p-ignore")).toBe(true);
    expect(feld.hasAttribute("data-bwignore")).toBe(true);
  });

  it("schützt auch Auswahl und Textbereich", () => {
    render(
      <>
        <Auswahl label="Währung"><option>EUR</option></Auswahl>
        <Textbereich label="Bemerkung" />
      </>,
    );
    for (const label of ["Währung", "Bemerkung"]) {
      const feld = screen.getByLabelText(label);
      expect(feld.getAttribute("autocomplete")).toBe("off");
      expect(feld.getAttribute("data-lpignore")).toBe("true");
    }
  });

  it("lässt Zugangsfelder mit ihren Tokens für Passwortmanager offen", () => {
    render(
      <>
        <Feld zugang label="E-Mail-Adresse" type="email" autoComplete="username" />
        <Feld zugang label="Passwort" type="password" autoComplete="current-password" />
        <Feld zugang label="Neues Passwort" type="password" autoComplete="new-password" />
        <Feld zugang label="Code" autoComplete="one-time-code" />
      </>,
    );
    for (const [label, token] of [["E-Mail-Adresse", "username"], ["Passwort", "current-password"], ["Neues Passwort", "new-password"], ["Code", "one-time-code"]] as const) {
      const feld = screen.getByLabelText(label);
      expect(feld.getAttribute("autocomplete")).toBe(token);
      for (const attribut of IGNORE) expect(feld.hasAttribute(attribut)).toBe(false);
    }
  });
});
