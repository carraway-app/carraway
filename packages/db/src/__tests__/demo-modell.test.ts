import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { erstelleDb } from "../index";
import { erzeugeDemodaten, schreibeDemoPortfolio, schreibeDemodaten, type Demodaten } from "../demo/index";
import { TESTDB_URL, cent } from "./hilfen";

/**
 * Konsistenz des Demo-Portfolios mit dem Portfolio-Modell (`docs/portfolio-modell.md`): Instrumente, Zusagen, Tranchen, Runden und Wandlungen
 * des Generators folgen den Regeln der API. Die Prüfungen laufen für mehrere Seeds und für den großen Umfang.
 */

const EIGENKAPITAL = ["offene_beteiligung", "stille_beteiligung"];
const DARLEHEN = ["darlehen", "wandeldarlehen", "venture_debt", "gesellschafterdarlehen"];
const summe = <T>(liste: T[], wert: (x: T) => number) => liste.reduce((s, x) => s + wert(x), 0);

function pruefe(d: Demodaten) {
  const instrument = new Map(d.instrumente.map((i) => [i.id, i]));
  const runde = new Map(d.finanzierungsrunden.map((r) => [r.id, r]));
  const beteiligung = new Map(d.beteiligungen.map((b) => [b.id, b]));
  const tranche = new Map(d.tranchen.map((t) => [t.id, t]));
  const vorgaenge = (instrumentId: string) => d.vorgaenge.filter((v) => v.instrumentId === instrumentId);
  const fehler: string[] = [];
  const pruefen = (ok: boolean, text: string) => {
    if (!ok) fehler.push(text);
  };

  // Positionen: Fonds-Positionen verweisen auf ein Eigenkapital-Instrument derselben Beteiligung und Runde, nie auf ein Darlehen
  for (const p of d.rundenpositionen) {
    if (!p.fondsId) {
      pruefen(p.instrumentId === undefined || p.instrumentId === null, "Fremdposition mit Instrument");
      continue;
    }
    const i = p.instrumentId ? instrument.get(p.instrumentId) : undefined;
    pruefen(i !== undefined, "Fonds-Position ohne Instrument");
    if (!i) continue;
    pruefen(EIGENKAPITAL.includes(i.art), `Position verweist auf ${i.art}`);
    pruefen(i.rundeId === p.rundeId, "Instrument und Position nennen verschiedene Runden");
    pruefen((i.anteilsklasseId ?? null) === (p.anteilsklasseId ?? null), "Anteilsklasse von Instrument und Position weicht ab");
    const b = beteiligung.get(i.beteiligungId);
    pruefen(b?.fondsId === p.fondsId && b?.organisationId === runde.get(p.rundeId)?.organisationId, "Instrument gehört zu einer anderen Beteiligung als die Position");
  }
  // Vehikel: Positionen Dritter zeigen auf ein Vehikel eines Investors, je Investor genau ein Standard-Vehikel
  const vehikel = new Map(d.vehikel.map((v) => [v.id, v]));
  const investoren = new Set(d.organisationen.filter((o) => o.art === "investor").map((o) => o.id));
  for (const p of d.rundenpositionen.filter((x) => !x.fondsId)) {
    const v = p.vehikelId ? vehikel.get(p.vehikelId) : undefined;
    pruefen(v !== undefined, "Fremdposition ohne Vehikel");
    if (v) pruefen(investoren.has(v.investorId), `${v.name}: Investor ist keine Investor-Organisation`);
  }
  for (const inv of investoren) pruefen(d.vehikel.filter((v) => v.investorId === inv && v.standard).length === 1, "Investor ohne genau ein Standard-Vehikel");
  // Eigenkapital-Instrumente stehen in Eigenkapitalrunden, Darlehen in Brückenrunden (oder ohne Runde), jede Runde gehört zum Unternehmen der Beteiligung
  for (const i of d.instrumente) {
    const r = i.rundeId ? runde.get(i.rundeId) : undefined;
    const b = beteiligung.get(i.beteiligungId);
    if (r) pruefen(r.organisationId === b?.organisationId, "Runde eines anderen Unternehmens");
    if (EIGENKAPITAL.includes(i.art)) pruefen(r === undefined || r.art !== "bruecke", `${i.bezeichnung}: Eigenkapital auf einer Brückenrunde`);
    if (DARLEHEN.includes(i.art)) pruefen(r?.art === "bruecke", `${i.bezeichnung}: Darlehen ohne Brückenrunde`);
  }
  for (const r of d.finanzierungsrunden.filter((x) => x.art === "bruecke")) {
    pruefen(r.preMoney == null && r.postMoney == null && r.preisJeAnteil == null && r.anteileGesamtNach == null, "Brückenrunde mit Bewertung");
    pruefen(!d.rundenpositionen.some((p) => p.rundeId === r.id), "Brückenrunde mit Positionen");
  }
  // Zusage und Tranchen je Instrument
  for (const i of d.instrumente) {
    const zusage = summe(vorgaenge(i.id).filter((v) => v.art === "zusage"), (v) => cent(v.betrag));
    const tranchen = summe(d.tranchen.filter((t) => t.instrumentId === i.id), (t) => cent(t.betrag));
    pruefen(tranchen <= zusage, `${i.bezeichnung}: Tranchen ${tranchen} über Zusage ${zusage}`);
    const netto = summe(vorgaenge(i.id).filter((v) => v.art === "auszahlung"), (v) => cent(v.betrag));
    pruefen(netto <= zusage, `${i.bezeichnung}: Auszahlungen über Zusage`);
  }
  for (const v of d.vorgaenge) {
    pruefen(instrument.get(v.instrumentId)?.beteiligungId === v.beteiligungId, "Vorgang an einem Instrument einer anderen Beteiligung");
    if (v.trancheId) {
      const t = tranche.get(v.trancheId);
      pruefen(v.art === "auszahlung" && t?.instrumentId === v.instrumentId, "Auszahlung auf eine Tranche eines anderen Instruments");
      if (t?.bedingung && !v.storniertVorgangId && cent(v.betrag) > 0) pruefen(t.erfuelltAm != null && t.erfuelltAm <= v.valuta, "Auszahlung vor erfüllter Bedingung");
    }
    // Zinsen auf Rechnung bei Wandeldarlehen, Zinszahlungen in bar nur an Instrumenten, die sie in bar tragen
    if (v.art === "zinszahlung") pruefen(instrument.get(v.instrumentId)?.art !== "wandeldarlehen", "Zinszahlung auf ein Wandeldarlehen");
    if (v.art === "zins" || v.art === "zinszahlung" || v.art === "tilgung") pruefen(!EIGENKAPITAL.includes(instrument.get(v.instrumentId)?.art ?? "") || instrument.get(v.instrumentId)?.art === "stille_beteiligung" || v.bemerkung === "Zahlung (Mengen-Referenz)", "Zins oder Tilgung auf Eigenkapital");
  }
  // Wandlungen
  const gewandelt = d.instrumente.filter((i) => i.status === "gewandelt");
  for (const i of gewandelt) pruefen(d.wandlungen.some((w) => w.quellInstrumentId === i.id), `${i.bezeichnung}: gewandelt ohne Wandlung`);
  for (const w of d.wandlungen) {
    const quelle = instrument.get(w.quellInstrumentId);
    const ziel = w.zielInstrumentId ? instrument.get(w.zielInstrumentId) : undefined;
    pruefen(quelle?.art === "wandeldarlehen" && quelle.status === "gewandelt", "Quelle der Wandlung kein gewandeltes Wandeldarlehen");
    pruefen(ziel !== undefined && ziel.art === "offene_beteiligung" && ziel.beteiligungId === quelle?.beteiligungId && ziel.rundeId === w.rundeId, "Ziel der Wandlung falsch");
    pruefen(runde.get(w.rundeId)?.art !== "bruecke", "Zielrunde ist eine Brückenrunde");
    const loan = vorgaenge(w.quellInstrumentId);
    const kapital = summe(loan.filter((v) => v.art === "auszahlung"), (v) => cent(v.betrag)) - summe(loan.filter((v) => v.art === "tilgung"), (v) => cent(v.betrag));
    pruefen(kapital === 0, "Darlehen nach der Wandlung nicht getilgt");
    const spitz = cent(w.spitzenbetrag);
    const umgewandelt = cent(w.wandlungsbetrag) - spitz;
    const zielVorgaenge = vorgaenge(w.zielInstrumentId as string);
    pruefen(summe(zielVorgaenge.filter((v) => v.art === "zusage"), (v) => cent(v.betrag)) === umgewandelt, "Zusage des Ziels ungleich Wandlungsbetrag");
    pruefen(summe(zielVorgaenge.filter((v) => v.art === "auszahlung"), (v) => cent(v.betrag)) === umgewandelt, "Einlage des Ziels ungleich Wandlungsbetrag");
    const position = d.rundenpositionen.find((p) => p.rundeId === w.rundeId && p.instrumentId === w.zielInstrumentId);
    pruefen(position !== undefined && cent(position.betrag) === umgewandelt && position.anteile === w.anzahlAnteile, "Position der Wandlung weicht ab");
    for (const vid of Object.values(w.vorgaenge as Record<string, string>)) {
      pruefen(d.vorgaenge.some((v) => v.id === vid), "Vorgang der Wandlung fehlt");
      pruefen(d.vorgangRunden.some((z) => z.vorgangId === vid && z.rundeId === w.rundeId), "Buchung der Wandlung nicht der Zielrunde zugeordnet");
    }
  }
  // Jeder Vorgang hat eine Runde des Unternehmens (ausdrücklich oder über das Instrument), bis auf das eine Beispiel
  const ausdruecklich = new Map(d.vorgangRunden.map((z) => [z.vorgangId, z.rundeId]));
  const ohne = new Set(d.vorgangOhneRunde);
  const geordnet = (v: Demodaten["vorgaenge"][number]): string | undefined => {
    const ausd = ausdruecklich.get(v.id);
    if (ausd) return ausd;
    if (v.storniertVorgangId) return geordnet(d.vorgaenge.find((x) => x.id === v.storniertVorgangId) as Demodaten["vorgaenge"][number]);
    return instrument.get(v.instrumentId)?.rundeId ?? undefined;
  };
  const ohneRunde: string[] = [];
  for (const v of d.vorgaenge) {
    const rid = ohne.has(v.id) ? undefined : geordnet(v);
    if (!rid) {
      if (!ohne.has(v.id) && v.bemerkung !== "Zahlung (Mengen-Referenz)") ohneRunde.push(`${v.art} ${v.valuta} ${instrument.get(v.instrumentId)?.bezeichnung}`);
      continue;
    }
    pruefen(runde.get(rid)?.organisationId === beteiligung.get(v.beteiligungId)?.organisationId, "Runde eines anderen Unternehmens");
  }
  pruefen(ohneRunde.length === 0, `Vorgänge ohne Runde: ${ohneRunde.slice(0, 5).join("; ")}`);
  pruefen(d.vorgangOhneRunde.length <= 1, "mehr als ein Beispiel ohne Runde");
  // Eigenkapitalrunden: Post-Money = Pre-Money + Volumen, Anteile folgen der Kette, Post-Money ≈ Preis × Anteile (Toleranz wie die Rundenprüfung der API;
  // die Anteile je Position sind abgerundet, deshalb bis zu ein Preis je Position)
  const mitWandlung = new Set(d.wandlungen.map((w) => w.rundeId));
  const orgs = new Set(d.finanzierungsrunden.map((r) => r.organisationId));
  for (const org of orgs) {
    let davor = 1_000_000;
    for (const r of d.finanzierungsrunden.filter((x) => x.organisationId === org && x.art !== "bruecke").sort((a, b) => a.datum.localeCompare(b.datum) || a.id.localeCompare(b.id))) {
      const pos = d.rundenpositionen.filter((p) => p.rundeId === r.id);
      pruefen(cent(r.postMoney as string) === cent(r.preMoney as string) + summe(pos, (p) => cent(p.betrag)), "Post-Money ≠ Pre-Money + Volumen");
      pruefen(Number(r.anteileGesamtNach) === davor + summe(pos, (p) => Number(p.anteile)), "Anteilskette gebrochen");
      const preis = Number(r.preisJeAnteil);
      pruefen(Math.abs(Number(r.anteileGesamtNach) * preis - Number(r.postMoney)) <= preis * (pos.length + 1) + Number(r.anteileGesamtNach) * 0.00005, "Post-Money ≠ Preis × Anteile");
      pruefen(pos.filter((p) => p.rolle === "lead").length === 1, "Runde ohne genau einen Lead");
      if (!mitWandlung.has(r.id)) pruefen(Math.abs(preis - Number(r.preMoney) / davor) < 0.0001, "Preis ≠ Pre-Money / Anteile vorher");
      davor = Number(r.anteileGesamtNach);
    }
  }
  // Mitarbeiterbeteiligung: Zuteilungen nie über der Größe des Pools, Pool nach der letzten Eigenkapitalrunde (die Runden bleiben unverwässert stimmig)
  for (const p of d.mitarbeiterpools) {
    const groesse = summe(d.poolAenderungen.filter((a) => a.poolId === p.id), (a) => Number(a.anzahl));
    const zugeteilt = summe(d.mitarbeiterzuteilungen.filter((z) => z.poolId === p.id && z.status !== "verfallen"), (z) => Number(z.anzahl));
    pruefen(zugeteilt <= groesse, `${p.bezeichnung}: Zuteilungen ${zugeteilt} über dem Pool ${groesse}`);
    const erste = d.poolAenderungen.filter((a) => a.poolId === p.id).map((a) => a.datum).sort()[0] ?? "";
    const letzteRunde = d.finanzierungsrunden.filter((r) => r.organisationId === p.organisationId && r.art !== "bruecke").map((r) => r.datum).sort().at(-1) ?? "";
    pruefen(erste > letzteRunde, `${p.bezeichnung}: Pool vor der letzten Runde`);
    pruefen(d.mitarbeiterzuteilungen.filter((z) => z.poolId === p.id).every((z) => z.zugeteiltAm >= erste), `${p.bezeichnung}: Zuteilung vor dem Pool`);
  }
  return fehler;
}

describe.each([
  ["Seed 1", () => erzeugeDemodaten({ seed: 1 })],
  ["Seed 7", () => erzeugeDemodaten({ seed: 7 })],
  ["Seed 42", () => erzeugeDemodaten({ seed: 42 })],
  ["5 Fonds, 500 Beteiligungen", () => erzeugeDemodaten({ seed: 1, umfang: { beteiligungen: 500, deals: 600, fonds: 5 } })],
  ["mit Mengen-Referenz", () => erzeugeDemodaten({ seed: 1, umfang: { zahlungen: 2000 } })],
])("Demo-Portfolio und Portfolio-Modell: %s", (_name, erzeuge) => {
  const d = erzeuge();

  it("die Invarianten des Modells gelten", () => {
    expect(pruefe(d)).toEqual([]);
  });

  it("es gibt Wandlungen, Brückenrunden, Tranchen mit Bedingung und mehrere Instrumente je Beteiligung", () => {
    expect(d.wandlungen.length).toBeGreaterThanOrEqual(1);
    expect(d.finanzierungsrunden.some((r) => r.art === "bruecke")).toBe(true);
    expect(d.tranchen.some((t) => t.bedingung)).toBe(true);
    const je = new Map<string, number>();
    for (const i of d.instrumente) je.set(i.beteiligungId, (je.get(i.beteiligungId) ?? 0) + 1);
    expect([...je.values()].some((n) => n >= 2)).toBe(true);
  });

  it("mindestens ein Investor ist mit zwei oder mehr Vehikeln in Runden vertreten", () => {
    const investorVon = new Map(d.vehikel.map((v) => [v.id, v.investorId]));
    const genutzt = new Map<string, Set<string>>();
    for (const p of d.rundenpositionen) if (p.vehikelId) genutzt.set(investorVon.get(p.vehikelId)!, (genutzt.get(investorVon.get(p.vehikelId)!) ?? new Set()).add(p.vehikelId));
    expect([...genutzt.values()].some((s) => s.size >= 2)).toBe(true);
  });
});

describe("Demo-Portfolio: Abwechslung und das Unternehmen mit der ganzen Kette", () => {
  const d = erzeugeDemodaten({ seed: 1 });
  const art = (id: string) => d.instrumente.find((i) => i.id === id)?.art;

  it("Tapa Sensorik: Seed-Anteile, Wandeldarlehen in zwei Tranchen, Wandlung in die Serie A, Venture Debt mit Zinszahlung und Tilgung, Folgerunde", () => {
    const org = d.organisationen.find((o) => o.name === "Tapa Sensorik")!;
    const b = d.beteiligungen.find((x) => x.organisationId === org.id)!;
    const instrumente = d.instrumente.filter((i) => i.beteiligungId === b.id);
    expect(instrumente.map((i) => [i.art, i.status])).toEqual([
      ["offene_beteiligung", "aktiv"],
      ["wandeldarlehen", "gewandelt"],
      ["offene_beteiligung", "aktiv"],
      ["venture_debt", "aktiv"],
      ["offene_beteiligung", "aktiv"],
    ]);
    const [seed, wandel, serieA, venture, folge] = instrumente;
    expect(seed?.bezeichnung).toBe("Seed-Runde-Anteile");
    expect(serieA?.bezeichnung).toBe("Serie-A-Runde-Anteile");
    const zusage = (i: typeof seed) => summe(d.vorgaenge.filter((v) => v.instrumentId === i?.id && v.art === "zusage" && !v.bemerkung?.startsWith("Wandlung:")), (v) => cent(v.betrag));
    expect(zusage(seed)).toBe(74_470_000);
    expect(zusage(wandel)).toBe(57_440_000);
    const tranchen = d.tranchen.filter((t) => t.instrumentId === wandel?.id).sort((x, y) => (x.nummer ?? 0) - (y.nummer ?? 0));
    expect(tranchen.map((t) => [t.betrag, t.geplantAm, t.bedingung])).toEqual([
      ["287200.00", "2024-11-04", "Unterzeichnung des Vertrags"],
      ["287200.00", "2024-12-02", "Unterzeichnetes Term Sheet der Serie A"],
    ]);
    expect(d.darlehenKonditionen.find((k) => k.instrumentId === wandel?.id)).toMatchObject({ satzFix: "0.060000", methode: "30E/360" });
    expect(d.finanzierungsrunden.find((r) => r.id === wandel?.rundeId)).toMatchObject({ art: "bruecke", bezeichnung: "Wandeldarlehen 2024", datum: "2024-11-04" });
    // Wandlung zum 19.01.2025 mit 20 % Abschlag: 44.239 Anteile der Serie A, Spitzenbetrag 4,55
    const w = d.wandlungen.find((x) => x.quellInstrumentId === wandel?.id)!;
    expect(w).toMatchObject({ cutoff: "2025-01-19", anzahlAnteile: "44239", spitzenbetrag: "4.55", zinsenWandeln: true, zielInstrumentId: serieA?.id });
    expect(d.finanzierungsrunden.find((r) => r.id === w.rundeId)).toMatchObject({ bezeichnung: "Serie-A-Runde", preisJeAnteil: "16.3949", anteileGesamtNach: "1306219" });
    const seedPosition = d.rundenpositionen.find((p) => p.instrumentId === seed?.id)!;
    expect(seedPosition).toMatchObject({ betrag: "744700.00", anteile: "85597" });
    // Venture Debt: Zinsen in bar und Tilgungen
    expect(d.vorgaenge.filter((v) => v.instrumentId === venture?.id && v.art === "zinszahlung").length).toBeGreaterThanOrEqual(4);
    expect(d.vorgaenge.filter((v) => v.instrumentId === venture?.id && v.art === "tilgung").length).toBeGreaterThanOrEqual(2);
    expect(d.tranchen.filter((t) => t.instrumentId === venture?.id)).toHaveLength(2);
    // Mitarbeiterbeteiligung: ESOP-Pool nach der Folgerunde, Zuteilungen nach Kategorie
    const esop = d.mitarbeiterpools.find((p) => p.organisationId === org.id)!;
    expect(esop).toMatchObject({ art: "esop", bezeichnung: "ESOP" });
    expect(d.mitarbeiterzuteilungen.filter((z) => z.poolId === esop.id).map((z) => z.kategorie).sort()).toEqual(["beirat", "fuehrung", "mitarbeitende"]);
    // Folgerunde: zweite Tranche offen mit Bedingung
    expect(d.tranchen.filter((t) => t.instrumentId === folge?.id && !d.vorgaenge.some((v) => v.trancheId === t.id))).toHaveLength(1);
    // Bewertungen zum Quartalsende, anfangs zu Anschaffungskosten (Seed 744.700 plus Wandeldarlehen 574.400)
    const bew = d.bewertungen.filter((x) => x.beteiligungId === b.id).sort((x, y) => x.stichtag.localeCompare(y.stichtag));
    expect(bew[0]).toMatchObject({ stichtag: "2024-12-31", methode: "anschaffungskosten" });
    expect(Math.abs(cent(bew[0]?.wert as string) - 131_910_000)).toBeLessThan(10_000);
  });

  it("einfache Darlehen, eine stille Beteiligung mit Zinsen, ein Gesellschafterdarlehen und ein Unternehmen in zwei Fonds", () => {
    const aktiv = d.instrumente.filter((i) => i.status === "aktiv");
    expect(aktiv.filter((i) => i.art === "darlehen").length).toBeGreaterThanOrEqual(2);
    expect(d.instrumente.some((i) => i.art === "gesellschafterdarlehen")).toBe(true);
    const stille = d.instrumente.filter((i) => i.art === "stille_beteiligung");
    expect(stille.length).toBeGreaterThanOrEqual(1);
    expect(stille.some((i) => d.vorgaenge.some((v) => v.instrumentId === i.id && v.art === "zins"))).toBe(true);
    const jeOrg = new Map<string, Set<string>>();
    for (const b of d.beteiligungen) jeOrg.set(b.organisationId, (jeOrg.get(b.organisationId) ?? new Set()).add(b.fondsId));
    expect([...jeOrg.values()].filter((f) => f.size >= 2).length).toBeGreaterThanOrEqual(1);
    // einfaches Darlehen mit Zinsen in bar und Tilgung
    const mitTilgung = aktiv.filter((i) => i.art === "darlehen" && d.vorgaenge.some((v) => v.instrumentId === i.id && v.art === "tilgung"));
    expect(mitTilgung.length).toBeGreaterThanOrEqual(1);
    expect(art(mitTilgung[0]?.id as string)).toBe("darlehen");
  });

  it("genau ein Vorgang bleibt als Beispiel ohne Runde", () => {
    expect(d.vorgangOhneRunde).toHaveLength(1);
  });
});

describe("Demo-Portfolio in der Datenbank", () => {
  const { db, pool } = erstelleDb(TESTDB_URL);
  const daten = erzeugeDemodaten({ seed: 1 });
  afterAll(async () => {
    await db.execute(sql`TRUNCATE TABLE vorgang_runde, rundenposition, finanzierungsrunde, wandlung, vorgang, tranche, instrument, beteiligung, anteilsklasse, fonds, organisation CASCADE`);
    await pool.end();
  });

  it("ergänzt beim Neu-Seed eines Bestands ohne LP-Zahlungen alle vorgesehenen Eingänge", async () => {
    await schreibeDemodaten(db, { ...daten, lpZahlungen: [] });
    const zahlungen = () => db.execute<{ id: string }>(sql`SELECT id FROM lp_zahlung ORDER BY id`);
    expect((await zahlungen()).rows).toHaveLength(0);
    await schreibeDemodaten(db, daten);
    expect((await zahlungen()).rows.map((z) => z.id)).toEqual(daten.lpZahlungen.map((z) => z.id).sort());
  });

  it("jeder Vorgang außer dem Beispiel hat eine Runde, die Wandlungsbuchungen die Zielrunde, und die Zeilen der Wandlung stehen in der Datenbank", async () => {
    await schreibeDemodaten(db, daten);
    await schreibeDemoPortfolio(db);
    const zeilen = async (abfrage: ReturnType<typeof sql>) => (await db.execute(abfrage)).rows;
    const ohne = await zeilen(sql`SELECT v.id FROM vorgang v LEFT JOIN vorgang_runde z ON z.vorgang_id = v.id WHERE z.vorgang_id IS NULL`);
    expect(ohne.map((r) => r.id)).toEqual(daten.vorgangOhneRunde);
    const fremd = await zeilen(sql`
      SELECT v.id FROM vorgang v JOIN vorgang_runde z ON z.vorgang_id = v.id
      JOIN finanzierungsrunde r ON r.id = z.runde_id JOIN beteiligung b ON b.id = v.beteiligung_id WHERE r.organisation_id <> b.organisation_id`);
    expect(fremd).toEqual([]);
    expect(Number((await zeilen(sql`SELECT count(*)::int AS n FROM wandlung`))[0]?.n)).toBe(daten.wandlungen.length);
    const falsch = await zeilen(sql`
      SELECT w.id FROM wandlung w, jsonb_each_text(w.vorgaenge) j JOIN vorgang_runde z ON z.vorgang_id = j.value::uuid WHERE z.runde_id <> w.runde_id`);
    expect(falsch).toEqual([]);
    // Fonds-Positionen verweisen in der Datenbank nie auf ein Darlehen
    const aufDarlehen = await zeilen(sql`SELECT p.id FROM rundenposition p JOIN instrument i ON i.id = p.instrument_id WHERE i.art NOT IN ('offene_beteiligung', 'stille_beteiligung')`);
    expect(aufDarlehen).toEqual([]);
  });
});
