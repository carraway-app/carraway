import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Kennwerte } from "./index";

describe("Kennwerte", () => {
  it("gliedert in Gruppen mit Überschrift und markiert Kopfzahl und ruhige Werte", () => {
    const { container } = render(
      <Kennwerte
        gruppen={[
          { titel: "Kapital", eintraege: [{ label: "Buchwert", wert: "1.000 €", primaer: true }, { label: "Zusage", wert: "–", ruhig: true, hinweis: "keine" }] },
          { titel: "Konditionen", eintraege: [{ label: "Zins", wert: "6 % fest" }] },
        ]}
      />,
    );
    expect(screen.getAllByRole("heading").map((h) => h.textContent)).toEqual(["Kapital", "Konditionen"]);
    expect(container.querySelectorAll("dt")).toHaveLength(3);
    expect(container.querySelector(".cw-kennwerte__eintrag--primaer dt")?.textContent).toBe("Buchwert");
    expect(container.querySelector(".cw-kennwerte__eintrag--ruhig .cw-kennwerte__hinweis")?.textContent).toBe("keine");
  });

  it("kennt Kompakt und gedämpft", () => {
    const { container } = render(<Kennwerte kompakt gedaempft gruppen={[{ eintraege: [{ label: "A", wert: "1" }] }]} />);
    expect(container.firstElementChild?.className).toContain("cw-kennwerte--kompakt");
    expect(container.firstElementChild?.className).toContain("cw-kennwerte--gedaempft");
    expect(screen.queryByRole("heading")).toBeNull();
  });
});
