import { describe, expect, it } from "vitest";
import type { Ich } from "../api/anmeldung";
import { de } from "../i18n/de";
import { ichDaten } from "../test/hilfen";
import { brotkruemel, fondsNavigation, globaleNavigation, type Kontext } from "./navigation";

const als = (zusatz: Partial<Ich>) => ({ ...ichDaten, globalVerwalter: false, investor: false, rollen: [{ fondsId: "f1", rolle: "bearbeiter" as const }], ...zusatz }) as unknown as Ich;
const global = (ich: Ich) => globaleNavigation(de, ich).flatMap((g) => g.items.map((i) => i.id));
const imFonds = (ich: Ich, portfolio = true) => fondsNavigation(de, ich, "f1", portfolio).flatMap((g) => g.items.map((i) => i.id));

describe("Seitenleiste im Kontext", () => {
  it("global: Fonds, Dashboard, Dealflow, Kontakte, Register, Datenübernahme; keine Finanzbereiche", () => {
    expect(global(als({ bereiche: null }))).toEqual(["fonds", "dashboard", "dealflow", "kontakte", "register", "import"]);
  });

  it("im Fonds: Portfolio, Kapital, Finanzen, Fonds mit höchstens 14 Einträgen; Fonds und Portfolio sind ein Ziel", () => {
    const gruppen = fondsNavigation(de, als({ bereiche: null }), "f1", true);
    expect(gruppen.map((g) => g.id)).toEqual(["portfolio", "kapital", "finanzen", "fonds"]);
    const ids = gruppen.flatMap((g) => g.items.map((i) => i.id));
    expect(ids).toEqual(["uebersicht", "kennzahlen", "planung", "bewertungsrunde", "zielfonds", "investoren", "journal", "belege", "zinsen", "buchhaltung", "meldungen", "berichte", "stammdaten", "dokumente"]);
    expect(ids.length).toBeLessThanOrEqual(14);
    // Die Finanzbereiche tragen den Fonds in der Adresse.
    expect(gruppen[2]!.items.find((i) => i.id === "belege")!.ziel).toMatchObject({ to: "/vouchers", search: { fondsId: "f1" } });
  });

  it("nach Bereichen: ohne Portfolio des Fonds entfallen dessen Einträge, Gruppen ohne Eintrag entfallen", () => {
    expect(global(als({ bereiche: ["kontakte"] }))).toEqual(["fonds", "kontakte", "register"]);
    expect(imFonds(als({ bereiche: ["finanzen", "berichte"] }), false)).toEqual(["investoren", "journal", "belege", "zinsen", "buchhaltung", "berichte", "stammdaten"]);
  });

  it("aktiv nach Pfad und Reiter: Planung umfasst Szenarien und Reserven, Investoren den Reiter Kapital der Fondsverwaltung", () => {
    const gruppen = fondsNavigation(de, als({ bereiche: null }), "f1", true);
    const aktiv = (pfad: string, tab?: string) => gruppen.flatMap((g) => g.items).filter((i) => i.aktiv({ pfad, tab })).map((i) => i.id);
    expect(aktiv("/funds/f1")).toEqual(["uebersicht"]);
    expect(aktiv("/funds/f1/reserves")).toEqual(["planung"]);
    expect(aktiv("/funds", "kapital")).toEqual(["investoren"]);
    expect(aktiv("/funds")).toEqual(["stammdaten"]);
    expect(aktiv("/funds", "dokumente")).toEqual(["dokumente"]);
    expect(aktiv("/funds/f1/interest")).toEqual(["zinsen"]);
    expect(aktiv("/interest-runs/z1")).toEqual(["zinsen"]);
  });

  it("Brotkrumen: Pfad des Kontexts, aktiver Eintrag, Art der Seite", () => {
    const kontext: Kontext = { art: "fonds", gruppen: fondsNavigation(de, als({ bereiche: null }), "f1", true), pfad: [{ label: "Fonds" }, { label: "Beispielfonds I" }] };
    expect(brotkruemel(de, { pfad: "/vouchers/b1" }, kontext).map((k) => k.label)).toEqual(["Fonds", "Beispielfonds I", "Belege", "Beleg"]);
    const globalerKontext: Kontext = { art: "global", gruppen: globaleNavigation(de, als({ bereiche: null })), pfad: [] };
    expect(brotkruemel(de, { pfad: "/deals/d1" }, globalerKontext).map((k) => k.label)).toEqual(["Dealflow & CRM", "Dealflow", "Deal"]);
  });
});
