import { describe, expect, it } from "vitest";
import { Abrufkontext, erlaubterUrsprung, leseAlleSeiten, leseVorsystem, QuellFehler } from "../vorsystem/adapter";
import { referenzAdapter } from "../vorsystem/referenz";
import { BeispielStoerung, beispielApi, beispielDaten } from "../vorsystem/referenz-api";

const ohneWarten = () => {
  const gewartet: number[] = [];
  return { gewartet, warte: async (ms: number) => void gewartet.push(ms) };
};
const optionen = (w: ReturnType<typeof ohneWarten>) => ({
  warte: w.warte,
  voruebergehend: (f: unknown) => f instanceof BeispielStoerung && f.warteSekunden === undefined,
  wartezeit: (f: unknown) => (f instanceof BeispielStoerung ? f.warteSekunden : undefined),
});

describe("Abrufkontext", () => {
  it("wiederholt vorübergehende Fehler mit wachsender Wartezeit und hält eine verlangte Wartezeit ein", async () => {
    const w = ohneWarten();
    const api = beispielApi(beispielDaten(), { stoerungen: [1, 2], drosselungen: [3] });
    const k = new Abrufkontext(api, optionen(w));
    const fonds = await referenzAdapter.leseFonds(k);
    expect(fonds.map((f) => f.quellId)).toEqual(["f-1", "f-2"]);
    expect(w.gewartet).toEqual([500, 1000, 2000]);
    expect(k.zaehler.wiederholungen).toBe(3);
  });

  it("gibt nach der letzten Wiederholung auf und wiederholt dauerhafte Fehler nicht", async () => {
    const w = ohneWarten();
    const k = new Abrufkontext(beispielApi(beispielDaten(), { stoerungen: [1, 2, 3] }), { ...optionen(w), versuche: 3 });
    await expect(referenzAdapter.leseFonds(k)).rejects.toBeInstanceOf(BeispielStoerung);
    let aufrufe = 0;
    const dauerhaft = new Abrufkontext(async () => { aufrufe++; throw new Error("forbidden"); }, optionen(w));
    await expect(dauerhaft.rufe("/graphql")).rejects.toThrow("forbidden");
    expect(aufrufe).toBe(1);
  });

  it("begrenzt die Rate der Anfragen", async () => {
    const w = ohneWarten();
    let jetzt = 0;
    const k = new Abrufkontext(async () => ({}), { warte: async (ms) => { w.gewartet.push(ms); jetzt += ms; }, jetzt: () => jetzt, rate: { anfragen: 2, sekunden: 1 } });
    for (let i = 0; i < 4; i++) await k.rufe("/x");
    expect(w.gewartet).toEqual([500, 500, 500]);
  });
});

describe("erlaubterUrsprung", () => {
  const a = { standardUrsprung: "https://api.example.com", erlaubteHosts: ["*.example.org", "fest.example.net"] };
  it("erlaubt nur https-Ursprünge des Adapters ohne Pfad, Port oder Anmeldedaten", () => {
    expect(erlaubterUrsprung(a, "https://api.example.com")).toBe("https://api.example.com");
    expect(erlaubterUrsprung(a, "https://kunde.example.org/")).toBe("https://kunde.example.org");
    expect(erlaubterUrsprung(a, "https://fest.example.net")).toBe("https://fest.example.net");
    for (const falsch of ["http://api.example.com", "https://example.org", "https://evilexample.org", "https://kunde.example.org.evil.test", "https://api.example.com:444", "https://u:p@api.example.com", "https://api.example.com/v1", "kein url"]) {
      expect(erlaubterUrsprung(a, falsch)).toBeNull();
    }
    expect(erlaubterUrsprung({}, "https://api.example.com")).toBeNull();
  });
});

describe("leseAlleSeiten", () => {
  it("liest alle Seiten und bricht bei einem wiederholten Cursor ab", async () => {
    expect(await leseAlleSeiten(async (c) => ({ eintraege: [c ?? "0"], weiter: c === "2" ? null : String(Number(c ?? 0) + 1) }))).toEqual(["0", "1", "2"]);
    await expect(leseAlleSeiten(async () => ({ eintraege: [1], weiter: "a" }))).rejects.toEqual(new QuellFehler("invalid_pagination"));
  });
});

describe("Referenz-Adapter", () => {
  it("liest je Fonds Beteiligungen mit verschachtelten Unternehmen und Vorgängen, Runden, Kennzahlen und Summen", async () => {
    const api = beispielApi();
    const { auszuege } = await leseVorsystem(referenzAdapter, new Abrufkontext(api), { fonds: [] });
    expect(auszuege.map((a) => a.fonds.quellId)).toEqual(["f-1", "f-2"]);
    const [eins, zwei] = auszuege;
    expect(eins!.beteiligungen.map((b) => [b.quellId, b.instrument])).toEqual([["i-a1", "offene_beteiligung"], ["i-a2", "darlehen"]]);
    // Die Vorgänge des Darlehens kommen über mehrere Seiten der verschachtelten Liste.
    expect(eins!.vorgaenge.filter((v) => v.beteiligungId === "i-a2")).toHaveLength(9);
    expect(api.anfragen.some((a) => a.query.startsWith("query InvestmentTransactions"))).toBe(true);
    expect(eins!.runden[0]!.positionen).toEqual([
      { fondsId: "f-1", betrag: "1000000.00", anteile: 100000, rolle: "lead" },
      { fondsId: "f-2", betrag: "500000.00", anteile: 50000, rolle: "co" },
      { investorId: "x-1", betrag: "500000.00", anteile: 50000, rolle: "co" },
    ]);
    expect(eins!.organisationen.find((o) => o.quellId === "x-1")).toMatchObject({ art: "investor" });
    expect(eins!.kontrollsummen).toContainEqual({ fondsId: "f-1", beteiligungId: "i-a2", groesse: "auszahlungen", betrag: "200000.00" });
    expect(zwei!.vorgaenge.find((v) => v.quellId === "t-b2-3")).toMatchObject({ art: "wandlung" });
    expect(zwei!.kennzahlen).toHaveLength(2);
  });

  it("liest nur gewählte Fonds und meldet unbekannte", async () => {
    const { auszuege } = await leseVorsystem(referenzAdapter, new Abrufkontext(beispielApi()), { fonds: ["f-2"] });
    expect(auszuege.map((a) => a.fonds.quellId)).toEqual(["f-2"]);
    await expect(leseVorsystem(referenzAdapter, new Abrufkontext(beispielApi()), { fonds: ["f-9"] })).rejects.toEqual(new QuellFehler("source_fund_not_found"));
  });

  it("verwirft unbekannte Quellwerte nicht still", async () => {
    const daten = beispielDaten();
    daten.investments[0]!.instrument = "MYSTERY";
    await expect(leseVorsystem(referenzAdapter, new Abrufkontext(beispielApi(daten)), { fonds: ["f-1"] })).rejects.toEqual(new QuellFehler("source_value_unknown"));
  });
});
