import { describe, expect, it } from "vitest";
import { sichereUrl } from "./sichereUrl";

describe("sichereUrl", () => {
  it("lässt absolute http- und https-Adressen durch", () => {
    expect(sichereUrl("https://example.org")).toBe("https://example.org/");
    expect(sichereUrl("http://example.org/pfad?x=1")).toBe("http://example.org/pfad?x=1");
    expect(sichereUrl("  https://example.org  ")).toBe("https://example.org/");
    expect(sichereUrl("HTTPS://EXAMPLE.ORG")).toBe("https://example.org/");
  });

  it("weist andere Schemata zurück, auch getarnte", () => {
    for (const roh of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      " javascript:alert(1)",
      "java\tscript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
      "ftp://example.org",
      "mailto:a@example.org",
      "blob:https://example.org/1",
    ]) {
      expect(sichereUrl(roh), roh).toBeNull();
    }
  });

  it("weist relative Angaben, Text und leere Werte zurück", () => {
    for (const roh of ["/pfad", "//example.org", "example.org", "kein link", "", "   ", null, undefined]) {
      expect(sichereUrl(roh), String(roh)).toBeNull();
    }
  });

  it("gibt die geparste Adresse zurück, nicht die Eingabe", () => {
    expect(sichereUrl('https://example.org/"onmouseover="x')).toBe("https://example.org/%22onmouseover=%22x");
  });
});
