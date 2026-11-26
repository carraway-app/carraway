import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { erzeugeDemodaten, schreibeDemodaten } from "@carraway/db/demo";
import { erstelleTestApp } from "./hilfen-auth";
import { leeren, oeffneTestdb } from "./hilfen";
import { aufrufe, json } from "./hilfen-instrumente";

const { db, pool } = oeffneTestdb();
const { get, post } = aufrufe(erstelleTestApp(db));

/** Ein Zinslauf über die Demo-Fonds liefert plausible Positionen und lässt sich bis zur Buchung führen. */
describe("Demo-Daten: Zinslauf", () => {
  const fonds: { id: string; kurzname: string }[] = [];

  beforeAll(async () => {
    await schreibeDemodaten(db, erzeugeDemodaten({ seed: 1 }));
    fonds.push(...(await get("/fonds").then(json)).daten);
  }, 60_000);
  afterAll(async () => {
    await leeren(db);
    await pool.end();
  });

  it("jeder Fonds mit Darlehen rechnet ohne Fehler, die Beträge sind plausibel", async () => {
    let positionen = 0;
    for (const f of fonds) {
      const antwort = await post("/zinslaeufe", { fondsId: f.id, stichtag: "2026-11-20" });
      expect(antwort.status).toBe(201);
      const lauf = await json(antwort);
      for (const p of lauf.positionen) {
        expect(Number(p.betragGebucht)).toBeGreaterThan(0);
        expect(p.schritte.length).toBeGreaterThan(2);
        expect(p.bis <= "2026-11-20").toBe(true);
      }
      const kontrolle = await get(`/zinslaeufe/${lauf.id}/kontrolle`).then(json);
      // Die Demo bucht Zinsen nicht bis zum Stichtag: die Prüfungen laufen durch, Lücken bleiben ausgewiesen
      expect(kontrolle.pruefungen.find((x: { schluessel: string }) => x.schluessel === "alle_darlehen_abgedeckt").status).toBe("ok");
      expect(kontrolle.pruefungen.find((x: { schluessel: string }) => x.schluessel === "keine_periode_doppelt").status).toBe("ok");
      positionen += lauf.positionen.length;
    }
    expect(positionen).toBeGreaterThan(0);
  });

  it("ein Lauf lässt sich freigeben und buchen, danach ist die Abgrenzung kleiner", async () => {
    const mitPositionen = [];
    for (const f of fonds) {
      const liste = (await get(`/zinslaeufe?fondsId=${f.id}`).then(json)).daten as { id: string; anzahlPositionen: number }[];
      if (liste[0] && liste[0].anzahlPositionen > 0) mitPositionen.push({ fonds: f.id, lauf: liste[0].id });
    }
    expect(mitPositionen.length).toBeGreaterThan(0);
    const { fonds: fondsId, lauf } = mitPositionen[0]!;
    const vorher = await get(`/fonds/${fondsId}/abgrenzung?stichtag=2026-11-20`).then(json);
    expect(Number(vorher.summe.offen)).toBeGreaterThan(0);
    await post(`/zinslaeufe/${lauf}/pruefen`, {}, "a");
    await post(`/zinslaeufe/${lauf}/freigeben`, {}, "b");
    expect((await post(`/zinslaeufe/${lauf}/buchen`, {}, "c")).status).toBe(200);
    const nachher = await get(`/fonds/${fondsId}/abgrenzung?stichtag=2026-11-20`).then(json);
    expect(nachher.summe.offen).toBe("0.00");
    expect(Number(nachher.summe.gesamt)).toBeLessThan(Number(vorher.summe.gesamt));
  });
});
