import { describe, expect, it } from "vitest";
import { datenbankNameAusUrl, setupZiele, testDatenbankUrl, verlangeDatenbankUrl } from "../schutz";

describe("Schutz vor der falschen Datenbank", () => {
  it("bricht ohne ausdrückliche Adresse ab", () => {
    expect(() => verlangeDatenbankUrl(["DATABASE_URL"], "Seed", {})).toThrow(/Seed: DATABASE_URL ist nicht gesetzt/);
    expect(() => verlangeDatenbankUrl(["DATABASE_URL_EIGENTUEMER", "DATABASE_URL"], "Migration", { DATABASE_URL: "  " })).toThrow(/Migration/);
  });

  it("nimmt die erste gesetzte Adresse", () => {
    const env = { DATABASE_URL_EIGENTUEMER: "postgres://a@h/x", DATABASE_URL: "postgres://b@h/y" };
    expect(verlangeDatenbankUrl(["DATABASE_URL_EIGENTUEMER", "DATABASE_URL"], "Migration", env)).toBe("postgres://a@h/x");
  });

  it("verlangt für Tests eine ausdrückliche Adresse", () => {
    expect(() => testDatenbankUrl({}, "setup:test")).toThrow(/setup:test: DATABASE_URL_TEST ist nicht gesetzt/);
  });

  it("lehnt eine Test-Adresse ohne test im Namen ab, weil die Tests Tabellen leeren", () => {
    expect(() => testDatenbankUrl({ DATABASE_URL_TEST: "postgres://u:p@localhost:5432/carraway_dev" })).toThrow(/nicht "test" enthält/);
    expect(() => testDatenbankUrl({ DATABASE_URL_TEST: "postgres://u:p@localhost:5432/produktion" })).toThrow(/abgelehnt/);
  });

  it("lässt eine Test-Datenbank zu", () => {
    const url = "postgres://u:p@localhost:5432/carraway_test_x";
    expect(testDatenbankUrl({ DATABASE_URL_TEST: url })).toBe(url);
    expect(datenbankNameAusUrl(url)).toBe("carraway_test_x");
  });

  it("meldet eine ungültige Adresse verständlich", () => {
    expect(() => testDatenbankUrl({ DATABASE_URL_TEST: "kein url" })).toThrow(/keine gültige URL/);
  });
});

describe("db:setup ohne --nur-test", () => {
  const dev = "postgres://u:p@localhost:5432/carraway_n";
  const test = "postgres://u:p@localhost:5432/carraway_test_n";

  it("bricht ohne ausdrückliche Ziele ab und nennt beide Wege", () => {
    expect(() => setupZiele([], {})).toThrow(/DATABASE_URL und DATABASE_URL_TEST sind nicht gesetzt.*--lokal-standard/s);
    expect(() => setupZiele([], { DATABASE_URL: dev })).toThrow(/DATABASE_URL_TEST ist nicht gesetzt/);
    expect(() => setupZiele([], { DATABASE_URL_TEST: test })).toThrow(/DATABASE_URL ist nicht gesetzt/);
  });

  it("nimmt die Ziele aus der Umgebung und prüft den Namen der Test-Datenbank", () => {
    expect(setupZiele([], { DATABASE_URL: dev, DATABASE_URL_TEST: test })).toEqual({ quelle: "umgebung", entwicklung: dev, test });
    expect(() => setupZiele([], { DATABASE_URL: dev, DATABASE_URL_TEST: dev })).toThrow(/nicht "test" enthält/);
  });

  it("nimmt die festen lokalen Datenbanken nur mit --lokal-standard, auch gegen eine gesetzte Umgebung", () => {
    const ziele = setupZiele(["--lokal-standard"], {});
    expect(ziele.quelle).toBe("lokal-standard");
    expect(datenbankNameAusUrl(ziele.entwicklung)).toBe("carraway_dev");
    expect(datenbankNameAusUrl(ziele.test)).toBe("carraway_test");
    expect(setupZiele(["--lokal-standard"], { DATABASE_URL: dev, DATABASE_URL_TEST: test }).quelle).toBe("lokal-standard");
  });
});
