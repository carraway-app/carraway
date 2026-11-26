import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HouseIcon } from "./icons";

describe("Zeichenmodul", () => {
  it("zeichnet Light mit Standardgröße, data-glyph und ohne Vorlesetext", () => {
    const { container } = render(<HouseIcon />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("data-glyph")).toBe("House");
    expect(svg?.getAttribute("width")).toBe("18");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.querySelector("path")).not.toBeNull();
  });

  it("nimmt size und className an", () => {
    const { container } = render(<HouseIcon size={24} className="x" />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("24");
    expect(svg?.classList.contains("x")).toBe(true);
  });
});
