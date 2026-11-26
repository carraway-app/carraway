import { randomBytes } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { erzeugeDemodaten, schreibeDemoZugaenge, schreibeDemodaten } from "@carraway/db/demo";
import * as s from "@carraway/db";
import { legeDemoPostfachAn } from "../demo/postfach";
import { Schluesselring } from "../geheimnis/krypto";
import { leeren, oeffneTestdb } from "./hilfen";

/** Demo: Der Demo-Anbieter übernimmt erfundene Mails und Termine für Vera, ohne Konto und ohne Netzwerk. */

const { db, pool } = oeffneTestdb();
const ring = new Schluesselring(randomBytes(32));

beforeAll(async () => {
  const daten = erzeugeDemodaten({ seed: 1 });
  await schreibeDemodaten(db, daten);
  const fondsIds = (await db.select({ id: s.fonds.id }).from(s.fonds).orderBy(asc(s.fonds.vintage), asc(s.fonds.name))).map((f) => f.id);
  await schreibeDemoZugaenge(db, fondsIds, undefined, daten.organisationen.filter((o) => o.art === "investor").map((o) => o.id));
});
afterAll(async () => {
  await leeren(db);
  await pool.end();
});

describe("Demo-Postfach", () => {
  it("übernimmt Mails und Termine mit Kontakten der Demo-Daten und verwirft den unbekannten Absender; ein zweiter Aufruf ersetzt statt zu verdoppeln", async () => {
    const e = await legeDemoPostfachAn(db, ring, "demo");
    expect(e).toMatchObject({ verbindungen: 2 });
    expect(e.mails).toBeGreaterThanOrEqual(3);
    expect(e.termine).toBeGreaterThanOrEqual(3);
    const aktivitaeten = await db.select().from(s.aktivitaet);
    const sync = await db.select().from(s.aktivitaetSync);
    expect(sync).toHaveLength(e.mails + e.termine);
    expect(sync.every((x) => x.anbieter === "demo")).toBe(true);
    expect(JSON.stringify(aktivitaeten)).not.toMatch(/Newsletter|newsletter@/);
    expect(aktivitaeten.some((a) => a.art === "termin")).toBe(true);
    expect(sync.some((x) => x.beginn.getTime() > Date.now())).toBe(true); // mindestens ein kommender Termin
    const [vera] = await db.select({ id: s.benutzer.id }).from(s.benutzer).where(eq(s.benutzer.email, "vera@beispiel.example"));
    expect(sync.every((x) => x.benutzerId === vera!.id)).toBe(true);

    const nochmal = await legeDemoPostfachAn(db, ring, "demo");
    expect(nochmal.verbindungen).toBe(2);
    expect(await db.select().from(s.aktivitaetSync)).toHaveLength(sync.length); // Dubletten fängt der Hash ab
  });

  it("im Echtbestand gibt es den Demo-Anbieter nicht", async () => {
    await expect(legeDemoPostfachAn(db, ring, "echt")).rejects.toThrow(/Echtbestand/);
  });
});
