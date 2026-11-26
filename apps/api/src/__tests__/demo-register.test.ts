import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { erzeugeDemodaten, schreibeDemodaten } from "@carraway/db/demo";
import { erstelleTestApp } from "./hilfen-auth";
import { leeren, oeffneTestdb } from "./hilfen";
import { aufrufe, json } from "./hilfen-instrumente";

const { db, pool } = oeffneTestdb();
const { get } = aufrufe(erstelleTestApp(db));

/** Demo-Daten der Etappe 18: Registereinträge mit Abweichung und Insolvenzhinweis, Reserven und zwei Szenarien je Fonds, die rechnen. */
describe("Demo-Daten: Register und Szenarien", () => {
  const daten = erzeugeDemodaten({ seed: 1 });

  beforeAll(async () => {
    await schreibeDemodaten(db, daten);
  }, 60_000);
  afterAll(async () => {
    await leeren(db);
    await pool.end();
  });

  it("enthält Registerdaten mit fiktiven Nummern, eine Abweichung der Geschäftsführung und eine Insolvenzbekanntmachung", async () => {
    expect(daten.registereintraege.length).toBeGreaterThanOrEqual(4);
    for (const e of daten.registereintraege) expect(e.nummer).toMatch(/^HRB 99\d{3}$/);
    const abweichend = daten.registereintraege[1]!;
    const r = await get(`/organisationen/${abweichend.organisationId}/register`).then(json);
    expect(r.abweichungen.map((a: { code: string }) => a.code)).toEqual(["GESCHAEFTSFUEHRUNG_ABWEICHEND"]);
    const insolvenz = daten.registerEreignisse.find((e) => e.art === "insolvenz")!;
    const b = daten.beteiligungen.find((x) => x.organisationId === insolvenz.organisationId)!;
    const h = await get(`/beteiligungen/${b.id}/register-hinweise`).then(json);
    expect(h.daten.map((x: { art: string }) => x.art)).toContain("insolvenz");
    const sauber = await get(`/organisationen/${daten.registereintraege[0]!.organisationId}/register`).then(json);
    expect(sauber.abweichungen).toEqual([]);
  });

  it("jeder Fonds hat zwei Szenarien, die ohne Fehler rechnen und sich vergleichen lassen", async () => {
    for (const f of daten.fonds) {
      const liste = (await get(`/fonds/${f.id}/szenarien`).then(json)).daten as { id: string; name: string }[];
      expect(liste.map((x) => x.name).sort()).toEqual(["Basis", "Vorsichtig"]);
      const antwort = await get(`/fonds/${f.id}/szenarien/vergleich?ids=${liste.map((x) => x.id).join(",")}`);
      expect(antwort.status).toBe(200);
      const v = await json(antwort);
      expect(v.vergleich.jahre.length).toBeGreaterThan(5);
      expect(v.szenarien[0].ergebnis.jahre[0].ist).toBe(true);
    }
  });

  it("Reserven sind geplant und im Fonds sichtbar", async () => {
    const b = daten.beteiligungen.find((x) => x.id === daten.reserven[0]!.beteiligungId)!;
    const r = await get(`/fonds/${b.fondsId}/reserven`).then(json);
    expect(r.reserven.length).toBeGreaterThan(0);
    expect(r.szenario).not.toBeNull();
  });
});
