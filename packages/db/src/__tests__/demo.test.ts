import { describe, expect, it } from "vitest";
import { paiDatenpunkte } from "@carraway/rechenkern";
import { demoSpracheAus, erzeugeDemodaten } from "../demo/index";
import { erzeugeBuchhaltung } from "../demo/buchhaltung";
import { cent } from "./hilfen";

const daten = erzeugeDemodaten({ seed: 1 });
const summe = <T>(liste: T[], wert: (x: T) => number) => liste.reduce((s, x) => s + wert(x), 0);

describe("Demo-Generator: Determinismus", () => {
  it("gleicher Seed ergibt gleiche Daten", () => {
    expect(erzeugeDemodaten({ seed: 1 })).toEqual(daten);
    expect(erzeugeDemodaten({ seed: 42 })).toEqual(erzeugeDemodaten({ seed: 42 }));
  });

  it("anderer Seed ergibt andere Daten", () => {
    expect(erzeugeDemodaten({ seed: 2 })).not.toEqual(daten);
  });
});

describe("Demo-Generator: Mengen-Referenz (umfang.zahlungen)", () => {
  it("ergänzt genau die gewünschte Zahl Zahlungen, ohne die übrigen Daten zu ändern, und bleibt deterministisch", () => {
    const mehr = erzeugeDemodaten({ seed: 1, umfang: { zahlungen: 1234 } });
    // Die zusätzlichen Zahlungen verbrauchen Zufallszahlen vor den Runden; Runden, Instrumente und deren Buchungen (Portfolio-Modell) können deshalb von
    // der Fassung ohne Zahlungen abweichen. Beteiligungen und die Zahlungen selbst sind genau bestimmt.
    const neu = mehr.vorgaenge.filter((v) => v.bemerkung === "Zahlung (Mengen-Referenz)");
    expect(neu).toHaveLength(1234);
    expect(mehr.vorgaenge.slice(-1234)).toEqual(neu);
    expect(daten.vorgaenge.some((v) => v.bemerkung === "Zahlung (Mengen-Referenz)")).toBe(false);
    expect(mehr.beteiligungen).toEqual(daten.beteiligungen);
    expect(erzeugeDemodaten({ seed: 1, umfang: { zahlungen: 1234 } })).toEqual(mehr);
    expect(neu.every((v) => v.art === "zins" && Number(v.betrag) > 0)).toBe(true);
    const bis = new Map(mehr.beteiligungen.map((b) => [b.id, b]));
    for (const v of neu) expect(v.valuta > (bis.get(v.beteiligungId)?.erstinvestment as string) && v.valuta <= "2026-09-30").toBe(true);
  });
});

describe("Demo-Generator: Kennzahlen der Unternehmen", () => {
  it("bestätigte Ist- und Plan-Werte für vier Quartale bei sechs aktiven Unternehmen, je Fonds vier ausgewählte Kennzahlen", () => {
    expect(daten.fondsKennzahlen).toHaveLength(daten.fonds.length * 4);
    expect(daten.kennzahlWerte).toHaveLength(6 * 4 * 2 * 4);
    expect(daten.kennzahlWerte.every((w) => w.status === "bestaetigt" && w.bestaetigtAm && w.periodeBeginn < w.periodeEnde)).toBe(true);
    const aktiv = new Set(daten.beteiligungen.filter((b) => b.status === "aktiv").map((b) => b.id));
    expect(daten.kennzahlWerte.every((w) => aktiv.has(w.beteiligungId))).toBe(true);
    expect(new Set(daten.kennzahlWerte.map((w) => w.szenario))).toEqual(new Set(["ist", "plan"]));
    expect(new Set(daten.kennzahlWerte.map((w) => w.periodeEnde)).size).toBe(4);
    const eindeutig = new Set(daten.kennzahlWerte.map((w) => [w.beteiligungId, w.schluessel, w.periodeEnde, w.szenario].join("|")));
    expect(eindeutig.size).toBe(daten.kennzahlWerte.length);
  });
});

describe("Demo-Generator: ESG und SFDR", () => {
  it("erfundene Datenpunkte für 2024 und 2025: bestätigt, jährlich, aus dem Katalog, lückenhaft und zum Teil geschätzt, je Wert eindeutig", () => {
    expect(daten.esgWerte.length).toBeGreaterThan(100);
    expect(daten.esgWerte.every((w) => w.status === "bestaetigt" && w.bestaetigtAm && w.szenario === "ist" && w.periodeBeginn.endsWith("-01-01") && w.periodeEnde.endsWith("-12-31"))).toBe(true);
    expect(new Set(daten.esgWerte.map((w) => w.periodeEnde))).toEqual(new Set(["2024-12-31", "2025-12-31"]));
    const erlaubt = new Set(paiDatenpunkte());
    expect(daten.esgWerte.every((w) => erlaubt.has(w.schluessel))).toBe(true);
    const aktiv = new Set(daten.beteiligungen.filter((b) => b.status === "aktiv").map((b) => b.id));
    expect(daten.esgWerte.every((w) => aktiv.has(w.beteiligungId))).toBe(true);
    const eindeutig = new Set(daten.esgWerte.map((w) => [w.beteiligungId, w.schluessel, w.periodeEnde].join("|")));
    expect(eindeutig.size).toBe(daten.esgWerte.length);
    // Teilabdeckung: nicht jedes Unternehmen liefert jeden Datenpunkt, und 2024 ist dünner besetzt als 2025
    const jahr = (j: string) => daten.esgWerte.filter((w) => w.periodeEnde === `${j}-12-31`);
    expect(jahr("2024").length).toBeLessThan(jahr("2025").length);
    const unternehmen = new Set(daten.esgWerte.map((w) => w.beteiligungId));
    expect(daten.esgWerte.length).toBeLessThan(unternehmen.size * erlaubt.size * 2);
    expect(daten.esgWerte.some((w) => w.geschaetzt === true)).toBe(true);
    expect(daten.esgWerte.some((w) => w.geschaetzt === false)).toBe(true);
    expect(daten.esgWerte.filter((w) => w.geschaetzt).every((w) => w.quellenangabe)).toBe(true);
  });

  it("NACE-Abschnitt der Unternehmen und Verlauf der Einordnung je Fonds mit mindestens einem Wechsel", () => {
    const unternehmen = daten.organisationen.filter((o) => o.art === "unternehmen");
    expect(unternehmen.some((o) => o.naceAbschnitt)).toBe(true);
    expect(daten.organisationen.filter((o) => o.naceAbschnitt).every((o) => /^[A-U]$/.test(o.naceAbschnitt!) && o.art === "unternehmen")).toBe(true);
    expect(new Set(daten.fondsOffenlegungen.map((e) => e.fondsId))).toEqual(new Set(daten.fonds.map((f) => f.id)));
    const jeFonds = new Map<string, typeof daten.fondsOffenlegungen>();
    for (const e of daten.fondsOffenlegungen) jeFonds.set(e.fondsId, [...(jeFonds.get(e.fondsId) ?? []), e]);
    expect([...jeFonds.values()].some((liste) => liste.length >= 2)).toBe(true);
    expect(new Set(daten.fondsOffenlegungen.map((e) => e.art)).size).toBeGreaterThanOrEqual(2);
    for (const liste of jeFonds.values()) expect(new Set(liste.map((e) => e.gueltigAb)).size).toBe(liste.length);
  });
});

describe("Demo-Generator: Umfang", () => {
  it("entspricht den Vorgaben", () => {
    expect(daten.fonds.map((f) => f.name)).toEqual(["Beispielfonds I", "Beispielfonds II", "Beispielfonds Seed"]);
    expect(daten.beteiligungen).toHaveLength(40);
    expect(daten.deals).toHaveLength(70);
    expect(daten.organisationen.some((o) => o.art === "investor")).toBe(true);
    for (const o of daten.organisationen) {
      const anzahl = daten.personen.filter((p) => p.organisationId === o.id).length;
      expect(anzahl).toBeGreaterThanOrEqual(1);
      expect(anzahl).toBeLessThanOrEqual(2);
    }
    for (const dl of daten.deals) {
      const anzahl = daten.aktivitaeten.filter((a) => a.dealId === dl.id).length;
      expect(anzahl).toBeGreaterThanOrEqual(2);
      expect(anzahl).toBeLessThanOrEqual(4);
    }
  });

  it("Tickets liegen zwischen 0,5 und 6 Mio. Euro (Zusagen je Beteiligung ohne die Zusagen aus Wandlungen)", () => {
    for (const b of daten.beteiligungen) {
      const zusagen = summe(daten.vorgaenge.filter((x) => x.beteiligungId === b.id && x.art === "zusage" && !x.bemerkung?.startsWith("Wandlung:")), (v) => cent(v.betrag));
      expect(zusagen).toBeGreaterThanOrEqual(50_000_000);
      expect(zusagen).toBeLessThanOrEqual(600_000_000);
    }
  });

  it("alle Datumswerte liegen bis 20.11.2026", () => {
    const tage = [
      ...daten.vorgaenge.map((v) => v.valuta),
      ...daten.bewertungen.map((b) => b.stichtag),
      ...daten.dealPhasenwechsel.map((p) => p.am),
      ...daten.aktivitaeten.map((a) => a.datum),
      ...daten.fondsBewegungen.map((b) => b.valuta),
      ...daten.lpZahlungen.map((z) => z.valuta),
    ];
    for (const t of tage) expect(t <= "2026-11-20").toBe(true);
  });
});

describe("Demo-Generator: Konditionen der Darlehen", () => {
  const art = new Map(daten.instrumente.map((i) => [i.id, i.art]));
  const darlehen = daten.instrumente.filter((i) => i.art === "darlehen" || i.art === "wandeldarlehen" || i.art === "venture_debt" || i.art === "gesellschafterdarlehen");

  it("jedes Darlehen-Instrument hat genau eine Kondition mit gültigen Werten", () => {
    expect(darlehen.length).toBeGreaterThan(0);
    for (const i of darlehen) {
      const k = daten.darlehenKonditionen.filter((x) => x.instrumentId === i.id);
      expect(k, i.bezeichnung).toHaveLength(1);
      expect(Number(k[0]?.satzFix)).toBeGreaterThanOrEqual(0.05);
      expect(Number(k[0]?.satzFix)).toBeLessThanOrEqual(0.08);
    }
    // Konditionen gibt es nur an darlehensartigen Instrumenten (dazu eine stille Beteiligung als Beispiel).
    for (const k of daten.darlehenKonditionen) expect(["darlehen", "wandeldarlehen", "venture_debt", "gesellschafterdarlehen", "stille_beteiligung"]).toContain(art.get(k.instrumentId));
  });

  it("die Zinsbuchungen des Generators („Jahreszins 6 %“) rechnen mit 6 % nach 30E/360, jede Zinsbuchung hat Konditionen am Instrument", () => {
    for (const z of daten.vorgaenge.filter((v) => v.art === "zins")) {
      const k = daten.darlehenKonditionen.find((x) => x.instrumentId === z.instrumentId);
      expect(k).toBeDefined();
      if (z.bemerkung === "Jahreszins 6 %") expect(k).toMatchObject({ satzFix: "0.060000", methode: "30E/360" });
    }
  });

  it("die gewinnabhängige Komponente hat für jedes Jahr bis 2026 einen Jahresüberschuss", () => {
    const gewinn = daten.darlehenKonditionen.filter((k) => k.gewinnabhaengigSatz);
    expect(gewinn).toHaveLength(1);
    const b = daten.beteiligungen.find((x) => x.id === gewinn[0]?.beteiligungId);
    const jahre = daten.jahresueberschuesse.filter((j) => j.beteiligungId === b?.id).map((j) => j.jahr);
    for (let j = Number(b?.erstinvestment.slice(0, 4)); j <= 2026; j++) expect(jahre).toContain(j);
  });
});

describe("Demo-Generator: Konsistenz", () => {
  it("Auszahlungen übersteigen die Zusage nicht (je Instrument, netto nach Storno)", () => {
    for (const i of daten.instrumente) {
      const vorgaenge = daten.vorgaenge.filter((v) => v.instrumentId === i.id);
      const zusage = summe(vorgaenge.filter((v) => v.art === "zusage"), (v) => cent(v.betrag));
      const netto = summe(vorgaenge.filter((v) => v.art === "auszahlung"), (v) => cent(v.betrag));
      expect(netto, i.bezeichnung).toBeLessThanOrEqual(zusage);
      const b = daten.beteiligungen.find((x) => x.id === i.beteiligungId)!;
      for (const v of vorgaenge.filter((x) => x.art === "auszahlung" && cent(x.betrag) > 0 && !x.storniertVorgangId)) {
        expect(v.valuta >= b.erstinvestment).toBe(true);
      }
    }
  });

  it("jeder investierte Deal hat genau eine Beteiligung samt Beschluss", () => {
    for (const dl of daten.deals.filter((x) => x.status === "investiert")) {
      expect(daten.beteiligungen.filter((b) => b.dealId === dl.id)).toHaveLength(1);
      expect(daten.beschluesse.filter((b) => b.dealId === dl.id && b.ergebnis === "zugestimmt")).toHaveLength(1);
      expect(dl.phase).toBe("closing");
    }
    expect(daten.deals.filter((x) => x.status === "investiert")).toHaveLength(daten.beteiligungen.length);
    for (const dl of daten.deals.filter((x) => x.status === "abgesagt")) expect(dl.absagegrund).toBeTruthy();
  });

  it("mindestens ein Unternehmen wird von zwei Fonds gehalten", () => {
    const fondsJeOrg = new Map<string, Set<string>>();
    for (const b of daten.beteiligungen) {
      fondsJeOrg.set(b.organisationId, (fondsJeOrg.get(b.organisationId) ?? new Set()).add(b.fondsId));
    }
    expect([...fondsJeOrg.values()].filter((f) => f.size >= 2).length).toBeGreaterThanOrEqual(1);
  });

  it("nach einem Exit gibt es keine Bewertung (außer der Bewertung null eines Verkaufs am Verkaufstag), nach einer Insolvenz nur noch null", () => {
    const exits = daten.beteiligungen.filter((b) => b.status === "exit");
    expect(exits.length).toBeGreaterThanOrEqual(2);
    for (const b of exits) {
      const rueck = daten.vorgaenge.find((v) => v.beteiligungId === b.id && v.art === "rueckfluss");
      expect(rueck).toBeDefined();
      const verkauf = daten.verkaeufe.find((v) => v.beteiligungId === b.id);
      for (const bew of daten.bewertungen.filter((x) => x.beteiligungId === b.id)) {
        if (verkauf && bew.id === verkauf.bewertungId) expect([bew.stichtag, bew.wert]).toEqual([verkauf.datum, "0.00"]);
        else expect(bew.stichtag < (rueck?.valuta ?? "")).toBe(true);
      }
    }
    const pleiten = daten.beteiligungen.filter((b) => b.status === "insolvent");
    expect(pleiten.length).toBeGreaterThanOrEqual(1);
    expect(pleiten.length).toBeLessThanOrEqual(2);
    for (const b of pleiten) {
      const bew = daten.bewertungen.filter((x) => x.beteiligungId === b.id).sort((a, c) => a.stichtag.localeCompare(c.stichtag));
      expect(bew.at(-1)?.wert).toBe("0.00");
      expect(bew.at(-1)?.stichtag).toBe("2026-09-30");
    }
  });

  it("Bewertungen sind vierteljährlich zum Quartalsende (außer der Bewertung null am Verkaufstag) und eindeutig je Beteiligung", () => {
    const schluessel = new Set<string>();
    const verkauf = new Set(daten.verkaeufe.map((v) => v.bewertungId));
    for (const bew of daten.bewertungen) {
      if (!verkauf.has(bew.id)) expect(["03-31", "06-30", "09-30", "12-31"]).toContain(bew.stichtag.slice(5));
      expect(bew.stichtag <= "2026-09-30").toBe(true);
      schluessel.add(`${bew.beteiligungId}|${bew.stichtag}`);
    }
    expect(schluessel.size).toBe(daten.bewertungen.length);
  });

  it("es gibt Zinszahlungen nur für Darlehen und ein Storno-Beispiel", () => {
    const zinsen = daten.vorgaenge.filter((v) => v.art === "zins");
    expect(zinsen.length).toBeGreaterThan(0);
    const art = new Map(daten.instrumente.map((i) => [i.id, i.art]));
    for (const z of zinsen) expect(["darlehen", "wandeldarlehen", "venture_debt", "gesellschafterdarlehen", "stille_beteiligung"]).toContain(art.get(z.instrumentId));
    const stornos = daten.vorgaenge.filter((v) => v.storniertVorgangId);
    expect(stornos).toHaveLength(1);
    const storno = stornos[0];
    const original = daten.vorgaenge.find((v) => v.id === storno?.storniertVorgangId);
    expect(original?.art).toBe(storno?.art);
    expect(cent(original?.betrag ?? "0") + cent(storno?.betrag ?? "0")).toBe(0);
  });

  it("verteilt jeden Kapitalabruf centgenau auf die LPs und bucht ihre Eingänge nach dem Abruf", () => {
    for (const abruf of daten.fondsBewegungen.filter((b) => b.art === "abruf")) {
      const anteile = daten.abrufAnteile.filter((a) => a.bewegungId === abruf.id);
      const lp = daten.fondsZeichnungen.filter((z) => z.fondsId === abruf.fondsId).map((z) => z.organisationId);
      expect(anteile.map((a) => a.organisationId).sort()).toEqual(lp.sort());
      expect(summe(anteile, (a) => cent(a.betrag))).toBe(cent(abruf.betrag));
      for (const a of anteile) {
        const eingaenge = daten.lpZahlungen.filter((z) => z.bewegungId === abruf.id && z.organisationId === a.organisationId);
        expect(eingaenge.length).toBeGreaterThan(0);
        expect(summe(eingaenge, (z) => cent(z.betrag))).toBeLessThanOrEqual(cent(a.betrag));
        for (const z of eingaenge) {
          expect(z.valuta > abruf.valuta).toBe(true);
          expect([0, 6]).not.toContain(new Date(z.valuta).getUTCDay());
          expect(cent(z.betrag)).toBeGreaterThan(0);
        }
      }
    }
  });

  it("bucht eine zusätzliche LP-Restzahlung erst ab Wertstellung von Forderungen auf Bank um", () => {
    const fonds = daten.fonds.find((f) => f.kurzname === "BF Seed")!;
    const abruf = daten.fondsBewegungen.find((b) => b.fondsId === fonds.id && b.valuta === "2026-04-05" && b.art === "abruf")!;
    const teilzahlung = daten.lpZahlungen.find((z) => z.bewegungId === abruf.id && z.betrag === "55936.00")!;
    const lauf = daten.saldenlaeufe.find((l) => l.fondsId === fonds.id)!;
    const saldo = (zeilen: typeof daten.salden, konto: string) => cent(zeilen.find((s) => s.laufId === lauf.id && s.kontoNummer === konto)!.saldo);
    for (const [valuta, differenz] of [["2026-09-30", cent(teilzahlung.betrag)], ["2026-10-01", 0]] as const) {
      const restzahlung = { ...teilzahlung, id: "00000000-0000-4000-8000-000000000001", valuta };
      const { salden } = erzeugeBuchhaltung({ ...daten, lpZahlungen: [...daten.lpZahlungen, restzahlung] }, 1);
      expect(saldo(salden, "1200") - saldo(daten.salden, "1200")).toBe(differenz);
      expect(saldo(daten.salden, "1400") - saldo(salden, "1400")).toBe(differenz);
    }
  });

  it("Abrufe decken die Auszahlungen samt Gebühren, Ausschüttungen folgen den Exits", () => {
    for (const f of daten.fonds) {
      const beteiligungen = new Set(daten.beteiligungen.filter((b) => b.fondsId === f.id).map((b) => b.id));
      // Die Einlage aus einer Wandlung ist kein Geldfluss und wird nicht abgerufen.
      const auszahlungen = summe(daten.vorgaenge.filter((v) => beteiligungen.has(v.beteiligungId) && v.art === "auszahlung" && !v.bemerkung?.startsWith("Wandlung:")), (v) => cent(v.betrag));
      // Ein Exit bringt den Erlös als Rückfluss und, bei Darlehensartigen, als Tilgung am selben Tag.
      const exitTag = new Set(daten.vorgaenge.filter((v) => v.art === "rueckfluss").map((v) => `${v.beteiligungId}|${v.valuta}`));
      const rueck = summe(daten.vorgaenge.filter((v) => beteiligungen.has(v.beteiligungId) && (v.art === "rueckfluss" || (v.art === "tilgung" && exitTag.has(`${v.beteiligungId}|${v.valuta}`)))), (v) => cent(v.betrag));
      const abrufe = summe(daten.fondsBewegungen.filter((x) => x.fondsId === f.id && x.art === "abruf"), (x) => cent(x.betrag));
      const ausschuettungen = summe(daten.fondsBewegungen.filter((x) => x.fondsId === f.id && x.art === "ausschuettung"), (x) => cent(x.betrag));
      expect(abrufe).toBeGreaterThanOrEqual(auszahlungen);
      expect(abrufe).toBeLessThanOrEqual(auszahlungen * 1.12);
      expect(abrufe).toBeLessThanOrEqual(cent(f.zeichnungskapital));
      expect(ausschuettungen).toBe(rueck);
    }
  });
});

describe("Demo-Generator: Finanzierungsrunden", () => {
  const cents = (betrag: string) => cent(betrag);
  const firmen = new Set(daten.beteiligungen.map((b) => b.organisationId));

  it("Zeichnungen: fünf Investoren je Fonds, Zusagen ergeben das Zeichnungskapital, Anteile ergeben 1", () => {
    for (const f of daten.fonds) {
      const z = daten.fondsZeichnungen.filter((x) => x.fondsId === f.id);
      expect(z).toHaveLength(5);
      expect(summe(z, (x) => cent(x.zusage))).toBe(cent(f.zeichnungskapital));
      expect(summe(z, (x) => Math.round(Number(x.anteil) * 1_000_000))).toBe(1_000_000);
      for (const x of z) expect(daten.organisationen.find((o) => o.id === x.organisationId)?.art).toBe("investor");
    }
  });

  it("Beschlussvorschlag steht nur an offenen Deals im Investitionsausschuss", () => {
    const mit = daten.deals.filter((x) => x.beschlussvorschlag);
    expect(mit.length).toBeGreaterThan(0);
    expect(mit.every((x) => x.phase === "investitionsausschuss" && x.status === "offen")).toBe(true);
  });

  it("jedes Portfoliounternehmen hat mindestens eine Runde und höchstens vier Eigenkapitalrunden (dazu Brückenrunden der Darlehen)", () => {
    for (const org of firmen) {
      const runden = daten.finanzierungsrunden.filter((r) => r.organisationId === org);
      expect(runden.length).toBeGreaterThanOrEqual(1);
      expect(runden.filter((r) => r.art !== "bruecke").length).toBeLessThanOrEqual(4);
    }
    for (const r of daten.finanzierungsrunden) expect(firmen.has(r.organisationId)).toBe(true);
  });

  it("Post-Money = Pre-Money + Rundenvolumen, Positionen ergeben das Volumen", () => {
    for (const r of daten.finanzierungsrunden.filter((x) => x.art !== "bruecke")) {
      const positionen = daten.rundenpositionen.filter((p) => p.rundeId === r.id);
      expect(positionen.length).toBeGreaterThanOrEqual(2);
      const volumen = summe(positionen, (p) => cents(p.betrag));
      expect(cents(r.postMoney!)).toBe(cents(r.preMoney!) + volumen);
      expect(positionen.filter((p) => p.rolle === "lead")).toHaveLength(1);
      for (const p of positionen) expect(Boolean(p.fondsId) !== Boolean(p.vehikelId)).toBe(true);
    }
  });

  it("Anteile: gesamt nach der Runde = vorher + neue Anteile der Positionen, Preis = Pre-Money / Anteile vorher (bei Wandlung Post-Money = Preis × Anteile)", () => {
    const mitWandlung = new Set(daten.wandlungen.map((w) => w.rundeId));
    for (const org of firmen) {
      const runden = daten.finanzierungsrunden.filter((r) => r.organisationId === org && r.art !== "bruecke").sort((a, b) => a.datum.localeCompare(b.datum));
      let davor = 1_000_000;
      for (const r of runden) {
        const neu = summe(daten.rundenpositionen.filter((p) => p.rundeId === r.id), (p) => Number(p.anteile));
        expect(Number(r.anteileGesamtNach)).toBe(davor + neu);
        if (mitWandlung.has(r.id)) {
          // Wandlungsanteile mit Abschlag: Post-Money ist Preis × Anteile; der wirksame Pre-Money (Post-Money minus Rundenvolumen) liegt um den Wert des Abschlags über Preis × Anteile vorher.
          expect(Math.abs(Number(r.preisJeAnteil) * Number(r.anteileGesamtNach) - Number(r.postMoney))).toBeLessThan(1);
          expect(Number(r.preMoney)).toBeGreaterThanOrEqual(Number(r.preisJeAnteil) * davor - 1);
        } else {
          expect(Math.abs(Number(r.preisJeAnteil) - Number(r.preMoney) / davor)).toBeLessThan(0.0001);
        }
        davor = Number(r.anteileGesamtNach);
      }
    }
  });

  it("die Position des Fonds liegt zwischen den Auszahlungen und der Zusage ihres Instruments (bei Wandlung gleich dem Wandlungsbetrag)", () => {
    for (const p of daten.rundenpositionen.filter((x) => x.fondsId)) {
      const vorgaenge = daten.vorgaenge.filter((v) => v.instrumentId === p.instrumentId);
      const auszahlungen = summe(vorgaenge.filter((v) => v.art === "auszahlung"), (v) => cents(v.betrag));
      const zusage = summe(vorgaenge.filter((v) => v.art === "zusage"), (v) => cents(v.betrag));
      expect(cents(p.betrag)).toBeGreaterThanOrEqual(auszahlungen);
      expect(cents(p.betrag)).toBeLessThanOrEqual(zusage);
    }
    for (const b of daten.beteiligungen) {
      // Alles, was der Fonds in Runden hält, ist durch Instrumente der Beteiligung gedeckt.
      const gesamt = summe(daten.rundenpositionen.filter((p) => p.fondsId === b.fondsId && daten.finanzierungsrunden.find((r) => r.id === p.rundeId)?.organisationId === b.organisationId), (p) => cents(p.betrag));
      const auszahlungen = summe(daten.vorgaenge.filter((v) => v.beteiligungId === b.id && v.art === "auszahlung" && daten.rundenpositionen.some((p) => p.instrumentId === v.instrumentId)), (v) => cents(v.betrag));
      expect(gesamt).toBeGreaterThanOrEqual(auszahlungen);
    }
  });

  it("Co-Investoren sind Vehikel von Investor-Organisationen, kein Fonds und kein Vehikel steht doppelt in einer Runde", () => {
    const investoren = new Set(daten.organisationen.filter((o) => o.art === "investor").map((o) => o.id));
    const investorVon = new Map(daten.vehikel.map((v) => [v.id, v.investorId]));
    for (const p of daten.rundenpositionen) if (p.vehikelId) expect(investoren.has(investorVon.get(p.vehikelId)!)).toBe(true);
    for (const r of daten.finanzierungsrunden) {
      const schluessel = daten.rundenpositionen.filter((p) => p.rundeId === r.id).map((p) => p.fondsId ?? p.vehikelId);
      expect(new Set(schluessel).size).toBe(schluessel.length);
    }
  });
});

describe("Demo-Generator: Anteilsklassen", () => {
  it("einige Unternehmen haben ein bis drei Klassen, die zu ihren Runden passen", () => {
    expect(daten.anteilsklassen.length).toBeGreaterThan(5);
    const jeOrg = new Map<string, number>();
    for (const k of daten.anteilsklassen) jeOrg.set(k.organisationId, (jeOrg.get(k.organisationId) ?? 0) + 1);
    expect(jeOrg.size).toBeLessThan(new Set(daten.finanzierungsrunden.map((r) => r.organisationId)).size);
    for (const [org, anzahl] of jeOrg) {
      expect(anzahl).toBeGreaterThanOrEqual(1);
      expect(anzahl).toBeLessThanOrEqual(3);
      expect(daten.finanzierungsrunden.filter((r) => r.organisationId === org).length).toBeGreaterThanOrEqual(anzahl);
    }
    expect(new Set(daten.anteilsklassen.map((k) => `${k.organisationId}|${k.name}`)).size).toBe(daten.anteilsklassen.length);
    for (const k of daten.anteilsklassen) {
      expect(k.rang).toBeGreaterThanOrEqual(1);
      expect(Number(k.praeferenzFaktor)).toBeGreaterThan(0);
      if (k.capFaktor) {
        expect(k.partizipierend).toBe(true);
        expect(Number(k.capFaktor)).toBeGreaterThanOrEqual(Number(k.praeferenzFaktor));
      }
    }
  });

  it("jede Position mit Klasse gehört zu einer Klasse desselben Unternehmens, alle Positionen einer Runde zur selben", () => {
    const klassen = new Map(daten.anteilsklassen.map((k) => [k.id, k]));
    const runden = new Map(daten.finanzierungsrunden.map((r) => [r.id, r]));
    const jeRunde = new Map<string, Set<string | null>>();
    for (const p of daten.rundenpositionen) {
      if (p.anteilsklasseId) expect(klassen.get(p.anteilsklasseId)?.organisationId).toBe(runden.get(p.rundeId)?.organisationId);
      jeRunde.set(p.rundeId, (jeRunde.get(p.rundeId) ?? new Set()).add(p.anteilsklasseId ?? null));
    }
    for (const klassenDerRunde of jeRunde.values()) expect(klassenDerRunde.size).toBe(1);
    expect(daten.rundenpositionen.some((p) => p.anteilsklasseId)).toBe(true);
    expect(daten.rundenpositionen.some((p) => !p.anteilsklasseId)).toBe(true);
  });
});

describe("Demo-Generator: größerer Umfang mit fünf Fonds", () => {
  const gross = erzeugeDemodaten({ seed: 1, umfang: { beteiligungen: 500, deals: 600, fonds: 5 } });

  it("liefert fünf Fonds und 500 Beteiligungen, Abrufe übersteigen das Zeichnungskapital nicht", () => {
    expect(gross.fonds).toHaveLength(5);
    expect(gross.beteiligungen).toHaveLength(500);
    for (const f of gross.fonds) {
      const abrufe = gross.fondsBewegungen.filter((x) => x.fondsId === f.id && x.art === "abruf").reduce((s, x) => s + cent(x.betrag), 0);
      expect(abrufe).toBeLessThanOrEqual(cent(f.zeichnungskapital));
    }
    expect(gross.finanzierungsrunden.length).toBeGreaterThanOrEqual(500 * 0.9);
  });

  it("lehnt ungültige Fondszahlen ab", () => {
    expect(() => erzeugeDemodaten({ umfang: { fonds: 6 } })).toThrow();
    expect(() => erzeugeDemodaten({ umfang: { fonds: 2 } })).toThrow();
  });
});

describe("Demo-Generator: Verwaltungsvergütung und Fondskosten (Issue #157)", () => {
  it("bucht je Fonds genau die Verwaltungskosten der Saldenliste, anteilig verteilt", () => {
    expect(daten.fondsKosten.length).toBeGreaterThan(0);
    for (const f of daten.fonds) {
      const lauf = daten.saldenlaeufe.find((l) => l.fondsId === f.id)!;
      const saldo6300 = cent(daten.salden.find((x) => x.laufId === lauf.id && x.kontoNummer === "6300")?.saldo ?? "0");
      const eigene = daten.fondsKosten.filter((k) => k.fondsId === f.id);
      expect(summe(eigene, (k) => cent(k.betrag))).toBe(saldo6300);
      for (const k of eigene) {
        expect(summe(daten.fondsKostenAnteile.filter((a) => a.kostenId === k.id), (a) => cent(a.betrag))).toBe(cent(k.betrag));
        expect(k.valuta <= "2026-09-30").toBe(true);
      }
    }
    expect(new Set(daten.fondsKosten.map((k) => k.art))).toEqual(new Set(["verwaltungsverguetung", "fondskosten"]));
  });
});

describe("Demo-Generator: Sprache der Freitexte", () => {
  const englisch = erzeugeDemodaten({ seed: 1, sprache: "en" });
  const umlaute = /[äöüßÄÖÜ]/;

  it("ohne Angabe bleiben die deutschen Texte, und die Zahlen und Stammdaten sind in beiden Sprachen gleich", () => {
    expect(erzeugeDemodaten({ seed: 1, sprache: "de" })).toEqual(daten);
    expect(englisch.bewertungen.map((b) => [b.id, b.wert, b.methode])).toEqual(daten.bewertungen.map((b) => [b.id, b.wert, b.methode]));
    expect(englisch.vorgaenge).toEqual(daten.vorgaenge);
    expect(englisch.organisationen).toEqual(daten.organisationen);
    expect(englisch.personen).toEqual(daten.personen);
    expect(englisch.deals.map((d) => [d.id, d.phase, d.status])).toEqual(daten.deals.map((d) => [d.id, d.phase, d.status]));
  });

  it("englische Notizen enthalten keine deutschen Freitexte (Bewertungen, Aktivitäten, Absagegründe, Bewegungen, Reserven, Szenarien, Offenlegung)", () => {
    const texte = [
      ...englisch.bewertungen.map((b) => b.begruendung ?? ""),
      ...englisch.aktivitaeten.map((a) => a.titel),
      ...englisch.deals.map((d) => d.absagegrund ?? ""),
      ...englisch.fondsBewegungen.map((b) => b.bemerkung ?? ""),
      ...englisch.fondsKosten.map((k) => k.bemerkung ?? ""),
      ...englisch.reserven.map((r) => r.bemerkung ?? ""),
      ...englisch.szenarien.map((s) => s.name),
      ...englisch.fondsOffenlegungen.map((o) => o.bemerkung ?? ""),
    ].filter((t) => t !== "");
    expect(texte.length).toBeGreaterThan(100);
    expect(texte.filter((t) => umlaute.test(t))).toEqual([]);
    const deutsch = new Set(["Ansatz zu Anschaffungskosten", "Abruf für Investitionen und Verwaltung", "Ausschüttung aus Exit", "Reserve für eine Folgerunde (Beispiel)", "Basis", "Vorsichtig", "Neuausrichtung der Anlagestrategie"]);
    expect(texte.filter((t) => deutsch.has(t))).toEqual([]);
    // deutsche Fassung enthält sie
    expect(daten.bewertungen.some((b) => b.begruendung === "Ansatz zu Anschaffungskosten")).toBe(true);
  });

  it("DEMO_SPRACHE wird streng gelesen", () => {
    expect(demoSpracheAus(undefined)).toBe("de");
    expect(demoSpracheAus("en")).toBe("en");
    expect(() => demoSpracheAus("fr")).toThrow(/DEMO_SPRACHE/);
  });
});
