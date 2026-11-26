import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import * as s from "@carraway/db";
import { erzeugeDemodaten, schreibeDemodaten } from "@carraway/db/demo";
import { Decimal } from "@carraway/rechenkern";
import { erstelleTestApp } from "./hilfen-auth";
import { leeren, oeffneTestdb } from "./hilfen";
import { aufrufe, json } from "./hilfen-instrumente";
import { ladeInstrumentUebersicht } from "../instrumente/instrumente";

/** Demofonds aus der Datenbank: Buchwert je Instrument nach Exits (#208) und die Beispiele für SAFE, Optionsscheine und Übertragung (#148). */

const { db, pool } = oeffneTestdb();
const { get } = aufrufe(erstelleTestApp(db));

beforeAll(async () => {
  await schreibeDemodaten(db, erzeugeDemodaten({ seed: 1 }));
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

describe("Demo aus der Datenbank", () => {
  it("Verkäufe der ganzen Beteiligung: Summe der Abgänge je Instrument gleich dem Abgang der Verkäufe, nach dem Vollverkauf alle Instrumente auf null", async () => {
    const verkaeufe = await db.select().from(s.verkauf).where(and(isNull(s.verkauf.instrumentId), isNull(s.verkauf.storniertAm)));
    expect(verkaeufe.length).toBeGreaterThan(0);
    for (const bId of new Set(verkaeufe.map((v) => v.beteiligungId))) {
      const eigene = await db.select().from(s.verkauf).where(and(eq(s.verkauf.beteiligungId, bId), isNull(s.verkauf.storniertAm)));
      const liste = (await db.transaction((tx) => ladeInstrumentUebersicht(tx, bId)))!;
      const abgang = liste.reduce((x, i) => x.plus(i.buchwertabgang), new Decimal(0));
      expect(abgang.toFixed(2), bId).toBe(eigene.reduce((x, v) => x.plus(v.buchwertAbgang), new Decimal(0)).toFixed(2));
      if (eigene.some((v) => v.instrumentId === null && new Decimal(v.anteilVerkauft).equals(1))) expect(liste.map((i) => i.buchwert).every((w) => w === "0.00"), bId).toBe(true);
    }
  });

  it("Tapa Sensorik: Optionsscheine voll verwässert, SAFE als offene Wandlung geschätzt, Übertragung angewandt", async () => {
    const [org] = await db.select().from(s.organisation).where(eq(s.organisation.name, "Tapa Sensorik"));
    const [b] = await db.select().from(s.beteiligung).where(eq(s.beteiligung.organisationId, org!.id));
    const antwort = await get(`/beteiligungen/${b!.id}/kapitaltabelle?stichtag=2026-09-30&offeneWandlungen=true`);
    expect(antwort.status).toBe(200);
    const k = await json(antwort);
    expect(k.zeilen.some((z: { halter: { art: string }; anteile: string }) => z.halter.art === "optionsschein" && z.anteile === "15000")).toBe(true);
    expect(k.zeilen.some((z: { uebertragung: unknown; anteile: string }) => z.uebertragung && z.anteile === "30000")).toBe(true);
    const safe = k.offeneWandlungen.liste.find((w: { art: string }) => w.art === "safe");
    expect(safe).toMatchObject({ status: "geschaetzt", kapital: "150000.00", zinsen: "0.00" });
    expect(Number(safe.anteile)).toBeGreaterThan(0);
  });
});
