import { describe, expect, it } from "vitest";
import { Abrufkontext, leseVorsystem } from "../vorsystem/adapter";
import { bildeAb } from "../vorsystem/abbilden";
import { referenzAdapter } from "../vorsystem/referenz";
import { beispielApi } from "../vorsystem/referenz-api";
import { domainVon, fuehreZusammen, nameZumVergleich } from "../vorsystem/zusammenfuehren";

const lese = () => leseVorsystem(referenzAdapter, new Abrufkontext(beispielApi()), { fonds: [] });
const lies = async () => (await lese()).auszuege;

describe("Zusammenführen", () => {
  it("normalisiert Domain und Namen", () => {
    expect(domainVon("https://www.Kiesel-Analytics.example/about")).toBe("kiesel-analytics.example");
    expect(domainVon("kein host")).toBeNull();
    expect(nameZumVergleich("Kiesel Analytics GmbH")).toBe(nameZumVergleich("Kiesel  Analytics"));
  });

  it("führt Unternehmen über Fonds hinweg einmal und leitet Dubletten der Quelle um", async () => {
    const { bestand, umleitungen } = fuehreZusammen(await lies());
    expect(bestand.organisationen.map((o) => o.quellId)).toEqual(["c-1", "c-2", "x-1"]);
    expect(umleitungen).toEqual([{ art: "organisation", von: "c-2b", nach: "c-2", grund: "domain" }]);
    expect(bestand.beteiligungen.find((b) => b.quellId === "i-b2")!.organisationId).toBe("c-2");
    expect(bestand.beteiligungen.filter((b) => b.organisationId === "c-1").map((b) => b.fondsId)).toEqual(["f-1", "f-2"]);
    expect(bestand.runden).toHaveLength(1);
    expect(bestand.personen).toHaveLength(1);
  });

  it("hält getrennte Unternehmen auseinander", async () => {
    const { bestand, umleitungen } = fuehreZusammen(await lies(), { getrennt: ["c-2b"] });
    expect(umleitungen).toEqual([]);
    expect(bestand.organisationen.map((o) => o.quellId)).toContain("c-2b");
  });
});

describe("Abbilden auf die Importvorlage", () => {
  it("verwendet Quell-IDs als Fachschlüssel und meldet Zusammenführungen", async () => {
    const { zeilen, befunde } = bildeAb(await lese(), { quelle: "example" });
    expect(zeilen.fonds!.map((f) => f.fonds_kurzname)).toEqual(["BSP-1", "Beispielfonds Zwei"]);
    expect(zeilen.organisationen!.map((o) => o.organisation_schluessel)).toEqual(["example:c-1", "example:c-2", "example:x-1"]);
    expect(zeilen.beteiligungen!.find((b) => b.beteiligung_schluessel === "example:i-b2")).toMatchObject({ organisation_schluessel: "example:c-2", fonds_kurzname: "Beispielfonds Zwei", instrument: "wandeldarlehen" });
    expect(befunde.map((b) => b.code)).toContain("VORSYSTEM_ZUSAMMENGEFUEHRT");
  });
});
