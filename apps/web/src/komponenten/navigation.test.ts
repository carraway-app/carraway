import { describe, expect, it } from "vitest";
import type { Ich } from "../api/anmeldung";
import { de } from "../i18n/de";
import { ichDaten } from "../test/hilfen";
import { navigationsgruppen } from "./navigation";

const ids = (ich: Ich) => navigationsgruppen(de, ich, "f1", { to: "/" }).flatMap((g) => g.items.map((i) => i.id));
const als = (zusatz: Partial<Ich>) => ({ ...ichDaten, globalVerwalter: false, investor: false, rollen: [{ fondsId: "f1", rolle: "bearbeiter" as const }], ...zusatz }) as unknown as Ich;

describe("Seitenleiste nach Bereichen (Rollen der Nutzergruppen)", () => {
  it("ohne Gruppe (bereiche null) alle Einträge wie bisher", () => {
    expect(ids(als({ bereiche: null }))).toEqual(["fonds", "dashboard", "portfolio", "dealflow", "kontakte", "journal", "zinsen", "belege", "buchhaltung", "meldungen", "berichte", "register", "import"]);
  });

  it("nur Kontakte: Fondsliste, Kontakte und Register; keine Finanzen, kein Portfolio, kein Dealflow", () => {
    expect(ids(als({ bereiche: ["kontakte"] }))).toEqual(["fonds", "kontakte", "register"]);
  });

  it("Finanzen und Berichte: Gruppen ohne Eintrag entfallen", () => {
    const gruppen = navigationsgruppen(de, als({ bereiche: ["finanzen", "berichte"] }), "f1", { to: "/" });
    expect(gruppen.map((g) => g.id)).toEqual(["uebersicht", "finanzen"]);
    expect(gruppen[1]!.items.map((i) => i.id)).toEqual(["journal", "zinsen", "belege", "buchhaltung", "berichte"]);
  });
});
